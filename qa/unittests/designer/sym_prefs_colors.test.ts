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

// -------------------------------------------------- the choice's width + order

describe('the theme list is ordered as GetColorSettingsList orders it', () => {
  it('sorts by NAME, so Classic comes before Default', () => {
    // `std::sort( …, []( COLOR_SETTINGS* a, COLOR_SETTINGS* b )
    //                 { return a->GetName() < b->GetName(); } )`
    // (`settings_manager.cpp:299-300`). We listed the built-ins in declaration
    // order, which put "KiCad Default" first — the opposite of a real KiCad.
    const names = colorThemeOptions([]).map(([, label]) => label);
    expect(names).toEqual([...names].sort());
    expect(names.indexOf('KiCad Classic')).toBeLessThan(names.indexOf('KiCad Default'));
  });

  it('sorts an installed theme INTO the list, not onto the end', () => {
    // The tell that the sort is real rather than a reordered literal: a PCM
    // theme named "Aardvark" must land first, and one named "Zebra" last.
    const names = colorThemeOptions([
      { id: 'z', name: 'Zebra' },
      { id: 'a', name: 'Aardvark' },
    ]).map(([, label]) => label);
    expect(names[0]).toBe('Aardvark');
    expect(names[names.length - 1]).toBe('Zebra');
  });

  it('gives the same ORDER whether or not the names are decorated', () => {
    // Upstream sorts by `GetName()` and only then asks
    // `GetSettingsDropdownName` for the " (read-only)" suffix, so the order
    // cannot depend on the decoration.
    //
    // Worth recording: sorting the DECORATED strings instead would give the
    // same answer, so no test can tell those two apart. The suffix begins with
    // a SPACE (0x20), which is lower than every printable character, so it only
    // ever matters when one raw name is a proper prefix of another — and there
    // it still preserves the order. This assertion is therefore about the sort
    // KEY being a name at all: sorting by id would put `_builtin_classic`,
    // `_builtin_default`, `user` in a different order from their names, and
    // leaving the list in insertion order fails the test above.
    const byId = (markReadOnly: boolean): string[] =>
      colorThemeOptions([{ id: 'z', name: 'Aardvark' }], markReadOnly).map(([id]) => id);
    expect(byId(true)).toEqual(byId(false));
    // ...and that order is the NAMES' order, not the ids'.
    expect(byId(false)).toEqual(['z', '_builtin_classic', '_builtin_default', 'user']);
  });

  it('names the user theme from its FILE, disambiguated against the built-in', () => {
    // Not "User": `colors/user.json`'s `meta.name` defaults to "KiCad Default"
    // (`color_settings.cpp:45-46`), which collides with the built-in, so
    // `loadAllColorSettings` appends the filename (`settings_manager.cpp:
    // 466-473`). The installed KiCad on this machine lists exactly this.
    const names = colorThemeOptions([]).map(([, label]) => label);
    expect(names).toEqual(['KiCad Classic', 'KiCad Default', 'KiCad Default (user)']);
  });

  it('applies the same rule to an installed theme that collides', () => {
    // The rule is about COLLIDING WITH A BUILT-IN, not about being the user
    // theme — so a PCM theme called "KiCad Classic" is disambiguated too, and
    // one with its own name is left alone.
    const names = colorThemeOptions([
      { id: 'clash', name: 'KiCad Classic' },
      { id: 'mine', name: 'Solarized' },
    ]).map(([, label]) => label);
    expect(names).toContain('KiCad Classic (clash)');
    expect(names).toContain('Solarized');
    // The BUILT-IN of that name keeps its own, undecorated.
    expect(names).toContain('KiCad Classic');
  });
});

describe('the Use theme choice is content-width, not panel-width', () => {
  it('takes its width from the widest theme NAME plus 50', () => {
    // `m_themes->GetTextExtent( settings->GetName(), &width, &height );`
    // `minwidth = std::max( minwidth, width );`
    // `m_themes->SetMinSize( wxSize( minwidth + 50, -1 ) );`
    // (`panel_sym_color_settings.cpp:61-65`)
    const src = readFileSync(
      join(SRC, 'editors/symbol/prefs/PanelSymbolEditorColorSettings.tsx'),
      'utf8',
    );
    expect(src).toContain('THEME_CHOICE_EXTRA = 50');
    expect(src).toContain('measureTextWidth(');
    expect(src).toContain('widest + THEME_CHOICE_EXTRA');
  });

  it('and the row does not stretch across the page', () => {
    // `p1mainSizer->Add( bMargins, 0, wxTOP, 10 )` — proportion 0 and no
    // wxEXPAND, then `Fit()`. The choice IS proportion 1 inside `bSizer2`, but
    // its parent claims no spare width for it to take, so reading that
    // proportion alone and writing `flex: 1` stretched it to the panel edge.
    const css = readFileSync(join(SRC, 'ui/shell.css'), 'utf8');
    const at = css.indexOf('.ze-sym-colors-row {');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('width: max-content');
    const combo = css.slice(css.indexOf('.ze-sym-colors-row > .ze-combo {'));
    expect(combo.slice(0, combo.indexOf('}')), 'the combo must not flex').not.toContain('flex:');
  });
});
