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
  width,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
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
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
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
      <input
        type="color"
        value={hex}
        style={{ width: 44, height: 20, padding: 0, border: 'none', background: 'none' }}
        onChange={(e) => onChange(joinCss(e.target.value, 1))}
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
