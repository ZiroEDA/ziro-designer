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
import { drawSelectionArea, isBackgroundDark, selectionAreaColors } from '@ziroeda/common';
import {
  EDIT_POINT_BORDER_SIZE,
  EDIT_POINT_HOVER_SIZE,
  EDIT_POINT_SIZE,
  editPointColors,
} from '@ziroeda/common';
import type { EditHandle } from '@ziroeda/eeschema/src/tools/point_editor.js';
import { ArcEditMode } from '@ziroeda/eeschema/src/tools/arc_edit.js';
import {
  commonInputPrefs,
  dragGesture,
  dragZoomScale,
  makeAutoPan,
  makeMotionPan,
  makeZoomController,
  wheelAction,
} from '../../ui/view_controls.js';
import { drawCrosshair } from '../../ui/grid_cursor.js';
import { symbolToolCursor } from './cursors.js';
import { clampViewScale } from '../../ui/zoom_settings.js';
import { SCH_IU_PER_MM } from '@ziroeda/common';
import { zoomAreaTarget, type ZoomArea } from '../../ui/zoom_tool.js';
import { SYM_SHAPE_TOOLS } from './symbolToolbars.js';
import { settings } from '../../prefs/settings.js';
import { useSymbolEditorSettings } from '../../prefs/useSettings.js';
import {
  fitSymbol,
  renderSymbolScene,
  drawPin,
  drawGraphic,
  type SymbolViewOptions,
  type Viewport,
} from './render/symbolRenderer.js';
import {
  boxSelectSymbol,
  deleteSymbolItems,
  symbolDeleteOutcome,
  hitTestSymbol,
  moveSymbolItems,
  symbolEditHandles,
  symbolIndicatorLines,
  dragSymbolHandle,
  moveSymbolOrigin,
  type SymbolHit,
} from './edits.js';
import { symbolGridForTool, symbolSnappingEnabled } from './grid.js';

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
  /**
   * `EDA_DRAW_FRAME::FocusOnLocation` (`common/eda_draw_frame.cpp`), which is
   * `GetCanvas()->GetView()->SetCenter( aPos )` once the point is off-screen:
   * the scale is kept and the world point goes to the middle of the canvas.
   * `SCH_FIND_REPLACE_TOOL::FindNext` ends on it for every hit.
   */
  centerOn: (pos: Vec2) => void;
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

type Mode = 'idle' | 'pan' | 'dragzoom' | 'move' | 'box' | 'zoom' | 'point';

