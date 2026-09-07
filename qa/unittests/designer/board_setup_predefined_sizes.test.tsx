// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Pre-defined Sizes — `PANEL_SETUP_TRACKS_AND_VIAS`
 * (`pcbnew/dialogs/panel_setup_tracks_and_vias.cpp`).
 *
 * Three `WX_GRID`s of dimensions that the toolbar's Track and Via selectors
 * offer. What ours got wrong was almost all in how a grid behaves rather than
 * in what it stores, and none of it is visible from the model:
 *
 *   - the remove button deleted the LAST row whatever was selected — in fact
 *     there was no selection at all, where upstream sets
 *     `wxGridSelectRows` on all three grids and `OnDeleteRows` deletes what is
 *     selected;
 *   - the sort button ordered by the first column only, where `std::sort` runs
 *     over the whole struct (`VIA_DIMENSION::operator<` is diameter then
 *     drill);
 *   - OK stored the rows as typed, where `TransferDataFromWindow` drops every
 *     row whose first cell is empty and sorts what is left, every time;
 *   - OK could not refuse, where `Validate()` rejects a via whose hole is not
 *     smaller than its diameter and a differential pair with no gap;
 *   - a cell showed a bare number, where a `WX_GRID` cell holds the TEXT
 *     `StringFromValue( iu, true )` writes — "0.5 mm" — and holds nothing at
 *     all for a zero, which is what "use netclass" looks like;
 *   - Add invented a size, where `AppendTrackWidth( 0 )` appends zeros.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DialogBoardSetup,
  normalizeSizeRows,
  sortSizeRows,
  validateSizes,
} from '@ziroeda/designer/src/editors/pcb/dialogs/dialog_board_setup.js';
import {
  defaultBoardSetup,
  type BoardSetupValues,
} from '@ziroeda/designer/src/editors/pcb/board_settings.js';

afterEach(cleanup);

const SIZES: Partial<BoardSetupValues> = {
  trackWidthsMM: [0.25, 0.5],
  viaSizesMM: [
    { diameter: 0.8, drill: 0.4 },
    { diameter: 0.6, drill: 0 },
  ],
  diffPairsMM: [{ width: 0.2, gap: 0.25, viaGap: 0.5 }],
};

/** The dialog on its Pre-defined Sizes page, plus whatever OK handed back. */
function open(over: Partial<BoardSetupValues> = SIZES): {
  ok: () => BoardSetupValues | null;
} {
  let out: BoardSetupValues | null = null;
  render(
    <DialogBoardSetup
      value={{ ...defaultBoardSetup(), ...over }}
      /* The frame's display units: Board Setup's fields and grid cells are
         `UNIT_BINDER`s and `WX_GRID`s with `SetUnitsProvider( m_Frame )`. */
      units="mm"
      onOk={(next) => {
        out = next;
      }}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByText('Pre-defined Sizes'));
  return {
    ok: () => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      return out;
    },
  };
}

/** The one grid whose column heading row starts with `first`. */
function gridOf(title: string): HTMLElement {
  const col = [...document.querySelectorAll<HTMLElement>('.ze-sizes-col')].find(
    (c) => c.querySelector('.ze-sizes-title')?.textContent === title,
  );
  expect(col, `no ${title} grid`).toBeTruthy();
  return col!;
}

const cellsOf = (title: string): HTMLInputElement[] => [
  ...gridOf(title).querySelectorAll<HTMLInputElement>('tbody input'),
];

const btn = (title: string, name: string): HTMLElement =>
  gridOf(title).querySelector<HTMLElement>(`[title="${name}"]`)!;

