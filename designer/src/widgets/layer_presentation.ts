// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_PRESENTATION` (`include/widgets/layer_presentation.h`,
 * `common/widgets/layer_presentation.cpp`) — the one place KiCad turns a layer
 * id into the pair every layer-bearing widget needs: the name to show and the
 * colour swatch to draw beside it.
 *
 * Upstream it is an abstract base with two virtuals —
 *
 *     virtual COLOR4D  getLayerColor( int aLayer ) const = 0;
 *     virtual wxString getLayerName( int aLayer ) const = 0;
 *
 * — and one concrete `DrawColorSwatch( bmp, aBackground, aColor )` that every
 * subclass shares. The subclass is per frame, because the *background* the
 * swatch is composited over is the frame's `LAYER_PCB_BACKGROUND`; the
 * compositing itself is written once. `PCB_LAYER_BOX_SELECTOR`,
 * `GRID_CELL_LAYER_RENDERER` and `sel_layer.cpp`'s picker all go through it.
 *
 * So the shape here is the same: `layerChoice()` is the shared half and takes
 * the background as an argument, and each frame has a one-line wrapper that
 * supplies its own. It exists because the footprint editor grew this logic
 * privately in `editors/footprint/fp_layer_choices.ts`, and the moment a second
 * frame needed a layer cell — Board Setup's Zone Hatch Offsets — the choice was
 * to copy that file or to hoist it. KiCad hoisted; so do we.
 */

import { LayerName, LSET_Name } from '@ziroeda/pcbnew/src/layer_ids.js';
import { parseColor4d, swatchOverBackground, toCssColor } from '@ziroeda/common/src/color4d.js';
import { layerColor } from '../editors/pcb/pcbTheme.js';

/** One layer as a widget shows it: the stored name, the shown name, a swatch. */
export interface LayerChoice {
  /** `LSET::Name( layer )` — the canonical token a file stores. */
  value: string;
  /** `getLayerName()`, i.e. `LayerName()`: `F.SilkS` shows as `F.Silkscreen`. */
  label: string;
  /** `DrawColorSwatch( bmp, background, getLayerColor( layer ) )`, as CSS. */
  swatch: string;
}

/**
 * `DrawColorSwatch( aLayerbmp, aBackground, aColor )` — the layer colour
 * composited over the frame's background, because a layer colour carries alpha
 * and a swatch drawn without the background under it reads as the wrong colour.
 */
export function layerSwatch(aLayerName: string, aBackground: string): string {
  return toCssColor(
    swatchOverBackground(parseColor4d(layerColor(aLayerName)), parseColor4d(aBackground)),
  );
}

/** One `LayerChoice` for a `PCB_LAYER_ID`, over the given frame background. */
export function layerChoice(aLayerId: number, aBackground: string): LayerChoice {
  const name = LSET_Name(aLayerId);
  return { value: name, label: LayerName(name), swatch: layerSwatch(name, aBackground) };
}

/** `layerChoice` over a whole `LSEQ`, keeping its order. */
export function layerChoices(aLayerIds: Iterable<number>, aBackground: string): LayerChoice[] {
  return [...aLayerIds].map((id) => layerChoice(id, aBackground));
}
