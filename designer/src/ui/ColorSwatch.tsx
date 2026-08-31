// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COLOR_SWATCH` — `common/widgets/color_swatch.cpp`.
 *
 * Every colour a KiCad user picks is picked through this one widget. It draws
 * the current colour as a bitmap and, on a click, opens DIALOG_COLOR_PICKER:
 *
 *     DIALOG_COLOR_PICKER dialog( wxGetTopLevelParent( this ), m_color,
 *                                 m_supportsOpacity, m_userColors, m_default );
 *     if( dialog.ShowModal() == wxID_OK )
 *         m_color = dialog.GetColor();          (color_swatch.cpp:301-328)
 *
 * The colour theme panels, the layer managers, the netclass table and every
 * item-properties dialog build one. That is the whole reason KiCad's colour
 * chooser looks and behaves the same in all of them, and it is why this is one
 * component in `ui/` rather than the same forty lines of state-button-dialog
 * repeated at each of our sixteen call sites — which is what we had, sixteen
 * `<input type="color">`s handing the job to the browser's own popup. That
 * popup is anchored to the control, so near the right edge of the window it
 * opens off-screen with nothing to click; and a KiCad user never sees their
 * desktop's picker here in the first place.
 *
 * NOT ported: `m_userColors` (`CUSTOM_COLORS_LIST`), which no call site of ours
 * passes; `m_readOnly` with its callback, which is `APPEARANCE_CONTROLS`
 * explaining why a layer's colour cannot be edited in the current theme; and
 * the middle/right-click re-post, which forwards to a parent listener that has
 * no counterpart here. Say so at the call site if one is ever wanted.
 */

import type { CSSProperties, JSX } from 'react';
import { useState } from 'react';
import {
  brightness,
  type Color4d,
  COLOR4D_UNSPECIFIED,
  darkened,
  toCssColor,
} from '@ziroeda/common/src/color4d.js';
import { DialogColorPicker } from './DialogColorPicker.js';

/**
 * `SWATCH_SIZE` (include/widgets/color_swatch.h:38-44), which the constructor
 * turns into pixels through `ConvertDialogToPixels`. The three sizes are
 * `--swatch-*-w/h` in shell.css, measured there; the class picks the pair.
 *
 * `SWATCH_EXPAND` is not offered: `COLOR_SWATCH` asserts on it
 * (color_swatch.cpp:161-162) — it is only meaningful to the grid-cell renderer.
 */
export type SwatchSize = 'small' | 'medium' | 'large';

export interface ColorSwatchProps {
  /** `m_color`. */
  color: Color4d;
  /**
   * `m_default` — what "Reset to Default" goes back to. UNSPECIFIED relabels
   * that button "Clear Color" (dialog_color_picker.cpp:101-102), which is what
   * a local override wants; a theme colour passes its theme default instead.
   */
  defaultColor?: Color4d;
  /**
   * `m_supportsOpacity`, the dialog's `aAllowOpacityControl`. False hides the
   * Opacity slider and forces alpha to 1 (dialog_color_picker.cpp:70-77) —
   * which is right wherever the colour is written somewhere that has no alpha
   * to store.
   */
  supportsOpacity?: boolean;
  /** `SWATCH_MEDIUM` is `COLOR_SWATCH`'s own default (color_swatch.h:52). */
  size?: SwatchSize;
  /** `sendSwatchChangeEvent`, raised only on wxID_OK. */
  onChange: (color: Color4d) => void;
  /**
   * `aBackground` — the colour the swatch is understood to sit ON, which
   * `RenderToDC` builds the checkerboard from (`color_swatch.cpp:94-107`):
   * a bright background gives a checkerboard of itself and a 15 %-darker
   * version of itself, so a half-transparent colour reads against the surface
   * it will really be drawn on. The colour pages pass the theme's own
   * `LAYER_*_BACKGROUND` (`panel_color_settings.cpp:262`).
   *
   * Omitted, or dark, and the checkerboard is the `else` branch's black and
   * 15 %-brightened black — which is also what an UNSPECIFIED colour always
   * gets here, because that branch reads `m_checkerboardBg`, the parent
   * window's background, and every list of ours sits on --chrome-bg2.
   */
  background?: Color4d;
  /** A11y only — a wxStaticBitmap has no label, but a bare button must. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Whether a colour is `COLOR4D::UNSPECIFIED`, which is compared by value. */
export const isUnspecified = (c: Color4d): boolean =>
  c.a === COLOR4D_UNSPECIFIED.a &&
  c.r === COLOR4D_UNSPECIFIED.r &&
  c.g === COLOR4D_UNSPECIFIED.g &&
  c.b === COLOR4D_UNSPECIFIED.b;

export function ColorSwatch({
  color,
  background,
  defaultColor = COLOR4D_UNSPECIFIED,
  supportsOpacity = true,
  size = 'medium',
  onChange,
  label,
  disabled,
  className,
}: ColorSwatchProps): JSX.Element {
  const [open, setOpen] = useState(false);

  // `RenderToDC`'s two branches, chosen by `GetBrightness() > 0.4`. The dark
  // one is the CSS default, so only the bright one is stated here.
  const checkerBase = isUnspecified(color) ? undefined : background;
  const bright = checkerBase !== undefined && brightness(checkerBase) > 0.4;
  const checker: Record<string, string> = bright
    ? {
        '--checker-hi': toCssColor(checkerBase, ', '),
        '--checker-lo': toCssColor(darkened(checkerBase, 0.15), ', '),
      }
    : {};

  return (
    <>
      {/* `MakeBitmap` lays a checkerboard down and paints the colour over it at
          its own alpha (color_swatch.cpp:78-133), so a transparent colour is
          the bare checkerboard and a half-transparent one is a tinted
          checkerboard — neither is a special case. `--swatch-color` is that
          foreground; the rule is `.ze-swatch.unspecified`'s, taken by the same
          class the drawing sheet's swatch and the picker's previews take. */}
      <button
        type="button"
        className={`ze-swatch unspecified${size === 'medium' ? '' : ` ${size}`}${
          className ? ` ${className}` : ''
        }`}
        style={{ '--swatch-color': toCssColor(color, ', '), ...checker } as CSSProperties}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      {open && (
        <DialogColorPicker
          value={color}
          defaultColor={defaultColor}
          allowOpacity={supportsOpacity}
          onDone={(picked) => {
            setOpen(false);
            // `if( result == wxID_OK )` — a cancel changes nothing at all, and
            // in particular does not send the change event.
            if (picked) onChange(picked);
          }}
        />
      )}
    </>
  );
}
