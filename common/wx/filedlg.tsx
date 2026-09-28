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
