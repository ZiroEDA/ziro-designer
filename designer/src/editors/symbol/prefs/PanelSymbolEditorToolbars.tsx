// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Toolbars — `PANEL_TOOLBAR_CUSTOMIZATION`, the
 * shared panel, constructed for this app:
 *
 *     APP_SETTINGS_BASE* cfg = GetAppSettings<SYMBOL_EDITOR_SETTINGS>( "symbol_editor" );
 *     TOOLBAR_SETTINGS*  tb  = GetToolbarSettings<SYMBOL_EDIT_TOOLBAR_SETTINGS>( "symbol_editor-toolbars" );
 *     ...
 *     return new PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb, FRAME_SCH_SYMBOL_EDITOR, actions, controls );
 *     (`eeschema/eeschema.cpp:287-302`)
 *
 * The KIFACE's whole contribution is those five arguments: the app's settings,
 * its own `TOOLBAR_SETTINGS` **file** — `symbol_editor-toolbars.json`, beside
 * `symbol_editor.json`, not a key inside it — its `FRAME_T`, and the action and
 * control lists. Ours passes the same things, with this editor's toolbar
 * inventory standing in for the last three; see `ui/toolbar_config.ts`.
 *
 * **What reads it.** `SYMBOL_TOOLBARS`, the map below, is what
 * `SymbolEditor.tsx` draws its three toolbars from, through the same
 * `GetToolbarConfig` path every other editor uses — stored configuration if
 * `appearance.custom_toolbars` is on and one exists, `DefaultToolbarConfig`
 * otherwise. So both controls on this page are live.
 */
import type { JSX } from 'react';
import { PanelToolbarCustomization } from '../../../dialogs/prefs/PanelToolbarCustomization.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { SYM_DEFAULT_TOOLBARS } from '../symbolToolbars.js';

export function PanelSymbolEditorToolbars({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return (
    <PanelToolbarCustomization
      app="symbol_editor"
      defaults={SYM_DEFAULT_TOOLBARS}
      custom={ctx.symbolEditor.appearance.custom_toolbars}
      setCustom={(v) => {
        ctx.upSym((s) => {
          s.appearance.custom_toolbars = v;
        });
      }}
      store={ctx.toolbars.symbol_editor}
      update={(fn) => ctx.upTb('symbol_editor', fn)}
    />
  );
}
