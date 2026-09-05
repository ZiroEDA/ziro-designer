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
  type ColorThemeIo,
} from '../../../dialogs/prefs/PanelColorSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';
import { BOARD_COLOR_KEYS } from '@ziroeda/common/src/settings/color_theme_file.js';
import { themeFilesFor } from '../../../prefs/theme_files.js';
import {
  FP_COLOR_BACKGROUND_KEY,
  fpBackgroundDefault,
  fpColorRows,
  fpDefaultColor,
} from '../fpColorLayers.js';

export function PanelFpColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp, eeschema, userColors, setUserColors, userThemes, setUserThemes } = ctx;

  const themeId = fpEdit.appearance.color_theme;
  /**
   * A swatch is answerable only on a WRITABLE theme, which is `user` and every
   * theme "New Theme..." made: upstream `PANEL_COLOR_SETTINGS` writes into
   * `m_currentSettings`, and a built-in theme's file `IsReadOnly()` so the edit
   * is never saved — `ResetPanel` returns early on exactly that check
   * (`panel_color_settings.cpp:74-75`). `AddNewColorSettings` calls
   * `SetReadOnly( false )` on what it makes (`:158-160`), so a made theme is
   * editable and the built-ins are not.
   */
  const stored = userThemes[themeId];
  const editable = themeId === 'user' || stored !== undefined;

  /**
   * `m_currentSettings->GetColor( layer )` — the SELECTED theme's table, which
   * is a made theme's own colours where there is one and `colors/user.json`'s
   * otherwise. Both are keyed `board.<key>`, the namespace this page writes
   * (`panel_fp_editor_color_settings.cpp:34`), so the two differ only in where
   * they are stored.
   */
  const themeColors = stored ? stored.colors : userColors;

  const rows = useMemo<ColorSwatchRow[]>(() => {
    const set = (key: string) => (picked: { r: number; g: number; b: number; a: number }) => {
      const css = toCssColor(picked, ', ');
      if (stored) {
        setUserThemes((t) => ({
          ...t,
          [themeId]: { ...stored, colors: { ...stored.colors, [key]: css } },
        }));
        return;
      }
      setUserColors((c) => ({ ...c, [key]: css }));
    };
    return fpColorRows().map((row) => ({
      id: row.key,
      name: row.name,
      color: parseColor4d(themeColors[row.key] ?? fpDefaultColor(row)),
      ...(editable ? { onChange: set(row.key) } : {}),
    }));
  }, [themeColors, editable, setUserColors, setUserThemes, stored, themeId]);

  /**
   * `m_currentSettings->GetColor( m_backgroundLayer )`, i.e.
   * `LAYER_PCB_BACKGROUND` (`panel_fp_editor_color_settings.cpp:69`) — the
   * colour every swatch is checkerboarded against. Named, never typed: the
   * default comes out of the shared theme table, and there is no local
   * fallback because `fpColorRows` always carries the row and a missing one is
   * a bug in that table rather than something to paint over.
   */
  const background = useMemo(
    () => parseColor4d(themeColors[FP_COLOR_BACKGROUND_KEY] ?? fpBackgroundDefault()),
    [themeColors],
  );

  /**
   * The base class's two theme commands (`PanelColorSettings`' `ColorThemeIo`),
   * in the `board` namespace. Both are `PANEL_COLOR_SETTINGS`' own —
   * `m_btnOpenFolder` at `panel_color_settings.cpp:65-69` and the
   * `New Theme...` row at `:122-176` — so this page has them for exactly the
   * reason eeschema's does, and had neither only because ours were wired by
   * hand on that one page.
   */
  const themeIo: ColorThemeIo = {
    /* `override` is `schematic.override_item_colors`, which this page cannot
       show (`m_optOverrideColors->Hide()`) but the FILE still carries: the
       folder writes a whole COLOR_SETTINGS, not the part one page edits. It is
       read off eeschema's settings because that is where the writable theme's
       copy of the flag lives, not because the flag is eeschema's. */
    files: themeFilesFor(userColors, eeschema.appearance.override_item_colors),
    /* `for( int layer : m_validLayers )
     *      newSettings->SetColor( layer, m_currentSettings->GetColor( layer ) );`
     * — the rows THIS page shows, from the theme that was selected. The layers
     * it does not show are left at `s_defaultTheme`, which is what a fresh
     * COLOR_SETTINGS carries, so a theme made here is seeded exactly as far as
     * upstream seeds it. */
    seed: () => {
      const out: Record<string, string> = {};
      for (const row of fpColorRows()) out[row.key] = themeColors[row.key] ?? fpDefaultColor(row);
      return out;
    },
    override: eeschema.appearance.override_item_colors,
    onImport: (contents) => {
      /*
       * The one writable theme takes the colours and the chooser is switched to
       * it, as on eeschema's page. Only the `board` section is read here: this
       * page's namespace is `board`, and a file's schematic half belongs to the
       * page that edits those rows.
       */
      const next: Record<string, string> = {};
      for (const [key, layer] of BOARD_COLOR_KEYS) {
        const css = contents.board?.[layer];
        if (css !== undefined) next[`board.${key}`] = css;
      }
      setUserColors((c) => {
        // `aResetIfMissing`: the board half is replaced whole, and the
        // schematic keys sharing this store are left alone.
        const kept = Object.fromEntries(Object.entries(c).filter(([k]) => !k.startsWith('board.')));
        return { ...kept, ...next };
      });
      upFp((s) => {
        s.appearance.color_theme = 'user';
      });
    },
    // `m_cbTheme->SetSelection( idx )` on what was just made.
    onThemeCreated: (name) => {
      upFp((s) => {
        s.appearance.color_theme = name;
      });
    },
    userThemes,
    setUserThemes,
  };

  return (
    <PanelColorSettings
      themeId={themeId}
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
      themeIo={themeIo}
    />
  );
}
