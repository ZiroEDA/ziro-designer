// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Open dialog every editor opens — the same widget as {@link SaveAsDialog},
 * in `wxFD_OPEN` mode.
 *
 * Upstream every `Open` is a `wxFileDialog` on the project's directory,
 * filtered by that document's wildcard — pl_editor's
 * (`pagelayout_editor/files.cpp:159-167`), eeschema's, pcbnew's. The dialog is
 * shared and only the wildcard differs.
 *
 * Ours reached for a hidden `<input type="file">`, which is the operating
 * system's file manager and knows nothing about the account's projects: a
 * cloud document could not be opened from inside an editor at all, only
 * re-downloaded and picked off the local disk. `accept` on that input also
 * flattens KiCad's named wildcards into a single unlabelled group, which is
 * the same reason `open_file_dialog.ts` exists.
 *
 * The local disk is still reachable — {@link ChooserPlace} carries its own
 * `FileSystem`, so a caller that wants "this computer" adds it as a place —
 * but it is no longer the ONLY thing Open can see.
 */

import type { JSX } from 'react';
import { useMemo } from 'react';
import { FileChooser } from './FileChooser.js';
import { projectStoreFileSystem } from './project_store_fs.js';
import type { ChooserFilter } from './chooser_types.js';

export interface OpenFileDialogProps {
  /** The document's wildcard, e.g. `drawingSheetWildcard()`. */
  filters?: readonly ChooserFilter[];
  /** Where to open. Defaults to the account root. */
  initialPath?: string;
  /**
   * The chosen file's text, or `null` for `wxID_CANCEL`. The read happens here
   * so every caller does not repeat it; `path` is the full path the chooser
   * gave back, whose leaf is the document's name.
   */
  onDone: (file: { path: string; text: string } | null) => void;
  /** `wxFileDialog`'s title. */
  title?: string;
  /** The affirmative button. `Open` unless the caller is appending. */
  accept?: string;
}

export function OpenFileDialog({
  filters,
  initialPath,
  onDone,
  title = 'Open',
  accept = 'Open',
}: OpenFileDialogProps): JSX.Element {
  // One filesystem per mount — see SaveAsDialog.
  const fs = useMemo(() => projectStoreFileSystem(), []);
  return (
    <FileChooser
      fs={fs}
      mode="open"
      title={title}
      accept={accept}
      {...(initialPath === undefined ? {} : { initialPath })}
      {...(filters === undefined ? {} : { filters })}
      onAccept={(path) => {
        void (async () => {
          try {
            const bytes = await fs.read(path);
            onDone({ path, text: new TextDecoder().decode(bytes) });
          } catch {
            // A read that fails is not an open: upstream's wxFileDialog hands
            // back a path and the frame's loader reports its own error, so the
            // caller sees a cancel rather than a half-open document.
            onDone(null);
          }
        })();
      }}
      onCancel={() => onDone(null)}
    />
  );
}
