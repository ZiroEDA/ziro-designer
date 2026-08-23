// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_COLOR_PICKER` — `common/dialogs/dialog_color_picker.cpp` and its
 * wxFormBuilder base.
 *
 * Every colour in KiCad is chosen here: COLOR_SWATCH opens it
 * (`color_swatch.cpp:301-311`), and so do the colour theme panels, the layer
 * managers and the item dialogs. Ours used `<input type="color">`, which hands
 * the job to the browser — and the browser draws that picker as an OS-level
 * popup anchored to the control, so on a control near the right edge of the
 * window it opens off-screen with no way to reach it. A KiCad user also never
 * sees their desktop's picker here; they see this one.
 *
 * Ported: the notebook's two pages, the RGB cube and the HSV wheel with their
 * cursors, the Value and Opacity sliders, the six spin controls, the hex
 * entry, the old/new preview pair and Reset to Default.
 *
 * NOT ported: nothing of the layout — but the palettes are drawn to a canvas
 * rather than to a `wxImage`, because that is what a browser has. The pixel
 * loops below are upstream's, transcribed.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Color4d,
  fromHSV,
  setFromHexString,
  toHSV,
  toHexString,
} from '@ziroeda/common/src/color4d.js';
import { useModalEscape } from './useModalEscape.js';

/**
 * `m_RgbBitmap`/`m_HsvBitmap` are both built `wxSize( 264, 264 )` with a
 * matching `SetMinSize` (dialog_color_picker_base.cpp:32-33, :81-82). [data]
 */
const PALETTE_SIZE = 264;

/**
 * `m_cursorsSize = ToPhys( FromDIP( 8 ) )` (dialog_color_picker.cpp:573-576):
 * the square cursor drawn on each palette, and the margin both palettes
 * reserve for it. [data]
 */
const CURSOR_SIZE = 8;

/**
 * `#define SLOPE_AXIS ( bmsize.y / 5.28 )` with the comment "was 50 at 264
 * size" (dialog_color_picker.cpp:32) — the vertical lean of the RGB cube's
 * three axes. [data]
 */
const slopeAxis = (height: number): number => height / 5.28;

