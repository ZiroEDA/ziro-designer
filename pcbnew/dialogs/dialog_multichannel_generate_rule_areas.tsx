// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS` (pcbnew/dialogs/dialog_multichannel_generate_rule_
 * areas.cpp): one grid per source kind - sheets, component classes, groups - each row a
 * candidate rule area to generate, written back into MULTICHANNEL_TOOL's RULE_AREAS_DATA.
 */
import { type JSX, useReducer, useState } from 'react';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxGridCellBoolEditor,
  wxGridCellBoolRenderer,
  wxGridStringTable,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import type { MULTICHANNEL_TOOL } from '../tools/multichannel_tool.js';
import { PLACEMENT_SOURCE_T } from '../zone_settings.js';
import { DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS_BASE } from './dialog_multichannel_generate_rule_areas_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A source grid: the "Generate" checkbox column, then the source's names. */
function sourceGrid(aLabels: readonly string[]): { grid: WX_GRID; tricks: GRID_TRICKS } {
  const grid = new WX_GRID();
  grid.SetTable(new wxGridStringTable(0, aLabels.length), true);
  grid.EnableEditing(false);
  aLabels.forEach((label, col) => grid.SetColLabelValue(col, label));
  return { grid, tricks: new GRID_TRICKS(grid) };
}

export class DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS {
  readonly m_parentTool: MULTICHANNEL_TOOL;
  readonly m_sheetGrid = sourceGrid([_HKI('Generate'), _HKI('Sheet Path'), _HKI('Sheet Name')]);
  readonly m_componentClassGrid = sourceGrid([_HKI('Generate'), _HKI('Component Class')]);
  readonly m_groupGrid = sourceGrid([_HKI('Generate'), _HKI('Name')]);
  m_selection = 0;
  m_cbGroupItems = false;
  m_cbGroupItemsEnabled = true;
  m_cbReplaceExisting = false;

  constructor(aParentTool: MULTICHANNEL_TOOL) {
    this.m_parentTool = aParentTool;

    const raData = aParentTool.GetData();
    const row = (aGrid: WX_GRID, aCells: string[], aEnabled: boolean): void => {
      const r = aGrid.GetNumberRows();
      aGrid.AppendRows(1);
      aCells.forEach((cell, i) => aGrid.SetCellValue(r, i + 1, cell));
      aGrid.SetCellRenderer(r, 0, new wxGridCellBoolRenderer());
      aGrid.SetCellEditor(r, 0, new wxGridCellBoolEditor());
      aGrid.SetCellValue(r, 0, aEnabled ? '1' : '');
    };

    for (const ruleArea of raData.m_areas) {
      if (ruleArea.m_sourceType === PLACEMENT_SOURCE_T.SHEETNAME)
        row(
          this.m_sheetGrid.grid,
          [ruleArea.m_sheetPath, ruleArea.m_sheetName],
          ruleArea.m_generateEnabled,
        );
      else if (ruleArea.m_sourceType === PLACEMENT_SOURCE_T.COMPONENT_CLASS)
        row(
          this.m_componentClassGrid.grid,
          [ruleArea.m_componentClass],
          ruleArea.m_generateEnabled,
        );
      else row(this.m_groupGrid.grid, [ruleArea.m_groupName], ruleArea.m_generateEnabled);
    }

    this.m_cbGroupItems = raData.m_options.m_groupItems;
    this.m_cbReplaceExisting = raData.m_replaceExisting;

    if (this.m_sheetGrid.grid.GetNumberRows() === 1) {
      if (this.m_componentClassGrid.grid.GetNumberRows() > 0) this.m_selection = 1;
      else if (this.m_groupGrid.grid.GetNumberRows() > 0) this.m_selection = 2;
    }

    this.OnNotebookPageChanged(this.m_selection);
  }

  TransferDataFromWindow(): boolean {
    const raData = this.m_parentTool.GetData();
    let sheetRowIdx = 0;
    let componentClassRowIdx = 0;
    let groupIdx = 0;

    for (const area of raData.m_areas) {
      let enabled: string;

      if (area.m_sourceType === PLACEMENT_SOURCE_T.SHEETNAME)
        enabled = this.m_sheetGrid.grid.GetCellValue(sheetRowIdx++, 0);
      else if (area.m_sourceType === PLACEMENT_SOURCE_T.COMPONENT_CLASS)
        enabled = this.m_componentClassGrid.grid.GetCellValue(componentClassRowIdx++, 0);
      else enabled = this.m_groupGrid.grid.GetCellValue(groupIdx++, 0);

      area.m_generateEnabled = enabled === '1';
    }

    raData.m_replaceExisting = this.m_cbReplaceExisting;

    // Don't allow grouping for groups
    raData.m_options.m_groupItems = this.m_selection === 2 ? false : this.m_cbGroupItems;

    return true;
  }

  /** `OnNotebookPageChanged`: grouping is not offered on the Groups page. */
  OnNotebookPageChanged(aSelection: number): void {
    this.m_selection = aSelection;
    this.m_cbGroupItemsEnabled = aSelection !== 2;
  }
}

export function DialogMultichannelGenerateRuleAreas({
  tool,
  onClose,
}: {
  tool: MULTICHANNEL_TOOL;
  /** EndModal: true for wxID_OK. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [dlg] = useState(() => new DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS(tool));
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const page = (aName: string, aGrid: { grid: WX_GRID; tricks: GRID_TRICKS }) => (
    <WxGridView
      grid={aGrid.grid}
      tricks={aGrid.tricks}
      rowLabels={false}
      flexCol={1}
      ariaLabel={aName}
    />
  );

  return (
    <DIALOG_MULTICHANNEL_GENERATE_RULE_AREAS_BASE
      pages={[
        { text: _('Sheets'), content: page(_('Sheets'), dlg.m_sheetGrid) },
        {
          text: _('Component Classes'),
          content: page(_('Component Classes'), dlg.m_componentClassGrid),
        },
        { text: _('Groups'), content: page(_('Groups'), dlg.m_groupGrid) },
      ]}
      selection={dlg.m_selection}
      OnNotebookPageChanged={(i) => {
        dlg.OnNotebookPageChanged(i);
        bump();
      }}
      m_cbReplaceExisting={{
        value: dlg.m_cbReplaceExisting,
        onChange: (on) => {
          dlg.m_cbReplaceExisting = on;
          bump();
        },
      }}
      m_cbGroupItems={{
        value: dlg.m_cbGroupItems,
        enabled: dlg.m_cbGroupItemsEnabled,
        onChange: (on) => {
          dlg.m_cbGroupItems = on;
          bump();
        },
      }}
      onOK={() => {
        if (dlg.TransferDataFromWindow()) onClose(true);
      }}
      onCancel={() => onClose(false)}
    />
  );
}
