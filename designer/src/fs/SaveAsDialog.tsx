// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Save As dialog every editor opens — one widget, over the project store.
 *
 * Upstream every `Save As` is a `wxFileDialog` with `wxFD_SAVE |
 * wxFD_OVERWRITE_PROMPT` on the project's own directory: pl_editor's
 * (`pagelayout_editor/files.cpp`), eeschema's, pcbnew's, all of them. The
 * dialog is shared and only the wildcard and the default name differ.
 *
 * Ours had `FileChooser` — a full port of that dialog, save mode included —
 * used by the project manager alone, while every editor fell back to
 * `window.prompt`. A prompt cannot show the project tree, cannot filter by
 * extension, cannot warn about an overwrite, and gives back a bare string
 * rather than a path, so nothing an editor saved could land anywhere but the
 * root. This is the shared call site that fixes all of that at once.
 *
 * `wxFD_OVERWRITE_PROMPT` is `FileChooser`'s own: it asks before replacing a
 * file that exists, so there is nothing to add here.
 */

import type { JSX } from 'react';
import { useMemo } from 'react';
import { FileChooser } from './FileChooser.js';
import { projectStoreFileSystem } from './project_store_fs.js';
import type { ChooserFilter } from './chooser_types.js';

export interface SaveAsDialogProps {
  /** The name the entry starts with — upstream's `wxFileDialog` default name. */
  initialName: string;
  /** The document's wildcard, e.g. `drawingSheetWildcard()`. */
  filters?: readonly ChooserFilter[];
  /** Where to open. Defaults to the account root. */
  initialPath?: string;
  /**
   * The chosen path, project folder included. `null` when cancelled, which is
   * `wxID_CANCEL` — the caller must not save.
   */
  onDone: (path: string | null) => void;
  /** The affirmative button. `Save` unless the caller is exporting. */
  accept?: string;
  title?: string;
}

export function SaveAsDialog({
  initialName,
  filters,
  initialPath,
  onDone,
  accept = 'Save',
  title = 'Save As',
}: SaveAsDialogProps): JSX.Element {
  // One filesystem per mount: `projectStoreFileSystem` reads the store on each
  // call, so rebuilding it every render would re-list the account on every
  // keystroke in the Name entry.
  const fs = useMemo(() => projectStoreFileSystem(), []);
  return (
    <FileChooser
      fs={fs}
      mode="save"
      title={title}
      accept={accept}
      initialName={initialName}
      {...(initialPath === undefined ? {} : { initialPath })}
      {...(filters === undefined ? {} : { filters })}
      onAccept={(path) => onDone(path)}
      onCancel={() => onDone(null)}
    />
  );
}
