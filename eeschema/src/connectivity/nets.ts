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
import { expandBusLabel, isBusLabel } from './bus.js';

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
  number: string;
  name: string;
  /** Electrical type token: input | output | ... (see ERC pin matrix). */
  electricalType: string;
  at: Vec2;
  /** True when the pin's parent lib symbol is a power symbol (GND, +5V, ...). */
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
export function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

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

  const onAnyBus = (p: Vec2): boolean => busNodes.some((b) => onSegment(p, b.a, b.b));

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
      driver: { priority, name: l.text },
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
        driver: { priority: Priority.SheetPin, name: p.name },
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
      return `${open}${pin.ref}-${escapeNetName(shownName)}${pad})`;
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
    } else {
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

  // Junction rule: a junction ties every wire whose segment passes through it.
  sch.junctions.forEach((j, i) => {
    const jid = refId('junction', j.uuid, i);
    for (const w of wireNodes) {
      if (onSegment(j.at, w.a, w.b)) add(j.at, w.id);
    }
    void jid;
  });

  // Label-over-wires rule: a label overlapping >= 2 wires ties them (KiCad enforces
  // connectivity for all wires under a label even without an explicit junction).
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return;
    const overlapping = wireNodes.filter((w) => onSegment(l.at, w.a, w.b));
    if (overlapping.length < 2) return;
    const lid = refId('label', l.uuid, i);
    for (const w of overlapping) {
      add(l.at, w.id);
    }
    void lid;
  });

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
    for (const b of busNodes) if (onSegment(j.at, b.a, b.b)) addBus(j.at, b.id);
  });
  for (const ids of busPointMap.values()) {
    const arr = [...ids];
    for (let i = 1; i < arr.length; i++) busUf.union(arr[0]!, arr[i]!);
  }
  // A bus label names the subgraph of the bus segment it sits on; an entry's
  // bus-side end attaches it to that subgraph.
  const busRootOfPoint = (p: Vec2): string | null => {
    for (const b of busNodes) if (onSegment(p, b.a, b.b)) return busUf.find(b.id);
    return null;
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
  const provisionalName = (root: string): string | null => {
    let best: Driver | null = null;
    for (const n of nodes) {
      if (uf.find(n.id) !== root) continue;
      if (n.driver?.name && (!best || n.driver.priority > best.priority)) best = n.driver;
    }
    return best?.name ?? null;
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
      if (prior) uf.union(prior, wireRoot);
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
    let auto: string | undefined;
    // aForceNoConnect: a net carrying a no-connect flag names its pin "unconnected-".
    const forceNoConnect = group.some((n) => noConnectIds.has(n.id));
    for (const n of group) {
      if (n.driver?.name && (!best || n.driver.priority > best.priority)) best = n.driver;
      if (auto === undefined) {
        const candidate = forceNoConnect ? n.autoNameNoConnect : n.autoName;
        if (candidate) auto = candidate;
      }
    }
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
    });
    for (const id of items) netByItem.set(id, code);
    code++;
  }

  return { nets, netByItem, buses };
}
