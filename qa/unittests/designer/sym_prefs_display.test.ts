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
} from '@ziroeda/eeschema/symbol_editor/symbol_editor_settings.js';
import {
  crosshairToggleId,
  crosshairToggleMode,
  DEFAULT_TOGGLES,
  persistSymbolToggle,
  SESSION_TOGGLES,
  symbolTogglesFromSettings,
} from '@ziroeda/eeschema/symbol_editor/toggles.js';

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

describe('the fourth checkbox is live, and reaches the canvas by its own route', () => {
  it('is not drawn disabled any more', () => {
    const src = read('editors/symbol/prefs/PanelSymbolEditorDisplayOptions.tsx');
    // Only this control's arm, so a `disabled` elsewhere on the page cannot
    // satisfy or break it.
    const arm = src.slice(src.indexOf('Show pin alternate mode indicator icons'));
    const control = arm.slice(0, arm.indexOf('/>'));
    expect(control).not.toContain('disabled');
  });

  it('has a View-menu CHECK but no toolbar button, which is upstream’s shape', () => {
    // `menubar_symbol_editor.cpp:142` adds it as ACTION_MENU::CHECK, ticked
    // from `showPinAltIconsCond` (`symbol_edit_frame.cpp:583-587`), while
    // `toolbars_symbol_editor.cpp:85` leaves the BUTTON commented out. So it
    // belongs in the toggle set and in the persisted set, and the menu row is
    // a `chk` rather than a `stub`.
    expect(persistSymbolToggle(cfg(), 'togglePinAltIcons')).toBe(true);
    const menubar = read('../../eeschema/symbol_editor/menubar_symbol_editor.ts');
    expect(menubar).toContain("chk(_('Show Pin Alternate Icons'), 'togglePinAltIcons')");
    expect(menubar).not.toMatch(/stub\((_\()?'Show Pin Alternate Icons'/);
  });

  it('the tick follows the settings object, as showPinAltIconsCond does', () => {
    // `return libeditconfig()->m_ShowPinAltIcons;` — the fifth CHECK
    // condition, and it reads the file rather than session state.
    const c = cfg();
    c.show_pin_alt_icons = true;
    expect(symbolTogglesFromSettings(c).has('togglePinAltIcons')).toBe(true);
    c.show_pin_alt_icons = false;
    expect(symbolTogglesFromSettings(c).has('togglePinAltIcons')).toBe(false);
  });

  it('flipping it writes the flag, like TogglePinAltIcons', () => {
    const c = cfg();
    const before = c.show_pin_alt_icons;
    expect(persistSymbolToggle(c, 'togglePinAltIcons')).toBe(true);
    expect(c.show_pin_alt_icons).toBe(!before);
  });

  it('the renderer draws the indicator the checkbox now promises', () => {
    // The claim the un-greying rests on: `drawPin` calls KiCad's own
    // `drawAltPinModesIcon`, gated on the setting, and gets its box from
    // `altIconBox` — which is null unless the pin declares alternates.
    const renderer = read('../../eeschema/symbol_editor/symbol_renderer.ts');
    expect(renderer).toContain('drawAltPinModesIcon');
    expect(renderer).toContain('altIconBox');
    expect(renderer).toMatch(/if \(sym\.showPinAltIcons\)/);
    // The editor's canvas is SCH_PAINTER now, fed from symbol_editor.json by
    // SYMBOL_EDIT_FRAME::LoadSettings (:336) - pinned both ways in
    // symbol_edit_frame_load_settings.test.ts - and the painter gates on it.
    expect(read('../../eeschema/sch_painter.ts')).toContain('m_schSettings.m_ShowPinAltIcons');
  });
});

// ------------------------------------------------------------ the GAL controls

describe('the embedded PANEL_GAL_OPTIONS is live', () => {
  // Snap to grid is GAL::GetGridSnapping - `m_options.m_gridSnapping == ALWAYS ||
  // ( m_gridVisibility && m_options.m_gridSnapping == WITH_GRID )`
  // (`include/gal/graphics_abstraction_layer.h:815-819`) - on the option
  // SYMBOL_EDIT_FRAME::LoadSettings reads from this slice.
  // The canvas asks it before snapping: WX_VIEW_CONTROLS::GetCursorPosition goes through
  // GAL::GetGridSnapping, whose option SYMBOL_EDIT_FRAME::LoadSettings reads from this window
  // slice (symbol_edit_frame_load_settings.test.ts; wx_view_controls.test.ts for the snap).

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
    expect(src).toContain("from '@ziroeda/common/dialogs/panel_gal_options.js'");
    expect(src).toContain('win={symbolEditor.window}');
    expect(src).not.toContain('ctx.eeschema');
  });
});
