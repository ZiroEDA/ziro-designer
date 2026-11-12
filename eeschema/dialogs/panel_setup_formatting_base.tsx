// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_FORMATTING_BASE` (eeschema/dialogs/panel_setup_formatting_base.cpp): the panel's
 * sizer tree, Add() for Add() - Text, Symbols and Connections down the left; Inter-sheet
 * References, Dashed Lines and the Operating-point Overlay down the right. A Schematic Setup page.
 */
import type { JSX } from 'react';
import {
  type CHECK,
  CheckBox,
  type CHOICE,
  Choice,
  RadioButton,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxFIXED_MINSIZE,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  StaticBoxSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxTextCtrl's text and its handler. */
export interface ENTRY {
  value: string;
  onChange: (aText: string) => void;
}

export interface PANEL_SETUP_FORMATTING_BASE_PROPS {
  m_textSizeCtrl: ENTRY;
  m_overbarHeightCtrl: ENTRY;
  m_textOffsetRatioCtrl: ENTRY;
  m_labelSizeRatioCtrl: ENTRY;
  m_lineWidthCtrl: ENTRY;
  m_pinSymbolSizeCtrl: ENTRY;
  /** The UNIT_BINDERs' unit text. */
  units: string;
  junctionDotChoices: readonly string[];
  m_choiceJunctionDotSize: CHOICE;
  hopOverChoices: readonly string[];
  m_choiceHopOverSize: CHOICE;
  m_connectionGridCtrl: ENTRY;
  m_showIntersheetsReferences: CHECK;
  /** onCheckBoxIref: the rest of the box follows Show inter-sheet references. */
  intersheetRefsEnabled: boolean;
  m_listOwnPage: CHECK;
  abbreviated: boolean;
  onAbbreviated: (aShort: boolean) => void;
  m_prefixCtrl: ENTRY;
  m_suffixCtrl: ENTRY;
  m_dashLengthCtrl: ENTRY;
  m_gapLengthCtrl: ENTRY;
  m_vPrecisionCtrl: { value: number; onChange: (aValue: number) => void };
  vRangeChoices: readonly string[];
  m_vRangeCtrl: CHOICE;
  m_iPrecisionCtrl: { value: number; onChange: (aValue: number) => void };
  iRangeChoices: readonly string[];
  m_iRangeCtrl: CHOICE;
}

export function PANEL_SETUP_FORMATTING_BASE(p: PANEL_SETUP_FORMATTING_BASE_PROPS): JSX.Element {
  const entry = (e: ENTRY, aLabel: string, aTitle?: string, aDisabled?: boolean) => (
    <TextCtrl
      value={e.value}
      onChange={e.onChange}
      ariaLabel={aLabel}
      title={aTitle}
      disabled={aDisabled}
    />
  );
  const offsetTip = _(
    'Percentage of the text size to offset labels above (or below) a wire, bus, or pin',
  );
  const marginTip = _('Percentage of the text size to use as space around a global label');
  const iref = !p.intersheetRefsEnabled;

  return (
    // bPanelSizer
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
        {/* bLeftColumn */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StaticBoxSizer label={_('Text')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                {/* fgSizer2 = wxFlexGridSizer( 0, 3, 5, 5 ), AddGrowableCol( 1 ) */}
                <FlexGridSizer cols={3} vgap={5} hgap={5} growableCols={[1]}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Default text size:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {entry(p.m_textSizeCtrl, 'Default text size')}
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxFIXED_MINSIZE} border={5}>
                    <StaticText label={p.units} />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Overbar offset ratio:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {entry(p.m_overbarHeightCtrl, 'Overbar offset ratio')}
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label="%" />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Label offset ratio:')} title={offsetTip} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {entry(p.m_textOffsetRatioCtrl, 'Label offset ratio', offsetTip)}
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxFIXED_MINSIZE} border={5}>
                    <StaticText label="%" />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Global label margin ratio:')} title={marginTip} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {entry(p.m_labelSizeRatioCtrl, 'Global label margin ratio', marginTip)}
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxFIXED_MINSIZE} border={5}>
                    <StaticText label="%" />
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StaticBoxSizer label={_('Symbols')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                {/* fgSizer321 = wxFlexGridSizer( 0, 3, 5, 0 ), AddGrowableCol( 1 ) */}
                <FlexGridSizer cols={3} vgap={5} hgap={0} growableCols={[1]}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                    <StaticText label={_('Default line width:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                    {entry(p.m_lineWidthCtrl, 'Default line width')}
                  </SizerItem>
                  <SizerItem
                    flag={wxALIGN_CENTER_VERTICAL | wxFIXED_MINSIZE | wxLEFT | wxRIGHT}
                    border={5}
                  >
                    <StaticText label={p.units} />
                  </SizerItem>
                  <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Pin symbol size:')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                    {entry(p.m_pinSymbolSizeCtrl, 'Pin symbol size')}
                  </SizerItem>
                  <SizerItem
                    flag={wxALIGN_CENTER_VERTICAL | wxFIXED_MINSIZE | wxLEFT | wxRIGHT}
                    border={5}
                  >
                    <StaticText label={p.units} />
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StaticBoxSizer label={_('Connections')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                {/* gbSizer1 = wxGridBagSizer( 5, 5 ), AddGrowableCol( 1 ) */}
                <GridBagSizer vgap={5} hgap={5} growableCols={[1]}>
                  <SizerItem pos={[0, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Junction dot size:')} />
                  </SizerItem>
                  <SizerItem
                    pos={[0, 1]}
                    span={[1, 2]}
                    flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                    border={5}
                  >
                    {/* `{ _("None"), _("Smallest"), ... }` (panel_setup_formatting_base.cpp:140-150). */}
                    <Choice
                      ariaLabel="Junction dot size"
                      choices={p.junctionDotChoices.map((c) => _(c))}
                      choice={p.m_choiceJunctionDotSize}
                    />
                  </SizerItem>
                  <SizerItem pos={[1, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Hop-over size:')} />
                  </SizerItem>
                  <SizerItem
                    pos={[1, 1]}
                    span={[1, 2]}
                    flag={wxEXPAND | wxALIGN_CENTER_VERTICAL}
                    border={5}
                  >
                    <Choice
                      ariaLabel="Hop-over size"
                      choices={p.hopOverChoices.map((c) => _(c))}
                      choice={p.m_choiceHopOverSize}
                    />
                  </SizerItem>
                  <SizerItem pos={[2, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Connection grid:')} />
                  </SizerItem>
                  <SizerItem
                    pos={[2, 1]}
                    span={[1, 1]}
                    flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                    border={5}
                  >
                    {entry(p.m_connectionGridCtrl, 'Connection grid')}
                  </SizerItem>
                  <SizerItem pos={[2, 2]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={p.units} />
                  </SizerItem>
                </GridBagSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxLEFT} border={5}>
        {/* bRightColumn */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxALL | wxEXPAND} border={5}>
            <StaticBoxSizer label={_('Inter-sheet References')} orient={wxVERTICAL}>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={_('Show inter-sheet references')}
                  check={p.m_showIntersheetsReferences}
                />
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={15}>
                {/* bSizerMargins */}
                <BoxSizer orient={wxVERTICAL}>
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                    <CheckBox
                      label={_('Show own page reference')}
                      check={{ ...p.m_listOwnPage, enabled: p.intersheetRefsEnabled }}
                    />
                  </SizerItem>
                  <SizerItem flag={wxALL} border={5}>
                    <RadioButton
                      label={_('Standard (1,2,3)')}
                      name="isr-format"
                      checked={!p.abbreviated}
                      disabled={iref}
                      onChange={() => p.onAbbreviated(false)}
                    />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    <RadioButton
                      label={_('Abbreviated (1..3)')}
                      name="isr-format"
                      checked={p.abbreviated}
                      disabled={iref}
                      onChange={() => p.onAbbreviated(true)}
                    />
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                    {/* fgSizer4 = wxFlexGridSizer( 0, 2, 0, 0 ), AddGrowableCol( 1 ) */}
                    <FlexGridSizer cols={2} vgap={0} hgap={0} growableCols={[1]}>
                      <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
                        <StaticText label={_('Prefix:')} disabled={iref} />
                      </SizerItem>
                      <SizerItem
                        proportion={1}
                        flag={wxALL | wxALIGN_CENTER_VERTICAL}
                        border={5}
                        minSize={[160, -1]}
                      >
                        {entry(p.m_prefixCtrl, 'Prefix', undefined, iref)}
                      </SizerItem>
                      <SizerItem
                        flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                        border={5}
                      >
                        <StaticText label={_('Suffix:')} disabled={iref} />
                      </SizerItem>
                      <SizerItem
                        proportion={1}
                        flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                        border={5}
                        minSize={[160, -1]}
                      >
                        {entry(p.m_suffixCtrl, _('Suffix'), undefined, iref)}
                      </SizerItem>
                    </FlexGridSizer>
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxALL} border={5}>
            <StaticBoxSizer label={_('Dashed Lines')} orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                {/* fgSizer41 = wxFlexGridSizer( 0, 2, 5, 0 ) */}
                <FlexGridSizer cols={2} vgap={5} hgap={0}>
                  <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Dash length:')} />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    {entry(p.m_dashLengthCtrl, 'Dash length')}
                  </SizerItem>
                  <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Gap length:')} />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    {entry(p.m_gapLengthCtrl, 'Gap length')}
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                {/* m_dashedLineHelp->SetFont( KIUI::GetSmallInfoFont( this ).Italic() ) */}
                <StaticText
                  label={_('Dash and dot lengths are ratios of the line width.')}
                  font="smallInfo"
                  italic
                />
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
            <StaticBoxSizer label={_('Operating-point Overlay')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                {/* fgSizer = wxFlexGridSizer( 4, 2, 6, 0 ), AddGrowableCol( 1 ) */}
                <FlexGridSizer cols={2} vgap={6} hgap={0} growableCols={[1]}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                    <StaticText label={_('Significant digits (voltages):')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                    <SpinCtrl
                      ariaLabel="Significant digits (voltages)"
                      min={1}
                      max={10}
                      value={p.m_vPrecisionCtrl.value}
                      onChange={p.m_vPrecisionCtrl.onChange}
                    />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                    <StaticText label={_('Range (voltages):')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                    <Choice
                      ariaLabel="Range (voltages)"
                      choices={p.vRangeChoices.map((c) => _(c))}
                      choice={p.m_vRangeCtrl}
                    />
                  </SizerItem>
                  <SizerItem flag={wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                    <StaticText label={_('Significant digits (currents):')} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                    <SpinCtrl
                      ariaLabel="Significant digits (currents)"
                      min={1}
                      max={10}
                      value={p.m_iPrecisionCtrl.value}
                      onChange={p.m_iPrecisionCtrl.onChange}
                    />
                  </SizerItem>
                  <SizerItem
                    flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                    border={5}
                  >
                    <StaticText label={_('Range (currents):')} />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                    <Choice
                      ariaLabel="Range (currents)"
                      choices={p.iRangeChoices.map((c) => _(c))}
                      choice={p.m_iRangeCtrl}
                    />
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
