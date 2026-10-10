// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Length-tuning Patterns. Counterpart:
 * `pcbnew/dialogs/panel_setup_tuning_patterns_base.cpp` (PANEL_SETUP_TUNING_PATTERNS)
 * - three groups stacked vertically (Single Track Tuning, Differential Pairs,
 * Differential Pair Skews), each an illustration + fields: minimum/maximum
 * amplitude, spacing, corner style (chamfer/fillet), radius (% of amplitude),
 * and single-sided. Defaults are PNS::MEANDER_SETTINGS (pns_meander.cpp).
 * Illustrations are KiCad's own dark-theme SVGs (BITMAPS::tune_*_legend).
 *
 * Each group is a heading + `wxStaticLine` (`.ze-pref-group-title`) over a
 * `wxFlexGridSizer( 0, 5, 5, 5 )` with column 1 growable — five columns, not
 * the seven this had. No SetFont anywhere in the panel, so no font size here:
 * the 12.5px headings, the 12px grid and the 11px units were all invented.
 */

import { CheckBox } from '@ziroeda/common/wx/controls.js';
import type { JSX } from 'react';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';

const icon = (name: string): string | undefined => svgUrl('tuning', name);

import { svgUrl } from '@ziroeda/bitmaps_png';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '../board.js';
import { MeanderStyle, type MeanderSettings } from '../router/pns_meander.js';

export type CornerStyle = 'Chamfer' | 'Fillet';

export interface TuningPattern {
  minAmplitudeMM: number;
  maxAmplitudeMM: number;
  spacingMM: number;
  cornerStyle: CornerStyle;
  radiusPct: number;
  singleSided: boolean;
}

export interface TuningSetup {
  singleTrack: TuningPattern;
  diffPair: TuningPattern;
  diffPairSkew: TuningPattern;
}

/** PANEL_SETUP_TUNING_PATTERNS's transfers (panel_setup_tuning_patterns.cpp). */
export const PANEL_SETUP_TUNING_PATTERNS = {
  TransferDataToWindow(aBoard: BOARD): TuningSetup {
    const bds = aBoard.GetDesignSettings();
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    const pattern = (s: MeanderSettings): TuningPattern => ({
      minAmplitudeMM: mm(s.minAmplitude),
      maxAmplitudeMM: mm(s.maxAmplitude),
      spacingMM: mm(s.spacing),
      cornerStyle: s.cornerStyle === MeanderStyle.MEANDER_STYLE_ROUND ? 'Fillet' : 'Chamfer',
      radiusPct: s.cornerRadiusPercentage,
      singleSided: s.singleSided,
    });
    return {
      singleTrack: pattern(bds.m_SingleTrackMeanderSettings),
      diffPair: pattern(bds.m_DiffPairMeanderSettings),
      diffPairSkew: pattern(bds.m_SkewMeanderSettings),
    };
  },

  TransferDataFromWindow(v: TuningSetup, aBoard: BOARD): void {
    const bds = aBoard.GetDesignSettings();
    const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
    const apply = (s: MeanderSettings, p: TuningPattern): void => {
      s.minAmplitude = iu(p.minAmplitudeMM);
      s.maxAmplitude = iu(p.maxAmplitudeMM);
      s.spacing = iu(p.spacingMM);
      s.cornerStyle =
        p.cornerStyle === 'Fillet'
          ? MeanderStyle.MEANDER_STYLE_ROUND
          : MeanderStyle.MEANDER_STYLE_CHAMFER;
      s.cornerRadiusPercentage = Math.trunc(p.radiusPct);
      s.singleSided = p.singleSided;
    };
    apply(bds.m_SingleTrackMeanderSettings, v.singleTrack);
    apply(bds.m_DiffPairMeanderSettings, v.diffPair);
    apply(bds.m_SkewMeanderSettings, v.diffPairSkew);
  },
};

// [data] `m_track_cornerCtrlChoices` (panel_setup_tuning_patterns_base.cpp:113).
const CORNER_STYLES: CornerStyle[] = ['Chamfer', 'Fillet'];

interface Props {
  value: TuningSetup;
  onChange: (next: TuningSetup) => void;
}

export function PanelPcbTuning({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);

  const group = (title: string, key: keyof TuningSetup, img: string): JSX.Element => {
    const s = value[key];
    const set = <K extends keyof TuningPattern>(k: K, v: TuningPattern[K]): void =>
      onChange({ ...value, [key]: { ...s, [k]: v } });

    const entry = (k: keyof TuningPattern): JSX.Element => (
      <input
        className="ze-search"
        value={s[k] as number}
        onChange={(e) => set(k, num(e.target.value) as never)}
      />
    );
    // Column 1 of the flexgrid is a `wxBoxSizer( wxHORIZONTAL )` holding the
    // control (proportion 1) and its unit label (`wxLEFT, 5`), not two cells.
    const entryWithUnit = (k: keyof TuningPattern, unit: string): JSX.Element => (
      <div className="ze-tune-entrybox">
        {entry(k)}
        <span className="unit">{unit}</span>
      </div>
    );
    const src = icon(img);

    return (
      <div className="ze-pref-group" key={key}>
        <div className="ze-pref-group-title">{title}</div>
        {/* `singleTrackSizer`, horizontal: the legend bitmap
            (`wxEXPAND|wxRIGHT|wxLEFT, 15`) then the field grid. */}
        <div className="ze-tune-body">
          {src && <img className="ze-tune-legend" src={src} alt="" aria-hidden="true" />}
          <div className="ze-tune-grid">
            {/* Row 1 */}
            <span>Minimum amplitude (A):</span>
            {entryWithUnit('minAmplitudeMM', 'mm')}
            <span className="ze-tune-col3">Maximum amplitude (A):</span>
            {entry('maxAmplitudeMM')}
            <span className="unit">mm</span>

            {/* Row 2 — the last three cells are spacers upstream. */}
            <span>Spacing (s):</span>
            {entryWithUnit('spacingMM', 'mm')}
            <span />
            <span />
            <span />

            {/* Row 3 — five spacers, the last of them 5 px tall. */}
            <div className="ze-tune-gap" />

            {/* Row 4 */}
            <span>Corner style:</span>
            <Combo
              value={s.cornerStyle}
              ariaLabel={`${title} corner style`}
              options={CORNER_STYLES.map((c) => ({ value: c, label: c }))}
              onChange={(c) => set('cornerStyle', c as CornerStyle)}
            />
            <span className="ze-tune-col3">Radius (r):</span>
            {entry('radiusPct')}
            <span className="unit">%</span>

            {/* Row 5 — the checkbox sits in column 1, under the entries. */}
            <span />
            <CheckBox
              label="Single-sided"
              checked={s.singleSided}
              className="ze-pref-check"
              onChange={(aChecked) => set('singleSided', aChecked)}
            />
            <span />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="ze-pref-page-natural">
      {group(
        'Default Properties for Single Track Tuning',
        'singleTrack',
        'tune_single_track_length_legend',
      )}
      {group(
        'Default Properties for Differential Pairs',
        'diffPair',
        'tune_diff_pair_length_legend',
      )}
      {group(
        'Default Properties for Differential Pair Skews',
        'diffPairSkew',
        'tune_diff_pair_skew_legend',
      )}
    </div>
  );
}
