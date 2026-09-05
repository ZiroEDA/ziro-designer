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
 * DELIBERATE DIVERGENCE. A page in a browser tab cannot start the desktop's
 * file manager, and there is no `~/.config/kicad/10.0/colors` behind this app
 * to start it on — a theme here is a slice of `localStorage`. So the button
 * shows the folder instead of launching one: the same list of theme files, with
 * the two things that folder is opened FOR. A user copies a theme out of it
 * (Export writes the `.json` KiCad itself would have written, so the file drops
 * straight into a real KiCad install) and copies one in (Import reads a KiCad
 * theme file back).
 *
 * Import can only ever land in the writable theme, for the same reason the
 * override checkbox is dead on the others: `IsReadOnly()`. Upstream a file
 * dropped in the folder becomes a theme of its own, which needs a per-theme
 * store this app does not have — so the file's colours are loaded into "User"
 * and its name is shown, rather than silently inventing a theme id.
 */
import { useRef, useState, type JSX } from 'react';
import {
  colorThemeFileText,
  colorThemeFromFile,
  type ColorThemeContents,
  type SchLayerId,
} from '@ziroeda/common/src/settings/color_theme_file.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { OK_LABEL } from '../../ui/message_dialog.js';

/** One row of the folder listing: a theme file, and whether it can be replaced. */
export interface ThemeFile {
  /** The file name a real KiCad folder would show, e.g. `user.json`. */
  fileName: string;
  /** `meta.name`. */
  name: string;
  /** What Export writes. */
  contents: ColorThemeContents;
  /** False for a built-in or a PCM-installed theme — `IsReadOnly()`. */
  writable: boolean;
}

/** A download, which is the only "copy out of the folder" a tab can perform. */
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
  onImport,
  onClose,
}: {
  files: readonly ThemeFile[];
  /** Called with a file KiCad wrote, once it has parsed. */
  onImport: (contents: ColorThemeContents) => void;
  onClose: () => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  useModalEscape(onClose);

  const read = async (file: File): Promise<void> => {
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

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-themefolder" role="dialog" aria-modal="true">
        <div className="ze-modal-header">Color Themes</div>
        <div className="ze-themefolder-body">
          <div className="ze-themefolder-list" role="table" aria-label="Color theme files">
            {files.map((f) => (
              <div className="ze-themefolder-row" role="row" key={f.fileName}>
                <span role="cell" className="ze-themefolder-file">
                  {f.fileName}
                </span>
                <span role="cell" className="ze-themefolder-name">
                  {f.name}
                  {f.writable ? '' : ' (read-only)'}
                </span>
                <button
                  type="button"
                  role="cell"
                  className="ze-btn"
                  onClick={() => saveFile(f.fileName, colorThemeFileText(f.contents))}
                >
                  Export
                </button>
              </div>
            ))}
          </div>
          {error !== '' && <div className="ze-themefolder-error">{error}</div>}
        </div>
        <div className="ze-themefolder-buttons">
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Clear it, so picking the same file twice fires twice.
              e.target.value = '';
              if (file) void read(file);
            }}
          />
          <button type="button" className="ze-btn" onClick={() => inputRef.current?.click()}>
            Import…
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

/** Re-exported so a caller does not need the common module for one type. */
export type { SchLayerId };
