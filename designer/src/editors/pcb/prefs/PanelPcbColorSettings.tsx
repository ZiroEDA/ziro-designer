// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Colors — `PANEL_PCBNEW_COLOR_SETTINGS`
 * (`pcbnew/dialogs/panel_pcbnew_color_settings.cpp:686-790`).
 *
 * `PANEL_FP_EDITOR_COLOR_SETTINGS` is the same `PANEL_COLOR_SETTINGS` base with
 * a shorter `m_validLayers`, and both set `m_colorNamespace = "board"` — so
 * these two pages edit ONE table and a colour changed on either moves both
 * frames. That is why this page reuses `PanelColorSettings` and the swatch
 * plumbing whole, and supplies only its row list.
 *
 * **What reads it.** `pcbThemeWithOverrides( theme, userColors, userThemes )`
 * in `pcbTheme.ts` — the same function the footprint editor already calls —
 * resolved in `PcbEditor` into `PcbDrawOptions.theme`. The board editor was
 * painting from `PCB_LAYER_COLORS` directly, i.e. from the built-in Default
 * theme with no override applied at all, so this page had nothing behind it
 * even for the rows the footprint editor's page could already move.
 */
import { type JSX, useMemo } from 'react';
import { parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';
import { BOARD_COLOR_KEYS } from '@ziroeda/common/src/settings/color_theme_file.js';
import {
  PanelColorSettings,
  type ColorSwatchRow,
  type ColorThemeIo,
} from '../../../dialogs/prefs/PanelColorSettings.js';
import { themeFilesFor } from '../../../prefs/theme_files.js';
import { pcbColorRows, pcbDefaultColor, PCB_COLOR_BACKGROUND_KEY } from '../pcbColorLayers.js';
import { pcbThemeWithOverrides } from '../pcbTheme.js';
import { PcbColorPreview } from './PcbColorPreview.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelPcbColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { pcbnew, upP, eeschema, userColors, setUserColors, userThemes, setUserThemes } = ctx;

  const themeId = pcbnew.appearance.color_theme;
  /**
   * A swatch is answerable only on a WRITABLE theme: a built-in's file
   * `IsReadOnly()`, so the edit would never be saved
   * (`panel_color_settings.cpp:74-75`), and `AddNewColorSettings` calls
   * `SetReadOnly( false )` on what it makes (`:158-160`).
   */
  const stored = userThemes[themeId];
  const editable = themeId === 'user' || stored !== undefined;
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
    return pcbColorRows().map((row) => ({
      id: row.key,
      name: row.name,
      color: parseColor4d(themeColors[row.key] ?? pcbDefaultColor(row)),
      ...(editable ? { onChange: set(row.key) } : {}),
    }));
  }, [themeColors, editable, setUserColors, setUserThemes, stored, themeId]);

  /** `m_currentSettings->GetColor( m_backgroundLayer )`, LAYER_PCB_BACKGROUND. */
  const background = useMemo(
    () =>
      parseColor4d(
        themeColors[PCB_COLOR_BACKGROUND_KEY] ??
          pcbDefaultColor({
            key: PCB_COLOR_BACKGROUND_KEY,
            name: 'Background',
            layer: 'LAYER_PCB_BACKGROUND',
          }),
      ),
    [themeColors],
  );

  const themeIo: ColorThemeIo = {
    files: themeFilesFor(userColors, eeschema.appearance.override_item_colors),
    /* `for( int layer : m_validLayers )
     *      newSettings->SetColor( layer, m_currentSettings->GetColor( layer ) );`
     * — the rows THIS page shows, from the theme that was selected. */
    seed: () => {
      const out: Record<string, string> = {};
      for (const row of pcbColorRows()) out[row.key] = themeColors[row.key] ?? pcbDefaultColor(row);
      return out;
    },
    override: eeschema.appearance.override_item_colors,
    onImport: (contents) => {
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
      upP((s) => {
        s.appearance.color_theme = 'user';
      });
    },
    onThemeCreated: (name) => {
      upP((s) => {
        s.appearance.color_theme = name;
      });
    },
    userThemes,
    setUserThemes,
  };

  /**
   * `updatePreview()`: `settings->LoadColors( m_currentSettings )` — the
   * preview is painted from the theme AS EDITED, which is the whole point of
   * having one. `pcbThemeWithOverrides` is the same resolver `PcbEditor` uses,
   * so what the pane shows is what the board will look like.
   */
  const previewTheme = useMemo(
    () => pcbThemeWithOverrides(themeId, userColors, userThemes),
    [themeId, userColors, userThemes],
  );

  return (
    <PanelColorSettings
      themeId={themeId}
      /* `m_previewPanelSizer`, which only eeschema's and pcbnew's pages fill. */
      preview={<PcbColorPreview theme={previewTheme} />}
      onThemeChange={(v) =>
        upP((s) => {
          s.appearance.color_theme = v;
        })
      }
      rows={rows}
      background={background}
      /* `m_optOverrideColors->Hide()` (`panel_pcbnew_color_settings.cpp:702`) —
         "Currently this only applies to eeschema". */
      showOverrideColors={false}
      userThemes={userThemes}
      themeIo={themeIo}
    />
  );
}
