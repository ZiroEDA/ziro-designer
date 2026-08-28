// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Drawing Sheet Editor > Grids — `PANEL_GRID_SETTINGS`, the
 * shared panel, constructed with `FRAME_PL_EDITOR`:
 *
 *     case PANEL_DS_GRIDS:
 *         return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_PL_EDITOR );
 *     (pagelayout_editor/pl_editor.cpp:71-79)
 *
 * The frame type is the whole of what pl_editor contributes: it decides that
 * the Grid Overrides group here shows Text and Graphics and not the connected,
 * wires or vias rows (`common/dialogs/panel_grid_settings.cpp:62-82`).
 *
 * This is also the page `ACTIONS::gridProperties` opens — `COMMON_TOOLS::
 * GridProperties` for `FRAME_PL_EDITOR` is nothing but
 * `ShowPreferences( _( "Grids" ), _( "Drawing Sheet Editor" ) )`
 * (`common/tool/common_tools.cpp:609-634`).
 */
import type { JSX } from 'react';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { DEFAULT_GRID_INDEX, GRID_SIZE_LIST } from '../../../ui/grid_settings.js';

/**
 * What an added row starts at. Upstream `OnAddGrid` opens
 * `DIALOG_GRID_SETTINGS` on an empty grid; with that dialog not ported, the row
 * starts on this editor's own default grid rather than on a literal — the same
 * table `PL_EDITOR_DEFAULTS` seeds the list from.
 */
const NEW_GRID_SIZE =
  GRID_SIZE_LIST.pl_editor[DEFAULT_GRID_INDEX.pl_editor]?.x ?? GRID_SIZE_LIST.pl_editor[0]!.x;

export function PanelPlEditorGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { plEditor, upPl } = ctx;
  return (
    <PanelGridSettings
      grid={plEditor.window.grid}
      update={(fn) => upPl((s) => fn(s.window.grid))}
      frameType="FRAME_PL_EDITOR"
      newGridSize={NEW_GRID_SIZE}
      idPrefix="ds"
    />
  );
}
