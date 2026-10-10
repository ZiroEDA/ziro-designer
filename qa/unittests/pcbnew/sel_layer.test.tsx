// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_ONE_LAYER_SELECTOR` (`pcbnew/sel_layer.cpp`): `buildList()`'s split,
 * the hotkey column, and the click-to-select/Escape-to-cancel UI.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PCB_THEMES } from '@ziroeda/pcbnew/pcbTheme.js';
import { buildOneLayerSelectorLists, PcbOneLayerSelector } from '@ziroeda/pcbnew/sel_layer.js';

const theme = PCB_THEMES[0]!;

function boardWithLayers(...layers: PCB_LAYER_ID[]): BOARD {
  const b = new BOARD();
  b.GetDesignSettings().SetEnabledLayers(new LSET(layers));
  return b;
}

afterEach(cleanup);

describe('buildOneLayerSelectorLists', () => {
  it('splits copper into the left list and non-copper into the right, in UI order', () => {
    const b = boardWithLayers(
      PCB_LAYER_ID.B_Cu,
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.F_SilkS,
      PCB_LAYER_ID.Edge_Cuts,
    );

    const { left, right } = buildOneLayerSelectorLists(b, new LSET(), theme);

    expect(left.map((r) => r.layer)).toEqual([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]);
    expect(right.map((r) => r.layer)).toContain(PCB_LAYER_ID.F_SilkS);
    expect(right.map((r) => r.layer)).toContain(PCB_LAYER_ID.Edge_Cuts);
  });

  it('skips a layer in aNotAllowedLayersMask even though the board enables it', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);

    const { left } = buildOneLayerSelectorLists(b, new LSET([PCB_LAYER_ID.B_Cu]), theme);

    expect(left.map((r) => r.layer)).toEqual([PCB_LAYER_ID.F_Cu]);
  });

  it('prefixes every name with a leading space, matching buildList()', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu);
    const { left } = buildOneLayerSelectorLists(b, new LSET(), theme);
    expect(left[0]!.name.startsWith(' ')).toBe(true);
    expect(left[0]!.name.trim()).toBe(b.GetLayerName(PCB_LAYER_ID.F_Cu));
  });

  it('gives F.Cu and B.Cu a hotkey suffix and every other layer none', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.In1_Cu);
    const { left } = buildOneLayerSelectorLists(b, new LSET(), theme);

    const byLayer = new Map(left.map((r) => [r.layer, r.hotkey]));
    expect(byLayer.get(PCB_LAYER_ID.F_Cu)).toContain('PgUp');
    expect(byLayer.get(PCB_LAYER_ID.B_Cu)).toContain('PgDn');
    expect(byLayer.get(PCB_LAYER_ID.In1_Cu)).toBe('');
  });

  it('never gives a non-copper row a hotkey', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_SilkS);
    const { right } = buildOneLayerSelectorLists(b, new LSET(), theme);
    expect(right.length).toBeGreaterThan(0);
    expect(right.every((r) => r.hotkey === '')).toBe(true);
  });
});

describe('PcbOneLayerSelector', () => {
  it('renders a row per enabled, allowed layer in each grid', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.F_SilkS);
    render(
      <PcbOneLayerSelector
        board={b}
        theme={theme}
        notAllowedLayersMask={new LSET()}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/F\.Cu/)).toBeTruthy();
    expect(screen.getByText(/B\.Cu/)).toBeTruthy();
    // `BOARD::GetLayerName` shows `LayerName()`, the display form: F.SilkS
    // shows as "F.Silkscreen" (`pcb_layer_presentation.ts`'s own doc comment).
    expect(screen.getByText(/F\.Silkscreen/)).toBeTruthy();
  });

  it('a click on a grid row selects that layer and does not cancel', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    render(
      <PcbOneLayerSelector
        board={b}
        theme={theme}
        notAllowedLayersMask={new LSET()}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    );

    const cell = screen.getByText(/B\.Cu/);
    const row = cell.closest('td')!;
    fireEvent.mouseDown(row, { button: 0 });

    expect(onSelect).toHaveBeenCalledWith(PCB_LAYER_ID.B_Cu);
    expect(onCancel).not.toHaveBeenCalled();
  });

  // PCB_ONE_LAYER_SELECTOR is a plain ShowModal() (sel_layer.cpp:355) with no activate or
  // focus-loss handler: a click outside it does nothing, as for every modal dialog; Escape is
  // wxID_CANCEL.
  it('ignores a click outside it, and Escape cancels', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu);
    const onCancel = vi.fn();
    const { container } = render(
      <PcbOneLayerSelector
        board={b}
        theme={theme}
        notAllowedLayersMask={new LSET()}
        onSelect={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.mouseDown(container.querySelector('.ze-modal-backdrop')!);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a masked-out F.Cu is not offered, and its hotkey no longer selects it', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    const onSelect = vi.fn();
    const { container } = render(
      <PcbOneLayerSelector
        board={b}
        theme={theme}
        notAllowedLayersMask={new LSET([PCB_LAYER_ID.F_Cu])}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/F\.Cu/)).toBeNull();

    fireEvent.keyDown(container.querySelector('.ze-modal')!, { key: 'PageUp' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('the bound layer-switch hotkey (Page Up = F.Cu) selects and closes like a click', () => {
    const b = boardWithLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    const onSelect = vi.fn();
    const { container } = render(
      <PcbOneLayerSelector
        board={b}
        theme={theme}
        notAllowedLayersMask={new LSET()}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    );
    fireEvent.keyDown(container.querySelector('.ze-modal')!, { key: 'PageUp' });
    expect(onSelect).toHaveBeenCalledWith(PCB_LAYER_ID.F_Cu);
  });
});
