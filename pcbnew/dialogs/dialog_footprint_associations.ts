// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Show Footprint Associations. Counterpart: `pcbnew/dialogs/dialog_footprint_associations.cpp`
 * over `dialog_footprint_associations_base.cpp`'s two `WX_GRID`s — opened by
 * `BOARD_INSPECTION_TOOL::ShowFootprintLinks` (`PCB_ACTIONS::showFootprintAssociations`,
 * Inspect > Show Footprint Associations) on the one selected footprint.
 *
 * `TransferDataToWindow` reads three things this module reproduces as pure
 * row-builders over the live `FOOTPRINT` (`board.footprints[idx].k`, the same
 * object `dialog_footprint_properties` is opened with): the FPID split into
 * library nickname / item name (`GetFPID().GetLibNickname()` /
 * `GetLibItemName()`), the library row's own description
 * (`LIBRARY_TABLE_ROW::Description()`, optional on the adapter's row: blank
 * when the host's library store keeps none), and a
 * fresh load of the library footprint for `GetLibDescription()`.
 *
 * The Schematic Association grid is one row per `KIID_PATH` segment upstream
 * (`symbolPath[ii]`, i.e. `footprint.GetPath()`), with every row's third
 * column cross-probed from eeschema
 * (`Kiway().ExpressMail( FRAME_SCH, MAIL_SCH_GET_ITEM, … )`).
 * `MAIL_SCH_GET_ITEM` has no sender/handler here yet, which leaves that
 * column blank — the same shape as upstream's own `!Kiface().IsSingle()`
 * branch, which skips the mail (and so the column) in standalone Pcbnew too.
 * What we DO carry locally, straight off the `FOOTPRINT`, are `GetReference()`
 * (the linked symbol's designator, shown on the last, "Symbol:" row) and
 * `GetSheetname()` (the immediate parent sheet, shown on the second-to-last,
 * "Sheet:" row) — `FOOTPRINT` keeps only that one flattened sheet name, not a
 * per-ancestor chain, so earlier "Sheet:" rows show no description either.
 */
import type { FOOTPRINT_LIBRARY_ADAPTER } from '../footprint_library_adapter.js';
import type { FOOTPRINT } from '../footprint.js';

export interface AssociationRow {
  label: string;
  value: string;
  description: string;
}

/** `m_gridLibrary`: the two rows built from `fpID` plus a fresh library load. */
export function buildLibraryAssociationRows(
  footprint: FOOTPRINT,
  adapter: FOOTPRINT_LIBRARY_ADAPTER | null,
): AssociationRow[] {
  const fpid = footprint.GetFPID();
  const libName = fpid.GetLibNickname();
  const fpName = fpid.GetLibItemName();

  // `adapter->GetRow( libName )` then `( *row )->Description()`.
  const libDesc = adapter?.GetRow(libName)?.Description?.() ?? '';
  let fpDesc = '';

  if (adapter) {
    try {
      const libFootprint = adapter.LoadFootprint(libName, fpName, true);
      if (libFootprint) fpDesc = libFootprint.GetLibDescription();
    } catch {
      // IO_ERROR: the library entry no longer loads. Matches upstream's
      // empty-string fallback (dialog_footprint_associations.cpp:70-73).
    }
  }

  return [
    { label: 'Library: ', value: libName, description: libDesc },
    { label: 'Footprint: ', value: fpName, description: fpDesc },
  ];
}

/** `m_gridSymbol`: one row per `KIID_PATH` segment of `FOOTPRINT::GetPath()`. */
export function buildSymbolAssociationRows(footprint: FOOTPRINT): AssociationRow[] {
  const segments = footprint.GetPath();

  return segments.map((uuid, i) => {
    const isLast = i === segments.length - 1;
    const isParentSheet = i === segments.length - 2;

    return {
      label: isLast ? 'Symbol:' : 'Sheet: ',
      value: uuid,
      description: isLast
        ? footprint.GetReference()
        : isParentSheet
          ? footprint.GetSheetname()
          : '',
    };
  });
}
