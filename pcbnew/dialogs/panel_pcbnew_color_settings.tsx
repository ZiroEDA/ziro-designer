// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_PCBNEW_COLOR_SETTINGS` (`pcbnew/dialogs/panel_pcbnew_color_settings.cpp`),
 * with the layer table it builds its swatches from (`pcbColorLayers.ts`).
 *
 * The program's part (PCM themes, theme files) arrives as a
 * `PANEL_COLOR_SETTINGS_HOST`, and the board preview (`m_previewPanel`, a
 * `PCB_DRAW_PANEL_GAL` upstream) as a render prop: it is a 2D paint today and
 * belongs to the WebGL stage, not to this file.
 */
import { useMemo, type JSX, type ReactNode } from 'react';
import { parseColor4d, toCssColor, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/settings/builtin_color_themes.js';
import { LayerName, LayerSelectorUIOrder, LSET_Name } from '@ziroeda/common/layer_ids.js';
import {
  BOARD_COLOR_KEYS,
  type UserColorTheme,
} from '@ziroeda/common/settings/color_theme_file.js';
import {
  PanelColorSettings,
  type ColorSwatchRow,
  type ColorThemeIo,
} from '@ziroeda/common/dialogs/panel_color_settings.js';
import { pcbThemeWithOverrides } from '../pcbTheme.js';
import {
  GAL_COLOR_ROWS,
  type FpColorLayer,
  type PANEL_COLOR_SETTINGS_CTX_BASE,
  type PANEL_COLOR_SETTINGS_HOST,
} from './panel_fp_editor_color_settings.js';

// ---------------------------------------------------------------------------
// The layer table (was pcbColorLayers.ts)
// ---------------------------------------------------------------------------
/**
 * `PANEL_PCBNEW_COLOR_SETTINGS`' `m_validLayers` and `createSwatches`
 * (`pcbnew/dialogs/panel_pcbnew_color_settings.cpp:690-780`), as data.
 *
 * The board editor's Colors page is the footprint editor's with a longer list,
 * and the shape of the difference is exactly two statements:
 *
 *     for( int id = GAL_LAYER_ID_START; id < GAL_LAYER_ID_BITMASK_END; id++ )
 *         if( !g_excludedLayers.count( id ) ) m_validLayers.push_back( id );
 *
 * — where the footprint editor's own version skips five more ids (the vias and
 * the pad plated holes), because a footprint has neither — and:
 *
 *     for( PCB_LAYER_ID layer : LAYER_RANGE( F_Cu, B_Cu, MAX_CU_LAYERS ) )
 *         m_validLayers.insert( m_validLayers.begin() + i++, layer );
 *     for( PCB_LAYER_ID layer : LSET::AllNonCuMask().TechAndUserUIOrder() )
 *         m_validLayers.insert( m_validLayers.begin() + i++, layer );
 *
 * — every board layer, in UI order, ahead of the sorted GAL rows, where the
 * footprint editor emits three copper rows and calls the middle one
 * "Internal Layers".
 *
 * The namespace is `board` on both pages (`m_colorNamespace = "board"`), so a
 * colour changed on either moves the other and both move the canvas. That is
 * upstream's, not a shortcut here: `editors/footprint/fpColorLayers.ts` is the
 * same table for the shorter list, and `pcbTheme.ts`' `pcbThemeWithOverrides`
 * is what turns either into a theme.
 */

export type PcbColorLayer = FpColorLayer;

/**
 * The GAL rows this page keeps and the FOOTPRINT editor's drops
 * (`panel_fp_editor_color_settings.cpp:56-65`): a footprint has no via, so
 * `LAYER_VIA_HOLES` and `LAYER_VIA_HOLEWALLS` have nothing to colour there.
 *
 * **`LAYER_PAD_PLATEDHOLES` is not one of them.** It is in `g_excludedLayers`
 * (`panel_pcbnew_color_settings.cpp:674`), so neither page shows it — even
 * though `board.pad_plated_hole` is a real key `color_settings.cpp:135` binds.
 * The exclusion list and the key list are two different questions, and reading
 * the second for the first puts a swatch on this page that KiCad does not have.
 */
const PCB_ONLY_GAL_ROWS: readonly PcbColorLayer[] = [
  { key: 'board.via_hole', name: 'Via holes', layer: 'LAYER_VIA_HOLES' },
  { key: 'board.via_hole_walls', name: 'Via hole walls', layer: 'LAYER_VIA_HOLEWALLS' },
];

/**
 * `board.copper.<f|b|in1…>` for a copper layer, `board.<layer>` otherwise —
 * the same key `pcbThemeWithOverrides` reads back
 * (`common/settings/color_settings.cpp:124-190`).
 */
export function boardColorKey(name: string): string {
  return /\.Cu$/.test(name)
    ? `board.copper.${name.replace(/\.Cu$/, '').toLowerCase()}`
    : `board.${name.replace('.', '_').toLowerCase()}`;
}

/**
 * The rows the page draws, in `createSwatches`' order: every board layer in
 * `LSET`'s UI order — copper first, then technical and user — and then the GAL
 * layers sorted by name.
 *
 * The board layers are NOT sorted ("Don't sort aBoard layers by name",
 * `:761`), and the GAL ones are, with `LayerName( a ) < LayerName( b )` — a
 * codepoint comparison, so every capital sorts before every lowercase and "DRC
 * errors" comes before "Drawing sheet". `localeCompare` would put them the
 * other way round.
 */
export function pcbColorRows(): readonly PcbColorLayer[] {
  const board: PcbColorLayer[] = LayerSelectorUIOrder().map((id) => {
    // The KEY is `LSET::Name` — the canonical token, `F.SilkS` — and the LABEL
    // is `LayerName`, which shows that layer as `F.Silkscreen`. Reading one for
    // the other is how a swatch ends up writing a key nothing reads back.
    const canonical = LSET_Name(id);
    return {
      key: boardColorKey(canonical),
      name: LayerName(canonical),
      layer: canonical.replace('.', '_') as PcbColorLayer['layer'],
    };
  });
  const gal = [...GAL_COLOR_ROWS, ...PCB_ONLY_GAL_ROWS].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return [...board, ...gal];
}

/** `LAYER_PCB_BACKGROUND` — `m_backgroundLayer` (`:725`). */
export const PCB_COLOR_BACKGROUND_KEY = 'board.background';

/** A row's colour with no user override: `s_defaultTheme`'s entry for its layer. */
export function pcbDefaultColor(row: PcbColorLayer): string {
  const c = BUILTIN_DEFAULT_THEME[row.layer] as Color4d | undefined;
  // A board layer with no entry in the built-in table cannot happen — every
  // `PCB_LAYER_ID` `color_settings.cpp` registers is in it — so this is a
  // missing row in that table rather than something to paint over.
  return toCssColor(c ?? (BUILTIN_DEFAULT_THEME.LAYER_GRID as Color4d));
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
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

export interface PANEL_PCBNEW_COLOR_SETTINGS_CTX extends PANEL_COLOR_SETTINGS_CTX_BASE {
  pcbnew: { appearance: { color_theme: string } };
  upP: (fn: (s: { appearance: { color_theme: string } }) => void) => void;
}

export function PanelPcbColorSettings({
  ctx,
  host,
  renderPreview,
}: {
  ctx: PANEL_PCBNEW_COLOR_SETTINGS_CTX;
  host: PANEL_COLOR_SETTINGS_HOST;
  /** `m_previewPanel`, painted from the theme AS EDITED. */
  renderPreview: (theme: ReturnType<typeof pcbThemeWithOverrides>) => ReactNode;
}): JSX.Element {
  // Re-render when a PCM theme is installed, as the choice used to itself.
  host.usePcmVersion();
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
    files: host.themeFilesFor(userColors, eeschema.appearance.override_item_colors),
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
      installedThemes={host.colorSettingsList()}
      themeId={themeId}
      /* `m_previewPanelSizer`, which only eeschema's and pcbnew's pages fill. */
      preview={renderPreview(previewTheme)}
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
