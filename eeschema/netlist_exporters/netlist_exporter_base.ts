// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_base.cpp` (`NETLIST_EXPORTER_BASE`):
 * the class every netlist exporter derives from, over a live `SCHEMATIC` and its
 * `CONNECTION_GRAPH` - `m_schematic`, `m_libParts`, `m_referencesAlreadyFound`,
 * `findNextSymbol`, `CreatePinList` (with `eraseDuplicatePins` and
 * `findAllUnitsOfSymbol`).
 *
 * Two helpers the OrcadPCB2, PADS and CadStar writers each spell out inline upstream are
 * written once here: {@link NETLIST_EXPORTER_BASE.sheetSymbolsByUuid} (their
 * "sort Items() by UUID, then findNextSymbol" opening) and
 * {@link NETLIST_EXPORTER_BASE.netsByName} (PADS/CadStar `writeListOfNets`' net list).
 *
 * Also here, for cross-probing's record-model selection: {@link symbolField} and
 * {@link resolvePadNumbers} (the pad numbers one schematic pin stands for, through
 * `SCH_PIN::GetEffectivePadNumber`'s pad map and stacked-pin notation).
 *
 * Not ported: `MakeCommandLine` (external command-line netlist generators), a
 * desktop-only feature, noted omitted in `dialog_export_netlist.tsx`.
 */

import type { LibSymbol, SchSymbol } from '../types.js';
import { getEffectivePadNumber, type SCH_PIN } from '../sch_pin.js';
import { expandStackedPinNotation, strNumCmp } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import type { SCHEMATIC } from '../schematic.js';

/** `UNIQUE_STRINGS`: Lookup() answers whether the string was already there. */
export class UNIQUE_STRINGS {
  m_set = new Set<string>();

  Clear(): void {
    this.m_set.clear();
  }

  Lookup(aString: string): boolean {
    if (this.m_set.has(aString)) return true;
    this.m_set.add(aString);
    return false;
  }
}

/** `std::set<LIB_SYMBOL*, LIB_SYMBOL_LESS_THAN>`: unique by LIB_ID, iterated in LIB_ID order. */
export class LIB_PART_SET {
  private m_items: LIB_SYMBOL[] = [];

  clear(): void {
    this.m_items = [];
  }

  insert(aSymbol: LIB_SYMBOL): void {
    const id = aSymbol.GetLibId();
    let lo = 0;
    let hi = this.m_items.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (this.m_items[mid]!.GetLibId().lt(id)) lo = mid + 1;
      else hi = mid;
    }

    if (lo < this.m_items.length && !id.lt(this.m_items[lo]!.GetLibId())) return;

    this.m_items.splice(lo, 0, aSymbol);
  }

  [Symbol.iterator](): Iterator<LIB_SYMBOL> {
    return this.m_items[Symbol.iterator]();
  }
}

/** `PIN_INFO`. */
export interface PIN_INFO {
  num: string;
  netName: string;
  pinName: string;
}

export class NETLIST_EXPORTER_BASE {
  protected m_referencesAlreadyFound = new UNIQUE_STRINGS();
  protected m_libParts = new LIB_PART_SET();
  protected m_schematic: SCHEMATIC;

  constructor(aSchematic: SCHEMATIC) {
    this.m_schematic = aSchematic;
  }

  /** `findNextSymbol`. */
  protected findNextSymbol(aItem: SCH_SYMBOL, aSheetPath: SCH_SHEET_PATH): SCH_SYMBOL | null {
    if (aItem.Type() !== KICAD_T.SCH_SYMBOL_T) return null;

    const symbol = aItem;

    // Power symbols and other symbols which have the reference starting with "#" are not
    // included in netlist (pseudo or virtual symbols)
    const ref = symbol.GetRef(aSheetPath);

    if (ref[0] === '#') return null;

    const screen = aSheetPath.LastScreen();

    if (!screen) return null;

    const libSymbol = screen.GetLibSymbols().get(symbol.GetSchSymbolLibraryName());

    if (!libSymbol) return null;

    // If symbol is a "multi parts per package" type
    if (libSymbol.GetUnitCount() > 1) {
      // test if this reference has already been processed, and if so skip
      if (this.m_referencesAlreadyFound.Lookup(ref)) return null;
    }

    // record the usage of this library symbol entry.
    this.m_libParts.insert(libSymbol);

    return symbol;
  }

  /** `CreatePinList`: one symbol's pins with their nets, sorted by number, duplicates erased. */
  protected CreatePinList(
    aSymbol: SCH_SYMBOL | null,
    aSheetPath: SCH_SHEET_PATH,
    aKeepUnconnectedPins: boolean,
  ): PIN_INFO[] {
    const pins: PIN_INFO[] = [];

    if (!aSymbol) return pins;

    const ref = aSymbol.GetRef(aSheetPath);

    // Power symbols and other symbols which have the reference starting with "#" are not
    // included in netlist (pseudo or virtual symbols)
    if (ref[0] === '#' || aSymbol.IsPower()) return pins;

    if (!aSymbol.GetLibSymbolRef()) return pins;

    // If symbol is a "multi parts per package" type
    if (aSymbol.GetLibSymbolRef()!.GetUnitCount() > 1) {
      // Collect all pins for this reference designator by searching the entire design for
      // other parts with the same reference designator.
      this.findAllUnitsOfSymbol(aSymbol, aSheetPath, pins, aKeepUnconnectedPins);
    } else {
      // GetUnitCount() <= 1 means one part per package
      this.collectPins(aSymbol, aSheetPath, pins, aKeepUnconnectedPins);
    }

    // Sort pins in m_SortedSymbolPinList by pin number
    stdSort(pins, (lhs, rhs) => strNumCmp(lhs.num, rhs.num, true) < 0);

    // Remove duplicate Pins in m_SortedSymbolPinList
    this.eraseDuplicatePins(pins);

    // record the usage of this library symbol
    this.m_libParts.insert(aSymbol.GetLibSymbolRef()!);

    return pins;
  }

  /** The per-pin body both `CreatePinList` arms share. */
  private collectPins(
    aSymbol: SCH_SYMBOL,
    aSheet: SCH_SHEET_PATH,
    aPins: PIN_INFO[],
    aKeepUnconnectedPins: boolean,
  ): void {
    const graph = this.m_schematic.ConnectionGraph();

    for (const pin of aSymbol.GetPins(aSheet)) {
      const conn = pin.Connection(aSheet);

      if (!conn) continue;

      const netName = conn.Name();

      if (!aKeepUnconnectedPins) {
        // Skip unconnected pins if requested
        const sg = graph.FindSubgraphByName(netName, aSheet);

        if (!sg || sg.GetNoConnect() || sg.GetItems().size < 2) continue;
      }

      const numbers = pin.GetStackedPinNumbers({ value: false });
      const baseName = pin.GetShownName();

      for (const num of numbers) {
        const pinName = baseName === '' ? num : `${baseName}_${num}`;
        aPins.push({ num, netName, pinName });
      }
    }
  }

  /** `eraseDuplicatePins`: keep one pin per number, preferring a user-named net. */
  protected eraseDuplicatePins(aPins: PIN_INFO[]): void {
    // Auto-generated nets start with "unconnected-(" for NC pins or "Net-(" for unnamed nets.
    const isAutoGeneratedNet = (aNetName: string): boolean =>
      aNetName.startsWith('unconnected-(') || aNetName.startsWith('Net-(');

    for (let ii = 0; ii < aPins.length; ii++) {
      if (aPins[ii]!.num === '') continue;

      // Because the pin list is sorted by pin number, duplicates are consecutive.
      let idxBest = ii;

      for (let jj = ii + 1; jj < aPins.length; jj++) {
        if (aPins[jj]!.num === '') continue;

        if (aPins[idxBest]!.num !== aPins[jj]!.num) break;

        // Prefer user-assigned nets over auto-generated "unconnected-(" or "Net-(" nets.
        const bestIsAuto = isAutoGeneratedNet(aPins[idxBest]!.netName);
        const jjIsAuto = isAutoGeneratedNet(aPins[jj]!.netName);

        if (bestIsAuto && !jjIsAuto) {
          // jj has a user-assigned net while best has auto-generated; switch to jj
          aPins[idxBest]!.num = '';
          idxBest = jj;
        } else {
          aPins[jj]!.num = '';
        }
      }
    }
  }

  /** `findAllUnitsOfSymbol`: the pins of every unit carrying this reference. */
  protected findAllUnitsOfSymbol(
    aSchSymbol: SCH_SYMBOL,
    aSheetPath: SCH_SHEET_PATH,
    aPins: PIN_INFO[],
    aKeepUnconnectedPins: boolean,
  ): void {
    const ref = aSchSymbol.GetRef(aSheetPath);

    for (const sheet of this.m_schematic.Hierarchy()) {
      for (const item of sheet.LastScreen()?.Items().OfType(KICAD_T.SCH_SYMBOL_T) ?? []) {
        const comp2 = item as unknown as SCH_SYMBOL;
        const ref2 = comp2.GetRef(sheet);

        if (ref2.toLowerCase() !== ref.toLowerCase()) continue;

        this.collectPins(comp2, sheet, aPins, aKeepUnconnectedPins);
      }
    }
  }

  /**
   * The board-bound symbols of one sheet, in `WriteNetlist`'s order: `Items()` sorted by
   * UUID ("to ensure file stability"), each through `findNextSymbol`, excluded-from-board
   * ones dropped. The OrcadPCB2, CadStar and PADS writers all open this way.
   */
  protected sheetSymbolsByUuid(aSheet: SCH_SHEET_PATH): SCH_SYMBOL[] {
    const sheetItems = [
      ...((aSheet.LastScreen()?.Items().OfType(KICAD_T.SCH_SYMBOL_T) ??
        []) as unknown as SCH_SYMBOL[]),
    ];

    stdSort(sheetItems, (a, b) => a.m_Uuid < b.m_Uuid);

    const out: SCH_SYMBOL[] = [];

    for (const item of sheetItems) {
      const symbol = this.findNextSymbol(item, aSheet);

      if (!symbol) continue;

      if (symbol.GetExcludedFromBoard()) continue;

      out.push(symbol);
    }

    return out;
  }

  /**
   * The net-by-net pin list PADS and CadStar's `writeListOfNets` build from `GetNetMap()`:
   * each net's pins sorted by reference then pin number, cross-subgraph duplicates of a
   * multi-unit part removed, the nets sorted by name. (`#` references are left for the
   * writer to skip, as upstream does.)
   */
  protected netsByName(
    aNetName: (aKeyName: string) => string,
  ): { name: string; pins: { ref: string; pin: string }[] }[] {
    const allNets: { name: string; pins: { ref: string; pin: string }[] }[] = [];

    for (const [key, subgraphs] of this.m_schematic.ConnectionGraph().GetNetMap()) {
      const sortedItems: { ref: string; pin: string }[] = [];

      for (const subgraph of subgraphs) {
        const sheet = subgraph.GetSheet();

        for (const item of subgraph.GetItems()) {
          if (item.Type() === KICAD_T.SCH_PIN_T) {
            const pin = item as SCH_PIN;
            sortedItems.push({
              ref: pin.GetParentSymbol()!.GetRef(sheet),
              pin: pin.GetShownNumber(),
            });
          }
        }
      }

      // Netlist ordering: Net name, then ref des, then pin name (intra-net)
      stdSort(sortedItems, (a, b) => (a.ref === b.ref ? a.pin < b.pin : a.ref < b.ref));

      // Remove duplicates across subgraphs for multi-unit parts (std::unique)
      const unique = sortedItems.filter(
        (p, k) =>
          k === 0 || !(sortedItems[k - 1]!.ref === p.ref && sortedItems[k - 1]!.pin === p.pin),
      );

      allNets.push({ name: aNetName(key.Name), pins: unique });
    }

    // Sort nets by name (inter-net ordering) for deterministic output
    stdSort(allNets, (a, b) => a.name < b.name);

    return allNets;
  }
}

export const symbolField = (s: SchSymbol, key: string): string =>
  s.fields.find((f) => f.key === key)?.value ?? '';

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
