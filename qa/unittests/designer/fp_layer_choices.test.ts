// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a layer cell on the footprint editor's Preferences pages offers.
 *
 * Both cells are `GRID_CELL_LAYER_SELECTOR( nullptr, … )` — a **null frame** —
 * and that one word is the whole of this file. `PCB_LAYER_BOX_SELECTOR::
 * getEnabledLayers()` returns `LSET::AllLayersMask()` when there is no board
 * frame (`pcb_layer_box_selector.cpp:129-136`), so the list is not the layer
 * set of any board:
 *
 *     LSET show = ( LSET::AllCuMask() | LSET::AllNonCuMask() ) & ~m_layerMaskDisable;
 *     LSET activated = getEnabledLayers() & ~m_layerMaskDisable;
 *     for( PCB_LAYER_ID layerid : show.UIOrder() )      // :57-101
 *
 * `AllNonCuMask()` is every ODD id (`common/lset.cpp:617-633`, which resets the
 * copper layers of a full set, and a full set's copper layers are every even
 * one), so `show` is 96 bits and `UIOrder()` yields 95 rows of it: the copper
 * stack, the eighteen written-out tech/user layers, then User.1 … User.45.
 * `Rescue` is in the set and in neither run, so it is never listed.
 *
 * Ours offered the 26 layers of the footprint editor's own dummy board — the
 * set the CANVAS has, which is what `footprintLayers()` is for and not what
 * this control shows. Akshay spotted it beside a live 10.0.5.
 */
import { describe, expect, it } from 'vitest';
import {
  allLayerChoices,
  userLayerChoices,
} from '@ziroeda/designer/src/editors/footprint/fp_layer_choices.js';
import { layerColor } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common';
import { toCssColor } from '@ziroeda/common/src/color4d.js';

const values = (rows: readonly { value: string }[]): string[] => rows.map((r) => r.value);
const labels = (rows: readonly { label: string }[]): string[] => rows.map((r) => r.label);

/** `LSET::CuStack()` over `AllCuMask()`: F.Cu, the inners, and B.Cu LAST. */
const COPPER = ['F.Cu', ...Array.from({ length: 30 }, (_, i) => `In${i + 1}.Cu`), 'B.Cu'];

/**
 * `LSET::TechAndUserUIOrder()`'s written-out head (`common/lset.cpp:282-300`),
 * transcribed. Not id order: B before F on adhesive, paste and silkscreen,
 * F before B on courtyard and fab.
 */
const TECH_AND_USER = [
  'F.Adhes',
  'B.Adhes',
  'F.Paste',
  'B.Paste',
  'F.SilkS',
  'B.SilkS',
  'F.Mask',
  'B.Mask',
  'Dwgs.User',
  'Cmts.User',
  'Eco1.User',
  'Eco2.User',
  'Edge.Cuts',
  'Margin',
  'F.CrtYd',
  'B.CrtYd',
  'F.Fab',
  'B.Fab',
];

const NUMBERED = Array.from({ length: 45 }, (_, i) => `User.${i + 1}`);

describe('Footprint Defaults offers every layer, in UIOrder', () => {
  it('is the copper stack, the tech/user run, then User.1 to User.45', () => {
    expect(values(allLayerChoices())).toEqual([...COPPER, ...TECH_AND_USER, ...NUMBERED]);
  });

  it('is 95 rows, not the 26 a footprint editor board has', () => {
    expect(allLayerChoices()).toHaveLength(95);
  });

  it('never lists Rescue, which is in the set but below User_1', () => {
    // `Rescue` is 37 and odd, so `AllNonCuMask()` carries it; the tail of
    // `TechAndUserUIOrder` keeps only `*it >= User_1` (39), and the head does
    // not name it (`common/lset.cpp:303-307`).
    expect(values(allLayerChoices())).not.toContain('Rescue');
  });

  it('stores the canonical token and shows the standard name', () => {
    // `GetValue()` is `BOARD::GetStandardLayerName`... but the STORED form is
    // `LSET::Name`, which is what `fpedit.json`'s
    // `default_footprint_text_items` carries: `["REF**", true, "F.SilkS"]`.
    const byValue = new Map(allLayerChoices().map((c) => [c.value, c.label]));
    expect(byValue.get('F.SilkS')).toBe('F.Silkscreen');
    expect(byValue.get('B.Adhes')).toBe('B.Adhesive');
    expect(byValue.get('Dwgs.User')).toBe('User.Drawings');
    expect(byValue.get('Eco2.User')).toBe('User.Eco2');
    expect(byValue.get('F.CrtYd')).toBe('F.Courtyard');
    // …and the ones `LayerName` leaves alone.
    expect(byValue.get('F.Fab')).toBe('F.Fab');
    expect(byValue.get('In7.Cu')).toBe('In7.Cu');
    expect(byValue.get('User.31')).toBe('User.31');
  });

  it('gives every row its own theme colour, including past User.9', () => {
    const byValue = new Map(allLayerChoices().map((c) => [c.value, c.swatch]));
    // `PCB_LAYER_COLORS` stopped at User_9, so User.10 and up drew the grid
    // colour — a grey swatch on a layer the theme has a colour for.
    expect(byValue.get('User.45')).toBe(toCssColor(BUILTIN_DEFAULT_THEME.User_45));
    expect(byValue.get('User.10')).toBe(toCssColor(BUILTIN_DEFAULT_THEME.User_10));
    expect(byValue.get('In30.Cu')).toBe(toCssColor(BUILTIN_DEFAULT_THEME.In30_Cu));
    // Not the fallback `layerColor` hands an unknown name.
    expect(byValue.get('User.45')).not.toBe(layerColor('nope'));
  });
});

describe('User Layer Names offers what its mask leaves', () => {
  /*
   * `LSET forbiddenLayers = LSET::AllCuMask() | LSET::AllTechMask();`
   * plus `Edge_Cuts` and `Margin` (`panel_fp_user_layer_names.cpp:160-164`).
   * `AllTechMask()` is the twelve F/B adhesive, paste, silkscreen, mask,
   * courtyard and fab layers, so the four auxiliary `*.User` layers and all
   * forty-five numbered ones survive.
   */
  it('is the four auxiliary user layers and all forty-five numbered ones', () => {
    expect(values(userLayerChoices())).toEqual([
      'Dwgs.User',
      'Cmts.User',
      'Eco1.User',
      'Eco2.User',
      ...NUMBERED,
    ]);
  });

  it('leaves out every layer the mask names', () => {
    const listed = new Set(values(userLayerChoices()));
    for (const forbidden of [
      ...COPPER,
      'F.Adhes',
      'B.Adhes',
      'F.Paste',
      'B.Paste',
      'F.SilkS',
      'B.SilkS',
      'F.Mask',
      'B.Mask',
      'F.CrtYd',
      'B.CrtYd',
      'F.Fab',
      'B.Fab',
      'Edge.Cuts',
      'Margin',
    ])
      expect(listed.has(forbidden), forbidden).toBe(false);
  });

  it('shows the standard names here too', () => {
    expect(labels(userLayerChoices()).slice(0, 4)).toEqual([
      'User.Drawings',
      'User.Comments',
      'User.Eco1',
      'User.Eco2',
    ]);
  });
});
