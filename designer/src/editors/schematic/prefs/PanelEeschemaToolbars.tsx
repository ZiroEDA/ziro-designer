// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Toolbars — `PANEL_TOOLBAR_CUSTOMIZATION`, the
 * shared panel, constructed for this app:
 *
 *     return new PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb, FRAME_SCH, actions, controls );
 *     (eeschema/eeschema.cpp:342-358)
 *
 * The KIFACE's whole contribution is those five arguments: the app's settings,
 * its `TOOLBAR_SETTINGS` file, its `FRAME_T`, and the action and control lists.
 * Ours passes the same things, with this editor's `DefaultToolbarConfig` map
 * standing in for the last three — see `ui/toolbar_config.ts`.
 */
import type { JSX } from 'react';
import { PanelToolbarCustomization } from '../../../dialogs/prefs/PanelToolbarCustomization.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { SCH_DEFAULT_TOOLBARS } from '../toolbars_sch_editor.js';

export function PanelEeschemaToolbars({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return (
    <PanelToolbarCustomization
      app="eeschema"
      defaults={SCH_DEFAULT_TOOLBARS}
      custom={ctx.eeschema.appearance.custom_toolbars}
      setCustom={(v) => {
        ctx.upE((s) => {
          s.appearance.custom_toolbars = v;
        });
      }}
      store={ctx.toolbars.eeschema}
      update={(fn) => ctx.upTb('eeschema', fn)}
    />
  );
}
