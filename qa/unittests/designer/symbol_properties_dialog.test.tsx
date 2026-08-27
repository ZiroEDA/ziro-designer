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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import type { LibSymbol, SchSymbol, SymbolEdit } from '@ziroeda/eeschema';
import { SymbolPropertiesDialog } from '@ziroeda/designer/src/editors/schematic/components/SymbolPropertiesDialog.js';

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

  it('a second click on the cell under the cursor opens its editor', () => {
    open(SHEET);
    const cell = within(fieldRows()[1]!).getAllByRole('cell')[4]!;
    fireEvent.mouseDown(cell);
    expect(cell.querySelector('select')).toBeNull();
    fireEvent.mouseDown(cell);
    expect(cell.querySelector('select')).toBeTruthy();
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

describe('the Unit and Body style combos', () => {
  it('are empty and disabled for a part that is neither', () => {
    // TransferDataToWindow appends nothing and calls Enable( false ) on both.
    open(SHEET);
    const unit = document.querySelector<HTMLSelectElement>('#ze-symprops-unit')!;
    const body = document.querySelector<HTMLSelectElement>('#ze-symprops-bodystyle')!;
    expect(unit.disabled).toBe(true);
    expect(unit.options).toHaveLength(0);
    expect(body.disabled).toBe(true);
    expect(body.options).toHaveLength(0);
  });

  it('list GetUnitDisplayName( ii, false ) — the bare letter — when multi-unit', () => {
    open(MULTI);
    const unit = document.querySelector<HTMLSelectElement>('#ze-symprops-unit')!;
    expect(unit.disabled).toBe(false);
    expect(Array.from(unit.options).map((o) => o.text)).toStrictEqual(['A', 'B']);
  });

  it('list Standard and Alternate when the part has a second body style', () => {
    open(MULTI);
    const body = document.querySelector<HTMLSelectElement>('#ze-symprops-bodystyle')!;
    expect(body.disabled).toBe(false);
    expect(Array.from(body.options).map((o) => o.text)).toStrictEqual(['Standard', 'Alternate']);
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
    fireEvent.change(document.querySelector('#ze-symprops-unit')!, { target: { value: '2' } });
    fireEvent.change(document.querySelector('#ze-symprops-bodystyle')!, {
      target: { value: '2' },
    });
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
