// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_MAP_LAYERS (dialog_map_layers.cpp): the mapping state machine, the
 * `" *"` marker on required layers, and `RunModal`'s refusal loop.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  DIALOG_MAP_LAYERS,
  DialogMapLayers,
  UNMATCHED_REQUIRED_MESSAGE,
} from '@ziroeda/pcbnew/dialogs/dialog_map_layers.js';
import type { INPUT_LAYER_DESC } from '@ziroeda/pcbnew/pcb_io/common/plugin_common_layer_mapping.js';

afterEach(cleanup);

const desc = (
  Name: string,
  permitted: PCB_LAYER_ID[],
  AutoMapLayer: PCB_LAYER_ID,
  Required: boolean,
): INPUT_LAYER_DESC => ({ Name, PermittedLayers: new LSET(permitted), AutoMapLayer, Required });

const LAYERS = (): INPUT_LAYER_DESC[] => [
  desc('Top Layer', [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu], PCB_LAYER_ID.F_Cu, true),
  desc('Bottom Layer', [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu], PCB_LAYER_ID.B_Cu, true),
  desc(
    'Mechanical 1',
    [PCB_LAYER_ID.Edge_Cuts, PCB_LAYER_ID.F_Fab],
    PCB_LAYER_ID.UNSELECTED_LAYER,
    false,
  ),
];

describe('DIALOG_MAP_LAYERS state', () => {
  it('a required layer carries " *", and the plain name is what the map is keyed by', () => {
    const d = new DIALOG_MAP_LAYERS(LAYERS());
    expect(d.m_unmatched_rows).toEqual(['Top Layer *', 'Bottom Layer *', 'Mechanical 1']);
    expect(DIALOG_MAP_LAYERS.UnwrapRequired('Top Layer *')).toBe('Top Layer');
    expect(DIALOG_MAP_LAYERS.UnwrapRequired('Top Layer')).toBe('Top Layer');
    d.AddMappings([0], 0);
    expect([...d.m_matched_layers_map.keys()]).toEqual(['Top Layer']);
  });

  it('the KiCad list is the union of every permitted set, in UI order', () => {
    const d = new DIALOG_MAP_LAYERS(LAYERS());
    expect(d.m_kicad_rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        PCB_LAYER_ID.F_Cu,
        PCB_LAYER_ID.B_Cu,
        PCB_LAYER_ID.Edge_Cuts,
        PCB_LAYER_ID.F_Fab,
      ]),
    );
    expect(d.m_kicad_rows).toHaveLength(4);
    expect(d.m_kicad_rows[0]!.id).toBe(PCB_LAYER_ID.F_Cu);
  });

  it('> maps the selected rows onto the selected KiCad layer, newest matched row first', () => {
    const d = new DIALOG_MAP_LAYERS(LAYERS());
    const kicadRow = d.m_kicad_rows.findIndex((r) => r.id === PCB_LAYER_ID.B_Cu);

    const after = d.AddMappings([0, 2], kicadRow);

    expect(d.m_matched_layers_map.get('Top Layer')).toBe(PCB_LAYER_ID.B_Cu);
    expect(d.m_matched_layers_map.get('Mechanical 1')).toBe(PCB_LAYER_ID.B_Cu);
    expect(d.m_matched_rows.map((r) => r.imported)).toEqual(['Mechanical 1', 'Top Layer *']);
    expect(d.m_unmatched_rows).toEqual(['Bottom Layer *']);
    expect(after).toEqual([0]);
  });

  it('> with no KiCad layer selected does nothing', () => {
    const d = new DIALOG_MAP_LAYERS(LAYERS());
    d.AddMappings([0], -1);
    expect(d.m_matched_rows).toEqual([]);
    expect(d.m_unmatched_rows).toHaveLength(3);
  });

  it('< puts a layer back at the TOP of the unmatched list and forgets its mapping', () => {
    const d = new DIALOG_MAP_LAYERS(LAYERS());
    d.AddMappings([0], 0);
    d.RemoveMappings([0]);
    expect(d.m_unmatched_rows[0]).toBe('Top Layer *');
    expect(d.m_matched_layers_map.size).toBe(0);
    expect(d.GetUnmappedRequiredLayers()).toEqual(['Bottom Layer', 'Top Layer']);
  });

  it('<< removes every matched layer', () => {
    const d = new DIALOG_MAP_LAYERS(LAYERS());
    d.OnAutoMatchLayersClicked();
    expect(d.m_matched_rows).toHaveLength(2);
    d.RemoveMappings('all');
    expect(d.m_matched_rows).toEqual([]);
    expect(d.m_matched_layers_map.size).toBe(0);
  });

  it('Auto-Match takes every layer with an AutoMapLayer and leaves UNSELECTED ones', () => {
    const d = new DIALOG_MAP_LAYERS(LAYERS());
    d.OnAutoMatchLayersClicked();
    expect(d.m_matched_layers_map.get('Top Layer')).toBe(PCB_LAYER_ID.F_Cu);
    expect(d.m_matched_layers_map.get('Bottom Layer')).toBe(PCB_LAYER_ID.B_Cu);
    expect(d.m_unmatched_rows).toEqual(['Mechanical 1']);
    expect(d.GetUnmappedRequiredLayers()).toEqual([]);
  });

  it('the first layer of a name stays in the map (std::map::insert)', () => {
    const d = new DIALOG_MAP_LAYERS([
      desc('Dup', [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu], PCB_LAYER_ID.UNSELECTED_LAYER, false),
    ]);
    d.AddMappings([0], 0);
    d.RemoveMappings('all');
    d.m_unmatched_rows = ['Dup'];
    d.m_unmatched_layer_names = ['Dup'];
    d.AddMappings([0], 0);
    d.m_unmatched_rows = ['Dup'];
    d.m_unmatched_layer_names = ['Dup'];
    d.AddMappings([0], 1);
    expect(d.m_matched_layers_map.get('Dup')).toBe(PCB_LAYER_ID.F_Cu);
  });
});

