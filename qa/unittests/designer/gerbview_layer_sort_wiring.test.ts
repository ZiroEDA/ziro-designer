// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where GerbView applies a layer sort.
 *
 * `unittests/gerbview/layer_sort.test.ts` pins the two comparators, and
 * `unittests/gerbview/gerbview_frame.test.ts` the places GERBVIEW_FRAME runs
 * one. This pins the menu entries that run one by hand, because a correct
 * comparator that nothing calls leaves the layers exactly as unsorted as
 * having no comparator at all — which is what ours was: both context-menu
 * entries were rendered greyed out and no load path sorted anything.
 */
import { describe, expect, it } from 'vitest';
import { layerContextMenu } from '@ziroeda/gerbview/widgets/gerbview_layer_widget.js';

const noop = (): void => {};
const MENU = layerContextMenu({
  showAll: noop,
  hideAllButActive: noop,
  hideAll: noop,
  sortByX2: noop,
  sortByFileExtension: noop,
  moveUp: noop,
  moveDown: noop,
  clearLayer: noop,
});
const item = (label: string): { disabled?: boolean; action?: () => void } | undefined =>
  MENU.find((m) => 'label' in m && m.label === label) as
    | { disabled?: boolean; action?: () => void }
    | undefined;

describe('the layers manager right-click menu', () => {
  it('found the menu, so this cannot pass by scanning nothing', () => {
    expect(MENU.length).toBeGreaterThan(8);
  });

  for (const label of ['Sort Layers if X2 Mode', 'Sort Layers by File Extension']) {
    it(`"${label}" runs, rather than sitting greyed out`, () => {
      // ID_SORT_GBR_LAYERS_X2 / ID_SORT_GBR_LAYERS_FILE_EXT are two ordinary
      // enabled entries upstream (`gerbview_layer_widget.cpp:176-181,253-259`).
      const entry = item(label);
      expect(entry, `${label} is missing from the menu`).toBeDefined();
      expect(entry?.disabled ?? false, `${label} is still greyed`).toBe(false);
      expect(typeof entry?.action).toBe('function');
    });
  }

  it('and the one entry that IS greyed still is, so this is not "nothing is disabled"', () => {
    // ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE drives a mode we do not hold.
    expect(item('Always Hide All Layers But Active')?.disabled).toBe(true);
  });
});
