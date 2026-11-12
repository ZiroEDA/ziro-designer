// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EXCHANGE_FOOTPRINTS_BASE` (pcbnew/dialogs/dialog_exchange_footprints_base.cpp): the sizer
 * tree, Add() for Add(). The members are props; the behaviour is DIALOG_EXCHANGE_FOOTPRINTS's
 * (dialog_exchange_footprints.tsx), which hides rows and relabels for Change versus Update.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine, Severity } from '@ziroeda/common/reporter.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
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

/** A match radio with the text it labels. */
export interface MATCH_RADIO {
  label: string;
  value: boolean;
  shown?: boolean;
  onSelect: () => void;
}

export interface DIALOG_EXCHANGE_FOOTPRINTS_BASE_PROPS {
  title: string;
  m_matchAll: MATCH_RADIO;
  m_matchSelected: MATCH_RADIO;
  m_matchSpecifiedRef: MATCH_RADIO;
  m_specifiedRef: { value: string; onChange: (aText: string) => void };
  m_matchSpecifiedValue: MATCH_RADIO;
  m_specifiedValue: { value: string; onChange: (aText: string) => void };
  m_matchSpecifiedID: MATCH_RADIO;
  m_specifiedID: { value: string; onChange: (aText: string) => void };
  /** `m_changeSizer->Show()`: Change Footprints only. */
  changeShown: boolean;
  m_newID: { value: string; onChange: (aText: string) => void };
  /** ViewAndSelectFootprint, for m_specifiedIDBrowseButton (false) or m_newIDBrowseButton (true). */
  ViewAndSelectFootprint: (aNewId: boolean) => void;
  m_removeExtraBox: CHECK;
  m_resetTextItemLayers: { label: string; check: CHECK };
  m_resetTextItemEffects: { label: string; check: CHECK };
  m_resetTextItemPositions: { label: string; check: CHECK };
  m_resetTextItemContent: { label: string; check: CHECK };
  m_resetFabricationAttrs: { label: string; check: CHECK };
  m_resetClearanceOverrides: { label: string; check: CHECK };
  m_reset3DModels: { label: string; check: CHECK };
  onCheckAll: () => void;
  onUncheckAll: () => void;
  m_MessageWindow: {
    lines: readonly ReportLine[];
    severities: Severity;
    onSeveritiesChange: (aSeverities: Severity) => void;
  };
  okLabel: string;
  okEnabled: boolean;
  OnOKClicked: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
const BR = wxBOTTOM | wxRIGHT;

export function DIALOG_EXCHANGE_FOOTPRINTS_BASE(
  p: DIALOG_EXCHANGE_FOOTPRINTS_BASE_PROPS,
): JSX.Element {
  const radio = (r: MATCH_RADIO): JSX.Element => (
    <RadioButton label={r.label} name="m_matchMode" checked={r.value} onChange={r.onSelect} />
  );
  const option = (o: { label: string; check: CHECK }, aFlag = BR): JSX.Element => (
    <SizerItem flag={aFlag} border={5}>
      <CheckBox label={o.label} check={o.check} />
    </SizerItem>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* m_mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          {/* m_upperSizer = wxGridBagSizer( 0, 0 ) */}
          <GridBagSizer vgap={0} hgap={0} growableCols={[1]}>
            <SizerItem
              pos={[0, 0]}
              span={[1, 2]}
              flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT | CV}
              border={5}
              shown={p.m_matchAll.shown !== false}
            >
              {radio(p.m_matchAll)}
            </SizerItem>
            <SizerItem
              pos={[1, 0]}
              flag={wxTOP | wxBOTTOM | wxRIGHT | CV}
              border={5}
              shown={p.m_matchSelected.shown !== false}
            >
              {radio(p.m_matchSelected)}
            </SizerItem>
            <SizerItem pos={[2, 0]} flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT | CV} border={5}>
              {radio(p.m_matchSpecifiedRef)}
            </SizerItem>
            <SizerItem
              pos={[2, 1]}
              flag={wxEXPAND | wxTOP | wxBOTTOM}
              border={2}
              minSize={[200, -1]}
            >
              <TextCtrl
                value={p.m_specifiedRef.value}
                onChange={p.m_specifiedRef.onChange}
                ariaLabel="Reference designator"
              />
            </SizerItem>
            <SizerItem pos={[3, 0]} flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT | CV} border={5}>
              {radio(p.m_matchSpecifiedValue)}
            </SizerItem>
            <SizerItem pos={[3, 1]} flag={CV | wxEXPAND | wxTOP | wxBOTTOM} border={2}>
              <TextCtrl
                value={p.m_specifiedValue.value}
                onChange={p.m_specifiedValue.onChange}
                ariaLabel="Value"
              />
            </SizerItem>
            <SizerItem pos={[4, 0]} flag={CV | wxRIGHT} border={5}>
              {radio(p.m_matchSpecifiedID)}
            </SizerItem>
            <SizerItem pos={[4, 1]} flag={wxEXPAND | CV} border={5}>
              {/* bSizer7 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={CV} border={5}>
                  <TextCtrl
                    value={p.m_specifiedID.value}
                    onChange={p.m_specifiedID.onChange}
                    ariaLabel={_('Library id')}
                  />
                </SizerItem>
                <SizerItem flag={CV} border={2}>
                  <StdBitmapButton
                    bitmap="small_library"
                    title={_('Browse')}
                    tooltip={null}
                    onClick={() => p.ViewAndSelectFootprint(false)}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </GridBagSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={10}>
          {/* bSizer4 */}
          <BoxSizer orient={wxHORIZONTAL} />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5} shown={p.changeShown}>
          {/* m_changeSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={3}>
              <StaticLine />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
              {/* bSizer3 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('New footprint library id:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={CV} border={5} minSize={[500, -1]}>
                  <TextCtrl
                    value={p.m_newID.value}
                    onChange={p.m_newID.onChange}
                    ariaLabel={_('New footprint library id')}
                  />
                </SizerItem>
                <SizerItem flag={CV | wxRIGHT} border={5}>
                  <StdBitmapButton
                    bitmap="small_library"
                    title={_('Browse for the new footprint')}
                    tooltip={null}
                    onClick={() => p.ViewAndSelectFootprint(true)}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={10}>
          <StaticBoxSizer label={_('Update Options')} orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={10}>
              {/* bSizer5 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
                  <CheckBox
                    label={_('Remove text items if not in library footprint')}
                    check={p.m_removeExtraBox}
                    title={_('Removes fields that do not occur in the original library symbols')}
                  />
                </SizerItem>
                {option(p.m_resetTextItemLayers)}
                {option(p.m_resetTextItemEffects)}
                {option(p.m_resetTextItemPositions)}
                {option(p.m_resetTextItemContent)}
                <Spacer width={0} height={10} proportion={1} border={5} />
                <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT} border={5}>
                  <Button label={_('Check All Update Options')} onClick={p.onCheckAll} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizer6 */}
              <BoxSizer orient={wxVERTICAL}>
                {option(p.m_resetFabricationAttrs, wxTOP | wxBOTTOM | wxRIGHT)}
                {option(p.m_resetClearanceOverrides)}
                {option(p.m_reset3DModels)}
                <Spacer width={0} height={10} proportion={1} border={5} />
                <SizerItem flag={wxBOTTOM | wxEXPAND | wxRIGHT} border={5}>
                  <Button label={_('Uncheck All Update Options')} onClick={p.onUncheckAll} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem
          proportion={5}
          flag={wxEXPAND | wxRIGHT | wxLEFT}
          border={10}
          minSize={[-1, 208]}
        >
          <HtmlReportPanel
            lines={p.m_MessageWindow.lines}
            visibleSeverities={p.m_MessageWindow.severities}
            onVisibleSeveritiesChange={p.m_MessageWindow.onSeveritiesChange}
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StdDialogButtonSizer
            okLabel={p.okLabel}
            okDisabled={!p.okEnabled}
            onOk={p.OnOKClicked}
            cancelLabel={_('Close')}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
