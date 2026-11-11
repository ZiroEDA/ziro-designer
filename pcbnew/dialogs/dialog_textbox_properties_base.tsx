// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TEXTBOX_PROPERTIES_BASE` (pcbnew/dialogs/dialog_textbox_properties_base.cpp): the sizer
 * tree, Add() for Add(), with the `m_syntaxHelp` link the constructor appends to m_MultiLineSizer.
 * The members are props; the behaviour is DIALOG_TEXTBOX_PROPERTIES's
 * (dialog_textbox_properties.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Combo, type ComboOption, TextCombo } from '@ziroeda/wx/combobox.js';
import { type CHECK, CheckBox, HyperlinkCtrl, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, GridBagSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { STC_BEST_SIZE, StyledTextCtrl } from '@ziroeda/wx/stc.js';
import type { FIELD, HALIGN, TOGGLE, VALIGN } from './dialog_text_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_TEXTBOX_PROPERTIES_BASE_PROPS {
  m_MultiLineText: { value: string; onChange: (aText: string) => void };
  onSyntaxHelp: () => void;
  m_cbLocked: CHECK & { shown: boolean };
  m_LayerSelectionCtrl: {
    rows: readonly ComboOption[];
    value: string;
    onChange: (aLayer: string) => void;
  };
  /** `m_OrientCtrl`, a wxComboBox. */
  m_orientation: { value: string; onChange: (aText: string) => void };
  m_fontCtrl: { face: string; onChange: (aFace: string) => void };
  m_bold: TOGGLE;
  m_italic: TOGGLE;
  hAlign: HALIGN;
  onHAlign: (aAlign: HALIGN) => void;
  vAlign: VALIGN;
  onVAlign: (aAlign: VALIGN) => void;
  m_mirrored: TOGGLE;
  m_textWidth: FIELD;
  m_textHeight: FIELD;
  m_thickness: FIELD;
  m_autoTextThickness: TOGGLE;
  m_borderCheckbox: CHECK;
  m_borderWidth: FIELD;
  /** `m_borderStyleCombo`, a wxBitmapComboBox of lineTypeNames. */
  m_borderStyleCombo: {
    rows: readonly ComboOption[];
    value: string;
    enabled: boolean;
    onChange: (aStyle: string) => void;
  };
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_TEXTBOX_PROPERTIES_BASE(
  p: DIALOG_TEXTBOX_PROPERTIES_BASE_PROPS,
): JSX.Element {
  // A UNIT_BINDER's cells. The size and thickness entries are wxTE_PROCESS_ENTER, bound to
  // OnOkClick; the border width's is not.
  const field = (
    aRow: number,
    aCol: number,
    f: FIELD,
    aLabelBorder: number,
    aEnter: boolean,
    aUnits = true,
  ) => (
    <>
      <SizerItem
        pos={[aRow, aCol]}
        flag={CV | wxLEFT}
        border={aLabelBorder}
        shown={f.shown !== false}
      >
        <StaticText label={f.label} title={f.title} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem pos={[aRow, aCol + 1]} flag={CV | wxEXPAND} border={5} shown={f.shown !== false}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          onEnter={aEnter ? p.onOK : undefined}
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
    <DialogShim title={_('Text Box Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={20} flag={wxEXPAND | wxALL} border={10}>
          {/* m_MultiLineSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
              <StaticText label={_('Text:')} />
            </SizerItem>
            <SizerItem
              proportion={1}
              flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
              border={5}
              minSize={[STC_BEST_SIZE[0], 150]}
            >
              {/* m_MultiLineText->SetMinSize( wxSize( -1,150 ) ): the width stays its best */}
              <StyledTextCtrl
                autoFocus
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
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={10}>
          {/* gbSizer1 = wxGridBagSizer( 3, 3 ) */}
          <GridBagSizer vgap={3} hgap={3} growableCols={[3]}>
            <SizerItem
              pos={[0, 0]}
              span={[1, 3]}
              flag={wxBOTTOM | wxRIGHT | wxLEFT}
              border={5}
              shown={p.m_cbLocked.shown}
            >
              <CheckBox label={_('Locked')} check={p.m_cbLocked} />
            </SizerItem>
            <SizerItem pos={[1, 0]} flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
              <StaticText label={_('Layer:')} />
            </SizerItem>
            <SizerItem
              pos={[1, 1]}
              span={[1, 2]}
              flag={CV | wxEXPAND}
              border={5}
              minSize={[175, -1]}
            >
              <Combo
                value={p.m_LayerSelectionCtrl.value}
                options={p.m_LayerSelectionCtrl.rows}
                onChange={p.m_LayerSelectionCtrl.onChange}
                ariaLabel="Layer"
              />
            </SizerItem>
            <SizerItem pos={[1, 4]} flag={CV | wxLEFT} border={10}>
              <StaticText label={_('Orientation:')} title={_('Text orientation')} />
            </SizerItem>
            <SizerItem pos={[1, 5]} span={[1, 2]} flag={CV | wxEXPAND | wxRIGHT} border={5}>
              <TextCombo
                value={p.m_orientation.value}
                options={['0.0', '90.0', '-90.0', '180.0']}
                onChange={p.m_orientation.onChange}
                ariaLabel="Orientation"
              />
            </SizerItem>
            <SizerItem pos={[3, 0]} flag={CV | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={_('Font:')} />
            </SizerItem>
            <SizerItem pos={[3, 1]} span={[1, 3]} flag={CV | wxEXPAND} border={5}>
              <FontChoice face={p.m_fontCtrl.face} onChange={p.m_fontCtrl.onChange} />
            </SizerItem>
            <SizerItem pos={[3, 4]} span={[1, 3]} flag={CV | wxEXPAND | wxRIGHT} border={8}>
              {/* bSizerButtonBar */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={CV} border={5}>
                  <BitmapButtonSeparator />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <BitmapButton
                    bitmap="text_bold"
                    tooltip="Bold"
                    checked={p.m_bold.checked}
                    onClick={p.m_bold.onClick}
                  />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <BitmapButton
                    bitmap="text_italic"
                    tooltip="Italic"
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
                <SizerItem flag={CV} border={5}>
                  <BitmapButtonSeparator />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            {field(5, 0, p.m_textWidth, 4, true)}
            <SizerItem pos={[5, 4]} span={[1, 2]} flag={wxLEFT | CV} border={10}>
              <CheckBox label={_('Border')} check={p.m_borderCheckbox} />
            </SizerItem>
            {field(6, 0, p.m_textHeight, 4, true)}
            {field(7, 0, p.m_thickness, 4, true, false)}
            <SizerItem pos={[7, 2]} span={[1, 2]} flag={CV | wxRIGHT} border={5}>
              {/* bSizer5 */}
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
            {field(6, 4, p.m_borderWidth, 10, false)}
            <SizerItem pos={[7, 4]} flag={CV | wxLEFT} border={10}>
              <StaticText label={_('Border style:')} disabled={!p.m_borderStyleCombo.enabled} />
            </SizerItem>
            <SizerItem
              pos={[7, 5]}
              span={[1, 2]}
              flag={CV | wxRIGHT | wxEXPAND}
              border={5}
              minSize={[240, -1]}
            >
              <Combo
                value={p.m_borderStyleCombo.value}
                options={p.m_borderStyleCombo.rows}
                disabled={!p.m_borderStyleCombo.enabled}
                onChange={p.m_borderStyleCombo.onChange}
                ariaLabel="Border style"
              />
            </SizerItem>
          </GridBagSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxRIGHT | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
