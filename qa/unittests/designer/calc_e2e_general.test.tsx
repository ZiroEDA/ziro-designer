// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * End-to-end parity for the calculator's "General system design" pages -
 * Regulators and Resistor Calculator - against REAL KiCad 10.0.5.
 *
 * Same rule as the other `calc_e2e_*` files: every expected string was printed
 * by the installed `/usr/bin/pcb_calculator` on this machine and read out of
 * its widgets over AT-SPI, never computed by our engine. The harness and the
 * raw captures are in `qa/probes/pcb_calculator_oracle/`; the case names in the
 * comments are keys in `kicad_answers_2.json`.
 *
 * These two panels are the ones where the answer is a STRING rather than a
 * number - "330R + 3K3", "5.04V [4.76V ... 5.35V]", "+0.05", "Exact" - so an
 * engine that computes the right resistance can still put the wrong thing on
 * screen, and nothing before this checked which.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PanelRegulator } from '@ziroeda/designer/src/editors/calculator/panels/panel_regulator.js';
import { PanelRCalculator } from '@ziroeda/designer/src/editors/calculator/panels/panel_r_calculator.js';

afterEach(() => cleanup());

const type = (el: Element | null, v: string): void => {
  fireEvent.change(el as HTMLElement, { target: { value: v } });
};
const valueOf = (el: Element | null | undefined): string => (el as HTMLInputElement).value;

/** The first `<input>` at or after the label, for a nameless flat-grid row. */
const afterLabel = (label: string): HTMLInputElement => {
  let n = screen.getByText(label).nextElementSibling;
  while (n) {
    if (n.tagName === 'INPUT') return n as HTMLInputElement;
    const inner = n.querySelector('input');
    if (inner) return inner;
    n = n.nextElementSibling;
  }
  throw new Error(`no input after ${label}`);
};

describe('Regulators, end to end against pcb_calculator', () => {
  /** `.reg-grid` is flat: label, then the min / typ / max cells in order. */
  const cells = (label: string): Element[] => {
    const out: Element[] = [];
    let n = screen.getByText(label).nextElementSibling;
    for (let i = 0; i < 3 && n; i++) {
      out.push(n);
      n = n.nextElementSibling;
    }
    return out;
  };
  const minTypMax = (label: string): string[] => cells(label).map((c) => valueOf(c));
  const solveFor = (i: number): void => {
    fireEvent.click(screen.getAllByRole('radio')[i] as HTMLElement);
  };
  const calculate = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
  };

  /** The whole 3-terminal form, so no case inherits another's state. */
  function fill(r1: string, r2: string, vout: string): void {
    type(cells('R1:')[1] ?? null, r1);
    type(cells('R2:')[1] ?? null, r2);
    type(cells('Vout:')[1] ?? null, vout);
    const vref = cells('Vref:');
    type(vref[0] ?? null, '1.20');
    type(vref[1] ?? null, '1.25');
    type(vref[2] ?? null, '1.30');
    const iadj = cells('Iadj:');
    // The Iadj row has no min cell - a plain span sits there - so its typ and
    // max are the second and third children after the label.
    type(iadj[1] ?? null, '50');
    type(iadj[2] ?? null, '100');
    type(afterLabel('Resistor tolerance:'), '1');
  }

  it('solves Vout for an LM317 divider, with KiCad’s min/typ/max spread', () => {
    render(<PanelRegulator />);
    fill('0.240', '0.720', '5');
    solveFor(2);
    calculate();

    // Case `regulators/3term_vout`. R1 and R2 pick up the ±1 % resistor
    // tolerance; Vout's spread comes from that plus Vref's own min/max.
    expect(minTypMax('R1:')).toEqual(['0.238', '0.24', '0.242']);
    expect(minTypMax('R2:')).toEqual(['0.713', '0.72', '0.727']);
    expect(minTypMax('Vout:')).toEqual(['4.764', '5.036', '5.352']);
    // The overall tolerance row has min and max but no typ - a span sits there.
    expect(valueOf(cells('Overall tolerance:')[0])).toBe('-5.39');
    expect(valueOf(cells('Overall tolerance:')[2])).toBe('5.9');
    // A single formatted sentence, not three numbers: %g at 0.01 precision with
    // a "V" glued to each.
    expect(valueOf(screen.getByText('Power Comment:').nextElementSibling)).toBe(
      '5.04V [4.76V ... 5.35V]',
    );
  });

  it('solves R2 for a target Vout', () => {
    render(<PanelRegulator />);
    fill('0.240', '0.720', '5');
    solveFor(1);
    calculate();

    // Case `regulators/3term_r2`.
    expect(minTypMax('R1:')).toEqual(['0.238', '0.24', '0.242']);
    expect(minTypMax('R2:')).toEqual(['0.706', '0.713', '0.72']);
    expect(minTypMax('Vout:')).toEqual(['4.73', '5', '5.313']);
    expect(valueOf(cells('Overall tolerance:')[0])).toBe('-5.39');
    expect(valueOf(cells('Overall tolerance:')[2])).toBe('5.89');
  });

  it('solves R1 for a target Vout', () => {
    render(<PanelRegulator />);
    fill('0.240', '0.720', '5');
    solveFor(0);
    calculate();

    // Case `regulators/3term_r1`.
    expect(minTypMax('R1:')).toEqual(['0.24', '0.242', '0.245']);
    expect(minTypMax('R2:')).toEqual(['0.713', '0.72', '0.727']);
    expect(minTypMax('Vout:')).toEqual(['4.73', '5', '5.313']);
    expect(valueOf(cells('Overall tolerance:')[0])).toBe('-5.39');
    expect(valueOf(cells('Overall tolerance:')[2])).toBe('5.9');
  });
});

