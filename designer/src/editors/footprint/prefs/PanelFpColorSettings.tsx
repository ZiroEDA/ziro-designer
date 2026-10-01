// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Colors: the program's half of
 * `PANEL_FP_EDITOR_COLOR_SETTINGS`. The page itself is
 * `pcbnew/dialogs/panel_fp_editor_color_settings.tsx`; what it asks the program
 * for (the PCM's installed themes, the theme files, the PCM re-render) is here.
 */
import type { JSX } from 'react';
import {
  PanelFpColorSettings as Page,
  type PANEL_COLOR_SETTINGS_HOST,
} from '@ziroeda/pcbnew/dialogs/panel_fp_editor_color_settings.js';
import { usePcmVersion } from '../../../pcm/pcmStore.js';
import { colorSettingsList } from '../../../prefs/color_settings_list.js';
import { themeFilesFor } from '../../../prefs/theme_files.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export const COLOR_SETTINGS_HOST: PANEL_COLOR_SETTINGS_HOST = {
  usePcmVersion,
  colorSettingsList,
  themeFilesFor,
};

export function PanelFpColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return <Page ctx={ctx} host={COLOR_SETTINGS_HOST} />;
}
