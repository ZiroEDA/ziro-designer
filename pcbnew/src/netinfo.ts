// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
import { unescapeString, wxSplit } from '@ziroeda/common/src/string_utils.js';
import type { Board } from './types.js';

/** NETINFO_LIST::UNCONNECTED, the code every unconnected item carries. */
export const UNCONNECTED_NET = 0;

/**
 * NETINFO_LIST::ORPHANED, the code an item lands on when the file contradicts
 * itself — a pad whose `(net 5 "GND")` names a net the declarations call
 * something else. It matches no net, which is the point: neither half of the
 * contradiction is trusted.
 */
export const ORPHANED_NET = -1;

/** NETINFO_LIST::GetNetItem( name ), the code of a net by name, or undefined. */
export function findNet(board: Board, netName: string): number | undefined {
  for (const [code, name] of board.nets) {
    if (name === netName) return code;
  }
  return undefined;
}

/** NETINFO_LIST::GetNetItem( code ), the name of a net by code. */
export const netName = (board: Board, code: number): string => board.nets.get(code) ?? '';

/**
 * `NETINFO_ITEM::GetShortNetname`: the part of a net name after the last `/`.
 *
 * The separator is the *hierarchy* separator, so a slash that belongs to a
 * label's own name is not one: the schematic writes that as `{slash}`, which is
 * why splitting has to happen before unescaping and never after.
 */
export const shortNetname = (name: string): string => name.slice(name.lastIndexOf('/') + 1);

/**
 * `BOARD_CONNECTED_ITEM::GetDisplayNetname`: the short net name, unescaped —
 * what every painter puts on a pad, track, via or shape.
 *
 * It exists because the escaped form is a *file* encoding, not a name anybody
 * chose. A net called `SDA/A4` in the schematic is stored `SDA{slash}A4`
 * (`EscapeString`, CTX_NETNAME, since `/` already means hierarchy), and every
 * painter site here computed the short name inline and drew it raw — so the
 * board showed `SDA{slash}A4` (issue #626). KiCad has one accessor and five
 * call sites; the reason to have one here is that five inline copies is exactly
 * how four of them stayed wrong.
 *
 * This is the single-name answer, which is the one `NETINFO_ITEM`'s constructor
 * and `SetNetname` compute. When two nets share a short name the list widens
 * both until they can be told apart — see {@link displayNetnames}, which is what
 * a painter with a whole board in hand should use.
 */
export const displayNetname = (name: string): string => unescapeString(shortNetname(name));

/**
 * `NETINFO_LIST::RebuildDisplayNetnames`: every net's display name at once.
 *
 * A short name is only useful while it is unique. `/Sheet1/SDA` and
 * `/Sheet2/SDA` both shorten to `SDA`, and on a hierarchical design with
 * repeated sub-sheets — where this matters most — every instance's nets then
 * letter identically. So a net that shares its short name with another is shown
 * from the first path component where they *differ* onwards, which is the least
 * that distinguishes them.
 *
 * Mirrors the C++ step for step, including the parts that look like accidents
 * and are load-bearing:
 *
 *  - the comparison group is `shortNameMap[short]`, which **contains this net's
 *    own full name**; comparing it against itself never disagrees, so it cannot
 *    push `firstNonCommon` forward on its own;
 *  - a name is only widened when `firstNonCommon` is both **set and > 0**. Nets
 *    differing at the very first component fall through to the full name, not
 *    to a suffix of it;
 *  - so does a group whose members never differ within `parts.length` — two
 *    identical net names, or one that is a prefix of another;
 *  - and the split is `wxSplit`, whose escape rules and empty-string case are
 *    not `String.split`'s. See that function.
 */
export function displayNetnames(nets: ReadonlyMap<number, string>): Map<number, string> {
  const shortNameMap = new Map<string, string[]>();
  for (const name of nets.values()) {
    const short = shortNetname(name);
    const group = shortNameMap.get(short);
    if (group) group.push(name);
    else shortNameMap.set(short, [name]);
  }

  const out = new Map<number, string>();
  for (const [code, name] of nets) {
    const short = shortNetname(name);
    const group = shortNameMap.get(short) ?? [name];

    if (group.length === 1) {
      out.set(code, unescapeString(short));
      continue;
    }

    const parts = wxSplit(name, '/');
    const aggregateParts = group.map((longName) => wxSplit(longName, '/'));
    let firstNonCommon: number | undefined;

    for (let ii = 0; ii < parts.length && firstNonCommon === undefined; ii++) {
      for (const otherParts of aggregateParts) {
        if (ii < otherParts.length && otherParts[ii] === parts[ii]) continue;
        firstNonCommon = ii;
        break;
      }
    }

    if (firstNonCommon !== undefined && firstNonCommon > 0 && firstNonCommon < parts.length) {
      out.set(code, unescapeString(parts.slice(firstNonCommon).join('/')));
    } else {
      out.set(code, unescapeString(name));
    }
  }
  return out;
}

/**
 * `SEXPR_BOARD_FILE_VERSION` 20251028 — "Stop writing netcodes; they're an
 * internal implementation detail".
 *
 * From this version `PCB_IO_KICAD_SEXPR::format` spells every connected item's
 * net as a **name** — `(net "GND")` — and the board's `(net <code> "<name>")`
 * declaration table is gone with it. Below it the code is what the file
 * carries. Both spellings are still *read* at any version, so the boundary
 * matters only here, on the writing side, and a file must be self-consistent:
 * a numeric `(net 5)` written into a 10.0 file names a net nothing declares,
 * and loads back as unconnected.
 */
export const NETCODES_DROPPED_VERSION = 20251028;

/** Whether this board's file version spells nets by name. */
export const writesNetNames = (board: Board): boolean => board.version >= NETCODES_DROPPED_VERSION;

/**
 * The `(net …)` of a track, arc, via or copper graphic, in the spelling the
 * board's file version uses (`format( const PCB_TRACK* )` and friends).
 */
export function itemNetNode(board: Board, code: number): SList {
  if (writesNetNames(board))
    return { kind: 'list', items: [atom('net'), str(netName(board, code))] };
  return { kind: 'list', items: [atom('net'), atom(String(code))] };
}

/**
 * The `(net …)` of a **pad**, which is the one place the legacy spelling
 * carries both halves — `(net 1 "GND")`. The parser insists on the name
 * (`Expecting( "net name" )`), so a pad written with the code alone is a file
 * KiCad refuses to open.
 */
export function padNetNode(board: Board, code: number): SList {
  if (writesNetNames(board))
    return { kind: 'list', items: [atom('net'), str(netName(board, code))] };
  return { kind: 'list', items: [atom('net'), atom(String(code)), str(netName(board, code))] };
}

/**
 * The `(net …)` — and, below 20251028, the `(net_name …)` beside it — of a
 * zone. `format( const ZONE* )` omits both for an unconnected zone and for a
 * rule area, neither of which belongs to a net at all.
 */
export function zoneNetNodes(board: Board, code: number, isRuleArea = false): SNode[] {
  // Below the boundary the pair is written unconditionally, which is what every
  // pre-10.0 file in the tree carries — `(net 0) (net_name "")` on a rule area
  // included.
  if (!writesNetNames(board))
    return [itemNetNode(board, code), list_(atom('net_name'), str(netName(board, code)))];

  return isRuleArea || code <= UNCONNECTED_NET ? [] : [itemNetNode(board, code)];
}

const list_ = (...items: SNode[]): SList => ({ kind: 'list', items });

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
