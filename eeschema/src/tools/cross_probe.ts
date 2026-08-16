// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic half of Select on PCB, `SCH_EDIT_FRAME::SendSelectItemsToPcb`
 * (eeschema/cross-probing.cpp:325).
 *
 * KiCad does not hand the board a list of objects — the two frames are separate
 * processes, so what crosses is a `$SELECT:` packet of little text parts, one
 * per selected item:
 *
 *     F<reference>              a symbol, matched against a footprint's reference
 *     S<sheet path>             a sheet, matched as a *prefix* of a footprint's path,
 *                               which is what makes it select the subsheets too
 *     P<reference>/<pad>        a pin, matched down to the pad
 *
 * Both frames are mounted together here, so nothing has to be serialised — but
 * the packet is still what we build, because every rule about which board items
 * a schematic selection reaches is encoded in these three shapes, and inventing
 * our own would mean re-deriving the sheet-prefix rule and the pad resolution
 * from scratch. `findItemsFromSyncSelection` on the pcbnew side reads them back.
 *
 * The escaping is `EscapeString( …, CTX_IPC )`: the parts are joined with commas
 * and a path is split on slashes, so a reference containing either would tear
 * the packet apart.
 */
import { escapeIpc } from '@ziroeda/common/src/string_utils.js';
import { symbolField } from '../exporters/netlist.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import { resolvePadNumbers } from '../sch_pin.js';
import { refId } from './hittest.js';
import type { LibSymbol, Schematic, SchSymbol } from '../types.js';

/** `<symbolRefId>:pin<k>` -> its two halves; null for anything else. */
function pinRef(id: string): { owner: string; index: number } | null {
  const at = id.lastIndexOf(':pin');
  if (at === -1) return null;
  const index = Number(id.slice(at + 4));
  if (!Number.isInteger(index) || index < 0) return null;
  return { owner: id.slice(0, at), index };
}

/**
 * The pin number a `:pin<k>` id names.
 *
 * `k` counts the pins of the units this placement draws, hidden ones included,
 * which is `computePinSegments`' enumeration — the one the ids were minted from.
 * Counting any other set would silently address the wrong pad.
 */
function pinNumberAt(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  index: number,
): string | undefined {
  let k = 0;
  for (const u of lib?.units ?? []) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const pin of u.pins) if (k++ === index) return pin.number;
  }
  return undefined;
}

/**
 * The `$SELECT:` parts for `selection`, in KiCad's order — the order decides
 * which board item the view ends up centred on, so it is carried through rather
 * than sorted.
 *
 * `sheetPath` is the current sheet's instance path (`SCH_SHEET_PATH::PathAsString`,
 * "/" at the root and slash-terminated below it), which a sheet part is prefixed
 * with so the board can tell two instances of the same sheet apart.
 *
 * Items that are none of the three kinds are skipped, matching the `default:
 * break` of the switch upstream — that is why the menu entry is conditioned on
 * `crossProbingSelection` and not merely on a non-empty selection.
 */
export function syncSelectionParts(
  doc: Schematic,
  selection: ReadonlySet<string>,
  sheetPath: string,
  libById?: ReadonlyMap<string, LibSymbol>,
): string[] {
  const symbolAt = new Map(doc.symbols.map((s, i) => [refId('symbol', s.uuid, i), i]));
  const sheetAt = new Map(doc.sheets.map((s, i) => [refId('sheet', s.uuid, i), i]));
  const parts: string[] = [];

  for (const id of selection) {
    const si = symbolAt.get(id);
    if (si !== undefined) {
      parts.push(`F${escapeIpc(symbolField(doc.symbols[si]!, 'Reference'))}`);
      continue;
    }

    const hi = sheetAt.get(id);
    if (hi !== undefined) {
      // The sheet's own uuid, appended to the path of the sheet it sits on:
      // together they are the path prefix every footprint inside it carries.
      const sheet = doc.sheets[hi]!;
      parts.push(`S${sheetPath}${sheet.uuid ?? ''}`);
      continue;
    }

    const pin = pinRef(id);
    const owner = pin === null ? undefined : symbolAt.get(pin.owner);
    if (pin === null || owner === undefined) continue;

    const sym = doc.symbols[owner]!;
    const lib = libById?.get(schSymbolLibraryName(sym));
    const number = pinNumberAt(sym, lib, pin.index);
    if (number === undefined) continue;

    const ref = escapeIpc(symbolField(sym, 'Reference'));
    // A mapped pin can stand for several pads (`[1,2]`), and upstream highlights
    // every one of them rather than picking the first.
    for (const pad of resolvePadNumbers(number, sym, lib, symbolField(sym, 'Footprint'), undefined))
      parts.push(`P${ref}/${escapeIpc(pad)}`);
  }

  return parts;
}
