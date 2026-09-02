// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor canvas, `pl_editor`'s PL_DRAW_PANEL_GAL plus its
 * interactive tools in Canvas 2D. It shows the page as white stationery on the
 * desk, paints the resolved drawing-sheet primitives (wksRender), and drives
 * the tool interactions the way the upstream tools do:
 *
 *  - selection tool: click select / shift-click add, drag-move the selection,
 *    box select, all with grid snapping of the tool cursor;
 *  - drawing tools (line / rect): first click creates the real item at the
 *    cursor, motion drags its end point live, the second click finishes it and
 *    hands the item to the point editor; Escape cancels the in-flight item but
 *    keeps the tool; the tool stays active for repeated placements;
 *  - one-click tools (text / bitmap): place at the click and stay active;
 *  - point editor: a single selected line/rect exposes draggable end/corner
 *    handles;
 *  - move mode (M): the selection travels with the cursor, click drops it;
 *  - interactive delete: the hovered item is brightened green, click deletes.
 *
 * A controller (zoom / redraw) is exposed via ref, like the other editors.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Vec2 } from '@ziroeda/kimath';
import {
  pickDrawItem,
  wksItemsInBox,
  wksItemBBox,
  SCH_IU_PER_MM,
  type DsDrawItem,
} from '@ziroeda/common';
import {
  drawDrawingSheetItems,
  dsBackgroundIsDark,
  DS_CURSOR_COLOR_ON_DARK,
  DS_CURSOR_COLOR_ON_LIGHT,
  DS_GRID_COLOR_ON_DARK,
  DS_GRID_COLOR_ON_LIGHT,
  PAGE_MARKER_SIZE_IU,
  DS_EDIT_POINT_ON_DARK,
  DS_EDIT_POINT_ON_LIGHT,
  DS_MARQUEE,
} from '@ziroeda/common';
import { setBitmapInvalidate } from '@ziroeda/common';
import { usePlEditorColors } from '../../prefs/useSettings.js';
import { DrawingSheetGl } from '../../render/gl/drawingsheet_gl.js';
import {
  commonInputPrefs,
  dragGesture,
  dragZoomScale,
  wheelAction,
  zoomFitView,
} from '../../ui/view_controls.js';
import { clampViewScale } from '../../ui/zoom_settings.js';
import { drawCrosshair, drawGrid } from '../../ui/grid_cursor.js';
import { scaleForZoomFactor, zoomFactorForScale } from '../../ui/status_format.js';
import { ZOOM_LIST, nextZoomPreset } from '../../ui/zoom_settings.js';
import { kiCursor } from '../../ui/kicursors.js';
import {
  DELETE_THRESHOLD_PX,
  EDIT_POINT_SIZE_PX,
  SELECT_THRESHOLD_PX,
  thresholdToWorld,
  withinPoint,
} from './hit_test.js';

/*
 * The canvas cursors are KiCad's own art now - see `ui/kicursors.ts` and
 * `scripts/vendor-cursors.mjs`. What stood here was an SVG pencil and an SVG
 * cross drawn by hand, on the reasoning that "an XPM bitmap gives no path".
 * An XPM is a bitmap; a bitmap converts to a PNG exactly, so there was never a
 * reason to redraw one.
 */

export interface DrawingSheetCanvasController {
  /**
   * Abandon whatever pointer gesture is running, without applying it.
   *
   * `PL_POINT_EDITOR::Main`'s cancel branch (pl_point_editor.cpp:241-247) and
   * `PL_EDIT_TOOL::Main`'s (pl_edit_tool.cpp:222-244) both leave the drag loop
   * on Escape, so the button still being down means nothing afterwards. Ours
   * kept the gesture alive and applied its delta on pointer-up.
   *
   * Returns whether anything was actually running, so the frame's cancel chain
   * can tell "I cancelled a drag" from "there was nothing to cancel" and fall
   * through to the next link.
   */
  cancelGesture: () => boolean;
  zoomToFit: () => void;
  zoomToSelection: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** `COMMON_TOOLS::doZoomToPreset` — jump to one entry of the zoom table. */
  setZoomPreset: (factor: number) => void;
  redraw: () => void;
}

