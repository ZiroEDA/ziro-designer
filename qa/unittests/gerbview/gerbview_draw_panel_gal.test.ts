// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBVIEW_DRAW_PANEL_GAL`'s view set-up, run on a real VIEW. The panel's
 * constructor needs WebGL2, which Node has not, so its methods are called on
 * an object holding what they read (`m_view`, `m_backend`) - the same members
 * the constructor would have made.
 *
 * Every expectation is re-derived from `gerbview_draw_panel_gal.cpp`, not
 * from our port:
 *
 *   SetTopLayer (:181-199)       dcode(i) at GERBER_DRAW_LAYER( 2i ), draw(i)
 *                                at 2i+1; then the active layer, its dcode
 *                                layer and the two overlays go on top.
 *   setDefaultLayerDeps (:153-172) every layer TARGET_CACHED on OpenGL, both
 *                                overlays TARGET_OVERLAY, six layers
 *                                display-only.
 */
import { describe, expect, it } from 'vitest';
import { GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import {
  GAL_LAYER_ID,
  GERBER_DCODE_LAYER,
  GERBER_DRAW_LAYER,
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { GERBVIEW_DRAW_PANEL_GAL } from '@ziroeda/gerbview/gerbview_draw_panel_gal.js';

class STUB_GAL extends GAL {}

interface LAYER_PEEK {
  renderingOrder: number;
  target: RENDER_TARGET;
  displayOnly: boolean;
}

function layersOf(aView: VIEW): Map<number, LAYER_PEEK> {
  return (aView as unknown as { m_layers: Map<number, LAYER_PEEK> }).m_layers;
}

/** The members the panel's methods read, as the constructor leaves them. */
function panelOn(aBackend: GAL_TYPE): { m_view: VIEW; m_backend: GAL_TYPE } {
  const view = new VIEW();
  view.SetGAL(new STUB_GAL(new GAL_DISPLAY_OPTIONS()));
  return { m_view: view, m_backend: aBackend };
}

const proto = GERBVIEW_DRAW_PANEL_GAL.prototype as unknown as {
  SetTopLayer(this: unknown, aLayer: number): void;
  setDefaultLayerDeps(this: unknown): void;
};

describe('GERBVIEW_DRAW_PANEL_GAL::SetTopLayer', () => {
  it('interleaves each dcode layer just below its draw layer', () => {
    const panel = panelOn(GAL_TYPE.GAL_TYPE_OPENGL);
    proto.SetTopLayer.call(panel, GERBER_DRAW_LAYER(5));
    const view = panel.m_view;

    // Away from the active layer, the order is exactly the C++ pair of calls.
    for (const i of [0, 1, 4, 6, GERBER_DRAWLAYERS_COUNT - 1]) {
      expect(view.GetLayerOrder(GERBER_DCODE_LAYER(GERBER_DRAW_LAYER(i)))).toBe(
        GERBER_DRAW_LAYER(2 * i),
      );
      expect(view.GetLayerOrder(GERBER_DRAW_LAYER(i))).toBe(GERBER_DRAW_LAYER(2 * i + 1));
    }
  });

  it('lifts the active layer and its dcode layer, and nothing else of the gerber layers', () => {
    const panel = panelOn(GAL_TYPE.GAL_TYPE_OPENGL);
    const view = panel.m_view;
    const active = GERBER_DRAW_LAYER(5);

    proto.SetTopLayer.call(panel, active);

    expect(view.GetLayerOrder(active)).toBe(GERBER_DRAW_LAYER(11) + VIEW.TOP_LAYER_MODIFIER);
    expect(view.GetLayerOrder(GERBER_DCODE_LAYER(active))).toBe(
      GERBER_DRAW_LAYER(10) + VIEW.TOP_LAYER_MODIFIER,
    );

    // ClearTopLayers first: switching the active layer drops the old one back.
    proto.SetTopLayer.call(panel, GERBER_DRAW_LAYER(2));

    expect(view.GetLayerOrder(active)).toBe(GERBER_DRAW_LAYER(11));
    // SetLayerOrder overwrites the order either way; the top-layer SET is
    // what ClearTopLayers empties, and its first member is the new layer.
    expect(view.GetTopLayer()).toBe(GERBER_DRAW_LAYER(2));
    expect(view.GetLayerOrder(GERBER_DRAW_LAYER(2))).toBe(
      GERBER_DRAW_LAYER(5) + VIEW.TOP_LAYER_MODIFIER,
    );
  });

  it('puts both overlays on top', () => {
    const panel = panelOn(GAL_TYPE.GAL_TYPE_OPENGL);
    const view = panel.m_view;
    const before = [GAL_LAYER_ID.LAYER_SELECT_OVERLAY, GAL_LAYER_ID.LAYER_GP_OVERLAY].map((l) =>
      view.GetLayerOrder(l),
    );

    proto.SetTopLayer.call(panel, GERBER_DRAW_LAYER(0));

    expect(view.GetLayerOrder(GAL_LAYER_ID.LAYER_SELECT_OVERLAY)).toBe(
      before[0]! + VIEW.TOP_LAYER_MODIFIER,
    );
    expect(view.GetLayerOrder(GAL_LAYER_ID.LAYER_GP_OVERLAY)).toBe(
      before[1]! + VIEW.TOP_LAYER_MODIFIER,
    );
  });
});

describe('GERBVIEW_DRAW_PANEL_GAL::setDefaultLayerDeps', () => {
  const DISPLAY_ONLY = [
    GERBVIEW_LAYER_ID.LAYER_DCODES,
    GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS,
    GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID,
    GERBVIEW_LAYER_ID.LAYER_GERBVIEW_AXES,
    GERBVIEW_LAYER_ID.LAYER_GERBVIEW_BACKGROUND,
    GAL_LAYER_ID.LAYER_DRAWINGSHEET,
    GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
    GAL_LAYER_ID.LAYER_GP_OVERLAY,
  ];
  const OVERLAYS = [GAL_LAYER_ID.LAYER_SELECT_OVERLAY, GAL_LAYER_ID.LAYER_GP_OVERLAY];

  it('caches every layer on OpenGL, overlays excepted, and marks the display-only ones', () => {
    const panel = panelOn(GAL_TYPE.GAL_TYPE_OPENGL);
    proto.setDefaultLayerDeps.call(panel);

    for (const [id, layer] of layersOf(panel.m_view)) {
      const expected = OVERLAYS.includes(id)
        ? RENDER_TARGET.TARGET_OVERLAY
        : RENDER_TARGET.TARGET_CACHED;
      expect(layer.target, `layer ${id}`).toBe(expected);
      expect(layer.displayOnly, `layer ${id}`).toBe(DISPLAY_ONLY.includes(id));
    }
  });

  it('does not cache on a software backend', () => {
    const panel = panelOn(GAL_TYPE.GAL_TYPE_CAIRO);
    proto.setDefaultLayerDeps.call(panel);

    expect(layersOf(panel.m_view).get(GERBER_DRAW_LAYER(0))?.target).toBe(
      RENDER_TARGET.TARGET_NONCACHED,
    );
  });
});
