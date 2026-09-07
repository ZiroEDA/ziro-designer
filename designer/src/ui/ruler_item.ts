// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::RULER_ITEM` — the measurement the Measure Tool drags out.
 *
 * Shared for the reason the upstream file is in `common/preview_items/`: the
 * ruler is not pcbnew's. `ACTIONS::measureTool` is registered by
 * `PCB_VIEWER_TOOLS` (pcbnew, the footprint editor and viewer, and CVPCB's
 * `DISPLAY_FOOTPRINTS_FRAME`), by `EE_TOOLS` in eeschema and by gerbview, and
 * every one of them puts up this same item.
 *
 * The arithmetic, the label text AND the painting live here. The painting was
 * meant to belong to each canvas "because each of ours owns its own
 * transform", and that reasoning did not survive a second caller: the whole
 * item is drawn in DEVICE space — upstream divides every size by
 * `GetWorldScale()` precisely so the ruler does not grow with the zoom — so a
 * `toPx` callback and the view scale are the only things a canvas has to
 * supply. Three canvases wanted the tool and only one had it: pcbnew drew a
 * `rgba(120,230,255)` line with a 6px tick and an invented `dist (dx dy)`
 * string, and GerbView a dashed line with a dot at each end and no readout at
 * all. Neither had a graduation, and neither had Shift's 45 degree snap.
 *
 * What stays with each canvas is arming the tool and capturing the pointer.
 */

import {
  CURSOR_TEXT_OFFSET_PX,
  PREVIEW_FONT,
  constantGlyphHeightPx,
  constantLinePitchPx,
  constantStrokeWidthPx,
  cssSizeForGlyphHeight,
  bareDimensionValue,
  dimensionLabel,
  angleLabel,
  drawTextNextToCursor,
  fromIU,
  type PreviewUnits,
} from './preview_utils.js';

// `preview_utils.cpp`'s own functions now live in `preview_utils.ts`, where
// `TWO_POINT_ASSISTANT` and `ARC_ASSISTANT` can reach them; they are
// re-exported here because callers and tests already import them from the
// ruler, and because upstream's ruler really does use all of them.
export { constantGlyphHeightPx, constantLinePitchPx, constantStrokeWidthPx, cssSizeForGlyphHeight };

/** A world-space point, matching the canvases' own `Vec2`. */
export interface RulerPoint {
  x: number;
  y: number;
}

/**
 * `LEADER_MODE`, the angle constraint `TWO_POINT_GEOMETRY_MANAGER` applies.
 *
 * `PCB_VIEWER_TOOLS::MeasureTool` sets it per motion event
 * (`pcbnew/tools/pcb_viewer_tools.cpp:383-388`):
 *
 *     twoPtMgr.SetAngleSnap( evt->Modifier( MD_SHIFT ) ? LEADER_MODE::DEG45
 *                                                      : LEADER_MODE::DIRECT );
 *
 * so the measurement is a direct line, and Shift constrains it to 45° steps.
 */
export type RulerAngleSnap = 'direct' | 'deg45';

/**
 * The end point after the angle constraint.
 *
 * `DEG45` keeps the length along the snapped direction rather than projecting
 * onto it, which is what makes the ruler follow the cursor's distance while its
 * angle clicks round in eighths.
 */
export function rulerEnd(origin: RulerPoint, cursor: RulerPoint, snap: RulerAngleSnap): RulerPoint {
  if (snap === 'direct') return cursor;
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return cursor;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: origin.x + len * Math.cos(angle), y: origin.y + len * Math.sin(angle) };
}

/** The units a ruler label can be written in, as `EDA_UNITS` distinguishes them. */
export type RulerUnits = PreviewUnits;

/**
 * `RULER_ITEM::GetDimensionStrings` (`common/preview_items/ruler_item.cpp:456`)
 * — four lines, in this order: x, y, r, θ.
 *
 * θ is `-EDA_ANGLE( rulerVec )`, negated because screen Y grows downward while
 * the reported angle is the mathematical one, and it is always in degrees
 * regardless of the frame's distance units.
 */
