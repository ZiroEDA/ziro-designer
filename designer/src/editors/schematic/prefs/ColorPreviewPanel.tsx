// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The right-hand half of Preferences > Colors — `m_preview`, a
 * `SCH_PREVIEW_PANEL` (`eeschema/dialogs/panel_eeschema_color_settings.cpp:218-227`).
 *
 * Upstream it is a real `EDA_DRAW_PANEL_GAL`: a KIGFX::VIEW over the sample
 * items `createPreviewItems` builds, painted by the editor's own painter with
 * the COLOR_SETTINGS being edited. That is why changing a colour on the left
 * repaints the right (`updatePreview`, `:490`) and why the preview zooms and
 * pans under the mouse like any other canvas.
 *
 * Ours is the same three things: `COLOR_PREVIEW_SCHEMATIC` is that document,
 * `renderSchematic` is that painter, and `wheelAction` is
 * `WX_VIEW_CONTROLS::onWheel` — the one this app already steers every canvas
 * with, so the preview obeys the same Mouse and Touchpad preferences the
 * editors do rather than a wheel rule invented here.
 */
import { useEffect, useRef, type JSX } from 'react';
import { DEFAULT_RENDER_OPTS, renderSchematic, paperSizeIU } from '../render/renderer.js';
import type { RenderOpts, Viewport } from '../render/renderer.js';
import { commonInputPrefs, wheelAction } from '../../../ui/view_controls.js';
import { COLOR_PREVIEW_SCHEMATIC, COLOR_PREVIEW_SELECTION } from './color_preview_schematic.js';
import type { Theme } from '../theme.js';

/**
 * `zoomFitPreview` (`panel_eeschema_color_settings.cpp:507-526`):
 *
 *     VECTOR2I psize( m_page->GetWidthIU(), m_page->GetHeightIU() );
 *     double scale = view->GetScale() / max( |psize.x / screenSize.x|,
 *                                            |psize.y / screenSize.y| );
 *     view->SetScale( scale * m_galDisplayOptions.m_scaleFactor * 0.8 );
 *     view->SetCenter( m_drawingSheet->ViewBBox().Centre() );
 *
 * The PAGE is what is fitted — not the items — with a 0.8 margin, centred on
 * the drawing sheet, which is the page rectangle. `m_scaleFactor` is the GAL's
 * DPI scale and is 1 here for the same reason the canvas is sized in device
 * pixels below.
 */
function zoomFitPreview(width: number, height: number): Viewport {
  const page = paperSizeIU(COLOR_PREVIEW_SCHEMATIC.paper);
  // The document is a literal in this module; a paper it cannot parse is a
  // transcription bug, not a state to render around.
  if (!page) return { scale: 1, offsetX: 0, offsetY: 0 };

  const scale = 0.8 / Math.max(page.w / width, page.h / height);
  return {
    scale,
    offsetX: width / 2 - (page.w / 2) * scale,
    offsetY: height / 2 - (page.h / 2) * scale,
  };
}

/**
 * The preview items are added straight to a `KIGFX::VIEW`
 * (`panel_eeschema_color_settings.cpp:266-270`), never to a SCH_SCREEN, so
 * `SCH_ITEM::Connection()` is null for every one of them — which is why KiCad's
 * `GLOBAL[0..3]` is LAYER_GLOBLABEL's dark red and not the bus blue a connected
 * bus-vector label would take.
 */
const PREVIEW_OPTS: RenderOpts = {
  ...DEFAULT_RENDER_OPTS,
  connectivity: false,
  /**
   * `SCH_RENDER_SETTINGS::m_ShowHiddenFields` is true by construction
   * (`sch_render_settings.cpp:40`), and the preview panel overrides only
   * `m_IsSymbolEditor`. In the EDITOR the painter reads the preference instead
   * — `m_schematic ? eeconfig()->m_Appearance.show_hidden_fields : …` — which
   * is why an ordinary schematic hides what this page shows.
   */
  showHiddenFields: true,
};

export function ColorPreviewPanel({ theme }: { theme: Theme }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /**
   * The VIEW's own state, which outlives a repaint: `updatePreview` refreshes
   * without touching the scale, so changing a colour must not throw away a
   * zoom the user made. Only `OnSize` refits (`:528-531`).
   */
  const viewRef = useRef<Viewport | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  // The theme is read inside handlers that are bound once, so it goes through
  // a ref rather than being closed over.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    const paint = (): void => {
      const { w, h } = sizeRef.current;
      const view = viewRef.current;
      if (!view || w === 0 || h === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // A canvas is sized in device pixels and laid out in CSS ones; without
      // the ratio the preview is soft on any HiDPI screen.
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderSchematic(
        ctx,
        COLOR_PREVIEW_SCHEMATIC,
        view,
        themeRef.current,
        w,
        h,
        COLOR_PREVIEW_SELECTION,
        undefined,
        PREVIEW_OPTS,
      );
    };

    const resize = (): void => {
      const w = Math.max(1, Math.round(box.clientWidth));
      const h = Math.max(1, Math.round(box.clientHeight));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h };
      // `OnSize` calls zoomFitPreview, so a resize discards the user's view.
      viewRef.current = zoomFitPreview(w, h);
      paint();
    };

    const onWheel = (e: WheelEvent): void => {
      const { w, h } = sizeRef.current;
      const view = viewRef.current;
      if (!view) return;
      const action = wheelAction(e, commonInputPrefs(), { width: w, height: h });
      if (action.kind === 'none') return;
      e.preventDefault();

      if (action.kind === 'pan') {
        viewRef.current = {
          ...view,
          offsetX: view.offsetX + action.dx,
          offsetY: view.offsetY + action.dy,
        };
      } else {
        // `VIEW::SetScale( scale, aAnchor )` keeps the anchor — the cursor —
        // over the same world point (view.cpp:530-540).
        const rect = box.getBoundingClientRect();
        const ax = e.clientX - rect.left;
        const ay = e.clientY - rect.top;
        viewRef.current = {
          scale: view.scale * action.factor,
          offsetX: ax - (ax - view.offsetX) * action.factor,
          offsetY: ay - (ay - view.offsetY) * action.factor,
        };
      }
      paint();
    };

    /** `WX_VIEW_CONTROLS`' middle-drag pan (wx_view_controls.cpp:264-289). */
    let panFrom: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 1) return;
      e.preventDefault();
      panFrom = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent): void => {
      const view = viewRef.current;
      if (!panFrom || !view) return;
      viewRef.current = {
        ...view,
        offsetX: view.offsetX + (e.clientX - panFrom.x),
        offsetY: view.offsetY + (e.clientY - panFrom.y),
      };
      panFrom = { x: e.clientX, y: e.clientY };
      paint();
    };
    const onPointerUp = (): void => {
      panFrom = null;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  // `updatePreview()` — `view->UpdateAllItems( KIGFX::COLOR )` and a refresh,
  // with no change to the view.
  useEffect(() => {
    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    const view = viewRef.current;
    if (!canvas || !view || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderSchematic(
      ctx,
      COLOR_PREVIEW_SCHEMATIC,
      view,
      theme,
      w,
      h,
      COLOR_PREVIEW_SELECTION,
      undefined,
      PREVIEW_OPTS,
    );
  }, [theme]);

  return (
    <div className="ze-colorpreview" ref={boxRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
