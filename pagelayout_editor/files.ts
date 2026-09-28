// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Everything `PL_EDITOR_FRAME::Files_io` says, and where it says it
 * (pagelayout_editor/files.cpp).
 *
 * The frame is a `.tsx`, and `qa`'s tsconfig sets no `--jsx`, so a rule that
 * lives inside it cannot be exercised at all. These are the strings and the
 * one dispatch rule that a test can hold, kept away from React for that reason
 * — the same split `toggles.ts` and `ui_conditions.ts` already make.
 *
 * ## The status line belongs to the five file commands and to nothing else
 *
 * `SetStatusText` appears fourteen times in pl_editor and eleven of them name
 * a pane: the zoom, the two coordinate pairs, the grid, the units and the
 * coordinate origin (`pl_editor_frame.cpp:726-805`). The three that write pane
 * 0 — the message area — are all in `files.cpp`, and between them they cover
 * Open, Append, Save, Save As and Open Recent. **Nothing else in the program
 * writes there**: not placing an item, not a copy, not a resize, not opening
 * Page Preview Settings, and not New.
 *
 * Driven against the installed pl_editor (`qa/probes/pl_e2e`), so these are
 * transcriptions of what the running program showed, not a reading of the C++:
 *
 * | command | pane 0 afterwards |
 * |---|---|
 * | Open | `File '<path>' saved.` |
 * | Append | `File '<path>' inserted` |
 * | Save / Save As | `File '<path>' saved.` |
 * | Open Recent | `File '<path>' loaded` |
 * | New | *unchanged* |
 * | a load that failed | *unchanged*; the text goes to a modal |
 *
 * "saved" after an Open is upstream's own copy-paste (`files.cpp:179`), and it
 * is reproduced rather than corrected: a user who reads the two side by side
 * has to see the same sentence.
 *
 * The argument is the **full path the dialog returned**, not the leaf.
 *
 * Below the strings, the three `PL_EDITOR_FRAME` members files.cpp defines,
 * bound on the class. `Files_io`, `OnFileHistory` and `DoWithAcceptedFiles`
 * open file dialogs, which are the page's: they stay in the window.
 */

import { DRAWING_SHEET_FILE_EXTENSION } from '@ziroeda/common/common.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { WKS_FILE_VERSION } from '@ziroeda/common/drawing_sheet/types.js';
import type { PL_EDITOR_FRAME, PL_FILES_IO_ID } from './pl_editor_frame.js';

/** `_( "File '%s' loaded" )` — Open Recent only (files.cpp:82). */
export function dsFileLoadedMsg(path: string): string {
  return `File '${path}' loaded`;
}

/**
 * `_( "File '%s' saved." )` — Save (files.cpp:194), Save As (:229) **and Open**
 * (:179). Upstream really does report a save after an open.
 */
export function dsFileSavedMsg(path: string): string {
  return `File '${path}' saved.`;
}

/** `_( "File '%s' inserted" )` — Append (files.cpp:152). No full stop. */
export function dsFileInsertedMsg(path: string): string {
  return `File '${path}' inserted`;
}

/**
 * `_( "Unable to load %s file" )` — the modal `Files_io` raises when either
 * Open or Append comes back false (files.cpp:145, :173). The path is bare: no
 * quotes, and "file" trails it.
 */
export function dsUnableToLoadMsg(path: string): string {
  return `Unable to load ${path} file`;
}

/** `_( "Unable to write '%s'." )` — a failed Save (files.cpp:189). */
export function dsUnableToWriteMsg(path: string): string {
  return `Unable to write '${path}'.`;
}

/** `_( "Failed to create file '%s'." )` — a failed Save As (files.cpp:224). */
export function dsFailedToCreateMsg(path: string): string {
  return `Failed to create file '${path}'.`;
}

/**
 * `_( "Error loading drawing sheet '%s'." )` — raised by `LoadDrawingSheetFile`
 * itself, with the parser's message as the dialog's extended text
 * (files.cpp:253-256).
 *
 * A bad file therefore raises **two** modals in a row: this one from the
 * loader, then `dsUnableToLoadMsg` from `Files_io`'s `if( !… )`. Confirmed by
 * driving it: `qa/probes/pl_e2e/README.md`.
 */
export function dsErrorLoadingMsg(path: string): string {
  return `Error loading drawing sheet '${path}'.`;
}

/**
 * The infobar a file older than `SEXPR_WORKSHEET_FILE_VERSION` raises
 * (files.cpp:271-273), dismissed again by a successful save (:329-330).
 */
