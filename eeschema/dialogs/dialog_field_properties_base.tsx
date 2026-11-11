// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FIELD_PROPERTIES_BASE` (eeschema/dialogs/dialog_field_properties_base.cpp): the sizer
 * tree, Add() for Add() - the value row (m_TextCtrl or the styled control, the footprint chooser
 * button, Unit), the sheet-filename note, the Visible / Show field name / Allow automatic
 * placement row, the gbSizer1 font / size / position grid, the empty fgSizer3 and
 * bBottomtBoxSizer, and the standard pair. What shows is DIALOG_FIELD_PROPERTIES's.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  type CHECK,
  CheckBox,
  type CHOICE,
  Choice,
  Panel,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_LEFT,
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
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** One BITMAP_BUTTON of formattingSizer that is not a separator. */
export interface ICON_BUTTON {
  bitmap: string;
  tooltip: string;
  checked: boolean;
  onClick: () => void;
}

export interface DIALOG_FIELD_PROPERTIES_BASE_PROPS {
  title: string;
  /** m_textLabel: `aField->GetName() + ":"`. */
  m_textLabel: string;
  m_text: string;
  onText: (aText: string) => void;
  /** False for a sheet filename or a generated field. */
  textEnabled: boolean;
  /** m_TextValueSelectButton: the footprint field's chooser. */
  selectButtonShown: boolean;
  onTextValueSelectButtonClick: () => void;
  /** m_unitLabel / m_unitChoice: the reference of a multi-unit symbol. */
  unitShown: boolean;
  unitChoices: readonly string[];
  m_unitChoice: CHOICE;
  /** m_note: "Sheet filename can only be modified in Sheet Properties dialog." */
  noteShown: boolean;
  m_visible: CHECK;
  m_nameVisible: CHECK;
  m_cbAllowAutoPlace: CHECK;
  font: string;
  onFont: (aFace: string) => void;
  m_bold: ICON_BUTTON;
  m_italic: ICON_BUTTON;
  hAlign: readonly ICON_BUTTON[];
  vAlign: readonly ICON_BUTTON[];
  orientation: readonly ICON_BUTTON[];
  m_textSizeCtrl: string;
  onTextSize: (aText: string) => void;
  m_xPosCtrl: string;
  onXPos: (aText: string) => void;
  m_yPosCtrl: string;
  onYPos: (aText: string) => void;
  units: string;
  m_textColorSwatch: Color4d;
  swatchBackground?: Color4d;
  onTextColor: (aColor: Color4d) => void;
  onOK: () => void;
  onCancel: () => void;
}

function Icon({ b }: { b: ICON_BUTTON }): JSX.Element {
  return (
    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
      <BitmapButton bitmap={b.bitmap} tooltip={b.tooltip} checked={b.checked} onClick={b.onClick} />
    </SizerItem>
  );
}

function Separator(): JSX.Element {
  return (
    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
      <BitmapButtonSeparator />
    </SizerItem>
  );
}

