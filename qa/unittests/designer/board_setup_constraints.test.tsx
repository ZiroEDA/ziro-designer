// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Constraints — `PANEL_SETUP_CONSTRAINTS`
 * (`pcbnew/dialogs/panel_setup_constraints_base.cpp`).
 *
 * The page came out ~115 px wider than KiCad's and its two halves did not line
 * up, and every cause was a per-element fact that no measurement of the page
 * as a whole could name:
 *
 *   - `bScrolledSizer` adds BOTH halves at proportion 0 and puts the one
 *     growable spacer after them (`:379-395`), so neither column stretches;
 *   - a section heading is one cell in the FIRST column (`Add( m_staticText23,
 *     0, wxTOP|wxLEFT, 13 )`), which is what makes the bitmap column as wide as
 *     "Copper" — not a cell spanning all four;
 *   - `fgSizer2`, the Maximum allowed deviation row, is label | entry | units
 *     with NO bitmap column (`:400-424`);
 *   - `m_minResolvedSpokeCountCtrl` is a `wxSpinCtrl` (`:452`), not an entry;
 *   - every bitmap is asked for at 24 px
 *     (`KiBitmapBundle( …, 24 )`, `panel_setup_constraints.cpp:61-73`).
 *
 * So these assert the structure, per element. The widths themselves are in
 * `designer/src/ui/shell.css` and are measured by
 * `qa/probes/constraints_layout_probe.cpp`; what a DOM test can pin is that
 * the markup those rules are written against is the markup we render.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogBoardSetup } from '@ziroeda/designer/src/editors/pcb/dialogs/dialog_board_setup.js';
import {
  clampMaxErrorMM,
  defaultBoardSetup,
  MAX_ERROR_SIZE_MM,
  MIN_ERROR_SIZE_MM,
  type BoardSetupValues,
} from '@ziroeda/designer/src/editors/pcb/board_settings.js';

afterEach(cleanup);

/** The dialog on its Constraints page, plus whatever OK last handed back. */
function open(over: Partial<BoardSetupValues> = {}): { ok: () => BoardSetupValues | null } {
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
  fireEvent.click(screen.getByText('Constraints'));
  return {
    ok: () => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      return out;
    },
  };
}

const q = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(sel));

describe('the Constraints page structure', () => {
  it('gives each section heading the first column, with the rule as its own row', () => {
    open();

    // `m_staticText23` / `24` / `25` / `28` — Copper, Holes, uVias, Silk.
    expect(q('.ze-con-grid > .ze-con-head').map((e) => e.textContent)).toEqual([
      'Copper',
      'Holes',
      'uVias',
      'Silk',
    ]);
    // One rule row per heading: the four `wxStaticLine`s that follow it.
    expect(q('.ze-con-grid > .ze-con-hr')).toHaveLength(4);
    // A heading that SPANS contributes nothing to the bitmap column, which is
    // how that column collapsed to the width of a bitmap.
    expect(q('.ze-con-grid > .ze-pref-group-title')).toHaveLength(0);
  });

  it('builds every constraint as a four-cell row of the flex grid', () => {
    open();

    const rows = q('.ze-con-grid > .ze-con-row');
    // Seven Copper rows, two Holes, two uVias, three Silk. "Minimum groove for
    // creepage:" is `Show( false )` without `ADVANCED_CFG::m_EnableCreepageSlot`.
    expect(rows).toHaveLength(14);
    for (const row of rows) {
      expect(row.querySelectorAll(':scope > .ze-con-icon')).toHaveLength(1);
      expect(row.querySelectorAll(':scope > .lbl')).toHaveLength(1);
      expect(row.querySelectorAll(':scope > input.ze-search')).toHaveLength(1);
      expect(row.querySelectorAll(':scope > .unit')).toHaveLength(1);
    }
    // The three Silk rows are the un-iconed ones; their cell still holds the
    // column open (`fgFeatureConstraints->Add( 0, 0, 1, wxEXPAND, 5 )`).
    const iconed = rows.filter((r) => r.querySelector('.ze-con-icon img'));
    expect(iconed).toHaveLength(11);
  });

  it('asks for every bitmap at 24, the size KiBitmapBundle is given', () => {
    open();

    const imgs = q('.ze-con-icon img') as HTMLImageElement[];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['24', '24']);
    }
  });

  it('keeps the Maximum allowed deviation row out of the four-column grid', () => {
    open();

    // `fgSizer2` has no bitmap column, so this row must not be a `.ze-con-row`
    // — rendering it as one indented the label by an empty icon cell.
    const dev = q('.ze-con-rules .ze-con-dev');
    expect(dev).toHaveLength(1);
    expect(dev[0]!.querySelector('.ze-con-icon')).toBeNull();
    expect(dev[0]!.querySelector('.lbl')!.textContent).toBe('Maximum allowed deviation:');
    expect(dev[0]!.querySelector('.unit')!.textContent).toBe('mm');
    expect(q('.ze-con-rules .ze-con-grid')).toHaveLength(0);
  });

  it('draws the thermal spoke count as a spin control, not a text field', () => {
    open();

    const spoke = q('.ze-con-spoke');
    expect(spoke).toHaveLength(1);
    // `wxSpinCtrl( …, wxSP_ARROW_KEYS, 0, 10, 0 )` — GTK's two arrow buttons.
    const spin = spoke[0]!.querySelector('.ze-spinctrl');
    expect(spin).not.toBeNull();
    expect(spin!.querySelectorAll('button')).toHaveLength(2);
    // And it carries no width of its own: the sizer lays it out at its best
    // size, which is the shared widget's.
    expect(spin!.querySelector<HTMLInputElement>('input')!.style.width).toBe('');
  });

  it('puts the fillet bitmap beside the checkbox, not inside its label', () => {
    open();

    // `bSizer9` is a horizontal box holding two siblings, so the icon is not
    // part of the checkbox's own label — where it would pick up the shared
    // checkbox's 8 px box-to-text gap instead of the two 5 px borders.
    const row = q('.ze-con-check');
    expect(row).toHaveLength(1);
    expect(row[0]!.querySelectorAll(':scope > .ze-con-icon')).toHaveLength(1);
    expect(row[0]!.querySelectorAll(':scope > label.ze-pref-check')).toHaveLength(1);
    expect(row[0]!.querySelector('label')!.querySelector('.ze-con-icon')).toBeNull();
  });
});

