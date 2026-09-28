// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Drawing-sheet editing geometry: bounding boxes, picking, and corner-aware
 * moves over the `WksSheet` model. The editor works in resolved IU page space
 * for hit-testing (so the user clicks what they see) but writes changes back to
 * the anchored millimetre model, flipping the delta sign per corner exactly as
 * KiCad's DS_DATA_ITEM stores offsets inward from each page corner.
 */

import { iuToMM, schIUScale } from '../eda_units.js';
import type { Vec2 } from '@ziroeda/kimath';
import { bitmapSizeIu } from '../reference_image.js';
import { interline, layoutText } from '../font/stroke_font.js';
import type { WksBitmap, WksItem, WksPoint, WksCorner } from './types.js';
import type { DsDrawItem } from './layout.js';

export interface WksBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box (IU) of one resolved draw primitive. */
export function drawItemBBox(d: DsDrawItem): WksBBox {
  switch (d.kind) {
    case 'line':
    case 'rect': {
      const pad = Math.max(d.width / 2, 1);
      return {
        minX: Math.min(d.a.x, d.b.x) - pad,
        minY: Math.min(d.a.y, d.b.y) - pad,
        maxX: Math.max(d.a.x, d.b.x) + pad,
        maxY: Math.max(d.a.y, d.b.y) + pad,
      };
    }
    case 'poly': {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of d.pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = Math.max(d.width / 2, 1);
      return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }
    case 'text': {
      // Measure with the real stroke font, then rotate the box corners.
      const lines = d.text.split('\n');
      let widest = 0;
      for (const line of lines) {
        const { width } = layoutText(line, d.h);
        if (width > widest) widest = width;
      }
      const scaleX = d.h > 0 ? d.w / d.h : 1;
      const w = Math.max(widest * scaleX, d.w);
      // `STROKE_FONT::GetInterline`, the pitch `layoutText` just stacked the
      // lines at; the bare METRICS pitch boxed them 4.3 % too tall.
      const h = d.h + (lines.length - 1) * interline(d.h);
      const hx = d.hjustify === 'left' ? 0 : d.hjustify === 'right' ? -w : -w / 2;
      const hy = d.vjustify === 'top' ? 0 : d.vjustify === 'bottom' ? -h : -h / 2;
      const rad = (-d.rotate * Math.PI) / 180;
      const cos = Math.cos(rad),
        sin = Math.sin(rad);
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [cx, cy] of [
        [hx, hy],
        [hx + w, hy],
        [hx + w, hy + h],
        [hx, hy + h],
      ] as const) {
        const x = d.at.x + cx * cos - cy * sin;
        const y = d.at.y + cx * sin + cy * cos;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { minX, minY, maxX, maxY };
    }
    case 'bitmap': {
      // `BITMAP_BASE::GetSize()`, from the one module that ports it. Fall back
      // to a 1-inch square when the image hasn't been decoded yet, so a
      // freshly-placed / not-yet-loaded bitmap is still visible and pickable.
      const px = (n: number | undefined): number => (n && n > 0 ? n : d.ppi);
      const halfW = bitmapSizeIu(schIUScale, px(d.pxW), d.ppi, d.scale) / 2;
      const halfH = bitmapSizeIu(schIUScale, px(d.pxH), d.ppi, d.scale) / 2;
      return {
        minX: d.at.x - halfW,
        minY: d.at.y - halfH,
        maxX: d.at.x + halfW,
        maxY: d.at.y + halfH,
      };
    }
  }
}

/** Union bbox (IU) of every resolved primitive belonging to model item `src`. */
export function itemBBox(draws: DsDrawItem[], src: number): WksBBox | null {
  let box: WksBBox | null = null;
  for (const d of draws) {
    if (d.src !== src) continue;
    const b = drawItemBBox(d);
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : b;
  }
  return box;
}

const inside = (b: WksBBox, p: Vec2, tol: number): boolean =>
  p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol;

