// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic connectivity (netlist), a faithful-but-minimal port of KiCad's
 * CONNECTION_GRAPH (eeschema/connection_graph.cpp).
 *
 * The core of KiCad's algorithm, transcribed here:
 *
 *  - updateItemConnectivity(): build a map from each connection point to the items
 *    that touch it. An item's connection points are GetConnectionPoints():
 *      • SCH_LINE (wire) -> { start, end }   (one item spanning two points)
 *      • SCH_LABEL       -> { position }
 *      • SCH_JUNCTION    -> { position }
 *      • SCH_PIN         -> { tip position } (through the symbol transform)
 *    Items sharing a point are connected. A junction additionally ties every wire
 *    whose segment passes through it; a label ties >= 2 wires it overlaps.
 *
 *  - buildItemSubGraphs(): the connected items form subgraphs (nets). Because a wire
 *    is one item present at both of its endpoints, unioning the items at each point
 *    bridges the two endpoints through the wire, so a union-find over items yields
 *    the nets directly.
 *
 *  - GetDriverPriority()/driverName(): each net is named by its highest-priority
 *    driver (global label > power pin > local label > hier label > pin); an
 *    unnamed net gets an auto name Net-(REF-PIN), and a power pin's name is the
 *    power symbol's value (GND, +5V, …).
 *
 *  - Buses: bus lines form their own subgraphs (they never join wires
 *    directly), named by the bus label they carry; a wire-to-bus entry's
 *    bus-side end attaches it to the bus while its wire-side end joins the
 *    ordinary wire graph. Wire nets whose resolved name is a member of the
 *    bus (vector/group expansion incl. bus aliases) connect *across* it,
 *    two entries labelled D0 on the same D[0..7] bus join into one net.
 *
 * Scope: single-sheet connectivity (no hierarchy yet), enough to tell what is
 * electrically joined and to highlight a net.
 */

import type { Schematic, SchSymbol, LibSymbol, Vec2 } from '../types.js';
import { symbolTransform, localToWorld } from '@ziroeda/common/src/transform.js';
import { escapeNetName } from '@ziroeda/common/src/string_utils.js';
import { refId } from '../tools/hittest.js';
import { subReference } from '../fieldbox.js';
import { expandBusLabel, isBusLabel } from './bus.js';
import { SegmentIndex, onSegment as segmentContains } from './segment_index.js';

/** KiCad CONNECTION_SUBGRAPH::PRIORITY (higher wins when naming a net). */
export enum Priority {
  None = 0,
  Pin = 1,
  SheetPin = 2,
  HierLabel = 3,
  LocalLabel = 4,
  LocalPowerPin = 5,
  GlobalPowerPin = 6,
  Global = 7,
}

interface Driver {
  priority: Priority;
  /** Resolved net name for this driver, or '' if it only contributes an auto name. */
  name: string;
  /** Sheet-pin shape, for the OUTPUT-beats-INPUT tie-break. */
  shape?: string;
}

/**
 * The `-Pad` demotion and alphabetical fallback of connection_graph.cpp's
 * compareDrivers (rules 5 and 6): a name KiCad had to build out of a pad number
 * is low quality, so a net with any *named* pin on it takes that pin's name,
 * `Net-(U1A-K)` rather than `Net-(R1-Pad2)`.
 */
export function compareNames(a: string, b: string): number {
  const aLowQuality = a.includes('-Pad');
  const bLowQuality = b.includes('-Pad');
  if (aLowQuality !== bLowQuality) return aLowQuality ? 1 : -1;
  return a < b ? -1 : b < a ? 1 : 0;
}

/**
 * CONNECTION_SUBGRAPH::ResolveDrivers' ranking (connection_graph.cpp's
 * compareDrivers): negative when `a` should name the net. Ties matter, picking
 * whichever driver the file happens to list first names nets differently from
 * KiCad, and a board updated from such a netlist reconnects every pad onto a
 * freshly-named net, stranding its routing on the old one.
 *
 * Two of upstream's rules do not apply here: the bus superset test (buses are a
 * separate subgraph with their own naming) and the power-pin rank, which this
 * port already carries in {@link Priority} (Global/LocalPowerPin over Pin).
 */
function compareDrivers(a: Driver, b: Driver): number {
  if (a.priority !== b.priority) return a.priority > b.priority ? -1 : 1;

  // A sheet pin driving out of its sheet beats one driving in.
  if (a.priority === Priority.SheetPin && a.shape !== b.shape) {
    if (a.shape === 'output') return -1;
    if (b.shape === 'output') return 1;
  }

  return compareNames(a.name, b.name);
}

