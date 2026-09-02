// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Colors — `PANEL_GERBVIEW_COLOR_SETTINGS`
 * (`gerbview/dialogs/panel_gerbview_color_settings.cpp`), constructed by
 * gerbview's KIFACE for `PANEL_GBR_COLORS` (`gerbview/gerbview.cpp:93-94`).
 *
 * **Verified, not assumed**: its header really does say
 * `class PANEL_GERBVIEW_COLOR_SETTINGS : public PANEL_COLOR_SETTINGS`
 * (`panel_gerbview_color_settings.h:31`), so it shares eeschema's base and gets
 * the swatch grid. `PANEL_SYM_COLOR_SETTINGS` and
 * `PANEL_PL_EDITOR_COLOR_SETTINGS` do NOT — they derive from `RESETTABLE_PANEL`
 * and are a theme choice alone — which is why the base is checked in the header
 * rather than inferred from the page's name.
 *
 * The subclass contributes exactly four things, and they are the four props
 * `PanelColorSettings` takes:
 *
 *   - `m_validLayers`: the 128 graphic layers then the seven fixed ones, in
 *     layer-id order (`:52-58`) — `gerbviewColorLayers.ts`;
 *   - `createSwatches()`: the name beside each (`:84-107`);
 *   - `m_backgroundLayer = LAYER_GERBVIEW_BACKGROUND` (`:61`);
 *   - `m_optOverrideColors->Hide()` (`:49-50`), "Currently this only applies to
 *     eeschema" — so that checkbox is ABSENT here, not greyed.
 *
 * It installs nothing in `m_previewPanelSizer`, unlike eeschema's and
 * pcbnew's, so the space beside the list is empty. Reproduced: the list is
 * proportion zero and does not spread into it.
 */
import { useMemo, type JSX } from 'react';
import {
  PanelColorSettings,
  type ColorSwatchRow,
} from '../../../dialogs/prefs/PanelColorSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { COLOR4D_UNSPECIFIED, parseColor4d, toCssColor } from '@ziroeda/common/src/color4d.js';
import {
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_FIXED_LAYERS,
  gerbviewColor,
  graphicLayerDefault,
  graphicLayerKey,
  graphicLayerName,
} from '../gerbviewColorLayers.js';
import { GERBER_BG_COLOR } from '../gerberColors.js';

export function PanelGerbviewColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { gerbview, upGbr, userColors, setUserColors } = ctx;

  /**
   * A swatch is answerable only on the "User" theme, for the reason every
   * swatch on eeschema's page is: upstream `PANEL_COLOR_SETTINGS` writes into
   * `m_currentSettings`, and a built-in theme's file `IsReadOnly()` so the edit
   * is never saved — `ResetPanel` returns early on exactly that check
   * (`panel_color_settings.cpp:74-75`).
   */
  const editable = gerbview.appearance.color_theme === 'user';

  const rows = useMemo<ColorSwatchRow[]>(() => {
    const set = (key: string) => (picked: { r: number; g: number; b: number; a: number }) => {
      setUserColors((c) => ({ ...c, [key]: toCssColor(picked, ', ') }));
    };

    const graphic: ColorSwatchRow[] = [];
    for (let row = 0; row < GERBER_DRAWLAYERS_COUNT; row++) {
      const fallback = graphicLayerDefault(row);
      const key = graphicLayerKey(row);
      const stored = userColors[key];
      graphic.push({
        id: key,
        name: graphicLayerName(row),
        // A layer past the default theme's 64 with no override of its own is
        // COLOR4D::UNSPECIFIED — the transparent colour a swatch draws as the
        // bare checkerboard, which is what upstream shows there too.
        color:
          stored !== undefined
            ? parseColor4d(stored)
            : fallback !== null
              ? parseColor4d(fallback)
              : COLOR4D_UNSPECIFIED,
        ...(editable ? { onChange: set(key) } : {}),
      });
    }

    const fixed: ColorSwatchRow[] = GERBVIEW_FIXED_LAYERS.map((l) => ({
      id: l.key,
      name: l.name,
      color: parseColor4d(gerbviewColor(l.key, l.fallback, userColors)),
      ...(editable ? { onChange: set(l.key) } : {}),
    }));

    // `m_validLayers`' two loops, in that order: the graphic layers, then the
    // fixed ones.
    return [...graphic, ...fixed];
  }, [userColors, editable, setUserColors]);

  return (
    <PanelColorSettings
      themeId={gerbview.appearance.color_theme}
      onThemeChange={(v) =>
        upGbr((s) => {
          s.appearance.color_theme = v;
        })
      }
      rows={rows}
      /* `m_backgroundLayer = LAYER_GERBVIEW_BACKGROUND` (`:61`) — GerbView's
         own canvas black, not the dialog's face colour and not the
         schematic's. */
      background={parseColor4d(gerbviewColor('gerbview.background', GERBER_BG_COLOR, userColors))}
      /* `m_optOverrideColors->Hide()` (`:49-50`). */
      showOverrideColors={false}
    />
  );
}
