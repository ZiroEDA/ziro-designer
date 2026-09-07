// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Zone Hatch Offsets —
 * `PANEL_SETUP_ZONE_HATCH_OFFSETS` with the shared
 * `LAYER_PROPERTIES_GRID_TABLE`, plus the `SyncCopperLayers` fan-out that keeps
 * its rows in step with the copper count.
 *
 * The reuse is the point here as much as the behaviour: upstream this grid is
 * its own header because Board Setup AND `panel_zone_properties.cpp` both take
 * it, and the layer swatch comes from `LAYER_PRESENTATION`, which every
 * layer-bearing widget shares. So these assert against the shared modules, not
 * against a page-private copy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type JSX } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PanelPcbZoneHatchOffsets } from '@ziroeda/designer/src/editors/pcb/dialogs/panels/panel_pcb_zone_hatch_offsets.js';
import {
  ZONE_LAYER_GRID_COLUMNS,
  ZoneLayerPropertiesGrid,
} from '@ziroeda/designer/src/widgets/zone_layer_properties_grid.js';
import {
  copperStackNames,
  defaultBoardSetup,
  syncCopperLayers,
  type ZoneLayerPropertiesMap,
} from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import {
  applyBoardFileSetup,
  writeBoardFileSetup,
} from '@ziroeda/designer/src/editors/pcb/board_file_settings.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/pcbnew/src/layer_ids.js';

afterEach(cleanup);

function Harness({
  layers,
  initial = {},
}: {
  layers: readonly string[];
  initial?: ZoneLayerPropertiesMap;
}): JSX.Element {
  const [v, setV] = useState<ZoneLayerPropertiesMap>(initial);
  return <PanelPcbZoneHatchOffsets copperLayers={layers} value={v} onChange={setV} />;
}

