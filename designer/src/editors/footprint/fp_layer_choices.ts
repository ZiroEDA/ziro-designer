// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRID_CELL_LAYER_SELECTOR`'s option list, for the two Preferences pages of
 * this editor that put a layer in a grid cell.
 *
 * Upstream the cell editor is one class (`pcbnew/grid_layer_box_helpers.cpp`),
 * built with a `LSET` of layers to LEAVE OUT and a frame to take the board
 * from:
 *
 *     new GRID_CELL_LAYER_SELECTOR( nullptr, {} )        // Footprint Defaults
 *     new GRID_CELL_LAYER_SELECTOR( nullptr, forbidden ) // User Layer Names
 *
 * **The frame is `nullptr` in both**, and that is the whole of what these
 * pages list. `PCB_LAYER_BOX_SELECTOR::getEnabledLayers()` returns
 * `LSET::AllLayersMask()` when it has no board frame
 * (`pcb_layer_box_selector.cpp:129-136`), so neither list is cut down to the
 * layers a board has: Footprint Defaults offers all 95 rows `UIOrder()` yields
 * — F.Cu, In1.Cu … In30.Cu, B.Cu, the eighteen tech and user layers, then
 * User.1 … User.45 — and the only difference between the two pages is the
 * mask. Ours listed the 26 layers of the footprint editor's own dummy board,
 * which is the set the CANVAS has and not the set this control offers.
 *
 * The names are `BOARD::GetStandardLayerName`, i.e. `LayerName()`
 * (`grid_layer_box_helpers.cpp:96`), for the same reason: with no frame there
 * is no board to have renamed anything, so a user layer name set on **User
 * Layer Names** does not show here. The value stored is `LSET::Name` — the
 * canonical token, which is what `default_footprint_text_items` holds in
 * `fpedit.json`.
 *
 * The entries carry the layer's colour, which is not decoration:
 * `PCB_LAYER_BOX_SELECTOR::Resync` appends each name with
 * `LAYER_PRESENTATION::DrawColorSwatch`, and our shared `Combo` takes the same
 * `swatch` on an option. That call composites the layer colour over the board
 * BACKGROUND (`layer_presentation.cpp:36-62`), so a half-transparent layer —
 * `F.Mask` is `rgba(216, 100, 255, 0.4)` — reads against `#001023` and not
 * against the cell it happens to sit in. Handed through raw, those six
 * swatches tinted the grid's grey and turned orange on a selected row.
 */
import {
  AllCuMask,
  AllTechMask,
  Edge_Cuts,
  LayerSelectorUIOrder,
  MAX_CU_LAYERS,
  Margin,
} from '@ziroeda/pcbnew/src/layer_ids.js';
import { fpBackgroundDefault } from './fpColorLayers.js';
import { layerChoice, type LayerChoice } from '../../widgets/layer_presentation.js';

/**
 * The footprint editor's row type. It IS `LAYER_PRESENTATION`'s `LayerChoice`
 * — the name/label/swatch triple is not per frame, only the background the
 * swatch is composited over is, so the type is re-exported rather than
 * redeclared (`widgets/layer_presentation.ts`).
 */
export type FpLayerChoice = LayerChoice;

/**
 * `m_layerPresentation->DrawColorSwatch( bmp, layerid )`, whose background is
 * `getLayerColor( LAYER_PCB_BACKGROUND )` (`pcbnew/sel_layer.cpp:60-74`). Both
 * colours come from the DEFAULT theme here, as `layerColor` already does — a
 * selector with no board frame reads `fpedit`'s theme upstream, which is the
 * same gap `layerColor` has and not a second one.
 *
 * This frame's subclass of the shared builder: it supplies the background and
 * nothing else.
 */
const choiceOf = (id: number): FpLayerChoice => layerChoice(id, fpBackgroundDefault());

/**
 * Every layer the selector has — `GRID_CELL_LAYER_SELECTOR( nullptr, {} )`, an
 * empty forbidden set, which is what Footprint Defaults passes
 * (`panel_fp_editor_field_defaults.cpp:189-201`).
 */
export function allLayerChoices(): FpLayerChoice[] {
  return LayerSelectorUIOrder().map(choiceOf);
}

/**
 * The layers a User Layer Names row may name.
 *
 * `PANEL_FP_USER_LAYER_NAMES`' mask is built by exclusion
 * (`panel_fp_user_layer_names.cpp:160-164`):
 *
 *     LSET forbiddenLayers = LSET::AllCuMask() | LSET::AllTechMask();
 *     forbiddenLayers.set( Edge_Cuts );
 *     forbiddenLayers.set( Margin );
 *
 * `AllTechMask()` is the twelve F/B adhesive, paste, silkscreen, mask,
 * courtyard and fab layers (`common/lset.cpp`), so what is left is the four
 * `User.*` auxiliary layers — Drawings, Comments, Eco1, Eco2 — and all
 * forty-five numbered `User.n` ones. Those are exactly the layers
 * `IsUserLayer` accepts when the panel writes the row back (`:250-256`).
 */
export function userLayerChoices(): FpLayerChoice[] {
  return LayerSelectorUIOrder([...AllCuMask(MAX_CU_LAYERS), ...AllTechMask, Edge_Cuts, Margin]).map(
    choiceOf,
  );
}
