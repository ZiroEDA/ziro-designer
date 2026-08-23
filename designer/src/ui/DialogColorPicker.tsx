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

import type { CSSProperties, JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Color4d,
  fromHSV,
  setFromHexString,
  toHSV,
  toHexString,
} from '@ziroeda/common/src/color4d.js';
import { Slider } from './Slider.js';
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

/**
 * `drawRGBPalette` (dialog_color_picker.cpp:407-477): over the cube it paints
 * three WHITE square cursors, one per channel on its own 3d axis, and the three
 * axes themselves — all with a 2 px pen and a transparent brush, so each cursor
 * is an outline rather than a filled block.
 */
function overlayRGB(ctx: CanvasRenderingContext2D, size: number, c: Color4d): void {
  ctx.clearRect(0, 0, size, size);

  let half = Math.floor(size / 2) - CURSOR_SIZE / 2;
  const slope = slopeAxis(size) / half;
  const halfC = CURSOR_SIZE / 2;
  // `SetAxisOrientation( true, true )` with the origin at the centre: y counts
  // upward, so a positive y is drawn above the middle.
  const X = (x: number): number => size / 2 + x;
  const Y = (y: number): number => size / 2 - y;

  ctx.save();
  // [data] `wxPen pen( wxColor( 255, 255, 255 ), 2 )` with the comment "using
  // white color to make them always visible" (dialog_color_picker.cpp:437-438).
  ctx.strokeStyle = 'rgb(255, 255, 255)';
  ctx.lineWidth = 2;

  const cursor = (x: number, y: number): void =>
    ctx.strokeRect(X(x - halfC), Y(y + halfC), CURSOR_SIZE, CURSOR_SIZE);

  // Red on the Z axis, blue on X, green on Y (mirrored onto -x).
  cursor(0, c.r * half);
  const bx = c.b * half;
  cursor(bx, -slope * bx);
  const gx = c.g * half;
  cursor(-gx, -slope * gx);

  // "Draw the 3 RGB axis" — and the axes run a fifth PAST the palette's own
  // half-size, which is `half_size += half_size/5` immediately before them.
  half += half / 5;
  const axis = (x: number, y: number): void => {
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(x), Y(y));
    ctx.stroke();
  };
  axis(0, half);
  axis(half, -half * slope);
  axis(-half, -half * slope);
  ctx.restore();
}

/**
 * `drawHSVPalette` (dialog_color_picker.cpp:479-522): ONE cursor, and it is
 * BLACK — a white one would vanish against the pale centre of the wheel.
 */
