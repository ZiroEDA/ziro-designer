// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * End-to-end parity for the calculator's "Power, current and isolation" pages,
 * against REAL KiCad 10.0.5.
 *
 * The engine already has KiCad's own QA vectors (transline_kicad_qa) and they
 * pass 99/99 - but every one of them calls an engine function directly. Nothing
 * had ever gone in through a panel. That is precisely where this week's five
 * bugs were: Stripline displayed `a` and threw the number away, the unit
 * selector converted the value beside it where KiCad only recalculates, Track
 * Width's cross-section ignored the width selector's unit. Every engine test
 * still passed through all five.
 *
 * So the expectations below are NOT computed by our code. Each one is a string
 * that the installed `/usr/bin/pcb_calculator` printed on this machine, read
 * out of its wxTextCtrl / wxStaticText through AT-SPI - the same characters a
 * user sees. `qa/probes/pcb_calculator_oracle/` holds the harness that drives
 * it and the raw captures; `kicad_answers_1.json` / `_2.json` are its output,
 * keyed by the same case names used here.
 *
 * Reading the real widget matters more than it sounds. An expectation derived
 * from our engine is CLAUDE.md's first shape of test that cannot fail, and here
 * it would have passed on all five bugs: our engine agreeing with itself says
 * nothing about whether the panel reaches it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PanelTrackWidth } from '@ziroeda/designer/src/editors/calculator/panels/panel_track_width.js';
import { PanelViaSize } from '@ziroeda/designer/src/editors/calculator/panels/panel_via_size.js';
import { PanelFusingCurrent } from '@ziroeda/designer/src/editors/calculator/panels/panel_fusing_current.js';
import { PanelCableSize } from '@ziroeda/designer/src/editors/calculator/panels/panel_cable_size.js';
import { PanelElectricalSpacing } from '@ziroeda/designer/src/editors/calculator/panels/panel_electrical_spacing.js';

// `qa/vitest.config.ts` does not set `globals`, so @testing-library/react never
// registers its own afterEach and two renders in one file would stack both DOMs
// on document.body.
afterEach(() => cleanup());

/** Type into a field the way a user does. */
const type = (el: Element | null, v: string): void => {
  fireEvent.change(el as HTMLElement, { target: { value: v } });
};

/** `Combo` is a <button> + a popup listbox that selects on mousedown. */
const pickUnit = (button: Element | null, option: string): void => {
  fireEvent.click(button as HTMLElement);
  fireEvent.mouseDown(screen.getByRole('option', { name: option }));
};

/** A `.calc-result` row displays its value in the span after the label. */
const resultOf = (scope: { getByText: (t: string) => HTMLElement }, label: string): string =>
  scope.getByText(label).nextElementSibling?.textContent ?? '<missing>';

/**
 * Shape-B rows carry no accessible name at all - `<span>label</span><input>` in
 * a flat grid - so the only handle is the label's own text. Walk forward to the
 * first `<input>`, which also copes with the rows whose entry shares a
 * `<span class="calc-cell">` with a `...` picker.
 */
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

/** The unit `Combo` of a Shape-B row: the first button after the label. */
const comboAfter = (label: string): HTMLElement => {
  let n = screen.getByText(label).nextElementSibling;
  while (n) {
    if (n.tagName === 'BUTTON') return n as HTMLElement;
    n = n.nextElementSibling;
  }
  throw new Error(`no combo after ${label}`);
};

const fieldText = (el: Element): string => (el as HTMLInputElement).value;

const textbox = (name: RegExp): HTMLElement => screen.getByRole('textbox', { name });

