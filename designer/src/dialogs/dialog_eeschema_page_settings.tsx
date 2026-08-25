// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EESCHEMA_PAGE_SETTINGS` —
 * `eeschema/dialogs/dialog_eeschema_page_settings.cpp`.
 *
 * The ONE subclass of `DIALOG_PAGES_SETTINGS`, and the reason the shared
 * dialog is not just "the same dialog with a boolean". The base class ships
 * WITHOUT the export checkboxes and the two sheet tallies — it hides all
 * sixteen in `TransferDataToWindow`, under its own comment "The default is to
 * disable aall these fields for the *generic* dialog"
 * (`common/dialogs/dialog_page_settings.cpp:169-185`) — and this subclass turns
 * them back on and takes ownership of everything that then has to happen:
 *
 *   - `onTransferDataToWindow` (:85-125) `Show( true )`s the sixteen, fills the
 *     two tallies from `m_screen`, and seeds each checkbox from
 *     `EESCHEMA_SETTINGS::m_PageSettings`;
 *   - the destructor (:37-82) writes each checkbox back into that same settings
 *     object, so the ticks survive the dialog;
 *   - `onSavePageSettings` (:128-190) walks `SCH_SCREENS` and copies each
 *     ticked field into every other sheet.
 *
 * pcbnew does none of that: `BOARD_EDITOR_CONTROL::PageSettings` constructs the
 * BASE class directly (`pcbnew/tools/board_editor_control.cpp:530-532`), as does
 * pl_editor (`pagelayout_editor/tools/pl_editor_control.cpp:94-98`). So the
 * checkbox column and the tallies are eeschema's alone, and this file is where
 * they and their round-trip live — not in the shared component, and not spread
 * through the editor.
 *
 * The cross-sheet propagation (`onSavePageSettings`) stays in `SchematicEditor`
 * with the rest of the multi-document machinery, because it needs the project's
 * open documents and their undo histories; what is here is the pair of settings
 * transforms, which is what the constructor/destructor pair actually is.
 */

import type { JSX } from 'react';
import { DialogPageSettings } from './dialog_page_settings.js';
import {
  pageExportsFromSettings,
  pageExportsToSettings,
  type PageExportFlags,
  type PageSettingsValue,
} from './page_settings_model.js';
import type { EdaUnits } from '../ui/unit_binder.js';
import type { WksSheet } from '@ziroeda/common';

export interface DialogEeschemaPageSettingsProps {
  value: PageSettingsValue;
  /** The schematic frame's unit — a fresh eeschema is in MILS. */
  units: EdaUnits;
  /** `m_screen->GetPageCount()` / `GetVirtualPageNumber()` (:105-106). */
  sheetCount: number;
  sheetNumber: number;
  /** `BASE_SCREEN::m_DrawingSheetFileName` (sch_editor_control.cpp:513). */
  wksFileName: string;
  sheet: WksSheet | null;
  projectDir: string | null;
  /** `cfg->m_PageSettings` as it stands. */
  stored: PageExportFlags;
  /**
   * The destructor's write-back. It is handed the flags to STORE, already
   * through the empty-field guard, so the caller only has to save them.
   */
  onStoreExports: (next: PageExportFlags) => void;
  onOk: (
    next: PageSettingsValue,
    exports: PageExportFlags,
    drawingSheet: WksSheet | null,
    drawingSheetName: string,
  ) => void;
  onCancel: () => void;
}

export function DialogEeschemaPageSettings({
  value,
  units,
  sheetCount,
  sheetNumber,
  wksFileName,
  sheet,
  projectDir,
  stored,
  onStoreExports,
  onOk,
  onCancel,
}: DialogEeschemaPageSettingsProps): JSX.Element {
  return (
    <DialogPageSettings
      frame="eeschema"
      value={value}
      units={units}
      sheetCount={sheetCount}
      sheetNumber={sheetNumber}
      wksFileName={wksFileName}
      sheet={sheet}
      projectDir={projectDir}
      // onTransferDataToWindow (:111-124): each box comes back the way it was
      // left, except that a box whose field is EMPTY comes back clear.
      exports={pageExportsFromSettings(stored, value)}
      onOk={(next, exports, drawingSheet, drawingSheetName) => {
        // The destructor (:42-81). It runs on the way out and writes each box
        // back — but twelve of the fourteen only `if( !…GetValue().IsEmpty() )`,
        // so a blank field leaves the stored preference alone rather than
        // clearing it.
        onStoreExports(pageExportsToSettings(stored, next, exports));
        onOk(next, exports, drawingSheet, drawingSheetName);
      }}
      onCancel={onCancel}
    />
  );
}
