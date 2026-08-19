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
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood no
 * behaviour change. The theme derivation came with it: `usePcmVersion`, the
 * installed-theme list and `activeColors` were declared in the dialog but read
 * only by this page, so they belong to it. Nothing else re-rendered on them.
 */
import { useMemo, type JSX } from 'react';
import { Group, Sel, joinCss, splitCss } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { pcm, usePcmVersion } from '../../../pcm/pcmStore.js';
import { BUILTIN_THEMES, KICAD_DEFAULT, type Theme } from '../theme.js';

/** The Colors page rows: KiCad layer display names (common/layer_id.cpp) -> Theme keys. */
const COLOR_LAYERS: [keyof Theme, string][] = [
  ['anchor', 'Anchors'],
  ['background', 'Background'],
  ['netHighlight', 'Highlighted items'],
  ['bus', 'Buses'],
  ['busJunction', 'Bus junctions'],
  ['symbolFill', 'Symbol body fills'],
  ['symbolOutline', 'Symbol body outlines'],
  ['cursor', 'Cursor'],
  ['ercError', 'ERC errors'],
  ['ercWarning', 'ERC warnings'],
  ['fields', 'Symbol fields'],
  ['grid', 'Grid'],
  ['hidden', 'Hidden items'],
  ['junction', 'Junctions'],
  ['globalLabel', 'Global labels'],
  ['hierLabel', 'Hierarchical labels'],
  ['label', 'Labels'],
  ['noConnect', 'No-connect symbols'],
  ['noteLine', 'Schematic text & graphics'],
  ['privateNote', 'Symbol private text & graphics'],
  ['pin', 'Pins'],
  ['pinName', 'Pin names'],
  ['pinNumber', 'Pin numbers'],
  ['reference', 'Symbol references'],
  ['value', 'Symbol values'],
  ['selectionShadow', 'Selection highlight'],
  ['sheetBorder', 'Sheet borders'],
  ['sheetBackground', 'Sheet backgrounds'],
  ['sheetName', 'Sheet names'],
  ['sheetFields', 'Sheet fields'],
  ['sheetFile', 'Sheet file names'],
  ['sheetLabel', 'Sheet pins'],
  ['wire', 'Wires'],
  ['pageFrame', 'Drawing sheet'],
  ['pageLimits', 'Page limits'],
];

export function PanelEeschemaColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE, userColors, setUserColors } = ctx;

  usePcmVersion();
  // Colour themes installed via the Plugin and Content Manager, offered here
  // alongside the built-in themes.
  const installedThemes = pcm.installedThemes();
  const themeId = eeschema.appearance.color_theme;
  const activeColors: Theme = useMemo(() => {
    const builtin = BUILTIN_THEMES[themeId];
    if (builtin) return builtin.theme;
    const installed = pcm.themeById(themeId);
    if (installed) return installed;
    return { ...KICAD_DEFAULT, ...userColors } as Theme;
  }, [themeId, userColors]);

  return (
    <>
      <Group title="Theme">
        <Sel
          label="Theme:"
          value={themeId}
          options={[
            ['_builtin_default', 'KiCad Default'],
            ['_builtin_classic', 'KiCad Classic'],
            ...installedThemes.map((t): [string, string] => [t.id, t.name]),
            ['user', 'User'],
          ]}
          onChange={(v) =>
            upE((s) => {
              s.appearance.color_theme = v;
            })
          }
        />
        {themeId !== 'user' && (
          <div className="ze-muted">
            Built-in themes are read-only. Select the "User" theme to edit colors.
          </div>
        )}
      </Group>
      <Group title="Colors">
        <div className="ze-pref-colorgrid">
          {COLOR_LAYERS.map(([key, label]) => {
            const css = activeColors[key];
            const { hex, alpha } = splitCss(css);
            return (
              <label key={key} className="ze-pref-colorrow">
                <input
                  type="color"
                  value={hex}
                  disabled={themeId !== 'user'}
                  onChange={(e) =>
                    setUserColors((c) => ({ ...c, [key]: joinCss(e.target.value, alpha) }))
                  }
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </Group>
    </>
  );
}
