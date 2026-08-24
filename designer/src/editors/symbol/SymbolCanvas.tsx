// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import type { Vec2 } from '@ziroeda/kimath';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LibGraphic, LibPin, LibSymbol } from '@ziroeda/eeschema';
import { EMPTY_SOURCE } from '@ziroeda/eeschema';
import { KICAD_DEFAULT, type Theme } from '../schematic/theme.js';
import { commonInputPrefs, wheelAction } from '../../ui/view_controls.js';
import { drawCrosshair } from '../../ui/grid_cursor.js';
import { SYM_SHAPE_TOOLS } from './symbolToolbars.js';
import { settings } from '../../prefs/settings.js';
import {
  fitSymbol,
  renderSymbolScene,
  drawPin,
  drawGraphic,
  GRID,
  type SymbolViewOptions,
  type Viewport,
} from './render/symbolRenderer.js';
import {
  boxSelectSymbol,
  deleteSymbolItems,
  hitTestSymbol,
  moveSymbolItems,
  moveSymbolOrigin,
  snap,
  type SymbolHit,
} from './edits.js';

/**
 * The symbol editor's drawing canvas: pan/zoom, selection/move (SCH_SELECTION /
 * SYMBOL_EDITOR_MOVE_TOOL), the two-click pin/text placement and the
 * SYMBOL_EDITOR_DRAWING_TOOLS::doDrawShape state machine, including KiCad's
 * exact 2-click arc construction (radius = chord × √½, quarter-circle bulge).
 */