describe('a cell is the text a WX_GRID holds', () => {
  it('shows the value with its unit', () => {
    open();

    // `SetUnitValue` writes `StringFromValue( iu, true )`.
    expect(cellsOf('Tracks').map((i) => i.value)).toEqual(['0.25 mm', '0.5 mm']);
  });

  it('shows nothing for a zero, which is "use netclass"', () => {
    open();

    // `AppendViaSize` calls SetUnitValue for the drill only `if( aDrill > 0 )`,
    // so the second via's Hole cell is EMPTY, not "0".
    expect(cellsOf('Vias').map((i) => i.value)).toEqual(['0.8 mm', '0.4 mm', '0.6 mm', '']);
  });

  it('holds what is typed until the editor closes', () => {
    open();

    // A wxGrid commits when the cell editor closes. Driving the model off every
    // keystroke turns "0." into 0 and rewrites the field under the caret.
    const cell = cellsOf('Tracks')[0]!;
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '0.' } });
    expect(cell.value).toBe('0.');
    fireEvent.change(cell, { target: { value: '0.35' } });
    fireEvent.blur(cell);
    expect(cellsOf('Tracks')[0]!.value).toBe('0.35 mm');
  });

  it('takes a unit the user types, as the auto-eval columns do', () => {
    // A fixture OK will accept: the shared one deliberately carries a via with
    // no hole, which `Validate()` refuses.
    const { ok } = open({ trackWidthsMM: [0.25], viaSizesMM: [], diffPairsMM: [] });

    const cell = cellsOf('Tracks')[0]!;
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '20 mils' } });
    fireEvent.blur(cell);

    expect(ok()!.trackWidthsMM).toContain(0.508);
  });

  it('shows the frame’s units, because the grid has a units provider', () => {
    // `m_trackWidthsGrid->SetUnitsProvider( m_Frame )`
    // (`panel_setup_tracks_and_vias.cpp:92-94`), so a mils frame reads the
    // same rows in mils. The Constraints page shares the binder and puts its
    // unit in a label instead; a grid cell carries its own.
    let out: BoardSetupValues | null = null;
    render(
      <DialogBoardSetup
        value={{ ...defaultBoardSetup(), trackWidthsMM: [0.508], viaSizesMM: [], diffPairsMM: [] }}
        units="mils"
        onOk={(next) => {
          out = next;
        }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Pre-defined Sizes'));

    expect(cellsOf('Tracks').map((i) => i.value)).toEqual(['20 mils']);

    // And a value typed back in mils round-trips to the same millimetres.
    const cell = cellsOf('Tracks')[0]!;
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '20' } });
    fireEvent.blur(cell);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(out!.trackWidthsMM).toEqual([0.508]);
  });

  it('labels its columns without a unit', () => {
    open();

    // `SetColLabelValue( 0, _("Width") )`. These read "Width (mm)".
    const heads = (t: string): string[] =>
      [...gridOf(t).querySelectorAll('thead th')].map((h) => h.textContent).filter((s) => s !== '');
    expect(heads('Tracks')).toEqual(['Width']);
    expect(heads('Vias')).toEqual(['Diameter', 'Hole']);
    expect(heads('Differential Pairs')).toEqual(['Width', 'Gap', 'Via Gap']);
  });
});

describe('the buttons under a grid', () => {
  it('adds a row of zeros and does not invent a size', () => {
    open();

    fireEvent.click(btn('Tracks', 'Add'));

    // `AppendTrackWidth( 0 )`, which renders as an empty cell.
    expect(cellsOf('Tracks').map((i) => i.value)).toEqual(['0.25 mm', '0.5 mm', '']);
  });

  it('removes the SELECTED row, not the last one', () => {
    open();

    fireEvent.mouseDown(cellsOf('Tracks')[0]!);
    fireEvent.click(btn('Tracks', 'Remove'));

    expect(cellsOf('Tracks').map((i) => i.value)).toEqual(['0.5 mm']);
  });

  it('cannot remove with nothing selected', () => {
    open();

    expect(btn('Tracks', 'Remove')).toHaveProperty('disabled', true);
  });

  it('sorts by the whole row, not by the first column', () => {
    // The rows must TIE on the first column or the two sorts agree and the
    // case proves nothing: sorting on diameter alone is stable, so it would
    // leave 0.5 above 0.3 and pass a first-column-only implementation.
    open({
      trackWidthsMM: [],
      viaSizesMM: [
        { diameter: 0.8, drill: 0.5 },
        { diameter: 0.8, drill: 0.3 },
        { diameter: 0.6, drill: 0.2 },
      ],
      diffPairsMM: [],
    });

    fireEvent.click(btn('Vias', 'Sort ascending'));

    // `VIA_DIMENSION::operator<`: diameter, then drill.
    expect(cellsOf('Vias').map((i) => i.value)).toEqual([
      '0.6 mm',
      '0.2 mm',
      '0.8 mm',
      '0.3 mm',
      '0.8 mm',
      '0.5 mm',
    ]);
  });

  it('marks the selected row, so the user can see what Remove will take', () => {
    open();

    const rowOf = (i: number): HTMLElement =>
      gridOf('Tracks').querySelectorAll<HTMLElement>('tbody tr')[i]!;
    expect(rowOf(0).className).not.toContain('selected');

    fireEvent.mouseDown(cellsOf('Tracks')[1]!);

    expect(rowOf(1).className).toContain('selected');
    expect(rowOf(0).className).not.toContain('selected');
  });
});

