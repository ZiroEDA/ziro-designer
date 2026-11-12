// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MULTICHANNEL_REPEAT_LAYOUT` (pcbnew/dialogs/dialog_multichannel_repeat_layout.cpp):
 * which targets to copy to and how, written back into MULTICHANNEL_TOOL's RULE_AREAS_DATA.
 */
import { type JSX, useEffect, useReducer, useState } from 'react';
import { KiBitmapBundle } from '@ziroeda/common/bitmap.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { BITMAPS } from '@ziroeda/include/bitmaps/bitmaps_list.js';
import {
  wxALIGN_CENTER,
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxGridCellAttr,
  wxGridCellBoolEditor,
  wxGridCellBoolRenderer,
  type wxGridEvent,
  wxGridStringTable,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import type { BOARD } from '../board.js';
import type { MULTICHANNEL_TOOL, RULE_AREA } from '../tools/multichannel_tool.js';
import { DIALOG_MULTICHANNEL_REPEAT_LAYOUT_BASE } from './dialog_multichannel_repeat_layout_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

interface TABLE_ENTRY {
  m_targetRA: RULE_AREA;
  m_raName: string;
  m_errMsg: string;
  m_isOK: boolean;
  m_doCopy: boolean;
  m_mismatchReasons: string[];
}

const COL_COPY = 0;
const COL_NAME = 1;
const COL_STATUS = 2;
const COL_DETAILS = 3;

export class DIALOG_MULTICHANNEL_REPEAT_LAYOUT {
  readonly m_parentTool: MULTICHANNEL_TOOL;
  readonly m_board: BOARD;
  readonly m_targetRAs: TABLE_ENTRY[] = [];
  readonly m_raGrid = new WX_GRID();
  readonly m_tricks: GRID_TRICKS;
  m_refRAName = '';
  m_refAnchorFpChoices: string[] = [];
  m_refAnchorFp = 0;
  m_cbCopyPlacement = true;
  m_cbCopyRouting = true;
  m_cbCopyOnlyConnectedRouting = true;
  m_cbCopyOtherItems = false;
  m_cbGroupItems = false;
  m_cbIncludeLockedComponents = false;

  constructor(aBoard: BOARD, aParentTool: MULTICHANNEL_TOOL) {
    this.m_board = aBoard;
    this.m_parentTool = aParentTool;
    this.m_raGrid.SetTable(new wxGridStringTable(0, 4), true);
    this.m_raGrid.SetColLabelValue(COL_COPY, _('Copy'));
    this.m_raGrid.SetColLabelValue(COL_NAME, _('Target Rule Area'));
    this.m_raGrid.SetColLabelValue(COL_STATUS, _('Status'));
    this.m_raGrid.SetColLabelValue(COL_DETAILS, _('Details'));
    this.m_raGrid.EnableEditing(false);
    this.m_tricks = new GRID_TRICKS(this.m_raGrid);
    this.TransferDataToWindow();
  }

  TransferDataToWindow(): boolean {
    const data = this.m_parentTool.GetData();

    for (const [ruleArea, ruleAreaData] of data.m_compatMap) {
      this.m_targetRAs.push({
        m_doCopy: ruleAreaData.m_isOk,
        m_errMsg: ruleAreaData.m_errorMsg,
        m_isOK: ruleAreaData.m_isOk,
        m_raName: ruleArea.m_ruleName,
        m_targetRA: ruleArea,
        m_mismatchReasons: ruleAreaData.m_mismatchReasons,
      });
    }

    // The comparator: an OK row before a failed one, else by name.
    this.m_targetRAs.sort((a, b) => {
      if (a.m_isOK !== b.m_isOK) return a.m_isOK ? -1 : 1;
      return a.m_raName < b.m_raName ? -1 : a.m_raName > b.m_raName ? 1 : 0;
    });

    const grid = this.m_raGrid;
    grid.ClearRows();
    grid.AppendRows(this.m_targetRAs.length);

    this.m_targetRAs.forEach((entry, i) => {
      grid.SetCellValue(i, COL_NAME, entry.m_raName);
      grid.SetCellValue(i, COL_STATUS, entry.m_isOK ? _('OK') : entry.m_errMsg);
      grid.SetCellValue(i, COL_DETAILS, '');
      grid.SetCellRenderer(i, COL_COPY, new wxGridCellBoolRenderer());
      grid.SetCellEditor(i, COL_COPY, new wxGridCellBoolEditor());
      grid.SetCellValue(i, COL_COPY, entry.m_doCopy ? '1' : '');

      if (!entry.m_isOK && entry.m_mismatchReasons.length > 0) {
        const attr = new wxGridCellAttr();
        attr.SetReadOnly();
        attr.SetAlignment(wxALIGN_CENTER);
        grid.SetAttr(i, COL_DETAILS, attr);
      }
    });

    this.m_refRAName = data.m_refRA?.m_zone?.GetZoneName() ?? '';

    const refFpNames = [''];

    for (const fp of data.m_refRA?.m_components ?? []) refFpNames.push(fp.GetReference());

    // wxArrayString::Sort.
    this.m_refAnchorFpChoices = refFpNames.sort();
    this.m_refAnchorFp = 0;

    this.m_cbCopyPlacement = data.m_options.m_copyPlacement;
    this.m_cbCopyRouting = data.m_options.m_copyRouting;
    this.m_cbCopyOnlyConnectedRouting = data.m_options.m_connectedRoutingOnly;
    this.m_cbGroupItems = data.m_options.m_groupItems;
    this.m_cbCopyOtherItems = data.m_options.m_copyOtherItems;
    this.m_cbIncludeLockedComponents = data.m_options.m_includeLockedItems;
    return true;
  }

  TransferDataFromWindow(): boolean {
    const data = this.m_parentTool.GetData();

    this.m_targetRAs.forEach((entry, i) => {
      const compat = data.m_compatMap.get(entry.m_targetRA);
      if (compat) compat.m_doCopy = this.m_raGrid.GetCellValue(i, COL_COPY) === '1';
    });

    data.m_options.m_copyPlacement = this.m_cbCopyPlacement;
    data.m_options.m_copyRouting = this.m_cbCopyRouting;
    data.m_options.m_connectedRoutingOnly = this.m_cbCopyOnlyConnectedRouting;
    data.m_options.m_copyOtherItems = this.m_cbCopyOtherItems;
    data.m_options.m_groupItems = this.m_cbGroupItems;
    data.m_options.m_includeLockedItems = this.m_cbIncludeLockedComponents;

    const anchor = this.m_refAnchorFpChoices[this.m_refAnchorFp] ?? '';

    if (anchor === '') {
      data.m_options.m_anchorFp = null;
    } else {
      for (const fp of this.m_board.Footprints()) {
        if (fp.GetReference() === anchor) data.m_options.m_anchorFp = fp;
      }
    }

    return true;
  }

  /** `OnGridCellLeftClick`: the Details column shows why a target does not match. */
  OnGridCellLeftClick(aRow: number, aCol: number): void {
    if (aCol !== COL_DETAILS || aRow < 0 || aRow >= this.m_targetRAs.length) return;

    const entry = this.m_targetRAs[aRow]!;

    if (!entry.m_isOK && entry.m_mismatchReasons.length > 0) {
      this.m_parentTool.ShowMismatchDetails(
        wxFormat(_('Rule area topologies do not match: %s'), entry.m_errMsg),
        entry.m_mismatchReasons,
      );
    }
  }
}

export function DialogMultichannelRepeatLayout({
  board,
  tool,
  onClose,
}: {
  board: BOARD;
  tool: MULTICHANNEL_TOOL;
  /** EndModal: true for wxID_OK. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [dlg] = useState(() => new DIALOG_MULTICHANNEL_REPEAT_LAYOUT(board, tool));
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const click = (e: wxGridEvent): void => {
      dlg.OnGridCellLeftClick(e.GetRow(), e.GetCol());
      e.Skip();
    };
    dlg.m_raGrid.Connect(wxEVT_GRID_CELL_LEFT_CLICK, click);
    return () => {
      dlg.m_raGrid.Disconnect(wxEVT_GRID_CELL_LEFT_CLICK, click);
    };
  }, [dlg]);

  const check = (aKey: keyof DIALOG_MULTICHANNEL_REPEAT_LAYOUT & `m_cb${string}`) => ({
    value: dlg[aKey] as boolean,
    onChange: (aOn: boolean) => {
      (dlg as unknown as Record<string, boolean>)[aKey] = aOn;
      bump();
    },
  });

  return (
    <DIALOG_MULTICHANNEL_REPEAT_LAYOUT_BASE
      m_refRAName={dlg.m_refRAName}
      m_refAnchorFp={{
        choices: dlg.m_refAnchorFpChoices,
        value: dlg.m_refAnchorFp,
        onChange: (i) => {
          dlg.m_refAnchorFp = i;
          bump();
        },
      }}
      m_raGrid={
        <WxGridView
          grid={dlg.m_raGrid}
          tricks={dlg.m_tricks}
          rowLabels={false}
          flexCol={COL_NAME}
          ariaLabel={_('Target areas')}
          renderCell={(aRow, aCol) => {
            if (aCol !== COL_DETAILS) return null;
            const entry = dlg.m_targetRAs[aRow];
            // GRID_CELL_ICON_RENDERER( KiBitmapBundleDef( BITMAPS::help, 16 ) ).
            return entry && !entry.m_isOK && entry.m_mismatchReasons.length > 0 ? (
              <img src={KiBitmapBundle(BITMAPS.help)} width="16" height="16" alt={_('Details')} />
            ) : null;
          }}
        />
      }
      m_cbCopyPlacement={check('m_cbCopyPlacement')}
      m_cbCopyRouting={check('m_cbCopyRouting')}
      m_cbCopyOnlyConnectedRouting={check('m_cbCopyOnlyConnectedRouting')}
      m_cbCopyOtherItems={check('m_cbCopyOtherItems')}
      m_cbGroupItems={check('m_cbGroupItems')}
      m_cbIncludeLockedComponents={check('m_cbIncludeLockedComponents')}
      onOK={() => {
        if (dlg.TransferDataFromWindow()) onClose(true);
      }}
      onCancel={() => onClose(false)}
    />
  );
}