export interface DrawingSheetCanvasProps {
  draws: DsDrawItem[];
  /** Page size in IU. */
  pageW: number;
  pageH: number;
  selection: ReadonlySet<number>;
  activeTool: string;
  showGrid: boolean;
  /** Grid step in IU (also the snap step while the grid is shown). */
  gridIU: number;
  /**
   * The coordinate-origin corner, in page IU — `ReturnCoordOriginCorner()`.
   *
   * `PL_DRAW_PANEL_GAL::DisplayDrawingSheet` hands it to the DS_DRAW_ITEM_PAGE
   * as its marker position (`pl_draw_panel_gal.cpp:126-128`), and DS_PAINTER
   * draws a circle and an X there. Defaults to the paper's top-left, which is
   * `m_originSelectChoice` 0.
   */
  originIU?: Vec2;
  /**
   * `window.cursor.cross_hair_mode` (app_settings.cpp:567-568), the three-way
   * `PANEL_GAL_OPTIONS` radio: small / full window / 45 degree
   * (common/dialogs/panel_gal_options_base.cpp:102-108). This used to be a
   * boolean, which could not express the third one.
   */
  crosshairMode?: 'small' | 'full' | '45';
  /**
   * `window.cursor.always_show_cursor` (app_settings.cpp:564-565).
   *
   * With the selection tool active the crosshair is there ONLY because this is
   * on — a tool that wants a cursor asks for one itself. It was a `true`
   * literal in the draw call with a comment naming this setting, which is the
   * drift CLAUDE.md's central-value rule is about: the value KiCad reads out of
   * its settings object has to come out of ours.
   */
  alwaysShowCursor?: boolean;
  /*
   * There is no `blackBackground` here any more, and there was never an
   * upstream one: `black_background` reaches `SetDrawBgColor`
   * (`pl_editor_frame.cpp:541`), which sets `EDA_DRAW_FRAME::m_drawBgColor` —
   * the DEVICE-CONTEXT background. Nothing in `EDA_DRAW_PANEL_GAL` reads it;
   * `onPaint` clears the canvas to `settings->GetBackgroundColor()`
   * (`common/draw_panel_gal.cpp:364`), which is `m_backgroundColor`, which is
   * `LAYER_SCHEMATIC_BACKGROUND` out of the chosen theme. The three consumers
   * of `GetDrawBgColor()` in 10.0.5 are the printer
   * (`dialogs_for_printing.cpp:186`), the properties frame's colour swatch
   * (`properties_frame.cpp:125`) and DIALOG_PAGES_SETTINGS' preview
   * (`common/dialogs/dialog_page_settings.cpp:598`) — and it is the last of
   * those that `DrawingSheetEditor` now hands the setting to.
   */
  /** Endpoint/corner handles of the point editor (page IU), or empty. */
  editPoints?: Vec2[];
  /** Move mode (M): selection travels with the cursor until dropped. */
  moveMode?: boolean;
  onCursorMove?: (p: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /**
   * Right-click on the canvas, with the item under the cursor (or null).
   *
   * PL_SELECTION_TOOL::Main (pl_selection_tool.cpp:120-135) on BUT_RIGHT:
   * an EMPTY selection picks up the item under the cursor as a hover
   * selection first; a non-empty one is left exactly as it is, wherever the
   * click landed. Then the tool menu opens over that selection.
   */
  onContextMenuRequest?: (x: number, y: number, hit: number | null) => void;
  onSelect?: (src: number | null, additive: boolean) => void;
  onSelectBox?: (srcs: number[], additive: boolean) => void;
  onMoveItems?: (deltaIU: Vec2) => void;
  /** One-click placement (text / bitmap). */
  onPlacePoint?: (tool: string, atIU: Vec2) => void;
  /** Two-click drawing: create the item, drag its end live, finish it. */
  onDrawFirst?: (tool: string, atIU: Vec2) => void;
  onDrawMove?: (atIU: Vec2) => void;
  onDrawSecond?: (atIU: Vec2) => void;
  /** Interactive delete picker. */
  onDeleteHover?: (src: number | null) => void;
  onDeleteClick?: (src: number) => void;
  /** Point editor: drag handle `index` to a new page position. */
  onPointDrag?: (index: number, atIU: Vec2) => void;
  onPointDragEnd?: () => void;
  /** Space bar: set the dx/dy local origin to the cursor. */
  onSetLocalOrigin?: (atIU: Vec2) => void;
  /** Move mode drop: commit the delta and leave move mode. */
  onMoveDrop?: (deltaIU: Vec2) => void;
}

/**
 * `?renderer=canvas` forces the 2D path, as it does in the other three canvases.
 *
 * The GL layer is an addition, never a requirement: `DrawingSheetGl.create`
 * returns null when WebGL is unavailable, and every frame then falls through to
 * the raster path below, which still draws the whole sheet.
 */
const GL_RENDERER =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('renderer') !== 'canvas';

const TWO_CLICK = new Set(['dsAddLine', 'dsAddRect']);
const ONE_CLICK = new Set(['dsAddText', 'dsAddBitmap']);

export const DrawingSheetCanvas = forwardRef<DrawingSheetCanvasController, DrawingSheetCanvasProps>(
  function DrawingSheetCanvas(props, ref) {
    const {
      draws,
      pageW,
      pageH,
      selection,
      activeTool,
      showGrid,
      gridIU,
      originIU,
      crosshairMode,
      alwaysShowCursor = true,
      editPoints,
      moveMode,
      onCursorMove,
      onScaleChange,
      onContextMenuRequest,
      onSelect,
      onSelectBox,
      onMoveItems,
      onPlacePoint,
      onDrawFirst,
      onDrawMove,
      onDrawSecond,
      onDeleteHover,
      onDeleteClick,
      onPointDrag,
      onPointDragEnd,
      onSetLocalOrigin,
      onMoveDrop,
    } = props;

    /*
     * `m_painter->GetSettings()->LoadColors( ::GetColorSettings( cfg->m_ColorTheme ) )`
     * — `PL_DRAW_PANEL_GAL::PL_DRAW_PANEL_GAL` (`pl_draw_panel_gal.cpp:57-59`).
     * The draw panel reads `pl_editor`'s own `appearance.color_theme`, which is
     * the value Preferences > Drawing Sheet Editor > Colors writes, so a theme
     * chosen there repaints this canvas.
     */
    const colors = usePlEditorColors();

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glCanvasRef = useRef<HTMLCanvasElement>(null);
    const overCanvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<DrawingSheetGl | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef({ scale: 0.02, tx: 0, ty: 0 });
    const rafRef = useRef(0);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const [, setScaleState] = useState(0);

    // Mutable state read by draw() without a re-render.
    const drawsRef = useRef(draws);
    drawsRef.current = draws;
    const selRef = useRef(selection);
    selRef.current = selection;
    const editPointsRef = useRef(editPoints);
    editPointsRef.current = editPoints;
    const moveDeltaRef = useRef<Vec2 | null>(null);
    const boxRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
    const drawingRef = useRef(false); // a two-click item is in flight
    const brightenedRef = useRef<number | null>(null);
    const cursorPxRef = useRef<{ x: number; y: number } | null>(null);
    const cursorWorldRef = useRef<Vec2 | null>(null);
    const moveModeStartRef = useRef<Vec2 | null>(null);

    /** Snap a world point to the grid when the grid is visible. */
    const snap = useCallback(
      (p: Vec2): Vec2 =>
        showGrid && gridIU > 0
          ? { x: Math.round(p.x / gridIU) * gridIU, y: Math.round(p.y / gridIU) * gridIU }
          : p,
      [showGrid, gridIU],
    );

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;

      // `m_gal->SetClearColor( settings->GetBackgroundColor() )`, then
      // `ClearScreen()` (common/draw_panel_gal.cpp:364, :372).
      const background = colors.background;
      const darkBg = dsBackgroundIsDark(background);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // World transform (IU → device px).
      ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);

      // No paper rectangle and no drop shadow: `DS_PAINTER::draw( const
      // DS_DRAW_ITEM_PAGE* )` (common/drawing_sheet/ds_painter.cpp:357-382)
      // sets `SetIsFill( false )` and only STROKES the page rectangle, in
      // `m_pageBorderColor`. The paper is the cleared background, which is why
      // pl_editor's canvas and page are the same colour.

      // GAL::DrawGrid, over the whole canvas rather than only the sheet: the
      // grid belongs to the view, not to the page, and pl_editor's grid runs
      // right across its canvas. It goes on after the paper because ours is an
      // opaque rectangle drawn over the backdrop; upstream has no such
      // rectangle, the background IS the paper. The colour is
      // DS_RENDER_SETTINGS::GetGridColor, a luma choice on the background
      // (ds_painter.h:71-75).
      drawGrid(ctx, v, canvas.width, canvas.height, {
        show: showGrid,
        sizeIU: gridIU,
        color: darkBg ? DS_GRID_COLOR_ON_DARK : DS_GRID_COLOR_ON_LIGHT,
        devicePixelRatio: dpr,
      });
      // World transform again: drawGrid paints in device space.
      ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);

