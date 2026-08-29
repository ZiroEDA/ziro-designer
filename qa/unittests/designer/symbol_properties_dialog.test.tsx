// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol Properties, against `DIALOG_SYMBOL_PROPERTIES` and the
 * `dialog_symbol_properties_base.cpp` it derives from.
 *
 * Every assertion below is one structural fact with one line of C++ behind it,
 * rather than a snapshot of the whole dialog. A snapshot cannot fail for the
 * right reason: it goes red the moment anything else in the dialog changes, so
 * it gets re-baselined, and the re-baseline is where the rule quietly leaves.
 * Each of these has a mutant that kills it and nothing else.
 *
 * These are the differences a side-by-side against a live KiCad 10.0.5 turned
 * up, which is why they are the things pinned:
 *
 *   1. two notebook pages against upstream's three;
 *   2. two field rows against upstream's five, so the footprint and the
 *      datasheet could not be reached from this dialog at all;
 *   3. no "Fields" static box;
 *   4. a visible dropdown in every H Align / V Align cell, where wxGrid draws
 *      those as text until the cell is opened;
 *   5. wide text buttons under the grid instead of STD_BITMAP_BUTTONs;
 *   6. the pin-number/pin-name checkboxes in Attributes instead of General;
 *   7. the four hand-off buttons along the bottom instead of down the right;
 *   8. the library link as plain text instead of a read-only wxTextCtrl;
 *   9. the whole row filled on open, where upstream only puts a cursor there.
 */
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import type { LibSymbol, SchSymbol, SymbolEdit } from '@ziroeda/eeschema';
import { SymbolPropertiesDialog } from '@ziroeda/designer/src/editors/schematic/components/SymbolPropertiesDialog.js';

/**
 * One declaration of one rule in `shell.css`, by exact selector.
 *
 * Comments are stripped from the WHOLE stylesheet before anything is indexed,
 * not from the extracted rule body. Several of these rules carry a comment that
 * quotes C++ — `.ze-grid th` quotes `WX_GRID::SetLabelFont`, braces and all — and
 * slicing to the first `}` in the raw text lands inside that comment and returns
 * a body missing everything after it.
 */
const SHELL = readFileSync(join(__dirname, '../../../designer/src/ui/shell.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const decl = (selector: string, prop: string): string | undefined => {
  const at = SHELL.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = SHELL.indexOf('{', at);
  const body = SHELL.slice(open + 1, SHELL.indexOf('}', open));
  return new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim();
};

afterEach(cleanup);

/**
 * A resistor placed the way OUR placer places one — Reference and Value only
 * (`makeSymbol`, eeschema/src/tools/build.ts) — beside a library part that
 * carries all five mandatory properties. That gap is difference 2: KiCad's
 * SCH_SYMBOL always has five fields because it copied the part's.
 */
const SHEET = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "Device:R" (pin_names (offset 0))
      (property "Reference" "R" (at 2.032 0 90))
      (property "Value" "R" (at 0 0 90))
      (property "Footprint" "" (at -1.778 0 90) (effects (font (size 1.27 1.27)) (hide yes)))
      (property "Datasheet" "~" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (property "Description" "Resistor" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "R_0_1" (rectangle (start -1.016 2.54) (end 1.016 -2.54)))))
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "r-1")
    (property "Reference" "R1" (at 53.34 49.53 0)
      (effects (font (size 1.27 1.27)) (justify left)))
    (property "Value" "10k" (at 53.34 52.07 0) (effects (font (size 1.27 1.27))))))`;

/**
 * The same resistor, but the file claims unit 2 and body style 2 for a part
 * that offers neither. `TransferDataFromWindow` writes 1 for both when the
 * combo is disabled, and a symbol already on 1 cannot show that.
 */
const UNIT2 = SHEET.replace('(unit 1)', '(unit 2) (body_style 2)');

/** A two-unit part with a De Morgan alternate, for the combos' enable rules. */
const MULTI = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "Device:Dual"
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "Dual" (at 0 0 0))
      (symbol "Dual_1_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08)))
      (symbol "Dual_1_2" (rectangle (start -5.08 5.08) (end 5.08 -5.08)))
      (symbol "Dual_2_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08)))
      (symbol "Dual_2_2" (rectangle (start -5.08 5.08) (end 5.08 -5.08)))))
  (symbol (lib_id "Device:Dual") (at 50.8 50.8 0) (unit 1) (uuid "u-1")
    (property "Reference" "U1" (at 0 0 0))
    (property "Value" "Dual" (at 0 0 0))))`;

/** A power symbol: its Footprint value is read-only and Simulation Model goes. */
const POWER = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "power:GND" (power)
      (property "Reference" "#PWR" (at 0 0 0))
      (property "Value" "GND" (at 0 0 0))
      (property "Footprint" "" (at 0 0 0))
      (property "Datasheet" "" (at 0 0 0))
      (property "Description" "Power symbol" (at 0 0 0))
      (symbol "GND_0_1" (rectangle (start -1 1) (end 1 -1)))))
  (symbol (lib_id "power:GND") (at 50.8 50.8 0) (unit 1) (uuid "g-1")
    (property "Reference" "#PWR01" (at 0 0 0))
    (property "Value" "GND" (at 0 0 0))))`;

/**
 * Multi-unit with ONE body style. MULTI is multi-unit AND multi-body-style and
 * SHEET is neither, so on those two alone a rule that greys both the Unit and
 * the Body style label off a single condition cannot be told from the right
 * one. This fixture is the case that separates them.
 */
const DUAL_UNIT_ONLY = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "Device:DualU"
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "DualU" (at 0 0 0))
      (symbol "DualU_1_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08)))
      (symbol "DualU_2_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08)))))
  (symbol (lib_id "Device:DualU") (at 50.8 50.8 0) (unit 1) (uuid "du-1")
    (property "Reference" "U1" (at 0 0 0))
    (property "Value" "DualU" (at 0 0 0))))`;

/** A symbol whose Reference names a face, for the Font column. */
const FACED = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0))
      (property "Value" "R" (at 0 0 0))
      (symbol "R_0_1" (rectangle (start -1 1) (end 1 -1)))))
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "r-3")
    (property "Reference" "R1" (at 50.8 45.8 0)
      (effects (font (face "Times New Roman") (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0))))`;

/**
 * Pins declared 10, 2, 1. Library order, a stable sort and a plain string sort
 * ("1" < "10" < "2") each produce a different wrong answer, so only
 * `PIN_NUMBERS::Compare` gives 1, 2, 10.
 */
const PINS = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "Device:Conn"
      (property "Reference" "J" (at 0 0 0))
      (property "Value" "Conn" (at 0 0 0))
      (symbol "Conn_1_1"
        (pin passive line (at 0 5.08 180) (length 2.54)
          (name "C" (effects (font (size 1.27 1.27))))
          (number "10" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 2.54 180) (length 2.54)
          (name "B" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 0 180) (length 2.54)
          (name "A" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "Device:Conn") (at 50.8 50.8 0) (unit 1) (uuid "j-1")
    (property "Reference" "J1" (at 0 0 0))
    (property "Value" "Conn" (at 0 0 0))))`;

