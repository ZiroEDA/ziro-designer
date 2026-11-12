// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE`
 * (eeschema/dialogs/dialog_global_edit_text_and_graphics_base.cpp): the sizer tree, Add() for
 * Add() - Scope beside Filter Items, the Set To box's six-column fgSizer1 with every spacer and
 * the row of static lines, and the OK / Apply / Cancel sizer. The behaviour is
 * DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS's.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import {
  type CHECK,
  CheckBox,
  type CHOICE,
  Choice,
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
import { type CHECK3, TriStateCheck } from '@ziroeda/wx/wx_checkbox.js';
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

/** A wxTextCtrl's text and its handler. */
export interface ENTRY {
  value: string;
  onChange: (aText: string) => void;
}

/** A "Set color" checkbox with its COLOR_SWATCH. */
export interface SWATCH {
  color: Color4d;
  onChange: (aColor: Color4d) => void;
}

export interface DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE_PROPS {
  m_references: CHECK;
  m_values: CHECK;
  m_otherFields: CHECK;
  m_wires: CHECK;
  m_buses: CHECK;
  m_globalLabels: CHECK;
  m_hierLabels: CHECK;
  m_labelFields: CHECK;
  m_sheetTitles: CHECK;
  m_sheetFields: CHECK;
  m_sheetPins: CHECK;
  m_sheetBorders: CHECK;
  m_schTextAndGraphics: CHECK;
  m_fieldnameFilterOpt: CHECK;
  m_fieldnameFilter: ENTRY;
  m_referenceFilterOpt: CHECK;
  m_referenceFilter: ENTRY;
  m_symbolFilterOpt: CHECK;
  m_symbolFilter: ENTRY;
  m_typeFilterOpt: CHECK;
  typeFilterChoices: readonly string[];
  m_typeFilter: CHOICE;
  m_netFilterOpt: CHECK;
  m_netFilter: ENTRY;
  m_selectedFilterOpt: CHECK;
  /** FONT_CHOICE with SetHasIndeterminateChoice(). */
  font: string;
  onFont: (aFace: string) => void;
  m_setTextColor: CHECK;
  m_textColorSwatch: SWATCH;
  m_textSizeCtrl: ENTRY;
  m_bold: CHECK3;
  m_italic: CHECK3;
  orientationChoices: readonly string[];
  m_orientation: CHOICE;
  hAlignChoices: readonly string[];
  m_hAlign: CHOICE;
  m_visible: CHECK3;
  vAlignChoices: readonly string[];
  m_vAlign: CHOICE;
  m_showFieldNames: CHECK3;
  m_LineWidthCtrl: ENTRY;
  m_setColor: CHECK;
  m_colorSwatch: SWATCH;
  /** The base's five styles plus the derived dialog's Append( INDETERMINATE_ACTION ). */
  lineStyleChoices: readonly string[];
  m_lineStyle: CHOICE;
  m_setFillColor: CHECK;
  m_fillColorSwatch: SWATCH;
  m_dotSizeCtrl: ENTRY;
  m_setDotColor: CHECK;
  m_dotColorSwatch: SWATCH;
  units: string;
  onOK: () => void;
  onApply: () => void;
  onCancel: () => void;
}

/** A spacer in fgSizer1: `Add( w, h, proportion, flag, border )`. */
function Sp({
  h = 0,
  w = 0,
  flag = wxEXPAND,
  border = 5,
}: {
  h?: number;
  w?: number;
  flag?: number;
  border?: number;
}): JSX.Element {
  return <Spacer width={w} height={h} proportion={1} flag={flag} border={border} />;
}

/** m_staticText12..16: KIUI::GetSmallInfoFont( this ).Italic() (the derived constructor). */
function Note({ label }: { label: string }): JSX.Element {
  return <StaticText label={label} font="smallInfo" italic />;
}

/** A COLOR_SWATCH, SetMinSize( wxSize( 48,24 ) ). */
function Swatch({ label, s }: { label: string; s: SWATCH }): JSX.Element {
  return <ColorSwatch label={label} color={s.color} onChange={s.onChange} />;
}