/**
 * CONNECTION_GRAPH::processSubGraphs' absorption, within one sheet: two
 * strongly-driven subgraphs whose driver names match are one subgraph, and the
 * loser is absorbed rather than merely renamed.
 *
 * Labels connect by name, so this is how a sheet that names the same net twice —
 * a hierarchical label "UTXD0" on the wire leaving the sheet and a plain label
 * "UTXD0" on the wire that feeds it — ends up with one net. It has to happen
 * before the hierarchy is walked: only the subgraph carrying the hierarchical
 * label is a candidate for propagation, so if the plain label's subgraph is still
 * separate at that point it never learns the name the parent settled on and is
 * left behind on "/Child/UTXD0" while the rest of the net becomes "/UTXD0".
 *
 * Upstream matches on `Name( true )` (the driver's own name, no sheet path) and
 * skips weak drivers, `m_strong_driver` being `highest_priority >= HIER_LABEL`.
 */
function absorbSameSheetSubgraphs(allNets: Net[], netByItem: Map<string, number>): Net[] {
  const nets = allNets.filter((n) => n.driverPriority >= Priority.HierLabel);
  if (nets.length < 2) return allNets;

  const classes = mergeBySharedDriverName(nets, Priority.HierLabel);
  const absorbed = new Set<Net>();

  for (const group of classes) {
    const rep = group[0]!;
    for (const net of group.slice(1)) {
      for (const id of net.items) {
        rep.items.push(id);
        netByItem.set(id, rep.code);
      }
      // The absorbed subgraph's own drivers come too, so a third subgraph named
      // by one of them still finds this one (add_connections_to_check recurses
      // onto each candidate it absorbs).
      for (const d of net.drivers)
        if (!rep.drivers.some((x) => x.name === d.name)) rep.drivers.push(d);
      absorbed.add(net);
    }
  }

  return absorbed.size > 0 ? allNets.filter((n) => !absorbed.has(n)) : allNets;
}

/**
 * Group subgraphs by the transitive closure of "shares a driver name at or above
 * `aMinPriority`". Each returned group is ordered with the subgraph whose driver
 * compareDrivers ranks first at the head, so callers can treat `group[0]` as the
 * representative the merged net should be named after.
 */