/**
 * `TestSegmentHit` — distance from a point to a segment, against `dist`.
 *
 * `common/trigo.cpp`: the perpendicular distance where the projection falls on
 * the segment, and the nearer endpoint's distance where it does not.
 */
function testSegmentHit(p: Vec2, a: Vec2, b: Vec2, dist: number): boolean {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return dx * dx + dy * dy <= dist * dist;
}

/** Point-in-polygon, the `SHAPE_POLY_SET::Collide` case that matters here. */
function pointInPoly(p: Vec2, pts: readonly Vec2[]): boolean {
  let inPoly = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inPoly = !inPoly;
  }
  return inPoly;
}

/**
 * `DS_DRAW_ITEM_*::HitTest( const VECTOR2I&, int )` — one primitive, one point.
 *
 * **Each shape tests its own geometry, not its bounding box.** That is the
 * whole point of these overrides, and the rect is the one that matters most:
 * the drawing sheet's border IS a rect covering the entire page, so a bbox test
 * selects it from anywhere on the sheet. Upstream says so itself, in
 * `DS_DRAW_ITEM_RECT::HitTest( const BOX2I& … )`:
 *
 *   "For greedy we need to check each side of the rect as we're pretty much
 *    always inside the rect which defines the drawing-sheet frame."
 *
 *   - rect    four edge segments, `dist = accuracy + penWidth / 2`
 *             (`ds_draw_item.cpp:360-394`)
 *   - line    `TestSegmentHit`, `mindist = accuracy + penWidth / 2 + 1`
 *             — the extra 1 IU is upstream's (`:461-465`)
 *   - text    the text box, `EDA_TEXT::TextHitTest` (`:228-231`)
 *   - poly    inside the polygon, `m_Polygons.Collide` (`:291-294`)
 *   - bitmap  the bounding box inflated by accuracy (`:505-511`)
 */
function hitDrawItem(d: DsDrawItem, p: Vec2, tol: number): boolean {
  switch (d.kind) {
    case 'rect': {
      const dist = tol + d.width / 2;
      const x0 = Math.min(d.a.x, d.b.x);
      const y0 = Math.min(d.a.y, d.b.y);
      const x1 = Math.max(d.a.x, d.b.x);
      const y1 = Math.max(d.a.y, d.b.y);
      const c = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      return c.some((from, i) => testSegmentHit(p, from, c[(i + 1) % 4]!, dist));
    }
    case 'line':
      return testSegmentHit(p, d.a, d.b, tol + d.width / 2 + 1);
    case 'poly':
      return pointInPoly(p, d.pts);
    case 'text':
    case 'bitmap':
      return inside(drawItemBBox(d), p, tol);
  }
}

/**
 * Pick the top-most model item at `world` (IU), within `tol`. Returns the
 * `src` index or `null`. Later items paint on top, so they win ties.
 */
export function pickDrawItem(draws: DsDrawItem[], world: Vec2, tol: number): number | null {
  let best: number | null = null;
  for (const d of draws) {
    if (hitDrawItem(d, world, tol)) best = d.src;
  }
  return best;
}

