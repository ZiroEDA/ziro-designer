// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * End-to-end parity for the calculator's "Memo" pages - E-Series, Colour Code,
 * Board Classes and Galvanic Corrosion - against REAL KiCad 10.0.5.
 *
 * These four are the ones AT-SPI cannot read. Each is a `wxGrid`, which is
 * custom-drawn on a bare `wxWindow`, so its cells are not accessibility objects
 * and `Atspi.Text.get_text` returns nothing for them. The harness therefore
 * takes the grid's own screen rectangle from `Atspi.Component.get_extents` and
 * screenshots exactly that; the expectations below were read off those images,
 * which are committed beside the harness in `qa/probes/pcb_calculator_oracle/`
 * and named in each case.
 *
 * They are also the panels with the least "calculating" in them, which is
 * exactly why they need this: a table that is simply WRONG - the wrong number
 * of columns, values from a different edition of the standard - produces no
 * error anywhere and no engine test notices. Electrical Spacing shipped one
 * (see `calc_e2e_power.test.tsx`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PanelEseriesDisplay } from '@ziroeda/designer/src/editors/calculator/panels/panel_eseries_display.js';
import { PanelColorCode } from '@ziroeda/designer/src/editors/calculator/panels/panel_color_code.js';
import { PanelBoardClass } from '@ziroeda/designer/src/editors/calculator/panels/panel_board_class.js';
import { PanelGalvanicCorrosion } from '@ziroeda/designer/src/editors/calculator/panels/panel_galvanic_corrosion.js';

afterEach(() => cleanup());

const pickUnit = (button: Element | null, option: string): void => {
  fireEvent.click(button as HTMLElement);
  fireEvent.mouseDown(screen.getByRole('option', { name: option }));
};

/** Every cell of every row, in DOM order - merged cells included as they lie. */
const grid = (table: Element): string[][] =>
  Array.from(table.querySelectorAll('tr')).map((r) =>
    Array.from(r.children).map((c) => c.textContent ?? ''),
  );

