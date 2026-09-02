// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Editing Options —
 * `PANEL_SYM_EDITING_OPTIONS` (`eeschema/dialogs/panel_sym_editing_options.cpp`).
 *
 * Eight controls, five of them live. The five are the `defaults.*` fields, and
 * what makes them live is `editors/symbol/defaults.ts`: the conversion upstream
 * performs at the point each item is constructed, pulled out so that
 * "Preferences says 60 mils, the new pin is 60 mils" can be asserted without a
 * canvas. The other three are drawn disabled and this pins the reason: their
 * readers are `SYMBOL_EDITOR_PIN_TOOL::RepeatPin` and `SCH_POINT_EDITOR`,
 * neither of which this port wires into the symbol editor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { schIUScale } from '@ziroeda/common';
import {
  SYMBOL_EDITOR_DEFAULTS,
  type SymbolEditorSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import { symbolItemDefaults } from '@ziroeda/designer/src/editors/symbol/defaults.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const PAGE = 'editors/symbol/prefs/PanelSymbolEditorEditingOptions.tsx';
const cfg = (): SymbolEditorSettings => structuredClone(SYMBOL_EDITOR_DEFAULTS);

// ----------------------------------------------------------------- the defaults

describe('symbol_editor.json’s defaults.* block', () => {
  it('is eeschema/default_values.h’s four macros, plus line_width 0', () => {
    // DEFAULT_TEXT_SIZE 50 (:69), DEFAULT_PIN_LENGTH 100 (:39),
    // DEFAULT_PINNUM_SIZE 50 (:42), DEFAULT_PINNAME_SIZE 50 (:45), and
    // `PARAM<int>( "defaults.line_width", …, 0 )`
    // (`symbol_editor_settings.cpp:58-59`). Mils, every one.
    expect(SYMBOL_EDITOR_DEFAULTS.defaults).toEqual({
      line_width: 0,
      text_size: 50,
      pin_length: 100,
      pin_name_size: 50,
      pin_num_size: 50,
    });
  });

  it('and repeat.* is 1 and 100', () => {
    // `symbol_editor_settings.cpp:75-79`, and the installed build's own
    // symbol_editor.json says `"label_delta": 1, "pin_step": 100`.
    expect(SYMBOL_EDITOR_DEFAULTS.repeat).toEqual({ label_delta: 1, pin_step: 100 });
    expect(SYMBOL_EDITOR_DEFAULTS.drag_pins_along_with_edges).toBe(true);
  });
});

describe('symbolItemDefaults: mils out of the file, IU into the item', () => {
  it('converts through schIUScale, as every call site upstream does', () => {
    const d = symbolItemDefaults(cfg());
    expect(d.pinLengthIU).toBe(schIUScale.milsToIU(100));
    expect(d.pinNameSizeIU).toBe(schIUScale.milsToIU(50));
    expect(d.pinNumberSizeIU).toBe(schIUScale.milsToIU(50));
    expect(d.textSizeIU).toBe(schIUScale.milsToIU(50));
  });

  it('lands on exactly the constants it replaced', () => {
    // The old literals were `2.54 * MM` and `1.27 * MM` with `MM = 10000`, i.e.
    // 25400 and 12700 IU. A default profile must be unchanged by the move, or
    // this is a behaviour change dressed as a refactor.
    const d = symbolItemDefaults(cfg());
    expect(d.pinLengthIU).toBe(25400);
    expect(d.pinNameSizeIU).toBe(12700);
    expect(d.pinNumberSizeIU).toBe(12700);
    expect(d.textSizeIU).toBe(12700);
  });

  it('follows the setting rather than the constant', () => {
    const c = cfg();
    c.defaults.pin_length = 60;
    c.defaults.text_size = 70;
    c.defaults.pin_name_size = 30;
    c.defaults.pin_num_size = 40;
    const d = symbolItemDefaults(c);
    expect(d.pinLengthIU).toBe(schIUScale.milsToIU(60));
    expect(d.textSizeIU).toBe(schIUScale.milsToIU(70));
    expect(d.pinNameSizeIU).toBe(schIUScale.milsToIU(30));
    expect(d.pinNumberSizeIU).toBe(schIUScale.milsToIU(40));
  });

  it('keeps line_width 0 as 0, because 0 means "inherit"', () => {
    // The page's own note under the field: "Set to 0 to allow symbols to
    // inherit line width properties from schematic". Defaulting it away to a
    // pen width would silently stop that inheritance.
    expect(symbolItemDefaults(cfg()).lineWidthIU).toBe(0);
    const c = cfg();
    c.defaults.line_width = 12;
    expect(symbolItemDefaults(c).lineWidthIU).toBe(schIUScale.milsToIU(12));
  });
});

// -------------------------------------------------------------- the three readers

describe('the frame reads the five live fields', () => {
  const FRAME = 'editors/symbol/SymbolEditor.tsx';

  it('seeds the last-pin defaults from the file, not from a literal', () => {
    // `GetLastPinLength()` and its two siblings, whose `-1` sentinels are
    // filled in from `cfg->m_Defaults` on first use
    // (`symbol_editor_pin_tool.cpp:50-79`).
    const src = read(FRAME);
    expect(src).toContain('lastPinDefaults(settings.symbolEditor)');
    expect(src).toContain('d.pinLengthIU');
    expect(src).toContain('d.pinNameSizeIU');
    expect(src).toContain('d.pinNumberSizeIU');
    // The literals it replaced must be gone, or the page moves one copy and
    // the frame keeps using the other.
    expect(src).not.toContain('2.54 * MM, // DEFAULT_PIN_LENGTH');
    expect(src).not.toContain('DEFAULT_LAST_PIN');
  });

  it('opens the text dialog at the default text size', () => {
    // `text->SetTextSize( … cfg->m_Defaults.text_size … )` BEFORE
    // `DIALOG_TEXT_PROPERTIES dlg( m_frame, text )`
    // (`symbol_editor_drawing_tools.cpp:238-246`).
    expect(read(FRAME)).toContain('defaultFontSize={symbolItemDefaults(symCfg).textSizeIU}');
    const dlg = read('editors/symbol/components/dialogs.tsx');
    expect(dlg).toContain('initial?.fontSize ?? defaultFontSize ?? 1.27 * MM');
  });

  it('gives a new shape the default line width, and only when it is set', () => {
    // `int lineWidth = schIUScale.MilsToIU( cfg->m_Defaults.line_width )`
    // (`symbol_editor_drawing_tools.cpp:480`). Zero stays an ABSENT stroke:
    // that is what "inherit" already means to the writer, so a default profile
    // keeps writing the bytes it did.
    const src = read(FRAME);
    expect(src).toContain('symbolItemDefaults(symCfg).lineWidthIU');
    expect(src).toContain("lineWidthIU > 0 && g.kind !== 'text'");
  });
});

// ------------------------------------------------------- the three without readers

describe('the three controls with no reader are drawn disabled', () => {
  /**
   * One control's props, from its `label=` prop to the end of that element.
   *
   * Anchored on `label="…"` and not on the bare string: the header comment
   * transcribes the whole sizer tree, so every one of these labels appears
   * twice in the file and the first hit is the comment.
   */
  const arm = (label: string): string => {
    const src = read(PAGE);
    const at = src.indexOf(`label="${label}"`);
    expect(at, `${label} is not on the page`).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('/>', at));
  };

  it('Pitch of repeated pins', () => {
    expect(arm('Pitch of repeated pins:')).toContain('disabled');
  });

  it('Label increment', () => {
    expect(arm('Label increment:')).toContain('disabled');
  });

  it('Keep pins attached when dragging edges', () => {
    expect(arm('Keep pins attached when dragging edges')).toContain('disabled');
  });

  it('and the five live ones are NOT disabled, so this cannot pass by accident', () => {
    for (const label of [
      'Default line width:',
      'Default text size:',
      'Default pin length:',
      'Default pin number size:',
      'Default pin name size:',
    ])
      expect(arm(label), label).not.toContain('disabled');
  });

  it('and the readers really are absent, which is what the greying rests on', () => {
    // If either ever lands, these fail and the controls come alive.
    const symbolDir = ['SymbolEditor.tsx', 'SymbolCanvas.tsx', 'edits.ts', 'symbolToolbars.ts'];
    for (const f of symbolDir)
      expect(read(`editors/symbol/${f}`), f).not.toContain('repeatDrawItem');
    for (const f of symbolDir) expect(read(`editors/symbol/${f}`), f).not.toContain('pin_step');
    // `drag_pins_along_with_edges` is read by SCH_POINT_EDITOR alone, and no
    // symbol-editor file mentions it.
    for (const f of symbolDir)
      expect(read(`editors/symbol/${f}`), f).not.toContain('drag_pins_along_with_edges');
  });
});