/** Model-item indices whose union bbox intersects the given IU box. */
export function itemsInBox(
  draws: DsDrawItem[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number[] {
  const minX = Math.min(ax, bx),
    maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by),
    maxY = Math.max(ay, by);
  const hits = new Set<number>();
  const overlaps = (b: WksBBox): boolean =>
    b.minX <= maxX && b.maxX >= minX && b.minY <= maxY && b.maxY >= minY;
  for (const d of draws) {
    // A rect is tested side by side, not as a filled box, for the same reason
    // the point hit test is: the sheet's border rect spans the whole page, so
    // any drag anywhere would sweep it in. Upstream builds four zero-thickness
    // boxes from the bounding box and intersects each
    // (`DS_DRAW_ITEM_RECT::HitTest( const BOX2I&, … )`, ds_draw_item.cpp:397-430).
    if (d.kind === 'rect') {
      const b = drawItemBBox(d);
      const sides: WksBBox[] = [
        { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.minY },
        { minX: b.minX, maxX: b.maxX, minY: b.maxY, maxY: b.maxY },
        { minX: b.minX, maxX: b.minX, minY: b.minY, maxY: b.maxY },
        { minX: b.maxX, maxX: b.maxX, minY: b.minY, maxY: b.maxY },
      ];
      if (sides.some(overlaps)) hits.add(d.src);
      continue;
    }
    if (overlaps(drawItemBBox(d))) hits.add(d.src);
  }
  return [...hits].sort((a, z) => a - z);
}

const isRightCorner = (c: WksCorner): boolean => c === 'rtcorner' || c === 'rbcorner';
const isBottomCorner = (c: WksCorner): boolean => c === 'lbcorner' || c === 'rbcorner';

/** Apply a page-space mm delta to one anchored point (sign flips per corner). */
function shiftPoint(p: WksPoint, dxMM: number, dyMM: number): WksPoint {
  return {
    ...p,
    x: p.x + (isRightCorner(p.corner) ? -dxMM : dxMM),
    y: p.y + (isBottomCorner(p.corner) ? -dyMM : dyMM),
  };
}

/** Translate an item by a page-space delta given in IU (used by drag-move). */
export function translateItem(item: WksItem, deltaIU: Vec2): WksItem {
  const dxMM = iuToMM(deltaIU.x);
  const dyMM = iuToMM(deltaIU.y);
  switch (item.type) {
    case 'line':
    case 'rect':
      return {
        ...item,
        start: shiftPoint(item.start, dxMM, dyMM),
        end: shiftPoint(item.end, dxMM, dyMM),
      };
    case 'text':
      return { ...item, pos: shiftPoint(item.pos, dxMM, dyMM) };
    case 'polygon':
    case 'bitmap':
      return { ...item, pos: shiftPoint(item.pos, dxMM, dyMM) };
  }
}

/** Immutably replace item at `index` in a sheet's item list. */
export function replaceItem<T extends { items: WksItem[] }>(
  sheet: T,
  index: number,
  next: WksItem,
): T {
  const items = sheet.items.slice();
  items[index] = next;
  return { ...sheet, items };
}

/**
 * `DS_DATA_ITEM_BITMAP::GetPPI()` — `common/drawing_sheet/ds_data_item.cpp:772-778`:
 *
 * ```cpp
 * return m_ImageBitmap->GetPPI() / m_ImageBitmap->GetScale();
 * ```
 *
 * The number the Properties panel's "Bitmap DPI:" field shows is *derived*, not
 * stored. `WksBitmap.ppi` is the image's own resolution — `BITMAP_BASE::GetPPI()`,
 * read out of the PNG's pHYs chunk — and the file records only `(scale …)`
 * (`ds_data_model_io.cpp:405-430`); no DPI is ever written. Show `ppi` raw and
 * the field is right only while the scale is 1.
 *
 * Upstream falls back to 300 when the item has no image at all (`:777`).
 */
export function bitmapDisplayPPI(item: Pick<WksBitmap, 'ppi' | 'scale'>): number {
  if (!item.ppi || !item.scale) return 300;
  return item.ppi / item.scale;
}

/**
 * `DS_DATA_ITEM_BITMAP::SetPPI()` — `ds_data_item.cpp:781-785`:
 *
 * ```cpp
 * m_ImageBitmap->SetScale( (double) m_ImageBitmap->GetPPI() / aBitmapPPI );
 * ```
 *
 * Editing the DPI moves the **scale**, which is the field that gets serialized.
 * Returns the new scale; the caller patches `scale`, never `ppi`. Writing `ppi`
 * instead resizes the image on screen and then loses the change on the next
 * load, because the reader takes `ppi` back from the PNG.
 *
 * A DPI of zero would divide by zero upstream too; the panel refuses it before
 * calling, the same way `msg.ToLong()` gates `SetPPI` at `properties_frame.cpp:634-637`.
 */
export function bitmapScaleForPPI(item: Pick<WksBitmap, 'ppi'>, aBitmapPPI: number): number {
  return item.ppi / aBitmapPPI;
}
