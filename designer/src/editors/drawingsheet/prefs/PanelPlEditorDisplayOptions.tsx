// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Drawing Sheet Editor > Display Options —
 * `PANEL_PL_EDITOR_DISPLAY_OPTIONS`
 * (`pagelayout_editor/dialogs/panel_pl_editor_display_options.cpp`),
 * constructed by pl_editor itself for `PANEL_DS_DISPLAY_OPTIONS`
 * (`pagelayout_editor/pl_editor.cpp:68-69`).
 *
 * The whole panel is one embedded `PANEL_GAL_OPTIONS` in a left column:
 *
 *     m_galOptsPanel = new PANEL_GAL_OPTIONS( this, aAppSettings );
 *     bLeftCol->Add( m_galOptsPanel, 1, wxEXPAND|wxRIGHT, 15 );
 *     (panel_pl_editor_display_options.cpp:38-40)
 *
 * — no controls of its own, and `TransferDataToWindow` /
 * `TransferDataFromWindow` / `ResetPanel` each forward to it and return.
 * So this file is the same: the shared panel, over pl_editor's settings.
 *
 * That is why the Grid Display group appears here at all. #619's G12 counted
 * only the Cursor group we had; upstream's page opens with Style, Grid
 * thickness, Minimum grid spacing and Snap to grid above it.
 */
import type { JSX } from 'react';
import { PanelGalOptions } from '../../../dialogs/prefs/PanelGalOptions.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelPlEditorDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { plEditor, upPl } = ctx;
  return (
    <div className="ze-pref-columns">
      <div>
        <PanelGalOptions
          win={plEditor.window}
          update={(fn) => upPl((s) => fn(s.window))}
          idPrefix="ds"
        />
      </div>
    </div>
  );
}