export function mergeBySharedDriverName(nets: readonly Net[], minPriority: Priority): Net[][] {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let root = i;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    for (let cur = i; cur !== root; ) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  /** prefer_as_representative: whichever driver compareDrivers ranks first. */
  const preferred = (a: number, b: number): boolean => {
    const na = nets[a]!;
    const nb = nets[b]!;
    if (na.driverPriority !== nb.driverPriority) return na.driverPriority > nb.driverPriority;
    return compareNames(na.name, nb.name) < 0;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (preferred(ra, rb)) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  const byName = new Map<string, number[]>();
  nets.forEach((net, i) => {
    for (const d of net.drivers) {
      if (d.priority < minPriority) continue;
      const arr = byName.get(d.name);
      if (arr) arr.push(i);
      else byName.set(d.name, [i]);
    }
  });
  for (const list of byName.values())
    for (let i = 1; i < list.length; i++) union(list[0]!, list[i]!);

  const groups = new Map<number, Net[]>();
  for (let i = 0; i < nets.length; i++) {
    const root = find(i);
    const arr = groups.get(root);
    // The root is the representative, so keep it at the head.
    if (!arr) groups.set(root, [nets[i]!]);
    else if (i === root) arr.unshift(nets[i]!);
    else arr.push(nets[i]!);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** A connectable item (node in the union-find): a wire, label, junction, or symbol pin. */
interface Node {
  id: string;
  points: Vec2[];
  driver: Driver | null;
  /** SCH_PIN::GetDefaultNetName for this pin, the name an otherwise unnamed net
   *  takes ("Net-(R1-Pad1)"). */
  autoName?: string;
  /** The same, for a net that carries a no-connect flag ("unconnected-(…)"). */
  autoNameNoConnect?: string;
}

export interface Net {
  /** 1-based net code, stable for a given schematic ordering. */
  code: number;
  /** SCH_CONNECTION::Name( false ), qualified with the sheet path when the
   *  driver is sheet-local ("/Child/CLK"). This is the net name everywhere else:
   *  the netlist, the board, ERC messages. */
  name: string;
  /** SCH_CONNECTION::Name( true ), the driver's own name, with no sheet path
   *  ("CLK"). Compare against label text and bus member tokens with this. */
  localName: string;
  /** Node ids on this net (wire/label/junction refIds and `<symbolRef>:pin<i>` ids). */
  items: string[];
  /** PRIORITY of the driver that named it (CONNECTION_SUBGRAPH::m_driver).
   *  >= HierLabel is a "strong" driver and < GlobalPowerPin a "local" one,
   *  exactly ResolveDrivers' m_strong_driver / m_local_driver. */
  driverPriority: Priority;
  /**
   * CONNECTION_SUBGRAPH::m_drivers: *every* driver on this subgraph, not just the
   * one that won the naming. A wire carrying both a "VCCA" and a "VRH" label has
   * two, and both are names this subgraph answers to — upstream feeds the
   * non-chosen ones into processSubGraphs' connections_to_check, so any other
   * subgraph named by either of them is the same net. Deduped by name, each
   * keeping its highest priority.
   */
  drivers: { name: string; priority: Priority }[];
}

/** A bus subgraph: the bus lines/entries it spans and its expanded members. */
export interface BusNet {
  /** The bus label naming this subgraph ('' when unlabelled). */
  name: string;
  /** Bus line, bus-label and entry refIds on this bus. */
  items: string[];
  /** Expanded member net names (empty when unlabelled/unparsable). */
  members: string[];
  /** Every bus label on the subgraph; `port` marks hierarchical labels
   *  (upstream's label-vs-port distinction for bus-to-bus conflicts). */
  labels: { id: string; text: string; port: boolean }[];
  /** Bus-shaped sheet pins on this bus: the parent side of a hierarchical bus. */
  sheetPins: { id: string; name: string; sheetId: string }[];
  /** Wire-to-bus entry refIds attached to this bus. */
  entryIds: string[];
}

export interface Netlist {
  nets: Net[];
  /** Node id -> net code. */
  netByItem: Map<string, number>;
  /** Bus subgraphs (buses are not electrical nets themselves). */
  buses: BusNet[];
}

export interface NetlistOptions {
  /** Bus alias definitions (Schematic Setup > Bus Alias Definitions):
   *  alias name -> member tokens, used when expanding group-bus labels. */
  busAliases?: ReadonlyMap<string, readonly string[]>;
  /**
   * The sheet path a net name on this sheet is qualified with,
   * `SCH_SHEET_PATH::PathHumanReadable( true, false, true )`: "/" for the root,
   * "/Power/" one level down, with each sheet name escaped for net-name use.
   * Only the sheet-dependent drivers take it (see {@link prependsSheetPath}).
   * Defaults to the root, which is what a sheet graphed on its own is.
   */
  sheetPath?: string;
}

/**
 * SCH_CONNECTION::recacheName, whether a net named by this driver carries its
 * sheet path. A local label, a hierarchical label and a sheet pin all name a net
 * that is local to (or enters) one sheet, so two sheets may each have a "CLK"
 * without sharing it; a global label, a global power pin and an ordinary pin's
 * auto-generated `Net-(R1-Pad1)` name are sheet-independent and take no prefix.
 */
function prependsSheetPath(priority: Priority): boolean {
  switch (priority) {
    case Priority.SheetPin:
    case Priority.HierLabel:
    case Priority.LocalLabel:
    case Priority.LocalPowerPin:
      return true;
    default:
      return false;
  }
}

const key = (p: Vec2): string => `${p.x},${p.y}`;

/** The `k` of a `<symbolRefId>:pin<k>` node id, the fallback for an unnumbered pin. */
const pinIndexOf = (id: string): number => Number(id.slice(id.lastIndexOf(':pin') + 4));

/** A symbol pin instance in world coordinates, as enumerated for the netlist/ERC. */
export interface PinNode {
  /** Node id, `<symbolRefId>:pin<k>`, identical to the ids computeNetlist emits. */
  id: string;
  symId: string;
  ref: string;
  /** SCH_SYMBOL::GetRef( sheet, true ), the reference with its unit token when
   *  the symbol has several units ("U1A"); the plain reference otherwise. */
  refWithUnit: string;
  number: string;
  name: string;
  /** Electrical type token: input | output | ... (see ERC pin matrix). */
  electricalType: string;
  at: Vec2;
  /** True when the pin's parent lib symbol is a power symbol (GND, +5V...). */
  isPowerSymbol: boolean;
  /** …and that symbol is a *local* power symbol (`(power local)`), whose pin
   *  drives only its own sheet (SCH_PIN::IsLocalPower). */
  isLocalPowerSymbol: boolean;
  hidden: boolean;
}

/**
 * Enumerate every placed symbol's pins in world coordinates. This is the single
 * source of pin identity shared by computeNetlist and the ERC checker, so the
 * `:pin<k>` ids always agree.
 */
export function enumeratePins(sch: Schematic, libById: Map<string, LibSymbol>): PinNode[] {
  const out: PinNode[] = [];
  sch.symbols.forEach((sym, si) => {
    const lib = libById.get(sym.libId);
    if (!lib) return;
    const symId = refId('symbol', sym.uuid, si);
    const t = symbolTransform(sym.angle, sym.mirror);
    const ref = fieldValue(sym, 'Reference') ?? '?';
    // GetRef( …, true ) only appends the unit token for a multi-unit symbol.
    const unitCount = lib.units.reduce((m, u) => Math.max(m, u.unit), 0);
    const refWithUnit = unitCount > 1 ? `${ref}${subReference(sym.unit)}` : ref;
    let k = 0;
    for (const u of lib.units) {
      if (
        (u.unit !== 0 && u.unit !== sym.unit) ||
        (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
      )
        continue;
      for (const pin of u.pins) {
        out.push({
          id: `${symId}:pin${k}`,
          symId,
          ref,
          refWithUnit,
          number: pin.number,
          name: pin.name,
          electricalType: pin.electricalType,
          at: localToWorld(sym.at, t, pin.at),
          isPowerSymbol: lib.isPower,
          isLocalPowerSymbol: lib.isPower && (lib.isLocalPower ?? false),
          hidden: pin.hidden,
        });
        k++;
      }
    }
  });
  return out;
}

/** True if point p lies on the segment a-b (exact, integer IU coordinates). */
export const onSegment = segmentContains;

function fieldValue(sym: SchSymbol, keyName: string): string | undefined {
  return sym.fields.find((f) => f.key === keyName)?.value;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = this.parent.get(x);
    if (root === undefined) {
      this.parent.set(x, x);
      return x;
    }
    while (root !== this.parent.get(root)) root = this.parent.get(root)!;
    // Path-compress.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b));
  }
}

/**
 * The connection name carried by a node id, SCH_ITEM::Connection()->Name().
 * Wire-graph nodes answer with their net; a bus line/label/entry answers with
 * the bus's name. An unnamed bus has no connection name, like upstream's empty
 * SCH_CONNECTION.
 */
export function connectionName(netlist: Netlist, nodeId: string): string | null {
  const code = netlist.netByItem.get(nodeId);
  if (code !== undefined) return netlist.nets.find((n) => n.code === code)?.name ?? null;
  const bus = netlist.buses.find((b) => b.items.includes(nodeId));
  return bus?.name ? bus.name : null;
}

/**
 * CONNECTION_GRAPH::GetEquivalentBusNames: the other names the same bus
 * subgraph answers to, so `{MIXED_BUS}` and its expansion `{FOO BAR}`
 * highlight together.
 */
export function equivalentBusNames(netlist: Netlist, name: string): string[] {
  const out: string[] = [];
  for (const b of netlist.buses) {
    if (b.name !== name && !b.labels.some((l) => l.text === name)) continue;
    if (b.name && b.name !== name) out.push(b.name);
    for (const l of b.labels) if (l.text !== name) out.push(l.text);
  }
  return out;
}

/** Compute the single-sheet netlist for a schematic. */
export function computeNetlist(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  opts: NetlistOptions = {},
): Netlist {
  const sheetPath = opts.sheetPath ?? '/';
  const nodes: Node[] = [];
  const wireNodes: { id: string; a: Vec2; b: Vec2 }[] = [];
  const busNodes: { id: string; a: Vec2; b: Vec2 }[] = [];

  // Wires (only nets, not buses) contribute their two endpoints as one item.
  sch.lines.forEach((line, i) => {
    const id = refId('line', line.uuid, i);
    if (line.kind === 'bus') {
      busNodes.push({ id, a: line.start, b: line.end });
      return;
    }
    if (line.kind !== 'wire') return;
    nodes.push({ id, points: [line.start, line.end], driver: null });
    wireNodes.push({ id, a: line.start, b: line.end });
  });

  // Wires and buses are indexed once so "what passes through this point?",
  // asked for every junction, label, bus entry and sheet pin below, costs a
  // hash lookup instead of a scan over every segment on the sheet.
  const busIndex = new SegmentIndex(busNodes.map((b) => ({ item: b.id, a: b.a, b: b.b })));
  const onAnyBus = (p: Vec2): boolean => busIndex.any(p);

  // Junctions.
  sch.junctions.forEach((j, i) => {
    nodes.push({ id: refId('junction', j.uuid, i), points: [j.at], driver: null });
  });

  // Labels: priority/name by kind. A bus label (vector/group syntax) sitting
  // on a bus names the bus subgraph instead of driving a wire net.
  const busLabels: { id: string; at: Vec2; text: string; priority: Priority; port: boolean }[] = [];
  /** Bus-shaped sheet pins: the hierarchy's bus ports on the parent side. */
  const busSheetPins: { id: string; at: Vec2; text: string; sheetId: string }[] = [];
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return; // free text is not a net driver
    const priority =
      l.kind === 'global_label'
        ? Priority.Global
        : l.kind === 'hierarchical_label'
          ? Priority.HierLabel
          : Priority.LocalLabel;
    if (isBusLabel(l.text) && onAnyBus(l.at)) {
      busLabels.push({
        id: refId('label', l.uuid, i),
        at: l.at,
        text: l.text,
        priority,
        port: l.kind === 'hierarchical_label',
      });
      return;
    }
    nodes.push({
      id: refId('label', l.uuid, i),
      points: [l.at],
      // CONNECTION_SUBGRAPH::driverName escapes a label's text for use as a net
      // name (EscapeString CTX_NETNAME), so a label reading "CLKIN/EXTAL" names
      // the net "CLKIN{slash}EXTAL" — the slash is the sheet-path separator and
      // cannot survive raw.
      driver: { priority, name: escapeNetName(l.text) },
    });
  });

  // Wire-to-bus entries: the bus-side end (on a bus segment) attaches the
  // entry to that bus; the wire-side end joins the ordinary wire graph, so
  // the entry carries its wire's net (SCH_BUS_WIRE_ENTRY connection points).
  const entryBusEnd: { id: string; at: Vec2 }[] = [];
  sch.busEntries.forEach((e, i) => {
    const id = refId('busentry', e.uuid, i);
    const p1 = e.at;
    const p2 = { x: e.at.x + e.size.x, y: e.at.y + e.size.y };
    const p1Bus = onAnyBus(p1);
    const p2Bus = onAnyBus(p2);
    const wireEnds: Vec2[] = [];
    if (p1Bus) entryBusEnd.push({ id, at: p1 });
    else wireEnds.push(p1);
    if (p2Bus) entryBusEnd.push({ id, at: p2 });
    else wireEnds.push(p2);
    nodes.push({ id, points: wireEnds, driver: null });
  });

  // Hierarchical sheet pins connect like labels at their point (KiCad driver
  // priority SHEET_PIN; the pin name names the net within this sheet). A pin
  // whose name is bus syntax and which sits on a bus joins the *bus* graph
  // instead, SCH_SHEET_PIN::ConfigureFromLabel makes it a BUS connection.
  sch.sheets.forEach((sh, si) => {
    const shId = refId('sheet', sh.uuid, si);
    sh.pins.forEach((p, k) => {
      const id = `${shId}:sheetpin${k}`;
      if (isBusLabel(p.name) && onAnyBus(p.at)) {
        busSheetPins.push({ id, at: p.at, text: p.name, sheetId: shId });
        return;
      }
      nodes.push({
        id,
        points: [p.at],
        // …and the same for a sheet pin's name (driverName's SCH_SHEET_PIN_T arm).
        driver: { priority: Priority.SheetPin, name: escapeNetName(p.name), shape: p.shape },
      });
    });
  });

  // No-connect flags join the net at their point (KiCad: SCH_NO_CONNECT is a
  // connectable item; the subgraph carrying one is exempt from unconnected checks).
  const noConnectIds = new Set<string>();
  sch.noConnects.forEach((nc, i) => {
    const id = refId('noconnect', nc.uuid, i);
    noConnectIds.add(id);
    nodes.push({ id, points: [nc.at], driver: null });
  });

  // Symbol pins (through the placement transform). Power symbols drive a power net
  // named by the symbol's Value; ordinary pins drive a Net-(REF-pin) auto name.
  const valueBySym = new Map(
    sch.symbols.map((s, i) => [refId('symbol', s.uuid, i), fieldValue(s, 'Value') ?? '']),
  );
  const uuidBySym = new Map(sch.symbols.map((s, i) => [refId('symbol', s.uuid, i), s.uuid ?? '']));
  const allPins = enumeratePins(sch, libById);
  /** The other pins of each symbol, for GetDefaultNetName's has_multiple test. */
  const pinsBySym = new Map<string, PinNode[]>();
  for (const p of allPins) {
    const arr = pinsBySym.get(p.symId) ?? [];
    arr.push(p);
    pinsBySym.set(p.symId, arr);
  }

  /**
   * SCH_PIN::GetDefaultNetName, the name a pin gives a net nothing else names.
   * `unconnected` is set when the pin is a no-connect type or the net carries a
   * no-connect flag (upstream's aForceNoConnect), which swaps the prefix and forces
   * the pad number into the name.
   */
  const defaultNetName = (pin: PinNode, unconnected: boolean): string => {
    const open = unconnected ? 'unconnected-(' : 'Net-(';
    const padNumber = pin.number || String(pinIndexOf(pin.id) + 1);
    const shownName = pin.name === '~' ? '' : pin.name;

    // Use the timestamp for unannotated symbols.
    if (pin.ref.endsWith('?')) {
      return `${open}${uuidBySym.get(pin.symId) ?? ''}-Pad${padNumber})`;
    }

    if (shownName !== '' && shownName !== pin.number) {
      // Pin names might not be unique between units, so the reference designator
      // carries the unit token; the pad number is added when it has to disambiguate.
      const hasMultiple = (pinsBySym.get(pin.symId) ?? []).some(
        (other) =>
          other.name === pin.name &&
          other.number !== pin.number &&
          unconnected === (other.electricalType === 'no_connect'),
      );
      const pad = unconnected || hasMultiple ? `-Pad${escapeNetName(padNumber)}` : '';
      return `${open}${pin.refWithUnit}-${escapeNetName(shownName)}${pad})`;
    }

    // Pin numbers are unique, so the unit token is skipped.
    return `${open}${pin.ref}-Pad${escapeNetName(padNumber)})`;
  };

  for (const pin of allPins) {
    const node: Node = { id: pin.id, points: [pin.at], driver: null };
    // GetDriverPriority for a pin: a power *input* pin drives a power net,
    // GLOBAL_POWER_PIN for a global power symbol (or the legacy invisible
    // power-in pin on an ordinary symbol, named after the pin rather than the
    // symbol value, SCH_PIN::GetDefaultNetName), LOCAL_POWER_PIN for a
    // `(power local)` symbol. A power symbol's power_out pin (PWR_FLAG) drives
    // no name at all; it only makes the net driven for ERC.
    const powerPin =
      pin.electricalType === 'power_in' &&
      (pin.isPowerSymbol || (pin.hidden && !pin.isPowerSymbol));
    if (powerPin) {
      node.driver = {
        priority: pin.isLocalPowerSymbol ? Priority.LocalPowerPin : Priority.GlobalPowerPin,
        name: pin.isPowerSymbol ? (valueBySym.get(pin.symId) ?? '') : pin.name,
      };
    } else if (!pin.ref.startsWith('#')) {
      // ResolveDrivers skips a pin whose symbol is not in the netlist
      // (SCH_SYMBOL::m_isInNetlist = !ref.StartsWith("#")), so a PWR_FLAG or
      // other virtual symbol never lends a net its name.
      //
      // Both spellings: which one applies depends on whether the net this pin
      // lands on carries a no-connect, which is only known once nets are grouped.
      node.autoName = defaultNetName(pin, pin.electricalType === 'no_connect');
      node.autoNameNoConnect = defaultNetName(pin, true);
    }
    nodes.push(node);
  }

  // Build the point -> node-ids map (KiCad's connection_map).
  const pointMap = new Map<string, Set<string>>();
  const add = (p: Vec2, id: string): void => {
    const kk = key(p);
    let s = pointMap.get(kk);
    if (!s) {
      s = new Set();
      pointMap.set(kk, s);
    }
    s.add(id);
  };
  for (const n of nodes) for (const p of n.points) add(p, n.id);

  const wireIndex = new SegmentIndex(wireNodes.map((w) => ({ item: w.id, a: w.a, b: w.b })));

  // Junction rule: a junction ties every wire whose segment passes through it.
  sch.junctions.forEach((j) => {
    for (const id of wireIndex.hits(j.at)) add(j.at, id);
  });

  // Label-over-wires rule: a label overlapping >= 2 wires ties them (KiCad enforces
  // connectivity for all wires under a label even without an explicit junction).
  sch.labels.forEach((l) => {
    if (l.kind === 'text') return;
    const overlapping = wireIndex.hits(l.at);
    if (overlapping.length < 2) return;
    for (const id of overlapping) add(l.at, id);
  });

  // Label-on-segment rule (SCH_LABEL_BASE::UpdateDanglingState): a label lying
  // anywhere along a wire or bus segment connects to that line, not just at one
  // of its ends. Upstream's connection_map only ties items that share an exact
  // point, so the dangling pass contributes this edge itself ("Add the line to
  // the connected items, since it won't be picked up by a search of intersecting
  // connection points"), and CONNECTION_GRAPH::Recalculate runs it between
  // updateItemConnectivity and buildConnectionGraph so the subgraph walk sees it.
  //
  // The order upstream tests in is load-bearing: an exact-position pin, label,
  // sheet pin or no-connect settles the label and *no* line edge is added; only
  // then bus segments, then wire segments, and only the first hit counts.
  const labelsAtPoint = new Map<string, number>();
  for (const l of sch.labels) {
    if (l.kind === 'text') continue;
    labelsAtPoint.set(key(l.at), (labelsAtPoint.get(key(l.at)) ?? 0) + 1);
  }
  const anchorPoints = new Set<string>();
  for (const p of allPins) anchorPoints.add(key(p.at)); // PIN_END
  for (const nc of sch.noConnects) anchorPoints.add(key(nc.at)); // NO_CONNECT_END
  for (const sh of sch.sheets) for (const p of sh.pins) anchorPoints.add(key(p.at)); // SHEET_LABEL_END
  for (const l of sch.labels) {
    if (l.kind === 'text') continue;
    const kk = key(l.at);
    // LABEL_END counts only for a *different* label on the point; upstream skips
    // the entry whose item is the label being tested.
    if (anchorPoints.has(kk) || (labelsAtPoint.get(kk) ?? 0) > 1) continue;
    if (busIndex.any(l.at)) continue; // BUS_END wins: it joins the bus, not a wire
    const wireId = wireIndex.hits(l.at)[0];
    if (wireId !== undefined) add(l.at, wireId);
  }

  // Union items sharing a point; wires bridge their two endpoints automatically.
  const uf = new UnionFind();
  for (const n of nodes) uf.find(n.id); // ensure every node exists
  for (const ids of pointMap.values()) {
    const arr = [...ids];
    for (let i = 1; i < arr.length; i++) uf.union(arr[0]!, arr[i]!);
  }

  // ----- Bus subgraphs (separate union-find: buses never join wires) -------
  const busUf = new UnionFind();
  const busPointMap = new Map<string, Set<string>>();
  const addBus = (p: Vec2, id: string): void => {
    const kk = key(p);
    let s = busPointMap.get(kk);
    if (!s) {
      s = new Set();
      busPointMap.set(kk, s);
    }
    s.add(id);
  };
  for (const b of busNodes) {
    busUf.find(b.id);
    addBus(b.a, b.id);
    addBus(b.b, b.id);
  }
  // Junctions tie buses crossing through them, like wires.
  sch.junctions.forEach((j) => {
    for (const id of busIndex.hits(j.at)) addBus(j.at, id);
  });
  for (const ids of busPointMap.values()) {
    const arr = [...ids];
    for (let i = 1; i < arr.length; i++) busUf.union(arr[0]!, arr[i]!);
  }
  // A bus label names the subgraph of the bus segment it sits on; an entry's
  // bus-side end attaches it to that subgraph.
  const busRootOfPoint = (p: Vec2): string | null => {
    const hit = busIndex.hits(p)[0];
    return hit === undefined ? null : busUf.find(hit);
  };
  const busInfo = new Map<
    string,
    {
      label: { text: string; priority: Priority } | null;
      labels: { id: string; text: string; port: boolean }[];
      sheetPins: { id: string; name: string; sheetId: string }[];
      entryIds: string[];
    }
  >();
  const infoFor = (root: string): NonNullable<ReturnType<typeof busInfo.get>> => {
    let inf = busInfo.get(root);
    if (!inf) {
      inf = { label: null, labels: [], sheetPins: [], entryIds: [] };
      busInfo.set(root, inf);
    }
    return inf;
  };
  for (const b of busNodes) infoFor(busUf.find(b.id));
  for (const bl of busLabels) {
    const root = busRootOfPoint(bl.at);
    if (!root) continue;
    const inf = infoFor(root);
    inf.labels.push({ id: bl.id, text: bl.text, port: bl.port });
    if (!inf.label || bl.priority > inf.label.priority)
      inf.label = { text: bl.text, priority: bl.priority };
  }
  for (const sp of busSheetPins) {
    const root = busRootOfPoint(sp.at);
    if (!root) continue;
    const inf = infoFor(root);
    inf.sheetPins.push({ id: sp.id, name: sp.text, sheetId: sp.sheetId });
    // SHEET_PIN priority never outranks a label, so it only names the bus when
    // nothing else does.
    if (!inf.label) inf.label = { text: sp.text, priority: Priority.SheetPin };
  }

  const entriesByBusRoot = new Map<string, string[]>();
  for (const e of entryBusEnd) {
    const root = busRootOfPoint(e.at);
    if (!root) continue;
    infoFor(root).entryIds.push(e.id);
    const arr = entriesByBusRoot.get(root) ?? [];
    arr.push(e.id);
    entriesByBusRoot.set(root, arr);
  }

  // Member resolution across each bus: wire nets attached via entries whose
  // resolved name is one of the bus's members join into a single net
  // (CONNECTION_GRAPH's bus neighbor propagation).
  // The highest-priority driver on each net, gathered in one pass. Re-deriving
  // it by walking every node for every bus entry made this quadratic on sheets
  // with wide buses; the map is kept correct across the unions below.
  const bestByRoot = new Map<string, Driver>();
  for (const n of nodes) {
    if (!n.driver?.name) continue;
    const root = uf.find(n.id);
    const cur = bestByRoot.get(root);
    if (!cur || compareDrivers(n.driver, cur) < 0) bestByRoot.set(root, n.driver);
  }
  const provisionalName = (root: string): string | null =>
    bestByRoot.get(uf.find(root))?.name ?? null;
  /** Union two nets and carry the winning driver onto the surviving root. */
  const unionNets = (a: string, b: string): void => {
    const da = bestByRoot.get(uf.find(a));
    const db = bestByRoot.get(uf.find(b));
    uf.union(a, b);
    const best = !da ? db : !db ? da : compareDrivers(da, db) <= 0 ? da : db;
    if (best) bestByRoot.set(uf.find(a), best);
  };
  const buses: BusNet[] = [];
  for (const [root, inf] of busInfo) {
    const expansion = inf.label ? expandBusLabel(inf.label.text, opts.busAliases) : null;
    const members = expansion?.members ?? [];
    const busItems = busNodes.filter((b) => busUf.find(b.id) === root).map((b) => b.id);
    buses.push({
      name: inf.label?.text ?? '',
      items: [
        ...busItems,
        ...inf.labels.map((l) => l.id),
        ...inf.sheetPins.map((p) => p.id),
        ...inf.entryIds,
      ],
      members,
      labels: inf.labels,
      sheetPins: inf.sheetPins,
      entryIds: inf.entryIds,
    });
    if (members.length === 0) continue;
    const memberSet = new Set(members);
    const byMember = new Map<string, string>();
    for (const entryId of entriesByBusRoot.get(root) ?? []) {
      const wireRoot = uf.find(entryId);
      const name = provisionalName(wireRoot);
      if (!name || !memberSet.has(name)) continue;
      const prior = byMember.get(name);
      if (prior) unionNets(prior, wireRoot);
      else byMember.set(name, wireRoot);
    }
  }

  // Group nodes by net root.
  const byRoot = new Map<string, Node[]>();
  for (const n of nodes) {
    const r = uf.find(n.id);
    let g = byRoot.get(r);
    if (!g) {
      g = [];
      byRoot.set(r, g);
    }
    g.push(n);
  }

  // Name each net by its highest-priority driver; fall back to a pin auto name.
  const nets: Net[] = [];
  const netByItem = new Map<string, number>();
  let code = 1;
  for (const group of byRoot.values()) {
    let best: Driver | null = null;
    /** The pin whose default name would name this net if nothing else does. */
    let autoPin: Node | null = null;
    // aForceNoConnect: a net carrying a no-connect flag names its pin "unconnected-".
    const forceNoConnect = group.some((n) => noConnectIds.has(n.id));
    /** Every driver on the subgraph, the names it merges on (m_drivers). */
    const drivers: { name: string; priority: Priority }[] = [];
    for (const n of group) {
      const d = n.driver;
      if (d?.name && (!best || compareDrivers(d, best) < 0)) best = d;
      if (d?.name) {
        const seen = drivers.find((x) => x.name === d.name);
        if (!seen) drivers.push({ name: d.name, priority: d.priority });
        else if (d.priority > seen.priority) seen.priority = d.priority;
      }
      // Pin candidates are ranked on the plain spelling, as ResolveDrivers ranks
      // them on GetNameForDriver; the "unconnected-" spelling of the winner is
      // only picked up once the winner is known.
      if (n.autoName && (!autoPin || compareNames(n.autoName, autoPin.autoName!) < 0)) autoPin = n;
    }
    const auto = autoPin
      ? forceNoConnect
        ? autoPin.autoNameNoConnect
        : autoPin.autoName
      : undefined;
    // A sheet-local driver qualifies the name with the sheet path it drives on.
    const localName = best ? best.name : (auto ?? `Net-${code}`);
    const name = best && prependsSheetPath(best.priority) ? `${sheetPath}${localName}` : localName;
    const items = group.map((n) => n.id);
    nets.push({
      code,
      name,
      localName,
      items,
      driverPriority: best?.priority ?? Priority.None,
      drivers,
    });
    for (const id of items) netByItem.set(id, code);
    code++;
  }

  // processSubGraphs' absorption closes the graph for this sheet, so everything
  // downstream — ERC re-graphing one sheet, the hierarchy walk — sees the same
  // subgraphs KiCad would.
  return { nets: absorbSameSheetSubgraphs(nets, netByItem), netByItem, buses };
}
