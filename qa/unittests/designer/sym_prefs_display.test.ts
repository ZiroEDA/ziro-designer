// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Display Options — `PANEL_SYM_DISPLAY_OPTIONS`
 * (`eeschema/dialogs/panel_sym_display_options.cpp`), which is one Appearance
 * group of four checkboxes beside the shared `PANEL_GAL_OPTIONS`.
 *
 * The page is a binding, so what is worth asserting is the binding: which of
 * its controls has a reader, and the relationship between the file and the
 * toolbar buttons that show the same four values. Upstream there is no
 * relationship to get wrong — a button's lit state is a `CHECK` condition that
 * reads `libeditconfig()->m_Show*` on every idle
 * (`symbol_edit_frame.cpp:566-606`) and the tool inverts the same field
 * (`symbol_editor_control.cpp:714-752`). Ours holds a React set, which is
 * exactly where the two can drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SYMBOL_EDITOR_DEFAULTS,
  type SymbolEditorSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  crosshairToggleId,
  crosshairToggleMode,
  DEFAULT_TOGGLES,
  mergeSymbolToggles,
  persistSymbolToggle,
  SESSION_TOGGLES,
  SYMBOL_SETTING_TOGGLES,
  symbolTogglesFromSettings,
} from '@ziroeda/designer/src/editors/symbol/toggles.js';
import { symbolSnappingEnabled } from '@ziroeda/designer/src/editors/symbol/grid.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const cfg = (): SymbolEditorSettings => structuredClone(SYMBOL_EDITOR_DEFAULTS);

// ------------------------------------------------------- the Appearance group

describe('the three live Appearance checkboxes', () => {
  it('open as KiCad opens them, which is all three ticked', () => {
    expect(SYMBOL_EDITOR_DEFAULTS.show_hidden_lib_pins).toBe(true);
    expect(SYMBOL_EDITOR_DEFAULTS.show_hidden_lib_fields).toBe(true);
    expect(SYMBOL_EDITOR_DEFAULTS.show_pin_electrical_type).toBe(true);
  });

  it('light their toolbar buttons, because the button reads the file', () => {
    for (const id of ['showHiddenPins', 'showHiddenFields', 'showElectricalTypes'])
      expect(DEFAULT_TOGGLES.has(id), id).toBe(true);
  });

  it('take the button back off when the file says so', () => {
    const c = cfg();
    c.show_hidden_lib_pins = false;
    c.show_hidden_lib_fields = false;
    c.show_pin_electrical_type = false;
    const off = symbolTogglesFromSettings(c);
    for (const id of ['showHiddenPins', 'showHiddenFields', 'showElectricalTypes'])
      expect(off.has(id), id).toBe(false);
    // and the session half is untouched
    for (const id of SESSION_TOGGLES) expect(off.has(id), id).toBe(true);
  });

  it('are inverted by the toolbar, into the file', () => {
    // `SYMBOL_EDITOR_CONTROL::ToggleHiddenPins`: `cfg->m_ShowHiddenPins =
    // !cfg->m_ShowHiddenPins` (`symbol_editor_control.cpp:716`).
    const c = cfg();
    expect(persistSymbolToggle(c, 'showHiddenPins')).toBe(true);
    expect(c.show_hidden_lib_pins).toBe(false);
    expect(persistSymbolToggle(c, 'showHiddenFields')).toBe(true);
    expect(c.show_hidden_lib_fields).toBe(false);
    expect(persistSymbolToggle(c, 'showElectricalTypes')).toBe(true);
    expect(c.show_pin_electrical_type).toBe(false);
    // and none of them touched anything else
    const other = cfg();
    other.show_hidden_lib_pins = false;
    other.show_hidden_lib_fields = false;
    other.show_pin_electrical_type = false;
    expect(c).toEqual(other);
  });
});

describe('the fourth checkbox is drawn disabled, because nothing reads it', () => {
  it('says so at the control', () => {
    const src = read('editors/symbol/prefs/PanelSymbolEditorDisplayOptions.tsx');
    const arm = src.slice(src.indexOf('Show pin alternate mode indicator icons'));
    expect(arm).toContain('disabled');
  });

  it('is not a toolbar toggle either, so the two agree', () => {
    // A lit button for a flag the renderer cannot act on is the same defect as
    // a live checkbox for it. `menubar.ts` already greys the View row.
    expect(DEFAULT_TOGGLES.has('togglePinAltIcons')).toBe(false);
    expect(SYMBOL_SETTING_TOGGLES.has('togglePinAltIcons')).toBe(false);
    expect(persistSymbolToggle(cfg(), 'togglePinAltIcons')).toBe(false);
  });

  it('the renderer really has no alternate-mode indicator to draw', () => {
    // The claim the `disabled` rests on. If `drawPin` ever grows one, this
    // fails and the checkbox comes alive.
    const renderer = read('editors/symbol/render/symbolRenderer.ts');
    expect(renderer).not.toContain('altIcon');
    expect(renderer).not.toContain('show_pin_alt_icons');
  });
});

