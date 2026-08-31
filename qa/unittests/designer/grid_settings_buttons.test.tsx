// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GRID_SETTINGS`' five buttons, and `DIALOG_GRID_SETTINGS` behind two of
 * them — **per launcher**.
 *
 * The panel is ONE class upstream (`common/dialogs/panel_grid_settings.cpp`)
 * and one component here, so a rule that is right in the Drawing Sheet Editor
 * and wrong in the Schematic Editor is the bug this file exists to catch. Every
 * behaviour below is asserted against both mounts: `FRAME_PL_EDITOR` with
 * `drawSheetIUScale` (microns) and `FRAME_SCH` with `schIUScale` (100 nm), which
 * differ in the printed precision as well as in the override rows.
 *
 * Rendered, not grepped. The five handlers are twelve lines each and every one
 * of them is an index calculation — `m_grids.insert( begin() + row )`,
 * `std::swap( m_grids[row], m_grids[row - 1] )`, `if( row != 0 )
 * SetSelection( row - 1 )` — so a source scan that finds the button says
 * nothing about where the row ends up.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { drawSheetIUScale, schIUScale, type EdaIuScale } from '@ziroeda/common';
import {
  PanelGridSettings,
  type GridSettingsSlice,
} from '@ziroeda/designer/src/dialogs/prefs/PanelGridSettings.js';
import type { GridFrameType } from '@ziroeda/designer/src/dialogs/prefs/grid_settings_rows.js';
import type { GridEntry } from '@ziroeda/designer/src/ui/grid_settings.js';
import type { EdaUnits } from '@ziroeda/designer/src/ui/unit_binder.js';

afterEach(cleanup);

/** One launcher's `PANEL_GRID_SETTINGS( …, cfg, FRAME_T )` call. */
interface Launcher {
  name: string;
  frameType: GridFrameType;
  units: EdaUnits;
  iuScale: EdaIuScale;
  /** Three grids, in millimetres, so both launchers start from the same list. */
  grids: GridEntry[];
  /** What `label()` prints for `grids[0]`, re-derived from `MessageTextFromValue`. */
  firstLabel: string;
  /** What the Edit test's row reads afterwards — 2 mils, named "Coarse". */
  editedLabel: string;
}

/**
 * `pl_editor.cpp:71-79` and `eeschema.cpp`'s `PANEL_SCH_GRIDS`.
 *
 * Both frames open in MILS (`app_settings.cpp:228-238`), so the difference in
 * the printed row is the IU SCALE alone: `short_form` is
 * `IU_PER_MM == SCH_IU_PER_MM` (`common/eda_units.cpp:425-426`), true for
 * eeschema and false for the drawing sheet, which is 0 vs 2 decimals on mils
 * and 3 vs 4 on millimetres. 1 mm is 39.3700787 mils.
 */
const LAUNCHERS: Launcher[] = [
  {
    name: 'pl_editor',
    frameType: 'FRAME_PL_EDITOR',
    units: 'mils',
    iuScale: drawSheetIUScale,
    grids: [
      { name: '', x: '1', y: '1' },
      { name: '', x: '0.5', y: '0.5' },
      { name: '', x: '0.25', y: '0.25' },
    ],
    firstLabel: '39.37 mils (1.0000 mm)',
    // 2 mils is exactly 0.0508 mm; the drawing sheet is the long form, so mils
    // take two decimals and millimetres four.
    editedLabel: 'Coarse: 2.00 mils (0.0508 mm)',
  },
  {
    name: 'eeschema',
    frameType: 'FRAME_SCH',
    units: 'mils',
    iuScale: schIUScale,
    grids: [
      { name: '', x: '1', y: '1' },
      { name: '', x: '0.5', y: '0.5' },
      { name: '', x: '0.25', y: '0.25' },
    ],
    firstLabel: '39 mils (1.00 mm)',
    // The SAME grid, printed by the same component, in eeschema's short form:
    // mils to no decimals and millimetres to three. `0.051` keeps its last
    // digit, so the 2-1/2-digit trim at `eda_units.cpp:496-503` does not fire
    // here the way it does on `1.000` above.
    editedLabel: 'Coarse: 2 mils (0.051 mm)',
  },
];

