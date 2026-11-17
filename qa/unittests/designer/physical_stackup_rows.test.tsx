// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Physical Stackup — `PANEL_SETUP_BOARD_STACKUP`
 * (`pcbnew/board_stackup_manager/panel_board_stackup.cpp`).
 *
 * Which cells a row draws is not one predicate, it is four, and they cover
 * different sets of layer types (`board_stackup.cpp:277-319`):
 *
 *     IsMaterialEditable()  dielectric | soldermask | silkscreen
 *     IsThicknessEditable() dielectric | soldermask | copper
 *     IsColorEditable()     dielectric | soldermask | silkscreen
 *     HasEpsilonRValue()    dielectric | soldermask
 *
 * Copper is in the thickness set and NOT the material set; silkscreen is the
 * other way round. Ours had both of those wrong, which is invisible to any
 * check that only counts columns — so these assert per row, by layer name.
 */
import { SetMessageDialogPresenter } from '@ziroeda/common/confirm.js';
import { afterEach, describe, expect, it } from 'vitest';
import { useState, type JSX } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  PANEL_SETUP_BOARD_STACKUP,
  PanelPcbStackup,
  type PhysicalStackup,
} from '@ziroeda/pcbnew/board_stackup_manager/panel_board_stackup.js';
import { freshBoardSetup, readSetup, writeSetup } from './board_setup_test_utils.js';

afterEach(cleanup);

function Harness({ initial }: { initial: PhysicalStackup }): JSX.Element {
  const [v, setV] = useState(initial);
  return <PanelPcbStackup value={v} onChange={setV} units="mm" />;
}

/** The rebuilt m_fgGridSizer: the nine-column flex grid the titles head. */
const grid = (): HTMLElement =>
  screen.getByText('Loss Tan').closest('.ze-szi')!.parentElement as HTMLElement;

/** The nine cells lazyBuildRowUI Insert()s for the row whose name cell reads `name`. */
function cellsOf(name: string): HTMLElement[] {
  const cells = [...grid().children] as HTMLElement[];
  const idIdx = cells.findIndex((c) => c.textContent === name);
  if (idIdx === -1) throw new Error(`no stackup row named ${name}`);
  // The name is the 2nd of the row's cells, after the swatch.
  return cells.slice(idIdx - 1, idIdx - 1 + 9);
}

const has = (name: string, cellIndex: number): boolean =>
  cellsOf(name)[cellIndex]!.querySelector('input, .ze-combo') !== null;

// Cell order inside a row, from lazyBuildRowUI: swatch, name, type, material (with its "..."),
// thickness, lock, color, epsilon, loss tangent.
const MATERIAL = 3;
const THICKNESS = 4;

describe('which cells each row type draws', () => {
  it('gives copper a thickness and no material', () => {
    // `IsThicknessEditable()` includes BS_ITEM_TYPE_COPPER; `IsMaterialEditable()`
    // does not. This drew a Material field reading "Copper".
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    expect(has('F.Cu', THICKNESS), 'F.Cu thickness').toBe(true);
    expect(has('F.Cu', MATERIAL), 'F.Cu material').toBe(false);
    expect(has('B.Cu', MATERIAL), 'B.Cu material').toBe(false);
  });

  it('gives silkscreen a material and no thickness', () => {
    // The mirror image: silkscreen is in the material set and not the
    // thickness set. A silkscreen thickness also fed the board-thickness sum.
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    expect(has('F.Silkscreen', MATERIAL), 'F.Silkscreen material').toBe(true);
    expect(has('F.Silkscreen', THICKNESS), 'F.Silkscreen thickness').toBe(false);
    expect(has('B.Silkscreen', THICKNESS), 'B.Silkscreen thickness').toBe(false);
  });

  it('gives solder mask both, and solder paste neither', () => {
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    expect(has('F.Mask', MATERIAL)).toBe(true);
    expect(has('F.Mask', THICKNESS)).toBe(true);
    expect(has('F.Paste', MATERIAL), 'F.Paste material').toBe(false);
    expect(has('F.Paste', THICKNESS), 'F.Paste thickness').toBe(false);
  });
});

