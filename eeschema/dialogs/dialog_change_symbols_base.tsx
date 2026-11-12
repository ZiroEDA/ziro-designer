// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CHANGE_SYMBOLS_BASE` (eeschema/dialogs/dialog_change_symbols_base.cpp): the sizer tree,
 * Add() for Add() - m_matchSizer's five radios and their entries, the static line, m_newIdSizer,
 * the Update/Reset Fields check list beside the Update Options columns, the message panel and the
 * standard pair. DIALOG_CHANGE_SYMBOLS's constructor relabels the controls for Change mode and
 * hides what that mode does not use; those labels and flags arrive as props.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine, Severity } from '@ziroeda/common/reporter.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { CheckListBox } from '@ziroeda/wx/checklst.js';
import {
  Button,
  type CHECK,
  CheckBox,
  RadioButton,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
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
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxTextCtrl with wxTE_PROCESS_ENTER, and the kill-focus handler the dialog connects. */
export interface MATCH_ENTRY {
  value: string;
  onChange: (aText: string) => void;
  onKillFocus: () => void;
}

/** A labelled checkbox whose label the derived constructor may change. */
export interface LABELLED_CHECK extends CHECK {
  label: string;
}

export interface DIALOG_CHANGE_SYMBOLS_BASE_PROPS {
  title: string;
  /** Which of m_matchAll .. m_matchById is set (CHANGE_SYMBOLS_MATCH). */
  match: number;
  onMatch: (aMatch: number) => void;
  /** The five radio labels, in the base's order. */
  matchLabels: readonly [string, string, string, string, string];
  /** `m_matchSizer->FindItem( m_matchAll )->Show( false )` in Change mode. */
  matchAllShown: boolean;
  /** `m_matchSizer->FindItem( m_matchBySelection )->Show( false )` with no symbol. */
  matchBySelectionShown: boolean;
  m_specifiedReference: MATCH_ENTRY;
  m_specifiedValue: MATCH_ENTRY;
  m_specifiedId: MATCH_ENTRY;
  onMatchIdBrowse: () => void;
  /** `m_newIdSizer->Show( false )` in Update mode. */
  newIdShown: boolean;
  m_newId: MATCH_ENTRY;
  onNewIdBrowse: () => void;
  /** "Update/Reset Fields", or Change mode's "Update Fields". */
  updateFieldsLabel: string;
  fields: readonly string[];
  fieldsChecked: readonly boolean[];
  onCheckField: (aIndex: number, aOn: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  m_removeExtraBox: LABELLED_CHECK;
  m_resetEmptyFields: LABELLED_CHECK;
  m_resetFieldText: LABELLED_CHECK;
  m_resetFieldVisibilities: LABELLED_CHECK;
  m_resetFieldEffects: LABELLED_CHECK;
  m_resetFieldPositions: LABELLED_CHECK;
  onCheckAll: () => void;
  m_resetPinTextVisibility: LABELLED_CHECK;
  m_resetAlternatePin: LABELLED_CHECK;
  m_resetAttributes: LABELLED_CHECK;
  m_resetCustomPower: LABELLED_CHECK;
  onUncheckAll: () => void;
  m_messagePanel: {
    lines: readonly ReportLine[];
    fileName: string;
    visibleSeverities: Severity;
    onVisibleSeveritiesChange: (aMask: Severity) => void;
  };
  /** SetupStandardButtons: wxID_OK is "Change" or "Update", wxID_CANCEL "Close". */
  okLabel: string;
  okDisabled: boolean;
  onOK: () => void;
  onCancel: () => void;
}

/** The two checkboxes the base adds checked and disabled. */
const FIXED_ON = { value: true, enabled: false, onChange: () => {} };

export function DIALOG_CHANGE_SYMBOLS_BASE(p: DIALOG_CHANGE_SYMBOLS_BASE_PROPS): JSX.Element {
  const radio = (i: number) => (
    <RadioButton
      label={p.matchLabels[i]!}
      name="change-symbols-match"
      checked={p.match === i}
      onChange={() => p.onMatch(i)}
    />
  );
  const entry = (e: MATCH_ENTRY, aLabel: string) => (
    <TextCtrl value={e.value} onChange={e.onChange} onBlur={e.onKillFocus} ariaLabel={aLabel} />
  );
  // bSizer8 / bSizer9's checkboxes: wxBOTTOM|wxRIGHT, 5 (the last of each column 10).
  const opt = (c: LABELLED_CHECK, aBorder = 5, aTitle?: string) => (
    <SizerItem flag={wxBOTTOM | wxRIGHT} border={aBorder}>
      <CheckBox label={c.label} title={aTitle} check={c} />
    </SizerItem>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* m_mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxLEFT} border={5}>
          {/* matchSizerMargins */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* m_matchSizer = wxGridBagSizer( 3, 0 ), AddGrowableCol( 1 ), AddGrowableRow( 1 ),
                  and the derived dialog's SetEmptyCellSize( wxSize( 0, 0 ) ) */}
              <GridBagSizer
                vgap={3}
                hgap={0}
                emptyCellSize={[0, 0]}
                growableCols={[1]}
                growableRows={[1]}
              >
                <SizerItem
                  pos={[0, 0]}
                  span={[1, 2]}
                  flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM}
                  border={5}
                  shown={p.matchAllShown}
                >
                  {radio(0)}
                </SizerItem>
                <SizerItem
                  pos={[1, 0]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM}
                  border={5}
                  shown={p.matchBySelectionShown}
                >
                  {radio(1)}
                </SizerItem>
                <SizerItem pos={[2, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={2}>
                  {radio(2)}
                </SizerItem>
                <SizerItem
                  pos={[2, 1]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxEXPAND}
                  border={5}
                  minSize={[200, -1]}
                >
                  {entry(p.m_specifiedReference, 'Reference designator')}
                </SizerItem>
                <SizerItem pos={[3, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  {radio(3)}
                </SizerItem>
                <SizerItem
                  pos={[3, 1]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT}
                  border={5}
                >
                  {entry(p.m_specifiedValue, 'Value')}
                </SizerItem>
                <SizerItem pos={[4, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={6}>
                  {radio(4)}
                </SizerItem>
                <SizerItem pos={[4, 1]} span={[1, 1]} flag={wxEXPAND | wxRIGHT} border={5}>
                  {/* bSizer10 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      {entry(p.m_specifiedId, 'Library identifier')}
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StdBitmapButton
                        bitmap="small_library"
                        title={_('Browse for symbol')}
                        tooltip={null}
                        onClick={p.onMatchIdBrowse}
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <Spacer width={0} height={8} flag={wxEXPAND} border={5} />
        <SizerItem flag={wxEXPAND | wxALL} border={4}>
          <StaticLine />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5} shown={p.newIdShown}>
          {/* m_newIdSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
              <StaticText label={_('New library identifier:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              {entry(p.m_newId, 'New library identifier')}
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <StdBitmapButton
                bitmap="small_library"
                title={_('Browse for new symbol')}
                tooltip={null}
                onClick={p.onNewIdBrowse}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizerUpdate */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={2} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
              {/* m_updateFieldsSizer */}
              <StaticBoxSizer label={p.updateFieldsLabel} orient={wxVERTICAL}>
                <SizerItem
                  proportion={1}
                  flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                  border={5}
                  minSize={[-1, 120]}
                >
                  {/* m_fieldsBox: wxCheckListBox, wxLB_NEEDED_SB */}
                  <CheckListBox
                    items={p.fields}
                    checked={p.fieldsChecked}
                    onCheck={p.onCheckField}
                    ariaLabel={p.updateFieldsLabel}
                  />
                </SizerItem>
                <SizerItem flag={wxEXPAND} border={5}>
                  {/* m_selBtnSizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <Button label={_('Select All')} onClick={p.onSelectAll} />
                    </SizerItem>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <Button label={_('Select None')} onClick={p.onSelectNone} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <Spacer width={5} height={0} flag={wxEXPAND} border={5} />
            <SizerItem proportion={4} flag={wxEXPAND | wxTOP | wxRIGHT} border={10}>
              {/* m_updateOptionsSizer, wxHORIZONTAL */}
              <StaticBoxSizer label={_('Update Options')} orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={10}>
                  {/* bSizer8 */}
                  <BoxSizer orient={wxVERTICAL}>
                    {opt(
                      p.m_removeExtraBox,
                      5,
                      _('Removes fields that do not occur in the original library symbols'),
                    )}
                    {opt(p.m_resetEmptyFields)}
                    <Spacer width={0} height={10} proportion={1} flag={wxEXPAND} border={5} />
                    {opt(p.m_resetFieldText)}
                    {opt(p.m_resetFieldVisibilities)}
                    {opt(p.m_resetFieldEffects)}
                    {opt(p.m_resetFieldPositions, 10)}
                    <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
                      <Button label={_('Check All Update Options')} onClick={p.onCheckAll} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* bSizer9 */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                      {/* updateShapeAndPins: SetValue( true ), Enable( false ) */}
                      <CheckBox label={_('Update symbol shape and pins')} check={FIXED_ON} />
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                      {/* updateKeywordsAndFootprintFilters: SetValue( true ), Enable( false ) */}
                      <CheckBox
                        label={_('Update keywords and footprint filters')}
                        check={FIXED_ON}
                      />
                    </SizerItem>
                    <Spacer width={0} height={10} proportion={1} flag={wxEXPAND} border={5} />
                    {opt(p.m_resetPinTextVisibility)}
                    {opt(p.m_resetAlternatePin)}
                    <Spacer width={0} height={10} proportion={1} flag={wxEXPAND} border={5} />
                    {opt(p.m_resetAttributes)}
                    {opt(p.m_resetCustomPower, 10)}
                    <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
                      <Button label={_('Uncheck All Update Options')} onClick={p.onUncheckAll} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* bSizer2 */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} minSize={[-1, 200]}>
              {/* m_messagePanel: WX_HTML_REPORT_PANEL, SetMinSize( wxSize( -1,200 ) ) */}
              <HtmlReportPanel
                label={_('Output Messages')}
                lines={p.m_messagePanel.lines}
                fileName={p.m_messagePanel.fileName}
                visibleSeverities={p.m_messagePanel.visibleSeverities}
                onVisibleSeveritiesChange={p.m_messagePanel.onVisibleSeveritiesChange}
                minHeight={0}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StdDialogButtonSizer
            okLabel={p.okLabel}
            cancelLabel={_('Close')}
            okDisabled={p.okDisabled}
            onOk={p.onOK}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