/** `COLOR4D::ToColour()` as a CSS colour. */
const css = (c: Color4d): string =>
  `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;

/**
 * `createRGBBitmap` (dialog_color_picker.cpp:248-336): three parallelograms
 * meeting at the centre, one per pair of channels, drawn on the dialog's own
 * background.
 */
function paintRGB(ctx: CanvasRenderingContext2D, size: number, background: string): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const half = Math.floor(size / 2) - CURSOR_SIZE / 2;
  const inc = 255.0 / half;
  const slope = slopeAxis(size) / half;
  const mapX = (x: number): number => Math.round(size / 2 + x);
  const mapY = (y: number): number => Math.round(size / 2 - y);

  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  };

  // Red / blue area, in the X-Z 3d axis. Green is zero across it.
  for (let xx = 0; xx < half; xx++) {
    const b = inc * xx;
    for (let yy = 0; yy < half; yy++) put(mapX(xx), mapY(yy - slope * xx), inc * yy, 0, b);
  }

  // Red / green area, in the Y-Z axis. Blue is zero.
  for (let xx = 0; xx < half; xx++) {
    const g = inc * xx;
    for (let yy = 0; yy < half; yy++) put(mapX(-xx), mapY(yy - slope * xx), inc * yy, g, 0);
  }

  // Blue / green area, in the X-Y axis. Red is zero, and the mapping is the
  // one upstream calls "more tricky": the blue axis runs to
  // (half_size, -yy - SLOPE_AXIS) and the green axis to its mirror.
  for (let xx = 0; xx < half; xx++) {
    const g = inc * xx;
    for (let yy = 0; yy < half; yy++) {
      const drawX = -xx + yy;
      const drawY = -Math.min(xx, yy) * 0.9;
      put(mapX(drawX), mapY(drawY - Math.abs(slope * drawX)), 0, g, inc * yy);
    }
  }

  ctx.putImageData(img, 0, 0);
}

/**
 * `createHSVBitmap` (dialog_color_picker.cpp:342-404): a disc of radius
 * `half_size`, hue around it and saturation out from the centre, at value 1.
 */
function paintHSV(ctx: CanvasRenderingContext2D, size: number, background: string): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const half = Math.floor(size / 2) - CURSOR_SIZE / 2;
  const sqRadius = half * half;

  for (let xx = -half; xx < half; xx++) {
    for (let yy = -half; yy < half; yy++) {
      let sat = (xx * xx + yy * yy) / sqRadius;
      // "any value > 1.0 is not a valid HSB color"
      if (sat > 1.0) continue;
      sat = Math.sqrt(sat);

      let hue = (Math.atan2(yy, xx) * 180) / Math.PI;
      if (hue < 0.0) hue += 360.0;

      const c = fromHSV(hue, sat, 1.0);
      const x = Math.round(size / 2 + xx);
      const y = Math.round(size / 2 - yy);
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = (y * size + x) * 4;
      img.data[i] = c.r * 255;
      img.data[i + 1] = c.g * 255;
      img.data[i + 2] = c.b * 255;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

export interface DialogColorPickerProps {
  /** `m_previousColor4D` — what the swatch showed when the dialog opened. */
  value: Color4d;
  /** `m_defaultColor`, the colour Reset to Default restores. */
  defaultColor?: Color4d;
  /**
   * `aAllowOpacityControl`: with it false `m_SizerTransparency` is hidden and
   * the alpha stays at the incoming value (dialog_color_picker.cpp:70-77).
   */
  allowOpacity?: boolean;
  onDone: (color: Color4d | null) => void;
}

export function DialogColorPicker({
  value,
  defaultColor,
  allowOpacity = true,
  onDone,
}: DialogColorPickerProps): JSX.Element {
  const [color, setColor] = useState<Color4d>(value);
  // Hue and saturation are held separately, as m_hue/m_sat/m_val are upstream:
  // a colour at value 0 is black whatever its hue, so recomputing them from the
  // rgb on every draw would swing the wheel cursor to the centre and lose the
  // hue the user had picked.
  const initialHsv = useMemo(() => toHSV(value, true), [value]);
  const [hsv, setHsv] = useState(initialHsv);
  const [hexText, setHexText] = useState(() => toHexString(value));

  const rgbRef = useRef<HTMLCanvasElement>(null);
  const hsvRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useModalEscape(() => onDone(null));

  /** Both palettes are drawn on the dialog's own background (`GetBackgroundColour`). */
  useEffect(() => {
    // `GetBackgroundColour()` — the dialog's own, never a colour of this
    // module's. With no element there is nothing to measure and nothing to
    // paint on, so the palettes wait rather than inventing a background.
    if (!rootRef.current) return;
    const bg = getComputedStyle(rootRef.current).backgroundColor;
    const rgb = rgbRef.current?.getContext('2d');
    if (rgb) paintRGB(rgb, PALETTE_SIZE, bg);
    const hsvCtx = hsvRef.current?.getContext('2d');
    if (hsvCtx) paintHSV(hsvCtx, PALETTE_SIZE, bg);
  }, []);

  /** Every edit path ends here: keep rgb, hsv and the hex field in step. */
  const applyRgb = useCallback((c: Color4d) => {
    setColor(c);
    setHsv(toHSV(c, true));
    setHexText(toHexString(c));
  }, []);

  const applyHsv = useCallback((h: number, s: number, v: number, alpha: number) => {
    const c = fromHSV(h, s, v, alpha);
    setHsv({ hue: h, sat: s, val: v });
    setColor(c);
    setHexText(toHexString(c));
  }, []);

  /**
   * `setHSvaluesFromCursor` (dialog_color_picker.cpp:759-798): a click outside
   * the disc sets nothing at all, because saturation cannot be computed there.
   */
  const onHsvPoint = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const half = PALETTE_SIZE / 2;
      const x = e.clientX - r.left - half;
      const y = -(e.clientY - r.top - half);
      const dist = Math.hypot(x, y);
      if (dist > half) return;

      const paletteHalf = half - CURSOR_SIZE / 2;
      const sat = Math.min(1.0, dist / paletteHalf);
      let hue = (Math.atan2(y, x) / Math.PI) * 180.0;
      if (hue < 0) hue += 360.0;
      applyHsv(hue, sat, hsv.val, color.a);
    },
    [applyHsv, hsv.val, color.a],
  );

  /**
   * `onRGBMouseClick` (dialog_color_picker.cpp:621-660) reads the pixel under
   * the pointer out of the bitmap it drew, rather than inverting the mapping.
   */
  const onRgbPoint = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const ctx = rgbRef.current?.getContext('2d');
      if (!ctx) return;
      const r = e.currentTarget.getBoundingClientRect();
      const x = Math.round(e.clientX - r.left);
      const y = Math.round(e.clientY - r.top);
      const d = ctx.getImageData(x, y, 1, 1).data;
      applyRgb({
        r: (d[0] ?? 0) / 255,
        g: (d[1] ?? 0) / 255,
        b: (d[2] ?? 0) / 255,
        a: color.a,
      });
    },
    [applyRgb, color.a],
  );

  /** The 8 px square cursor each palette draws over its own pixel. */
  const hsvCursor = {
    left:
      PALETTE_SIZE / 2 +
      Math.cos((hsv.hue * Math.PI) / 180) * hsv.sat * (PALETTE_SIZE / 2 - CURSOR_SIZE / 2),
    top:
      PALETTE_SIZE / 2 -
      Math.sin((hsv.hue * Math.PI) / 180) * hsv.sat * (PALETTE_SIZE / 2 - CURSOR_SIZE / 2),
  };

  const spin = (
    label: string,
    v: number,
    max: number,
    onChange: (n: number) => void,
  ): JSX.Element => (
    <label className="ze-cp-spin">
      <span>{label}</span>
      <input
        className="ze-search"
        type="number"
        min={0}
        max={max}
        value={Math.round(v)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={() => onDone(null)}>
      <div
        ref={rootRef}
        className="ze-modal ze-cp"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Color Picker"
      >
        <div className="ze-modal-header">Color Picker</div>

        <div className="ze-cp-upper">
          <div className="ze-cp-panels">
            {/* sbSizerViewRGB */}
            <fieldset className="ze-ds-group">
              <legend>RGB</legend>
              <div className="ze-cp-palette">
                {/* biome-ignore lint/a11y/noStaticElementInteractions: wxStaticBitmap with a wxEVT_LEFT_DOWN handler */}
                <canvas
                  ref={rgbRef}
                  width={PALETTE_SIZE}
                  height={PALETTE_SIZE}
                  onMouseDown={onRgbPoint}
                  onMouseMove={(e) => {
                    if (e.buttons & 1) onRgbPoint(e);
                  }}
                />
              </div>
              <div className="ze-cp-spins">
                {spin('Red:', color.r * 255, 255, (n) =>
                  applyRgb({ ...color, r: Math.min(255, Math.max(0, n)) / 255 }),
                )}
                {spin('Green:', color.g * 255, 255, (n) =>
                  applyRgb({ ...color, g: Math.min(255, Math.max(0, n)) / 255 }),
                )}
                {spin('Blue:', color.b * 255, 255, (n) =>
                  applyRgb({ ...color, b: Math.min(255, Math.max(0, n)) / 255 }),
                )}
              </div>
            </fieldset>

            {/* sbSizerViewHSV */}
            <fieldset className="ze-ds-group">
              <legend>HSV</legend>
              <div className="ze-cp-hsvrow">
                <div className="ze-cp-hsvcol">
                  <div className="ze-cp-palette">
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: wxStaticBitmap with a wxEVT_LEFT_DOWN handler */}
                    <canvas
                      ref={hsvRef}
                      width={PALETTE_SIZE}
                      height={PALETTE_SIZE}
                      onMouseDown={onHsvPoint}
                      onMouseMove={(e) => {
                        if (e.buttons & 1) onHsvPoint(e);
                      }}
                    />
                    <span
                      className="ze-cp-cursor"
                      style={{ left: hsvCursor.left, top: hsvCursor.top }}
                    />
                  </div>
                  <div className="ze-cp-spins two">
                    {/* wxSP_WRAP, 0..359 (dialog_color_picker_base.cpp:104). */}
                    {spin('Hue:', hsv.hue, 359, (n) =>
                      applyHsv(((n % 360) + 360) % 360, hsv.sat, hsv.val, color.a),
                    )}
                    {/* 0..255, though m_sat is 0..1 — SetEditVals scales it. */}
                    {spin('Saturation:', hsv.sat * 255, 255, (n) =>
                      applyHsv(hsv.hue, Math.min(255, Math.max(0, n)) / 255, hsv.val, color.a),
                    )}
                  </div>
                </div>
                {/* bSizerBright: a vertical wxSL_INVERSE slider, 0..255. */}
                <div className="ze-cp-slidercol">
                  <span>Value:</span>
                  <input
                    type="range"
                    className="ze-cp-vslider"
                    min={0}
                    max={255}
                    value={Math.round(hsv.val * 255)}
                    onChange={(e) =>
                      applyHsv(hsv.hue, hsv.sat, Number(e.target.value) / 255, color.a)
                    }
                  />
                </div>
              </div>
            </fieldset>
          </div>

          {/* m_SizerTransparency, 0..100 and wxSL_INVERSE. */}
          {allowOpacity && (
            <div className="ze-cp-slidercol">
              <span>Opacity:</span>
              <input
                type="range"
                className="ze-cp-vslider"
                min={0}
                max={100}
                value={Math.round(color.a * 100)}
                onChange={(e) => {
                  const c = { ...color, a: Number(e.target.value) / 100 };
                  setColor(c);
                  setHexText(toHexString(c));
                }}
              />
            </div>
          )}
        </div>

        <div className="ze-cp-buttons">
          <span>Preview (old/new):</span>
          <span className="ze-cp-preview" style={{ background: css(value) }} />
          <span className="ze-cp-preview" style={{ background: css(color) }} />
          <input
            className="ze-search ze-cp-hex"
            value={hexText}
            onChange={(e) => {
              // OnColorValueText: a string it will not parse leaves the colour
              // alone, so a half-typed "#1" is not an edit.
              setHexText(e.target.value);
              const parsed = setFromHexString(e.target.value);
              if (parsed) {
                setColor(parsed);
                setHsv(toHSV(parsed, true));
              }
            }}
          />
          <span className="ze-cp-gap" />
          {defaultColor && (
            <button
              type="button"
              className="ze-btn"
              onClick={() => {
                applyRgb(defaultColor);
              }}
            >
              Reset to Default
            </button>
          )}
          {/* m_sdbSizer: a wxStdDialogButtonSizer, so GTK's own order - Cancel
              then OK - and OK is the affirmative default. */}
          <div className="ze-modal-footer">
            <button type="button" className="ze-btn" onClick={() => onDone(null)}>
              Cancel
            </button>
            <button type="button" className="ze-btn primary" onClick={() => onDone(color)}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
