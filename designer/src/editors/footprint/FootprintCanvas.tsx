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
  dragGesture,
  dragZoomScale,
  makeMotionPan,
  makeZoomController,
  wheelAction,
  zoomFitView,
  type FitFrame,
} from '../../ui/view_controls.js';
import { type CrosshairMode, drawCrosshair, drawGrid } from '../../ui/grid_cursor.js';
import { kiCursor } from '../../ui/kicursors.js';
import { clampViewScale } from '../../ui/zoom_settings.js';
import {
  SELECTION_AREA_FILL,
  SELECTION_AREA_STROKE,
  zoomAreaTarget,
  type ZoomArea,
} from '../../ui/zoom_tool.js';
import {
  constantGlyphHeightPx,
  constantLinePitchPx,
  constantStrokeWidthPx,
  rulerLineWidthPx,
  tickLineWidthPx,
  rulerDimensionStrings,
  rulerEnd,
  rulerTicks,
  type RulerPoint,
  type RulerUnits,
} from '../../ui/ruler_item.js';
import { hitTestFootprint } from '@ziroeda/pcbnew';
import { itemsInBox, fpItemBBox, type PcbFootprint } from '@ziroeda/pcbnew';
import {
  buildScene,
  buildDrawSteps,
  drawAnchors,
  DEFAULT_DRAW_OPTIONS,
  type BoardScene,
  type PcbDrawOptions,
} from '../pcb/renderBoard.js';
import { PCB_BACKGROUND, PCB_CURSOR, PCB_GRID_AXES, PCB_SPECIAL } from '../pcb/pcbTheme.js';
import { footprintToBoard } from './footprintBoard.js';
import { pcbGridOptions, PCB_DEFAULT_GRID_IU } from '../pcb/renderBoard.js';
import { snapToGridSize } from '../pcb/pcb_grid.js';

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
  /**
   * `ACTIONS::cursorSmallCrosshairs` / `cursorFullCrosshairs` /
   * `cursor45Crosshairs` — the radio group every EDA_DRAW_FRAME's left toolbar
   * carries. It was hardcoded `'small'` here, so the other two buttons were
   * radio items that changed nothing.
   */
  crosshairMode?: CrosshairMode;
  /**
   * The frame's distance units, for the Measure Tool's labels.
   * `RULER_ITEM` is constructed with `frame()->GetUserUnits()`.
   */
  measureUnits?: RulerUnits;
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
      crosshairMode = 'small',
      measureUnits = 'mm',
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
    /** `WX_VIEW_CONTROLS::m_metaPanning` / `m_metaPanStart`, per canvas. */
    const motionPanRef = useRef(makeMotionPan());
    /**
     * `WX_VIEW_CONTROLS::m_zoomController` — this canvas's own, because upstream
     * each `WX_VIEW_CONTROLS` owns one and the accelerating one has history.
     */
    const zoomCtlRef = useRef(makeZoomController());
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
    /**
     * `TWO_POINT_GEOMETRY_MANAGER` + the RULER_ITEM's visibility.
     *
     * `originSet` is upstream's own flag: the FIRST click sets the origin, the
     * SECOND ends the drag, and the ruler stays on screen after it -- nothing
     * hides it until Esc or the next measurement (`pcb_viewer_tools.cpp:364-382`).
     */
    const rulerRef = useRef<{ origin: RulerPoint; end: RulerPoint; originSet: boolean } | null>(
      null,
    );
    const fpForDrawRef = useRef<PcbFootprint | null>(footprint);
    fpForDrawRef.current = footprint;
    const selForDrawRef = useRef<ReadonlySet<string>>(selection);
    selForDrawRef.current = selection;
    const previewRef = useRef(preview);
    previewRef.current = preview;
    const cursorWorldRef = useRef<Vec2 | null>(null);
    const showGridRef = useRef(showGrid);
    showGridRef.current = showGrid;
    const crosshairModeRef = useRef(crosshairMode);
    crosshairModeRef.current = crosshairMode;
    const measureUnitsRef = useRef(measureUnits);
    measureUnitsRef.current = measureUnits;
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
          // Both frames this canvas serves enable the origin axes:
          // FOOTPRINT_EDIT_FRAME and CVPCB's DISPLAY_FOOTPRINTS_FRAME. The
          // board editor does not, which is why this is stated here rather
          // than in pcbGridOptions' defaults.
          axes: { color: drawOpts.theme?.gridAxes ?? PCB_GRID_AXES },
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

      // `draw( const FOOTPRINT* )`'s LAYER_ANCHOR cross at the footprint
      // origin. It is a per-frame SCREEN-space pass, never part of the retained
      // scene -- 5 px arms at 1 px, "size and width constant, not related to
      // the scale because the anchor is just a marker on screen" -- so it is
      // painted here rather than into the cached raster above, which is blitted
      // under a delta transform and would scale it.
      //
      // Only PcbEditor called this. The footprint editor and CVPCB's viewer
      // draw the same footprints through the same painter and had no component
      // origin at all, which is the marker Akshay pointed out is present
      // everywhere in pcbnew.
      const sc = sceneRef.current;
      if (sc) {
        drawAnchors(
          ctx,
          sc,
          { scale: v.scale, tx: v.tx, ty: v.ty },
          visible,
          canvas.width,
          canvas.height,
          drawOpts,
          'none',
          dpr,
        );
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
      // `KIGFX::PREVIEW::RULER_ITEM`: the main line origin→end, a tick at each
      // end, and the four dimension strings beside the cursor. It is painted in
      // device space because upstream draws it at a constant glyph height and a
      // constant tick length — `GetConstantGlyphHeight` divides by the world
      // scale precisely so the ruler does not grow when you zoom.
      const rl = rulerRef.current;
      if (rl) {
        const a = toPx(rl.origin);
        const b = toPx(rl.end);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // LAYER_AUX_ITEMS, which is what RULER_ITEM strokes with when it
        // carries no colour of its own (ruler_item.cpp:320-323).
        const aux = drawOpts.theme?.special?.auxItems ?? PCB_SPECIAL.auxItems;
        ctx.strokeStyle = aux;
        ctx.fillStyle = aux;
        // `getTickLineWidth( textDims )` = StrokeWidth * 0.8, not a hairline.
        ctx.lineWidth = rulerLineWidthPx(dpr) * dpr;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // An end tick perpendicular to the line at each end.
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 0) {
          const nx = (-(b.y - a.y) / len) * 5 * dpr;
          const ny = ((b.x - a.x) / len) * 5 * dpr;
          ctx.beginPath();
          ctx.moveTo(a.x - nx, a.y - ny);
          ctx.lineTo(a.x + nx, a.y + ny);
          ctx.moveTo(b.x - nx, b.y - ny);
          ctx.lineTo(b.x + nx, b.y + ny);
          ctx.stroke();
        }
        // PCB_IU_PER_MM, asked for rather than restated. This file used to
        // hold `const MM = 10000` -- eeschema's scale -- in a PCB canvas, and
        // it read 9.83 mm as 983.370 mm. Every other pcbnew module writes
        // `const MM = PCB_IU_PER_MM`; this one was the exception.
        // `drawTicksAlongLine`: a tick every `tickSpace` along the line,
        // perpendicular to it, with the value on major and mid ones. All the
        // sizes are screen sizes upstream (`5.0 / GetWorldScale()`), so they are
        // device px here and the ruler does not grow with zoom.
        const dxw = rl.end.x - rl.origin.x;
        const dyw = rl.end.y - rl.origin.y;
        const lenIU = Math.hypot(dxw, dyw);
        if (lenIU > 0) {
          const ux = dxw / lenIU;
          const uy = dyw / lenIU;
          // `VECTOR2D tickLine = aLine; RotatePoint( tickLine, ANGLE_90 );`
          // KiCad's ANGLE_90 turns (x, y) into (y, -x), which on a Y-down
          // canvas points to the side the graduations and their numbers sit on.
          // Negating it instead put both on the wrong side of the line.
          const px = uy;
          const py = -ux;
          const ticks = rulerTicks(lenIU, v.scale, PCB_IU_PER_MM, measureUnitsRef.current);
          // KiCad's GlyphSize is the stroke font's glyph HEIGHT; CSS
          // font-size is the em box, which is larger. Measure the face's own
          // cap height once and solve for the size that yields the height
          // upstream asks for, rather than guessing a ratio.
          const tickFont = cssSizeForGlyphHeight(ctx, constantGlyphHeightPx(dpr, -1) * dpr);
          // `labelOffset = tickLine.Resize( majorTickLen )`, where
          // drawTicksAlongLine's majorTickLen is minor * (2.5 + 1).
          const labelOff = 5 * 3.5 * dpr;
          ctx.font = `${tickFont}px ui-monospace, monospace`;
          ctx.textBaseline = 'middle';
          // `labelAngle = -EDA_ANGLE( tickLine )`: the numbers run along the
          // TICK, not along the ruler — which is why upstream's read
          // bottom-to-top beside a roughly horizontal measurement. Rotating
          // them along the line instead is what drew ours mirrored.
          //
          // The two `m_Halign` branches are the same rule stated in KiCad's
          // angle convention: keep the text right-reading. A baseline pointing
          // into the left half-plane is upside down, so it turns through 180
          // and anchors from the other end.
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
            const wx = rl.origin.x + ux * t.distIU;
            const wy = rl.origin.y + uy * t.distIU;
            const p = toPx({ x: wx, y: wy });
            if (p.x < -50 || p.x > canvas.width + 50 || p.y < -50 || p.y > canvas.height + 50)
              continue;
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
        const lines = rulerDimensionStrings(
          rl.origin,
          rl.end,
          PCB_IU_PER_MM,
          measureUnitsRef.current,
        );
        // `DrawTextNextToCursor`'s 15 px offset, and the quadrant it prefers:
        // away from the origin, so the labels never sit on the ruler
        // (ruler_item.cpp:342-343, 363).
        const offX = 15 * dpr;
        // `DrawTextNextToCursor` at GetConstantGlyphHeight()'s size and pitch —
        // sizes[3] = 14 / hdpiSizes[3] = 11, times linePitchFactor 1.9 / 1.7.
        const pitch = constantLinePitchPx(dpr) * dpr;
        const sx = rl.end.y < rl.origin.y ? -1 : 1;
        const sy = rl.end.x < rl.origin.x ? 1 : -1;
        ctx.font = `${cssSizeForGlyphHeight(ctx, constantGlyphHeightPx(dpr) * dpr)}px ui-monospace, monospace`;
        ctx.textAlign = sx < 0 ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        // The quadrant only decides where the BLOCK sits; the lines inside it
        // stay in GetDimensionStrings' order — x, y, r, θ, top to bottom.
        // Stacking them along `sy` reversed them whenever the block went up.
        const x0 = b.x + sx * offX;
        const top = sy < 0 ? b.y - offX - (lines.length - 1) * pitch : b.y + offX;
        // A stroke font at thicknessFactor 0.2 reads bold; fill plus a stroke
        // of the same width is that weight on a 2D context.
        ctx.lineWidth = constantStrokeWidthPx(dpr) * dpr * 0.5;
        ctx.lineJoin = 'round';
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i]!, x0, top + i * pitch);
          ctx.strokeText(lines[i]!, x0, top + i * pitch);
        }
        ctx.restore();
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
          mode: crosshairModeRef.current,
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
      // The same constant, and the same bug: at 10000 this asked for a 0.1 mm
      // box rather than a 10 mm one, which is why an empty viewer opened at
      // Zoom 1484.
      const bbox = scn?.bbox ?? {
        minX: -5 * PCB_IU_PER_MM,
        minY: -5 * PCB_IU_PER_MM,
        maxX: 5 * PCB_IU_PER_MM,
        maxY: 5 * PCB_IU_PER_MM,
      };
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
        const action = wheelAction(
          e,
          commonInputPrefs(),
          { width: canvas.width, height: canvas.height },
          zoomCtlRef.current,
        );
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

    /**
     * The measure tool's cursor: `grid.BestSnapAnchor`, unless Shift is held.
     *
     * `snapRef` is this canvas's grid helper, the same one EDIT_TOOL's move
     * goes through, so a measurement lands on the grid the status bar reports.
     * Upstream also snaps to magnetic ITEMS (`PCB_GRID_HELPER` is built with
     * `GetMagneticItemsSettings()`), which we do not have here yet -- pad-to-pad
     * measuring is therefore grid-accurate but not pad-exact.
     */
    const measurePoint = (e: React.PointerEvent): Vec2 => {
      const w = worldAt(e.clientX, e.clientY);
      return e.shiftKey ? w : snapRef.current(w);
    };

    // A gesture in flight: pan (middle button), or, with the select tool,
    // click-select + box-select on empty space, and drag-move over a selection.
    const gestureRef = useRef<
      | { mode: 'pan'; last: { x: number; y: number } }
      | { mode: 'dragzoom'; last: { x: number; y: number }; anchor: { x: number; y: number } }
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
      // `WX_VIEW_CONTROLS::onButton` (`wx_view_controls.cpp:546-569`): the
      // middle button starts whatever Preferences > Mouse and Touchpad > Drag
      // Gestures says. NONE is neither branch, so the press falls through to
      // the tools. (Right button is still the context menu here; see the
      // report -- upstream it obeys `m_dragRight` as well.)
      if (e.button === 1) {
        const gesture = dragGesture(e.button, commonInputPrefs());
        if (gesture !== 'none') {
          const last = { x: e.clientX, y: e.clientY };
          const r = canvasRef.current?.getBoundingClientRect() ?? new DOMRect();
          // `m_zoomStartPoint` (`:562`), fixed for the whole drag.
          const anchor = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
          gestureRef.current =
            gesture === 'zoom' ? { mode: 'dragzoom', last, anchor } : { mode: 'pan', last };
          return;
        }
      }
      // `ACTIONS::zoomTool` is AF_ACTIVATE: the button ARMS ZOOM_TOOL, and the
      // drag that follows does the work. Upstream accepts either button —
      // `evt->IsDrag( BUT_LEFT ) || evt->IsDrag( BUT_RIGHT )`
      // (`zoom_tool.cpp:84`) — and branches only at the end, where a right
      // drag zooms OUT by the same ratio. So this runs before the
      // left-button-only guard below.
      // `ACTIONS::measureTool`. The first left click sets the origin, the
      // second ends it (`pcb_viewer_tools.cpp:364-382`). Both are clicks, not a
      // press-drag-release, so this is all in pointerdown.
      if (activeToolRef.current === 'measureTool' && e.button === 0) {
        // `cursorPos = grid.BestSnapAnchor( cursorPos, nullptr );` runs on
        // every event of MeasureTool's loop (`pcb_viewer_tools.cpp:318-326`),
        // with `grid.SetSnap( !evt->Modifier( MD_SHIFT ) )` above it. That is
        // why upstream's readings are whole multiples of the grid and ours
        // were not. Shift turns snapping off -- the same modifier that turns
        // the 45 degree angle constraint on.
        const world = measurePoint(e);
        const r = rulerRef.current;
        if (r?.originSet) r.originSet = false;
        else rulerRef.current = { origin: world, end: world, originSet: true };
        gestureRef.current = null;
        requestDraw();
        return;
      }
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
      // `onMotion`'s meta-pan (`wx_view_controls.cpp:288-311`), which comes
      // FIRST and returns: with the Drag Gestures key held, a bare pointer move
      // pans and nothing else in this handler runs.
      const meta = motionPanRef.current.update(e, commonInputPrefs().motionPanModifier, dpr);
      if (meta) {
        const v = viewRef.current;
        v.tx += meta.dx;
        v.ty += meta.dy;
        requestDraw();
        return;
      }
      if (canvasRef.current) {
        const w = worldAt(e.clientX, e.clientY);
        cursorWorldRef.current = w;
        onCursorMove?.(w);
        // The crosshair and the rubber band both follow the pointer.
        requestDraw();
      }
      const r = rulerRef.current;
      if (r?.originSet) {
        // Shift constrains to 45 degree increments; otherwise a direct line.
        r.end = rulerEnd(r.origin, measurePoint(e), e.shiftKey ? 'deg45' : 'direct');
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
        // DRAG_ZOOMING (`wx_view_controls.cpp:363-405`): the same zoom-about-a-
        // point arithmetic the wheel uses, at `m_zoomStartPoint`.
        const v = viewRef.current;
        const f = dragZoomScale(g.last.y - e.clientY, commonInputPrefs());
        const wx = (g.anchor.x - v.tx) / v.scale;
        const wy = (g.anchor.y - v.ty) / v.scale;
        v.scale *= f;
        v.tx = g.anchor.x - wx * v.scale;
        v.ty = g.anchor.y - wy * v.scale;
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
            // `ZOOM_TOOL::Main` and `PCB_VIEWER_TOOLS::MeasureTool` each set
            // their own: KICURSOR::ZOOM_IN (`zoom_tool.cpp:65-69`) and
            // KICURSOR::MEASURE (`pcb_viewer_tools.cpp:292`).
            cursor:
              activeTool === 'zoomTool'
                ? kiCursor('ZOOM_IN')
                : activeTool === 'measureTool'
                  ? kiCursor('MEASURE')
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

/**
 * The CSS `font-size` whose cap height is `targetPx`.
 *
 * KiCad's `TEXT_DIMS::GlyphSize` is the stroke font's glyph HEIGHT — the height
 * of a capital — while CSS `font-size` is the em box, which is always larger.
 * Setting one as the other draws the preview text about a third too small,
 * which is what made ours look thin and undersized beside a real ruler.
 *
 * Measured rather than assumed: the ratio differs per face, and the fallback
 * chain here can resolve to whatever the platform has. `actualBoundingBoxAscent`
 * of a digit is that cap height.
 */
const capRatioCache = new Map<string, number>();
function cssSizeForGlyphHeight(ctx: CanvasRenderingContext2D, targetPx: number): number {
  const face = 'ui-monospace, monospace';
  let ratio = capRatioCache.get(face);
  if (ratio === undefined) {
    const probe = 100;
    const saved = ctx.font;
    ctx.font = `${probe}px ${face}`;
    const m = ctx.measureText('0');
    const asc = m.actualBoundingBoxAscent;
    ratio = asc > 0 ? asc / probe : 0.72;
    ctx.font = saved;
    capRatioCache.set(face, ratio);
  }
  return targetPx / ratio;
}
