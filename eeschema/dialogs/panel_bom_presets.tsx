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
import { PANEL_BOM_PRESETS_BASE } from './panel_bom_presets_base.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridStringTable } from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import type { BomPresets } from '../schematic_settings.js';
import { _ } from '@ziroeda/wx/translation.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export { defaultBomPresets, type BomPresets } from '../schematic_settings.js';

interface Props {
  value: BomPresets;
  onChange: (next: BomPresets) => void;
}

function makeGrid(): WX_GRID {
  const g = new WX_GRID();
  g.SetTable(new wxGridStringTable(0, 1), true);
  g.EnableEditing(false);
  g.SetColLabelValue(0, _('Name'));
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
    <PANEL_BOM_PRESETS_BASE
      m_bomPresetsGrid={
        <WxGridView grid={bomGrid} columns={[{ width: 420 }]} ariaLabel={_('BOM presets')} />
      }
      onDeleteBomPreset={() => onDelete(bomGrid, 'presets')}
      m_bomFmtPresetsGrid={
        <WxGridView
          grid={fmtGrid}
          columns={[{ width: 420 }]}
          ariaLabel={_('BOM formatting presets')}
        />
      }
      onDeleteBomFmtPreset={() => onDelete(fmtGrid, 'fmtPresets')}
    />
  );
}
