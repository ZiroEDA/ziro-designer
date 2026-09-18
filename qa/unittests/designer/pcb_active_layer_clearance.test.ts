// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::SetActiveLayer` (pcb_edit_frame.cpp:1823-1876): the
 * clearance outlines (`pcb_display.pad_clearance`, on by default) are drawn on
 * `CLEARANCE_LAYER_FOR( layer )`, and `SyncLayersVisibility` hides every one
 * of those; it is SetActiveLayer that shows the active copper layer's and
 * hides the previous one's. Ours synced and never switched one on, so no pad
 * ever drew the copper-coloured ring KiCad draws at its clearance distance
 * (seen on CM5_MINIMA_3, 2026-09-18).
 */
import { describe, expect, it } from 'vitest';
import { CLEARANCE_LAYER_FOR, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/src/pcb_draw_panel_gal.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/src/pcb_screen.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/src/pcbnew_settings.js';
import { PCB_EDIT_FRAME } from '@ziroeda/designer/src/editors/pcb/pcb_edit_frame.js';

function makeFrame() {
  const frame = new PCB_EDIT_FRAME({
    settings: () => new PCBNEW_SETTINGS(),
    onModify: () => {},
    onUndoRedoIncomplete: () => {},
    // The DRC dialog's window half; this test never opens it.
    createDrcDialog: () => {
      throw new Error('no DRC dialog here');
    },
    isSingle: () => true,
    fetchNetlistFromSchematic: () => false,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
  });
  // `createPcbDrawPanel`'s screen, whose m_Active_Layer the frame reads.
  frame.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));
  const visible = new Map<number, boolean>();
  const calls: string[] = [];
  const canvas = {
    SetHighContrastLayer: (l: number) => calls.push(`hc ${l}`),
    GetView: () => ({
      SetLayerVisible: (l: number, v: boolean) => {
        visible.set(l, v);
        calls.push(`${v ? 'show' : 'hide'} ${l}`);
      },
      UpdateAllItemsConditionally: () => calls.push('update'),
    }),
    Refresh: () => calls.push('refresh'),
  };
  frame.SetCanvas(canvas as unknown as PCB_DRAW_PANEL_GAL);
  return { frame, visible, calls };
}

describe('PCB_EDIT_FRAME::SetActiveLayer and the clearance layers', () => {
  it('shows the clearance layer of the copper layer made active, hides the old one', () => {
    const { frame, visible, calls } = makeFrame();
    frame.SetActiveLayer(PCB_LAYER_ID.F_Cu, true);
    expect(visible.get(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu))).toBe(true);

    calls.length = 0;
    frame.SetActiveLayer(PCB_LAYER_ID.B_Cu);
    expect(visible.get(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu))).toBe(false);
    expect(visible.get(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.B_Cu))).toBe(true);
    // the C++ order: high contrast, the two visibilities, the item update, the repaint
    expect(calls).toEqual([
      `hc ${PCB_LAYER_ID.B_Cu}`,
      `hide ${CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu)}`,
      `show ${CLEARANCE_LAYER_FOR(PCB_LAYER_ID.B_Cu)}`,
      'update',
      'refresh',
    ]);
  });

  it('a non-copper layer shows no clearance layer, and hides the copper one it left', () => {
    const { frame, visible } = makeFrame();
    frame.SetActiveLayer(PCB_LAYER_ID.F_Cu, true);
    frame.SetActiveLayer(PCB_LAYER_ID.F_SilkS);
    expect(visible.get(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu))).toBe(false);
    expect([...visible.values()].filter(Boolean)).toHaveLength(0);
  });

  it('the same layer again is a no-op unless forced, as the C++ early return', () => {
    const { frame, calls } = makeFrame();
    frame.SetActiveLayer(PCB_LAYER_ID.F_Cu, true);
    calls.length = 0;
    frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    expect(calls).toEqual([]);
    // `SetActiveLayer( GetActiveLayer(), true )` after a SyncLayersVisibility
    // ("Make sure to repaint even if not switching", pcb_edit_frame.cpp:2037)
    frame.SetActiveLayer(PCB_LAYER_ID.F_Cu, true);
    expect(calls).toContain(`show ${CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu)}`);
  });
});
