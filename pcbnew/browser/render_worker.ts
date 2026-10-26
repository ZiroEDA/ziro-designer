// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The render worker (not KiCad's): `PCB_DRAW_PANEL_GAL` - VIEW, PCB_PAINTER and OPENGL_GAL - on
 * an OffscreenCanvas, in a worker, over its own copy of the board.
 *
 * KiCad draws on its GUI thread and gets away with it in C++. In a browser the window's thread
 * is also the menus', the panels' and the cursor's, so every redraw that takes longer than a
 * frame freezes all of them. Here the board, its grid and its background are drawn on this
 * thread instead, under the window's own canvas, which keeps only the overlay (render_mirror.ts):
 *
 * - `init`: the board as the DRC job loads it (the editor's own load, project and rules), the
 *   window's settings - common, pcbnew, the colour theme as the colour of every layer, the
 *   painter's render settings, the GAL's display options - and its view's layer state.
 * - `view`: the window's view, each frame it changes - centre, scale, mirror, size, grid.
 * - `batch`: what the window's VIEW did (RENDER_VIEW_BATCH).
 */
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import {
  type COMMON_SETTINGS_LIKE,
  PGM_BASE,
  SETTINGS_MANAGER,
  SetPgm,
} from '@ziroeda/common/pgm_base.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { loadBitmapFontImage } from '@ziroeda/common/gal/gal_window.js';
import type { DRAW_PANEL_GAL_WINDOW } from '@ziroeda/common/draw_panel_gal.js';
import { LAYER_SELECT_OVERLAY } from '@ziroeda/common/layer_id.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import { boardDrawingSheet, PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';
import type { PCB_PAINTER } from '../pcb_painter.js';
import { PCBNEW_SETTINGS } from '../pcbnew_settings.js';
import { ApplyProjectToBoard, type DRC_JOB_REQUEST, loadBoardForDrc } from './drc_job.js';
import { DRC_ENGINE } from '../drc/drc_engine.js';
import { wxInitAllImageHandlers } from '@ziroeda/wx/wx_image.js';
import {
  ApplyRenderViewBatch,
  RECORDED_LAYERS,
  type RENDER_VIEW_BATCH,
  applyRenderSettings,
} from './render_mirror.js';

/** The fields of PCBNEW_SETTINGS the painter reads, as plain data. */
export interface RENDER_PCBNEW_SETTINGS {
  display: object;
  viewersDisplay: object;
  showPageLimits: boolean;
}

/** The window's view, as the worker's must match it. */
export interface RENDER_VIEW_STATE {
  center: Vec2;
  scale: number;
  mirrorX: boolean;
  mirrorY: boolean;
  /** The canvas's client size, CSS pixels. */
  width: number;
  height: number;
  grid: { size: Vec2; origin: Vec2; visible: boolean };
  /** The window's GAL_DISPLAY_OPTIONS fields: grid style, antialiasing, ... (Preferences). */
  gal: Record<string, unknown>;
}

export type RENDER_WORKER_REQUEST =
  | ({
      t: 'init';
      canvas: OffscreenCanvas;
      /** The window's `Pgm().GetCommonSettings()`, as plain data. */
      commonSettings: COMMON_SETTINGS_LIKE;
      /** What the painter reads of the window's PCBNEW_SETTINGS (`pcbconfig()`). */
      pcbnewSettings: RENDER_PCBNEW_SETTINGS;
      /** The colour theme the window paints with: its name and every layer's colour. */
      colorTheme: { name: string; colors: [number, Color4d][] };
      /** PCB_RENDER_SETTINGS, as `snapshotRenderSettings` writes it. */
      renderSettings: Record<string, unknown>;
      /** The window's GAL_DISPLAY_OPTIONS fields. */
      galOptions: Record<string, unknown>;
      /** The window's VIEW layers: [id, visible, rendering order]. */
      layers: [number, boolean, number][];
      view: RENDER_VIEW_STATE;
    } & Pick<
      DRC_JOB_REQUEST,
      'boardText' | 'boardPath' | 'boardUuid' | 'projectText' | 'rulesText' | 'rulesPath'
    >)
  | { t: 'view'; view: RENDER_VIEW_STATE }
  | { t: 'batch'; batch: RENDER_VIEW_BATCH };

export type RENDER_WORKER_MESSAGE =
  | { t: 'ready'; loadMs: number; firstDrawMs: number }
  | { t: 'error'; message: string };

/**
 * The OffscreenCanvas as the panel's `wxGLCanvas`: what it reads of a DOM canvas - its size,
 * being shown, a style for the cursor - answered from the last size the window posted.
 */
function canvasShim(aCanvas: OffscreenCanvas, aSize: { w: number; h: number }): HTMLCanvasElement {
  const style: Record<string, string> = {};

  return Object.assign(aCanvas, {
    get clientWidth() {
      return aSize.w;
    },
    get clientHeight() {
      return aSize.h;
    },
    isConnected: true,
    // No DOM events reach a worker: EDA_DRAW_PANEL_GAL binds none when there is no listener API.
    addEventListener: undefined,
    parentElement: null,
    style,
    focus: () => {},
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: aSize.w, height: aSize.h }),
  }) as unknown as HTMLCanvasElement;
}

