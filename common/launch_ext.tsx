// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LaunchExternal` (common/launch_ext.cpp), as far as a page can do it: a page
 * cannot start the desktop's file manager, so the one folder KiCad launches it
 * on from a dialog - the colour themes folder - is shown here instead.
 *
 * "Open Theme Folder" — `m_btnOpenFolder`
 * (`common/dialogs/panel_color_settings_base.cpp:43`), whose handler is two
 * lines:
 *
 *     wxString dir( SETTINGS_MANAGER::GetColorSettingsPath() );
 *     LaunchExternal( dir );
 *     (`common/dialogs/panel_color_settings.cpp:65-69`)
 *
 * The button opens a folder, and a page can do that: the desktop's folder
 * chooser is the File System Access API, which this app already opens a project
 * with. Point it at `~/.config/kicad/10.0/colors` and this IS KiCad's theme
 * folder — its files listed, loaded, and written back.
 *
 * What a page cannot do is start the file MANAGER, so the folder's contents are
 * shown here instead of in Files or Nautilus. The two operations are the ones
 * that folder is opened for: a theme goes out of the app into it, and one of
 * its files comes back in.
 *
 * When the browser has no picker, or refuses the folder — Chrome blocks
 * "system" locations, the profile root, Desktop, Documents and Downloads — the
 * dialog falls back to a download and an upload, which need no permission.
 * That fallback is not a lesser mode by accident: it is the only one Firefox
 * and Safari can offer.
 *
 * Import can only land in the writable theme, for the same reason the override
 * checkbox is dead on the others: `IsReadOnly()`. Upstream a file in the folder
 * is a theme of its own, which needs a per-theme store this app does not have,
 * so its colours load into "User" rather than inventing a theme id.
 */
import { useRef, useState, type JSX } from 'react';
import {
  colorThemeFileText,
  colorThemeFromFile,
  type ColorThemeContents,
} from './settings/color_theme_file.js';
import { useModalEscape } from './dialog_shim.js';
import { OK_LABEL } from './confirm_types.js';

// ---------------------------------------------------------------------------
// The folder's I/O: what was designer/src/fs/theme_folder.ts (09-26). It is
// the half of LaunchExternal( GetColorSettingsPath() ) a page can do - pick the
// folder with the File System Access API, list its themes, write one back.

/** The half of `FileSystemDirectoryHandle` this uses. */
export interface ThemeDirHandle {
  name: string;
  values: () => AsyncIterable<ThemeFsEntry>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<ThemeFileHandle>;
}
export interface ThemeFsEntry {
  kind: string;
  name: string;
  getFile: () => Promise<File>;
}
export interface ThemeFileHandle {
  createWritable: () => Promise<ThemeWritable>;
}
export interface ThemeWritable {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

/** The user closed the chooser. Nothing to do — same as `AbortError` upstream. */
export const PICK_CANCELLED = 'cancelled';
/** No API, or the browser refused this folder. The caller offers files instead. */
export const PICK_BLOCKED = 'blocked';

export type PickedFolder = ThemeDirHandle | typeof PICK_CANCELLED | typeof PICK_BLOCKED;

type Picker = (options?: { mode?: string; id?: string }) => Promise<ThemeDirHandle>;

/**
 * Open the desktop's folder chooser.
 *
 * `mode: 'readwrite'` asks for write permission in the same gesture, because
 * the point of the folder is that a theme goes back into it; asking again on
 * the first save would put a second prompt between the user and a button they
 * already pressed. `id` makes Chrome reopen the chooser where it was last left,
 * which is what a folder you return to should do.
 */
export async function pickThemeFolder(): Promise<PickedFolder> {
  const picker = (globalThis as { showDirectoryPicker?: Picker }).showDirectoryPicker;
  if (!picker) return PICK_BLOCKED;
  try {
    return await picker({ mode: 'readwrite', id: 'kicad-color-themes' });
  } catch (e) {
    // AbortError is the user closing the dialog; a blocked folder, a
    // SecurityError or an unsupported call is not, and gets the fallback.
    return (e as DOMException)?.name === 'AbortError' ? PICK_CANCELLED : PICK_BLOCKED;
  }
}

/** One `.json` in the folder that parses as a colour theme. */
export interface FolderTheme {
  fileName: string;
  contents: ColorThemeContents;
}

/**
 * Every colour theme in the folder, in the order the platform lists it.
 *
 * A `.json` that is not a theme is skipped rather than reported: KiCad's own
 * folder is not guaranteed to hold only themes, and a listing that refused to
 * open because of a stray file would be worse than one that leaves it out.
 * Subfolders are not walked — `GetColorSettingsPath()` is one flat directory.
 */
export async function readThemeFolder(dir: ThemeDirHandle): Promise<FolderTheme[]> {
  const out: FolderTheme[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await (await entry.getFile()).text());
    } catch {
      continue;
    }
    const contents = colorThemeFromFile(parsed);
    if (contents) out.push({ fileName: entry.name, contents });
  }
  return out;
}

