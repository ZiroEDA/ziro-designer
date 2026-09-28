// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How big to make a canvas's backing store for the box it is laid into.
 *
 * There is one right answer and it is easy to get subtly wrong, so it lives
 * here rather than once per editor. KiCad has the same single answer for a
 * different reason: `EDA_DRAW_PANEL_GAL::onSize` hands `GetClientSize()` — the
 * *client* box, in whole pixels — to `GAL::ResizeScreen`, and every frame's
 * canvas goes through it.
 *
 * **The rule: the CSS size must be a whole number of CSS pixels, and the
 * backing store exactly `dpr` times it.** When it is not, the browser resamples
 * the whole canvas on every paint — a bitmap `w` device px wide stretched into
 * a box `w / dpr + ε` CSS px wide is a scale of `1 + ε·dpr/w`, and the board
 * shimmers.
 *
 * That is what made the PCB editor flicker while a dock was dragged and left
 * eeschema steady: `PcbEditor` measured with `getBoundingClientRect()`, whose
 * width is **fractional**, and put a rounded backing store behind it, while
 * `SchematicCanvas` measured with `clientWidth`, which is an integer. At a dpr
 * of 1 or 2 that is the difference between resampling ~85% of the widths a
 * drag passes through and resampling none of them.
 *
 * `clientWidth`/`clientHeight` are also the *correct box*, not merely the
 * integer one: they measure the padding box, and a canvas positioned
 * `absolute; inset: 0` is laid into the padding box too. `getBoundingClientRect()`
 * includes the border, so on `.ze-canvas-wrap` — which carries the pane's
 * bottom border — it reported one pixel more height than the canvas actually
 * had to fill.
 */

/** The two sizes a canvas needs: what CSS shows, and what the bitmap holds. */
export interface CanvasBackingSize {
  /** CSS pixels, whole numbers. Written to `style.width` / `style.height`. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixels. Written to `canvas.width` / `canvas.height`. */
  width: number;
  height: number;
}

/**
 * The arithmetic, apart from the DOM so it can be checked.
 *
 * `Math.max(1, …)` because a canvas of zero width is an error in some browsers
 * and a divide-by-zero in every view transform; a hidden frame measures 0×0 and
 * callers must be able to tell that apart, which is what {@link isMeasured} is
 * for.
 */
export function backingSizeFor(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): CanvasBackingSize {
  const cw = Math.max(0, Math.trunc(cssWidth));
  const ch = Math.max(0, Math.trunc(cssHeight));
  return {
    cssWidth: cw,
    cssHeight: ch,
    width: Math.max(1, Math.round(cw * devicePixelRatio)),
    height: Math.max(1, Math.round(ch * devicePixelRatio)),
  };
}

/**
 * The box a canvas at `position: absolute; inset: 0` fills, in whole CSS px.
 *
 * `clientWidth`/`clientHeight` and not `getBoundingClientRect()` — see the head
 * of this file for both reasons.
 */
export function canvasBackingSize(el: HTMLElement, devicePixelRatio: number): CanvasBackingSize {
  return backingSizeFor(el.clientWidth, el.clientHeight, devicePixelRatio);
}

/**
 * Did we measure a real box?
 *
 * A frame kept mounted and hidden with CSS measures 0×0, and `backingSizeFor`
 * floors that to a 1×1 backing store so the context stays valid. Fitting a view
 * to 1×1 produces a scale and an offset that mean nothing, so every caller that
 * fits has to ask this first.
 */
export const isMeasured = (s: CanvasBackingSize): boolean => s.cssWidth > 0 && s.cssHeight > 0;

/**
 * Apply a size to every layer of a stacked canvas, clearing as little as
 * possible.
 *
 * Assigning `canvas.width` clears the bitmap **even when the value is
 * unchanged**, so the backing store is only touched on a real change — a
 * caller whose effect re-runs for an unrelated reason would otherwise blank the
 * view for a frame. The CSS size is set unconditionally: it is free when
 * nothing moved, and it is what keeps the two from drifting apart when a
 * sub-pixel layout change rounds to the same backing store.
 *
 * Returns whether the backing store changed, which is the caller's signal that
 * whatever it had cached for the old viewport is stale.
 */
export function applyCanvasSize(
  layers: readonly (HTMLCanvasElement | null)[],
  size: CanvasBackingSize,
): boolean {
  const changed = layers.some((c) => c && (c.width !== size.width || c.height !== size.height));
  for (const c of layers) {
    if (!c) continue;
    if (changed) {
      c.width = size.width;
      c.height = size.height;
    }
    c.style.width = `${size.cssWidth}px`;
    c.style.height = `${size.cssHeight}px`;
  }
  return changed;
}
