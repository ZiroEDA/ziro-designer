// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Colors: the program's half of
 * `PANEL_PCBNEW_COLOR_SETTINGS`. The page itself is
 * `pcbnew/dialogs/panel_pcbnew_color_settings.tsx`; the PCM themes and theme
 * files come from the same host the footprint editor's page takes, and the
 * board preview (`PcbColorPreview`, a 2D paint that waits for the WebGL stage)
 * is handed in as a render prop.
 */
import type { JSX } from 'react';
import { PanelPcbColorSettings as Page } from '@ziroeda/pcbnew/dialogs/panel_pcbnew_color_settings.js';
import { COLOR_SETTINGS_HOST } from '../../footprint/prefs/PanelFpColorSettings.js';
import { PcbColorPreview } from './PcbColorPreview.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelPcbColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return (
    <Page
      ctx={ctx}
      host={COLOR_SETTINGS_HOST}
      renderPreview={(theme) => <PcbColorPreview theme={theme} />}
    />
  );
}
