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
  GERBER_DRAW_ITEM,
  GERBVIEW_PAINTER,
  GERBVIEW_SETTINGS,
  IU_PER_MM,
  gvconfig,
  type GERBER_FILE_IMAGE,
} from '@ziroeda/gerbview';
import { GERBER_BG_COLOR } from './gerberColors.js';
import {
  defaultDrawingSheet,
  layoutDrawingSheet,
  PAPER_MM,
  SCH_IU_PER_MM,
  type DsDrawItem,
} from '@ziroeda/common';
import { drawDrawingSheetItems } from '@ziroeda/common';
import { parseColor4d } from '@ziroeda/common/color4d.js';
import {
  GERBER_DCODE_LAYER,
  GERBER_DRAW_LAYER,
  GERBVIEW_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { zoomFactorForScale } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { SURFACE_GAL } from './gerber_surface_gal.js';
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
 * The frame passes it in (`GerberRenderOptions.paper` -> `GerberCanvas`), which
 * is what makes a change in Preferences repaint. The settings manager is only
 * the FALLBACK, for the one caller that has no options object — a test, or the
 * zoom-to-fit bbox — and an unknown page name falls back further, to the
 * `PARAM`'s own default, rather than indexing `PAPER_MM` off the end.
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
 * (include/base_units.h:69), and our `common/eda_units.ts:24` matches it,
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

/**
 * The gerbview-specific layers a painter needs, resolved. Keys are
 * `gerbviewColorLayers.ts`' seven, minus the background — that one already has
 * its own option, because it is also what a layer buffer is composited over.
 */
export interface GerbviewPalette {
  /** LAYER_DCODES. */
  dcodes: string;
  /** LAYER_NEGATIVE_OBJECTS, and `GBR_DISPLAY_OPTIONS::m_NegativeDrawColor`. */
  negativeObjects: string;
  /** LAYER_GERBVIEW_GRID. */
  grid: string;
  /** LAYER_GERBVIEW_AXES. */
  axes: string;
  /** LAYER_GERBVIEW_DRAWINGSHEET. */
  drawingSheet: string;
  /** LAYER_GERBVIEW_PAGE_LIMITS. */
  pageLimits: string;
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
  /**
   * The seven gerbview-specific layer colours in force —
   * `m_currentSettings->GetColor( layer )` for each of `LAYER_DCODES ..
   * GERBVIEW_LAYER_ID_END`, which is what Preferences > Gerber Viewer > Colors
   * edits and what the Layers manager edits, because upstream they are one
   * `COLOR_SETTINGS`.
   *
   * On the options object rather than imported as module constants for the
   * same reason `paper` is: the canvas asks for a frame when this object
   * changes identity, so a colour the painter fetched for itself would be
   * stored, correct, and invisible until something else redrew.
   */
  colors: GerbviewPalette;
  /**
   * `GERBVIEW_RENDER_SETTINGS`' four highlight selections — what the TOP_AUX
   * choices set (`gerbview_control.cpp:190-249`). Empty / -1 is none.
   */
  highlight?: GerberHighlight;
}

/** `m_netHighlightString`, `m_componentHighlightString`, `m_attributeHighlightString`, `m_dcodeHighlightValue`. */
export interface GerberHighlight {
  net: string;
  component: string;
  attribute: string;
  dcode: number;
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
 * `GERBER_DRAW_ITEM::GetBoundingBox` over an image, in this canvas's world.
 *
 * The items answer in image (AB) coordinates, whose Y runs down; this canvas's
 * world runs Y up (see `applyWorld`), so the box is mirrored.
 */
export function imageWorldBBox(image: GERBER_FILE_IMAGE): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of image.GetItems()) {
    const b = item.GetBoundingBox();
    minX = Math.min(minX, b.GetLeft());
    maxX = Math.max(maxX, b.GetRight());
    minY = Math.min(minY, -b.GetBottom());
    maxY = Math.max(maxY, -b.GetTop());
  }

  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * The GERBVIEW_SETTINGS the painter reads through `gvconfig()`, brought into
 * line with the options this frame is drawn with — the toggles upstream write
 * straight into `cfg->m_Display` / `m_Appearance`.
 *
 * `m_ForceOpacityMode` is left false: the opacity is the compositor's
 * `layerOpacity` here, applied once per layer buffer, where `LoadColors`
 * would put it into every colour a second time.
 */
export function syncGerbviewSettings(opts: {
  flashedSketch: boolean;
  linesSketch: boolean;
  polygonsSketch: boolean;
  showNegativeObjects: boolean;
}): GERBVIEW_SETTINGS {
  const mgr = PgmOrNull()?.GetSettingsManager();

  if (mgr && !mgr.GetAppSettings<GERBVIEW_SETTINGS>('gerbview'))
    mgr.RegisterSettings('gerbview', new GERBVIEW_SETTINGS());

  const cfg = gvconfig();
  cfg.m_Display.m_DisplayFlashedItemsFill = !opts.flashedSketch;
  cfg.m_Display.m_DisplayLinesFill = !opts.linesSketch;
  cfg.m_Display.m_DisplayPolygonsFill = !opts.polygonsSketch;
  cfg.m_Display.m_ForceOpacityMode = false;
  cfg.m_Appearance.show_negative_objects = opts.showNegativeObjects;
  return cfg;
}

/**
 * A painter whose render settings hold these colours:
 * `GERBVIEW_RENDER_SETTINGS::LoadColors` over a COLOR_SETTINGS carrying each
 * drawn layer's colour at `GERBER_DRAW_LAYER( k )`, plus the negative-object
 * and D-code colours, and the four highlight selections.
 */
export function gerberPainter(
  layerColors: readonly string[],
  negativeObjects: string,
  dcodes: string,
  highlight: GerberHighlight | undefined,
): GERBVIEW_PAINTER {
  const cs = new COLOR_SETTINGS('gerbview');

  for (let k = 0; k < layerColors.length; k++)
    cs.SetColor(GERBER_DRAW_LAYER(k), parseColor4d(layerColors[k] as string));

  cs.SetColor(GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS, parseColor4d(negativeObjects));
  cs.SetColor(GERBVIEW_LAYER_ID.LAYER_DCODES, parseColor4d(dcodes));

  const painter = new GERBVIEW_PAINTER(null);
  const rs = painter.GetSettings();
  rs.LoadColors(cs);

  if (highlight) {
    rs.m_netHighlightString = highlight.net;
    rs.m_componentHighlightString = highlight.component;
    rs.m_attributeHighlightString = highlight.attribute;
    rs.m_dcodeHighlightValue = highlight.dcode;
  }

  return painter;
}

/** `VIEW` as `ViewGetLOD` consults it: not printing. */
const SCREEN_VIEW = { GetPainter: () => ({ GetSettings: () => ({ IsPrinting: () => false }) }) };

/**
 * Draw one image into the layer buffer: `VIEW::Redraw` over its items, each
 * through GERBVIEW_PAINTER on the layer's drawing layer.
 *
 * The buffer is this image's alone, which is `CAIRO_GAL`'s negatives layer: a
 * clear (%LPC) item erases what this image drew under it and nothing of the
 * layers below. An IPNEG image is NOT pre-filled — upstream's own
 * "TODO(JE) This doesn't actually work properly for ImageNegative", and what
 * GerbView draws.
 */
function drawImageToBuffer(
  lctx: CanvasRenderingContext2D,
  layer: GerberLayerView,
  layerIndex: number,
  painter: GERBVIEW_PAINTER,
  v: ViewTransform,
  opts: GerberRenderOptions,
  canvasW: number,
  canvasH: number,
): void {
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, canvasW, canvasH);

  applyWorld(lctx, v, opts.flipView);
  painter.SetGAL(
    new SURFACE_GAL(lctx as unknown as ConstructorParameters<typeof SURFACE_GAL>[0], 1 / v.scale),
  );

  const drawLayer = GERBER_DRAW_LAYER(layerIndex);

  for (const item of layer.image.GetItems()) painter.Draw(item, drawLayer);

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

  syncGerbviewSettings(opts);
  const painter = gerberPainter(
    layers.map((l) => l.color),
    opts.colors.negativeObjects,
    opts.colors.dcodes,
    opts.highlight,
  );

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!layer.visible || layer.image.GetItemsCount() === 0) continue;
    drawImageToBuffer(lctx, layer, i, painter, v, opts, canvasW, canvasH);

    // Compose onto the main canvas.
    if (opts.xorMode) {
      ctx.globalCompositeOperation = 'difference';
      ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      // A layer keeps the theme's own alpha, which is 1 for all 64 rows of
      // s_defaultTheme; only toggleForceOpacityMode lowers it, to
      // m_OpacityModeAlphaValue (`gerbview_painter.cpp:65-66`) — one colour
      // per buffer, so the alpha of the buffer is that colour's alpha.
      // "Inactive Layer View Mode" is NOT done here: the frame mixes the
      // layer's colour toward the background before handing it over.
      ctx.globalAlpha = opts.layerOpacity;
    }
    ctx.drawImage(buf, 0, 0);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  if (opts.showDcodes) drawGerberDcodes(ctx, v, layers, opts, painter);
}

