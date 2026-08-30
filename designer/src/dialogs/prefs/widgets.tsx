// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The form helpers every Preferences panel is built from.
 *
 * Upstream these are wxFormBuilder-emitted wxCheckBox / wxSpinCtrl / wxChoice /
 * wxStaticBoxSizer / COLOR_SWATCH inside `common/dialogs/`, shared by every
 * `panel_*_base.cpp` in the book. Ours live here for the same reason: the
 * panels are owned by different editors and must still look identical.
 *
 * Moved verbatim out of `prefs/PreferencesDialog.tsx`; no behaviour change.
 */
import type { JSX, ReactNode } from 'react';
import { ColorSwatch } from '../../ui/ColorSwatch.js';
import { parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';

export function Check({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <label className="ze-pref-check" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Num({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step,
  width,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  /** `wxSpinCtrl::SetIncrement` — how far one arrow click moves the value. */
  step?: number;
  width?: number;
}): JSX.Element {
  return (
    <label className="ze-pref-row">
      <span className="lbl">{label}</span>
      <input
        type="number"
        className="ze-search num"
        value={value}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(step !== undefined ? { step } : {})}
        style={{ width: width ?? 80 }}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

export function Sel<T extends string | number>({
  label,
  value,
  options,
  onChange,
  unit,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  /** A trailing `wxStaticText`, as `l_gridLineWidthUnits`' "pixels" is. */
  unit?: string;
}): JSX.Element {
  return (
    <label className="ze-pref-row">
      <span className="lbl">{label}</span>
      <select
        className="ze-select"
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          onChange((typeof value === 'number' ? Number(raw) : raw) as T);
        }}
      >
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ze-pref-group">
      <div className="ze-pref-group-title">{title}</div>
      <div className="ze-pref-group-body">{children}</div>
    </div>
  );
}

/**
 * A `wxRB_GROUP` run of `wxRadioButton`s, which is what KiCad reaches for
 * wherever a choice is small and its options should all be visible at once —
 * `PANEL_GAL_OPTIONS`' grid style and crosshair shape are both this
 * (`common/dialogs/panel_gal_options_base.cpp:27-41` and `:100-112`), and a
 * `wxChoice` in their place hides two of the three answers behind a click.
 *
 * `name` is the radio group: every button sharing it is mutually exclusive,
 * which is what `wxRB_GROUP` declares. Two groups on one page must not share
 * one, so it is required rather than derived.
 *
 * `row` lays the buttons out horizontally after the label, as the grid style's
 * `wxBoxSizer( wxHORIZONTAL )` does; without it they stack, as the crosshair
 * shape's `wxFlexGridSizer( 0, 1, 3, 0 )` does.
 */
export function Radio<T extends string | number>({
  label,
  name,
  value,
  options,
  onChange,
  row,
  disabled,
  title,
}: {
  label?: string;
  name: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  row?: boolean;
  /** Shown, but not answerable here — the same treatment a control KiCad has
   *  and this app cannot back gets everywhere else. `title` says why. */
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <div className={row ? 'ze-pref-row' : 'ze-pref-radios'} title={title}>
      {label !== undefined && <span className="lbl">{label}</span>}
      {options.map(([v, l]) => (
        <label key={String(v)} className="ze-pref-radio">
          <input
            type="radio"
            name={name}
            checked={value === v}
            disabled={disabled}
            onChange={() => {
              onChange(v);
            }}
          />
          {l}
        </label>
      ))}
    </div>
  );
}

/** A label + colour swatch row (KiCad's COLOR_SWATCH). Empty value means "unset". */
export function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (css: string) => void;
}): JSX.Element {
  const hex = splitCss(value || fallback).hex;
  return (
    <label className="ze-pref-row">
      <span className="lbl">{label}</span>
      {/* COLOR_SWATCH (color_swatch.cpp:301-328), which every colour in
          KiCad is picked through - not the browser's popup, which opens
          off-screen on a control near the window edge. */}
      <ColorSwatch
        label={label}
        color={parseColor4d(value || fallback)}
        onChange={(picked) => onChange(toCssColor(picked, ', '))}
      />
    </label>
  );
}

// ----- colour helpers ---------------------------------------------------------------

/** CSS colour -> #rrggbb + alpha (for <input type=color> round-trips). */
export function splitCss(css: string): { hex: string; alpha: number } {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(css);
  if (m) {
    const h = (n: string): string => Number(n).toString(16).padStart(2, '0');
    return {
      hex: `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`,
      alpha: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  if (/^#[0-9a-f]{6}$/i.test(css)) return { hex: css, alpha: 1 };
  return { hex: '#000000', alpha: 1 };
}

export function joinCss(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
