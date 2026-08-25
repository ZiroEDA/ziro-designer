// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * End-to-end parity for the calculator's "High Speed" pages - Wavelength, RF
 * Attenuators and Transmission Lines - against REAL KiCad 10.0.5.
 *
 * Same rule as `calc_e2e_power.test.tsx`: every expected string below was
 * printed by the installed `/usr/bin/pcb_calculator` and read out of its
 * widgets over AT-SPI. See `qa/probes/pcb_calculator_oracle/`; the case names
 * in the comments are the keys in `kicad_answers_1/3/4/5.json`.
 *
 * Transmission Lines is where the sharpest of this week's bugs lived: the
 * Stripline panel drew an `a:` field, took the user's number and never passed
 * it to the engine. The `a` sweep below is the case that catches it - three
 * values of `a` on one geometry give three different characteristic impedances
 * in KiCad, so a panel that drops `a` prints the same number three times.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PanelWavelength } from '@ziroeda/designer/src/editors/calculator/panels/panel_wavelength.js';
import { PanelRfAttenuators } from '@ziroeda/designer/src/editors/calculator/panels/panel_rf_attenuators.js';
import { PanelTransline } from '@ziroeda/designer/src/editors/calculator/panels/panel_transline.js';

afterEach(() => cleanup());

const type = (el: Element | null, v: string): void => {
  fireEvent.change(el as HTMLElement, { target: { value: v } });
};

const pickUnit = (button: Element | null, option: string): void => {
  fireEvent.click(button as HTMLElement);
  fireEvent.mouseDown(screen.getByRole('option', { name: option }));
};

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

const comboAfter = (label: string): HTMLElement => {
  let n = screen.getByText(label).nextElementSibling;
  while (n) {
    if (n.tagName === 'BUTTON') return n as HTMLElement;
    n = n.nextElementSibling;
  }
  throw new Error(`no combo after ${label}`);
};

const fieldText = (el: Element): string => (el as HTMLInputElement).value;
const textbox = (name: RegExp): HTMLInputElement =>
  screen.getByRole('textbox', { name }) as HTMLInputElement;

describe('Wavelength, end to end against pcb_calculator', () => {
  function setSource(): void {
    type(afterLabel('Frequency:'), '1');
    type(afterLabel('er:'), '4.5');
    type(afterLabel('mur:'), '1');
  }

  it('1 GHz through εr 4.5 gives KiCad’s period, wavelengths and speed', () => {
    render(<PanelWavelength />);
    setSource();

    // Case `wavelength/1GHz_er4.5`.
    expect(fieldText(afterLabel('Period:'))).toBe('1');
    expect(fieldText(afterLabel('Wavelength in vacuum:'))).toBe('29.9792');
    expect(fieldText(afterLabel('Wavelength in medium:'))).toBe('14.1324');
    expect(fieldText(afterLabel('Speed in medium:'))).toBe('1.41324e+08');
  });

  it('mi/h prints 87814.6, upstream’s mile-in-metres and all', () => {
    render(<PanelWavelength />);
    setSource();
    pickUnit(comboAfter('Speed in medium:'), 'mi/h');

    // 1.41324e8 m/s is 3.16e8 mi/h. KiCad prints 87814.6, which is
    // 1.41324e8 / 1609.344: upstream divides by the mile in METRES and never
    // multiplies by 3600, so its "mi/h" is really miles per second. We mirror
    // the bug on purpose - the goal is that a user cannot tell the two apart -
    // and this is the case that pins the mirroring rather than letting someone
    // "fix" it. Case `wavelength/speed_mi_per_h`.
    expect(fieldText(afterLabel('Speed in medium:'))).toBe('87814.6');
  });

  it('its length selectors CONVERT the value they sit beside', () => {
    render(<PanelWavelength />);
    setSource();
    pickUnit(comboAfter('Wavelength in vacuum:'), 'inch');
    pickUnit(comboAfter('Wavelength in medium:'), 'feet');

    // Case `wavelength/lambda_inch_feet`. Note this is the opposite of Track
    // Width and Via Size, where the number stands and the quantity changes.
    // Both behaviours are KiCad's, on different panels.
    expect(fieldText(afterLabel('Wavelength in vacuum:'))).toBe('11.8029');
    expect(fieldText(afterLabel('Wavelength in medium:'))).toBe('0.46366');
  });

  it('typing a period back-solves the frequency', () => {
    render(<PanelWavelength />);
    setSource();
    pickUnit(comboAfter('Period:'), 'ps');
    type(afterLabel('Period:'), '500');

    // Case `wavelength/period_500ps_drives_freq`.
    expect(fieldText(afterLabel('Frequency:'))).toBe('2');
    expect(fieldText(afterLabel('Wavelength in vacuum:'))).toBe('14.9896');
    expect(fieldText(afterLabel('Wavelength in medium:'))).toBe('7.06618');
    expect(fieldText(afterLabel('Speed in medium:'))).toBe('1.41324e+08');
  });
});

