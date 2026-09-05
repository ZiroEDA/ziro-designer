// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRID_CELL_LAYER_SELECTOR`'s option list, for the three Preferences pages of
 * this editor that put a layer in a grid cell.
 *
 * Upstream the cell editor is one class (`common/grid_layer_box_helpers.cpp`),
 * built with a `LSET` of layers to LEAVE OUT:
 *
 *     new GRID_CELL_LAYER_SELECTOR( nullptr, {} )        // Footprint Defaults
 *     new GRID_CELL_LAYER_SELECTOR( nullptr, forbidden ) // User Layer Names
 *
 * so the only difference between the two pages is that mask. It sits here
 * rather than inside a panel because both panels want it and neither owns it —
 * and because the mask is a statement about the BOARD's layers, which is this
 * directory's subject.
 *
 * The entries carry the layer's colour, which is not decoration:
 * `PCB_LAYER_BOX_SELECTOR::Resync` appends each name with
 * `LAYER_PRESENTATION::DrawColorSwatch`, and our shared `Combo` takes the same
 * `swatch` on an option.
 */
import { FOOTPRINT_LAYERS } from './footprintBoard.js';
import { layerColor } from '../pcb/pcbTheme.js';

/** One row of the cell's dropdown: the canonical name stored, the name shown. */
export interface FpLayerChoice {
  /** `LSET::Name( layer )` — what `default_footprint_text_items` stores. */
  value: string;
  /** `BOARD::GetLayerName`, which is the user name where a layer has one. */
  label: string;
  /** The layer's colour, for the swatch. */
  swatch: string;
}

const choiceOf = (l: (typeof FOOTPRINT_LAYERS)[number]): FpLayerChoice => ({
  value: l.name,
  label: l.userName ?? l.name,
  swatch: layerColor(l.name),
});

/**
 * Every layer the frame's board has — `GRID_CELL_LAYER_SELECTOR( nullptr, {} )`,
 * an empty forbidden set, which is what Footprint Defaults passes
 * (`panel_fp_editor_field_defaults.cpp:199-201`).
 */
export function allLayerChoices(): FpLayerChoice[] {
  return FOOTPRINT_LAYERS.map(choiceOf);
}

/**
 * The layers a User Layer Names row may name.
 *
 * `PANEL_FP_USER_LAYER_NAMES`' mask is built by exclusion
 * (`panel_fp_user_layer_names.cpp:157-161`):
 *
 *     LSET forbiddenLayers = LSET::AllCuMask() | LSET::AllTechMask();
 *     forbiddenLayers.set( Edge_Cuts );
 *     forbiddenLayers.set( Margin );
 *
 * `AllTechMask()` is the twelve F/B adhesive, paste, silkscreen, mask,
 * courtyard and fab layers (`common/lset.cpp`), so what is left is the four
 * `User.*` auxiliary layers — Drawings, Comments, Eco1, Eco2 — and the
 * numbered `User.n` ones. Those are exactly the layers `IsUserLayer` accepts
 * when the panel writes the row back (`:250-253`).
 */
export function userLayerChoices(): FpLayerChoice[] {
  return FOOTPRINT_LAYERS.filter(
    (l) =>
      l.kind !== 'signal' &&
      !TECH_LAYERS.has(l.name) &&
      l.name !== 'Edge.Cuts' &&
      l.name !== 'Margin',
  ).map(choiceOf);
}

/**
 * `LSET::AllTechMask()` by name — the twelve technical layers, which are the
 * F/B pairs of adhesive, paste, silkscreen, mask, courtyard and fab
 * (`common/lset.cpp`). Stated as names because that is what `FOOTPRINT_LAYERS`
 * is keyed by; the numeric mask has no other reader here. [data]
 */
const TECH_LAYERS: ReadonlySet<string> = new Set([
  'F.Adhes',
  'B.Adhes',
  'F.Paste',
  'B.Paste',
  'F.SilkS',
  'B.SilkS',
  'F.Mask',
  'B.Mask',
  'F.CrtYd',
  'B.CrtYd',
  'F.Fab',
  'B.Fab',
]);

/** The label a stored canonical name shows as, or the name itself if unknown. */
export function fpLayerLabel(canonical: string): string {
  return FOOTPRINT_LAYERS.find((l) => l.name === canonical)?.userName ?? canonical;
}
