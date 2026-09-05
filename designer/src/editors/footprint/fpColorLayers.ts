// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_EDITOR_COLOR_SETTINGS`' `m_validLayers` and `createSwatches`
 * (`pcbnew/dialogs/panel_fp_editor_color_settings.cpp:50-113`), as data.
 *
 * The panel's whole contribution over `PANEL_COLOR_SETTINGS` is four
 * statements, and this file is two of them:
 *
 *     m_validLayers = { F_Cu, In1_Cu, B_Cu } + every GAL_LAYER_ID
 *                     except the five via/pad-hole ones          (`:50-67`)
 *     createSwatches(): F.Cu, _( "Internal Layers" ), B.Cu, then the GAL
 *                     layers SORTED BY NAME                      (`:90-113`)
 *
 * The other two are on the panel itself: `m_colorNamespace = "board"` — this
 * page edits the SAME rows the PCB Editor's does, which is why a colour changed
 * here shows up there — and `m_backgroundLayer = LAYER_PCB_BACKGROUND`.
 *
 * **The three copper rows are not `LayerName()`.** The middle one is spelled
 * `_( "Internal Layers" )` in the source (`:110`), plural, over `In1_Cu` alone:
 * a footprint's inner-copper items all share one colour because the frame's
 * dummy board has a single inner layer.
 *
 * Every colour is named, never typed: the values come from
 * `BUILTIN_DEFAULT_THEME`, the shared port of `builtin_color_themes.h`, through
 * `editors/pcb/pcbTheme.ts` — the same table the board editor paints from.
 */
import { toCssColor, type Color4d } from '@ziroeda/common';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common';

/** One row of the swatch list: its `colors/user.json` key and its label. */
export interface FpColorLayer {
  /**
   * The stored key, `<namespace>.<layer>`. The namespace is `board`
   * (`panel_fp_editor_color_settings.cpp:34`), so these are pcbnew's rows and
   * not a set of the footprint editor's own — `color_settings.cpp:124-148` is
   * where each name is bound to its `LAYER_*` id.
   */
  key: string;
  /** `LayerName( id )` (`common/layer_id.cpp:130-160`), or the panel's own string. */
  name: string;
  /** The `LAYER_*` enumerator, which is how the default is looked up. */
  layer: keyof typeof BUILTIN_DEFAULT_THEME;
}

/**
 * The three copper rows, in `createSwatches`' own order — which is NOT the
 * sorted order the rest of the list is in, because upstream emits these three
 * before the loop.
 */
const COPPER_ROWS: readonly FpColorLayer[] = [
  { key: 'board.copper.f', name: 'F.Cu', layer: 'F_Cu' },
  // `createSwatch( In1_Cu, _( "Internal Layers" ) )` (`:110`).
  { key: 'board.copper.in1', name: 'Internal Layers', layer: 'In1_Cu' },
  { key: 'board.copper.b', name: 'B.Cu', layer: 'B_Cu' },
];

/**
 * Every `board.*` GAL layer `color_settings.cpp:124-147` binds, minus the five
 * `m_validLayers` skips.
 *
 * The five are `LAYER_VIAS`, `LAYER_VIA_HOLES`, `LAYER_VIA_HOLEWALLS`,
 * `LAYER_PAD_PLATEDHOLES` and `LAYER_PAD_HOLEWALLS`
 * (`panel_fp_editor_color_settings.cpp:56-65`) — a footprint has no vias, and
 * a pad's plated hole is painted in the background colour rather than a colour
 * of its own (`pcb_painter.cpp:158`), so neither has a colour to offer. Of
 * those five only `via_hole`, `via_hole_walls` and `pad_plated_hole` have a
 * `board.*` key at all; the other two are painter-side.
 *
 * NOT sorted here. `createSwatches` sorts at build time with
 * `LayerName( a ) < LayerName( b )`, a codepoint comparison, and doing it in
 * {@link fpColorRows} rather than freezing an order in this table is what keeps
 * the two agreeing when a row is added.
 */
