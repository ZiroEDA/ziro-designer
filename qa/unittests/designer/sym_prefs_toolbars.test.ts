// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Toolbars.
 *
 * `PANEL_TOOLBAR_CUSTOMIZATION` is one class upstream and one component here,
 * so what this pins is the wiring either side of it, which is where the page
 * could be decorative:
 *
 *  - the store is `symbol_editor-toolbars.json`, a FILE of its own beside
 *    `symbol_editor.json` — `GetToolbarSettings<SYMBOL_EDIT_TOOLBAR_SETTINGS>(
 *    "symbol_editor-toolbars" )` (`eeschema/eeschema.cpp:289`). One KIFACE,
 *    two toolbar files, because the Symbol Editor is its own frame;
 *  - the FRAME draws `GetToolbarConfig( loc, m_CustomToolbars )` and never
 *    `DefaultToolbarConfig` (`EDA_BASE_FRAME::RecreateToolbars`,
 *    `common/eda_base_frame.cpp:1728-1843`). Three bars drawn from the module
 *    constants would leave this page editing a file nothing reads — which is
 *    what `SymbolEditor.tsx` did before this landed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SYMBOL_EDITOR_DEFAULTS,
  TOOLBAR_APPS,
  toolbarSlice,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  SYM_DEFAULT_TOOLBARS,
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
  SYM_TOP_TOOLBAR,
} from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import {
  resolveToolbarConfig,
  toolbarLocsOf,
  TOOLBAR_SETTINGS_DEFAULTS,
  type ToolbarSettings,
} from '@ziroeda/designer/src/ui/toolbar_config.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('the store', () => {
  it('is a file of the app’s own, named as KiCad names it', () => {
    expect(TOOLBAR_APPS).toContain('symbol_editor');
    expect(toolbarSlice('symbol_editor')).toBe('symbol_editor-toolbars');
  });

  it('opens with Customize toolbars off', () => {
    // `PARAM<bool>( "appearance.custom_toolbars", &m_CustomToolbars, false )`
    // (`common/settings/app_settings.cpp:285`). A default of true is invisible
    // everywhere except this page, where it would open already ticked.
    expect(SYMBOL_EDITOR_DEFAULTS.appearance.custom_toolbars).toBe(false);
  });

  it('customToolbarsEnabled answers for this app', () => {
    // `useToolbarEntries.ts`' switch is exhaustive over `ToolbarApp`; an app
    // added to `TOOLBAR_APPS` without its arm leaves the function with no
    // return on one path, and EVERY editor's toolbar goes through it.
    const src = read('ui/useToolbarEntries.ts');
    expect(src).toContain("case 'symbol_editor':");
    expect(src).toContain('settings.symbolEditor.appearance.custom_toolbars');
  });
});

describe('DefaultToolbarConfig for FRAME_SCH_SYMBOL_EDITOR', () => {
  it('is the three bars the frame has, and no TOP_AUX', () => {
    // `SYMBOL_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig`'s first case is
    // `return std::nullopt` for TOP_AUX, so the page must offer three choices
    // and not four.
    expect(toolbarLocsOf(SYM_DEFAULT_TOOLBARS).sort()).toEqual(['LEFT', 'RIGHT', 'TOP_MAIN']);
  });

  it('is the same three lists the module already declared, by reference', () => {
    // Not a fourth transcription of the toolbars: the map is a switch over the
    // lists above it, which is what the C++ is too.
    expect(SYM_DEFAULT_TOOLBARS.TOP_MAIN).toBe(SYM_TOP_TOOLBAR);
    expect(SYM_DEFAULT_TOOLBARS.LEFT).toBe(SYM_LEFT_TOOLBAR);
    expect(SYM_DEFAULT_TOOLBARS.RIGHT).toBe(SYM_RIGHT_TOOLBAR);
  });
});

describe('the frame draws the stored configuration', () => {
  /** A store with one obviously-customised LEFT toolbar. */
  const customised = (): ToolbarSettings => ({
    ...structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
    toolbars: [{ name: 'LEFT', contents: [{ type: 'TOOL', name: 'placePin' }] }],
  });

  it('falls through to the defaults with nothing stored', () => {
    const entries = resolveToolbarConfig(
      SYM_DEFAULT_TOOLBARS,
      'LEFT',
      structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
      false,
    );
    expect(entries).toEqual(SYM_LEFT_TOOLBAR);
  });

  it('keeps the defaults while Customize toolbars is off, stored or not', () => {
    // `aAllowCustom` — switching the checkbox off restores the stock toolbars
    // WITHOUT discarding the customisation, which is the whole reason
    // `GetToolbarConfig` takes the flag.
    const entries = resolveToolbarConfig(SYM_DEFAULT_TOOLBARS, 'LEFT', customised(), false);
    expect(entries).toEqual(SYM_LEFT_TOOLBAR);
  });

  it('takes the stored one once it is on', () => {
    const entries = resolveToolbarConfig(SYM_DEFAULT_TOOLBARS, 'LEFT', customised(), true);
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toBe('sep');
    expect(entries[0]).toMatchObject({ id: 'placePin' });
    // and it is NOT the stock bar, which is the thing that was broken
    expect(entries).not.toEqual(SYM_LEFT_TOOLBAR);
  });

  it('the frame asks that question rather than reading the constants', () => {
    // Source text, because there is no frame to mount here. The three bars
    // used to be `entries={SYM_TOP_TOOLBAR}` and friends, which no page could
    // reach.
    const src = read('editors/symbol/SymbolEditor.tsx');
    for (const loc of ['TOP_MAIN', 'LEFT', 'RIGHT'])
      expect(src, loc).toContain(
        `useToolbarEntries('symbol_editor', '${loc}', SYM_DEFAULT_TOOLBARS)`,
      );
    expect(src).not.toContain('entries={SYM_TOP_TOOLBAR}');
    expect(src).not.toContain('entries={SYM_LEFT_TOOLBAR}');
    expect(src).not.toContain('entries={SYM_RIGHT_TOOLBAR}');
  });
});

describe('the page is the shared panel, constructed for this app', () => {
  const PAGE = 'editors/symbol/prefs/PanelSymbolEditorToolbars.tsx';

  it('calls dialogs/prefs/PanelToolbarCustomization rather than copying it', () => {
    const src = read(PAGE);
    expect(src).toContain("from '../../../dialogs/prefs/PanelToolbarCustomization.js'");
    expect(src).toContain('app="symbol_editor"');
    expect(src).toContain('defaults={SYM_DEFAULT_TOOLBARS}');
    expect(src).toContain('store={ctx.toolbars.symbol_editor}');
  });

  it('edits this app’s custom_toolbars flag and no other app’s', () => {
    const src = read(PAGE);
    expect(src).toContain('ctx.symbolEditor.appearance.custom_toolbars');
    for (const other of ['ctx.eeschema', 'ctx.pcbnew', 'ctx.plEditor'])
      expect(src, other).not.toContain(other);
  });
});
