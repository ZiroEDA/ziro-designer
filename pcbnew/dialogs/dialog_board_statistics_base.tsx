// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_BOARD_STATISTICS_BASE` (pcbnew/dialogs/dialog_board_statistics_base.cpp): the sizer
 * tree, Add() for Add(). The five grids are handed in; the behaviour is DIALOG_BOARD_STATISTICS's
 * (dialog_board_statistics.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Button, type CHECK, CheckBox, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_BOARD_STATISTICS_BASE_PROPS {
  page: number;
  onPage: (aPage: number) => void;
  m_gridComponents: ReactNode;
  m_gridPads: ReactNode;
  m_gridBoard: ReactNode;
  m_gridVias: ReactNode;
  m_checkBoxSubtractHoles: CHECK;
  m_checkBoxSubtractHolesFromCopper: CHECK;
  m_checkBoxExcludeComponentsNoPins: CHECK;
  m_gridDrills: ReactNode;
  onSaveReport: () => void;
  onClose: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_BOARD_STATISTICS_BASE(p: DIALOG_BOARD_STATISTICS_BASE_PROPS): JSX.Element {
  // A titled grid: the label (SetFont( KIUI::GetSmallInfoFont( this ) )), a 2 px spacer, the grid.
  const titled = (aLabel: string, aGrid: ReactNode, aGridFlag: number) => (
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
        <StaticText label={aLabel} font="smallInfo" />
      </SizerItem>
      <Spacer width={0} height={2} border={5} />
      <SizerItem proportion={1} flag={aGridFlag} border={5}>
        {aGrid}
      </SizerItem>
    </BoxSizer>
  );

  const general = (
    // bGeneralPanelSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* fgSizerContents = wxFlexGridSizer( 0, 2, 0, 0 ) */}
        <FlexGridSizer cols={2} growableCols={[0, 1]} growableRows={[0, 1]}>
          <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
            {titled(_('Components'), p.m_gridComponents, wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT)}
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxLEFT} border={5}>
            {titled(_('Pads'), p.m_gridPads, wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT)}
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
            {titled(_('Board'), p.m_gridBoard, wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT)}
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
            {titled(_('Vias'), p.m_gridVias, wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT)}
          </SizerItem>
        </FlexGridSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxALL} border={5}>
        {/* gOptionsSizer = wxGridSizer( 0, 1, 4, 0 ) */}
        <FlexGridSizer cols={1} vgap={4}>
          <SizerItem flag={wxEXPAND | wxRIGHT} border={4}>
            <CheckBox
              label={_('Subtract holes from board area')}
              check={p.m_checkBoxSubtractHoles}
            />
          </SizerItem>
          <SizerItem flag={wxRIGHT} border={5}>
            <CheckBox
              label={_('Subtract holes from copper areas')}
              check={p.m_checkBoxSubtractHolesFromCopper}
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxRIGHT} border={5}>
            <CheckBox
              label={_('Exclude footprints with no pads')}
              check={p.m_checkBoxExcludeComponentsNoPins}
            />
          </SizerItem>
        </FlexGridSizer>
      </SizerItem>
    </BoxSizer>
  );

  const drills = (
    // bDrillsSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
        {p.m_gridDrills}
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={_('Board Statistics')} onClose={p.onClose}>
      {/* bMainBoxSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          <Notebook
            pages={[
              { text: _('General'), content: general },
              { text: _('Drill Holes'), content: drills },
            ]}
            selection={p.page}
            onPageChanged={p.onPage}
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxALL} border={15}>
              <Button label={_('Generate Report File...')} onClick={p.onSaveReport} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxBOTTOM | wxLEFT | wxRIGHT | wxTOP | CV} border={5}>
              {/* m_sdbControlSizer: wxID_CANCEL alone, SetLabel( _( "Close" ) ) */}
              <StdDialogButtonSizer cancelLabel={_('Close')} onCancel={p.onClose} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
