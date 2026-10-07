// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_PREVIEW_PANEL` (`pcbnew/footprint_preview_panel.cpp`): the
 * board canvas a `FOOTPRINT_PREVIEW_WIDGET` hosts — a `PCB_DRAW_PANEL_GAL`
 * with no frame, drawing one library footprint on a dummy FPHOLDER BOARD. The
 * widget, its status text and the "Footprint not found." branch are common
 * (`common/widgets/footprint_preview_widget.tsx`); upstream it gets this panel
 * from the kiway (`FRAME_FOOTPRINT_PREVIEW`), here the caller builds it with
 * {@link FOOTPRINT_PREVIEW_PANEL_New}.
 *
 * Upstream's `DisplayFootprint( LIB_ID )` loads and shows in one call. The
 * load here may wait on a hosted library file, so the widget resolves the
 * footprint first (`LoadFootprint` through the adapter) and the panel shows
 * what it was handed ({@link FOOTPRINT_PREVIEW_PANEL.ShowFootprint}).
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { pcbIUScale, type EdaUnits, DoubleValueFromStringIn } from '@ziroeda/common/eda_units.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { INSPECT_RESULT } from '@ziroeda/common/eda_item.js';
import { GAL_DISPLAY_OPTIONS_IMPL } from '@ziroeda/common/gal_display_options_common.js';
import { drawPanelWindow, loadBitmapFontImage } from '@ziroeda/common/gal/gal_window.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import {
  HIGH_CONTRAST_MODE,
  NET_COLOR_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { FOOTPRINT_PREVIEW_PANEL_BASE } from '@ziroeda/common/widgets/footprint_preview_widget.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import { BOARD, BOARD_USE } from './board.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import { PCB_DRAW_PANEL_GAL } from './pcb_draw_panel_gal.js';
import type { PCB_RENDER_SETTINGS } from './pcb_painter.js';
import { PCBNEW_SETTINGS } from './pcbnew_settings.js';

export class FOOTPRINT_PREVIEW_PANEL {
  private readonly m_panel: PCB_DRAW_PANEL_GAL;
  private readonly m_dummyBoard: BOARD;
  private m_currentFootprint: FOOTPRINT | null = null;
  private m_otherFootprint: FOOTPRINT | null = null;
  /** `m_pinFunctions`: a pad number's pin function, set by `SetPinFunctions`. */
  private m_pinFunctions = new Map<string, string>();
  private m_pendingFit = false;

  constructor(aPanel: PCB_DRAW_PANEL_GAL, aUserUnits: EdaUnits) {
    this.m_panel = aPanel;

    aPanel.SetStealsFocus(false);

    this.m_dummyBoard = new BOARD();
    this.m_dummyBoard.SetUserUnits(aUserUnits);
    this.m_dummyBoard.SetBoardUse(BOARD_USE.FPHOLDER);

    aPanel.UpdateColors();
    aPanel.SyncLayersVisibility(this.m_dummyBoard);
  }

  GetPanel(): PCB_DRAW_PANEL_GAL {
    return this.m_panel;
  }

  /** `GetBoard()`: the dummy board the footprint is shown on. */
  GetBoard(): BOARD {
    return this.m_dummyBoard;
  }

  /** `GetCurrentFootprint()`. */
  GetCurrentFootprint(): FOOTPRINT | null {
    return this.m_currentFootprint;
  }

  /** `SetPinFunctions( aPinFunctions )`. */
  SetPinFunctions(aPinFunctions: ReadonlyMap<string, string>): void {
    this.m_pinFunctions = new Map(aPinFunctions);
  }

  /** `ClearViewAndData()`. */
  ClearViewAndData(): void {
    this.m_dummyBoard.DetachAllFootprints();

    const view = this.m_panel.GetView();

    if (this.m_currentFootprint) view.Remove(this.m_currentFootprint);
    if (this.m_otherFootprint) view.Remove(this.m_otherFootprint);

    view.Clear();

    this.m_currentFootprint = null;
    this.m_otherFootprint = null;
  }

