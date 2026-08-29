// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GAL_OPTIONS`' data: its two group headings, its control labels, and the
 * three tables that decide what its controls offer.
 *
 * Split from the panel itself (`PanelGalOptions.tsx`) for the reason
 * `registry.ts` is split from `lazy_pages.ts`: `qa`'s tsconfig sets no `--jsx`,
 * so a test cannot follow a `.tsx`. A range that lives only inside JSX can only
 * be checked by scraping the file as text, and "the right number appears
 * somewhere in the file" is not an assertion — a commented-out line satisfies
 * it. Here the tables are values, and the panel is the only thing that reads
 * them.
 *
 * Every number is `common/dialogs/panel_gal_options.cpp`'s, and every string is
 * `common/dialogs/panel_gal_options_base.cpp`'s.
 */

/** `GRID_SETTINGS::style` — `KIGFX::GRID_STYLE`, as our settings spell it. */
export type GridStyle = 'dots' | 'lines' | 'crosses';

/** `KIGFX::GRID_SNAPPING`, stored as the `wxChoice` selection upstream stores. */
export type GridSnapping = 0 | 1 | 2;

/**
 * `m_staticText1` and `m_stGridLabel` (`panel_gal_options_base.cpp:17` and
 * `:96`) — the panel's two headings, in order.
 */
export const GAL_GROUP_TITLES = ['Grid Display', 'Cursor'] as const;

/**
 * The Grid Display group's four control labels, in wxFormBuilder's own order:
 * the style radio row, then the grid-bag sizer's three rows
 * (`panel_gal_options_base.cpp:27`, `:49`, `:63`, `:75`).
 *
 * This group is the whole of what #619's G12 counted as missing from the
 * Drawing Sheet Editor's Preferences and could not name, because our modal had
 * only the Cursor group below it.
 */
export const GRID_DISPLAY_LABELS = [
  'Style:',
  'Grid thickness:',
  'Minimum grid spacing:',
  'Snap to grid:',
] as const;

/** `m_rbDots` / `m_rbLines` / `m_rbCrosses` (`panel_gal_options_base.cpp:31-38`). */
export const GRID_STYLE_CHOICES: readonly (readonly [GridStyle, string])[] = [
  ['dots', 'Dots'],
  ['lines', 'Lines'],
  ['crosses', 'Small crosses'],
];

/** `m_gridSnapOptionsChoices` (`panel_gal_options_base.cpp:77`). */
export const GRID_SNAP_CHOICES: readonly (readonly [GridSnapping, string])[] = [
  [0, 'Always'],
  [1, 'When grid shown'],
  [2, 'Never'],
];

/**
 * `gridThicknessMin`, `gridThicknessMax`, `gridThicknessStep`
 * (`common/dialogs/panel_gal_options.cpp:36-38`).
 */
export const GRID_THICKNESS_RANGE = { min: 0.5, max: 10.0, step: 0.5 } as const;

/**
 * `gridMinSpacingMin`, `gridMinSpacingMax`, `gridMinSpacingStep`
 * (`common/dialogs/panel_gal_options.cpp:40-42`), handed to
 * `m_gridMinSpacing->SetRange` / `SetIncrement` at `:77-78`.
 */
export const GRID_MIN_SPACING_RANGE = { min: 5, max: 200, step: 5 } as const;

/**
 * The grid-thickness `wxChoice`'s items, built by the constructor's loop
 * (`common/dialogs/panel_gal_options.cpp:65-73`):
 *
 *     for( double size = gridThicknessMin; size <= gridThicknessMax; size += gridThicknessStep )
 *         m_gridLineWidth->Append( wxString::Format( wxT( "%.1f" ), size ) );
 *
 * A choice of twenty fixed values, not a spin control — which is why the label
 * beside it is a `wxChoice` and the one beside Minimum grid spacing is not.
 */
export const GRID_THICKNESS_CHOICES: readonly (readonly [number, string])[] = (() => {
  const { min, max, step } = GRID_THICKNESS_RANGE;
  const out: [number, string][] = [];
  // `size <= max` in double arithmetic; the epsilon is ours, because 0.5 steps
  // accumulate error and C's comparison happens to fall the other way.
  for (let size = min; size <= max + 1e-9; size += step) out.push([size, size.toFixed(1)]);
  return out;
})();
