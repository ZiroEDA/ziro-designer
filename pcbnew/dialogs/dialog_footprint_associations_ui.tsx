// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Show Footprint Associations. Counterpart: `dialog_footprint_associations_base.cpp`'s
 * sizer — two `WX_GRID`s (`m_gridLibrary` 2x3, `m_gridSymbol` Nx3), each with
 * no column or row labels, no grid lines and editing off, under their own
 * `wxStaticText` heading, and a single wxID_OK `wxStdDialogButtonSizer`
 * (there is no Cancel: `TransferDataToWindow` only reads, never writes).
 *
 * The decision logic — which rows exist and what each cell holds — lives in
 * `dialog_footprint_associations.ts`; this file is only the controls.
 */
import { useMemo, type JSX } from 'react';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridStringTable } from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { AssociationRow } from './dialog_footprint_associations.js';
import {
  buildLibraryAssociationRows,
  buildSymbolAssociationRows,
} from './dialog_footprint_associations.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from '../footprint_library_adapter.js';
import type { FOOTPRINT } from '../footprint.js';

/** `m_gridLibrary` / `m_gridSymbol`: a read-only 3-column info grid, no headers. */
function useInfoGrid(rows: readonly AssociationRow[]): WX_GRID {
  return useMemo(() => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(rows.length, 3), true);
    g.EnableEditing(false);
    rows.forEach((row, i) => {
      g.SetCellValue(i, 0, row.label);
      g.SetCellValue(i, 1, row.value);
      g.SetCellValue(i, 2, row.description);
    });
    return g;
    // `rows` is itself memoized upstream on [footprint, adapter], so its
    // identity is stable across re-renders that do not change the footprint.
  }, [rows]);
}

const LIBRARY_COLUMNS = [{ width: 100 }, { width: 280 }, { width: 360 }];

export function DialogFootprintAssociations({
  footprint,
  adapter,
  onClose,
}: {
  /** The one selected footprint (`selection.Front()`, `PCB_FOOTPRINT_T`). */
  footprint: FOOTPRINT;
  /** `PROJECT_PCB::FootprintLibAdapter( GetProject() )`, or null with no project. */
  adapter: FOOTPRINT_LIBRARY_ADAPTER | null;
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);

  const libraryRows = useMemo(
    () => buildLibraryAssociationRows(footprint, adapter),
    [footprint, adapter],
  );
  const symbolRows = useMemo(() => buildSymbolAssociationRows(footprint), [footprint]);

  const libraryGrid = useInfoGrid(libraryRows);
  const symbolGrid = useInfoGrid(symbolRows);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-footprint-associations" role="dialog" aria-modal="true">
        <div className="ze-modal-header">Footprint Associations</div>
        <div className="ze-modal-body">
          {/* `SetFont( KIUI::GetStatusFont( this ) )`: a no-op off macOS
              (getGUIFont( win, 0 ) is the window's own font there), so this
              is plain chrome text — no bold/size class to invent. */}
          <div className="assoc-label">Library Association</div>
          <WxGridView
            grid={libraryGrid}
            columns={LIBRARY_COLUMNS}
            rowLabels={false}
            colLabels={false}
            ariaLabel="Library association"
          />

          <div className="assoc-label">Schematic Association</div>
          <WxGridView
            grid={symbolGrid}
            columns={LIBRARY_COLUMNS}
            rowLabels={false}
            colLabels={false}
            ariaLabel="Schematic association"
          />
        </div>
        <div className="ze-modal-footer">
          {/* `m_sdbControlSizer`: wxID_OK alone, no Cancel — the dialog never writes. */}
          <button type="button" className="ze-btn default" onClick={onClose} autoFocus>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