  /** `renderFootprint( aFootprint )`. */
  private renderFootprint(aFootprint: FOOTPRINT): void {
    this.m_dummyBoard.Add(aFootprint);

    aFootprint.Visit(
      (descendant: EDA_ITEM) => {
        (descendant as PCB_DIMENSION_BASE).UpdateUnits();
        return INSPECT_RESULT.CONTINUE;
      },
      null,
      [
        KICAD_T.PCB_DIM_LEADER_T,
        KICAD_T.PCB_DIM_ALIGNED_T,
        KICAD_T.PCB_DIM_ORTHOGONAL_T,
        KICAD_T.PCB_DIM_CENTER_T,
        KICAD_T.PCB_DIM_RADIAL_T,
      ],
    );

    // `m_pinFunctions[ pad->GetNumber() ]`: a std::map's operator[], so a pad
    // with no entry gets the empty string.
    for (const pad of aFootprint.Pads())
      pad.SetPinFunction(this.m_pinFunctions.get(pad.GetNumber()) ?? '');

    // Ensure we are not using the high contrast mode to display the selected footprint
    const view = this.m_panel.GetView();
    const settings = view.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;
    settings.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.NORMAL;

    view.Add(aFootprint);
    view.SetVisible(aFootprint, true);
    view.Update(aFootprint, VIEW_UPDATE_FLAGS.ALL);
  }

  /** `fitToCurrentFootprint()`. */
  fitToCurrentFootprint(): void {
    const current = this.m_currentFootprint;

    if (!current) return;

    const includeText = current.TextOnly();
    const bbox = current.GetBoundingBox(includeText);

    if (bbox.GetSize().x > 0 && bbox.GetSize().y > 0) {
      const view = this.m_panel.GetView();

      // Autozoom
      view.SetViewport(new BOX2D(bbox.GetOrigin(), bbox.GetSize()));

      // Add a margin
      view.SetScale(view.GetScale() * 0.7);

      this.m_panel.Refresh();
    }
  }

  /**
   * `onSize`: the first size event after a footprint is shown fits it, the
   * GAL having been resized to the canvas by then.
   */
  onSize(): void {
    if (this.m_pendingFit && this.m_currentFootprint) {
      this.m_pendingFit = false;
      this.fitToCurrentFootprint();
    }
  }

  /**
   * `DisplayFootprint( aFPID )` past its `LoadFootprint`: the last footprint
   * detached and the view cleared, \a aFootprint (a fresh copy from the
   * library, or null when it was not found) rendered and fitted.
   */
  ShowFootprint(aFootprint: FOOTPRINT | null): boolean {
    this.m_dummyBoard.DetachAllFootprints();

    const view = this.m_panel.GetView();

    if (this.m_currentFootprint) view.Remove(this.m_currentFootprint);

    view.Clear();

    this.m_currentFootprint = aFootprint;

    if (this.m_currentFootprint) {
      this.renderFootprint(this.m_currentFootprint);
      this.m_pendingFit = true;
      this.fitToCurrentFootprint();
    }

    this.m_panel.ForceRefresh();

    return this.m_currentFootprint !== null;
  }

  /** `DisplayFootprints( aFootprintA, aFootprintB )`: two footprints, fitted to the first. */
  DisplayFootprints(aFootprintA: FOOTPRINT | null, aFootprintB: FOOTPRINT | null): void {
    this.m_dummyBoard.DetachAllFootprints();

    const view = this.m_panel.GetView();

    if (this.m_currentFootprint) view.Remove(this.m_currentFootprint);
    if (this.m_otherFootprint) view.Remove(this.m_otherFootprint);

    view.Clear();

    this.m_currentFootprint = aFootprintA;
    this.m_otherFootprint = aFootprintB;

    if (this.m_currentFootprint) {
      if (!this.m_otherFootprint) return;

      this.renderFootprint(this.m_currentFootprint);
      this.renderFootprint(this.m_otherFootprint);
      this.m_pendingFit = true;
      this.fitToCurrentFootprint();
    }
  }

  /** `RefreshAll()`. */
  RefreshAll(): void {
    this.m_panel.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_panel.ForceRefresh();
  }

