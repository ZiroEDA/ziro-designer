// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_PAIR_SETTINGS` (`pcbnew/layer_pairs.cpp`). Cases derived directly
 * from the C++: dedup by `HasSameLayers` (layer order doesn't matter),
 * `GetEnabledLayerPairs`'s "Manual" pair injected first when the current pair
 * isn't an enabled preset, and the two change events.
 */
import { describe, expect, it } from 'vitest';
import { LAYER_PAIR, LAYER_PAIR_INFO } from '@ziroeda/common/project/board_project_settings.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  LAYER_PAIR_SETTINGS,
  PCB_CURRENT_LAYER_PAIR_CHANGED,
  PCB_LAYER_PAIR_PRESETS_CHANGED,
} from '@ziroeda/pcbnew/layer_pairs.js';
import type { wxEvent } from '@ziroeda/common/wx/wx_event.js';

const { F_Cu, B_Cu, In1_Cu, In2_Cu } = PCB_LAYER_ID;

describe('LAYER_PAIR_SETTINGS', () => {
  it('defaults to F.Cu/B.Cu as the current pair', () => {
    const s = new LAYER_PAIR_SETTINGS();
    expect(s.GetCurrentLayerPair().HasSameLayers(new LAYER_PAIR(F_Cu, B_Cu))).toBe(true);
  });

  it('AddLayerPair rejects a duplicate regardless of layer order', () => {
    const s = new LAYER_PAIR_SETTINGS();
    expect(s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(F_Cu, In1_Cu), true, 'A'))).toBe(true);
    // Same two layers, reversed order - still a duplicate.
    expect(s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(In1_Cu, F_Cu), true, 'B'))).toBe(
      false,
    );
    expect(s.GetLayerPairs()).toHaveLength(1);
  });

  it('RemoveLayerPair matches either layer order and reports whether it removed anything', () => {
    const s = new LAYER_PAIR_SETTINGS();
    s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(F_Cu, In1_Cu), true, 'A'));

    expect(s.RemoveLayerPair(new LAYER_PAIR(In1_Cu, F_Cu))).toBe(true);
    expect(s.GetLayerPairs()).toHaveLength(0);
    expect(s.RemoveLayerPair(new LAYER_PAIR(In1_Cu, F_Cu))).toBe(false);
  });

  it('GetEnabledLayerPairs skips disabled presets and reports the current index', () => {
    const s = new LAYER_PAIR_SETTINGS();
    s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(F_Cu, B_Cu), true, 'Outer'));
    s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(In1_Cu, In2_Cu), false, 'Inner (off)'));

    s.SetCurrentLayerPair(new LAYER_PAIR(F_Cu, B_Cu));

    const { pairs, current } = s.GetEnabledLayerPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.GetName()).toBe('Outer');
    expect(current).toBe(0);
  });

  it('GetEnabledLayerPairs injects a "Manual" pair first when the current pair matches no enabled preset', () => {
    const s = new LAYER_PAIR_SETTINGS();
    s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(F_Cu, B_Cu), true, 'Outer'));

    s.SetCurrentLayerPair(new LAYER_PAIR(In1_Cu, In2_Cu));

    const { pairs, current } = s.GetEnabledLayerPairs();
    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.GetName()).toBe('Manual');
    expect(pairs[0]!.GetLayerPair().HasSameLayers(new LAYER_PAIR(In1_Cu, In2_Cu))).toBe(true);
    expect(current).toBe(0);
  });

  it('SetCurrentLayerPair does not create a manual pair when it matches an enabled preset', () => {
    const s = new LAYER_PAIR_SETTINGS();
    s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(F_Cu, B_Cu), true, 'Outer'));

    s.SetCurrentLayerPair(new LAYER_PAIR(B_Cu, F_Cu)); // reversed order, still the same pair

    const { pairs, current } = s.GetEnabledLayerPairs();
    expect(pairs).toHaveLength(1); // no "Manual" entry injected
    expect(current).toBe(0);
  });

  it('SetLayerPairs replaces the store and skips dupes the same way AddLayerPair does', () => {
    const s = new LAYER_PAIR_SETTINGS();
    s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(F_Cu, B_Cu), true, 'Old'));

    s.SetLayerPairs([
      new LAYER_PAIR_INFO(new LAYER_PAIR(In1_Cu, In2_Cu), true, 'New'),
      new LAYER_PAIR_INFO(new LAYER_PAIR(In2_Cu, In1_Cu), true, 'Dupe'),
    ]);

    const pairs = s.GetLayerPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.GetName()).toBe('New');
  });

  it('fires PCB_LAYER_PAIR_PRESETS_CHANGED on add/remove/set and PCB_CURRENT_LAYER_PAIR_CHANGED on SetCurrentLayerPair', () => {
    const s = new LAYER_PAIR_SETTINGS();
    let presetsChanged = 0;
    let currentChanged = 0;

    s.Connect<wxEvent>(PCB_LAYER_PAIR_PRESETS_CHANGED, () => {
      presetsChanged++;
    });
    s.Connect<wxEvent>(PCB_CURRENT_LAYER_PAIR_CHANGED, () => {
      currentChanged++;
    });

    s.AddLayerPair(new LAYER_PAIR_INFO(new LAYER_PAIR(F_Cu, B_Cu), true, 'Outer'));
    s.RemoveLayerPair(new LAYER_PAIR(F_Cu, B_Cu));
    s.SetLayerPairs([]);
    expect(presetsChanged).toBe(3);
    expect(currentChanged).toBe(0);

    s.SetCurrentLayerPair(new LAYER_PAIR(In1_Cu, In2_Cu));
    expect(currentChanged).toBe(1);
  });
});