export interface SymbolCanvasController {
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

/** In-progress shape state, mirroring EDA_SHAPE::m_editState. */
interface DrawState {
  tool: 'rectangle' | 'circle' | 'arc' | 'lines' | 'polygon';
  start: Vec2;
  points: Vec2[]; // poly points placed so far (lines/polygon)
  cursor: Vec2;
}

interface Props {
  symbol: LibSymbol | null;
  /** Active colour theme (Preferences > Colors). */
  theme?: Theme;
  opts: SymbolViewOptions;
  selection: ReadonlySet<string>;
  activeTool: string;
  /** A pin configured in the dialog, now following the cursor (two-click place). */
  pendingPin: LibPin | null;
  /** A text item configured in the dialog, following the cursor. */
  pendingText: { text: string; fontSize?: number } | null;
  onSelect: (id: string | null, additive: boolean) => void;
  onSelectBox: (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => void;
  /** Commit an edited symbol as one undoable step. */
  onCommit: (next: LibSymbol, description: string) => void;
  /** First click of the pin tool: open the pin dialog for this position. */
  onPinToolClick: (pos: Vec2) => void;
  /** The pending pin was dropped at pos: place it (PlacePin + image pins). */
  onPlacePendingPin: (pos: Vec2) => void;
  /** First click of the text tool: open the text dialog. */
  onTextToolClick: (pos: Vec2) => void;
  /** The pending text was dropped. */
  onPlacePendingText: (pos: Vec2) => void;
  /** A finished shape from the drawing tools. */
  onPlaceShape: (g: LibGraphic) => void;
  onEditItem: (hit: SymbolHit) => void;
  onCursorMove?: (world: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
}

type Mode = 'idle' | 'pan' | 'move' | 'box';

/** GAL::GetScaleFactor. Module scope so it is stable across renders. */
const dpr = (): number => window.devicePixelRatio || 1;

const BOX_FILL_NORMAL = 'rgba(128, 77, 255, 0.5)';
const BOX_FILL_ADDITIVE = 'rgba(128, 255, 128, 0.5)';
const BOX_FILL_SUBTRACT = 'rgba(255, 128, 128, 0.5)';
const BOX_OUTLINE_L2R = 'rgb(179, 179, 0)';
const BOX_OUTLINE_R2L = 'rgb(26, 26, 255)';

/** KiCad's 2-click arc (EDA_SHAPE::calcEdit state 1): quarter-circle through start/end. */
export function arcFromTwoPoints(
  start: Vec2,
  end: Vec2,
): { start: Vec2; mid: Vec2; end: Vec2 } | null {
  const l = Math.hypot(end.x - start.x, end.y - start.y);
  if (l === 0) return null;
  const radius = l * Math.SQRT1_2;
  const m = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const sqRadDiff = radius * radius - (l * l) / 4;
  const f = Math.sqrt(Math.max(0, sqRadDiff)) / l;
  // Two candidate centres; KiCad keeps the arc's subtended angle <= 180° while drawing.
  const d1 = { x: f * (start.y - end.y), y: f * (end.x - start.x) };
  for (const d of [d1, { x: -d1.x, y: -d1.y }]) {
    const c = { x: m.x + d.x, y: m.y + d.y };
    const a0 = Math.atan2(start.y - c.y, start.x - c.x);
    const a1 = Math.atan2(end.y - c.y, end.x - c.x);
    // Sweep from start to end going clockwise on screen (KiCad keeps it at 90°).
    let sweep = a1 - a0;
    while (sweep < 0) sweep += Math.PI * 2;
    if (sweep <= Math.PI + 1e-9) {
      const am = a0 + sweep / 2;
      return {
        start,
        mid: { x: c.x + radius * Math.cos(am), y: c.y + radius * Math.sin(am) },
        end,
      };
    }
  }
  const c = { x: m.x + d1.x, y: m.y + d1.y };
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  const am = (a0 + a1) / 2;
  return { start, mid: { x: c.x + radius * Math.cos(am), y: c.y + radius * Math.sin(am) }, end };
}

export const SymbolCanvas = forwardRef<SymbolCanvasController, Props>(function SymbolCanvas(
  {
    symbol,
    theme = KICAD_DEFAULT,
    opts,
    selection,
    activeTool,
    pendingPin,
    pendingText,
    onSelect,
    onSelectBox,
    onCommit,
    onPinToolClick,
    onPlacePendingPin,
    onTextToolClick,
    onPlacePendingText,
    onPlaceShape,
    onEditItem,
    onCursorMove,
    onScaleChange,
  },
  ref,
): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const modeRef = useRef<Mode>('idle');
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  const panMovedRef = useRef(false);
  const moveStartRef = useRef<Vec2 | null>(null);
  const moveDeltaRef = useRef<Vec2 | null>(null);
  const boxOriginRef = useRef<Vec2 | null>(null);
  const boxEndRef = useRef<Vec2 | null>(null);
  const boxModifiersRef = useRef({ additive: false, subtractive: false });
  const cursorRef = useRef<Vec2 | null>(null);
  const drawStateRef = useRef<DrawState | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let doc = symbol;
    const md = moveDeltaRef.current;
    if (doc && modeRef.current === 'move' && md && (md.x !== 0 || md.y !== 0)) {
      doc = moveSymbolItems(doc, selection, md);
    }
    renderSymbolScene(ctx, doc, vp, theme, canvas.width, canvas.height, opts, selection);

    ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Ghost: the configured pin following the cursor (two-click place).
    const cur = cursorRef.current;
    if (pendingPin && cur && doc) {
      const at = snap(cur);
      drawPin(
        ctx,
        { ...pendingPin, at },
        {
          pinNamesHidden: doc.pinNamesHidden,
          pinNumbersHidden: doc.pinNumbersHidden,
          pinNameOffset: doc.pinNameOffset,
          showElectricalTypes: opts.showPinElectricalTypes,
          showHiddenPins: true,
        },
        theme,
      );
    }

    // Ghost: pending text.
    if (pendingText && cur) {
      const at = snap(cur);
      const g: LibGraphic = {
        kind: 'text',
        text: pendingText.text,
        at,
        angle: 0,
        source: EMPTY_SOURCE,
        ...(pendingText.fontSize
          ? {
              effects: {
                hidden: false,
                fontSize: [pendingText.fontSize, pendingText.fontSize] as [number, number],
              },
            }
          : {}),
      };
      drawGraphic(ctx, g, theme);
    }

    // Preview: the shape being drawn.
    const ds = drawStateRef.current;
    if (ds) {
      const preview = shapePreview(ds);
      if (preview) drawGraphic(ctx, preview, theme);
    }

    // Box-selection rubber band.
    const bo = boxOriginRef.current;
    const be = boxEndRef.current;
    if (modeRef.current === 'box' && bo && be) {
      const greedy = be.x < bo.x;
      const { additive, subtractive } = boxModifiersRef.current;
      ctx.fillStyle = subtractive
        ? BOX_FILL_SUBTRACT
        : additive
          ? BOX_FILL_ADDITIVE
          : BOX_FILL_NORMAL;
      ctx.strokeStyle = greedy ? BOX_OUTLINE_R2L : BOX_OUTLINE_L2R;
      ctx.lineWidth = 1 / vp.scale;
      const x = Math.min(bo.x, be.x),
        y = Math.min(bo.y, be.y);
      const w = Math.abs(be.x - bo.x),
        h = Math.abs(be.y - bo.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    // GAL::blitCursor at the snapped point, in LAYER_SCHEMATIC_CURSOR: the
    // symbol editor is an SCH_BASE_FRAME and reads eeschema's cursor layer
    // (sch_render_settings.h:71). It had none at all before.
    if (cur) {
      const at = snap(cur);
      const cursorPrefs = settings.eeschema.window.cursor;
      drawCrosshair(
        ctx,
        { x: at.x * vp.scale + vp.offsetX, y: at.y * vp.scale + vp.offsetY },
        canvas.width,
        canvas.height,
        {
          mode: cursorPrefs.crosshair,
          color: theme.cursor,
          // SYMBOL_EDITOR_DRAWING_TOOLS and the move tool call ShowCursor(true);
          // the selection tool does not, so there the crosshair is the dimmed
          // forced one.
          toolWantsCursor: activeTool !== 'select',
          alwaysShow: cursorPrefs.always_show_cursor,
          devicePixelRatio: dpr(),
        },
      );
    }

    onScaleChange?.(vp.scale);
  }, [symbol, theme, opts, selection, activeTool, pendingPin, pendingText, onScaleChange]);

  const zoomAbout = useCallback(
    (px: number, py: number, factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const wx = (px - vp.offsetX) / vp.scale;
      const wy = (py - vp.offsetY) / vp.scale;
      const scale = vp.scale * factor;
      viewportRef.current = { scale, offsetX: px - wx * scale, offsetY: py - wy * scale };
      draw();
    },
    [draw],
  );

  const fitPendingRef = useRef(false);
  const sizedRef = useRef(false);

  useImperativeHandle(
    ref,
    (): SymbolCanvasController => ({
      zoomToFit: () => {
        const c = canvasRef.current;
        if (!c || !sizedRef.current) {
          fitPendingRef.current = true;
          return;
        }
        viewportRef.current = fitSymbol(symbol, opts.unit, opts.bodyStyle, c.width, c.height);
        draw();
      },
      zoomIn: () => {
        const c = canvasRef.current;
        if (c) zoomAbout(c.width / 2, c.height / 2, 1.25);
      },
      zoomOut: () => {
        const c = canvasRef.current;
        if (c) zoomAbout(c.width / 2, c.height / 2, 0.8);
      },
    }),
    [symbol, opts.unit, opts.bodyStyle, draw, zoomAbout],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const r = dpr();
    canvas.width = Math.floor(size.w * r);
    canvas.height = Math.floor(size.h * r);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    sizedRef.current = true;
    if (!viewportRef.current || fitPendingRef.current) {
      viewportRef.current = fitSymbol(
        symbol,
        opts.unit,
        opts.bodyStyle,
        canvas.width,
        canvas.height,
      );
      fitPendingRef.current = false;
    }
    draw();
  }, [size, symbol, opts.unit, opts.bodyStyle, draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Tool switches cancel any in-progress shape.
  useEffect(() => {
    drawStateRef.current = null;
    draw();
  }, [activeTool, draw]);

  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const canvas = canvasRef.current!;
    const vp = viewportRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * dpr();
    const py = (clientY - rect.top) * dpr();
    return { x: (px - vp.offsetX) / vp.scale, y: (py - vp.offsetY) / vp.scale };
  };

  // WX_VIEW_CONTROLS::onWheel. The symbol editor is an EDA_DRAW_FRAME like any
  // other, so Preferences -> Mouse and Touchpad applies here too; this used to
  // be a fixed exp(-delta * 0.001) that read no setting at all.
  const inputPrefs = useMemo(() => commonInputPrefs(), []);

  const onWheel = useCallback(
    (e: WheelEvent) => {
      const canvas = canvasRef.current;
      const vp = viewportRef.current;
      if (!canvas || !vp) return;
      e.preventDefault();
      const action = wheelAction(e, inputPrefs, { width: canvas.width, height: canvas.height });
      if (action.kind === 'none') return;
      if (action.kind === 'pan') {
        viewportRef.current = {
          ...vp,
          offsetX: vp.offsetX + action.dx,
          offsetY: vp.offsetY + action.dy,
        };
        draw();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      zoomAbout((e.clientX - rect.left) * dpr(), (e.clientY - rect.top) * dpr(), action.factor);
    },
    [zoomAbout, draw, inputPrefs],
  );

  // Bound natively and non-passively: React's onWheel is a passive listener on
  // the root container, so preventDefault() there is a no-op and the browser
  // keeps Ctrl+wheel page zoom and trackpad overscroll for itself.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const finishPoly = useCallback(
    (closed: boolean) => {
      const ds = drawStateRef.current;
      if (!ds || (ds.tool !== 'lines' && ds.tool !== 'polygon')) return;
      drawStateRef.current = null;
      const pts = ds.points;
      if (pts.length >= 2) {
        const points =
          closed && (pts[0]!.x !== pts[pts.length - 1]!.x || pts[0]!.y !== pts[pts.length - 1]!.y)
            ? [...pts, pts[0]!]
            : pts;
        onPlaceShape({ kind: 'polyline', points, source: EMPTY_SOURCE });
      }
      draw();
    },
    [onPlaceShape, draw],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const world = toWorld(e.clientX, e.clientY);

      if (e.button === 1) {
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = 'pan';
        panLastRef.current = { x: e.clientX, y: e.clientY };
        panMovedRef.current = false;
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      const gridPos = snap(world);

      // Two-click pin placement.
      if (activeTool === 'placePin') {
        if (pendingPin) onPlacePendingPin(gridPos);
        else onPinToolClick(gridPos);
        return;
      }
      // Two-click text placement.
      if (activeTool === 'placeText') {
        if (pendingText) onPlacePendingText(gridPos);
        else onTextToolClick(gridPos);
        return;
      }

      // Anchor tool: reposition the symbol origin (symbol->Move(-cursor)).
      if (activeTool === 'placeAnchor') {
        if (symbol) {
          onCommit(moveSymbolOrigin(symbol, gridPos), 'Move Symbol Anchor');
          // Keep the view steady: shift the viewport by the same world delta.
          viewportRef.current = {
            ...vp,
            offsetX: vp.offsetX + gridPos.x * vp.scale,
            offsetY: vp.offsetY + gridPos.y * vp.scale,
          };
        }
        return;
      }

      // Delete tool: click deletes.
      if (activeTool === 'deleteTool') {
        if (symbol) {
          const hit = hitTestSymbol(
            symbol,
            opts.unit,
            opts.bodyStyle,
            world,
            (6 * dpr()) / vp.scale,
            opts.showHiddenPins,
            opts.showHiddenFields,
          );
          if (hit) onCommit(deleteSymbolItems(symbol, new Set([hit.id])), 'Delete');
        }
        return;
      }

      // Shape drawing tools. The id -> kind table is `symbolToolbars.ts`',
      // beside the toolbar that emits the ids; it used to be a chain of
      // comparisons here that had drifted off the toolbar by one action name.
      const tool = SYM_SHAPE_TOOLS[activeTool as keyof typeof SYM_SHAPE_TOOLS];
      if (tool) {
        const ds = drawStateRef.current;
        if (!ds) {
          drawStateRef.current = {
            tool,
            start: gridPos,
            points: tool === 'lines' || tool === 'polygon' ? [gridPos] : [],
            cursor: gridPos,
          };
        } else if (ds.tool === 'lines' || ds.tool === 'polygon') {
          // continueEdit: append a vertex (skip zero-length segments).
          const last = ds.points[ds.points.length - 1]!;
          if (last.x !== gridPos.x || last.y !== gridPos.y) ds.points.push(gridPos);
        } else {
          // Second click finishes rectangle / circle / arc.
          const done = shapeFinal(ds, gridPos);
          drawStateRef.current = null;
          if (done) onPlaceShape(done);
        }
        draw();
        return;
      }

      if (activeTool !== 'select') return;

      (e.target as Element).setPointerCapture(e.pointerId);
      if (!symbol) return;
      const hit = hitTestSymbol(
        symbol,
        opts.unit,
        opts.bodyStyle,
        world,
        (6 * dpr()) / vp.scale,
        opts.showHiddenPins,
        opts.showHiddenFields,
      );
      const additive = e.shiftKey;
      if (hit) {
        onSelect(hit.id, additive);
        modeRef.current = 'move';
        moveStartRef.current = world;
        moveDeltaRef.current = { x: 0, y: 0 };
      } else {
        modeRef.current = 'box';
        boxOriginRef.current = world;
        boxEndRef.current = world;
        boxModifiersRef.current = {
          additive: (e.ctrlKey || e.shiftKey) && !e.altKey,
          subtractive: e.ctrlKey && e.shiftKey && !e.altKey,
        };
      }
    },
    [
      activeTool,
      symbol,
      opts,
      selection,
      pendingPin,
      pendingText,
      onSelect,
      onCommit,
      onPinToolClick,
      onPlacePendingPin,
      onTextToolClick,
      onPlacePendingText,
      onPlaceShape,
      draw,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const world = toWorld(e.clientX, e.clientY);
      cursorRef.current = world;
      onCursorMove?.(world);

      if (modeRef.current === 'pan' && panLastRef.current) {
        panMovedRef.current = true;
        viewportRef.current = {
          ...vp,
          offsetX: vp.offsetX + (e.clientX - panLastRef.current.x) * dpr(),
          offsetY: vp.offsetY + (e.clientY - panLastRef.current.y) * dpr(),
        };
        panLastRef.current = { x: e.clientX, y: e.clientY };
        draw();
        return;
      }
      if (modeRef.current === 'box') {
        boxEndRef.current = world;
        draw();
        return;
      }
      if (modeRef.current === 'move' && moveStartRef.current) {
        const raw = { x: world.x - moveStartRef.current.x, y: world.y - moveStartRef.current.y };
        moveDeltaRef.current = {
          x: Math.round(raw.x / GRID) * GRID,
          y: Math.round(raw.y / GRID) * GRID,
        };
        draw();
        return;
      }
      const ds = drawStateRef.current;
      if (ds) {
        ds.cursor = snap(world);
        draw();
        return;
      }
      if (pendingPin || pendingText) {
        draw();
        return;
      }
      // Nothing is in flight, but the crosshair still follows the pointer.
      draw();
    },
    [draw, pendingPin, pendingText, onCursorMove],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (modeRef.current === 'pan' && e.button === 1) {
        (e.target as Element).releasePointerCapture(e.pointerId);
        modeRef.current = 'idle';
        panLastRef.current = null;
        return;
      }
      if (activeTool !== 'select') return;
      (e.target as Element).releasePointerCapture(e.pointerId);
      let committed = false;
      if (modeRef.current === 'move') {
        const d = moveDeltaRef.current;
        if (symbol && d && (d.x !== 0 || d.y !== 0) && selection.size > 0) {
          onCommit(moveSymbolItems(symbol, selection, d), 'Move');
          committed = true;
        }
      } else if (modeRef.current === 'box') {
        const bo = boxOriginRef.current;
        const be = boxEndRef.current;
        const vp = viewportRef.current;
        const movedPx = bo && be && vp ? Math.hypot(be.x - bo.x, be.y - bo.y) * vp.scale : 0;
        if (symbol && bo && be && movedPx > 4) {
          const greedy = be.x < bo.x;
          const { additive, subtractive } = boxModifiersRef.current;
          onSelectBox(
            boxSelectSymbol(symbol, opts.unit, opts.bodyStyle, bo, be, greedy, opts.showHiddenPins),
            additive,
            subtractive,
          );
        } else {
          onSelect(null, e.shiftKey);
        }
        boxOriginRef.current = null;
        boxEndRef.current = null;
      }
      modeRef.current = 'idle';
      moveStartRef.current = null;
      moveDeltaRef.current = null;
      if (!committed) draw();
    },
    [activeTool, symbol, opts, selection, onCommit, onSelect, onSelectBox, draw],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Double-click finishes an open polyline (lines stay open, polygon closes).
      const ds = drawStateRef.current;
      if (ds && (ds.tool === 'lines' || ds.tool === 'polygon')) {
        finishPoly(ds.tool === 'polygon');
        return;
      }
      if (activeTool !== 'select' || !symbol) return;
      const vp = viewportRef.current;
      if (!vp) return;
      const hit = hitTestSymbol(
        symbol,
        opts.unit,
        opts.bodyStyle,
        toWorld(e.clientX, e.clientY),
        (6 * dpr()) / vp.scale,
        opts.showHiddenPins,
        opts.showHiddenFields,
      );
      if (hit) onEditItem(hit);
    },
    [activeTool, symbol, opts, onEditItem, finishPoly],
  );