/** Two units, one pin each, one body style — for the Unit combo's rebuild. */
const TWO_UNIT_PINS = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "Device:DualP"
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "DualP" (at 0 0 0))
      (symbol "DualP_1_1"
        (pin passive line (at 0 0 180) (length 2.54)
          (name "A" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))
      (symbol "DualP_2_1"
        (pin passive line (at 0 0 180) (length 2.54)
          (name "B" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "Device:DualP") (at 50.8 50.8 0) (unit 1) (uuid "dp-1")
    (property "Reference" "U1" (at 0 0 0))
    (property "Value" "DualP" (at 0 0 0))))`;

/** A part carrying an embedded file, for the third page. */
const EMBEDDED = `(kicad_sch (version 20250114) (generator "test")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0))
      (property "Value" "R" (at 0 0 0))
      (embedded_fonts yes)
      (embedded_files (file (name "datasheet.pdf") (type datasheet)))
      (symbol "R_0_1" (rectangle (start -1 1) (end 1 -1)))))
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "r-2")
    (property "Reference" "R1" (at 0 0 0))
    (property "Value" "R" (at 0 0 0))))`;

function open(
  src: string,
  extra: Partial<Parameters<typeof SymbolPropertiesDialog>[0]> = {},
): { symbol: SchSymbol; lib: LibSymbol; edits: SymbolEdit[] } {
  const doc = readSchematic(parse(src));
  const symbol = doc.symbols[0]!;
  const lib = doc.libSymbols[0]!;
  const edits: SymbolEdit[] = [];
  render(
    <SymbolPropertiesDialog
      symbol={symbol}
      lib={lib}
      onOk={(e) => edits.push(e)}
      onCancel={() => {}}
      onUpdateSymbol={() => {}}
      onChangeSymbol={() => {}}
      onEditSymbol={() => {}}
      onEditLibrarySymbol={() => {}}
      {...extra}
    />,
  );
  return { symbol, lib, edits };
}

/** The fields grid's `<tbody>` rows, in order. */
const fieldRows = (): HTMLTableRowElement[] =>
  Array.from(document.querySelectorAll<HTMLTableRowElement>('.ze-symprops-grid tbody tr'));

/** The Name cell of each field row: its text, or its editor's value when the
 *  grid cursor has that cell open. */
const fieldNames = (): string[] =>
  fieldRows().map((tr) => {
    const cell = tr.querySelector('td');
    const editor = cell?.querySelector('input');
    return (editor ? editor.value : (cell?.textContent ?? '')).trim();
  });

/** The `<fieldset>` whose `<legend>` reads `name`. */
function groupBox(name: string): HTMLElement {
  const box = Array.from(document.querySelectorAll('fieldset')).find(
    (f) => f.querySelector('legend')?.textContent?.trim() === name,
  );
  if (!box) throw new Error(`no group box called ${name}`);
  return box;
}

describe('1. the notebook has upstream three pages', () => {
  it('General, Pin Functions and Embedded Files, in that order', () => {
    open(EMBEDDED);
    // AddPage( generalPage, "General", true ), AddPage( m_pinTablePage,
    // "Pin Functions", false ) in the base file, then AddPage( m_embeddedFiles,
    // "Embedded Files" ) in the constructor.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toStrictEqual([
      'General',
      'Pin Functions',
      'Embedded Files',
    ]);
  });

  it('opens on General, which is the page AddPage was told to select', () => {
    open(EMBEDDED);
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');
  });

  it('the Embedded Files page lists the LIBRARY symbol s files', () => {
    // SCH_SYMBOL::GetEmbeddedFiles returns GetLibSymbolRef()->GetEmbeddedFiles()
    // (sch_symbol.cpp:2790-2798), so the page shows the part's collection.
    open(EMBEDDED);
    fireEvent.click(screen.getByRole('tab', { name: 'Embedded Files' }));
    expect(screen.getByText('datasheet.pdf')).toBeTruthy();
    expect(screen.getByText('kicad-embed://datasheet.pdf')).toBeTruthy();
  });
});

describe('2. every mandatory field is a row', () => {
  it('shows all five, in FIELD_T order, for a symbol whose file wrote two', () => {
    open(SHEET);
    expect(fieldNames()).toStrictEqual([
      'Reference',
      'Value',
      'Footprint',
      'Datasheet',
      'Description',
    ]);
  });

  it('fills the three the file lacked from the library part', () => {
    open(SHEET);
    const description = fieldRows()[4]!;
    expect(within(description).getAllByRole('cell')[1]?.textContent).toBe('Resistor');
  });

  it('a private field is not a row, though it survives OK', () => {
    // FIELDS_GRID_TABLE::getVisibleRowCount skips IsPrivate() in FRAME_SCH.
    const { edits } = open(
      SHEET.replace(
        '(property "Value" "10k" (at 53.34 52.07 0) (effects (font (size 1.27 1.27))))))',
        '(property "Value" "10k" (at 53.34 52.07 0) (effects (font (size 1.27 1.27))))' +
          '(property private "Sim.Params" "r=10k" (at 0 0 0))))',
      ),
    );
    expect(fieldNames()).not.toContain('Sim.Params');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(edits[0]?.fields.map((f) => f.key)).toContain('Sim.Params');
  });
});

describe('3. the grid sits in a "Fields" static box', () => {
  it('the box exists and the grid is inside it', () => {
    // sbFields = new wxStaticBoxSizer( new wxStaticBox( generalPage, wxID_ANY,
    // _("Fields") ), wxVERTICAL ), base file line 27-28.
    open(SHEET);
    expect(groupBox('Fields').querySelector('.ze-symprops-grid')).toBeTruthy();
  });
});

describe('4. a cell is a control only while it is being edited', () => {
  it('H Align and V Align draw as text, not as a dropdown', () => {
    // m_hAlignAttr/m_vAlignAttr set only a wxGridCellChoiceEditor and no
    // renderer, so the default string renderer paints them until the editor is
    // shown (fields_grid_table.cpp:347-357).
    open(SHEET);
    expect(document.querySelectorAll('.ze-symprops-grid select')).toHaveLength(0);
    const reference = fieldRows()[0]!;
    const cells = within(reference).getAllByRole('cell');
    expect(cells[4]?.textContent).toBe('Left');
    expect(cells[5]?.textContent).toBe('Center');
  });

  it('the opened editor offers the choice editor s items, in its order', () => {
    // wxArrayString hAlignNames { Left, Center, Right } (fields_grid_table.cpp:
    // 355-357). The <option>s come off FIELDS_GRID_COLUMNS, so the list the
    // dialog offers and the list the column table records cannot drift apart.
    open(SHEET);
    const hAlign = within(fieldRows()[1]!).getAllByRole('cell')[4]!;
    fireEvent.doubleClick(hAlign);
    expect(Array.from(hAlign.querySelector('select')!.options).map((o) => o.text)).toStrictEqual([
      'Left',
      'Center',
      'Right',
    ]);
    const vAlign = within(fieldRows()[1]!).getAllByRole('cell')[5]!;
    fireEvent.doubleClick(vAlign);
    expect(Array.from(vAlign.querySelector('select')!.options).map((o) => o.text)).toStrictEqual([
      'Top',
      'Center',
      'Bottom',
    ]);
  });

  it('a SINGLE click opens the editor, on mouse up', () => {
    /**
     * `GRID_TRICKS::onGridCellLeftClick` (grid_tricks.cpp:218-231), whose own
     * comment is "Don't make users click twice to toggle a checkbox or edit a
     * text cell"; `m_enableSingleClickEdit` is true by default (:48). This
     * dialog wanted two clicks.
     *
     * `showEditor` ends with `ShowEditorOnMouseUp()`, so the editor appears on
     * the UP, not the down — which is also what keeps the browser from blurring
     * it away while it is still handling the mousedown.
     */
    open(SHEET);
    const cell = within(fieldRows()[1]!).getAllByRole('cell')[4]!;
    fireEvent.mouseDown(cell);
    expect(cell.querySelector('select')).toBeNull();
    fireEvent.mouseUp(cell);
    expect(cell.querySelector('select')).toBeTruthy();
  });

  it('but a read-only cell only selects the row, as showEditor returns false', () => {
    // `showEditor`'s `isReadOnly( aRow, aCol )` guard: a mandatory field's NAME
    // is read-only (fields_grid_table.cpp:592-597), so the event is skipped and
    // the click falls through to plain row selection.
    open(SHEET);
    const nameCell = within(fieldRows()[1]!).getAllByRole('cell')[0]!;
    fireEvent.mouseDown(nameCell);
    fireEvent.mouseUp(nameCell);
    expect(nameCell.querySelector('input')).toBeNull();
    expect(nameCell.closest('tr')?.className).toContain('selected');
  });

  it('and suppresses that click\u2019s default, or the editor loses focus at once', () => {
    /**
     * The editor mounts with `autoFocus`. If the browser is left to finish the
     * mousedown it moves focus to the element that was clicked, blurring the
     * editor straight back out; `onBlur` closes it and the cell reads as
     * permanently uneditable — the row highlights and nothing else ever
     * happens, however many times you click. Akshay hit exactly that on the
     * Footprint row.
     *
     * Upstream avoids the same class of problem by deferring the editor to
     * `ShowEditorOnMouseUp()`, noting that "wxGrid\u2019s MouseUp handler ... has
     * disabled the editor yet again". We do both: open on the up, and stop the
     * down\u2019s default, which also stops a drag selecting the cell\u2019s text, as
     * a wxGrid never does.
     *
     * This asserts `defaultPrevented` rather than the focus, because happy-dom
     * does not implement the browser\u2019s default focus-on-mousedown at all: the
     * test above passes with or without the fix, and so would any test that
     * only looked at the DOM.
     */
    open(SHEET);
    const cell = within(fieldRows()[1]!).getAllByRole('cell')[1]!;

    const down = createEvent.mouseDown(cell);
    fireEvent(cell, down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent.mouseUp(cell);
    expect(cell.querySelector('input')).toBeTruthy();

    // Already open: the default must come back, or the caret cannot be placed.
    const again = createEvent.mouseDown(cell);
    fireEvent(cell, again);
    expect(again.defaultPrevented).toBe(false);
  });

  it('and a click inside the open editor is the editor\u2019s, not the grid\u2019s', () => {
    /**
     * The editor control has the mouse once it is up; wxGrid never sees the
     * click. So the second click places the caret and does nothing else — it
     * must not move the cursor, re-select the row, or re-open the editor.
     *
     * Akshay: "2nd click ... i can place cursor in whole long string anywhere
     * so no highlight on 2nd click". Handling it as a grid click flashed the
     * row highlight back on and re-ran `SetSelection( -1, -1 )`, which put the
     * whole value back under selection and made the middle of a long string
     * unreachable.
     */
    open(SHEET);
    const cell = within(fieldRows()[1]!).getAllByRole('cell')[1]!;
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(cell);
    const editor = cell.querySelector('input');
    expect(editor).toBeTruthy();
    expect(cell.closest('tr')?.className).not.toContain('selected');

    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(cell);
    // Same editor element: not torn down and rebuilt, so the caret survives.
    expect(cell.querySelector('input')).toBe(editor);
    // And the row highlight never comes back.
    expect(cell.closest('tr')?.className).not.toContain('selected');
  });

  it('Show / Show Name / Italic / Bold are checkboxes at all times', () => {
    // m_boolAttr->SetRenderer( new wxGridCellBoolRenderer() ), :338-341.
    open(SHEET);
    const cells = within(fieldRows()[0]!).getAllByRole('cell');
    for (const col of [2, 3, 6, 7]) {
      expect(cells[col]?.querySelector('input[type="checkbox"]')).toBeTruthy();
    }
  });

  it('shows the eight columns ShowHideColumns names, and no more', () => {
    // m_fieldsGrid->ShowHideColumns( "0 1 2 3 4 5 6 7" ),
    // dialog_symbol_properties.cpp:341.
    open(SHEET);
    expect(
      Array.from(document.querySelectorAll('.ze-symprops-grid thead th')).map((t) => t.textContent),
    ).toStrictEqual(['Name', 'Value', 'Show', 'Show Name', 'H Align', 'V Align', 'Italic', 'Bold']);
  });
});

describe('5. the buttons under the grid are STD_BITMAP_BUTTONs', () => {
  it('add, move up, move down, then delete after a fixed gap', () => {
    // bButtonSize: m_bpAdd, m_bpMoveUp, m_bpMoveDown, Add( 20, 0 ), m_bpDelete.
    open(SHEET);
    const row = groupBox('Fields').querySelector('.ze-grid-btns')!;
    expect(
      Array.from(row.querySelectorAll('button')).map((b) => b.getAttribute('title')),
    ).toStrictEqual(['Add field', 'Move up', 'Move down', 'Delete field']);
    // The delete button is set apart by a spacer, not pushed to the far end.
    expect(row.querySelector('.ze-symprops-btngap')).toBeTruthy();
  });

  it('each is an icon button carrying KiCad s own bitmap', () => {
    // m_bpAdd->SetBitmap( KiBitmapBundle( BITMAPS::small_plus ) ) and friends.
    open(SHEET);
    const row = groupBox('Fields').querySelector('.ze-grid-btns')!;
    for (const b of Array.from(row.querySelectorAll('button'))) {
      expect(b.className).toContain('ze-gridbtn');
      expect(b.textContent).toBe('');
    }
  });
});

describe('6. which box each control lives in', () => {
  it('Show pin numbers and Show pin names are in General, not Attributes', () => {
    // bSizer11 is added to sbGeneralProps, base file line 176-192.
    open(SHEET);
    const general = groupBox('General').textContent ?? '';
    expect(general).toContain('Show pin numbers');
    expect(general).toContain('Show pin names');
    expect(groupBox('Attributes').textContent).not.toContain('Show pin');
  });

  it('General holds Unit, Body style, Angle and Mirror in that order', () => {
    open(SHEET);
    expect(
      Array.from(groupBox('General').querySelectorAll('.ze-symprops-lbl')).map(
        (l) => l.textContent,
      ),
    ).toStrictEqual(['Unit:', 'Body style:', 'Angle:', 'Mirror:']);
  });

  it('Attributes holds the five exclusions in the base file s order', () => {
    // sbAttributes: sim, (10px), bill of materials, board, position files, DNP.
    open(SHEET);
    expect(
      Array.from(groupBox('Attributes').querySelectorAll('label')).map((l) =>
        l.textContent?.trim(),
      ),
    ).toStrictEqual([
      'Exclude from simulation',
      'Exclude from bill of materials',
      'Exclude from board',
      'Exclude from position files',
      'Do not populate',
    ]);
  });
});

describe('7. the hand-off buttons are a column on the right', () => {
  it('all four are there, in buttonsSizer s order', () => {
    open(SHEET);
    const column = document.querySelector('.ze-symprops-buttons')!;
    expect(Array.from(column.querySelectorAll('button')).map((b) => b.textContent)).toStrictEqual([
      'Update Symbol from Library...',
      'Change Symbol...',
      'Edit Symbol...',
      'Edit Library Symbol...',
    ]);
  });

  it('the column is a child of the lower half, not of the dialog footer', () => {
    open(SHEET);
    expect(document.querySelector('.ze-symprops-lower > .ze-symprops-buttons')).toBeTruthy();
    expect(document.querySelector('.ze-modal-footer .ze-symprops-buttons')).toBeNull();
  });

  it('Edit Symbol and Edit Library Symbol need a cached library symbol', () => {
    // onUpdateEditSymbol: event.Enable( m_symbol && m_symbol->GetLibSymbolRef() ).
    open(SHEET, { lib: undefined });
    expect(screen.getByRole('button', { name: 'Edit Symbol...' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      screen.getByRole('button', { name: 'Edit Library Symbol...' }).hasAttribute('disabled'),
    ).toBe(true);
    // The other two do not: they open a dialog that replaces the library link.
    expect(screen.getByRole('button', { name: 'Change Symbol...' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});

describe('8. the library link is a read-only entry', () => {
  it('an input, not a span, carrying the lib id', () => {
    // m_tcLibraryID = new wxTextCtrl( …, wxTE_READONLY|wxBORDER_NONE ).
    open(SHEET);
    const field = document.querySelector<HTMLInputElement>('.ze-symprops-libid')!;
    expect(field.tagName).toBe('INPUT');
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe('Device:R');
  });

  it('sits in the dialog s bottom bar, outside the notebook', () => {
    // mainSizer->Add( bSizerBottom, … ) is a sibling of the notebook, so the
    // link does not disappear when the Pin Functions page comes up.
    open(SHEET);
    fireEvent.click(screen.getByRole('tab', { name: 'Pin Functions' }));
    expect(document.querySelector('.ze-modal-footer .ze-symprops-libid')).toBeTruthy();
  });
});

describe('the dialog is Fit(), so it states no size', () => {
  it('the modal root carries no sized variant class', () => {
    // `mainSizer->Fit( this )` and `finishDialogSettings()`, and no SetSize
    // anywhere in DIALOG_SYMBOL_PROPERTIES. `.ze-props-dialog`, which this used
    // to carry alongside `.ze-symprops`, states `width: 1060px` in shell.css —
    // a number that appears nowhere upstream and that silently won over
    // `.ze-modal`'s max-content.
    open(SHEET);
    const modal = document.querySelector('.ze-modal')!;
    expect(modal.className.split(/\s+/).sort()).toStrictEqual(['ze-modal', 'ze-symprops']);
  });
});

describe('9. the grid opens with a cursor, not a selection', () => {
  it('nothing is filled until the user clicks a row', () => {
    // The constructor queues SYMBOL_DELAY_FOCUS / SYMBOL_DELAY_SELECTION for
    // { 0, FDC_VALUE } and calls SetGridCursor, which selects nothing.
    open(SHEET);
    expect(document.querySelectorAll('.ze-symprops-grid tr.selected')).toHaveLength(0);
    // …and the cursor really is on the Reference row's Value cell.
    expect(within(fieldRows()[0]!).getAllByRole('cell')[1]?.className).toContain('cursor');
  });

  it('a click fills the row, because the grid is wxGridSelectRows', () => {
    open(SHEET);
    fireEvent.mouseDown(within(fieldRows()[2]!).getAllByRole('cell')[0]!);
    const filled = document.querySelectorAll('.ze-symprops-grid tr.selected');
    expect(filled).toHaveLength(1);
    expect(filled[0]).toBe(fieldRows()[2]);
  });
});

describe('the mandatory-field rules the buttons guard', () => {
  it('a mandatory field s Name cell holds text, never an entry', () => {
    // FIELDS_GRID_TABLE::GetAttr, FDC_NAME: attr->SetReadOnly( true ).
    open(SHEET);
    const nameCell = within(fieldRows()[0]!).getAllByRole('cell')[0]!;
    fireEvent.mouseDown(nameCell);
    fireEvent.mouseDown(nameCell);
    expect(nameCell.querySelector('input')).toBeNull();
  });

  it('deleting one refuses with upstream s message', () => {
    open(SHEET);
    fireEvent.mouseDown(within(fieldRows()[2]!).getAllByRole('cell')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }));
    expect(screen.getByText(/The first 5 fields are mandatory\./)).toBeTruthy();
    expect(fieldNames()).toHaveLength(5);
  });

  it('a user field added after them can be deleted', () => {
    open(SHEET);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(fieldNames()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }));
    expect(fieldNames()).toHaveLength(5);
  });

  it('the first user field cannot be moved up into the mandatory block', () => {
    // OnMoveUp's filter is `row > GetMandatoryRowCount()`, strictly greater.
    open(SHEET);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
    expect(fieldNames()[4]).toBe('Description');
    expect(fieldNames()[5]).toBe('Field5');
  });

  it('a power symbol s Footprint value is read-only too', () => {
    // "Power symbols do not appear in the board, so don't allow a footprint."
    open(POWER);
    const cell = within(fieldRows()[2]!).getAllByRole('cell')[1]!;
    fireEvent.mouseDown(cell);
    fireEvent.mouseDown(cell);
    expect(cell.querySelector('input')).toBeNull();
  });

  it('and a power symbol has no Simulation Model button at all', () => {
    // if( m_part && m_part->IsPower() ) m_spiceFieldsButton->Hide();
    open(POWER);
    expect(screen.queryByRole('button', { name: /Simulation Model/ })).toBeNull();
    open(SHEET);
    expect(screen.getByRole('button', { name: /Simulation Model/ })).toBeTruthy();
  });
});

/**
 * Choose an option in a `ui/Combo` by its visible label.
 *
 * Combo is the wxChoice port: a button that opens a `role="listbox"`. There is
 * no `<select>` to `fireEvent.change`, because a native select's option list is
 * drawn by the OS and cannot be themed — see Combo.tsx's header.
 */
function pickCombo(name: string, label: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
  const option = screen.getAllByRole('option').find((o) => (o.textContent ?? '').trim() === label);
  if (!option) throw new Error(`Combo "${name}" offers no option "${label}"`);
  // mouseDown, not click: GTK commits a wxChoice on press, and Combo binds
  // onMouseDown to match (Combo.tsx:200).
  fireEvent.mouseDown(option);
}

describe('the Unit and Body style combos', () => {
  /**
   * Both are `ui/Combo`, the wxChoice port, not a native `<select>`: a native
   * one draws its option list with the OS, so its highlight is Chrome's blue
   * rgb(153,200,255) where GTK paints rgb(62,62,62) (see Combo.tsx's header
   * for the side-by-side measurement). The control is a button that opens a
   * `role="listbox"`, so the options are read by opening it rather than off
   * `HTMLSelectElement.options`.
   */
  const combo = (name: string): HTMLButtonElement =>
    screen.getByRole('button', { name }) as HTMLButtonElement;

  /** The labels the popup offers, in order. */
  const optionsOf = (name: string): string[] => {
    const btn = combo(name);
    fireEvent.click(btn);
    if (!screen.queryByRole('listbox')) fireEvent.mouseDown(btn);
    const list = screen.queryByRole('listbox');
    const labels = list
      ? Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.textContent ?? '')
      : [];
    if (list) fireEvent.click(btn);
    return labels;
  };

  it('are empty and disabled for a part that is neither', () => {
    // TransferDataToWindow appends nothing and calls Enable( false ) on both.
    open(SHEET);
    expect(combo('Unit').disabled).toBe(true);
    expect(combo('Body style').disabled).toBe(true);
    // A disabled Combo does not open, so the emptiness is asserted on the
    // options it was given rather than on a popup that cannot appear.
    expect(optionsOf('Unit')).toStrictEqual([]);
    expect(optionsOf('Body style')).toStrictEqual([]);
  });

  it('list GetUnitDisplayName( ii, false ) — the bare letter — when multi-unit', () => {
    open(MULTI);
    expect(combo('Unit').disabled).toBe(false);
    expect(optionsOf('Unit')).toStrictEqual(['A', 'B']);
  });

  it('list Standard and Alternate when the part has a second body style', () => {
    open(MULTI);
    expect(combo('Body style').disabled).toBe(false);
    expect(optionsOf('Body style')).toStrictEqual(['Standard', 'Alternate']);
  });

  it('the Pin Functions page is disabled for a multi-body-style part', () => {
    // "Alternate pin assignments are not available for symbols with multiple
    // body styles."  m_pinTablePage->Disable() with that tooltip.
    open(MULTI);
    const tab = screen.getByRole('tab', { name: 'Pin Functions' });
    expect(tab.hasAttribute('disabled')).toBe(true);
    expect(tab.getAttribute('title')).toMatch(/multiple body styles/);
  });

  it('OK writes unit 1 and body style 1 when both combos are disabled', () => {
    //   int unit_selection = m_unitChoice->IsEnabled() ? GetSelection() + 1 : 1;
    //   int bodyStyle_selection = m_bodyStyleChoice->IsEnabled() ? … + 1 : 1;
    // The fixture claims unit 2 and body style 2 for a part that has neither,
    // which is the only way this can be tested at all: a symbol already on 1
    // comes out 1 whatever the dialog does.
    const { symbol, edits } = open(UNIT2);
    expect(symbol.unit).toBe(2);
    expect(symbol.bodyStyle).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(edits[0]?.unit).toBe(1);
    expect(edits[0]?.bodyStyle).toBe(1);
  });

  it('and keeps the selection when the part really does have them', () => {
    const { edits } = open(MULTI);
    pickCombo('Unit', 'B');
    pickCombo('Body style', 'Alternate');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(edits[0]?.unit).toBe(2);
    expect(edits[0]?.bodyStyle).toBe(2);
  });
});

describe('the hidden columns are reachable, as GRID_TRICKS makes them', () => {
  it('right-clicking a column label offers all fifteen', () => {
    // GRID_TRICKS::onGridLabelRightClick appends a check item per column.
    open(SHEET);
    fireEvent.contextMenu(document.querySelector('.ze-symprops-grid thead tr')!);
    expect(
      Array.from(document.querySelectorAll('.ze-symprops-colmenu .lbl')).map((l) => l.textContent),
    ).toStrictEqual([
      'Name',
      'Value',
      'Show',
      'Show Name',
      'H Align',
      'V Align',
      'Italic',
      'Bold',
      'Text Size',
      'Orientation',
      'X Position',
      'Y Position',
      'Font',
      'Color',
      'Allow Autoplacement',
    ]);
  });

  it('turning one on adds its column to the grid', () => {
    open(SHEET);
    fireEvent.contextMenu(document.querySelector('.ze-symprops-grid thead tr')!);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'X Position' }));
    expect(
      Array.from(document.querySelectorAll('.ze-symprops-grid thead th')).map((t) => t.textContent),
    ).toContain('X Position');
  });
});

// ---------------------------------------------------------------------------
// Round 2: the divergences a second side-by-side against KiCad 10.0.5 turned
// up. Each is one line of C++ that our port had not reached.
// ---------------------------------------------------------------------------

/** Turn a hidden column on and hand back its header index. */
function showColumn(label: string): number {
  fireEvent.contextMenu(document.querySelector('.ze-symprops-grid thead tr')!);
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: label }));
  const heads = Array.from(document.querySelectorAll('.ze-symprops-grid thead th'));
  const at = heads.findIndex((t) => t.textContent === label);
  if (at === -1) throw new Error(`column ${label} did not appear`);
  return at;
}

/** The text of one visible column, row by row. */
const columnText = (at: number): string[] =>
  fieldRows().map((tr) => (tr.children[at]?.textContent ?? '').trim());

describe('the Unit and Body style LABELS grey with their combos', () => {
  // `m_unitLabel->Enable( false )` (dialog_symbol_properties.cpp:504) and
  // `m_bodyStyle->Enable( false )` (:537) sit beside the Enable( false ) on the
  // choices. A wxStaticText greys when it is disabled, so the WORDS "Unit:" and
  // "Body style:" are grey on a single-unit, single-body-style part — which is
  // most parts, and is the first thing a side-by-side shows.
  const labelOf = (id: string): HTMLLabelElement =>
    document.querySelector<HTMLLabelElement>(`label[for="${id}"]`)!;

  it('both are marked disabled for a part that is neither', () => {
    open(SHEET);
    expect(labelOf('ze-symprops-unit').className).toContain('disabled');
    expect(labelOf('ze-symprops-bodystyle').className).toContain('disabled');
  });

  it('and neither is, for a part that is both', () => {
    open(MULTI);
    expect(labelOf('ze-symprops-unit').className).not.toContain('disabled');
    expect(labelOf('ze-symprops-bodystyle').className).not.toContain('disabled');
  });

  it('the label greys with its OWN control, not with the other one', () => {
    // MULTI is multi-unit AND multi-body-style, SHEET is neither, so on those
    // two fixtures alone a rule that greyed both labels off one condition
    // would pass. `DUAL_UNIT_ONLY` is multi-unit with a single body style,
    // which is the case that separates them.
    open(DUAL_UNIT_ONLY);
    expect(document.querySelector<HTMLButtonElement>('#ze-symprops-unit')!.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#ze-symprops-bodystyle')!.disabled).toBe(
      true,
    );
    expect(labelOf('ze-symprops-unit').className).not.toContain('disabled');
    expect(labelOf('ze-symprops-bodystyle').className).toContain('disabled');
  });
});

describe('the numeric cells carry their unit word', () => {
  // `m_frame->StringFromValue( field.GetTextHeight(), true )`
  // (fields_grid_table.cpp:823-833) — `aAddUnitLabel` is TRUE for Text Size,
  // X Position and Y Position alike, and `EDA_UNIT_UTILS::GetText( MM )` is
  // " mm" with a leading space (common/eda_units.cpp:151). The cells have no
  // unit static text beside them, so the suffix is the only thing that says
  // what the number is.
  it('Text Size reads "1.27 mm", not "1.27"', () => {
    open(SHEET);
    expect(columnText(showColumn('Text Size'))[0]).toBe('1.27 mm');
  });

  it('X Position is symbol-relative and carries the unit too', () => {
    // The fixture's Reference sits at 53.34 against a symbol at 50.8, so the
    // symbol-relative x is 2.54 mm.
    open(SHEET);
    expect(columnText(showColumn('X Position'))[0]).toBe('2.54 mm');
  });

  it('and the unit is the FRAME s, not a hardcoded millimetre', () => {
    // `GetUserUnits()`, so a frame in inches shows 0.05 in for 1.27 mm.
    open(SHEET, { units: 'in' });
    expect(columnText(showColumn('Text Size'))[0]).toBe('0.05 in');
  });

  it('the editor parses the unit back off the text it was showing', () => {
    // `ValueFromString` is `DoubleValueFromString`: only the leading numeric
    // run is read, so the " mm" the cell was showing does not corrupt the
    // number, and a designator the user types overrides the display unit.
    const { edits } = open(SHEET);
    const at = showColumn('Text Size');
    const cell = fieldRows()[0]!.children[at]!;
    fireEvent.mouseDown(cell);
    fireEvent.doubleClick(cell);
    const input = cell.querySelector('input')!;
    fireEvent.change(input, { target: { value: '2 mm' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(edits[0]?.fields[0]?.effects?.fontSize?.[0]).toBe(20000);
  });
});

describe('the Font cell names the DEFAULT font, not the stroke font', () => {
  // `field.GetFont() ? GetName() : DEFAULT_FONT_NAME`
  // (fields_grid_table.cpp:838-841), and `#define DEFAULT_FONT_NAME
  // _( "Default Font" )` (:60). "KiCad Font" is a DIFFERENT entry in the same
  // combo (:410-411) — the face a field can name explicitly — so showing it
  // for a field with no `(face …)` claims a token the file does not have.
  it('a field with no (face …) reads "Default Font"', () => {
    open(SHEET);
    expect(columnText(showColumn('Font'))[0]).toBe('Default Font');
  });

  it('and a field that names a face reads that face', () => {
    open(FACED);
    expect(columnText(showColumn('Font'))[0]).toBe('Times New Roman');
  });
});

