// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Image Converter's page: what the program gives the window in
 * `bitmap2component/bitmap2cmp_frame_ui.tsx` - `Pgm()`'s settings manager and
 * language, the file chooser over the account's storage, the Preferences
 * dialog, the hotkey list, and the way home.
 */
import { type JSX, useMemo } from 'react';
import {
  Bitmap2cmpFrameWindow,
  type BITMAP2CMP_APP,
} from '@ziroeda/bitmap2component/bitmap2cmp_frame_ui.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { acceptAttribute, openFileDialog } from '../../fs/open_file_dialog.js';
import { settings } from '../../prefs/settings.js';
import { useCommonSettings } from '../../prefs/useSettings.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { loadBitmap2CmpSettings, saveBitmap2CmpSettings } from './bitmap2cmpSettings.js';

export function ImageConverter({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
  const common = useCommonSettings();
  const language = common.system.language;

  const app = useMemo<BITMAP2CMP_APP>(
    () => ({
      homeLink: <HomeLink onClick={onExitToHome} />,
      LoadSettings: loadBitmap2CmpSettings,
      SaveSettings: saveBitmap2CmpSettings,
      fileHistorySize: settings.common.system.file_history_size,
      language,
      SetLanguage: (label) =>
        settings.updateCommon((c) => {
          c.system.language = label;
        }),
      OpenFileDialog: (filters, fallback) => openFileDialog(filters, { fallback }),
      AcceptAttribute: acceptAttribute,
      Preferences: (onClose) => <PreferencesDialog onClose={onClose} />,
      ShowHotkeyList: showHotkeyList,
    }),
    [onExitToHome, language],
  );

  return <Bitmap2cmpFrameWindow app={app} onExitToHome={onExitToHome} />;
}
