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
import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { Combo } from '../ui/Combo.js';
import { SpinCtrl } from '../ui/SpinCtrl.js';

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
  /** `GetTextExtent( "000_" ).x`, the ruler's own minimum label spacing. */
  labelSpacingPx = 28,
): readonly Tick[] {
  const pxPerUnit = (BASE_SCREEN_DPI / UNITS_PER_INCH[units]) * factor;
  if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) return [];

  // `int majorTickEvery = 10` -- ten minor ticks to a major one. For mm
  // `tickLabelDiv` is 1, so a major tick is labelled with its own minor-tick
  // count: 10, 20, 30 ...
  let majorEvery = 10;
  let pxPerMinorTick = pxPerUnit;

  // `if( pxPerMinorTick < 3 )` (`:104-109`) -- when a millimetre is under three
  // pixels the ruler halves its resolution rather than drawing mush.
  if (pxPerMinorTick < 3) {
    pxPerMinorTick *= 2;
    majorEvery /= 2;
  }

  // `int minLabelSpacing = GetTextExtent( "000_" ).x` (`:73`) -- the label is
  // dropped, not the tick, when two would collide.
  const minLabelSpacing = labelSpacingPx;
  let lastLabelX = -minLabelSpacing;

  const out: Tick[] = [];
  for (let x = 0, i = 0; x <= widthPx; i++, x = i * pxPerMinorTick) {
    const major = i % majorEvery === 0;
    if (!major) {
      out.push({ x, major });
    } else {
      const labelNum = Math.round(i / (10 / majorEvery));
      // `if( labelNum > 0 && x < size.x - 10 && ( x - lastLabelX ) >= minLabelSpacing )`
      // -- so there is no "0" at the left end, and none crowding the right.
      if (labelNum > 0 && x < widthPx - 10 && x - lastLabelX >= minLabelSpacing) {
        out.push({ x, major, label: String(labelNum) });
        lastLabelX = x;
      } else {
        out.push({ x, major });
      }
    }
    // A ruler drawn at one tick per fraction of a pixel is a grey bar; stop
    // rather than emit thousands of them.
    if (out.length > 4000) break;
  }
  return out;
}

/**
 * The ruler panel's own size and its tick lengths, all upstream's:
 *
 *     ZOOM_CORRECTION_RULER( … aParent->FromDIP( wxSize( 200, 30 ) ) … )   :40
 *     dc.DrawLine( x, size.y - 1, x, size.y - 16 );   // major             :113
 *     dc.DrawLine( x, size.y - 1, x, size.y - 8 );    // minor             :130
 *
 * The 200 is a MINIMUM: `rulerSizer->Add( m_ruler, 1, wxEXPAND )` then gives
 * it every pixel the units choice leaves, which is why KiCad's ruler is as
 * wide as the Scaling group and ours -- fixed at 300 -- was not. [data]
 */
const RULER_H = 30;
const RULER_MIN_W = 200;
const MAJOR_TICK = 16;
const MINOR_TICK = 8;

export function ZoomCorrectionCtrl({
  /** `zoom_correction_factor` — the stored ratio, not the PPI. */
  value,
  onChange,
  units,
  onUnitsChange,
  disabled,
}: {
  readonly value: number;
  readonly onChange: (v: number) => void;
  readonly units: ZoomCorrectionUnits;
  readonly onUnitsChange: (u: ZoomCorrectionUnits) => void;
  /** `wxWindow::Enable( false )` on the whole panel — drawn, not answerable. */
  readonly disabled?: boolean;
}): JSX.Element {
  const id = useId();
  // `m_spinner->SetValue( (int)( aValue * m_baseValue ) )` -- truncation, as
  // the C++ cast does, not rounding.
  const ppi = Math.trunc(value * BASE_SCREEN_DPI);
  // `*m_value = m_spinner->GetValue() / m_baseValue`
  const setPpi = (p: number): void => onChange(p / BASE_SCREEN_DPI);

  /**
   * The ruler's width, asked of the layout rather than declared.
   *
   * `rulerSizer->Add( m_ruler, 1, wxEXPAND )` gives the ruler every pixel the
   * units choice leaves, and its ticks are laid out in the width it ENDS UP
   * with -- `OnPaint` reads `GetClientSize()`. A component that states its own
   * width instead draws a ruler that is right about millimetres and wrong
   * about how many of them fit, which is what a fixed 300 did here.
   */
  const ruler = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(RULER_MIN_W);

  useEffect(() => {
    const el = ruler.current;
    if (!el) return;
    // The RULER's own box, not its row's: the units choice sits in that row and
    // takes part of it, and ticks laid out to the row's width would run under
    // the choice and be clipped.
    const measure = (): void =>
      setWidth(Math.max(RULER_MIN_W, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const ticks = rulerTicks(width, value, units);

  return (
    <div className={`ze-zoomcorrection${disabled ? ' ze-disabled' : ''}`}>
      {/* `controlsSizer` (`:146-159`): the label, the spin control and Detect. */}
      <div className="ze-pref-row">
        {/* `_( "Display PPI: " )` -- the trailing space is upstream's. */}
        <span className="lbl">Display PPI:</span>
        {/* `m_spinner` is a wxSpinCtrl (`:150`), so it carries GTK's two
            stepper buttons; it was drawn here as a bare number field, which
            has none until the pointer is over it. */}
        <SpinCtrl
          id={id}
          ariaLabel="Display PPI"
          value={ppi}
          disabled={disabled}
          /* [data] `wxSpinCtrl( …, 10, 1000, … )` (`:150-151`) — upstream's own
             range, not the PARAM's. */
          min={10}
          max={1000}
          onChange={setPpi}
        />
        <button
          type="button"
          className="ze-btn"
          disabled={disabled}
          onClick={() => setPpi(detectScreenPpi())}
        >
          Detect
        </button>
      </div>

      {/* `rulerSizer` (`:161-176`): the ruler, then the units choice at its
          right — a wxBoxSizer( wxHORIZONTAL ), not a stack. */}
      <div className="ze-zoomcorrection-ruler">
        {/* `width="100%"`, never the measured number: an <svg> with a width
            attribute is laid out at that width, so writing the measured value
            back would make the ruler its own minimum size and the dialog would
            grow to fit it, then hand it more room. The CSS above states the
            200 px minimum and the proportion; this only has to fill it, and an
            SVG with no viewBox draws in CSS pixels either way. */}
        <svg ref={ruler} width="100%" height={RULER_H} role="img" aria-label="Scaling ruler">
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
              {t.label !== undefined && (
                // `dc.DrawText( label, x - textSize.x / 2, 0 )` (`:124`): the
                // number is CENTRED on its tick and sits at the top of the
                // panel. No font is stated -- upstream draws with the panel's,
                // and so does this.
                <text x={t.x} y={RULER_H - MAJOR_TICK - 2} fill="currentColor" textAnchor="middle">
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
          disabled={disabled}
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
