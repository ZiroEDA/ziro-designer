// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZOOM_CORRECTION_CTRL` (common/widgets/zoom_correction_ctrl.cpp) — the whole
 * of Preferences > Common's "Scaling" group.
 *
 *     m_scalingSizer->Add( m_zoomCorrectionCtrl, 1, wxEXPAND );
 *     (panel_common_settings.cpp:120)
 *
 * The group has no other content: the heading, the rule, and this one panel.
 *
 * What it is for. A drawing program has to know how big a screen pixel is, or
 * a 10 mm pad cannot be drawn 10 mm across. The panel draws a RULER and asks
 * the user to hold a real one against it; whatever they have to change the PPI
 * to for the two to agree is the truth about their monitor.
 *
 * The arithmetic, verbatim (`:190`, `:197`, `:224`):
 *
 *     m_spinner->SetValue( (int)( aValue * m_baseValue ) );   // show
 *     return (double) m_spinner->GetValue() / m_baseValue;    // read
 *
 * so the spinner is a PPI and the stored setting is a ratio against the assumed
 * base. And the ruler (`:65-74`):
 *
 *     double dpi = ADVANCED_CFG::GetCfg().m_ScreenDPI;
 *     double unitsPerInch = 25.4;              // 2.54 for cm, 1.0 for inch
 *     double pxPerUnit = dpi / unitsPerInch * value;
 *
 * with a major tick every ten minor ones.
 *
 * A browser needs this MORE than a desktop app does, not less. `wxDisplay`
 * can at least ask the OS what the panel reports; a CSS pixel is defined only
 * as a ratio to the reference pixel, and the page is never told the physical
 * size of anything. So Detect is the best guess and the ruler is the answer.
 */
import { useId, type JSX } from 'react';
import { Combo } from '../ui/Combo.js';

/**
 * `ADVANCED_CFG::m_ScreenDPI`, whose default is 91
 * (common/advanced_config.cpp:339, range 50..500). [data]
 *
 * The base the stored ratio is against, so it must not be "corrected" to 96:
 * changing it would silently rescale every existing `zoom_correction_factor`.
 */
export const BASE_SCREEN_DPI = 91;

export type ZoomCorrectionUnits = 'mm' | 'cm' | 'inch';

/** `unitsPerInch` in the ruler's own arithmetic. [data] */
const UNITS_PER_INCH: Readonly<Record<ZoomCorrectionUnits, number>> = {
  mm: 25.4,
  cm: 2.54,
  inch: 1.0,
};

/**
 * `autoPressed` (`:235-257`) — what the display reports about itself.
 *
 * Upstream tries `wxDisplay::GetRawPPI()` and falls back to
 * `GetStdPPIValue() / GetScaleFactor()`. The browser's one equivalent is
 * `devicePixelRatio` against the 96 dpi CSS reference pixel, which is the same
 * shape of answer: what the platform claims, not what a ruler would say.
 */
export function detectScreenPpi(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  // 96 is the CSS reference pixel's dpi, fixed by the spec -- not a guess at
  // this monitor, which is the whole reason the ruler below exists. [data]
  return Math.round(96 * ratio);
}

/** Where a tick sits and whether it is labelled. */
interface Tick {
  readonly x: number;
  readonly major: boolean;
  readonly label?: string;
}

/**
 * The ruler's ticks for a given width. Pure, so the spacing can be tested
 * without rendering: a ruler that is wrong is wrong by a ratio, and a ratio is
 * exactly what a rendering test cannot see.
 */
export function rulerTicks(
  widthPx: number,
  factor: number,
  units: ZoomCorrectionUnits,
): readonly Tick[] {
  const pxPerUnit = (BASE_SCREEN_DPI / UNITS_PER_INCH[units]) * factor;
  if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) return [];

  // `int majorTickEvery = 10` -- ten minor ticks to a major one.
  const MAJOR_EVERY = 10;
  const out: Tick[] = [];
  for (let i = 0; ; i++) {
    const x = i * pxPerUnit;
    if (x > widthPx) break;
    const major = i % MAJOR_EVERY === 0;
    out.push(major ? { x, major, label: String(i) } : { x, major });
    // A ruler drawn at one tick per fraction of a pixel is a grey bar; stop
    // rather than emit thousands of them.
    if (out.length > 4000) break;
  }
  return out;
}

/** [px] the ruler's drawn height, and how far a major tick stands proud. */
const RULER_H = 34;
const MAJOR_TICK = 14;
const MINOR_TICK = 7;

export function ZoomCorrectionCtrl({
  /** `zoom_correction_factor` — the stored ratio, not the PPI. */
  value,
  onChange,
  units,
  onUnitsChange,
  width = 300,
}: {
  readonly value: number;
  readonly onChange: (v: number) => void;
  readonly units: ZoomCorrectionUnits;
  readonly onUnitsChange: (u: ZoomCorrectionUnits) => void;
  readonly width?: number;
}): JSX.Element {
  const id = useId();
  // `m_spinner->SetValue( (int)( aValue * m_baseValue ) )` -- truncation, as
  // the C++ cast does, not rounding.
  const ppi = Math.trunc(value * BASE_SCREEN_DPI);
  // `*m_value = m_spinner->GetValue() / m_baseValue`
  const setPpi = (p: number): void => onChange(p / BASE_SCREEN_DPI);

  const ticks = rulerTicks(width, value, units);

  return (
    <div className="ze-zoomcorrection">
      <div className="ze-pref-row">
        {/* `_( "Display PPI: " )` -- the trailing space is upstream's. */}
        <span className="lbl">Display PPI:</span>
        <input
          id={id}
          className="ze-search num"
          type="number"
          value={ppi}
          /* [data] `PARAM<double>` clamps the FACTOR to 0.1..10.0, so the PPI
             the spinner may hold is that range times the base. */
          min={Math.round(0.1 * BASE_SCREEN_DPI)}
          max={Math.round(10 * BASE_SCREEN_DPI)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) setPpi(v);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="button" className="ze-btn" onClick={() => setPpi(detectScreenPpi())}>
          Detect
        </button>
      </div>

      <div className="ze-zoomcorrection-ruler">
        <svg width={width} height={RULER_H} role="img" aria-label="Scaling ruler">
          {/* "Draw baseline" (`:55`) -- along the BOTTOM, with the ticks
              standing up from it. */}
          <line
            x1={0}
            y1={RULER_H - 0.5}
            x2={width}
            y2={RULER_H - 0.5}
            stroke="currentColor"
            strokeWidth={1}
          />
          {ticks.map((t) => (
            <g key={t.x}>
              <line
                x1={t.x + 0.5}
                y1={RULER_H - (t.major ? MAJOR_TICK : MINOR_TICK)}
                x2={t.x + 0.5}
                y2={RULER_H}
                stroke="currentColor"
                strokeWidth={1}
              />
              {t.label !== undefined && t.x + 12 < width && (
                <text x={t.x + 2} y={RULER_H - MAJOR_TICK - 3} fill="currentColor" fontSize="10">
                  {t.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        {/* `m_unitsChoice` is a wxChoice, so it is the app's own combo and not
            the browser's -- the one widget, everywhere. */}
        <Combo
          value={units}
          onChange={(v) => onUnitsChange(v as ZoomCorrectionUnits)}
          ariaLabel="Ruler units"
          /* ZOOM_CORRECTION_UNITS, in its own order, MM first. [data] */
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'cm', label: 'cm' },
            { value: 'inch', label: 'inch' },
          ]}
        />
      </div>
    </div>
  );
}
