// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FIND_BASE` (pcbnew/dialogs/dialog_find_base.cpp): the sizer tree, Add() for Add(). The
 * members are props; the behaviour is DIALOG_FIND's (dialog_find.tsx). The dialog is modeless.
 */
import type { JSX, KeyboardEvent } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { TextCombo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  type CHECK,
  CheckBox,
  HyperlinkCtrl,
  StaticLine,
  StaticText,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_LEFT,
  wxALIGN_TOP,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_FIND_BASE_PROPS {
  /** `m_searchCombo`: wxCB_DROPDOWN | wxTE_PROCESS_ENTER, its history in the list. */
  m_searchCombo: { value: string; history: readonly string[]; onChange: (aText: string) => void };
  onTextEnter: () => void;
  m_matchCase: CHECK;
  m_matchWords: CHECK;
  m_wildcards: CHECK;
  m_wrap: CHECK;
  m_includeReferences: CHECK;
  m_includeMarkers: CHECK;
  m_includeValues: CHECK;
  m_includeNets: CHECK;
  m_checkAllFields: CHECK;
  m_includeTexts: CHECK;
  onFindNextClick: () => void;
  onFindPreviousClick: () => void;
  onSearchAgainClick: () => void;
  OnCloseButtonClick: () => void;
  m_status: string;
  /** `m_searchPanelLink`'s label: "Show search panel", and the hotkey the dialog adds. */
  searchPanelLinkLabel: string;
  onShowSearchPanel: () => void;
  /** wxEVT_CHAR_HOOK, which the dialog binds for F3. */
  onCharHook: (aEvent: KeyboardEvent<HTMLDivElement>) => void;
}

export function DIALOG_FIND_BASE(p: DIALOG_FIND_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Find')} onClose={p.OnCloseButtonClick} modeless onCharHook={p.onCharHook}>
      {/* bSizer10 */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* topSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* leftSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* bSizer8 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                      <StaticText label={_('Search for:')} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                      <TextCombo
                        value={p.m_searchCombo.value}
                        options={p.m_searchCombo.history}
                        onChange={p.m_searchCombo.onChange}
                        onEnter={p.onTextEnter}
                        title={_('Text with optional wildcards')}
                        ariaLabel="Search for"
                        autoFocus
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={0}>
                  {/* sizerOptions */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALL} border={5}>
                      <CheckBox label={_('Match case')} check={p.m_matchCase} />
                    </SizerItem>
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxALL} border={5}>
                      <CheckBox label={_('Whole words only')} check={p.m_matchWords} />
                    </SizerItem>
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxALL} border={5}>
                      <CheckBox label={_('Wildcards')} check={p.m_wildcards} />
                    </SizerItem>
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxALL} border={5}>
                      <CheckBox label={_('Wrap')} check={p.m_wrap} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxEXPAND | wxALL} border={5}>
                  {/* sizerInclude = wxFlexGridSizer( 0, 2, 6, 20 ) */}
                  <FlexGridSizer cols={2} vgap={6} hgap={20}>
                    <SizerItem border={5}>
                      <CheckBox
                        label={_('Search footprint reference designators')}
                        check={p.m_includeReferences}
                      />
                    </SizerItem>
                    <SizerItem border={5}>
                      <CheckBox label={_('Search DRC markers')} check={p.m_includeMarkers} />
                    </SizerItem>
                    <SizerItem border={5}>
                      <CheckBox label={_('Search footprint values')} check={p.m_includeValues} />
                    </SizerItem>
                    <SizerItem border={5}>
                      <CheckBox label={_('Search net names')} check={p.m_includeNets} />
                    </SizerItem>
                    <SizerItem border={5}>
                      <CheckBox label={_('Include hidden fields')} check={p.m_checkAllFields} />
                    </SizerItem>
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem border={5}>
                      <CheckBox label={_('Search other text items')} check={p.m_includeTexts} />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem border={5}>
              {/* buttonSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALIGN_TOP | wxALL | wxEXPAND} border={5}>
                  {/* m_findNext->SetDefault() */}
                  <Button label={_('Find Next')} isDefault onClick={p.onFindNextClick} />
                </SizerItem>
                <SizerItem flag={wxALIGN_LEFT | wxALL | wxEXPAND} border={5}>
                  <Button label={_('Find Previous')} onClick={p.onFindPreviousClick} />
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <Button label={_('Restart Search')} onClick={p.onSearchAgainClick} />
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <Button label={_('Close')} onClick={p.OnCloseButtonClick} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StaticLine />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
          {/* sizerStatus */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={p.m_status} />
            </SizerItem>
            <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              <HyperlinkCtrl label={p.searchPanelLinkLabel} onClick={p.onShowSearchPanel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
