// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_PREVIEW_PANEL's layer setup (sch_preview_panel.cpp): unlike the editor's SCH_DRAW_PANEL
 * every layer is uncached - an alias's fields cannot substitute their parent's values, so they
 * may not draw from a cache - and the two overlays are display-only overlay layers. The panel's
 * constructor needs WebGL2, so the methods run on an object built from its prototype.
 */
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { SCH_PREVIEW_PANEL } from '@ziroeda/eeschema/sch_preview_panel.js';
import { SCH_LAYER_ORDER } from '@ziroeda/eeschema/sch_view.js';
import { describe, expect, it } from 'vitest';

function panel() {
  const p = Object.create(SCH_PREVIEW_PANEL.prototype) as {
    setDefaultLayerDeps(): void;
    setDefaultLayerOrder(): void;
  };
  const view = new VIEW();
  Object.assign(p, { m_view: view });
  // KiCad's VIEW has no target getter; the test reads the layer record.
  const target = (aLayer: number) =>
    (view as unknown as { m_layers: Map<number, { target: RENDER_TARGET }> }).m_layers.get(aLayer)!
      .target;
  return { p, view, target };
}

describe('SCH_PREVIEW_PANEL', () => {
  it('draws every layer uncached, the overlays as display-only overlays', () => {
    const { p, view, target } = panel();

    p.setDefaultLayerDeps();

    expect(view.IsCached(SCH_LAYER_ID.LAYER_DEVICE)).toBe(false);
    expect(view.IsCached(SCH_LAYER_ID.LAYER_WIRE)).toBe(false);
    expect(target(GAL_LAYER_ID.LAYER_GP_OVERLAY)).toBe(RENDER_TARGET.TARGET_OVERLAY);
    expect(target(GAL_LAYER_ID.LAYER_SELECT_OVERLAY)).toBe(RENDER_TARGET.TARGET_OVERLAY);
    expect(target(GAL_LAYER_ID.LAYER_DRAWINGSHEET)).toBe(RENDER_TARGET.TARGET_NONCACHED);
  });

  it('orders the layers by SCH_LAYER_ORDER', () => {
    const { p, view } = panel();

    p.setDefaultLayerOrder();

    for (let i = 0; i < SCH_LAYER_ORDER.length; ++i)
      expect(view.GetLayerOrder(SCH_LAYER_ORDER[i]!)).toBe(i);
  });
});