export const DS_OUTDATED_FORMAT_INFOBAR =
  'This file was created by an older version of KiCad. ' +
  'It will be converted to the new format when saved.';

/** `wxFileDialog( this, _( "Open Drawing Sheet" ), … )` (files.cpp:161). */
export const DS_OPEN_DIALOG_TITLE = 'Open Drawing Sheet';

/** `_( "Append Existing Drawing Sheet" )` (files.cpp:132). */
export const DS_APPEND_DIALOG_TITLE = 'Append Existing Drawing Sheet';

/** `_( "Save Drawing Sheet As" )` (files.cpp:203). */
export const DS_SAVE_AS_DIALOG_TITLE = 'Save Drawing Sheet As';

/**
 * `if( filename.IsEmpty() && id == wxID_SAVE ) id = wxID_SAVEAS;`
 * (files.cpp:105-106) — Save with no name is Save As.
 */
export function dsSaveBecomesSaveAs(currentFileName: string): boolean {
  return currentFileName === '';
}

/**
 * `if( ( id == wxID_NEW || id == wxID_OPEN ) && IsContentModified() )`
 * (files.cpp:108) — the unsaved-changes guard covers New and Open and
 * **not** Append, which adds to the sheet and destroys nothing.
 */
export function dsNeedsUnsavedGuard(command: 'new' | 'open' | 'append'): boolean {
  return command === 'new' || command === 'open';
}

// ---- the PL_EDITOR_FRAME members files.cpp defines --------------------------

/** `HandleUnsavedChanges`' question, New / Open / a history row (files.cpp:61-63, :107-108). */
export const DS_SAVE_CHANGES_QUESTION =
  'The current drawing sheet has been modified. Save changes?';

/**
 * `PL_EDITOR_FRAME::OnFileHistory( event )` (files.cpp:55-86), from the
 * point `GetFileFromHistory` has named the file.
 *
 * Note what it does after the load: `OnNewDrawingSheet()` runs whether or not
 * the load worked, and the status line is written only when it did.
 */
export async function OnFileHistory(self: PL_EDITOR_FRAME, aFileName: string): Promise<void> {
  const host = self.GetHost();
  const filename = aFileName;

  if (filename !== '' && host) {
    if (self.IsContentModified()) {
      if (
        !(await host.HandleUnsavedChanges(DS_SAVE_CHANGES_QUESTION, () =>
          self.saveCurrentPageLayout(),
        ))
      ) {
        return;
      }
    }

    // ::wxSetWorkingDirectory( ::wxPathOnly( filename ) ): a page has no cwd.

    if (self.LoadDrawingSheetFile(filename)) self.SetStatusText(dsFileLoadedMsg(filename));

    self.OnNewDrawingSheet();
  }
}

/** `PL_EDITOR_FRAME::Files_io( event )`: the file commands (files.cpp:98-238). */
export async function Files_io(self: PL_EDITOR_FRAME, aId: PL_FILES_IO_ID): Promise<void> {
  const host = self.GetHost();

  if (!host) return;

  let id = aId;
  let filename = self.GetCurrentFileName();
  const pglayout = DS_DATA_MODEL.GetTheInstance();

  if (dsSaveBecomesSaveAs(filename) && id === 'wxID_SAVE') id = 'wxID_SAVEAS';

  if ((id === 'wxID_NEW' || id === 'wxID_OPEN') && self.IsContentModified()) {
    if (
      !(await host.HandleUnsavedChanges(DS_SAVE_CHANGES_QUESTION, () =>
        self.saveCurrentPageLayout(),
      ))
    ) {
      return;
    }
  }

  switch (id) {
    case 'wxID_NEW':
      pglayout.AllowVoidList(true);
      self.SetCurrentFileName('');
      pglayout.ClearList();
      self.OnNewDrawingSheet();
      break;

    case 'ID_APPEND_DESCR_FILE': {
      const path = await host.OpenFileDialog(DS_APPEND_DIALOG_TITLE, 'append');

      if (path === null) return;

      filename = path;

      if (!self.InsertDrawingSheetFile(filename)) {
        host.DisplayErrorMessage(dsUnableToLoadMsg(filename));
      } else {
        self.GetScreen()!.SetContentModified();
        self.HardRedraw();
        self.SetStatusText(dsFileInsertedMsg(filename));
      }

      break;
    }

    case 'wxID_OPEN': {
      const path = await host.OpenFileDialog(DS_OPEN_DIALOG_TITLE, 'open');

      if (path === null) return;

      filename = path;

      if (!self.LoadDrawingSheetFile(filename)) {
        host.DisplayErrorMessage(dsUnableToLoadMsg(filename));
      } else {
        self.OnNewDrawingSheet();
        self.SetStatusText(dsFileSavedMsg(filename));
      }

      break;
    }

    case 'wxID_SAVE':
      if (!self.SaveDrawingSheetFile(filename)) {
        host.DisplayErrorMessage(dsUnableToWriteMsg(filename));
      } else {
        self.SetStatusText(dsFileSavedMsg(filename));
      }

      break;

    case 'wxID_SAVEAS': {
      // PATHS::GetUserTemplatesPath(): the account's Templates folder.
      const path = await host.SaveFileDialog(DS_SAVE_AS_DIALOG_TITLE, DS_USER_TEMPLATES_PATH);

      if (path === null) return;

      filename = path;

      // Ensure the file has the right extension:
      // because a name like name.subname.subsubname is legal,
      // add the right extension without replacing the wxFileName
      // extension
      if (fileNameGetExt(filename) !== DRAWING_SHEET_FILE_EXTENSION)
        filename += `.${DRAWING_SHEET_FILE_EXTENSION}`;

      if (!self.SaveDrawingSheetFile(filename)) {
        host.DisplayErrorMessage(dsFailedToCreateMsg(filename));
      } else {
        self.SetStatusText(dsFileSavedMsg(filename));

        self.SetCurrentFileName(filename);
        self.UpdateTitleAndInfo();
      }

      break;
    }

    default:
      break;
  }
}

