// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Editing Options —
 * `PANEL_EESCHEMA_EDITING_OPTIONS`
 * (`eeschema/dialogs/panel_eeschema_editing_options_base.cpp`).
 *
 * Four faults, and the first two are why the right-hand column ran off the
 * edge of the dialog:
 *
 *   * `m_staticTextArcEdit` is added on its own line (`:48`) and
 *     `m_choiceArcMode` on the next with `wxEXPAND` (`:54`) — its longest entry
 *     does not fit beside a label. Ours put the two on one row.
 *   * `m_hint1`'s string carries a newline (`:162`), so the note is two lines.
 *     Ours drew it as one, which set the column's width.
 *   * the note takes `KIUI::GetSmallInfoFont( this ).Italic()`
 *     (`panel_eeschema_editing_options.cpp:79`) — the GUI font two points down,
 *     italic — and no foreground at all. Ours dimmed it to #9aa0a6 at full
 *     size, and dimmed the Left Click table's first column the same way.
 *   * `m_hPitchCtrl` and `m_vPitchCtrl` are `wxTextCtrl`s (`:325`, `:336`);
 *     only `m_spinLabelRepeatStep` is a `wxSpinCtrl` (`:347`). Ours drew
 *     steppers on all three.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), '../designer/src');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');
const PANEL = read('editors/schematic/prefs/PanelEeschemaEditingOptions.tsx');
const CSS = read('ui/shell.css');
const CODE = PANEL.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

/** The props of the JSX element a label opens. */
function props(label: string): string {
  const at = CODE.indexOf(label);
  expect(at, label).toBeGreaterThan(-1);
  return CODE.slice(at, CODE.indexOf('/>', at));
}

describe('the left column is as wide as upstream makes it', () => {
  it('stacks the arc-mode label above a full-width choice', () => {
    expect(CODE).toContain('ze-pref-stacked');
    expect(rule('.ze-pref-stacked')).toMatch(/flex-direction:\s*column/);
    expect(rule('.ze-pref-stacked > .ze-combo')).toMatch(/width:\s*100%/);
  });

  it('breaks the hint where the string breaks it', () => {
    // `_("Left click (and drag) actions depend on 2 modifier keys:\nShift and Ctrl")`
    expect(CODE).toContain('Left click (and drag) actions depend on 2 modifier keys:');
    expect(CODE).toContain('<br />');
    expect(CODE).toContain('Shift and Ctrl');
  });
});

describe("the type is the panel's own, and neither run is dimmed", () => {
  it('gives the hint the small info font, italic', () => {
    const hint = rule('.ze-pref-hint');
    expect(hint).toContain('var(--ui-font-size-small)');
    expect(hint).toMatch(/font-style:\s*italic/);
    expect(hint).not.toMatch(/(^|[;\s])color\s*:/);
  });

  it('leaves the Left Click table in the dialog foreground', () => {
    expect(rule('.ze-pref-mouse td:first-child')).not.toMatch(/(^|[;\s])color\s*:/);
  });
});

describe('the repeated-item controls are the widgets upstream builds', () => {
  it.each([['Horizontal pitch:'], ['Vertical pitch:']])('%s is a wxTextCtrl', (label) => {
    expect(props(label), label).toContain('spin={false}');
  });

  it('leaves the label increment a spin control', () => {
    expect(props('Label increment:')).not.toContain('spin={false}');
  });
});

/**
 * `drawing.default_sheet_border_color` and `default_sheet_background_color` are
 * `PARAM<COLOR4D>( …, COLOR4D::UNSPECIFIED )` (`eeschema_settings.cpp:396-400`),
 * and `COLOR_SWATCH::MakeBitmap` paints the colour over a checkerboard at its
 * own alpha — so unset draws as the bare checkerboard, which is what a fresh
 * KiCad shows. Ours passed a `fallback`, and painted them solid.
 */
describe('an unset colour stays unset', () => {
  it('passes no fallback for the two sheet colours', () => {
    expect(props('Sheet border:')).not.toContain('fallback');
    expect(props('Sheet background:')).not.toContain('fallback');
  });
});

/**
 * A row is enabled exactly when something outside Preferences reads its
 * setting.
 */
describe('the rows nothing reads are disabled', () => {
  it.each([
    // Needs the Rescue Symbols tool, which this port does not have.
    ['Never show Rescue Symbols tool'],
  ])('%s is disabled', (label) => {
    expect(props(label), label).toMatch(/\bdisabled\b/);
  });

  it.each([
    // `input.drag_is_move` -> `ui/view_controls.ts:37`, `SchematicEditor.tsx:5300`
    ['Mouse drag performs Drag (G) operation', 'drag_is_move'],
    // `drawing.auto_start_wires` -> `SchematicEditor.tsx:5301`
    ['Automatically start wires on unconnected pins', 'auto_start_wires'],
    // `annotation.automatic` -> the paste mode, `SchematicEditor.tsx:2730`
    ['Automatically annotate symbols', 'annotation.automatic'],
    // `autoplace_fields.*` -> `SchematicEditor.tsx:3257-3260`
    ['Automatically place symbol fields', 'autoplace_fields.enable'],
    // `appearance.footprint_preview` -> `SchematicEditor.tsx:9580`
    ['Show footprint previews in Symbol Chooser', 'footprint_preview'],
    // The three "Defaults for New Objects" rows, stamped onto the item as it
    // is created (`sch_drawing_tools.cpp:3444-3446` and `:436-471`). Pinned in
    // `sch_new_object_defaults.test.ts`.
    ['Sheet border:', 'default_sheet_border_color'],
    ['Sheet background:', 'default_sheet_background_color'],
    ['Power Symbols:', 'new_power_symbols'],
    // Gates the Swap Pins context-menu entry and the tool behind it. Pinned in
    // `swap_pins.test.ts` and `sch_swap_pins_wired.test.ts`.
    ['Allow unconstrained pin swaps', 'allow_unconstrained_pin_swaps'],
  ])('%s is live, and bound to %s', (label, setting) => {
    const p = props(label);
    expect(p, label).toContain(setting);
    expect(p, label).not.toMatch(/\bdisabled\b/);
  });
});

/**
 * A numeric row's limits are KiCad's, and KiCad states them in two places that
 * disagree: the base file constructs the control with one range and the panel's
 * constructor then overrides it. The second one wins, and it is the one a user
 * runs into.
 */
describe('the Repeated Items limits are the ones upstream ends up with', () => {
  it('lets the label increment go to ±100000, not to some range of ours', () => {
    // `m_spinLabelRepeatStep->SetRange( -100000, 100000 )`
    // (`panel_eeschema_editing_options.cpp:83`) replaces the base file's
    // `wxSpinCtrl( …, -1000000, 1000000, 1 )` (`_base.cpp:347`). This said
    // -10..10 and so refused a repeat step of 100.
    const p = props('Label increment:');
    expect(p).toContain('min={-100000}');
    expect(p).toContain('max={100000}');
  });

  it('leaves the two pitches unbounded, because a UNIT_BINDER’s entry is', () => {
    // `m_hPitch` / `m_vPitch` are UNIT_BINDERs over plain wxTextCtrls
    // (`panel_eeschema_editing_options.cpp:72-73`) with no range set on either,
    // so a min or a max here would be invented.
    for (const label of ['Horizontal pitch:', 'Vertical pitch:']) {
      const p = props(label);
      expect(p, label).not.toMatch(/\bmin=/);
      expect(p, label).not.toMatch(/\bmax=/);
    }
  });
});
