// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_PCBNEW_COLOR_SETTINGS`' `m_validLayers` and `createSwatches`
 * (`pcbnew/dialogs/panel_pcbnew_color_settings.cpp:690-780`), as data.
 *
 * The board editor's Colors page is the footprint editor's with a longer list,
 * and the shape of the difference is exactly two statements:
 *
 *     for( int id = GAL_LAYER_ID_START; id < GAL_LAYER_ID_BITMASK_END; id++ )
 *         if( !g_excludedLayers.count( id ) ) m_validLayers.push_back( id );
 *
 * — where the footprint editor's own version skips five more ids (the vias and
 * the pad plated holes), because a footprint has neither — and:
 *
 *     for( PCB_LAYER_ID layer : LAYER_RANGE( F_Cu, B_Cu, MAX_CU_LAYERS ) )
 *         m_validLayers.insert( m_validLayers.begin() + i++, layer );
 *     for( PCB_LAYER_ID layer : LSET::AllNonCuMask().TechAndUserUIOrder() )
 *         m_validLayers.insert( m_validLayers.begin() + i++, layer );
 *
 * — every board layer, in UI order, ahead of the sorted GAL rows, where the
 * footprint editor emits three copper rows and calls the middle one
 * "Internal Layers".
 *
 * The namespace is `board` on both pages (`m_colorNamespace = "board"`), so a
 * colour changed on either moves the other and both move the canvas. That is
 * upstream's, not a shortcut here: `editors/footprint/fpColorLayers.ts` is the
 * same table for the shorter list, and `pcbTheme.ts`' `pcbThemeWithOverrides`
 * is what turns either into a theme.
 */
import { toCssColor, type Color4d } from '@ziroeda/common';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common';
import { LayerName, LayerSelectorUIOrder, LSET_Name } from '@ziroeda/pcbnew/src/layer_ids.js';
import { GAL_COLOR_ROWS, type FpColorLayer } from '../footprint/fpColorLayers.js';

export type PcbColorLayer = FpColorLayer;

/**
 * The GAL rows this page keeps and the FOOTPRINT editor's drops
 * (`panel_fp_editor_color_settings.cpp:56-65`): a footprint has no via, so
 * `LAYER_VIA_HOLES` and `LAYER_VIA_HOLEWALLS` have nothing to colour there.
 *
 * **`LAYER_PAD_PLATEDHOLES` is not one of them.** It is in `g_excludedLayers`
 * (`panel_pcbnew_color_settings.cpp:674`), so neither page shows it — even
 * though `board.pad_plated_hole` is a real key `color_settings.cpp:135` binds.
 * The exclusion list and the key list are two different questions, and reading
 * the second for the first puts a swatch on this page that KiCad does not have.
 */
const PCB_ONLY_GAL_ROWS: readonly PcbColorLayer[] = [
  { key: 'board.via_hole', name: 'Via holes', layer: 'LAYER_VIA_HOLES' },
  { key: 'board.via_hole_walls', name: 'Via hole walls', layer: 'LAYER_VIA_HOLEWALLS' },
];

/**
 * `board.copper.<f|b|in1…>` for a copper layer, `board.<layer>` otherwise —
 * the same key `pcbThemeWithOverrides` reads back
 * (`common/settings/color_settings.cpp:124-190`).
 */
export function boardColorKey(name: string): string {
  return /\.Cu$/.test(name)
    ? `board.copper.${name.replace(/\.Cu$/, '').toLowerCase()}`
    : `board.${name.replace('.', '_').toLowerCase()}`;
}

/**
 * The rows the page draws, in `createSwatches`' order: every board layer in
 * `LSET`'s UI order — copper first, then technical and user — and then the GAL
 * layers sorted by name.
 *
 * The board layers are NOT sorted ("Don't sort aBoard layers by name",
 * `:761`), and the GAL ones are, with `LayerName( a ) < LayerName( b )` — a
 * codepoint comparison, so every capital sorts before every lowercase and "DRC
 * errors" comes before "Drawing sheet". `localeCompare` would put them the
 * other way round.
 */
export function pcbColorRows(): readonly PcbColorLayer[] {
  const board: PcbColorLayer[] = LayerSelectorUIOrder().map((id) => {
    // The KEY is `LSET::Name` — the canonical token, `F.SilkS` — and the LABEL
    // is `LayerName`, which shows that layer as `F.Silkscreen`. Reading one for
    // the other is how a swatch ends up writing a key nothing reads back.
    const canonical = LSET_Name(id);
    return {
      key: boardColorKey(canonical),
      name: LayerName(canonical),
      layer: canonical.replace('.', '_') as PcbColorLayer['layer'],
    };
  });
  const gal = [...GAL_COLOR_ROWS, ...PCB_ONLY_GAL_ROWS].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return [...board, ...gal];
}

/** `LAYER_PCB_BACKGROUND` — `m_backgroundLayer` (`:725`). */
export const PCB_COLOR_BACKGROUND_KEY = 'board.background';

/** A row's colour with no user override: `s_defaultTheme`'s entry for its layer. */
export function pcbDefaultColor(row: PcbColorLayer): string {
  const c = BUILTIN_DEFAULT_THEME[row.layer] as Color4d | undefined;
  // A board layer with no entry in the built-in table cannot happen — every
  // `PCB_LAYER_ID` `color_settings.cpp` registers is in it — so this is a
  // missing row in that table rather than something to paint over.
  return toCssColor(c ?? (BUILTIN_DEFAULT_THEME.LAYER_GRID as Color4d));
}
