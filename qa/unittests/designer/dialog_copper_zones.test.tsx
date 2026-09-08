// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper Zone Properties — `DIALOG_COPPER_ZONE` over `PANEL_ZONE_PROPERTIES`.
 *
 * This dialog was a single vertical scroll of four boxed groups with the
 * layers as two inline checkboxes. Upstream is a horizontal split with the
 * layer list on the left and a **three-tab notebook** on the right, with
 * Corner smoothing and Remove islands sitting OUTSIDE that notebook. So the
 * assertions here are mostly about shape: which control is on which page, and
 * which ones are hidden rather than disabled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogCopperZones } from '@ziroeda/designer/src/editors/pcb/dialogs/dialog_copper_zones.js';
import type { ZoneValues } from '@ziroeda/pcbnew/src/zone_properties.js';

afterEach(cleanup);

/** pcbnew's internal units per millimetre. */
const IU = 1e6;

const BASE: ZoneValues = {
  name: '',
  net: 1,
  layers: ['F.Cu'],
  locked: false,
  clearance: 0.5 * IU,
  minThickness: 0.25 * IU,
  padConnection: 'thermal',
  thermalGap: 0.5 * IU,
  thermalBridgeWidth: 0.5 * IU,
  hatchStyle: 'edge',
  hatchPitch: 0.5 * IU,
  cornerSmoothing: 'none',
  cornerRadius: 0,
  islandRemovalMode: 'always',
  islandAreaMin: 10,
  fillMode: 'solid',
  hatchThickness: 0,
  hatchGap: 0,
  hatchOrientation: 0,
  hatchSmoothingLevel: 0,
  hatchSmoothingValue: 0,
  hatchHoleMinArea: 0.3,
  filled: true,
  priority: 0,
  layerProperties: {},
};

const LAYERS = [
  { name: 'F.Cu', color: 'rgb(200, 52, 52)' },
  { name: 'B.Cu', color: 'rgb(77, 127, 196)' },
];

const NETS = new Map([
  [0, ''],
  [1, 'GND'],
]);

function open(
  over: Partial<ZoneValues> = {},
  props: { onApply?: (v: ZoneValues) => void; existingZone?: boolean } = {},
): void {
  render(
    <DialogCopperZones
      units="mm"
      initial={{ ...BASE, ...over }}
      nets={NETS}
      layers={LAYERS}
      existingZone={props.existingZone}
      onApply={props.onApply ?? (() => {})}
      onClose={() => {}}
    />,
  );
}

const tab = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('the frame', () => {
  it('puts the layer list beside the fields, not inside them', () => {
    open();
    // `bMainSizer` is horizontal with `bSizerLeft` at proportion 0.
    const list = document.querySelector('.ze-cz-layers');
    expect(list).toBeTruthy();
    expect(screen.getByText('Layers:')).toBeTruthy();
    // Each row carries the layer's colour swatch, as the wxDataViewListCtrl's
    // renderer draws.
    expect(document.querySelectorAll('.ze-cz-layer-list .ze-layer-swatch')).toHaveLength(2);
  });

  it('hides the Zone Manager button for a zone still being drawn', () => {
    // "A zone still in creation (ie: not yet in the document) can't be edited
    // by the Zone Manager."
    open();
    expect(screen.queryByText('Open Zone Manager...')).toBeNull();

    cleanup();
    open({}, { existingZone: true });
    expect(screen.getByText('Open Zone Manager...')).toBeTruthy();
  });
});

describe('the three notebook pages', () => {
  it('opens on Clearances && Pad Connections', () => {
    // `AddPage( m_clearancesPanel, …, true )`.
    open();
    expect(tab('Clearances & Pad Connections').className).toContain('active');
    expect(screen.getByText('Pad connections:')).toBeTruthy();
  });

  it('keeps Outline display on Display Overrides, not on the first page', () => {
    open();
    expect(screen.queryByText('Outline display:')).toBeNull();
    fireEvent.click(tab('Display Overrides'));
    expect(screen.getByText('Outline display:')).toBeTruthy();
    expect(screen.getByText('Outline hatch pitch:')).toBeTruthy();
  });

  it('keeps the hatch parameters on Hatched Fill', () => {
    open();
    expect(screen.queryByText('Hatch width:')).toBeNull();
    fireEvent.click(tab('Hatched Fill'));
    expect(screen.getByText('Hatched fill')).toBeTruthy();
    expect(screen.getByText('Hatch width:')).toBeTruthy();
    expect(screen.getByText('Hatch offset overrides:')).toBeTruthy();
  });
});

