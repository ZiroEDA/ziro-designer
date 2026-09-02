// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber Viewer canvas, GerbView's GERBVIEW_DRAW_PANEL_GAL plus its
 * interactive tools in Canvas 2D. It renders the composited layers
 * (gerberRender), tracks the cursor for the coordinate readout, supports
 * pan (middle/right drag or space-drag), wheel zoom about the cursor, the
 * measure tool (two clicks → distance + dx/dy overlay, matching
 * GERBVIEW_CONTROL::MeasureTool), and click-to-inspect item picking. A
 * controller (zoom / redraw) is exposed via ref like the other editors.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Vec2 } from '@ziroeda/kimath';
import { IU_PER_MM, type GERBER_DRAW_ITEM } from '@ziroeda/gerbview';
import {
  renderGerberLayers,
  worldToDevice,
  deviceToWorld,
  drawGerberDrawingSheet,
  drawGerberPageLimits,
  type GerberLayerView,
  type GerberRenderOptions,
  type ViewTransform,
} from './gerberRender.js';
import {
  GERBER_AXES_COLOR,
  GERBER_BG_COLOR,
  GERBER_CURSOR_COLOR,
  GERBER_DRAWINGSHEET_COLOR,
  GERBER_GRID_COLOR,
  GERBER_NEGATIVE_COLOR,
  GERBER_PAGE_LIMITS_COLOR,
  highlightedLayerColor,
} from './gerberColors.js';
import { GerbviewGl, type GerberGlContent } from '../../render/gl/gerbview_gl.js';
import {
  commonInputPrefs,
  dragGesture,
  dragZoomScale,
  makeZoomController,
  wheelAction,
  zoomFitScale,
} from '../../ui/view_controls.js';
import { type CrosshairMode, drawCrosshair, drawGrid } from '../../ui/grid_cursor.js';
import { clampViewScale, nextZoomPreset, ZOOM_LIST } from '../../ui/zoom_settings.js';
import { scaleForZoomFactor, zoomFactorForScale } from '../../ui/status_format.js';
import {
  SELECTION_AREA_FILL,
  SELECTION_AREA_STROKE,
  zoomAreaTarget,
  type ZoomArea,
} from '../../ui/zoom_tool.js';

/**
 * On by default, with `?renderer=canvas` to opt out - the same shape
 * `PcbEditor` uses, and for the reasons written there: the schematic's flag was
 * left opt-in past the point of decision and rounds of "improvements" were
 * measured against a renderer that was not running. A browser without WebGL2
 * keeps working regardless, because `GerbviewGl.create` returns null and every
 * frame falls through to the raster path.
 */
const GL_RENDERER =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('renderer') !== 'canvas';

/** `?perf=1` publishes per-frame cost and which path drew it, on window. */
const PERF =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';

/**
 * Build the GL content key from the same inputs the 2D painter takes.
 *
 * A fresh object every frame is deliberately fine: `GerbviewGl` compares the
 * key field by field, not by reference. Comparing by reference here is the
 * documented trap - it looks right, re-records the whole scene every frame,
 * and shows up only as "still slow".
 */
function glContent(layers: readonly GerberLayerView[], opts: GerberRenderOptions): GerberGlContent {
  return {
    layers: layers.map((l) => ({
      image: l.image,
      color: l.color,
      // GetColor's negative and highlight branches, resolved per layer because
      // m_layerColorsHi is Brightened( 0.5 ) of the LAYER's own colour
      // (`gerbview_painter.cpp:70`) - not one flat highlight for all of them.
      negativeColor: GERBER_NEGATIVE_COLOR,
      highlightColor: highlightedLayerColor(l.color),
      visible: l.visible,
    })),
    flashedSketch: opts.flashedSketch,
    linesSketch: opts.linesSketch,
    polygonsSketch: opts.polygonsSketch,
    showNegativeObjects: opts.showNegativeObjects,
    highlightTest: opts.highlightTest ?? null,
  };
}

