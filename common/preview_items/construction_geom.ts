// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::CONSTRUCTION_GEOM` - `include/preview_items/construction_geom.h` +
 * `common/preview_items/construction_geom.cpp`: the preview overlay
 * `CONSTRUCTION_MANAGER` and `SNAP_MANAGER` (`tool/construction_manager.ts`)
 * feed with "construction" geometry - line extensions, arc centres, and the
 * snap-line's own guides and dashed segment.
 *
 * Upstream is a `VIEW_ITEM` whose `ViewDraw` calls straight into `GAL` in
 * WORLD coordinates - `gal.DrawLine( aLine.A, aLine.B )` takes IU, not screen
 * pixels, because `VIEW` applies the world -> device transform around every
 * item's draw call. `snap_indicator.ts` and `origin_viewitem.ts` are the
 * opposite case (a fixed on-screen marker size at every zoom) and so they
 * reset the canvas transform and take a `toPx` callback; this file keeps
 * upstream's transform instead, matching `designer/src/editors/pcb/renderBoard.ts`'s
 * own convention of setting `ctx.setTransform( view.scale, 0, 0, view.scale,
 * view.tx, view.ty )` once and then drawing every world item in raw IU. The
 * one thing that still needs converting is a size or pen width that upstream
 * states in *screen* pixels before handing it to GAL - `aView->ToWorld( x )`
 * and `aLineWidth / gal.GetWorldScale()` - which this port does with
 * `worldScale`, the same `view.scale` (device px per world IU) `GAL::m_worldScale`
 * already is.
 *
 * `KIGFX::DrawCross` / `KIGFX::DrawDashedLine`
 * (`preview_items/item_drawing_utils.h/.cpp`) are not ported as a shared
 * module elsewhere yet, so they are transcribed here, private to this file,
 * as {@link drawCross} / {@link drawDashedLine} - the only two callers
 * upstream has are both in this same file's `ViewDraw`.
 */

