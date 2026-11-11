// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_TEARDROPS_BASE` (pcbnew/dialogs/panel_setup_teardrops_base.cpp): the panel's sizer
 * tree, Add() for Add() - three groups (round shapes, rectangular shapes, track to track), each a
 * bitmap column beside a wxGridBagSizer( 2, 3 ) with 10 x 7 empty cells. The groups differ in
 * their hint letter, a label, two tooltips and whether they have "Prefer zone connection", which
 * are passed in. The behaviour is PANEL_SETUP_TEARDROPS's (panel_setup_teardrops.tsx).
 */
import type { JSX } from 'react';
import {
  type CHECK,
  CheckBox,
  StaticBitmap,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_BOTTOM,
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, GridBagSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A UNIT_BINDER's control and units label. */
export type UNIT_FIELD = {
  value: string;
  onChange: (aText: string) => void;
  onBlur: () => void;
  units: string;
};
/** A wxSpinCtrlDouble with SetDigits( 0 ). */
export type SPIN = { value: number; onChange: (aValue: number) => void };

export interface TEARDROP_GROUP {
  /** The class's SetBitmap( KiBitmapBundle( BITMAPS::teardrop_*sizes ) ). */
  bitmap: string | undefined;
  m_spLenPercent: SPIN;
  m_tcTdMaxLen: UNIT_FIELD;
  m_spWidthPercent: SPIN;
  m_tcMaxWidth: UNIT_FIELD;
  /** Absent in the track-to-track group. */
  m_cbPreferZoneConnection?: CHECK;
  m_spTeardropHDPercent: SPIN;
  m_cbTeardropsUseNextTrack: CHECK;
  m_cbCurvedEdges: CHECK;
}

export interface PANEL_SETUP_TEARDROPS_BASE_PROPS {
  round: TEARDROP_GROUP;
  rect: TEARDROP_GROUP;
  track: TEARDROP_GROUP;
}

const CV = wxALIGN_CENTER_VERTICAL;
const SPAN_TIP = _HKI(
  'Allows a teardrop to extend over the first 2 connected track segments if the first track segment is too short to accommodate the best length.',
);
const ZONE_TIP = _HKI(
  'Do not create teardrops on tracks connected to pads that are also connected to a copper zone.',
);

/** What one group's text says, and the few Add() flags that differ. */
interface GROUP_TEXT {
  title: string;
  name: string;
  /** The italic letter in "%( d )": the pad diameter, or the track width. */
  hint: string;
  span: string;
  hdLabelTip: string;
  hdTip: string;
  /** bSizer1311 / bSizer1221 / bSizer12211: the three Add() flags of the "%( x )" row. */
  hdHintFlags: readonly [number, number, number];
  /** bSizer122: the round group's best-length row is CV, the others wxEXPAND|CV. */
  lenHintBox: number;
}

export function PANEL_SETUP_TEARDROPS_BASE(p: PANEL_SETUP_TEARDROPS_BASE_PROPS): JSX.Element {
  /** "%(", the italic hint at wxALIGN_BOTTOM 1, " )". */
  const hintRow = (
    aHint: string,
    aFlags: readonly [number, number, number] = [CV, wxALIGN_BOTTOM, CV],
  ) => (
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={aFlags[0]} border={aFlags[0] === (wxALIGN_BOTTOM | wxBOTTOM) ? 1 : 5}>
        <StaticText label="%(" />
      </SizerItem>
      <SizerItem flag={aFlags[1]} border={aFlags[1] === wxALIGN_BOTTOM ? 1 : 5}>
        {/* SetFont( wxNORMAL_FONT size, wxFONTSTYLE_ITALIC ) */}
        <StaticText label={aHint} italic />
      </SizerItem>
      <SizerItem flag={aFlags[2]} border={aFlags[2] === (wxALIGN_BOTTOM | wxBOTTOM) ? 1 : 5}>
        <StaticText label=" )" />
      </SizerItem>
    </BoxSizer>
  );
  const spin = (s: SPIN, aMin: number, aMax: number, aName: string, aTip?: string) => (
    <SpinCtrl
      value={s.value}
      onChange={s.onChange}
      min={aMin}
      max={aMax}
      step={10}
      digits={0}
      ariaLabel={aName}
      title={aTip}
    />
  );
  const unitRow = (aRow: number, aLabel: string, u: UNIT_FIELD, aName: string) => (
    <>
      <SizerItem pos={[aRow, 0]} flag={CV} border={5}>
        <StaticText label={aLabel} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={CV | wxEXPAND} border={5}>
        <TextCtrl value={u.value} onChange={u.onChange} onBlur={u.onBlur} ariaLabel={aName} />
      </SizerItem>
      <SizerItem pos={[aRow, 2]} flag={CV} border={5}>
        <StaticText label={u.units} />
      </SizerItem>
    </>
  );

  const group = (g: TEARDROP_GROUP, t: GROUP_TEXT) => (
    <>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={13}>
        <StaticText label={t.title} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={2}>
        <StaticLine />
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
        {/* bSizerShapeColumns */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxEXPAND | wxRIGHT} border={10}>
            {/* bSizerLeftCol */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem
                proportion={1}
                flag={wxALIGN_CENTER_HORIZONTAL | wxRIGHT | wxLEFT}
                border={5}
              >
                <StaticBitmap bitmap={g.bitmap} />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={10} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxEXPAND | wxLEFT} border={20}>
            {/* gbSizer = wxGridBagSizer( 2, 3 ), SetEmptyCellSize( wxSize( 10, 7 ) ) */}
            <GridBagSizer vgap={2} hgap={3} emptyCellSize={[10, 7]}>
              <SizerItem pos={[0, 0]} flag={CV} border={5}>
                <StaticText label={_('Best length (L):')} />
              </SizerItem>
              <SizerItem pos={[0, 1]} flag={CV | wxEXPAND} border={5}>
                {spin(g.m_spLenPercent, 20, 100, `${t.name} best length`)}
              </SizerItem>
              <SizerItem pos={[0, 2]} flag={t.lenHintBox} border={5}>
                {hintRow(t.hint)}
              </SizerItem>
              {unitRow(1, _('Maximum length (L):'), g.m_tcTdMaxLen, `${t.name} maximum length`)}
              <SizerItem pos={[3, 0]} flag={CV} border={5}>
                <StaticText label={_('Best width (W):')} />
              </SizerItem>
              <SizerItem pos={[3, 1]} flag={CV | wxEXPAND} border={5}>
                {spin(g.m_spWidthPercent, 60, 100, `${t.name} best width`)}
              </SizerItem>
              <SizerItem pos={[3, 2]} flag={wxEXPAND | CV} border={5}>
                {hintRow(t.hint)}
              </SizerItem>
              {unitRow(4, _('Maximum width (W):'), g.m_tcMaxWidth, `${t.name} maximum width`)}
              {g.m_cbPreferZoneConnection && (
                <SizerItem pos={[1, 3]} span={[1, 3]} flag={CV | wxLEFT} border={40}>
                  <CheckBox
                    label={_('Prefer zone connection')}
                    title={ZONE_TIP}
                    check={g.m_cbPreferZoneConnection}
                  />
                </SizerItem>
              )}
              <SizerItem pos={[3, 3]} flag={CV | wxLEFT} border={40}>
                <StaticText label={_('Track width limit:')} title={t.hdLabelTip} />
              </SizerItem>
              <SizerItem pos={[3, 4]} flag={CV} border={5}>
                {spin(g.m_spTeardropHDPercent, 0, 100, `${t.name} track width limit`, t.hdTip)}
              </SizerItem>
              <SizerItem pos={[3, 5]} flag={wxEXPAND | CV} border={5}>
                {hintRow(t.hint, t.hdHintFlags)}
              </SizerItem>
              <SizerItem pos={[0, 3]} span={[1, 3]} flag={CV | wxLEFT} border={40}>
                <CheckBox label={t.span} title={SPAN_TIP} check={g.m_cbTeardropsUseNextTrack} />
              </SizerItem>
              <SizerItem pos={[6, 0]} border={5}>
                <CheckBox label={_('Curved edges')} check={g.m_cbCurvedEdges} />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </>
  );

  const PAD_LIMIT_TIP = _(
    'Max pad/via size to track width ratio to create a teardrop.\n100 always creates a teardrop.',
  );

  return (
    // mainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxLEFT} border={5}>
        {/* m_gridSizer */}
        <BoxSizer orient={wxVERTICAL}>
          {group(p.round, {
            title: _('Default Properties for Round Shapes'),
            name: 'Round shapes',
            hint: 'd',
            span: _('Allow teardrop to span two track segments'),
            hdLabelTip: PAD_LIMIT_TIP,
            hdTip: _('Tracks which are similar in size to the pad or via do not need teardrops.'),
            hdHintFlags: [CV, wxALIGN_BOTTOM, CV],
            lenHintBox: wxEXPAND | CV,
          })}
          <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
          {group(p.rect, {
            title: _('Default Properties for Rectangular Shapes'),
            name: 'Rectangular shapes',
            hint: 'w',
            span: _('Allow teardrop to span track segments'),
            hdLabelTip: PAD_LIMIT_TIP,
            hdTip: _('Tracks which are similar in size to the pad do not need teardrops.'),
            hdHintFlags: [0, wxALIGN_BOTTOM, CV],
            lenHintBox: CV,
          })}
          <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
          {group(p.track, {
            title: _('Properties for Track-to-Track Teardrops'),
            name: _('Track to track'),
            hint: 'w',
            span: _('Allow teardrop to span track segments'),
            hdLabelTip: _(
              'Max track width ratio to create a teardrop.\n100 always creates a teardrop.',
            ),
            hdTip: _('Tracks which are similar in size do not need teardrops.'),
            hdHintFlags: [CV, CV, wxALIGN_BOTTOM | wxBOTTOM],
            lenHintBox: wxEXPAND | CV,
          })}
          <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
