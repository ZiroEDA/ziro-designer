// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window's half of the render worker (not KiCad's), for the board editor (`?rw=0` turns it off).
 *
 * Once the worker has drawn the board, the window's PCB_DRAW_PANEL_GAL turns transparent and
 * its VIEW overlay-only: it keeps the items for the tools' hit tests and draws the overlay - the
 * ratsnest, previews, the cursor - while render_worker.ts draws the board, grid, background and
 * the selection on a canvas under it. Until then (the board text is written and parsed first)
 * the window draws the board itself, as without the worker.
 * Each board the panel displays starts a session: a fresh canvas and worker, the board's text,
 * the window's settings and view, and from then on RENDER_VIEW_MIRROR's batches and the view
 * whenever it moves.
 */
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import type { BOARD } from '../board.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';
import type { PCB_PAINTER } from '../pcb_painter.js';
import {
  CTL_ENUMERATE_LAYERS,
  CTL_FOR_BOARD,
  FormatBoardAsync,
} from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { RENDER_VIEW_MIRROR, snapshotRenderSettings } from './render_mirror.js';
import type {
  RENDER_VIEW_STATE,
  RENDER_WORKER_MESSAGE,
  RENDER_WORKER_REQUEST,
} from './render_worker.js';

/**
 * Draw the board on the render worker - the default wherever the browser can hand a canvas to a
 * worker. `?rw=0` in the address, or `ze.renderWorker` = `0` in this browser's storage, draws it
 * in the window instead.
 */
export function RenderWorkerEnabled(): boolean {
  if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') return false;

  if (typeof location !== 'undefined') {
    const rw = new URLSearchParams(location.search).get('rw');

    if (rw !== null) return rw !== '0';
  }

  try {
    return localStorage.getItem('ze.renderWorker') !== '0';
  } catch {
    return true;
  }
}

export interface RENDER_WORKER_HOST_ENV {
  commonSettings(): COMMON_SETTINGS_LIKE;
}

/** What the frame answers about its project, when it is the board editor. */
interface PROJECT_TEXTS {
  GetProjectText?(): string | null;
  GetDesignRulesText?(): string | null;
  GetDesignRulesPath?(): string;
}

/** The plain fields of an object, for a message. */
function plainFields(aObject: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(aObject)) {
    if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) out[k] = v;
  }

  return out;
}

export class RENDER_WORKER_HOST {
  private readonly m_panel: PCB_DRAW_PANEL_GAL;
  private readonly m_frame: PCB_BASE_FRAME;
  private readonly m_canvas: HTMLCanvasElement;
  private readonly m_env: RENDER_WORKER_HOST_ENV;
  private m_worker: Worker | null = null;
  private m_workerCanvas: HTMLCanvasElement | null = null;
  private m_destroyed = false;
  private m_viewLoop = 0;
  private m_lastView = '';
  private m_session = 0;

  constructor(
    aPanel: PCB_DRAW_PANEL_GAL,
    aFrame: PCB_BASE_FRAME,
    aCanvas: HTMLCanvasElement,
    aEnv: RENDER_WORKER_HOST_ENV,
  ) {
    this.m_panel = aPanel;
    this.m_frame = aFrame;
    this.m_canvas = aCanvas;
    this.m_env = aEnv;

    aPanel.SetOnDisplayBoard((b) => void this.start(b));

    // The window's canvas draws over the worker's.
    aCanvas.style.position = 'relative';
    aCanvas.style.zIndex = '1';
  }

  /** The view as the worker must draw it, read off the window's panel. */
  private viewState(): RENDER_VIEW_STATE {
    const view = this.m_panel.GetView();
    const gal = this.m_panel.GetGAL()!;
    const size = this.m_panel.GetClientSize();

    return {
      center: { ...view.GetCenter() },
      scale: view.GetScale(),
      mirrorX: view.IsMirroredX(),
      mirrorY: view.IsMirroredY(),
      width: size.x,
      height: size.y,
      grid: {
        size: { ...gal.GetGridSize() },
        origin: { ...gal.GetGridOrigin() },
        visible: gal.GetGridVisibility(),
      },
      gal: plainFields(this.m_frame.GetGalDisplayOptions()),
    };
  }

