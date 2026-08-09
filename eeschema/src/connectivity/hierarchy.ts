// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hierarchy-wide connectivity. Counterpart: the sheet-crossing half of
 * `eeschema/connection_graph.cpp`, `CONNECTION_GRAPH::propagateToNeighbors`
 * and the sheet bookkeeping around it.
 *
 * Each sheet instance is graphed on its own (computeNetlist gives us that
 * sheet's CONNECTION_SUBGRAPHs). This module then joins those graphs the way
 * upstream does:
 *
 *  - `visit()`: a subgraph carrying a **sheet pin** looks into the child sheet
 *    that pin belongs to for a strongly-driven subgraph carrying a
 *    **hierarchical label** of the same name, that child is a neighbour; a
 *    subgraph carrying a hierarchical label looks the other way, at the parent
 *    sheet's subgraphs whose sheet pin (on the sheet symbol we came through)
 *    has the same name.
 *  - a subgraph that has *both* ports and pins is skipped: it will be reached
 *    from one end or the other. A subgraph with neither is not hierarchical.
 *  - the neighbours are walked breadth-first, then the **best driver** among
 *    the visited chain is chosen with upstream's rules (a global/power driver
 *    wins outright; otherwise a strong driver beats a weak one, higher priority
 *    wins, then the shorter sheet path, then the alphabetically lower name),
 *    and every subgraph in the chain takes that name.
 *
 * The result is that hierarchically connected nets share one name across the
 * sheets, which is what lets ERC treat them as one net.
 */

import { escapeNetName } from '@ziroeda/common/src/string_utils.js';
import type { Schematic } from '../types.js';
import { sheetName } from '../project.js';
import { refId } from '../tools/hittest.js';
import {
  computeNetlist,
  mergeBySharedDriverName,
  Priority,
  type Net,
  type Netlist,
  type NetlistOptions,
} from './nets.js';

/** One sheet instance of the hierarchy (a SCH_SHEET_PATH plus its screen). */
export interface HierSheet {
  /** Instance path, "/" for the root and "/<sheetUuid>/…" below it. */
  path: string;
  /** Sheet file name (several instances can share one). */
  file: string;
  doc: Schematic;
}

/** A sheet's graph plus the hierarchical links its nets carry. */
interface SheetGraph {
  sheet: HierSheet;
  netlist: Netlist;
  /** Depth of the sheet path (SCH_SHEET_PATH::size), for the shorter-path rule. */
  depth: number;
  /** net code -> the sheet pins on it: the child path they open and their name. */
  hierPins: Map<number, { childPath: string; name: string }[]>;
  /** net code -> the hierarchical labels on it. */
  hierPorts: Map<number, string[]>;
}

/** A subgraph of the hierarchy: one net of one sheet instance. */
interface SubGraph {
  key: string;
  graph: SheetGraph;
  code: number;
}

export interface HierarchyNetlist {
  /** Each sheet instance's netlist, with hierarchical names propagated. */
  bySheet: Map<string, Netlist>;
  /**
   * Each sheet instance's human-readable path, the prefix its sheet-local net
   * names carry. Anything that re-graphs a single sheet (ERC) must pass the same
   * path so the two agree on net names.
   */
  humanPaths: Map<string, string>;
  /**
   * Per sheet instance, the rename propagateToNeighbors applied: the name the
   * sheet's own graph gave a net -> the name the hierarchy settled on. A sheet
   * graphed alone cannot know that a parent's local label outranks its own
   * hierarchical label, so "/Child/SIG" locally is "/SIG" once the chain is
   * resolved. Anything that re-graphs one sheet and then has to talk about the
   * *hierarchy's* nets (ERC's external-pin lists) translates through this;
   * upstream has one graph for the whole hierarchy and never has to ask.
   */
  hierNetNames: Map<string, Map<string, string>>;
}

/** The child instance path a sheet symbol opens (buildSheetTree's convention). */
const childPathOf = (parentPath: string, sheetUuid: string, index: number): string =>
  `${parentPath}${sheetUuid || `i${index}`}/`;