describe('what this dialog does NOT have', () => {
  it('no Filled checkbox, no Fill type choice and no Priority', () => {
    // None of the three is in `panel_zone_properties_base.cpp`: the fill mode
    // is the `Hatched fill` checkbox and priority moved to the Zone Manager.
    open();
    for (const gone of ['Filled', 'Fill type:', 'Priority:'])
      expect(screen.queryByText(gone)).toBeNull();
  });
});

describe('Corner smoothing and Remove islands sit outside the notebook', () => {
  it('stay visible on every page', () => {
    open();
    for (const t of ['Clearances & Pad Connections', 'Display Overrides', 'Hatched Fill']) {
      fireEvent.click(tab(t));
      expect(screen.getByText('Corner smoothing:')).toBeTruthy();
      expect(screen.getByText('Remove islands:')).toBeTruthy();
    }
  });

  it('hides Radius until the smoothing is Chamfer or Fillet', () => {
    // `OnCornerSmoothingSelection` — `Show( false )`, and the cell is reserved.
    open();
    expect(screen.getByText('Radius:').hasAttribute('hidden')).toBe(true);

    cleanup();
    open({ cornerSmoothing: 'fillet' });
    expect(screen.getByText('Radius:').hasAttribute('hidden')).toBe(false);
  });

  it('hides Area limit until the mode is Below area limit', () => {
    open();
    expect(screen.getByText('Area limit:').hasAttribute('hidden')).toBe(true);

    cleanup();
    open({ islandRemovalMode: 'area' });
    expect(screen.getByText('Area limit:').hasAttribute('hidden')).toBe(false);
  });
});

describe('<no net>', () => {
  it('raises the infobar', () => {
    // `updateInfoBar()`: shown while the selected netcode is <= INVALID_NET_CODE.
    open({ net: 0 });
    expect(screen.getByText('<no net> will result in an isolated copper island.')).toBeTruthy();

    cleanup();
    open({ net: 1 });
    expect(screen.queryByText('<no net> will result in an isolated copper island.')).toBeNull();
  });

  it('forces Remove islands to Never and disables it', () => {
    // "Zones with no net never have islands removed."
    open({ net: 0, islandRemovalMode: 'always' });
    const combo = document.querySelector<HTMLButtonElement>('#ze-cz-islands');
    expect(combo!.disabled).toBe(true);
    expect(combo!.textContent).toContain('Never');
  });

  it('hands back Never even though the value came in as Always', () => {
    const onApply = vi.fn();
    open({ net: 0, islandRemovalMode: 'always' }, { onApply });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect((onApply.mock.calls[0]![0] as ZoneValues).islandRemovalMode).toBe('never');
  });

  it('leaves the mode alone when the zone has a net', () => {
    const onApply = vi.fn();
    open({ net: 1, islandRemovalMode: 'always' }, { onApply });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect((onApply.mock.calls[0]![0] as ZoneValues).islandRemovalMode).toBe('always');
  });
});

describe('the Hatched Fill tab', () => {
  it('is the fill mode: the checkbox IS ZONE_FILL_MODE', () => {
    const onApply = vi.fn();
    open({ fillMode: 'solid' }, { onApply });
    fireEvent.click(tab('Hatched Fill'));
    fireEvent.click(screen.getByLabelText('Hatched fill', { selector: 'input' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect((onApply.mock.calls[0]![0] as ZoneValues).fillMode).toBe('hatch');
  });

  it('greys its parameters while the fill is solid', () => {
    // `enableHatchedFill( enable )` runs over every one of them.
    open({ fillMode: 'solid' });
    fireEvent.click(tab('Hatched Fill'));
    expect((document.querySelector('.ze-cz-hatchfields') as HTMLFieldSetElement).disabled).toBe(
      true,
    );

    cleanup();
    open({ fillMode: 'hatch' });
    fireEvent.click(tab('Hatched Fill'));
    expect((document.querySelector('.ze-cz-hatchfields') as HTMLFieldSetElement).disabled).toBe(
      false,
    );
  });

  it('adds one override row per layer, and refuses once every layer has one', () => {
    // `OnAddLayerItem` puts up "All zone layers already overridden." when
    // there is nothing left to add.
    open({ fillMode: 'hatch', layers: ['F.Cu'] });
    fireEvent.click(tab('Hatched Fill'));
    const add = screen.getByTitle('Add a layer override') as HTMLButtonElement;

    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(screen.getByLabelText('F.Cu X Offset')).toBeTruthy();
    expect((screen.getByTitle('Add a layer override') as HTMLButtonElement).disabled).toBe(true);
  });
});
