// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_DIMENSIONS_BASE` (pcbnew/dialogs/panel_setup_dimensions_base.cpp): the panel's sizer
 * tree, Add() for Add() - one wxGridBagSizer( 0, 5 ), six columns, the right pair from column 3.
 * Board Setup's Defaults page and the footprint editor's Default Values page both embed it; the
 * behaviour is PANEL_SETUP_DIMENSIONS's (panel_setup_dimensions.tsx).
 */
import type { JSX } from 'react';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
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
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, GridBagSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER's control and units label. */
export type UNIT_FIELD = {
  value: string;
  onChange: (aText: string) => void;
  onBlur: () => void;
  units: string;
};

export interface PANEL_SETUP_DIMENSIONS_BASE_PROPS {
  m_dimensionUnits: CHOICE;
  m_dimensionTextPositionMode: CHOICE;
  m_dimensionUnitsFormat: CHOICE;
  m_dimensionTextKeepAligned: CHECK;
  m_dimensionPrecision: CHOICE;
  m_dimensionArrowLength: UNIT_FIELD;
  m_dimensionSuppressZeroes: CHECK;
  m_dimensionExtensionOffset: UNIT_FIELD;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function PANEL_SETUP_DIMENSIONS_BASE(p: PANEL_SETUP_DIMENSIONS_BASE_PROPS): JSX.Element {
  const label = (aRow: number, aCol: number, aText: string, aFlag: number, aBorder = 5) => (
    <SizerItem pos={[aRow, aCol]} flag={aFlag} border={aBorder}>
      <StaticText label={aText} />
    </SizerItem>
  );
  const choice = (
    aRow: number,
    aCol: number,
    aChoices: readonly string[],
    c: CHOICE,
    aName: string,
    aTip?: string,
  ) => (
    <SizerItem pos={[aRow, aCol]} flag={wxEXPAND | CV | wxBOTTOM} border={5}>
      <Choice choices={aChoices} choice={c} ariaLabel={aName} title={aTip} />
    </SizerItem>
  );
  const unitField = (aRow: number, f: UNIT_FIELD, aName: string) => (
    <>
      <SizerItem pos={[aRow, 4]} flag={wxEXPAND | CV | wxBOTTOM} border={5}>
        <TextCtrl value={f.value} onChange={f.onChange} onBlur={f.onBlur} ariaLabel={aName} />
      </SizerItem>
      <SizerItem pos={[aRow, 5]} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
        <StaticText label={f.units} />
      </SizerItem>
    </>
  );

  return (
    // mainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={13}>
        <StaticText label={_('Default Properties for New Dimension Objects')} />
      </SizerItem>
      <Spacer width={0} height={2} border={5} />
      <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
        <StaticLine />
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
        {/* gbSizer1 = wxGridBagSizer( 0, 5 ) */}
        <GridBagSizer vgap={0} hgap={5}>
          {label(0, 0, _('Units:'), CV | wxBOTTOM | wxRIGHT)}
          {choice(
            0,
            1,
            [_('Inches'), _('Mils'), _('Millimeters'), _('Automatic')],
            p.m_dimensionUnits,
            'Units',
            _('Default units for dimensions ("automatic" to follow the chosen UI units)'),
          )}
          <Spacer width={0} height={0} pos={[0, 2]} flag={wxEXPAND | CV} border={5} />
          {label(0, 3, _('Text position:'), CV | wxBOTTOM | wxLEFT, 4)}
          {choice(
            0,
            4,
            [_('Outside'), _('Inline')],
            p.m_dimensionTextPositionMode,
            'Text position',
            _('Where to position the dimension text relative to the dimension line'),
          )}
          {label(1, 0, _('Units format:'), CV | wxBOTTOM | wxRIGHT)}
          {choice(
            1,
            1,
            ['1234', _('1234 mm'), _('1234 (mm)')],
            p.m_dimensionUnitsFormat,
            'Units format',
          )}
          <SizerItem pos={[1, 3]} span={[1, 2]} flag={CV | wxEXPAND | wxBOTTOM | wxLEFT} border={5}>
            <CheckBox
              label={_('Keep text aligned')}
              title={_('When checked, dimension text will be kept aligned with dimension lines')}
              check={p.m_dimensionTextKeepAligned}
            />
          </SizerItem>
          {label(2, 0, _('Precision:'), CV | wxBOTTOM | wxRIGHT)}
          {choice(
            2,
            1,
            ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'],
            p.m_dimensionPrecision,
            'Precision',
            _('How many digits of precision to show'),
          )}
          {label(2, 3, _('Arrow length:'), CV | wxBOTTOM | wxLEFT)}
          {unitField(2, p.m_dimensionArrowLength, 'Arrow length')}
          <SizerItem pos={[3, 0]} span={[1, 2]} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
            <CheckBox
              label={_('Suppress trailing zeroes')}
              title={_(
                'When checked, "1.2300" will be rendered as "1.23" even if precision is set to show more digits',
              )}
              check={p.m_dimensionSuppressZeroes}
            />
          </SizerItem>
          {label(3, 3, _('Extension line offset:'), CV | wxBOTTOM | wxLEFT)}
          {unitField(3, p.m_dimensionExtensionOffset, 'Extension line offset')}
        </GridBagSizer>
      </SizerItem>
    </BoxSizer>
  );
}