  /**
   * `FOOTPRINT_PREVIEW_PANEL::New( aKiway, aParent, aUnitsProvider )`
   * (`:278-312`): the GAL options from the common settings and pcbnew's own
   * window settings, the grid shown and sized as pcbnew's last grid, and no
   * highlight or net colours. Null when WebGL is not to be had.
   */
  static New(
    aCanvas: HTMLCanvasElement,
    aFontImage: ImageBitmap,
    aCommonSettings: COMMON_SETTINGS_LIKE,
    aUserUnits: EdaUnits,
  ): FOOTPRINT_PREVIEW_PANEL | null {
    const cfg =
      PgmOrNull()?.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew') ??
      new PCBNEW_SETTINGS();

    const galOpts = new GAL_DISPLAY_OPTIONS_IMPL();
    galOpts.ReadConfig(aCommonSettings, cfg.m_Window, window);

    let drawPanel: PCB_DRAW_PANEL_GAL;

    try {
      drawPanel = new PCB_DRAW_PANEL_GAL(null, drawPanelWindow(aCanvas, aFontImage), galOpts);
    } catch (err) {
      console.warn(`Could not use OpenGL: ${(err as Error).message}`);
      return null;
    }

    const panel = new FOOTPRINT_PREVIEW_PANEL(drawPanel, aUserUnits);

    drawPanel.UpdateColors();

    const gridCfg = cfg.m_Window.grid;
    drawPanel.GetGAL().SetGridVisibility(gridCfg.show);

    // Bounds checking cannot include number of elements as an index!
    const gridIdx = Math.min(Math.max(gridCfg.last_size_idx, 0), gridCfg.grids.length - 1);
    const grid = gridCfg.grids[gridIdx];

    if (grid) {
      const gridSizeX = DoubleValueFromStringIn(pcbIUScale, 'mils', grid.x);
      const gridSizeY = DoubleValueFromStringIn(pcbIUScale, 'mils', grid.y);
      drawPanel.GetGAL().SetGridSize({ x: gridSizeX, y: gridSizeY });
    }

    const settings = drawPanel.GetView().GetPainter().GetSettings() as PCB_RENDER_SETTINGS;
    settings.SetHighlight(false);
    settings.SetNetColorMode(NET_COLOR_MODE.OFF);

    return panel;
  }
}

export interface FootprintPreviewPanelProps {
  /** The resolved footprint, a fresh copy from the library. */
  footprint: FOOTPRINT;
  /** `Pgm()`, installed before the canvas is built. */
  installPgm: () => void;
  /** `Pgm().GetCommonSettings()`, which the GAL options read. */
  commonSettings: () => COMMON_SETTINGS_LIKE;
}

/** The panel's window: the canvas `New` builds on, and its size events. */
export function FootprintPreviewPanel({
  footprint,
  installPgm,
  commonSettings,
}: FootprintPreviewPanelProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [panel, setPanel] = useState<FOOTPRINT_PREVIEW_PANEL | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: built once per window; the two readers are read at build time
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let built: FOOTPRINT_PREVIEW_PANEL | null = null;
    let observer: ResizeObserver | null = null;

    loadBitmapFontImage().then(
      (fontImage) => {
        if (cancelled) return;

        installPgm();
        built = FOOTPRINT_PREVIEW_PANEL.New(canvas, fontImage, commonSettings(), 'mm');

        if (!built) return;

        const p = built;
        observer = new ResizeObserver(() => p.onSize());
        observer.observe(canvas);
        setPanel(p);
      },
      (err: unknown) => console.warn(`Could not load the bitmap font: ${(err as Error).message}`),
    );

    return () => {
      cancelled = true;
      observer?.disconnect();

      if (built) {
        built.ClearViewAndData();
        built.GetPanel().Destroy();
      }
    };
  }, []);

  useEffect(() => {
    panel?.ShowFootprint(footprint);
  }, [panel, footprint]);

  return <canvas ref={canvasRef} className="ze-fp-canvas" />;
}

/**
 * What `FOOTPRINT_PREVIEW_WIDGET`'s constructor gets from
 * `aKiway.KiFACE( KIWAY::FACE_PCB ).CreateKiWindow( FRAME_FOOTPRINT_PREVIEW )`:
 * the lookup `DisplayFootprint` does against the footprint libraries, and the
 * canvas that shows the result.
 */
export function FOOTPRINT_PREVIEW_PANEL_New(app: {
  /** `FootprintLibAdapter()->LoadFootprint( nickname, name, false )`, by "Library:Name". */
  resolve: (libId: string) => Promise<FOOTPRINT | null>;
  installPgm: () => void;
  commonSettings: () => COMMON_SETTINGS_LIKE;
}): FOOTPRINT_PREVIEW_PANEL_BASE<FOOTPRINT> {
  return {
    resolve: app.resolve,
    render: (footprint) => (
      <FootprintPreviewPanel
        footprint={footprint}
        installPgm={app.installPgm}
        commonSettings={app.commonSettings}
      />
    ),
  };
}
