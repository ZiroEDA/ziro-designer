// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
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
} from '@ziroeda/common/src/settings/color_theme_file.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { OK_LABEL } from '../../ui/message_dialog.js';

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
      setError(`${file.name} has no "schematic" section, so it is not a color theme.`);
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
