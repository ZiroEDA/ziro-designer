// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_DESIGN_SETTINGS::GetLineThickness( layer )` and its text siblings, for
 * the Footprint Editor — the lookup that turns a layer into the layer CLASS
 * whose defaults a new item takes.
 *
 * Upstream this is three one-line methods on `BOARD_DESIGN_SETTINGS`
 * (`include/board_design_settings.h`), each `m_LineThickness[ GetLayerClass(
 * aLayer ) ]` over the `LAYER_CLASS_*` enum, and `GetLayerClass` is the switch
 * that maps a `PCB_LAYER_ID` onto one of six buckets. The Graphics Defaults
 * page edits those six rows; every drawing tool reads them back.
 *
 * It lives beside the editor rather than in `prefs/` because it is a BOARD
 * question, not a settings-file one: the same six classes exist on a real
 * board's design settings, and only the object they are read out of differs.
 */
import type { FpEditSettings, FpGraphicsTextClass } from '../../prefs/settings.js';
import { settings } from '../../prefs/settings.js';

/** The six `LAYER_CLASS_*` buckets, as the keys `design_settings` stores. */
export type FpGraphicsRowKey = 'silk' | 'copper' | 'edges' | 'courtyard' | 'fab' | 'others';

/**
 * The Graphics Defaults grid's rows, in `ROW_*` order
 * (`panel_fp_editor_graphics_defaults.cpp:47-56`) with the base file's labels
 * (`_base.cpp:52-57`).
 *
 * `text: false` is Edge Cuts and Courtyards, whose four text columns the panel
 * disables because no `*_text_*` param exists for them.
 */
export const GRAPHICS_ROWS: readonly { key: FpGraphicsRowKey; label: string; text: boolean }[] = [
  { key: 'silk', label: 'Silk Layers', text: true },
  { key: 'copper', label: 'Copper Layers', text: true },
  { key: 'edges', label: 'Edge Cuts', text: false },
  { key: 'courtyard', label: 'Courtyards', text: false },
  { key: 'fab', label: 'Fab Layers', text: true },
  { key: 'others', label: 'Other Layers', text: true },
];

/**
 * `BOARD_DESIGN_SETTINGS::GetLayerClass( PCB_LAYER_ID )` — which of the six
 * rows a layer belongs to.
 *
 * The switch is: silk for `F_SilkS`/`B_SilkS`, copper for any copper layer,
 * edges for `Edge_Cuts`, courtyard for `F_CrtYd`/`B_CrtYd`, fab for
 * `F_Fab`/`B_Fab`, and others for everything else — which is what makes "Other
 * Layers" the row that catches the user and auxiliary layers.
 */
export function fpLayerClass(layer: string): FpGraphicsRowKey {
  if (layer === 'F.SilkS' || layer === 'B.SilkS') return 'silk';
  if (/\.Cu$/.test(layer)) return 'copper';
  if (layer === 'Edge.Cuts') return 'edges';
  if (layer === 'F.CrtYd' || layer === 'B.CrtYd') return 'courtyard';
  if (layer === 'F.Fab' || layer === 'B.Fab') return 'fab';
  return 'others';
}

/** `GetLineThickness( aLayer )`, in **millimetres** — the unit the file holds. */
export function fpLineThicknessMM(layer: string, cfg: FpEditSettings = settings.fpEdit): number {
  return cfg.design_settings[fpLayerClass(layer)].line_width;
}

/**
 * `GetTextSize( aLayer )` and `GetTextThickness( aLayer )` and
 * `GetTextItalic( aLayer )`, in millimetres, for the four classes that have
 * text.
 *
 * Edge Cuts and Courtyards have none, and upstream's array simply holds
 * whatever the constructor left there for those two indices; a caller asking
 * for a text default on one of them is asking a question the settings file
 * cannot answer, so this returns null rather than a number nobody wrote.
 */
export function fpTextDefaults(
  layer: string,
  cfg: FpEditSettings = settings.fpEdit,
): FpGraphicsTextClass | null {
  const row = cfg.design_settings[fpLayerClass(layer)];
  return 'text_size_h' in row ? row : null;
}