  // Escape cancels an in-progress shape (the frame handles tool reset).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'symbols') !== 'symbols') return;
      if (e.key === 'Escape' && drawStateRef.current) {
        drawStateRef.current = null;
        draw();
      } else if (e.key === 'Enter' && drawStateRef.current) {
        const ds = drawStateRef.current;
        if (ds.tool === 'lines' || ds.tool === 'polygon') finishPoly(ds.tool === 'polygon');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draw, finishPoly]);

  const cursor = activeTool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          const ds = drawStateRef.current;
          if (ds && (ds.tool === 'lines' || ds.tool === 'polygon'))
            finishPoly(ds.tool === 'polygon');
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
});

/** Live preview of the shape being drawn. */
function shapePreview(ds: DrawState): LibGraphic | null {
  switch (ds.tool) {
    case 'rectangle':
      return { kind: 'rectangle', start: ds.start, end: ds.cursor, source: EMPTY_SOURCE };
    case 'circle': {
      const r = Math.hypot(ds.cursor.x - ds.start.x, ds.cursor.y - ds.start.y);
      return { kind: 'circle', center: ds.start, radius: r, source: EMPTY_SOURCE };
    }
    case 'arc': {
      const a = arcFromTwoPoints(ds.start, ds.cursor);
      return a ? { kind: 'arc', ...a, source: EMPTY_SOURCE } : null;
    }
    case 'lines':
    case 'polygon':
      return { kind: 'polyline', points: [...ds.points, ds.cursor], source: EMPTY_SOURCE };
  }
}

/** Final shape at the second click (rectangle / circle / arc). */
function shapeFinal(ds: DrawState, end: Vec2): LibGraphic | null {
  switch (ds.tool) {
    case 'rectangle':
      if (ds.start.x === end.x && ds.start.y === end.y) return null;
      return { kind: 'rectangle', start: ds.start, end, source: EMPTY_SOURCE };
    case 'circle': {
      const r = Math.hypot(end.x - ds.start.x, end.y - ds.start.y);
      if (r === 0) return null;
      return { kind: 'circle', center: ds.start, radius: r, source: EMPTY_SOURCE };
    }
    case 'arc': {
      const a = arcFromTwoPoints(ds.start, end);
      return a ? { kind: 'arc', ...a, source: EMPTY_SOURCE } : null;
    }
    default:
      return null;
  }
}
