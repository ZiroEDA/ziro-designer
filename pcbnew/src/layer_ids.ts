// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board layer identifiers, the pcbnew layer model (pcbnew/layer_ids.h / lset).
 * KiCad's PCB_LAYER_ID is an enum of int ids; this port keeps the canonical
 * string layer names (`F.Cu`, `B.SilkS`, …) that appear in the file as the id,
 * which is what our board model already uses.
 */

export type PCB_LAYER_ID = string;

/**
 * The layer on the opposite board side, KiCad BOARD::FlipLayer (board.cpp:958),
 * whose front/back opposites all swap the `F.`/`B.` prefix for a standard stack
 * (common/lset.cpp). Inner and single-sided user layers are their own opposite.
 */
export function FlipLayer(aLayer: PCB_LAYER_ID): PCB_LAYER_ID {
  if (aLayer.startsWith('F.')) return `B.${aLayer.slice(2)}`;
  if (aLayer.startsWith('B.')) return `F.${aLayer.slice(2)}`;
  return aLayer;
}

/**
 * The "English Standard" display name of a board layer, KiCad `LayerName()`
 * (`common/layer_id.cpp:24`). It is NOT the canonical token the file stores:
 * ten layers spell out in the UI what the file abbreviates — `F.SilkS` shows
 * as `F.Silkscreen`, `Dwgs.User` as `User.Drawings` — while inner copper
 * (`In%d.Cu`) and user layers (`User.%d`) render exactly as their token does.
 *
 * [data] Transcribed from that switch, not invented. Only the entries that
 * differ from the token are listed; anything absent is its own name.
 */
const STANDARD_LAYER_NAMES: Readonly<Record<string, string>> = {
  'B.Adhes': 'B.Adhesive',
  'F.Adhes': 'F.Adhesive',
  'B.SilkS': 'B.Silkscreen',
  'F.SilkS': 'F.Silkscreen',
  'Dwgs.User': 'User.Drawings',
  'Cmts.User': 'User.Comments',
  'Eco1.User': 'User.Eco1',
  'Eco2.User': 'User.Eco2',
  'F.CrtYd': 'F.Courtyard',
  'B.CrtYd': 'B.Courtyard',
};

/**
 * KiCad `LayerName()` / `BOARD::GetStandardLayerName()` (`pcbnew/board.h:909`,
 * which is just a call through to the former).
 */
export function LayerName(aLayer: PCB_LAYER_ID): string {
  return STANDARD_LAYER_NAMES[aLayer] ?? aLayer;
}

/** The layer half of what `GetLayerName` needs: a `PcbLayerDef`, loosely. */
export interface NamedLayer {
  name: string;
  userName?: string;
}

/**
 * The name a BOARD shows for one of its layers, KiCad `BOARD::GetLayerName()`
 * (`pcbnew/board.cpp:737`).
 *
 * "Standard names were set in BOARD::BOARD() but they may be over-ridden by
 * BOARD::SetLayerName(). For copper layers, return the user defined layer
 * name, if it was set. Otherwise return the Standard English layer name."
 *
 * The user name is the fourth token of a `(layers …)` entry, and a stock KiCad
 * board carries one on most layers — the demo boards ship `(0 "F.Cu" signal
 * "top_cu")`, which is why real pcbnew's layer list and layer selector open on
 * `top_cu` rather than `F.Cu`. Every place that puts a layer in front of the
 * user goes through here.
 */
export function GetLayerName(aLayers: readonly NamedLayer[], aLayer: PCB_LAYER_ID): string {
  const def = aLayers.find((l) => l.name === aLayer);
  if (def && def.userName !== undefined && def.userName !== '') return def.userName;
  return LayerName(aLayer);
}