describe('Board Classes, end to end against pcb_calculator', () => {
  it('shows the six classes in mm', () => {
    const { container } = render(<PanelBoardClass />);
    const t = container.querySelector('table');

    // Capture `board_class_mm.png`. `--` is what KiCad prints for a class that
    // does not define the row, not a blank and not a zero.
    expect(grid(t as Element)).toEqual([
      ['', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6'],
      ['Lines width', '0.8', '0.5', '0.31', '0.21', '0.15', '0.12'],
      ['Minimum clearance', '0.68', '0.5', '0.31', '0.21', '0.15', '0.12'],
      ['Via: (diameter - drill)', '--', '--', '0.45', '0.34', '0.24', '0.2'],
      ['Plated Pad: (diameter - drill)', '1.19', '0.78', '0.6', '0.49', '0.39', '0.35'],
      ['NP Pad: (diameter - drill)', '1.57', '1.13', '0.9', '--', '--', '--'],
    ]);
  });

  it('converts the whole table when the unit changes', () => {
    const { container } = render(<PanelBoardClass />);
    pickUnit(screen.getByRole('button', { name: 'Unit' }), 'mil');
    const t = container.querySelector('table');

    // Capture `board_class_mil.png`. Six significant figures, %g style: this
    // panel reformats every cell, unlike Track Width's selectors which leave the
    // number where it is.
    expect(grid(t as Element)[1]).toEqual([
      'Lines width',
      '31.4961',
      '19.685',
      '12.2047',
      '8.26772',
      '5.90551',
      '4.72441',
    ]);
    expect(grid(t as Element)[5]).toEqual([
      'NP Pad: (diameter - drill)',
      '61.811',
      '44.4882',
      '35.4331',
      '--',
      '--',
      '--',
    ]);

    pickUnit(screen.getByRole('button', { name: 'Unit' }), 'inch');
    // Capture `board_class_inch.png`.
    expect(grid(container.querySelector('table') as Element)[1]).toEqual([
      'Lines width',
      '0.0314961',
      '0.019685',
      '0.0122047',
      '0.00826772',
      '0.00590551',
      '0.00472441',
    ]);
  });
});

describe('Colour Code, end to end against pcb_calculator', () => {
  it('five bands at 10 % / 5 %, six at ≤ 2 %', () => {
    const { container } = render(<PanelColorCode />);

    // Captures `cc_5band.png` and `cc_6band.png`. Picking the tighter tolerance
    // INSERTS a "4th Band" column third - it does not append one at the end -
    // and the artwork strip count follows.
    const heads = (): string[] =>
      Array.from(container.querySelectorAll('.cc-colhead')).map((e) => e.textContent ?? '');
    expect(heads()).toEqual(['1st Band', '2nd Band', '3rd Band', 'Multiplier', 'Tolerance']);
    expect(container.querySelectorAll('img.cc-art').length).toBe(5);

    fireEvent.click(screen.getByLabelText('<= 2%'));
    expect(heads()).toEqual([
      '1st Band',
      '2nd Band',
      '3rd Band',
      '4th Band',
      'Multiplier',
      'Tolerance',
    ]);
    expect(container.querySelectorAll('img.cc-art').length).toBe(6);
  });
});

describe('Galvanic Corrosion, end to end against pcb_calculator', () => {
  it('39 metals, with KiCad’s chemical symbols and signed millivolts', () => {
    const { container } = render(<PanelGalvanicCorrosion />);
    const rows = grid(container.querySelector('table') as Element);

    // Capture `galv_sym_0.png`. 1 header + 39 metals.
    expect(rows.length).toBe(40);
    expect(rows[0]?.slice(0, 16)).toEqual([
      '',
      'Rh',
      'Pt',
      'Pd',
      'Au',
      'X2CrNiMo17-12-2',
      'Inconel',
      'In',
      'Ti',
      'X8CrNiS18-9',
      'Ag',
      'Hg',
      'ENEPIG',
      'ENIG',
      'Ni',
      // "C" is Carbon (Graphitic), not the start of "Cu" - the screenshot crop
      // cut it off and the C++ settles it (panel_galvanic_corrosion.cpp:141).
      // Copper is the column after.
      'C',
    ]);
    // Rhodium against everything below it, in mV, rounded to whole millivolts.
    expect(rows[1]?.slice(0, 16)).toEqual([
      'Rh',
      '0',
      '-30',
      '-100',
      '-160',
      '-250',
      '-250',
      '-260',
      '-280',
      '-280',
      '-380',
      '-380',
      '-420',
      '-450',
      '-460',
      '-500',
    ]);
    expect(rows[2]?.slice(0, 13)).toEqual([
      'Pt',
      '30',
      '0',
      '-70',
      '-130',
      '-220',
      '-220',
      '-230',
      '-250',
      '-250',
      '-350',
      '-350',
      '-390',
    ]);
  });

  it('the Names radio swaps every label, and only the labels', () => {
    const { container } = render(<PanelGalvanicCorrosion />);
    fireEvent.click(screen.getByLabelText('Names'));
    const rows = grid(container.querySelector('table') as Element);

    // Capture `galv_names_0.png`. Note "Titanium, passive" and
    // "ENEPIG (Ni/Pd/Au)" - the parenthetical and the comma are KiCad's.
    expect(rows[0]?.slice(0, 13)).toEqual([
      '',
      'Rhodium',
      'Platinum',
      'Palladium',
      'Gold',
      'Stainless steel 316L',
      'Inconel',
      'Indium',
      'Titanium, passive',
      'Stainless steel 18-9',
      'Silver',
      'Mercury',
      'ENEPIG (Ni/Pd/Au)',
    ]);
    expect(rows[1]?.slice(0, 5)).toEqual(['Rhodium', '0', '-30', '-100', '-160']);
  });
});

describe('E-Series, end to end against pcb_calculator', () => {
  it('the E24/E48/E96 grid, four column groups with a spacer between', () => {
    const { container } = render(<PanelEseriesDisplay />);
    const wide = container.querySelectorAll('table')[0];
    const rows = grid(wide as Element);

    // Capture `eser_wide.png`. Fifteen headers: E24/E48/E96 four times with a
    // "-" spacer between groups and none after the last.
    expect(rows[0]).toEqual([
      'E24',
      'E48',
      'E96',
      '-',
      'E24',
      'E48',
      'E96',
      '-',
      'E24',
      'E48',
      'E96',
      '-',
      'E24',
      'E48',
      'E96',
    ]);
    // Merged cells mean a row carries only the cells that START on it: the E24
    // 100 spans four rows, its E48 100 spans two, and the spacer spans 24.
    expect(rows[1]).toEqual([
      '100',
      '100',
      '100',
      '',
      '180',
      '178',
      '178',
      '',
      '330',
      '316',
      '316',
      '',
      '560',
      '562',
      '562',
    ]);
    expect(rows[2]).toEqual(['102', '182', '324', '576']);
    expect(rows[3]).toEqual(['105', '105', '187', '187', '332', '332', '590', '590']);
    expect(rows[4]).toEqual(['107', '191', '340', '604']);
    expect(rows[5]).toEqual([
      '110',
      '110',
      '110',
      '200',
      '196',
      '196',
      '360',
      '348',
      '348',
      '620',
      '619',
      '619',
    ]);
  });

  it('the E1/E3/E6/E12 grid', () => {
    const { container } = render(<PanelEseriesDisplay />);
    const narrow = container.querySelectorAll('table')[1];
    const rows = grid(narrow as Element);

    // Capture `eser_narrow.png`. E1's single 100 spans all twelve rows.
    expect(rows[0]).toEqual(['E1', 'E3', 'E6', 'E12']);
    expect(rows[1]).toEqual(['100', '100', '100', '100']);
    expect(rows[2]).toEqual(['120']);
    expect(rows[3]).toEqual(['150', '150']);
    expect(rows[4]).toEqual(['180']);
    expect(rows[5]).toEqual(['220', '220', '220']);
  });
});
