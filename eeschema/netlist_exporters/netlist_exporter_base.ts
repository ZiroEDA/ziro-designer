// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_base.cpp` (`NETLIST_EXPORTER_BASE`):
 * the pieces every netlist exporter shares, rather than a per-format copy.
 *
 * Ported:
 *  - {@link symbolField} / {@link boardSymbols}: read one field off a placed
 *    symbol, and the board-bound subset of a schematic's symbols in *reference*
 *    order — the ordering `NETLIST_EXPORTER_XML::makeSymbols` and
 *    `netlist_exporter_kicad.ts`'s `orderedSymbols` use (a `std::set` keyed by
 *    `StrNumCmp` on the reference, lowest uuid picked as the primary unit of a
 *    multi-unit part). Kept for the KiCad-XML and OrcadPCB2 exporters, which
 *    already read this way; not re-ordered this stage (their kicad-cli oracle
 *    coverage is still hand-written unit tests, not a byte-exact fixture, so
 *    "stays byte-identical" cuts the other way here — changing it now would be
 *    an unverified behavior change, not a move).
 *  - {@link sheetOrderedBoardSymbols}: `findNextSymbol`, applied across the whole
 *    symbol list. Upstream's OrcadPCB2/PADS/CadStar `WriteNetlist` each sort
 *    `SCH_SCREEN::Items()` by **uuid** (not reference — "the rtree returns items
 *    in a non-deterministic order … we need to sort them … to ensure file
 *    stability"), then call `findNextSymbol` per item, which skips a symbol
 *    whose reference was already seen (`m_referencesAlreadyFound.Lookup`) — so a
 *    multi-unit part's later units never get a second `.ADD_COM`/`*PART*` line.
 *    Used by {@link netlistCadstar} and {@link netlistPads}; confirmed against
 *    `kicad-cli sch export netlist --format cadstar/pads` (both bugs — reference
 *    order instead of uuid order, and no multi-unit dedup — were real before
 *    this, caught by `test_multiunit_reannotate_2/3` and `complex_hierarchy`).
 *  - {@link netPinsByName}: the net-by-net pin list `writeListOfNets` builds from
 *    `ConnectionGraph()->GetNetMap()` (sorted by net name, then by reference then
 *    pin number inside a net, cross-subgraph duplicates for a multi-unit part's
 *    shared pins removed) — shared by PADS and CadStar, which both build it this
 *    way rather than through `CreatePinList`.
 *  - {@link resolvePadNumbers}: the pad numbers one schematic pin contributes to
 *    the PCB-sync (KiCad-format) netlist, moved here from `sch_pin.ts` — it is
 *    exporter infrastructure (only `netlist_exporter_kicad.ts` and cross-probing
 *    call it), not a `SCH_PIN` method; `SCH_PIN::GetEffectivePadNumber` itself,
 *    the pad-map resolution it is built on, stays in `sch_pin.ts` since that one
 *    really is the pin's own.
 *
 * Not ported: `CreatePinList` / `eraseDuplicatePins` / `findAllUnitsOfSymbol`
 * (the single-symbol pin list with stacked-pin expansion and the
 * user-net-over-auto-generated-net dedup rule) — OrcadPCB2 is the only exporter
 * that calls `CreatePinList`, and it is out of scope this stage (see above); a
 * PADS/CadStar port would need it only if they grew that call, which upstream's
 * versions do not. `MakeCommandLine` (external command-line netlist generators)
 * is a desktop-only feature, already noted omitted in
 * `dialog_export_netlist.tsx`.
 */

import type { LibSymbol, Schematic, SchSymbol } from '../types.js';
import { computeNetlist, enumeratePins } from '../connectivity/nets.js';
import { refId } from '../tools/hittest.js';
import { compareRefs } from '../exporters/bom.js';
import { getEffectivePadNumber } from '../sch_pin.js';
import { expandStackedPinNotation } from '@ziroeda/common/string_utils.js';

export const symbolField = (s: SchSymbol, key: string): string =>
  s.fields.find((f) => f.key === key)?.value ?? '';

/** A symbol that belongs on the board (excludes power/virtual and off-board parts). */
export function boardSymbols(sch: Schematic): { sym: SchSymbol; ref: string; index: number }[] {
  const out: { sym: SchSymbol; ref: string; index: number }[] = [];
  sch.symbols.forEach((sym, index) => {
    const ref = symbolField(sym, 'Reference');
    if (!ref || ref.startsWith('#') || !sym.onBoard) return;
    out.push({ sym, ref, index });
  });
  // Stable ordering by reference (KiCad sorts for file stability).
  return out.sort((a, b) => compareRefs(a.ref, b.ref));
}

/**
 * `findNextSymbol`, applied across the whole schematic: board-bound symbols in
 * **uuid** order (the order `SCH_SCREEN::Items()` yields once sorted for file
 * stability), with only the first-seen unit of a multi-unit reference kept.
 */
export function sheetOrderedBoardSymbols(
  sch: Schematic,
): { sym: SchSymbol; ref: string; index: number }[] {
  const candidates: { sym: SchSymbol; ref: string; index: number }[] = [];
  sch.symbols.forEach((sym, index) => {
    const ref = symbolField(sym, 'Reference');
    if (!ref || ref.startsWith('#') || !sym.onBoard) return;
    candidates.push({ sym, ref, index });
  });
  candidates.sort((a, b) => (a.sym.uuid ?? '').localeCompare(b.sym.uuid ?? ''));

  const seen = new Set<string>();
  const out: { sym: SchSymbol; ref: string; index: number }[] = [];
  for (const c of candidates) {
    if (seen.has(c.ref)) continue;
    seen.add(c.ref);
    out.push(c);
  }
  return out;
}

/**
 * The pins of every net, as `REF.PIN` pairs, ordered the way both the PADS and
 * CadStar exporters order them.
 *
 * Both sort nets by name and, inside a net, by reference then pin number, "to
 * ensure file stability for version control and QA comparisons". Both also drop
 * duplicates, which a multi-unit part produces when its repeated pins are
 * connected on more than one unit and so land in separate subgraphs. And both
 * skip a reference beginning with `#`, the power/virtual symbols.
 */
export function netPinsByName(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
): { name: string; pins: { ref: string; pin: string }[] }[] {
  const netlist = computeNetlist(sch, libById);
  const pinById = new Map(enumeratePins(sch, libById).map((p) => [p.id, p]));
  const refByIndex = new Map(
    sch.symbols.map((sym, i) => [refId('symbol', sym.uuid, i), symbolField(sym, 'Reference')]),
  );

  const out: { name: string; pins: { ref: string; pin: string }[] }[] = [];
  for (const net of netlist.nets) {
    const seen = new Set<string>();
    const pins: { ref: string; pin: string }[] = [];
    for (const id of net.items) {
      const pin = pinById.get(id);
      if (!pin || !pin.number) continue;
      const ref = refByIndex.get(pin.symId) ?? '';
      if (!ref || ref.startsWith('#')) continue;
      const k = `${ref}\u0000${pin.number}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pins.push({ ref, pin: pin.number });
    }
    pins.sort((a, b) =>
      a.ref === b.ref ? (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0) : a.ref < b.ref ? -1 : 1,
    );
    out.push({ name: net.name, pins });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface NetlistMeta {
  /** Source schematic file name (design header `source`). */
  source: string;
  /**
   * Timestamp for the formats that stamp one (CadStar's `.TIM`). Left to the
   * caller so an export is reproducible in a test; defaults to now.
   */
  date?: string;
}

/**
 * `NETLIST_EXPORTER_BASE::resolvePadNumbers` (not a literal upstream name — the
 * pad numbers one pin contributes to a netlist): the resolved pad expanded
 * through stacked-pin notation, or nothing at all when the pin maps to no pad
 * on its footprint (an UNMAPPED pin must not open a net entry).
 */
export function resolvePadNumbers(
  pinNumber: string,
  symbol: SchSymbol,
  lib: LibSymbol | undefined,
  footprintLibId: string,
  footprintPads: ReadonlySet<string> | undefined,
): string[] {
  const { padNumber, state } = getEffectivePadNumber(
    pinNumber,
    symbol,
    lib,
    footprintLibId,
    footprintPads,
  );
  if (state === 'unmapped') return [];
  return expandStackedPinNotation(padNumber).numbers;
}
