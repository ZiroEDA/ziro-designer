// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber Viewer's page: what the program gives the window in
 * `gerbview/gerbview_frame_ui.tsx` - `Pgm()` (the settings slices, the
 * language), the KIWAY, the file dialog over the account's storage, the
 * Preferences dialog, the user's toolbar layout, and the way home.
 */
import type { KIWAY } from '@ziroeda/common/kiway.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import {
  type GERBVIEW_APP,
  type GERBVIEW_PICKED_FILE,
  GerbviewFrameWindow,
} from '@ziroeda/gerbview/gerbview_frame_ui.js';
import { GBR_DEFAULT_TOOLBARS } from '@ziroeda/gerbview/toolbars_gerber.js';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { pageFor } from '../../dialogs/prefs/registry.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { acceptAttribute, openFileDialog } from '../../fs/open_file_dialog.js';
import { InitPgm } from '../../pgm_app.js';
import { settings } from '../../prefs/settings.js';
import { useCommonSettings, useGerbviewSettings, useUserColors } from '../../prefs/useSettings.js';
import { drawPanelWindow, loadBitmapFontImage } from '../../render/gal_window.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';

interface FileDialogRequest {
  title: string;
  filters: readonly ChooserFilter[];
  multiple: boolean;
  resolve: (aFiles: GERBVIEW_PICKED_FILE[] | null) => void;
}

/** Browser files as the window's picked files. */
async function picked(aFiles: readonly File[]): Promise<GERBVIEW_PICKED_FILE[]> {
  return Promise.all(
    aFiles.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

export function GerberViewer({
  onExitToHome,
  kiway,
  projectName,
  openRequest,
}: {
  onExitToHome: () => void;
  /** The program's KIWAY, which COMMON_CONTROL calls. */
  kiway: KIWAY;
  projectName?: string;
  /**
   * A file the project manager activated into this viewer -
   * `KICAD_MANAGER_ACTIONS::viewGerbers`, which upstream runs with the file as
   * its parameter (`project_tree_item.cpp:317`). The request carries a nonce so
   * re-opening the same file loads it again.
   */
  openRequest?: { name: string; text: string; nonce: number } | null;
}): JSX.Element {
  const gbrCfg = useGerbviewSettings();
  const userColors = useUserColors();
  const common = useCommonSettings();
  const top = useToolbarEntries('gerbview', 'TOP_MAIN', GBR_DEFAULT_TOOLBARS);
  const aux = useToolbarEntries('gerbview', 'TOP_AUX', GBR_DEFAULT_TOOLBARS);
  const left = useToolbarEntries('gerbview', 'LEFT', GBR_DEFAULT_TOOLBARS);

  // ---- the file dialog: the account's chooser, the computer's as fallback ----

  const [fileDialog, setFileDialog] = useState<FileDialogRequest | null>(null);

  /** The hidden `<input>` a browser with no file picker falls back to. */
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const fallbackResolve = useRef<((aFiles: File[]) => void) | null>(null);

  const fileDialogFn = useCallback(
    (aTitle: string, aFilters: readonly ChooserFilter[], aMultiple: boolean) =>
      new Promise<GERBVIEW_PICKED_FILE[] | null>((resolve) =>
        setFileDialog({ title: aTitle, filters: aFilters, multiple: aMultiple, resolve }),
      ),
    [],
  );

  const language = common.system.language;
  const app = useMemo<GERBVIEW_APP>(
    () => ({
      homeLink: <HomeLink onClick={onExitToHome} />,
      kiway,
      InitPgm,
      gerbviewSettings: gbrCfg,
      GetGerbviewSettings: () => settings.gerbview,
      UpdateGerbviewSettings: (fn) => settings.updateGerbview(fn),
      userColors,
      GetUserColors: () => settings.userColors,
      SetUserColors: (c) => settings.setUserColors(c),
      language,
      SetLanguage: (label) =>
        settings.updateCommon((c) => {
          c.system.language = label;
        }),
      FileDialog: fileDialogFn,
      Preferences: (page, parent, onClose) => (
        <PreferencesDialog
          onClose={onClose}
          {...(page === '' ? {} : { initialPage: pageFor(page, parent) })}
          frameOwner="gerbview"
        />
      ),
      DrawPanelWindow: async (canvas) => drawPanelWindow(canvas, await loadBitmapFontImage()),
      toolbars: { top, aux, left },
    }),
    [onExitToHome, kiway, gbrCfg, userColors, language, fileDialogFn, top, aux, left],
  );

  const fallbackFilters = fileDialog?.filters ?? [];

  const overlay = (
    <>
      {fileDialog && (
        <OpenFileDialog
          title={fileDialog.title}
          filters={fileDialog.filters}
          multiple={fileDialog.multiple}
          extra={
            <button
              type="button"
              className="ze-btn"
              onClick={() => {
                const req = fileDialog;
                setFileDialog(null);
                void openFileDialog(req.filters, {
                  multiple: req.multiple,
                  fallback: () => {
                    fallbackResolve.current = (files) =>
                      void picked(files).then((p) => req.resolve(p.length ? p : null));
                    fallbackInputRef.current?.click();
                  },
                }).then(async (files) => {
                  if (files.length) req.resolve(await picked(files));
                  else if (!fallbackResolve.current) req.resolve(null);
                });
              }}
            >
              Open from Computer...
            </button>
          }
          onDone={(file) => {
            const req = fileDialog;
            setFileDialog(null);

            if (!file) {
              req.resolve(null); // wxID_CANCEL
              return;
            }

            req.resolve([file, ...file.rest].map((f) => ({ name: f.path, bytes: f.bytes })));
          }}
        />
      )}
      <input
        ref={fallbackInputRef}
        type="file"
        accept={acceptAttribute(fallbackFilters) || undefined}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          const resolve = fallbackResolve.current;
          fallbackResolve.current = null;
          resolve?.(files);
        }}
      />
    </>
  );

  return (
    <GerbviewFrameWindow
      app={app}
      overlay={overlay}
      onExitToHome={onExitToHome}
      {...(projectName === undefined ? {} : { projectName })}
      openRequest={openRequest ?? null}
    />
  );
}