import { BOX2ISafe, type BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { ClipLine } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import {
  KIGEOM_ClipHalfLineToBox,
  KIGEOM_ClipLineToBox,
} from '@ziroeda/kimath/src/geometry/shape_utils.js';
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import { HALF_LINE } from '@ziroeda/kimath/src/geometry/half_line.js';
import { LINE } from '@ziroeda/kimath/src/geometry/line.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/** `KIGFX::CONSTRUCTION_GEOM::DRAWABLE` (`construction_geom.h:47`): the variant's members. */
export type CONSTRUCTION_GEOM_DRAWABLE = SEG | LINE | HALF_LINE | CIRCLE | SHAPE_ARC | VECTOR2I;

function isPlainPoint(aItem: CONSTRUCTION_GEOM_DRAWABLE): aItem is VECTOR2I {
  return (
    !(aItem instanceof SEG) &&
    !(aItem instanceof LINE) &&
    !(aItem instanceof HALF_LINE) &&
    !(aItem instanceof CIRCLE) &&
    !(aItem instanceof SHAPE_ARC)
  );
}

/** `KIGFX::CONSTRUCTION_GEOM::SNAP_GUIDE` (`construction_geom.h:49-54`). */
export interface CONSTRUCTION_GEOM_SNAP_GUIDE {
  Segment: SEG;
  /** A colour string; upstream is `COLOR4D`, the caller's theme answers it (see `CLAUDE.md`). */
  Color: string;
  LineWidth: number;
}

/** The private `DRAWABLE_INFO` (`construction_geom.h:73-78`). */
interface DRAWABLE_INFO {
  Item: CONSTRUCTION_GEOM_DRAWABLE;
  IsPersistent: boolean;
  LineWidth: number;
}

/**
 * `KIGFX::CONSTRUCTION_GEOM` (`construction_geom.h/.cpp`): the drawable state
 * only. `ViewBBox` / `ViewGetLayers` / `GetClass` are not ported - nothing
 * here is added to a `VIEW`, so there is no `VIEW_ITEM` machinery to answer
 * them for; {@link drawConstructionGeom} is the free-function `ViewDraw`.
 */
export class CONSTRUCTION_GEOM {
  private m_color = '#ffffff';
  private m_persistentColor = '#ffffff';

  private m_drawables: DRAWABLE_INFO[] = [];
  private m_snapGuides: CONSTRUCTION_GEOM_SNAP_GUIDE[] = [];

  private m_snapLine: SEG | null = null;

  SetColor(aColor: string): void {
    this.m_color = aColor;
  }

  SetPersistentColor(aColor: string): void {
    this.m_persistentColor = aColor;
  }

  GetColor(): string {
    return this.m_color;
  }

  GetPersistentColor(): string {
    return this.m_persistentColor;
  }

  /** `AddDrawable` (`construction_geom.cpp:44-47`). */
  AddDrawable(aItem: CONSTRUCTION_GEOM_DRAWABLE, aIsPersistent: boolean, aLineWidth = 1): void {
    this.m_drawables.push({ Item: aItem, IsPersistent: aIsPersistent, LineWidth: aLineWidth });
  }

  /** `SetSnapGuides` (`construction_geom.cpp:50-53`). */
  SetSnapGuides(aGuides: CONSTRUCTION_GEOM_SNAP_GUIDE[]): void {
    this.m_snapGuides = aGuides;
  }

  /** `ClearDrawables` (`construction_geom.cpp:56-59`). */
  ClearDrawables(): void {
    this.m_drawables = [];
  }

  SetSnapLine(aLine: SEG): void {
    this.m_snapLine = aLine;
  }

  ClearSnapLine(): void {
    this.m_snapLine = null;
  }

  GetDrawables(): readonly DRAWABLE_INFO[] {
    return this.m_drawables;
  }

  GetSnapGuides(): readonly CONSTRUCTION_GEOM_SNAP_GUIDE[] {
    return this.m_snapGuides;
  }

  GetSnapLine(): SEG | null {
    return this.m_snapLine;
  }
}

/** `KIGFX::DrawCross` (`item_drawing_utils.cpp:32-37`); `aSize` already in world units. */
function drawCross(ctx: CanvasRenderingContext2D, aPosition: VECTOR2I, aSize: number): void {
  const size = aSize / 2;

  ctx.beginPath();
  ctx.moveTo(aPosition.x - size, aPosition.y);
  ctx.lineTo(aPosition.x + size, aPosition.y);
  ctx.moveTo(aPosition.x, aPosition.y - size);
  ctx.lineTo(aPosition.x, aPosition.y + size);
  ctx.stroke();
}

/**
 * `KIGFX::DrawDashedLine` (`item_drawing_utils.cpp:40-79`). `aDashSize` and
 * the resulting geometry are all in world units already; `worldScale` is
 * only needed for the "sub-pixel cycle -> draw solid" bail-out, exactly as
 * `aGal.GetWorldScale()` is upstream.
 */
function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  aSeg: SEG,
  aDashSize: number,
  worldScale: number,
): void {
  const strokeOn = aDashSize;
  const strokeOff = aDashSize / 2;
  const dashCycleLen = strokeOn + strokeOff;

  const segVec = { x: aSeg.B.x - aSeg.A.x, y: aSeg.B.y - aSeg.A.y };
  const segLen = Math.hypot(segVec.x, segVec.y);

  const maxDashes = 100000.0;

  if (
    dashCycleLen <= 0.0 ||
    dashCycleLen * worldScale <= 1.0 ||
    segLen / dashCycleLen > maxDashes
  ) {
    ctx.beginPath();
    ctx.moveTo(aSeg.A.x, aSeg.A.y);
    ctx.lineTo(aSeg.B.x, aSeg.B.y);
    ctx.stroke();
    return;
  }

  const clip = BOX2ISafe({ x: aSeg.A.x, y: aSeg.A.y }, segVec);

  const theta = Math.atan2(segVec.y, segVec.x);

  const cycleVec = { x: dashCycleLen * Math.cos(theta), y: dashCycleLen * Math.sin(theta) };
  const dashVec = { x: strokeOn * Math.cos(theta), y: strokeOn * Math.sin(theta) };

  const cycleCount = Math.trunc(segLen / dashCycleLen) + 1;

  for (let cyclei = 0; cyclei < cycleCount; cyclei++) {
    const dashStart = { x: aSeg.A.x + cycleVec.x * cyclei, y: aSeg.A.y + cycleVec.y * cyclei };
    const dashEnd = { x: dashStart.x + dashVec.x, y: dashStart.y + dashVec.y };

    const dashSeg = {
      x1: KiROUND(dashStart.x),
      y1: KiROUND(dashStart.y),
      x2: KiROUND(dashEnd.x),
      y2: KiROUND(dashEnd.y),
    };

    if (ClipLine(clip, dashSeg)) break;

    ctx.beginPath();
    ctx.moveTo(dashSeg.x1, dashSeg.y1);
    ctx.lineTo(dashSeg.x2, dashSeg.y2);
    ctx.stroke();
  }
}

