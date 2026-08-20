// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Canvas 2D renderer for Gerber layers, the app-side mirror of GerbView's
 * GAL painter (`gerbview/gerbview_painter.cpp` GERBVIEW_PAINTER::Draw). It draws
 * each visible image into a reusable offscreen buffer honouring Gerber
 * compositing rules, dark objects add, clear objects (LPC) and drilled holes
 * erase, negative images invert, macro exposure-off primitives cut holes, then
 * blends the buffers onto the main canvas in layer order. Display options
 * (sketch modes for flashed/lines/polygons, negative-object ghosting, diff
 * mode, high-contrast dimming, DCode numbers) match the left-toolbar toggles.
 */

import {
  GBR_BASIC_SHAPE,
  type GERBER_FILE_IMAGE,
  type GERBER_DRAW_ITEM,
  type AmResolvedShape,
} from '@ziroeda/gerbview';
import {
  GERBER_BG_COLOR,
  GERBER_DCODE_COLOR,
  GERBER_NEGATIVE_COLOR,
  highlightedLayerColor,
} from './gerberColors.js';

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export interface GerberLayerView {
  image: GERBER_FILE_IMAGE;
  color: string;
  visible: boolean;
}

export interface GerberRenderOptions {
  flashedSketch: boolean;
  linesSketch: boolean;
  polygonsSketch: boolean;
  showNegativeObjects: boolean;
  showDcodes: boolean;
  xorMode: boolean;
  highContrast: boolean;
  /** Active layer index (into `layers`) for high-contrast dimming. */
  activeLayer: number;
  /** Flip the whole view horizontally (mirror). */
  flipView: boolean;
  background: string;
  /** Optional highlight (by net / component / attribute / DCode). */
  highlightTest?: (item: GERBER_DRAW_ITEM) => boolean;
}

/** A shared offscreen buffer, grown to fit the target canvas. */
let scratch: HTMLCanvasElement | null = null;
function getScratch(w: number, h: number): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch;
}

/**
 * Set the world transform on a context (IU → device px). Gerber Y points up, so
 * the vertical scale is negated to map it to screen-down. `flip` mirrors X for
 * the "flip view" (view-from-back) option.
 */
function applyWorld(ctx: CanvasRenderingContext2D, v: ViewTransform, flip: boolean): void {
  const sx = flip ? -v.scale : v.scale;
  ctx.setTransform(sx, 0, 0, -v.scale, v.tx, v.ty);
}

/** World IU → device px (matches applyWorld). */
export function worldToDevice(
  v: ViewTransform,
  flip: boolean,
  x: number,
  y: number,
): { x: number; y: number } {
  const sx = flip ? -v.scale : v.scale;
  return { x: sx * x + v.tx, y: -v.scale * y + v.ty };
}

/** Device px → world IU (inverse of worldToDevice). */
export function deviceToWorld(
  v: ViewTransform,
  flip: boolean,
  px: number,
  py: number,
): { x: number; y: number } {
  const sx = flip ? -v.scale : v.scale;
  return { x: (px - v.tx) / sx, y: (py - v.ty) / -v.scale };
}

/**
 * `GERBVIEW_RENDER_SETTINGS::GetColor( aItem, aLayer )`
 * (`gerbview/gerbview_painter.cpp:100-160`), for the cases this renderer
 * reaches, **in upstream's own branch order**:
 *
 *     if( gbrItem && gbrItem->GetLayerPolarity() )      // :122
 *     {
 *         if( show_negative_objects ) return LAYER_NEGATIVE_OBJECTS;
 *         else                        return transparent;
 *     }
 *     if( !m_netHighlightString.IsEmpty() && ... )      // :135
 *         return m_layerColorsHi[aLayer];
 *
 * The order is load-bearing and easy to get backwards: **polarity is tested
 * before the highlight**, so a clear object that also matches the highlight is
 * drawn as a negative object - or not at all - rather than brightened. Written
 * the other way round it reads just as plausibly and is wrong.
 *
 * `GetLayerPolarity()` is `m_LayerNegative`, true meaning NEGATIVE
 * (`gerber_draw_item.h:77,266`), which is the complement of our reader's
 * `layerPolarity` ("true = dark (add)") - hence `negativePolarity` here.
 *
 * `null` is upstream's `transparent`, `COLOR4D( 0, 0, 0, 0 )` (`:103`): a clear
 * object with the toggle off contributes no ink of its own. The caller keeps
 * compositing it with `destination-out`, which is what makes it erase.
 *
 * A highlighted item takes `m_layerColorsHi[aLayer]` - `Brightened( 0.5 )` of
 * the LAYER's own colour (`:70`) - so it still reads as belonging to its layer.
 * Ours painted every highlight one flat white.
 *
 * Pure and exported, so the choice can be pinned without a canvas.
 */
