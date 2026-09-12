// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint preview pane of the chooser dialogs. Mirrors
 * kicad/common/widgets/footprint_preview_widget.cpp
 * (FOOTPRINT_PREVIEW_WIDGET + FOOTPRINT_PREVIEW_PANEL): fetches the footprint
 * from the hosted libraries and paints it through the PCB paint pipeline,
 * with a status text replacing the canvas when there is nothing to draw
 * ("No footprint specified" / "Footprint not found").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { footprintBBox, footprintTextOnly, type PcbFootprint } from '@ziroeda/pcbnew';
import { usePreviewViewControls, type PreviewView } from './preview_view_controls.js';
import type { InputPrefs } from '../ui/view_controls.js';
import {
  buildScene,
  drawAnchors,
  drawBoard,
  pcbGridOptions,
  DEFAULT_DRAW_OPTIONS,
  PCB_DEFAULT_GRID_IU,
} from '../editors/pcb/renderBoard.js';
import { drawCrosshair, drawGrid } from '../ui/grid_cursor.js';
import { PCB_BACKGROUND, PCB_CURSOR } from '../editors/pcb/pcbTheme.js';
import { settings } from '../prefs/settings.js';
import { footprintToBoard, FOOTPRINT_LAYERS } from '../editors/footprint/footprintBoard.js';
import { loadFootprint } from './footprint_list.js';

const ALL_LAYERS: ReadonlySet<string> = new Set(FOOTPRINT_LAYERS.map((l) => l.name));

export interface FootprintPreviewWidgetProps {
  /** Footprint LIB_ID text to display, '' for none (SetStatusText branch). */
  footprint: string;
  /** Status label, e.g. "No footprint specified" (upstream SetStatusText). */
  statusText: string;
  /** Resolve a LIB_ID to a footprint. Defaults to the hosted libraries; the
   *  Assign Footprints window passes a resolver that also serves the project's
   *  own `.pretty` libraries (the fp-lib-table's project scope). */
  resolve?: (libId: string) => Promise<PcbFootprint | null>;
  /** Mouse preferences (PANEL_MOUSE_SETTINGS) for the zoom/pan gestures. */
  inputPrefs?: InputPrefs;
}