/** Options for {@link drawConstructionGeom}. */
export interface CONSTRUCTION_GEOM_DRAW_OPTIONS {
  /** `aView->GetViewport()`, already in world units (`BOX2ISafe` of it). */
  viewport: BOX2I;
  /**
   * `GAL::GetWorldScale()`: device px per world IU - `view.scale` in this
   * codebase's canvas convention. Converts a screen-pixel size or pen width
   * into world units, matching `aView->ToWorld( x )` / `x / gal.GetWorldScale()`.
   */
  worldScale: number;
}

/**
 * `CONSTRUCTION_GEOM::ViewDraw` (`construction_geom.cpp:76-165`). Assumes
 * `ctx` already carries the world -> device transform (this codebase's
 * `ctx.setTransform( view.scale, 0, 0, view.scale, view.tx, view.ty )`
 * convention), so every coordinate here is raw IU, exactly as `gal.DrawLine`
 * etc. take world coordinates upstream.
 */
export function drawConstructionGeom(
  ctx: CanvasRenderingContext2D,
  geom: CONSTRUCTION_GEOM,
  opts: CONSTRUCTION_GEOM_DRAW_OPTIONS,
): void {
  const { viewport, worldScale } = opts;

  ctx.lineJoin = 'miter';

  // Prevents extremely short snap lines from inhibiting drawing (usually a
  // length-1-IU rounding artefact from an intersection).
  const minSnapLineLength = 10;
  const snapLine = geom.GetSnapLine();
  const haveSnapLine = snapLine !== null && snapLine.Length() >= minSnapLineLength;

  // Avoid fighting with the snap line.
  const drawLineIfNotAlsoSnapLine = (aLine: SEG): void => {
    if (!haveSnapLine || !aLine.ApproxCollinear(snapLine as SEG, 1)) {
      ctx.beginPath();
      ctx.moveTo(aLine.A.x, aLine.A.y);
      ctx.lineTo(aLine.B.x, aLine.B.y);
      ctx.stroke();
    }
  };

  for (const drawable of geom.GetDrawables()) {
    const color = drawable.IsPersistent ? geom.GetPersistentColor() : geom.GetColor();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = drawable.LineWidth / worldScale;

    const item = drawable.Item;

    if (item instanceof LINE) {
      const segToBoundary = KIGEOM_ClipLineToBox(item, viewport);

      if (segToBoundary) drawLineIfNotAlsoSnapLine(segToBoundary);
    } else if (item instanceof HALF_LINE) {
      const segToBoundary = KIGEOM_ClipHalfLineToBox(item, viewport);

      if (segToBoundary) drawLineIfNotAlsoSnapLine(segToBoundary);
    } else if (item instanceof SEG) {
      drawLineIfNotAlsoSnapLine(item);
    } else if (item instanceof CIRCLE) {
      ctx.beginPath();
      ctx.arc(item.Center.x, item.Center.y, item.Radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (item instanceof SHAPE_ARC) {
      const center = item.GetCenter();
      const startDeg = item.GetStartAngle().AsDegrees();
      const sweepDeg = item.GetCentralAngle().AsDegrees();

      ctx.beginPath();
      ctx.arc(
        center.x,
        center.y,
        item.GetRadius(),
        (startDeg * Math.PI) / 180,
        ((startDeg + sweepDeg) * Math.PI) / 180,
        sweepDeg < 0,
      );
      ctx.stroke();
    } else if (isPlainPoint(item)) {
      drawCross(ctx, item, 16 / worldScale);
    }
  }

  for (const guide of geom.GetSnapGuides()) {
    const segment = guide.Segment;

    if (segment.A.x === segment.B.x && segment.A.y === segment.B.y) continue;

    const clipped = KIGEOM_ClipLineToBox(new LINE(segment), viewport);

    if (!clipped) continue;

    ctx.strokeStyle = guide.Color;
    ctx.lineWidth = guide.LineWidth;
    ctx.beginPath();
    ctx.moveTo(clipped.A.x, clipped.A.y);
    ctx.lineTo(clipped.B.x, clipped.B.y);
    ctx.stroke();
  }

  if (haveSnapLine) {
    const line = snapLine as SEG;

    ctx.strokeStyle = geom.GetPersistentColor();
    ctx.lineWidth = 2;

    const dashSizeBasis = 12 / worldScale;
    const snapOriginMarkerSize = 16 / worldScale;

    // Avoid clash with the snap marker if very close.
    const omitStartMarkerIfWithinLength = 8 / worldScale;

    drawDashedLine(ctx, line, dashSizeBasis, worldScale);

    if (Math.hypot(line.B.x - line.A.x, line.B.y - line.A.y) > omitStartMarkerIfWithinLength) {
      drawCross(ctx, line.A, snapOriginMarkerSize);
      ctx.beginPath();
      ctx.arc(line.A.x, line.A.y, snapOriginMarkerSize / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
