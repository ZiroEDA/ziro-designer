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
import { type AssetKind, chooserPlacesFor } from './chooser_places.js';
import type { ChooserFilter } from './chooser_types.js';
import type { FileSystem } from './filesystem.js';

/** One file the dialog hands back, with the batch it came in. */
export interface OpenedFile {
  path: string;
  text: string;
  bytes: Uint8Array;
  /** The rest of a multiple selection; empty for every single-select caller. */
  rest: readonly { path: string; text: string; bytes: Uint8Array }[];
}

export interface OpenFileDialogProps {
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
   * The chosen file's text, or `null` for `wxID_CANCEL`. The read happens here
   * so every caller does not repeat it; `path` is the full path the chooser
   * gave back, whose leaf is the document's name.
   */
  onDone: (file: OpenedFile | null) => void;
  /**
   * `wxFD_MULTIPLE` — the user may take several files at once, and `onDone`
   * then reports the batch through {@link OpenedFile.rest}.
   *
   * GerbView's Open is the one that needs it: a board's plot is a folder of
   * layers (gerbview/files.cpp:151-152).
   */
  multiple?: boolean;
  /** Rendered beside the buttons — where "Open from Computer..." goes. */
  extra?: JSX.Element;
  /** `wxFileDialog`'s title. */
  title?: string;
  /** The affirmative button. `Open` unless the caller is appending. */
  accept?: string;
}

export function OpenFileDialog({
  filters,
  initialPath,
  kind,
  multiple = false,
  extra,
  onDone,
  title = 'Open',
  accept = 'Open',
}: OpenFileDialogProps): JSX.Element {
  // One filesystem per mount — see SaveAsDialog.
  const fs = useMemo(() => projectStoreFileSystem(), []);

  /**
   * Read the chosen file and hand it back, through the tree it came from.
   *
   * This used to read through the account's own filesystem whatever place the
   * path came from, so a file taken out of Templates or Demos threw NOT_FOUND
   * and came back as `onDone(null)` — indistinguishable from Cancel. That is
   * the whole of why a drawing sheet saved into the templates root could not
   * then be opened from the Drawing Sheet Editor: pl_editor's Open is a
   * `wxFileDialog` over one tree upstream (pagelayout_editor/files.cpp:159-167),
   * and splitting that one tree into places is ours — so re-joining them at the
   * read is ours to do too.
   */
  const readAndDone = (from: FileSystem, path: string, rest: readonly string[] = []): void => {
    void (async () => {
      try {
        const bytes = await from.read(path);
        // Bytes AND text. A gerber or a schematic is read as text; a `.zip` is
        // not text at all and its reader wants the raw buffer (GerbView's Open
        // Zip File is its own dialog upstream, gerbview/files.cpp:661). Decoding
        // is cheap next to the read, and handing back only one of the two is
        // what made this dialog unusable for the binary callers.
        const others = await Promise.all(
          rest.map(async (p) => {
            const b = await from.read(p);
            return { path: p, text: new TextDecoder().decode(b), bytes: b };
          }),
        );
        onDone({ path, text: new TextDecoder().decode(bytes), bytes, rest: others });
      } catch {
        // A read that fails is not an open: upstream's wxFileDialog hands
        // back a path and the frame's loader reports its own error, so the
        // caller sees a cancel rather than a half-open document.
        onDone(null);
      }
    })();
  };

  // GTK gives every wxFileDialog in the process the same
  // GtkPlacesSidebar; ours had one only in the project manager, so an
  // editor's dialog opened with no sidebar at all.
  const places = useMemo(
    () =>
      // Every place is a folder of the account's own tree now, so one read
      // serves all of them. Opening is not gated: `mode: 'open'` lists every
      // project, with or without one open.
      chooserPlacesFor({ mode: 'open', ...(kind === undefined ? {} : { kind }) }),
    [kind],
  );
  return (
    <FileChooser
      fs={fs}
      mode="open"
      title={title}
      accept={accept}
      places={places}
      {...(initialPath === undefined ? {} : { initialPath })}
      {...(filters === undefined ? {} : { filters })}
      multiple={multiple}
      {...(extra === undefined ? {} : { extra })}
      onAccept={(path, rest) => readAndDone(fs, path, rest)}
      onCancel={() => onDone(null)}
    />
  );
}