export function FootprintPreviewWidget({
  footprint,
  statusText,
  resolve = loadFootprint,
  inputPrefs,
}: FootprintPreviewWidgetProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fp, setFp] = useState<PcbFootprint | null>(null);
  // `FOOTPRINT_PREVIEW_WIDGET` has two states, not three: `DisplayFootprint`
  // (common/widgets/footprint_preview_widget.cpp:107-123) either clears the
  // status or sets "Footprint not found." There is no loading state because the
  // read is off an already-resident library, so while ours is in flight the
  // widget keeps showing what it showed before — which is what upstream's panel
  // does too, since it only repaints once the new footprint resolves.
  const [status, setStatus] = useState<'idle' | 'missing'>('idle');

  // DisplayFootprint: fetch the .kicad_mod on selection change.
  useEffect(() => {
    let cancelled = false;
    if (!footprint) {
      setFp(null);
      setStatus('idle');
      return;
    }
    void resolve(footprint).then((loaded) => {
      if (cancelled) return;
      setFp(loaded);
      setStatus(loaded ? 'idle' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [footprint, resolve]);

  // Paint the footprint through the pane's view (FOOTPRINT_PREVIEW_PANEL's
  // fitToCurrentFootprint seeds it; the wheel and a middle/right drag move it
  // afterwards, as on any GAL canvas).
  const fpRef = useRef<PcbFootprint | null>(fp);
  fpRef.current = fp;
  /**
   * `WX_VIEW_CONTROLS::m_cursorPos`, in world units: where the pointer last
   * was over the canvas, and (0, 0) — the footprint's anchor — before it has
   * ever been there, which is why KiCad's chooser opens with the crosshair
   * sitting on pad 1. It is not cleared on leave; upstream keeps the last
   * position too.
   */
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const viewRef = useRef<PreviewView | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const footprintNow = fpRef.current;
    if (!canvas || !footprintNow) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The panel is a pcbnew canvas, so it clears to LAYER_PCB_BACKGROUND
    // before painting (the raster itself stays transparent).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PCB_BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scene = buildScene(footprintToBoard(footprintNow), {
      // `PAD::GetOwnClearance` is "if this board has a DRC engine ask it, else
      // 0" (board_connected_item.cpp:121-130) and the preview's `m_dummyBoard`
      // is a bare `new BOARD()` with none, so every pad's clearance here is 0
      // and `draw( const PAD* )` skips the outline (`clearance > 0`,
      // pcb_painter.cpp:1974). Ours drew a ring round every pad that pcbnew's
      // preview does not have.
      clearanceForNet: () => 0,
    });
    const w = canvas.width;
    const h = canvas.height;
    // `fitToCurrentFootprint` (pcbnew/footprint_preview_panel.cpp):
    //
    //     bool  includeText = m_currentFootprint->TextOnly();
    //     BOX2I bbox = m_currentFootprint->GetBoundingBox( includeText );
    //
    // — the FOOTPRINT's own box, and with its **text excluded** unless the
    // footprint is nothing but text. This used `scene.bbox`, the whole board's,
    // so the value on F.Fab (`D_DO-41_SOD81_P10.16mm_Horizontal`, three times
    // wider than the part) was inside the box being fitted and the footprint
    // came out small and pushed off-centre.
    const b = footprintBBox(footprintNow, footprintTextOnly(footprintNow));
    if (!b) return;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    // SetViewport(bbox) then `SetScale(GetScale() * 0.7)` for the margin.
    const fitScale = Math.min(w / bw, h / bh) * 0.7;
    const view = viewRef.current ?? {
      scale: fitScale,
      tx: w / 2 - ((b.minX + b.maxX) / 2) * fitScale,
      ty: h / 2 - ((b.minY + b.maxY) / 2) * fitScale,
    };
    viewRef.current = view;
    // `FOOTPRINT_PREVIEW_PANEL::New` turns the grid on and sizes it from
    // pcbnew's own window settings — `panel->GetGAL()->SetGridVisibility(
    // gridCfg.show )` and `SetGridSize( gridCfg.grids[last_size_idx] )` off
    // `PCBNEW_SETTINGS::m_Window.grid`, whose defaults are `show = true`
    // (app_settings.cpp:555-556) and index 15 of the non-eeschema grid list,
    // 0.50 mm (app_settings.cpp:462-481) — which is `PCB_DEFAULT_GRID_IU`.
    // So the preview canvas is a dotted board grid, and ours had none at all.
    drawGrid(ctx, view, w, h, pcbGridOptions({ show: true, devicePixelRatio: dpr }));
    drawBoard(ctx, scene, view, ALL_LAYERS, w, h, {
      ...DEFAULT_DRAW_OPTIONS,
      drawingSheet: false,
    });
    // `PCB_PAINTER::draw( const FOOTPRINT*, LAYER_ANCHOR )` — the 5 px cross
    // in the anchor colour at the footprint origin. The editor runs this pass
    // after the board; the preview never did, so the anchor KiCad's chooser
    // shows on pad 1 was missing here.
    drawAnchors(ctx, scene, view, ALL_LAYERS, w, h, DEFAULT_DRAW_OPTIONS, 'none', dpr);
    // `blitCursor`: this panel runs no tool, so `m_isCursorEnabled` is never
    // set and the crosshair is there only through `m_forceDisplayCursor` —
    // "Always show crosshairs", `window.cursor.always_show_cursor`, default
    // TRUE (app_settings.cpp:564-565) — at `GetCursorPosition()`, the pointer
    // snapped to the panel's grid (`m_snappingEnabled` is constructed true).
    const cur = cursorRef.current;
    const g = PCB_DEFAULT_GRID_IU;
    const snapped = { x: Math.round(cur.x / g) * g, y: Math.round(cur.y / g) * g };
    const cursorPrefs = settings.pcbnew.window.cursor;
    drawCrosshair(
      ctx,
      { x: snapped.x * view.scale + view.tx, y: snapped.y * view.scale + view.ty },
      w,
      h,
      {
        mode: cursorPrefs.crosshair,
        color: PCB_CURSOR,
        toolWantsCursor: false,
        alwaysShow: cursorPrefs.always_show_cursor,
        devicePixelRatio: dpr,
      },
    );
  }, []);

  const viewCtl = usePreviewViewControls(canvasRef, draw, inputPrefs, viewRef);

  /** `onMotion` — `m_cursorPos = m_view->ToWorld( event position )`. */
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (canvas && view) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cursorRef.current = {
        x: ((e.clientX - rect.left) * dpr - view.tx) / view.scale,
        y: ((e.clientY - rect.top) * dpr - view.ty) / view.scale,
      };
      draw();
    }
    viewCtl.handlers.onPointerMove(e);
  };

  // A newly displayed footprint refits, and so does a resize (onSize).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fp triggers the refit
  useEffect(() => {
    viewRef.current = null;
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      viewRef.current = null;
      draw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fp, draw]);

  return (
    <div className="ze-fp-preview">
      {fp && footprint ? (
        <canvas
          ref={canvasRef}
          className="ze-fp-canvas"
          onWheel={viewCtl.handlers.onWheel}
          onPointerDown={viewCtl.handlers.onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={viewCtl.handlers.onPointerUp}
          onPointerCancel={viewCtl.handlers.onPointerUp}
          onContextMenu={viewCtl.handlers.onContextMenu}
        />
      ) : (
        <div className="ze-muted">
          {!footprint || status !== 'missing' ? statusText : 'Footprint not found.'}
        </div>
      )}
    </div>
  );
}