/** The slice the panel writes into, with the panel's own state around it. */
function Harness({
  launcher,
  initial,
  onChange,
}: {
  launcher: Launcher;
  initial: GridSettingsSlice;
  onChange?: (g: GridSettingsSlice) => void;
}): React.JSX.Element {
  const [grid, setGrid] = useState<GridSettingsSlice>(initial);
  return (
    <PanelGridSettings
      grid={grid}
      update={(fn) => {
        setGrid((prev) => {
          const next = structuredClone(prev);
          fn(next);
          onChange?.(next);
          return next;
        });
      }}
      frameType={launcher.frameType}
      units={launcher.units}
      iuScale={launcher.iuScale}
      idPrefix={launcher.name}
    />
  );
}

const slice = (grids: GridEntry[], last = 0): GridSettingsSlice => ({
  sizes: structuredClone(grids),
  last_size_idx: last,
  fast_grid_1: 0,
  fast_grid_2: grids.length - 1,
  overrides_enabled: true,
  overrides: {},
});

/** The list box's rows, in order. */
const rowLabels = (): string[] =>
  Array.from(document.querySelectorAll('.ze-gridlist .ze-gridlist-row')).map(
    (o) => o.textContent ?? '',
  );

/**
 * `m_currentGridCtrl->GetSelection()`.
 *
 * The list is a `role="listbox"` of `role="option"` rows, not a native
 * `<select size>`: a native one paints its selected row in the BROWSER's
 * highlight once it has focus, which beats any `option:checked` rule, so the
 * row came up in KiCad's orange and turned blue on the first click.
 */
const selectedRow = (): number =>
  Array.from(document.querySelectorAll('.ze-gridlist .ze-gridlist-row')).findIndex(
    (o) => o.getAttribute('aria-selected') === 'true',
  );

const button = (title: string): HTMLButtonElement => screen.getByTitle(title) as HTMLButtonElement;

/** Select a row, which is what every handler reads. */
function selectRow(i: number): void {
  const rows = document.querySelectorAll('.ze-gridlist .ze-gridlist-row');
  fireEvent.mouseDown(rows[i] as Element);
}

/** Fill the open `DIALOG_GRID_SETTINGS` and press OK. */
function fillDialog(fields: { name?: string; x?: string; y?: string; linked?: boolean }): void {
  if (fields.name !== undefined) {
    fireEvent.change(document.getElementById('ze-gs-name') as HTMLInputElement, {
      target: { value: fields.name },
    });
  }
  if (fields.linked !== undefined) {
    const linked = screen.getByLabelText('Linked') as HTMLInputElement;
    if (linked.checked !== fields.linked) fireEvent.click(linked);
  }
  if (fields.x !== undefined) {
    fireEvent.change(document.getElementById('ze-gs-x') as HTMLInputElement, {
      target: { value: fields.x },
    });
  }
  if (fields.y !== undefined) {
    fireEvent.change(document.getElementById('ze-gs-y') as HTMLInputElement, {
      target: { value: fields.y },
    });
  }
  act(() => {
    fireEvent.click(screen.getByText('OK'));
  });
}

