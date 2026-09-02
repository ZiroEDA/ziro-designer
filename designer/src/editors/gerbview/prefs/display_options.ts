// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GERBVIEW_DISPLAY_OPTIONS`' data: the Page Size radio table and the
 * forced-opacity spin control's range.
 *
 * Split from the panel for the reason `dialogs/prefs/gal_options.ts` is split
 * from `PanelGalOptions.tsx`: `qa`'s tsconfig sets no `--jsx`, so a test cannot
 * follow a `.tsx`, and a range that exists only inside JSX can be checked only
 * by scraping the file as text — which a commented-out line satisfies. Here
 * they are values, and the panel is the only thing that reads them.
 */

/**
 * The seven Page Size radios, in the base file's own order, each paired with
 * the string `TransferDataFromWindow` stores in `appearance.page_type`.
 *
 * Two halves of `panel_gerbview_display_options.cpp`, and they must be read
 * together. The LABELS are `panel_gerbview_display_options_base.cpp:109-133` —
 * `_( "Full size" )`, `_( "Size A4" )` and so on. The VALUES are the `wxT(…)`
 * literals at `:91-97`, where "Full size" is the `else` arm and stores
 * `"GERBER"` rather than anything spelled like its label. The full-size button
 * carries `wxRB_GROUP` and is therefore first.
 *
 * `"GERBER"` is also the `PARAM`'s default (`gerbview_settings.cpp:53-55`) and
 * a real `PAGE_SIZE_TYPE`: 32000 x 32000 mils (`page_info.cpp:61`), the square
 * GerbView opens on.
 */
export const GBR_PAGE_SIZE_CHOICES: readonly (readonly [string, string])[] = [
  ['GERBER', 'Full size'],
  ['A4', 'Size A4'],
  ['A3', 'Size A3'],
  ['A2', 'Size A2'],
  ['A', 'Size A'],
  ['B', 'Size B'],
  ['C', 'Size C'],
];

/**
 * `m_spOpacityCtrl`'s range — a `wxSpinCtrlDouble` constructed
 * `( …, 0.2, 1, 0.600000, 0.1 )` with `SetDigits( 2 )` after it
 * (`panel_gerbview_display_options_base.cpp:86-87`). Min, max, initial, step,
 * then digits; the initial is `GERBVIEW_DEFAULTS.appearance.mode_opacity_value`
 * and lives there rather than being restated here.
 */
export const OPACITY_RANGE = { min: 0.2, max: 1, step: 0.1, digits: 2 } as const;
