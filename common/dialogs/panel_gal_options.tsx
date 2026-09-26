// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GAL_OPTIONS` — the Grid Display and Cursor groups, written **once**.
 *
 * Upstream this is `common/dialogs/panel_gal_options.{h,cpp}` plus its
 * wxFormBuilder base, and it is in `common/` because no app owns it: every
 * editor's Display Options page constructs one and embeds it —
 * `PANEL_PL_EDITOR_DISPLAY_OPTIONS` (`pagelayout_editor/dialogs/
 * panel_pl_editor_display_options.cpp:38-40`), `PANEL_EESCHEMA_DISPLAY_OPTIONS`,
 * `PANEL_PCBNEW_DISPLAY_OPTIONS`, the footprint editor's and gerbview's. It
 * takes an `APP_SETTINGS_BASE*` and touches `m_Window.grid` and
 * `m_Window.cursor`, the slice `APP_SETTINGS_BASE` gives every app alike, so one
 * class serves all of them without knowing which one it is looking at.
 *
 * Ours is the same shape: a component over the `window` slice of whichever
 * settings object the calling page owns. It was previously inlined in the
 * schematic's Display Options page, where it had drifted — a `wxChoice` where
 * upstream has radio buttons, a crosshair list spelled `45° full window
 * crosshairs` against `ui/grid_cursor.ts`' `45 degree crosshairs`, and both
 * spin ranges invented (thickness 1..5 against 0.5..10 by 0.5, minimum spacing
 * 2..50 against 5..200 by 5).
 */
import type { JSX } from 'react';
import { Check, Group, Num, Radio, Sel } from '../wx/controls.js';
import {
  ALWAYS_SHOW_CROSSHAIRS_LABEL,
  CROSSHAIR_MODE_CHOICES,
  type CrosshairMode,
} from '../draw_panel_gal_grid_cursor.js';
import type { GridSnapping } from '../draw_panel_gal_grid_cursor.js';

// ---------------------------------------------------------------------------
// Folded in from gal_options.ts (09-26): upstream this is the same
// file, and the split existed only because qa could not compile .tsx.

/** `GRID_SETTINGS::style` — `KIGFX::GRID_STYLE`, as our settings spell it. */
export type GridStyle = 'dots' | 'lines' | 'crosses';

/**
 * `KIGFX::GRID_SNAPPING`, re-exported rather than restated: it is a
 * `GAL_DISPLAY_OPTIONS` member, so it lives beside `GAL::GetGridSnapping` —
 * the one function that acts on it — in `ui/grid_cursor.ts`, and this module
 * is only where the CHOICE that writes it is described.
 */
export type { GridSnapping } from '../draw_panel_gal_grid_cursor.js';

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

/**
 * `GRID_SETTINGS`' appearance half — what `PANEL_GAL_OPTIONS::
 * TransferDataFromWindow` writes back (`common/dialogs/panel_gal_options.cpp:
 * 110-124`), and nothing else. The grid *list* is the Grids page.
 */
export interface GalGridOptions {
  style: GridStyle;
  line_width: number;
  min_spacing: number;
  snap: GridSnapping;
}

/** `CURSOR_SETTINGS`, both of its controls. */
export interface GalCursorOptions {
  crosshair: CrosshairMode;
  always_show_cursor: boolean;
}

/** `APP_SETTINGS_BASE::m_Window`, as much of it as this panel can see. */
export interface GalOptionsWindow {
  grid: GalGridOptions;
  cursor: GalCursorOptions;
}

export function PanelGalOptions({
  /**
   * The `m_Window` slice of the owning app's settings — `APP_SETTINGS_BASE*
   * aAppSettings` narrowed to the part this panel reads.
   */
  win,
  /** Mutate a clone of it, the working copy the shell commits on OK. */
  update,
  /**
   * The radio groups' `name`. Two `PANEL_GAL_OPTIONS` can never be on screen at
   * once upstream — one page is shown at a time — but ours must still not
   * collide with another page's radios if one is ever mounted alongside.
   */
  idPrefix,
}: {
  win: GalOptionsWindow;
  update: (fn: (w: GalOptionsWindow) => void) => void;
  idPrefix: string;
}): JSX.Element {
  return (
    <>
      <Group title={GAL_GROUP_TITLES[0]}>
        <Radio
          label={GRID_DISPLAY_LABELS[0]}
          row
          name={`${idPrefix}-grid-style`}
          value={win.grid.style}
          options={GRID_STYLE_CHOICES}
          onChange={(v) =>
            update((w) => {
              w.grid.style = v;
            })
          }
        />
        <Sel
          label={GRID_DISPLAY_LABELS[1]}
          value={win.grid.line_width}
          unit="pixels"
          options={GRID_THICKNESS_CHOICES.map(([v, l]) => [v, l] as [number, string])}
          onChange={(v) =>
            update((w) => {
              w.grid.line_width = v;
            })
          }
        />
        <Num
          label={GRID_DISPLAY_LABELS[2]}
          value={win.grid.min_spacing}
          unit="pixels"
          min={GRID_MIN_SPACING_RANGE.min}
          max={GRID_MIN_SPACING_RANGE.max}
          step={GRID_MIN_SPACING_RANGE.step}
          onChange={(v) =>
            update((w) => {
              w.grid.min_spacing = v;
            })
          }
        />
        <Sel
          label={GRID_DISPLAY_LABELS[3]}
          value={win.grid.snap}
          options={GRID_SNAP_CHOICES.map(([v, l]) => [v, l] as [GridSnapping, string])}
          onChange={(v) =>
            update((w) => {
              w.grid.snap = v;
            })
          }
        />
      </Group>
      <Group title={GAL_GROUP_TITLES[1]}>
        <Radio
          name={`${idPrefix}-crosshair`}
          value={win.cursor.crosshair}
          options={CROSSHAIR_MODE_CHOICES}
          onChange={(v) =>
            update((w) => {
              w.cursor.crosshair = v;
            })
          }
        />
        <Check
          label={ALWAYS_SHOW_CROSSHAIRS_LABEL}
          checked={win.cursor.always_show_cursor}
          onChange={(v) =>
            update((w) => {
              w.cursor.always_show_cursor = v;
            })
          }
        />
      </Group>
    </>
  );
}