describe('a field name must be unique, and must exist', () => {
  /** Open the Name cell of the given visible row. */
  function editName(row: number): HTMLInputElement {
    const cell = fieldRows()[row]!.children[0]!;
    fireEvent.mouseDown(cell);
    fireEvent.doubleClick(cell);
    return cell.querySelector('input')!;
  }

  const addField = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  };

  it('renaming onto another row s name is refused with upstream s message', () => {
    // `OnGridCellChanging` (dialog_symbol_properties.cpp:878-896).
    open(SHEET);
    addField();
    const input = editName(5);
    fireEvent.change(input, { target: { value: 'Value' } });
    fireEvent.blur(input);
    expect(screen.getByText(/Field name 'Value' already in use/)).toBeTruthy();
    // Vetoed, not applied: the row keeps the name it had.
    expect(fieldNames()[5]).toBe('Field5');
  });

  it('a case variant of a MANDATORY name collides too', () => {
    // `FieldNamesAreDuplicates` (common/template_fieldnames.cpp:99-119): a
    // case-insensitive match counts only when one side is a mandatory
    // canonical name, because the s-expression parser folds those.
    open(SHEET);
    addField();
    const input = editName(5);
    fireEvent.change(input, { target: { value: 'reference' } });
    fireEvent.blur(input);
    expect(screen.getByText(/already in use/)).toBeTruthy();
  });

  it('re-typing a row s OWN name is not a duplicate of itself', () => {
    // `if( i == event.GetRow() ) continue;` (dialog_symbol_properties.cpp:884).
    // Every other case here changes the name to something new, so the skip is
    // invisible to them: the comparison is against the row's OLD key, which a
    // changed name never matches. Committing the cell unchanged is the one
    // action that reaches it, and without the skip it refuses every field the
    // user merely tabbed through.
    open(SHEET);
    addField();
    const input = editName(5);
    fireEvent.blur(input);
    expect(document.querySelector('.ze-props-error')).toBeNull();
    expect(fieldNames()[5]).toBe('Field5');
  });

  it('but a case variant of a USER name does not', () => {
    // Two user fields differing only in case are two fields. A rule written as
    // a bare CmpNoCase would refuse this, and nothing else here would notice.
    open(SHEET);
    addField();
    let input = editName(5);
    fireEvent.change(input, { target: { value: 'PartNo' } });
    fireEvent.blur(input);
    addField();
    input = editName(6);
    fireEvent.change(input, { target: { value: 'partno' } });
    fireEvent.blur(input);
    expect(document.querySelector('.ze-props-error')).toBeNull();
    expect(fieldNames().slice(5)).toStrictEqual(['PartNo', 'partno']);
  });

  it('OK refuses a nameless user field even when it has no value either', () => {
    // `Validate()` (dialog_symbol_properties.cpp:673-692) consults ONLY the
    // name. `TransferDataFromWindow`'s "no name AND no value → skip" branch
    // (:771) never sees such a row, because Validate has already refused it.
    const { edits } = open(SHEET);
    addField();
    const input = editName(5);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText(/Fields must have a name/)).toBeTruthy();
    expect(edits).toHaveLength(0);
  });
});