describe('the Type cell', () => {
  it('is a Core/PrePreg choice on a dielectric row and text elsewhere', () => {
    // `panel_board_stackup.cpp:828-840` — a wxChoice for a dielectric's main
    // row, a wxStaticText for every other layer. All of them were text, so the
    // one editable Type cell on the page could not be changed.
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    const diel = cellsOf('Dielectric 1')[2]!;
    expect(diel.querySelector('.ze-combo')).not.toBeNull();
    expect(diel.querySelector('.ze-combo-shown')?.textContent).toBe('Core');

    expect(cellsOf('F.Cu')[2]!.querySelector('.ze-combo')).toBeNull();
    expect(cellsOf('F.Cu')[2]!.textContent).toBe('Copper');
  });

  it('labels the second entry PrePreg, which is not the stored value', () => {
    // `m_core_prepreg_choice` is "Core" / "PrePreg" (`:121-122`) while
    // SetTypeName stores KEY_CORE / KEY_PREPREG.
    const s = freshBoardSetup().physicalStackup;
    s.layers = s.layers.map((l) => (l.type === 'Core' ? { ...l, type: 'Prepreg' } : l));
    render(<Harness initial={s} />);
    expect(cellsOf('Dielectric 1')[2]!.querySelector('.ze-combo-shown')?.textContent).toBe(
      'PrePreg',
    );
  });
});

describe('board thickness from stackup', () => {
  const readField = (): string =>
    (screen.getByLabelText('Board thickness from stackup') as HTMLInputElement).value;

  it('carries its unit in the field and trims trailing zeros', () => {
    // `StringFromValue( thickness, true )` (`:590-594`) — "1.6 mm", not
    // "1.620" beside a separate mm label.
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    expect(readField()).toMatch(/^[\d.]+ mm$/);
    expect(readField()).not.toMatch(/0 mm$/);
  });

  it('sums only the thickness-editable rows', () => {
    // `GetBoardThickness()` adds a row only when `IsThicknessEditable()`
    // (`board_stackup.cpp:498-515`), so a stale thickness on a silkscreen or
    // paste row must not reach it.
    const s = freshBoardSetup().physicalStackup;
    const before = s.layers.reduce(
      (a, l) => a + (l.type === 'Copper' || l.type === 'Core' ? l.thicknessMM : 0),
      0,
    );
    s.layers = s.layers.map((l) =>
      l.type.includes('Silk Screen') || l.type.includes('Solder Paste')
        ? { ...l, thicknessMM: 5 }
        : l,
    );
    render(<Harness initial={s} />);
    // Five 5mm phantom layers would be unmissable; the mask rows still count.
    const shown = Number.parseFloat(readField());
    expect(shown).toBeLessThan(before + 1);
  });
});

describe('the option and thickness bars are single wx rows', () => {
  /** The children of the sizer that holds `aText`'s control. */
  const barOf = (aText: string): Element[] => [
    ...screen.getByText(aText).closest('.ze-szi')!.parentElement!.children,
  ];

  it('puts two growable spacers in the top bar', () => {
    // `bTopSizer` adds `40, 0, 1, wxEXPAND` before AND after the checkbox.
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    expect(
      barOf('Add Dielectric Layer...').filter((k) => k.classList.contains('ze-szspacer')),
    ).toHaveLength(2);
  });

  it('puts the bottom bar spacer between Adjust and Export', () => {
    // `bBottomSizer`: value, fixed 10px, Adjust, growable spacer, Export.
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    const kids = barOf('Export to Clipboard');
    const adjust = kids.findIndex((k) => k.textContent === 'Adjust Dielectric Thickness');
    const spacers = kids
      .map((k, i) => (k.classList.contains('ze-szspacer') ? i : -1))
      .filter((i) => i >= 0);
    const exportBtn = kids.findIndex((k) => k.textContent === 'Export to Clipboard');
    expect(spacers).toHaveLength(2);
    expect(spacers[0]).toBeLessThan(adjust);
    expect(spacers[1]).toBeGreaterThan(adjust);
    expect(exportBtn).toBeGreaterThan(spacers[1]!);
  });
});