/** GAL::GetScaleFactor. Module scope so it is stable across renders. */
const dpr = (): number => window.devicePixelRatio || 1;

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

  /**
   * The active snap grid — `GRID_HELPER::GetGrid` for what this tool lays down,
   * exactly as `SchematicCanvas` computes it. It was `edits.ts`' module-level
   * `snap`, on the constant `GRID`, so Preferences > Symbol Editor > Grids
   * could store a grid and a set of overrides that nothing snapped to.
   */
  const symCfg = useSymbolEditorSettings();
  const gridIU = symbolGridForTool(symCfg, activeTool);
  /**
   * `GRID_HELPER::canUseGrid()`, whose only term we can express is
   * `GetGAL()->GetGridSnapping()` — the "Snap to grid" choice. With it off the
   * cursor is where the pointer is, which is what `GRID_SNAPPING::NEVER`
   * means.
   */
  const snapping = symbolSnappingEnabled(symCfg);
  const snap = useCallback(
    (p: Vec2): Vec2 =>
      snapping ? { x: Math.round(p.x / gridIU) * gridIU, y: Math.round(p.y / gridIU) * gridIU } : p,
    [gridIU, snapping],
  );

  const modeRef = useRef<Mode>('idle');
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  /** `WX_VIEW_CONTROLS::m_metaPanning` / `m_metaPanStart`, per canvas. */
  const motionPanRef = useRef(makeMotionPan());
  /**
   * `WX_VIEW_CONTROLS::m_zoomController` — this canvas's own, because upstream
   * each `WX_VIEW_CONTROLS` owns one and the accelerating one has history.
   */
  const zoomCtlRef = useRef(makeZoomController());
  /** `WX_VIEW_CONTROLS::m_zoomStartPoint` (`wx_view_controls.cpp:562`, `:386`). */
  const zoomStartRef = useRef<{ x: number; y: number } | null>(null);
  const panMovedRef = useRef(false);
  const moveStartRef = useRef<Vec2 | null>(null);
  const moveDeltaRef = useRef<Vec2 | null>(null);

  /**
   * `SCH_POINT_EDITOR`'s EDIT_POINTS for the one selected shape.
   *
   * The same tool the schematic runs — one class registered by both frames
   * (`sch_edit_frame.cpp:705`, `symbol_edit_frame.cpp:431`) — so the handles
   * come from the shared behaviours rather than a second set computed here.
   * Upstream shows them for a single selection of a `pointEditorTypes` item;
   * inside a LIB_SYMBOL that is a shape and nothing else.
   */
  const pointTargetRef = useRef<string | null>(null);
  const pointHandlesRef = useRef<readonly EditHandle[]>([]);
  const pointLeadersRef = useRef<readonly [Vec2, Vec2][]>([]);
  const pointDragRef = useRef<EditHandle | null>(null);
  const pointDragPosRef = useRef<Vec2 | null>(null);
  const hoveredHandleRef = useRef<EditHandle | null>(null);
  const boxOriginRef = useRef<Vec2 | null>(null);
  const boxEndRef = useRef<Vec2 | null>(null);
  const boxModifiersRef = useRef({ additive: false, subtractive: false });
  /**
   * `ZOOM_TOOL`'s right-button drag zooms OUT: upstream accepts
   * `IsDrag( BUT_LEFT ) || IsDrag( BUT_RIGHT )` throughout and branches only at
   * the end (`common/tool/zoom_tool.cpp:150-153`). Which button started the
   * drag is the whole of the difference, so it is kept for the pointer-up.
   */
  const zoomOutRef = useRef(false);
  /**
   * `WX_VIEW_CONTROLS::m_panTimer` and the AUTO_PANNING state, per canvas.
   *
   * `enabled` is `m_autoPanEnabled`, which upstream every move and drawing
   * tool brackets its loop with (`SetAutoPan( true/false )`) — so autopan
   * runs while an item is in flight or a rubber band is being framed, and
   * never on an idle hover.
   */
  const autoPanRef = useRef(
    makeAutoPan({
      viewportPx: () => ({
        width: canvasRef.current?.width ?? 0,
        height: canvasRef.current?.height ?? 0,
      }),
      enabled: () => modeRef.current === 'move' || modeRef.current === 'zoom',
      // `SetCenter( center + dir )`: the centre moves WITH dir, so the
      // translation moves against it.
      panBy: (dx, dy) => {
        const v = viewportRef.current;
        if (v) viewportRef.current = { ...v, offsetX: v.offsetX - dx, offsetY: v.offsetY - dy };
        draw();
      },
    }),
  );
  const cursorRef = useRef<Vec2 | null>(null);
  const drawStateRef = useRef<DrawState | null>(null);

  /**
   * `SCH_POINT_EDITOR::Main`'s guard, ported: handles appear for a single
   * selection of an editable item and for nothing else.
   *
   *     if( selection.Size() != 1 || !selection.Front()->IsType( pointEditorTypes ) )
   *         return 0;
   *     (`sch_point_editor.cpp:1152-1153`)
   *
   * It also waits for the drawing tool to finish, which here is the `select`
   * tool test — a shape being drawn is not a selection.
   */
  useEffect(() => {
    const ids = [...selection];
    const id = ids.length === 1 ? ids[0]! : null;
    const editable = id !== null && id.startsWith('gfx:') && activeTool === 'select';
    pointTargetRef.current = editable ? id : null;
    pointHandlesRef.current = editable && symbol ? symbolEditHandles(symbol, id) : [];
    pointLeadersRef.current = editable && symbol ? symbolIndicatorLines(symbol, id) : [];
    if (!editable) {
      pointDragRef.current = null;
      hoveredHandleRef.current = null;
    }
  }, [selection, symbol, activeTool]);

  /**
   * `EDIT_POINTS::FindPoint` — each handle's own box, POINT_SIZE screen pixels
   * wide however far you are zoomed, so the tolerance converts back through the
   * view scale.
   */
  const handleAt = useCallback((p: Vec2): EditHandle | null => {
    const vp = viewportRef.current;
    const handles = pointHandlesRef.current;
    if (!vp || handles.length === 0) return null;
    const tol = (EDIT_POINT_SIZE * dpr()) / vp.scale;
    let best: EditHandle | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const h of handles) {
      const d = Math.hypot(h.at.x - p.x, h.at.y - p.y);
      // A corner wins a tie: it sits on top of the two edge handles beside it.
      if (d <= tol && (d < bestD || (d === bestD && h.kind === 'point'))) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }, []);

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
    // The live reshape, from the same pure function the release commits.
    if (doc && modeRef.current === 'point' && pointDragRef.current && pointDragPosRef.current) {
      const id = pointTargetRef.current;
      if (id) {
        doc = dragSymbolHandle(doc, id, pointDragRef.current, pointDragPosRef.current, {
          arcMode: ArcEditMode.KeepCenterAdjustAngleRadius,
          dragPins: symCfg.drag_pins_along_with_edges,
        });
      }
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
          // The ghost following the cursor during a two-click place: a pin
          // being created declares no alternates yet, so the icon could never
          // appear and passing the live setting would be a reader that cannot
          // fire.
          showPinAltIcons: false,
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
    // `ZOOM_TOOL::selectRegion` adds a `KIGFX::PREVIEW::SELECTION_AREA` to the
    // view and live-updates it (`zoom_tool.cpp:104-124`). A default-constructed
    // one takes the `normal` fill and the `outline_l2r` stroke, which is why
    // this band is blue/yellow and not the selection box's purple — the colours
    // are `ui/zoom_tool.ts`', shared with every other canvas that arms the tool.
    if ((modeRef.current === 'zoom' || modeRef.current === 'box') && bo && be) {
      // The band is a device-space item: `SetLineWidth( 0.0 )` is one DEVICE
      // pixel at every zoom, and `1 / vp.scale` — one world unit scaled back to
      // one logical pixel — is neither that nor stable across displays. So the
      // world transform comes off for the two passes and goes back after.
      const toDev = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: p.x * vp.scale + vp.offsetX,
        y: p.y * vp.scale + vp.offsetY,
      });
      const d0 = toDev(bo);
      const d1 = toDev(be);
      const mods = boxModifiersRef.current;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawSelectionArea(
        ctx,
        d0.x,
        d0.y,
        d1.x,
        d1.y,
        selectionAreaColors({
          // SYMBOL_EDIT_FRAME is an SCH_BASE_FRAME, so this is
          // `SCH_RENDER_SETTINGS::IsBackgroundDark` — LAYER_SCHEMATIC_BACKGROUND's
          // luma (`sch_render_settings.h:48-52`). The five constants that used
          // to sit here were `selectionColorScheme[1]` verbatim, i.e. the light
          // scheme unconditionally, on a canvas whose theme can be dark.
          backgroundDark: isBackgroundDark(theme.background),
          // `ZOOM_TOOL` never calls `SetMode`, so a zoom band is always the
          // default INSIDE_RECTANGLE; a box select follows the drag direction.
          inside: modeRef.current === 'zoom' || be.x >= bo.x,
          ...(modeRef.current === 'box'
            ? { additive: mods.additive, subtractive: mods.subtractive }
            : {}),
        }),
      );
      ctx.restore();
    }
    // Edit points (`EDIT_POINTS::ViewDraw`): a square on every corner or vertex
    // and a circle at every edge midpoint, at a fixed SCREEN size whatever the
    // zoom, so this runs in device space. The colours are derived from the
    // theme's LAYER_AUX_ITEMS exactly as upstream derives them, through the one
    // shared `editPointColors`.
    {
      const handles = pointHandlesRef.current;
      if (handles.length > 0 && modeRef.current !== 'move') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const r = dpr();
        const half = (EDIT_POINT_SIZE / 2) * r;
        const hovered = pointDragRef.current ?? hoveredHandleRef.current;
        const colors = editPointColors(theme.auxItems, theme.background);
        ctx.setLineDash([]);
        // Leaders first, so a handle square sits on top of the line ending at
        // it. `borderSize / 4`, in the border colour, no midpoint circle.
        if (pointLeadersRef.current.length > 0) {
          ctx.strokeStyle = colors.border;
          ctx.lineWidth = (EDIT_POINT_BORDER_SIZE / 4) * r;
          ctx.beginPath();
          for (const [a, b] of pointLeadersRef.current) {
            ctx.moveTo(a.x * vp.scale + vp.offsetX, a.y * vp.scale + vp.offsetY);
            ctx.lineTo(b.x * vp.scale + vp.offsetX, b.y * vp.scale + vp.offsetY);
          }
          ctx.stroke();
        }
        ctx.fillStyle = colors.fill;
        for (const h of handles) {
          const x = h.at.x * vp.scale + vp.offsetX;
          const y = h.at.y * vp.scale + vp.offsetY;
          const active = hovered?.kind === h.kind && hovered?.index === h.index;
          ctx.strokeStyle = active ? colors.highlight : colors.border;
          ctx.lineWidth = (active ? EDIT_POINT_HOVER_SIZE : EDIT_POINT_BORDER_SIZE) * r;
          ctx.beginPath();
          if (h.kind === 'line') ctx.arc(x, y, half, 0, Math.PI * 2);
          else ctx.rect(x - half, y - half, half * 2, half * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      }
    }

    // GAL::blitCursor at the snapped point, in LAYER_SCHEMATIC_CURSOR: the
    // symbol editor is an SCH_BASE_FRAME and reads eeschema's cursor layer
    // (sch_render_settings.h:71). It had none at all before.
    if (cur) {
      const at = snap(cur);
      // `symbol_editor.json`'s `window.cursor`, not eeschema's: SYMBOL_EDIT_FRAME
      // is given `GetAppSettings<SYMBOL_EDITOR_SETTINGS>( "symbol_editor" )`
      // (`eeschema/eeschema.cpp:252`), and the Cursor group on Preferences >
      // Symbol Editor > Display Options writes that file. Reading the
      // schematic's here made those two radio buttons and the checkbox dead.
      const cursorPrefs = settings.symbolEditor.window.cursor;
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
          // forced one. `ZOOM_TOOL` does not either — `grep ShowCursor
          // common/tool/zoom_tool.cpp` is empty; all it sets is the pointer
          // bitmap (`KICURSOR::ZOOM_IN`, :65-69).
          toolWantsCursor: activeTool !== 'select' && activeTool !== 'zoomTool',
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

  /**
   * `ZOOM_TOOL::selectRegion`'s tail (`common/tool/zoom_tool.cpp:134-160`). The
   * arithmetic is `ui/zoom_tool.ts`', shared with the ten frames that upstream
   * gives the same 174-line tool; only putting the result into this canvas's
   * own transform is local.
   */
  const applyZoomArea = useCallback(
    (area: ZoomArea) => {
      const canvas = canvasRef.current;
      const vp = viewportRef.current;
      if (!canvas || !vp) return;
      const target = zoomAreaTarget(area, {
        scale: vp.scale,
        width: canvas.width,
        height: canvas.height,
      });
      if (!target) return;
      // `VIEW::SetScale` pins to `m_minScale`/`m_maxScale`, so a one-pixel drag
      // does not send the scale to infinity. The pair is `ZOOM_LIMITS`', the
      // shared transcription of `zoom_defines.h`, and the Symbol Editor's row
      // there is eeschema's because upstream reuses it.
      const scale = clampViewScale(target.scale, 'symbol_editor', dpr(), SCH_IU_PER_MM);
      // `view->SetCenter( selectionBox.Centre() )`: that world point goes to
      // the middle of the canvas.
      viewportRef.current = {
        scale,
        offsetX: canvas.width / 2 - target.centre.x * scale,
        offsetY: canvas.height / 2 - target.centre.y * scale,
      };
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
      centerOn: (pos: Vec2) => {
        const c = canvasRef.current;
        const vp = viewportRef.current;
        if (!c || !vp) return;
        viewportRef.current = {
          scale: vp.scale,
          offsetX: c.width / 2 - pos.x * vp.scale,
          offsetY: c.height / 2 - pos.y * vp.scale,
        };
        draw();
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
      const action = wheelAction(
        e,
        inputPrefs,
        { width: canvas.width, height: canvas.height },
        zoomCtlRef.current,
      );
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

      // `WX_VIEW_CONTROLS::onButton` (`wx_view_controls.cpp:546-569`): the
      // middle button starts whatever Preferences > Mouse and Touchpad > Drag
      // Gestures says, and NONE is neither branch -- the press falls through.
      if (e.button === 1) {
        const gesture = dragGesture(e.button, inputPrefs);
        if (gesture !== 'none') {
          (e.target as Element).setPointerCapture(e.pointerId);
          modeRef.current = gesture === 'zoom' ? 'dragzoom' : 'pan';
          panLastRef.current = { x: e.clientX, y: e.clientY };
          const zr = canvasRef.current?.getBoundingClientRect();
          zoomStartRef.current = zr
            ? { x: (e.clientX - zr.left) * dpr(), y: (e.clientY - zr.top) * dpr() }
            : null;
          panMovedRef.current = false;
          e.preventDefault();
          return;
        }
      }
      /*
       * `ZOOM_TOOL::Main` (`common/tool/zoom_tool.cpp:61-101`) waits for a DRAG
       * and takes either button:
       *
       *     else if( evt->IsDrag( BUT_LEFT ) || evt->IsDrag( BUT_RIGHT ) )
       *         if( selectRegion() ) break;
       *
       * Nothing has to be selected for it to work — it frames a rectangle, it
       * does not zoom to the selection — which is why `ACTIONS::zoomTool` is one
       * of the actions `setupUIConditions` gives no ENABLE at all and it stays
       * live on a cold frame.
       */
      if (activeTool === 'zoomTool' && (e.button === 0 || e.button === 2)) {
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = 'zoom';
        boxOriginRef.current = world;
        boxEndRef.current = world;
        zoomOutRef.current = e.button === 2;
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
          if (hit) {
            const r = deleteSymbolItems(symbol, new Set([hit.id]));
            const outcome = symbolDeleteOutcome(r);
            if (outcome.kind === 'commit') onCommit(r.symbol, outcome.description);
          }
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

      // A handle wins over the item under it: `SCH_POINT_EDITOR` runs before
      // the selection tool's drag, which is why grabbing a corner resizes
      // rather than moving the whole shape.
      const grabbed = handleAt(world);
      if (grabbed) {
        pointDragRef.current = grabbed;
        modeRef.current = 'point';
        draw();
        return;
      }

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
      // `if( m_autoPanEnabled && m_autoPanSettingEnabled ) isAutoPanning =
      // handleAutoPanning( aEvent )` (`wx_view_controls.cpp:304-305`).
      {
        const apr = canvasRef.current?.getBoundingClientRect();
        if (apr)
          autoPanRef.current.motion(
            { x: (e.clientX - apr.left) * dpr(), y: (e.clientY - apr.top) * dpr() },
            { settingEnabled: inputPrefs.autoPan, acceleration: inputPrefs.autoPanAcceleration },
          );
      }
      // `onMotion`'s meta-pan (`wx_view_controls.cpp:288-311`), which comes
      // FIRST and returns: with the Drag Gestures key held, a bare pointer move
      // pans and nothing else in this handler runs.
      const meta = motionPanRef.current.update(e, inputPrefs.motionPanModifier, dpr());
      if (meta) {
        viewportRef.current = {
          ...vp,
          offsetX: vp.offsetX + meta.dx,
          offsetY: vp.offsetY + meta.dy,
        };
        draw();
        return;
      }
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
      if (modeRef.current === 'dragzoom' && panLastRef.current) {
        // DRAG_ZOOMING (`wx_view_controls.cpp:363-405`).
        panMovedRef.current = true;
        const anchor = zoomStartRef.current;
        if (anchor)
          zoomAbout(
            anchor.x,
            anchor.y,
            dragZoomScale(panLastRef.current.y - e.clientY, inputPrefs),
          );
        panLastRef.current = { x: e.clientX, y: e.clientY };
        return;
      }
      if (modeRef.current === 'box' || modeRef.current === 'zoom') {
        boxEndRef.current = world;
        draw();
        return;
      }
      // A live handle drag. `SCH_POINT_EDITOR` reshapes the item on every
      // motion and commits once on release, so the preview and the committed
      // result come from the same pure function.
      if (modeRef.current === 'point' && pointDragRef.current) {
        pointDragPosRef.current = snap(world);
        draw();
        return;
      }
      if (modeRef.current === 'move' && moveStartRef.current) {
        const raw = { x: world.x - moveStartRef.current.x, y: world.y - moveStartRef.current.y };
        // `SYMBOL_EDITOR_MOVE_TOOL` moves by whole grid steps, and the grid is
        // the frame's — `symbolGridIU()` — not a constant. See
        // `editors/symbol/grid.ts`.
        const grid = gridIU;
        moveDeltaRef.current = {
          x: Math.round(raw.x / grid) * grid,
          y: Math.round(raw.y / grid) * grid,
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
      // Idle: which handle is under the pointer, so it can thicken.
      // `EDIT_POINTS::ViewDraw` uses HOVER_SIZE for a hovered or active point.
      if (modeRef.current === 'idle' && pointHandlesRef.current.length > 0) {
        const over = handleAt(world);
        const prev = hoveredHandleRef.current;
        if (over?.kind !== prev?.kind || over?.index !== prev?.index) {
          hoveredHandleRef.current = over;
          draw();
        }
      }
      // Nothing is in flight, but the crosshair still follows the pointer.
      draw();
    },
    [draw, pendingPin, pendingText, onCursorMove, zoomAbout, inputPrefs],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // `case DRAG_ZOOMING: case DRAG_PANNING:` share one release
      // (`wx_view_controls.cpp:575-588`).
      if ((modeRef.current === 'pan' || modeRef.current === 'dragzoom') && e.button === 1) {
        (e.target as Element).releasePointerCapture(e.pointerId);
        modeRef.current = 'idle';
        panLastRef.current = null;
        zoomStartRef.current = null;
        return;
      }
      if (modeRef.current === 'zoom') {
        (e.target as Element).releasePointerCapture(e.pointerId);
        const bo = boxOriginRef.current;
        const be = boxEndRef.current;
        modeRef.current = 'idle';
        boxOriginRef.current = null;
        boxEndRef.current = null;
        // The tool STAYS ARMED. `selectRegion()` returns `cancelled`, which a
        // completed zoom leaves false, so `if( selectRegion() ) break;` in
        // `Main` breaks only on Esc or on another tool being picked
        // (`zoom_tool.cpp:104-165`) — you can frame one rectangle after another.
        if (bo && be) applyZoomArea({ a: bo, b: be, out: zoomOutRef.current });
        else draw();
        return;
      }
      if (activeTool !== 'select') return;
      (e.target as Element).releasePointerCapture(e.pointerId);
      let committed = false;
      if (modeRef.current === 'point') {
        // One commit on release, from the same `dragSymbolHandle` the preview
        // ran — so what is drawn and what is stored cannot disagree.
        const h = pointDragRef.current;
        const at = pointDragPosRef.current;
        const id = pointTargetRef.current;
        if (symbol && h && at && id) {
          const next = dragSymbolHandle(symbol, id, h, at, {
            arcMode: ArcEditMode.KeepCenterAdjustAngleRadius,
            // `editor.GetSettings()->m_dragPinsAlongWithEdges`
            // (`sch_point_editor.cpp:652-653`) — Preferences > Symbol Editor >
            // Editing Options' "Keep pins attached when dragging edges".
            dragPins: symCfg.drag_pins_along_with_edges,
          });
          if (next !== symbol) {
            onCommit(next, 'Drag Corner');
            committed = true;
          }
        }
        pointDragRef.current = null;
        pointDragPosRef.current = null;
      } else if (modeRef.current === 'move') {
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
    [activeTool, symbol, opts, selection, onCommit, onSelect, onSelectBox, draw, applyZoomArea],
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

  const cursor = symbolToolCursor(activeTool);

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
          // BUT_RIGHT is the zoom-OUT drag while ZOOM_TOOL is armed
          // (`zoom_tool.cpp:82`), so that button does not mean "menu" here.
          if (activeTool === 'zoomTool') return;
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
