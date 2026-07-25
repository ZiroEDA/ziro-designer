/**
 * The board's net table. Counterpart: `pcbnew/netinfo_list.cpp` (NETINFO_LIST) and
 * the `(net <code> "<name>")` declarations at the top of a `.kicad_pcb`.
 *
 * In the typed board model a net is just the `code -> name` entry of
 * `Board.nets`, and every net-carrying item (pad, track, via, zone) refers to it
 * by code. The writer passes the `(net …)` source children straight through, so
 * adding or dropping a net means editing the board node's own children, which is
 * what these helpers do, keeping `Board.nets` and `Board.source` in lockstep.
 */

import { atom, head, isList, str, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';
import { arg, numArg } from '@ziroeda/sexpr/src/query.js';
import type { Board } from './types.js';

/** NETINFO_LIST::UNCONNECTED, the code every unconnected item carries. */
export const UNCONNECTED_NET = 0;

/** NETINFO_LIST::GetNetItem( name ), the code of a net by name, or undefined. */
export function findNet(board: Board, netName: string): number | undefined {
  for (const [code, name] of board.nets) {
    if (name === netName) return code;
  }
  return undefined;
}

/** NETINFO_LIST::GetNetItem( code ), the name of a net by code. */
export const netName = (board: Board, code: number): string => board.nets.get(code) ?? '';

/** NETINFO_LIST::getFreeNetCode, net codes stay consecutive. */
function freeNetCode(board: Board): number {
  let code = 1;
  while (board.nets.has(code)) code++;
  return code;
}

const netNode = (code: number, name: string): SList => ({
  kind: 'list',
  items: [atom('net'), atom(String(code)), str(name)],
});

/**
 * NETINFO_LIST::AppendNet, add a net, or return the existing code when a net of
 * that name is already there. The new `(net …)` declaration is inserted after the
 * last existing one so the file keeps its conventional layout.
 */
export function appendNet(board: Board, name: string): { board: Board; code: number } {
  const existing = findNet(board, name);
  if (existing !== undefined) return { board, code: existing };

  const code = freeNetCode(board);
  const nets = new Map(board.nets);
  nets.set(code, name);

  const items: SNode[] = [];
  let inserted = false;
  // Walk backwards so the declaration lands after the last (net …) child.
  const lastNetIndex = board.source.items.reduce(
    (last, it, i) => (isList(it) && head(it) === 'net' ? i : last),
    -1,
  );
  board.source.items.forEach((it, i) => {
    items.push(it);
    if (i === lastNetIndex) {
      items.push(netNode(code, name));
      inserted = true;
    }
  });
  if (!inserted) items.push(netNode(code, name));

  return { board: { ...board, nets, source: { kind: 'list', items } }, code };
}

/**
 * NETINFO_LIST::RemoveUnusedNets, keep only the nets in `keep` (upstream's
 * IsCurrent flag), dropping both the model entries and the `(net …)` declarations.
 * Net 0 (`""`, the unconnected net) is always kept.
 */
export function removeUnusedNets(board: Board, keep: ReadonlySet<number>): Board {
  const nets = new Map<number, string>();
  for (const [code, name] of board.nets) {
    if (code === UNCONNECTED_NET || keep.has(code)) nets.set(code, name);
  }
  if (nets.size === board.nets.size) return board;

  const items = board.source.items.filter((it) => {
    if (!isList(it) || head(it) !== 'net') return true;
    const code = numArg(it, 0);
    return code === undefined || nets.has(code);
  });

  return { ...board, nets, source: { kind: 'list', items } };
}

/**
 * Rename a net in place, keeping its code. Used when the netlist keeps a net's
 * identity but the schematic renamed it.
 */
export function renameNet(board: Board, code: number, name: string): Board {
  if (!board.nets.has(code)) return board;
  const nets = new Map(board.nets);
  nets.set(code, name);

  const items = board.source.items.map((it) => {
    if (!isList(it) || head(it) !== 'net') return it;
    return numArg(it, 0) === code ? netNode(code, name) : it;
  });

  return { ...board, nets, source: { kind: 'list', items } };
}

/** The `(net …)` declaration codes actually present in the source, in file order. */
export function declaredNetCodes(board: Board): number[] {
  const out: number[] = [];
  for (const it of board.source.items) {
    if (!isList(it) || head(it) !== 'net') continue;
    const code = numArg(it, 0);
    if (code !== undefined) out.push(code);
  }
  return out;
}

/** The name written in a `(net …)` declaration node. */
export const declaredNetName = (node: SList): string => arg(node, 1) ?? '';
