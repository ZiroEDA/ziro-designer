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
} from '../../../dialogs/prefs/PanelColorSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { pcm, usePcmVersion } from '../../../pcm/pcmStore.js';
import { BUILTIN_THEMES, KICAD_DEFAULT, type Theme } from '../theme.js';
import { ColorPreviewPanel } from './ColorPreviewPanel.js';
import { BUILTIN_CLASSIC_THEME, BUILTIN_DEFAULT_THEME, type Color4d } from '@ziroeda/common';
import { COLOR4D_UNSPECIFIED, parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';
import type { SchLayerId } from '@ziroeda/common/src/settings/color_theme_file.js';
import {
  ThemeFolderDialog,
  type FolderFile,
  type ThemeFile,
} from '../../../dialogs/prefs/dialog_theme_folder.js';
import {
  PICK_CANCELLED,
  pickThemeFolder,
  readThemeFolder,
  writeThemeFile,
  type ThemeDirHandle,
} from '../../../fs/theme_folder.js';

/** One row of `m_colorsGridSizer`: a swatch and the layer's name. */
export interface ColorRowSpec {
  /** The `SCH_LAYER_ID` enumerator, which is also the key of a theme's table. */
  layer: string;
  /** `LayerName( layer )` (`common/layer_id.cpp:71-120`). */
  name: string;
  /**
   * The `Theme` field our painter reads that layer through, or null where it
   * reads none — those rows are drawn from the theme's own table and disabled,
   * for the same reason every other unread control on this dialog is.
   */
  key: keyof Theme | null;
}

/**
 * `createSwatches` (`panel_eeschema_color_settings.cpp:184-215`): every
 * `SCH_LAYER_ID` from `SCH_LAYER_ID_START` to `SCH_LAYER_ID_END` except the
 * four in `g_excludedLayers` (`:52-58`), sorted by `LayerName`, with
 * `LAYER_SCHEMATIC_GRID_AXES` alone getting " (symbol editor only)" appended
 * (`:206-207`).
 *
 * The sort is `wxString::operator<`, a plain byte comparison, which is why
 * "Bus junctions" precedes "Buses" (space < 'e') and "Pin names" precedes
 * "Pins". The order below is that comparison applied to the names, not an
 * alphabetisation of our own.
 */
export const COLOR_LAYERS: readonly ColorRowSpec[] = [
  { layer: 'LAYER_SCHEMATIC_ANCHOR', name: 'Anchors', key: 'anchor' },
  { layer: 'LAYER_SCHEMATIC_GRID_AXES', name: 'Axes (symbol editor only)', key: 'gridAxes' },
  { layer: 'LAYER_SCHEMATIC_BACKGROUND', name: 'Background', key: 'background' },
  { layer: 'LAYER_BUS_JUNCTION', name: 'Bus junctions', key: 'busJunction' },
  { layer: 'LAYER_BUS', name: 'Buses', key: 'bus' },
  { layer: 'LAYER_SCHEMATIC_CURSOR', name: 'Cursor', key: 'cursor' },
  { layer: 'LAYER_DNP_MARKER', name: 'DNP markers', key: 'dnpMarker' },
  { layer: 'LAYER_DRAG_NET_COLLISION', name: 'Drag net collisions', key: 'dragNetCollision' },
  { layer: 'LAYER_SCHEMATIC_DRAWINGSHEET', name: 'Drawing sheet', key: 'pageFrame' },
  { layer: 'LAYER_ERC_ERR', name: 'ERC errors', key: 'ercError' },
  { layer: 'LAYER_ERC_EXCLUSION', name: 'ERC exclusions', key: 'ercExclusion' },
  { layer: 'LAYER_ERC_WARN', name: 'ERC warnings', key: 'ercWarning' },
  {
    layer: 'LAYER_EXCLUDED_FROM_SIM',
    name: 'Excluded-from-simulation markers',
    key: 'excludedFromSim',
  },
  { layer: 'LAYER_GLOBLABEL', name: 'Global labels', key: 'globalLabel' },
  { layer: 'LAYER_SCHEMATIC_GRID', name: 'Grid', key: 'grid' },
  { layer: 'LAYER_SCHEMATIC_AUX_ITEMS', name: 'Helper items', key: 'auxItems' },
  { layer: 'LAYER_HIDDEN', name: 'Hidden items', key: 'hidden' },
  { layer: 'LAYER_HIERLABEL', name: 'Hierarchical labels', key: 'hierLabel' },
  { layer: 'LAYER_BRIGHTENED', name: 'Highlighted items', key: 'netHighlight' },
  { layer: 'LAYER_HOVERED', name: 'Hovered items', key: null },
  { layer: 'LAYER_JUNCTION', name: 'Junctions', key: 'junction' },
  { layer: 'LAYER_LOCLABEL', name: 'Labels', key: 'label' },
  { layer: 'LAYER_NETCLASS_REFS', name: 'Net class references', key: 'netclassFlag' },
  { layer: 'LAYER_NOCONNECT', name: 'No-connect symbols', key: 'noConnect' },
  { layer: 'LAYER_OP_CURRENTS', name: 'Operating point currents', key: null },
  { layer: 'LAYER_OP_VOLTAGES', name: 'Operating point voltages', key: null },
  { layer: 'LAYER_SCHEMATIC_PAGE_LIMITS', name: 'Page limits', key: 'pageLimits' },
  { layer: 'LAYER_PINNAM', name: 'Pin names', key: 'pinName' },
  { layer: 'LAYER_PINNUM', name: 'Pin numbers', key: 'pinNumber' },
  { layer: 'LAYER_PIN', name: 'Pins', key: 'pin' },
  { layer: 'LAYER_RULE_AREAS', name: 'Rule areas', key: 'ruleArea' },
  // `_( "Schematic text && graphics" )` — a wxStaticText label escapes the
  // mnemonic, so what a user reads is one ampersand.
  { layer: 'LAYER_NOTES', name: 'Schematic text & graphics', key: 'noteLine' },
  { layer: 'LAYER_SELECTION_SHADOWS', name: 'Selection highlight', key: 'selectionShadow' },
  { layer: 'LAYER_SHAPES_BACKGROUND', name: 'Shape fills', key: null },
  { layer: 'LAYER_SHEET_BACKGROUND', name: 'Sheet backgrounds', key: 'sheetBackground' },
  { layer: 'LAYER_SHEET', name: 'Sheet borders', key: 'sheetBorder' },
  { layer: 'LAYER_SHEETFIELDS', name: 'Sheet fields', key: 'sheetFields' },
  { layer: 'LAYER_SHEETFILENAME', name: 'Sheet file names', key: 'sheetFile' },
  { layer: 'LAYER_SHEETNAME', name: 'Sheet names', key: 'sheetName' },
  { layer: 'LAYER_SHEETLABEL', name: 'Sheet pins', key: 'sheetLabel' },
  { layer: 'LAYER_INTERSHEET_REFS', name: 'Sheet references', key: null },
  { layer: 'LAYER_DEVICE_BACKGROUND', name: 'Symbol body fills', key: 'symbolFill' },
  { layer: 'LAYER_DEVICE', name: 'Symbol body outlines', key: 'symbolOutline' },
  { layer: 'LAYER_FIELDS', name: 'Symbol fields', key: 'fields' },
  { layer: 'LAYER_PRIVATE_NOTES', name: 'Symbol private text & graphics', key: 'privateNote' },
  { layer: 'LAYER_REFERENCEPART', name: 'Symbol references', key: 'reference' },
  { layer: 'LAYER_VALUEPART', name: 'Symbol values', key: 'value' },
  { layer: 'LAYER_WIRE', name: 'Wires', key: 'wire' },
];

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

/**
 * The theme's colour table keyed the way a COLOR_SETTINGS file keys it.
 *
 * `Theme` is the painter's projection and has no field for six of the layers,
 * so those are simply absent — `colorThemeToFile` falls back to
 * `s_defaultTheme` for them, which is what `COLOR_MAP_PARAM`'s default is.
 */
const themeByLayer = (theme: Theme): Partial<Record<SchLayerId, string>> => {
  const out: Partial<Record<SchLayerId, string>> = {};
  for (const { layer, key } of COLOR_LAYERS)
    if (key) out[layer as SchLayerId] = theme[key] as string;
  return out;
};

export function PanelEeschemaColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE, userColors, setUserColors } = ctx;
  const [themeFolder, setThemeFolder] = useState(false);
  /**
   * The picked directory, once the user has granted one. Null means the browser
   * would not open a folder, and the dialog offers files instead — see
   * `fs/theme_folder.ts`.
   */
  const [dir, setDir] = useState<ThemeDirHandle | null>(null);
  const [folderFiles, setFolderFiles] = useState<readonly FolderFile[]>([]);

  /**
   * `LaunchExternal( GetColorSettingsPath() )`, as near as a page gets: the
   * desktop's folder chooser, then the folder's own theme files.
   *
   * A cancel does nothing at all — the same `AbortError` branch
   * `HomePage.openProjectPicker` has, because closing a chooser you did not
   * want should not leave a dialog behind.
   */
  const openThemeFolder = async (): Promise<void> => {
    const picked = await pickThemeFolder();
    if (picked === PICK_CANCELLED) return;
    if (typeof picked === 'string') {
      setDir(null);
      setFolderFiles([]);
    } else {
      setDir(picked);
      try {
        setFolderFiles(await readThemeFolder(picked));
      } catch {
        // A folder we can open but not list is still a folder to write into.
        setFolderFiles([]);
      }
    }
    setThemeFolder(true);
  };

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
    return { ...KICAD_DEFAULT, ...userColors } as Theme;
  }, [themeId, userColors]);

  const raw = rawTable(themeId);

  /*
   * What the folder holds. KiCad's colour-theme directory contains the themes
   * a user made and the ones the PCM installed — never the two built-ins,
   * which are compiled in and have no file (`COLOR_BUILTIN_DEFAULT`,
   * `color_settings.cpp:34-35`).
   */
  const themeFiles: readonly ThemeFile[] = [
    {
      fileName: 'user.json',
      name: 'User',
      contents: {
        name: 'User',
        colors: themeByLayer({ ...KICAD_DEFAULT, ...userColors } as Theme),
        override: eeschema.appearance.override_item_colors,
      },
      writable: true,
    },
    ...pcm.installedThemes().map(({ id, name, theme }) => ({
      fileName: `${id.replace(/^pcm:/, '')}.json`,
      name,
      contents: { name, colors: themeByLayer(theme), override: false },
      writable: false,
    })),
  ];

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
  const override =
    workingOverride ?? (themeId === 'user' && eeschema.appearance.override_item_colors);

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
    disabled: themeId !== 'user' || key === null,
    ...(key
      ? {
          onChange: (picked: Color4d): void => {
            setUserColors((c) => ({ ...c, [key]: toCssColor(picked, ', ') }));
          },
        }
      : {}),
  }));

  return (
    <>
      <PanelColorSettings
        themeId={themeId}
        onThemeChange={(v) => {
          // `OnThemeChanged`, in its order: the new theme's flag, then whether
          // it can be edited at all.
          setWorkingOverride(null);
          setOverrideEnabled(v === 'user');
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
          if (themeId === 'user')
            upE((s) => {
              s.appearance.override_item_colors = v;
            });
        }}
        onOpenThemeFolder={() => void openThemeFolder()}
        /* `backgroundColor = m_currentSettings->GetColor( m_backgroundLayer )`
         (`panel_color_settings.cpp:262`) — the theme's own schematic
         background, which is what a half-transparent colour is
         checkerboarded against. */
        background={parseColor4d(activeColors.background)}
        /* `m_preview`, the SCH_PREVIEW_PANEL (`:218-227`). eeschema and pcbnew
         are the only two pages that fill `m_previewPanelSizer`. */
        preview={<ColorPreviewPanel theme={activeColors} overrideItemColors={override} />}
      />
      {themeFolder && (
        <ThemeFolderDialog
          files={themeFiles}
          {...(dir ? { folderName: dir.name } : {})}
          folderFiles={folderFiles}
          {...(dir
            ? {
                onWriteToFolder: async (fileName: string, text: string): Promise<string> => {
                  try {
                    await writeThemeFile(dir, fileName, text);
                    setFolderFiles(await readThemeFolder(dir));
                    return '';
                  } catch (e) {
                    return `Could not write ${fileName}: ${(e as Error)?.message ?? 'refused'}`;
                  }
                },
              }
            : {})}
          onImport={(contents) => {
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
          }}
          onClose={() => setThemeFolder(false)}
        />
      )}
    </>
  );
}
