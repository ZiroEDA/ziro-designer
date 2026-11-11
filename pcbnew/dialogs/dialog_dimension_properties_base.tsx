// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DIMENSION_PROPERTIES_BASE` (pcbnew/dialogs/dialog_dimension_properties_base.cpp): the
 * sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_DIMENSION_PROPERTIES's (dialog_dimension_properties.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Combo, type ComboOption, TextCombo } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
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
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import type { FIELD, HALIGN, TOGGLE } from './dialog_text_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

type LAYER_BOX = {
  rows: readonly ComboOption[];
  value: string;
  onChange: (aLayer: string) => void;
};
type ENTRY = { value: string; enabled?: boolean; onChange: (aText: string) => void };

export interface DIALOG_DIMENSION_PROPERTIES_BASE_PROPS {
  /** Which of the boxes and rows the constructor leaves shown. */
  m_sizerLeader: boolean;
  m_sizerCenter: boolean;
  m_sizerFormat: boolean;
  m_sizerText: boolean;
  m_txtLeaderValue: ENTRY;
  m_cbTextFrame: CHOICE;
  m_cbLeaderLayer: LAYER_BOX;
  m_cbCenterLayer: LAYER_BOX;
  m_txtValue: ENTRY;
  m_cbOverrideValue: CHECK;
  m_cbUnits: CHOICE;
  m_txtPrefix: ENTRY;
  m_cbUnitsFormat: CHOICE;
  m_txtSuffix: ENTRY;
  m_cbPrecision: CHOICE;
  m_cbLayer: LAYER_BOX;
  m_cbSuppressZeroes: CHECK;
  /** `m_staticTextPreview`. */
  m_staticTextPreview: string;
  m_fontCtrl: { face: string; onChange: (aFace: string) => void };
  m_bold: TOGGLE;
  m_italic: TOGGLE;
  hAlign: HALIGN;
  onHAlign: (aAlign: HALIGN) => void;
  m_mirrored: TOGGLE;
  m_textWidth: FIELD;
  m_textPosX: FIELD;
  m_textHeight: FIELD;
  m_textPosY: FIELD;
  m_textThickness: FIELD;
  /** `m_cbTextOrientation`, a wxComboBox. */
  m_cbTextOrientation: ENTRY;
  m_cbTextPositionMode: CHOICE & { shown: boolean };
  m_cbKeepAligned: CHECK;
  m_lineThickness: FIELD;
  m_arrowLength: FIELD;
  m_extensionOffset: FIELD;
  m_extensionOvershoot: FIELD;
  m_cbArrowDirection: CHOICE;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_DIMENSION_PROPERTIES_BASE(
  p: DIALOG_DIMENSION_PROPERTIES_BASE_PROPS,
): JSX.Element {
  // A UNIT_BINDER's three cells, with the per-cell flags the base gives each of them.
  const field = (
    aRow: number,
    aCol: number,
    f: FIELD,
    aFlags: readonly [number, number, number],
    aEnter: boolean,
  ) => (
    <>
      <SizerItem pos={[aRow, aCol]} flag={aFlags[0]} border={5} shown={f.shown !== false}>
        <StaticText label={f.label} title={f.title} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem pos={[aRow, aCol + 1]} flag={aFlags[1]} border={5} shown={f.shown !== false}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          onEnter={aEnter ? p.onOK : undefined}
          disabled={f.enabled === false}
          title={f.title}
          ariaLabel={f.label.replace(/:$/, '')}
        />
      </SizerItem>
      <SizerItem pos={[aRow, aCol + 2]} flag={aFlags[2]} border={5} shown={f.shown !== false}>
        <StaticText label={f.units} disabled={f.enabled === false} />
      </SizerItem>
    </>
  );

  const LEFT_UNIT = [CV | wxRIGHT, wxEXPAND | CV, CV | wxLEFT] as const;

  return (
    <DialogShim title={_('Dimension Properties')} onClose={p.onCancel}>
      {/* m_mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10} shown={p.m_sizerLeader}>
          <StaticBoxSizer label={_('Leader Format')} orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* gbSizerLeader */}
              <GridBagSizer vgap={0} hgap={0} growableCols={[1, 4]}>
                <SizerItem pos={[0, 0]} flag={CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Text:')} />
                </SizerItem>
                <SizerItem
                  pos={[0, 1]}
                  flag={wxEXPAND | CV | wxBOTTOM | wxRIGHT | wxLEFT}
                  border={5}
                >
                  <TextCtrl
                    value={p.m_txtLeaderValue.value}
                    onChange={p.m_txtLeaderValue.onChange}
                    ariaLabel="Leader text"
                  />
                </SizerItem>
                <Spacer width={60} height={0} pos={[0, 2]} flag={wxEXPAND} border={5} />
                <SizerItem pos={[0, 3]} flag={CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <StaticText
                    label={_('Text frame:')}
                    title={_('Draw a shape around the leader text')}
                  />
                </SizerItem>
                <SizerItem
                  pos={[0, 4]}
                  flag={wxEXPAND | CV | wxBOTTOM | wxRIGHT | wxLEFT}
                  border={5}
                >
                  <Choice
                    choices={[_('None'), _('Rectangle'), _('Circle')]}
                    choice={p.m_cbTextFrame}
                    title={_('Draw a shape around the leader text')}
                    ariaLabel="Text frame"
                  />
                </SizerItem>
                <SizerItem pos={[1, 0]} flag={CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Layer:')} />
                </SizerItem>
                <SizerItem
                  pos={[1, 1]}
                  flag={wxEXPAND | CV | wxBOTTOM | wxRIGHT | wxLEFT}
                  border={5}
                >
                  <Combo
                    value={p.m_cbLeaderLayer.value}
                    options={p.m_cbLeaderLayer.rows}
                    onChange={p.m_cbLeaderLayer.onChange}
                    ariaLabel="Leader layer"
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10} shown={p.m_sizerCenter}>
          <StaticBoxSizer label={_('Dimension Format')} orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* gbSizerCenter */}
              <GridBagSizer vgap={0} hgap={0}>
                <SizerItem pos={[0, 0]} flag={CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Layer:')} />
                </SizerItem>
                <SizerItem
                  pos={[0, 1]}
                  flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT | CV}
                  border={5}
                >
                  <Combo
                    value={p.m_cbCenterLayer.value}
                    options={p.m_cbCenterLayer.rows}
                    onChange={p.m_cbCenterLayer.onChange}
                    ariaLabel="Center layer"
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10} shown={p.m_sizerFormat}>
          <StaticBoxSizer label={_('Dimension Format')} orient={wxVERTICAL}>
            <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
              {/* gbSizerFormat = wxGridBagSizer( 3, 0 ) */}
              <GridBagSizer vgap={3} hgap={0} growableCols={[1, 5]}>
                <SizerItem pos={[0, 0]} flag={CV | wxRIGHT} border={5}>
                  <StaticText label={_('Value:')} title={_('Measured value of this dimension')} />
                </SizerItem>
                <SizerItem pos={[0, 1]} flag={wxEXPAND | CV} border={5}>
                  <TextCtrl
                    value={p.m_txtValue.value}
                    onChange={p.m_txtValue.onChange}
                    disabled={p.m_txtValue.enabled === false}
                    title={_('Measured value of this dimension')}
                    ariaLabel="Value"
                  />
                </SizerItem>
                <SizerItem pos={[0, 2]} flag={CV | wxLEFT} border={5}>
                  <CheckBox
                    label={_('Override value')}
                    check={p.m_cbOverrideValue}
                    title={_(
                      'When checked, the actual measurement is ignored and any value can be entered',
                    )}
                  />
                </SizerItem>
                <Spacer width={40} height={0} pos={[0, 3]} border={5} />
                <SizerItem pos={[0, 4]} flag={CV | wxRIGHT} border={5}>
                  <StaticText
                    label={_('Units:')}
                    title={_(
                      'Units of this dimension ("automatic" to follow the units selected in the editor)',
                    )}
                  />
                </SizerItem>
                <SizerItem pos={[0, 5]} flag={wxEXPAND | CV} border={5}>
                  <Choice
                    choices={[_('Inches'), _('Mils'), _('Millimeters'), _('Automatic')]}
                    choice={p.m_cbUnits}
                    title={_(
                      'Units of this dimension ("automatic" to follow the units selected in the editor)',
                    )}
                    ariaLabel="Units"
                  />
                </SizerItem>
                <SizerItem pos={[1, 0]} flag={CV | wxRIGHT} border={5}>
                  <StaticText
                    label={_('Prefix:')}
                    title={_('Text to print before the dimension value')}
                  />
                </SizerItem>
                <SizerItem pos={[1, 1]} flag={wxEXPAND | CV} border={5}>
                  <TextCtrl
                    value={p.m_txtPrefix.value}
                    onChange={p.m_txtPrefix.onChange}
                    title={_('Text to print before the dimension value')}
                    ariaLabel="Prefix"
                  />
                </SizerItem>
                <SizerItem pos={[1, 4]} flag={CV | wxRIGHT} border={5}>
                  <StaticText
                    label={_('Units format:')}
                    title={_('Choose how to display the units')}
                  />
                </SizerItem>
                <SizerItem pos={[1, 5]} flag={wxEXPAND | CV} border={5}>
                  <Choice
                    choices={['1234', _('1234 mm'), _('1234 (mm)')]}
                    choice={p.m_cbUnitsFormat}
                    title={_('Choose how to display the units')}
                    ariaLabel="Units format"
                  />
                </SizerItem>
                <SizerItem pos={[2, 0]} flag={CV | wxRIGHT} border={5}>
                  <StaticText
                    label={_('Suffix:')}
                    title={_('Text to print after the dimension value')}
                  />
                </SizerItem>
                <SizerItem pos={[2, 1]} flag={wxEXPAND | CV} border={5}>
                  <TextCtrl
                    value={p.m_txtSuffix.value}
                    onChange={p.m_txtSuffix.onChange}
                    title={_('Text to print after the dimension value')}
                    ariaLabel={_('Suffix')}
                  />
                </SizerItem>
                <SizerItem pos={[2, 4]} flag={CV | wxRIGHT} border={5}>
                  <StaticText
                    label={_('Precision:')}
                    title={_('Choose how many digits of precision to display')}
                  />
                </SizerItem>
                <SizerItem pos={[2, 5]} flag={wxEXPAND | CV} border={5}>
                  <Choice
                    choices={[
                      '0',
                      '0.0',
                      '0.00',
                      '0.000',
                      '0.0000',
                      '0.00000',
                      _('0.00 in / 0 mils / 0.0 mm'),
                      '0.000 / 0 / 0.00',
                      '0.0000 / 0.0 / 0.000',
                      '0.00000 / 0.00 / 0.0000',
                    ]}
                    choice={p.m_cbPrecision}
                    title={_('Choose how many digits of precision to display')}
                    ariaLabel="Precision"
                  />
                </SizerItem>
                <SizerItem pos={[3, 1]} flag={CV} border={5}>
                  <Combo
                    value={p.m_cbLayer.value}
                    options={p.m_cbLayer.rows}
                    onChange={p.m_cbLayer.onChange}
                    ariaLabel="Layer"
                  />
                </SizerItem>
                <SizerItem pos={[3, 0]} flag={CV | wxRIGHT} border={5}>
                  <StaticText label={_('Layer:')} />
                </SizerItem>
                <SizerItem pos={[3, 4]} flag={CV} border={5}>
                  <CheckBox
                    label={_('Suppress trailing zeroes')}
                    check={p.m_cbSuppressZeroes}
                    title={_(
                      'When checked, "0.100" will be shown as "0.1" even if the precision setting is higher',
                    )}
                  />
                </SizerItem>
                <SizerItem pos={[4, 0]} flag={CV | wxTOP | wxRIGHT} border={5}>
                  <StaticText label={_('Preview:')} />
                </SizerItem>
                <SizerItem pos={[4, 1]} span={[1, 2]} flag={CV | wxTOP | wxEXPAND} border={5}>
                  <StaticText label={p.m_staticTextPreview} />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10} shown={p.m_sizerText}>
          <StaticBoxSizer label={_('Dimension Text')} orient={wxVERTICAL}>
            <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT} border={5}>
              {/* gbSizerText = wxGridBagSizer( 3, 0 ) */}
              <GridBagSizer vgap={3} hgap={0} growableCols={[1, 5]}>
                <SizerItem pos={[0, 0]} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
                  <StaticText label={_('Font:')} />
                </SizerItem>
                <SizerItem pos={[0, 1]} span={[1, 2]} flag={CV | wxBOTTOM | wxEXPAND} border={5}>
                  <FontChoice face={p.m_fontCtrl.face} onChange={p.m_fontCtrl.onChange} />
                </SizerItem>
                <SizerItem pos={[0, 4]} span={[1, 3]} flag={wxEXPAND | wxBOTTOM | CV} border={5}>
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
                {field(1, 0, p.m_textWidth, LEFT_UNIT, true)}
                <Spacer width={40} height={0} pos={[0, 3]} flag={wxEXPAND} border={5} />
                {field(
                  1,
                  4,
                  p.m_textPosX,
                  [CV | wxRIGHT, wxEXPAND | CV, CV | wxALIGN_LEFT | wxLEFT | wxRIGHT],
                  true,
                )}
                {field(
                  2,
                  0,
                  p.m_textHeight,
                  [CV | wxRIGHT, wxEXPAND | CV, CV | wxLEFT | wxRIGHT],
                  true,
                )}
                {field(
                  2,
                  4,
                  p.m_textPosY,
                  [CV | wxRIGHT, wxEXPAND | CV, CV | wxALIGN_LEFT | wxLEFT],
                  true,
                )}
                {field(3, 0, p.m_textThickness, LEFT_UNIT, true)}
                <SizerItem pos={[3, 4]} flag={CV | wxRIGHT} border={5}>
                  <StaticText
                    label={_('Orientation:')}
                    title={_('Text orientation')}
                    disabled={p.m_cbTextOrientation.enabled === false}
                  />
                </SizerItem>
                <SizerItem pos={[3, 5]} span={[1, 2]} flag={CV | wxEXPAND | wxRIGHT} border={5}>
                  <TextCombo
                    value={p.m_cbTextOrientation.value}
                    options={['0.0', '90.0', '-90.0', '180.0']}
                    onChange={p.m_cbTextOrientation.onChange}
                    disabled={p.m_cbTextOrientation.enabled === false}
                    ariaLabel="Orientation"
                  />
                </SizerItem>
                <SizerItem
                  pos={[4, 0]}
                  flag={CV | wxTOP | wxRIGHT}
                  border={5}
                  shown={p.m_cbTextPositionMode.shown}
                >
                  <StaticText label={_('Position mode:')} />
                </SizerItem>
                <SizerItem
                  pos={[4, 1]}
                  span={[1, 2]}
                  flag={wxEXPAND | CV | wxTOP}
                  border={5}
                  shown={p.m_cbTextPositionMode.shown}
                >
                  <Choice
                    choices={[_('Outside'), _('Inline'), _('Manual')]}
                    choice={p.m_cbTextPositionMode}
                    title={_('Choose how to position the text relative to the dimension line')}
                    ariaLabel="Position mode"
                  />
                </SizerItem>
                <SizerItem pos={[4, 4]} span={[1, 3]} flag={CV | wxTOP} border={5}>
                  <CheckBox
                    label={_('Keep aligned with dimension')}
                    check={p.m_cbKeepAligned}
                    title={_('Automatically set the text orientation to match the dimension lines')}
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={10}>
          <StaticBoxSizer label={_('Dimension Line')} orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
              {/* gbSizerLine = wxGridBagSizer( 3, 0 ) */}
              <GridBagSizer vgap={3} hgap={0} growableCols={[1, 5]}>
                {field(0, 0, p.m_lineThickness, [CV | wxRIGHT, CV | wxEXPAND, CV | wxLEFT], true)}
                <Spacer width={40} height={0} pos={[0, 3]} flag={wxEXPAND} border={5} />
                {field(1, 0, p.m_arrowLength, LEFT_UNIT, true)}
                {field(
                  0,
                  4,
                  p.m_extensionOffset,
                  [CV | wxRIGHT, CV | wxEXPAND, CV | wxLEFT],
                  false,
                )}
                {field(
                  1,
                  4,
                  p.m_extensionOvershoot,
                  [wxRIGHT | CV, CV | wxEXPAND, CV | wxLEFT],
                  false,
                )}
                <SizerItem pos={[2, 0]} flag={CV | wxTOP | wxRIGHT} border={5}>
                  <StaticText label={_('Arrow direction:')} />
                </SizerItem>
                <SizerItem pos={[2, 1]} span={[1, 2]} flag={CV | wxEXPAND | wxTOP} border={5}>
                  <Choice
                    choices={[_('Inward'), _('Outward')]}
                    choice={p.m_cbArrowDirection}
                    title={_(
                      'Chose Dimension Arrow Direction\nAutomatic: Determined based on text position.\nInward:    >-----<\nOutward: <----->',
                    )}
                    ariaLabel="Arrow direction"
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
