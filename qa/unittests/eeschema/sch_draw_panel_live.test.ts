// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAW_PANEL (sch_draw_panel.cpp): the layer order and render targets it gives the view.
 * The panel itself needs WebGL2, which the test DOM lacks, so its layer setup runs on a
 * prototype instance holding a real SCH_VIEW.
 */
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { SCH_DRAW_PANEL } from '@ziroeda/eeschema/sch_draw_panel.js';
import { SCH_LAYER_ORDER, SCH_VIEW } from '@ziroeda/eeschema/sch_view.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { describe, expect, it } from 'vitest';

class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

interface LAYER {
  renderingOrder: number;
  target: RENDER_TARGET;
  displayOnly: boolean;
}

/** A panel's layer setup on a view, with `aBackend` as its GAL. */
function setUp(aBackend: GAL_TYPE) {
  const view = new SCH_VIEW(null);
  view.SetGAL(new STUB_GAL(new GAL_DISPLAY_OPTIONS()));
  const panel = Object.create(SCH_DRAW_PANEL.prototype) as SCH_DRAW_PANEL;
  const p = panel as unknown as {
    m_view: SCH_VIEW;
    m_backend: GAL_TYPE;
    setDefaultLayerOrder(): void;
    setDefaultLayerDeps(): void;
  };
  p.m_view = view;
  p.m_backend = aBackend;
  p.setDefaultLayerOrder();
  p.setDefaultLayerDeps();
  const layers = (view as unknown as { m_layers: Map<number, LAYER> }).m_layers;
  return { view, layer: (id: number) => layers.get(id)! };
}

describe('SCH_DRAW_PANEL', () => {
  it('orders the layers as SCH_LAYER_ORDER: the overlays on top, the drawing sheet beneath', () => {
    const { layer } = setUp(GAL_TYPE.GAL_TYPE_OPENGL);
    SCH_LAYER_ORDER.forEach((id, i) => expect(layer(id).renderingOrder).toBe(i));
  });

  it('caches every layer on OpenGL, except the ones drawn fresh each frame', () => {
    const { layer } = setUp(GAL_TYPE.GAL_TYPE_OPENGL);
    expect(layer(SCH_LAYER_ID.LAYER_WIRE).target).toBe(RENDER_TARGET.TARGET_CACHED);
    expect(layer(SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR).target).toBe(RENDER_TARGET.TARGET_NONCACHED);
    expect(layer(GAL_LAYER_ID.LAYER_DRAW_BITMAPS).target).toBe(RENDER_TARGET.TARGET_NONCACHED);
    expect(layer(GAL_LAYER_ID.LAYER_DRAWINGSHEET).target).toBe(RENDER_TARGET.TARGET_NONCACHED);
  });

  it('caches nothing on a software backend', () => {
    const { layer } = setUp(GAL_TYPE.GAL_TYPE_CAIRO);
    expect(layer(SCH_LAYER_ID.LAYER_WIRE).target).toBe(RENDER_TARGET.TARGET_NONCACHED);
  });

  it('puts the selection shadows, the operating points and the tool overlays on the overlay', () => {
    const { layer } = setUp(GAL_TYPE.GAL_TYPE_OPENGL);
    for (const id of [
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
      SCH_LAYER_ID.LAYER_OP_VOLTAGES,
      SCH_LAYER_ID.LAYER_OP_CURRENTS,
      GAL_LAYER_ID.LAYER_GP_OVERLAY,
      GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
    ]) {
      expect(layer(id).target).toBe(RENDER_TARGET.TARGET_OVERLAY);
      expect(layer(id).displayOnly).toBe(true);
    }
  });

  it('marks the dangling and net-colour layers display-only, but not the wires', () => {
    const { layer } = setUp(GAL_TYPE.GAL_TYPE_OPENGL);
    expect(layer(SCH_LAYER_ID.LAYER_DANGLING).displayOnly).toBe(true);
    expect(layer(SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT).displayOnly).toBe(true);
    expect(layer(SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR).displayOnly).toBe(true);
    expect(layer(SCH_LAYER_ID.LAYER_WIRE).displayOnly).toBe(false);
  });
});

describe('SCH_EDIT_FRAME::OpenProjectFiles and the canvas', () => {
  const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
  const SHEETS = [
    'complex_hierarchy.kicad_sch',
    'ampli_ht.kicad_sch',
    'complex_hierarchy.kicad_pro',
  ];

  it("shows the loaded root sheet on the frame's canvas (files-io.cpp:857)", () => {
    SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
    try {
      const frame = new SCH_EDIT_FRAME({
        crossProbingSettings: () =>
          ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
        highlightNet: () => {},
        syncSelection: () => {},
        assignFootprints: () => {},
        saveProject: () => true,
      });
      const shown: unknown[] = [];
      frame.SetCanvas({ DisplaySheet: (s: unknown) => shown.push(s) } as never);
      frame.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (p) => {
        const n = SHEETS.find((s) => p === `/complex_hierarchy/${s}`);
        return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
      });
      expect(shown).toEqual([frame.GetScreen()]);
      expect(shown[0]).not.toBe(null);
    } finally {
      SetPgm(null);
    }
  });
});
