// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FP_EDIT_PAD_TABLE_BASE` (pcbnew/dialogs/dialog_fp_edit_pad_table_base.cpp): the sizer tree,
 * Add() for Add(). The members are props; the behaviour is DIALOG_FP_EDIT_PAD_TABLE's
 * (dialog_fp_edit_pad_table.tsx).
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import type { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_RIGHT,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_FP_EDIT_PAD_TABLE_BASE_PROPS {
  title: string;
  m_pin_numbers_summary: { label: string; tooltip: string };
  m_pin_count: string;
  m_duplicate_pins: { label: string; tooltip: string };
  m_grid: WX_GRID;
  tricks: GRID_TRICKS;
  columnWidths: readonly number[];
  /** wxEVT_SIZE on m_grid: the pane whose width OnSize reads. */
  gridPaneRef: Ref<HTMLDivElement>;
  OnUpdateUI: () => void;
  onOK: () => void;
  OnCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_FP_EDIT_PAD_TABLE_BASE(p: DIALOG_FP_EDIT_PAD_TABLE_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.OnCancel}>
      {/* topSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
          {/* bSummarySizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxLEFT} border={5}>
              <StaticText label={_('Pad numbers:')} />
            </SizerItem>
            <SizerItem flag={wxRIGHT | wxLEFT | CV} border={5}>
              <StaticText
                label={p.m_pin_numbers_summary.label}
                title={p.m_pin_numbers_summary.tooltip || undefined}
                ellipsize
              />
            </SizerItem>
            <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxLEFT} border={10}>
              <StaticText label={_('Pad count:')} />
            </SizerItem>
            <SizerItem flag={wxRIGHT | wxLEFT | CV} border={5}>
              <StaticText label={p.m_pin_count} />
            </SizerItem>
            <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxLEFT} border={10}>
              <StaticText label={_('Duplicate pads:')} />
            </SizerItem>
            <SizerItem flag={wxRIGHT | wxLEFT | CV} border={5}>
              <StaticText
                label={p.m_duplicate_pins.label}
                title={p.m_duplicate_pins.tooltip || undefined}
                ellipsize
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} minSize={[800, 400]}>
          {/* m_grid = WX_GRID( …, wxSize( 800,400 ) ), no row labels */}
          <div className="ze-grid-pane" ref={p.gridPaneRef}>
            <WxGridView
              grid={p.m_grid}
              tricks={p.tricks}
              columns={p.columnWidths.map((width) => ({ width }))}
              ariaLabel="Pads"
              onUpdate={p.OnUpdateUI}
            />
          </div>
        </SizerItem>
        <SizerItem flag={wxALIGN_RIGHT | wxALL} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.OnCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
