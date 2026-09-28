// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `VIEW::DataReference` (`common/view/view.cpp:1646-1654`): a second view on
 * the same items, whose layer flags are its own. `m_layers` is a
 * `std::map<int, VIEW_LAYER>`, copied by value; only each layer's `items`
 * RTree (a `shared_ptr`) and `m_allItems` are shared. A printout relies on
 * that: it hides every layer but the one it prints on its copy.
 */
import { describe, expect, it } from 'vitest';
import { VIEW } from '@ziroeda/common/view/view.js';

describe('VIEW::DataReference', () => {
  it('copies the layer flags, so the copy can hide a layer the original shows', () => {
    const view = new VIEW();
    view.SetLayerVisible(3, true);

    const copy = view.DataReference();
    copy.SetLayerVisible(3, false);

    expect(copy.IsLayerVisible(3)).toBe(false);
    expect(view.IsLayerVisible(3)).toBe(true);
  });

  it('shares the items: the same RTree behind each layer', () => {
    const view = new VIEW();
    const copy = view.DataReference();
    const layersOf = (v: VIEW) =>
      (v as unknown as { m_layers: Map<number, { items: unknown }> }).m_layers;

    expect(layersOf(copy).get(3)!.items).toBe(layersOf(view).get(3)!.items);
    expect(layersOf(copy).get(3)).not.toBe(layersOf(view).get(3));
  });
});