describe('Track Width, end to end against pcb_calculator', () => {
  /** Set the whole Parameters box, so no case depends on the one before it. */
  function setParameters(current: string, dt: string, len: string): void {
    type(textbox(/^Current \(I\)/), current);
    type(textbox(/^Temperature rise/), dt);
    type(textbox(/^Conductor length/), len);
  }

  it('5 A / 10 °C / 20 mm gives KiCad’s widths, areas, drops and losses', () => {
    render(<PanelTrackWidth />);
    setParameters('5', '10', '20');

    const ext = screen.getByRole('group', { name: 'External Layer Tracks' });
    const int_ = screen.getByRole('group', { name: 'Internal Layer Tracks' });

    // pcb_calculator, Track Width page, typed exactly these three numbers with
    // both thicknesses at 35 µm. Case `track_width/current_5A_mm`.
    expect(fieldText(within(ext).getByRole('textbox', { name: /^Track width \(W\)/ }))).toBe(
      '2.76552',
    );
    expect(resultOf(within(ext), 'Cross-section area:')).toBe('0.0967932');
    expect(resultOf(within(ext), 'Resistance:')).toBe('0.00355397');
    expect(resultOf(within(ext), 'Voltage drop:')).toBe('0.0177698');
    expect(resultOf(within(ext), 'Power loss:')).toBe('0.0888492');

    expect(fieldText(within(int_).getByRole('textbox', { name: /^Track width \(W\)/ }))).toBe(
      '7.19434',
    );
    expect(resultOf(within(int_), 'Cross-section area:')).toBe('0.251802');
    expect(resultOf(within(int_), 'Resistance:')).toBe('0.00136615');
    expect(resultOf(within(int_), 'Voltage drop:')).toBe('0.00683077');
    expect(resultOf(within(int_), 'Power loss:')).toBe('0.0341538');
  });

  it('switching the length unit to inch recalculates and does NOT convert the 20', () => {
    render(<PanelTrackWidth />);
    setParameters('5', '10', '20');

    const lenRow = textbox(/^Conductor length/).closest('label');
    pickUnit(within(lenRow as HTMLElement).getByRole('button'), 'inch');

    // KiCad leaves the entry alone - a UNIT_SELECTOR is a plain wxChoice wired
    // to the same recalculate handler as the text field, so 20 mm becomes
    // 20 INCH and the resistance moves by exactly 25.4.
    // Case `track_width/len_unit_inch`.
    expect(fieldText(textbox(/^Conductor length/))).toBe('20');

    const ext = screen.getByRole('group', { name: 'External Layer Tracks' });
    expect(fieldText(within(ext).getByRole('textbox', { name: /^Track width \(W\)/ }))).toBe(
      '2.76552',
    );
    expect(resultOf(within(ext), 'Cross-section area:')).toBe('0.0967932');
    expect(resultOf(within(ext), 'Resistance:')).toBe('0.0902708');
    expect(resultOf(within(ext), 'Voltage drop:')).toBe('0.451354');
    expect(resultOf(within(ext), 'Power loss:')).toBe('2.25677');
  });

  it('the cross-section area follows the WIDTH selector, unit label and all', () => {
    render(<PanelTrackWidth />);
    setParameters('5', '10', '20');

    const ext = screen.getByRole('group', { name: 'External Layer Tracks' });
    const widthRow = within(ext)
      .getByRole('textbox', { name: /^Track width \(W\)/ })
      .closest('label');
    pickUnit(within(widthRow as HTMLElement).getByRole('button'), 'mil');

    // Case `track_width/ext_width_unit_mil`. The width here is DERIVED - the
    // current is the controlling value - so the selector reformats it, and the
    // area goes with it: 2.76552 mm is 108.879 mil, and the area is printed in
    // mil², not left in mm². The resistance is a physical quantity and does not
    // move at all. This is the case that pins the third of this week's bugs,
    // where the area ignored this selector entirely.
    expect(fieldText(within(ext).getByRole('textbox', { name: /^Track width \(W\)/ }))).toBe(
      '108.879',
    );
    expect(resultOf(within(ext), 'Cross-section area:')).toBe('150.03');
    expect(
      within(ext).getByText('Cross-section area:').parentElement?.lastElementChild?.textContent,
    ).toBe('mil²');
    expect(resultOf(within(ext), 'Resistance:')).toBe('0.00355397');
    expect(resultOf(within(ext), 'Voltage drop:')).toBe('0.0177698');
    expect(resultOf(within(ext), 'Power loss:')).toBe('0.0888492');

    pickUnit(within(widthRow as HTMLElement).getByRole('button'), 'inch');
    // Case `track_width/ext_width_unit_inch`.
    expect(fieldText(within(ext).getByRole('textbox', { name: /^Track width \(W\)/ }))).toBe(
      '0.108879',
    );
    expect(resultOf(within(ext), 'Cross-section area:')).toBe('0.00015003');
    expect(
      within(ext).getByText('Cross-section area:').parentElement?.lastElementChild?.textContent,
    ).toBe('inch²');
  });

  it('an external thickness of 1 oz/ft² widens the track the way KiCad does', () => {
    render(<PanelTrackWidth />);
    setParameters('5', '10', '20');

    const ext = screen.getByRole('group', { name: 'External Layer Tracks' });
    const thickRow = within(ext)
      .getByRole('textbox', { name: /^Track thickness \(H\)/ })
      .closest('label');
    pickUnit(within(thickRow as HTMLElement).getByRole('button'), 'oz/ft²');
    type(within(ext).getByRole('textbox', { name: /^Track thickness \(H\)/ }), '1');

    // Case `track_width/ext_thickness_1oz`.
    expect(fieldText(within(ext).getByRole('textbox', { name: /^Track width \(W\)/ }))).toBe(
      '2.81376',
    );
    expect(resultOf(within(ext), 'Cross-section area:')).toBe('0.0967932');
    expect(resultOf(within(ext), 'Resistance:')).toBe('0.00355397');
  });

  it('typing a width makes it the controlling value and drives the current', () => {
    render(<PanelTrackWidth />);
    setParameters('5', '10', '20');

    const ext = screen.getByRole('group', { name: 'External Layer Tracks' });
    type(within(ext).getByRole('textbox', { name: /^Track width \(W\)/ }), '1.0');

    // Case `track_width/ext_width_1mm_drives_current`.
    expect(fieldText(textbox(/^Current \(I\)/))).toBe('2.39156');
    expect(resultOf(within(ext), 'Cross-section area:')).toBe('0.035');
    expect(resultOf(within(ext), 'Resistance:')).toBe('0.00982857');

    const int_ = screen.getByRole('group', { name: 'Internal Layer Tracks' });
    expect(fieldText(within(int_).getByRole('textbox', { name: /^Track width \(W\)/ }))).toBe(
      '2.60144',
    );
  });
});

