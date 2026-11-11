// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_RULES_BASE` (pcbnew/dialogs/panel_setup_rules_base.cpp): the panel's sizer tree,
 * Add() for Add() - the title and Syntax help link, the rules editor (proportion 3) over the
 * Check-rule-syntax button and the errors report (proportion 1, at least 400 x 60). A Board Setup
 * page; the behaviour is PANEL_SETUP_RULES's (panel_setup_rules.tsx).
 */
import type { JSX, RefObject } from 'react';
import { WX_HTML_REPORT_BOX } from '@ziroeda/common/widgets/wx_html_report_box.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HyperlinkCtrl, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { StyledTextCtrl } from '@ziroeda/wx/stc.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_RULES_BASE_PROPS {
  onSyntaxHelp: () => void;
  m_textEditor: {
    value: string;
    onChange: (aText: string) => void;
    ref: RefObject<HTMLTextAreaElement>;
  };
  /** `OnCompile` */
  onCompile: () => void;
  /** m_errorsReport's lines. */
  m_errorsReport: readonly string[];
  /** `OnErrorLinkClicked` */
  onErrorLinkClicked: (aHref: string) => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function PANEL_SETUP_RULES_BASE(p: PANEL_SETUP_RULES_BASE_PROPS): JSX.Element {
  return (
    // bPanelSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bSizer4 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={CV | wxBOTTOM | wxLEFT | wxTOP} border={5}>
            <StaticText label={_('DRC Rules')} />
          </SizerItem>
          <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
            <HyperlinkCtrl
              label={_('Syntax help')}
              title={_('Show syntax help window')}
              onClick={p.onSyntaxHelp}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND} border={10}>
        {/* m_topMargin */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem proportion={3} flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
            <StyledTextCtrl
              lineNumbers
              ariaLabel={_('DRC Rules')}
              value={p.m_textEditor.value}
              onChange={p.m_textEditor.onChange}
              inputRef={p.m_textEditor.ref}
            />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* bSizer5 */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxTOP | wxBOTTOM} border={5}>
                {/* the class's SetBitmap( KiBitmapBundle( BITMAPS::drc ) ) */}
                <StdBitmapButton
                  bitmap="drc"
                  title={_('Check rule syntax')}
                  onClick={p.onCompile}
                />
              </SizerItem>
              <SizerItem
                proportion={1}
                flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP}
                border={5}
                minSize={[400, 60]}
              >
                <WX_HTML_REPORT_BOX
                  messages={p.m_errorsReport}
                  onLinkClicked={p.onErrorLinkClicked}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
