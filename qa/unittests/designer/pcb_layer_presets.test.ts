// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The layer presets combo: `rebuildLayerPresetsWidget` (`:2725`) and
 * `syncLayerPresetSelection` (`:2785`).
 *
 * The expected combo order below was also read off a live KiCad 10.0.5 on
 * this machine, with the dropdown open — see the audit capture.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PRESETS,
  matchPresetName,
  presetComboItems,
  PRESET_SEPARATOR,
} from '@ziroeda/designer/src/widgets/appearance_presets.js';

const ALL = ['F.Cu', 'In1.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'];
const CU = ['F.Cu', 'In1.Cu', 'B.Cu'];
const base = {
  objectsAtDefault: true,
  flipBoard: false,
  allLayers: ALL,
  copperLayers: CU,
};

describe('the combo lists the built-ins alphabetically', () => {
  it('matches the open dropdown of a real pcbnew', () => {
    expect(presetComboItems()).toEqual([
      'All Copper Layers',
      'All Layers',
      'Back Assembly View',
      'Back Layers',
      'Front Assembly View',
      'Front Layers',
      'Inner Copper Layers',
      'No Layers',
      PRESET_SEPARATOR,
      'Save preset...',
      'Delete preset...',
    ]);
  });

  it('does not open on the declaration order', () => {
    // m_layerPresets is a std::map, so "All Layers" — first in the source —
    // is second on screen. This is the whole bug.
    expect(presetComboItems()[0]).toBe('All Copper Layers');
    // …and that is NOT the first one declared, which is the whole bug.
    expect(BUILTIN_PRESETS[0]?.name).toBe('All Layers');
    expect(presetComboItems()[0]).not.toBe(BUILTIN_PRESETS[0]?.name);
  });

  it('never offers an "(unsaved)" entry', () => {
    expect(presetComboItems()).not.toContain('(unsaved)');
    expect(presetComboItems(['mine'])).not.toContain('(unsaved)');
  });

  it('puts user presets after a separator of their own, sorted', () => {
    expect(presetComboItems(['zed', 'alpha'])).toEqual([
      'All Copper Layers',
      'All Layers',
      'Back Assembly View',
      'Back Layers',
      'Front Assembly View',
      'Front Layers',
      'Inner Copper Layers',
      'No Layers',
      PRESET_SEPARATOR,
      'alpha',
      'zed',
      PRESET_SEPARATOR,
      'Save preset...',
      'Delete preset...',
    ]);
  });

  it('omits the user separator when there are no user presets', () => {
    expect(presetComboItems().filter((x) => x === PRESET_SEPARATOR)).toHaveLength(1);
    expect(presetComboItems(['mine']).filter((x) => x === PRESET_SEPARATOR)).toHaveLength(2);
  });

  it('keeps the separator third from last, where SetSelection(count-3) points', () => {
    for (const users of [[], ['a'], ['a', 'b']]) {
      const items = presetComboItems(users);
      expect(items[items.length - 3]).toBe(PRESET_SEPARATOR);
    }
  });
});

describe('the two Back presets view the board flipped', () => {
  it.each([
    ['Back Layers', true],
    ['Back Assembly View', true],
    ['Front Layers', false],
    ['All Layers', false],
    ['No Layers', false],
  ])('%s has flipBoard %s', (name, flip) => {
    expect(BUILTIN_PRESETS.find((p) => p.name === name)?.flipBoard).toBe(flip);
  });

  it('sets an active layer for the two assembly views and no others', () => {
    const withActive = BUILTIN_PRESETS.filter((p) => p.activeLayer !== undefined);
    expect(withActive.map((p) => [p.name, p.activeLayer])).toEqual([
      ['Front Assembly View', 'F.SilkS'],
      ['Back Assembly View', 'B.SilkS'],
    ]);
  });
});

describe('the shown entry is derived from the view', () => {
  it('names the preset whose layers the view matches', () => {
    expect(matchPresetName({ ...base, visibleLayers: new Set(ALL) })).toBe('All Layers');
    expect(matchPresetName({ ...base, visibleLayers: new Set() })).toBe('No Layers');
    expect(matchPresetName({ ...base, visibleLayers: new Set([...CU, 'Edge.Cuts']) })).toBe(
      'All Copper Layers',
    );
  });

  it('falls to the separator when the view matches nothing', () => {
    expect(matchPresetName({ ...base, visibleLayers: new Set(['F.Cu']) })).toBe(PRESET_SEPARATOR);
  });

  it('falls to the separator when one layer is toggled off', () => {
    const nearly = new Set(ALL);
    nearly.delete('B.Mask');
    expect(matchPresetName({ ...base, visibleLayers: nearly })).toBe(PRESET_SEPARATOR);
  });

  it('will not claim a preset when the Objects tab has been touched', () => {
    // Every built-in carries renderLayers = GAL_SET::DefaultVisible().
    expect(matchPresetName({ ...base, visibleLayers: new Set(ALL), objectsAtDefault: false })).toBe(
      PRESET_SEPARATOR,
    );
  });

  it('will not claim a flat preset while the board is flipped', () => {
    expect(matchPresetName({ ...base, visibleLayers: new Set(ALL), flipBoard: true })).toBe(
      PRESET_SEPARATOR,
    );
  });

  it('does claim Back Layers only while flipped', () => {
    const backSet = new Set(['B.Cu', 'B.SilkS', 'B.Mask', 'Edge.Cuts']);
    expect(matchPresetName({ ...base, visibleLayers: backSet, flipBoard: true })).toBe(
      'Back Layers',
    );
    expect(matchPresetName({ ...base, visibleLayers: backSet, flipBoard: false })).toBe(
      PRESET_SEPARATOR,
    );
  });

  it('names a user preset the view matches', () => {
    expect(
      matchPresetName({
        ...base,
        visibleLayers: new Set(['F.Cu']),
        userPresets: [{ name: 'mine', layers: ['F.Cu'] }],
      }),
    ).toBe('mine');
  });

  it('resolves a preset against the layers this board actually has', () => {
    // A two-layer board has no In1.Cu, so All Copper Layers is F.Cu+B.Cu+Edge.
    const twoLayer = {
      ...base,
      allLayers: ['F.Cu', 'B.Cu', 'Edge.Cuts'],
      copperLayers: ['F.Cu', 'B.Cu'],
    };
    expect(
      matchPresetName({ ...twoLayer, visibleLayers: new Set(['F.Cu', 'B.Cu', 'Edge.Cuts']) }),
    ).toBe('All Copper Layers');
  });
});
