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
  IU_PER_MM,
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
import {
  defaultDrawingSheet,
  layoutDrawingSheet,
  PAPER_MM,
  SCH_IU_PER_MM,
  type DsDrawItem,
} from '@ziroeda/common';
import { drawDrawingSheetItems } from '@ziroeda/common';
import { settings } from '../../prefs/settings.js';

/**
 * `PAGE_INFO pageInfo( PAGE_SIZE_TYPE::GERBER )` — the page GerbView sets at
 * startup and again on every clear (gerbview_frame.cpp:134-136, 333-335). It is
 * 32000 x 32000 mils (page_info.cpp:61), a square far larger than any drawing
 * a Gerber job puts on it.
 *
 * It is the DEFAULT, not the only value: this said "and GerbView never changes
 * it", and both of those lines change it —
 *
 *     pageInfo.SetType( cfg->m_Appearance.page_type );
 *     (gerbview_frame.cpp:334, and again at :1213)
 *
 * from the seven Page Size radios on Preferences > Gerber Viewer > Display
 * Options. `"GERBER"` is only what the `PARAM` defaults to
 * (`gerbview_settings.cpp:53-55`).
 */
const GERBER_PAPER = 'GERBER';

/**
 * The page the sheet and the page-limits rectangle are drawn on.
 *
 * Asked of the settings manager here rather than threaded down as a prop,
 * because upstream it is asked of the settings object at the same depth: the
 * DRAW PANEL, not the frame, is what runs `GetAppSettings<…>( "gerbview" )` and
 * reads `m_Appearance.page_type` back out of it. `usePlEditorColors` documents
 * the same shape for pl_editor's palette.
 *
 * A caller may still pass one, which is what lets a test state the page it is
 * asserting about instead of depending on a store.
 */
function paperOf(paper?: string): string {
  const want = paper ?? settings.gerbview.appearance.page_type;
  return PAPER_MM[want] === undefined ? GERBER_PAPER : want;
}

/**
 * The world units this canvas draws in, which are the ones the Gerber PARSER
 * emits — `@ziroeda/gerbview`'s `IU_PER_MM`, the same constant every bounding
 * box and every item coordinate on this canvas already uses.
 *
 * Deliberately not `common`'s `GERB_IU_PER_MM`. Those two do not agree: KiCad
 * says `GERB_IU_PER_MM = 1e5`, "Gerbview IU is 10 nanometers"
 * (include/base_units.h:69), and our `common/src/eda_units.ts:24` matches it,
 * but our parser works in 1e6. Reconciling them is a change to every Gerber
 * coordinate in the package and is not this feature's to make; drawing the page
 * in the units the canvas actually uses is. Using the 1e5 constant here would
 * have drawn the page a tenth of its size, which is the kind of mistake that
 * looks like a layout bug rather than a units bug.
 */
const GERB_IU = IU_PER_MM;

/** No drawing-sheet item is ever selected outside pl_editor. */
const NO_DS_SELECTION: ReadonlySet<number> = new Set();

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
  /**
   * LAYER_GERBVIEW_DRAWINGSHEET — `show_border_and_titleblock`, which defaults
   * FALSE (gerbview_settings.cpp:45-46). GerbView opens with no sheet.
   */
  drawingSheet: boolean;
  /**
   * LAYER_GERBVIEW_PAGE_LIMITS — `m_DisplayPageLimits`, also default FALSE
   * (gerbview_settings.cpp:58, gbr_display_options.h:58). Independent of the
   * sheet: two layers, two colours, two visibilities.
   */
  pageLimits: boolean;
  /**
   * The alpha every GERBER DRAW layer's colour is forced to — 1 unless
   * forced-opacity mode is on, in which case
   * `m_Display.m_OpacityModeAlphaValue`.
   *
   * `GERBVIEW_RENDER_SETTINGS::LoadColors` (`gerbview_painter.cpp:57-71`):
   *
   *     COLOR4D baseColor = aSettings->GetColor( i );
   *     if( gvconfig()->m_Display.m_ForceOpacityMode )
   *         baseColor.a = gvconfig()->m_Display.m_OpacityModeAlphaValue;
   *
   * — and only over `GERBVIEW_LAYER_ID_START .. + GERBER_DRAWLAYERS_COUNT`.
   * The loop below it re-reads LAYER_DCODES, the grid, the drawing sheet and
   * the page limits at their own colours, so those are NOT dimmed; here that
   * falls out of the composite happening per layer buffer, with the D-code
   * annotations drawn afterwards at alpha 1.
   */
  layerOpacity: number;
  /**
   * `PAGE_INFO`'s type — `appearance.page_type`, the seven Page Size radios on
   * Preferences > Gerber Viewer > Display Options, which the frame pushes into
   * the page with `pageInfo.SetType( cfg->m_Appearance.page_type )`
   * (`gerbview_frame.cpp:334`, `:1213`).
   *
   * It is on the render options rather than read from the settings manager
   * inside the painter, and the difference is a repaint: the canvas asks for a
   * new frame when this object's identity changes
   * (`GerberCanvas.tsx`'s `[layers, options, …]` effect), so a page size the
   * painter fetched for itself would be stored, and correct, and invisible
   * until something else happened to redraw. That is the half-live state a
   * Preferences control must never be in.
   */
  paper: string;
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
      // NOT dimmed here. "Inactive Layer View Mode" mixes the layer's colour
      // toward the background (`common/render_settings.cpp:92-93`), which the
      // frame does per layer before handing the colours over, so both this and
      // the GL renderer get it. Doing it as alpha instead — which is what this
      // line used to do, at a 0.3 with no upstream source — composites against
      // whatever is underneath, so two dimmed layers overlapping came out
      // brighter than either.
      //
      // `layerOpacity` is the ONE thing that does lower it: forced-opacity
      // mode, which upstream pushes into each gerber layer's COLOR4D alpha
      // rather than into a composite. A layer buffer is drawn in one colour,
      // so the two are the same picture. See the note on the option.
      ctx.globalAlpha = opts.layerOpacity;
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

