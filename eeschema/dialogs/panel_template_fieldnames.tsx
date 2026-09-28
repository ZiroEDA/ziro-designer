// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_TEMPLATE_FIELDNAMES` (`eeschema/dialogs/panel_template_fieldnames.cpp`
 * over `..._base.cpp`) — the Name / Visible / URL grid of template field names.
 *
 * **One class, two pages.** Upstream the constructor takes a `TEMPLATES*` and
 * branches on it once:
 *
 *     if( aProjectTemplateMgr )  m_title->SetLabel( _( "Project Field Name Templates" ) );
 *     else                       m_title->SetLabel( _( "Global Field Name Templates" ) );
 *     (`:44-52`)
 *
 * Schematic Setup passes the project's manager; Preferences passes nullptr and
 * the panel reads `EESCHEMA_SETTINGS`' own `m_Drawing.field_names`. Everything
 * else — the grid, the buttons, the row rules — is shared, which is why the two
 * pages are the same page with one word different.
 *
 * We had TWO of them: this one, and a second hand-rolled table under
 * `prefs/PanelTemplateFieldnames.tsx` with a `+ Add field` text button, a per-row
 * `−`, a heading in a group box KiCad does not draw, and a sentence
 * ("Template fields are added to every new symbol placed on the schematic")
 * that appears nowhere in KiCad. That one is gone; this is the panel both pages
 * construct, as upstream does.
 *
 * The grid is a `WX_GRID` with GRID_TRICKS: `CreateGrid( 0, 3 )`, column
 * widths 48 / 48 on the check-box columns and the autosizer on column 0,
 * `SetSelectionMode( wxGridSelectRows )`, and a `wxGridCellBoolRenderer`
 * on columns 1 and 2, read-only because GRID_TRICKS toggles them.
 */

import type { JSX } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import type { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridCellBoolRenderer, wxGridSelectionModes } from '@ziroeda/common/wx/grid.js';
import { useStringGrid, WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { FieldTemplate } from '../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export type { FieldTemplate } from '../schematic_settings.js';

interface Props {
  templates: FieldTemplate[];
  onChange: (next: FieldTemplate[]) => void;
  /**
   * `aProjectTemplateMgr == nullptr` — the Preferences copy, which edits the
   * application's own templates rather than this project's. It changes the
   * title and nothing else, exactly as upstream's one branch does.
   */
  global?: boolean;
}

/** `TransferDataToGrid`'s per-row cells: the two flags as check boxes GRID_TRICKS toggles. */
function setupRows(aGrid: WX_GRID): void {
  for (let row = 0; row < aGrid.GetNumberRows(); ++row) {
    for (const col of [1, 2]) {
      aGrid.SetCellRenderer(row, col, new wxGridCellBoolRenderer());
      aGrid.SetReadOnly(row, col); // Not really; we delegate interactivity to GRID_TRICKS
    }
  }
}

/** `OnAddButtonClick`: an "Untitled Field", not visible, with its name open. */
function onAddButtonClick(aGrid: WX_GRID): void {
  aGrid.OnAddRow(() => {
    const row = aGrid.GetNumberRows();
    aGrid.AppendRows(1);
    aGrid.SetCellValue(row, 0, 'Untitled Field');
    aGrid.SetCellValue(row, 1, '0');
    aGrid.SetCellValue(row, 2, '0');
    setupRows(aGrid);
    return [row, 0];
  });
}

export function PanelTemplateFieldnames({ templates, onChange, global }: Props): JSX.Element {
  const { grid, tricks, onUpdate } = useStringGrid<FieldTemplate>({
    labels: ['Name', 'Visible', 'URL'],
    mode: wxGridSelectionModes.wxGridSelectRows,
    rows: templates,
    toCells: (t) => [t.name, t.visible ? '1' : '0', t.url ? '1' : '0'],
    fromCells: (c) => ({ name: c[0]!, visible: c[1] === '1', url: c[2] === '1' }),
    onChange,
    setup: setupRows,
    onAddRow: onAddButtonClick,
  });

  return (
    <div className="ze-fieldnames">
      {/* `m_title`, a plain wxStaticText added `wxTOP|wxLEFT|wxEXPAND, 8` — not a
          group box, and with no rule under it. */}
      <div className="ze-fieldnames-title">
        {global ? 'Global Field Name Templates' : 'Project Field Name Templates'}
      </div>
      <div className="ze-grid-pane ze-fieldnames-grid">
        <WxGridView
          grid={grid}
          tricks={tricks}
          columns={[{}, { width: 48, center: true }, { width: 48, center: true }]}
          flexCol={0}
          onUpdate={onUpdate}
          ariaLabel="Field name templates"
        />
      </div>
      {/* `bSizer10`: add, up, down, a fixed 20 px gap, delete. Four
          STD_BITMAP_BUTTONs carrying KiCad's own small_* bitmaps — the tooltips
          are on up and down alone, which is where the base file sets them. */}
      <div className="ze-grid-btns">
        <StdBitmapButton
          bitmap="small_plus"
          title="Add field"
          tooltip={null}
          onClick={() => onAddButtonClick(grid)}
        />
        <StdBitmapButton
          bitmap="small_up"
          title="Move up"
          onClick={() => grid.OnMoveRowUp((row) => grid.SwapRows(row, row - 1))}
        />
        <StdBitmapButton
          bitmap="small_down"
          title="Move down"
          onClick={() => grid.OnMoveRowDown((row) => grid.SwapRows(row, row + 1))}
        />
        {/* `bSizer10->Add( 20, 0, 0, wxEXPAND, 5 )`. [px] wxFormBuilder's own 20. */}
        <span className="ze-fieldnames-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete field"
          tooltip={null}
          onClick={() => grid.OnDeleteRows((row) => grid.DeleteRows(row, 1))}
        />
      </div>
    </div>
  );
}
