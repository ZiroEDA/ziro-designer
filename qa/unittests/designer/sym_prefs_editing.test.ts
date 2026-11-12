// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Editing Options —
 * `PANEL_SYM_EDITING_OPTIONS` (`eeschema/dialogs/panel_sym_editing_options.cpp`).
 *
 * Eight controls, all live. Their readers are upstream's: the tools, off
 * `libeditconfig()` - SYMBOL_EDITOR_PIN_TOOL for the pin defaults and RepeatPin,
 * SYMBOL_EDITOR_DRAWING_TOOLS for the text size and line width, SCH_POINT_EDITOR
 * for dragging pins with an edge. Each is driven on the live frame, off its
 * default, in `eeschema/symbol_editor_settings_readers_live.test.ts`; this file
 * pins the file's defaults and the page.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SYMBOL_EDITOR_DEFAULTS,
  type SymbolEditorSettings,
} from '@ziroeda/eeschema/symbol_editor/symbol_editor_settings.js';
import { unmarked } from '../translation/unmarked.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => unmarked(readFileSync(join(SRC, rel), 'utf8'));
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

// ------------------------------------------------------- the three without readers

describe('every control on the page reads', () => {
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

  it('none of the eight is disabled', () => {
    for (const label of [
      'Default line width:',
      'Default text size:',
      'Default pin length:',
      'Default pin number size:',
      'Default pin name size:',
      // Live with Insert (`SYMBOL_EDITOR_PIN_TOOL::RepeatPin`).
      'Pitch of repeated pins:',
      'Label increment:',
      // Live with the point editor (`SCH_POINT_EDITOR::dragPinsOnEdge`).
      'Keep pins attached when dragging edges',
    ])
      expect(arm(label), label).not.toContain('disabled');
  });

  it('the page really does draw eight controls, so the loop is not vacuous', () => {
    // A label list that silently shrank would make the check above pass by
    // testing less, which is the failure mode of a per-label loop.
    const src = read(PAGE);
    expect((src.match(/label="/g) ?? []).length).toBeGreaterThanOrEqual(8);
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
