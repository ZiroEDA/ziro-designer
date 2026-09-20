// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/layer_settings_utils.cpp` + its header: the names the
 * `.kicad_prl` uses for the user-visibility items, and the two-way map
 * between them and `GAL_LAYER_ID`.
 *
 * The file stores names, not numbers, so a `GAL_LAYER_ID` renumbering does
 * not change what an existing project shows. `LY_POINTS` is spelled that way
 * upstream because `POINTS` collides with a Windows header define; the
 * *string* is `ly_points`, and that is what a file carries.
 */
import { GAL_LAYER_ID, GAL_SET } from '../layer_ids.js';

export enum VISIBILITY_LAYER {
  TRACKS = 0,
  VIAS,
  PADS,
  ZONES,
  SHAPES,
  BITMAPS,
  FOOTPRINTS_FRONT,
  FOOTPRINTS_BACK,
  FOOTPRINT_VALUES,
  FOOTPRINT_REFERENCES,
  FOOTPRINT_TEXT,
  FOOTPRINT_ANCHORS,
  LY_POINTS, // Do not use POINTS: it collide with a Windows header define
  RATSNEST,
  DRC_WARNINGS,
  DRC_ERRORS,
  DRC_EXCLUSIONS,
  LOCKED_ITEM_SHADOWS,
  CONFLICT_SHADOWS,
  BOARD_OUTLINE_AREA,
  DRAWING_SHEET,
  GRID,
}

/** `magic_enum::enum_name`, lower-cased: the enum's own spelling is the key. */
const NAMES: readonly string[] = [
  'tracks',
  'vias',
  'pads',
  'zones',
  'shapes',
  'bitmaps',
  'footprints_front',
  'footprints_back',
  'footprint_values',
  'footprint_references',
  'footprint_text',
  'footprint_anchors',
  'ly_points',
  'ratsnest',
  'drc_warnings',
  'drc_errors',
  'drc_exclusions',
  'locked_item_shadows',
  'conflict_shadows',
  'board_outline_area',
  'drawing_sheet',
  'grid',
];

/** The render layers, in `VISIBILITY_LAYER` order. */
const RENDER: readonly GAL_LAYER_ID[] = [
  GAL_LAYER_ID.LAYER_TRACKS,
  GAL_LAYER_ID.LAYER_VIAS,
  GAL_LAYER_ID.LAYER_PADS,
  GAL_LAYER_ID.LAYER_ZONES,
  GAL_LAYER_ID.LAYER_FILLED_SHAPES,
  GAL_LAYER_ID.LAYER_DRAW_BITMAPS,
  GAL_LAYER_ID.LAYER_FOOTPRINTS_FR,
  GAL_LAYER_ID.LAYER_FOOTPRINTS_BK,
  GAL_LAYER_ID.LAYER_FP_VALUES,
  GAL_LAYER_ID.LAYER_FP_REFERENCES,
  GAL_LAYER_ID.LAYER_FP_TEXT,
  GAL_LAYER_ID.LAYER_ANCHOR,
  GAL_LAYER_ID.LAYER_POINTS,
  GAL_LAYER_ID.LAYER_RATSNEST,
  GAL_LAYER_ID.LAYER_DRC_WARNING,
  GAL_LAYER_ID.LAYER_DRC_ERROR,
  GAL_LAYER_ID.LAYER_DRC_EXCLUSION,
  GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW,
  GAL_LAYER_ID.LAYER_CONFLICTS_SHADOW,
  GAL_LAYER_ID.LAYER_BOARD_OUTLINE_AREA,
  GAL_LAYER_ID.LAYER_DRAWINGSHEET,
  GAL_LAYER_ID.LAYER_GRID,
];

/**
 * `UserVisbilityLayers()` (sic — the typo is upstream's): the GAL layers a
 * user can toggle from the Appearance panel, as a set.
 */
export function UserVisbilityLayers(): GAL_SET {
  return new GAL_SET(RENDER);
}

export function RenderLayerFromVisibilityLayer(aLayer: VISIBILITY_LAYER): GAL_LAYER_ID {
  return RENDER[aLayer] ?? GAL_LAYER_ID.GAL_LAYER_ID_END;
}

export function VisibilityLayerFromRenderLayer(
  aLayerId: GAL_LAYER_ID,
): VISIBILITY_LAYER | undefined {
  const i = RENDER.indexOf(aLayerId);

  return i < 0 ? undefined : (i as VISIBILITY_LAYER);
}

/** `magic_enum::enum_cast` with `case_insensitive`. */
export function RenderLayerFromVisbilityString(aLayer: string): GAL_LAYER_ID | undefined {
  const i = NAMES.indexOf(aLayer.toLowerCase());

  return i < 0 ? undefined : RENDER[i];
}

export function VisibilityLayerToString(aLayerId: VISIBILITY_LAYER): string {
  return NAMES[aLayerId] ?? '';
}
