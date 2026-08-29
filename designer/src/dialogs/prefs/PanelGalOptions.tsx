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
import { Check, Group, Num, Radio, Sel } from './widgets.js';
import {
  GAL_GROUP_TITLES,
  GRID_DISPLAY_LABELS,
  GRID_MIN_SPACING_RANGE,
  GRID_SNAP_CHOICES,
  GRID_STYLE_CHOICES,
  GRID_THICKNESS_CHOICES,
  type GridSnapping,
  type GridStyle,
} from './gal_options.js';
import {
  ALWAYS_SHOW_CROSSHAIRS_LABEL,
  CROSSHAIR_MODE_CHOICES,
  type CrosshairMode,
} from '../../ui/grid_cursor.js';

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
