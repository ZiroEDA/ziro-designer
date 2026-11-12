// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SCH_FIND_BASE` (eeschema/dialogs/dialog_sch_find_base.cpp): the sizer tree, Add() for
 * Add(). The base hides the replace row, the Direction radios, Replace matches in reference
 * designators and the two Replace buttons; DIALOG_SCH_FIND shows what its mode and frame want.
 */
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { TextCombo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  type CHECK,
  CheckBox,
  HyperlinkCtrl,
  RadioButton,
  StaticLine,
  StaticText,
} from '@ziroeda/wx/controls.js';
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
import { BoxSizer, FlexGridSizer, GridBagSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A shown/hidden check member. */
export interface SHOWN_CHECK extends CHECK {
  shown: boolean;
}

export interface DIALOG_SCH_FIND_BASE_PROPS {
  /** "Find" or "Find and Replace" (wxFR_REPLACEDIALOG). */
  title: string;
  m_comboFind: string;
  comboFindChoices: readonly string[];
  onComboFind: (aText: string) => void;
  /** The replace row: m_staticReplace and m_comboReplace, shown in replace mode. */
  replaceShown: boolean;
  m_comboReplace: string;
  comboReplaceChoices: readonly string[];
  onComboReplace: (aText: string) => void;
  m_checkMatchCase: CHECK;
  m_checkWholeWord: CHECK;
  m_checkRegexMatch: CHECK;
  m_cbSearchPins: SHOWN_CHECK;
  m_cbSearchNetNames: SHOWN_CHECK;
  m_cbSearchHiddenFields: CHECK;
  m_cbCurrentSheetOnly: SHOWN_CHECK;
  m_cbSelectedOnly: CHECK;
  m_cbReplaceReferences: SHOWN_CHECK;
  onFind: () => void;
  m_buttonReplace: { shown: boolean; enabled: boolean; onClick: () => void };
  m_buttonReplaceAll: { shown: boolean; enabled: boolean; onClick: () => void };
  /** m_staticline1 and m_searchPanelLink (both hidden in the symbol editor). */
  searchPanelLinkShown: boolean;
  searchPanelLinkLabel: string;
  onShowSearchPanel: () => void;
  onCharHook: (aEvent: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCancel: () => void;
}

function Check({ label, c }: { label: string; c: CHECK }): JSX.Element {
  return <CheckBox label={label} check={c} />;
}

export function DIALOG_SCH_FIND_BASE(p: DIALOG_SCH_FIND_BASE_PROPS): JSX.Element {
  // gbSizer2's items are all added wxBOTTOM|wxRIGHT|wxLEFT, 5.
  const opt = wxBOTTOM | wxRIGHT | wxLEFT;

  return (
    <DialogShim title={p.title} onClose={p.onCancel} modeless onCharHook={p.onCharHook}>
      {/* mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* topSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              {/* leftSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  {/* leftGridSizer = wxFlexGridSizer( 3, 2, 3, 3 ), AddGrowableCol( 1 ) */}
                  <FlexGridSizer cols={2} vgap={3} hgap={3} growableCols={[1]}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={6}>
                      <StaticText label={_('Search for:')} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND} border={6} minSize={[220, -1]}>
                      {/* m_comboFind, wxTE_PROCESS_ENTER: OnSearchForEnter is OnFind */}
                      <TextCombo
                        title={_('Text with optional wildcards')}
                        value={p.m_comboFind}
                        options={p.comboFindChoices}
                        autoFocus
                        onChange={p.onComboFind}
                        onEnter={p.onFind}
                        ariaLabel={_('Search for')}
                      />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
                      border={5}
                      shown={p.replaceShown}
                    >
                      <StaticText label={_('Replace with:')} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND} border={5} shown={p.replaceShown}>
                      {/* m_comboReplace: OnReplaceWithEnter is OnFind too */}
                      <TextCombo
                        value={p.m_comboReplace}
                        options={p.comboReplaceChoices}
                        onChange={p.onComboReplace}
                        onEnter={p.onFind}
                        ariaLabel={_('Replace with')}
                      />
                    </SizerItem>
                    <SizerItem flag={0} border={5} shown={false}>
                      {/* m_staticDirection->Hide() */}
                      <StaticText label={_('Direction:')} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5} shown={false}>
                      {/* directionSizer: m_radioForward / m_radioBackward, both Hide() */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxALL} border={3}>
                          <RadioButton
                            label={_('Forward')}
                            name="find-dir"
                            checked
                            onChange={() => {}}
                          />
                        </SizerItem>
                        <SizerItem flag={wxALL} border={3}>
                          <RadioButton
                            label={_('Backward')}
                            name="find-dir"
                            checked={false}
                            onChange={() => {}}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
                  {/* gbSizer2 = wxGridBagSizer( 0, 20 ), SetEmptyCellSize( wxSize( -1,8 ) ) */}
                  <GridBagSizer vgap={0} hgap={20} emptyCellSize={[-1, 8]}>
                    <SizerItem pos={[0, 0]} span={[1, 1]} flag={opt | wxEXPAND} border={5}>
                      <Check label={_('Match case')} c={p.m_checkMatchCase} />
                    </SizerItem>
                    <SizerItem pos={[0, 1]} span={[1, 1]} flag={opt | wxEXPAND} border={5}>
                      <Check label={_('Whole words only')} c={p.m_checkWholeWord} />
                    </SizerItem>
                    <SizerItem pos={[0, 2]} span={[1, 1]} flag={opt | wxEXPAND} border={5}>
                      <Check label={_('Regular Expression')} c={p.m_checkRegexMatch} />
                    </SizerItem>
                    <SizerItem
                      pos={[2, 0]}
                      span={[1, 2]}
                      flag={opt}
                      border={5}
                      shown={p.m_cbSearchPins.shown}
                    >
                      <Check label={_('Search pin names and numbers')} c={p.m_cbSearchPins} />
                    </SizerItem>
                    <SizerItem pos={[3, 0]} span={[1, 3]} flag={opt} border={5}>
                      <Check label={_('Include hidden fields')} c={p.m_cbSearchHiddenFields} />
                    </SizerItem>
                    <SizerItem
                      pos={[4, 0]}
                      span={[1, 3]}
                      flag={opt}
                      border={5}
                      shown={p.m_cbCurrentSheetOnly.shown}
                    >
                      <Check
                        label={_('Search the current sheet only')}
                        c={p.m_cbCurrentSheetOnly}
                      />
                    </SizerItem>
                    <SizerItem pos={[5, 0]} span={[1, 3]} flag={opt} border={5}>
                      <Check
                        label={_('Search the current selection only')}
                        c={p.m_cbSelectedOnly}
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[6, 0]}
                      span={[1, 3]}
                      flag={opt}
                      border={5}
                      shown={p.m_cbReplaceReferences.shown}
                    >
                      <Check
                        label={_('Replace matches in reference designators')}
                        c={p.m_cbReplaceReferences}
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[2, 2]}
                      span={[1, 1]}
                      flag={wxBOTTOM | wxLEFT | wxRIGHT}
                      border={5}
                      shown={p.m_cbSearchNetNames.shown}
                    >
                      <Check label={_('Search net names')} c={p.m_cbSearchNetNames} />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxALL | wxEXPAND} border={6}>
              {/* rightSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL | wxEXPAND} border={6}>
                  {/* m_buttonFind->SetDefault() */}
                  <Button label={_('Find')} isDefault onClick={p.onFind} />
                </SizerItem>
                <SizerItem
                  flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT}
                  border={6}
                  shown={p.m_buttonReplace.shown}
                >
                  <Button
                    label={_('Replace')}
                    disabled={!p.m_buttonReplace.enabled}
                    onClick={p.m_buttonReplace.onClick}
                  />
                </SizerItem>
                <SizerItem
                  flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT}
                  border={6}
                  shown={p.m_buttonReplaceAll.shown}
                >
                  <Button
                    label={_('Replace All')}
                    disabled={!p.m_buttonReplaceAll.enabled}
                    onClick={p.m_buttonReplaceAll.onClick}
                  />
                </SizerItem>
                <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT | wxEXPAND} border={6}>
                  {/* m_buttonCancel: wxID_CANCEL, "Close" */}
                  <Button label={_('Close')} onClick={p.onCancel} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
          {/* bSizer6 */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5} shown={p.searchPanelLinkShown}>
              <StaticLine />
            </SizerItem>
            <SizerItem
              flag={wxBOTTOM | wxRIGHT | wxLEFT | wxALIGN_RIGHT}
              border={5}
              shown={p.searchPanelLinkShown}
            >
              <HyperlinkCtrl label={p.searchPanelLinkLabel} onClick={p.onShowSearchPanel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
