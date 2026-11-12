// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TEXT_PROPERTIES_BASE` (eeschema/dialogs/dialog_text_properties_base.cpp): the sizer
 * tree, Add() for Add() - the info bar, then m_textEntrySizer, one grid bag holding the text,
 * Exclude from simulation and Syntax help, the font row with its icon bar, the size and colour
 * row, the text box's border and fill rows, and the Link row; then the symbol editor's
 * m_fgSymbolEditor and the standard pair. Every show/hide and enable is DIALOG_TEXT_PROPERTIES's,
 * passed in.
 */
import type { JSX, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { Combo, TextCombo } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  CheckBox,
  HyperlinkCtrl,
  Panel,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_RIGHT,
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
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** One BITMAP_BUTTON of bSizeCtrlSizer that is not a separator. */
export interface ICON_BUTTON {
  bitmap: string;
  tooltip: string;
  checked: boolean;
  onClick: () => void;
}

/** A COLOR_SWATCH in its wxBORDER_SIMPLE panel. */
export interface SWATCH {
  color: Color4d;
  background: Color4d;
  enabled?: boolean;
  onChange: (aColor: Color4d) => void;
}

export interface DIALOG_TEXT_PROPERTIES_BASE_PROPS {
  /** "Text Properties" or "Text Box Properties". */
  title: string;
  m_infoBar: string | null;
  m_textCtrl: string;
  onText: (aText: string) => void;
  textRef?: RefObject<HTMLTextAreaElement>;
  /** False in the symbol editor, with m_syntaxHelp, m_hyperlinkCb and m_hyperlinkCombo. */
  schematicOnlyShown: boolean;
  m_excludeFromSim: CHECK;
  onSyntaxHelp: () => void;
  font: string;
  onFont: (aFace: string) => void;
  m_bold: ICON_BUTTON;
  m_italic: ICON_BUTTON;
  /** m_hAlignLeft, m_hAlignCenter, m_hAlignRight. */
  hAlign: readonly ICON_BUTTON[];
  /** m_vAlignTop, m_vAlignCenter, m_vAlignBottom. */
  vAlign: readonly ICON_BUTTON[];
  /** m_horizontal, m_vertical. */
  orientation: readonly ICON_BUTTON[];
  m_textSizeCtrl: string;
  onTextSize: (aText: string) => void;
  units: string;
  m_textColorSwatch: SWATCH;
  /** The text box rows: shown only for SCH_TEXTBOX. */
  boxShown: boolean;
  m_borderCheckbox: CHECK;
  /** `onBorderChecked`: the width, colour and style follow the box. */
  borderEnabled: boolean;
  m_borderWidthCtrl: string;
  onBorderWidth: (aText: string) => void;
  m_borderColorSwatch: SWATCH;
  /** m_borderStyleCombo: `lineTypeNames`, name and bitmap. */
  borderStyles: readonly { value: string; label: string; bitmap?: string }[];
  m_borderStyleCombo: string;
  onBorderStyle: (aValue: string) => void;
  m_filledCtrl: CHECK;
  m_fillColorSwatch: SWATCH;
  m_hyperlinkCb: CHECK;
  m_hyperlinkCombo: string;
  /** WX_COMBOBOX: the texts Append() put in, and their menu texts. */
  hyperlinkChoices: readonly string[];
  hyperlinkMenuText: readonly (string | undefined)[];
  onHyperlinkText: (aText: string) => void;
  onHyperlinkCombo: (aText: string) => void;
  /** `m_fgSymbolEditor->Show( m_isSymbolEditor )`. */
  symbolEditorShown: boolean;
  m_privateCheckbox: CHECK;
  m_commonToAllUnits: CHECK;
  m_commonToAllBodyStyles: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

function SwatchPanel({ label, s }: { label: string; s: SWATCH }): JSX.Element {
  return (
    <Panel border="simple">
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL} border={5}>
          <ColorSwatch
            label={label}
            color={s.color}
            background={s.background}
            disabled={s.enabled === false}
            onChange={s.onChange}
          />
        </SizerItem>
      </BoxSizer>
    </Panel>
  );
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

export function DIALOG_TEXT_PROPERTIES_BASE(p: DIALOG_TEXT_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5} shown={p.m_infoBar !== null}>
          <Infobar message={p.m_infoBar ?? ''} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          {/* m_textEntrySizer = wxGridBagSizer( 2, 3 ), SetEmptyCellSize( wxSize( 0,6 ) ),
              AddGrowableCol( 3 ), and the derived dialog's AddGrowableRow( 0 ) */}
          <GridBagSizer
            vgap={2}
            hgap={3}
            emptyCellSize={[0, 6]}
            growableCols={[3]}
            growableRows={[0]}
          >
            <SizerItem pos={[0, 0]} span={[1, 1]} flag={wxRIGHT} border={5}>
              <StaticText label={_('Text:')} />
            </SizerItem>
            <SizerItem pos={[0, 1]} span={[1, 5]} flag={wxEXPAND} border={5} minSize={[500, 140]}>
              {/* m_textCtrl: wxStyledTextCtrl, SetMinSize( wxSize( 500,140 ) ),
                  SetInitialFocus( m_textCtrl ) */}
              <TextCtrl
                multiLine
                value={p.m_textCtrl}
                onChange={p.onText}
                textAreaRef={p.textRef}
                ariaLabel="Text"
              />
            </SizerItem>
            <SizerItem
              pos={[1, 5]}
              span={[1, 1]}
              flag={wxEXPAND | wxALIGN_RIGHT | wxLEFT}
              border={5}
            >
              {/* bSizer41 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem
                  flag={wxBOTTOM | wxRIGHT | wxLEFT}
                  border={6}
                  shown={p.schematicOnlyShown}
                >
                  <HyperlinkCtrl
                    label={_('Syntax help')}
                    title={_('Show syntax help window')}
                    onClick={p.onSyntaxHelp}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem
              pos={[1, 0]}
              span={[1, 2]}
              flag={wxTOP | wxBOTTOM}
              border={10}
              shown={p.schematicOnlyShown}
            >
              <CheckBox label={_('Exclude from simulation')} check={p.m_excludeFromSim} />
            </SizerItem>
            <SizerItem pos={[3, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
              <StaticText label={_('Font:')} />
            </SizerItem>
            <SizerItem
              pos={[3, 1]}
              span={[1, 2]}
              flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
              border={5}
            >
              <FontChoice face={p.font} onChange={p.onFont} />
            </SizerItem>
            <SizerItem
              pos={[3, 3]}
              span={[1, 3]}
              flag={wxEXPAND | wxALIGN_CENTER_VERTICAL}
              border={5}
            >
              {/* bSizeCtrlSizer */}
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
            <SizerItem pos={[4, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
              <StaticText label={_('Text size:')} />
            </SizerItem>
            <SizerItem pos={[4, 1]} span={[1, 1]} flag={wxEXPAND} border={5}>
              {/* bSizer71 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxEXPAND} border={5}>
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
                  {/* m_panelBorderColor1 */}
                  <SwatchPanel label={_('Text color')} s={p.m_textColorSwatch} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem pos={[6, 0]} span={[1, 2]} flag={wxBOTTOM} border={2} shown={p.boxShown}>
              <CheckBox label={_('Border')} check={p.m_borderCheckbox} />
            </SizerItem>
            <SizerItem
              pos={[7, 0]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL}
              border={5}
              shown={p.boxShown}
            >
              <StaticText label={_('Width:')} disabled={!p.borderEnabled} />
            </SizerItem>
            <SizerItem pos={[7, 1]} span={[1, 2]} flag={wxEXPAND} border={5} shown={p.boxShown}>
              {/* bSizer7 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_borderWidthCtrl}
                    onChange={p.onBorderWidth}
                    onEnter={p.onOK}
                    disabled={!p.borderEnabled}
                    ariaLabel={_('Border width')}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={3}>
                  <StaticText label={p.units} disabled={!p.borderEnabled} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={15}>
                  <StaticText label={_('Color:')} disabled={!p.borderEnabled} />
                </SizerItem>
                <Spacer width={5} height={0} border={5} />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  {/* m_panelBorderColor */}
                  <SwatchPanel label={_('Border color')} s={p.m_borderColorSwatch} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem
              pos={[8, 0]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL}
              border={5}
              shown={p.boxShown}
            >
              <StaticText label={_('Style:')} disabled={!p.borderEnabled} />
            </SizerItem>
            <SizerItem
              pos={[8, 1]}
              span={[1, 2]}
              flag={wxEXPAND}
              border={5}
              minSize={[240, -1]}
              shown={p.boxShown}
            >
              {/* m_borderStyleCombo: wxBitmapComboBox, wxCB_READONLY */}
              <Combo
                ariaLabel={_('Border style')}
                value={p.m_borderStyleCombo}
                disabled={!p.borderEnabled}
                options={p.borderStyles}
                onChange={p.onBorderStyle}
              />
            </SizerItem>
            <SizerItem pos={[6, 4]} span={[1, 2]} flag={wxRIGHT} border={80} shown={p.boxShown}>
              <CheckBox label={_('Background fill')} check={p.m_filledCtrl} />
            </SizerItem>
            <SizerItem pos={[7, 4]} span={[1, 2]} flag={wxEXPAND} border={5} shown={p.boxShown}>
              {/* bSizer8 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxRIGHT | wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Fill color:')}
                    disabled={p.m_fillColorSwatch.enabled === false}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  {/* m_panelFillColor */}
                  <SwatchPanel label={_HKI('Fill color')} s={p.m_fillColorSwatch} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem
              pos={[10, 0]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM}
              border={5}
              shown={p.schematicOnlyShown}
            >
              <CheckBox
                label={_('Link:')}
                title={_('Make this text item a clickable hyperlink')}
                check={p.m_hyperlinkCb}
              />
            </SizerItem>
            <SizerItem
              pos={[10, 1]}
              span={[1, 5]}
              flag={wxEXPAND | wxBOTTOM | wxALIGN_CENTER_VERTICAL}
              border={5}
              shown={p.schematicOnlyShown}
            >
              {/* bSizer11 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem
                  proportion={1}
                  flag={wxALIGN_CENTER_VERTICAL | wxFIXED_MINSIZE}
                  border={5}
                >
                  {/* m_hyperlinkCombo: WX_COMBOBOX */}
                  <TextCombo
                    value={p.m_hyperlinkCombo}
                    options={p.hyperlinkChoices}
                    menuText={p.hyperlinkMenuText}
                    onChange={p.onHyperlinkText}
                    onSelect={p.onHyperlinkCombo}
                    ariaLabel={_('Link')}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </GridBagSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={10} shown={p.symbolEditorShown}>
          {/* m_fgSymbolEditor = wxFlexGridSizer( 0, 3, 0, 0 ), AddGrowableCol( 0 ), ( 2 ) */}
          <FlexGridSizer cols={3} vgap={0} hgap={0} growableCols={[0, 2]}>
            <SizerItem flag={wxRIGHT | wxTOP} border={5}>
              <CheckBox label={_('Private to symbol editor')} check={p.m_privateCheckbox} />
            </SizerItem>
            <Spacer width={60} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
              <CheckBox label={_('Common to all units')} check={p.m_commonToAllUnits} />
            </SizerItem>
            <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxALL} border={5}>
              <CheckBox label={_('Common to all body styles')} check={p.m_commonToAllBodyStyles} />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizer1: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
