/**
 * Net-chain detection. Counterpart: `CONNECTION_GRAPH::buildBridgeAdjacency` +
 * `RebuildNetChains` (eeschema/connection_graph.cpp) and SCH_NETCHAIN
 * (eeschema/sch_netchain.h), chains of nets bridged by 2-pin passthrough
 * symbols (series resistors, filters, …) so DRC rules can target them via
 * `inNetChainClass('name')`.
 *
 * The exact pipeline, single-sheet:
 *  1. bridge edges: every 2-pin symbol whose pins each land on a wire, with
 *     the default-mode gate (no power pins; both wires collinear, vertical
 *     on one X or horizontal on one Y) links its two distinct nets;
 *  2. edges touching a power subgraph (a power-class pin or power symbol)
 *     drop, their non-power endpoints marked power-adjacent;
 *  3. power-adjacent degree-≤1 leaves prune iteratively (skipped entirely
 *     for graphs of ≤2 nets or ≤2 power-adjacent nets);
 *  4. components larger than 4 nets shed degree-1 stubs whose neighbour has
 *     degree >2 (case-insensitive-sorted, only as many as needed);
 *  5. remaining components of ≥2 nets become chains;
 *  6. a local label on a member net names its chain (leading '/' stripped,
 *     512-char cap); unnamed chains fall back to `NetChain<n>`.
 *
 * Beyond detection ("potential" chains), the committed store also lives here:
 * `(net_chain "name" (from ref pin) (to ref pin) …)` nodes in `.kicad_sch`
 * (SCH_IO_KICAD_SEXPR::Format / parseSchNetChain), terminal-pin selection
 * (RebuildNetChains pass 4: the farthest-apart pin pair on member nets), the
 * committed-restore passes (terminal-ref match against a potential, then the
 * manual member-net fallback), and the symbol `(passthrough block|force)`
 * gates in the bridge builder.
 */

