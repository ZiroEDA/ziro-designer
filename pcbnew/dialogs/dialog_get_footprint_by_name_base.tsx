// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GET_FOOTPRINT_BY_NAME_BASE` (pcbnew/dialogs/dialog_get_footprint_by_name_base.cpp): the
 * sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_GET_FOOTPRINT_BY_NAME's (dialog_get_footprint_by_name.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHOICE, Choice, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, GridBagSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_GET_FOOTPRINT_BY_NAME_BASE_PROPS {
  m_SearchTextCtrl: { value: string; onChange: (aText: string) => void };
  /** `m_multipleHint->Show()`. */
  multipleHintShown: boolean;
  m_choiceFpListChoices: readonly string[];
  m_choiceFpList: CHOICE;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_GET_FOOTPRINT_BY_NAME_BASE(
  p: DIALOG_GET_FOOTPRINT_BY_NAME_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Get and Move Footprint')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              {/* gbSizer1 = wxGridBagSizer( 0, 0 ), SetEmptyCellSize( wxSize( -1,12 ) ) */}
              <GridBagSizer vgap={0} hgap={0} emptyCellSize={[-1, 12]}>
                <SizerItem
                  pos={[0, 0]}
                  flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                  border={5}
                >
                  <StaticText label={_('Reference designator:')} />
                </SizerItem>
                <SizerItem
                  pos={[0, 1]}
                  flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                  border={5}
                  minSize={[200, -1]}
                >
                  {/* SetInitialFocus( m_SearchTextCtrl ) */}
                  <TextCtrl
                    value={p.m_SearchTextCtrl.value}
                    onChange={p.m_SearchTextCtrl.onChange}
                    ariaLabel="Reference designator"
                    autoFocus
                  />
                </SizerItem>
                <SizerItem
                  pos={[1, 0]}
                  span={[1, 2]}
                  flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP}
                  border={5}
                  shown={p.multipleHintShown}
                >
                  <StaticText
                    label={_(
                      '(specify multiple items separated by spaces for successive placement)',
                    )}
                    font="info"
                    italic
                  />
                </SizerItem>
                <SizerItem
                  pos={[3, 0]}
                  flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                  border={5}
                >
                  <StaticText label={_('Available footprints:')} />
                </SizerItem>
                <SizerItem
                  pos={[3, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxALL | wxEXPAND}
                  border={5}
                >
                  <Choice
                    choices={p.m_choiceFpListChoices}
                    choice={p.m_choiceFpList}
                    ariaLabel="Available footprints"
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
