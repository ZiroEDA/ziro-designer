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
import type { PcbFootprint } from '@ziroeda/pcbnew';
import { usePreviewViewControls, type PreviewView } from './preview_view_controls.js';
import type { InputPrefs } from '../ui/view_controls.js';
import { buildScene, drawBoard, DEFAULT_DRAW_OPTIONS } from '../editors/pcb/renderBoard.js';
import { PCB_BACKGROUND } from '../editors/pcb/pcbTheme.js';
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
    const scene = buildScene(footprintToBoard(footprintNow));
    const b = scene.bbox;
    const w = canvas.width;
    const h = canvas.height;
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
    drawBoard(ctx, scene, view, ALL_LAYERS, w, h, {
      ...DEFAULT_DRAW_OPTIONS,
      drawingSheet: false,
    });
  }, []);

  const viewCtl = usePreviewViewControls(canvasRef, draw, inputPrefs, viewRef);

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
          onPointerMove={viewCtl.handlers.onPointerMove}
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