function overlayHSV(ctx: CanvasRenderingContext2D, size: number, hue: number, sat: number): void {
  ctx.clearRect(0, 0, size, size);

  const half = Math.floor(size / 2) - CURSOR_SIZE / 2;
  const x = Math.cos((hue * Math.PI) / 180.0) * half * sat;
  const y = Math.sin((hue * Math.PI) / 180.0) * half * sat;

  ctx.save();
  // [data] `wxPen pen( wxColor( 0, 0, 0 ), 2 )` — the HSV cursor is BLACK, and
  // deliberately not the white the RGB cursors use (dialog_color_picker.cpp:511).
  ctx.strokeStyle = 'rgb(0, 0, 0)';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    size / 2 + x - CURSOR_SIZE / 2,
    size / 2 - y - CURSOR_SIZE / 2,
    CURSOR_SIZE,
    CURSOR_SIZE,
  );
  ctx.restore();
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

  /** `m_notebook`: "Color Picker" and "Defined Colors", the first selected. */
  const [tab, setTab] = useState<'free' | 'defined'>('free');

  const rgbRef = useRef<HTMLCanvasElement>(null);
  const hsvRef = useRef<HTMLCanvasElement>(null);
  const rgbOverRef = useRef<HTMLCanvasElement>(null);
  const hsvOverRef = useRef<HTMLCanvasElement>(null);
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

  /**
   * `drawAll` (dialog_color_picker.cpp:579-595) — the cursors are repainted on
   * every change, over a palette bitmap that is built once.
   */
  useEffect(() => {
    const rgb = rgbOverRef.current?.getContext('2d');
    if (rgb) overlayRGB(rgb, PALETTE_SIZE, color);
    const h = hsvOverRef.current?.getContext('2d');
    if (h) overlayHSV(h, PALETTE_SIZE, hsv.hue, hsv.sat);
  }, [color, hsv.hue, hsv.sat]);

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

  /**
   * A `wxSpinCtrl`, which GTK draws as an entry with a `-` and a `+` beside it
   * (dialog_color_picker_base.cpp:59-70). A bare number entry has no buttons at
   * all on this theme, so the control read as a plain text field.
   *
   * `wrap` is `wxSP_WRAP`, which only Hue carries: 359 steps up to 0.
   */
  const spin = (
    label: string,
    v: number,
    max: number,
    onChange: (n: number) => void,
    wrap = false,
  ): JSX.Element => {
    const step = (d: number): void => {
      const next = Math.round(v) + d;
      if (wrap) onChange(((next % (max + 1)) + max + 1) % (max + 1));
      else onChange(Math.min(max, Math.max(0, next)));
    };
    return (
      <label className="ze-cp-spin">
        <span>{label}</span>
        <span className="ze-cp-spinbox">
          <input
            className="ze-search"
            type="text"
            inputMode="numeric"
            value={Math.round(v)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(n);
            }}
          />
          <button type="button" className="ze-cp-spinbtn" onClick={() => step(-1)} tabIndex={-1}>
            −
          </button>
          <button type="button" className="ze-cp-spinbtn" onClick={() => step(1)} tabIndex={-1}>
            +
          </button>
        </span>
      </label>
    );
  };

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

        {/* m_notebook (dialog_color_picker_base.cpp:21, :140-160). The same
            wxNotebook tab strip the drawing sheet's properties pane draws, so
            the same rule paints it. */}
        <div className="ze-nb-tabs">
          <button
            type="button"
            className={tab === 'free' ? 'active' : ''}
            onClick={() => setTab('free')}
          >
            Color Picker
          </button>
          <button
            type="button"
            className={tab === 'defined' ? 'active' : ''}
            onClick={() => setTab('defined')}
          >
            Defined Colors
          </button>
        </div>

        <div className="ze-cp-upper">
          <div className="ze-cp-panels" hidden={tab !== 'free'}>
            {/* sbSizerViewRGB */}
            <fieldset className="ze-ds-group">
              <legend>RGB</legend>
              <div className="ze-cp-palette">
                {/* biome-ignore lint/a11y/noStaticElementInteractions: wxStaticBitmap with a wxEVT_LEFT_DOWN handler */}
                <canvas ref={rgbRef} width={PALETTE_SIZE} height={PALETTE_SIZE} />
                <canvas
                  ref={rgbOverRef}
                  className="ze-cp-overlay"
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
                    <canvas ref={hsvRef} width={PALETTE_SIZE} height={PALETTE_SIZE} />
                    <canvas
                      ref={hsvOverRef}
                      className="ze-cp-overlay"
                      width={PALETTE_SIZE}
                      height={PALETTE_SIZE}
                      onMouseDown={onHsvPoint}
                      onMouseMove={(e) => {
                        if (e.buttons & 1) onHsvPoint(e);
                      }}
                    />
                  </div>
                  <div className="ze-cp-spins two">
                    {/* wxSP_WRAP, 0..359 (dialog_color_picker_base.cpp:104). */}
                    {spin(
                      'Hue:',
                      hsv.hue,
                      359,
                      (n) => applyHsv(((n % 360) + 360) % 360, hsv.sat, hsv.val, color.a),
                      true,
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
                  {/* `wxSL_INVERSE|wxSL_LABELS|wxSL_LEFT|wxSL_VERTICAL`, 0..255
                      (dialog_color_picker_base.cpp:122). The shared wxSlider —
                      a bare range input has none of the labels or the accent
                      fill, which is what stood here. */}
                  <Slider
                    vertical
                    labels
                    ariaLabel="Value"
                    min={0}
                    max={255}
                    value={Math.round(hsv.val * 255)}
                    onChange={(n) => applyHsv(hsv.hue, hsv.sat, n / 255, color.a)}
                  />
                </div>
              </div>
            </fieldset>
          </div>

          {/* m_panelDefinedColors: `m_fgridColor`, ten columns of swatches
              filled by `initDefinedColors` from the CUSTOM_COLORS_LIST the
              caller passed (dialog_color_picker.cpp:167-246). A caller that
              passes none - which pl_editor's swatch does - leaves the page
              empty, so an empty grid IS the page here. */}
          {tab === 'defined' && (
            <div className="ze-cp-defined">
              {/* `initDefinedColors` fills m_fgridColor from the
                  CUSTOM_COLORS_LIST the caller passed; with none there are no
                  swatches to draw, and the page is the empty grid. */}
            </div>
          )}

          {/* m_SizerTransparency, 0..100 and wxSL_INVERSE. */}
          {allowOpacity && (
            <div className="ze-cp-slidercol">
              <span>Opacity:</span>
              {/* The same control, 0..100 (dialog_color_picker_base.cpp:171). */}
              <Slider
                vertical
                labels
                ariaLabel="Opacity"
                min={0}
                max={100}
                value={Math.round(color.a * 100)}
                onChange={(n) => {
                  const c = { ...color, a: n / 100 };
                  setColor(c);
                  setHexText(toHexString(c));
                }}
              />
            </div>
          )}
        </div>

        <div className="ze-cp-buttons">
          <span>Preview (old/new):</span>
          {/* `updatePreview` builds both of these with COLOR_SWATCH's own
              MakeBitmap (dialog_color_picker.cpp:128-140), so UNSPECIFIED
              checkerboards here exactly as it does in a swatch. A plain
              `rgba(0,0,0,0)` background showed the dialog through the square,
              which reads as "no preview" rather than as "no colour". */}
          <span
            className="ze-cp-preview ze-swatch unspecified"
            style={{ '--swatch-color': css(value) } as CSSProperties}
          />
          <span
            className="ze-cp-preview ze-swatch unspecified"
            style={{ '--swatch-color': css(color) } as CSSProperties}
          />
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
              className="ze-btn ze-cp-reset"
              onClick={() => {
                applyRgb(defaultColor);
              }}
            >
              {/* "Theme colors have a default value, and the Reset to Default
                  button reverts to it. Local override colors have a default of
                  UNSPECIFIED, which means 'use the theme color'. […] we change
                  the label here because the action from the point of view of
                  the user is slightly different." (dialog_color_picker.cpp:95-102) */}
              {defaultColor.a === 0 ? 'Clear Color' : 'Reset to Default'}
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