const GAL_ROWS: readonly FpColorLayer[] = [
  { key: 'board.anchor', name: 'Anchors', layer: 'LAYER_ANCHOR' },
  { key: 'board.locked_shadow', name: 'Locked item shadow', layer: 'LAYER_LOCKED_ITEM_SHADOW' },
  {
    key: 'board.conflicts_shadow',
    name: 'Courtyard collision shadow',
    layer: 'LAYER_CONFLICTS_SHADOW',
  },
  { key: 'board.aux_items', name: 'Helper items', layer: 'LAYER_AUX_ITEMS' },
  { key: 'board.background', name: 'Background', layer: 'LAYER_PCB_BACKGROUND' },
  { key: 'board.cursor', name: 'Cursor', layer: 'LAYER_CURSOR' },
  { key: 'board.drc_error', name: 'DRC errors', layer: 'LAYER_DRC_ERROR' },
  { key: 'board.drc_warning', name: 'DRC warnings', layer: 'LAYER_DRC_WARNING' },
  { key: 'board.drc_exclusion', name: 'DRC exclusions', layer: 'LAYER_DRC_EXCLUSION' },
  { key: 'board.grid', name: 'Grid', layer: 'LAYER_GRID' },
  { key: 'board.grid_axes', name: 'Grid axes', layer: 'LAYER_GRID_AXES' },
  // `board.plated_hole` is LAYER_NON_PLATEDHOLES, not the plated one — that
  // pairing is upstream's and it is easy to read backwards
  // (`color_settings.cpp:135-136`).
  { key: 'board.plated_hole', name: 'Non-plated holes', layer: 'LAYER_NON_PLATEDHOLES' },
  { key: 'board.ratsnest', name: 'Ratsnest', layer: 'LAYER_RATSNEST' },
  { key: 'board.worksheet', name: 'Drawing sheet', layer: 'LAYER_DRAWINGSHEET' },
  { key: 'board.page_limits', name: 'Page limits', layer: 'LAYER_PAGE_LIMITS' },
  { key: 'board.outline_area', name: 'Board outline area', layer: 'LAYER_BOARD_OUTLINE_AREA' },
  { key: 'board.track_net_names', name: 'Track net names', layer: 'NETNAMES_LAYER_ID_START' },
  { key: 'board.pad_net_names', name: 'Pad net names', layer: 'LAYER_PAD_NETNAMES' },
  { key: 'board.via_net_names', name: 'Via net names', layer: 'LAYER_VIA_NETNAMES' },
  { key: 'board.points', name: 'Points', layer: 'LAYER_POINTS' },
];

/**
 * The rows the page draws, in `createSwatches`' order: the three copper rows,
 * then the GAL layers sorted by name.
 *
 * The sort is `std::sort( …, LayerName( a ) < LayerName( b ) )`
 * (`panel_fp_editor_color_settings.cpp:101-106`), which compares wxString by
 * code unit — so every capital sorts before every lowercase and "DRC errors"
 * comes before "Drawing sheet". `localeCompare` would put them the other way
 * round, which is the trap `net_colors_live_in_the_project` names.
 */
export function fpColorRows(): readonly FpColorLayer[] {
  const sorted = [...GAL_ROWS].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...COPPER_ROWS, ...sorted];
}

/** `LAYER_PCB_BACKGROUND` — `m_backgroundLayer` (`:114`). */
export const FP_COLOR_BACKGROUND_KEY = 'board.background';

/** A row's colour with no user override: `s_defaultTheme`'s entry for its layer. */
export function fpDefaultColor(row: FpColorLayer): string {
  return toCssColor(BUILTIN_DEFAULT_THEME[row.layer] as Color4d);
}

/**
 * `m_backgroundLayer`'s default colour — `LAYER_PCB_BACKGROUND` out of
 * `s_defaultTheme`, which is the same value `pcbTheme.ts`' `PCB_BACKGROUND`
 * carries. Here rather than at the call site so the page states no colour of
 * its own, not even a fallback.
 */
export function fpBackgroundDefault(): string {
  return toCssColor(BUILTIN_DEFAULT_THEME.LAYER_PCB_BACKGROUND as Color4d);
}