export function itemColor(
  layerColor: string,
  highlighted: boolean,
  negativePolarity: boolean,
  showNegativeObjects: boolean,
): string | null {
  if (negativePolarity) return showNegativeObjects ? GERBER_NEGATIVE_COLOR : null;
  if (highlighted) return highlightedLayerColor(layerColor);
  return layerColor;
}

/** Compute the effective add/erase op for a shape. */
function shapeOp(itemAdd: boolean, exposure: boolean, negative: boolean): GlobalCompositeOperation {
  const effectiveAdd = itemAdd === exposure;
  const finalAdd = negative ? !effectiveAdd : effectiveAdd;
  return finalAdd ? 'source-over' : 'destination-out';
}

function fillCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(r, 0), 0, Math.PI * 2);
  ctx.fill();
}

function fillPolygon(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fill();
}

function fillCapsule(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(width, 0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawResolvedShape(
  ctx: CanvasRenderingContext2D,
  sh: AmResolvedShape,
  itemAdd: boolean,
  negative: boolean,
  color: string,
  sketch: boolean,
  worldPen: number,
): void {
  const op = shapeOp(itemAdd, sh.exposure, negative);
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  // Sketch (outline) mode: stroke only the exposure-on (added) shapes; the
  // erase shapes still cut normally so holes read correctly.
  if (sketch && op === 'source-over') {
    ctx.lineWidth = worldPen;
    if (sh.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(sh.center.x, sh.center.y, Math.max(sh.radius, 0), 0, Math.PI * 2);
      ctx.stroke();
    } else if (sh.kind === 'segment') {
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sh.a.x, sh.a.y);
      ctx.lineTo(sh.b.x, sh.b.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(sh.points[0]!.x, sh.points[0]!.y);
      for (let i = 1; i < sh.points.length; i++) ctx.lineTo(sh.points[i]!.x, sh.points[i]!.y);
      ctx.closePath();
      ctx.stroke();
    }
    return;
  }
  if (sh.kind === 'circle') fillCircle(ctx, sh.center.x, sh.center.y, sh.radius);
  else if (sh.kind === 'segment') fillCapsule(ctx, sh.a, sh.b, sh.width);
  else fillPolygon(ctx, sh.points);
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  item: GERBER_DRAW_ITEM,
  layerColor: string,
  negative: boolean,
  opts: GerberRenderOptions,
  worldPen: number,
): void {
  const itemAdd = item.layerPolarity;
  const highlighted = !!opts.highlightTest?.(item);
  // "Show negative objects": a clear (LPC) object is normally invisible (it
  // erases). With the toggle on it is drawn as a ghost so it can be seen.
  const showNeg = opts.showNegativeObjects && !itemAdd;
  // m_layerColorsHi[aLayer] = baseColor.Brightened( 0.5 ) - the LAYER's colour
  // lifted, which is what GERBVIEW_RENDER_SETTINGS::GetColor returns for a net,
  // component or attribute match (`gerbview_painter.cpp:70,135-147`). It used to
  // be a flat white for every layer.
  const color =
    itemColor(layerColor, highlighted, !itemAdd, opts.showNegativeObjects) ?? layerColor;
  // Highlighted and ghosted negative objects always add (source-over).
  const op: GlobalCompositeOperation =
    highlighted || showNeg
      ? 'source-over'
      : negative
        ? itemAdd
          ? 'destination-out'
          : 'source-over'
        : itemAdd
          ? 'source-over'
          : 'destination-out';
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  switch (item.shape) {
    case GBR_BASIC_SHAPE.GBR_SEGMENT: {
      ctx.globalCompositeOperation = op;
      if (opts.linesSketch) {
        ctx.lineWidth = worldPen;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(item.start.x, item.start.y);
        ctx.lineTo(item.end.x, item.end.y);
        ctx.stroke();
      } else {
        fillCapsule(ctx, item.start, item.end, item.width);
      }
      break;
    }
    case GBR_BASIC_SHAPE.GBR_ARC:
    case GBR_BASIC_SHAPE.GBR_CIRCLE: {
      ctx.globalCompositeOperation = op;
      const r = Math.hypot(item.start.x - item.arcCentre.x, item.start.y - item.arcCentre.y);
      ctx.lineWidth = opts.linesSketch ? worldPen : Math.max(item.width, worldPen);
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (item.shape === GBR_BASIC_SHAPE.GBR_CIRCLE) {
        ctx.arc(item.arcCentre.x, item.arcCentre.y, r, 0, Math.PI * 2);
      } else {
        const a0 = Math.atan2(item.start.y - item.arcCentre.y, item.start.x - item.arcCentre.x);
        const a1 = Math.atan2(item.end.y - item.arcCentre.y, item.end.x - item.arcCentre.x);
        ctx.arc(item.arcCentre.x, item.arcCentre.y, r, a0, a1, item.arcCcw);
      }
      ctx.stroke();
      break;
    }
    case GBR_BASIC_SHAPE.GBR_POLYGON: {
      ctx.globalCompositeOperation = op;
      if (opts.polygonsSketch) {
        ctx.lineWidth = worldPen;
        ctx.beginPath();
        if (item.polyPoints.length) {
          ctx.moveTo(item.polyPoints[0]!.x, item.polyPoints[0]!.y);
          for (let i = 1; i < item.polyPoints.length; i++)
            ctx.lineTo(item.polyPoints[i]!.x, item.polyPoints[i]!.y);
          ctx.closePath();
        }
        ctx.stroke();
      } else {
        fillPolygon(ctx, item.polyPoints);
      }
      break;
    }
    default: {
      // Flashed spot: resolve to primitives and composite each.
      const shapes = item.resolveFlashShapes();
      if (showNeg) {
        // Ghost the added primitives of a negative flash; skip the holes.
        ctx.globalCompositeOperation = 'source-over';
        for (const sh of shapes) {
          if (!sh.exposure) continue;
          if (sh.kind === 'circle') fillCircle(ctx, sh.center.x, sh.center.y, sh.radius);
          else if (sh.kind === 'segment') fillCapsule(ctx, sh.a, sh.b, sh.width);
          else fillPolygon(ctx, sh.points);
        }
      } else {
        for (const sh of shapes) {
          drawResolvedShape(ctx, sh, itemAdd, negative, color, opts.flashedSketch, worldPen);
        }
      }
      break;
    }
  }
}

/** Draw one image's items into the (identity-transform) layer buffer. */
function drawImageToBuffer(
  lctx: CanvasRenderingContext2D,
  layer: GerberLayerView,
  v: ViewTransform,
  opts: GerberRenderOptions,
  canvasW: number,
  canvasH: number,
): void {
  const negative = layer.image.imageNegative;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, canvasW, canvasH);

  applyWorld(lctx, v, opts.flipView);
  const worldPen = 1 / v.scale;

  if (negative) {
    // Negative image: start from a filled field the dark objects erase.
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = layer.color;
    const b = layer.image.computeBoundingBox();
    const pad = worldPen * 20;
    lctx.fillRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
  }

  lctx.lineCap = 'round';
  lctx.lineJoin = 'round';
  for (const item of layer.image.items) {
    drawItem(lctx, item, layer.color, negative, opts, worldPen);
  }
  lctx.globalCompositeOperation = 'source-over';
  lctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Render all layers to the main canvas. `layers` is bottom-to-top; GerbView
 * draws the active layer last (on top), the caller orders the array so the
 * active layer is at the end.
 */
export function renderGerberLayers(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  v: ViewTransform,
  layers: GerberLayerView[],
  opts: GerberRenderOptions,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.background || GERBER_BG_COLOR;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const buf = getScratch(canvasW, canvasH);
  const lctx = buf.getContext('2d');
  if (!lctx) return;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!layer.visible || layer.image.items.length === 0) continue;
    drawImageToBuffer(lctx, layer, v, opts, canvasW, canvasH);

    // Compose onto the main canvas.
    if (opts.xorMode) {
      ctx.globalCompositeOperation = 'difference';
      ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      // Translucent layers (GerbView look) so overlaps blend; high-contrast
      // dims layers other than the active one (drawn last).
      // A layer keeps the theme's own alpha, which is 1 for all 64 rows of
      // s_defaultTheme; only toggleForceOpacityMode lowers it, to
      // m_OpacityModeAlphaValue (`gerbview_painter.cpp:65-66`). We used to
      // composite everything at a permanent 0.8, a number with no upstream
      // source, which made every layer translucent whether or not that mode
      // was on.
      ctx.globalAlpha = opts.highContrast && i !== layers.length - 1 ? 0.3 : 1;
    }
    ctx.drawImage(buf, 0, 0);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // DCode number annotations (drawn upright in device space).
  if (opts.showDcodes) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = GERBER_DCODE_COLOR;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const layer of layers) {
      if (!layer.visible) continue;
      for (const item of layer.image.items) {
        if (!item.dcodeNum) continue;
        if (
          item.shape === GBR_BASIC_SHAPE.GBR_SEGMENT ||
          item.shape === GBR_BASIC_SHAPE.GBR_ARC ||
          item.shape === GBR_BASIC_SHAPE.GBR_POLYGON
        )
          continue;
        const b = item.getBoundingBox();
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const d = worldToDevice(v, opts.flipView, cx, cy);
        ctx.fillText(`D${item.dcodeNum}`, d.x, d.y);
      }
    }
  }
}
