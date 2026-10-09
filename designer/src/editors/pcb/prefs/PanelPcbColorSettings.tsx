// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Colors, the page itself in
 * `pcbnew/dialogs/panel_pcbnew_color_settings.tsx`; the PCM themes and theme
 * files come from the same host the footprint editor's page takes, and the
 * preview's `FOOTPRINT_PREVIEW_PANEL` is handed `Pgm()`.
 */
import type { JSX } from 'react';
import { PanelPcbColorSettings as Page } from '@ziroeda/pcbnew/dialogs/panel_pcbnew_color_settings.js';
import { COLOR_SETTINGS_HOST } from '../../footprint/prefs/PanelFpColorSettings.js';
import { installPgm } from '../pcb_canvas.js';
import { commonSettingsOf } from '../../../pgm_app.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

const PREVIEW_ENV = {
  installPgm: () => void installPgm(),
  commonSettings: commonSettingsOf,
};

export function PanelPcbColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return <Page ctx={ctx} host={COLOR_SETTINGS_HOST} previewEnv={PREVIEW_ENV} />;
}
