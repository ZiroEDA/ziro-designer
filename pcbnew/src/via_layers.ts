// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_VIA::IsOnLayer( aLayer )` for a copper layer: `LAYER_RANGE::Contains(
 * Drill().start, Drill().end, aLayer )` — the layer lies in the via's span
 * by Z order, F.Cu on top, B.Cu at the bottom (`layer_range.h:139`). A
 * through via spans everything; a blind or buried one only what it was
 * drilled between.
 */

import { copperRank, isCopperLayerName } from './swap_layers.js';
import type { PcbVia } from './types.js';

export function viaIsOnLayer(via: PcbVia, layer: string): boolean {
  if (!isCopperLayerName(layer)) return false;
  if (via.kind === 'through') return true;
  const [start, end] = via.layers;
  const lo = Math.min(copperRank(start), copperRank(end));
  const hi = Math.max(copperRank(start), copperRank(end));
  const r = copperRank(layer);
  return r >= lo && r <= hi;
}

/** The copper layers a via is on, out of the board's, in stack order. */
export function viaCopperLayers(via: PcbVia, copperLayers: readonly string[]): string[] {
  return copperLayers.filter((l) => viaIsOnLayer(via, l));
}
