// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxSpinCtrl` — an entry with the two stepper buttons GTK draws beside it.
 *
 * Upstream this is one widget used everywhere a dialog wants a bounded number:
 * "File history size" and "Maximum total backup size" on Preferences > Common
 * (`panel_common_settings_base.cpp:397`, `:466`), "3D cache file duration" on
 * Maintenance, `ZOOM_CORRECTION_CTRL`'s Display PPI
 * (`common/widgets/zoom_correction_ctrl.cpp:150`), and on down. A bare
 * `<input type="number">` is NOT that widget: the browser hides its steppers
 * until the pointer is over the field, so ours had no buttons where KiCad has
 * two, and the same control looked different on every page it appeared on.
 *
 * [px] `GtkSpinButton` asked for its own measurements on this machine and this
 * theme (`qa/probes/spin_ctrl_probe.py`): natural height 34, and the pair of
 * buttons is 70 wide — 35 each — once the entry is wide enough to stop
 * fighting the theme's 116 px minimum. That is `--spin-btn-w` / `--ctl-h` in
 * `shell.css`.
 *
 * The digits sit where GTK puts them, which is the LEFT of the entry: a
 * wxSpinCtrl sets no alignment, so `9` in KiCad's File history size hugs the
 * left edge. `.ze-search.num`'s right-aligned digits belong to a grid cell,
 * not to this.
 */
import type { JSX } from 'react';

export interface SpinCtrlProps {
  value: number;
  onChange: (v: number) => void;
  /** `wxSpinCtrl( …, min, max, initial )` — the range the control clamps to. */
  min?: number;
  max?: number;
  /** `SetIncrement` — how far one button press moves the value. */
  step?: number;
  /** The entry's width. The buttons are the theme's and are never sized here. */
  width?: number;
  /** `wxWindow::Enable( false )` — greyed and unreachable, but still drawn. */
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}

export function SpinCtrl({
  value,
  onChange,
  min,
  max,
  step = 1,
  width,
  disabled,
  id,
  ariaLabel,
}: SpinCtrlProps): JSX.Element {
  /** `wxSpinCtrl::SetValue` clamps to the range rather than refusing. */
  const clamp = (v: number): number => {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  };

  return (
    <div className="ze-spinctrl">
      <input
        id={id}
        aria-label={ariaLabel}
        className="ze-search"
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        style={width === undefined ? undefined : { width }}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v));
        }}
        onKeyDown={(e) => {
          // GTK steps the value on the arrow keys; the entry is text, so this
          // is the only thing that gives it back.
          if (e.key === 'ArrowUp') onChange(clamp(value + step));
          else if (e.key === 'ArrowDown') onChange(clamp(value - step));
          e.stopPropagation();
        }}
      />
      {/* GTK draws the decrement first, then the increment. */}
      <button
        type="button"
        className="ze-spinbtn"
        aria-label="Decrease"
        disabled={disabled || (min !== undefined && value <= min)}
        onClick={() => onChange(clamp(value - step))}
      >
        −
      </button>
      <button
        type="button"
        className="ze-spinbtn"
        aria-label="Increase"
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(clamp(value + step))}
      >
        +
      </button>
    </div>
  );
}
