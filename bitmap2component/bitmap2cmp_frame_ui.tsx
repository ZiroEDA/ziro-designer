// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Image Converter's window: the `wxFrame` half of `BITMAP2CMP_FRAME`
 * (`bitmap2component/bitmap2cmp_frame.cpp`) - the menu bar
 * `doReCreateMenuBar` builds, the status bar, the message boxes and the About
 * dialog.
 *
 * What only the program has comes in as {@link BITMAP2CMP_APP}: upstream
 * `Pgm()` (the settings manager, the language), `KIWAY` (the way home to the
 * project manager) and the toolkit's own dialogs - the file dialog, which here
 * is the account's file chooser, Preferences and the hotkey list.
 */

import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuBar, type Menu, type MenuItem } from '@ziroeda/common/tool/action_menu_bar.js';
import { MessageDialogOk, MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import type { MessageDialogIcon, YesNoResult } from '@ziroeda/common/confirm_types.js';
import {
  FileHistory,
  MISSING_FILE_EXTENDED,
  missingFileMessage,
  openRecentMenuItem,
} from '@ziroeda/common/file_history.js';
import { useFileHistory } from '@ziroeda/common/use_file_history.js';
import { setLanguageMenuItem } from '@ziroeda/common/eda_base_frame_language_menu.js';
import { standardHelpMenu } from '@ziroeda/common/eda_base_frame_help_menu.js';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import { useMenuHotkeys } from '@ziroeda/common/tool/use_menu_hotkeys.js';
import { addQuit } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { imageFileWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import type { BITMAP2CMP_FRAME, BITMAP2CMP_FRAME_UI } from './bitmap2cmp_frame.js';
import { CreateKiWindow } from './bitmap2cmp_main.js';
import type { IMAGE_FILE } from './bitmap2cmp_panel.js';
import { Bitmap2cmpPanel, readImageFile } from './bitmap2cmp_panel_ui.js';
import { BITMAP2CMP_SETTINGS, type BITMAP2CMP_SETTINGS_JSON } from './bitmap2cmp_settings.js';
import './bitmap2cmp_panel.css';
import './bitmap2cmp_frame.css';

/** One Open Recent row: the name FILE_HISTORY shows, and the image to reload. */
export interface RecentImage {
  name: string;
  /** The image bytes as a data URL. */
  data: string;
}

/**
 * A data URL longer than this is not kept in the history: localStorage's quota
 * is per origin, and one large image would push every other slice out.
 */
export const RECENT_MAX_DATA = 1_500_000;

/**
 * What the Image Converter's window asks of the program it runs in.
 */
export interface BITMAP2CMP_APP {
  /** The way back to the project manager, drawn at the left of the menu bar. */
  homeLink: ReactNode;
  /** `Pgm()`'s settings manager: `bitmap2component.json`, read and written. */
  LoadSettings(): Partial<BITMAP2CMP_SETTINGS_JSON>;
  SaveSettings(aJson: BITMAP2CMP_SETTINGS_JSON): void;
  /** `COMMON_SETTINGS::m_System.file_history_size`. */
  fileHistorySize: number;
  /** `Pgm().GetLanguage` / `SetLanguage`, the Preferences menu's language list. */
  language: string;
  SetLanguage(aLabel: string): void;
  /**
   * The file dialog: the chosen files, or none. `aFallback` is run when the
   * program has no picker to offer and a plain `<input type=file>` must ask.
   */
  OpenFileDialog(aFilters: readonly ChooserFilter[], aFallback: () => void): Promise<File[]>;
  /** The `accept` attribute for that fallback input. */
  AcceptAttribute(aFilters: readonly ChooserFilter[]): string;
  /** `EDA_BASE_FRAME::ShowPreferences( wxEmptyString, wxEmptyString )`: the dialog. */
  Preferences(aOnClose: () => void): ReactNode;
  /** `DisplayHotkeyList( this )`. */
  ShowHotkeyList(): void;
}

const bytesToDataUrl = (bytes: Uint8Array, type: string): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type || 'image/png'};base64,${btoa(bin)}`;
};

/** A message box waiting for OK, or a question waiting for an answer. */
type Modal =
  | { kind: 'ok'; message: string; caption?: string }
  | {
      kind: 'yesno';
      message: string;
      caption: string;
      icon: MessageDialogIcon;
      defaultButton: YesNoResult;
      resolve: (r: YesNoResult) => void;
    };

export function Bitmap2cmpFrameWindow({
  app,
  onExitToHome,
}: {
  app: BITMAP2CMP_APP;
  onExitToHome: () => void;
}): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** The `<input>` fallback of the file dialog reports here. */
  const pendingPick = useRef<((f: IMAGE_FILE | null) => void) | null>(null);

  const [version, setVersion] = useState(0);
  const [title, setTitle] = useState('Image Converter');
  // KiCad's status bar starts empty and shows the loaded file (OnLoadFile).
  const [status, setStatus] = useState('');
  const [modals, setModals] = useState<Modal[]>([]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // BITMAP2CMP_FRAME's `m_fileHistory`, allocated once the way
  // `EDA_BASE_FRAME::LoadSettings` (eda_base_frame.cpp:1282-1286) allocates it,
  // from the user's `system.file_history_size`.
  //
  // It does not follow the account, and upstream is the reason:
  // `SETTINGS_MANAGER::ResetToDefaults` (settings_manager.cpp:106-124) lifts the
  // history out, resets the rest and puts it back - KiCad is drawing the line
  // itself, the history is not one of the settings. Ours holds bytes rather
  // than paths, up to RECENT_MAX_DATA a row; if recent images should ever
  // follow the account they belong in the content-addressed blob store with
  // hashes in the slice, not in a settings row.
  const [recentImages] = useState(
    () =>
      new FileHistory<RecentImage>({
        storageKey: 'ziroeda.bitmap2cmp.recent',
        maxFiles: app.fileHistorySize,
      }),
  );
  const recent = useFileHistory(recentImages);

  /**
   * The window's services, as BITMAP2CMP_FRAME / BITMAP2CMP_PANEL call them.
   * Every one is a state setter or a stable ref, so the object is built once.
   */
  const ui = useMemo<BITMAP2CMP_FRAME_UI>(
    () => ({
      MessageBox: (message, caption) => setModals((m) => [...m, { kind: 'ok', message, caption }]),
      AskYesNo: (message, caption, icon, defaultButton) =>
        new Promise<YesNoResult>((resolve) =>
          setModals((m) => [
            ...m,
            { kind: 'yesno', message, caption, icon, defaultButton, resolve },
          ]),
        ),
      SetClipboardText: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
      Refresh: () => setVersion((v) => v + 1),
      ChooseImageFile: async (_title, filters) => {
        const files = await app.OpenFileDialog(filters, () => fileInputRef.current?.click());

        if (files.length > 0) return readImageFile(files[0]!);

        // The <input> fallback answers through its change handler; a cancel
        // there is never reported, and the next pick replaces this one.
        return new Promise<IMAGE_FILE | null>((resolve) => {
          pendingPick.current = resolve;
        });
      },
      SaveFile: (_title, _filters, name, text) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        return true;
      },
      SetTitle: setTitle,
      SetStatusText: setStatus,
      UpdateFileHistory: (file) => {
        const data = bytesToDataUrl(file.bytes, '');
        if (data.length <= RECENT_MAX_DATA)
          recentImages.addFileToHistory({ name: file.name, data });
      },
      Close: onExitToHome,
    }),
    [onExitToHome, app, recentImages],
  );

  // bitmap2cmp_main.cpp's CreateKiWindow: the settings object, then the frame.
  const [frame] = useState<BITMAP2CMP_FRAME>(() => CreateKiWindow(ui, app.LoadSettings()));

  // SaveSettings: KiCad writes the settings once, from the frame destructor.
  // A tab has no destructor, so every change is written; the slice ignores a
  // save that changes nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the trigger; the frame is read, not a dependency that changes
  useEffect(() => {
    const cfg = new BITMAP2CMP_SETTINGS();
    frame.SaveSettings(cfg);
    app.SaveSettings(cfg.ToJson());
  }, [version]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const resolve = pendingPick.current;
    pendingPick.current = null;

    if (!resolve) return;

    if (f) void readImageFile(f).then(resolve);
    else resolve(null);
  };

  /**
   * EDA_BASE_FRAME::GetFileFromHistory: a row whose file is gone gets the
   * "File '%s' was not found." question and opens nothing whatever the answer.
   * Our rows carry their own bytes, so "gone" means the data URL did not
   * survive storage.
   */
  const openRecent = useCallback(
    async (index: number) => {
      const r = recentImages.getFileFromHistory(index, {
        exists: (e) => e.data.length > 0,
        confirmRemove: (e) =>
          window.confirm(`${missingFileMessage(e.name)}\n${MISSING_FILE_EXTENDED}`),
      });
      if (!r) return;
      const blob = await (await fetch(r.data)).blob();
      frame.OnFileHistory(await readImageFile(new File([blob], r.name, { type: blob.type })));
    },
    [frame, recentImages],
  );

  // doReCreateMenuBar: File (Open... / Open Recent / Quit), Preferences
  // (Preferences... / language list), then the standard Help menu.
  const openRecentItem: MenuItem = openRecentMenuItem({
    files: recent,
    onOpen: (i) => void openRecent(i),
    onClear: () => recentImages.clearFileHistory(),
  });

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        // ACTIONS::open, which BITMAP2CMP_CONTROL::Open answers.
        {
          label: 'Open...',
          shortcut: 'Ctrl+O',
          action: () => frame.GetToolManager()?.RunAction(ACTIONS.open),
        },
        openRecentItem,
        { sep: true },
        // `fileMenu->AddQuit( _( "Image Converter" ) )`: bitmap2component has
        // no kiface of its own to close into, so it is always Quit.
        addQuit('Image Converter', () => frame.OnExit()),
      ],
    },
    {
      label: 'Preferences',
      items: [
        { label: 'Preferences...', shortcut: 'Ctrl+,', action: () => setPrefsOpen(true) },
        { sep: true },
        setLanguageMenuItem({
          current: app.language,
          onSelect: (label) => app.SetLanguage(label),
        }),
      ],
    },
    standardHelpMenu({
      showHotkeys: () => app.ShowHotkeyList(),
      showAbout: () => setAboutOpen(true),
    }),
  ];

  // The menus are the whole of this frame's keyboard: Ctrl+O, Ctrl+`,`,
  // Ctrl+Alt+Q and Ctrl+F1 are dispatched from the rows that declare them.
  useMenuHotkeys(menus, 'image');

  const modal = modals[0];
  const closeModal = (): void => setModals((m) => m.slice(1));

  return (
    <div className="imgc-frame ze-app">
      <MenuBar menus={menus} leftSlot={app.homeLink} title={title} />
      <input
        ref={fileInputRef}
        type="file"
        accept={app.AcceptAttribute([imageFileWildcard()])}
        style={{ display: 'none' }}
        onChange={onPick}
      />

      <Bitmap2cmpPanel
        panel={frame.GetPanel()}
        dropTarget={frame.GetDropTarget()}
        version={version}
      />

      {/* CreateStatusBar( 1, wxSTB_SIZEGRIP ) - one field, the loaded file. */}
      <KiStatusBar>
        <span className="cell grow">{status}</span>
      </KiStatusBar>

      {modal?.kind === 'ok' && (
        <MessageDialogOk caption={modal.caption} message={modal.message} onClose={closeModal} />
      )}
      {modal?.kind === 'yesno' && (
        <MessageDialogYesNo
          caption={modal.caption}
          message={modal.message}
          icon={modal.icon}
          defaultButton={modal.defaultButton}
          onResult={(r) => {
            modal.resolve(r);
            closeModal();
          }}
        />
      )}

      {prefsOpen && app.Preferences(() => setPrefsOpen(false))}

      {/* ShowAboutDialog( this ), with the frame's m_aboutTitle. */}
      {aboutOpen && (
        <ShowAboutDialog title={frame.m_aboutTitle} onClose={() => setAboutOpen(false)} />
      )}
    </div>
  );
}
