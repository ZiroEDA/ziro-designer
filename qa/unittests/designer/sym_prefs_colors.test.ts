// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Colors — `PANEL_SYM_COLOR_SETTINGS`
 * (`eeschema/dialogs/panel_sym_color_settings.cpp`).
 *
 * Two radio buttons and a theme choice, and the interesting thing about them is
 * that they are **not** a second copy of the schematic's theme picker. They
 * choose which SETTINGS OBJECT the frame asks:
 *
 *     APP_SETTINGS_BASE* cfg = GetSettings();
 *     if( cfg && static_cast<SYMBOL_EDITOR_SETTINGS*>( cfg )->m_UseEeschemaColorSettings )
 *         cfg = GetAppSettings<EESCHEMA_SETTINGS>( "eeschema" );
 *     return ::GetColorSettings( cfg ? cfg->m_ColorTheme : DEFAULT_THEME );
 *     (`SYMBOL_EDIT_FRAME::GetColorSettings`, `symbol_edit_frame.cpp:402-410`)
 *
 * The Symbol Editor called `useSchematicTheme()` before this landed, i.e. it
 * took the first branch unconditionally, so the choice could not exist.
 *
 * The page is also the one under this heading that is not a `RESETTABLE_PANEL`
 * — `PANEL_SYM_COLOR_SETTINGS_BASE : public wxPanel` — which is asserted from
 * the factory in `prefs_reset_slices.test.ts` rather than here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SYMBOL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import { colorThemeOptions } from '@ziroeda/designer/src/dialogs/prefs/ColorThemeChoice.js';
import { UPSTREAM_BOOK, shippedUnder } from '@ziroeda/designer/src/dialogs/prefs/registry.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const PAGE = 'editors/symbol/prefs/PanelSymbolEditorColorSettings.tsx';

describe('the setting behind the two radio buttons', () => {
  it('defaults to following the schematic editor', () => {
    // `m_UseEeschemaColorSettings = true` in the constructor and
    // `PARAM<bool>( "use_eeschema_color_settings", …, true )`
    // (`symbol_editor_settings.cpp:46`, `:100-101`). The installed build's own
    // symbol_editor.json says `"use_eeschema_color_settings": true`.
    expect(SYMBOL_EDITOR_DEFAULTS.use_eeschema_color_settings).toBe(true);
    // Its own theme is still stored, and still the built-in default: the file
    // keeps a `appearance.color_theme` whichever button is on, because the
    // panel writes it only on the second branch.
    expect(SYMBOL_EDITOR_DEFAULTS.appearance.color_theme).toBe('_builtin_default');
  });
});

describe('the reader is GetColorSettings, not a second theme id', () => {
  const HOOK = 'prefs/useSettings.ts';

  it('swaps which settings object is asked', () => {
    const src = read(HOOK);
    const at = src.indexOf('export function useSymbolEditorTheme');
    expect(at, 'useSymbolEditorTheme is missing').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}', at));
    expect(body).toContain('cfg.use_eeschema_color_settings');
    expect(body).toContain('settings.eeschema.appearance.color_theme');
    expect(body).toContain('cfg.appearance.color_theme');
  });

  it('and the frame calls it instead of the schematic’s', () => {
    const frame = read('editors/symbol/SymbolEditor.tsx');
    expect(frame).toContain('const theme = useSymbolEditorTheme();');
    // The bug this replaces: `useSchematicTheme()` is the first branch taken
    // unconditionally, so both controls on the page would be dead. Checked on
    // the CALL and the IMPORT rather than on the name, which the comment
    // beside the call still mentions.
    expect(frame).not.toContain('const theme = useSchematicTheme();');
    const imports = frame.slice(0, frame.indexOf('export function'));
    expect(imports).not.toMatch(/^\s*useSchematicTheme,$/m);
  });

  it('leaves the schematic editor on its own hook', () => {
    // The swap must not have been done by changing `useSchematicTheme` itself,
    // which would have pointed eeschema at the symbol editor's file.
    const src = read(HOOK);
    const at = src.indexOf('export function useSchematicTheme');
    const body = src.slice(at, src.indexOf('\n}', at));
    expect(body).toContain('resolveTheme()');
    expect(body).not.toContain('symbolEditor');
  });
});