describe('Via Size, end to end against pcb_calculator', () => {
  /** Every input, so the case does not inherit a default that might drift. */
  function setAll(): void {
    type(textbox(/^Finished hole diameter \(D\)/), '0.4');
    type(textbox(/^Plating thickness \(T\)/), '0.035');
    type(textbox(/^Via length/), '1.6');
    type(textbox(/^Via pad diameter/), '0.6');
    type(textbox(/^Clearance hole diameter/), '1.0');
    type(textbox(/^Z0/), '50');
    type(textbox(/^Applied current/), '1');
    type(textbox(/^Plating resistivity/), '6.9e-8');
    type(textbox(/^Substrate relative permittivity/), '4.5');
    type(textbox(/^Temperature rise/), '10');
    type(textbox(/^Pulse rise time/), '1');
  }

  it('gives KiCad’s nine results for a 0.4 mm via', () => {
    render(<PanelViaSize />);
    setAll();

    // Case `via_size/defaults`.
    expect(resultOf(screen, 'Resistance:')).toBe('0.00230814');
    expect(resultOf(screen, 'Voltage drop:')).toBe('0.00230814');
    expect(resultOf(screen, 'Power loss:')).toBe('0.00230814');
    expect(resultOf(screen, 'Thermal resistance:')).toBe('83.2937');
    expect(resultOf(screen, 'Estimated ampacity:')).toBe('2.9993');
    expect(resultOf(screen, 'Capacitance:')).toBe('0.599508');
    expect(resultOf(screen, 'Rise time degradation:')).toBe('32.9729');
    expect(resultOf(screen, 'Inductance:')).toBe('1.20723');
    expect(resultOf(screen, 'Reactance:')).toBe('3.79262');
  });

  it('reading the hole diameter as mil leaves the 0.4 alone and moves the results', () => {
    render(<PanelViaSize />);
    setAll();

    const holeRow = textbox(/^Finished hole diameter \(D\)/).closest('label');
    pickUnit(within(holeRow as HTMLElement).getByRole('button'), 'mil');

    // Case `via_size/hole_unit_mil`. Capacitance and rise-time degradation do
    // NOT move: KiCad computes both from the CLEARANCE and PAD diameters, which
    // this selector does not touch.
    expect(fieldText(textbox(/^Finished hole diameter \(D\)/))).toBe('0.4');
    expect(resultOf(screen, 'Resistance:')).toBe('0.022233');
    expect(resultOf(screen, 'Thermal resistance:')).toBe('802.32');
    expect(resultOf(screen, 'Estimated ampacity:')).toBe('0.580513');
    expect(resultOf(screen, 'Capacitance:')).toBe('0.599508');
    expect(resultOf(screen, 'Rise time degradation:')).toBe('32.9729');
    expect(resultOf(screen, 'Inductance:')).toBe('2.38259');
    expect(resultOf(screen, 'Reactance:')).toBe('7.48513');
  });

  it('50 Ω typed as 0.05 kΩ is the same via', () => {
    render(<PanelViaSize />);
    setAll();

    const z0Row = textbox(/^Z0/).closest('label');
    pickUnit(within(z0Row as HTMLElement).getByRole('button'), 'kΩ');
    type(textbox(/^Z0/), '0.05');

    // Case `via_size/z0_kohm`.
    expect(resultOf(screen, 'Rise time degradation:')).toBe('32.9729');
    expect(resultOf(screen, 'Inductance:')).toBe('1.20723');
    expect(resultOf(screen, 'Reactance:')).toBe('3.79262');
  });
});

