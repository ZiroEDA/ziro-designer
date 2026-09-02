// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Toolbars — `PANEL_TOOLBAR_CUSTOMIZATION`, the
 * shared panel, constructed for this app:
 *
 *     return new PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb, FRAME_GERBER,
 *                                             actions, controls );
 *     (gerbview/gerbview.cpp:96-110)
 *
 * Same five arguments every other KIFACE passes: the app's settings, its
 * `TOOLBAR_SETTINGS` file (`GetToolbarSettings<GERBVIEW_TOOLBAR_SETTINGS>(
 * "gerbview-toolbars" )`), its `FRAME_T`, and the action and control lists.
 * Ours passes the same things, with `GBR_DEFAULT_TOOLBARS` standing in for the
 * last three — see `ui/toolbar_config.ts`.
 */
import type { JSX } from 'react';
import { PanelToolbarCustomization } from '../../../dialogs/prefs/PanelToolbarCustomization.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { GBR_DEFAULT_TOOLBARS } from '../gerberToolbars.js';

export function PanelGerbviewToolbars({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return (
    <PanelToolbarCustomization
      app="gerbview"
      defaults={GBR_DEFAULT_TOOLBARS}
      custom={ctx.gerbview.appearance.custom_toolbars}
      setCustom={(v) => {
        ctx.upGbr((s) => {
          s.appearance.custom_toolbars = v;
        });
      }}
      store={ctx.toolbars.gerbview}
      update={(fn) => ctx.upTb('gerbview', fn)}
    />
  );
}