describe('the page', () => {
  it('is two radio buttons in one group and a choice, and nothing else', () => {
    const src = read(PAGE);
    expect(src).toContain('Use schematic editor color theme');
    expect(src).toContain('Use theme:');
    // One `wxRB_GROUP`, so both inputs share a name or the browser lets both
    // be on at once.
    expect([...src.matchAll(/name=\{GROUP\}/g)]).toHaveLength(2);
    // No heading and no rule: `p1mainSizer` holds the two rows directly, with
    // no `wxStaticText`/`wxStaticLine` pair anywhere in the base file.
    expect(src).not.toContain('<Group');
    // And no swatch grid — this is not a PANEL_COLOR_SETTINGS.
    expect(src).not.toContain('ColorRow');
    expect(src).not.toContain('ColorSwatch');
  });

  it('uses the app-wide theme list, unmarked', () => {
    // `GetColorSettingsList()` walked verbatim, appending `settings->GetName()`
    // (`panel_sym_color_settings.cpp:52-58`) — no "(read-only)" suffix, which
    // is `PANEL_COLOR_SETTINGS::GetSettingsDropdownName`'s and not this
    // panel's.
    const src = read(PAGE);
    // The second argument is `aMarkReadOnly`, and it is off: passing it would
    // suffix every built-in with "(read-only)", which is
    // `PANEL_COLOR_SETTINGS::GetSettingsDropdownName`'s doing and not this
    // panel's. Checked on the CALL, since the header comment names the flag.
    expect(src).toContain('colorThemeOptions(pcm.installedThemes())');
    expect(src).not.toContain('colorThemeOptions(pcm.installedThemes(), true)');
    // The list itself is the shared one; a page that built its own would drift
    // from every other theme choice in the app.
    expect(colorThemeOptions([]).map(([id]) => id)).toContain('_builtin_default');
    // `aMarkReadOnly` defaults OFF, which is this panel's arm; the schematic's
    // Colors page opts in. Both directions, so this cannot pass by the helper
    // simply never marking anything.
    expect(colorThemeOptions([]).some(([, label]) => label.includes('read-only'))).toBe(false);
    expect(colorThemeOptions([], true).some(([, label]) => label.includes('read-only'))).toBe(true);
  });

  it('is a native <select> nowhere', () => {
    // A wxChoice is a button with a popup. `Combo` is the shared widget.
    const src = read(PAGE);
    expect(src).toContain("from '../../../ui/Combo.js'");
    expect(src).not.toContain('<select');
  });

  it('selects the second radio when a theme is picked', () => {
    // `OnThemeChanged` is one line: `m_themeRB->SetValue( true )`
    // (`panel_sym_color_settings.cpp:89-92`). Without it the choice could move
    // while the first button stayed on, and `TransferDataFromWindow` writes
    // `m_ColorTheme` only on the other branch — so the pick would be
    // discarded.
    const src = read(PAGE);
    const at = src.indexOf('<Combo');
    const combo = src.slice(at, src.indexOf('/>', at));
    expect(combo).toContain('s.appearance.color_theme = v;');
    expect(combo).toContain('s.use_eeschema_color_settings = false;');
  });

  it('writes symbol_editor.json and not the schematic’s', () => {
    const src = read(PAGE);
    expect(src).toContain('symbolEditor.use_eeschema_color_settings');
    expect(src).not.toContain('ctx.eeschema');
  });
});

describe('the heading is complete', () => {
  it('ships all five of upstream’s sub-pages, in upstream’s order', () => {
    expect(shippedUnder('Symbol Editor')).toEqual([...UPSTREAM_BOOK['Symbol Editor']!]);
    expect(shippedUnder('Symbol Editor')).toEqual([
      'Display Options',
      'Grids',
      'Editing Options',
      'Colors',
      'Toolbars',
    ]);
  });
});
