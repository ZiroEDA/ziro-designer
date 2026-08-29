// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A distance field in a dialog shows the FRAME's units, never a fixed one.
 *
 * Every such field upstream is a `UNIT_BINDER`, constructed with the label, the
 * text control AND the units label beside it — e.g. `DIALOG_LABEL_PROPERTIES`'s
 *
 *     m_textSize( aParent, m_textSizeLabel, m_textSizeCtrl, m_textSizeUnits, false )
 *         (dialog_label_properties.cpp:53)
 *
 * The binder formats through `StringFromValue`, parses through `ValueFromString`
 * and writes the unit NAME into that third control, all in
 * `EDA_DRAW_FRAME::GetUserUnits()`. A schematic in mils shows "50 mils" where
 * the same field in a mm schematic shows "1.27 mm".
 *
 * THE BUG THIS PINS, which has been the same bug three times now: a dialog
 * formats in millimetres and hardcodes "mm" beside the field. The properties
 * panel had it; `dialog_label_properties.tsx` and `dialog_text_properties.tsx`
 * both had it here — Akshay's schematic reads `mils` in its own status bar
 * while those dialogs said `1.27 mm`.
 *
 * It is a SOURCE scan on purpose. A rendered test needs a fixture per dialog
 * and only covers the ones someone remembered; the defect is per-file, and this
 * catches the next file to acquire it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIALOGS = fileURLToPath(
  new URL('../../../designer/src/editors/schematic/dialogs', import.meta.url),
);
const files = readdirSync(DIALOGS).filter((f) => f.endsWith('.tsx'));

/** Comments are prose: a `mm` in a header block is documentation, not a label. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The two banned shapes, as ONE predicate so no two blocks here can disagree
 * about what counts. They did on the first draft — the scan used `\s*` and the
 * debt check used ` ?`, and the two then named different files.
 */
function hardcodesUnits(file: string): string[] {
  const src = code(readFileSync(join(DIALOGS, file), 'utf8'));
  return [
    ...[...src.matchAll(/>\s*(mm|mils|in|inches)\s*</g)].map((m) => `unit label "${m[1]}"`),
    ...[...src.matchAll(/useState\([^)]*\b(?:mmText|iuToMM)\s*\(/g)].map(() => 'mm-seeded field'),
  ];
}

/**
 * Dialogs that STILL hardcode a unit. Listed so the debt is visible and cannot
 * grow: a file NOT on this list must be clean, and a file on it that gets fixed
 * must be removed (the last block enforces that, so the list cannot rot into a
 * permanent excuse).
 *
 * Each is a real defect, checked against upstream — e.g.
 * `DIALOG_SHEET_PIN_PROPERTIES` binds its text size with
 * `m_textSize( parent, m_textSizeLabel, m_textSizeCtrl, m_textSizeUnits )`
 * (dialog_sheet_pin_properties.cpp:44) while ours renders a literal "mm".
 */
const KNOWN_HARDCODED = new Set([
  'dialog_global_edit_text_and_graphics.tsx',
  'dialog_image_properties.tsx',
  'dialog_line_properties.tsx',
  'dialog_plot.tsx',
  'dialog_shape_properties.tsx',
  'dialog_sheet_pin_properties.tsx',
  'dialog_sheet_properties.tsx',
  'dialog_table_properties.tsx',
]);

describe('a dialog never hardcodes a unit name beside a field', () => {
  it.each(files.filter((f) => !KNOWN_HARDCODED.has(f)))('%s', (file) => {
    expect(hardcodesUnits(file), `${file}: use unitLabel(units) and the unit binder`).toEqual([]);
  });
});

describe('the debt list stays honest', () => {
  // A fixed file must leave the list. Without this the list is a place to hide
  // a regression: add the filename and the scan goes quiet.
  it.each([...KNOWN_HARDCODED])('%s still has it, or should be removed', (file) => {
    expect(
      hardcodesUnits(file).length,
      `${file} is clean now — take it out of KNOWN_HARDCODED`,
    ).toBeGreaterThan(0);
  });

  it('and names only files that exist', () => {
    for (const f of KNOWN_HARDCODED) expect(files, f).toContain(f);
  });
});

describe('the two dialogs this was found in take the units as a prop', () => {
  // Named, so the fix cannot be reverted quietly: the scan above also passes
  // for a dialog that simply has no distance field at all.
  it.each(['dialog_label_properties.tsx', 'dialog_text_properties.tsx'])('%s', (file) => {
    const src = readFileSync(join(DIALOGS, file), 'utf8');
    expect(src).toMatch(/units:\s*StatusUnits/);
    expect(src).toMatch(/unitLabel\(units\)/);
    expect(src).toMatch(/parseUnitValueDouble\(/);
  });
});
