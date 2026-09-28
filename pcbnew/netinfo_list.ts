// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * NETINFO_LIST: the board's net table. Counterpart: `pcbnew/netinfo_list.cpp` (NETINFO_LIST) and
 * the `(net <code> "<name>")` declarations at the top of a `.kicad_pcb`.
 *
 * In the typed board model a net is just the `code -> name` entry of
 * `Board.nets`, and every net-carrying item (pad, track, via, zone) refers to it
 * by code. The writer passes the `(net …)` source children straight through, so
 * adding or dropping a net means editing the board node's own children, which is
 * what these helpers do, keeping `Board.nets` and `Board.source` in lockstep.
 */

import { unescapeString, wxSplit } from '@ziroeda/common/string_utils.js';
import type { Board } from './types.js';
import { NETINFO_ITEM, type NETNAMES_MAP, type NETCODES_MAP } from './netinfo_item.js';
import type { BOARD } from './board.js';
import { BOARD_ITEM } from './board_item.js';

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

/** NETINFO_LIST::getFreeNetCode, net codes stay consecutive. */
function freeNetCode(board: Board): number {
  let code = 1;
  while (board.nets.has(code)) code++;
  return code;
}

/**
 * NETINFO_LIST::AppendNet, add a net, or return the existing code when a net of
 * that name is already there.
 */
export function appendNet(board: Board, name: string): { board: Board; code: number } {
  const existing = findNet(board, name);
  if (existing !== undefined) return { board, code: existing };

  const code = freeNetCode(board);
  const nets = new Map(board.nets);
  nets.set(code, name);

  return { board: { ...board, nets }, code };
}

/**
 * NETINFO_LIST::RemoveUnusedNets, keep only the nets in `keep` (upstream's
 * IsCurrent flag). Net 0 (`""`, the unconnected net) is always kept.
 */
export function removeUnusedNets(board: Board, keep: ReadonlySet<number>): Board {
  const nets = new Map<number, string>();
  for (const [code, name] of board.nets) {
    if (code === UNCONNECTED_NET || keep.has(code)) nets.set(code, name);
  }
  if (nets.size === board.nets.size) return board;

  return { ...board, nets };
}

/**
 * Rename a net in place, keeping its code. Used when the netlist keeps a net's
 * identity but the schematic renamed it.
 */
export function renameNet(board: Board, code: number, name: string): Board {
  if (!board.nets.has(code)) return board;
  const nets = new Map(board.nets);
  nets.set(code, name);

  return { ...board, nets };
}

const wxLess = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Container for #NETINFO_ITEM elements, which are the nets.
 */
export class NETINFO_LIST {
  /// Constant that holds the "unconnected net" number (typically 0)
  /// all items "connected" to this net are actually not connected items
  static readonly UNCONNECTED = 0;

  /// Constant that forces initialization of a netinfo item to the NETINFO_ITEM ORPHANED
  /// (typically -1) when calling SetNetCode on board connected items.
  static readonly ORPHANED = -1;

  private static g_orphanedItem: NETINFO_ITEM | null = null;

  /// NETINFO_ITEM meaning that there was no net assigned for an item, as there was no
  /// board storing net list available.
  static OrphanedItem(): NETINFO_ITEM {
    if (!NETINFO_LIST.g_orphanedItem)
      NETINFO_LIST.g_orphanedItem = new NETINFO_ITEM(null, '', NETINFO_LIST.UNCONNECTED);

    return NETINFO_LIST.g_orphanedItem;
  }

  m_DisplayNetnamesDirty = false;

  private m_parent: BOARD | null;
  private m_netNames: NETNAMES_MAP = new Map(); ///< map of <wxString, NETINFO_ITEM*>, is NETINFO_ITEM owner
  private m_netCodes: NETCODES_MAP = new Map(); ///< map of <int, NETINFO_ITEM*> is NOT owner
  private m_newNetCode: number; ///< possible value for new net code assignment

  constructor(aParent: BOARD | null) {
    this.m_parent = aParent;
    this.m_newNetCode = 0;

    // Make sure that the unconnected net has number 0
    this.AppendNet(new NETINFO_ITEM(aParent, '', 0));
  }

  /**
   * @param aNetCode netcode to identify a given #NETINFO_ITEM.
   * @return net item by \a aNetCode, or NULL if not found.
   */
  GetNetItem(aNetCode: number): NETINFO_ITEM | null;
  /**
   * @param aNetName net name to identify a given #NETINFO_ITEM.
   * @return net item by \a aNetName, or NULL if not found.
   */
  GetNetItem(aNetName: string): NETINFO_ITEM | null;
  GetNetItem(a: number | string): NETINFO_ITEM | null {
    if (typeof a === 'number') return this.m_netCodes.get(a) ?? null;

    return this.m_netNames.get(a) ?? null;
  }

  /**
   * @return the number of nets ( always >= 1 ) because the first net is the "not connected"
   *         net and always exists
   */
  GetNetCount(): number {
    return this.m_netNames.size;
  }

  /// Return the name map, at least for python.
  NetsByName(): NETNAMES_MAP {
    return this.m_netNames;
  }

  /// Return the netcode map, at least for python.
  NetsByNetcode(): NETCODES_MAP {
    return this.m_netCodes;
  }