describe('the Pin Functions grid', () => {
  it('is sorted by pin number, not left in library order', () => {
    // `m_dataModel->SortRows( COL_NUMBER, true )`
    // (dialog_symbol_properties.cpp:369), through `PIN_NUMBERS::Compare` —
    // a natural compare, so 10 follows 9 and not 1. PINS declares them
    // 10, 2, 1 so both a stable no-sort and a plain string sort come out wrong.
    open(PINS);
    fireEvent.click(screen.getByRole('tab', { name: 'Pin Functions' }));
    const numbers = Array.from(
      document.querySelectorAll('.ze-symprops-pin-pane tbody tr td:first-child'),
    ).map((td) => td.textContent);
    expect(numbers).toStrictEqual(['1', '2', '10']);
  });

  it('follows the Unit combo, as OnUnitChoice rebuilds it', () => {
    // `OnUnitChoice` (:1172-1203) sets the symbol to the chosen unit, rebuilds
    // the model from GetRawPins() and puts the unit back. The page must list
    // the pins of the unit the COMBO is on, not the one the symbol opened as.
    open(TWO_UNIT_PINS);
    fireEvent.click(screen.getByRole('tab', { name: 'Pin Functions' }));
    const numbers = (): (string | null)[] =>
      Array.from(document.querySelectorAll('.ze-symprops-pin-pane tbody tr td:first-child')).map(
        (td) => td.textContent,
      );
    expect(numbers()).toStrictEqual(['1']);
    // The Unit combo lives on the General page, and an unselected notebook
    // page is `aria-hidden` — as a wxNotebook's is — so it is reached the way
    // a user reaches it: switch back, change it, switch forward. The control
    // is `ui/Combo`, not a `<select>`; see pickCombo. TWO_UNIT_PINS names its
    // units A and B.
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    pickCombo('Unit', 'B');
    fireEvent.click(screen.getByRole('tab', { name: 'Pin Functions' }));
    expect(numbers()).toStrictEqual(['2']);
  });
});

