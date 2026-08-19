// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How big a board text item is, and whether a click landed on it.
 *
 * `PCB_TEXT::GetBoundingBox` and `PCB_TEXT::TextHitTest` (`pcbnew/pcb_text.cpp`)
 * are thin wrappers over `EDA_TEXT::GetTextBox` / `EDA_TEXT::TextHitTest`, which
 * live in `common/src/font/text_box.ts` because upstream's live in `common/`.
 * This file is only the adapter: it maps a `PcbTextItem` onto `TextBoxAttrs`,
 * applies `PCB_TEXT::GetDrawRotation`, and rotates the box (or un-rotates the
 * point) the way the two `pcb_text.cpp` methods do.
 *
 * It replaces a `text.length * size.x * 0.6` guess that stood in four places.
 * That guess could not tell `IIII` from `WWWW`, used a full-string width as a
 * *half* width — so every box was about twice as wide as intended — carried no
 * pen width, no descender allowance and no rotation, and disagreed with the
 * stroke font the renderer has always drawn with.
 */

import {
  textBox,
  effectiveTextPenWidth,
  type TextBox2,
  type TextBoxAttrs,
  type TextHJustify,
  type TextVJustify,
} from '@ziroeda/common/src/font/text_box.js';
import type { PcbTextItem, Vec2 } from './types.js';

export type { TextBox2 } from '@ziroeda/common/src/font/text_box.js';

const hJustifyOf = (justify?: string[]): TextHJustify =>
  justify?.includes('left') ? 'left' : justify?.includes('right') ? 'right' : 'center';

const vJustifyOf = (justify?: string[]): TextVJustify =>
  justify?.includes('top') ? 'top' : justify?.includes('bottom') ? 'bottom' : 'center';

/** The `EDA_TEXT` attributes `GetTextBox` reads, taken off a `PcbTextItem`. */
export function textAttrs(t: PcbTextItem): TextBoxAttrs {
  return {
    size: t.size,
    thickness: t.thickness,
    bold: t.bold,
    italic: t.italic,
    mirrored: t.mirror,
    hJustify: hJustifyOf(t.justify),
    vJustify: vJustifyOf(t.justify),
  };
}

/** `EDA_TEXT::GetEffectiveTextPenWidth` for a board text item. */
export const textPenWidth = (t: PcbTextItem): number => effectiveTextPenWidth(textAttrs(t));

/**
 * `PCB_TEXT::GetDrawRotation`: footprint text with `keepUpright` is folded into
 * ]-90°, 90°] so it stays readable; anything else draws at its stored angle.
 */
export function drawRotation(t: PcbTextItem): number {
  let angle = t.angle;
  if (t.keepUpright) {
    while (angle > 90) angle -= 180;
    while (angle <= -90) angle += 180;
  }
  return angle;
}

/**
 * `EDA_TEXT::GetTextBox`: the axis-aligned box at the text's anchor, before
 * rotation. This is the box `TextHitTest` tests against, in the text's frame.
 */
export const textItemBox = (t: PcbTextItem): TextBox2 => textBox(t.text, t.at, textAttrs(t));

/**
 * Rotate a board-frame point into the text's own frame.
 *
 * `EDA_TEXT::TextHitTest` does `GetRotated( aPoint, GetDrawPos(), -GetDrawRotation() )`.
 * The sign convention is the renderer's (`renderBoard.ts` `addText`), which
 * places a glyph offset `(gx, gy)` at `at + (gx·cos - gy·sin, gx·sin + gy·cos)`
 * with `rad = -angle`; this is that map inverted.
 */
function toTextFrame(t: PcbTextItem, pos: Vec2): Vec2 {
  const rad = (-drawRotation(t) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pos.x - t.at.x;
  const dy = pos.y - t.at.y;
  return { x: t.at.x + dx * cos + dy * sin, y: t.at.y - dx * sin + dy * cos };
}

/**
 * `PCB_TEXT::GetBoundingBox`: the text box rotated about the anchor by the draw
 * rotation, then re-bounded axis-aligned.
 */
export function textItemBBox(t: PcbTextItem): TextBox2 {
  const b = textItemBox(t);
  const angle = drawRotation(t);
  if (angle % 360 === 0) return b;

  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [cx, cy] of [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ] as const) {
    const dx = cx - t.at.x;
    const dy = cy - t.at.y;
    const x = t.at.x + dx * cos - dy * sin;
    const y = t.at.y + dx * sin + dy * cos;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * `EDA_TEXT::TextHitTest( aPoint, aAccuracy )`: the text box inflated by the
 * caller's accuracy, tested against the point brought back into the text frame.
 *
 * The accuracy is upstream's own parameter — every `HitTest` on the board passes
 * one, sized from the view's pixel-to-IU scale — so the tolerance our callers
 * supply is kept.
 */
export function textItemHitTest(t: PcbTextItem, pos: Vec2, accuracy = 0): boolean {
  const b = textItemBox(t);
  const p = toTextFrame(t, pos);
  return (
    p.x >= b.x - accuracy &&
    p.x <= b.x + b.w + accuracy &&
    p.y >= b.y - accuracy &&
    p.y <= b.y + b.h + accuracy
  );
}