describe('Fusing Current, end to end against pcb_calculator', () => {
  /** The four radios have no accessible name; index is the only handle. */
  const solveFor = (i: number): void => {
    fireEvent.click(screen.getAllByRole('radio')[i] as HTMLElement);
  };
  const calculate = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
  };

  it('solves each of the four unknowns to KiCad’s printf("%f") strings', () => {
    render(<PanelFusingCurrent />);
    type(afterLabel('Ambient temperature:'), '25');
    type(afterLabel('Melting point:'), '1084');
    type(afterLabel('Track width:'), '0.100000');
    type(afterLabel('Track thickness:'), '0.035000');
    type(afterLabel('Current:'), '10.000000');
    type(afterLabel('Time to fuse:'), '0.010000');

    // This panel is the one place KiCad uses %f rather than %g, which is why
    // every field reads 0.035000 and not 0.035. Cases
    // `fusing_current/solve_{width,thickness,current,time}`, run in this order
    // exactly as the harness did.
    solveFor(0);
    calculate();
    expect(fieldText(afterLabel('Track width:'))).toBe('0.089133');

    solveFor(1);
    calculate();
    expect(fieldText(afterLabel('Track thickness:'))).toBe('0.035000');

    solveFor(2);
    calculate();
    expect(fieldText(afterLabel('Current:'))).toBe('10.000029');

    solveFor(3);
    calculate();
    expect(fieldText(afterLabel('Time to fuse:'))).toBe('0.010000');
  });

  it('a thickness given in oz/ft² reaches the solver', () => {
    render(<PanelFusingCurrent />);
    type(afterLabel('Ambient temperature:'), '25');
    type(afterLabel('Melting point:'), '1084');
    type(afterLabel('Track width:'), '0.089133');
    type(afterLabel('Time to fuse:'), '0.010000');

    solveFor(2);
    pickUnit(comboAfter('Track thickness:'), 'oz/ft²');
    type(afterLabel('Track thickness:'), '1');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    // Case `fusing_current/solve_current_1oz`. 1 oz/ft² is 34.79 µm, a hair
    // under the 35 µm above, so the fusing current drops just below 10 A.
    expect(fieldText(afterLabel('Current:'))).toBe('9.828600');
  });
});

