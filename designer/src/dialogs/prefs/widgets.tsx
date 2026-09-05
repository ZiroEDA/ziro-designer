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
import { Combo } from '../../ui/Combo.js';
import { ColorSwatch } from '../../ui/ColorSwatch.js';
import { SpinCtrl } from '../../ui/SpinCtrl.js';
import { parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';

/**
 * wx border flags -> the classes `.ze-pref-group-body` reads.
 *
 * One helper rather than one per widget: the flags mean the same thing on every
 * control, exactly as `wxTOP` does, and a second copy is how two widgets in the
 * same group end up spaced differently for no reason.
 */
export function sizerBorders(flags: readonly ('top' | 'bottom')[] | undefined): string {
  // The default: `wxBOTTOM|wxLEFT|wxRIGHT, 5`, which is most Add() calls here.
  const f = flags ?? ['bottom'];
  return `${f.includes('top') ? ' ze-border-top' : ''}${f.includes('bottom') ? '' : ' ze-border-none'}`;
}

export function Check({
  label,
  checked,
  onChange,
  borders,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /**
   * This checkbox's own `Add()` border flags. See {@link sizerBorders}.
   *
   * A checkbox is added with the same flags as any other row and KiCad varies
   * them per Add() — the first box of a group usually carries `wxTOP` as well
   * (`wxTOP|wxBOTTOM|wxLEFT, 5` on Show D codes and `wxALL, 5` on Sketch
   * flashed items, `panel_gerbview_display_options_base.cpp:38`, `:65`) while
   * the ones under it do not. Left out, the row takes `['bottom']`, which is
   * what nearly every Add() in these panels carries and what this component
   * drew before it could be told otherwise.
   */
  borders?: readonly ('top' | 'bottom')[];
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <label className={`ze-pref-check${sizerBorders(borders)}`} title={title}>
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
  digits,
  width,
  spin,
  disabled,
  title,
  borders,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  /**
   * Whether the control is a `wxSpinCtrl` (the default here) or a plain
   * `wxTextCtrl`. KiCad picks one or the other per row and they do not look
   * alike: a spin control carries GTK's two stepper buttons and a text control
   * has none. "High-contrast mode dimming factor" is
   * `m_highContrastCtrl`, a `wxTextCtrl`
   * (`panel_common_settings_base.cpp:283`), and drawing it with arrows put a
   * widget on the page that upstream does not have there.
   */
  spin?: boolean;
  /** This row's own `Add()` border flags. See {@link sizerBorders}. */
  borders?: readonly ('top' | 'bottom')[];
  /** `wxWindow::Enable( false )` — greyed and unreachable, but still drawn. */
  disabled?: boolean;
  /** The control's `SetToolTip`. Carries the reason when `disabled` is set. */
  title?: string;
  min?: number;
  max?: number;
  /** `wxSpinCtrl::SetIncrement` — how far one arrow click moves the value. */
  step?: number;
  /**
   * `wxSpinCtrlDouble::SetDigits` — set it and the row is a FRACTIONAL spin
   * control rather than an integer one, which is a different wx class and a
   * visibly different field: `0.60`, not `0.6`. See `ui/SpinCtrl.tsx`.
   */
  digits?: number;
  width?: number;
}): JSX.Element {
  return (
    <label className={`ze-pref-row${sizerBorders(borders)}`} title={title}>
      <span className="lbl">{label}</span>
      {spin === false ? (
        // A `wxTextCtrl`: no stepper buttons, and the entry's own alignment.
        <input
          type="text"
          className="ze-search"
          value={value}
          disabled={disabled}
          style={{ width: width ?? 80 }}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        // A `wxSpinCtrl`, which is the shared widget and not a number input:
        // the browser hides its steppers until hovered, and KiCad's are always
        // drawn.
        <SpinCtrl
          value={value}
          onChange={onChange}
          disabled={disabled}
          {...(min !== undefined ? { min } : {})}
          {...(max !== undefined ? { max } : {})}
          {...(step !== undefined ? { step } : {})}
          {...(digits !== undefined ? { digits } : {})}
          {...(width !== undefined ? { width } : {})}
        />
      )}
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
  disabled,
  title,
  ariaLabel,
  stacked,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  /** A trailing `wxStaticText`, as `l_gridLineWidthUnits`' "pixels" is. */
  unit?: string;
  /** `wxWindow::Enable( false )` — greyed and unreachable, but still drawn. */
  disabled?: boolean;
  /** The control's `SetToolTip`. Carries the reason when `disabled` is set. */
  title?: string;
  /**
   * The choice's own accessible name, where the label beside it is not the one
   * a reader should hear. Left out, the `<span class="lbl">` next to it is.
   */
  ariaLabel?: string;
  /**
   * The label on its own line with the choice stretched under it — what a
   * VERTICAL sizer does when the two are separate `Add()`s rather than one
   * horizontal sizer. Both Arc editing mode panels are that shape, because the
   * longest entry ("Keep endpoints or direction of starting point") does not
   * fit beside a label.
   *
   * The numbers are the wx borders of those Add()s, and they are stated here
   * rather than in the class because they differ per panel — a uniform gap is
   * exactly what would flatten the difference:
   *
   *   * `gap` — the space between the label and the choice.
   *   * `above` — an explicit spacer `Add()` before the label, on top of the
   *     previous row's own wxBOTTOM.
   */
  stacked?: { gap: number; above?: number };
}): JSX.Element {
  // The app's own combo, never the browser's -- see the note at the call below.
  const combo = (
    <Combo
      value={String(value)}
      disabled={disabled}
      ariaLabel={ariaLabel}
      options={options.map(([v, l]) => ({ value: String(v), label: l }))}
      onChange={(raw) => onChange((typeof value === 'number' ? Number(raw) : raw) as T)}
    />
  );

  if (stacked) {
    return (
      <div
        className="ze-pref-stacked"
        title={title}
        style={{
          gap: stacked.gap,
          ...(stacked.above !== undefined ? { marginTop: stacked.above } : {}),
        }}
      >
        <span className="lbl">{label}</span>
        {combo}
        {unit && <span className="unit">{unit}</span>}
      </div>
    );
  }

  return (
    // Not a <label>: `Combo` is a button, and wrapping a button in a label
    // makes every click on the text toggle it open and shut again.
    <div className="ze-pref-row" title={title}>
      <span className="lbl">{label}</span>
      {/* The app's own combo, never the browser's. A wxChoice is owner-drawn --
          it takes the GTK theme, and its entries can carry a swatch or a KiCad
          bitmap (`Append( name, KiBitmapBundle( … ) )`), which a native
          <select> cannot draw at all. One widget for every dropdown in the app
          is also the only way they stay identical; a native one here would be
          the single control on the page that is not ours. */}
      {combo}
      {unit && <span className="unit">{unit}</span>}
    </div>
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
 *
 * A row is `.ze-pref-radiorow`, NOT `.ze-pref-row`. The two are laid out by
 * different sizers upstream and so are spaced differently: a `.ze-pref-row` is
 * a gbSizer cell, whose labels line up in a column, while every radio row in
 * these panels is a bare `wxBoxSizer( wxHORIZONTAL )` whose label takes its own
 * width and whose children each carry `wxALL, 5` -- Icon theme
 * (`panel_common_settings_base.cpp:202-226`), Toolbar icon size (`:228-251`)
 * and PANEL_GAL_OPTIONS' grid Style (`panel_gal_options_base.cpp:23-41`) are
 * all that shape. Drawing them in the label column pushed the radios a fixed
 * 150 px right, which is why ours lined up with each other and KiCad's do not.
 */
export function Radio<T extends string | number>({
  label,
  name,
  value,
  options,
  onChange,
  row,
  borders,
  borderSpaced,
  disabled,
  title,
}: {
  label?: string;
  name: string;
  value: T;
  /**
   * `[value, label]`, or `[value, label, tooltip]` where the BUTTON carries a
   * `SetToolTip` of its own — every radio in Icon theme and Toolbar icon size
   * does (`panel_common_settings_base.cpp:206-251`), and wx puts the tip on
   * the button, not on the row.
   */
  options: readonly (readonly [T, string, string?])[];
  onChange: (v: T) => void;
  row?: boolean;
  /**
   * Where the space BETWEEN stacked buttons comes from.
   *
   * Unset, it is the sizer's own vgap — `wxFlexGridSizer( 0, 1, 3, 0 )`, which
   * is how `PANEL_GAL_OPTIONS` lays its crosshair shapes out
   * (`panel_gal_options_base.cpp:100`), so 3.
   *
   * Set, the sizer is a plain `wxBoxSizer( wxVERTICAL )` with no gap at all and
   * every button carries its own `wxTOP, 5` — Page Size on Preferences >
   * Gerber Viewer > Display Options
   * (`panel_gerbview_display_options_base.cpp:109-133`), so 5. Two different
   * sizers, two different numbers; a single uniform gap here is what would
   * lose that.
   */
  borderSpaced?: boolean;
  /**
   * The border flags this row's own `Add()` states — the wx ones, spelled the
   * same way, because they are independent and combine:
   *
   *     Add( bSizerIconsTheme,   0, wxEXPAND|wxTOP, 5 )        ['top']
   *     Add( bSizerToolbarSize,  0, wxEXPAND, 5 )              []
   *     Add( bSizerHighContrast, 0, wxEXPAND|wxTOP|wxBOTTOM, 5 ) ['top','bottom']
   *
   * Left out entirely, the row takes `['bottom']`, which is what nearly every
   * Add() in these panels carries and what every other page already looks
   * like. See `.ze-pref-group-body`.
   */
  borders?: readonly ('top' | 'bottom')[];
  /** Shown, but not answerable here — the same treatment a control KiCad has
   *  and this app cannot back gets everywhere else. `title` says why. */
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  const borderClass = sizerBorders(borders);
  return (
    <div
      className={`${row ? 'ze-pref-radiorow' : 'ze-pref-radios'}${
        borderSpaced === true ? ' ze-gap-5' : ''
      }${borderClass}`}
      title={title}
    >
      {label !== undefined && <span className="lbl">{label}</span>}
      {options.map(([v, l, tip]) => (
        <label key={String(v)} className="ze-pref-radio" title={tip}>
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

/**
 * A label + colour swatch row (KiCad's COLOR_SWATCH).
 *
 * An empty value is `COLOR4D::UNSPECIFIED`, which is a fully transparent
 * colour — and `COLOR_SWATCH::MakeBitmap` lays a checkerboard down and paints
 * the colour over it at its own alpha (`color_swatch.cpp:78-133`), so unset
 * draws as the bare checkerboard. That is what a fresh KiCad shows for
 * eeschema's Sheet border and Sheet background, whose PARAMs default to
 * UNSPECIFIED (`eeschema_settings.cpp:396-400`).
 *
 * `fallback` is therefore only for the rows whose setting has a real default:
 * pass none and unset stays unset. Substituting a colour for every empty value
 * is what painted those two swatches solid red and cream.
 */
export function ColorRow({
  label,
  value,
  fallback,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  /** A real default, where the setting has one. Omit for `UNSPECIFIED`. */
  fallback?: string;
  onChange: (css: string) => void;
  /** `wxWindow::Enable( false )` — drawn, but not answerable here. */
  disabled?: boolean;
}): JSX.Element {
  const hex = splitCss(value || fallback || '').hex;
  return (
    <label className="ze-pref-row">
      <span className="lbl">{label}</span>
      {/* COLOR_SWATCH (color_swatch.cpp:301-328), which every colour in
          KiCad is picked through - not the browser's popup, which opens
          off-screen on a control near the window edge. */}
      <ColorSwatch
        disabled={disabled}
        label={label}
        // [data] `COLOR4D::UNSPECIFIED` is `COLOR4D( 0, 0, 0, 0 )`
        // (`include/gal/color4d.h`) — fully transparent, which is what the
        // swatch draws as the bare checkerboard.
        color={parseColor4d(value || fallback || 'rgba(0, 0, 0, 0)')}
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
