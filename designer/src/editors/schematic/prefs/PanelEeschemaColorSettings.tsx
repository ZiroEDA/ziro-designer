// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Colors — `PANEL_EESCHEMA_COLOR_SETTINGS`
 * (`eeschema/dialogs/panel_eeschema_color_settings.cpp`), one of the four
 * subclasses of `PANEL_COLOR_SETTINGS` (`include/dialogs/panel_color_settings.h`);
 * eeschema constructs it for `PANEL_SCH_COLORS`. Splitting the shared base out
 * of it is follow-up work -- there is only one subclass here to share with.
 *
 * The page is `m_mainSizer`, vertical (`panel_color_settings_base.cpp:16-83`):
 *
 *     bControlSizer               0, wxEXPAND|wxALL, 5     the theme row
 *     m_panel1                    1, wxEXPAND              a WX_PANEL, top border
 *         m_colorsListWindow      0, wxEXPAND|wxLEFT|wxRIGHT, 5
 *         m_preview               1, wxTOP|wxEXPAND, 1
 *
 * The list is proportion ZERO — it is exactly as wide as its widest row plus a
 * 20 px margin (`panel_eeschema_color_settings.cpp:212-215`) — and the preview
 * takes every remaining pixel. Ours had the swatches spread across the whole
 * page in a two-across grid, in an order of our own, with no preview at all.
 */
