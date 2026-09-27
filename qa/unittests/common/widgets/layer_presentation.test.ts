// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_PRESENTATION` and `LAYER_BOX_SELECTOR` (common/widgets/): the bases
 * the board and GerbView layer widgets derive from.
 */
import { describe, expect, it } from 'vitest';
import { type Color4d, COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/layer_id.js';
import { LAYER_PRESENTATION } from '@ziroeda/common/widgets/layer_presentation.js';
import { LAYER_BOX_SELECTOR } from '@ziroeda/common/widgets/layer_box_selector.js';

const BG: Color4d = { r: 0, g: 0, b: 0.2, a: 1 };
const RED_HALF: Color4d = { r: 1, g: 0, b: 0, a: 0.5 };

class TEST_PRESENTATION extends LAYER_PRESENTATION {
  getLayerColor(aLayer: number): Color4d {
    return aLayer === GAL_LAYER_ID.LAYER_PCB_BACKGROUND ? BG : RED_HALF;
  }
  getLayerName(aLayer: number): string {
    return `L${aLayer}`;
  }
}

describe('LAYER_PRESENTATION::DrawColorSwatch', () => {
  it('draws the colour over the opaque background (layer_presentation.cpp:36-62)', () => {
    // Background fill first, then the colour source-over: 0.5 red over 0.2 blue.
    expect(LAYER_PRESENTATION.DrawColorSwatch(BG, RED_HALF)).toEqual({
      r: 0.5,
      g: 0,
      b: 0.1,
      a: 1,
    });
  });

  it('skips the background fill when it is UNSPECIFIED', () => {
    expect(LAYER_PRESENTATION.DrawColorSwatch(COLOR4D_UNSPECIFIED, RED_HALF)).toEqual(RED_HALF);
  });

  it('the layer overload asks the subclass for LAYER_PCB_BACKGROUND (:65-71)', () => {
    expect(new TEST_PRESENTATION().DrawColorSwatch(3)).toEqual({ r: 0.5, g: 0, b: 0.1, a: 1 });
  });
});

class TEST_BOX extends LAYER_BOX_SELECTOR {
  protected isLayerEnabled(aLayer: number): boolean {
    return aLayer !== 2;
  }
  Resync(): void {
    this.Clear();
    for (const layerid of [0, 1, 2, 5]) if (this.isLayerEnabled(layerid)) this.Append({ layerid });
  }
  hotkeys(): boolean {
    return this.m_layerhotkeys;
  }
}

describe('LAYER_BOX_SELECTOR', () => {
  it('selects by client data and reports UNDEFINED_LAYER with no selection', () => {
    const box = new TEST_BOX();
    box.Resync();
    expect(box.GetCount()).toBe(3);
    expect(box.GetLayerSelection()).toBe(UNDEFINED_LAYER);
    expect(box.SetLayerSelection(5)).toBe(2);
    expect(box.GetLayerSelection()).toBe(5);
    // Already selected: the same index, nothing changes.
    expect(box.SetLayerSelection(5)).toBe(2);
  });

  it('a layer not in the list clears the selection and returns -1', () => {
    const box = new TEST_BOX();
    box.Resync();
    box.SetLayerSelection(1);
    expect(box.SetLayerSelection(2)).toBe(-1);
    expect(box.GetSelection()).toBe(-1);
    expect(box.GetLayerSelection()).toBe(UNDEFINED_LAYER);
  });

  it('LAYER_SELECTOR defaults m_layerhotkeys to true', () => {
    const box = new TEST_BOX();
    expect(box.hotkeys()).toBe(true);
    expect(box.SetLayersHotkeys(false)).toBe(false);
    expect(box.hotkeys()).toBe(false);
  });
});