describe('Cable Size, end to end against pcb_calculator', () => {
  it('a 1 mm conductor carrying 1 A over 100 cm', () => {
    render(<PanelCableSize />);
    type(afterLabel('Diameter:'), '1');
    type(afterLabel('Conductor resistivity:'), '1.72e-08');
    type(afterLabel('Temperature Coefficient:'), '3.93e-3');
    type(afterLabel('Cable temperature:'), '20');
    type(afterLabel('Current:'), '1');
    type(afterLabel('Length:'), '100');

    // Case `cable_size/d1mm_20C_1A_100cm`.
    expect(fieldText(afterLabel('Area:'))).toBe('0.785398');
    expect(fieldText(afterLabel('Linear resistance:'))).toBe('0.0218997');
    expect(fieldText(afterLabel('Frequency for 100% skin depth:'))).toBe('1.74272e-05');
    expect(fieldText(afterLabel('Ampacity:'))).toBe('2.35619');
    expect(fieldText(afterLabel('Resistance DC:'))).toBe('0.0218997');
    expect(fieldText(afterLabel('Voltage drop:'))).toBe('21.8997');
    expect(fieldText(afterLabel('Dissipated power:'))).toBe('21.8997');
  });

  it('its unit selectors CONVERT, unlike Track Width’s', () => {
    render(<PanelCableSize />);
    type(afterLabel('Diameter:'), '1');
    type(afterLabel('Cable temperature:'), '20');
    type(afterLabel('Current:'), '1');
    type(afterLabel('Length:'), '100');

    pickUnit(comboAfter('Linear resistance:'), 'Ω/km');
    pickUnit(comboAfter('Frequency for 100% skin depth:'), 'Hz');
    pickUnit(comboAfter('Voltage drop:'), 'V');
    pickUnit(comboAfter('Dissipated power:'), 'W');

    // KiCad's PANEL_CABLE_SIZE really does rewrite the entries here - every row
    // is a LINKED field holding one quantity, so the displayed number follows
    // the unit. That is the OPPOSITE of Via Size and Track Width above, and the
    // difference is upstream's, not ours. Case `cable_size/units_switched`.
    expect(fieldText(afterLabel('Linear resistance:'))).toBe('21.8997');
    expect(fieldText(afterLabel('Frequency for 100% skin depth:'))).toBe('17427.2');
    expect(fieldText(afterLabel('Resistance DC:'))).toBe('0.0218997');
    expect(fieldText(afterLabel('Voltage drop:'))).toBe('0.0218997');
    expect(fieldText(afterLabel('Dissipated power:'))).toBe('0.0218997');
  });

  it('picking AWG12 fills the diameter and everything downstream', () => {
    render(<PanelCableSize />);
    type(afterLabel('Cable temperature:'), '20');
    type(afterLabel('Current:'), '1');
    type(afterLabel('Length:'), '100');

    pickUnit(comboAfter('Standard Size:'), 'AWG12');

    // Case `cable_size/AWG12`.
    expect(fieldText(afterLabel('Diameter:'))).toBe('2.05232');
    expect(fieldText(afterLabel('Area:'))).toBe('3.30811');
    expect(fieldText(afterLabel('Linear resistance:'))).toBe('0.00519934');
    expect(fieldText(afterLabel('Frequency for 100% skin depth:'))).toBe('4.13751e-06');
    expect(fieldText(afterLabel('Ampacity:'))).toBe('9.92433');
    expect(fieldText(afterLabel('Resistance DC:'))).toBe('0.00519934');
    expect(fieldText(afterLabel('Voltage drop:'))).toBe('5.19934');
    expect(fieldText(afterLabel('Dissipated power:'))).toBe('5.19934');
  });
});

