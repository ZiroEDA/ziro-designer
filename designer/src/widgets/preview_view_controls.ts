// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Mouse zoom/pan for the small preview canvases (symbol chooser, footprint
 * chooser, CVPCB's viewer).
 *
 * Upstream these panes are real GAL canvases, SYMBOL_PREVIEW_WIDGET hosts a
 * SCH_PREVIEW_PANEL and FOOTPRINT_PREVIEW_WIDGET a FOOTPRINT_PREVIEW_PANEL,
 * both EDA_DRAW_PANEL_GALs, so they get WX_VIEW_CONTROLS for free: the wheel
 * zooms about the cursor (`VIEW::SetScale(scale * exp(…), ToWorld(cursor))`)
 * and a middle/right drag pans, exactly as on the editor canvas. The view is
 * refit whenever the pane is resized or the displayed item changes
 * (SYMBOL_PREVIEW_WIDGET::onSize / fitOnDrawArea,
 * FOOTPRINT_PREVIEW_PANEL::onSize / fitToCurrentFootprint).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { InputPrefs } from '../ui/view_controls.js';
import { commonInputPrefs } from '../ui/view_controls.js';

/** A canvas transform in device pixels: world -> screen. */
export interface PreviewView {
  scale: number;
  tx: number;
  ty: number;
}

/** VIEW::SetScale's limits, so a preview can't be zoomed into nothing. */
const MIN_SCALE_FACTOR = 0.02;
const MAX_SCALE_FACTOR = 200;

export interface PreviewViewControls {
  /** The current transform, or null while the next draw should refit. */
  viewRef: React.MutableRefObject<PreviewView | null>;
  /** Drop the transform so the next draw refits (a new item was displayed). */
  resetToFit: () => void;
  /** Attach to the canvas element. */
  handlers: {
    onWheel: (e: React.WheelEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
}

const dpr = (): number => window.devicePixelRatio || 1;

/**
 * `redraw` is called after every view change; `fitScale` reports the scale the
 * last fit produced, so zoom limits stay relative to the fitted view the way
 * VIEW's min/max scale do.
 */
export function usePreviewViewControls(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  redraw: () => void,
  inputPrefs?: InputPrefs,
  /** The caller's view ref, so its draw callback can read the transform
   *  without depending on this hook's return value. */
  externalViewRef?: React.MutableRefObject<PreviewView | null>,
): PreviewViewControls {
  // Read once per mount, like WX_VIEW_CONTROLS' LoadSettings.
  const prefs = useMemo(() => inputPrefs ?? commonInputPrefs(), [inputPrefs]);
  const ownViewRef = useRef<PreviewView | null>(null);
  const viewRef = externalViewRef ?? ownViewRef;
  const fitScaleRef = useRef(0);
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  // The scale the current fit settled on, tracked so zoom stays bounded around
  // it however large or small the item is.
  useEffect(() => {
    if (viewRef.current && fitScaleRef.current === 0) fitScaleRef.current = viewRef.current.scale;
  });

  const resetToFit = useCallback(() => {
    viewRef.current = null;
    fitScaleRef.current = 0;
    redraw();
  }, [redraw, viewRef]);

  /** SetScale(scale * factor, anchor): keep the world point under the cursor. */
  const zoomAbout = useCallback(
    (px: number, py: number, factor: number) => {
      const view = viewRef.current;
      if (!view) return;
      if (fitScaleRef.current === 0) fitScaleRef.current = view.scale;
      const min = fitScaleRef.current * MIN_SCALE_FACTOR;
      const max = fitScaleRef.current * MAX_SCALE_FACTOR;
      const scale = Math.max(min, Math.min(max, view.scale * factor));
      const k = scale / view.scale;
      viewRef.current = {
        scale,
        tx: px - (px - view.tx) * k,
        ty: py - (py - view.ty) * k,
      };
      redraw();
    },
    [redraw, viewRef],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !viewRef.current) return;
      const mod: 'none' | 'ctrl' | 'shift' | 'alt' =
        e.ctrlKey || e.metaKey ? 'ctrl' : e.shiftKey ? 'shift' : e.altKey ? 'alt' : 'none';
      const delta = e.deltaY;
      const view = viewRef.current;

      // The pan modifiers work here too (PANEL_MOUSE_SETTINGS applies to every
      // GAL canvas, previews included).
      if (mod === prefs.scrollModPanV && prefs.scrollModPanV !== prefs.scrollModZoom) {
        viewRef.current = { ...view, ty: view.ty - delta * dpr() };
        redraw();
        return;
      }
      if (mod === prefs.scrollModPanH && prefs.scrollModPanH !== prefs.scrollModZoom) {
        const d = prefs.reverseScrollPanH ? -delta : delta;
        viewRef.current = { ...view, tx: view.tx - d * dpr() };
        redraw();
        return;
      }
      if (mod !== prefs.scrollModZoom) return;

      const rect = canvas.getBoundingClientRect();
      const speed = prefs.zoomSpeedAuto ? 1 : prefs.zoomSpeed / 5;
      const dir = prefs.reverseZoom ? 1 : -1;
      zoomAbout(
        (e.clientX - rect.left) * dpr(),
        (e.clientY - rect.top) * dpr(),
        Math.exp(dir * delta * 0.001 * speed),
      );
    },
    [canvasRef, prefs, redraw, zoomAbout, viewRef],
  );

  // Middle / right drag pans (m_dragMiddle / m_dragRight default to PAN); the
  // preview has no selection tool, so a left drag does nothing.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const wantsPan =
        (e.button === 1 && prefs.mouseMiddle === 'pan') ||
        (e.button === 2 && prefs.mouseRight === 'pan');
      if (!wantsPan || !viewRef.current) return;
      e.preventDefault();
      panRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [prefs, viewRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pan = panRef.current;
      const view = viewRef.current;
      if (!pan || !view || pan.pointerId !== e.pointerId) return;
      viewRef.current = {
        ...view,
        tx: view.tx + (e.clientX - pan.x) * dpr(),
        ty: view.ty + (e.clientY - pan.y) * dpr(),
      };
      panRef.current = { ...pan, x: e.clientX, y: e.clientY };
      redraw();
    },
    [redraw, viewRef],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (panRef.current?.pointerId !== e.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    panRef.current = null;
  }, []);

  // A right-drag pan must not raise the browser menu.
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (prefs.mouseRight === 'pan') e.preventDefault();
    },
    [prefs],
  );

  return {
    viewRef,
    resetToFit,
    handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onContextMenu },
  };
}
