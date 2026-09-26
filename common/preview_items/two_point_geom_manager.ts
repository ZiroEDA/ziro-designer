// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TWO_POINT_GEOMETRY_MANAGER` — an origin, an end, and the angle constraint
 * between them. Counterpart: `include/preview_items/two_point_geom_manager.h`.
 *
 * It is the whole state of the line, rectangle and circle tools:
 * `DRAWING_TOOL::drawShape` drives one of these for all three, and
 * `updateSegmentFromGeometryMgr` is two lines — `SetStart( GetOrigin() )` and
 * `SetEnd( GetEnd() )` — because a `PCB_SHAPE` already means "opposite corners"
 * for a rectangle and "centre, then a point on the circumference" for a circle.
 * `PCB_VIEWER_TOOLS::MeasureTool` uses it too, for the ruler.
 *
 * The angle snap lives **here** rather than at the call site, and it is
 * `GetVectorSnapped45` / `GetVectorSnapped90` — which do *not* preserve the
 * vector's length. That distinction is the whole point: they zero or equalise
 * the components so a cursor on the grid stays on the grid. Projecting onto the
 * nearest 45° ray instead keeps the length and lands the far end between grid
 * nodes, which is exactly the bug this replaced in the PCB editor.
 */

import {
  LeaderMode,
  vectorSnapped45,
  vectorSnapped90,
} from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export { LeaderMode };

/** `TWO_POINT_GEOMETRY_MANAGER`. */
export class TWO_POINT_GEOMETRY_MANAGER {
  private m_origin: Vec2 = { x: 0, y: 0 };
  private m_end: Vec2 = { x: 0, y: 0 };
  private m_angleSnap: LeaderMode = LeaderMode.DIRECT;
  private m_originSet = false;

  /** `SetOrigin` — the fixed end. */
  SetOrigin(origin: Vec2): void {
    this.m_origin = { x: origin.x, y: origin.y };
    this.m_originSet = true;
  }

  /** `GetOrigin`. */
  GetOrigin(): Vec2 {
    return this.m_origin;
  }

  /**
   * `SetEnd` — the end that moves with the cursor, snapped by the current
   * mode on the way in.
   *
   * `only45` is not available here: `drawShape` needs it for a rectangle (a
   * square, rather than a square-or-axis-aligned rectangle), so it snaps the
   * vector itself and hands the result in already constrained. Both snap
   * functions are idempotent, so passing through this one again changes
   * nothing.
   */
  SetEnd(end: Vec2): void {
    const vec = { x: end.x - this.m_origin.x, y: end.y - this.m_origin.y };
    switch (this.m_angleSnap) {
      case LeaderMode.DEG45: {
        const s = vectorSnapped45(vec);
        this.m_end = { x: this.m_origin.x + s.x, y: this.m_origin.y + s.y };
        break;
      }
      case LeaderMode.DEG90: {
        const s = vectorSnapped90(vec);
        this.m_end = { x: this.m_origin.x + s.x, y: this.m_origin.y + s.y };
        break;
      }
      default:
        this.m_end = { x: end.x, y: end.y };
        break;
    }
  }

  /** `GetEnd`. */
  GetEnd(): Vec2 {
    return this.m_end;
  }

  /** `SetAngleSnap`. */
  SetAngleSnap(snap: LeaderMode): void {
    this.m_angleSnap = snap;
  }

  /** `GetAngleSnap`. */
  GetAngleSnap(): LeaderMode {
    return this.m_angleSnap;
  }

  /** `IsReset` — nothing has been placed, so there is nothing to draw. */
  IsReset(): boolean {
    return !this.m_originSet;
  }

  /** `Reset`. Note that it clears only the flag, as upstream does. */
  Reset(): void {
    this.m_originSet = false;
  }

  /**
   * `IsEmpty` — no origin, or an end that has not moved off it.
   *
   * `drawShape` uses this for the second click: clicking twice in the same
   * spot means the user is finished, and the zero-sized shape is thrown away
   * rather than committed.
   */
  IsEmpty(): boolean {
    return (
      !this.m_originSet || (this.m_origin.x === this.m_end.x && this.m_origin.y === this.m_end.y)
    );
  }
}