export interface GerberCanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  redraw: () => void;
  /**
   * `KIGFX::VIEW::SetScale( scale )` with no anchor, which is what
   * `COMMON_TOOLS::doZoomToPreset` runs for a picked zoom preset
   * (`common/tool/common_tools.cpp:493`). An anchorless `SetScale` keeps the
   * *view centre* fixed, so this is a step about the canvas centre.
   */
  setScale: (scale: number) => void;
}

export interface GerberCanvasProps {
  /** Layers bottom-to-top; active layer last (drawn on top). */
  layers: GerberLayerView[];
  options: GerberRenderOptions;
  /** Bounding box of visible content (IU) for zoom-to-fit. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  showGrid: boolean;
  gridIU: number;
  /**
   * `GAL_DISPLAY_OPTIONS::GetCursorMode()`, one of three
   * (`include/gal/gal_display_options.h:67-71`). It was a boolean, so the
   * FULLSCREEN_DIAGONAL mode had nothing to select and clicking through the
   * group only ever gave small and full-window.
   */
  crosshairMode: CrosshairMode;
  activeTool: 'select' | 'measure' | 'zoom';
  /** Report the cursor world position (IU) for the status bar. */
  onCursorMove?: (p: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /** Report the measured segment (IU) live while measuring. */
  onMeasure?: (m: { a: Vec2; b: Vec2 } | null) => void;
  /** Report the picked item under a select-click (or null). */
  onPick?: (item: GERBER_DRAW_ITEM | null, at: Vec2) => void;
  /**
   * The zoom-area drag finished. ZOOM_TOOL's Main loop `break`s as soon as
   * selectRegion returns (`common/tool/zoom_tool.cpp:85-87`) and then pops the
   * tool, so one drag is one zoom and the frame goes back to the previous tool.
   */
  onZoomAreaDone?: () => void;
}

export const GerberCanvas = forwardRef<GerberCanvasController, GerberCanvasProps>(
  function GerberCanvas(props, ref) {
    const {
      layers,
      options,
      bbox,
      showGrid,
      gridIU,
      crosshairMode,
      activeTool,
      onCursorMove,
      onZoomAreaDone,
      onScaleChange,
      onMeasure,
      onPick,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    /**
     * `WX_VIEW_CONTROLS::m_zoomController` — this canvas's own, because upstream
     * each `WX_VIEW_CONTROLS` owns one and the accelerating one has history.
     */
    const zoomCtlRef = useRef(makeZoomController());
    /**
     * The GL canvas sits between the background/grid canvas and the overlay.
     *
     * KiCad's own split: LAYER_GERBVIEW_BACKGROUND, _GRID and _AXES render
     * below the items, and LAYER_SELECT_OVERLAY / LAYER_GP_OVERLAY are
     * TARGET_OVERLAY above them (`gerbview_draw_panel_gal.cpp:150-166`).
     * Anything that must appear *over* an item - the measure line, the zoom
     * rubber band, the crosshair - cannot go on the canvas beneath GL, or the
     * item it marks hides it.
     */
    const glCanvasRef = useRef<HTMLCanvasElement>(null);
    const overCanvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<GerbviewGl | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<ViewTransform>({ scale: 0.0005, tx: 0, ty: 0 });
    const rafRef = useRef(0);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    const layersRef = useRef(layers);
    layersRef.current = layers;
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const gridRef = useRef({ showGrid, gridIU });
    gridRef.current = { showGrid, gridIU };
    const crosshairRef = useRef(crosshairMode);
    crosshairRef.current = crosshairMode;

    const cursorPxRef = useRef<{ x: number; y: number } | null>(null);
    const measureRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
    /**
     * ZOOM_TOOL::selectRegion's rubber band (`common/tool/zoom_tool.cpp:110-165`).
     * `out` records which button started the drag: upstream a LEFT drag zooms
     * IN and a RIGHT drag zooms OUT, and it is the same rectangle either way.
     */
    const zoomAreaRef = useRef<ZoomArea | null>(null);
    const measuringRef = useRef(false);

    /** Device px → world IU (accounting for flip). */
    const toWorld = useCallback(
      (px: number, py: number): Vec2 =>
        deviceToWorld(viewRef.current, optionsRef.current.flipView, px, py),
      [],
    );

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;
      const opts = optionsRef.current;

      const t0 = PERF ? performance.now() : 0;
      // Try GL first. `gl` is null on a browser without WebGL2 and after a
      // context loss, and both fall through to the raster path below - which
      // still draws everything, because it is the painter GerbView shipped
      // with rather than a stub kept alive for the fallback.
      const gl = glRef.current;
      const glCanvas = glCanvasRef.current;
      let drewWithGl = false;
      if (GL_RENDERER && gl && glCanvas && !gl.isLost) {
        // The background, grid and axes go on the canvas *below* GL, so this
        // pass paints only those and the item pass is transparent over it.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = opts.background || GERBER_BG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        gl.render(glContent(layersRef.current, opts), {
          scale: v.scale,
          tx: v.tx,
          ty: v.ty,
          flipX: opts.flipView,
        });
        drewWithGl = true;
      } else {
        renderGerberLayers(ctx, canvas.width, canvas.height, v, layersRef.current, opts);
      }
      if (PERF) {
        (window as unknown as { __gbrPerf?: unknown }).__gbrPerf = {
          path: drewWithGl ? 'gl' : 'canvas2d',
          frameMs: +(performance.now() - t0).toFixed(2),
          recordCount: gl?.recordCount ?? 0,
          lastRecordMs: gl?.lastRecordMs ?? 0,
          census: gl?.runCensus,
          runHead: gl?.runHead,
        };
      }

      const flip = opts.flipView;
      const worldToPx = (p: Vec2): { x: number; y: number } => worldToDevice(v, flip, p.x, p.y);

      // GAL::DrawGrid, in LAYER_GERBVIEW_GRID (gerbview_frame.cpp:934-937).
      // GerbView's canvas is y-up, and mirrors x under "flip view", so the
      // lattice is told about both.
      const { showGrid: sg, gridIU: g } = gridRef.current;
      drawGrid(
        ctx,
        { scale: v.scale, tx: v.tx, ty: v.ty, flipX: flip, flipY: true },
        canvas.width,
        canvas.height,
        {
          show: sg,
          sizeIU: g,
          color: GERBER_GRID_COLOR,
          devicePixelRatio: dpr,
          // GERBVIEW_FRAME's constructor turns the GAL's axes on directly -
          // "Enable the axes to match legacy draw style"
          // (`gerbview/gerbview_frame.cpp:188-191`) - so they are unconditional
          // here, and upstream draws them BEFORE the grid-visibility test
          // (`opengl_gal.cpp:1919-1928`), which is why they survive Show Grid
          // being off. We drew none at all.
          axes: { color: GERBER_AXES_COLOR },
        },
      );

      // ZOOM_TOOL's rubber band, KIGFX::PREVIEW::SELECTION_AREA. Its dark
      // scheme is `COLOR4D( 0.3, 0.3, 0.7, 0.3 )` filled and
      // `COLOR4D( 1.0, 1.0, 0.4, 1.0 )` outlined - "slight blue" and "yellow",
      // `common/preview_items/selection_area.cpp:44-52` - taken through the
      // INSIDE_RECTANGLE branch, which is the mode a default-constructed
      // SELECTION_AREA carries (`:118-121`).
      // Everything from here up is drawn *over* the items, so on the GL path it
      // goes to the overlay canvas. Leaving it on the canvas underneath would
      // put the crosshair and the measure line behind the board.
      //
      // The overlay has no invalidation of its own: it is cleared and redrawn
      // in this same pass, because a preference changed from the toolbar once
      // failed to appear until the mouse moved.
      const octx = drewWithGl ? (overCanvasRef.current?.getContext('2d') ?? ctx) : ctx;
      if (octx !== ctx) {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, canvas.width, canvas.height);
      }
      // The drawing sheet, before every preview tool and after the items.
      //
      // GerbView gives the gerber layers explicit render orders 0..2N+1
      // (gerbview_draw_panel_gal.cpp:181-183) while LAYER_DRAWINGSHEET keeps its
      // default order, which is its own id - GAL_LAYER_ID_START + 24, far above
      // them (layer_ids.h:278). So the sheet paints OVER the copper, and only
      // LAYER_SELECT_OVERLAY and LAYER_GP_OVERLAY, made top layers at :191-193,
      // paint over the sheet. That is exactly this position: on the overlay
      // canvas, ahead of the rubber band, the measure line and the crosshair.
      if (opts.drawingSheet) {
        drawGerberDrawingSheet(octx, v, opts.flipView, GERBER_DRAWINGSHEET_COLOR);
      }
      // DS_PROXY_VIEW_ITEM::ViewDraw draws the border AFTER the sheet's items
      // (ds_proxy_view_item.cpp:139-147), and on its own visibility flag.
      if (opts.pageLimits) {
        drawGerberPageLimits(octx, v, opts.flipView, GERBER_PAGE_LIMITS_COLOR);
      }

