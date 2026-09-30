// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_EDITOR_COLOR_SETTINGS` (`pcbnew/dialogs/panel_fp_editor_color_settings.cpp`),
 * with the layer table it builds its swatches from (`fpColorLayers.ts`, which the
 * PCB Editor's page shares).
 *
 * The three things `PANEL_COLOR_SETTINGS` gets from the PROGRAM — the PCM's
 * installed themes, the theme files the folder shows, and the re-render when a
 * package is installed — arrive as a `PANEL_COLOR_SETTINGS_HOST` prop; this module
 * names nothing of the designer.
 */
import { useMemo, type ComponentProps, type Dispatch, type JSX, type SetStateAction } from 'react';
import { parseColor4d, toCssColor, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/settings/builtin_color_themes.js';
import {
  BOARD_COLOR_KEYS,
  type UserColorTheme,
} from '@ziroeda/common/settings/color_theme_file.js';
import {
  PanelColorSettings,
  type ColorSwatchRow,
  type ColorThemeIo,
} from '@ziroeda/common/dialogs/panel_color_settings.js';

/** What the program hands a colour-settings page (see the file header). */
export interface PANEL_COLOR_SETTINGS_HOST {
  /** Re-render when a PCM theme is installed. */
  usePcmVersion: () => number;
  /** `COLOR_SETTINGS_MANAGER::GetColorSettingsList` as the chooser lists it. */
  colorSettingsList: () => ComponentProps<typeof PanelColorSettings>['installedThemes'];
  /** The `.json` theme files the folder holds, with the writable one first. */
  themeFilesFor: (
    userColors: Readonly<Record<string, string>>,
    override: boolean,
  ) => ColorThemeIo['files'];
}

/** The Preferences working copy a colour page reads and writes. */
export interface PANEL_COLOR_SETTINGS_CTX_BASE {
  eeschema: { appearance: { override_item_colors: boolean } };
  userColors: Record<string, string>;
  setUserColors: Dispatch<SetStateAction<Record<string, string>>>;
  userThemes: Record<string, UserColorTheme>;
  setUserThemes: Dispatch<SetStateAction<Record<string, UserColorTheme>>>;
}

// ---------------------------------------------------------------------------
// The layer table (was fpColorLayers.ts)
// ---------------------------------------------------------------------------
/**
 * `PANEL_FP_EDITOR_COLOR_SETTINGS`' `m_validLayers` and `createSwatches`
 * (`pcbnew/dialogs/panel_fp_editor_color_settings.cpp:50-113`), as data.
 *
 * The panel's whole contribution over `PANEL_COLOR_SETTINGS` is four
 * statements, and this file is two of them:
 *
 *     m_validLayers = { F_Cu, In1_Cu, B_Cu } + every GAL_LAYER_ID
 *                     except the five via/pad-hole ones          (`:50-67`)
 *     createSwatches(): F.Cu, _( "Internal Layers" ), B.Cu, then the GAL
 *                     layers SORTED BY NAME                      (`:90-113`)
 *
 * The other two are on the panel itself: `m_colorNamespace = "board"` — this
 * page edits the SAME rows the PCB Editor's does, which is why a colour changed
 * here shows up there — and `m_backgroundLayer = LAYER_PCB_BACKGROUND`.
 *
 * **The three copper rows are not `LayerName()`.** The middle one is spelled
 * `_( "Internal Layers" )` in the source (`:110`), plural, over `In1_Cu` alone:
 * a footprint's inner-copper items all share one colour because the frame's
 * dummy board has a single inner layer.
 *
 * Every colour is named, never typed: the values come from
 * `BUILTIN_DEFAULT_THEME`, the shared port of `builtin_color_themes.h`, through
 * `editors/pcb/pcbTheme.ts` — the same table the board editor paints from.
 */

/** One row of the swatch list: its `colors/user.json` key and its label. */
export interface FpColorLayer {
  /**
   * The stored key, `<namespace>.<layer>`. The namespace is `board`
   * (`panel_fp_editor_color_settings.cpp:34`), so these are pcbnew's rows and
   * not a set of the footprint editor's own — `color_settings.cpp:124-148` is
   * where each name is bound to its `LAYER_*` id.
   */
  key: string;
  /** `LayerName( id )` (`common/layer_id.cpp:130-160`), or the panel's own string. */
  name: string;
  /** The `LAYER_*` enumerator, which is how the default is looked up. */
  layer: keyof typeof BUILTIN_DEFAULT_THEME;
}

/**
 * The three copper rows, in `createSwatches`' own order — which is NOT the
 * sorted order the rest of the list is in, because upstream emits these three
 * before the loop.
 */
const COPPER_ROWS: readonly FpColorLayer[] = [
  { key: 'board.copper.f', name: 'F.Cu', layer: 'F_Cu' },
  // `createSwatch( In1_Cu, _( "Internal Layers" ) )` (`:110`).
  { key: 'board.copper.in1', name: 'Internal Layers', layer: 'In1_Cu' },
  { key: 'board.copper.b', name: 'B.Cu', layer: 'B_Cu' },
];

/**
 * Every `board.*` GAL layer `color_settings.cpp:124-147` binds, minus the five
 * `m_validLayers` skips.
 *
 * Exported because the PCB Editor's Colors page is this list PLUS the three of
 * those five that have a key — `editors/pcb/pcbColorLayers.ts` adds them rather
 * than restating the twenty rows they sit among.
 *
 * The five are `LAYER_VIAS`, `LAYER_VIA_HOLES`, `LAYER_VIA_HOLEWALLS`,
 * `LAYER_PAD_PLATEDHOLES` and `LAYER_PAD_HOLEWALLS`
 * (`panel_fp_editor_color_settings.cpp:56-65`) — a footprint has no vias, and
 * a pad's plated hole is painted in the background colour rather than a colour
 * of its own (`pcb_painter.cpp:158`), so neither has a colour to offer. Of
 * those five only `via_hole`, `via_hole_walls` and `pad_plated_hole` have a
 * `board.*` key at all; the other two are painter-side.
 *
 * NOT sorted here. `createSwatches` sorts at build time with
 * `LayerName( a ) < LayerName( b )`, a codepoint comparison, and doing it in
 * {@link fpColorRows} rather than freezing an order in this table is what keeps
 * the two agreeing when a row is added.
 */
export const GAL_COLOR_ROWS: readonly FpColorLayer[] = [
  { key: 'board.anchor', name: 'Anchors', layer: 'LAYER_ANCHOR' },
  { key: 'board.locked_shadow', name: 'Locked item shadow', layer: 'LAYER_LOCKED_ITEM_SHADOW' },
  {
    key: 'board.conflicts_shadow',
    name: 'Courtyard collision shadow',
    layer: 'LAYER_CONFLICTS_SHADOW',
  },
  { key: 'board.aux_items', name: 'Helper items', layer: 'LAYER_AUX_ITEMS' },
  { key: 'board.background', name: 'Background', layer: 'LAYER_PCB_BACKGROUND' },
  { key: 'board.cursor', name: 'Cursor', layer: 'LAYER_CURSOR' },
  { key: 'board.drc_error', name: 'DRC errors', layer: 'LAYER_DRC_ERROR' },
  { key: 'board.drc_warning', name: 'DRC warnings', layer: 'LAYER_DRC_WARNING' },
  { key: 'board.drc_exclusion', name: 'DRC exclusions', layer: 'LAYER_DRC_EXCLUSION' },
  { key: 'board.grid', name: 'Grid', layer: 'LAYER_GRID' },
  { key: 'board.grid_axes', name: 'Grid axes', layer: 'LAYER_GRID_AXES' },
  // `board.plated_hole` is LAYER_NON_PLATEDHOLES, not the plated one — that
  // pairing is upstream's and it is easy to read backwards
  // (`color_settings.cpp:135-136`).
  { key: 'board.plated_hole', name: 'Non-plated holes', layer: 'LAYER_NON_PLATEDHOLES' },
  { key: 'board.ratsnest', name: 'Ratsnest', layer: 'LAYER_RATSNEST' },
  { key: 'board.worksheet', name: 'Drawing sheet', layer: 'LAYER_DRAWINGSHEET' },
  { key: 'board.page_limits', name: 'Page limits', layer: 'LAYER_PAGE_LIMITS' },
  { key: 'board.outline_area', name: 'Board outline area', layer: 'LAYER_BOARD_OUTLINE_AREA' },
  { key: 'board.track_net_names', name: 'Track net names', layer: 'NETNAMES_LAYER_ID_START' },
  { key: 'board.pad_net_names', name: 'Pad net names', layer: 'LAYER_PAD_NETNAMES' },
  { key: 'board.via_net_names', name: 'Via net names', layer: 'LAYER_VIA_NETNAMES' },
  { key: 'board.points', name: 'Points', layer: 'LAYER_POINTS' },
];

/**
 * The rows the page draws, in `createSwatches`' order: the three copper rows,
 * then the GAL layers sorted by name.
 *
 * The sort is `std::sort( …, LayerName( a ) < LayerName( b ) )`
 * (`panel_fp_editor_color_settings.cpp:101-106`), which compares wxString by
 * code unit — so every capital sorts before every lowercase and "DRC errors"
 * comes before "Drawing sheet". `localeCompare` would put them the other way
 * round, which is the trap `net_colors_live_in_the_project` names.
 */
export function fpColorRows(): readonly FpColorLayer[] {
  const sorted = [...GAL_COLOR_ROWS].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return [...COPPER_ROWS, ...sorted];
}

/** `LAYER_PCB_BACKGROUND` — `m_backgroundLayer` (`:114`). */
export const FP_COLOR_BACKGROUND_KEY = 'board.background';

/** A row's colour with no user override: `s_defaultTheme`'s entry for its layer. */
export function fpDefaultColor(row: FpColorLayer): string {
  return toCssColor(BUILTIN_DEFAULT_THEME[row.layer] as Color4d);
}

/**
 * `m_backgroundLayer`'s default colour — `LAYER_PCB_BACKGROUND` out of
 * `s_defaultTheme`, which is the same value `pcbTheme.ts`' `PCB_BACKGROUND`
 * carries. Here rather than at the call site so the page states no colour of
 * its own, not even a fallback.
 */
export function fpBackgroundDefault(): string {
  return toCssColor(BUILTIN_DEFAULT_THEME.LAYER_PCB_BACKGROUND as Color4d);
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
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

export interface PANEL_FP_EDITOR_COLOR_SETTINGS_CTX extends PANEL_COLOR_SETTINGS_CTX_BASE {
  fpEdit: { appearance: { color_theme: string } };
  upFp: (fn: (s: { appearance: { color_theme: string } }) => void) => void;
}

export function PanelFpColorSettings({
  ctx,
  host,
}: {
  ctx: PANEL_FP_EDITOR_COLOR_SETTINGS_CTX;
  host: PANEL_COLOR_SETTINGS_HOST;
}): JSX.Element {
  // Re-render when a PCM theme is installed, as the choice used to itself.
  host.usePcmVersion();
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
    files: host.themeFilesFor(userColors, eeschema.appearance.override_item_colors),
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
      installedThemes={host.colorSettingsList()}
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
