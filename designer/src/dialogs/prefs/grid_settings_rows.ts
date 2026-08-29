// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GRID_SETTINGS`' per-frame data: its three group headings, and which
 * Grid Overrides rows each `FRAME_T` shows.
 *
 * Split from `PanelGridSettings.tsx` so `qa` can read it — see the note at the
 * top of `gal_options.ts`. The table below is the entire behavioural difference
 * between one editor's Grids page and another's, so it is the thing worth
 * asserting per launcher.
 */

/** The five `override_*` keys `GRID_SETTINGS` declares, in KiCad's own order. */
export type GridOverrideKey = 'connected' | 'wires' | 'vias' | 'text' | 'graphics';

/** The `FRAME_T`s that reach `PANEL_GRID_SETTINGS`' constructor switch. */
export type GridFrameType =
  | 'FRAME_SCH'
  | 'FRAME_SCH_SYMBOL_EDITOR'
  | 'FRAME_PCB_EDITOR'
  | 'FRAME_FOOTPRINT_EDITOR'
  | 'FRAME_GERBER'
  | 'FRAME_PL_EDITOR';

/**
 * `m_gridsLabel`, `m_staticText21`, `m_overridesLabel`
 * (`common/dialogs/panel_grid_settings_base.cpp:25`, `:67`, `:109`).
 */
export const GRID_GROUP_TITLES = ['Grids', 'Fast Grid Switching', 'Grid Overrides'] as const;

/**
 * `PANEL_GRID_SETTINGS::PANEL_GRID_SETTINGS`' visibility table
 * (`common/dialogs/panel_grid_settings.cpp:53-92`), read out as data.
 *
 * The C++ says it by hiding rows rather than by listing them, so read it
 * backwards: `m_checkGridOverrideVias->Show( false )` outside pcbnew; connected
 * and wires hidden for every frame that is not one of the four schematic ones;
 * gerbview hides the heading, the rule and the remaining two as well. What is
 * left standing per frame is this. Three rows carry their frame's own text —
 * `SetLabel( _( "Pads:" ) )` at `:57`, and `_( "Footprints/pads:" )` and
 * `_( "Tracks:" )` at `:67-68`; the rest keep the base file's labels
 * (`panel_grid_settings_base.cpp:122-154`).
 */
export const OVERRIDE_ROWS: Readonly<
  Record<GridFrameType, readonly (readonly [GridOverrideKey, string])[]>
> = {
  FRAME_SCH: [
    ['connected', 'Connected items:'],
    ['wires', 'Wires:'],
    ['text', 'Text:'],
    ['graphics', 'Graphics:'],
  ],
  FRAME_SCH_SYMBOL_EDITOR: [
    ['connected', 'Connected items:'],
    ['wires', 'Wires:'],
    ['text', 'Text:'],
    ['graphics', 'Graphics:'],
  ],
  FRAME_PCB_EDITOR: [
    ['connected', 'Footprints/pads:'],
    ['wires', 'Tracks:'],
    ['vias', 'Vias:'],
    ['text', 'Text:'],
    ['graphics', 'Graphics:'],
  ],
  FRAME_FOOTPRINT_EDITOR: [
    ['connected', 'Pads:'],
    ['text', 'Text:'],
    ['graphics', 'Graphics:'],
  ],
  // `m_overridesLabel->Show( false )` too (`:82-90`): the group has no rows and
  // no heading in gerbview.
  FRAME_GERBER: [],
  // The `else` fall-through: vias gone with every non-pcbnew frame, connected
  // and wires gone with every non-schematic one. This is the Drawing Sheet
  // Editor's row.
  FRAME_PL_EDITOR: [
    ['text', 'Text:'],
    ['graphics', 'Graphics:'],
  ],
};