      octx.setTransform(1, 0, 0, 1, 0, 0);
      const za = zoomAreaRef.current;
      if (za) {
        const q0 = worldToPx(za.a);
        const q1 = worldToPx(za.b);
        octx.fillStyle = SELECTION_AREA_FILL;
        octx.strokeStyle = SELECTION_AREA_STROKE;
        octx.lineWidth = Math.max(1, dpr);
        octx.setLineDash([]);
        octx.fillRect(q0.x, q0.y, q1.x - q0.x, q1.y - q0.y);
        octx.strokeRect(q0.x, q0.y, q1.x - q0.x, q1.y - q0.y);
      }

      // Measure overlay.
      const m = measureRef.current;
      if (m) {
        const p0 = worldToPx(m.a);
        const p1 = worldToPx(m.b);
        octx.strokeStyle = '#ffd54a';
        octx.fillStyle = '#ffd54a';
        octx.lineWidth = Math.max(1, dpr);
        octx.setLineDash([6 * dpr, 4 * dpr]);
        octx.beginPath();
        octx.moveTo(p0.x, p0.y);
        octx.lineTo(p1.x, p1.y);
        octx.stroke();
        octx.setLineDash([]);
        for (const p of [p0, p1]) {
          octx.beginPath();
          octx.arc(p.x, p.y, 3 * dpr, 0, Math.PI * 2);
          octx.fill();
        }
      }

