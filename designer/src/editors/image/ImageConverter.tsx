// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Image Converter's window: the `wxFrame` half of `BITMAP2CMP_FRAME`
 * (`bitmap2component/bitmap2cmp_frame.cpp`). The frame's behaviour, the panel
 * and its view are `@ziroeda/bitmap2component`; what is here is what needs the
 * app — the menu bar `doReCreateMenuBar` builds, the status bar, the message
 * boxes and file dialogs the frame and panel ask for, the Preferences and
 * About dialogs, and the `bitmap2component` settings slice.
 */

import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuBar, type Menu, type MenuItem } from '@ziroeda/common/tool/action_menu_bar.js';
import { MessageDialogOk, MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import type { MessageDialogIcon, YesNoResult } from '@ziroeda/common/confirm_types.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import {
  loadBitmap2CmpSettings,
  recentImages,
  RECENT_MAX_DATA,
  saveBitmap2CmpSettings,
} from './bitmap2cmpSettings.js';
import {
  MISSING_FILE_EXTENDED,
  missingFileMessage,
  openRecentMenuItem,
} from '@ziroeda/common/file_history.js';
import { useFileHistory } from '@ziroeda/common/use_file_history.js';
import { setLanguageMenuItem } from '@ziroeda/common/eda_base_frame_language_menu.js';
import { settings } from '../../prefs/settings.js';
import { useCommonSettings } from '../../prefs/useSettings.js';
import { standardHelpMenu } from '@ziroeda/common/eda_base_frame_help_menu.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import { useMenuHotkeys } from '@ziroeda/common/tool/use_menu_hotkeys.js';
import { addQuit } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { imageFileWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import {
  BITMAP2CMP_SETTINGS,
  CreateKiWindow,
  type BITMAP2CMP_FRAME,
  type BITMAP2CMP_FRAME_UI,
  type IMAGE_FILE,
} from '@ziroeda/bitmap2component';
import { Bitmap2cmpPanel, readImageFile } from '@ziroeda/bitmap2component/bitmap2cmp_panel_ui.js';
import { acceptAttribute, openFileDialog } from '../../fs/open_file_dialog.js';
import { HomeLink } from '../../ui/HomeLink.js';
import '@ziroeda/bitmap2component/bitmap2cmp_panel.css';
import './imageConverter.css';

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

export function ImageConverter({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
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

  // BITMAP2CMP_FRAME's file history, the shared FILE_HISTORY port.
  const recent = useFileHistory(recentImages);
  const common = useCommonSettings();

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
        const files = await openFileDialog(filters, {
          fallback: () => fileInputRef.current?.click(),
        });

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
    [onExitToHome],
  );

  // bitmap2cmp_main.cpp's CreateKiWindow: the settings object, then the frame.
  const [frame] = useState<BITMAP2CMP_FRAME>(() => CreateKiWindow(ui, loadBitmap2CmpSettings()));

  // SaveSettings: KiCad writes the settings once, from the frame destructor.
  // A tab has no destructor, so every change is written; the slice ignores a
  // save that changes nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the trigger; the frame is read, not a dependency that changes
  useEffect(() => {
    const cfg = new BITMAP2CMP_SETTINGS();
    frame.SaveSettings(cfg);
    saveBitmap2CmpSettings(cfg.ToJson());
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
    [frame],
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
          current: common.system.language,
          onSelect: (label) =>
            settings.updateCommon((c) => {
              c.system.language = label;
            }),
        }),
      ],
    },
    standardHelpMenu({ showHotkeys: showHotkeyList, showAbout: () => setAboutOpen(true) }),
  ];

  // The menus are the whole of this frame's keyboard: Ctrl+O, Ctrl+`,`,
  // Ctrl+Alt+Q and Ctrl+F1 are dispatched from the rows that declare them.
  useMenuHotkeys(menus, 'image');

  const modal = modals[0];
  const closeModal = (): void => setModals((m) => m.slice(1));

  return (
    <div className="imgc-frame ze-app">
      <MenuBar menus={menus} leftSlot={<HomeLink onClick={onExitToHome} />} title={title} />
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptAttribute([imageFileWildcard()])}
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

      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      {/* ShowAboutDialog( this ), with the frame's m_aboutTitle. */}
      {aboutOpen && (
        <ShowAboutDialog title={frame.m_aboutTitle} onClose={() => setAboutOpen(false)} />
      )}
    </div>
  );
}