import { useMemo, useState, type JSX } from 'react';
import {
  PanelColorSettings,
  type ColorSwatchRow,
  type ColorThemeIo,
} from '../../../dialogs/prefs/PanelColorSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { pcm, usePcmVersion } from '../../../pcm/pcmStore.js';
import { BUILTIN_THEMES, KICAD_DEFAULT, type Theme } from '../theme.js';
import { ColorPreviewPanel } from './ColorPreviewPanel.js';
import { BUILTIN_CLASSIC_THEME, BUILTIN_DEFAULT_THEME, type Color4d } from '@ziroeda/common';
import { COLOR4D_UNSPECIFIED, parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';
import type { SchLayerId } from '@ziroeda/common/src/settings/color_theme_file.js';
import { COLOR_LAYERS } from './schColorLayers.js';
import { themeFilesFor } from '../../../prefs/theme_files.js';

/**
 * The theme's own layer table, which is what `COLOR_SETTINGS::GetColor( aLayer )`
 * reads. `Theme` is our painter's PROJECTION of it and has no field for six of
 * the layers above; those rows read the table directly.
 *
 * A layer the table never sets — `LAYER_INTERSHEET_REFS` and
 * `LAYER_SHAPES_BACKGROUND` are in neither `s_defaultTheme` nor
 * `s_classicTheme` — is `COLOR4D::UNSPECIFIED`, which `COLOR_SWATCH::MakeBitmap`
 * draws as the bare checkerboard.
 */
const rawTable = (themeId: string): Partial<Record<string, Color4d>> =>
  themeId === '_builtin_classic' ? BUILTIN_CLASSIC_THEME : BUILTIN_DEFAULT_THEME;

export function PanelEeschemaColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE, userColors, setUserColors, userThemes, setUserThemes } = ctx;
  // Colour themes installed via the Plugin and Content Manager are offered by
  // `ColorThemeChoice`, which subscribes to the store itself; this page still
  // needs the version to re-derive `activeColors` when one is installed.
  usePcmVersion();
  const themeId = eeschema.appearance.color_theme;
  const activeColors: Theme = useMemo(() => {
    const builtin = BUILTIN_THEMES[themeId];
    if (builtin) return builtin.theme;
    const installed = pcm.themeById(themeId);
    if (installed) return installed;
    // A theme "New Theme..." made carries its own colour table; `user` and an
    // id nothing knows both fall through to the writable one.
    const made = userThemes[themeId];
    if (made) return { ...KICAD_DEFAULT, ...made.colors } as Theme;
    return { ...KICAD_DEFAULT, ...userColors } as Theme;
  }, [themeId, userColors, userThemes]);

  const raw = rawTable(themeId);

  /*
   * What the folder holds. KiCad's colour-theme directory contains the themes
   * a user made and the ones the PCM installed — never the two built-ins,
   * which are compiled in and have no file (`COLOR_BUILTIN_DEFAULT`,
   * `color_settings.cpp:34-35`).
   */
  const themeFiles = themeFilesFor(userColors, eeschema.appearance.override_item_colors);

  /**
   * `m_optOverrideColors`' ENABLED state, which is a small state machine and
   * not a property of the selected theme.
   *
   * `Enable()` is called in exactly two places, `panel_color_settings.cpp:171`
   * and `:187`, and BOTH are inside `OnThemeChanged`. Neither
   * `PANEL_COLOR_SETTINGS`' constructor nor `PANEL_EESCHEMA_COLOR_SETTINGS`'
   * touches it, and a wxCheckBox is born enabled — so the box is live when the
   * page opens, whatever theme is selected, and goes grey only once the user
   * switches to a read-only one. A live 10.0.5 shows it enabled on
   * "KiCad Default (read-only)". Reading `:171` as a rule about read-only
   * themes greyed it permanently instead.
   */
  const [overrideEnabled, setOverrideEnabled] = useState(true);

  /**
   * The WORKING COPY's flag — `m_currentSettings->SetOverrideSchItemColors( … )`
   * (`panel_eeschema_color_settings.cpp:552`).
   *
   * `m_currentSettings` is a COPY of the selected theme, so a tick takes effect
   * at once even on a read-only one; `saveCurrentTheme` simply never writes that
   * file, and the next theme change loads the new theme's own value over it
   * (`SetValue( selected->GetOverrideSchItemColors() )`). Null means "not
   * touched since the last theme change", so the theme's stored value shows —
   * which for either built-in is `color_settings.cpp:49`'s false.
   */
  const [workingOverride, setWorkingOverride] = useState<boolean | null>(null);

  /**
   * `!m_currentSettings->IsReadOnly()`, which is `m_writeFile`
   * (`json_settings.h:105`). The built-ins clear it in
   * `CreateBuiltinColorSettings` and everything under the system and
   * third-party colour directories gets `SetReadOnly( true )`; a theme
   * `AddNewColorSettings` made has a file of its own and is writable, exactly
   * like `user.json`.
   */
  const writable = themeId === 'user' || themeId in userThemes;
  const stored = userThemes[themeId];
  const override =
    workingOverride ??
    (themeId === 'user' ? eeschema.appearance.override_item_colors : (stored?.override ?? false));

  /** `m_currentSettings->SetColor( layer, … )` on whichever theme is selected. */
  const setThemeColor = (key: string, css: string): void => {
    if (stored) {
      setUserThemes((t) => ({
        ...t,
        [themeId]: { ...stored, colors: { ...stored.colors, [key]: css } },
      }));
      return;
    }
    setUserColors((c) => ({ ...c, [key]: css }));
  };

  // `m_validLayers` crossed with `createSwatches()`, in that function's own
  // order. A row whose `key` is null has no field on our painter's `Theme`, so
  // it reads the theme table directly and cannot be edited.
  const rows: ColorSwatchRow[] = COLOR_LAYERS.filter(
    /*
     * `updateAllowedSwatches` (`panel_eeschema_color_settings.cpp:536-548`):
     *
     *     // If the theme is not overriding individual item colors then don't
     *     // show them so that the user doesn't get seduced into thinking
     *     // they'll have some effect.
     *     m_labels[ LAYER_SHEET ]->Show( …GetOverrideSchItemColors() );
     *     m_swatches[ LAYER_SHEET ]->Show( … );
     *     m_labels[ LAYER_SHEET_BACKGROUND ]->Show( … );
     *     m_swatches[ LAYER_SHEET_BACKGROUND ]->Show( … );
     *
     * A hidden wxWindow takes no space in its sizer, so the two rows are gone
     * from the list rather than greyed in it.
     */
    ({ layer }) => override || (layer !== 'LAYER_SHEET' && layer !== 'LAYER_SHEET_BACKGROUND'),
  ).map(({ layer, name, key }) => ({
    id: layer,
    name,
    color: key ? parseColor4d(activeColors[key]) : (raw[layer] ?? COLOR4D_UNSPECIFIED),
    // Upstream a read-only THEME disables the whole panel; `key === null` is
    // our separate reason, a layer with no reader on this side.
    disabled: !writable || key === null,
    ...(key
      ? {
          onChange: (picked: Color4d): void => {
            setThemeColor(key, toCssColor(picked, ', '));
          },
        }
      : {}),
  }));

  /**
   * The base class's two theme commands, with this page's namespace filled in
   * (`PanelColorSettings`' `ColorThemeIo`).
   */
  const themeIo: ColorThemeIo = {
    files: themeFiles,
    /*
     * `for( int layer : m_validLayers )
     *      newSettings->SetColor( layer, m_currentSettings->GetColor( layer ) );`
     * — seeded from the theme that was SELECTED, not from the defaults, so
     * "New Theme..." on KiCad Classic gives you Classic to edit.
     */
    seed: () => {
      const out: Record<string, string> = {};
      for (const { key } of COLOR_LAYERS) if (key) out[key] = activeColors[key] as string;
      return out;
    },
    override,
    onImport: (contents) => {
      /*
       * Upstream a file dropped in the folder becomes a theme of its own;
       * here the one writable theme takes the colours, and the chooser is
       * switched to it so the page shows what was imported. A layer the
       * file did not name falls back to the default rather than keeping
       * what the previous theme had, which is `COLOR_MAP_PARAM::Load`'s
       * `aResetIfMissing`: the file is the whole theme, not a patch.
       */
      const next: Record<string, string> = {};
      for (const { layer, key } of COLOR_LAYERS) {
        const css = contents.colors[layer as SchLayerId];
        if (key && css !== undefined) next[key] = css;
      }
      setUserColors(() => next);
      upE((s) => {
        s.appearance.color_theme = 'user';
        s.appearance.override_item_colors = contents.override;
      });
    },
    // `m_cbTheme->SetSelection( idx )`, then `Enable( !IsReadOnly() )`.
    onThemeCreated: (name) => {
      setWorkingOverride(null);
      setOverrideEnabled(true);
      upE((st) => {
        st.appearance.color_theme = name;
      });
    },
    userThemes,
    setUserThemes,
  };

  return (
    <PanelColorSettings
      themeId={themeId}
      onThemeChange={(v) => {
        // `OnThemeChanged`, in its order: the new theme's flag, then whether
        // it can be edited at all.
        setWorkingOverride(null);
        setOverrideEnabled(v === 'user' || v in userThemes);
        upE((s) => {
          s.appearance.color_theme = v;
        });
      }}
      rows={rows}
      showOverrideColors
      overrideColors={override}
      overrideColorsEnabled={overrideEnabled}
      onOverrideColorsChange={(v: boolean) => {
        setWorkingOverride(v);
        // `saveCurrentTheme` writes only a theme it can write, so a tick on a
        // read-only one lives as long as the page and no longer.
        if (stored) setUserThemes((t) => ({ ...t, [themeId]: { ...stored, override: v } }));
        else if (themeId === 'user')
          upE((s) => {
            s.appearance.override_item_colors = v;
          });
      }}
      userThemes={userThemes}
      themeIo={themeIo}
      /* `backgroundColor = m_currentSettings->GetColor( m_backgroundLayer )`
         (`panel_color_settings.cpp:262`) — the theme's own schematic
         background, which is what a half-transparent colour is
         checkerboarded against. */
      background={parseColor4d(activeColors.background)}
      /* `m_preview`, the SCH_PREVIEW_PANEL (`:218-227`). eeschema and pcbnew
         are the only two pages that fill `m_previewPanelSizer`. */
      preview={<ColorPreviewPanel theme={activeColors} overrideItemColors={override} />}
    />
  );
}
