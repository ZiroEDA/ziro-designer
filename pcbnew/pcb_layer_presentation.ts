// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_LAYER_PRESENTATION` (`pcbnew/pcb_layer_presentation.h`, its bodies in
 * `pcbnew/sel_layer.cpp:58-85`): the board frames' `LAYER_PRESENTATION`. The
 * base, and the swatch compositing every subclass shares, is
 * `common/widgets/layer_presentation.ts`.
 *
 * With a frame, `getLayerColor` asks its `COLOR_SETTINGS` and `getLayerName`
 * its board, so a user-renamed layer shows by its name. Without one -
 * upstream's `m_boardFrame == nullptr` branch, which the dialog grids that
 * have no frame here take - the caller hands the background in and every
 * other colour comes from `pcbTheme`; the name is the default
 * (`BOARD::GetStandardLayerName`): `F.SilkS` shows as `F.Silkscreen`.
 *
 * `layerChoice()` is what the layer cells and choosers consume: the stored
 * name, the shown name, and `DrawColorSwatch( aLayer )` as CSS.
 */

import { LayerName, LSET_Name } from '@ziroeda/common/layer_ids.js';
import { type Color4d, parseColor4d, toCssColor } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { LAYER_PAIR } from '@ziroeda/common/project/board_project_settings.js';
import type { PCB_BASE_FRAME } from './pcb_base_frame.js';
import { LAYER_PRESENTATION } from '@ziroeda/common/widgets/layer_presentation.js';
import { layerColor } from './pcbTheme.js';

/**
 * Class that manages the presentation of PCB layers in a PCB frame.
 */
export class PCB_LAYER_PRESENTATION extends LAYER_PRESENTATION {
  private m_boardFrame: PCB_BASE_FRAME | null;
  private readonly m_background: Color4d;

  /**
   * `PCB_LAYER_PRESENTATION( aFrame )`. `aBackground` is the
   * `LAYER_PCB_BACKGROUND` a frameless caller paints over, as CSS.
   */
  constructor(aFrame: PCB_BASE_FRAME | null, aBackground = '#000000') {
    super();
    this.m_boardFrame = aFrame;
    this.m_background = parseColor4d(aBackground);
  }

  getLayerColor(aLayer: number): Color4d {
    if (this.m_boardFrame) return this.m_boardFrame.GetColorSettings().GetColor(aLayer);

    if (aLayer === GAL_LAYER_ID.LAYER_PCB_BACKGROUND) return this.m_background;

    return parseColor4d(layerColor(LSET_Name(aLayer)));
  }

  getLayerName(aLayer: number): string {
    if (this.m_boardFrame) return this.m_boardFrame.GetBoard()!.GetLayerName(aLayer);

    return LayerName(LSET_Name(aLayer));
  }

  getOrderedEnabledLayers(): PCB_LAYER_ID[] {
    return this.m_boardFrame!.GetBoard()!.GetEnabledLayers().UIOrder();
  }

  /**
   * Annoying post-ctor initialization (for when PCB_LAYER_BOX_SELECTOR doesn't
   * have access to the PCB_BASE_FRAME at construction time).
   */
  SetBoardFrame(aFrame: PCB_BASE_FRAME | null): void {
    this.m_boardFrame = aFrame;
  }

  /** `getLayerPairName( aPair )` (sel_layer.cpp:90-96). */
  getLayerPairName(aPair: LAYER_PAIR): string {
    const layerAName = this.getLayerName(aPair.GetLayerA());
    const layerBName = this.getLayerName(aPair.GetLayerB());

    return `${layerAName} / ${layerBName}`;
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
  const presentation = new PCB_LAYER_PRESENTATION(null, aBackground);
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
