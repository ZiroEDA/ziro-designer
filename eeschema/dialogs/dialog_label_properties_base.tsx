// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LABEL_PROPERTIES_BASE` (eeschema/dialogs/dialog_label_properties_base.cpp): the sizer
 * tree, Add() for Add() - m_textEntrySizer (three label/value pairs, of which the derived dialog
 * shows one, then Multiple label input and Syntax help), the Fields grid and its buttons, the
 * Shape radio box beside the Formatting box. Every show/hide and relabel is
 * DIALOG_LABEL_PROPERTIES's constructor's, passed in as props.
 */
import type { JSX, ReactNode, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { TextCombo } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  CheckBox,
  HyperlinkCtrl,
  Panel,
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

/** Which of m_textEntrySizer's three label/value pairs is shown. */
export type LABEL_ENTRY = 'combo' | 'single' | 'multi';

/** One of the nine Shape radio buttons. */
export interface SHAPE_RADIO {
  label: string;
  shown: boolean;
  checked: boolean;
  onChange: () => void;
}

export interface DIALOG_LABEL_PROPERTIES_BASE_PROPS {
  title: string;
  /** `m_textEntrySizer->Show( false )` for a directive label. */
  textEntryShown: boolean;
  entry: LABEL_ENTRY;
  m_value: string;
  onValue: (aText: string) => void;
  valueRef?: RefObject<HTMLInputElement>;
  /** m_valueCombo's list (FILTER_COMBOBOX): the schematic's existing labels. */
  comboChoices: readonly string[];
  m_cbMultiLine: CHECK & { shown: boolean };
  onSyntaxHelp: () => void;
  /** m_grid: the WX_GRID the derived dialog sets up over FIELDS_GRID_TABLE. */
  m_grid: ReactNode;
  onAddField: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteField: () => void;
  /** `m_shapeSizer->Show( false )` for a plain local label. */
  shapeShown: boolean;
  shapes: readonly SHAPE_RADIO[];
  /** m_fontLabel's text: "Font:", or a directive's "Orientation:". */
  fontLabel: string;
  /** False for a directive: the font, bold/italic and separators hide and m_iconBar moves to (0,1). */
  fontShown: boolean;
  font: string;
  onFont: (aFace: string) => void;
  m_bold: boolean;
  onBold: () => void;
  m_italic: boolean;
  onItalic: () => void;
  /** m_spin0..3: bitmap and whether it is the pressed radio. */
  spins: readonly { bitmap: string; checked: boolean; onClick: () => void }[];
  m_autoRotate: CHECK & { shown: boolean };
  /** m_textSizeLabel's text: "Text size:", or a directive's "Pin length:". */
  textSizeLabel: string;
  m_textSizeCtrl: string;
  onTextSize: (aText: string) => void;
  units: string;
  m_textColorSwatch: Color4d;
  swatchBackground: Color4d;
  onTextColor: (aColor: Color4d) => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_LABEL_PROPERTIES_BASE(p: DIALOG_LABEL_PROPERTIES_BASE_PROPS): JSX.Element {
  const iconBar = (
    // m_iconBar
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5} shown={p.fontShown}>
        <BitmapButtonSeparator />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5} shown={p.fontShown}>
        <BitmapButton
          bitmap="text_bold"
          tooltip={_('Bold')}
          checked={p.m_bold}
          onClick={p.onBold}
        />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5} shown={p.fontShown}>
        <BitmapButton
          bitmap="text_italic"
          tooltip={_('Italic')}
          checked={p.m_italic}
          onClick={p.onItalic}
        />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5} shown={p.fontShown}>
        <BitmapButtonSeparator />
      </SizerItem>
      {p.spins.map((s) => (
        <SizerItem key={s.bitmap} flag={wxALIGN_CENTER_VERTICAL} border={5}>
          <BitmapButton bitmap={s.bitmap} tooltip="" checked={s.checked} onClick={s.onClick} />
        </SizerItem>
      ))}
      <SizerItem flag={wxALL} border={5} shown={p.m_autoRotate.shown}>
        <CheckBox label={_('Auto')} check={p.m_autoRotate} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5} shown={p.fontShown}>
        {/* m_separator3 */}
        <BitmapButtonSeparator />
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel} initialFocus={p.valueRef}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={12} shown={p.textEntryShown}>
          {/* m_textEntrySizer = wxFlexGridSizer( 5, 2, 1, 3 ), AddGrowableCol( 1 ),
              AddGrowableRow( 1 ) */}
          <FlexGridSizer cols={2} vgap={1} hgap={3} growableCols={[1]} growableRows={[1]}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={2} shown={p.entry === 'single'}>
              <StaticText
                label={_('Label:')}
                title={_('Enter the text to be used within the schematic')}
              />
            </SizerItem>
            <SizerItem
              flag={wxEXPAND | wxALIGN_CENTER_VERTICAL}
              border={2}
              shown={p.entry === 'single'}
            >
              {/* m_valueSingleLine, wxTE_PROCESS_ENTER */}
              <TextCtrl
                value={p.m_value}
                onChange={p.onValue}
                onEnter={p.onOK}
                inputRef={p.entry === 'single' ? p.valueRef : undefined}
                ariaLabel="Label"
              />
            </SizerItem>
            <SizerItem
              flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
              border={5}
              shown={p.entry === 'combo'}
            >
              <StaticText label={_('Label:')} />
            </SizerItem>
            <SizerItem
              flag={wxEXPAND | wxALIGN_CENTER_VERTICAL}
              border={5}
              shown={p.entry === 'combo'}
            >
              {/* m_valueCombo: FILTER_COMBOBOX */}
              <TextCombo
                value={p.m_value}
                options={p.comboChoices}
                onChange={p.onValue}
                onEnter={p.onOK}
                autoFocus={p.entry === 'combo'}
                ariaLabel="Label"
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={2} shown={p.entry === 'multi'}>
              <StaticText
                label={_('Label:')}
                title={_('Enter the text to be used within the schematic')}
              />
            </SizerItem>
            <SizerItem
              flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
              border={2}
              shown={p.entry === 'multi'}
            >
              {/* m_valueMultiLine, wxTE_MULTILINE */}
              <TextCtrl multiLine value={p.m_value} onChange={p.onValue} ariaLabel="Label" />
            </SizerItem>
            <StretchSpacer />
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizer7 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={0} border={5} shown={p.m_cbMultiLine.shown}>
                  <CheckBox label={_('Multiple label input')} check={p.m_cbMultiLine} />
                </SizerItem>
                <StretchSpacer />
                <SizerItem
                  proportion={1}
                  flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                  border={5}
                >
                  {/* m_syntaxHelp, wxHL_ALIGN_RIGHT */}
                  <HyperlinkCtrl
                    label={_('Syntax help')}
                    title={_('Show syntax help window')}
                    onClick={p.onSyntaxHelp}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
          <StaticBoxSizer label={_('Fields')} orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} minSize={[-1, 100]}>
              {p.m_grid}
            </SizerItem>
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              {/* bButtonSize */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  <StdBitmapButton
                    bitmap="small_plus"
                    title={_('Add field')}
                    onClick={p.onAddField}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  <StdBitmapButton bitmap="small_up" title={_('Move up')} onClick={p.onMoveUp} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  <StdBitmapButton
                    bitmap="small_down"
                    title={_('Move down')}
                    onClick={p.onMoveDown}
                  />
                </SizerItem>
                <Spacer width={20} height={0} flag={wxEXPAND} border={10} />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <StdBitmapButton
                    bitmap="small_trash"
                    title={_('Delete field')}
                    onClick={p.onDeleteField}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
          {/* optionsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxBOTTOM | wxEXPAND | wxRIGHT | wxTOP} border={5} shown={p.shapeShown}>
              {/* m_shapeSizer */}
              <StaticBoxSizer label={_('Shape')} orient={wxVERTICAL}>
                {p.shapes.map((s, i) => (
                  // m_input is added wxBOTTOM|wxRIGHT 2, the other eight 3.
                  <SizerItem
                    key={s.label}
                    flag={wxBOTTOM | wxRIGHT}
                    border={i === 0 ? 2 : 3}
                    shown={s.shown}
                  >
                    <RadioButton
                      label={s.label}
                      name="label-shape"
                      checked={s.checked}
                      onChange={s.onChange}
                    />
                  </SizerItem>
                ))}
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
              <StaticBoxSizer label={_('Formatting')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND} border={5}>
                  {/* m_formattingGB = wxGridBagSizer( 3, 1 ) */}
                  <GridBagSizer vgap={3} hgap={1}>
                    <SizerItem
                      pos={[0, 0]}
                      span={[1, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                      border={5}
                    >
                      <StaticText label={p.fontLabel} />
                    </SizerItem>
                    {p.fontShown ? (
                      <SizerItem
                        pos={[0, 1]}
                        span={[1, 2]}
                        flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                        border={5}
                      >
                        <FontChoice face={p.font} onChange={p.onFont} />
                      </SizerItem>
                    ) : null}
                    {p.fontShown ? (
                      <SizerItem
                        pos={[0, 3]}
                        span={[1, 1]}
                        flag={wxEXPAND | wxRIGHT | wxLEFT}
                        border={5}
                      >
                        {iconBar}
                      </SizerItem>
                    ) : (
                      // A directive: Detach( m_fontCtrl ), Detach( m_iconBar ), then
                      // Add( m_iconBar, wxGBPosition( 0, 1 ), wxGBSpan( 1, 1 ), wxEXPAND | wxRIGHT, 5 ).
                      <SizerItem pos={[0, 1]} span={[1, 1]} flag={wxEXPAND | wxRIGHT} border={5}>
                        {iconBar}
                      </SizerItem>
                    )}
                    <SizerItem
                      pos={[1, 0]}
                      span={[1, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                      border={4}
                    >
                      <StaticText label={p.textSizeLabel} />
                    </SizerItem>
                    <SizerItem pos={[1, 1]} span={[1, 1]} flag={wxEXPAND} border={5}>
                      {/* bSizer71 */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <TextCtrl
                            value={p.m_textSizeCtrl}
                            onChange={p.onTextSize}
                            onEnter={p.onOK}
                            ariaLabel={p.textSizeLabel.replace(/:$/, '')}
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
                              <SizerItem flag={0} border={5}>
                                <ColorSwatch
                                  label="Text color"
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
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          {/* m_sdbSizer1: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
