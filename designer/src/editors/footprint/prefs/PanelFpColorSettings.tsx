// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Colors — `PANEL_FP_EDITOR_COLOR_SETTINGS`
 * (`pcbnew/dialogs/panel_fp_editor_color_settings.cpp`), constructed by
 * pcbnew's KIFACE for `PANEL_FP_COLORS` (`pcbnew/pcbnew.cpp:398-399`).
 *
 * **Verified, not assumed**: its header says
 * `class PANEL_FP_EDITOR_COLOR_SETTINGS : public PANEL_COLOR_SETTINGS`
 * (`panel_fp_editor_color_settings.h:31`), so it shares the base and gets the
 * swatch grid — unlike `PANEL_SYM_COLOR_SETTINGS` and
 * `PANEL_PL_EDITOR_COLOR_SETTINGS`, which derive from `RESETTABLE_PANEL` and
 * are a theme choice alone. That is why the base is read out of the header
 * rather than guessed from the page's name.
 *
 * The subclass contributes four things, and they are the props
 * `PanelColorSettings` takes:
 *
 *   - `m_colorNamespace = "board"` (`:34`) — **the same rows the PCB Editor's
 *     Colors page edits**. This page is not a set of footprint-editor colours;
 *     it is pcbnew's palette shown from this frame, so a swatch changed here
 *     changes the board editor too. Only which THEME is remembered differs, and
 *     that is `fpedit.json`'s `appearance.color_theme` (`:80-81`).
 *   - `m_validLayers` and `createSwatches()` — `fpColorLayers.ts`;
 *   - `m_backgroundLayer = LAYER_PCB_BACKGROUND` (`:69`);
 *   - `m_optOverrideColors->Hide()` (`:32-33`), with upstream's comment
 *     "Currently this only applies to eeschema" — so that checkbox is ABSENT
 *     here, not greyed.
 *
 * It installs nothing in `m_previewPanelSizer`, so the space beside the list is
 * empty, as on GerbView's page.
 *
 * **What reads it.** `FOOTPRINT_EDIT_FRAME::GetColorSettings` is
 * `::GetColorSettings( GetSettings()->m_ColorTheme )`, and the frame hands that
 * to its painter — so the theme choice repaints the canvas, and the per-swatch
 * overrides land in `colors/user.json` where `resolveThemeById` already reads
 * them for every editor.
 */
import { useMemo, type JSX } from 'react';
import {
  PanelColorSettings,
  type ColorSwatchRow,
} from '../../../dialogs/prefs/PanelColorSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';
import {
  FP_COLOR_BACKGROUND_KEY,
  fpBackgroundDefault,
  fpColorRows,
  fpDefaultColor,
} from '../fpColorLayers.js';

export function PanelFpColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp, userColors, setUserColors, userThemes } = ctx;

  /**
   * A swatch is answerable only on the "User" theme, for the reason every
   * swatch on eeschema's page is: upstream `PANEL_COLOR_SETTINGS` writes into
   * `m_currentSettings`, and a built-in theme's file `IsReadOnly()` so the edit
   * is never saved — `ResetPanel` returns early on exactly that check
   * (`panel_color_settings.cpp:74-75`).
   */
  const editable = fpEdit.appearance.color_theme === 'user';

  const rows = useMemo<ColorSwatchRow[]>(() => {
    const set = (key: string) => (picked: { r: number; g: number; b: number; a: number }) => {
      setUserColors((c) => ({ ...c, [key]: toCssColor(picked, ', ') }));
    };
    return fpColorRows().map((row) => ({
      id: row.key,
      name: row.name,
      color: parseColor4d(userColors[row.key] ?? fpDefaultColor(row)),
      ...(editable ? { onChange: set(row.key) } : {}),
    }));
  }, [userColors, editable, setUserColors]);

  /**
   * `m_currentSettings->GetColor( m_backgroundLayer )`, i.e.
   * `LAYER_PCB_BACKGROUND` (`panel_fp_editor_color_settings.cpp:69`) — the
   * colour every swatch is checkerboarded against. Named, never typed: the
   * default comes out of the shared theme table, and there is no local
   * fallback because `fpColorRows` always carries the row and a missing one is
   * a bug in that table rather than something to paint over.
   */
  const background = useMemo(
    () => parseColor4d(userColors[FP_COLOR_BACKGROUND_KEY] ?? fpBackgroundDefault()),
    [userColors],
  );

  return (
    <PanelColorSettings
      themeId={fpEdit.appearance.color_theme}
      onThemeChange={(v) =>
        upFp((s) => {
          s.appearance.color_theme = v;
        })
      }
      rows={rows}
      background={background}
      /* `m_optOverrideColors->Hide()` (`:32-33`). */
      showOverrideColors={false}
      userThemes={userThemes}
    />
  );
}