describe('the library link is never writeable', () => {
  it('carries readOnly, as wxTE_READONLY does, and nothing clears it', () => {
    // `wxTextCtrl( …, wxTE_READONLY|wxBORDER_NONE )`
    // (dialog_symbol_properties_base.cpp:323). `TransferDataToWindow` calls
    // SetValue on it (:575) and no code path ever calls SetEditable.
    open(SHEET);
    const entry = document.querySelector<HTMLInputElement>('.ze-symprops-libid')!;
    expect(entry.readOnly).toBe(true);
    expect(entry.getAttribute('aria-readonly')).toBe('true');
  });
});

/**
 * sbAttributes' five checkboxes, and the borders that space them.
 *
 * They are NOT one repeated row (dialog_symbol_properties_base.cpp:204-224):
 *
 *   Exclude from simulation         wxRIGHT|wxLEFT 5           no vertical
 *   sbAttributes->Add( 0, 10, … )                              a 10 px spacer
 *   Exclude from bill of materials  wxALL 5                    5 top, 5 bottom
 *   Exclude from board              wxBOTTOM|wxRIGHT|wxLEFT 5  5 bottom
 *   Exclude from position files     wxBOTTOM|wxRIGHT|wxLEFT 5  5 bottom
 *   Do not populate                 wxBOTTOM|wxLEFT|wxRIGHT 5  5 bottom
 *
 * so the rows repeat every `--check-row` + 5 = 27 and the first gap is
 * `--check-row` + 10 + 5 = 37. [px] a live KiCad 10.0.5 beside ours at the same
 * screen size reads its label rows at y = 691, 727, 754, 781, 808 — 36/27/27/27
 * — where ours read 700, 732, 754, 776, 798, a flat 32/22/22/22. Ours stated no
 * vertical border at all, so every gap was 5 short and the box was 20 px tighter
 * than KiCad's over five rows.
 *
 * happy-dom implements no layout, so the borders are asserted on the stated
 * declaration; the ORDER they apply to is asserted on the rendered dialog,
 * because a `:first-of-type` / adjacent-sibling rule is only correct if the
 * spacer really is the second child.
 */
