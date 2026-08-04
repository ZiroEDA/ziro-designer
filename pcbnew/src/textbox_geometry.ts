// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A text box's outline and extent.
 * Counterparts: `PCB_TEXTBOX::GetCorners` and `PCB_TEXTBOX::HitTest`
 * (pcbnew/pcb_textbox.cpp).
 *
 * A box is stored either as two opposite corners or, once a non-cardinal
 * rotation has turned it into one, as a polygon. Both have to produce the same
 * four-ish corners for drawing and hit-testing, which is what `textBoxCorners`
 * is for — everything else here works from that one list.
 *
 * **A text box is solid to the mouse.** `PCB_TEXTBOX::HitTest` inflates the
 * bounding box and asks whether it *contains* the point; it does not test the
 * border outline. So clicking the middle of an empty box selects it, unlike a
 * dimension where the space between the feature line and the crossbar is
 * genuinely empty. Getting this backwards would make a box with `border no`
 * almost unselectable.
 *
 * That test is not a function here: `boardHitCandidates` needs the *distance*
 * for its size ranking rather than a boolean, so it measures against this
 * bounding box directly. A separate `hitTestTextBox` was written and had no
 * caller, so it is not kept.
 */
import type { PcbTextBox } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** The box's outline, closed. `PCB_TEXTBOX::GetCorners`. */
export function textBoxCorners(t: PcbTextBox): Vec2[] {
  if (t.pts && t.pts.length > 0) return t.pts;
  if (!t.start || !t.end) return [];
  return [
    { x: t.start.x, y: t.start.y },
    { x: t.end.x, y: t.start.y },
    { x: t.end.x, y: t.end.y },
    { x: t.start.x, y: t.end.y },
  ];
}

/**
 * The box's extent, half the border stroke included on every side.
 *
 * The text is not measured: sizing it needs glyph metrics, and upstream's own
 * bounding box is the shape's. A box is drawn no smaller than its border.
 */
export function textBoxBBox(t: PcbTextBox): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const pts = textBoxCorners(t);
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const half = (t.strokeWidth ?? 0) / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}