      const worldPen = 1 / v.scale; // 1 device px in world units

      // The page outline (ds_painter.cpp:361-368). One device pixel, drawn on
      // top of the grid the way the LAYER_DRAWINGSHEET page item is.
      ctx.strokeStyle = colors.pageBorder;
      ctx.lineWidth = worldPen;
      // Snapped for the same reason the sheet's own hairlines are: this rect is
      // ONE device pixel and straddles two of them wherever the page edge
      // happens to land, which is what still read as a soft grey border after
      // the items themselves went crisp. Drawn in device space with the world
      // transform put back afterwards.
      {
        const m = ctx.getTransform();
        const half = (v: number): number => Math.round(v - 0.5) + 0.5;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const l = half(m.e);
        const t = half(m.f);
        const r = half(m.a * pageW + m.e);
        const b = half(m.d * pageH + m.f);
        ctx.lineWidth = 1;
        ctx.strokeRect(l, t, r - l, b - t);
        ctx.restore();
      }

      // The coord-origin marker: a circle of `marker_size` and an X across it,
      // both in the page-border colour (`ds_painter.cpp:372-383`). The size is
      // `drawSheetIUScale.mmToIU( 5 )`, fixed by PL_DRAW_PANEL_GAL rather than
      // scaled with the view (`pl_draw_panel_gal.cpp:110-113`), so it stays 5 mm
      // of PAGE however far you zoom out.
      {
        const o = originIU ?? { x: 0, y: 0 };
        const r = PAGE_MARKER_SIZE_IU;
        ctx.beginPath();
        ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
        ctx.moveTo(o.x - r, o.y - r);
        ctx.lineTo(o.x + r, o.y + r);
        ctx.moveTo(o.x + r, o.y - r);
        ctx.lineTo(o.x - r, o.y + r);
        ctx.stroke();
      }

      // ---- the sheet itself ----
      //
      // On the GL layer when there is one, and NOT during an in-flight move: a
      // move rebuilds the item list every pointer event, so the buffer would be
      // re-recorded and re-uploaded on each one. That is the same exception
      // `SchematicCanvas` makes for a ghost, and it is why `moveDelta` falls
      // through to the raster path below.
      const md = moveDeltaRef.current;
      const glc = glRef.current;
      const glCanvas = glCanvasRef.current;
      let sheetOnGl = false;
      /*
       * A sheet with an image on it goes down the raster path, whole.
       *
       * `GlRecorder.drawImage` is a no-op — "images are not recorded yet...
       * which is why the backend is not yet the default" (recorder.ts). The
       * backend then BECAME the default here, and the comment's condition went
       * with it: placing an image put a real DS_DATA_ITEM_BITMAP in the sheet,
       * saved it, and drew nothing at all. Reported as "the image inserting
       * tool not working", and it was not the tool.
       *
       * The raster painter draws bitmaps properly (`drawBitmap`, ds_painter.ts),
       * so falling back to it is not a degraded mode — it is the renderer that
       * was the default until recently, and it is the same painter. It costs
       * the GL crispness on sheets that carry a logo, which is the trade until
       * the recorder can texture a quad.
       *
       * Only when the image has DATA: an item still decoding, or one whose PNG
       * failed to load, is drawn as a dashed placeholder rectangle, and a
       * rectangle is something the recorder handles.
       */
      const hasImage = drawsRef.current.some((d) => d.kind === 'bitmap' && !!d.pngB64);
      if (
        GL_RENDERER &&
        glc &&
        glCanvas &&
        !glc.isLost &&
        !hasImage &&
        !(md && selRef.current.size > 0)
      ) {
        const brightened = brightenedRef.current;
        glc.render(
          {
            draws: drawsRef.current,
            selection: selRef.current,
            // `m_normalColor`, so the GL layer and the raster path paint the
            // sheet the same colour. It is part of the recorded geometry, so it
            // is part of the key that decides whether to re-record.
            color: colors.normal,
            ...(brightened === null ? {} : { brightened }),
          },
          { scale: v.scale, tx: v.tx, ty: v.ty },
        );
        sheetOnGl = true;
      } else {
        // The GL layer must not keep showing a buffer the raster path is about
        // to draw over — during a move that would leave a stale copy of the
        // sheet sitting under the one being dragged. The overlay canvas goes
        // with it: the raster path draws its overlays into `ctx`, so anything
        // left on the layer above would sit there frozen while the sheet moved.
        glc?.clear();
        const over = overCanvasRef.current;
        if (over) over.getContext('2d')?.clearRect(0, 0, over.width, over.height);
      }