/**
 * GerbView's drawing sheet — `GERBVIEW_FRAME::SetPageSettings`
 * (gerbview/gerbview_frame.cpp:878-902):
 *
 * ```cpp
 * DS_PROXY_VIEW_ITEM* drawingSheet = new DS_PROXY_VIEW_ITEM( gerbIUScale, &GetPageSettings(),
 *                                                            &Prj(), &GetTitleBlock(), nullptr );
 * drawingSheet->SetPageNumber( "1" );
 * drawingSheet->SetSheetCount( 1 );
 * drawingSheet->SetColorLayer( LAYER_GERBVIEW_DRAWINGSHEET );
 * drawingSheet->SetPageBorderColorLayer( LAYER_GERBVIEW_PAGE_LIMITS );
 * drawPanel->SetDrawingSheet( drawingSheet );
 * ```
 *
 * GerbView is not a special case: it builds the same `DS_PROXY_VIEW_ITEM` the
 * schematic (`eeschema/sch_view.cpp:117`) and the board
 * (`pcbnew/pcb_draw_panel_gal.cpp:472`) build, and that item's `ViewDraw`
 * constructs a `DS_PAINTER` over `common/drawing_sheet/`. So this goes through
 * `layoutDrawingSheet` + `drawDrawingSheetItems` exactly as the other two
 * launchers do; only the IU scale and the two colour layers differ.
 *
 * The two things GerbView leaves EMPTY are deliberate, not missing:
 *
 *  - the title block. `GetTitleBlock()` returns `m_gerberLayout->GetTitleBlock()`
 *    and nothing in gerbview/ ever calls `SetTitleBlock`, so it is
 *    default-constructed. Every `${TITLE}` / `${COMPANY}` / `${COMMENT…}` in the
 *    sheet resolves to an empty string, and the title block draws as ruled but
 *    blank boxes. That is what a live GerbView shows.
 *  - the file name, sheet name and sheet path. `SetPageSettings` never calls
 *    `SetFileName`/`SetSheetName`/`SetSheetPath` on the proxy item, so those
 *    stay empty too.
 *
 * `${PAPER}` is the exception that does resolve: `DS_DRAW_ITEM_LIST` takes it
 * from `aPageInfo.GetTypeAsString()` (ds_draw_item.cpp:552), which for
 * `PAGE_SIZE_TYPE::GERBER` is the string "GERBER".
 */
export function gerberDrawingSheetItems(paper?: string): DsDrawItem[] {
  const type = paperOf(paper);
  const [wMM, hMM] = PAPER_MM[type]!;
  return layoutDrawingSheet(
    defaultDrawingSheet(),
    { widthMM: wMM, heightMM: hMM },
    {
      // SetPageNumber( "1" ) / SetSheetCount( 1 ) — gerbview_frame.cpp:893-894.
      pageNumber: 1,
      sheetCount: 1,
      // An untouched TITLE_BLOCK: see the note above.
      title: '',
      rev: '',
      date: '',
      company: '',
      comments: ['', '', '', ''],
      paper: type,
      fileName: '',
      sheetPath: '',
      appVersion: 'ZiroEDA',
    },
  );
}

/** Paint what {@link gerberDrawingSheetItems} lays out, in canvas world space. */
export function drawGerberDrawingSheet(
  ctx: CanvasRenderingContext2D,
  v: ViewTransform,
  flip: boolean,
  color: string,
  paper?: string,
): void {
  const items = gerberDrawingSheetItems(paper);
  if (items.length === 0) return;
  // The shared engine lays out in schematic internal units; this canvas is in
  // Gerber ones. Scaling the context rather than each coordinate also scales the
  // pen widths, which are in the same units.
  const toGerb = GERB_IU / SCH_IU_PER_MM;
  ctx.save();
  applyWorld(ctx, v, flip);
  ctx.scale(toGerb, toGerb);
  // One device pixel in world units, the same floor the item painter uses, so a
  // hairline stays visible when the whole 32-inch page is zoomed to fit.
  drawDrawingSheetItems(ctx, items, NO_DS_SELECTION, {
    color,
    minWidth: 1 / v.scale / toGerb,
  });
  ctx.restore();
}

/**
 * The paper edge — `DS_PAINTER::DrawBorder`, called by
 * `DS_PROXY_VIEW_ITEM::ViewDraw` after the sheet's own items and gated on
 * `GetShowPageLimits()`, which in GerbView is
 * `gvconfig()->m_Display.m_DisplayPageLimits` (gerbview_painter.cpp:186).
 *
 * It is a separate call because it is a separate layer with its own colour
 * (`LAYER_GERBVIEW_PAGE_LIMITS`) and its own visibility, and because it is not
 * part of the sheet description at all.
 */
export function drawGerberPageLimits(
  ctx: CanvasRenderingContext2D,
  v: ViewTransform,
  flip: boolean,
  color: string,
  paper?: string,
): void {
  const [wMM, hMM] = PAPER_MM[paperOf(paper)]!;
  ctx.save();
  applyWorld(ctx, v, flip);
  ctx.strokeStyle = color;
  // The same 0.1 mm pen the board's page rectangle uses, floored at one device
  // pixel so the edge does not vanish when zoomed out.
  ctx.lineWidth = Math.max(0.1 * GERB_IU, 1 / v.scale);
  ctx.setLineDash([]);
  ctx.strokeRect(0, 0, wMM * GERB_IU, hMM * GERB_IU);
  ctx.restore();
}
