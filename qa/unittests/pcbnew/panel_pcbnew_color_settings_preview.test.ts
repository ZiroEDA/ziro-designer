// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_PCBNEW_COLOR_SETTINGS`' preview (pcbnew/dialogs/panel_pcbnew_color_settings.cpp
 * :781-889): `g_previewBoard` loaded into a FOOTPRINT_PREVIEW_PANEL's board as a
 * NORMAL board, its drawing sheet a 6000 x 5000 mil User page, the board's box
 * fitted with a tenth to spare, and the painter recoloured from the theme as
 * edited. The panel draws on a GAL with no output.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { BOARD_USE, type BOARD } from '@ziroeda/pcbnew/board.js';
import {
  createPreviewItems,
  currentColorSettings,
  g_previewBoard,
  updatePreview,
  zoomFitPreview,
} from '@ziroeda/pcbnew/dialogs/panel_pcbnew_color_settings.js';
import { FOOTPRINT_PREVIEW_PANEL } from '@ziroeda/pcbnew/footprint_preview_panel.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { PCB_PAINTER, type PCB_RENDER_SETTINGS } from '@ziroeda/pcbnew/pcb_painter.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/pcb_view.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';

class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

function preview(): {
  p: FOOTPRINT_PREVIEW_PANEL;
  view: PCB_VIEW;
  gal: STUB_GAL;
  displayed: BOARD[];
  sheets: DS_PROXY_VIEW_ITEM[];
} {
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(400, 300);
  const view = new PCB_VIEW();
  view.SetGAL(gal);
  view.SetPainter(new PCB_PAINTER(gal, FRAME_T.FRAME_FOOTPRINT_PREVIEW));
  const displayed: BOARD[] = [];
  const sheets: DS_PROXY_VIEW_ITEM[] = [];
  const panel = {
    GetView: () => view,
    GetGAL: () => gal,
    SetStealsFocus: () => {},
    UpdateColors: () => {},
    SyncLayersVisibility: () => {},
    DisplayBoard: (b: BOARD) => displayed.push(b),
    SetDrawingSheet: (s: DS_PROXY_VIEW_ITEM) => sheets.push(s),
    GetClientSize: () => ({ x: 400, y: 300 }),
    GetDefaultViewBBox: () => null,
    Refresh: () => {},
    ForceRefresh: () => {},
  } as unknown as PCB_DRAW_PANEL_GAL;
  return { p: new FOOTPRINT_PREVIEW_PANEL(panel, 'mm'), view, gal, displayed, sheets };
}

describe('createPreviewItems', () => {
  it('loads g_previewBoard into the preview’s own board, as a NORMAL board, and shows it', () => {
    const { p, displayed } = preview();
    createPreviewItems(p);
    const board = p.GetBoard();
    expect(board.GetBoardUse()).toBe(BOARD_USE.NORMAL);
    expect(displayed).toEqual([board]);
    expect(board.Footprints()).toHaveLength(8);
    expect(board.Tracks().filter((t) => t.GetClass() === 'PCB_VIA')).toHaveLength(1);
    expect(board.Zones()).toHaveLength(1);
    for (const l of [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.Edge_Cuts])
      expect(board.IsLayerEnabled(l)).toBe(true);
  });

  it('puts a 6000 x 5000 mil User page under it, first page, sheet and page-limit colours', () => {
    const { p, sheets } = preview();
    createPreviewItems(p);
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0]! as unknown as {
      m_pageInfo: { GetWidthMils(): number; GetHeightMils(): number; GetType(): string };
      m_isFirstPage: boolean;
      m_colorLayer: number;
      m_pageBorderColorLayer: number;
      m_titleBlock: { GetTitle(): string };
    };
    expect(sheet.m_pageInfo.GetWidthMils()).toBe(6000);
    expect(sheet.m_pageInfo.GetHeightMils()).toBe(5000);
    expect(sheet.m_isFirstPage).toBe(true);
    expect(sheet.m_colorLayer).toBe(GAL_LAYER_ID.LAYER_DRAWINGSHEET);
    expect(sheet.m_pageBorderColorLayer).toBe(GAL_LAYER_ID.LAYER_PAGE_LIMITS);
    expect(sheet.m_titleBlock.GetTitle()).toBe('Color Preview');
  });

  it('is KiCad’s literal: the board text opens as upstream’s does', () => {
    expect(g_previewBoard.startsWith('(kicad_pcb (version 20230620) (generator pcbnew)\n')).toBe(
      true,
    );
  });
});

describe('zoomFitPreview', () => {
  it('fits the BOARD’s box, not the sheet’s, with a tenth to spare', () => {
    const { p, view } = preview();
    createPreviewItems(p);
    const box = p.GetBoard().GetBoundingBox();
    zoomFitPreview(p);

    expect(view.GetCenter()).toEqual(box.Centre());
    // The same fit through VIEW::SetViewport is the board filling the client
    // area exactly; the preview leaves 1/1.1 of that.
    const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
    gal.ResizeScreen(400, 300);
    const ref = new PCB_VIEW();
    ref.SetGAL(gal);
    ref.SetViewport(new BOX2D(box.GetOrigin(), box.GetSize()));
    expect(view.GetScale()).toBeCloseTo(ref.GetScale() / 1.1, 10);
  });
});

describe('updatePreview', () => {
  it('loads the colours as edited into the painter and clears to their background', () => {
    const { p, view, gal } = preview();
    createPreviewItems(p);
    const cs = new COLOR_SETTINGS('user');
    cs.LoadFromJsonPaths({
      'board.background': 'rgb(10, 20, 30)',
      'board.copper.f': 'rgb(1, 2, 3)',
    });
    updatePreview(p, cs);
    const rs = view.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;
    expect(rs.GetLayerColor(PCB_LAYER_ID.F_Cu)).toEqual(cs.GetColor(PCB_LAYER_ID.F_Cu));
    expect(gal.GetClearColor()).toEqual(rs.GetBackgroundColor());
    expect(rs.GetBackgroundColor()).toEqual(cs.GetColor(GAL_LAYER_ID.LAYER_PCB_BACKGROUND));
  });
});

describe('currentColorSettings', () => {
  it('the user theme takes the user’s colours; an installed theme its own', () => {
    const user = currentColorSettings('user', { 'board.copper.f': 'rgb(1, 2, 3)' }, null);
    expect(user.GetColor(PCB_LAYER_ID.F_Cu)).toEqual({ r: 1 / 255, g: 2 / 255, b: 3 / 255, a: 1 });

    const made = currentColorSettings('mine', {}, { 'board.copper.f': 'rgb(4, 5, 6)' });
    expect(made.GetColor(PCB_LAYER_ID.F_Cu)).toEqual({ r: 4 / 255, g: 5 / 255, b: 6 / 255, a: 1 });
  });
});