export function DIALOG_FIELD_PROPERTIES_BASE(p: DIALOG_FIELD_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* bPropertiesSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT | wxEXPAND} border={5}>
              {/* bUpperBoxSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
                  {/* bTextValueBoxSizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={p.m_textLabel} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                      {/* m_TextCtrl, or the one-line m_StyledTextCtrl in its wxBORDER_THEME
                          panel: init() shows one of the two, and both are an entry here. */}
                      <TextCtrl
                        value={p.m_text}
                        onChange={p.onText}
                        onEnter={p.onOK}
                        disabled={!p.textEnabled}
                        autoFocus
                        ariaLabel={p.m_textLabel.replace(/:$/, '')}
                      />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL}
                      border={5}
                      shown={p.selectButtonShown}
                    >
                      <StdBitmapButton
                        bitmap="small_library"
                        title="Select footprint"
                        tooltip={null}
                        onClick={p.onTextValueSelectButtonClick}
                      />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                      border={15}
                      shown={p.unitShown}
                    >
                      <StaticText label={_('Unit:')} />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                      border={5}
                      shown={p.unitShown}
                    >
                      <Choice ariaLabel="Unit" choices={p.unitChoices} choice={p.m_unitChoice} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={20} shown={p.noteShown}>
                  {/* m_note->SetFont( KIUI::GetInfoFont( this ).Italic() ) (the derived constructor) */}
                  <StaticText
                    label={_('Sheet filename can only be modified in Sheet Properties dialog.')}
                    font="info"
                    italic
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={10}>
              {/* bSizer9 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_LEFT | wxBOTTOM} border={5}>
                  <CheckBox label={_('Visible')} check={p.m_visible} />
                </SizerItem>
                <StretchSpacer />
                <SizerItem flag={wxRIGHT | wxLEFT} border={20}>
                  <CheckBox
                    label={_('Show field name')}
                    title={_('Show the field name in addition to its value')}
                    check={p.m_nameVisible}
                  />
                </SizerItem>
                <StretchSpacer />
                <SizerItem flag={wxFIXED_MINSIZE | wxRIGHT} border={37}>
                  <CheckBox
                    label={_('Allow automatic placement')}
                    title={_('Allow automatic placement of this field in the schematic')}
                    check={p.m_cbAllowAutoPlace}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
              {/* gbSizer1 = wxGridBagSizer( 3, 0 ), SetEmptyCellSize( wxSize( -1,10 ) ) */}
              <GridBagSizer vgap={3} hgap={0} emptyCellSize={[-1, 10]}>
                <SizerItem
                  pos={[0, 0]}
                  span={[1, 1]}
                  flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                  border={5}
                >
                  <StaticText label={_('Font:')} />
                </SizerItem>
                <SizerItem pos={[0, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                  <FontChoice face={p.font} onChange={p.onFont} />
                </SizerItem>
                <SizerItem pos={[0, 3]} span={[1, 2]} flag={wxEXPAND} border={5}>
                  {/* formattingSizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                      <BitmapButtonSeparator />
                    </SizerItem>
                    <Icon b={p.m_bold} />
                    <Icon b={p.m_italic} />
                    <Separator />
                    {p.hAlign.map((b) => (
                      <Icon key={b.bitmap} b={b} />
                    ))}
                    <Separator />
                    {p.vAlign.map((b) => (
                      <Icon key={b.bitmap} b={b} />
                    ))}
                    <Separator />
                    {p.orientation.map((b) => (
                      <Icon key={b.bitmap} b={b} />
                    ))}
                    <Separator />
                  </BoxSizer>
                </SizerItem>
                <SizerItem
                  pos={[1, 0]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                  border={5}
                >
                  <StaticText label={_('Text size:')} />
                </SizerItem>
                <SizerItem pos={[1, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                  {/* bSizer71 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <TextCtrl
                        value={p.m_textSizeCtrl}
                        onChange={p.onTextSize}
                        onEnter={p.onOK}
                        ariaLabel="Text size"
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
                              label="Color"
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
                <SizerItem
                  pos={[3, 0]}
                  span={[1, 1]}
                  flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                  border={5}
                >
                  <StaticText label={_('Position X:')} />
                </SizerItem>
                <SizerItem
                  pos={[3, 1]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                  border={5}
                >
                  <TextCtrl
                    value={p.m_xPosCtrl}
                    onChange={p.onXPos}
                    onEnter={p.onOK}
                    ariaLabel={_HKI('Position X')}
                  />
                </SizerItem>
                <SizerItem
                  pos={[3, 2]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                  border={3}
                >
                  <StaticText label={p.units} />
                </SizerItem>
                <SizerItem
                  pos={[4, 0]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                  border={5}
                >
                  <StaticText label={_('Position Y:')} />
                </SizerItem>
                <SizerItem
                  pos={[4, 1]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                  border={5}
                >
                  <TextCtrl
                    value={p.m_yPosCtrl}
                    onChange={p.onYPos}
                    onEnter={p.onOK}
                    ariaLabel={_HKI('Position Y')}
                  />
                </SizerItem>
                <SizerItem
                  pos={[4, 2]}
                  span={[1, 1]}
                  flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                  border={3}
                >
                  <StaticText label={p.units} />
                </SizerItem>
                {/* m_commonToAllUnits (3,4) and m_commonToAllBodyStyles (4,4): init() hides both. */}
              </GridBagSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              {/* fgSizer3 = wxFlexGridSizer( 5, 4, 3, 3 ): five empty stretch spacers */}
              <FlexGridSizer cols={4} vgap={3} hgap={3}>
                <StretchSpacer />
                <StretchSpacer />
                <StretchSpacer />
                <StretchSpacer />
                <StretchSpacer />
              </FlexGridSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP | wxLEFT} border={5}>
              {/* bBottomtBoxSizer: empty */}
              <BoxSizer orient={wxVERTICAL}>{null}</BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* m_sdbSizerButtons: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
