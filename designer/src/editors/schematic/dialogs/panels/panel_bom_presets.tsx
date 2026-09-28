// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BOM Presets panel. Counterpart: `eeschema/dialogs/panel_bom_presets.cpp`
 * over `..._base.cpp` (PANEL_BOM_PRESETS): two read-only "Name" WX_GRIDs
 * (Bill of Materials Presets, Bill of Materials Formatting Presets), each with
 * a delete button beneath. The presets are made in the Symbol Fields Table;
 * here they are only listed and removed (`OnDeleteRows`).
 *
 * No GRID_TRICKS: upstream pushes none onto these two grids, so they have no
 * copy, paste or context menu either.
 */
import { type JSX, useLayoutEffect, useState } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridStringTable } from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { BomPresets } from '@ziroeda/eeschema/schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export { defaultBomPresets, type BomPresets } from '@ziroeda/eeschema/schematic_settings.js';

interface Props {
  value: BomPresets;
  onChange: (next: BomPresets) => void;
}

function makeGrid(): WX_GRID {
  const g = new WX_GRID();
  g.SetTable(new wxGridStringTable(0, 1), true);
  g.EnableEditing(false);
  g.SetColLabelValue(0, 'Name');
  return g;
}

/** `BuildGrid`, for one grid. */
function build(aGrid: WX_GRID, aNames: readonly string[]): void {
  aGrid.BeginBatch();
  aGrid.ClearRows();
  aGrid.AppendRows(aNames.length);
  aNames.forEach((n, row) => {
    aGrid.SetCellValue(row, 0, n);
  });
  aGrid.EndBatch();
}

export function PanelBomPresets({ value, onChange }: Props): JSX.Element {
  const [[bomGrid, fmtGrid]] = useState(() => [makeGrid(), makeGrid()] as const);

  const bomNames = JSON.stringify(value.presets.map((p) => p.name));
  const fmtNames = JSON.stringify(value.fmtPresets.map((p) => p.name));

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the names' content; the grid is stable
  useLayoutEffect(() => build(bomGrid, JSON.parse(bomNames) as string[]), [bomNames]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the names' content; the grid is stable
  useLayoutEffect(() => build(fmtGrid, JSON.parse(fmtNames) as string[]), [fmtNames]);

  /** `OnDeleteBomPreset` / `OnDeleteBomFmtPreset`. */
  const onDelete = (aGrid: WX_GRID, aKey: 'presets' | 'fmtPresets'): void => {
    const next = [...value[aKey]];

    aGrid.OnDeleteRows((row) => {
      aGrid.DeleteRows(row, 1);
      next.splice(row, 1);
    });

    if (next.length !== value[aKey].length) onChange({ ...value, [aKey]: next });
  };

  return (
    <div className="ze-bompresets">
      <div className="ze-bompresets-title">Bill of Materials Presets</div>
      <div className="ze-grid-pane ze-bompresets-grid">
        <WxGridView grid={bomGrid} columns={[{ width: 420 }]} ariaLabel="BOM presets" />
      </div>
      <div className="ze-bompresets-btn">
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete preset"
          tooltip={null}
          onClick={() => onDelete(bomGrid, 'presets')}
        />
      </div>
      <div className="ze-bompresets-title">Bill of Materials Formatting Presets</div>
      <div className="ze-grid-pane ze-bompresets-grid">
        <WxGridView grid={fmtGrid} columns={[{ width: 420 }]} ariaLabel="BOM formatting presets" />
      </div>
      <div className="ze-bompresets-btn">
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete formatting preset"
          tooltip={null}
          onClick={() => onDelete(fmtGrid, 'fmtPresets')}
        />
      </div>
    </div>
  );
}