export function rulerDimensionStrings(
  origin: RulerPoint,
  end: RulerPoint,
  iuPerMM: number,
  units: RulerUnits,
): string[] {
  const dx = end.x - origin.x;
  const dy = end.y - origin.y;
  const theta = (-Math.atan2(dy, dx) * 180) / Math.PI;
  return [
    dimensionLabel('x', dx, iuPerMM, units),
    dimensionLabel('y', dy, iuPerMM, units),
    dimensionLabel('r', Math.hypot(dx, dy), iuPerMM, units),
    angleLabel('θ', theta),
  ];
}

/* ------------------------------------------------------------------------ *
 * Ticks.
 *
 * `drawTicksAlongLine` (`common/preview_items/ruler_item.cpp:121-227`) and the
 * `getTickFormatForScale` above it. Every constant below is that file's.
 * ------------------------------------------------------------------------ */

/** `static const double maxTickDensity = 10.0;` — min pixels between ticks. */
const MAX_TICK_DENSITY = 10.0;
/** `midTickLengthFactor = 1.5`, `majorTickLengthFactor = 2.5` (`:35-36`). */
const MID_TICK_FACTOR = 1.5;
const MAJOR_TICK_FACTOR = 2.5;
/** `double minorTickLen = 5.0 / gal->GetWorldScale();` (`:421`) — screen px. */
export const MINOR_TICK_PX = 5.0;

/**
 * `tickFormats` (`:81-86`) — "simple 1/2/5 scales per decade".
 *
 *     { 2,    10,     5 },    // |....:....|
 *     { 2,     5,     0 },    // |....|
 *     { 2.5,   2,     0 },    // |.|.|
 */
interface TickFormat {
  /** Multiple from the last scale. */
  divisionBase: number;
  /** Ticks between major (labelled, long) ticks. */
  majorStep: number;
  /** Ticks between medium ticks; 0 for none. */
  midStep: number;
}
const TICK_FORMATS: readonly TickFormat[] = [
  { divisionBase: 2, majorStep: 10, midStep: 5 },
  { divisionBase: 2, majorStep: 5, midStep: 0 },
  { divisionBase: 2.5, majorStep: 2, midStep: 0 },
];

export interface RulerTick {
  /** Distance from the origin, in IU. */
  distIU: number;
  /** Tick length in screen px — minor, mid or major. */
  lengthPx: number;
  /** The value, unit-less, on major and mid ticks only (`aIncludeUnits=false`). */
  label: string | null;
}

/**
 * `getTickFormatForScale` then the loop in `drawTicksAlongLine`.
 *
 * `pxPerIU` is `gal->GetWorldScale()`: the tick spacing grows by the 1/2/5
 * sequence until one tick is at least `maxTickDensity` pixels from the next,
 * so the ruler never becomes a solid bar when you zoom out.
 */
export function rulerTicks(
  lengthIU: number,
  pxPerIU: number,
  iuPerMM: number,
  units: RulerUnits,
): RulerTick[] {
  if (!(lengthIU > 0) || !(pxPerIU > 0)) return [];

  // `aTickSpace = 1;` then `*= 2.54` for imperial. The 1 is ONE INTERNAL
  // UNIT, not one millimetre — the comment above it says so: "could start at a
  // set number of MM, but that's not available in common". Seeding this at 1 mm
  // instead started the 1/2/5 climb a hundred steps too coarse and labelled
  // every 5 mm where KiCad labels every 1 mm.
  let tickSpaceIU = units === 'mm' ? 1 : 2.54;
  let fmt = 0;
  // Bounded: each turn multiplies the spacing by at least 2, so it reaches any
  // reachable density in a few dozen steps. Upstream's `while( true )` cannot
  // spin because GetWorldScale is never zero; ours is guarded above.
  for (let guard = 0; guard < 200; guard++) {
    // `const auto pixelSpace = aTickSpace * aScale; if( pixelSpace >= maxTickDensity ) break;`
    if (tickSpaceIU * pxPerIU >= MAX_TICK_DENSITY) break;
    fmt = (fmt + 1) % TICK_FORMATS.length;
    tickSpaceIU *= TICK_FORMATS[fmt]!.divisionBase;
  }
  const format = TICK_FORMATS[fmt]!;

  // `int numTicks = (int) std::ceil( aLine.EuclideanNorm() / tickSpace );`
  const numTicks = Math.ceil(lengthIU / tickSpaceIU);
  const out: RulerTick[] = [];
  for (let i = 0; i < numTicks; i++) {
    let lengthPx = MINOR_TICK_PX;
    let labelled = false;
    if (i % format.majorStep === 0) {
      labelled = true;
      lengthPx *= MAJOR_TICK_FACTOR;
    } else if (format.midStep && i % format.midStep === 0) {
      labelled = true;
      lengthPx *= MID_TICK_FACTOR;
    }
    const distIU = tickSpaceIU * i;
    out.push({
      distIU,
      lengthPx,
      // `DimensionLabel( "", tickSpace * i, …, false )`: the value alone, no
      // prefix and no unit suffix.
      label: labelled ? bareDimensionValue(distIU, iuPerMM, units) : null,
    });
  }
  return out;
}

