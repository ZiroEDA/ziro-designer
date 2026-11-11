// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_ASSOCIATIONS` (pcbnew/dialogs/dialog_footprint_associations.cpp): Inspect >
 * Show Footprint Associations on the one selected footprint (BOARD_INSPECTION_TOOL::
 * ShowFootprintLinks). It only reads.
 *
 * The library grid is the FPID split into nickname and item name, the library row's description,
 * and a fresh library load's GetLibDescription(). The schematic grid is one row per KIID_PATH
 * segment of GetPath(), each third column asked of eeschema with MAIL_SCH_GET_ITEM - unless
 * Kiface().IsSingle() or no schematic frame is open, when it stays blank, as upstream.
 *
 * `DialogFootprintAssociations` below is the window, DIALOG_FOOTPRINT_ASSOCIATIONS_BASE over it.
 */
import { type JSX, useState } from 'react';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import { DIALOG_FOOTPRINT_ASSOCIATIONS_BASE } from './dialog_footprint_associations_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export class DIALOG_FOOTPRINT_ASSOCIATIONS {
  private readonly m_frame: PCB_EDIT_FRAME;
  private readonly m_footprint: FOOTPRINT;

  readonly m_gridLibrary = new WX_GRID();
  readonly m_gridSymbol = new WX_GRID();

  constructor(aFrame: PCB_EDIT_FRAME, aFootprint: FOOTPRINT) {
    this.m_frame = aFrame;
    this.m_footprint = aFootprint;

    // The base's CreateGrid( 2, 3 ) / CreateGrid( 1, 3 ), editing off.
    this.m_gridLibrary.CreateGrid(2, 3);
    this.m_gridSymbol.CreateGrid(1, 3);

    for (const grid of [this.m_gridLibrary, this.m_gridSymbol]) grid.EnableEditing(false);

    this.m_gridLibrary.SetCellValue(0, 0, _('Library: '));
    this.m_gridLibrary.SetCellValue(1, 0, _('Footprint: '));
  }

  TransferDataToWindow(): boolean {
    const fpID = this.m_footprint.GetFPID();
    const libName = fpID.GetLibNickname();
    const fpName = fpID.GetLibItemName();
    let libDesc = '';
    let fpDesc = '';

    const adapter = this.m_footprint.GetBoard()?.GetFootprintLibAdapter() ?? null;

    if (adapter) {
      const row = adapter.GetRow(libName);

      if (row) libDesc = row.Description?.() ?? '';

      try {
        const libFootprint = adapter.LoadFootprint(libName, fpName, true);

        if (libFootprint) fpDesc = libFootprint.GetLibDescription();
      } catch {
        // IO_ERROR: the library entry no longer loads; the description stays blank.
      }
    }

    this.m_gridLibrary.SetCellValue(0, 1, libName);
    this.m_gridLibrary.SetCellValue(0, 2, libDesc);
    this.m_gridLibrary.SetCellValue(1, 1, fpName);
    this.m_gridLibrary.SetCellValue(1, 2, fpDesc);

    const symbolPath = this.m_footprint.GetPath();

    // ClearRows()
    this.m_gridSymbol.DeleteRows(0, this.m_gridSymbol.GetNumberRows());

    for (let ii = 0; ii < symbolPath.length; ++ii) {
      this.m_gridSymbol.AppendRows();
      this.m_gridSymbol.SetCellValue(
        ii,
        0,
        ii === symbolPath.length - 1 ? _('Symbol:') : _('Sheet: '),
      );
      this.m_gridSymbol.SetCellValue(ii, 1, symbolPath[ii]!);

      const kiway = this.m_frame.Kiway();

      if (!this.m_frame.IsSingle() && kiway?.Player(FRAME_T.FRAME_SCH)) {
        const item = { value: symbolPath[ii]! };
        kiway.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_ITEM, item, this.m_frame);
        this.m_gridSymbol.SetCellValue(ii, 2, item.value);
      }
    }

    return true;
  }
}

/** `ShowModal()` of DIALOG_FOOTPRINT_ASSOCIATIONS: OK is its only button. */
export function DialogFootprintAssociations({
  dialog,
  onClose,
}: {
  dialog: DIALOG_FOOTPRINT_ASSOCIATIONS;
  onClose: () => void;
}): JSX.Element {
  // OnInitDialog -> TransferDataToWindow
  useState(() => dialog.TransferDataToWindow());

  return (
    <DIALOG_FOOTPRINT_ASSOCIATIONS_BASE
      m_gridLibrary={dialog.m_gridLibrary}
      m_gridSymbol={dialog.m_gridSymbol}
      onOK={onClose}
    />
  );
}
