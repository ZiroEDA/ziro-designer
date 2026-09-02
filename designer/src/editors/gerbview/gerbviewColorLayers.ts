// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GERBVIEW_COLOR_SETTINGS`' `m_validLayers` and `createSwatches`
 * (`gerbview/dialogs/panel_gerbview_color_settings.cpp:52-107`), plus the
 * override store the swatches write into.
 *
 * A `.ts` and not part of the panel for the reason `dialogs/prefs/gal_options.ts`
 * is: `qa`'s tsconfig sets no `--jsx`, so a table that lived inside JSX could
 * only be checked by scraping the file as text.
 *
 * ---------------------------------------------------------------------------
 * THE LAYER LIST
 * ---------------------------------------------------------------------------
 *
 * Two runs, appended in this order (`:52-58`):
 *
 *     for( int i = GERBVIEW_LAYER_ID_START;
 *          i < GERBVIEW_LAYER_ID_START + GERBER_DRAWLAYERS_COUNT; i++ )
 *         m_validLayers.push_back( i );
 *
 *     for( int i = LAYER_DCODES; i < GERBVIEW_LAYER_ID_END; i++ )
 *         m_validLayers.push_back( i );
 *
 * The second run is in **layer-id order** (`include/layer_ids.h:529-537`) —
 * DCodes, Negative Objects, Grid, Axes, Background, Drawing Sheet, Page
 * Limits — and NOT in the order `createSwatches`' switch happens to list its
 * cases, which puts Background last. The switch is a lookup; the loop is the
 * sequence. Getting that backwards moves one row.
 *
 * `GERBER_DRAWLAYERS_COUNT` is `PCB_LAYER_ID_COUNT`, **128** (`:519`, `:171`),
 * so upstream really does draw 128 graphic-layer swatches, of which only the
 * first 64 have a default colour in `s_defaultTheme` — see
 * {@link GERBER_DEFAULT_THEME_LAYERS} in `gerberColors.ts`. The rest are
 * `COLOR4D::UNSPECIFIED`, which `COLOR_SWATCH::MakeBitmap` draws as the bare
 * checkerboard. Reproduced rather than tidied to 64: the bar is that a user
 * cannot tell which program they are in, and a list that stops at 64 is a
 * visibly shorter scrollbar.
 *
 * The name is `_( "Graphic Layer %d" )` with `layer + 1 -
 * GERBVIEW_LAYER_ID_START` (`:103-104`), so the first row is "Graphic Layer 1"
 * and not 0.
 */
import {
  defaultLayerColor,
  GERBER_AXES_COLOR,
  GERBER_BG_COLOR,
  GERBER_DCODE_COLOR,
  GERBER_DEFAULT_THEME_LAYERS,
  GERBER_DRAWINGSHEET_COLOR,
  GERBER_GRID_COLOR,
  GERBER_NEGATIVE_COLOR,
  GERBER_PAGE_LIMITS_COLOR,
} from './gerberColors.js';

/** `GERBER_DRAWLAYERS_COUNT` — `PCB_LAYER_ID_COUNT` (`layer_ids.h:519`, `:171`). */
export const GERBER_DRAWLAYERS_COUNT = 128;

/**
 * The seven gerbview-specific layers, in the id order `m_validLayers`' second
 * loop walks them (`layer_ids.h:529-535`), with the name
 * `createSwatches`' switch gives each.
 *
 * `key` is the settings key an override is stored under, and it is namespaced:
 * upstream a `COLOR_SETTINGS` file keeps each app's colours under its own
 * section and the panel announces which by setting `m_colorNamespace =
 * "gerbview"` (`panel_gerbview_color_settings.cpp:33`). One flat map here with
 * the namespace in the key is that, and it is what stops a gerbview `Grid`
 * from overwriting the schematic's.
 */
