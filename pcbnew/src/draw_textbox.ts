// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a text box.
 * Counterparts: `DRAWING_TOOL::DrawRectangle` with `isTextBox` set (which is
 * how `drawTextBox` is registered — the same handler as `drawRectangle`),
 * `PCB_TEXTBOX`'s constructor, and `PCB_SHAPE::Normalize`.
 *
 * ## Two clicks, then the dialog
 *
 * Upstream draws the rectangle, then opens the properties dialog *immediately*
 * and **discards the box if it is cancelled**. A text box with no text is
 * useless, so the dialog is part of placing one rather than an optional
 * follow-up. That is why this module only builds the item: committing it is the
 * dialog's OK button.
 *
 * ## Normalize, and why it matters here
 *
 * `PCB_SHAPE::Normalize` rewrites a rectangle so `start` is the minimum corner.
 * Dragging up-and-left produces `start > end`, and nothing downstream expects
 * that — the renderer's corner walk and `textBoxBBox` both happen to cope, but
 * the *file* would carry a rectangle KiCad itself never writes.
 */
import type { PcbTextBox, StrokeType } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** The Board Setup values a freshly-drawn box takes. */
export interface TextBoxDefaults {
  layer: string;
  textSize: number;
  textThickness: number;
  borderWidth: number;
  borderStyle: StrokeType;
}

const MM = (v: number): number => Math.round(v * 1e6);

/** `BOARD_DESIGN_SETTINGS`' silkscreen text class, at its own defaults. */
export const DEFAULT_TEXTBOX_DEFAULTS: TextBoxDefaults = {
  layer: 'F.SilkS',
  textSize: MM(1),
  textThickness: MM(0.15),
  borderWidth: MM(0.1),
  borderStyle: 'solid',
};

/**
 * `PCB_SHAPE::Normalize` for a rectangle: `start` becomes the minimum corner
 * and `end` the maximum, whichever way round they were drawn.
 */
export function normalizeCorners(a: Vec2, b: Vec2): { start: Vec2; end: Vec2 } {
  return {
    start: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    end: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
  };
}

/**
 * `PCB_TEXTBOX::GetLegacyTextMargin`: half the border stroke plus three
 * quarters of the text height.
 *
 * All four margins start equal, and they are a *function of the style* rather
 * than a fixed number — a box drawn with larger text gets proportionally more
 * padding, which is what stops the text touching its own border.
 */
export function legacyTextMargin(textHeight: number, borderWidth: number): number {
  return Math.round(borderWidth / 2) + Math.round(textHeight * 0.75);
}

/**
 * A fresh text box over the two clicked corners.
 *
 * The text is empty: upstream opens the properties dialog straight away, so
 * whatever the user types there is what the box ends up with. `border` is on
 * and justification is left/centre, both from `PCB_TEXTBOX`'s constructor.
 */
export function newTextBox(
  a: Vec2,
  b: Vec2,
  defaults: TextBoxDefaults = DEFAULT_TEXTBOX_DEFAULTS,
): Omit<PcbTextBox, 'source'> {
  const { start, end } = normalizeCorners(a, b);
  const margin = legacyTextMargin(defaults.textSize, defaults.borderWidth);
  return {
    text: '',
    start,
    end,
    margins: { left: margin, top: margin, right: margin, bottom: margin },
    layer: defaults.layer,
    size: { x: defaults.textSize, y: defaults.textSize },
    thickness: defaults.textThickness,
    // PCB_TEXTBOX's ctor: SetHorizJustify(LEFT), SetVertJustify(CENTER).
    // Centre is the unwritten default on both axes, so only `left` is stored.
    justify: ['left'],
    border: true,
    strokeWidth: defaults.borderWidth,
    strokeType: defaults.borderStyle,
    knockout: false,
  };
}

/**
 * Whether the two clicks describe a box worth keeping.
 *
 * A zero-width or zero-height rectangle is not a text box — upstream's
 * `drawShape` refuses to finish one, the same way a dimension refuses two
 * feature points in the same spot.
 */
export function isDrawableTextBox(a: Vec2, b: Vec2): boolean {
  return a.x !== b.x && a.y !== b.y;
}
