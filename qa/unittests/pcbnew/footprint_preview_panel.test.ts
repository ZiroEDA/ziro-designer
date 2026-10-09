// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_PREVIEW_PANEL` (pcbnew/footprint_preview_panel.cpp) on a GAL
 * that draws nothing: the dummy FPHOLDER board, what `DisplayFootprint`
 * puts in the view, and `fitToCurrentFootprint`'s viewport.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { BOARD_USE } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT_PREVIEW_PANEL } from '@ziroeda/pcbnew/footprint_preview_panel.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseFootprintFile } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_PAINTER, type PCB_RENDER_SETTINGS } from '@ziroeda/pcbnew/pcb_painter.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/pcb_view.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';

class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

/**
 * A footprint whose value text sits far to the right of its two pads and its
 * silkscreen line (a drawing, so it is not `TextOnly()`).
 */
const FP = (aName: string): string => `(footprint "${aName}" (layer "F.Cu")
  (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS"))
  (property "Value" "${aName}" (at 40 0 0) (layer "F.Fab"))
  (fp_line (start -2 -1) (end 2 -1) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
  (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
  (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu")))`;

function stubPanel(): { panel: PCB_DRAW_PANEL_GAL; view: PCB_VIEW; refreshed: () => number } {
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(1000, 1000);
  const view = new PCB_VIEW();
  view.SetGAL(gal);
  view.SetPainter(new PCB_PAINTER(gal, FRAME_T.FRAME_FOOTPRINT_PREVIEW));
  let refreshes = 0;
  const panel = {
    GetView: () => view,
    GetGAL: () => gal,
    SetStealsFocus: () => {},
    UpdateColors: () => {},
    SyncLayersVisibility: () => {},
    Refresh: () => {
      refreshes++;
    },
    ForceRefresh: () => {
      refreshes++;
    },
  } as unknown as PCB_DRAW_PANEL_GAL;
  return { panel, view, refreshed: () => refreshes };
}

describe('FOOTPRINT_PREVIEW_PANEL', () => {
  it('holds its footprints on a dummy FPHOLDER board', () => {
    const { panel } = stubPanel();
    const preview = new FOOTPRINT_PREVIEW_PANEL(panel, 'mm');
    expect(preview.GetBoard().GetBoardUse()).toBe(BOARD_USE.FPHOLDER);
  });

  it('DisplayFootprint: the footprint on the board and in the view, high contrast off', () => {
    const { panel, view } = stubPanel();
    const preview = new FOOTPRINT_PREVIEW_PANEL(panel, 'mm');
    const settings = view.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;
    settings.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.DIMMED;

    const fp = ParseFootprintFile(FP('A'), 'Lib:A');
    expect(preview.ShowFootprint(fp)).toBe(true);

    expect(preview.GetBoard().Footprints()).toEqual([fp]);
    expect(preview.GetCurrentFootprint()).toBe(fp);
    expect(view.IsVisible(fp)).toBe(true);
    expect(settings.m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.NORMAL);
  });

  it('a second footprint replaces the first', () => {
    const { panel } = stubPanel();
    const preview = new FOOTPRINT_PREVIEW_PANEL(panel, 'mm');
    const a = ParseFootprintFile(FP('A'), 'Lib:A');
    const b = ParseFootprintFile(FP('B'), 'Lib:B');
    preview.ShowFootprint(a);
    preview.ShowFootprint(b);
    expect(preview.GetBoard().Footprints()).toEqual([b]);
    expect(preview.GetCurrentFootprint()).toBe(b);
  });

  it('not found: the board is emptied and the answer is false', () => {
    const { panel } = stubPanel();
    const preview = new FOOTPRINT_PREVIEW_PANEL(panel, 'mm');
    preview.ShowFootprint(ParseFootprintFile(FP('A'), 'Lib:A'));
    expect(preview.ShowFootprint(null)).toBe(false);
    expect(preview.GetBoard().Footprints()).toEqual([]);
    expect(preview.GetCurrentFootprint()).toBeNull();
  });

  it('fits the footprint without its text, at 0.7 of the fitted scale', () => {
    const { panel, view } = stubPanel();
    const preview = new FOOTPRINT_PREVIEW_PANEL(panel, 'mm');
    const fp = ParseFootprintFile(FP('A'), 'Lib:A');
    preview.ShowFootprint(fp);

    // The value at x = 40 mm is outside the fitted box: the view centres on
    // the pads, not on the text.
    const box = fp.GetBoundingBox(false);
    expect(view.GetCenter().x).toBeCloseTo(box.Centre().x, -2);
    expect(view.GetCenter().y).toBeCloseTo(box.Centre().y, -2);

    // SetViewport( bbox ) then SetScale( GetScale() * 0.7 ), against VIEW's own fit.
    const referenceGal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
    referenceGal.ResizeScreen(1000, 1000);
    const reference = new PCB_VIEW();
    reference.SetGAL(referenceGal);
    reference.SetViewport(new BOX2D(box.GetOrigin(), box.GetSize()));
    expect(view.GetScale()).toBeCloseTo(reference.GetScale() * 0.7, 12);
  });

  it('every pad takes the pin function its number has, or none', () => {
    const { panel } = stubPanel();
    const preview = new FOOTPRINT_PREVIEW_PANEL(panel, 'mm');
    preview.SetPinFunctions(new Map([['1', 'VCC']]));
    const fp = ParseFootprintFile(FP('A'), 'Lib:A');
    fp.Pads()[1]!.SetPinFunction('stale');
    preview.ShowFootprint(fp);
    expect(fp.Pads()[0]!.GetPinFunction()).toBe('VCC');
    expect(fp.Pads()[1]!.GetPinFunction()).toBe('');
  });
});
