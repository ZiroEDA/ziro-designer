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
import { DialogPageSettings } from '@ziroeda/common/dialogs/dialog_page_settings.js';
import {
  COMMENT_COUNT,
  type PageExportFlags,
  type PageSettingsValue,
} from '@ziroeda/common/dialogs/dialog_page_settings.js';
import type { EdaUnits } from '@ziroeda/common/widgets/unit_binder.js';
import type { WksSheet } from '@ziroeda/common';

// The subclass's constructor / destructor pair. These were in the page
// settings model; DIALOG_EESCHEMA_PAGE_SETTINGS is the only code upstream that
// knows the export settings, so they are this file's.

/**
 * `DIALOG_EESCHEMA_PAGE_SETTINGS::onTransferDataToWindow`
 * (dialog_eeschema_page_settings.cpp:108-124).
 *
 * The ticks are a PREFERENCE, not one-shot dialog state — the destructor writes
 * them back into `EESCHEMA_SETTINGS::m_PageSettings` (:39-81) and this reads
 * them out again, so a project that wants its title carried onto every new
 * sheet says so once. Ours wrote them and never read them: the dialog opened
 * with all fourteen clear every time.
 *
 * ```cpp
 * m_PaperExport->SetValue( cfg->m_PageSettings.export_paper );
 * m_RevisionExport->SetValue( m_TextRevision->GetValue().IsEmpty()
 *                                 ? false : cfg->m_PageSettings.export_revision );
 * ```
 *
 * Note which one is NOT guarded: `m_PaperExport` takes the stored value
 * outright, because a page always has a size. The other thirteen are forced
 * back to false when the field they would copy is empty.
 */
export function pageExportsFromSettings(
  stored: PageExportFlags,
  value: PageSettingsValue,
): PageExportFlags {
  const ifSet = (text: string, flag: boolean): boolean => (text ? flag : false);
  return {
    paper: stored.paper,
    date: ifSet(value.date, stored.date),
    rev: ifSet(value.rev, stored.rev),
    title: ifSet(value.title, stored.title),
    company: ifSet(value.company, stored.company),
    comments: Array.from({ length: COMMENT_COUNT }, (_, i) =>
      ifSet(value.comments[i] ?? '', stored.comments[i] ?? false),
    ),
  };
}

/**
 * `DIALOG_EESCHEMA_PAGE_SETTINGS::~DIALOG_EESCHEMA_PAGE_SETTINGS`
 * (dialog_eeschema_page_settings.cpp:37-82) — the mirror of the rule above.
 *
 * ```cpp
 * cfg->m_PageSettings.export_paper = m_PaperExport->GetValue();
 *
 * if( !m_TextRevision->GetValue().IsEmpty() )
 *     cfg->m_PageSettings.export_revision = m_RevisionExport->GetValue();
 * ```
 *
 * The thirteen guarded ones are written back only when the field they copy is
 * non-empty, so leaving a field blank does not silently CLEAR a preference the
 * user set while it had text in it. Ours wrote all fourteen unconditionally,
 * which is how a tick set on a sheet with a title vanished on the next sheet
 * without one.
 */
export function pageExportsToSettings(
  stored: PageExportFlags,
  value: PageSettingsValue,
  ticked: PageExportFlags,
): PageExportFlags {
  const keep = (text: string, next: boolean, was: boolean): boolean => (text ? next : was);
  return {
    paper: ticked.paper,
    date: keep(value.date, ticked.date, stored.date),
    rev: keep(value.rev, ticked.rev, stored.rev),
    title: keep(value.title, ticked.title, stored.title),
    company: keep(value.company, ticked.company, stored.company),
    comments: Array.from({ length: COMMENT_COUNT }, (_, i) =>
      keep(value.comments[i] ?? '', ticked.comments[i] ?? false, stored.comments[i] ?? false),
    ),
  };
}

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
