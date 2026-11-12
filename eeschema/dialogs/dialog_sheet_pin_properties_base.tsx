// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHEET_PIN_PROPERTIES_BASE` (eeschema/dialogs/dialog_sheet_pin_properties_base.cpp): the
 * sizer tree, Add() for Add() - the Name combo and Syntax help, the Shape radio box beside the
 * Formatting box. The behaviour is DIALOG_SHEET_PIN_PROPERTIES's.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { TextCombo } from '@ziroeda/wx/combobox.js';
import { HyperlinkCtrl, Panel, RadioButton, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
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
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `m_input` .. `m_passive`, in the base's order. */
export const SHEET_PIN_SHAPES = [
  _HKI('Input'),
  _HKI('Output'),
  _HKI('Bidirectional'),
  _HKI('Tri-state'),
  _HKI('Passive'),
] as const;

export interface DIALOG_SHEET_PIN_PROPERTIES_BASE_PROPS {
  m_comboName: string;
  comboNameChoices: readonly string[];
  onComboName: (aText: string) => void;
  /** `onComboBox`: a name picked from the list. */
  onComboBox: (aText: string) => void;
  onSyntaxHelp: () => void;
  /** Which of the five radio buttons is set (an index into SHEET_PIN_SHAPES). */
  shape: number;
  onShape: (aIndex: number) => void;
  /** `m_fontCtrl`: '' is "Default Font". */
  font: string;
  onFont: (aFace: string) => void;
  m_bold: boolean;
  onBold: () => void;
  m_italic: boolean;
  onItalic: () => void;
  m_textSizeCtrl: string;
  onTextSize: (aText: string) => void;
  /** `m_textSizeUnits`: the UNIT_BINDER's units. */
  units: string;
  m_textColorSwatch: Color4d;
  swatchBackground: Color4d;
  onTextColor: (aColor: Color4d) => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_SHEET_PIN_PROPERTIES_BASE(
  p: DIALOG_SHEET_PIN_PROPERTIES_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Sheet Pin Properties')} onClose={p.onCancel}>
      {/* m_mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={10}>
          {/* m_nameSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* fgSizer2 = wxFlexGridSizer( 2, 2, 4, 0 ), AddGrowableCol( 1 ) */}
              <FlexGridSizer cols={2} vgap={4} hgap={0} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Name:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT | wxTOP} border={5}>
                  {/* m_comboName, SetInitialFocus( m_comboName ) */}
                  <TextCombo
                    value={p.m_comboName}
                    options={p.comboNameChoices}
                    onChange={p.onComboName}
                    onSelect={p.onComboBox}
                    onEnter={p.onOK}
                    autoFocus
                    ariaLabel="Name"
                  />
                </SizerItem>
                <StretchSpacer />
                <SizerItem flag={wxALIGN_RIGHT | wxRIGHT | wxLEFT} border={7}>
                  {/* m_hyperlink1 */}
                  <HyperlinkCtrl
                    label={_('Syntax help')}
                    title={_('Show syntax help window')}
                    onClick={p.onSyntaxHelp}
                  />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* optionsSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
                  {/* m_shapeSizer */}
                  <StaticBoxSizer label={_('Shape')} orient={wxVERTICAL}>
                    {SHEET_PIN_SHAPES.map((label, i) => (
                      // m_input is added wxBOTTOM|wxRIGHT 2, the other four 3.
                      <SizerItem key={label} flag={wxBOTTOM | wxRIGHT} border={i === 0 ? 2 : 3}>
                        <RadioButton
                          label={label}
                          name="sheet-pin-shape"
                          checked={p.shape === i}
                          onChange={() => p.onShape(i)}
                        />
                      </SizerItem>
                    ))}
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
                  {/* formatting */}
                  <StaticBoxSizer label={_('Formatting')} orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* gbSizer1 = wxGridBagSizer( 3, 0 ) */}
                      <GridBagSizer vgap={3} hgap={0}>
                        <SizerItem
                          pos={[0, 0]}
                          span={[1, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                          border={5}
                        >
                          <StaticText label={_('Font:')} />
                        </SizerItem>
                        <SizerItem
                          pos={[0, 1]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                          border={5}
                        >
                          <FontChoice face={p.font} onChange={p.onFont} />
                        </SizerItem>
                        <SizerItem
                          pos={[0, 3]}
                          span={[1, 1]}
                          flag={wxEXPAND | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          {/* formattingSizer: separator, bold, italic, separator */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                              <BitmapButtonSeparator />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <BitmapButton
                                bitmap="text_bold"
                                tooltip={_('Bold')}
                                checked={p.m_bold}
                                onClick={p.onBold}
                              />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <BitmapButton
                                bitmap="text_italic"
                                tooltip={_('Italic')}
                                checked={p.m_italic}
                                onClick={p.onItalic}
                              />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <BitmapButtonSeparator />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                        <SizerItem
                          pos={[1, 0]}
                          span={[1, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                          border={5}
                        >
                          <StaticText label={_('Text size:')} />
                        </SizerItem>
                        <SizerItem pos={[1, 1]} span={[1, 1]} flag={wxEXPAND} border={5}>
                          {/* bSizer71 */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <TextCtrl
                                value={p.m_textSizeCtrl}
                                onChange={p.onTextSize}
                                onEnter={p.onOK}
                                ariaLabel={_('Text size')}
                              />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={3}>
                              <StaticText label={p.units} />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={15}>
                              <StaticText label={_('Color:')} />
                            </SizerItem>
                            <Spacer width={5} height={0} border={5} />
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              {/* m_panelBorderColor1, wxBORDER_SIMPLE */}
                              <Panel border="simple">
                                <BoxSizer orient={wxVERTICAL}>
                                  <SizerItem
                                    flag={wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL}
                                    border={5}
                                  >
                                    <ColorSwatch
                                      label={_('Text color')}
                                      color={p.m_textColorSwatch}
                                      background={p.swatchBackground}
                                      onChange={p.onTextColor}
                                    />
                                  </SizerItem>
                                </BoxSizer>
                              </Panel>
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={6}>
          {/* m_sdbSizer: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
