// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two pieces of `PCB_EDIT_FRAME`'s canvas construction that `pcbnew/`
 * cannot host, because they read the app's live settings singleton
 * (`prefs/settings.ts`): installing the process-wide `PGM_BASE` with the
 * common settings and pcbnew's own `PCBNEW_SETTINGS`, and reloading the
 * registered colour themes' rows. The rest of the canvas — the panel, the
 * view/display-state bridge — is `pcbnew/pcb_canvas.ts`, which is pure of
 * designer/.
 *
 * `PcbEditor.tsx` reaches these two through `PCBNEW_APP`
 * (`pcbnew/pcb_edit_frame_ui.tsx`); the designer-side `usePcbnewApp()` hook
 * wires them to this module the same way `useCvpcbApp()` wires `CVPCB_APP`.
 */

import { commonSettingsOf, InitPgm } from '../../pgm_app.js';
import { PGM_BASE, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { loadPcbnewSettings, pcbnewSettingsOf } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { settings } from '../../prefs/settings.js';

/**
 * `PGM_BASE::InitPgm` as far as the canvas needs it: install the program
 * object with the common settings, the colour-theme loader and the pcbnew
 * app settings. Idempotent; the settings objects are refreshed in place on a
 * later call so the readers (`pcbconfig()`, `Pgm().GetCommonSettings()`) see
 * a changed preference.
 */
export function installPgm(): PGM_BASE {
  // The program object exists from startup (main.tsx, as InitPgm runs before
  // any frame); here the common settings are refreshed in place and pcbnew's
  // KIFACE registers its own.
  const pgm = InitPgm();
  pgm.SetCommonSettings(commonSettingsOf());

  // `Kiface().KifaceSettings()` for pcbnew: ONE PCBNEW_SETTINGS for the life of
  // the program, which the frame, the tools and the painter all read and the
  // tools write. A later call reloads it in place (`JSON_SETTINGS::Load`).
  const mgr = pgm.GetSettingsManager();
  const existing = mgr.GetAppSettings<PCBNEW_SETTINGS>('pcbnew');

  if (existing) loadPcbnewSettings(existing, settings.pcbnew);
  else mgr.RegisterSettings('pcbnew', pcbnewSettingsOf(settings.pcbnew));

  return pgm;
}

/**
 * The colour theme a frame paints with was edited (the Colors page, or a
 * made theme): reload its rows into the registered COLOR_SETTINGS, as the
 * panel's `SetColor` calls would have written them.
 */
export function reloadUserColorSettings(): void {
  const mgr = PgmOrNull()?.GetSettingsManager();

  if (!mgr) return;

  for (const cs of mgr.GetColorSettingsList()) {
    const name = cs.GetFilename();
    const made = settings.userThemes[name];

    if (name === 'user') cs.LoadFromJsonPaths(settings.userColors);
    else if (made) {
      cs.SetName(made.name);
      cs.LoadFromJsonPaths(made.colors);
    }
  }
}
