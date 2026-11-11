// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TEXT_PROPERTIES_BASE` (pcbnew/dialogs/dialog_text_properties_base.cpp): the sizer tree,
 * Add() for Add(), with the `m_syntaxHelp` link the constructor appends to m_MultiLineSizer. The
 * members are props; the behaviour is DIALOG_TEXT_PROPERTIES's (dialog_text_properties.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Combo, type ComboOption, TextCombo } from '@ziroeda/wx/combobox.js';
import { STC_BEST_SIZE, StyledTextCtrl } from '@ziroeda/wx/stc.js';
import { type CHECK, CheckBox, HyperlinkCtrl, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_LEFT,
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
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its label, text, unit, Show() and Enable(). */
export interface FIELD {
  label: string;
  /** The label's SetToolTip(). */
  title?: string;
  value: string;
  units: string;
  shown?: boolean;
  enabled?: boolean;
  onChange: (aText: string) => void;
  onBlur?: () => void;
}

/** A BITMAP_BUTTON in check or radio mode. */
export interface TOGGLE {
  checked: boolean;
  shown?: boolean;
  onClick: () => void;
}

export type HALIGN = 'left' | 'center' | 'right';
export type VALIGN = 'top' | 'center' | 'bottom';

export interface DIALOG_TEXT_PROPERTIES_BASE_PROPS {
  title: string;
  /** m_MultiLineSizer, shown for a board text. */
  multiLine: boolean;
  m_MultiLineText: { value: string; onChange: (aText: string) => void };
  onSyntaxHelp: () => void;
  /** `m_TextLabel` - "Reference:", "Value:" or "Text:" for a footprint's text. */
  m_TextLabel: string;
  m_SingleLineText: { value: string; onChange: (aText: string) => void };
  m_cbLocked: CHECK & { shown: boolean };
  m_LayerSelectionCtrl: {
    rows: readonly ComboOption[];
    value: string;
    onChange: (aLayer: string) => void;
  };
  m_cbKnockout: CHECK;
  m_KeepUpright: CHECK & { shown: boolean };
  m_Visible: CHECK & { shown: boolean };
  m_fontCtrl: { face: string; onChange: (aFace: string) => void };
  m_bold: TOGGLE;
  m_italic: TOGGLE;
  /** m_alignLeft / Center / Right, radio buttons. */
  hAlign: HALIGN;
  onHAlign: (aAlign: HALIGN) => void;
  /** m_valignTop / Center / Bottom. */
  vAlign: VALIGN;
  onVAlign: (aAlign: VALIGN) => void;
  m_mirrored: TOGGLE;
  m_textWidth: FIELD;
  m_textHeight: FIELD;
  m_thickness: FIELD;
  m_autoTextThickness: TOGGLE;
  m_posX: FIELD;
  m_posY: FIELD;
  /** `m_OrientCtrl`, a wxComboBox. */
  m_orientation: { value: string; onChange: (aText: string) => void };
  /** `m_statusLine`, or null when it is hidden (no parent footprint). */
  m_statusLine: string | null;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_TEXT_PROPERTIES_BASE(p: DIALOG_TEXT_PROPERTIES_BASE_PROPS): JSX.Element {
  // A UNIT_BINDER's three cells; its text ctrl is wxTE_PROCESS_ENTER, bound to OnOkClick.
  const field = (aRow: number, aCol: number, f: FIELD, aLabelBorder: number, aUnits = true) => (
    <>
      <SizerItem
        pos={[aRow, aCol]}
        flag={CV | wxLEFT}
        border={aLabelBorder}
        shown={f.shown !== false}
      >
        <StaticText label={f.label} title={f.title} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem
        pos={[aRow, aCol + 1]}
        flag={aUnits ? CV | wxEXPAND : CV | wxALIGN_LEFT}
        border={5}
        shown={f.shown !== false}
      >
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          onEnter={p.onOK}
          disabled={f.enabled === false}
          ariaLabel={f.label.replace(/:$/, '')}
        />
      </SizerItem>
      {aUnits && (
        <SizerItem pos={[aRow, aCol + 2]} flag={CV} border={5} shown={f.shown !== false}>
          <StaticText label={f.units} disabled={f.enabled === false} />
        </SizerItem>
      )}
    </>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={20} flag={wxEXPAND | wxALL} border={10} shown={p.multiLine}>
          {/* m_MultiLineSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
              <StaticText label={_('Text:')} />
            </SizerItem>
            <SizerItem
              proportion={1}
              flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
              border={5}
              minSize={STC_BEST_SIZE}
            >
              {/* m_MultiLineText: no SetMinSize, so the sizer takes its best size */}
              <StyledTextCtrl
                autoFocus={p.multiLine}
                value={p.m_MultiLineText.value}
                onChange={p.m_MultiLineText.onChange}
                ariaLabel="Text"
              />
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={3}>
              <HyperlinkCtrl
                label={_('Syntax help')}
                title={_('Show syntax help window')}
                onClick={p.onSyntaxHelp}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={10} shown={!p.multiLine}>
          {/* m_SingleLineSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={p.m_TextLabel} />
            </SizerItem>
            <SizerItem proportion={1} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
              <TextCtrl
                autoFocus={!p.multiLine}
                value={p.m_SingleLineText.value}
                onChange={p.m_SingleLineText.onChange}
                onEnter={p.onOK}
                ariaLabel={p.m_TextLabel.replace(/:$/, '')}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={10}>
          {/* gbSizer1 = wxGridBagSizer( 2, 3 ), SetEmptyCellSize( wxSize( 20,-1 ) ) */}
          <GridBagSizer vgap={2} hgap={3} emptyCellSize={[20, -1]} growableCols={[1, 5]}>
            <SizerItem
              pos={[0, 0]}
              span={[1, 3]}
              flag={wxRIGHT | wxLEFT}
              border={5}
              shown={p.m_cbLocked.shown}
            >
              <CheckBox label={_('Locked')} check={p.m_cbLocked} />
            </SizerItem>
            <SizerItem pos={[1, 0]} flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
              <StaticText label={_('Layer:')} />
            </SizerItem>
            <SizerItem pos={[1, 1]} span={[1, 2]} flag={CV | wxEXPAND} border={5}>
              <Combo
                value={p.m_LayerSelectionCtrl.value}
                options={p.m_LayerSelectionCtrl.rows}
                onChange={p.m_LayerSelectionCtrl.onChange}
                ariaLabel="Layer"
              />
            </SizerItem>
            <SizerItem pos={[1, 4]} span={[1, 3]} flag={wxEXPAND | wxTOP | wxBOTTOM} border={10}>
              {/* bSizer7 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxALL} border={15}>
                  <CheckBox label={_('Knockout')} check={p.m_cbKnockout} />
                </SizerItem>
                <Spacer width={20} height={0} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={CV} border={10} shown={p.m_KeepUpright.shown}>
                  <CheckBox
                    label={_('Keep upright')}
                    check={p.m_KeepUpright}
                    title={_('Keep text upright')}
                  />
                </SizerItem>
                <Spacer width={20} height={0} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={CV | wxRIGHT} border={20} shown={p.m_Visible.shown}>
                  <CheckBox label={_('Show')} check={p.m_Visible} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem pos={[2, 0]} flag={CV | wxALL} border={5}>
              <StaticText label={_('Font:')} />
            </SizerItem>
            <SizerItem
              pos={[2, 1]}
              span={[1, 2]}
              flag={CV | wxEXPAND | wxTOP | wxBOTTOM}
              border={5}
            >
              <FontChoice face={p.m_fontCtrl.face} onChange={p.m_fontCtrl.onChange} />
            </SizerItem>
            <SizerItem pos={[2, 4]} span={[1, 3]} flag={wxBOTTOM | wxEXPAND | wxTOP} border={3}>
              {/* bSizerButtonBar */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={CV} border={5}>
                  <BitmapButton
                    bitmap="text_bold"
                    tooltip={_('Bold')}
                    checked={p.m_bold.checked}
                    onClick={p.m_bold.onClick}
                  />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <BitmapButton
                    bitmap="text_italic"
                    tooltip={_('Italic')}
                    checked={p.m_italic.checked}
                    onClick={p.m_italic.onClick}
                  />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <BitmapButtonSeparator />
                </SizerItem>
                {(
                  [
                    ['left', 'text_align_left', _('Align left')],
                    ['center', 'text_align_center', _('Align center')],
                    ['right', 'text_align_right', _('Align right')],
                  ] as const
                ).map(([align, bitmap, tip]) => (
                  <SizerItem key={align} flag={CV} border={5}>
                    <BitmapButton
                      bitmap={bitmap}
                      tooltip={tip}
                      checked={p.hAlign === align}
                      onClick={() => p.onHAlign(align)}
                    />
                  </SizerItem>
                ))}
                <SizerItem flag={CV} border={5}>
                  <BitmapButtonSeparator />
                </SizerItem>
                {(
                  [
                    ['top', 'text_valign_top', _('Align top')],
                    ['center', 'text_valign_center', 'Align middle'],
                    ['bottom', 'text_valign_bottom', _('Align bottom')],
                  ] as const
                ).map(([align, bitmap, tip]) => (
                  <SizerItem key={align} flag={CV} border={5}>
                    <BitmapButton
                      bitmap={bitmap}
                      tooltip={tip}
                      checked={p.vAlign === align}
                      onClick={() => p.onVAlign(align)}
                    />
                  </SizerItem>
                ))}
                <SizerItem flag={CV} border={5}>
                  <BitmapButtonSeparator />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <BitmapButton
                    bitmap="text_mirrored"
                    tooltip="Mirrored"
                    checked={p.m_mirrored.checked}
                    onClick={p.m_mirrored.onClick}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            {field(3, 0, p.m_textWidth, 5)}
            {field(4, 0, p.m_textHeight, 5)}
            <SizerItem pos={[5, 2]} span={[1, 2]} flag={CV | wxRIGHT} border={5}>
              {/* bSizer8 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={CV} border={5} shown={p.m_thickness.shown !== false}>
                  <StaticText
                    label={p.m_thickness.units}
                    disabled={p.m_thickness.enabled === false}
                  />
                </SizerItem>
                <SizerItem
                  flag={CV | wxRIGHT | wxLEFT}
                  border={3}
                  shown={p.m_autoTextThickness.shown !== false}
                >
                  <BitmapButton
                    bitmap="edit_cmp_symb_links"
                    tooltip={_('Adjust the text thickness')}
                    checked={p.m_autoTextThickness.checked}
                    onClick={p.m_autoTextThickness.onClick}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            {field(3, 4, p.m_posX, 15)}
            {field(4, 4, p.m_posY, 15)}
            <SizerItem pos={[5, 4]} flag={CV | wxLEFT} border={15}>
              <StaticText label={_('Orientation:')} title={_('Text orientation')} />
            </SizerItem>
            <SizerItem pos={[5, 5]} flag={CV | wxEXPAND} border={5}>
              <TextCombo
                value={p.m_orientation.value}
                options={['0.0', '90.0', '-90.0', '180.0']}
                onChange={p.m_orientation.onChange}
                ariaLabel="Orientation"
              />
            </SizerItem>
            {field(5, 0, p.m_thickness, 5, false)}
          </GridBagSizer>
        </SizerItem>
        <Spacer width={0} height={0} flag={wxTOP} border={5} />
        <SizerItem
          flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP}
          border={12}
          shown={p.m_statusLine !== null}
        >
          {/* bMargins */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT | wxEXPAND} border={3}>
              {/* SetFont( KIUI::GetInfoFont( this ) ) */}
              <StaticText label={p.m_statusLine ?? ''} font="info" />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