describe('DialogMapLayers', () => {
  it('OK with a required layer unmatched raises the error and stays open', () => {
    const onDone = vi.fn();
    render(<DialogMapLayers layers={LAYERS()} keepKiCadLayerNames={false} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText(UNMATCHED_REQUIRED_MESSAGE)).toBeTruthy();
    expect(screen.getByText('Unmatched Layers', { selector: '.ze-msgdlg-title' })).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Auto-Match then OK returns the map and the Keep KiCad layer names checkbox', () => {
    const onDone = vi.fn();
    render(<DialogMapLayers layers={LAYERS()} keepKiCadLayerNames={false} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-Match Layers' }));
    fireEvent.click(screen.getByLabelText('Keep KiCad layer names'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDone).toHaveBeenCalledOnce();
    const [map, keep] = onDone.mock.calls[0]!;
    expect(map.get('Top Layer')).toBe(PCB_LAYER_ID.F_Cu);
    expect(keep).toBe(true);
  });

  it('opens with the first imported layer and the first KiCad layer selected, and > maps them', () => {
    render(<DialogMapLayers layers={LAYERS()} keepKiCadLayerNames={false} onDone={() => {}} />);
    fireEvent.click(screen.getByTitle('Add selected layers to matched layers list.'));
    const matched = screen.getByLabelText('Matched layers');
    expect(within(matched).getByText('Top Layer *')).toBeTruthy();
    expect(within(matched).getByText('F.Cu')).toBeTruthy();
  });

  it('draws the three group labels and the matched list headers the base file states', () => {
    render(<DialogMapLayers layers={LAYERS()} keepKiCadLayerNames={false} onDone={() => {}} />);
    for (const t of [
      'Unmatched Layers',
      'Matched Layers',
      'Imported Layers',
      'KiCad Layers',
      'Imported Layer',
      'KiCad Layer',
    ])
      expect(screen.getByText(t)).toBeTruthy();
  });
});

describe('DialogMapLayers, closing the window', () => {
  it('Esc is ShowModal returning: with everything matched it finishes, like OK', () => {
    const onDone = vi.fn();
    render(<DialogMapLayers layers={LAYERS()} keepKiCadLayerNames={false} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-Match Layers' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('Esc with a required layer unmatched raises the same error instead of returning', () => {
    const onDone = vi.fn();
    render(<DialogMapLayers layers={LAYERS()} keepKiCadLayerNames={false} onDone={onDone} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText(UNMATCHED_REQUIRED_MESSAGE)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