// ------------------------------------------------------------ the GAL controls

describe('the embedded PANEL_GAL_OPTIONS is live', () => {
  it('Snap to grid is GAL::GetGridSnapping, all three options', () => {
    // `m_options.m_gridSnapping == ALWAYS || ( m_gridVisibility &&
    //  m_options.m_gridSnapping == WITH_GRID )`
    // (`include/gal/graphics_abstraction_layer.h:815-819`).
    const c = cfg();
    c.window.grid.snap = 0; // ALWAYS
    c.window.grid.show = false;
    expect(symbolSnappingEnabled(c)).toBe(true);
    c.window.grid.snap = 1; // WITH_GRID — and that is Show Grid, not the list
    expect(symbolSnappingEnabled(c)).toBe(false);
    c.window.grid.show = true;
    expect(symbolSnappingEnabled(c)).toBe(true);
    c.window.grid.snap = 2; // NEVER
    expect(symbolSnappingEnabled(c)).toBe(false);
    c.window.grid.show = false;
    expect(symbolSnappingEnabled(c)).toBe(false);
  });

  it('the canvas asks it before snapping', () => {
    const canvas = read('editors/symbol/SymbolCanvas.tsx');
    expect(canvas).toContain('symbolSnappingEnabled(symCfg)');
  });

  it('the crosshair mode decides which toolbar radio is lit', () => {
    // `CURSOR_SETTINGS::cross_hair_mode`, which is the Cursor group's own
    // setting. Ours hardcoded `crosshairSmall` as "the group's first action".
    expect(crosshairToggleId('small')).toBe('crosshairSmall');
    expect(crosshairToggleId('full')).toBe('crosshairFull');
    expect(crosshairToggleId('45')).toBe('crosshair45');
    const c = cfg();
    c.window.cursor.crosshair = 'full';
    const set = symbolTogglesFromSettings(c);
    expect(set.has('crosshairFull')).toBe(true);
    expect(set.has('crosshairSmall')).toBe(false);
    expect(set.has('crosshair45')).toBe(false);
  });

  it('and the radio writes it back, replacing rather than flipping', () => {
    const c = cfg();
    expect(persistSymbolToggle(c, 'crosshair45')).toBe(true);
    expect(c.window.cursor.crosshair).toBe('45');
    // Re-activating the member already on leaves it on and writes nothing.
    expect(persistSymbolToggle(c, 'crosshair45')).toBe(false);
    expect(c.window.cursor.crosshair).toBe('45');
    expect(crosshairToggleMode('crosshairFull')).toBe('full');
    expect(crosshairToggleMode('showHiddenPins')).toBeNull();
  });

  it('passes the symbol editor’s own window slice, not eeschema’s', () => {
    const src = read('editors/symbol/prefs/PanelSymbolEditorDisplayOptions.tsx');
    expect(src).toContain("from '../../../dialogs/prefs/PanelGalOptions.js'");
    expect(src).toContain('win={symbolEditor.window}');
    expect(src).not.toContain('ctx.eeschema');
  });
});

// ------------------------------------------- the file wins over the stale set

describe('mergeSymbolToggles: OK in Preferences moves the buttons', () => {
  it('re-reads every settings-backed id from the file', () => {
    // The drift this exists to stop: `toggles` is initialised once, so without
    // this a Display Options OK would change the canvas and leave the toolbar
    // buttons showing the old values for the life of the frame.
    const stale = new Set(DEFAULT_TOGGLES);
    const c = cfg();
    c.show_hidden_lib_pins = false;
    c.window.grid.show = false;
    c.window.cursor.crosshair = 'full';
    const shown = mergeSymbolToggles(stale, c);
    expect(shown.has('showHiddenPins')).toBe(false);
    expect(shown.has('toggleGrid')).toBe(false);
    expect(shown.has('crosshairFull')).toBe(true);
    expect(shown.has('crosshairSmall')).toBe(false);
  });

  it('leaves session state exactly as the frame left it', () => {
    // A pane the user closed must not come back because the settings moved.
    const stale = new Set(DEFAULT_TOGGLES);
    stale.delete('showProperties');
    stale.add('toggleSyncedPinsMode');
    const shown = mergeSymbolToggles(stale, cfg());
    expect(shown.has('showProperties')).toBe(false);
    expect(shown.has('toggleSyncedPinsMode')).toBe(true);
  });

  it('the frame draws the merged set, not the raw React state', () => {
    const src = read('editors/symbol/SymbolEditor.tsx');
    expect(src).toContain('mergeSymbolToggles(sessionToggles, symCfg)');
    // The state itself must not be read directly anywhere but the merge, or
    // that call site is the one that goes stale.
    // Three: the useState declaration, the merge's argument, and the memo's
    // dependency. Any fourth is a call site reading the state directly, and
    // that is the one that goes stale.
    const uses = [...src.matchAll(/\bsessionToggles\b/g)].length;
    expect(uses).toBe(3);
  });
});