const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
)`;

describe('the page', () => {
  it('is a caption, a rule and the shared grid', () => {
    render(<Harness layers={copperStackNames(2)} />);
    expect(screen.getByText('Zone Hatched Fill Offsets')).toBeTruthy();
    expect(document.querySelector('.ze-zone-hatch-rule')).not.toBeNull();
    expect(document.querySelector('.ze-zone-layer-grid')).not.toBeNull();
  });

  it('labels the columns Layer / Offset X / Offset Y', () => {
    // The TABLE's `GetColLabelValue()` (`zone_layer_properties_grid.h:48-57`),
    // which replaces the base's "X Offset" / "Y Offset" when SetTable runs.
    expect([...ZONE_LAYER_GRID_COLUMNS]).toEqual(['Layer', 'Offset X', 'Offset Y']);
    render(<Harness layers={copperStackNames(2)} />);
    expect(
      [...document.querySelectorAll('.ze-zone-layer-grid th')].map((t) => t.textContent),
    ).toEqual(['Layer', 'Offset X', 'Offset Y']);
  });

  it('draws one row per enabled copper layer, B.Cu last', () => {
    // `for( PCB_LAYER_ID layer : LSET::AllCuMask().UIOrder() )` — CuStack order,
    // which reaches B.Cu after the inner layers.
    render(<Harness layers={copperStackNames(4)} />);
    const names = [...document.querySelectorAll('.ze-zone-layer-name')].map((c) => c.textContent);
    expect(names).toEqual(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
  });

  it('shows an unset layer as zero, with the unit in the cell', () => {
    // `GetValue()` is `hatching_offset.value_or( VECTOR2I() )` and goes through
    // `StringFromValue( …, true )`.
    render(<Harness layers={copperStackNames(2)} />);
    expect((screen.getByLabelText('F.Cu offset X') as HTMLInputElement).value).toBe('0 mm');
    expect((screen.getByLabelText('B.Cu offset Y') as HTMLInputElement).value).toBe('0 mm');
  });

  it('gives a layer an offset the moment one axis is edited', () => {
    // `SetValue()` assigns the whole VECTOR2I back, so the optional becomes set.
    render(<Harness layers={copperStackNames(2)} />);
    fireEvent.change(screen.getByLabelText('F.Cu offset X'), { target: { value: '0.5 mm' } });
    expect((screen.getByLabelText('F.Cu offset X') as HTMLInputElement).value).toBe('0.5 mm');
    expect((screen.getByLabelText('F.Cu offset Y') as HTMLInputElement).value).toBe('0 mm');
  });

  it('edits one axis without disturbing the other', () => {
    // `SetValue()` starts from `hatching_offset.value_or( VECTOR2I() )` and
    // replaces ONE member (`zone_settings.cpp:410-423`). Starting both axes at
    // zero cannot tell that apart from rebuilding the pair, so Y starts at -3.
    render(
      <Harness
        layers={copperStackNames(2)}
        initial={{ 'F.Cu': { hatchingOffset: { x: 0, y: -3 } } }}
      />,
    );
    fireEvent.change(screen.getByLabelText('F.Cu offset X'), { target: { value: '0.5 mm' } });
    expect((screen.getByLabelText('F.Cu offset Y') as HTMLInputElement).value).toBe('-3 mm');

    fireEvent.change(screen.getByLabelText('F.Cu offset Y'), { target: { value: '7 mm' } });
    expect((screen.getByLabelText('F.Cu offset X') as HTMLInputElement).value).toBe('0.5 mm');
  });
});

describe('the grid is content-sized, so it must not be contained', () => {
  // Upstream adds it `Add( m_layerOffsetsGrid, 0, wxALL, 5 )` — proportion 0,
  // i.e. it takes its own size rather than stretching. A `contain: inline-size`
  // on such a box has nothing left to size it and it collapses: the page went
  // blank, caption and rule only, when that landed on the shared pane class.
  const css = readFileSync(join(__dirname, '../../../designer/src/ui/shell.css'), 'utf8');
  const ruleFor = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    if (at === -1) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };

  it('is content-sized and uncontained', () => {
    expect(ruleFor('.ze-zone-layer-grid')).toMatch(/align-self:\s*flex-start/);
    expect(ruleFor('.ze-zone-layer-grid')).not.toMatch(/contain:/);
    expect(ruleFor('.ze-grid-pane')).not.toMatch(/contain:\s*inline-size/);
  });

  it('still draws its rows', () => {
    render(<Harness layers={copperStackNames(2)} />);
    expect(document.querySelectorAll('.ze-zone-layer-name')).toHaveLength(2);
  });
});

describe('the grid is the shared one', () => {
  it('renders standalone, the way panel_zone_properties would take it', () => {
    // If this only worked inside the Board Setup panel it would not be the
    // shared table upstream has, and the zone dialog would need a second copy.
    render(
      <ZoneLayerPropertiesGrid
        layers={['F.Cu', 'B.Cu']}
        value={{ 'F.Cu': { hatchingOffset: { x: 1, y: -2 } } }}
        onChange={() => {}}
      />,
    );
    expect((screen.getByLabelText('F.Cu offset X') as HTMLInputElement).value).toBe('1 mm');
    expect((screen.getByLabelText('F.Cu offset Y') as HTMLInputElement).value).toBe('-2 mm');
  });

  it('draws each layer’s swatch from LAYER_PRESENTATION', () => {
    render(<Harness layers={copperStackNames(2)} />);
    const swatches = [...document.querySelectorAll('.ze-zone-layer-name .ze-combo-swatch')];
    expect(swatches).toHaveLength(2);
    // F.Cu and B.Cu are different colours, so a shared swatch source shows two.
    const colors = swatches.map((s) => (s as HTMLElement).style.background);
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[0]).toMatch(/rgb/);
  });
});

describe('LSET_NameToLayer is the inverse of LSET_Name', () => {
  it('round-trips every layer the writer can name', () => {
    // One table read each way — the point of putting it beside LSET_Name.
    for (const id of [0, 2, 4, 6, 1, 3, 5, 17, 19, 25, 27, 31, 35, 39, 41, 127])
      expect(LSET_NameToLayer(LSET_Name(id)), String(id)).toBe(id);
  });

  it('returns UNDEFINED_LAYER for a name it does not know', () => {
    expect(LSET_NameToLayer('Nonsense.Layer')).toBe(-1);
  });
});

describe('SyncCopperLayers', () => {
  it('rebuilds the copper rows to the new stack, keeping what survives', () => {
    // `m_enabledLayers` loses every copper id then gains `AllCuMask( n )`
    // (`panel_setup_layers.cpp:598-607`).
    let v = defaultBoardSetup();
    v.layers.layers = v.layers.layers.map((l) =>
      l.id === 'F.Cu' ? { ...l, name: 'Top', copperType: 'power' as const } : l,
    );

    v = syncCopperLayers(v, 4);
    const copper = v.layers.layers.filter((l) => l.kind === 'copper');
    expect(copper.map((l) => l.id)).toEqual(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
    // A surviving layer keeps its name and type.
    expect(copper[0]).toMatchObject({ name: 'Top', copperType: 'power' });
    expect(v.physicalStackup.copperCount).toBe(4);

    // and the copper block stays between the front technical layers and B.Mask.
    const ids = v.layers.layers.map((l) => l.id);
    expect(ids.indexOf('F.Mask')).toBeLessThan(ids.indexOf('F.Cu'));
    expect(ids.indexOf('B.Cu')).toBeLessThan(ids.indexOf('B.Mask'));
  });

  it('drops the hatch offsets of a layer that leaves the stack', () => {
    // `SyncCopperLayers` deletes the rows of layers no longer enabled
    // (`panel_setup_zone_hatch_offsets.cpp:84-97`).
    let v = syncCopperLayers(defaultBoardSetup(), 4);
    v.zoneLayerProperties = {
      'F.Cu': { hatchingOffset: { x: 1, y: 1 } },
      'In2.Cu': { hatchingOffset: { x: 2, y: 2 } },
    };
    v = syncCopperLayers(v, 2);
    expect(Object.keys(v.zoneLayerProperties)).toEqual(['F.Cu']);
  });
});

describe('(zone_defaults …) round-trips through the board file', () => {
  it('writes nothing at all when no layer has an offset', () => {
    // `format()` returns early on an unset optional, and the block itself is
    // only opened when the map is non-empty (`pcb_io_kicad_sexpr.cpp:607`).
    const s = defaultBoardSetup();
    expect(writeBoardFileSetup(BOARD, s)).not.toContain('zone_defaults');
    s.zoneLayerProperties = { 'F.Cu': {} }; // present but unset
    expect(writeBoardFileSetup(BOARD, s)).not.toContain('zone_defaults');
  });

  it('writes a property per layer that has one', () => {
    const s = defaultBoardSetup();
    s.zoneLayerProperties = { 'F.Cu': { hatchingOffset: { x: 0.5, y: -0.25 } } };
    const out = writeBoardFileSetup(BOARD, s)!;
    expect(out).toContain('zone_defaults');
    expect(out).toContain('"F.Cu"');
    expect(out).toContain('hatch_position');
    expect(out).toMatch(/\(xy 0\.5 -0\.25\)/);
  });

  it('reads them back', () => {
    const s = defaultBoardSetup();
    s.zoneLayerProperties = { 'B.Cu': { hatchingOffset: { x: 1.25, y: 2 } } };
    const out = writeBoardFileSetup(BOARD, s)!;

    const back = defaultBoardSetup();
    expect(applyBoardFileSetup(out, back)).toBe(true);
    expect(back.zoneLayerProperties['B.Cu']).toEqual({ hatchingOffset: { x: 1.25, y: 2 } });
  });
});
