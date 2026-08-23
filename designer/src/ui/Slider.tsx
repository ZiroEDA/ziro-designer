// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxSlider`, with `wxSL_LABELS` and `wxSL_VERTICAL` — the one in the app.
 *
 * wx has a single slider and KiCad opens it wherever it needs one: the image
 * converter's threshold (`bitmap2cmp_panel_base.cpp:150`), the colour picker's
 * Value and Opacity (`dialog_color_picker_base.cpp:122, 171`), the calculator's
 * current density. `wxSL_LABELS` is a STYLE BIT on that one control, not a
 * second widget, so there is one implementation of it here too.
 *
 * It was a block of rules scoped to `.imgc-frame` inside `imageConverter.css`,
 * reachable from exactly one launcher. The colour picker then wanted the same
 * control and got a bare `<input type="range">` instead: no value label, no
 * range ends, no accent fill — which is the per-editor copy CLAUDE.md names,
 * arriving as an ABSENCE rather than as a duplicate.
 *
 * `wxSL_INVERSE` is the other bit the colour picker's two sliders carry: the
 * maximum is at the TOP of a vertical scale rather than the bottom, which is
 * where a person expects "more" to be.
 */

import type { CSSProperties, JSX } from 'react';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** `wxSL_VERTICAL`. Horizontal is wx's default. */
  vertical?: boolean;
  /**
   * `wxSL_LABELS`: GTK draws the current value beside the thumb and the two
   * range ends at the ends of the track. Without the bit there are no labels
   * at all, which is a wxSlider built plain.
   */
  labels?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
}

export function Slider({
  value,
  min,
  max,
  onChange,
  vertical = false,
  labels = false,
  title,
  ariaLabel,
  className,
}: SliderProps): JSX.Element {
  // Where the thumb actually stands, 0..1. The CSS needs it because a range
  // input's thumb centre travels only between half a thumb in from each end,
  // so neither the accent fill nor the value label can be placed from `value`
  // alone.
  const frac = max > min ? (value - min) / (max - min) : 0;

  return (
    <div
      className={`ze-slider${vertical ? ' vertical' : ''}${labels ? ' labelled' : ''}${
        className ? ` ${className}` : ''
      }`}
      style={{ '--slider-frac': frac } as CSSProperties}
    >
      {labels && <span className="ze-slider-val">{Math.round(value)}</span>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        title={title}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {labels && (
        <span className="ze-slider-ends">
          {/* Low end first in the DOM; `wxSL_INVERSE` on a vertical scale is
              what puts the MAXIMUM at the top, and the CSS reverses them
              there rather than the caller passing them the other way round. */}
          <span>{min}</span>
          <span>{max}</span>
        </span>
      )}
    </div>
  );
}
