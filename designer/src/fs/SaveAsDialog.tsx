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
 * `wxFD_OVERWRITE_PROMPT` is `FileChooser`'s, and for a while this comment
 * claimed it already worked. It did not — `acceptNow` accepted the path with no
 * existence check at all, so a Save As over an existing file replaced it
 * silently. The comment was the only thing standing where the feature should
 * have been. It is implemented now; see `confirmOverwrite` there.
 */

import type { JSX } from 'react';
import { useMemo } from 'react';
import { FileChooser } from './FileChooser.js';
import { projectStoreFileSystem } from './project_store_fs.js';
import { type AssetKind, chooserPlacesFor } from './chooser_places.js';
import type { ChooserFilter } from './chooser_types.js';

export interface SaveAsDialogProps {
  /** The name the entry starts with — upstream's `wxFileDialog` default name. */
  initialName: string;
  /** The document's wildcard, e.g. `drawingSheetWildcard()`. */
  filters?: readonly ChooserFilter[];
  /** Where to open. Defaults to the account root. */
  initialPath?: string;
  /**
   * Which shared folder this document kind belongs in — Templates for a drawing
   * sheet, Symbols for a symbol library. Omitted, the dialog offers projects
   * only.
   */
  kind?: AssetKind;
  /** The open project's folder, e.g. `/MyBoard`. */
  projectDir?: string | null;
  /**
   * Which places row to start on — upstream's `wxFileDialog` `defaultDir`.
   *
   * Every Save As names one: pl_editor's is `PATHS::GetUserTemplatesPath()`
   * (pagelayout_editor/files.cpp:199). Without it the chooser opens on the
   * first row, which is Recent, and a Save As that opens on a list of things
   * you have opened is a row you cannot save into.
   */
  initialPlace?: string;
  /**
   * The chosen path, project folder included. `null` when cancelled, which is
   * `wxID_CANCEL` — the caller must not save.
   */
  onDone: (path: string | null, placeId?: string) => void;
  /** The affirmative button. `Save` unless the caller is exporting. */
  accept?: string;
  title?: string;
}

export function SaveAsDialog({
  initialName,
  filters,
  initialPath,
  kind,
  projectDir,
  onDone,
  accept = 'Save',
  title = 'Save As',
}: SaveAsDialogProps): JSX.Element {
  // One filesystem per mount: `projectStoreFileSystem` reads the store on each
  // call, so rebuilding it every render would re-list the account on every
  // keystroke in the Name entry.
  const fs = useMemo(() => projectStoreFileSystem(), []);
  // GTK gives every wxFileDialog in the process the same
  // GtkPlacesSidebar; ours had one only in the project manager, so an
  // editor's dialog opened with no sidebar at all.
  const places = useMemo(
    () =>
      // Every place here is a folder of the account's own tree, so a path from
      // any of them reads the same way and the chooser's own accept is right
      // for all of them.
      chooserPlacesFor({
        mode: 'save',
        ...(kind === undefined ? {} : { kind }),
        ...(projectDir === undefined ? {} : { projectDir }),
      }),
    [kind, projectDir],
  );
  return (
    <FileChooser
      fs={fs}
      mode="save"
      title={title}
      accept={accept}
      places={places}
      initialName={initialName}
      {...(initialPath === undefined ? {} : { initialPath })}
      {...(filters === undefined ? {} : { filters })}
      onAccept={(path) => onDone(path)}
      onCancel={() => onDone(null)}
    />
  );
}
