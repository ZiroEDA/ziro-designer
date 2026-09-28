// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_LAYER_PRESENTATION` (`pcbnew/pcb_layer_presentation.h`, its bodies in
 * `pcbnew/sel_layer.cpp:58-85`): the board frames' `LAYER_PRESENTATION`. The
 * base, and the swatch compositing every subclass shares, is
 * `common/widgets/layer_presentation.ts`.
 *
 * Upstream `getLayerColor` asks the frame's `COLOR_SETTINGS`, and
 * `LAYER_PCB_BACKGROUND` is one of its colours. Here the frame hands its
 * background in, because the board and footprint frames hold theirs in
 * different places; every other layer's colour comes from `pcbTheme`.
 *
 * `getLayerName` is `LayerName()`, the default name: `F.SilkS` shows as
 * `F.Silkscreen`. A board's user-renamed layers are not read here.
 *
 * `layerChoice()` is what the layer cells and choosers consume: the stored
 * name, the shown name, and `DrawColorSwatch( aLayer )` as CSS.
 */

import { LayerName, LSET_Name } from '@ziroeda/common/layer_ids.js';
import { type Color4d, parseColor4d, toCssColor } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LAYER_PRESENTATION } from '@ziroeda/common/widgets/layer_presentation.js';
import { layerColor } from '@ziroeda/pcbnew/pcbTheme.js';

/**
 * Class that manages the presentation of PCB layers in a PCB frame.
 */
export class PCB_LAYER_PRESENTATION extends LAYER_PRESENTATION {
  private readonly m_background: Color4d;

  /** `aBackground` is the frame's `LAYER_PCB_BACKGROUND`, as CSS. */
  constructor(aBackground: string) {
    super();
    this.m_background = parseColor4d(aBackground);
  }

  getLayerColor(aLayer: number): Color4d {
    if (aLayer === GAL_LAYER_ID.LAYER_PCB_BACKGROUND) return this.m_background;

    return parseColor4d(layerColor(LSET_Name(aLayer)));
  }

  getLayerName(aLayer: number): string {
    return LayerName(LSET_Name(aLayer));
  }
}

/** One layer as a widget shows it: the stored name, the shown name, a swatch. */
export interface LayerChoice {
  /** `LSET::Name( layer )` — the canonical token a file stores. */
  value: string;
  /** `getLayerName()`, i.e. `LayerName()`: `F.SilkS` shows as `F.Silkscreen`. */
  label: string;
  /** `DrawColorSwatch( aLayer )`, as CSS. */
  swatch: string;
}

/** One `LayerChoice` for a `PCB_LAYER_ID`, over the given frame background. */
export function layerChoice(aLayerId: number, aBackground: string): LayerChoice {
  const presentation = new PCB_LAYER_PRESENTATION(aBackground);
  return {
    value: LSET_Name(aLayerId),
    label: presentation.getLayerName(aLayerId),
    swatch: toCssColor(presentation.DrawColorSwatch(aLayerId)),
  };
}

/** `layerChoice` over a whole `LSEQ`, keeping its order. */
export function layerChoices(aLayerIds: Iterable<number>, aBackground: string): LayerChoice[] {
  return [...aLayerIds].map((id) => layerChoice(id, aBackground));
}
