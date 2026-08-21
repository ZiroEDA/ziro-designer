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
  DS_BG_COLOR,
  DS_BG_COLOR_DARK,
  DS_CURSOR_COLOR_ON_DARK,
  DS_CURSOR_COLOR_ON_LIGHT,
  DS_GRID_COLOR_ON_DARK,
  DS_GRID_COLOR_ON_LIGHT,
  DS_PAGE_BORDER_COLOR,
  DS_EDIT_POINT_ON_DARK,
  DS_EDIT_POINT_ON_LIGHT,
  DS_MARQUEE,
  DS_SELECTED_COLOR,
} from './wksRender.js';
import { setBitmapInvalidate } from './wksBitmap.js';
import { commonInputPrefs, wheelAction, zoomFitView } from '../../ui/view_controls.js';
import { clampViewScale } from '../../ui/zoom_settings.js';
import { drawCrosshair, drawGrid } from '../../ui/grid_cursor.js';
import { scaleForZoomFactor, zoomFactorForScale } from '../../ui/status_format.js';
import { ZOOM_LIST, nextZoomPreset } from '../../ui/zoom_settings.js';

/*
 * The drawing tools' pencil (KICURSOR::PENCIL) and the interactive delete
 * picker's cross (KICURSOR::REMOVE).
 *
 * [art] KiCad ships both as 32x32 XPMs - `resources/bitmaps_png/cursors/
 * cursor-pencil.xpm` and `cursor-eraser.xpm`, mapped at `common/gal/cursors.cpp`
 * :137-141 and :185-190 - so there is no vector to copy, only a PALETTE. Both
 * XPMs declare exactly three colours: `None`, `#FFFFFF` and `#000000`. A KiCad
 * cursor is a white shape with a black outline and nothing else, on every
 * frame, so it stays legible over any canvas colour.
 *
 * Ours were a yellow-and-red pencil (`#ffd54a` / `#c8322d` / `#1b1b1b`) and a
 * red cross (`#e33`) - three invented hues where upstream has two absolutes.
 * The geometry below is still ours, because an XPM bitmap gives no path; the
 * ink is KiCad's.
 *
 * The hotspots are upstream's too: pencil { 4, 27 } and eraser { 4, 4 } in the
 * 32x32 art, i.e. { 3, 20 } and { 3, 3 } scaled to our 24x24.
 */
const CURSOR_INK = '#ffffff'; // [art] XPM colour `.`
const CURSOR_EDGE = '#000000'; // [art] XPM colour `+`
const PENCIL_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  `<path d='M3.5 20.5l3.2-1 11-11-2.2-2.2-11 11z' fill='${CURSOR_INK}' stroke='${CURSOR_EDGE}' stroke-width='1'/>` +
  `<path d='M14.8 5.1l2.2 2.2 1.9-1.9a1.3 1.3 0 0 0 0-1.9l-.3-.3a1.3 1.3 0 0 0-1.9 0z' fill='${CURSOR_INK}' stroke='${CURSOR_EDGE}' stroke-width='1'/>` +
  `<path d='M3.5 20.5l1.1-2.9 1.8 1.1z' fill='${CURSOR_EDGE}'/></svg>`;
const PENCIL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PENCIL_SVG)}") 3 20, crosshair`;
const REMOVE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  `<path d='M5 5l14 14M19 5L5 19' stroke='${CURSOR_EDGE}' stroke-width='4' stroke-linecap='round'/>` +
  `<path d='M5 5l14 14M19 5L5 19' stroke='${CURSOR_INK}' stroke-width='2' stroke-linecap='round'/></svg>`;
const REMOVE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(REMOVE_SVG)}") 3 3, not-allowed`;

export interface DrawingSheetCanvasController {
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
  /** Draw a full-window crosshair at the cursor. */
  fullCrosshair?: boolean;
  /** Dark canvas background (display option `black_background`). */
  blackBackground?: boolean;
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
  /** The active tool finished and handed back to the arrow (PopTool). */
  onToolDone?: () => void;
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
      fullCrosshair,
      blackBackground,
      editPoints,
      moveMode,
      onCursorMove,
      onScaleChange,
      onContextMenuRequest,
      onSelect,
      onSelectBox,
      onToolDone,
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

    const canvasRef = useRef<HTMLCanvasElement>(null);
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

      const background = blackBackground ? DS_BG_COLOR_DARK : DS_BG_COLOR;
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
      ctx.strokeStyle = DS_PAGE_BORDER_COLOR;
      ctx.lineWidth = worldPen;
      ctx.strokeRect(0, 0, pageW, pageH);

      // Clip page content to the page rectangle.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pageW, pageH);
      ctx.clip();
      // An in-flight move-mode / drag offset shifts the selected items live.
      const md = moveDeltaRef.current;
      if (md && selRef.current.size > 0) {
        const still = drawsRef.current.filter((d) => !selRef.current.has(d.src));
        drawDrawingSheetItems(ctx, still, new Set(), {
          minWidth: worldPen,
          brightened: brightenedRef.current,
        });
        ctx.save();
        ctx.translate(md.x, md.y);
        const moving = drawsRef.current.filter((d) => selRef.current.has(d.src));
        drawDrawingSheetItems(ctx, moving, selRef.current, { minWidth: worldPen });
        ctx.restore();
      } else {
        drawDrawingSheetItems(ctx, drawsRef.current, selRef.current, {
          minWidth: worldPen,
          brightened: brightenedRef.current,
        });
      }
      ctx.restore();

      // ---- overlays (device space) ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const toPx = (p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });

      // Selection outlines (dashed), offset by an in-flight move delta.
      if (selRef.current.size > 0) {
        // [art] pl_editor draws NO outline around a selected item - it repaints
        // the item itself in m_selectedColor, which drawDrawingSheetItems above
        // already does. This dashed box is ours, an affordance a mouse-and-
        // canvas UI needs and a wxWidgets one does not, so it has no upstream
        // metric. It at least borrows the one selection colour rather than
        // inventing a second.
        ctx.strokeStyle = DS_SELECTED_COLOR;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([5 * dpr, 3 * dpr]);
        const ox = md ? md.x : 0,
          oy = md ? md.y : 0;
        for (const src of selRef.current) {
          const b = wksItemBBox(drawsRef.current, src);
          if (!b) continue;
          const p0 = toPx({ x: b.minX + ox, y: b.minY + oy });
          const p1 = toPx({ x: b.maxX + ox, y: b.maxY + oy });
          const pad = 2 * dpr;
          ctx.strokeRect(
            Math.min(p0.x, p1.x) - pad,
            Math.min(p0.y, p1.y) - pad,
            Math.abs(p1.x - p0.x) + 2 * pad,
            Math.abs(p1.y - p0.y) + 2 * pad,
          );
        }
        ctx.setLineDash([]);
      }

      // Point-editor handles (filled squares, EDIT_POINTS style).
      const pts = editPointsRef.current;
      if (pts && pts.length > 0 && !md) {
        // EDIT_POINT::POINT_SIZE is 8 (include/tool/edit_points.h:194) and
        // edit_points.cpp:290 halves it, so the square is 8 across. [data]
        const r = 4 * dpr;
        const handle = darkBg ? DS_EDIT_POINT_ON_DARK : DS_EDIT_POINT_ON_LIGHT;
        for (const p of pts) {
          const c = toPx(p);
          ctx.fillStyle = handle.fill;
          ctx.strokeStyle = handle.border;
          ctx.lineWidth = Math.max(1, dpr);
          ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
          ctx.strokeRect(c.x - r, c.y - r, r * 2, r * 2);
        }
      }

      // Box-select marquee.
      const box = boxRef.current;
      if (box) {
        const p0 = toPx(box.a),
          p1 = toPx(box.b);
        const rightward = box.b.x >= box.a.x;
        const scheme = darkBg ? DS_MARQUEE.onDark : DS_MARQUEE.onLight;
        ctx.strokeStyle = rightward ? scheme.outlineL2R : scheme.outlineR2L;
        ctx.fillStyle = scheme.fill;
        ctx.lineWidth = dpr;
        const x = Math.min(p0.x, p1.x),
          y = Math.min(p0.y, p1.y);
        ctx.fillRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
        ctx.strokeRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
      }

      // GAL::blitCursor, in DS_RENDER_SETTINGS::GetCursorColor
      // (ds_painter.h:77-81). The drawing tools ask for a crosshair; with the
      // selection tool it is there only because always_show_cursor is on, and
      // a forced cursor is dimmed.
      drawCrosshair(ctx, cursorPxRef.current, canvas.width, canvas.height, {
        mode: fullCrosshair ? 'full' : 'small',
        color: darkBg ? DS_CURSOR_COLOR_ON_DARK : DS_CURSOR_COLOR_ON_LIGHT,
        toolWantsCursor: activeTool !== 'select',
        alwaysShow: true,
        devicePixelRatio: dpr,
      });

      setScaleState(v.scale);
      onScaleChange?.(v.scale);
    }, [
      pageW,
      pageH,
      showGrid,
      gridIU,
      dpr,
      activeTool,
      fullCrosshair,
      blackBackground,
      onScaleChange,
    ]);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

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
    useEffect(() => {
      const wrap = wrapRef.current,
        canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const ro = new ResizeObserver(() => {
        const r = wrap.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(r.width * dpr));
        canvas.height = Math.max(1, Math.round(r.height * dpr));
        canvas.style.width = `${r.width}px`;
        canvas.style.height = `${r.height}px`;
        if (!fittedRef.current) {
          fittedRef.current = true;
          zoomToFit();
        } else requestDraw();
      });
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [dpr, requestDraw, zoomToFit]);

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
      const tol = (6 * dpr) / viewRef.current.scale;
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(pts[i]!.x - world.x) <= tol && Math.abs(pts[i]!.y - world.y) <= tol) return i;
      }
      return null;
    };

    const onPointerDown = (e: React.PointerEvent): void => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const world = worldAt(e.clientX, e.clientY);

      // Middle button always pans.
      if (e.button === 1) {
        gestureRef.current = { mode: 'pan', last: { x: e.clientX, y: e.clientY } };
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
        const tol = (6 * dpr) / viewRef.current.scale;
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
      const tol = (6 * dpr) / viewRef.current.scale;
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
        const tol = (6 * dpr) / viewRef.current.scale;
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
        // selectRegion() returns after ONE region and Main breaks out of its
        // loop, so the tool hands back to the arrow rather than staying armed.
        onToolDone?.();
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
          const tol = (6 * dpr) / viewRef.current.scale;
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
        ? 'zoom-in'
        : activeTool === 'dsDelete'
          ? REMOVE_CURSOR
          : activeTool === 'dsAddText'
            ? 'text'
            : activeTool === 'dsAddBitmap'
              ? 'default'
              : placing
                ? PENCIL_CURSOR
                : moveMode
                  ? 'move'
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
            const tol = (6 * dpr) / viewRef.current.scale;
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
      </div>
    );
  },
);
