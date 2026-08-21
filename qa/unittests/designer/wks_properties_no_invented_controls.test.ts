// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROPERTIES_FRAME` has no control, string, tooltip or limit that
 * `pagelayout_editor/dialogs/properties_frame{,_base}.cpp` does not have.
 *
 * The panel had drifted in five separate ways, none of which the existing
 * 35-test `wks_properties_frame.test.ts` could see, because every one of them
 * was an ADDITION and that file only asserts that the right things are present.
 *
 * Two rules shape this file:
 *
 *  - **Name every control.** A file-level `expect(PANEL).not.toContain(…)` is
 *    the shape of test that cannot fail here: the rule is per-control, so one
 *    surviving offender passes while its six siblings are clean. Each check
 *    below extracts the specific element it is about and asserts on that slice.
 *  - **Prefer calling to reading.** The two Printf formats are a real module
 *    (`properties_format.ts`) and are tested as functions. Only the wiring —
 *    which control gets which format, which control carries a tooltip — has to
 *    be read out of the `.tsx`, because there is no DOM test environment here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fmtInt,
  fmtRotation,
} from '@ziroeda/designer/src/editors/drawingsheet/properties_format.js';

const PANEL = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/PropertiesFrame.tsx', import.meta.url),
  ),
  'utf8',
);

/** The panel's source with comments blanked — prose must not read as code. */
const CODE = PANEL.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

/**
 * The `<Row label="…">…</Row>` element for one label. Fails rather than
 * returning an empty string when the row is gone, so a renamed or deleted
 * control cannot make a `not.toContain` pass vacuously.
 */
function row(label: string): string {
  // The label may sit on the `<Row` line or on its own, so find the label and
  // walk back to the element that opens it.
  const at = CODE.indexOf(`label="${label}"`);
  expect(at, `the "${label}" row must exist`).toBeGreaterThan(-1);
  const start = CODE.lastIndexOf('<Row', at);
  expect(start, `"${label}" must belong to a Row`).toBeGreaterThan(-1);
  const end = CODE.indexOf('</Row>', at);
  expect(end, `the "${label}" row must be closed`).toBeGreaterThan(start);
  return CODE.slice(start, end);
}

/** The `<FormatButton …>` element whose body contains `glyph`. */
function formatButton(glyph: string): string {
  const at = CODE.indexOf(glyph);
  expect(at, `the ${glyph} button must exist`).toBeGreaterThan(-1);
  const start = CODE.lastIndexOf('<FormatButton', at);
  expect(start, `${glyph} must belong to a FormatButton`).toBeGreaterThan(-1);
  return CODE.slice(start, at);
}

// ---------------------------------------------------------------- D4

describe('the Item Properties page with nothing selected', () => {
  it('is blank, with no sentence of our own', () => {
    // `CopyPrmsFromItemToPanel( nullptr )` hides the sizer and returns
    // (properties_frame.cpp:226-233), so the page shows NOTHING.
    expect(CODE).not.toContain('Select an item');
    expect(CODE).not.toMatch(/to edit its properties/);
  });

  it('renders null on that branch rather than any element', () => {
    // The alternative arm of the `item ? … : …` ternary, taken between the end
    // of <ItemProperties/> and the start of the outer arm. Asserting on the
    // VALUE rather than on its punctuation: whether the formatter wraps it in
    // parentheses is not the parity question, and an empty styled <div> with no
    // text would satisfy a check that only looked for the missing sentence.
    const at = CODE.indexOf('<ItemProperties');
    expect(at).toBeGreaterThan(-1);
    const close = CODE.indexOf('/>', at);
    const branch = CODE.slice(close + 2, CODE.indexOf('<GeneralOptions', at));
    expect(branch).toContain('null');
    // No element of any kind on this arm.
    expect(branch, 'the unselected arm renders no element').not.toMatch(/<[A-Za-z]/);
  });
});

// ---------------------------------------------------------------- D5

describe('the four plain wxTextCtrl fields', () => {
  it('prints Rotation with %.3f', () => {
    // properties_frame.cpp:295 and :342.
    expect(fmtRotation(0)).toBe('0.000');
    expect(fmtRotation(90)).toBe('90.000');
    expect(fmtRotation(1.23456)).toBe('1.235');
    expect(fmtRotation(-45.5)).toBe('-45.500');
  });

  it('prints Count, Step text and Bitmap DPI with %d', () => {
    // properties_frame.cpp:291, :351, :384.
    expect(fmtInt(1)).toBe('1');
    expect(fmtInt(300)).toBe('300');
    expect(fmtInt(-2)).toBe('-2');
    // %d takes an int: a fraction is truncated toward zero, never rounded up
    // and never shown with a decimal point.
    expect(fmtInt(2.9)).toBe('2');
    expect(fmtInt(-2.9)).toBe('-2');
    expect(fmtInt(300)).not.toContain('.');
  });

  it('renders NumField as a text input with no spinner and no step', () => {
    const at = CODE.indexOf('function NumField');
    expect(at).toBeGreaterThan(-1);
    const body = CODE.slice(at, CODE.indexOf('function ', at + 10));
    // m_textCtrlRotation / RepeatCount / TextIncrement / BitmapDPI are all
    // wxTextCtrl (properties_frame_base.cpp:369, 400, 410, 376). Not one is a
    // wxSpinCtrl, so there is no step and no pair of arrows.
    expect(body).toContain('type="text"');
    expect(body).not.toContain('type="number"');
    expect(body).not.toContain('step');
  });

  it('gives each of the four the format its own Printf uses', () => {
    expect(row('Rotation:')).toContain('format={fmtRotation}');
    for (const label of ['Count:', 'Step text:', 'Bitmap DPI:']) {
      expect(row(label), `${label} prints with %d`).toContain('format={fmtInt}');
    }
  });

  it('gives none of the four an invented step', () => {
    for (const label of ['Rotation:', 'Count:', 'Step text:', 'Bitmap DPI:']) {
      expect(row(label), `${label} must not declare a step`).not.toContain('step=');
    }
  });
});