describe('Electrical Spacing, end to end against pcb_calculator', () => {
  /** The IPC-2221 table: row label -> the seven B1..A7 cells. */
  const ipcRow = (label: string): string[] => {
    const cell = screen.getByText(label);
    const row = cell.closest('tr');
    return Array.from(row?.querySelectorAll('td') ?? []).map((td) => td.textContent ?? '');
  };

  it('shows the IPC 2221 table in mm exactly as KiCad prints it', () => {
    render(<PanelElectricalSpacing />);

    // Read off the real window at Unit = mm, "Voltage > 500 V" = 500.
    // qa/probes/pcb_calculator_oracle/es_ipc_mm_500.png.
    expect(ipcRow('0 .. 15 V')).toEqual(['0.05', '0.1', '0.1', '0.05', '0.13', '0.13', '0.13']);
    expect(ipcRow('16 .. 30 V')).toEqual(['0.05', '0.1', '0.1', '0.05', '0.13', '0.25', '0.13']);
    expect(ipcRow('51 .. 100 V')).toEqual(['0.1', '0.6', '1.5', '0.13', '0.13', '0.5', '0.13']);
    expect(ipcRow('251 .. 300 V')).toEqual(['0.2', '1.25', '12.5', '0.4', '0.4', '0.8', '0.8']);
    expect(ipcRow('301 .. 500 V')).toEqual(['0.25', '2.5', '12.5', '0.8', '0.8', '1.5', '0.8']);
    expect(ipcRow('> 500 V')).toEqual(['0.25', '2.5', '12.5', '0.8', '0.8', '1.5', '0.8']);
  });

  it('names the seven classes exactly as the real panel does', () => {
    const { container } = render(<PanelElectricalSpacing />);

    // This block is what settles the number of columns and their identity, and
    // it is the one thing a row-value check cannot: a table with an extra `B5`
    // still matches on the four columns before it. Read verbatim off the real
    // window's `wxStaticText` over AT-SPI - the ids run B1..B4 then A5..A7, and
    // "over 3050 m" carries no "or a vacuum".
    expect(container.querySelector('.es-ipc-help')?.textContent).toBe(
      [
        '*  B1 - Internal Conductors',
        '*  B2 - External Conductors, uncoated, sea level to 3050 m',
        '*  B3 - External Conductors, uncoated, over 3050 m',
        '*  B4 - External Conductors, with permanent polymer coating (any elevation)',
        '*  A5 - External Conductors, with conformal coating over assembly (any elevation)',
        '*  A6 - External Component lead/termination, uncoated',
        '*  A7 - External Component lead termination, with conformal coating (any elevation)',
      ].join('\n'),
    );
    // And the header row itself, which is where an eighth class would show.
    const head = container.querySelectorAll('table tr')[0];
    expect(Array.from(head?.children ?? []).map((c) => c.textContent)).toEqual([
      '',
      'B1',
      'B2',
      'B3',
      'B4',
      'A5',
      'A6',
      'A7',
    ]);
  });

  it('the same table in mil', () => {
    render(<PanelElectricalSpacing />);
    pickUnit(screen.getByRole('button', { name: 'Unit' }), 'mil');

    // es_ipc_mil_500.png. Six significant figures, %g style, as everywhere else.
    expect(ipcRow('0 .. 15 V')).toEqual([
      '1.9685',
      '3.93701',
      '3.93701',
      '1.9685',
      '5.11811',
      '5.11811',
      '5.11811',
    ]);
    expect(ipcRow('301 .. 500 V')).toEqual([
      '9.84252',
      '98.4252',
      '492.126',
      '31.4961',
      '31.4961',
      '59.0551',
      '31.4961',
    ]);
  });

  it('typing 1000 V and pressing Update Values extrapolates the last row', () => {
    render(<PanelElectricalSpacing />);
    type(screen.getByRole('textbox'), '1000');
    fireEvent.click(screen.getByRole('button', { name: 'Update Values' }));

    // es_ipc_mm_1000.png. Everything above the last row is a fixed IPC table
    // and must not move.
    expect(ipcRow('301 .. 500 V')).toEqual(['0.25', '2.5', '12.5', '0.8', '0.8', '1.5', '0.8']);
    expect(ipcRow('> 500 V')).toEqual(['1.5', '5', '25', '2.325', '2.325', '3.025', '2.325']);
  });

  it('clamps a voltage below 500 back up to 500, writing it into the field', () => {
    render(<PanelElectricalSpacing />);
    type(screen.getByRole('textbox'), '100');
    fireEvent.click(screen.getByRole('button', { name: 'Update Values' }));

    // Measured on the real panel: the entry itself is rewritten to "500".
    expect(fieldText(screen.getByRole('textbox'))).toBe('500');
    expect(ipcRow('> 500 V')).toEqual(['0.25', '2.5', '12.5', '0.8', '0.8', '1.5', '0.8']);
  });
});
