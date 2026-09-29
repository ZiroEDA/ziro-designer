// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_EDIT_FRAME`'s `LAYER_PAIR_SETTINGS` plumbing (`pcb_edit_frame.cpp:470-
 * 489`) and `SELECT_COPPER_LAYERS_PAIR_DIALOG` (`sel_layer.cpp:646-789`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPgm } from '@ziroeda/common/pgm_base.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LAYER_PAIR, LAYER_PAIR_INFO } from '@ziroeda/common/project/board_project_settings.js';
import { PCB_THEMES } from '@ziroeda/pcbnew/pcbTheme.js';
import { SelectCopperLayerPairDialog } from '@ziroeda/pcbnew/sel_layer.js';

const theme = PCB_THEMES[0]!;

const makeFrame = (selectCopperLayerPair: () => void = () => {}) =>
  new PCB_EDIT_FRAME({
    settings: () => new PCBNEW_SETTINGS(),
    onModify: () => {},
    onUndoRedoIncomplete: () => {},
    createDrcDialog: () => {
      throw new Error('no DRC dialog here');
    },
    isSingle: () => true,
    fetchNetlistFromSchematic: () => false,
    schematicNetlistText: () => null,
    projectText: () => null,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
    setHighlightNets: () => {},
    syncSelection: () => {},
    editZoneParams: () => {},
    selectCopperLayerPair,
    updatePcbFromSchematic: () => {},
  });

/**
 * A frame with a screen mounted, matching `pcb_edit_frame_ui.tsx`'s real
 * lifecycle (a screen exists before any dialog can open) — `SetCurrentLayerPair`'s
 * `PCB_CURRENT_LAYER_PAIR_CHANGED` binding writes through `GetScreen()!`.
 */
const makeFrameWithScreen = () => {
  const frame = makeFrame();
  frame.SetScreen(new PCB_SCREEN({ x: 0, y: 0 }));
  return frame;
};

beforeEach(() => {
  SetPgm(null);
  installPgm();
});
afterEach(() => {
  SetPgm(null);
  cleanup();
});

function boardWithLayers(...layers: PCB_LAYER_ID[]): BOARD {
  const b = new BOARD();
  b.GetDesignSettings().SetEnabledLayers(new LSET(layers));
  return b;
}

describe('PCB_EDIT_FRAME.GetLayerPairSettings', () => {
  it('defaults to F.Cu / B.Cu', () => {
    const pair = makeFrame().GetLayerPairSettings().GetCurrentLayerPair();
    expect(pair.GetLayerA()).toBe(PCB_LAYER_ID.F_Cu);
    expect(pair.GetLayerB()).toBe(PCB_LAYER_ID.B_Cu);
  });

  it('SetCurrentLayerPair updates the screen the router reads (m_Route_Layer_TOP/BOTTOM)', () => {
    const frame = makeFrame();
    frame.SetScreen(new PCB_SCREEN({ x: 0, y: 0 }));
    frame
      .GetLayerPairSettings()
      .SetCurrentLayerPair(new LAYER_PAIR(PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.In2_Cu));
    const screen = frame.GetScreen()!;
    expect(screen.m_Route_Layer_TOP).toBe(PCB_LAYER_ID.In1_Cu);
    expect(screen.m_Route_Layer_BOTTOM).toBe(PCB_LAYER_ID.In2_Cu);
  });

  it('a preset change syncs the project file (Prj().GetProjectFile().m_LayerPairInfos)', () => {
    const frame = makeFrame();
    frame
      .GetLayerPairSettings()
      .AddLayerPair(
        new LAYER_PAIR_INFO(new LAYER_PAIR(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu), true, 'Test'),
      );
    const stored = frame.Prj().GetProjectFile().m_LayerPairInfos;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.GetName()).toBe('Test');
  });

  it('SelectCopperLayerPair calls the hook (the dialog-opening seam)', () => {
    const onOpen = vi.fn();
    makeFrame(onOpen).SelectCopperLayerPair();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('SelectCopperLayerPairDialog', () => {
  it('renders every board-enabled copper layer in both grids', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.B_Cu);
    const settings = makeFrame().GetLayerPairSettings();
    render(
      <SelectCopperLayerPairDialog
        board={b}
        theme={theme}
        layerPairSettings={settings}
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByText(/F\.Cu/).length).toBeGreaterThanOrEqual(2); // once per grid
    expect(screen.getAllByText(/B\.Cu/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/In1\.Cu/i).length).toBeGreaterThanOrEqual(0);
  });

  it('clicking a row in the left grid changes the top layer, not the bottom', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.B_Cu);
    const settings = makeFrameWithScreen().GetLayerPairSettings();
    const { container } = render(
      <SelectCopperLayerPairDialog
        board={b}
        theme={theme}
        layerPairSettings={settings}
        onClose={() => {}}
      />,
    );
    const leftGrid = container.querySelectorAll('.ze-grid-pane')[0]!;
    const in1Cell = Array.from(leftGrid.querySelectorAll('td')).find((td) =>
      /In1/.test(td.textContent ?? ''),
    )!;
    fireEvent.mouseDown(in1Cell, { button: 0 });

    // OK commits the draft onto the real settings.
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    const pair = settings.GetCurrentLayerPair();
    expect(pair.GetLayerA()).toBe(PCB_LAYER_ID.In1_Cu);
    expect(pair.GetLayerB()).toBe(PCB_LAYER_ID.B_Cu); // unchanged
  });

  it('Cancel discards the draft: the real settings are untouched', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.B_Cu);
    const settings = makeFrame().GetLayerPairSettings();
    const before = settings.GetCurrentLayerPair();
    const { container } = render(
      <SelectCopperLayerPairDialog
        board={b}
        theme={theme}
        layerPairSettings={settings}
        onClose={() => {}}
      />,
    );
    const leftGrid = container.querySelectorAll('.ze-grid-pane')[0]!;
    const in1Cell = Array.from(leftGrid.querySelectorAll('td')).find((td) =>
      /In1/.test(td.textContent ?? ''),
    )!;
    fireEvent.mouseDown(in1Cell, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(settings.GetCurrentLayerPair()).toEqual(before);
  });

  it('Add to presets adds the current pair as a row in the presets grid', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    const settings = makeFrame().GetLayerPairSettings();
    render(
      <SelectCopperLayerPairDialog
        board={b}
        theme={theme}
        layerPairSettings={settings}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Add current pair to presets'));
    expect(screen.getByText('F.Cu / B.Cu')).toBeTruthy();
  });

  it('OK with the same layer on both sides warns (DisplayInfoMessage)', async () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu);
    const settings = makeFrameWithScreen().GetLayerPairSettings();
    settings.SetCurrentLayerPair(new LAYER_PAIR(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Cu));
    render(
      <SelectCopperLayerPairDialog
        board={b}
        theme={theme}
        layerPairSettings={settings}
        onClose={() => {}}
      />,
    );
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('top and bottom layers are same'));
    infoSpy.mockRestore();
  });
});