describe('the spoke count spin control', () => {
  it('clamps to the wxSpinCtrl range rather than refusing', () => {
    const { ok } = open();

    const spin = document.querySelector<HTMLInputElement>('.ze-con-spoke .ze-spinctrl input')!;
    fireEvent.change(spin, { target: { value: '99' } });
    // [data] `wxSpinCtrl( …, wxSP_ARROW_KEYS, 0, 10, 0 )` (`:452`).
    expect(ok()!.constraints.minThermalSpokes).toBe(10);
  });
});

describe('m_MaxError is clamped on the way out', () => {
  it('is the range from board_design_settings.h', () => {
    expect([MIN_ERROR_SIZE_MM, MAX_ERROR_SIZE_MM]).toEqual([0.001, 0.1]);
    expect(clampMaxErrorMM(0)).toBe(0.001);
    expect(clampMaxErrorMM(5)).toBe(0.1);
    expect(clampMaxErrorMM(0.005)).toBe(0.005);
  });

  it('stores a typed-in zero as the minimum, not as zero', () => {
    // GetArcToSegmentCount divides by the error, so a zero out of this page is
    // a division by zero in the zone filler.
    const { ok } = open({
      constraints: { ...defaultBoardSetup().constraints, maxDeviationMM: 0 },
    });

    expect(ok()!.constraints.maxDeviationMM).toBe(MIN_ERROR_SIZE_MM);
  });

  it('leaves an in-range value exactly as typed', () => {
    const { ok } = open();

    const dev = document.querySelector<HTMLInputElement>('.ze-con-dev input.ze-search')!;
    fireEvent.change(dev, { target: { value: '0.02' } });
    expect(ok()!.constraints.maxDeviationMM).toBe(0.02);
  });
});

describe('TransferDataFromWindow validates before it stores', () => {
  const type = (key: string, value: string): void => {
    fireEvent.change(document.getElementById(`ze-constraint-${key}`)!, { target: { value } });
  };

  it('refuses a negative clearance and commits nothing', () => {
    const { ok } = open();

    type('minClearanceMM', '-1');
    // `Validate` returns false before the first assignment, so OK does not fire
    // and none of the page's other edits land either.
    expect(ok()).toBeNull();
    expect(screen.getByText(/Minimum clearance must be at least/)).toBeTruthy();
  });

  it('refuses a value over the 10 inch cap', () => {
    const { ok } = open();

    // [data] `Validate( 0, 10, EDA_UNITS::INCH )` — 254 mm.
    type('minTrackMM', '300');
    expect(ok()).toBeNull();
    expect(screen.getByText(/Minimum track width must be less than/)).toBeTruthy();
  });

  it('holds the drill to its own mils range, not the inch one', () => {
    const { ok } = open();

    // [data] `Validate( 2, 1000, EDA_UNITS::MILS )` — 0.0508 mm to 25.4 mm. A
    // 0.01 mm drill is inside the inch range every other field uses and
    // outside this one.
    type('minThroughHoleMM', '0.01');
    expect(ok()).toBeNull();
    expect(screen.getByText(/Minimum drill size must be at least/)).toBeTruthy();
  });

  it('leaves the fields upstream does not validate alone', () => {
    const { ok } = open();

    // `TransferDataFromWindow` calls Validate on ten fields and these are not
    // among them: a uVia or Silk value out of range is stored as typed.
    type('minUViaMM', '900');
    type('minTextHeightMM', '900');
    expect(ok()!.constraints.minUViaMM).toBe(900);
  });

  it('accepts the whole page when every value is in range', () => {
    const { ok } = open();

    type('minClearanceMM', '0.2');
    expect(ok()!.constraints.minClearanceMM).toBe(0.2);
  });
});
