// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Drawing Sheet Editor > Colors —
 * `PANEL_PL_EDITOR_COLOR_SETTINGS`
 * (`pagelayout_editor/dialogs/panel_pl_editor_color_settings.cpp`),
 * constructed for `PANEL_DS_COLORS` (`pagelayout_editor/pl_editor.cpp:82-83`).
 *
 * It is **not** a `PANEL_COLOR_SETTINGS`: it does not derive from that class and
 * has no swatch grid. Its base file is twelve lines of sizer holding a
 * `Color theme:` static text and a `wxChoice`, and nothing else
 * (`panel_pl_editor_color_settings_base.cpp:14-32`) — the drawing sheet's
 * colours come from the chosen theme, and the editor offers no per-layer
 * override. Adding one here would be an invention, so this page is that one row.
 *
 * `TransferDataFromWindow` writes the chosen theme's filename to
 * `cfg->m_ColorTheme` — `appearance.color_theme` — which is why the setting is
 * on `PlEditorSettings` rather than borrowed from eeschema's.
 *
 * **What reads it.** `DrawingSheetCanvas` calls `usePlEditorColors()`, which is
 * `LoadColors( ::GetColorSettings( cfg->m_ColorTheme ) )` — the line
 * `PL_DRAW_PANEL_GAL`'s constructor runs (`pl_draw_panel_gal.cpp:57-59`) and
 * `PL_EDITOR_FRAME::CommonSettingsChanged` runs again on a settings change
 * (`pl_editor_frame.cpp:641-650`). It takes three layers and only three:
 * LAYER_SCHEMATIC_BACKGROUND, LAYER_SCHEMATIC_GRID and
 * LAYER_SCHEMATIC_DRAWINGSHEET (`ds_painter.cpp:66-68`). Picking a theme here
 * therefore changes the canvas colour, the page outline and the sheet ink.
 *
 * It was stored and unread for one commit, and named as such on issue 619 —
 * a control that displays a value and then discards it is exactly the failure
 * this editor's audit exists to catch.
 */
import type { JSX } from 'react';
import { ColorThemeChoice } from '../../../dialogs/prefs/ColorThemeChoice.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelPlEditorColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { plEditor, upPl } = ctx;
  // No group box: `p1mainSizer` holds the label-and-choice row directly, with
  // no `wxStaticBoxSizer` and no heading. eeschema's Colors page has one because
  // `PANEL_COLOR_SETTINGS_BASE` gives it one; this page is not that class.
  return (
    <ColorThemeChoice
      label="Color theme:"
      value={plEditor.appearance.color_theme}
      onChange={(v) =>
        upPl((s) => {
          s.appearance.color_theme = v;
        })
      }
    />
  );
}