export function DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE(
  p: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE_PROPS,
): JSX.Element {
  // sbScope's checkboxes are all added wxBOTTOM|wxRIGHT|wxLEFT, 4.
  const scope = (label: string, c: CHECK) => (
    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={4}>
      <CheckBox label={label} check={c} />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Edit Text and Graphic Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
              <StaticBoxSizer label={_('Scope')} orient={wxVERTICAL}>
                {scope(_('Reference designators'), p.m_references)}
                {scope(_('Values'), p.m_values)}
                {scope(_('Other symbol fields'), p.m_otherFields)}
                <Spacer width={0} height={0} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5} />
                {scope(_('Wires & wire labels'), p.m_wires)}
                {scope(_('Buses & bus labels'), p.m_buses)}
                {scope(_('Global labels'), p.m_globalLabels)}
                {scope(_('Hierarchical labels'), p.m_hierLabels)}
                {scope(_('Label fields'), p.m_labelFields)}
                <Spacer
                  width={0}
                  height={0}
                  proportion={1}
                  flag={wxEXPAND | wxTOP | wxBOTTOM}
                  border={5}
                />
                {scope(_('Sheet titles'), p.m_sheetTitles)}
                {scope(_('Other sheet fields'), p.m_sheetFields)}
                {scope(_('Sheet pins'), p.m_sheetPins)}
                {scope(_('Sheet borders & backgrounds'), p.m_sheetBorders)}
                <Spacer
                  width={0}
                  height={0}
                  proportion={1}
                  flag={wxEXPAND | wxTOP | wxBOTTOM}
                  border={5}
                />
                {scope(_('Schematic text & graphics'), p.m_schTextAndGraphics)}
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
              <StaticBoxSizer label={_('Filter Items')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
                  {/* fgSizer2 = wxFlexGridSizer( 0, 2, 4, 0 ), AddGrowableCol( 1 ) */}
                  <FlexGridSizer cols={2} vgap={4} hgap={0} growableCols={[1]}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <CheckBox label={_('By field name:')} check={p.m_fieldnameFilterOpt} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxEXPAND} border={5}>
                      <TextCtrl
                        value={p.m_fieldnameFilter.value}
                        onChange={p.m_fieldnameFilter.onChange}
                        ariaLabel={_('Field name filter')}
                      />
                    </SizerItem>
                    <Sp flag={wxEXPAND | wxTOP | wxBOTTOM} border={3} />
                    <Sp flag={wxEXPAND | wxTOP | wxBOTTOM} border={3} />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                      <CheckBox
                        label={_('By parent reference designator:')}
                        check={p.m_referenceFilterOpt}
                      />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxLEFT} border={5} minSize={[150, -1]}>
                      <TextCtrl
                        value={p.m_referenceFilter.value}
                        onChange={p.m_referenceFilter.onChange}
                        ariaLabel={_('Reference filter')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <CheckBox
                        label={_('By parent symbol library id:')}
                        check={p.m_symbolFilterOpt}
                      />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                      <TextCtrl
                        value={p.m_symbolFilter.value}
                        onChange={p.m_symbolFilter.onChange}
                        ariaLabel={_('Symbol filter')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                      <CheckBox label={_('By parent symbol type:')} check={p.m_typeFilterOpt} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxLEFT} border={5}>
                      <Choice
                        ariaLabel={_('Symbol type')}
                        choices={p.typeFilterChoices}
                        choice={p.m_typeFilter}
                      />
                    </SizerItem>
                    <Sp flag={wxEXPAND | wxTOP | wxBOTTOM} />
                    <Sp />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <CheckBox label={_('By net:')} check={p.m_netFilterOpt} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxLEFT} border={5}>
                      <TextCtrl
                        value={p.m_netFilter.value}
                        onChange={p.m_netFilter.onChange}
                        ariaLabel={_('Net filter')}
                      />
                    </SizerItem>
                    <Sp flag={wxEXPAND | wxTOP | wxBOTTOM} />
                    <Sp />
                    <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                      <CheckBox label={_('Selected items only')} check={p.m_selectedFilterOpt} />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <Spacer width={0} height={0} flag={wxTOP} border={5} />
        <Spacer width={0} height={0} flag={wxTOP} border={5} />
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxRIGHT} border={10}>
          <StaticBoxSizer label={_('Set To')} orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
              {/* fgSizer1 = wxFlexGridSizer( 0, 6, 5, 0 ), AddGrowableCol( 1 / 3 / 5 ) */}
              <FlexGridSizer cols={6} vgap={5} hgap={0} growableCols={[1, 3, 5]}>
                <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Font:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  <FontChoice face={p.font} indeterminate onChange={p.onFont} />
                </SizerItem>
                <Sp />
                <Sp />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                  <CheckBox label={_('Text color:')} check={p.m_setTextColor} />
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT} border={5} minSize={[48, 24]}>
                  <Swatch label={_('Text color')} s={p.m_textColorSwatch} />
                </SizerItem>

                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Text size:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5} minSize={[120, -1]}>
                  <TextCtrl
                    value={p.m_textSizeCtrl.value}
                    onChange={p.m_textSizeCtrl.onChange}
                    ariaLabel={_('Text size')}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                  <StaticText label={p.units} />
                </SizerItem>
                <Sp />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <TriStateCheck label={_('Bold')} check={p.m_bold} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  <TriStateCheck label={_('Italic')} check={p.m_italic} />
                </SizerItem>

                <Sp h={5} />
                <Sp />
                <Sp />
                <Sp />
                <Sp />
                <Sp />

                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Orientation:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={4}>
                  <Choice
                    ariaLabel="Orientation"
                    choices={p.orientationChoices}
                    choice={p.m_orientation}
                  />
                </SizerItem>
                <SizerItem flag={wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                  <Note label={_('(labels only)')} />
                </SizerItem>
                <Spacer width={0} height={0} flag={wxEXPAND | wxRIGHT | wxLEFT} border={25} />
                <Sp />
                <Sp />

                <Sp h={5} />
                <Sp />
                <Sp />
                <Sp />
                <Sp />
                <Sp />

                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('H Align:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={4}>
                  <Choice ariaLabel="H Align" choices={p.hAlignChoices} choice={p.m_hAlign} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                  <Note label={_('(fields only)')} />
                </SizerItem>
                <Sp />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <TriStateCheck label={_('Visible')} check={p.m_visible} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={15}>
                  <Note label={_('(fields only)')} />
                </SizerItem>

                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                  <StaticText label={_('V Align:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  <Choice ariaLabel="V Align" choices={p.vAlignChoices} choice={p.m_vAlign} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                  <Note label={_('(fields only)')} />
                </SizerItem>
                <Sp flag={wxEXPAND | wxBOTTOM} border={0} />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <TriStateCheck label={_('Show field name')} check={p.m_showFieldNames} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={15}>
                  <Note label={_('(fields only)')} />
                </SizerItem>

                {/* m_staticline1 .. m_staticline5 */}
                <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxTOP} border={7}>
                  <StaticLine />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={7}>
                  <StaticLine />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={7}>
                  <StaticLine />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={7}>
                  <StaticLine />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={7}>
                  <StaticLine />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={7}>
                  <StaticLine />
                </SizerItem>

                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Line width:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_LineWidthCtrl.value}
                    onChange={p.m_LineWidthCtrl.onChange}
                    ariaLabel={_('Line width')}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                  <StaticText label={p.units} />
                </SizerItem>
                <Sp />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox label={_('Line color:')} check={p.m_setColor} />
                </SizerItem>
                <SizerItem
                  flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                  border={5}
                  minSize={[48, 24]}
                >
                  <Swatch label={_('Line color')} s={p.m_colorSwatch} />
                </SizerItem>

                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Line style:')} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM} border={1}>
                  <Choice
                    ariaLabel={_('Line style')}
                    choices={p.lineStyleChoices}
                    choice={p.m_lineStyle}
                  />
                </SizerItem>
                <Sp />
                <Sp />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox label={_('Fill color:')} check={p.m_setFillColor} />
                </SizerItem>
                <SizerItem
                  flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                  border={5}
                  minSize={[48, 24]}
                >
                  <Swatch label={_HKI('Fill color')} s={p.m_fillColorSwatch} />
                </SizerItem>

                <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Junction size:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_dotSizeCtrl.value}
                    onChange={p.m_dotSizeCtrl.onChange}
                    ariaLabel={_('Junction size')}
                  />
                </SizerItem>
                <SizerItem flag={wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={p.units} />
                </SizerItem>
                <Sp flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} />
                <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                  <CheckBox label={_('Junction color:')} check={p.m_setDotColor} />
                </SizerItem>
                <SizerItem
                  flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                  border={5}
                  minSize={[48, 24]}
                >
                  <Swatch label={_('Junction color')} s={p.m_dotColorSwatch} />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizerButtons: OK, Apply, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onApply={p.onApply} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