  /** `begin()..end()`: the nets in name order, as the `std::map` iterates them. */
  *[Symbol.iterator](): IterableIterator<NETINFO_ITEM> {
    const names = [...this.m_netNames.keys()].sort(wxLess);

    for (const name of names) yield this.m_netNames.get(name)!;
  }

  GetParent(): BOARD | null {
    return this.m_parent;
  }

  /**
   * Add \a aNewElement to the end of the net list. Negative net code means it is going to be
   * auto-assigned.
   */
  AppendNet(aNewElement: NETINFO_ITEM): void {
    // if there is a net with such name then just assign the correct number
    const sameName = this.GetNetItem(aNewElement.GetNetname());

    if (sameName !== null) {
      aNewElement.set_netCode(sameName.GetNetCode());

      return;
    } else if (aNewElement.GetNetCode() !== this.m_netCodes.size || aNewElement.GetNetCode() < 0) {
      // be sure that net codes are consecutive
      // negative net code means that it has to be auto assigned
      aNewElement.set_netCode(this.getFreeNetCode());
    }

    // net names & codes are supposed to be unique
    console.assert(this.GetNetItem(aNewElement.GetNetname()) === null);
    console.assert(this.GetNetItem(aNewElement.GetNetCode()) === null);

    // add an entry for fast look up by a net name using a map
    this.m_netNames.set(aNewElement.GetNetname(), aNewElement);
    this.m_netCodes.set(aNewElement.GetNetCode(), aNewElement);

    this.m_DisplayNetnamesDirty = true;
  }

  /**
   * Remove a net from the net list.
   */
  RemoveNet(aNet: NETINFO_ITEM): void {
    let removed = false;

    for (const [code, item] of this.m_netCodes) {
      if (item === aNet) {
        removed = true;
        this.m_netCodes.delete(code);
        break;
      }
    }

    for (const [name, item] of this.m_netNames) {
      if (item === aNet) {
        console.assert(
          removed,
          'NETINFO_LIST::RemoveNet: target net found in m_netNames but not m_netCodes!',
        );
        this.m_netNames.delete(name);
        break;
      }
    }

    if (removed) {
      this.m_newNetCode = Math.min(this.m_newNetCode, aNet.GetNetCode() - 1);
      this.m_DisplayNetnamesDirty = true;
    }
  }

  RemoveUnusedNets(aCommit: { Removed(aItem: BOARD_ITEM): void } | null): void {
    const existingNets = new Map(this.m_netCodes);

    this.m_netCodes.clear();
    this.m_netNames.clear();

    // `std::map<int, ...>` iterates by code.
    for (const netCode of [...existingNets.keys()].sort((a, b) => a - b)) {
      const netInfo = existingNets.get(netCode)!;

      if (netInfo.IsCurrent()) {
        this.m_netNames.set(netInfo.GetNetname(), netInfo);
        this.m_netCodes.set(netCode, netInfo);
      } else {
        this.m_DisplayNetnamesDirty = true;

        if (aCommit) aCommit.Removed(netInfo);
      }
    }
  }

  /**
   * Delete the list of nets (and free memory).
   */
  clear(): void {
    this.m_netNames.clear();
    this.m_netCodes.clear();
    this.m_newNetCode = 0;
  }

  /**
   * Rebuild the list of NETINFO_ITEMs
   *
   * The list is sorted by names.
   */
  buildListOfNets(): void {
    // Restore the initial state of NETINFO_ITEMs
    for (const net of this) net.Clear();

    this.m_parent!.SynchronizeNetsAndNetClasses(false);
    this.m_parent!.SetAreasNetCodesFromNetNames();
  }

  RebuildDisplayNetnames(): void {
    const shortNameMap = new Map<string, string[]>();

    for (const net of this) {
      let list = shortNameMap.get(net.GetShortNetname());

      if (!list) {
        list = [];
        shortNameMap.set(net.GetShortNetname(), list);
      }

      list.push(net.GetNetname());
    }

    for (const net of this) {
      const longNames = shortNameMap.get(net.GetShortNetname())!;

      if (longNames.length === 1) {
        net.set_displayNetname(unescapeString(net.GetShortNetname()));
      } else {
        const parts = wxSplit(net.GetNetname(), '/');
        const aggregateParts: string[][] = [];
        let firstNonCommon: number | undefined;

        for (const longName of longNames) aggregateParts.push(wxSplit(longName, '/'));

        for (let ii = 0; ii < parts.length && firstNonCommon === undefined; ++ii) {
          for (const otherParts of aggregateParts) {
            if (ii < otherParts.length && otherParts[ii] === parts[ii]) continue;

            firstNonCommon = ii;
            break;
          }
        }

        if ((firstNonCommon ?? 0) > 0 && firstNonCommon! < parts.length) {
          let disambiguatedName = '';

          for (let ii = firstNonCommon!; ii < parts.length; ++ii) {
            if (disambiguatedName !== '') disambiguatedName += '/';

            disambiguatedName += parts[ii];
          }

          net.set_displayNetname(unescapeString(disambiguatedName));
        } else {
          net.set_displayNetname(unescapeString(net.GetNetname()));
        }
      }
    }

    this.m_DisplayNetnamesDirty = false;
  }

  /**
   * Return the first available net code that is not used by any other net.
   */
  private getFreeNetCode(): number {
    do {
      if (this.m_newNetCode < 0) this.m_newNetCode = 0;
    } while (this.m_netCodes.has(++this.m_newNetCode));

    return this.m_newNetCode;
  }
}