// ---------------------------------------------------------------------- the page

describe('the page is upstream’s, control for control', () => {
  it('has all eight controls and invents none', () => {
    const src = read(PAGE);
    for (const label of [
      'Default line width:',
      'Default text size:',
      'Default pin length:',
      'Default pin number size:',
      'Default pin name size:',
      'Pitch of repeated pins:',
      'Label increment:',
      'Keep pins attached when dragging edges',
    ])
      expect(src, label).toContain(label);
    // Three headings, in order, and no fourth.
    const headings = [...src.matchAll(/<Group title="([^"]+)"/g)].map((m) => m[1]);
    expect(headings).toEqual(['Defaults for New Objects', 'Repeated Items', 'General Editing']);
  });

  it('carries m_widthHelpText verbatim, on its own two lines', () => {
    // `_("Set to 0 to allow symbols to inherit line width properties\nfrom
    // schematic")` (`panel_sym_editing_options_base.cpp:48`) — one string with
    // a newline in it, so it is two lines and not a wrap.
    const src = read(PAGE);
    expect(src).toContain('Set to 0 to allow symbols to inherit line width properties');
    expect(src).toContain('from schematic');
  });

  it('spins only the Label increment, and at KiCad’s range', () => {
    // Five `wxTextCtrl`s and one `wxSpinCtrl( …, -10, 10, 1 )`
    // (`panel_sym_editing_options_base.cpp:143`). A stepper on a text field is
    // a widget upstream does not have there.
    const src = read(PAGE);
    expect([...src.matchAll(/spin=\{false\}/g)]).toHaveLength(6);
    expect(src).toContain('{ min: -10, max: 10 }');
  });

  it('labels every mils field mils, and the spin control not at all', () => {
    const src = read(PAGE);
    expect([...src.matchAll(/unit="mils"/g)]).toHaveLength(6);
    const incr = src.slice(src.indexOf('label="Label increment:"'));
    expect(incr.slice(0, incr.indexOf('/>'))).not.toContain('unit=');
  });

  it('writes symbol_editor.json and not the schematic’s', () => {
    const src = read(PAGE);
    expect(src).toContain('symbolEditor.defaults');
    expect(src).not.toContain('ctx.eeschema');
  });
});
