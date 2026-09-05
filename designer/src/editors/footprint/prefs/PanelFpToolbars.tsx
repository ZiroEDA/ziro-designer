// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Toolbars — `PANEL_TOOLBAR_CUSTOMIZATION`,
 * the shared panel, constructed for this app:
 *
 *     TOOLBAR_SETTINGS* tb = GetToolbarSettings<FOOTPRINT_EDIT_TOOLBAR_SETTINGS>(
 *                                "fpedit-toolbars" );
 *     return new PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb,
 *                                             FRAME_FOOTPRINT_EDITOR, actions, controls );
 *     (pcbnew/pcbnew.cpp:381-390)
 *
 * `AddLazySubPage( LAZY_CTOR( PANEL_FP_TOOLBARS ), _( "Toolbars" ) )` is the
 * sixth row under the Footprint Editor heading (`eda_base_frame.cpp:1672`).
 * The heading and this page were missing here entirely, so the editor drew
 * `FP_*_TOOLBAR` directly and there was nothing to customise.
 */
import type { JSX } from 'react';
import { PanelToolbarCustomization } from '../../../dialogs/prefs/PanelToolbarCustomization.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { FP_DEFAULT_TOOLBARS } from '../footprintToolbars.js';

export function PanelFpToolbars({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return (
    <PanelToolbarCustomization
      app="fpedit"
      defaults={FP_DEFAULT_TOOLBARS}
      custom={ctx.fpEdit.appearance.custom_toolbars}
      setCustom={(v) => {
        ctx.upFp((s) => {
          s.appearance.custom_toolbars = v;
        });
      }}
      store={ctx.toolbars.fpedit}
      update={(fn) => ctx.upTb('fpedit', fn)}
    />
  );
}