describe('sortSizeRows and normalizeSizeRows', () => {
  it('breaks a tie on the second key, then the third', () => {
    // `VIA_DIMENSION::operator<`: `if( m_Diameter != … ) return …; return m_Drill < …`.
    expect(
      sortSizeRows(
        [
          { diameter: 0.8, drill: 0.5 },
          { diameter: 0.8, drill: 0.3 },
          { diameter: 0.6, drill: 0.9 },
        ],
        ['diameter', 'drill'],
      ),
    ).toEqual([
      { diameter: 0.6, drill: 0.9 },
      { diameter: 0.8, drill: 0.3 },
      { diameter: 0.8, drill: 0.5 },
    ]);
  });

  it('drops a row whose first cell is empty, and sorts the rest', () => {
    // `if( !GetCellValue( row, TR_WIDTH_COL ).IsEmpty() )` then `sort()`.
    expect(normalizeSizeRows([{ w: 0.5 }, { w: 0 }, { w: 0.2 }], ['w'])).toEqual([
      { w: 0.2 },
      { w: 0.5 },
    ]);
  });

  it('keeps a row whose LATER cells are empty', () => {
    // A via with no drill is a legal row: `<= 0 means use Netclass via drill`.
    expect(normalizeSizeRows([{ diameter: 0.6, drill: 0 }], ['diameter', 'drill'])).toEqual([
      { diameter: 0.6, drill: 0 },
    ]);
  });
});

describe('OK sorts and prunes whether or not Sort was pressed', () => {
  it('stores the lists in increasing order', () => {
    const { ok } = open({
      trackWidthsMM: [0.5, 0.2, 0.35],
      viaSizesMM: [{ diameter: 0.8, drill: 0.4 }],
      diffPairsMM: [],
    });

    expect(ok()!.trackWidthsMM).toEqual([0.2, 0.35, 0.5]);
  });

  it('drops the rows an Add left empty', () => {
    const { ok } = open({ trackWidthsMM: [0.5], viaSizesMM: [], diffPairsMM: [] });

    fireEvent.click(btn('Tracks', 'Add'));

    expect(ok()!.trackWidthsMM).toEqual([0.5]);
  });
});

describe('Validate() refuses before anything is stored', () => {
  const check = (over: Partial<BoardSetupValues>, message: RegExp) => {
    const { ok } = open({ trackWidthsMM: [], viaSizesMM: [], diffPairsMM: [], ...over });

    expect(ok()).toBeNull();
    expect(screen.getByText(message)).toBeTruthy();
  };

  it('rejects a hole that is not smaller than the diameter', () => {
    check(
      { viaSizesMM: [{ diameter: 0.4, drill: 0.4 }] },
      /Via hole size must be smaller than via diameter/,
    );
  });

  it('rejects a diameter with no hole beside it', () => {
    check({ viaSizesMM: [{ diameter: 0.6, drill: 0 }] }, /No via hole size defined/);
  });

  it('rejects a hole with no diameter beside it', () => {
    check({ viaSizesMM: [{ diameter: 0, drill: 0.3 }] }, /No via diameter defined/);
  });

  it('rejects a dimension under GEOMETRY_MIN_SIZE', () => {
    // [data] `GEOMETRY_MIN_SIZE`, `0.001 * IU_PER_MM` (`pcb_track.h:57`).
    check({ viaSizesMM: [{ diameter: 0.0005, drill: 0.0002 }] }, /Via diameter is too small/);
  });

  it('rejects a differential pair with no gap', () => {
    check(
      { diffPairsMM: [{ width: 0.2, gap: 0, viaGap: 0.5 }] },
      /No differential pair gap defined/,
    );
  });

  it('accepts a via with neither value, which is an empty row', () => {
    const { ok } = open({
      trackWidthsMM: [],
      viaSizesMM: [{ diameter: 0, drill: 0 }],
      diffPairsMM: [],
    });

    expect(ok()!.viaSizesMM).toEqual([]);
  });

  it('leaves the via gap optional', () => {
    const { ok } = open({
      trackWidthsMM: [],
      viaSizesMM: [],
      diffPairsMM: [{ width: 0.2, gap: 0.25, viaGap: 0 }],
    });

    expect(ok()!.diffPairsMM).toEqual([{ width: 0.2, gap: 0.25, viaGap: 0 }]);
  });
});

describe('validateSizes on its own', () => {
  it('names the cell to focus, not just the message', () => {
    // `SetError( msg, this, m_viaSizesGrid, row, errorCol )` — the dialog puts
    // the cursor in the offending cell, so the row and column are part of the
    // answer.
    expect(
      validateSizes({
        viaSizesMM: [
          { diameter: 0.8, drill: 0.4 },
          { diameter: 0.4, drill: 0.4 },
        ],
        diffPairsMM: [],
      }),
    ).toEqual({
      message: 'Via hole size must be smaller than via diameter',
      row: 1,
      grid: 'Vias',
      col: 'drill',
    });
  });

  it('is null when every row is legal', () => {
    expect(
      validateSizes({
        viaSizesMM: [{ diameter: 0.8, drill: 0.4 }],
        diffPairsMM: [{ width: 0.2, gap: 0.25, viaGap: 0 }],
      }),
    ).toBeNull();
  });
});
