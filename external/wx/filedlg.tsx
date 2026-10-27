// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxFileDialog`, as KiCad's dialogs call it.
 *
 * KiCad does not own its file dialog: wxWidgets does, and every dialog in
 * `common/dialogs` simply constructs one. Ours is the app's chooser
 * (`designer/src/fs/OpenFileDialog.tsx`), which reads the account's file tree
 * and so cannot live in `common/`. The app installs it here at startup
 * (`SetFileDialog`), the way it installs the program object (`SetPgm`), and a
 * common dialog renders `<WxFileDialog>` without knowing whose it is.
 *
 * `WxFileDialog`, not `wxFileDialog`: a JSX tag in lower case is an HTML
 * element.
 */
import type { JSX } from 'react';
import { MEMORY_FILESYSTEM, wxFileExists, wxMountFileSystem } from './filefn.js';

/** One wildcard of the type combo: `KiCad project files (*.kicad_pro)`. */
export interface ChooserFilter {
  /** The whole string the combo shows. */
  readonly label: string;
  /** Lowercase extensions without the dot. Empty means everything. */
  readonly extensions: readonly string[];
}

/** One file the dialog hands back, with the batch it came in. */
export interface OpenedFile {
  path: string;
  text: string;
  bytes: Uint8Array;
  /** The rest of a multiple selection; empty for every single-select caller. */
  rest: readonly { path: string; text: string; bytes: Uint8Array }[];
}

export interface WxFileDialogProps {
  /** The document's wildcards (`FILEEXT::DrawingSheetFileWildcard()`, ...). */
  filters?: readonly ChooserFilter[];
  /** Where to open. Defaults to the account root. */
  initialPath?: string;
  /**
   * Which shared folder this document kind belongs in (`templates` for a
   * drawing sheet). The app's chooser knows the set; omitted, it offers
   * projects only.
   */
  kind?: string;
  /** The open project's folder, e.g. `/MyBoard`. */
  projectDir?: string | null;
  /** The chosen file, or `null` for `wxID_CANCEL`. */
  onDone: (file: OpenedFile | null) => void;
  /** `wxFD_MULTIPLE`. */
  multiple?: boolean;
  /** Rendered beside the buttons. */
  extra?: JSX.Element;
  /** The dialog's title. */
  title?: string;
  /** The affirmative button; `Open` unless the caller is appending. */
  accept?: string;
}

let s_fileDialog: ((props: WxFileDialogProps) => JSX.Element) | null = null;

/** The app installs its chooser. */
export function SetFileDialog(aImpl: ((props: WxFileDialogProps) => JSX.Element) | null): void {
  s_fileDialog = aImpl;
}

export function WxFileDialog(props: WxFileDialogProps): JSX.Element {
  if (!s_fileDialog) throw new Error('wxFileDialog used before the app installed one');
  const Impl = s_fileDialog;
  return <Impl {...props} />;
}

/**
 * `wxFileDialog( …, wxFD_SAVE | wxFD_OVERWRITE_PROMPT )`: a path to write, named in the app's save
 * chooser - which asks before replacing a file that is there, and hands back the path only.
 */
export interface WxSaveFileDialogProps {
  title: string;
  /** `aDefaultFile`: the name the entry starts with. */
  initialName: string;
  filters?: readonly ChooserFilter[];
  /** `aDefaultDir`, when the caller names one. */
  initialPath?: string;
  /** Which shared folder this document kind belongs in (`symbols` for a symbol library). */
  kind?: string;
  /** The places row to open on when no directory is named: the kind's own folder. */
  initialPlace?: string;
  /** The open project's folder, e.g. `/MyBoard`. */
  projectDir?: string | null;
  /** `wxFileDialogCustomizeHook::AddCustomControls`: the controls under the chooser. */
  extra?: JSX.Element;
  /** The chosen path, or `null` for `wxID_CANCEL`. */
  onDone: (path: string | null) => void;
}

let s_saveFileDialog: ((props: WxSaveFileDialogProps) => JSX.Element) | null = null;

/** The app installs its save chooser. */
export function SetSaveFileDialog(
  aImpl: ((props: WxSaveFileDialogProps) => JSX.Element) | null,
): void {
  s_saveFileDialog = aImpl;
}

export function WxSaveFileDialog(props: WxSaveFileDialogProps): JSX.Element {
  if (!s_saveFileDialog)
    throw new Error('wxFileDialog(wxFD_SAVE) used before the app installed one');
  const Impl = s_saveFileDialog;
  return <Impl {...props} />;
}

/** Where a file the picker hands back is readable when no mount holds its path. */
const PICKED_FILES_DIR = '/.picked-files';
let s_pickedFiles: MEMORY_FILESYSTEM | null = null;

/**
 * `wxFileDialog::GetPath()` for a file the picker returned: its own path when a mounted file
 * system already has it (a project file), else its bytes written to the picked-files folder, so
 * KiCad's file reads open it.
 */
export function wxFileDialogGetPath(aFile: OpenedFile): string {
  if (wxFileExists(aFile.path)) return aFile.path;
  if (!s_pickedFiles) {
    s_pickedFiles = new MEMORY_FILESYSTEM();
    wxMountFileSystem(PICKED_FILES_DIR, s_pickedFiles);
  }
  const name = aFile.path.replace(/^.*\//, '');
  s_pickedFiles.Write(name, aFile.bytes);
  return `${PICKED_FILES_DIR}/${name}`;
}

/**
 * A file off the computer, for `wxFileDialog( …, wxFD_OPEN )` where the file is the user's and
 * not the account's: the browser's own file `<input>`, limited to \a aFilters' extensions. Its
 * name and text, or null for `wxID_CANCEL`. The sibling of dirdlg.tsx's `ChooseLocalFolder`.
 */
export function ChooseLocalFile(
  aFilters: readonly ChooserFilter[],
): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // An empty extension list is "All files": no accept.
    if (aFilters.every((f) => f.extensions.length > 0))
      input.accept = [...new Set(aFilters.flatMap((f) => f.extensions.map((e) => `.${e}`)))].join(
        ',',
      );
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];

      if (!file) {
        resolve(null);
        return;
      }

      void file.text().then((text) => resolve({ name: file.name, text }));
    });
    input.click();
  });
}