describe('RF Attenuators, end to end against pcb_calculator', () => {
  const calculate = (): void => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Calculate' })[0] as HTMLElement);
  };
  const resistors = (): string[] => [
    fieldText(textbox(/^R1/)),
    fieldText(textbox(/^R2/)),
    fieldText(textbox(/^R3/)),
  ];

  function setup(topology: string, a: string, zin?: string, zout?: string): void {
    fireEvent.click(screen.getByLabelText(topology));
    type(textbox(/^Attenuation \(a\)/), a);
    if (zin !== undefined) type(textbox(/^Zin/), zin);
    if (zout !== undefined) type(textbox(/^Zout/), zout);
    calculate();
  }

  it('6 dB at 50 Ω, all four topologies', () => {
    render(<PanelRfAttenuators />);

    setup('Pi', '6', '50', '50');
    expect(resistors()).toEqual(['150.476', '37.3519', '150.476']); // rf_attenuators/Pi_a6_50_50

    setup('Tee', '6', '50', '50');
    expect(resistors()).toEqual(['16.6139', '66.931', '16.6139']); // .../Tee_a6_50_50

    // A bridged tee has only two resistors, so KiCad leaves R3 blank rather
    // than printing 0. Case `rf_attenuators/Bridged_tee_a6_50_50`.
    setup('Bridged tee', '6', '50', '50');
    expect(resistors()).toEqual(['49.7631', '50.238', '']);
  });

  it('the resistive splitter ignores the attenuation box entirely', () => {
    render(<PanelRfAttenuators />);
    fireEvent.click(screen.getByLabelText('Resistive splitter'));

    // KiCad disables Attenuation and blanks Zin for this topology: a splitter's
    // 6 dB and its Zin are fixed by Zout, so there is nothing to type.
    expect(textbox(/^Attenuation \(a\)/).disabled).toBe(true);
    expect(fieldText(textbox(/^Zin/))).toBe('');

    calculate();
    // Case `rf_attenuators/Resistive_splitter_a6_50_50`.
    expect(resistors()).toEqual(['16.6667', '16.6667', '16.6667']);
  });

  it('an asymmetric tee, 10 dB from 75 Ω to 50 Ω', () => {
    render(<PanelRfAttenuators />);
    setup('Tee', '10', '75', '50');

    // Case `rf_attenuators/Tee_a10_75_50`.
    expect(resistors()).toEqual(['48.6335', '43.0331', '18.078']);
  });

  it('an attenuation below what the topology allows prints -- in all three', () => {
    render(<PanelRfAttenuators />);
    setup('Tee', '0.5', '50', '75');

    // 0.5 dB cannot match 50 Ω to 75 Ω. Case `rf_attenuators/tee_a0.5_too_low`.
    expect(resistors()).toEqual(['--', '--', '--']);
  });
});

