// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_COLOR_SETTINGS` — the Colors page's shared half, written **once**.
 *
 * Upstream this is `common/dialogs/panel_color_settings.{h,cpp}` plus its
 * wxFormBuilder base, and it is in `common/` because four apps subclass it:
 * `PANEL_EESCHEMA_COLOR_SETTINGS`, `PANEL_PCBNEW_COLOR_SETTINGS`,
 * `PANEL_GERBVIEW_COLOR_SETTINGS` and the footprint editor's. A subclass
 * supplies four things and no more —
 *
 *   - `m_validLayers`, the layer ids that get a swatch;
 *   - `createSwatches()`, the NAME beside each one;
 *   - `m_backgroundLayer`, the colour a half-transparent swatch is
 *     checkerboarded against;
 *   - optionally a preview panel in `m_previewPanelSizer`, and whether
 *     `m_optOverrideColors` is shown at all
 *     (`panel_gerbview_color_settings.cpp:50` hides it: "Currently this only
 *     applies to eeschema").
 *
 * — so those four are the props here and everything else is this component's.
 *
 * Note what is NOT a subclass: `PANEL_SYM_COLOR_SETTINGS` and
 * `PANEL_PL_EDITOR_COLOR_SETTINGS` derive from `RESETTABLE_PANEL` directly and
 * are a theme choice with no swatch grid at all. Assuming a shared base from
 * the page's *name* is how that gets ported wrong; check the header.
 *
 * **The sizer tree**, whole (`panel_color_settings_base.cpp:14-84`):
 *
 *     m_mainSizer (V)
 *       bControlSizer (H)                      0, wxEXPAND|wxALL, 5
 *         "Theme:"                             wxLEFT|wxRIGHT, 5
 *         m_cbTheme (min width 150)            wxBOTTOM|wxRIGHT|wxTOP, 5
 *         (0, 0) proportion 1
 *         m_optOverrideColors                  wxLEFT, 5
 *         (0, 0) proportion 1
 *         m_btnOpenFolder                      wxRIGHT, 5
 *       m_panel1 (WX_PANEL)                    1, wxEXPAND
 *         m_colorsListWindow (wxScrolledWindow, min 240x240)
 *                                              0, wxEXPAND|wxLEFT|wxRIGHT, 5
 *           m_colorsGridSizer (wxFlexGridSizer 0 x 2)
 *         m_previewPanelSizer (V)              1, wxEXPAND|wxRIGHT, 5
 *
 * The list is proportion ZERO and the preview takes every remaining pixel —
 * which is why a page with no preview (gerbview's) leaves that space empty
 * rather than letting the swatches spread into it.
 *
 * **Not yet shared with eeschema.** `editors/schematic/prefs/
 * PanelEeschemaColorSettings.tsx` still carries its own copy of this markup;
 * that file was owned by another agent for the whole of the session this was
 * written in, and a refactor of it could not have been reviewed as a no-op
 * alongside a new page. Migrating it onto this component is the follow-up, and
 * it is a small one: its body below the `COLOR_LAYERS` table is this component
 * with `preview` set.
 */
import {
  Fragment,
  useState,
  type Dispatch,
  type JSX,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Check } from './widgets.js';
import { ColorThemeChoice } from './ColorThemeChoice.js';
import { ColorSwatch } from '../../ui/ColorSwatch.js';
import { ThemeFolderDialog, type FolderFile, type ThemeFile } from './dialog_theme_folder.js';
import { AddColorThemeDialog } from './dialog_add_color_theme.js';
import { MessageDialogOk } from '../../ui/dialog_message.js';
import {
  PICK_CANCELLED,
  pickThemeFolder,
  readThemeFolder,
  writeThemeFile,
  type ThemeDirHandle,
} from '../../fs/theme_folder.js';
import type { UserColorTheme } from '../../prefs/settings.js';
import type { Color4d } from '@ziroeda/common';
import type { ColorThemeContents } from '@ziroeda/common/src/settings/color_theme_file.js';

/**
 * What a subclass has to supply for the base's two theme commands to work —
 * `m_btnOpenFolder` and the `New Theme...` row of `createThemeList`.
 *
 * Both live in `PANEL_COLOR_SETTINGS` (`panel_color_settings.cpp:65-69` and
 * `:122-176`), so every subclass gets them; only the namespace they read and
 * write differs. Ours were wired by hand in eeschema's page alone, which is why
 * the footprint editor's had a dead button and a list that stopped at the three
 * themes.
 */
export interface ColorThemeIo {
  /**
   * `SETTINGS_MANAGER::GetColorSettingsPath()`'s contents, as this app holds
   * them: the writable theme and everything the PCM installed. Never the two
   * built-ins, which are compiled in and have no file.
   */
  files: readonly ThemeFile[];
  /**
   * `for( int layer : m_validLayers )
   *      newSettings->SetColor( layer, m_currentSettings->GetColor( layer ) );`
   * — a new theme is seeded from the theme that was SELECTED, not from the
   * defaults, keyed the way `userThemes[].colors` is for this page.
   */
  seed: () => Record<string, string>;
  /** `newSettings->GetOverrideSchItemColors()`, copied with the colours. */
  override: boolean;
  /** A theme file the user brought back out of the folder. */
  onImport: (contents: ColorThemeContents) => void;
  /**
   * `m_cbTheme->SetSelection( idx )` and the two lines after it: the page
   * selects what was just made and re-reads the override flag from it.
   */
  onThemeCreated: (id: string) => void;
  userThemes: Readonly<Record<string, UserColorTheme>>;
  setUserThemes: Dispatch<SetStateAction<Record<string, UserColorTheme>>>;
}

/** One entry of `m_validLayers`, with the name `createSwatches` gives it. */
export interface ColorSwatchRow {
  /** The layer enumerator. Only ever a key here; nothing reads it as a number. */
  id: string;
  /** `createSwatch( layer, aName )`'s `aName`. */
  name: string;
  /** `m_currentSettings->GetColor( layer )`. */
  color: Color4d;
  /**
   * Whether the swatch answers a click.
   *
   * Upstream the whole panel is read-only when the selected theme is
   * (`ResetPanel` returns early on `m_currentSettings->IsReadOnly()`, and
   * `OnColorChanged` writes into a settings object that will not be saved), so
   * this is per row only because some rows have no reader on our side and are
   * greyed for that separate reason.
   */
  disabled?: boolean;
  onChange?: (picked: Color4d) => void;
}

export function PanelColorSettings({
  themeId,
  onThemeChange,
  rows,
  background,
  showOverrideColors = true,
  overrideColors = false,
  overrideColorsEnabled = false,
  onOverrideColorsChange,
  userThemes,
  themeIo,
  preview,
}: {
  /** `cfg->m_ColorTheme`, whichever app's settings object that is. */
  themeId: string;
  onThemeChange: (id: string) => void;
  /** `m_validLayers` crossed with `createSwatches()`. */
  rows: readonly ColorSwatchRow[];
  /**
   * `m_currentSettings->GetColor( m_backgroundLayer )`
   * (`panel_color_settings.cpp:262`) — the colour every swatch is
   * checkerboarded against, which is the app's own canvas background and not
   * the dialog's.
   */
  background: Color4d;
  /**
   * `m_optOverrideColors`. `PANEL_GERBVIEW_COLOR_SETTINGS`' constructor calls
   * `m_optOverrideColors->Hide()` with the comment "Currently this only
   * applies to eeschema" (`panel_gerbview_color_settings.cpp:49-50`), so the
   * control is ABSENT there rather than greyed — a hidden wxWindow takes no
   * space in its sizer.
   */
  showOverrideColors?: boolean;
  /** `m_optOverrideColors->GetValue()`. */
  overrideColors?: boolean;
  /** `m_optOverrideColors->Enable( !settings->IsReadOnly() )`. */
  overrideColorsEnabled?: boolean;
  onOverrideColorsChange?: (value: boolean) => void;
  /** Themes "New Theme..." made, which the choice lists beside the rest. */
  userThemes?: Readonly<Record<string, { name: string }>>;
  /**
   * The two theme COMMANDS — `m_btnOpenFolder` and `New Theme...` — which this
   * panel runs itself, exactly as the base class does upstream. Left out, the
   * button is dead and the choice stops at the themes; that is what a page
   * looks like before it has been wired, not a shape KiCad has.
   */
  themeIo?: ColorThemeIo;
  /** `m_previewPanelSizer`'s contents, which only eeschema and pcbnew fill. */
  preview?: ReactNode;
}): JSX.Element {
  /** The "New Theme..." prompt, and the box that reports a name already taken. */
  const [naming, setNaming] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  /**
   * The picked directory, once the user has granted one. Null means the browser
   * would not open a folder, and the dialog offers files instead — see
   * `fs/theme_folder.ts`.
   */
  const [dir, setDir] = useState<ThemeDirHandle | null>(null);
  const [folderFiles, setFolderFiles] = useState<readonly FolderFile[]>([]);

  /**
   * `LaunchExternal( GetColorSettingsPath() )`, as near as a page gets: the
   * desktop's folder chooser, then the folder's own theme files.
   *
   * A cancel does nothing at all — the same `AbortError` branch
   * `HomePage.openProjectPicker` has, because closing a chooser you did not
   * want should not leave a dialog behind.
   */
  const openThemeFolder = async (): Promise<void> => {
    const picked = await pickThemeFolder();
    if (picked === PICK_CANCELLED) return;
    if (typeof picked === 'string') {
      setDir(null);
      setFolderFiles([]);
    } else {
      setDir(picked);
      try {
        setFolderFiles(await readThemeFolder(picked));
      } catch {
        // A folder we can open but not list is still a folder to write into.
        setFolderFiles([]);
      }
    }
    setFolderOpen(true);
  };

  return (
    <>
      <div className="ze-colorpage">
        {/* `bControlSizer`, horizontal and in NO group. */}
        <div className="ze-colorpage-controls">
          <ColorThemeChoice
            label="Theme:"
            /* `GetSettingsDropdownName` appends " (read-only)" to every theme
             whose file cannot be written (`panel_color_settings.cpp:391-398`). */
            markReadOnly
            value={themeId}
            onChange={onThemeChange}
            {...(userThemes ? { userThemes } : {})}
            {...(themeIo ? { onNewTheme: () => setNaming(true) } : {})}
          />
          <span className="ze-spacer" />
          {showOverrideColors && (
            /* `schematic.override_item_colors`, a field of the COLOR_SETTINGS
             FILE (`color_settings.cpp:48-49`) read by
             `SCH_RENDER_SETTINGS::m_OverrideItemColors`. It belongs to the
             THEME, so it is live only while a writable one is selected —
             `m_optOverrideColors->Enable( !settings->IsReadOnly() )`. */
            <Check
              label="Override individual item colors"
              title="Show all items in their default color even if they have specific colors set in their properties."
              checked={overrideColors}
              disabled={!overrideColorsEnabled}
              onChange={(v) => onOverrideColorsChange?.(v)}
            />
          )}
          <span className="ze-spacer" />
          {/* `m_btnOpenFolder`. */}
          <button
            type="button"
            className="ze-btn"
            disabled={!themeIo}
            title="Open the folder containing color themes"
            onClick={() => void openThemeFolder()}
          >
            Open Theme Folder
          </button>
        </div>
        {/* `m_panel1`, the WX_PANEL carrying `m_colorsMainSizer`. */}
        <div className="ze-colorpage-body">
          {/* `m_colorsListWindow` around `m_colorsGridSizer`: two columns, a
            swatch and its label, one row per layer. */}
          <div className="ze-colorlist">
            <div className="ze-colorgrid">
              {rows.map((row) => (
                <Fragment key={row.id}>
                  {/* COLOR_SWATCH (`color_swatch.cpp:301-328`), SWATCH_MEDIUM. */}
                  <ColorSwatch
                    label={row.name}
                    background={background}
                    disabled={row.disabled === true || row.onChange === undefined}
                    color={row.color}
                    onChange={(picked) => row.onChange?.(picked)}
                  />
                  <span>{row.name}</span>
                </Fragment>
              ))}
            </div>
          </div>
          {preview}
        </div>
      </div>
      {themeIo && naming && (
        <AddColorThemeDialog
          onCancel={() => setNaming(false)}
          onConfirm={(name) => {
            setNaming(false);
            /*
             * `if( fn.Exists() ) { wxMessageBox( _( "Theme already exists!" ) ); return; }`
             * — the FILE, so the question is about the folder, not about the
             * display name. `user.json` is in that folder too, which is why it
             * is checked here alongside the themes this made.
             */
            if (name === 'user' || name in themeIo.userThemes) {
              setNameTaken(true);
              return;
            }
            themeIo.setUserThemes((t) => ({
              ...t,
              [name]: { name, colors: themeIo.seed(), override: themeIo.override },
            }));
            themeIo.onThemeCreated(name);
          }}
        />
      )}
      {nameTaken && (
        <MessageDialogOk message="Theme already exists!" onClose={() => setNameTaken(false)} />
      )}
      {themeIo && folderOpen && (
        <ThemeFolderDialog
          files={themeIo.files}
          {...(dir ? { folderName: dir.name } : {})}
          folderFiles={folderFiles}
          {...(dir
            ? {
                onWriteToFolder: async (fileName: string, text: string): Promise<string> => {
                  try {
                    await writeThemeFile(dir, fileName, text);
                    setFolderFiles(await readThemeFolder(dir));
                    return '';
                  } catch (e) {
                    return `Could not write ${fileName}: ${(e as Error)?.message ?? 'refused'}`;
                  }
                },
              }
            : {})}
          onImport={themeIo.onImport}
          onClose={() => setFolderOpen(false)}
        />
      )}
    </>
  );
}
