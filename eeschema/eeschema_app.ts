// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the program gives the Schematic Editor's window (`SCH_EDIT_FRAME`) —
 * `Pgm()`'s `eeschema.json` / `common.json` slices and the colour theme,
 * and, as the frame's other designer-only reaches are threaded through, the
 * dialogs, libraries and services it asks the app for. The same shape
 * `pcbnew/pcbnew_app.ts`'s `PCBNEW_APP` and `cvpcb/cvpcb_mainframe_ui.tsx`'s
 * `CVPCB_APP` give their windows. `eeschema` never imports `designer`; the
 * designer-side `useEeschemaApp()` hook
 * (`designer/src/editors/schematic/eeschema_app.tsx`) is the one file that
 * wires this interface back to what designer actually has.
 */
import type { CommonSettings } from '@ziroeda/common/settings/common_settings.js';
import type { EeschemaSettings } from './eeschema_settings.js';
import type { Theme } from './sch_render_settings.js';

/**
 * `Pgm().GetSettingsManager()`, the part the frame reads and writes: the
 * `eeschema.json` and `common.json` slices, live (not a render snapshot), and
 * the user's hotkey overrides.
 */
export interface EESCHEMA_SETTINGS_STORE {
  readonly eeschema: EeschemaSettings;
  readonly common: CommonSettings;
  /** `user.hotkeys`: action name to key, `null` for unbound. */
  readonly hotkeys: Record<string, string | null>;
  updateEeschema(mutate: (s: EeschemaSettings) => void): void;
  updateCommon(mutate: (c: CommonSettings) => void): void;
}

export interface EESCHEMA_APP {
  // ----- settings ----------------------------------------------------------
  settings: EESCHEMA_SETTINGS_STORE;
  /** The `eeschema.json` slice for this render (re-renders on change). */
  useEeschemaSettings(): EeschemaSettings;
  /** The `common.json` slice for this render. */
  useCommonSettings(): CommonSettings;
  /** The hotkey overrides for this render. */
  useHotkeyOverrides(): Record<string, string | null>;
  /** `SCH_RENDER_SETTINGS::LoadColors` of the active colour theme, for this render. */
  useSchematicTheme(): Theme;
  /** Whether a colour theme overrides item colours (a user theme's own flag). */
  overrideItemColorsFor(themeId: string): boolean;
  /** A grid size as the preferences store it ("50 mil", "1.27 mm") in schematic IU. */
  gridSizeToIU(size: string): number;
}
