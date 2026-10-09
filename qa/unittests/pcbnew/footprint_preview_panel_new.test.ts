// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_PREVIEW_PANEL::New` (pcbnew/footprint_preview_panel.cpp:278-312):
 * the panel's GAL options read from the common settings and pcbnew's window
 * settings, the grid shown and sized as pcbnew's last grid, and the painter
 * with no highlight and no net colours. The WebGL panel is stood in for by a
 * PCB_DRAW_PANEL_GAL that draws on a GAL with no output.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import { DoubleValueFromStringIn, pcbIUScale } from '@ziroeda/common/eda_units.js';
import { NET_COLOR_MODE } from '@ziroeda/common/project/board_project_settings.js';

const built = vi.hoisted(() => ({
  options: null as GAL_DISPLAY_OPTIONS | null,
  parent: 1 as unknown,
}));

vi.mock('@ziroeda/common/gal/gal_window.js', () => ({
  drawPanelWindow: () => ({}),
  loadBitmapFontImage: () => Promise.reject(new Error('none')),
}));

vi.mock('@ziroeda/pcbnew/pcb_draw_panel_gal.js', async () => {
  const { PCB_VIEW } = await import('@ziroeda/pcbnew/pcb_view.js');
  const { PCB_PAINTER } = await import('@ziroeda/pcbnew/pcb_painter.js');
  const { GAL } = await import('@ziroeda/common/gal/graphics_abstraction_layer.js');
  const { FRAME_T } = await import('@ziroeda/common/frame_type.js');

  class STUB_GAL extends GAL {
    override ResizeScreen(aWidth: number, aHeight: number): void {
      this.m_screenSize = { x: aWidth, y: aHeight };
    }
  }

  class PCB_DRAW_PANEL_GAL {
    private readonly m_gal: STUB_GAL;
    private readonly m_view = new PCB_VIEW();

    constructor(aParent: unknown, _aWindow: unknown, aOptions: GAL_DISPLAY_OPTIONS) {
      built.parent = aParent;
      built.options = aOptions;
      this.m_gal = new STUB_GAL(aOptions);
      this.m_gal.ResizeScreen(400, 300);
      this.m_view.SetGAL(this.m_gal);
      this.m_view.SetPainter(new PCB_PAINTER(this.m_gal, FRAME_T.FRAME_FOOTPRINT_PREVIEW));
    }

    GetGAL(): STUB_GAL {
      return this.m_gal;
    }

    GetView(): InstanceType<typeof PCB_VIEW> {
      return this.m_view;
    }

    SetStealsFocus(): void {}
    UpdateColors(): void {}
    SyncLayersVisibility(): void {}
    Refresh(): void {}
    ForceRefresh(): void {}
  }

  return { PCB_DRAW_PANEL_GAL };
});

const { FOOTPRINT_PREVIEW_PANEL } = await import('@ziroeda/pcbnew/footprint_preview_panel.js');
const { PCBNEW_SETTINGS } = await import('@ziroeda/pcbnew/pcbnew_settings.js');

afterEach(() => SetPgm(null));

const COMMON = {
  m_Graphics: { aa_mode: 0 },
  m_Appearance: { canvas_scale: 1 },
} as unknown as COMMON_SETTINGS_LIKE;

describe('FOOTPRINT_PREVIEW_PANEL::New', () => {
  it('builds a frameless panel with no highlight and no net colours', () => {
    const preview = FOOTPRINT_PREVIEW_PANEL.New(
      {} as HTMLCanvasElement,
      {} as ImageBitmap,
      COMMON,
      'mm',
    )!;
    expect(built.parent).toBeNull();

    const settings = preview.GetPanel().GetView().GetPainter().GetSettings() as unknown as {
      IsHighlightEnabled(): boolean;
      GetNetColorMode(): NET_COLOR_MODE;
    };
    expect(settings.IsHighlightEnabled()).toBe(false);
    expect(settings.GetNetColorMode()).toBe(NET_COLOR_MODE.OFF);
  });

  it("shows pcbnew's grid at pcbnew's last grid size", () => {
    const cfg = new PCBNEW_SETTINGS();
    const preview = FOOTPRINT_PREVIEW_PANEL.New(
      {} as HTMLCanvasElement,
      {} as ImageBitmap,
      COMMON,
      'mm',
    )!;
    const gal = preview.GetPanel().GetGAL();

    expect(gal.GetGridVisibility()).toBe(cfg.m_Window.grid.show);
    // `grids[ last_size_idx ]`, the default index 15 of the non-eeschema list: 0.50 mm.
    expect(cfg.m_Window.grid.last_size_idx).toBe(15);
    expect(gal.GetGridSize()).toEqual({ x: 500000, y: 500000 });
  });

  it("takes the cursor options from pcbnew's window settings", () => {
    const cfg = new PCBNEW_SETTINGS();
    FOOTPRINT_PREVIEW_PANEL.New({} as HTMLCanvasElement, {} as ImageBitmap, COMMON, 'mm');
    expect(built.options!.m_forceDisplayCursor).toBe(cfg.m_Window.cursor.always_show_cursor);
    expect(built.options!.m_forceDisplayCursor).toBe(true);
  });
  it('reads the registered pcbnew settings, not the defaults', () => {
    const cfg = new PCBNEW_SETTINGS();
    cfg.m_Window.grid.show = false;
    cfg.m_Window.grid.last_size_idx = 3;
    cfg.m_Window.cursor.always_show_cursor = false;
    const pgm = new PGM_BASE(null, new SETTINGS_MANAGER());
    pgm.GetSettingsManager().RegisterSettings('pcbnew', cfg);
    SetPgm(pgm);

    const preview = FOOTPRINT_PREVIEW_PANEL.New(
      {} as HTMLCanvasElement,
      {} as ImageBitmap,
      COMMON,
      'mm',
    )!;
    const gal = preview.GetPanel().GetGAL();
    expect(gal.GetGridVisibility()).toBe(false);
    // `DoubleValueFromString( pcbIUScale, EDA_UNITS::MILS, grids[3].x )`.
    expect(gal.GetGridSize().x).toBe(
      DoubleValueFromStringIn(pcbIUScale, 'mils', cfg.m_Window.grid.grids[3]!.x),
    );
    expect(gal.GetGridSize().x).not.toBe(500000);
    expect(built.options!.m_forceDisplayCursor).toBe(false);
  });
});