interface WorkerScope {
  postMessage(aMessage: RENDER_WORKER_MESSAGE): void;
  onmessage: ((e: MessageEvent<RENDER_WORKER_REQUEST>) => void) | null;
}

const g = globalThis as unknown as { WorkerGlobalScope?: unknown };

if (g.WorkerGlobalScope !== undefined) {
  const scope = globalThis as unknown as WorkerScope;
  const size = { w: 1, h: 1 };
  let panel: PCB_DRAW_PANEL_GAL | null = null;
  let board: BOARD | null = null;
  // Messages that arrive while the board loads wait for it.
  let pending: RENDER_WORKER_REQUEST[] | null = [];
  let options: GAL_DISPLAY_OPTIONS | null = null;
  /** What the board was loaded with, for a project reloaded later. */
  const project = { boardPath: '', rulesText: null as string | null, rulesPath: '' };
  let lastGal = '';

  /**
   * What EDA_DRAW_PANEL_GAL::onSize does to the canvas and the GAL, unconditionally: onSize itself
   * returns early when the GAL already has the client size, which a GAL built at that size does -
   * and then the OffscreenCanvas keeps its 300 x 150 backing store. The +1 is onSize's own.
   */
  const resize = (): void => {
    const p = panel! as unknown as { resizeBackingStore(w: number, h: number): boolean };
    const w = Math.max(10, size.w + 1);
    const h = Math.max(10, size.h + 1);

    p.resizeBackingStore(w, h);
    panel!.GetGAL()!.ResizeScreen(w, h);
    panel!.GetView().MarkDirty();
  };

  const applyView = (aView: RENDER_VIEW_STATE): void => {
    const p = panel!;
    const view = p.GetView();
    const gal = p.GetGAL()!;

    if (aView.width !== size.w || aView.height !== size.h) {
      size.w = aView.width;
      size.h = aView.height;
      resize();
    }

    // GAL_DISPLAY_OPTIONS::NotifyChanged, as the window's options did when the user changed them.
    const galKey = JSON.stringify(aView.gal);

    if (galKey !== lastGal) {
      lastGal = galKey;
      Object.assign(options!, aView.gal);
      options!.NotifyChanged();
    }

    gal.SetGridSize(aView.grid.size);
    gal.SetGridOrigin(aView.grid.origin);
    gal.SetGridVisibility(aView.grid.visible);
    view.SetMirror(aView.mirrorX, aView.mirrorY);
    view.SetScale(aView.scale);
    view.SetCenter(aView.center);
  };

  const handle = (msg: RENDER_WORKER_REQUEST): void => {
    if (!panel || !board) return;

    if (msg.t === 'view') applyView(msg.view);
    else if (msg.t === 'batch') {
      const painter = panel.GetView().GetPainter() as PCB_PAINTER;
      ApplyRenderViewBatch(board, panel.GetView(), painter.GetSettings(), msg.batch, {
        sheetChanged: () => {
          // The sheet reads the board's page and title block, which changed in place.
          const sheet = panel!.GetDrawingSheet();

          if (sheet) panel!.GetView().Update(sheet);
        },
        projectChanged: (aText) => {
          // As the board was loaded: the project, then the rule engine clearances are read through.
          ApplyProjectToBoard(board!, project.boardPath, aText);

          const engine = new DRC_ENGINE(board!, board!.GetDesignSettings());

          board!.GetDesignSettings().m_DRCEngine = engine;
          engine.InitEngine(project.rulesText, project.rulesPath);
          board!.InitializeClearanceCache();
        },
      });
    }

    panel.Refresh();
  };

  const init = async (msg: Extract<RENDER_WORKER_REQUEST, { t: 'init' }>): Promise<void> => {
    await EMBEDDED_FILES.InitCodec();
    // The board's reference images decode as it is parsed; a worker is a program of its own.
    await wxInitAllImageHandlers();

    const font = await loadBitmapFontImage();
    const t0 = performance.now();

    // This realm's program object, with the window's settings and colour theme.
    const pgm = new PGM_BASE(null, new SETTINGS_MANAGER());
    pgm.SetCommonSettings(msg.commonSettings);
    SetPgm(pgm);

    const mgr = pgm.GetSettingsManager();
    const pcbnew = new PCBNEW_SETTINGS();
    Object.assign(pcbnew.m_Display, msg.pcbnewSettings.display);
    Object.assign(pcbnew.m_ViewersDisplay, msg.pcbnewSettings.viewersDisplay);
    pcbnew.m_ShowPageLimits = msg.pcbnewSettings.showPageLimits;
    mgr.RegisterSettings('pcbnew', pcbnew);

    const theme = mgr.AddNewColorSettings(msg.colorTheme.name);

    for (const [layer, color] of msg.colorTheme.colors) theme.SetColor(layer, color);

    pcbnew.m_ColorTheme = msg.colorTheme.name;

    board = loadBoardForDrc(msg);
    project.boardPath = msg.boardPath;
    project.rulesText = msg.rulesText;
    project.rulesPath = msg.rulesPath;

    size.w = msg.view.width;
    size.h = msg.view.height;

    options = new GAL_DISPLAY_OPTIONS();
    Object.assign(options, msg.galOptions);
    lastGal = JSON.stringify(msg.galOptions);

    const window: DRAW_PANEL_GAL_WINDOW = {
      canvas: canvasShim(msg.canvas, size),
      GetCursorCss: () => 'default',
      GetBitmapFontImage: () => font,
    };

    panel = new PCB_DRAW_PANEL_GAL(null, window, options);
    // The first wxEVT_SIZE: the canvas's backing store and the GAL's screen take the window's size.
    resize();
    panel.UpdateColors();

    panel.DisplayBoard(board);

    // The window's drawing sheet, built the same way (PCB_EDIT_FRAME::SetPageSettings). After
    // DisplayBoard, which clears the view (SetBoard's order). The worker has no frame: the
    // screen descriptions are EDA_DRAW_FRAME's empty ones, and the page is the first.
    panel.SetDrawingSheet(boardDrawingSheet(board, '', '', null));

    const view = panel.GetView();
    const painter = view.GetPainter() as PCB_PAINTER;
    applyRenderSettings(painter.GetSettings(), msg.renderSettings);

    // The window draws the overlay; this view only the selection it is handed and the layers the
    // window records (render_mirror.ts). Its own ratsnest gives way to the window's.
    view.SetOverlayKept([LAYER_SELECT_OVERLAY, ...RECORDED_LAYERS]);

    const ratsnest = (panel as unknown as { m_ratsnest: VIEW_ITEM | null }).m_ratsnest;

    if (ratsnest) view.Remove(ratsnest);

    for (const [layer, visible, order] of msg.layers) {
      view.SetLayerVisible(layer, visible);
      view.SetLayerOrder(layer, order, false);
    }

    view.UpdateAllLayersOrder();
    view.UpdateAllLayersColor();
    applyView(msg.view);

    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    panel.ForceRefresh();

    scope.postMessage({ t: 'ready', loadMs, firstDrawMs: performance.now() - t1 });

    for (const m of pending ?? []) handle(m);

    pending = null;
  };

  scope.onmessage = (e: MessageEvent<RENDER_WORKER_REQUEST>): void => {
    const msg = e.data;

    try {
      if (msg.t === 'init') {
        init(msg).catch((err: unknown) =>
          scope.postMessage({
            t: 'error',
            message: err instanceof Error ? (err.stack ?? err.message) : String(err),
          }),
        );
      } else if (pending) {
        pending.push(msg);
      } else {
        handle(msg);
      }
    } catch (err) {
      scope.postMessage({
        t: 'error',
        message: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    }
  };
}