describe('the Attributes checkboxes are spaced by their own borders', () => {
  it('renders the five in upstream’s order, with the spacer after the first', () => {
    open(SHEET);
    const box = groupBox('Attributes');
    // The children the CSS selectors depend on: the spacer is child 2, so
    // `.ze-symprops-attrgap + .ze-check` is "Exclude from bill of materials".
    expect(
      Array.from(box.children)
        .filter((c) => c.tagName !== 'LEGEND')
        .map((c) => (c.className.includes('attrgap') ? '(spacer)' : c.textContent)),
    ).toStrictEqual([
      'Exclude from simulation',
      '(spacer)',
      'Exclude from bill of materials',
      'Exclude from board',
      'Exclude from position files',
      'Do not populate',
    ]);
  });

  it('gives every row but the first a 5 px bottom border', () => {
    expect(decl('.ze-symprops-attrs > .ze-check', 'margin-bottom')).toBe('5px');
    expect(decl('.ze-symprops-attrs > .ze-check:first-of-type', 'margin-bottom')).toBe('0');
  });

  it('and the one wxALL 5 a 5 px top border as well', () => {
    expect(decl('.ze-symprops-attrs > .ze-symprops-attrgap + .ze-check', 'margin-top')).toBe('5px');
  });

  it('leaves the 10 px spacer as the spacer, not as a row border', () => {
    // `sbAttributes->Add( 0, 10, 0, wxEXPAND, 5 )` — folding it into the rows
    // would give the same first gap and the wrong one everywhere else.
    expect(decl('.ze-symprops-attrgap', 'height')).toBe('10px');
  });
});

