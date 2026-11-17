// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_LAYER_PRESENTATION::getLayerName` for the dialogs that keep a layer by its canonical
 * name: the board's name with a board (sel_layer.cpp:77-83), so KiCad 10's F.Silkscreen
 * and User.Drawings, and a user's own name for a renamed layer.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { layerBoxName } from '@ziroeda/pcbnew/pcb_layer_box_selector.js';

describe('layerBoxName', () => {
  it("is the board's name for the layer, not the canonical one", () => {
    const b = new BOARD();
    expect(layerBoxName(b, 'F.SilkS')).toBe('F.Silkscreen');
    expect(layerBoxName(b, 'Dwgs.User')).toBe('User.Drawings');
    expect(layerBoxName(b, 'F.CrtYd')).toBe('F.Courtyard');
    expect(layerBoxName(b, 'F.Cu')).toBe('F.Cu');
  });

  it('is the name the user gave a layer', () => {
    const b = new BOARD();
    b.SetLayerName(PCB_LAYER_ID.F_Cu, 'top_cu');
    expect(layerBoxName(b, 'F.Cu')).toBe('top_cu');
  });

  it('is the standard name with no board', () => {
    expect(layerBoxName(null, 'F.SilkS')).toBe('F.Silkscreen');
  });
});
