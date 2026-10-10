// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Teardrops. Counterpart:
 * `pcbnew/dialogs/panel_setup_teardrops_base.cpp` (PANEL_SETUP_TEARDROPS), three
 * groups stacked vertically (Round Shapes, Rectangular Shapes, Track-to-Track),
 * each an illustration beside ONE `wxGridBagSizer( 2, 3 )` of six columns:
 * label / control / units on the left, and the same three again on the right
 * starting at `wxLEFT, 40`. Best length, best width and the track-width limit
 * are percentages of the pad/via diameter (round) or width (rect/track);
 * maximum length/width are mm. Illustrations are KiCad's own dark-theme SVGs
 * (BITMAPS::teardrop_*_sizes), vendored like assets/constraints.
 *
 * Two things this had wrong beyond the font sizes:
 *
 *  - the percentage fields are `wxSpinCtrlDouble`s with a range and an
 *    increment (`:51`, `:93`, `:142`), so they carry GTK's stepper buttons.
 *    They were plain number inputs, whose steppers the browser hides until you
 *    hover them.
 *  - the units read `%(` + an ITALIC hint letter + ` )` — three static texts,
 *    the middle one `wxFONTSTYLE_ITALIC` at the dialog's own point size
 *    (`:66`, `:108`, `:159`) — not one grey 11px "%(d)".
 */

import { CheckBox, TextCtrl } from '@ziroeda/common/wx/controls.js';
import type { JSX } from 'react';
import { SpinCtrl } from '@ziroeda/common/widgets/spin_ctrl.js';

const icon = (name: string): string | undefined => svgUrl('teardrops', name);

import { svgUrl } from '@ziroeda/bitmaps_png';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '../board.js';
import { TARGET_TD } from '../teardrop/teardrop_parameters.js';

export interface TeardropShape {
  bestLengthPct: number;
  maxLengthMM: number;
  bestWidthPct: number;
  maxWidthMM: number;
  preferZoneConnection: boolean;
  trackWidthLimitPct: number;
  allowSpanTwoSegments: boolean;
  curvedEdges: boolean;
}

/**
 * `teardrop_options` in the project file: TEARDROP_PARAMETERS_LIST's target
 * flags. PANEL_SETUP_TEARDROPS does not show these - DIALOG_GLOBAL_EDIT_TEARDROPS
 * owns them - but they travel with the page's values so OK writes them back
 * unchanged.
 */
export interface TeardropTargets {
  /** m_TargetVias / `td_onvia`. */
  vias: boolean;
  /** m_TargetPTHPads / `td_onpthpad`. */
  pthPads: boolean;
  /** m_TargetSMDPads / `td_onsmdpad`. */
  smdPads: boolean;
  /** m_TargetTrack2Track / `td_ontrackend`. */
  trackToTrack: boolean;
  /** m_UseRoundShapesOnly / `td_onroundshapesonly`. */
  roundShapesOnly: boolean;
}

/** The three shape groups PANEL_SETUP_TEARDROPS edits, apart from the targets. */
export type TeardropShapeKey = 'round' | 'rect' | 'trackToTrack';

export interface TeardropsSetup {
  round: TeardropShape;
  rect: TeardropShape;
  trackToTrack: TeardropShape;
  targets: TeardropTargets;
}

/** PANEL_SETUP_TEARDROPS's transfers (panel_setup_teardrops.cpp). */
export const PANEL_SETUP_TEARDROPS = {
  TransferDataToWindow(aBoard: BOARD): TeardropsSetup {
    const tdl = aBoard.GetDesignSettings().GetTeadropParamsList();
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    const shape = (t: TARGET_TD): TeardropShape => {
      const p = tdl.GetParameters(t);
      return {
        maxLengthMM: mm(p.m_TdMaxLen),
        maxWidthMM: mm(p.m_TdMaxWidth),
        bestLengthPct: p.m_BestLengthRatio * 100.0,
        bestWidthPct: p.m_BestWidthRatio * 100.0,
        trackWidthLimitPct: p.m_WidthtoSizeFilterRatio * 100.0,
        preferZoneConnection: !p.m_TdOnPadsInZones,
        allowSpanTwoSegments: p.m_AllowUseTwoTracks,
        curvedEdges: p.m_CurvedEdges,
      };
    };
    return {
      round: shape(TARGET_TD.TARGET_ROUND),
      rect: shape(TARGET_TD.TARGET_RECT),
      trackToTrack: shape(TARGET_TD.TARGET_TRACK),
      targets: {
        vias: tdl.m_TargetVias,
        pthPads: tdl.m_TargetPTHPads,
        smdPads: tdl.m_TargetSMDPads,
        trackToTrack: tdl.m_TargetTrack2Track,
        roundShapesOnly: tdl.m_UseRoundShapesOnly,
      },
    };
  },

  TransferDataFromWindow(v: TeardropsSetup, aBoard: BOARD): void {
    const tdl = aBoard.GetDesignSettings().GetTeadropParamsList();
    const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
    const apply = (t: TARGET_TD, s: TeardropShape, withZone: boolean): void => {
      const p = tdl.GetParameters(t);
      p.m_BestLengthRatio = s.bestLengthPct / 100.0;
      p.m_BestWidthRatio = s.bestWidthPct / 100.0;
      p.m_TdMaxLen = iu(s.maxLengthMM);
      p.m_TdMaxWidth = iu(s.maxWidthMM);
      p.m_CurvedEdges = s.curvedEdges;
      p.m_WidthtoSizeFilterRatio = s.trackWidthLimitPct / 100.0;
      if (withZone) p.m_TdOnPadsInZones = !s.preferZoneConnection;
      p.m_AllowUseTwoTracks = s.allowSpanTwoSegments;
    };
    apply(TARGET_TD.TARGET_ROUND, v.round, true);
    apply(TARGET_TD.TARGET_RECT, v.rect, true);
    apply(TARGET_TD.TARGET_TRACK, v.trackToTrack, false);
    tdl.m_TargetVias = v.targets.vias;
    tdl.m_TargetPTHPads = v.targets.pthPads;
    tdl.m_TargetSMDPads = v.targets.smdPads;
    tdl.m_TargetTrack2Track = v.targets.trackToTrack;
    tdl.m_UseRoundShapesOnly = v.targets.roundShapesOnly;
  },
};