export const GERBVIEW_FIXED_LAYERS: readonly {
  id: string;
  name: string;
  key: string;
  fallback: string;
}[] = [
  {
    id: 'LAYER_DCODES',
    name: 'DCodes',
    key: 'gerbview.dcodes',
    fallback: GERBER_DCODE_COLOR,
  },
  {
    id: 'LAYER_NEGATIVE_OBJECTS',
    name: 'Negative Objects',
    key: 'gerbview.negativeObjects',
    fallback: GERBER_NEGATIVE_COLOR,
  },
  {
    id: 'LAYER_GERBVIEW_GRID',
    name: 'Grid',
    key: 'gerbview.grid',
    fallback: GERBER_GRID_COLOR,
  },
  {
    id: 'LAYER_GERBVIEW_AXES',
    name: 'Axes',
    key: 'gerbview.axes',
    fallback: GERBER_AXES_COLOR,
  },
  {
    id: 'LAYER_GERBVIEW_BACKGROUND',
    name: 'Background',
    key: 'gerbview.background',
    fallback: GERBER_BG_COLOR,
  },
  {
    id: 'LAYER_GERBVIEW_DRAWINGSHEET',
    name: 'Drawing Sheet',
    key: 'gerbview.drawingSheet',
    fallback: GERBER_DRAWINGSHEET_COLOR,
  },
  {
    id: 'LAYER_GERBVIEW_PAGE_LIMITS',
    name: 'Page Limits',
    key: 'gerbview.pageLimits',
    fallback: GERBER_PAGE_LIMITS_COLOR,
  },
];

/** The settings key a graphic layer's override is stored under. */
export const graphicLayerKey = (row: number): string => `gerbview.layer${row}`;

/** `_( "Graphic Layer %d" )`, `layer + 1 - GERBVIEW_LAYER_ID_START` (`:103-104`). */
export const graphicLayerName = (row: number): string => `Graphic Layer ${row + 1}`;

/**
 * {@link graphicLayerKey} backwards — the row a stored key names, or null if it
 * names something else. `GERBER_DRAW_LAYER_INDEX( x )`, which is
 * `x - GERBVIEW_LAYER_ID_START` (`layer_ids.h:544`).
 *
 * Needed because the store is flat and shared: the Layers manager wants the
 * gerbview graphic rows out of a map that also holds the schematic's wires and
 * this app's own seven fixed layers.
 */
export function graphicLayerRow(key: string): number | null {
  const m = /^gerbview\.layer(\d+)$/.exec(key);
  if (!m) return null;
  const row = Number(m[1]);
  return row >= 0 && row < GERBER_DRAWLAYERS_COUNT ? row : null;
}

/**
 * A graphic layer's default colour, or null where upstream has none.
 *
 * `s_defaultTheme` names only the first 64 (`builtin_color_themes.h:91-154`);
 * `COLOR_SETTINGS::GetColor` answers `COLOR4D::UNSPECIFIED` beyond that
 * (`color_settings.cpp:402-408`), which is the transparent colour a swatch
 * draws as a bare checkerboard.
 */
export function graphicLayerDefault(row: number): string | null {
  return row < GERBER_DEFAULT_THEME_LAYERS ? defaultLayerColor(row) : null;
}

/**
 * The colour in force for one key: the user's override if there is one, the
 * theme's default otherwise.
 *
 * `COLOR_SETTINGS::GetColor( aLayer )` — a lookup in the settings object, which
 * is seeded from the default theme and then written over by whatever the user
 * changed, whether from this page or from the Layers manager. That both write
 * one store is not incidental: `PANEL_GERBVIEW_COLOR_SETTINGS`' constructor
 * calls `frame->m_LayersManager->CollectCurrentColorSettings( current )` with
 * the comment "Colors can also be modified from the LayersManager"
 * (`:41-43`), which only makes sense because they are the same colours.
 */
export function gerbviewColor(
  key: string,
  fallback: string,
  overrides: Readonly<Record<string, string>>,
): string {
  return overrides[key] ?? fallback;
}
