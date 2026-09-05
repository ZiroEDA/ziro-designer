// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > 3D Viewer > Toolbars — `PANEL_TOOLBAR_CUSTOMIZATION`, the
 * shared panel, constructed for this app:
 *
 *     APP_SETTINGS_BASE* cfg = GetAppSettings<EDA_3D_VIEWER_SETTINGS>( "3d_viewer" );
 *     TOOLBAR_SETTINGS*  tb  = GetToolbarSettings<EDA_3D_VIEWER_TOOLBAR_SETTINGS>(
 *                                  "3d_viewer-toolbars" );
 *     return new PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb,
 *                                             FRAME_PCB_DISPLAY3D, actions, controls );
 *     (pcbnew/pcbnew.cpp:481-491)
 *
 * The 3D Viewer is a heading of its own under pcbnew's KIFACE
 * (`eda_base_frame.cpp:1691-1696`) with Toolbars as its second row, and it has
 * a settings file of its own — which is why the "Customize toolbars" checkbox
 * writes `3d_viewer.json` and not `pcbnew.json`.
 */
import type { JSX } from 'react';
import { PanelToolbarCustomization } from '../../../dialogs/prefs/PanelToolbarCustomization.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { VIEWER3D_DEFAULT_TOOLBARS } from '../viewer3dToolbars.js';

export function PanelViewer3dToolbars({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return (
    <PanelToolbarCustomization
      app="3d_viewer"
      defaults={VIEWER3D_DEFAULT_TOOLBARS}
      custom={ctx.viewer3d.appearance.custom_toolbars}
      setCustom={(v) => {
        ctx.up3d((s) => {
          s.appearance.custom_toolbars = v;
        });
      }}
      store={ctx.toolbars['3d_viewer']}
      update={(fn) => ctx.upTb('3d_viewer', fn)}
    />
  );
}