      // GAL::blitCursor in LAYER_CURSOR (gerbview_painter.h:95). GerbView has
      // no drawing tools, so nothing calls ShowCursor(true): the crosshair is
      // there because always_show_cursor is on, and a forced cursor is dimmed.
      drawCrosshair(octx, cursorPxRef.current, canvas.width, canvas.height, {
        mode: crosshairRef.current,
        color: GERBER_CURSOR_COLOR,
        alwaysShow: true,
        devicePixelRatio: dpr,
      });

      onScaleChange?.(v.scale);
    }, [dpr, onScaleChange]);

    /**
     * Create the backend once, and recreate it when the context is lost.
     *
     * A lost context must rebuild the device and re-upload, not merely fall
     * back for one frame: a scene uploaded to a dead context draws as nothing,
     * with no error. Until it comes back, `isLost` sends every frame down the
     * raster path, which is a real renderer and not a stub.
     */
    useEffect(() => {
      if (!GL_RENDERER) return;
      const el = glCanvasRef.current;
      if (!el) return;
      glRef.current = GerbviewGl.create(el);
      const onLost = (e: Event): void => {
        e.preventDefault();
        glRef.current?.dispose();
        glRef.current = null;
        requestDrawRef.current();
      };
      const onRestored = (): void => {
        glRef.current = GerbviewGl.create(el);
        requestDrawRef.current();
      };
      el.addEventListener('webglcontextlost', onLost);
      el.addEventListener('webglcontextrestored', onRestored);
      return () => {
        el.removeEventListener('webglcontextlost', onLost);
        el.removeEventListener('webglcontextrestored', onRestored);
        glRef.current?.dispose();
        glRef.current = null;
      };
    }, []);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    const requestDrawRef = useRef(requestDraw);
    requestDrawRef.current = requestDraw;

    /**
     * A synchronous draw, published only under `?perf=1`.
     *
     * Frames are scheduled through requestAnimationFrame, which Chrome does not
     * run for a hidden document - and a hidden tab still answers
     * getBoundingClientRect and getComputedStyle perfectly well, so a profiling
     * harness that waits on rAF simply hangs while every DOM probe around it
     * keeps returning plausible numbers. Timing this directly takes the
     * scheduler out of the measurement entirely.
     */
    useEffect(() => {
      if (!PERF) return;
      (window as unknown as { __gbrDrawNow?: () => void }).__gbrDrawNow = draw;
      return () => {
        (window as unknown as { __gbrDrawNow?: () => void }).__gbrDrawNow = undefined;
      };
    }, [draw]);

    useEffect(() => {
      requestDraw();
    }, [layers, options, showGrid, gridIU, crosshairMode, requestDraw]);

    const zoomToFit = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = bbox.maxX - bbox.minX;
      const h = bbox.maxY - bbox.minY;
      if (w <= 0 || h <= 0 || !Number.isFinite(w) || !Number.isFinite(h)) {
        // `doZoomFit` sets the scale to 1.0 up front — "the best scale will be
        // determined later, but this initial value ensures all view parameters
        // are up to date" (`common/tool/common_tools.cpp:331`) — and when there
        // is nothing to fit, the computed scale is not finite, so it centres on
        // the world origin and returns (`:350-356`). The 1.0 it set is what
        // stays. That is why a GerbView with no file loaded reads Zoom 1.00.
        //
        // This branch used to write scale 0.0005, a number from nowhere, which
        // is exactly the 139.56 the zoom box was showing: 0.0005 x (IU per mm
        // x 25.4 / 91 screen DPI).
        viewRef.current = {
          scale: scaleForZoomFactor(
            1,
            typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
            IU_PER_MM,
          ),
          tx: canvas.width / 2,
          ty: canvas.height / 2,
        };
        requestDraw();
        return;
      }
      // COMMON_TOOLS::doZoomFit's FRAME_GERBER margin, not a flat x1.1.
      const s = zoomFitScale(bbox, { width: canvas.width, height: canvas.height }, 'gerber');
      if (s === null) {
        // Same branch as above: nothing fittable, so the 1.0 stands.
        viewRef.current = {
          scale: scaleForZoomFactor(
            1,
            typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
            IU_PER_MM,
          ),
          tx: canvas.width / 2,
          ty: canvas.height / 2,
        };
        requestDraw();
        return;
      }
      const cx = (bbox.minX + bbox.maxX) / 2;
      const cy = (bbox.minY + bbox.maxY) / 2;
      const flip = optionsRef.current.flipView;
      const sx = flip ? -s : s;
      viewRef.current = {
        scale: s,
        tx: canvas.width / 2 - sx * cx,
        ty: canvas.height / 2 + s * cy, // sy = -s
      };
      requestDraw();
    }, [bbox, requestDraw]);

    const zoomStep = useCallback(
      (factor: number, aboutPx?: { x: number; y: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const v = viewRef.current;
        const px = aboutPx?.x ?? canvas.width / 2;
        const py = aboutPx?.y ?? canvas.height / 2;
        const flip = optionsRef.current.flipView;
        // Keep the world point under (px,py) fixed across the zoom.
        const w = deviceToWorld(v, flip, px, py);
        // ZOOM_MAX_LIMIT_GERBVIEW / ZOOM_MIN_LIMIT_GERBVIEW, 5000 and 0.02
        // (`include/zoom_defines.h:60-62`), installed by
        // gerbview_draw_panel_gal.cpp:55. VIEW::SetScale clamps before it
        // re-anchors (`common/view/view.cpp:583-595`).
        v.scale = clampViewScale(v.scale * factor, 'gerbview', dpr, IU_PER_MM);
        const sx = flip ? -v.scale : v.scale;
        v.tx = px - sx * w.x;
        v.ty = py + v.scale * w.y; // sy = -scale
        requestDraw();
      },
      [dpr, requestDraw],
    );

    /**
     * `ZOOM_TOOL::selectRegion`'s tail (`common/tool/zoom_tool.cpp:134-160`),
     * which is the whole of what the zoom-area tool does:
     *
     *     VECTOR2D sSize = view->ToWorld( canvas->GetClientSize(), false );
     *     VECTOR2D vSize = selectionBox.GetSize();
     *     double ratio = std::max( fabs( vSize.x / sSize.x ), fabs( vSize.y / sSize.y ) );
     *     if( LEFT )  scale = view->GetScale() / ratio;
     *     else        scale = view->GetScale() * ratio;
     *     view->SetScale( scale );
     *     view->SetCenter( selectionBox.Centre() );
     *
     * `ratio` is the LARGER of the two axis ratios, so the whole rectangle
     * fits rather than only the tighter axis, and a right-drag divides instead
     * of multiplying - it zooms *out* by the same factor. A zero-width or
     * zero-height box does nothing at all (`:138-142`).
     */
    const applyZoomArea = useCallback(
      (za: ZoomArea) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const v = viewRef.current;
        const target = zoomAreaTarget(za, {
          scale: v.scale,
          width: canvas.width,
          height: canvas.height,
        });
        if (!target) return;

        v.scale = clampViewScale(target.scale, 'gerbview', dpr, IU_PER_MM);
        // view->SetCenter( centre ): put that world point at the canvas middle.
        const flip = optionsRef.current.flipView;
        const sx = flip ? -v.scale : v.scale;
        v.tx = canvas.width / 2 - sx * target.centre.x;
        v.ty = canvas.height / 2 + v.scale * target.centre.y;
        requestDraw();
      },
      [dpr, requestDraw],
    );

    /**
     * `COMMON_TOOLS::doZoomInOut` (`common/tool/common_tools.cpp:252-291`).
     *
     * A Zoom In does NOT multiply by 1.3. The 1.3 is the floor - upstream's own
     * comment is "Step must be AT LEAST 1.3" - and the zoom it lands on is the
     * next entry of ZOOM_LIST_GERBVIEW beyond it, pegged to the end of the list.
     * That is what makes KiCad's zoom a repeatable, nameable place: the value
     * always matches a row of the Zoom selector. Ours multiplied blindly and so
     * landed on figures that appear nowhere in the table.
     */
    const zoomPresetStep = useCallback(
      (zoomIn: boolean) => {
        const v = viewRef.current;
        const now = zoomFactorForScale(v.scale, dpr, IU_PER_MM);
        const next = nextZoomPreset(ZOOM_LIST.gerbview, now, zoomIn);
        if (next === now) return;
        zoomStep(scaleForZoomFactor(next, dpr, IU_PER_MM) / v.scale);
      },
      [dpr, zoomStep],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomToFit,
        zoomIn: () => zoomPresetStep(true),
        zoomOut: () => zoomPresetStep(false),
        redraw: () => requestDraw(),
        setScale: (scale: number) => {
          const current = viewRef.current.scale;
          if (current > 0 && scale > 0) zoomStep(scale / current);
        },
      }),
      [zoomToFit, zoomPresetStep, zoomStep, requestDraw],
    );

    // Size to container; fit on first layout.
    const fittedRef = useRef(false);
    useEffect(() => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const ro = new ResizeObserver(() => {
        const r = wrap.getBoundingClientRect();
        for (const el of [canvas, glCanvasRef.current, overCanvasRef.current]) {
          if (!el) continue;
          el.width = Math.max(1, Math.round(r.width * dpr));
          el.height = Math.max(1, Math.round(r.height * dpr));
          el.style.width = `${r.width}px`;
          el.style.height = `${r.height}px`;
        }
        if (!fittedRef.current) {
          fittedRef.current = true;
          zoomToFit();
        } else requestDraw();
      });
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [dpr, requestDraw, zoomToFit]);

    // When "flip view" toggles, mirror the pan about the canvas centre so the
    // content stays put instead of sliding off-screen (GerbView keeps the board
    // centred across a flip). tx' = canvasW - tx makes the world point at the
    // canvas centre invariant under the x-scale sign change.
    const prevFlipRef = useRef(options.flipView);
    useEffect(() => {
      if (prevFlipRef.current !== options.flipView) {
        prevFlipRef.current = options.flipView;
        const canvas = canvasRef.current;
        if (canvas) {
          viewRef.current.tx = canvas.width - viewRef.current.tx;
          requestDraw();
        }
      }
    }, [options.flipView, requestDraw]);

    // Re-fit when the first content arrives.
    const hadContentRef = useRef(false);
    useEffect(() => {
      const has = layers.some((l) => l.image.items.length > 0);
      if (has && !hadContentRef.current) {
        hadContentRef.current = true;
        zoomToFit();
      }
      if (!has) hadContentRef.current = false;
    }, [layers, zoomToFit]);

    // WX_VIEW_CONTROLS::onWheel.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const action = wheelAction(
          e,
          commonInputPrefs(),
          { width: canvas.width, height: canvas.height },
          zoomCtlRef.current,
        );
        if (action.kind === 'none') return;
        if (action.kind === 'pan') {
          const v = viewRef.current;
          v.tx += action.dx;
          v.ty += action.dy;
          requestDraw();
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * dpr;
        const py = (e.clientY - rect.top) * dpr;
        zoomStep(action.factor, { x: px, y: py });
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [dpr, zoomStep, requestDraw]);

    // Pointer interactions: pan, measure, pick.
    const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    /** A DRAG_ZOOMING gesture: the last pointer y, and `m_zoomStartPoint`. */
    const dragZoomRef = useRef<{
      lastClientY: number;
      anchor: { x: number; y: number };
    } | null>(null);
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const pxOf = (e: PointerEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
      };

      const onDown = (e: PointerEvent): void => {
        canvas.setPointerCapture(e.pointerId);
        const p = pxOf(e);
        // ZOOM_TOOL consumes both drags while it is armed: LEFT zooms in and
        // RIGHT zooms out (`zoom_tool.cpp:150-153`), so neither reaches pan.
        if (activeTool === 'zoom' && (e.button === 0 || e.button === 2)) {
          const w = toWorld(p.x, p.y);
          zoomAreaRef.current = { a: w, b: w, out: e.button === 2 };
          requestDraw();
          return;
        }
        // `WX_VIEW_CONTROLS::onButton` (`wx_view_controls.cpp:546-569`): the
        // middle and right buttons each start what Preferences > Mouse and
        // Touchpad > Drag Gestures says for them. NONE is neither branch and
        // the press falls through -- which is what leaves the right button to
        // the context menu when it is set to None.
        if (e.button === 1 || e.button === 2) {
          const gesture = dragGesture(e.button, commonInputPrefs());
          if (gesture === 'pan') {
            panRef.current = { x: p.x, y: p.y, tx: viewRef.current.tx, ty: viewRef.current.ty };
            return;
          }
          if (gesture === 'zoom') {
            // `m_zoomStartPoint = m_dragStartPoint` (`:562`) -- fixed for the drag.
            dragZoomRef.current = { lastClientY: e.clientY, anchor: { x: p.x, y: p.y } };
            return;
          }
        }
        if (e.button !== 0) return;
        const world = toWorld(p.x, p.y);
        if (activeTool === 'measure') {
          if (!measuringRef.current) {
            measuringRef.current = true;
            measureRef.current = { a: world, b: world };
          } else {
            measuringRef.current = false;
            measureRef.current = { a: measureRef.current!.a, b: world };
            onMeasure?.(measureRef.current);
          }
          requestDraw();
        } else {
          // Select: pick the topmost item under the cursor.
          const tol = 3 / viewRef.current.scale;
          let picked: GERBER_DRAW_ITEM | null = null;
          outer: for (let li = layersRef.current.length - 1; li >= 0; li--) {
            const layer = layersRef.current[li]!;
            if (!layer.visible) continue;
            const items = layer.image.items;
            for (let k = items.length - 1; k >= 0; k--) {
              if (items[k]!.hitTest(world, tol)) {
                picked = items[k]!;
                break outer;
              }
            }
          }
          onPick?.(picked, world);
        }
      };

      const onMove = (e: PointerEvent): void => {
        const p = pxOf(e);
        const world = toWorld(p.x, p.y);
        // The crosshair marks the snapped point (GAL m_cursorPosition), not the
        // raw pointer.
        const { showGrid: sg, gridIU: g } = gridRef.current;
        const snapped =
          sg && g > 0 ? { x: Math.round(world.x / g) * g, y: Math.round(world.y / g) * g } : world;
        const vt = viewRef.current;
        cursorPxRef.current = worldToDevice(vt, optionsRef.current.flipView, snapped.x, snapped.y);
        onCursorMove?.(world);
        if (panRef.current) {
          viewRef.current.tx = panRef.current.tx + (p.x - panRef.current.x);
          viewRef.current.ty = panRef.current.ty + (p.y - panRef.current.y);
          requestDraw();
          return;
        }
        const dz = dragZoomRef.current;
        if (dz) {
          // DRAG_ZOOMING (`wx_view_controls.cpp:363-405`), through gerbview's
          // own scale clamp because `zoomStep` is where that lives.
          zoomStep(dragZoomScale(dz.lastClientY - e.clientY, commonInputPrefs()), dz.anchor);
          dz.lastClientY = e.clientY;
          return;
        }
        if (zoomAreaRef.current) {
          zoomAreaRef.current = { ...zoomAreaRef.current, b: world };
          requestDraw();
          return;
        }
        if (measuringRef.current && measureRef.current) {
          measureRef.current = { a: measureRef.current.a, b: world };
          onMeasure?.(measureRef.current);
          requestDraw();
        } else {
          // The crosshair follows the pointer in both modes now, not only the
          // full-window one.
          requestDraw();
        }
      };

      const onUp = (e: PointerEvent): void => {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        panRef.current = null;
        // DRAG_ZOOMING and DRAG_PANNING share one release (`:575-588`).
        dragZoomRef.current = null;

        const za = zoomAreaRef.current;
        if (za) {
          zoomAreaRef.current = null;
          applyZoomArea(za);
          onZoomAreaDone?.();
          requestDraw();
        }
      };

      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      // No 'pointerleave' handler on purpose. `WX_VIEW_CONTROLS::onLeave` is
      // `onMotion( aEvent )` and nothing else (`wx_view_controls.cpp:625-630`),
      // so the cursor keeps its last position, the crosshair stays at the edge
      // and the status bar keeps its coordinates.
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      return () => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
      };
    }, [activeTool, dpr, requestDraw, toWorld, onCursorMove, onMeasure, onPick]);

    // Escape cancels an in-flight measurement.
    useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
        // Hidden frames must not act on global hotkeys (editors stay mounted
        // behind display:none; no stamp = standalone build, always active).
        if ((document.body.dataset.activeView ?? 'gerber') !== 'gerber') return;
        if (e.key === 'Escape' && measuringRef.current) {
          measuringRef.current = false;
          measureRef.current = null;
          onMeasure?.(null);
          requestDraw();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onMeasure, requestDraw]);

    // Reset measurement when the tool changes away from measure.
    useEffect(() => {
      if (activeTool !== 'measure') {
        measuringRef.current = false;
        measureRef.current = null;
        onMeasure?.(null);
        requestDraw();
      }
    }, [activeTool, onMeasure, requestDraw]);

    return (
      <div
        ref={wrapRef}
        className="ze-canvas-wrap"
        style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            // ZOOM_TOOL sets KICURSOR::ZOOM_IN while it is armed
            // (`common/tool/zoom_tool.cpp:70`).
            cursor:
              activeTool === 'zoom'
                ? 'zoom-in'
                : activeTool === 'measure'
                  ? 'crosshair'
                  : 'default',
          }}
        />
        {/* The items. Takes no pointer events, so captures still land on the
            canvas underneath. */}
        {GL_RENDERER && (
          <canvas
            ref={glCanvasRef}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          />
        )}
        {/* Above the items: the zoom rubber band, the measure line and the
            crosshair - GerbView's TARGET_OVERLAY. */}
        {GL_RENDERER && (
          <canvas
            ref={overCanvasRef}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          />
        )}
      </div>
    );
  },
);