      // Clip page content to the page rectangle.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pageW, pageH);
      ctx.clip();
      // An in-flight move-mode / drag offset shifts the selected items live.
      if (sheetOnGl) {
        // Already on the GL layer above; the clip is still opened and closed so
        // the two paths leave the context in the same state.
      } else if (md && selRef.current.size > 0) {
        const still = drawsRef.current.filter((d) => !selRef.current.has(d.src));
        drawDrawingSheetItems(ctx, still, new Set(), {
          color: colors.normal,
          minWidth: worldPen,
          brightened: brightenedRef.current,
        });
        ctx.save();
        ctx.translate(md.x, md.y);
        const moving = drawsRef.current.filter((d) => selRef.current.has(d.src));
        drawDrawingSheetItems(ctx, moving, selRef.current, {
          color: colors.normal,
          minWidth: worldPen,
        });
        ctx.restore();
      } else {
        drawDrawingSheetItems(ctx, drawsRef.current, selRef.current, {
          color: colors.normal,
          minWidth: worldPen,
          brightened: brightenedRef.current,
        });
      }
      ctx.restore();

      // ---- overlays (device space) ----
      //
      // On their own canvas when the sheet is on the GL layer, because that
      // layer sits ABOVE the raster one: a crosshair or a selection box drawn
      // into `ctx` would be painted over by the sheet wherever the two cross.
      // GerbView splits them the same way, for the same reason.
      const octx = (sheetOnGl && overCanvasRef.current?.getContext('2d')) || ctx;
      if (octx !== ctx) {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, canvas.width, canvas.height);
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      const toPx = (p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });

      // No selection outline. pl_editor draws none: `PL_PAINTER::draw` picks
      // `m_selectedColor` for an item with SELECTED set and repaints the item
      // ITSELF in it (pl_painter.cpp), which ds_painter.ts:455 already does
      // here. The dashed box that stood here was ours - an invention with no
      // upstream metric, and visibly a second outline beside the real one:
      // where KiCad shows one recoloured rectangle plus its EDIT_POINTS
      // handles, ours showed a dashed rectangle inset inside the solid one.

      // Point-editor handles (filled squares, EDIT_POINTS style).
      const pts = editPointsRef.current;
      if (pts && pts.length > 0 && !md) {
        // EDIT_POINT::POINT_SIZE is 8 (include/tool/edit_points.h:194) and
        // edit_points.cpp:290 halves it, so the square is 8 across. [data]
        const r = 4 * dpr;
        const handle = darkBg ? DS_EDIT_POINT_ON_DARK : DS_EDIT_POINT_ON_LIGHT;
        for (const p of pts) {
          const c = toPx(p);
          octx.fillStyle = handle.fill;
          octx.strokeStyle = handle.border;
          octx.lineWidth = Math.max(1, dpr);
          octx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
          octx.strokeRect(c.x - r, c.y - r, r * 2, r * 2);
        }
      }

      // Box-select marquee.
      const box = boxRef.current;
      if (box) {
        const p0 = toPx(box.a),
          p1 = toPx(box.b);
        const rightward = box.b.x >= box.a.x;
        const scheme = darkBg ? DS_MARQUEE.onDark : DS_MARQUEE.onLight;
        octx.strokeStyle = rightward ? scheme.outlineL2R : scheme.outlineR2L;
        octx.fillStyle = scheme.fill;
        octx.lineWidth = dpr;
        const x = Math.min(p0.x, p1.x),
          y = Math.min(p0.y, p1.y);
        octx.fillRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
        octx.strokeRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
      }

      // GAL::blitCursor, in DS_RENDER_SETTINGS::GetCursorColor
      // (ds_painter.h:77-81). The drawing tools ask for a crosshair; with the
      // selection tool it is there only because always_show_cursor is on, and
      // a forced cursor is dimmed.
      drawCrosshair(ctx, cursorPxRef.current, canvas.width, canvas.height, {
        mode: crosshairMode ?? 'small',
        color: darkBg ? DS_CURSOR_COLOR_ON_DARK : DS_CURSOR_COLOR_ON_LIGHT,
        toolWantsCursor: activeTool !== 'select',
        alwaysShow: alwaysShowCursor,
        devicePixelRatio: dpr,
      });

      setScaleState(v.scale);
      onScaleChange?.(v.scale);
    }, [
      pageW,
      pageH,
      showGrid,
      gridIU,
      // The origin corner. Without it the marker is painted once and then never
      // again: `draw` is a useCallback, so an origin the closure never re-reads
      // is an origin the dropdown cannot move. The value is memoised upstream on
      // [sheet.setup, pageMM, originChoice], so this does not re-arm per frame.
      originIU,
      dpr,
      activeTool,
      crosshairMode,
      alwaysShowCursor,
      // `CommonSettingsChanged`'s `LoadColors` + `UpdateAllItems( COLOR )` +
      // `ForceRefresh()` (pl_editor_frame.cpp:645-650): a new theme repaints.
      colors,
      onScaleChange,
    ]);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    /**
     * The live `requestDraw`, for effects that must NOT re-run when it changes.
     *
     * `requestDraw` is rebuilt whenever `draw` is, and `draw` closes over
     * `activeTool` among other things — so it is a new function on every tool
     * click. An effect that lists it in its deps therefore tears down and
     * rebuilds on every tool click, and for the GL device below that means
     * disposing the WebGL context, recompiling both programs and re-uploading
     * every buffer. That is the whole-canvas flash, on every click of the right
     * toolbar and again when a finished tool falls back to the selection tool.
     *
     * GerbView's canvas routes its two context handlers through a ref for
     * exactly this reason and mounts the device once
     * (`GerberCanvas.tsx:385,393-394`), as does the schematic's
     * (`SchematicCanvas.tsx:2487`). This is that ref.
     */
    const requestDrawRef = useRef(requestDraw);
    requestDrawRef.current = requestDraw;

    useEffect(() => {
      requestDraw();
    }, [draws, selection, editPoints, requestDraw]);

    // Redraw when an async bitmap decode finishes.
    useEffect(() => {
      setBitmapInvalidate(requestDraw);
      return () => setBitmapInvalidate(null);
    }, [requestDraw]);

    const zoomToFit = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // COMMON_TOOLS::doZoomFit's FRAME_PL_EDITOR margin, not 12 mm of padding.
      const v = zoomFitView(
        { minX: 0, minY: 0, maxX: pageW, maxY: pageH },
        { width: canvas.width, height: canvas.height },
        'pl_editor',
      );
      viewRef.current = v ?? {
        scale: 0.02,
        tx: canvas.width / 2,
        ty: canvas.height / 2,
      };
      requestDraw();
    }, [pageW, pageH, requestDraw]);

    const zoomToSelection = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
      for (const src of selRef.current) {
        const b = wksItemBBox(drawsRef.current, src);
        if (!b) continue;
        box = box
          ? {
              minX: Math.min(box.minX, b.minX),
              minY: Math.min(box.minY, b.minY),
              maxX: Math.max(box.maxX, b.maxX),
              maxY: Math.max(box.maxY, b.maxY),
            }
          : b;
      }
      if (!box) return;
      // ZOOM_FIT_SELECTION: doZoomFit's plain margin, the library-editor slack
      // applying only to ZOOM_FIT_ALL (common_tools.cpp:387).
      const v = zoomFitView(
        box,
        { width: canvas.width, height: canvas.height },
        'pl_editor',
        'selection',
      );
      if (v) viewRef.current = v;
      requestDraw();
    }, [requestDraw]);

    /*
     * ZOOM_TOOL::selectRegion's tail (common/tool/zoom_tool.cpp:130-158):
     *
     *   VECTOR2D sSize = view->ToWorld( canvas->GetClientSize(), false );
     *   VECTOR2D vSize = selectionBox.GetSize();
     *   double ratio = std::max( fabs( vSize.x / sSize.x ), fabs( vSize.y / sSize.y ) );
     *   scale = IsMouseUp( BUT_LEFT ) ? view->GetScale() / ratio
     *                                 : view->GetScale() * ratio;
     *   view->SetScale( scale );
     *   view->SetCenter( selectionBox.Centre() );
     *
     * A zero-width or zero-height box does nothing at all (`break` before the
     * else), so a plain click inside the tool is not a zoom.
     */
    const zoomToRegion = useCallback(
      (box: { a: Vec2; b: Vec2 } | null, out: boolean) => {
        const canvas = canvasRef.current;
        if (!canvas || !box) return;
        const v = viewRef.current;
        const w = Math.abs(box.b.x - box.a.x);
        const h = Math.abs(box.b.y - box.a.y);
        if (w === 0 || h === 0) return;
        // The client size in WORLD units, view->ToWorld( ..., false ).
        const sw = canvas.width / v.scale;
        const sh = canvas.height / v.scale;
        const ratio = Math.max(Math.abs(w / sw), Math.abs(h / sh));
        if (!Number.isFinite(ratio) || ratio === 0) return;
        // VIEW::SetScale clamps BEFORE it re-anchors (`common/view/view.cpp:583-595`),
        // so a zoom that hits the limit stops rather than sliding the view.
        const scale = clampViewScale(
          out ? v.scale * ratio : v.scale / ratio,
          'pl_editor',
          dpr,
          SCH_IU_PER_MM,
        );
        const cx = (box.a.x + box.b.x) / 2;
        const cy = (box.a.y + box.b.y) / 2;
        v.scale = scale;
        v.tx = canvas.width / 2 - cx * scale;
        v.ty = canvas.height / 2 - cy * scale;
        requestDraw();
      },
      [requestDraw],
    );

    /**
     * `COMMON_TOOLS::doZoomToPreset` (common/tool/common_tools.cpp:468-495):
     * `VIEW::SetScale( zoomList[idx] )`, an absolute zoom rather than a step.
     * The canvas centre is held, which is `SetScale( scale )`'s own behaviour
     * when no anchor is passed.
     */
    const setZoomPreset = useCallback(
      (factor: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const v = viewRef.current;
        const px = canvas.width / 2,
          py = canvas.height / 2;
        const wx = (px - v.tx) / v.scale,
          wy = (py - v.ty) / v.scale;
        v.scale = clampViewScale(
          scaleForZoomFactor(factor, dpr, SCH_IU_PER_MM),
          'pl_editor',
          dpr,
          SCH_IU_PER_MM,
        );
        v.tx = px - wx * v.scale;
        v.ty = py - wy * v.scale;
        requestDraw();
      },
      [dpr, requestDraw],
    );

    /**
     * `COMMON_TOOLS::doZoomInOut` (common/tool/common_tools.cpp:252-291).
     *
     * Not `scale *= 1.3`. The 1.3 is the FLOOR - "Step must be AT LEAST 1.3" -
     * and the zoom actually applied is the next entry of the frame's zoom table
     * beyond it, pegged to the end of the list rather than running off it. So
     * KiCad always lands on a round, repeatable zoom that the canvas context
     * menu can also name and jump straight back to; ours multiplied by a
     * constant and landed on 1.12, 1.46, 1.90, 2.47… none of which is anywhere.
     */
    const zoomPresetStep = useCallback(
      (zoomIn: boolean) => {
        const now = zoomFactorForScale(viewRef.current.scale, dpr, SCH_IU_PER_MM);
        setZoomPreset(nextZoomPreset(ZOOM_LIST.pl_editor, now, zoomIn));
      },
      [dpr, setZoomPreset],
    );

    useImperativeHandle(
      ref,
      () => ({
        cancelGesture: () => {
          const live = gestureRef.current !== null || drawingRef.current;
          gestureRef.current = null;
          moveDeltaRef.current = null;
          boxRef.current = null;
          drawingRef.current = false;
          if (live) requestDraw();
          return live;
        },
        zoomToFit,
        zoomToSelection,
        zoomIn: () => zoomPresetStep(true),
        zoomOut: () => zoomPresetStep(false),
        setZoomPreset,
        redraw: () => requestDraw(),
      }),
      [zoomToFit, zoomToSelection, zoomPresetStep, setZoomPreset, requestDraw],
    );

    // Size to container; fit on first layout.
    const fittedRef = useRef(false);
    /** The live `zoomToFit`, for the same reason as {@link requestDrawRef}. */
    const zoomToFitRef = useRef(zoomToFit);
    zoomToFitRef.current = zoomToFit;
    useEffect(() => {
      const wrap = wrapRef.current,
        canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const ro = new ResizeObserver(() => {
        const r = wrap.getBoundingClientRect();
        for (const el of [canvas, glCanvasRef.current, overCanvasRef.current]) {
          if (!el) continue;
          const w = Math.max(1, Math.round(r.width * dpr));
          const h = Math.max(1, Math.round(r.height * dpr));
          // Only when it CHANGED. Assigning `canvas.width` resets the drawing
          // buffer even when the value is identical, so an observer that fires
          // on a layout the canvas did not actually change wipes all three
          // layers and leaves them blank until the next animation frame. That
          // is one frame of empty canvas — the flash.
          if (el.width !== w) el.width = w;
          if (el.height !== h) el.height = h;
          el.style.width = `${r.width}px`;
          el.style.height = `${r.height}px`;
        }
        if (!fittedRef.current) {
          fittedRef.current = true;
          zoomToFitRef.current();
        } else requestDrawRef.current();
      });
      ro.observe(wrap);
      return () => ro.disconnect();
      // Mounted once, like the GL device above: `observe()` fires the callback
      // immediately, so re-arming this effect on every tool click ran a resize
      // pass per click. Both callbacks are reached through refs.
    }, [dpr]);

    /**
     * The GL device, and its two context events.
     *
     * A lost context is not an error path to log and forget: the buffers are
     * gone, so the adapter is dropped and every frame until `restored` takes the
     * raster path, which still draws the whole sheet. That is why
     * `DrawingSheetGl.create` returning null has to stay survivable.
     */
    useEffect(() => {
      if (!GL_RENDERER) return;
      const el = glCanvasRef.current;
      if (!el) return;
      glRef.current = DrawingSheetGl.create(el);
      const onLost = (e: Event): void => {
        e.preventDefault();
        glRef.current?.dispose();
        glRef.current = null;
        requestDrawRef.current();
      };
      const onRestored = (): void => {
        glRef.current = DrawingSheetGl.create(el);
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
      // Mounted ONCE. The two handlers reach the current `requestDraw` through
      // its ref; listing it here would rebuild the WebGL context on every tool
      // click. See `requestDrawRef`.
    }, []);

    // WX_VIEW_CONTROLS::onWheel.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const v = viewRef.current;
        const action = wheelAction(e, commonInputPrefs(), {
          width: canvas.width,
          height: canvas.height,
        });
        if (action.kind === 'none') return;
        if (action.kind === 'pan') {
          v.tx += action.dx;
          v.ty += action.dy;
          requestDraw();
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * dpr,
          py = (e.clientY - rect.top) * dpr;
        const wx = (px - v.tx) / v.scale,
          wy = (py - v.ty) / v.scale;
        // ZOOM_MAX_LIMIT_PLEDITOR / ZOOM_MIN_LIMIT_PLEDITOR, 20 and 0.05
        // (`include/zoom_defines.h:56-58`), installed by pl_draw_panel_gal.cpp:63.
        // The wheel is the path upstream's comment singles out as the reason
        // the limits exist at all.
        v.scale = clampViewScale(v.scale * action.factor, 'pl_editor', dpr, SCH_IU_PER_MM);
        v.tx = px - wx * v.scale;
        v.ty = py - wy * v.scale;
        requestDraw();
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [dpr, requestDraw]);

    // Space bar: set the relative-coordinate local origin at the cursor.
    useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
        // Hidden frames must not act on global hotkeys (editors stay mounted
        // behind display:none; no stamp = standalone build, always active).
        if ((document.body.dataset.activeView ?? 'drawingsheet') !== 'drawingsheet') return;
        if (e.key !== ' ' || e.repeat) return;
        const tgt = e.target as HTMLElement | null;
        if (
          tgt &&
          (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')
        )
          return;
        const w = cursorWorldRef.current;
        if (w) {
          e.preventDefault();
          onSetLocalOrigin?.(w);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onSetLocalOrigin]);

    const worldAt = (clientX: number, clientY: number): Vec2 => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: ((clientX - rect.left) * dpr - v.tx) / v.scale,
        y: ((clientY - rect.top) * dpr - v.ty) / v.scale,
      };
    };

    const gestureRef = useRef<
      | { mode: 'pan'; last: { x: number; y: number } }
      | { mode: 'dragzoom'; last: { x: number; y: number }; anchor: { x: number; y: number } }
      | { mode: 'box'; start: Vec2; additive: boolean }
      | { mode: 'move'; start: Vec2; moved: boolean }
      | { mode: 'point'; index: number }
      | { mode: 'zoom'; start: Vec2; out: boolean }
      | null
    >(null);

    // Entering/leaving move mode (M): anchor at current cursor.
    useEffect(() => {
      if (moveMode) {
        moveModeStartRef.current = cursorWorldRef.current ?? { x: 0, y: 0 };
      } else {
        moveModeStartRef.current = null;
        moveDeltaRef.current = null;
        requestDraw();
      }
    }, [moveMode, requestDraw]);

    const hitEditPoint = (world: Vec2): number | null => {
      const pts = editPointsRef.current;
      if (!pts) return null;
      // EDIT_POINTS::FindPoint over EDIT_POINT::POINT_SIZE — a square box,
      // strict on its edges (edit_points.cpp:37-45, :58-78). See `hit_test.ts`.
      const tol = thresholdToWorld(EDIT_POINT_SIZE_PX, viewRef.current.scale, dpr);
      for (let i = 0; i < pts.length; i++) {
        if (withinPoint(pts[i]!, world, tol)) return i;
      }
      return null;
    };

    const onPointerDown = (e: React.PointerEvent): void => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const world = worldAt(e.clientX, e.clientY);

      // Middle button always pans — except that a middle DOUBLE-click is
      // zoom-to-fit: `else if( evt->IsDblClick( BUT_MIDDLE ) )
      // m_toolMgr->RunAction( ACTIONS::zoomFitScreen )`
      // (pl_selection_tool.cpp:167-171). `PointerEvent.detail` is the click
      // count, so 2 is the second press of the pair.
      if (e.button === 1) {
        if (e.detail >= 2) {
          zoomToFit();
          return;
        }
        // `WX_VIEW_CONTROLS::onButton` (`wx_view_controls.cpp:546-569`) — the
        // middle button starts what Drag Gestures says, and NONE is neither
        // branch, so the press falls through to the tools.
        const gesture = dragGesture(e.button, commonInputPrefs());
        if (gesture !== 'none') {
          const last = { x: e.clientX, y: e.clientY };
          const r = canvasRef.current?.getBoundingClientRect() ?? new DOMRect();
          // `m_zoomStartPoint` (`:562`), fixed for the whole drag.
          const anchor = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
          gestureRef.current =
            gesture === 'zoom' ? { mode: 'dragzoom', last, anchor } : { mode: 'pan', last };
        }
        return;
      }

      /*
       * ZOOM_TOOL (common/tool/zoom_tool.cpp:62-95). The tool waits for a
       * DRAG, with the two buttons meaning opposite directions:
       *
       *     else if( evt->IsDrag( BUT_LEFT ) || evt->IsDrag( BUT_RIGHT ) )
       *         if( selectRegion() ) break;
       *
       * and in selectRegion the rubber band is a SELECTION_AREA preview item
       * live-updated on every drag event. It is not "zoom to what is
       * selected": nothing has to be selected for it to work, which is why
       * ACTIONS::zoomTool is always enabled.
       */
      if (activeTool === 'zoomTool' && (e.button === 0 || e.button === 2)) {
        gestureRef.current = { mode: 'zoom', start: world, out: e.button === 2 };
        boxRef.current = { a: world, b: world };
        return;
      }

      if (e.button !== 0) return;

      // Move mode: the click drops the selection.
      if (moveMode) {
        const start = moveModeStartRef.current;
        const d = start ? { x: snap(world).x - start.x, y: snap(world).y - start.y } : null;
        if (d) onMoveDrop?.(d);
        return;
      }

      // Interactive delete: click deletes the hovered item.
      if (activeTool === 'dsDelete') {
        // InteractiveDelete's click handler (pl_edit_tool.cpp:414).
        const tol = thresholdToWorld(DELETE_THRESHOLD_PX, viewRef.current.scale, dpr);
        const hit = pickDrawItem(drawsRef.current, world, tol);
        if (hit !== null) onDeleteClick?.(hit);
        return;
      }

      // Drawing tools.
      if (TWO_CLICK.has(activeTool)) {
        const at = snap(world);
        if (!drawingRef.current) {
          drawingRef.current = true;
          onDrawFirst?.(activeTool, at);
        } else {
          drawingRef.current = false;
          onDrawSecond?.(at);
        }
        return;
      }
      if (ONE_CLICK.has(activeTool)) {
        onPlacePoint?.(activeTool, snap(world));
        return;
      }

      // Point-editor handle?
      const handle = hitEditPoint(world);
      if (handle !== null) {
        gestureRef.current = { mode: 'point', index: handle };
        return;
      }

      // Select tool: pick / move / box.
      // SelectPoint (pl_selection_tool.cpp:44).
      const tol = thresholdToWorld(SELECT_THRESHOLD_PX, viewRef.current.scale, dpr);
      const hit = pickDrawItem(drawsRef.current, world, tol);
      const additive = e.shiftKey;
      if (hit !== null) {
        if (!selRef.current.has(hit)) onSelect?.(hit, additive);
        gestureRef.current = { mode: 'move', start: snap(world), moved: false };
      } else {
        if (!additive) onSelect?.(null, false);
        gestureRef.current = { mode: 'box', start: world, additive };
      }
    };

    const onPointerMove = (e: React.PointerEvent): void => {
      const world = worldAt(e.clientX, e.clientY);
      cursorWorldRef.current = world;
      const snapped = snap(world);
      onCursorMove?.(snapped);
      // The crosshair marks where the click will land, i.e. the SNAPPED point,
      // the way GAL draws at m_cursorPosition rather than at the raw pointer.
      const vp = viewRef.current;
      cursorPxRef.current = {
        x: snapped.x * vp.scale + vp.tx,
        y: snapped.y * vp.scale + vp.ty,
      };
      requestDraw();

      // Live end point of an in-flight drawing.
      if (drawingRef.current) onDrawMove?.(snapped);

      // Move mode: live offset.
      if (moveMode && moveModeStartRef.current) {
        moveDeltaRef.current = {
          x: snapped.x - moveModeStartRef.current.x,
          y: snapped.y - moveModeStartRef.current.y,
        };
        requestDraw();
      }

      // Delete picker: brighten the hovered item.
      if (activeTool === 'dsDelete') {
        // InteractiveDelete's motion handler (pl_edit_tool.cpp:414, :443).
        const tol = thresholdToWorld(DELETE_THRESHOLD_PX, viewRef.current.scale, dpr);
        const hit = pickDrawItem(drawsRef.current, world, tol);
        if (brightenedRef.current !== hit) {
          brightenedRef.current = hit;
          onDeleteHover?.(hit);
          requestDraw();
        }
      } else if (brightenedRef.current !== null) {
        brightenedRef.current = null;
        onDeleteHover?.(null);
        requestDraw();
      }

      const g = gestureRef.current;
      if (!g) return;
      if (g.mode === 'pan') {
        const v = viewRef.current;
        v.tx += (e.clientX - g.last.x) * dpr;
        v.ty += (e.clientY - g.last.y) * dpr;
        g.last = { x: e.clientX, y: e.clientY };
        requestDraw();
      } else if (g.mode === 'dragzoom') {
        // DRAG_ZOOMING (`wx_view_controls.cpp:363-405`), through the same
        // pl_editor scale clamp the wheel goes through.
        const v = viewRef.current;
        const f = dragZoomScale(g.last.y - e.clientY, commonInputPrefs());
        const wx = (g.anchor.x - v.tx) / v.scale;
        const wy = (g.anchor.y - v.ty) / v.scale;
        v.scale = clampViewScale(v.scale * f, 'pl_editor', dpr, SCH_IU_PER_MM);
        v.tx = g.anchor.x - wx * v.scale;
        v.ty = g.anchor.y - wy * v.scale;
        g.last = { x: e.clientX, y: e.clientY };
        requestDraw();
      } else if (g.mode === 'box' || g.mode === 'zoom') {
        boxRef.current = { a: g.start, b: world };
        requestDraw();
      } else if (g.mode === 'point') {
        onPointDrag?.(g.index, snapped);
      } else {
        moveDeltaRef.current = { x: snapped.x - g.start.x, y: snapped.y - g.start.y };
        g.moved = true;
        requestDraw();
      }
    };

    const onPointerUp = (e: React.PointerEvent): void => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g) return;
      if (g.mode === 'zoom') {
        const b = boxRef.current;
        boxRef.current = null;
        zoomToRegion(b, g.out);
        // The tool STAYS ARMED. `selectRegion()` returns `cancelled`, and a
        // zoom that completed sets it false:
        //
        //     bool cancelled = false;
        //     ... if( evt->IsCancelInteractive() || evt->IsActivate() )
        //             cancelled = true;
        //     ... view->SetScale( scale ); view->SetCenter( ... ); break;
        //     return cancelled;                    (zoom_tool.cpp:78-160)
        //
        // so `if( selectRegion() ) break;` in `Main` breaks only when the user
        // ESCAPED or picked another tool. Otherwise the outer `while( Wait() )`
        // goes round again and re-arms the ZOOM_IN cursor, and you can zoom
        // repeatedly without re-picking the tool.
        //
        // This used to clear the tool here, and said in its own comment that
        // upstream did. A zero-size box does not end it either: upstream
        // `break`s before the zoom arithmetic, still with `cancelled` false.
        requestDraw();
      } else if (g.mode === 'box') {
        const b = boxRef.current;
        boxRef.current = null;
        if (b) {
          const srcs = wksItemsInBox(drawsRef.current, b.a.x, b.a.y, b.b.x, b.b.y);
          if (srcs.length > 0) onSelectBox?.(srcs, g.additive);
        }
        requestDraw();
      } else if (g.mode === 'point') {
        onPointDragEnd?.();
      } else if (g.mode === 'move') {
        const d = moveDeltaRef.current;
        moveDeltaRef.current = null;
        if (g.moved && d && (d.x !== 0 || d.y !== 0)) onMoveItems?.(d);
        else if (!g.moved) {
          const world = worldAt(e.clientX, e.clientY);
          // SelectPoint (pl_selection_tool.cpp:44).
          const tol = thresholdToWorld(SELECT_THRESHOLD_PX, viewRef.current.scale, dpr);
          const hit = pickDrawItem(drawsRef.current, world, tol);
          if (hit !== null && !e.shiftKey) onSelect?.(hit, false);
        }
        requestDraw();
      }
    };

    // Clear the in-flight drawing marker when the tool changes.
    useEffect(() => {
      drawingRef.current = false;
      requestDraw();
    }, [activeTool, requestDraw]);

    const placing = TWO_CLICK.has(activeTool) || ONE_CLICK.has(activeTool);
    /*
     * The pointer, per KiCad's own setCursor lambdas. Note the idle case:
     * PL_SELECTION_TOOL::Main falls through to KICURSOR::ARROW
     * (pl_selection_tool.cpp:209), so the selection tool shows the ordinary
     * pointer. Ours showed a `crosshair`, which doubled up with the crosshair
     * the canvas already DRAWS at the cursor — KiCad draws that mark itself and
     * leaves the system pointer an arrow, so we had two crosshairs at once.
     *
     * The placing tools are not all the same either
     * (pl_drawing_tools.cpp:83-99): text takes KICURSOR::TEXT, placeImage takes
     * KICURSOR::ARROW, and only the rest take KICURSOR::PENCIL.
     */
    const cursor =
      activeTool === 'zoomTool'
        ? kiCursor('ZOOM_IN')
        : activeTool === 'dsDelete'
          ? // PL_EDIT_TOOL's delete picker: `picker->SetCursor( KICURSOR::REMOVE )`
            // (pl_edit_tool.cpp:424).
            kiCursor('REMOVE')
          : activeTool === 'dsAddText'
            ? // KICURSOR::TEXT (pl_drawing_tools.cpp:90) — KiCad's own I-beam
              // art, not the browser's `text`, which is a different glyph.
              kiCursor('TEXT')
            : activeTool === 'dsAddBitmap'
              ? 'default'
              : placing
                ? kiCursor('PENCIL')
                : moveMode
                  ? // KICURSOR::MOVING (pl_edit_tool.cpp:158).
                    kiCursor('MOVING')
                  : 'default';
    return (
      <div
        className="ze-canvas-wrap"
        ref={wrapRef}
        style={{ position: 'relative', flex: 1, minWidth: 0 }}
      >
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(e) => {
            e.preventDefault();
            // BUT_RIGHT is the zoom-out drag while ZOOM_TOOL is armed
            // (zoom_tool.cpp:62-95), so the selection tool's menu is not what
            // that button means and no menu opens.
            if (activeTool === 'zoomTool') return;
            const world = worldAt(e.clientX, e.clientY);
            // SelectPoint for the hover selection a right-click makes (pl_selection_tool.cpp:125-128, :44).
            const tol = thresholdToWorld(SELECT_THRESHOLD_PX, viewRef.current.scale, dpr);
            onContextMenuRequest?.(
              e.clientX,
              e.clientY,
              pickDrawItem(drawsRef.current, world, tol),
            );
          }}
          // `WX_VIEW_CONTROLS::onLeave` is `onMotion( aEvent )` and nothing
          // else (`common/view/wx_view_controls.cpp:625-630`): leaving the
          // canvas is one more motion, so the cursor keeps its last position,
          // the crosshair stays drawn at the edge and the status bar keeps
          // showing those coordinates. KiCad's crosshair is the TOOL cursor
          // held by VIEW_CONTROLS, not the mouse pointer, so there is nothing
          // to clear when the pointer goes away.
        />
        {/* The sheet. Takes no pointer events, so every capture still lands on
            the canvas underneath — the hit testing, the drag handling and the
            context menu are all unchanged by this layer existing. */}
        {GL_RENDERER && (
          <canvas
            ref={glCanvasRef}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          />
        )}
        {/* Above the sheet: the selection boxes, the point-editor handles and
            the crosshair — pl_editor's overlay target. */}
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