import { isList, head, list, atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { arg, childNamed } from '@ziroeda/sexpr/src/query.js';
import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import type { EditCommand } from '../tools/command.js';
import { refId } from '../tools/hittest.js';
import { enumeratePins, type Netlist, type PinNode } from './nets.js';

export interface ChainTerminal {
  ref: string;
  pin: string;
}

export interface DetectedNetChain {
  name: string;
  /** Member net names, sorted. */
  nets: string[];
  /** RefIds of the bridging 2-pin symbols. */
  symbols: string[];
  /** The chain's end pins, the farthest-apart pin pair on member nets
   *  (RebuildNetChains pass 4); unset when no two pins resolve. */
  terminals?: [ChainTerminal, ChainTerminal];
}

interface BridgeEdge {
  a: string;
  b: string;
  symId: string;
}

export function detectNetChains(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  netlist: Netlist,
): DetectedNetChain[] {
  const wires = sch.lines.filter((l) => l.kind === 'wire');

  // findWireOnScreen: the pin position within an H or V wire's span.
  const findWire = (p: Vec2): { a: Vec2; b: Vec2 } | null => {
    for (const w of wires) {
      const s = w.start;
      const e = w.end;
      if (s.y === e.y && p.y === s.y) {
        if (p.x >= Math.min(s.x, e.x) && p.x <= Math.max(s.x, e.x)) return { a: s, b: e };
      } else if (s.x === e.x && p.x === s.x) {
        if (p.y >= Math.min(s.y, e.y) && p.y <= Math.max(s.y, e.y)) return { a: s, b: e };
      }
    }
    return null;
  };

  const pins = enumeratePins(sch, libById);
  const bySym = new Map<string, PinNode[]>();
  for (const p of pins) {
    const arr = bySym.get(p.symId) ?? [];
    arr.push(p);
    bySym.set(p.symId, arr);
  }
  const netName = (code: number | undefined): string =>
    code !== undefined ? (netlist.nets.find((n) => n.code === code)?.name ?? '') : '';
  const isPowerPin = (p: PinNode): boolean =>
    p.electricalType === 'power_in' || p.electricalType === 'power_out';
  const passthroughBySym = new Map<string, 'block' | 'force'>();
  sch.symbols.forEach((sym, si) => {
    if (sym.passthrough) passthroughBySym.set(refId('symbol', sym.uuid, si), sym.passthrough);
  });

  // ----- 1. bridge edges over 2-pin symbols --------------------------------
  const edges: BridgeEdge[] = [];
  for (const [symId, symPins] of bySym) {
    if (symPins.length !== 2) continue;
    const [p0, p1] = symPins as [PinNode, PinNode];
    // (passthrough block) removes the symbol from bridging outright.
    const passthrough = passthroughBySym.get(symId);
    if (passthrough === 'block') continue;
    const wireA = findWire(p0.at);
    const wireB = findWire(p1.at);
    if (!wireA || !wireB) continue;

    let allow = false;
    if (passthrough === 'force') {
      // FORCE skips both the power-pin gate and the collinear-wire heuristic.
      allow = true;
    } else {
      // Default mode: no power pins, and both wires collinear.
      if (isPowerPin(p0) || isPowerPin(p1)) continue;
      if (wireA.a.x === wireA.b.x && wireB.a.x === wireB.b.x && wireA.a.x === wireB.a.x)
        allow = true;
      else if (wireA.a.y === wireA.b.y && wireB.a.y === wireB.b.y && wireA.a.y === wireB.a.y)
        allow = true;
    }
    if (!allow) continue;

    const netA = netName(netlist.netByItem.get(p0.id));
    const netB = netName(netlist.netByItem.get(p1.id));
    if (netA === '' || netB === '' || netA === netB) continue;
    edges.push({ a: netA, b: netB, symId });
  }

  // ----- 2. power subgraphs drop their edges -------------------------------
  const powerNets = new Set<string>();
  for (const p of pins) {
    if (isPowerPin(p) || p.isPowerSymbol) {
      const name = netName(netlist.netByItem.get(p.id));
      if (name !== '') powerNets.add(name);
    }
  }
  const powerAdjacent = new Set<string>();
  let adjacency = new Map<string, { other: string; symId: string }[]>();
  const addAdj = (from: string, other: string, symId: string): void => {
    const arr = adjacency.get(from) ?? [];
    arr.push({ other, symId });
    adjacency.set(from, arr);
  };
  for (const be of edges) {
    if (powerNets.has(be.a) || powerNets.has(be.b)) {
      if (!powerNets.has(be.a)) powerAdjacent.add(be.a);
      if (!powerNets.has(be.b)) powerAdjacent.add(be.b);
      continue;
    }
    addAdj(be.a, be.b, be.symId);
    addAdj(be.b, be.a, be.symId);
  }

  // ----- 3. iterative power-adjacent leaf pruning --------------------------
  const degree = new Map<string, number>();
  for (const [k, v] of adjacency) degree.set(k, v.length);
  if (adjacency.size <= 2) powerAdjacent.clear();
  if (powerAdjacent.size <= 2) powerAdjacent.clear();
  const queue: string[] = [];
  for (const [k, d] of degree) if (d <= 1 && powerAdjacent.has(k)) queue.push(k);
  const removed = new Set<string>();
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (removed.has(n)) continue;
    removed.add(n);
    for (const e of adjacency.get(n) ?? []) {
      if (removed.has(e.other)) continue;
      const d = degree.get(e.other);
      if (d !== undefined) {
        degree.set(e.other, d - 1);
        if (d - 1 <= 1 && powerAdjacent.has(e.other)) queue.push(e.other);
      }
    }
  }
  if (removed.size > 0) {
    const newAdj = new Map<string, { other: string; symId: string }[]>();
    for (const [k, v] of adjacency) {
      if (removed.has(k)) continue;
      newAdj.set(
        k,
        v.filter((e) => !removed.has(e.other)),
      );
    }
    adjacency = newAdj;
  }

  // ----- 4. targeted stub pruning for components > 4 nets ------------------
  {
    const snapshot = adjacency;
    const seen = new Set<string>();
    const globalPrune = new Set<string>();
    for (const start of snapshot.keys()) {
      if (seen.has(start)) continue;
      const comp: string[] = [];
      const q = [start];
      seen.add(start);
      while (q.length > 0) {
        const cur = q.shift()!;
        comp.push(cur);
        for (const e of snapshot.get(cur) ?? []) {
          if (!seen.has(e.other)) {
            seen.add(e.other);
            q.push(e.other);
          }
        }
      }
      if (comp.length <= 4) continue;
      const deg = new Map<string, number>();
      for (const n of comp) deg.set(n, (snapshot.get(n) ?? []).length);
      const candidates: string[] = [];
      for (const n of comp) {
        const nbrs = snapshot.get(n) ?? [];
        if (nbrs.length === 1) {
          const neigh = nbrs[0]!.other;
          if ((deg.get(neigh) ?? 0) > 2) candidates.push(n);
        }
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      let needPrune = comp.length - 4;
      if (needPrune > candidates.length) needPrune = candidates.length;
      for (let i = 0; i < needPrune; i++) globalPrune.add(candidates[i]!);
    }
    if (globalPrune.size > 0) {
      const newAdj = new Map<string, { other: string; symId: string }[]>();
      for (const [k, v] of adjacency) {
        if (globalPrune.has(k)) continue;
        newAdj.set(
          k,
          v.filter((e) => !globalPrune.has(e.other)),
        );
      }
      adjacency = newAdj;
    }
  }

  // ----- 5. connected components of ≥2 nets become chains ------------------
  const chains: { nets: Set<string>; symbols: Set<string>; name: string }[] = [];
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const comp = new Set<string>([start]);
    const q = [start];
    visited.add(start);
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const e of adjacency.get(cur) ?? []) {
        if (visited.has(e.other)) continue;
        visited.add(e.other);
        comp.add(e.other);
        q.push(e.other);
      }
    }
    if (comp.size >= 2) {
      const symbols = new Set<string>();
      for (const be of edges) if (comp.has(be.a) && comp.has(be.b)) symbols.add(be.symId);
      chains.push({ nets: comp, symbols, name: '' });
    }
  }

  // ----- 6. naming: local labels first, then NetChain<n> -------------------
  const netToChain = new Map<string, (typeof chains)[number]>();
  for (const c of chains) for (const n of c.nets) netToChain.set(n, c);
  sch.labels.forEach((l, i) => {
    if (l.kind !== 'label') return; // SCH_LABEL_T only, like upstream's pass
    const code = netlist.netByItem.get(refId('label', l.uuid, i));
    const net = netName(code);
    if (net === '' || net.length >= 2048) return;
    const chain = netToChain.get(net);
    if (!chain) return;
    let name = l.text;
    if (name.length > 512) name = name.slice(0, 512);
    if (name.startsWith('/')) name = name.slice(1);
    chain.name = name;
  });
  let idx = 1;
  for (const c of chains) {
    if (c.name === '') {
      c.name = `NetChain${idx}`;
      idx++;
    }
  }

  // ----- pass 4: terminal pins, the farthest-apart pin pair on member nets
  const chainTerminals = (c: (typeof chains)[number]): [ChainTerminal, ChainTerminal] | null => {
    const onChain = pins.filter((p) => c.nets.has(netName(netlist.netByItem.get(p.id))));
    let best = -1n;
    let bestI = 0;
    let bestJ = 0;
    for (let i = 0; i < onChain.length; i++) {
      for (let j = i + 1; j < onChain.length; j++) {
        const dx = BigInt(onChain[i]!.at.x - onChain[j]!.at.x);
        const dy = BigInt(onChain[i]!.at.y - onChain[j]!.at.y);
        const d = dx * dx + dy * dy;
        if (d > best) {
          best = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (best < 0n) return null;
    const a = onChain[bestI]!;
    const b = onChain[bestJ]!;
    return [
      { ref: a.ref, pin: a.number },
      { ref: b.ref, pin: b.number },
    ];
  };

  return chains.map((c) => {
    const out: DetectedNetChain = {
      name: c.name,
      nets: [...c.nets].sort(),
      symbols: [...c.symbols].sort(),
    };
    const terms = chainTerminals(c);
    if (terms) out.terminals = terms;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Committed net chains, `(net_chain "name" (from "ref" "pin") (to "ref" "pin")
// [(net_class "…")] [(color R G B A)] [(nets "n1" …)])` nodes in `.kicad_sch`,
// written by exactly one (the root) sheet file.

/** SCH_NETCHAIN::SYNTHETIC_NET_PREFIX, per-run subgraph names, never persisted. */
export const NET_CHAIN_SYNTHETIC_PREFIX = '__SG_';

/** SCH_NETCHAIN::IsValidName. */
export function isValidNetChainName(name: string): boolean {
  if (name === '') return false;
  for (const c of name) {
    if (c === '"' || c === "'" || c === '(' || c === ')' || c === ' ') return false;
  }
  return true;
}

export interface CommittedNetChain {
  name: string;
  /** Terminal end pins as (reference, pin number) pairs, the chain's anchor. */
  from: ChainTerminal;
  to: ChainTerminal;
  /** Netclass override applied to every member net ('' = none). */
  netClass: string;
  /** `(color r g b a)` as a CSS rgba() string; '' = UNSPECIFIED. */
  color: string;
  /** Persisted member nets (synthetic names already filtered on write). */
  nets: string[];
}

/** parseSchNetChain, read every `(net_chain …)` node from the source AST. */
export function readNetChains(sch: Schematic): CommittedNetChain[] {
  const out: CommittedNetChain[] = [];
  for (const node of sch.source.items) {
    if (!isList(node) || head(node) !== 'net_chain') continue;
    const name = arg(node, 0) ?? '';
    const chain: CommittedNetChain = {
      name,
      from: { ref: '', pin: '' },
      to: { ref: '', pin: '' },
      netClass: '',
      color: '',
      nets: [],
    };
    for (const it of node.items.slice(1)) {
      if (!isList(it)) continue;
      const h = head(it);
      if (h === 'from') {
        chain.from = { ref: arg(it, 0) ?? '', pin: arg(it, 1) ?? '' };
      } else if (h === 'to') {
        chain.to = { ref: arg(it, 0) ?? '', pin: arg(it, 1) ?? '' };
      } else if (h === 'net_class') {
        chain.netClass = arg(it, 0) ?? '';
      } else if (h === 'color') {
        const r = Number(arg(it, 0)) || 0;
        const g = Number(arg(it, 1)) || 0;
        const b = Number(arg(it, 2)) || 0;
        const a = Number(arg(it, 3));
        chain.color = `rgba(${r}, ${g}, ${b}, ${Number.isFinite(a) ? a : 1})`;
      } else if (h === 'nets') {
        const nets = new Set<string>();
        for (const n of it.items.slice(1)) {
          if (n.kind === 'atom' || n.kind === 'string') nets.add(n.value);
        }
        chain.nets = [...nets].sort();
      }
      // Unknown subsections are skipped (parseSchNetChain's depth loop).
    }
    out.push(chain);
  }
  return out;
}

/** FormatDouble2Str's normal path: `%.10g`. */
const formatDouble2Str = (v: number): string => String(Number(v.toPrecision(10)));

/** Parse our rgba() color strings back into (color R G B A) components. */
function colorParts(color: string): [number, number, number, number] | null {
  const m = color.match(/rgba?\(\s*(\d+)[, ]+(\d+)[, ]+(\d+)(?:[, ]+([\d.]+))?\s*\)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1];
}

/**
 * SCH_IO_KICAD_SEXPR::Format's net-chain block: replace the document's
 * `(net_chain …)` nodes with `chains`, skipping chains with an empty terminal
 * ref (like the writer), filtering synthetic member nets, and omitting the
 * optional sections at their defaults. New nodes land where the old ones were
 * (before `sheet_instances` when there were none).
 */
export function writeNetChains(sch: Schematic, chains: readonly CommittedNetChain[]): Schematic {
  const nodes: SList[] = [];
  for (const chain of chains) {
    if (chain.from.ref === '' || chain.to.ref === '') continue;
    const items: SNode[] = [
      atom('net_chain'),
      str(chain.name),
      list(atom('from'), str(chain.from.ref), str(chain.from.pin)),
      list(atom('to'), str(chain.to.ref), str(chain.to.pin)),
    ];
    if (chain.netClass !== '') items.push(list(atom('net_class'), str(chain.netClass)));
    const c = chain.color !== '' ? colorParts(chain.color) : null;
    if (c) {
      items.push(
        list(
          atom('color'),
          atom(String(c[0])),
          atom(String(c[1])),
          atom(String(c[2])),
          atom(formatDouble2Str(c[3])),
        ),
      );
    }
    const persistableNets = chain.nets.filter(
      (n) => n !== '' && !n.startsWith(NET_CHAIN_SYNTHETIC_PREFIX),
    );
    if (persistableNets.length > 0)
      items.push(list(atom('nets'), ...persistableNets.map((n) => str(n))));
    nodes.push({ kind: 'list', items });
  }

  const items: SNode[] = [];
  let placed = false;
  const place = (): void => {
    if (!placed) items.push(...nodes);
    placed = true;
  };
  for (const it of sch.source.items) {
    if (isList(it) && head(it) === 'net_chain') {
      place();
      continue;
    }
    if (!placed && isList(it) && head(it) === 'sheet_instances') place();
    items.push(it);
  }
  place();
  return { ...sch, source: { kind: 'list', items } };
}

/**
 * The committed-restore passes of RebuildNetChains: resolve each persisted
 * chain against this run's potentials by terminal refs (pass 2a), then fall
 * back to the persisted member-net list (pass 2b), requiring both terminal
 * pins to resolve and at least one pin on a member net. Restored chains carry
 * the potential's live nets and refreshed terminals where matched, and keep
 * their persisted name, netclass and colour.
 */
export function restoreCommittedNetChains(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  netlist: Netlist,
  potentials: readonly DetectedNetChain[],
  persisted: readonly CommittedNetChain[],
): CommittedNetChain[] {
  const pins = enumeratePins(sch, libById);
  const netName = (code: number | undefined): string =>
    code !== undefined ? (netlist.nets.find((n) => n.code === code)?.name ?? '') : '';
  const refPinToNet = new Map<string, string>();
  const pinByRefPin = new Map<string, PinNode>();
  for (const p of pins) {
    const key = `${p.ref} ${p.number}`;
    refPinToNet.set(key, netName(netlist.netByItem.get(p.id)));
    pinByRefPin.set(key, p);
  }

  const out: CommittedNetChain[] = [];
  for (const chain of persisted) {
    // Pass 2a: a potential chain spanning both terminal nets wins.
    const fromNet = refPinToNet.get(`${chain.from.ref} ${chain.from.pin}`);
    const toNet = refPinToNet.get(`${chain.to.ref} ${chain.to.pin}`);
    const match =
      fromNet !== undefined && toNet !== undefined
        ? potentials.find((pot) => pot.nets.includes(fromNet) && pot.nets.includes(toNet))
        : undefined;
    if (match) {
      out.push({
        ...chain,
        nets: [...match.nets],
        ...(match.terminals ? { from: match.terminals[0], to: match.terminals[1] } : {}),
      });
      continue;
    }

    // Pass 2b: manual fallback from the persisted member-net list.
    if (chain.nets.length === 0) continue;
    const memberNets = new Set(chain.nets);
    const terminalA = pinByRefPin.get(`${chain.from.ref} ${chain.from.pin}`);
    const terminalB = pinByRefPin.get(`${chain.to.ref} ${chain.to.pin}`);
    const anyMemberPin = pins.some((p) => memberNets.has(netName(netlist.netByItem.get(p.id))));
    if (!terminalA || !terminalB || !anyMemberPin) continue; // unresolved: skip
    out.push({ ...chain });
  }
  return out;
}

/**
 * SCH_EDITOR_CONTROL::RemoveFromNetChain, every 2-pin symbol bridging
 * `netName` into a different net gets `(passthrough block)`, undoably, so the
 * next detection pass drops it from its chain.
 */
export function removeFromNetChainCommand(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  netlist: Netlist,
  netName: string,
): EditCommand | null {
  const pins = enumeratePins(sch, libById);
  const bySym = new Map<string, PinNode[]>();
  for (const p of pins) {
    const arr = bySym.get(p.symId) ?? [];
    arr.push(p);
    bySym.set(p.symId, arr);
  }
  const nameOf = (code: number | undefined): string =>
    code !== undefined ? (netlist.nets.find((n) => n.code === code)?.name ?? '') : '';
  const passthroughOf = new Map<string, 'block' | 'force' | undefined>();
  sch.symbols.forEach((sym, si) => {
    passthroughOf.set(refId('symbol', sym.uuid, si), sym.passthrough);
  });

  const toBlock = new Set<string>();
  for (const [symId, symPins] of bySym) {
    if (symPins.length !== 2) continue;
    const a = nameOf(netlist.netByItem.get(symPins[0]!.id));
    const b = nameOf(netlist.netByItem.get(symPins[1]!.id));
    if (a === '' || b === '') continue;
    if ((a === netName && b !== netName) || (b === netName && a !== netName)) {
      if (passthroughOf.get(symId) !== 'block') toBlock.add(symId);
    }
  }
  if (toBlock.size === 0) return null;

  return {
    label: 'Remove from Net Chain',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((sym, si) =>
          toBlock.has(refId('symbol', sym.uuid, si))
            ? { ...sym, passthrough: 'block' as const }
            : sym,
        ),
      };
    },
    invert(before: Schematic): EditCommand {
      const prior = new Map<string, 'block' | 'force' | undefined>();
      before.symbols.forEach((sym, si) => {
        const id = refId('symbol', sym.uuid, si);
        if (toBlock.has(id)) prior.set(id, sym.passthrough);
      });
      return {
        label: 'Remove from Net Chain',
        apply(doc: Schematic): Schematic {
          return {
            ...doc,
            symbols: doc.symbols.map((sym, si) => {
              const id = refId('symbol', sym.uuid, si);
              if (!prior.has(id)) return sym;
              const mode = prior.get(id);
              const out = { ...sym };
              if (mode) (out as { passthrough?: 'block' | 'force' }).passthrough = mode;
              else delete (out as { passthrough?: 'block' | 'force' }).passthrough;
              return out;
            }),
          };
        },
        invert: () => removeFromNetChainCommand(sch, libById, netlist, netName) as EditCommand,
      };
    },
  };
}

/** Dialog-OK document update: swap in the recomputed source (chain edits are
 *  applied whole, like the embedded-files flow). */
export function netChainsCommand(after: Schematic): EditCommand {
  return {
    label: 'Net Chains',
    apply: (d) => ({ ...d, source: after.source }),
    invert: (before) => netChainsCommand(before),
  };
}

/**
 * ApplyNetChainNetclasses, chain netclass overrides become per-net pattern
 * assignments (appended after the user's own patterns in netclass
 * resolution); synthetic member names never match a resolved net.
 */
export function chainPatternAssignments(
  committed: readonly CommittedNetChain[],
): { pattern: string; netClass: string }[] {
  const out: { pattern: string; netClass: string }[] = [];
  const seen = new Set<string>();
  for (const chain of committed) {
    if (chain.netClass === '') continue;
    for (const net of chain.nets) {
      if (net.startsWith(NET_CHAIN_SYNTHETIC_PREFIX)) continue;
      const key = `${net} ${chain.netClass}`;
      if (seen.has(key)) continue; // addSingleChainPatternAssignment dedupe
      seen.add(key);
      out.push({ pattern: net, netClass: chain.netClass });
    }
  }
  return out;
}
