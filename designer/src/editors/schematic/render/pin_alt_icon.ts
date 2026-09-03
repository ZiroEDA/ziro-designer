// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The alternate-pin-mode indicator, drawn by ONE painter for both editors.
 *
 * `drawAltPinModesIcon` is a static in `eeschema/sch_painter.cpp`, and
 * `SCH_PAINTER` is the painter `SCH_EDIT_FRAME` and `SYMBOL_EDIT_FRAME` both
 * use — the same relationship as `SCH_POINT_EDITOR`, one class registered by
 * two frames. So this lives beside the schematic's painter and the symbol
 * editor imports it, rather than each renderer carrying a copy of the geometry.
 *
 * It is placed from `PIN_LAYOUT_CACHE::getUntransformedAltIconBox`, which is
 * `altIconBox` in `eeschema/src/pin_box.ts`.
 */
import type { Vec2 } from '@ziroeda/kimath';

/**
 * `drawAltPinModesIcon` (`sch_painter.cpp:838-906`) — the two-arrow glyph that
 * marks a pin as having alternate modes, drawn beside its name.
 *
 * Upstream's own diagram of the two states:
 *
 *      ----------->            -----  ---->
 *          + <--center            \
 *         \------->                \------>
 *
 *      aBaseSelected = true      aBaseSelected = false
 *
 * The call site passes `true` unconditionally, with its reason in a comment —
 * "Icon style doesn't work due to the tempPin having no alt but maybe it's
 * better with just one style anyway" (`:1674-1676`) — so the gapped variant is
 * unreachable in KiCad today. It is ported anyway because the branch is the
 * upstream code and a caller may one day pass false; passing `true` here is
 * matching the call site, not dropping half the function.
 *
 * `aRotate` turns the glyph 270 degrees for a vertical pin name.
 */
export function drawAltPinModesIcon(
  ctx: CanvasRenderingContext2D,
  at: Vec2,
  size: number,
  baseSelected: boolean,
  rotate: boolean,
  extraLineWidth: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  // `aGal.Rotate( ANGLE_270.AsRadians() )`.
  if (rotate) ctx.rotate((270 * Math.PI) / 180);

  ctx.strokeStyle = color;
  ctx.lineWidth = size / 10 + extraLineWidth;

  const lineYOffset = size / 4;
  const arrowHead = size / 8;
  const topX = size / 2;
  const topY = -lineYOffset;
  const btmY = lineYOffset;

  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  // Top line and arrowhead.
  if (baseSelected) {
    line(topX, topY, topX - size, topY);
  } else {
    line(topX, topY, topX - size / 2, topY);
    line(topX - size, topY, topX - size * 0.7, topY);
  }
  line(topX, topY, topX - arrowHead * 1.2, topY - arrowHead);
  line(topX, topY, topX - arrowHead * 1.2, topY + arrowHead);

  // Bottom line and arrowhead.
  line(topX, btmY, topX - size / 2, btmY);
  line(topX, btmY, topX - arrowHead * 1.2, btmY - arrowHead);
  line(topX, btmY, topX - arrowHead * 1.2, btmY + arrowHead);

  // The 'S' arcs. `DrawArc( centre, r, ANGLE_0, -ANGLE_90 )` sweeps NEGATIVE,
  // which is anticlockwise in KiCad's y-down world, so canvas takes
  // `anticlockwise = true` for the same visual sweep.
  const arc = (cx: number, cy: number, r: number, from: number, to: number): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, (from * Math.PI) / 180, (to * Math.PI) / 180, true);
    ctx.stroke();
  };
  if (!baseSelected) arc(topX - size, topY + lineYOffset, lineYOffset, 0, -90);
  arc(topX - (size - lineYOffset * 2), topY + lineYOffset, lineYOffset, 180, 90);

  ctx.restore();
}