// ---------------------------------------------------------------- D6

describe('the Count field', () => {
  it('enforces only >= 1, because the 1..100 range is the reader’s', () => {
    // `msg.ToLong( &itmp ); if( itmp < 1l ) itmp = 1;` is the whole check
    // (properties_frame.cpp:558-570). `parseInt( 1, 100 )` lives in
    // drawing_sheet_parser.cpp:429, 507, 672, 732 — the READER.
    const count = row('Count:');
    expect(count).toContain('Math.max(1');
    expect(count).not.toContain('Math.min(100');
    expect(count).not.toContain('100');
  });
});

// ---------------------------------------------------------------- D8

describe('tooltips', () => {
  // The seven SetToolTip calls in properties_frame_base.cpp are the whole list:
  // m_bold (:93), m_italic (:98), m_constraintXLabel (:185),
  // m_constraintYLabel (:198), m_textCtrlTextIncrement (:411),
  // m_textCtrlStepX (:423), m_textCtrlStepY (:436). properties_frame.cpp adds
  // none.
  it('keeps the two the format bar has', () => {
    expect(formatButton('<b>B</b>')).toContain('title="Bold"');
    expect(formatButton('<i>I</i>')).toContain('title="Italic"');
  });

  it('gives the six alignment buttons none, one button at a time', () => {
    for (const glyph of ['⬅', '↔', '➡', '⬆', '↕', '⬇']) {
      expect(formatButton(glyph), `the ${glyph} button carries no tooltip`).not.toContain('title=');
    }
  });

  it('gives the colour swatch none', () => {
    const at = CODE.indexOf('type="color"');
    expect(at).toBeGreaterThan(-1);
    const start = CODE.lastIndexOf('<input', at);
    expect(CODE.slice(start, CODE.indexOf('/>', at))).not.toContain('title=');
  });

  it('keeps the five the fields have, named one at a time', () => {
    expect(row('Maximum width:')).toContain('hint="Set to 0 to disable this constraint"');
    expect(row('Maximum height:')).toContain('hint="Set to 0 to disable this constraint"');
    expect(row('Step text:')).toContain(
      'hint="Number of characters or digits to step text by for each repeat."',
    );
    expect(row('Step X:')).toContain('hint="Distance on the X axis to step for each repeat."');
    expect(row('Step Y:')).toContain('hint="Distance to step on Y axis for each repeat."');
  });

  it('gives the size and pen-width rows none, one row at a time', () => {
    // "Set to 0 to use default values" is m_staticTextSizeInfo, a standalone
    // label (properties_frame_base.cpp:226), not a hint on three fields.
    for (const label of ['Text width:', 'Text height:', 'Line width:']) {
      expect(row(label), `${label} carries no tooltip`).not.toContain('hint=');
    }
  });

  it('still shows that string as its own label', () => {
    expect(CODE).toContain('Set to 0 to use default values</div>');
  });
});

describe('the Comment field', () => {
  it('puts its label above a full-width field, not beside it', () => {
    // m_staticTextComment then m_textCtrlComment, added to m_SizerItemProperties
    // as siblings, the field with wxEXPAND (properties_frame_base.cpp:233-238).
    expect(CODE).not.toContain('<Row label="Comment:"');
    const at = CODE.indexOf('ze-ds-stacklabel');
    expect(at, 'the Comment label must be stacked').toBeGreaterThan(-1);
    // The label keeps `.ze-ds-label`'s font and dimming rather than restating
    // them, and the field is the same full-width box `.ze-ds-textedit` already
    // defines — no second copy of either.
    expect(CODE.slice(Math.max(0, at - 40), at)).toContain('ze-ds-label');
    expect(CODE.slice(at, at + 400)).toContain('ze-ds-textedit');
  });
});

// ---------------------------------------------------------------- D9

describe('the text colour swatch', () => {
  it('has no clear button beside it', () => {
    // The bar ends at m_textColorSwatch (properties_frame_base.cpp:88-148).
    // Reset-to-default is inside DIALOG_COLOR_PICKER, fed m_default by
    // COLOR_SWATCH (color_swatch.cpp:301-311; set at properties_frame.cpp:124).
    expect(CODE).not.toContain('Clear color override');
    // The whole format bar, so any replacement button is caught too.
    const at = CODE.indexOf('className="ze-ds-fmtbar"');
    expect(at).toBeGreaterThan(-1);
    const bar = CODE.slice(at, CODE.indexOf('</div>', CODE.indexOf('type="color"', at)));
    expect(bar).not.toContain('color: undefined');
  });
});
