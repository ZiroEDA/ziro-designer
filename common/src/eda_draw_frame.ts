// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Grid snapping, `EDA_DRAW_FRAME::GetNearestGridPosition` /
 * `::GetNearestHalfGridPosition` (`common/eda_draw_frame.cpp:1073/1098`).
 *
 * Upstream reads the grid size and origin off the frame's GAL, so both live on
 * the *frame* — in `common/`, instantiated once and used by every editor. Ours
 * therefore belongs in a shared module too, parameterised by the grid rather
 * than duplicated per editor: the symbol editor already had a private copy
 * (`designer/src/editors/symbol/edits.ts`), and the schematic transform needs
 * exactly the same answer.
 *
 * The grid origin is a user setting that we do not model anywhere yet, so
 * `gridOrigin` defaults to zero, which makes both `fmod` offsets zero.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `KiROUND`: round half *away from zero*, not half up as `Math.round` does. */
const kiRound = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/** `KiROUND( (p - offset) / size ) * size + offset` on one axis. */
const snapAxis = (v: number, size: number, origin: number): number => {
  const offset = origin % size;
  return kiRound((v - offset) / size) * size + offset;
};

/** `EDA_DRAW_FRAME::GetNearestGridPosition`: the nearest point on the grid. */
export function nearestGridPosition(p: Vec2, grid: number, gridOrigin: Vec2 = { x: 0, y: 0 }): Vec2 {
  return {
    x: snapAxis(p.x, grid, gridOrigin.x),
    y: snapAxis(p.y, grid, gridOrigin.y),
  };
}

/**
 * `EDA_DRAW_FRAME::GetNearestHalfGridPosition`: the same, on a grid of half the
 * step. Rotate and mirror snap their centre with this one, so a two-item
 * selection whose midpoint falls between grid points still lands somewhere the
 * items' own endpoints can reach.
 */
export function nearestHalfGridPosition(
  p: Vec2,
  grid: number,
  gridOrigin: Vec2 = { x: 0, y: 0 },
): Vec2 {
  return nearestGridPosition(p, grid / 2, gridOrigin);
}
