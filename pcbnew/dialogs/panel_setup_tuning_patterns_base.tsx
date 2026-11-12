// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_TUNING_PATTERNS_BASE` (pcbnew/dialogs/panel_setup_tuning_patterns_base.cpp): the
 * panel's sizer tree, Add() for Add() - three blocks (single track, differential pair, skew), each
 * a legend bitmap beside a five-column wxFlexGridSizer( 0, 5, 5, 5 ) growing column 1. The blocks
 * differ only in a few Add() flags, which are passed in. The behaviour is
 * PANEL_SETUP_TUNING_PATTERNS's (panel_setup_tuning_patterns.tsx).
 */
import type { JSX } from 'react';
import { TextCtrlEval } from '@ziroeda/common/widgets/text_ctrl_eval.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticBitmap,
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
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** A UNIT_BINDER's control and units label. */
export type UNIT_FIELD = {
  value: string;
  onChange: (aText: string) => void;
  onBlur: () => void;
  units: string;
};

export interface TUNING_BLOCK {
  /** The class's SetBitmap( KiBitmapBundle( BITMAPS::tune_*_legend ) ). */
  legend: string | undefined;
  minA: UNIT_FIELD;
  maxA: UNIT_FIELD;
  spacing: UNIT_FIELD;
  corner: CHOICE;
  r: UNIT_FIELD;
  singleSided: CHECK;
}

export interface PANEL_SETUP_TUNING_PATTERNS_BASE_PROPS {
  track: TUNING_BLOCK;
  dp: TUNING_BLOCK;
  skew: TUNING_BLOCK;
}

const CV = wxALIGN_CENTER_VERTICAL;
const SPACING_TIP = _HKI(
  'Minimum spacing between adjacent tuning segments. The resulting spacing may be greater based on design rules.',
);

/** The per-block Add() flags that differ between the three. */
interface FLAGS {
  spacingBox: number;
  singleSided: number;
  outer: number;
}

export function PANEL_SETUP_TUNING_PATTERNS_BASE(
  p: PANEL_SETUP_TUNING_PATTERNS_BASE_PROPS,
): JSX.Element {
  const block = (aTitle: string, aName: string, b: TUNING_BLOCK, f: FLAGS) => {
    const entry = (aLabel: string, u: UNIT_FIELD, aTip?: string) => (
      <TextCtrl
        value={u.value}
        onChange={u.onChange}
        onBlur={u.onBlur}
        title={aTip}
        ariaLabel={`${aName} ${aLabel}`}
      />
    );
    // A spacer cell: Add( 0, 0, 1, wxEXPAND, 5 ).
    const gap = (aHeight = 0) => (
      <Spacer width={0} height={aHeight} proportion={1} flag={wxEXPAND} border={5} />
    );

    return (
      <>
        <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={13}>
          <StaticText label={aTitle} />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={2}>
          <StaticLine />
        </SizerItem>
        <SizerItem flag={f.outer} border={5}>
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={15}>
              <StaticBitmap bitmap={b.legend} />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              <FlexGridSizer cols={5} vgap={5} hgap={5} growableCols={[1]}>
                <SizerItem flag={CV} border={5}>
                  <StaticText label={_('Minimum amplitude (A):')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} border={5}>
                      {entry('minimum amplitude', b.minA)}
                    </SizerItem>
                    <SizerItem flag={CV | wxLEFT} border={5}>
                      <StaticText label={b.minA.units} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem flag={CV | wxLEFT} border={15}>
                  <StaticText label={_('Maximum amplitude (A):')} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | CV} border={5}>
                  {entry('maximum amplitude', b.maxA)}
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <StaticText label={b.maxA.units} />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <StaticText label={_('Spacing (s):')} title={SPACING_TIP} />
                </SizerItem>
                <SizerItem proportion={1} flag={f.spacingBox} border={5}>
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={CV} border={5}>
                      {entry('spacing', b.spacing, SPACING_TIP)}
                    </SizerItem>
                    <SizerItem flag={CV | wxLEFT} border={5}>
                      <StaticText label={b.spacing.units} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                {gap()}
                {gap()}
                {gap()}
                {gap()}
                {gap()}
                {gap()}
                {gap()}
                {gap(5)}
                <SizerItem proportion={1} flag={CV} border={5}>
                  <StaticText label={_('Corner style:')} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | CV} border={5}>
                  <Choice
                    choices={[_('Chamfer'), _('Fillet')]}
                    choice={b.corner}
                    ariaLabel={wxFormat(_('%s corner style'), aName)}
                  />
                </SizerItem>
                <SizerItem flag={CV | wxLEFT} border={15}>
                  <StaticText label={_('Radius (r):')} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | CV} border={5}>
                  <TextCtrlEval
                    value={b.r.value}
                    onChange={b.r.onChange}
                    ariaLabel={wxFormat(_('%s radius'), aName)}
                  />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <StaticText label={b.r.units} />
                </SizerItem>
                {gap()}
                <SizerItem flag={f.singleSided} border={5}>
                  <CheckBox label={_('Single-sided')} check={b.singleSided} />
                </SizerItem>
                {gap()}
              </FlexGridSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </>
    );
  };

  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      {block(_('Default Properties for Single Track Tuning'), _HKI('Single track'), p.track, {
        spacingBox: wxEXPAND | CV,
        singleSided: wxEXPAND | CV,
        outer: wxEXPAND | wxTOP | wxRIGHT,
      })}
      <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
      {block(_('Default Properties for Differential Pairs'), _HKI('Differential pair'), p.dp, {
        spacingBox: wxEXPAND,
        singleSided: wxEXPAND | CV,
        outer: wxEXPAND | wxTOP | wxRIGHT,
      })}
      <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
      {block(_('Default Properties for Differential Pair Skews'), 'Skew', p.skew, {
        spacingBox: wxEXPAND,
        singleSided: wxALL,
        outer: wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT,
      })}
    </BoxSizer>
  );
}