/** Write one theme file into the folder, creating it if it is not there. */
export async function writeThemeFile(
  dir: ThemeDirHandle,
  fileName: string,
  text: string,
): Promise<void> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/** A theme this app holds, which can be written into the folder. */
export interface ThemeFile {
  /** The file name a real KiCad folder would give it, e.g. `user.json`. */
  fileName: string;
  /** `meta.name`. */
  name: string;
  contents: ColorThemeContents;
  /** False for a built-in or a PCM-installed theme — `IsReadOnly()`. */
  writable: boolean;
}

/** A theme file found in the folder the user picked. */
export interface FolderFile {
  fileName: string;
  contents: ColorThemeContents;
}

/** A download, for when there is no folder to write into. */
function saveFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ThemeFolderDialog({
  files,
  folderName,
  folderFiles = [],
  onWriteToFolder,
  onImport,
  onClose,
}: {
  /** The themes this app holds. */
  files: readonly ThemeFile[];
  /** The picked folder's own name, absent when there is no folder. */
  folderName?: string;
  /** The theme files in it. */
  folderFiles?: readonly FolderFile[];
  /** Write one of `files` into the folder. Absent = no folder, so download. */
  onWriteToFolder?: (fileName: string, text: string) => Promise<string>;
  onImport: (contents: ColorThemeContents) => void;
  onClose: () => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useModalEscape(onClose);

  const readPicked = async (file: File): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError(`${file.name} is not a JSON file.`);
      return;
    }
    const contents = colorThemeFromFile(parsed);
    if (!contents) {
      setError(`${file.name} has no "schematic" or "board" section, so it is not a color theme.`);
      return;
    }
    setError('');
    onImport(contents);
    onClose();
  };

  const put = async (f: ThemeFile): Promise<void> => {
    const text = colorThemeFileText(f.contents);
    if (!onWriteToFolder) {
      saveFile(f.fileName, text);
      return;
    }
    setError('');
    // The write can be refused after the fact — permission revoked, a
    // read-only mount — and a button that silently did nothing would be worse
    // than one that says why.
    const failed = await onWriteToFolder(f.fileName, text);
    if (failed) setError(failed);
    else setNote(`Wrote ${f.fileName}.`);
  };

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-choicedlg ze-themefolder" role="dialog" aria-modal="true">
        <div className="ze-modal-header">
          {folderName ? `Color Themes — ${folderName}` : 'Color Themes'}
        </div>
        <div className="ze-choicedlg-body">
          {folderName === undefined && (
            /* Said once, plainly, rather than leaving the user to work out why
               a button called "Open Theme Folder" produced a download. */
            <div className="ze-choicedlg-message">
              This browser will not open a folder, so themes are saved and loaded as files.
            </div>
          )}

          <div
            className="ze-choicedlg-list cols ze-themefolder-list"
            role="table"
            aria-label="Color theme files"
          >
            {folderFiles.map((f) => (
              <div
                className="ze-choicedlg-item cols ze-themefolder-row"
                role="row"
                key={`folder:${f.fileName}`}
              >
                <span role="cell" className="ze-themefolder-file">
                  {f.fileName}
                </span>
                <span role="cell" className="ze-themefolder-name">
                  {f.contents.name}
                </span>
                <button
                  type="button"
                  role="cell"
                  className="ze-btn"
                  onClick={() => {
                    onImport(f.contents);
                    onClose();
                  }}
                >
                  Load
                </button>
              </div>
            ))}
            {files.map((f) => (
              <div
                className="ze-choicedlg-item cols ze-themefolder-row"
                role="row"
                key={`app:${f.fileName}`}
              >
                <span role="cell" className="ze-themefolder-file">
                  {f.fileName}
                </span>
                <span role="cell" className="ze-themefolder-name">
                  {f.name}
                  {f.writable ? '' : ' (read-only)'}
                </span>
                <button type="button" role="cell" className="ze-btn" onClick={() => void put(f)}>
                  {onWriteToFolder ? 'Save to folder' : 'Export'}
                </button>
              </div>
            ))}
          </div>

          {note !== '' && <div className="ze-choicedlg-message">{note}</div>}
          {error !== '' && <div className="ze-themefolder-error">{error}</div>}
        </div>
        <div className="ze-choicedlg-buttons">
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared, so picking the same file twice fires twice.
              e.target.value = '';
              if (file) void readPicked(file);
            }}
          />
          {/* With a folder open its files are listed above and loadable from
              there; this stays for a theme that lives somewhere else. */}
          <button type="button" className="ze-btn" onClick={() => inputRef.current?.click()}>
            Import...
          </button>
          <span className="ze-spacer" />
          <button type="button" className="ze-btn" onClick={onClose}>
            {OK_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