/**
 * Which fields-grid column absorbs the dialog's slack.
 *
 * `RecomputeGridWidths` (common/widgets/wx_grid.cpp:1114-1155) ends with
 *
 *     SetColSize( m_flexibleCol,
 *                 std::max( flexibleMinWidth, width - nonFlexibleWidth ) );
 *
 * where `width` is the grid's ALREADY-ALLOCATED width. So `SetupColumnAutosizer(
 * FDC_VALUE )` (fields_grid_table.cpp:422) does not make the dialog as wide as
 * the longest value — Value takes whatever is left, and a value longer than that
 * clips. A capture of a live KiCad 10.0.5 confirms it: its Description cell
 * clips at the same place ours does, and its dialog is the same width for a
 * Device:C as for a Screw_Terminal_01x02.
 *
 * Every other shown column states one of the base file's `SetColSize` values
 * (dialog_symbol_properties_base.cpp:39-46), so a stated width on Value — or a
 * missing one anywhere else — is the bug this pins.
 */
describe('the Value column is the flexible one, and only it', () => {
  it('states no width, so it takes the slack', () => {
    open(SHEET);
    const value = document.querySelectorAll('.ze-symprops-grid thead th')[1] as HTMLElement;
    expect(value.textContent).toBe('Value');
    expect(value.style.width).toBe('');
  });

  it('and every other shown column carries the base file’s SetColSize as a FLOOR', () => {
    open(SHEET);
    const heads = Array.from(
      document.querySelectorAll<HTMLElement>('.ze-symprops-grid thead th'),
    ).map((th) => [th.textContent, th.style.minWidth || th.style.width] as const);
    // base.cpp:39-46 for the eight ShowHideColumns( "0 1 2 3 4 5 6 7" ) shows.
    // `min-width`, not `width`: RecomputeGridWidths AutoSizeColumns each of
    // these and then takes max( SetColSize, content ), so the number is a floor
    // the content may exceed — a live KiCad's Name column measures 92 against
    // the 72 stated here, because "Description" needs 88. Stated as a hard
    // width it clipped to "Descriptic" in the one column KiCad widens to fit.
    expect(heads).toStrictEqual([
      ['Name', '72px'],
      ['Value', ''],
      ['Show', '48px'],
      ['Show Name', '84px'],
      ['H Align', '66px'],
      ['V Align', '66px'],
      ['Italic', '48px'],
      ['Bold', '48px'],
    ]);
  });

  it('states them as a floor, never as a hard width', () => {
    open(SHEET);
    // The mutant this kills is the one that shipped: `width: c.width`, which
    // caps the column at the base file's number instead of flooring it.
    const name = document.querySelectorAll<HTMLElement>('.ze-symprops-grid thead th')[0]!;
    expect(name.style.minWidth).toBe('72px');
    expect(name.style.width).toBe('1px');
  });

  it('clips only the flexible column, which is the one that takes the slack', () => {
    open(SHEET);
    const tds = Array.from(
      document.querySelectorAll<HTMLElement>('.ze-symprops-grid tbody tr:first-child td'),
    );
    // `width: 0; min-width: 100%` keeps a cell's text out of its column's
    // intrinsic width. That belongs to FDC_VALUE alone; on every column it made
    // each one sit at exactly its floor.
    expect(tds.map((td) => td.classList.contains('ze-grid-flexcol'))).toStrictEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('and the marker actually carries the rule that keeps it out of the width', () => {
    // A surviving mutant: the class can be on the right cell while the rule it
    // names says nothing, and every other assertion here still passes. It is
    // `width: 0` + `min-width: 100%` that paints the text across the cell while
    // contributing nothing to the column, which is what lets the flexible
    // column take the slack instead of being pushed out by its own content.
    expect(decl('.ze-grid td.ze-grid-flexcol > .ze-grid-text', 'width')).toBe('0');
    expect(decl('.ze-grid td.ze-grid-flexcol > .ze-grid-text', 'min-width')).toBe('100%');
    // and the shared rule must NOT still carry them, or every column is capped
    // again and "Description" clips in the Name column.
    //
    // `decl` cannot ask this one: the selector `.ze-grid td > .ze-grid-text`
    // appears TWICE — once for the padding it shares with `td.ze-grid-text`,
    // once for the clipping — and `decl` finds the first. Asserting through it
    // reads the padding rule, which never had a width, so the assertion passed
    // whatever the clipping rule said. This reads the rule that actually
    // declares `display: block`.
    const blockRule = (() => {
      const at = SHELL.indexOf('display: block;', SHELL.indexOf('.ze-grid td > .ze-grid-text {'));
      return SHELL.slice(SHELL.lastIndexOf('{', at), SHELL.indexOf('}', at));
    })();
    expect(blockRule).toContain('display: block');
    expect(blockRule).not.toContain('width: 0');
    expect(blockRule).not.toContain('min-width: 100%');
  });
});

/**
 * The Pin Functions grid, and the one thing this suite cannot see.
 *
 * happy-dom has no layout engine, so everything below is an assertion on the
 * stated declaration. That is a real limit and it is what let a 1000000px
 * max-content ship through a green suite once already: `table-layout: fixed`
 * inherits `width: 100%` from `.ze-grid`, a percentage has nothing to resolve
 * against inside `.ze-modal`'s `width: max-content`, and the dialog opened 1780
 * wide instead of 884 on every tab. `qa/harness/symprops_layout.md` says how to
 * measure that in a browser; these pin the values it settled on.
 *
 *   `SetColSize` 0..4 = 160, 160, 160, 140, 140   (base.cpp:279-283)
 *   `SetColLabelSize( 24 )`                        (base.cpp:291)
 *   `bMargins->Add( m_pinGrid, 1, wxEXPAND|wxALL|wxFIXED_MINSIZE, 5 )` (:303)
 *   `AdjustPinsGridColumns`      (dialog_symbol_properties.cpp:1066-1085)
 *   `SetDefaultRowSize( + FromDIP( 4 ) )`          (wx_grid.cpp:211)
 */
describe('the Pin Functions grid', () => {
  it('states its columns in a colgroup, where a fixed layout reads them', () => {
    open(PINS);
    const cols = Array.from(
      document.querySelectorAll<HTMLElement>('.ze-symprops-pin-grid colgroup col'),
    ).map((c) => c.className);
    // Number fixed, Base Name and Alternate Assignment flexible, Electrical
    // Type and Graphic Style fixed — the split AdjustPinsGridColumns makes.
    expect(cols).toStrictEqual(['num', 'flex', 'flex', 'fixed', 'fixed']);
  });

  it('fixes the three columns AdjustPinsGridColumns never touches', () => {
    expect(decl('.ze-symprops-pin-grid', 'table-layout')).toBe('fixed');
    expect(decl('.ze-symprops-pin-grid col.num', 'width')).toBe('160px');
    expect(decl('.ze-symprops-pin-grid col.fixed', 'width')).toBe('140px');
  });

  it('and leaves the two it stretches auto, never a percentage', () => {
    // `width: auto` in a fixed-layout table IS `pinTblWidth / 2`. A percentage
    // is what produced the 1000000px; the regression test for that is the
    // browser harness, so this states the shape the fix has to keep.
    expect(decl('.ze-symprops-pin-grid col.flex', 'width')).toBe('auto');
    expect(decl('.ze-symprops-pin-grid col.flex', 'width')).not.toMatch(/%/);
  });

  it('models wxFIXED_MINSIZE: the grid contributes its minimum, not its content', () => {
    // Without this the pin page reaches the dialog's width and every tab opens
    // at `max-width: 92vw`.
    expect(decl('.ze-symprops-pin-pane', 'contain')).toBe('inline-size');
    // 160 + 160 + 160 + 140 + 140, the five SetColSize calls.
    expect(decl('.ze-symprops-pin-pane', 'min-width')).toBe('760px');
  });

  it('gives its rows WX_GRID’s default row size and its header the stated 24', () => {
    expect(decl('.ze-symprops-pin-grid td', 'height')).toBe('30px');
    expect(decl('.ze-symprops-pin-pane th', 'height')).toBe('24px');
  });

  it('paints a pin with no alternates the button face, as BuildAttrs does', () => {
    open(PINS);
    // None of Device:Conn's three pins carries an alternate, so all three cells
    // are the read-only, painted kind.
    const marked = document.querySelectorAll('.ze-symprops-pin-grid td.ze-pin-noalt');
    expect(marked).toHaveLength(3);
    expect(decl('.ze-symprops-pin-grid td.ze-pin-noalt', 'background')).toBe('var(--ctl-face)');
  });

  it('left-aligns the first column header in every grid, as WX_GRID does', () => {
    // `if( col == 0 ) hAlign = wxALIGN_LEFT;` — on the shared rule, because
    // upstream puts it in the shared class rather than in each dialog.
    expect(decl('.ze-grid th', 'text-align')).toBe('center');
    expect(decl('.ze-grid th:first-child', 'text-align')).toBe('left');
    // MIN_GRIDCELL_MARGIN = FromDIP( 2 ), replacing the centred rule's 6.
    expect(decl('.ze-grid th:first-child', 'padding-left')).toBe('2px');
  });
});

/**
 * The dialog's height, band by band.
 *
 * [px] `qa/probes/symprops_row_probe.cpp` asks wx for each one on this machine,
 * with the same widgets and the same borders the base file gives them:
 *
 *     sbFields               222      bLowerSizer           219
 *     General min            219        General 219 / Attributes 163 / Buttons 186
 *     general page CalcMin   456      notebook best         495
 *     bottom row CalcMin      44      mainSizer (client)    559
 *
 * Ours measured 599 of client against that 559. The excess was not spread
 * thinly — it sat in exactly two bands, and both are stated below.
 */
describe('the two bands that made the dialog 50px too tall', () => {
  it('gives the footer row no vertical border, because upstream gives it none', () => {
    // `mainSizer->Add( bSizerBottom, 0, wxEXPAND|wxLEFT, 12 )` — wxLEFT alone.
    // `.ze-modal-footer`'s shared `padding: 8px 12px` is right for a dialog
    // whose button row is added wxALL; it is 16px too tall for this one.
    expect(decl('.ze-symprops-foot', 'padding-left')).toBe('12px');
    expect(decl('.ze-symprops-foot', 'padding-top')).toBe('0');
    expect(decl('.ze-symprops-foot', 'padding-bottom')).toBe('0');
    // and the shared rule it is overriding still carries its own number, so
    // this reads as an override rather than as the default having moved.
    expect(decl('.ze-modal-footer', 'padding')).toBe('8px 12px');
  });

  it('spaces the four hand-off buttons the way buttonsSizer does, not evenly', () => {
    // 10, 10, then 5 either side of the 20px spacer: the spacer carries no
    // border of its own, so only the buttons bracketing it contribute one.
    // A uniform gap made those last two 10 as well — 10px this column does not
    // have. wx: buttonsSizer->CalcMin().y = 186 = 4 x 34 + 30 + 20.
    expect(decl('.ze-symprops-buttons', 'gap')).toBe('0');
    expect(decl('.ze-symprops-buttons > .ze-btn:nth-child(1)', 'margin-bottom')).toBe('5px');
    expect(decl('.ze-symprops-buttons > .ze-btn:last-child', 'margin-top')).toBe('5px');
    expect(decl('.ze-symprops-btnsgap', 'height')).toBe('20px');
  });

  it('and the spacer really is between Edit Symbol and Edit Library Symbol', () => {
    // The margins above are keyed on position, so the order has to be pinned:
    // nth-child(1) is Update, last-child is Edit Library Symbol, and the gap
    // sits fourth.
    open(SHEET);
    const col = document.querySelector('.ze-symprops-buttons')!;
    expect(
      Array.from(col.children).map((c) =>
        c.className.includes('btnsgap') ? '(20px spacer)' : c.textContent,
      ),
    ).toStrictEqual([
      'Update Symbol from Library...',
      'Change Symbol...',
      'Edit Symbol...',
      '(20px spacer)',
      'Edit Library Symbol...',
    ]);
  });
});