  /** A session for \a aBoard: the last one's worker and canvas go. */
  private async start(aBoard: BOARD): Promise<void> {
    const session = ++this.m_session;

    this.stop();

    const view = this.m_panel.GetView();
    const painter = view.GetPainter() as PCB_PAINTER;

    // Until this session's worker has drawn the board, the window draws it: a board opened
    // while the last worker was drawing went into a view that cached nothing.
    if (view.IsOverlayOnly()) {
      view.SetOverlayOnly(false);
      this.m_panel.SetTransparent(false);
      view.RecacheAllItems();
    }

    // The VIEW's own adds are done before the worker hears of anything; from now on it hears all.
    view.UpdateItems();

    const worker = new Worker(new URL('./render_worker.ts', import.meta.url), { type: 'module' });
    const mirror = new RENDER_VIEW_MIRROR(
      aBoard,
      () => painter.GetSettings(),
      (batch) => worker.postMessage({ t: 'batch', batch } satisfies RENDER_WORKER_REQUEST),
      () => (this.m_frame as PCB_BASE_FRAME & PROJECT_TEXTS).GetProjectText?.() ?? null,
    );

    view.SetRemoteView(mirror);
    this.m_worker = worker;

    worker.onmessage = (e: MessageEvent<RENDER_WORKER_MESSAGE>): void => {
      if (e.data.t === 'error') console.error('render worker:', e.data.message);
      else if (e.data.t === 'ready' && session === this.m_session) {
        console.info(
          `render worker: board drawn (load ${e.data.loadMs.toFixed(0)} ms, first draw ${e.data.firstDrawMs.toFixed(0)} ms)`,
        );
        // The worker draws the board from now on: the window keeps the overlay, and records the
        // layers the worker draws for it.
        view.SetOverlayOnly(true);
        view.MarkDirty();
        this.m_panel.SetTransparent(true);
      }
    };

    worker.onerror = (e: ErrorEvent): void =>
      console.error('render worker failed:', e.message || 'could not load', e.filename, e.lineno);

    // Under the window's canvas, the same box.
    const wc = document.createElement('canvas');
    wc.style.position = 'absolute';
    wc.style.left = '0';
    wc.style.top = '0';
    wc.style.pointerEvents = 'none';
    wc.style.zIndex = '0';
    this.m_canvas.parentElement!.insertBefore(wc, this.m_canvas);
    this.matchCanvasBox(wc);
    this.m_workerCanvas = wc;

    const offscreen = wc.transferControlToOffscreen();

    // A transport, as the DRC and fill jobs' board text; edits made while it is written reach
    // the worker as batches, which it holds until the board is in.
    const boardText = await FormatBoardAsync(
      aBoard,
      () => new Promise((r) => setTimeout(r, 0)),
      () => session !== this.m_session,
      undefined,
      undefined,
      CTL_FOR_BOARD | CTL_ENUMERATE_LAYERS,
    );

    if (boardText === null || session !== this.m_session) return;

    const cs = this.m_frame.GetColorSettings();
    const colors: [number, Color4d][] = [];

    // Every VIEW layer, the GAL's (zone fills, pad and via copper, overlays) as well as the board's.
    for (let layer = 0; layer < VIEW.VIEW_MAX_LAYERS; layer++)
      colors.push([layer, cs.GetColor(layer)]);

    const layers: [number, boolean, number][] = [];

    for (let layer = 0; layer < VIEW.VIEW_MAX_LAYERS; layer++) {
      let order: number;

      try {
        order = view.GetLayerOrder(layer);
      } catch {
        continue; // not a layer of this view
      }

      layers.push([layer, view.IsLayerVisible(layer), order]);
    }

    const frame = this.m_frame as PCB_BASE_FRAME & PROJECT_TEXTS;
    const state = this.viewState();

    worker.postMessage(
      {
        t: 'init',
        canvas: offscreen,
        boardText,
        boardPath: aBoard.GetFileName(),
        boardUuid: aBoard.m_Uuid,
        projectText: frame.GetProjectText?.() ?? null,
        rulesText: frame.GetDesignRulesText?.() ?? null,
        rulesPath: frame.GetDesignRulesPath?.() ?? '',
        // Data only: the window's object also carries accessors, which do not cross.
        commonSettings: JSON.parse(JSON.stringify(this.m_env.commonSettings())),
        pcbnewSettings: {
          display: structuredClone({ ...this.m_frame.GetPcbNewSettings().m_Display }),
          viewersDisplay: structuredClone({ ...this.m_frame.GetPcbNewSettings().m_ViewersDisplay }),
          showPageLimits: this.m_frame.GetPcbNewSettings().m_ShowPageLimits,
        },
        colorTheme: { name: cs.GetFilename(), colors },
        renderSettings: snapshotRenderSettings(painter.GetSettings()),
        galOptions: plainFields(this.m_frame.GetGalDisplayOptions()),
        layers,
        view: state,
      } satisfies RENDER_WORKER_REQUEST,
      [offscreen],
    );

    this.m_lastView = JSON.stringify(state);

    // The view, whenever it moves.
    const loop = (): void => {
      if (session !== this.m_session) return;

      this.matchCanvasBox(wc);

      const next = this.viewState();
      const key = JSON.stringify(next);

      if (key !== this.m_lastView) {
        this.m_lastView = key;
        worker.postMessage({ t: 'view', view: next } satisfies RENDER_WORKER_REQUEST);
      }

      this.m_viewLoop = requestAnimationFrame(loop);
    };

    this.m_viewLoop = requestAnimationFrame(loop);
  }

  /**
   * The worker sizes its backing store as the panel sizes the window's (onSize's +1); the element
   * takes the window canvas's CSS box, so a device pixel stays a device pixel. Any other box and
   * the browser resamples the image, which blurs and fades every one-pixel line.
   */
  private matchCanvasBox(aCanvas: HTMLCanvasElement): void {
    const { width, height } = this.m_canvas.style;

    if (aCanvas.style.width !== width) aCanvas.style.width = width;
    if (aCanvas.style.height !== height) aCanvas.style.height = height;
  }

  private stop(): void {
    cancelAnimationFrame(this.m_viewLoop);
    this.m_panel.GetView().SetRemoteView(null);
    this.m_worker?.terminate();
    this.m_worker = null;
    this.m_workerCanvas?.remove();
    this.m_workerCanvas = null;
  }

  /**
   * The panel goes: so does the worker. Once: a lost context destroys it ahead of the panel, and
   * the window's cleanup asks again after the panel's view is gone.
   */
  Destroy(): void {
    if (this.m_destroyed) return;

    this.m_destroyed = true;
    this.m_session++;
    this.stop();
    this.m_panel.SetOnDisplayBoard(null);
  }
}