/**
 * `getTickLineWidth` (`ruler_item.cpp:55-63`): `textDims.StrokeWidth * 0.8`,
 * with the cursor-label dims. The ruler's own line, and the backside ticks.
 */
export function rulerLineWidthPx(devicePixelRatio: number): number {
  return constantStrokeWidthPx(devicePixelRatio) * 0.8;
}

/**
 * The graduation ticks: `gal->SetLineWidth( labelAttrs.m_StrokeWidth / 2 )`
 * (`ruler_item.cpp:218`), and those attrs are the rel=-1 tick-label dims.
 */
export function tickLineWidthPx(devicePixelRatio: number): number {
  return constantStrokeWidthPx(devicePixelRatio, -1) / 2;
}

// ---------------------------------------------------------------------------
// RULER_ITEM::ViewDraw (ruler_item.cpp:300-370).

/** `minorTickLen`, the graduation length `drawTicksAlongLine` starts from. */
const END_TICK_PX = 5;

export interface RulerDrawOptions {
  /** The two ends, in the caller's world units. */
  origin: RulerPoint;
  end: RulerPoint;
  /** World → device pixels, the caller's own transform. */
  toPx: (p: RulerPoint) => { x: number; y: number };
  /**
   * `GetWorldScale()`, device px per world unit. Only its MAGNITUDE is used —
   * pcbnew's flipped board view carries a negative X scale, and a graduation
   * spacing cannot be negative.
   */
  worldScale: number;
  /** The caller's IU per millimetre: pcbnew's and eeschema's differ. */
  iuPerMm: number;
  units: RulerUnits;
  /**
   * `rs->GetLayerColor( LAYER_AUX_ITEMS )` — the item carries no colour of its
   * own (`ruler_item.cpp:320-323`), so each frame's theme answers it.
   */
  color: string;
  devicePixelRatio: number;
  /** The backing-store size, so a graduation off screen can be skipped. */
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Paint the ruler: the line, an end tick at each end, the graduations along it
 * with their values, and the four dimension strings beside the cursor.
 *
 * Saves and restores the context, and works in device space throughout.
 */
export function drawRulerItem(ctx: CanvasRenderingContext2D, o: RulerDrawOptions): void {
  const dpr = o.devicePixelRatio;
  const a = o.toPx(o.origin);
  const b = o.toPx(o.end);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  // `getTickLineWidth( textDims )` = StrokeWidth * 0.8, not a hairline.
  ctx.lineWidth = rulerLineWidthPx(dpr) * dpr;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // An end tick perpendicular to the line at each end.
  const lenPx = Math.hypot(b.x - a.x, b.y - a.y);
  if (lenPx > 0) {
    const nx = (-(b.y - a.y) / lenPx) * END_TICK_PX * dpr;
    const ny = ((b.x - a.x) / lenPx) * END_TICK_PX * dpr;
    ctx.beginPath();
    ctx.moveTo(a.x - nx, a.y - ny);
    ctx.lineTo(a.x + nx, a.y + ny);
    ctx.moveTo(b.x - nx, b.y - ny);
    ctx.lineTo(b.x + nx, b.y + ny);
    ctx.stroke();
  }

  // `drawTicksAlongLine`: a tick every `tickSpace` along the line,
  // perpendicular to it, with the value on major and mid ones. All the sizes
  // are screen sizes upstream (`5.0 / GetWorldScale()`), so they are device px
  // here and the ruler does not grow with zoom.
  const dxw = o.end.x - o.origin.x;
  const dyw = o.end.y - o.origin.y;
  const lenIU = Math.hypot(dxw, dyw);
  if (lenIU > 0 && lenPx > 0) {
    const ux = dxw / lenIU;
    const uy = dyw / lenIU;
    // `VECTOR2D tickLine = aLine; RotatePoint( tickLine, ANGLE_90 );`
    // KiCad's ANGLE_90 turns (x, y) into (y, -x), which points to the side the
    // graduations and their numbers sit on. Negating it instead put both on
    // the wrong side of the line.
    //
    // Taken from the DEVICE-space line, not the world one. The two agree on a
    // Y-down canvas whose scale is positive, which is every caller this was
    // written against — but pcbnew mirrors X in the flipped board view and
    // GerbView's canvas is Y-up, and on either of those a world-space normal
    // is not perpendicular on screen. Perpendicular on screen is what a tick
    // is.
    const px = (b.y - a.y) / lenPx;
    const py = -(b.x - a.x) / lenPx;
    const ticks = rulerTicks(lenIU, Math.abs(o.worldScale), o.iuPerMm, o.units);
    // KiCad's GlyphSize is the stroke font's glyph HEIGHT; CSS font-size is the
    // em box, which is larger. Measure the face's own cap height once and solve
    // for the size that yields the height upstream asks for.
    const tickFont = cssSizeForGlyphHeight(ctx, constantGlyphHeightPx(dpr, -1) * dpr);
    // `labelOffset = tickLine.Resize( majorTickLen )`, where
    // drawTicksAlongLine's majorTickLen is minor * (2.5 + 1).
    const labelOff = END_TICK_PX * 3.5 * dpr;
    ctx.font = `${tickFont}px ${PREVIEW_FONT}`;
    ctx.textBaseline = 'middle';
    // `labelAngle = -EDA_ANGLE( tickLine )`: the numbers run along the TICK,
    // not along the ruler — which is why upstream's read bottom-to-top beside a
    // roughly horizontal measurement. Rotating them along the line instead is
    // what drew ours mirrored.
    //
    // The two `m_Halign` branches are the same rule stated in KiCad's angle
    // convention: keep the text right-reading. A baseline pointing into the
    // left half-plane is upside down, so it turns through 180 and anchors from
    // the other end.
    let textAngle = Math.atan2(py, px);
    let alignRight = false;
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
      textAngle += Math.PI;
      alignRight = true;
    }
    ctx.textAlign = alignRight ? 'right' : 'left';
    // `SetLineWidth( labelAttrs.m_StrokeWidth / 2 )`.
    ctx.lineWidth = tickLineWidthPx(dpr) * dpr;
    for (const t of ticks) {
      const p = o.toPx({ x: o.origin.x + ux * t.distIU, y: o.origin.y + uy * t.distIU });
      if (p.x < -50 || p.x > o.canvasWidth + 50 || p.y < -50 || p.y > o.canvasHeight + 50) continue;
      const L = t.lengthPx * dpr;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + px * L, p.y + py * L);
      ctx.stroke();
      if (t.label !== null) {
        ctx.save();
        ctx.translate(p.x + px * labelOff, p.y + py * labelOff);
        ctx.rotate(textAngle);
        ctx.fillText(t.label, 0, 0);
        ctx.restore();
      }
    }
  }

  ctx.restore();

  // `int prefX = rulerVec.y < 0.0 ? -1 : 1; int prefY = rulerVec.x < 0.0 ? 1 : -1;`
  // (`ruler_item.cpp:342-343`) — the ruler's preferred quadrant, away from the
  // origin so the labels never sit on the measurement. Upstream then tries the
  // other three and takes the best that fits on screen, which is not ported.
  //
  // The block itself is `DrawTextNextToCursor`'s, shared with the shape and arc
  // assistants. That sharing is what caught this frame placing it in the
  // OPPOSITE quadrant on both axes: upstream left-aligns and moves *right* for
  // `quadrant.x < 0`, and shifts up for `quadrant.y > 0`, and the vertical
  // offset is a LINE PITCH, never the horizontal 15 px.
  drawTextNextToCursor(ctx, {
    cursor: b,
    quadrant: { x: o.end.y < o.origin.y ? -1 : 1, y: o.end.x < o.origin.x ? 1 : -1 },
    strings: rulerDimensionStrings(o.origin, o.end, o.iuPerMm, o.units),
    color: o.color,
    devicePixelRatio: dpr,
  });
}