/** The parent instance path of a sheet path ("/a/b/" -> "/a/"); null at the root. */
export function parentPathOf(path: string): string | null {
  if (path === '/') return null;
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}/` : '/';
}

/** The last sheet-symbol uuid of an instance path ("/a/b/" -> "b"). */
const lastSheetOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? '';

/**
 * SCH_SHEET_PATH::PathHumanReadable( true, false, true ) for every sheet instance:
 * "/" for the root, then one escaped sheet name per level ("/Power/Filter/"). This is
 * the prefix a sheet-local net name carries, so two sheets can each have a "CLK"
 * without sharing it.
 */
export function humanReadablePaths(sheets: readonly HierSheet[]): Map<string, string> {
  const byPath = new Map(sheets.map((s) => [s.path, s]));
  const out = new Map<string, string>();

  const resolve = (path: string, seen: Set<string>): string => {
    const cached = out.get(path);
    if (cached !== undefined) return cached;
    if (path === '/' || seen.has(path)) return '/';
    seen.add(path);

    const parentPath = parentPathOf(path) ?? '/';
    const parent = byPath.get(parentPath);
    const uuid = lastSheetOf(path);
    // The sheet symbol in the parent that opens this instance, matched the way
    // childPathOf builds the path (uuid, or the index when the sheet has none).
    const symbol = parent?.doc.sheets.find((sh, i) => (sh.uuid || `i${i}`) === uuid);
    const name = symbol ? escapeNetName(sheetName(symbol)) : '';
    const result = `${resolve(parentPath, seen)}${name}/`;
    out.set(path, result);
    return result;
  };

  out.set('/', '/');
  for (const sheet of sheets) resolve(sheet.path, new Set());
  return out;
}

/**
 * The transitive closure over "shares a global driver name", applied to every
 * sheet's subgraphs at once (CONNECTION_GRAPH::buildConnectionGraph).
 *
 * Upstream indexes each global subgraph under the name of *every* driver it
 * carries at GLOBAL_POWER_PIN priority or above, unions the subgraphs sharing a
 * name, and clones the winning connection onto the rest. The one case that makes
 * this load-bearing rather than cosmetic: a schematic that ties two power rails
 * together — a wire joining a VCC, a VDD and a +3.3V power symbol — puts three
 * global names on one subgraph, and every subgraph named by any of them, on any
 * sheet, is then the same net. Without it the rails stay apart, the netlist
 * hands the board nets KiCad never had, and ERC reports each unmerged rail as an
 * undriven power net.
 *
 * The representative is picked with compareDrivers' rules (priority, then the
 * -Pad demotion and alphabetical order of compareNames), so the class settles on
 * the name upstream would have chosen.
 */
function globalEquivalenceClasses(graphs: ReadonlyMap<string, SheetGraph>): void {
  const all: Net[] = [];
  for (const graph of graphs.values())
    for (const net of graph.netlist.nets)
      if (net.drivers.some((d) => d.priority >= Priority.GlobalPowerPin)) all.push(net);
  if (all.length < 2) return;

  // Global names span sheets, so unlike the same-sheet absorption above this only
  // renames: the subgraphs stay on their own sheets and keep their own items.
  for (const group of mergeBySharedDriverName(all, Priority.GlobalPowerPin)) {
    const rep = group[0]!;
    for (const net of group.slice(1)) {
      if (net.name === rep.name) continue;
      net.name = rep.name;
      net.localName = rep.localName;
    }
  }
}

/**
 * Graph every sheet instance and propagate net names across the hierarchy.
 * `sheets` is the flattened hierarchy (SCH_SHEET_LIST order).
 */
export function computeHierarchyNetlist(
  sheets: readonly HierSheet[],
  libsFor: (sheet: HierSheet) => Map<string, import('../types.js').LibSymbol>,
  opts: NetlistOptions = {},
): HierarchyNetlist {
  const graphs = new Map<string, SheetGraph>();
  const humanPaths = humanReadablePaths(sheets);

  for (const sheet of sheets) {
    if (graphs.has(sheet.path)) continue;
    const netlist = computeNetlist(sheet.doc, libsFor(sheet), {
      ...opts,
      sheetPath: humanPaths.get(sheet.path) ?? '/',
    });
    const hierPins = new Map<number, { childPath: string; name: string }[]>();
    const hierPorts = new Map<number, string[]>();

    // The sheet pins of this sheet's sheet symbols, by the net they sit on.
    sheet.doc.sheets.forEach((sh, si) => {
      const shId = refId('sheet', sh.uuid, si);
      const childPath = childPathOf(sheet.path, sh.uuid ?? '', si);
      sh.pins.forEach((p, k) => {
        const code = netlist.netByItem.get(`${shId}:sheetpin${k}`);
        if (code === undefined) return;
        const arr = hierPins.get(code) ?? [];
        arr.push({ childPath, name: p.name });
        hierPins.set(code, arr);
      });
    });

    // The hierarchical labels of this sheet, by the net they sit on.
    sheet.doc.labels.forEach((l, i) => {
      if (l.kind !== 'hierarchical_label') return;
      const code = netlist.netByItem.get(refId('label', l.uuid, i));
      if (code === undefined) return;
      const arr = hierPorts.get(code) ?? [];
      arr.push(l.text);
      hierPorts.set(code, arr);
    });

    graphs.set(sheet.path, {
      sheet,
      netlist,
      depth: sheet.path === '/' ? 1 : sheet.path.split('/').filter(Boolean).length + 1,
      hierPins,
      hierPorts,
    });
  }

  // The names each sheet's own graph settled on, before the hierarchy renames
  // any of them below.
  const localNameOf = new Map<string, string>();
  for (const graph of graphs.values())
    for (const net of graph.netlist.nets)
      localNameOf.set(`${graph.sheet.path}#${net.code}`, net.name);

  // CONNECTION_GRAPH::buildConnectionGraph's global equivalence classes, run
  // before propagateToNeighbors exactly as upstream does. Two subgraphs are the
  // same net whenever they share a *global* driver name, transitively: a wire
  // tying VCC, VDD and +3.3V power symbols together carries three global
  // drivers, so it lands in all three name buckets and collapses every VCC,
  // every VDD and every +3.3V subgraph in the hierarchy onto one net. Upstream
  // then clones the representative's connection onto each member, which is a
  // rename — the members keep their own m_driver, so driverPriority is left
  // alone here too.
  globalEquivalenceClasses(graphs);

  const netOf = (sg: SubGraph) => sg.graph.netlist.nets.find((n) => n.code === sg.code)!;
  const keyOf = (path: string, code: number): string => `${path}#${code}`;
  const subGraph = (path: string, code: number): SubGraph | null => {
    const graph = graphs.get(path);
    if (!graph || !graph.netlist.nets.some((n) => n.code === code)) return null;
    return { key: keyOf(path, code), graph, code };
  };

  /** ResolveDrivers: a driver at HIER_LABEL or above is "strong". */
  const isStrong = (sg: SubGraph): boolean => netOf(sg).driverPriority >= Priority.HierLabel;

  // CONNECTION_GRAPH::propagateToNeighbors, run over every hierarchical subgraph.
  const done = new Set<string>();

  for (const graph of graphs.values()) {
    for (const net of graph.netlist.nets) {
      const start: SubGraph = { key: keyOf(graph.sheet.path, net.code), graph, code: net.code };
      if (done.has(start.key)) continue;

      const pins = graph.hierPins.get(net.code) ?? [];
      const ports = graph.hierPorts.get(net.code) ?? [];
      // "If we have both ports and pins, skip processing as we'll be visited by
      // a parent or child"; with neither there is nothing to propagate.
      if (pins.length > 0 && ports.length > 0) continue;
      if (pins.length === 0 && ports.length === 0) continue;

      const visited = new Map<string, SubGraph>([[start.key, start]]);
      const searchList: SubGraph[] = [];

      const visit = (parent: SubGraph): void => {
        // Down: each sheet pin opens a child sheet; look there for a strongly
        // driven subgraph whose hierarchical label matches the pin's name.
        for (const pin of parent.graph.hierPins.get(parent.code) ?? []) {
          const child = graphs.get(pin.childPath);
          if (!child) continue;
          for (const candidate of child.netlist.nets) {
            const key = keyOf(pin.childPath, candidate.code);
            if (visited.has(key)) continue;
            const candidatePorts = child.hierPorts.get(candidate.code) ?? [];
            if (candidatePorts.length === 0) continue;
            const sg = subGraph(pin.childPath, candidate.code);
            if (!sg || !isStrong(sg)) continue;
            if (candidatePorts.some((label) => label === pin.name)) {
              searchList.push(sg);
              break;
            }
          }
        }

        // Up: each hierarchical label answers a sheet pin one level up, on the
        // very sheet symbol this instance path came through.
        if ((parent.graph.hierPorts.get(parent.code) ?? []).length > 0) {
          const upPath = parentPathOf(parent.graph.sheet.path);
          const up = upPath ? graphs.get(upPath) : undefined;
          if (up) {
            const viaSheet = lastSheetOf(parent.graph.sheet.path);
            const labels = parent.graph.hierPorts.get(parent.code) ?? [];
            for (const candidate of up.netlist.nets) {
              const key = keyOf(up.sheet.path, candidate.code);
              if (visited.has(key)) continue;
              const candidatePins = up.hierPins.get(candidate.code) ?? [];
              if (candidatePins.length === 0) continue;
              const matches = candidatePins.some(
                (p) =>
                  lastSheetOf(p.childPath) === viaSheet && labels.some((label) => label === p.name),
              );
              if (!matches) continue;
              const sg = subGraph(up.sheet.path, candidate.code);
              if (sg) searchList.push(sg);
            }
          }
        }
      };

      visit(start);
      for (let i = 0; i < searchList.length; i++) {
        const child = searchList[i]!;
        if (!visited.has(child.key)) {
          visited.set(child.key, child);
          visit(child);
        }
      }

      if (visited.size < 2) {
        done.add(start.key);
        continue;
      }

      // "Now, find the best driver for this chain of subgraphs."
      let bestDriver = start;
      let highest = netOf(start).driverPriority;
      let bestIsStrong = highest >= Priority.HierLabel;
      let bestName = netOf(start).name;

      if (highest < Priority.GlobalPowerPin) {
        for (const sg of visited.values()) {
          if (sg.key === start.key) continue;
          const priority = netOf(sg).driverPriority;
          const candidateStrong = priority >= Priority.HierLabel;
          const candidateName = netOf(sg).name;
          const shorterPath = sg.graph.depth < bestDriver.graph.depth;
          const asGoodPath = sg.graph.depth <= bestDriver.graph.depth;

          if (
            priority >= Priority.GlobalPowerPin ||
            (!bestIsStrong && candidateStrong) ||
            (priority > highest && candidateStrong) ||
            (priority === highest && candidateStrong && shorterPath) ||
            (bestIsStrong === candidateStrong &&
              asGoodPath &&
              priority === highest &&
              candidateName < bestName)
          ) {
            bestDriver = sg;
            highest = priority;
            bestIsStrong = candidateStrong;
            bestName = candidateName;
          }
        }
      }

      // Every subgraph of the chain takes the winning *connection*, both
      // spellings of its name, as upstream copies the whole SCH_CONNECTION.
      const bestLocalName = netOf(bestDriver).localName;
      for (const sg of visited.values()) {
        const net = netOf(sg);
        if (net.name !== bestName) net.name = bestName;
        net.localName = bestLocalName;
        net.driverPriority = highest;
        done.add(sg.key);
      }
    }
  }

  propagateBuses(graphs);

  const bySheet = new Map<string, Netlist>();
  const hierNetNames = new Map<string, Map<string, string>>();
  for (const [path, graph] of graphs) {
    bySheet.set(path, graph.netlist);
    const renames = new Map<string, string>();
    for (const net of graph.netlist.nets) {
      const local = localNameOf.get(`${path}#${net.code}`);
      // First rename wins, so two same-named local nets that the hierarchy pulled
      // apart resolve the way the sheet's own graph would have merged them.
      if (local !== undefined && local !== net.name && !renames.has(local))
        renames.set(local, net.name);
    }
    if (renames.size > 0) hierNetNames.set(path, renames);
  }
  return { bySheet, humanPaths, hierNetNames };
}