describe('Transmission Lines, end to end against pcb_calculator', () => {
  const analyze = (): void => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Analyze' })[0] as HTMLElement);
  };
  const synthesize = (): void => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Synthesize' })[0] as HTMLElement);
  };
  /** A `.tl-result-row` prints "<number> <unit>" in the span after its label. */
  const tl = (label: string): string =>
    screen.getByText(label).nextElementSibling?.textContent ?? '<missing>';
  const unitCombo = (name: string): HTMLElement => screen.getByRole('button', { name });

  it('a microstrip on the shipped defaults', () => {
    render(<PanelTransline />);
    analyze();

    // Case `transline/MicroStrip/analyze_defaults`: εr 4.5, tan δ 0.02,
    // ρ 1.72e-08, H 0.2 mm, H(top) 1e+20, T 0.035, roughness 0, both μr 1,
    // 1 GHz, W 0.2 mm, L 50 mm.
    expect(fieldText(textbox(/^Z0:/))).toBe('66.9548');
    expect(fieldText(textbox(/^Ang_l:/))).toBe('1.79748');
    // KiCad appends " " + unit even when the unit is empty, so the effective
    // permittivity really does carry a trailing space.
    expect(tl('Effective εr:')).toBe('2.94219 ');
    expect(tl('Unit propagation delay:')).toBe('57.3673 ps/cm');
    expect(tl('Conductor losses:')).toBe('0.158494 dB');
    expect(tl('Dielectric losses:')).toBe('0.132482 dB');
    expect(tl('Skin depth:')).toBe('2.0873 µm');
  });

  /** Everything the Stripline page reads, so nothing carries over. */
  function stripline(a: string): void {
    fireEvent.click(screen.getByLabelText('Stripline'));
    type(textbox(/^εr:/), '4.5');
    type(textbox(/^tan δ:/), '0.02');
    type(textbox(/^ρ:/), '1.72e-08');
    type(textbox(/^H:/), '1.6');
    type(textbox(/^a:/), a);
    type(textbox(/^T:/), '0.035');
    type(textbox(/^Frequency:/), '1');
    type(textbox(/^W:/), '0.3');
    type(textbox(/^L:/), '50');
    analyze();
  }

  it('the Stripline `a` field reaches the engine', () => {
    render(<PanelTransline />);

    // THE regression case. `a` is the distance from the strip to the far
    // ground plane; on this geometry KiCad gives three different impedances for
    // three values of it. A panel that displays `a` and drops it - which is
    // what we shipped - prints one number three times, and every engine test
    // still passes, because the engine was never the thing that was broken.
    // Cases `transline/StripLine/H1.6_W0.3_a{0.8,0.4,0.2}`.
    stripline('0.8');
    expect(fieldText(textbox(/^Z0:/))).toBe('68.1537');
    expect(tl('Conductor losses:')).toBe('0.130474 dB');

    stripline('0.4');
    expect(fieldText(textbox(/^Z0:/))).toBe('61.4897');
    expect(tl('Conductor losses:')).toBe('0.142615 dB');

    stripline('0.2');
    expect(fieldText(textbox(/^Z0:/))).toBe('48.3171');
    expect(tl('Conductor losses:')).toBe('0.193666 dB');

    // The three share everything `a` does not touch.
    expect(tl('Effective εr:')).toBe('4.5 ');
    expect(tl('Unit propagation delay:')).toBe('70.9472 ps/cm');
    expect(tl('Dielectric losses:')).toBe('0.193086 dB');
  });

  /** Set every microstrip input explicitly, in the units named. */
  function microstrip(o: {
    H: string;
    Hunit: string;
    W: string;
    Wunit: string;
    L: string;
    f: string;
    funit: string;
  }): void {
    fireEvent.click(screen.getByLabelText('Microstrip Line'));
    type(textbox(/^εr:/), '4.6');
    type(textbox(/^tan δ:/), '0.02');
    type(textbox(/^ρ:/), '1.72e-08');
    pickUnit(unitCombo('H unit'), o.Hunit);
    type(textbox(/^H:/), o.H);
    pickUnit(unitCombo('H(top) unit'), 'mm');
    type(textbox(/^H\(top\):/), '1e+20');
    pickUnit(unitCombo('T unit'), 'mm');
    type(textbox(/^T:/), '0.035');
    pickUnit(unitCombo('Roughness unit'), 'mm');
    type(textbox(/^Roughness:/), '0');
    type(textbox(/^μr \(substrate\):/), '1');
    type(textbox(/^μr \(conductor\):/), '1');
    pickUnit(unitCombo('Frequency unit'), o.funit);
    type(textbox(/^Frequency:/), o.f);
    pickUnit(unitCombo('W unit'), o.Wunit);
    type(textbox(/^W:/), o.W);
    pickUnit(unitCombo('L unit'), 'mm');
    type(textbox(/^L:/), o.L);
    analyze();
  }

  const MM_3_H16 = { H: '1.6', Hunit: 'mm', W: '3.0', Wunit: 'mm', L: '50' };

  it('a 3 mm trace on 1.6 mm FR4', () => {
    render(<PanelTransline />);
    microstrip({ ...MM_3_H16, f: '1', funit: 'GHz' });

    // Case `transline/MicroStrip/W3_H1.6_1GHz`.
    expect(fieldText(textbox(/^Z0:/))).toBe('49.2446');
    expect(fieldText(textbox(/^Ang_l:/))).toBe('1.9435');
    expect(tl('Effective εr:')).toBe('3.43962 ');
    expect(tl('Unit propagation delay:')).toBe('62.0274 ps/cm');
    expect(tl('Conductor losses:')).toBe('0.015526 dB');
    expect(tl('Dielectric losses:')).toBe('0.152295 dB');
  });

  it('1000 MHz is the same line as 1 GHz', () => {
    render(<PanelTransline />);
    microstrip({ ...MM_3_H16, f: '1000', funit: 'MHz' });

    // Case `transline/MicroStrip/W3_H1.6_1000MHz` - identical to the above, so
    // the frequency selector's scale is what is under test, not the maths.
    expect(fieldText(textbox(/^Z0:/))).toBe('49.2446');
    expect(fieldText(textbox(/^Ang_l:/))).toBe('1.9435');
    expect(tl('Conductor losses:')).toBe('0.015526 dB');
  });

  it('H read as mil is a different board, and the 1.6 is left alone', () => {
    render(<PanelTransline />);
    microstrip({ H: '1.6', Hunit: 'mil', W: '3.0', Wunit: 'mm', L: '50', f: '1', funit: 'GHz' });

    // Case `transline/MicroStrip/W3_H1.6mil`. Like Via Size and Track Width,
    // a transline UNIT_SELECTOR recalculates and does not convert.
    expect(fieldText(textbox(/^H:/))).toBe('1.6');
    expect(fieldText(textbox(/^Z0:/))).toBe('2.29688');
    expect(tl('Effective εr:')).toBe('4.34751 ');
    expect(tl('Conductor losses:')).toBe('0.490892 dB');
  });

  it('118.11 mil of width is the same 3 mm trace', () => {
    render(<PanelTransline />);
    microstrip({ H: '1.6', Hunit: 'mm', W: '118.11', Wunit: 'mil', L: '50', f: '1', funit: 'GHz' });

    // Case `transline/MicroStrip/W118.11mil_H1.6`. 118.11 mil is 3 mm to five
    // digits, and KiCad's answer differs from the mm case in the sixth.
    expect(fieldText(textbox(/^Z0:/))).toBe('49.2447');
    expect(tl('Conductor losses:')).toBe('0.0155261 dB');
  });

  it('synthesizes a 50 Ω quarter-wave microstrip', () => {
    render(<PanelTransline />);
    microstrip({ ...MM_3_H16, f: '1', funit: 'GHz' });
    pickUnit(unitCombo('Ang_l unit'), 'deg');
    type(textbox(/^Z0:/), '50');
    type(textbox(/^Ang_l:/), '90');
    synthesize();

    // Case `transline/MicroStrip/synth_50ohm_90deg`: KiCad writes the physical
    // parameters back into W and L.
    expect(fieldText(textbox(/^W:/))).toBe('2.92362');
    expect(fieldText(textbox(/^L:/))).toBe('40.4616');
    expect(tl('Effective εr:')).toBe('3.43111 ');
    expect(tl('Unit propagation delay:')).toBe('61.9507 ps/cm');
  });

  it('every other line type analyses to KiCad’s numbers on its own defaults', () => {
    // All eight remaining types, on the parameters the panel opens with, so
    // this also pins that switching type does not reset them to something else.
    // Cases `transline/<type>/analyze_defaults`.
    const cases: {
      radio: string;
      z: [RegExp, string][];
      results: [string, string][];
    }[] = [
      {
        radio: 'Coupled Microstrip Line',
        z: [
          [/^Zeven:/, '81.9558'],
          [/^Zodd:/, '58.0682'],
          [/^Ang_l:/, '1.87532'],
        ],
        results: [
          ['Effective εr (even):', '3.42275 '],
          ['Effective εr (odd):', '2.99648 '],
          ['Differential Impedance (Zd):', '116.255 Ω'],
        ],
      },
      {
        radio: 'Coupled Stripline',
        z: [
          [/^Zeven:/, '23.1736'],
          [/^Zodd:/, '22.6178'],
        ],
        results: [
          ['Effective εr (even):', '4.5 '],
          ['Differential Impedance (Zd):', '45.2356 Ω'],
        ],
      },
      {
        radio: 'Coplanar wave guide',
        z: [[/^Z0:/, '83.2666']],
        results: [
          ['Effective εr:', '2.11148 '],
          ['Unit propagation delay:', '48.5985 ps/cm'],
        ],
      },
      {
        radio: 'Coplanar wave guide w/ ground plane',
        z: [[/^Z0:/, '67.769']],
        results: [
          ['Effective εr:', '2.59877 '],
          ['Unit propagation delay:', '53.9154 ps/cm'],
        ],
      },
      {
        radio: 'Rectangular Waveguide',
        z: [[/^Z0:/, '0']],
        // A 10x5 mm guide at 1 GHz is below cutoff, so KiCad prints a -nan
        // impedance and "none" for both mode lists. Its Ohm here is spelt out.
        results: [
          ['ZF(H10) = Ey / Hx:', '-nan Ohm'],
          ['TE-modes:', 'none'],
          ['TM-modes:', 'none'],
        ],
      },
      {
        radio: 'Coaxial Line',
        z: [[/^Z0:/, '58.7748']],
        results: [
          ['Effective εr:', '4.5 '],
          ['Conductor losses:', '0.0109021 dB'],
          ['TE-modes:', 'H(1,1) H(n,2) H(n,3) H(n,4) H(n,5) H(n,6) H(n,7) H(n,8) H(n,9) '],
        ],
      },
      {
        radio: 'Twisted Pair',
        z: [[/^Z0:/, '242.465']],
        results: [
          ['Effective εr:', '1.875 '],
          ['Conductor losses:', '0.002354 dB'],
          ['Dielectric losses:', '0.124636 dB'],
        ],
      },
    ];

    for (const c of cases) {
      const { unmount } = render(<PanelTransline />);
      fireEvent.click(screen.getByLabelText(c.radio));
      analyze();
      for (const [name, want] of c.z) {
        expect(`${c.radio} ${name}: ${fieldText(textbox(name))}`).toBe(
          `${c.radio} ${name}: ${want}`,
        );
      }
      for (const [label, want] of c.results) {
        expect(`${c.radio} ${label} ${tl(label)}`).toBe(`${c.radio} ${label} ${want}`);
      }
      unmount();
    }
  });

  it('a WR-90 guide above cutoff: Z0 and ZF(H10) are different numbers', () => {
    render(<PanelTransline />);
    fireEvent.click(screen.getByLabelText('Rectangular Waveguide'));
    type(textbox(/^εr:/), '4.5');
    type(textbox(/^tan δ:/), '0.02');
    type(textbox(/^ρ:/), '1.72e-08');
    type(textbox(/^μ\(insulator\):/), '1');
    type(textbox(/^μ\(conductor\):/), '1');
    pickUnit(unitCombo('Frequency unit'), 'GHz');
    type(textbox(/^Frequency:/), '10');
    pickUnit(unitCombo('a unit'), 'mm');
    type(textbox(/^a:/), '22.86');
    pickUnit(unitCombo('b unit'), 'mm');
    type(textbox(/^b:/), '10.16');
    pickUnit(unitCombo('L unit'), 'mm');
    type(textbox(/^L:/), '50');
    analyze();

    // Case `rectwaveguide/WR90_10GHz_er4.5`. The Electrical box shows Z0, the
    // fictive-voltage impedance, which carries a √(μr/εr); the result line
    // shows Z0EH = Ey/Hx, which does not. In εr 4.5 they differ by √4.5, and we
    // used to print the same number in both.
    expect(fieldText(textbox(/^Z0:/))).toBe('186.737');
    expect(fieldText(textbox(/^Ang_l:/))).toBe('21.1411');
    expect(tl('ZF(H10) = Ey / Hx:')).toBe('396.13 Ohm');
    expect(tl('Effective εr:')).toBe('0.904453 ');
    expect(tl('Conductor losses:')).toBe('0.0741937 dB');
    expect(tl('Dielectric losses:')).toBe('2.03028 dB');
    // KiCad strcat()s each mode with a trailing space and never trims.
    expect(tl('TE-modes:')).toBe('H(0,1) H(1,0) H(1,1) H(2,0) H(2,1) H(3,0) ');
    expect(tl('TM-modes:')).toBe('E(1,1) E(2,1) ');
  });

  it('switching line type keeps the substrate you typed', () => {
    render(<PanelTransline />);
    type(textbox(/^εr:/), '3.38');
    fireEvent.click(screen.getByLabelText('Stripline'));
    fireEvent.click(screen.getByLabelText('Microstrip Line'));

    // Measured: KiCad's PANEL_TRANSLINE keeps one TRANSLINE_IDENT per type and
    // does not reset it on a type change. Case `transline/type_switch_keeps_er`.
    expect(fieldText(textbox(/^εr:/))).toBe('3.38');
  });
});
