// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor drawing canvas, the PCB_DRAW_PANEL_GAL of KiCad's
 * `FOOTPRINT_EDIT_FRAME`, ported to Canvas 2D. It reuses the board painter
 * (renderBoard.ts) unchanged by wrapping the edited footprint as a one-item
 * BOARD (footprintToBoard), exactly as pcbnew edits a footprint on an internal
 * board. Same crisp off-screen raster + delta-blit strategy as PcbEditor, and a
 * controller (zoomToFit/zoomIn/zoomOut/redraw) exposed via ref like SymbolCanvas.
 */

import type { Vec2 } from '@ziroeda/kimath';
import { PCB_IU_PER_MM } from '@ziroeda/common';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  commonInputPrefs,
  wheelAction,
  zoomFitView,
  type FitFrame,
} from '../../ui/view_controls.js';
import { drawCrosshair, drawGrid } from '../../ui/grid_cursor.js';
import { kiCursor } from '../../ui/kicursors.js';
import { clampViewScale } from '../../ui/zoom_settings.js';
import {
  SELECTION_AREA_FILL,
  SELECTION_AREA_STROKE,
  zoomAreaTarget,
  type ZoomArea,
} from '../../ui/zoom_tool.js';
import { hitTestFootprint } from '@ziroeda/pcbnew';
import { itemsInBox, fpItemBBox, type PcbFootprint } from '@ziroeda/pcbnew';
import {
  buildScene,
  buildDrawSteps,
  DEFAULT_DRAW_OPTIONS,
  type BoardScene,
  type PcbDrawOptions,
} from '../pcb/renderBoard.js';
import { PCB_BACKGROUND, PCB_CURSOR } from '../pcb/pcbTheme.js';
import { footprintToBoard } from './footprintBoard.js';
import { pcbGridOptions, PCB_DEFAULT_GRID_IU } from '../pcb/renderBoard.js';
import { snapToGridSize } from '../pcb/pcb_grid.js';

const MM = 10000;

export interface FootprintCanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  redraw: () => void;
  /** `VIEW::SetScale`, keeping the viewport centre — what the zoom selector
   *  box dispatches (`COMMON_TOOLS::doZoomToPreset`). */
  setScale: (scale: number) => void;
  /** `VIEW::SetCenter( bBox.Centre() )` with the scale left alone —
   *  `ACTIONS::centerContents`, the branch `updateView` takes when automatic
   *  zoom is off (`cvpcb/display_footprints_frame.cpp:430-433`). */
  centerContents: () => void;
}