describe('the board thickness written to the file', () => {
  const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
)`;

  const thicknessIn = (text: string): number =>
    Number(/\(thickness ([\d.]+)/.exec(text)?.[1] ?? Number.NaN);

  it('includes a dielectric’s sublayers, not just its main layer', () => {
    // `GetBoardThickness()` adds the row, then loops
    // `for( idx = 1; idx < GetSublayersCount(); idx++ ) thickness += GetThickness( idx )`
    // (`board_stackup.cpp:502-512`). A writer that summed only main layers
    // under-reported every board with an added dielectric sublayer.
    const f = readSetup(BOARD);
    const s = f.values;

    const plain = thicknessIn(writeSetup(f));

    s.physicalStackup.layers = s.physicalStackup.layers.map((l) =>
      l.type === 'Core' || l.type === 'Prepreg'
        ? { ...l, sublayers: [{ material: 'PTFE', thicknessMM: 0.25 }] }
        : l,
    );
    const withSub = thicknessIn(writeSetup(f));

    expect(withSub).toBeCloseTo(plain + 0.25, 6);
  });

  it('leaves a silkscreen thickness out of it', () => {
    const f = readSetup(BOARD);
    const s = f.values;
    const before = thicknessIn(writeSetup(f));

    s.physicalStackup.layers = s.physicalStackup.layers.map((l) =>
      l.type.includes('Silk Screen') ? { ...l, thicknessMM: 1 } : l,
    );
    expect(thicknessIn(writeSetup(f))).toBeCloseTo(before, 6);
  });
});

describe('the Layer column swatch', () => {
  const swatchOf = (name: string): HTMLElement =>
    cellsOf(name)[0]!.querySelector('.ze-stackup-swatch') as HTMLElement;

  it('draws one for EVERY row, including copper and paste', () => {
    // `lazyBuildRowUI` inserts the wxStaticBitmap unconditionally
    // (`panel_board_stackup.cpp:807-810`). This drew one only where
    // `IsColorEditable()` was true, so copper and paste rows came out blank —
    // and those are precisely the types with a fixed colour of their own.
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    for (const row of ['F.Silkscreen', 'F.Paste', 'F.Mask', 'F.Cu', 'Dielectric 1', 'B.Cu'])
      expect(swatchOf(row), row).not.toBeNull();
  });

  it('uses getColorIconItem’s three fixed colours, not the Color cell', () => {
    // [data] `copperColor( 220, 180, 30 )`, `dielectricColor( 75, 120, 75 )`,
    // `pasteColor( 200, 200, 200 )` (`:69-71`).
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    expect(swatchOf('F.Cu').style.background).toBe('rgb(220, 180, 30)');
    expect(swatchOf('B.Cu').style.background).toBe('rgb(220, 180, 30)');
    expect(swatchOf('Dielectric 1').style.background).toBe('rgb(75, 120, 75)');
    expect(swatchOf('F.Paste').style.background).toBe('rgb(200, 200, 200)');
  });

  it('follows the Color cell only for mask and silkscreen', () => {
    // `case BS_ITEM_TYPE_SOLDERMASK/SILKSCREEN: color = GetSelectedColor( aRow )`.
    const s = freshBoardSetup().physicalStackup;
    s.layers = s.layers.map((l) =>
      l.name === 'F.Mask' ? { ...l, color: 'Red' } : l.name === 'F.Cu' ? { ...l, color: 'Red' } : l,
    );
    render(<Harness initial={s} />);
    expect(swatchOf('F.Mask').style.background).toBe('rgb(128, 0, 0)');
    // Copper ignores its Color cell entirely.
    expect(swatchOf('F.Cu').style.background).toBe('rgb(220, 180, 30)');
  });
});

/**
 * DIALOG_DIELECTRIC_MATERIAL (`dialog_dielectric_list_manager.cpp`) on the
 * panel's own DIELECTRIC_SUBSTRATE_LISTs (`onMaterialChange`,
 * `panel_board_stackup.cpp:1417-1490`).
 */
describe('the material dialog', () => {
  afterEach(cleanup);

  const open = (row: string): void => {
    const btn = cellsOf(row)[MATERIAL]!.querySelector('button')!;
    fireEvent.click(btn);
  };
  /** m_lcMaterials' rows, each a row of cells (the header excluded). */
  const listRows = (): (HTMLElement & { cells: HTMLElement[] })[] =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[aria-label="Common materials"] [role="listitem"]',
      ),
    ].map((r) => Object.assign(r, { cells: [...r.children] as HTMLElement[] }));
  const field = (label: string): HTMLInputElement =>
    screen.getByRole('textbox', {
      name: label.replace(/:$/, '') === 'Material' ? 'Name' : label.replace(/:$/, ''),
    }) as HTMLInputElement;

  it('opens with Material empty, Epsilon R 1 and Loss Tan 0, on the type’s own list', () => {
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    // The dielectric list starts with the ten predefined substrates…
    open('Dielectric 1');
    expect(field('Material:').value).toBe('');
    expect(field('Epsilon R:').value).toBe('1');
    expect(field('Loss Tan:').value).toBe('0');
    const names = listRows().map((r) => r.cells[0]!.textContent);
    expect(names.slice(0, 3)).toEqual(['Not specified', 'FR4', 'FR408-HR']);
    expect(names).toContain('Ceramic');
    // …and the mask list is the four mask materials, not the dielectrics.
    fireEvent.click(screen.getByText('Cancel'));
    open('F.Mask');
    expect(listRows().map((r) => r.cells[0]!.textContent)).toEqual([
      'Not specified',
      'Epoxy',
      'Liquid Ink',
      'Dry Film',
    ]);
  });

  it('a material the board already uses is appended to the list before it opens', () => {
    const v = freshBoardSetup().physicalStackup;
    const diel = v.layers.findIndex((l) => l.type === 'Core' || l.type === 'Prepreg');
    v.layers[diel] = {
      ...v.layers[diel]!,
      material: 'Rogers 4003C',
      epsilonR: 3.38,
      lossTan: 0.0027,
    };
    render(<Harness initial={v} />);
    open('Dielectric 1');
    const last = listRows().at(-1)!;
    expect([...last.cells].map((c) => c.textContent)).toEqual(['Rogers 4003C', '3.38', '0.0027']);
  });

  it('selecting a row fills the fields; OK writes them to the row; an empty name changes nothing', () => {
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    open('Dielectric 1');
    fireEvent.click(listRows()[7]!); // PTFE
    expect(field('Material:').value).toBe('PTFE');
    expect(field('Epsilon R:').value).toBe('2.1');
    expect(field('Loss Tan:').value).toBe('0.0002');
    fireEvent.click(screen.getByText('OK'));
    const mat = cellsOf('Dielectric 1')[MATERIAL]!.querySelector('input')!;
    expect(mat.value).toBe('PTFE');

    open('Dielectric 1');
    fireEvent.click(screen.getByText('OK')); // "No substrate specified": the row keeps PTFE
    expect(document.querySelector('.ze-dielmat-list')).toBeNull();
    expect(cellsOf('Dielectric 1')[MATERIAL]!.querySelector('input')!.value).toBe('PTFE');
  });

  it('refuses a negative or non-numeric Epsilon R / Loss Tan with the wxMessageBox text', () => {
    const alerts: string[] = [];
    SetMessageDialogPresenter(async (a) => {
      alerts.push(a.message);
      return 0;
    });
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    open('Dielectric 1');
    fireEvent.click(listRows()[1]!); // FR4
    const eps = field('Epsilon R:');
    fireEvent.change(eps, { target: { value: '-1' } });
    fireEvent.click(screen.getByText('OK'));
    expect(alerts).toEqual(['Incorrect value for Epsilon R']);
    // The dialog stays open.
    expect(document.querySelector('[aria-label="Common materials"]')).not.toBeNull();
  });

  it('Delete on a selected row drops it from the panel’s list, but never row 0', () => {
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    open('Dielectric 1');
    const before = listRows().length;
    fireEvent.click(listRows()[2]!); // FR408-HR
    const pane = document.querySelector<HTMLElement>('.ze-listctrl')!;
    fireEvent.keyDown(pane, { key: 'Delete' });
    expect(listRows().length).toBe(before - 1);
    expect(listRows().map((r) => r.cells[0]!.textContent)).not.toContain('FR408-HR');
    // The next row is selected and its values are in the fields.
    expect(field('Material:').value).toBe('Polyimide');
    fireEvent.click(listRows()[0]!);
    fireEvent.keyDown(pane, { key: 'Delete' });
    expect(listRows().length).toBe(before - 1);
    // The list is the panel's: closing and reopening keeps the deletion.
    fireEvent.click(screen.getByText('Cancel'));
    open('Dielectric 1');
    expect(listRows().map((r) => r.cells[0]!.textContent)).not.toContain('FR408-HR');
  });
});

describe('a new copper count', () => {
  it("takes BOARD_STACKUP::BuildDefaultStackupList's rows, as KiCad builds them", () => {
    // KiCad 10.0.6's four-layer default (qa/fixtures/board_support_oracle.json,
    // stackup4_default_text): core / prepreg / core, 0.48 mm each, FR4, and no
    // colour on any row - "Not specified", not a White silk or a Green mask.
    const rows = PANEL_SETUP_BOARD_STACKUP.DefaultRows(4);
    const dielectrics = rows.filter((r) => r.type === 'Core' || r.type === 'Prepreg');
    expect(dielectrics.map((r) => [r.type, r.thicknessMM, r.material])).toEqual([
      ['Core', 0.48, 'FR4'],
      ['Prepreg', 0.48, 'FR4'],
      ['Core', 0.48, 'FR4'],
    ]);
    expect(rows.filter((r) => r.type === 'Copper').map((r) => r.name)).toEqual([
      'F.Cu',
      'In1.Cu',
      'In2.Cu',
      'B.Cu',
    ]);
    const silk = rows.find((r) => r.name === 'F.Silkscreen')!;
    const mask = rows.find((r) => r.name === 'F.Mask')!;
    expect([silk.color, mask.color]).toEqual(['Not specified', 'Not specified']);
  });
});

describe('what a thickness cell shows', () => {
  // `m_frame->StringFromValue( item->GetThickness( sub ), true )`: the frame's units, with
  // the unit word. This printed the IU count as millimetres - F.Cu "35000 mm", the core
  // "1510000 mm" - because the mm formatter was handed nanometres (blinky555, I-10).
  const thicknessOf = (name: string): string =>
    (cellsOf(name)[THICKNESS]!.querySelector('input') as HTMLInputElement).value;

  it('is the layer thickness in mm, not in internal units', () => {
    const stackup = freshBoardSetup().physicalStackup;
    render(<Harness initial={stackup} />);
    const fcu = stackup.layers.find((l) => l.name === 'F.Cu')!;
    const fmask = stackup.layers.find((l) => l.name === 'F.Mask')!;
    expect(fcu.thicknessMM).toBe(0.035);
    expect(thicknessOf('F.Cu')).toBe('0.035 mm');
    expect(thicknessOf('F.Mask')).toBe(`${fmask.thicknessMM} mm`);
  });

  it('shows back what was typed, in mm', () => {
    render(<Harness initial={freshBoardSetup().physicalStackup} />);
    const input = cellsOf('F.Mask')[THICKNESS]!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.02' } });
    fireEvent.blur(input);
    expect(thicknessOf('F.Mask')).toBe('0.02 mm');
  });

  it('gives Adjust Dielectric Thickness its minimum in mm', () => {
    // onAdjustDielectricThickness: "Enter expected board thickness (min value %s):", the
    // sum of every thickness the adjustment may not change - here copper and mask.
    const stackup = freshBoardSetup().physicalStackup;
    render(<Harness initial={stackup} />);
    const fixed = stackup.layers
      .filter((l) => l.type === 'Copper' || l.name.endsWith('.Mask'))
      .reduce((a, l) => a + l.thicknessMM, 0);
    fireEvent.click(screen.getByText('Adjust Dielectric Thickness'));
    expect(
      screen.getByText(
        `Enter expected board thickness (min value ${Number(fixed.toFixed(6))} mm):`,
      ),
    ).toBeTruthy();
  });
});
