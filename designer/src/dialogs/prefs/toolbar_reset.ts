// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`), written once for
 * every editor that has the page.
 *
 * It is a `.ts` and not part of the `.tsx` panel for the reason every other
 * `resets.ts` here is: `qa`'s tsconfig sets no `--jsx`, and "resetting one page
 * leaves the others alone" is exactly what has to be tested.
 *
 *     m_toolbars.clear();
 *     for( auto& tb : magic_enum::enum_values<TOOLBAR_LOC>() )
 *     {
 *         auto tbConfig = m_appTbSettings->DefaultToolbarConfig( tb );
 *         if( !tbConfig.has_value() ) continue;
 *         m_toolbars[tb] = tbConfig.value();
 *     }
 *
 * Two things it pointedly does NOT do, and neither does this:
 *
 *  - it does not touch `m_CustomToolbars`. The "Customize toolbars" checkbox is
 *    an `APP_SETTINGS_BASE` value the panel merely edits; Reset puts the
 *    *toolbars* back, and leaves customisation switched on if it was;
 *  - it does not touch any other app. `m_toolbars` is one panel's shadow of one
 *    `TOOLBAR_SETTINGS` file, and the schematic's Toolbars page cannot reach the
 *    board's.
 *
 * **Where this differs**, and it is one line: upstream refills the shadow with
 * `DefaultToolbarConfig` and `TransferDataFromWindow` then writes those defaults
 * out, so after Reset and OK the file holds an explicit copy of the stock
 * toolbars. Ours empties the file instead, which is the same drawn result —
 * `GetToolbarConfig` falls straight through to `DefaultToolbarConfig` when
 * nothing is stored — and is the state the settings object's own defaults
 * describe, so "Reset put this page back to its defaults" stays checkable as a
 * whole-tree diff. The panel is built the same way round: see the note on
 * `items` in `PanelToolbarCustomization.tsx`.
 */
import type { ToolbarSettings } from '../../ui/toolbar_config.js';

export function resetToolbarsPanel(store: ToolbarSettings): void {
  store.toolbars = [];
}