/**
 * `PATHS::GetUserTemplatesPath()`: where Save As opens. The account's file
 * tree has one templates folder, `/Templates`. [data]
 */
export const DS_USER_TEMPLATES_PATH = '/Templates';

/** `wxFileName( aPath ).GetExt()`: after the last dot of the leaf, or empty. */
function fileNameGetExt(aPath: string): string {
  const leaf = aPath.slice(aPath.lastIndexOf('/') + 1);
  const dot = leaf.lastIndexOf('.');

  return dot > 0 ? leaf.slice(dot + 1) : '';
}

/**
 * `PL_EDITOR_FRAME::LoadDrawingSheetFile( aFullFileName )`.
 *
 * `wxFileExists` and the read are the host's `ReadFile`; the read-only
 * infobar (`!fn.IsFileWritable()`) is n/a, a page cannot see permissions.
 */
export function LoadDrawingSheetFile(self: PL_EDITOR_FRAME, aFullFileName: string): boolean {
  const host = self.GetHost();
  const contents = host ? host.ReadFile(aFullFileName) : null;

  if (host && contents !== null) {
    const msg = { value: '' };

    if (!DS_DATA_MODEL.GetTheInstance().LoadDrawingSheet(aFullFileName, msg, false, contents)) {
      host.DisplayErrorMessage(dsErrorLoadingMsg(aFullFileName), msg.value);
      return false;
    }

    self.SetCurrentFileName(aFullFileName);
    host.UpdateFileHistory(aFullFileName);
    self.GetScreen()!.SetContentModified(false);

    host.ShowOutdatedSaveInfoBar(false);

    if (DS_DATA_MODEL.GetTheInstance().GetFileFormatVersionAtLoad() < WKS_FILE_VERSION)
      host.ShowOutdatedSaveInfoBar(true);

    return true;
  }

  return false;
}

/** `PL_EDITOR_FRAME::InsertDrawingSheetFile( aFullFileName )`. */
export function InsertDrawingSheetFile(self: PL_EDITOR_FRAME, aFullFileName: string): boolean {
  const host = self.GetHost();
  const contents = host ? host.ReadFile(aFullFileName) : null;

  if (contents !== null) {
    const append = true;
    self.SaveCopyInUndoList();
    DS_DATA_MODEL.GetTheInstance().LoadDrawingSheet(aFullFileName, null, append, contents);
    return true;
  }

  return false;
}

/**
 * `PL_EDITOR_FRAME::SaveDrawingSheetFile( aFullFileName )`: the model's
 * text through the host's `WriteFile`, which stands for the temp file and
 * the rename.
 */
export function SaveDrawingSheetFile(self: PL_EDITOR_FRAME, aFullFileName: string): boolean {
  const host = self.GetHost();

  if (aFullFileName !== '' && host) {
    const text = DS_DATA_MODEL.GetTheInstance().Save(aFullFileName);

    if (!host.WriteFile(aFullFileName, text)) return false;

    host.ShowOutdatedSaveInfoBar(false);

    self.GetScreen()!.SetContentModified(false);
    self.UpdateTitleAndInfo();
    return true;
  }

  return false;
}