for (const launcher of LAUNCHERS) {
  describe(`PANEL_GRID_SETTINGS in ${launcher.name}`, () => {
    it('has all five buttons of bSizerGridButtons, in upstream’s order', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids)} />);
      // `panel_grid_settings_base.cpp:37-54`: add, edit, moveUp, moveDown,
      // spacer, remove. Ours shipped two of the five.
      const titles = Array.from(document.querySelectorAll('.ze-gridbtns button')).map((b) =>
        b.getAttribute('title'),
      );
      expect(titles).toEqual([
        'Add grid',
        'Edit grid',
        'Move grid up',
        'Move grid down',
        'Remove grid',
      ]);
    });

    it('prints each row through GRID::MessageText in both unit systems', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids)} />);
      // `_( "%s%s (%s)" )` (`panel_grid_settings.cpp:139-143`). The value is
      // re-derived from `MessageTextFromValue`'s per-unit precision, and it
      // differs between these two launchers, which is what says the panel is
      // reading the frame's IU scale rather than one of its own.
      expect(rowLabels()[0]).toBe(launcher.firstLabel);
    });

    it('greys Move Up on the first row and Move Down on the last', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 0)} />);
      // `OnUpdateMoveUp` / `OnUpdateMoveDown` (`:360-378`).
      expect(button('Move grid up').disabled).toBe(true);
      expect(button('Move grid down').disabled).toBe(false);
      selectRow(2);
      expect(button('Move grid up').disabled).toBe(false);
      expect(button('Move grid down').disabled).toBe(true);
    });

    it('greys Remove when one grid is left, and never Add', () => {
      render(<Harness launcher={launcher} initial={slice([launcher.grids[0]!])} />);
      // `OnUpdateRemove`: `event.Enable( m_grids.size() > 1 )` (`:379-383`).
      expect(button('Remove grid').disabled).toBe(true);
      // Add has no `OnUpdate*` handler at all.
      expect(button('Add grid').disabled).toBe(false);
    });

    it('Move Up swaps with the row above and the selection follows', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 2)} />);
      const before = rowLabels();
      act(() => {
        fireEvent.click(button('Move grid up'));
      });
      const after = rowLabels();
      // `std::swap( m_grids[row], m_grids[row - 1] )` (`:331`).
      expect(after[1]).toBe(before[2]);
      expect(after[2]).toBe(before[1]);
      expect(after[0]).toBe(before[0]);
      // `SetSelection( row - 1 )` (`:334`) — the grid stays selected.
      expect(selectedRow()).toBe(1);
    });

    it('Move Down swaps with the row below and the selection follows', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 1)} />);
      const before = rowLabels();
      act(() => {
        fireEvent.click(button('Move grid down'));
      });
      const after = rowLabels();
      expect(after[1]).toBe(before[2]);
      expect(after[2]).toBe(before[1]);
      expect(selectedRow()).toBe(2);
    });

    it('Move Down from row 0 moves the grid but NOT the selection', () => {
      // `OnMoveGridDown` guards its `SetSelection` with `if( row != 0 )`
      // (`:348`), where `OnMoveGridUp`'s guard is vacuous. Copied rather than
      // corrected: the asymmetry is upstream's, and a "fixed" port would be a
      // different program.
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 0)} />);
      const before = rowLabels();
      act(() => {
        fireEvent.click(button('Move grid down'));
      });
      expect(rowLabels()[1]).toBe(before[0]);
      expect(selectedRow()).toBe(0);
    });

    it('Remove deletes the selected row and steps the selection back', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 2)} />);
      const before = rowLabels();
      act(() => {
        fireEvent.click(button('Remove grid'));
      });
      expect(rowLabels()).toEqual([before[0], before[1]]);
      // `if( row != 0 ) SetSelection( row - 1 )` (`:319-320`).
      expect(selectedRow()).toBe(1);
    });

    it('Edit opens DIALOG_GRID_SETTINGS on the selected row and rewrites it', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 1)} />);
      act(() => {
        fireEvent.click(button('Edit grid'));
      });
      // The dialog's own title (`dialog_grid_settings_base.h:57`).
      expect(screen.getByText('Grid Settings')).toBeTruthy();
      // It opens filled from the row: 0.5 mm in a mils frame is 19.685 mils.
      expect((document.getElementById('ze-gs-x') as HTMLInputElement).value).not.toBe('');

      fillDialog({ name: 'Coarse', x: '2', linked: true });

      // `m_grids[row] = editGrid` (`:302`), and the row is re-selected (`:305`).
      expect(rowLabels()[1]).toContain('Coarse: ');
      expect(selectedRow()).toBe(1);
      // The name is stored, not just displayed, and so is the SIZE: `2` typed
      // into a mils field is exactly 2 mils = 0.0508 mm, written back through
      // `StringFromValue( scale, EDA_UNITS::MM, gridX )` and read out again by
      // `MessageTextFromValue`. `2.01 mils (0.0510 mm)` here would mean the
      // value had been quantised to the frame's IU on the way in, which is
      // `GetValue()`'s behaviour and not `GetDoubleValue()`'s.
      expect(rowLabels()[1]).toBe(launcher.editedLabel);
    });

    it('Edit leaves the row alone when nothing was changed', () => {
      // ":If the user just clicked OK without changing anything, then return"
      // (`:285-288`) — and it matters, because the duplicate check that follows
      // would otherwise match the row against itself.
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 1)} />);
      const before = rowLabels();
      act(() => {
        fireEvent.click(button('Edit grid'));
      });
      act(() => {
        fireEvent.click(screen.getByText('OK'));
      });
      expect(rowLabels()).toEqual(before);
      expect(screen.queryByText(/already exists/)).toBeNull();
    });

    it('Add inserts the new grid AT the selected row, not at the end', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 1)} />);
      const before = rowLabels();
      act(() => {
        fireEvent.click(button('Add grid'));
      });
      fillDialog({ name: 'Fine', x: '0.1', linked: true });
      // `m_grids.insert( m_grids.begin() + row, newGrid )` (`:266`), then
      // `SetSelection( row )` — the new grid takes the selected position.
      const after = rowLabels();
      expect(after).toHaveLength(before.length + 1);
      expect(after[1]).toContain('Fine: ');
      expect(after[2]).toBe(before[1]);
      expect(selectedRow()).toBe(1);
    });

    it('refuses a duplicate with KiCad’s own message', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 0)} />);
      const existing = rowLabels()[1]!;
      act(() => {
        fireEvent.click(button('Add grid'));
      });
      // The second row is 0.5 mm; entering it again must clash.
      fillDialog({ name: '', x: '0.5mm', linked: true });
      // `_( "Grid size '%s' already exists." )` (`:259-262`), whose `%s` is the
      // EXISTING row's `UserUnitsMessageText`, not the text just typed.
      expect(screen.getByText(`Grid size '${existing}' already exists.`)).toBeTruthy();
      // And nothing was added.
      expect(rowLabels()).toHaveLength(launcher.grids.length);
    });

    it('refuses an out-of-range X with the dialog’s own message', () => {
      render(<Harness launcher={launcher} initial={slice(launcher.grids, 0)} />);
      act(() => {
        fireEvent.click(button('Add grid'));
      });
      // `Validate( 0.001, 1000.0, EDA_UNITS::MM )` (`dialog_grid_settings.cpp:81`)
      // — the limits are millimetres whatever the field is showing, so 2000 mm
      // is out and the message is the dialog's, not `UNIT_BINDER`'s.
      fillDialog({ x: '2000mm', linked: true });
      expect(screen.getByText('Grid size X out of range.')).toBeTruthy();
      expect(rowLabels()).toHaveLength(launcher.grids.length);
    });

    it('a linked grid writes Y = X, and unlinking lets them differ', () => {
      const seen: GridSettingsSlice[] = [];
      render(
        <Harness
          launcher={launcher}
          initial={slice(launcher.grids, 0)}
          onChange={(g) => seen.push(g)}
        />,
      );
      act(() => {
        fireEvent.click(button('Add grid'));
      });
      // `gridY = m_checkLinked->IsChecked() ? gridX : m_gridSizeY.GetDoubleValue()`
      // (`dialog_grid_settings.cpp:92`).
      fillDialog({ x: '0.3mm', linked: false, y: '0.7mm' });
      const added = seen.at(-1)!.sizes[0]!;
      expect(added.x).not.toBe(added.y);
      // A non-square grid prints as `x X y` (`grid_settings.cpp:41-44`).
      expect(rowLabels()[0]).toContain(' x ');
    });
  });
}

describe('the two launchers do not share a rendering', () => {
  it('prints the same grid differently, because the IU scale differs', () => {
    // The trap this whole file guards: one component, two frames. If the panel
    // ever hardcoded a scale, these two would print the same string.
    expect(LAUNCHERS[0]!.firstLabel).not.toBe(LAUNCHERS[1]!.firstLabel);
  });
});