/**
 * `propagate_bus_neighbors` across the hierarchy: a bus-shaped sheet pin and
 * the child sheet's bus port of the same name are one bus, and the bus member
 * connections travel with it, so the child's member nets take the parent's
 * member names. Members are matched by **vector index** for a bus vector (the
 * names are allowed to differ) and by **name** inside a bus group, exactly as
 * CONNECTION_GRAPH::matchBusMember does.
 */
function propagateBuses(graphs: Map<string, SheetGraph>): void {
  interface BusRef {
    key: string;
    graph: SheetGraph;
    index: number;
  }
  const busKey = (path: string, index: number): string => `${path}!${index}`;
  const busOf = (b: BusRef) => b.graph.netlist.buses[b.index]!;
  const done = new Set<string>();

  /** The child instance path a bus sheet pin opens. */
  const childOfPin = (graph: SheetGraph, sheetId: string): string | null => {
    let found: string | null = null;
    graph.sheet.doc.sheets.forEach((sh, si) => {
      if (refId('sheet', sh.uuid, si) === sheetId)
        found = childPathOf(graph.sheet.path, sh.uuid ?? '', si);
    });
    return found;
  };

  for (const graph of graphs.values()) {
    graph.netlist.buses.forEach((bus, index) => {
      const start: BusRef = { key: busKey(graph.sheet.path, index), graph, index };
      if (done.has(start.key)) return;
      const ports = bus.labels.filter((l) => l.port);
      if (bus.sheetPins.length === 0 && ports.length === 0) return;

      const visited = new Map<string, BusRef>([[start.key, start]]);
      const searchList: BusRef[] = [];

      const visit = (parent: BusRef): void => {
        const pbus = busOf(parent);
        // Down: through each bus sheet pin into the child sheet's bus port.
        for (const pin of pbus.sheetPins) {
          const childPath = childOfPin(parent.graph, pin.sheetId);
          const child = childPath ? graphs.get(childPath) : undefined;
          if (!child || !childPath) continue;
          child.netlist.buses.forEach((candidate, ci) => {
            const key = busKey(childPath, ci);
            if (visited.has(key)) return;
            if (candidate.labels.some((l) => l.port && l.text === pin.name))
              searchList.push({ key, graph: child, index: ci });
          });
        }
        // Up: through each bus port to the parent sheet's matching bus pin.
        if (pbus.labels.some((l) => l.port)) {
          const upPath = parentPathOf(parent.graph.sheet.path);
          const up = upPath ? graphs.get(upPath) : undefined;
          if (up && upPath) {
            const viaSheet = lastSheetOf(parent.graph.sheet.path);
            const portNames = pbus.labels.filter((l) => l.port).map((l) => l.text);
            up.netlist.buses.forEach((candidate, ci) => {
              const key = busKey(upPath, ci);
              if (visited.has(key)) return;
              const matches = candidate.sheetPins.some((sp) => {
                const childPath = childOfPin(up, sp.sheetId);
                return (
                  childPath !== null &&
                  lastSheetOf(childPath) === viaSheet &&
                  portNames.includes(sp.name)
                );
              });
              if (matches) searchList.push({ key, graph: up, index: ci });
            });
          }
        }
      };

      visit(start);
      for (let i = 0; i < searchList.length; i++) {
        const next = searchList[i]!;
        if (!visited.has(next.key)) {
          visited.set(next.key, next);
          visit(next);
        }
      }
      if (visited.size < 2) {
        done.add(start.key);
        return;
      }

      // The chain's driver: the shallowest sheet's bus wins, then the
      // alphabetically lower name, the non-bus rules reduced to what a bus
      // subgraph can carry (a bus is never driven by a power pin).
      let best = start;
      for (const b of visited.values()) {
        if (b.key === best.key) continue;
        const shorter = b.graph.depth < best.graph.depth;
        const asGood = b.graph.depth <= best.graph.depth;
        if (shorter || (asGood && busOf(b).name < busOf(best).name)) best = b;
      }

      const bestBus = busOf(best);

      for (const b of visited.values()) {
        done.add(b.key);
        if (b.key === best.key) continue;
        const bus = busOf(b);
        bus.members = bestBus.members.slice();
        bus.name = bestBus.name;
      }

      // propagate_bus_neighbors: a bus crossing a sheet boundary carries its
      // *members* with it, so the wire net holding each member takes the name the
      // winning bus gives it — otherwise a signal broken out of the same bus on
      // two sheets stays two nets, each looking like a one-pin net to ERC and
      // reaching the board as two. A member net driven by a global (power symbol
      // or global label) outranks the bus and keeps its own name, which is the
      // direction upstream clones in for GetDriverPriority >= GLOBAL_POWER_PIN.
      //
      // Which net *is* a member is decided by name, not by wiring: upstream feeds
      // the bus's expanded members into connections_to_check and matches them
      // against the driver name of every other subgraph on that sheet
      // (processSubGraphs). So the parent's "GPT0" label counts as a member of its
      // "GPT[0..3]" bus even when it hangs off a different bus segment entirely,
      // which is how these schematics are actually drawn.
      const chain = [...visited.values()].sort((x, y) => {
        if (x.graph.depth !== y.graph.depth) return x.graph.depth - y.graph.depth;
        const nx = busOf(x).name;
        const ny = busOf(y).name;
        return nx < ny ? -1 : nx > ny ? 1 : 0;
      });

      for (const token of bestBus.members) {
        // Every sheet's net for this member, the winning bus's sheet first.
        const owners: Net[] = [];
        for (const b of chain)
          for (const net of b.graph.netlist.nets)
            if (net.localName === token && !owners.includes(net)) owners.push(net);
        if (owners.length < 2) continue;
        const winner =
          owners.find((n) => n.driverPriority >= Priority.GlobalPowerPin) ?? owners[0]!;
        for (const net of owners) {
          if (net === winner || net.driverPriority >= Priority.GlobalPowerPin) continue;
          net.name = winner.name;
          net.localName = winner.localName;
        }
      }
    });
  }
}
