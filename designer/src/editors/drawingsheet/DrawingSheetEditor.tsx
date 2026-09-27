// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's page: what the program gives the window in
 * `pagelayout_editor/pl_editor_frame_ui.tsx` - `Pgm()` (the `pl_editor.json`
 * slice, the language, the colour themes with the user's overrides), the
 * KIWAY, the Open and Save As dialogs over the account's storage, where a
 * written sheet goes, the Preferences dialog, the user's toolbar layout, and
 * the way home.
 */
import { type JSX, useCallback, useMemo, useState } from 'react';
import { parseColor4d } from '@ziroeda/common/color4d.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import { COLOR_SETTINGS, layerIdFromThemeKey } from '@ziroeda/common/settings/color_settings.js';
import { drawingSheetWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import {
  type PL_EDITOR_APP,
  PlEditorFrameWindow,
} from '@ziroeda/pagelayout_editor/pl_editor_frame_ui.js';
import { DS_DEFAULT_TOOLBARS } from '@ziroeda/pagelayout_editor/toolbars_pl_editor.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { pageFor } from '../../dialogs/prefs/registry.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { SaveAsDialog } from '../../fs/SaveAsDialog.js';
import { leafOf } from '../../fs/save_path.js';
import { InitPgm } from '../../pgm_app.js';
import { settings } from '../../prefs/settings.js';
import {
  resolveThemeById,
  useCommonSettings,
  usePlEditorSettings,
  useUserColors,
} from '../../prefs/useSettings.js';
import { drawPanelWindow, loadBitmapFontImage } from '../../render/gal_window.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { themeByLayer } from '../schematic/prefs/schColorLayers.js';

export interface DrawingSheetEditorFile {
  name: string;
  text: string;
}

const download = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * `::GetColorSettings( aThemeId )` as this program answers it: a built-in, an
 * installed or made theme, or "User" with the per-layer overrides the Colors
 * pages store - the one colour store every editor here reads.
 */
export function colorSettingsFor(aThemeId: string): COLOR_SETTINGS {
  const cs = new COLOR_SETTINGS(aThemeId);

  for (const [layer, css] of Object.entries(themeByLayer(resolveThemeById(aThemeId)))) {
    const id = layerIdFromThemeKey(layer);

    if (id !== undefined && css) cs.SetColor(id, parseColor4d(css));
  }

  return cs;
}

export function DrawingSheetEditor({
  onExitToHome,
  kiway,
  projectName,
  onSaveToProject,
  openRequest,
  readOnlyNotice,
}: {
  onExitToHome: () => void;
  /** The program's KIWAY, which COMMON_CONTROL calls. */
  kiway: KIWAY;
  projectName?: string;
  /**
   * The read-only strip, when the layout cannot be written: `LoadDrawingSheetFile`
   * raises one for exactly this (`pagelayout_editor/files.cpp:276-281`).
   */
  readOnlyNotice?: JSX.Element | null;
  /** Write the sheet at this full account path. */
  onSaveToProject?: (path: string, text: string) => void;
  /** A `.kicad_wks` the project manager double-clicked to open here; re-sent with
   *  a fresh nonce so the resident editor re-opens on the newly-picked file. */
  openRequest?: { name: string; text: string; nonce: number } | null;
}): JSX.Element {
  const plCfg = usePlEditorSettings();
  const userColors = useUserColors();
  const common = useCommonSettings();
  const top = useToolbarEntries('pl_editor', 'TOP_MAIN', DS_DEFAULT_TOOLBARS);
  const left = useToolbarEntries('pl_editor', 'LEFT', DS_DEFAULT_TOOLBARS);
  const right = useToolbarEntries('pl_editor', 'RIGHT', DS_DEFAULT_TOOLBARS);

  // ---- the file dialogs: the account's chooser ------------------------------

  const [openDlg, setOpenDlg] = useState<{
    title: string;
    action: 'open' | 'append';
    resolve: (aFile: { path: string; text: string } | null) => void;
  } | null>(null);
  const [saveAsDlg, setSaveAsDlg] = useState<{
    title: string;
    resolve: (aPath: string | null) => void;
  } | null>(null);

  const openFileDialog = useCallback(
    (aTitle: string, aAction: 'open' | 'append') =>
      new Promise<{ path: string; text: string } | null>((resolve) =>
        setOpenDlg({ title: aTitle, action: aAction, resolve }),
      ),
    [],
  );
  const saveFileDialog = useCallback(
    (aTitle: string) =>
      new Promise<string | null>((resolve) => setSaveAsDlg({ title: aTitle, resolve })),
    [],
  );

  const language = common.system.language;
  const app = useMemo<PL_EDITOR_APP>(
    () => ({
      homeLink: <HomeLink onClick={onExitToHome} />,
      kiway,
      InitPgm,
      plEditorSettings: plCfg,
      GetPlEditorSettings: () => settings.plEditor,
      UpdatePlEditorSettings: (fn) => settings.updatePlEditor(fn),
      ColorSettings: colorSettingsFor,
      colorsVersion: userColors,
      fileHistorySize: settings.common.system.file_history_size,
      language,
      SetLanguage: (label) =>
        settings.updateCommon((c) => {
          c.system.language = label;
        }),
      OpenFileDialog: openFileDialog,
      SaveFileDialog: saveFileDialog,
      WriteFile: (aPath, aContents) => {
        if (onSaveToProject) onSaveToProject(aPath, aContents);
        else download(leafOf(aPath), aContents);
      },
      Preferences: (page, parent, onClose) => (
        <PreferencesDialog
          {...(page === '' ? {} : { initialPage: pageFor(page, parent) })}
          onClose={onClose}
        />
      ),
      DrawPanelWindow: async (canvas) => drawPanelWindow(canvas, await loadBitmapFontImage()),
      toolbars: { top, left, right },
    }),
    [
      onExitToHome,
      kiway,
      plCfg,
      userColors,
      language,
      openFileDialog,
      saveFileDialog,
      onSaveToProject,
      top,
      left,
      right,
    ],
  );

  const overlay = (
    <>
      {openDlg && (
        <OpenFileDialog
          kind="templates"
          title={openDlg.title}
          accept={openDlg.action === 'append' ? 'Append' : 'Open'}
          filters={[drawingSheetWildcard()]}
          onDone={(file) => {
            const req = openDlg;
            setOpenDlg(null);
            req.resolve(file ? { path: file.path, text: file.text } : null);
          }}
        />
      )}

      {saveAsDlg && (
        <SaveAsDialog
          // `wxFileDialog( this, _( "Save Drawing Sheet As" ), dir, wxEmptyString, … )`:
          // no name suggested (files.cpp:200-202).
          initialName=""
          kind="templates"
          title={saveAsDlg.title}
          // `dir = PATHS::GetUserTemplatesPath()` (files.cpp:199).
          initialPlace="templates"
          {...(projectName ? { projectDir: `/${projectName}` } : {})}
          filters={[drawingSheetWildcard()]}
          onDone={(path) => {
            const req = saveAsDlg;
            setSaveAsDlg(null);
            req.resolve(path);
          }}
        />
      )}
    </>
  );

  return (
    <PlEditorFrameWindow
      app={app}
      overlay={overlay}
      onExitToHome={onExitToHome}
      openRequest={openRequest ?? null}
      readOnlyNotice={readOnlyNotice ?? null}
    />
  );
}
