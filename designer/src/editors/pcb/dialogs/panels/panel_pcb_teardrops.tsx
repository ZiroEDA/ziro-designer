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

import type { JSX } from 'react';
import { SpinCtrl } from '../../../../ui/SpinCtrl.js';

const TD_ICON = import.meta.glob('../../../../assets/teardrops/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const icon = (name: string): string | undefined =>
  TD_ICON[`../../../../assets/teardrops/${name}.svg`];

import type { TeardropsSetup, TeardropShape, TeardropShapeKey } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultTeardrops,
  type TeardropShape,
  type TeardropsSetup,
} from '../../board_settings.js';

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
      <input
        className="ze-search"
        value={s[k] as number}
        onChange={(e) => set(k, num(e.target.value) as never)}
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
            <label className="ze-pref-check ze-td-right" title={SPAN_TIP}>
              <input
                type="checkbox"
                checked={s.allowSpanTwoSegments}
                onChange={(e) => set('allowSpanTwoSegments', e.target.checked)}
              />
              {opts.spanLabel}
            </label>

            {/* Row 1 */}
            <span>Maximum length (L):</span>
            {entry('maxLengthMM')}
            <span className="unit">mm</span>
            {opts.preferZone ? (
              <label className="ze-pref-check ze-td-right">
                <input
                  type="checkbox"
                  checked={s.preferZoneConnection}
                  onChange={(e) => set('preferZoneConnection', e.target.checked)}
                />
                Prefer zone connection
              </label>
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
            <label className="ze-pref-check">
              <input
                type="checkbox"
                checked={s.curvedEdges}
                onChange={(e) => set('curvedEdges', e.target.checked)}
              />
              Curved edges
            </label>
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