describe('Resistor Calculator, end to end against pcb_calculator', () => {
  const calculate = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
  };
  /** The three solution rows and the three approximation cells beside them. */
  const solutions = (container: HTMLElement): string[][] => {
    const s = Array.from(container.querySelectorAll('input.rc-solution')).map((e) =>
      valueOf(e as HTMLInputElement),
    );
    const a = Array.from(container.querySelectorAll('input.rc-approx')).map((e) =>
      valueOf(e as HTMLInputElement),
    );
    return [s, a];
  };

  function ask(series: string, kohm: string): void {
    fireEvent.click(screen.getByLabelText(series));
    type(afterLabel('Required resistance:'), kohm);
    type(afterLabel('Exclude value 1:'), '');
    type(afterLabel('Exclude value 2:'), '');
    calculate();
  }

  it('3.65 kΩ out of E6', () => {
    const { container } = render(<PanelRCalculator />);
    ask('E6', '3.65');

    // Case `r_calculator/E6_3.65k`. The R-notation (330R, 3K3), the `|` for a
    // parallel pair, the bracketing, the signed two-decimal error and the word
    // "Exact" are all KiCad's own strings.
    const [sol, approx] = solutions(container);
    expect(sol).toEqual(['330R + 3K3', '22R + 330R + 3K3', '(3K3 | 3K3) + 1K + 1K']);
    expect(approx).toEqual(['-0.55', '+0.05', 'Exact']);
  });

  it('3.65 kΩ out of E24, where the 4R search gives up', () => {
    const { container } = render(<PanelRCalculator />);
    ask('E24', '3.65');

    // Case `r_calculator/E24_3.65k`. A three-resistor exact hit makes the
    // four-resistor search pointless, and KiCad says so in words rather than
    // printing a worse answer. Its approximation cell is then blank.
    //
    // The 3R cell is THE ONE CELL in these three cases that cannot be matched.
    // KiCad prints `(3K3 | 3K3) + 2K`; we print `(100R | 100R) + 3K6`. Both are
    // exactly 3650 Ω from three resistors of two distinct values, so KiCad's own
    // `betterCandidate` (fewest distinct values, then fewest resistors, then the
    // smaller formula string) ranks OURS first - `(1` sorts before `(3`. KiCad
    // never generated ours: `findIn2RBuffer` looks only at the two entries
    // either side of `lower_bound`, dozens of 2R combinations share a value
    // exactly, and which one `std::sort` leaves at that index is unspecified.
    // There is no way to reproduce an unspecified order from TypeScript, so we
    // resolve the tie by upstream's own preference instead (see the comment on
    // the buffer sort in resistor_substitution_utils.ts). That is what this
    // string is derived from - it is the lexicographic minimum among the exact
    // three-resistor two-value forms - not a baseline of whatever we printed.
    const [sol, approx] = solutions(container);
    expect(sol[0]).toBe('51R + 3K6');
    expect(sol[1]).toBe('(100R | 100R) + 3K6');
    expect(sol[2]).toBe('Not worth using');
    expect(approx).toEqual(['+0.03', 'Exact', '']);
  });

  it('3.65 kΩ out of E3, where nothing is close', () => {
    const { container } = render(<PanelRCalculator />);
    ask('E3', '3.65');

    // Case `r_calculator/E3_3.65k`. E3 has no value near 3.65 k, so the simple
    // solution is a parallel pair 6 % out and the search works down from there.
    const [sol, approx] = solutions(container);
    expect(sol).toEqual(['4K7 | 22K', '(2K2 + 2K2) | 22K', '10K | (1K + 47R + 4K7)']);
    expect(approx).toEqual(['+6.10', '+0.46', '-0.01']);
  });
});
