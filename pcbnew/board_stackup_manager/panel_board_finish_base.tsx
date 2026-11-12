// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_BOARD_FINISH_BASE` (pcbnew/board_stackup_manager/panel_board_finish_base.cpp): the
 * plated edge, the copper finish (whose choices the class appends) and the edge card connectors.
 */
import type { JSX } from 'react';
import { type CHECK, type CHOICE, CheckBox, Choice, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxBOTTOM,
  wxEXPAND,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, FlexGridSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_BOARD_FINISH_BASE_PROPS {
  m_cbEgdesPlated: CHECK;
  /** m_choiceFinish: the class's Append( GetStandardCopperFinishes() ). */
  m_choiceFinish: CHOICE & { choices: readonly string[] };
  m_choiceEdgeConn: CHOICE;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function PANEL_SETUP_BOARD_FINISH_BASE(p: PANEL_SETUP_BOARD_FINISH_BASE_PROPS): JSX.Element {
  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
        {/* bMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <CheckBox label={_('Plated board edge')} check={p.m_cbEgdesPlated} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={10}>
            {/* fgSizer2 = wxFlexGridSizer( 0, 2, 5, 0 ) */}
            <FlexGridSizer cols={2} vgap={5}>
              <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                <StaticText label={_('Copper finish:')} />
              </SizerItem>
              <SizerItem flag={wxEXPAND | CV} border={2}>
                <Choice
                  choices={p.m_choiceFinish.choices}
                  choice={p.m_choiceFinish}
                  ariaLabel={_('Copper finish')}
                />
              </SizerItem>
              <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                <StaticText label={_('Edge card connectors:')} />
              </SizerItem>
              <SizerItem flag={wxEXPAND} border={2}>
                <Choice
                  choices={[_('None'), _('Yes'), _('Yes, bevelled')]}
                  choice={p.m_choiceEdgeConn}
                  ariaLabel={_('Edge card connectors')}
                  title={_('Options for edge card connectors.')}
                />
              </SizerItem>
            </FlexGridSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