export interface FootprintCanvasProps {
  footprint: PcbFootprint | null;
  /** Visible board layers (Appearance panel). */
  visible: ReadonlySet<string>;
  drawOpts?: PcbDrawOptions;
  /** Currently selected item ids (PCB_SELECTION_TOOL). */
  selection?: ReadonlySet<string>;
  /** Active right-toolbar tool (`selectSetRect` enables picking/box/move).
   *
   *  The id is `ACTIONS::selectSetRect`'s upstream action name, the one the PCB
   *  editor already uses for the same button. Note upstream splits what we
   *  conflate: `ACTIONS::selectionTool` does the picking and is always running,
   *  while selectSetRect/selectSetLasso only choose the drag SHAPE. Ours gates
   *  picking on the mode, which is a separate gap from the naming. */
  activeTool?: string;
  /** ACTIONS::toggleGrid. */
  showGrid?: boolean;
  /** Grid size in IU (GAL m_gridSize). A library footprint has no board, so
   *  there is no grid origin: FOOTPRINT_EDIT_FRAME leaves it at (0, 0). */
  gridIU?: number;
  onCursorMove?: (p: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /** Click/box selection results (additive when Shift is held). */
  onSelect?: (id: string | null, additive: boolean) => void;
  onSelectBox?: (ids: string[], additive: boolean) => void;
  /** A committed drag-move of the current selection (world-unit delta). */
  onMoveItems?: (delta: Vec2) => void;
  /** A click while a placement tool is active (e.g. Add Pad), in world units. */
  onPlace?: (pos: Vec2) => void;
  /**
   * A zoom-area drag committed, so `ZOOM_TOOL` is finished.
   *
   * `ZOOM_TOOL::Main` is `if( selectRegion() ) break;` (`zoom_tool.cpp:84-88`)
   * followed by `PopTool` — the tool is ONE-SHOT: framing a rectangle ends it
   * and the frame returns to the tool that was running before. The canvas owns
   * the drag but not the frame's tool state, so it reports the commit here.
   */
  onZoomAreaApplied?: () => void;
  /** Double-click an item (open its properties). */
  onEditItem?: (id: string) => void;
  /** Rubber-band preview for a 2-click graphic being drawn (from `start` to cursor). */
  preview?: { tool: string; start: Vec2 } | null;
  /**
   * Which frame is fitting, for `doZoomFit`'s `margin_scale_factor`
   * (`common/tool/common_tools.cpp:381-401`). The footprint EDITOR gets the
   * library-editor margin of 1.48; CVPCB's viewer, which draws through this
   * same panel, is not one of the four frame types that branch names and gets
   * the default 1.04. Hardcoding 'footprint_editor' here is what made this
   * canvas unusable for any other frame.
   */
  fitFrame?: FitFrame;
  /**
   * What to run when a different footprint is loaded. Default: zoom to fit,
   * which is `FOOTPRINT_EDIT_FRAME`'s behaviour. CVPCB's viewer passes its
   * own so it can honour `footprint_viewer.autozoom`.
   */
  onFootprintChange?: () => void;
}

const EMPTY_SEL: ReadonlySet<string> = new Set();

export const FootprintCanvas = forwardRef<FootprintCanvasController, FootprintCanvasProps>(
  function FootprintCanvas(
    {
      footprint,
      visible,
      drawOpts = DEFAULT_DRAW_OPTIONS,
      selection = EMPTY_SEL,
      activeTool = 'selectSetRect',
      showGrid = true,
      gridIU = PCB_DEFAULT_GRID_IU,
      onCursorMove,
      onScaleChange,
      onSelect,
      onSelectBox,
      onMoveItems,
      onPlace,
      onZoomAreaApplied,
      onEditItem,
      preview = null,
      fitFrame = 'footprint_editor',
      onFootprintChange,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0 });
    const sceneRef = useRef<BoardScene | null>(null);
    const rafRef = useRef(0);
    const [, setScale] = useState(0);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Live-gesture state (mutable, read by draw()'s overlay pass; no re-render).
    const moveDeltaRef = useRef<Vec2 | null>(null);
    const boxRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
    /** `ZOOM_TOOL`'s rubber band, which is a different item from the selection
     *  box above: `KIGFX::PREVIEW::SELECTION_AREA` in its default (non-additive)
     *  colours, not the marquee's blue/green. */
    const zoomBoxRef = useRef<ZoomArea | null>(null);
    const fpForDrawRef = useRef<PcbFootprint | null>(footprint);
    fpForDrawRef.current = footprint;
    const selForDrawRef = useRef<ReadonlySet<string>>(selection);
    selForDrawRef.current = selection;
    const previewRef = useRef(preview);
    previewRef.current = preview;
    const cursorWorldRef = useRef<Vec2 | null>(null);
    const showGridRef = useRef(showGrid);
    showGridRef.current = showGrid;
    const gridIURef = useRef(gridIU);
    gridIURef.current = gridIU;
    const activeToolRef = useRef(activeTool);
    activeToolRef.current = activeTool;
    /** GRID_HELPER::BestSnapAnchor, reduced to the plain grid: a footprint has
     *  no board grid origin, so it rounds about (0, 0). */
    const snapRef = useRef((p: Vec2): Vec2 => p);
    snapRef.current = (p: Vec2): Vec2 => (showGrid ? snapToGridSize(p, gridIU, { x: 0, y: 0 }) : p);

    // Compile the footprint (wrapped as a board) into retained per-layer paths.
    const scene = useMemo(() => buildScene(footprintToBoard(footprint)), [footprint]);
    sceneRef.current = scene;

    // ----- crisp off-screen raster, blitted with a delta transform each frame ---
    const cacheRef = useRef<{
      canvas: HTMLCanvasElement;
      view: { scale: number; tx: number; ty: number };
    } | null>(null);
    const renderingRef = useRef(false);
    const viewChangedRef = useRef(true);

    const viewMatchesCache = useCallback((): boolean => {
      const c = cacheRef.current;
      const v = viewRef.current;
      const canvas = canvasRef.current;
      return (
        !!c &&
        !!canvas &&
        c.view.scale === v.scale &&
        c.view.tx === v.tx &&
        c.view.ty === v.ty &&
        c.canvas.width === canvas.width &&
        c.canvas.height === canvas.height
      );
    }, []);

    const startCrispRender = useCallback(() => {
      if (renderingRef.current) return;
      const canvas = canvasRef.current;
      const scn = sceneRef.current;
      if (!canvas || !scn || canvas.width < 2) return;
      if (viewMatchesCache()) {
        viewChangedRef.current = false;
        return;
      }
      renderingRef.current = true;
      viewChangedRef.current = false;
      const work = document.createElement('canvas');
      work.width = canvas.width;
      work.height = canvas.height;
      const cctx = work.getContext('2d');
      if (!cctx) {
        renderingRef.current = false;
        return;
      }
      const jobView = { ...viewRef.current };
      // No drawing sheet in the footprint editor (a library footprint has no page).
      const steps = buildDrawSteps(cctx, scn, jobView, visible, work.width, work.height, {
        ...drawOpts,
        drawingSheet: false,
      });
      let i = 0;
      const run = (): void => {
        const t0 = performance.now();
        while (i < steps.length && performance.now() - t0 < 12) steps[i++]!();
        if (i < steps.length) {
          requestAnimationFrame(run);
        } else {
          cacheRef.current = { canvas: work, view: jobView };
          renderingRef.current = false;
          requestDraw();
          if (viewChangedRef.current || !viewMatchesCache()) startCrispRender();
        }
      };
      run();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, drawOpts, viewMatchesCache]);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !sceneRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;
      if (!viewMatchesCache()) {
        viewChangedRef.current = true;
        startCrispRender();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PCB_BACKGROUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // GAL::DrawGrid, behind the board raster (GRID_DEPTH) and painted at the
      // live view each frame so it stays crisp through a pan or zoom. The
      // raster's background is transparent, so it shows through. The footprint
      // editor reads LAYER_GRID, the same layer pcbnew does
      // (footprint_editor_utils.cpp:269).
      drawGrid(
        ctx,
        v,
        canvas.width,
        canvas.height,
        pcbGridOptions({
          show: showGridRef.current,
          sizeIU: gridIURef.current,
          color: drawOpts.theme?.grid,
          devicePixelRatio: dpr,
        }),
      );
      const c = cacheRef.current;
      if (c) {
        const k = v.scale / c.view.scale;
        ctx.setTransform(k, 0, 0, k, v.tx - c.view.tx * k, v.ty - c.view.ty * k);
        ctx.imageSmoothingEnabled = k < 1;
        ctx.drawImage(c.canvas, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // ----- selection + gesture overlay (device-pixel space) -----------------
      const fp = fpForDrawRef.current;
      const sel = selForDrawRef.current;
      const md = moveDeltaRef.current;
      const toPx = (p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });
      if (fp && sel.size > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        const ox = md ? md.x : 0,
          oy = md ? md.y : 0;
        for (const id of sel) {
          const b = fpItemBBox(fp, id);
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
      const box = boxRef.current;
      if (box) {
        const p0 = toPx(box.a),
          p1 = toPx(box.b);
        // KiCad tints the marquee blue (l→r) or green (r→l window select).
        const rightward = box.b.x >= box.a.x;
        ctx.strokeStyle = rightward ? 'rgba(120,170,255,0.9)' : 'rgba(120,255,150,0.9)';
        ctx.fillStyle = rightward ? 'rgba(120,170,255,0.12)' : 'rgba(120,255,150,0.12)';
        ctx.lineWidth = dpr;
        const x = Math.min(p0.x, p1.x),
          y = Math.min(p0.y, p1.y);
        const w = Math.abs(p1.x - p0.x),
          h = Math.abs(p1.y - p0.y);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      // `ZOOM_TOOL::selectRegion` puts a SELECTION_AREA on the view while the
      // drag is live (`common/tool/zoom_tool.cpp:106-107`). A default-constructed
      // one carries no additive/subtractive flag, so it is `normal` over
      // `outline_l2r` — the blue/yellow pair in ui/zoom_tool.ts, not the
      // marquee's colours above.
      const zb = zoomBoxRef.current;
      if (zb) {
        const p0 = toPx(zb.a),
          p1 = toPx(zb.b);
        ctx.fillStyle = SELECTION_AREA_FILL;
        ctx.strokeStyle = SELECTION_AREA_STROKE;
        ctx.lineWidth = dpr;
        const x = Math.min(p0.x, p1.x),
          y = Math.min(p0.y, p1.y);
        const w = Math.abs(p1.x - p0.x),
          h = Math.abs(p1.y - p0.y);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      // Rubber-band preview for a graphic being drawn (start → cursor).
      const pv = previewRef.current;
      const cur = cursorWorldRef.current;
      if (pv && cur) {
        const a = toPx(pv.start),
          b = toPx(cur);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        if (pv.tool === 'drawCircle') {
          const r = Math.hypot(b.x - a.x, b.y - a.y);
          ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        } else if (pv.tool === 'drawRectangle') {
          ctx.rect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
          );
        } else {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // GAL::blitCursor at the snapped point, in LAYER_CURSOR (pcb_painter.h:135).
      // The canvas had none: one occurrence of the word "crosshair" in the whole
      // file, and that was a CSS cursor.
      const cw = cursorWorldRef.current;
      if (cw) {
        const at = snapRef.current(cw);
        drawCrosshair(ctx, toPx(at), canvas.width, canvas.height, {
          mode: 'small',
          color: PCB_CURSOR,
          // FOOTPRINT_EDIT_FRAME's drawing tools call ShowCursor(true) through
          // PCB_TOOL_BASE; the selection tool does not, so there the crosshair
          // is the dimmed forced one.
          toolWantsCursor: activeToolRef.current !== 'selectSetRect',
          alwaysShow: true,
          devicePixelRatio: dpr,
        });
      }

      setScale(v.scale);
      onScaleChange?.(v.scale);
    }, [startCrispRender, viewMatchesCache, onScaleChange, drawOpts, dpr]);

    const requestDraw = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    // Invalidate the raster when the compiled scene, layers or options change.
    useEffect(() => {
      cacheRef.current = null;
      requestDraw();
    }, [scene, visible, drawOpts, requestDraw]);

    // The selection only affects the overlay, not the raster, just repaint.
    useEffect(() => {
      requestDraw();
    }, [selection, requestDraw]);

    const zoomToFit = useCallback(() => {
      const canvas = canvasRef.current;
      const scn = sceneRef.current;
      if (!canvas) return;
      // A footprint with no geometry (a brand-new one): centre on the origin.
      const bbox = scn?.bbox ?? { minX: -5 * MM, minY: -5 * MM, maxX: 5 * MM, maxY: 5 * MM };
      // `margin_scale_factor` is per FRAME TYPE (common_tools.cpp:381-401):
      // 1.48 for FRAME_FOOTPRINT_EDITOR, which leaves the library editors more
      // slack than the board editor, and the default 1.04 for CVPCB's viewer,
      // which that branch does not name. That is why the frame says which it
      // is instead of this canvas assuming.
      const v = zoomFitView(bbox, { width: canvas.width, height: canvas.height }, fitFrame);
      viewRef.current = v ?? { scale: 0.02, tx: canvas.width / 2, ty: canvas.height / 2 };
      requestDraw();
    }, [requestDraw, fitFrame]);

    const zoomStep = useCallback(
      (factor: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const v = viewRef.current;
        const px = canvas.width / 2;
        const py = canvas.height / 2;
        const wx = (px - v.tx) / v.scale;
        const wy = (py - v.ty) / v.scale;
        v.scale *= factor;
        v.tx = px - wx * v.scale;
        v.ty = py - wy * v.scale;
        requestDraw();
      },
      [requestDraw],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomToFit,
        zoomIn: () => zoomStep(1.3),
        zoomOut: () => zoomStep(1 / 1.3),
        redraw: () => {
          cacheRef.current = null;
          requestDraw();
        },
        setScale: (scale: number) => {
          const canvas = canvasRef.current;
          if (!canvas || !(scale > 0)) return;
          zoomStep(scale / viewRef.current.scale);
        },
        centerContents: () => {
          const canvas = canvasRef.current;
          const scn = sceneRef.current;
          if (!canvas || !scn) return;
          const bbox = scn.bbox;
          if (!bbox) return;
          const v = viewRef.current;
          const cx = (bbox.minX + bbox.maxX) / 2;
          const cy = (bbox.minY + bbox.maxY) / 2;
          v.tx = canvas.width / 2 - cx * v.scale;
          v.ty = canvas.height / 2 - cy * v.scale;
          requestDraw();
        },
      }),
      [zoomToFit, zoomStep, requestDraw],
    );

    // Size the canvas to its container (device pixels); fit on first layout.
    const fittedRef = useRef(false);
    useEffect(() => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
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
        } else {
          cacheRef.current = null;
          requestDraw();
        }
      });
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [dpr, requestDraw, zoomToFit]);

    // Re-fit when a different footprint is loaded.
    //
    // `onFootprintChange` is the hook CVPCB's viewer needs: `updateView`
    // (`display_footprints_frame.cpp:427-433`) runs zoomFitScreen OR
    // centerContents on every reload, chosen by `m_FootprintViewerAutoZoomOnSelect`,
    // and only the frame knows which. A canvas that always fits cannot express
    // the second branch.
    const fpRef = useRef(footprint);
    const onFpChangeRef = useRef(onFootprintChange);
    onFpChangeRef.current = onFootprintChange;
    useEffect(() => {
      if (fpRef.current !== footprint) {
        fpRef.current = footprint;
        const handler = onFpChangeRef.current;
        requestAnimationFrame(handler ?? zoomToFit);
      }
    }, [footprint, zoomToFit]);

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
        const px = (e.clientX - rect.left) * dpr;
        const py = (e.clientY - rect.top) * dpr;
        const wx = (px - v.tx) / v.scale;
        const wy = (py - v.ty) / v.scale;
        v.scale *= action.factor;
        v.tx = px - wx * v.scale;
        v.ty = py - wy * v.scale;
        requestDraw();
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [dpr, requestDraw]);

    // Pointer world position (IU) from a client event.
    const worldAt = (clientX: number, clientY: number): Vec2 => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: ((clientX - rect.left) * dpr - v.tx) / v.scale,
        y: ((clientY - rect.top) * dpr - v.ty) / v.scale,
      };
    };

    // A gesture in flight: pan (middle button), or, with the select tool,
    // click-select + box-select on empty space, and drag-move over a selection.
    const gestureRef = useRef<
      | { mode: 'pan'; last: { x: number; y: number } }
      | { mode: 'box'; start: Vec2; additive: boolean }
      | { mode: 'move'; start: Vec2; moved: boolean }
      | { mode: 'place'; start: { x: number; y: number }; moved: boolean }
      | { mode: 'zoom' }
      | null
    >(null);

    /**
     * `ZOOM_TOOL::selectRegion`'s tail, applied to this canvas's viewport.
     *
     * The arithmetic is `zoomAreaTarget`'s and is not restated here — this is
     * only the part that is per-canvas, because each of ours owns its own
     * transform. `VIEW::SetCenter( selectionBox.Centre() )` puts that world
     * point at the middle of the canvas, which for `x*scale + tx` is
     * `tx = width/2 - centre.x*scale`.
     */
    const applyZoomArea = (area: ZoomArea): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const target = zoomAreaTarget(area, {
        scale: v.scale,
        width: canvas.width,
        height: canvas.height,
      });
      // `selectRegion` returns false for a degenerate box, and `Main` then
      // keeps waiting rather than popping the tool — so no commit is reported.
      if (!target) return;
      // `VIEW::SetScale` pins to m_minScale/m_maxScale, so a one-pixel drag
      // cannot send the scale to infinity. This canvas draws a footprint at
      // pcbnew's IU, so it takes pcbnew's row of ZOOM_LIMITS.
      const scale = clampViewScale(target.scale, 'pcbnew', dpr, PCB_IU_PER_MM);
      v.scale = scale;
      v.tx = canvas.width / 2 - target.centre.x * scale;
      v.ty = canvas.height / 2 - target.centre.y * scale;
      viewChangedRef.current = true;
      setScale(scale);
      onScaleChange?.(scale);
      requestDraw();
      onZoomAreaApplied?.();
    };

    const onPointerDown = (e: React.PointerEvent): void => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      // Middle button always pans (right button reserved for context menu later).
      if (e.button === 1) {
        gestureRef.current = { mode: 'pan', last: { x: e.clientX, y: e.clientY } };
        return;
      }
      // `ACTIONS::zoomTool` is AF_ACTIVATE: the button ARMS ZOOM_TOOL, and the
      // drag that follows does the work. Upstream accepts either button —
      // `evt->IsDrag( BUT_LEFT ) || evt->IsDrag( BUT_RIGHT )`
      // (`zoom_tool.cpp:84`) — and branches only at the end, where a right
      // drag zooms OUT by the same ratio. So this runs before the
      // left-button-only guard below.
      if (activeToolRef.current === 'zoomTool' && (e.button === 0 || e.button === 2)) {
        const world = worldAt(e.clientX, e.clientY);
        gestureRef.current = { mode: 'zoom' };
        zoomBoxRef.current = { a: world, b: world, out: e.button === 2 };
        return;
      }
      if (e.button !== 0) return;
      // A placement tool is active: a click drops the item (drag is ignored).
      if (activeTool !== 'selectSetRect') {
        gestureRef.current = { mode: 'place', start: { x: e.clientX, y: e.clientY }, moved: false };
        return;
      }
      const world = worldAt(e.clientX, e.clientY);
      const fp = fpForDrawRef.current;
      const tol = (6 * dpr) / viewRef.current.scale;
      const hit = fp ? hitTestFootprint(fp, world, tol) : null;
      const additive = e.shiftKey;
      if (hit) {
        // Select the hit item (unless already selected) then start a move drag.
        if (!selForDrawRef.current.has(hit)) onSelect?.(hit, additive);
        gestureRef.current = { mode: 'move', start: world, moved: false };
      } else {
        if (!additive) onSelect?.(null, false);
        gestureRef.current = { mode: 'box', start: world, additive };
      }
    };

    const onPointerMove = (e: React.PointerEvent): void => {
      if (canvasRef.current) {
        const w = worldAt(e.clientX, e.clientY);
        cursorWorldRef.current = w;
        onCursorMove?.(w);
        // The crosshair and the rubber band both follow the pointer.
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
      } else if (g.mode === 'box') {
        boxRef.current = { a: g.start, b: worldAt(e.clientX, e.clientY) };
        requestDraw();
      } else if (g.mode === 'zoom') {
        const zb = zoomBoxRef.current;
        if (zb) zoomBoxRef.current = { ...zb, b: worldAt(e.clientX, e.clientY) };
        requestDraw();
      } else if (g.mode === 'place') {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 3) g.moved = true;
      } else {
        // EDIT_TOOL's move follows the snapped crosshair, not the raw pointer
        // (edit_tool_move_fct.cpp: m_cursor = grid.BestSnapAnchor( mousePos )).
        const w = snapRef.current(worldAt(e.clientX, e.clientY));
        const from = snapRef.current(g.start);
        moveDeltaRef.current = { x: w.x - from.x, y: w.y - from.y };
        g.moved = true;
        requestDraw();
      }
    };

    const onPointerUp = (e: React.PointerEvent): void => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g) return;
      if (g.mode === 'place') {
        if (!g.moved) onPlace?.(snapRef.current(worldAt(e.clientX, e.clientY)));
        return;
      }
      if (g.mode === 'zoom') {
        const zb = zoomBoxRef.current;
        zoomBoxRef.current = null;
        // A zero-width or zero-height box leaves the view alone
        // (`zoom_tool.cpp:138-142`) — that is what a click rather than a drag
        // does, and `zoomAreaTarget` returns null for it.
        if (zb) applyZoomArea({ ...zb, b: worldAt(e.clientX, e.clientY) });
        else requestDraw();
        return;
      }
      if (g.mode === 'box') {
        const b = boxRef.current;
        boxRef.current = null;
        if (b) {
          const fp = fpForDrawRef.current;
          const ids = fp ? itemsInBox(fp, b.a.x, b.a.y, b.b.x, b.b.y) : [];
          if (ids.length > 0) onSelectBox?.(ids, g.additive);
        }
        requestDraw();
      } else if (g.mode === 'move') {
        const d = moveDeltaRef.current;
        moveDeltaRef.current = null;
        if (g.moved && d && (d.x !== 0 || d.y !== 0)) onMoveItems?.(d);
        else if (!g.moved) {
          // A plain click on an item: finalise the (non-additive) selection.
          const world = worldAt(e.clientX, e.clientY);
          const fp = fpForDrawRef.current;
          const tol = (6 * dpr) / viewRef.current.scale;
          const hit = fp ? hitTestFootprint(fp, world, tol) : null;
          if (hit && !e.shiftKey) onSelect?.(hit, false);
        }
        requestDraw();
      }
    };

    return (
      <div className="ze-canvas-wrap" ref={wrapRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            // `ZOOM_TOOL::Main`'s setCursor is
            // `SetCurrentCursor( KICURSOR::ZOOM_IN )` (`zoom_tool.cpp:65-69`)
            // — KiCad's own art, not the browser's `zoom-in`.
            cursor:
              activeTool === 'zoomTool'
                ? kiCursor('ZOOM_IN')
                : activeTool === 'selectSetRect'
                  ? 'default'
                  : 'crosshair',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(e) => {
            // BUT_RIGHT is the zoom-OUT drag while ZOOM_TOOL is armed
            // (`zoom_tool.cpp:82`), so that button does not mean "menu" here.
            if (activeToolRef.current === 'zoomTool') e.preventDefault();
          }}
          onDoubleClick={(e) => {
            const fp = fpForDrawRef.current;
            if (!fp || !onEditItem) return;
            const w = worldAt(e.clientX, e.clientY);
            const hit = hitTestFootprint(fp, w, (6 * dpr) / viewRef.current.scale);
            if (hit) onEditItem(hit);
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