interface Props {
  value: TeardropsSetup;
  onChange: (next: TeardropsSetup) => void;
}

const SPAN_TIP =
  'Allows a teardrop to extend over the first 2 connected track segments if the first track ' +
  'segment is too short to accommodate the best length.';

export function PanelPcbTeardrops({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);

  const group = (
    title: string,
    key: TeardropShapeKey,
    opts: { img: string; ref: 'd' | 'w'; preferZone: boolean; spanLabel: string; note?: string },
  ): JSX.Element => {
    const s = value[key];
    const set = <K extends keyof TeardropShape>(k: K, v: TeardropShape[K]): void =>
      onChange({ ...value, [key]: { ...s, [k]: v } });

    // `%(` + the italic hint + ` )`, as three wxStaticTexts.
    const pct = (
      <span className="unit">
        {'%('}
        <i className="ze-td-hint">{opts.ref}</i>
        {' )'}
      </span>
    );
    // A `wxSpinCtrlDouble`: range and increment are the base file's own.
    const spin = (k: keyof TeardropShape, min: number): JSX.Element => (
      <SpinCtrl
        value={s[k] as number}
        min={min}
        max={100}
        step={10}
        onChange={(n) => set(k, n as never)}
      />
    );
    const entry = (k: keyof TeardropShape): JSX.Element => (
      <TextCtrl
        value={String(s[k] as number)}
        onChange={(aValue) => set(k, num(aValue) as never)}
        className="ze-search"
      />
    );
    const src = icon(opts.img);

    return (
      <div className="ze-pref-group" key={key}>
        <div className="ze-pref-group-title">{title}</div>
        {/* `bSizerShapeColumns`, horizontal: the bitmap column
            (`wxEXPAND|wxRIGHT, 10`), a 10 px spacer, then the gridbag
            (`wxEXPAND|wxLEFT, 20`). */}
        <div className="ze-td-body">
          {src && <img className="ze-td-legend" src={src} alt="" aria-hidden="true" />}
          <div className="ze-td-grid">
            {/* Row 0 */}
            <span>Best length (L):</span>
            {spin('bestLengthPct', 20)}
            {pct}
            <CheckBox
              label={opts.spanLabel}
              checked={s.allowSpanTwoSegments}
              title={SPAN_TIP}
              className="ze-pref-check ze-td-right"
              onChange={(aChecked) => set('allowSpanTwoSegments', aChecked)}
            />

            {/* Row 1 */}
            <span>Maximum length (L):</span>
            {entry('maxLengthMM')}
            <span className="unit">mm</span>
            {opts.preferZone ? (
              <CheckBox
                label="Prefer zone connection"
                checked={s.preferZoneConnection}
                className="ze-pref-check ze-td-right"
                onChange={(aChecked) => set('preferZoneConnection', aChecked)}
              />
            ) : (
              <span className="ze-td-right" />
            )}

            {/* Row 2 — `SetEmptyCellSize( wxSize( 10, 7 ) )`. */}
            <div className="ze-td-emptyrow" />

            {/* Row 3 */}
            <span>Best width (W):</span>
            {spin('bestWidthPct', 60)}
            {pct}
            <span className="ze-td-right">Track width limit:</span>
            {spin('trackWidthLimitPct', 0)}
            {pct}

            {/* Row 4 */}
            <span>Maximum width (W):</span>
            {entry('maxWidthMM')}
            <span className="unit">mm</span>
            <span />
            <span />
            <span />

            {/* Row 5 — the second empty row. */}
            <div className="ze-td-emptyrow" />

            {/* Row 6 */}
            <CheckBox
              label="Curved edges"
              checked={s.curvedEdges}
              className="ze-pref-check"
              onChange={(aChecked) => set('curvedEdges', aChecked)}
            />
          </div>
        </div>
        {opts.note && <div className="ze-pref-infotext ze-td-note">{opts.note}</div>}
      </div>
    );
  };

  return (
    <div className="ze-pref-page-natural">
      {group('Default Properties for Round Shapes', 'round', {
        img: 'teardrop_sizes',
        ref: 'd',
        preferZone: true,
        spanLabel: 'Allow teardrop to span two track segments',
      })}
      {group('Default Properties for Rectangular Shapes', 'rect', {
        img: 'teardrop_rect_sizes',
        ref: 'w',
        preferZone: true,
        spanLabel: 'Allow teardrop to span track segments',
      })}
      {group('Properties for Track-to-Track Teardrops', 'trackToTrack', {
        img: 'teardrop_track_sizes',
        ref: 'w',
        preferZone: false,
        spanLabel: 'Allow teardrop to span track segments',
        note: 'Tracks which are similar in size do not need teardrops.',
      })}
    </div>
  );
}
