// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CREATE_ARRAY_BASE` (pcbnew/dialogs/dialog_create_array_base.cpp): the sizer tree, Add()
 * for Add(). The members are props; the behaviour is DIALOG_CREATE_ARRAY's
 * (dialog_create_array.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { TextCtrlEval } from '@ziroeda/common/widgets/text_ctrl_eval.js';
import {
  Button,
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  RadioBox,
  RadioButton,
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
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A text control: its text, Enable() and wxEVT_TEXT. */
export interface ENTRY {
  value: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
  onBlur?: () => void;
}

/** A wxRadioBox: its selection, Enable() and wxEVT_RADIOBOX. */
export interface RADIOBOX {
  selection: number;
  enabled?: boolean;
  onChange: (aIndex: number) => void;
}

/** A radio button pair or group member. */
export interface RADIO {
  value: boolean;
  onSelect: () => void;
}

export interface DIALOG_CREATE_ARRAY_BASE_PROPS {
  /** The window's Enable(): false while PCB_PICKER_TOOL picks a center for it. */
  enabled: boolean;
  /** `m_gridTypeNotebook`'s selection. */
  page: number;
  onPage: (aPage: number) => void;
  m_entryNx: ENTRY;
  m_entryNy: ENTRY;
  /** UNIT_BINDER texts, and the units each shows. */
  m_entryDx: ENTRY;
  m_entryDy: ENTRY;
  m_entryOffsetX: ENTRY;
  m_entryOffsetY: ENTRY;
  units: string;
  m_entryStagger: ENTRY;
  m_staggerRows: RADIO;
  m_staggerCols: RADIO;
  m_rbItemsRemainInPlace: RADIO;
  m_rbCentreOnSource: RADIO;
  /** `m_gridPadNumberingPanel->Show()`: the footprint editor's pad numbering. */
  gridPadNumberingShown: boolean;
  m_cbRenumberPads: CHECK;
  m_radioBoxGridNumberingAxis: RADIOBOX;
  m_checkBoxGridReverseNumbering: CHECK;
  m_rbGridStartNumberingOpt: RADIOBOX;
  m_radioBoxGridNumberingScheme: RADIOBOX;
  numberingChoices: readonly string[];
  m_choicePriAxisNumbering: CHOICE;
  m_choiceSecAxisNumbering: CHOICE;
  m_entryGridPriNumberingOffset: ENTRY;
  m_entryGridSecNumberingOffset: ENTRY;
  m_entryGridPriNumberingStep: ENTRY;
  m_entryGridSecNumberingStep: ENTRY;
  /** The labels setControlEnablement greys with their controls. */
  priAxisLabelEnabled: boolean;
  secAxisLabelEnabled: boolean;
  numberingOffsetLabelEnabled: boolean;
  numberingStepLabelEnabled: boolean;
  m_entryCentreX: ENTRY;
  m_entryCentreY: ENTRY;
  onSelectCenterPoint: () => void;
  onSelectCenterItem: () => void;
  m_checkBoxFullCircle: CHECK;
  m_rbCircDirection: RADIOBOX;
  m_entryCircAngle: ENTRY;
  m_entryCircCount: ENTRY;
  m_entryCircOffset: ENTRY;
  m_entryRotateItemsCb: CHECK;
  circPadNumberingShown: boolean;
  m_rbCircStartNumberingOpt: RADIOBOX;
  m_choiceCircNumbering: CHOICE;
  m_entryCircNumberingStart: ENTRY;
  m_entryCircNumberingStep: ENTRY;
  m_radioBtnDuplicateSelection: RADIO;
  m_radioBtnArrangeSelection: RADIO;
  /** `m_footprintReannotatePanel->Show()`. */
  footprintReannotateShown: boolean;
  m_radioBtnKeepRefs: RADIO;
  m_radioBtnUniqueRefs: RADIO;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
const REFS_TIP = _HKI(
  'This can conflict with reference designators in the schematic that have not yet been synchronized with the board.',
);

export function DIALOG_CREATE_ARRAY_BASE(p: DIALOG_CREATE_ARRAY_BASE_PROPS): JSX.Element {
  const text = (aLabel: string, e: ENTRY, aTitle?: string) => (
    <TextCtrl
      value={e.value}
      onChange={e.onChange}
      onBlur={e.onBlur}
      disabled={e.enabled === false}
      title={aTitle}
      ariaLabel={aLabel.replace(/:$/, '')}
    />
  );
  const evalText = (aLabel: string, e: ENTRY, aTitle?: string) => (
    <TextCtrlEval
      value={e.value}
      onChange={e.onChange}
      disabled={e.enabled === false}
      title={aTitle}
      ariaLabel={aLabel.replace(/:$/, '')}
    />
  );
  const radio = (aLabel: string, aGroup: string, r: RADIO, aTitle?: string) => (
    <RadioButton
      label={aLabel}
      name={aGroup}
      checked={r.value}
      onChange={r.onSelect}
      title={aTitle}
    />
  );
  // A UNIT_BINDER row of a wxFlexGridSizer( 0, 3, 5, 5 ): label, text, units.
  const unitRow = (
    aLabel: string,
    e: ENTRY,
    aUnits: string,
    aTitle?: string,
    aCtrlFlag = CV | wxEXPAND,
  ) => (
    <>
      <SizerItem flag={CV | wxLEFT} border={5}>
        <StaticText label={aLabel} title={aTitle} disabled={e.enabled === false} />
      </SizerItem>
      <SizerItem flag={aCtrlFlag} border={5}>
        {text(aLabel, e)}
      </SizerItem>
      <SizerItem flag={CV | wxRIGHT} border={5}>
        <StaticText label={aUnits} disabled={e.enabled === false} />
      </SizerItem>
    </>
  );

  const gridPage = (
    // bSizerGridArray
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* bSizerGridLeft */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={10}>
            <StaticBoxSizer label={_('Grid Array Size')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                {/* fgSizerGridSize = wxFlexGridSizer( 0, 2, 5, 5 ) */}
                <FlexGridSizer cols={2} vgap={5} hgap={5} growableCols={[1]}>
                  <SizerItem flag={CV} border={5}>
                    <StaticText label={_('Horizontal count:')} title={_('Number of columns')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5} minSize={[60, -1]}>
                    {evalText('Horizontal count', p.m_entryNx)}
                  </SizerItem>
                  <SizerItem flag={CV} border={5}>
                    <StaticText label={_('Vertical count:')} title={_('Number of rows')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5} minSize={[60, -1]}>
                    {evalText('Vertical count', p.m_entryNy, _('Number of rows'))}
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={10}>
            <StaticBoxSizer label={_('Items Spacing')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                {/* fgSizerItemSpacing = wxFlexGridSizer( 0, 3, 5, 5 ) */}
                <FlexGridSizer cols={3} vgap={5} hgap={5} growableCols={[1]}>
                  {unitRow(
                    _('Horizontal spacing:'),
                    p.m_entryDx,
                    p.units,
                    _('Distance between columns'),
                  )}
                  {unitRow(
                    _('Vertical spacing:'),
                    p.m_entryDy,
                    p.units,
                    _('Distance between rows'),
                  )}
                  <Spacer width={0} height={5} proportion={1} flag={wxEXPAND} border={5} />
                  <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                  <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                  {unitRow(
                    _('Horizontal offset:'),
                    p.m_entryOffsetX,
                    p.units,
                    _('Offset added to the next row position.'),
                  )}
                  {unitRow(
                    _('Vertical offset:'),
                    p.m_entryOffsetY,
                    p.units,
                    _('Offset added to the next column position'),
                  )}
                </FlexGridSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={10}>
            <StaticBoxSizer label={_('Stagger Settings')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                {/* bSizerStaggerset */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={CV | wxLEFT} border={5}>
                    <StaticText
                      label={_('Stagger:')}
                      title={_('Value -1,  0 or 1 disable this option.')}
                    />
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxRIGHT | wxLEFT | wxEXPAND} border={5}>
                    {evalText('Stagger', p.m_entryStagger)}
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                {radio(_('Rows'), 'm_stagger', p.m_staggerRows)}
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                {radio(_('Columns'), 'm_stagger', p.m_staggerCols)}
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={10}>
            <StaticBoxSizer label={_('Grid Position')} orient={wxVERTICAL}>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                {radio(
                  _('Source items remain in place'),
                  'm_gridPosition',
                  p.m_rbItemsRemainInPlace,
                )}
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                {radio(_('Centre on source items'), 'm_gridPosition', p.m_rbCentreOnSource)}
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND} border={5} shown={p.gridPadNumberingShown}>
        {/* m_gridPadNumberingPanel > bSizer15 */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
            {/* m_gridPadNumberingSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxALL} border={5}>
                <CheckBox label={_('Renumber pads')} check={p.m_cbRenumberPads} />
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <RadioBox
                  label={_('Numbering Direction')}
                  choices={[_('Horizontal, then vertical'), _('Vertical, then horizontal')]}
                  selection={p.m_radioBoxGridNumberingAxis.selection}
                  disabled={p.m_radioBoxGridNumberingAxis.enabled === false}
                  onChange={p.m_radioBoxGridNumberingAxis.onChange}
                />
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <CheckBox
                  label={_('Reverse numbering on alternate rows/columns')}
                  check={p.m_checkBoxGridReverseNumbering}
                />
              </SizerItem>
              <SizerItem flag={wxALL | wxEXPAND} border={5}>
                <RadioBox
                  label={_('Initial Pad Number')}
                  choices={[_('Use first free number'), _('From start value')]}
                  selection={p.m_rbGridStartNumberingOpt.selection}
                  disabled={p.m_rbGridStartNumberingOpt.enabled === false}
                  onChange={p.m_rbGridStartNumberingOpt.onChange}
                />
              </SizerItem>
              <SizerItem flag={wxALL | wxEXPAND} border={5}>
                <RadioBox
                  label={_('Pad Numbering Scheme')}
                  choices={[_('Continuous (1, 2, 3...)'), _('Coordinate (A1, A2, ... B1, ...)')]}
                  selection={p.m_radioBoxGridNumberingScheme.selection}
                  disabled={p.m_radioBoxGridNumberingScheme.enabled === false}
                  onChange={p.m_radioBoxGridNumberingScheme.onChange}
                />
              </SizerItem>
              <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                <StaticText
                  label={_('Primary axis numbering:')}
                  disabled={!p.priAxisLabelEnabled}
                />
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <Choice
                  choices={p.numberingChoices}
                  choice={p.m_choicePriAxisNumbering}
                  ariaLabel="Primary axis numbering"
                />
              </SizerItem>
              <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                <StaticText
                  label={_('Secondary axis numbering:')}
                  disabled={!p.secAxisLabelEnabled}
                />
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <Choice
                  choices={p.numberingChoices}
                  choice={p.m_choiceSecAxisNumbering}
                  ariaLabel="Secondary axis numbering"
                />
              </SizerItem>
              <SizerItem flag={wxEXPAND} border={5}>
                {/* fgSizer1 = wxFlexGridSizer( 2, 3, 0, 0 ) */}
                <FlexGridSizer cols={3} growableCols={[0]}>
                  <SizerItem proportion={1} flag={CV | wxALL} border={5}>
                    <StaticText
                      label={_('Pad numbering start:')}
                      disabled={!p.numberingOffsetLabelEnabled}
                    />
                  </SizerItem>
                  <SizerItem flag={wxALL} border={5} minSize={[72, -1]}>
                    {text('Primary numbering start', p.m_entryGridPriNumberingOffset)}
                  </SizerItem>
                  <SizerItem flag={wxALL} border={5} minSize={[72, -1]}>
                    {text('Secondary numbering start', p.m_entryGridSecNumberingOffset)}
                  </SizerItem>
                  <SizerItem proportion={1} flag={CV | wxALL} border={5}>
                    <StaticText
                      label={_('Pad numbering increment:')}
                      disabled={!p.numberingStepLabelEnabled}
                    />
                  </SizerItem>
                  <SizerItem flag={wxALL} border={5} minSize={[72, -1]}>
                    {text('Primary numbering increment', p.m_entryGridPriNumberingStep)}
                  </SizerItem>
                  <SizerItem flag={wxALL} border={5} minSize={[72, -1]}>
                    {text('Secondary numbering increment', p.m_entryGridSecNumberingStep)}
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const circularPage = (
    // bSizer4
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* bSizerCircLeft */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={10}>
            <StaticBoxSizer label={_('Center position')} orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxLEFT} border={25}>
                {/* fgSizerArrayPrms = wxFlexGridSizer( 0, 3, 5, 5 ) */}
                <FlexGridSizer cols={3} vgap={5} hgap={5} growableCols={[1]}>
                  <SizerItem flag={CV} border={5}>
                    <StaticText label={_('Center pos X:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxTOP} border={5}>
                    {text('Center pos X', p.m_entryCentreX)}
                  </SizerItem>
                  <SizerItem flag={CV | wxRIGHT} border={5}>
                    <StaticText label={p.units} />
                  </SizerItem>
                  <SizerItem flag={CV} border={5}>
                    <StaticText label={_('Center pos Y:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {text('Center pos Y', p.m_entryCentreY)}
                  </SizerItem>
                  <SizerItem flag={CV | wxRIGHT} border={5}>
                    <StaticText label={p.units} />
                  </SizerItem>
                  <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                </FlexGridSizer>
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                {/* bSizer12 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem proportion={1} flag={wxALL} border={5}>
                    <Button label={_('Select Point...')} onClick={p.onSelectCenterPoint} />
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxALL} border={5}>
                    <Button label={_('Select Item...')} onClick={p.onSelectCenterItem} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={10}>
            <StaticBoxSizer label={_('Duplication Settings')} orient={wxVERTICAL}>
              <SizerItem flag={wxALL} border={5}>
                <CheckBox label={_('Full circle')} check={p.m_checkBoxFullCircle} />
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
                <RadioBox
                  label={_('Direction')}
                  choices={[_('Clockwise'), _('Anti-clockwise')]}
                  selection={p.m_rbCircDirection.selection}
                  onChange={p.m_rbCircDirection.onChange}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxEXPAND} border={5}>
                {/* fgSizerDupPrms = wxFlexGridSizer( 0, 3, 5, 5 ) */}
                <FlexGridSizer cols={3} vgap={5} hgap={5} growableCols={[1]}>
                  <SizerItem flag={CV | wxLEFT} border={5}>
                    <StaticText
                      label={_('Angle between items:')}
                      disabled={p.m_entryCircAngle.enabled === false}
                    />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {text(
                      'Angle between items',
                      p.m_entryCircAngle,
                      _(
                        'Positive angles represent an anti-clockwise rotation. An angle of 0 will produce a full circle divided evenly into "Count" portions.',
                      ),
                    )}
                  </SizerItem>
                  <SizerItem flag={CV | wxRIGHT} border={5}>
                    <StaticText label={_('deg')} disabled={p.m_entryCircAngle.enabled === false} />
                  </SizerItem>
                  <SizerItem flag={CV | wxLEFT} border={5}>
                    <StaticText label={_('Item count:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {evalText('Item count', p.m_entryCircCount, _('How many items in the array.'))}
                  </SizerItem>
                  <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                  <SizerItem flag={CV | wxLEFT} border={5}>
                    <StaticText label={_('First item angle:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {evalText(
                      'First item angle',
                      p.m_entryCircOffset,
                      _('Angle offset of the first item in the array'),
                    )}
                  </SizerItem>
                  <SizerItem flag={CV} border={5}>
                    <StaticText label={_('deg')} />
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <CheckBox
                  label={_('Rotate items')}
                  check={p.m_entryRotateItemsCb}
                  title={_(
                    'Rotate the item as well as move it - multi-selections will be rotated together',
                  )}
                />
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxALL} border={5} shown={p.circPadNumberingShown}>
        {/* m_circularPadNumberingPanel > bSizer13 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <Spacer width={10} height={0} flag={wxEXPAND} border={5} />
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            <StaticBoxSizer label={_('Numbering Options')} orient={wxVERTICAL}>
              <SizerItem flag={wxALL | wxEXPAND} border={5}>
                <RadioBox
                  label={_('Initial Pad Number:')}
                  choices={[_('Use first free number'), _('From start value')]}
                  selection={p.m_rbCircStartNumberingOpt.selection}
                  disabled={p.m_rbCircStartNumberingOpt.enabled === false}
                  onChange={p.m_rbCircStartNumberingOpt.onChange}
                />
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <StaticText label={_('Pad Numbering:')} />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
                <Choice
                  choices={p.numberingChoices}
                  choice={p.m_choiceCircNumbering}
                  ariaLabel="Pad Numbering"
                />
              </SizerItem>
              <SizerItem flag={wxEXPAND} border={5}>
                {/* fgSizer2 = wxFlexGridSizer( 0, 2, 0, 0 ) */}
                <FlexGridSizer cols={2} growableCols={[0]}>
                  <SizerItem flag={CV | wxALL} border={5}>
                    <StaticText label={_('Pad numbering start:')} />
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxALL} border={5}>
                    {text('Circular numbering start', p.m_entryCircNumberingStart)}
                  </SizerItem>
                  <SizerItem flag={CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    <StaticText label={_('Pad numbering increment:')} />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    {text('Circular numbering increment', p.m_entryCircNumberingStep)}
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={_('Create Array')} onClose={p.onCancel} enabled={p.enabled}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* bSizer7 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={10}>
              <Notebook
                pages={[
                  { text: _('Grid Array'), content: gridPage },
                  { text: _('Circular Array'), content: circularPage },
                ]}
                selection={p.page}
                onPageChanged={p.onPage}
              />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              {/* m_optionsPanel > bSizer8 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <StaticBoxSizer label={_('Item Source')} orient={wxVERTICAL}>
                    <SizerItem flag={wxALL} border={5}>
                      {radio(
                        _('Duplicate selection'),
                        'm_itemSource',
                        p.m_radioBtnDuplicateSelection,
                      )}
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                      {radio(
                        _('Arrange selection'),
                        'm_itemSource',
                        p.m_radioBtnArrangeSelection,
                        REFS_TIP,
                      )}
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxALL} border={5} shown={p.footprintReannotateShown}>
                  <StaticBoxSizer label={_('Footprint Annotation')} orient={wxVERTICAL}>
                    <SizerItem flag={wxALL} border={5}>
                      {radio(
                        _('Keep existing reference designators'),
                        'm_annotation',
                        p.m_radioBtnKeepRefs,
                      )}
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                      {radio(
                        _('Assign unique reference designators'),
                        'm_annotation',
                        p.m_radioBtnUniqueRefs,
                        REFS_TIP,
                      )}
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