/**
 * The D code layers, over every drawing layer as GerbView orders them above
 * their own layer: GERBVIEW_PAINTER's D-code text, shown only where
 * `GERBER_DRAW_ITEM::ViewGetLOD` says it is readable at this zoom
 * (`VIEW::draw` draws an item when `itemLOD < m_scale`).
 */
export function drawGerberDcodes(
  ctx: CanvasRenderingContext2D,
  v: ViewTransform,
  layers: GerberLayerView[],
  opts: GerberRenderOptions,
  aPainter?: GERBVIEW_PAINTER,
): void {
  const painter =
    aPainter ??
    gerberPainter(
      layers.map((l) => l.color),
      opts.colors.negativeObjects,
      opts.colors.dcodes,
      opts.highlight,
    );
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const zoom = zoomFactorForScale(v.scale, dpr, IU_PER_MM);

  ctx.save();
  applyWorld(ctx, v, opts.flipView);
  painter.SetGAL(
    new SURFACE_GAL(ctx as unknown as ConstructorParameters<typeof SURFACE_GAL>[0], 1 / v.scale),
  );

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!layer.visible) continue;
    const dcodeLayer = GERBER_DCODE_LAYER(GERBER_DRAW_LAYER(i));

    for (const item of layer.image.GetItems()) {
      if (item.ViewGetLOD(dcodeLayer, SCREEN_VIEW) < zoom) painter.Draw(item, dcodeLayer);
    }
  }

  ctx.restore();
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
