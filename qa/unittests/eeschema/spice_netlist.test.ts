// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SPICE netlist export, NETLIST_EXPORTER_SPICE + SIM_MODEL::InferSimModel
 * quirks straight from the C++: net-name markup conversion and ground
 * aliases, SI→SPICE value notation, passive/source inference (separator
 * disambiguation, `4u7`-style fraction values, behavioural fallback),
 * directive collection, and the assembled netlist order.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import {
  collectSpiceDirectives,
  convertToSpiceMarkup,
  generateSpiceNetlist,
  inferSimModel,
  toSpice,
} from '@ziroeda/eeschema/src/exporters/spice.js';

describe('convertToSpiceMarkup', () => {
  it('flattens markup and replaces ngspice-hostile characters', () => {
    expect(convertToSpiceMarkup('~{CLK}')).toBe('_CLK'); // '~' + CLK, then ~ → _
    expect(convertToSpiceMarkup('V_{OUT}')).toBe('VOUT'); // subscript = pretty print
    expect(convertToSpiceMarkup('A(1)')).toBe('A_1_');
    expect(convertToSpiceMarkup('D[3]')).toBe('D_3_');
    expect(convertToSpiceMarkup('a b')).toBe('a_b');
  });

  it('applies the SPICE ground aliases', () => {
    expect(convertToSpiceMarkup('/sub/0')).toBe('0');
    expect(convertToSpiceMarkup('/gnd')).toBe('gnd');
    expect(convertToSpiceMarkup('//foo')).toBe('/root/foo');
  });
});

describe('toSpice (SIM_VALUE::ToSpice)', () => {
  it('converts SI mega and micro, passes plain numbers and expressions', () => {
    expect(toSpice('10k')).toBe('10k');
    expect(toSpice('1M')).toBe('1Meg');
    expect(toSpice('4.7µ')).toBe('4.7u');
    expect(toSpice('100')).toBe('100');
    expect(toSpice('V(a)*2')).toBe('V(a)*2');
  });
});

describe('inferSimModel (SIM_MODEL::InferSimModel)', () => {
  const f = (entries: Record<string, string>) => new Map(Object.entries(entries));

  it('infers ideal passives from prefix + value, with units stripped', () => {
    const m = inferSimModel('R', f({ Value: '10kΩ' }), ['1', '2'])!;
    expect(m.deviceType).toBe('R');
    expect(m.modelType).toBe('');
    expect(m.value).toBe('10k');
  });

  it('handles the 4u7-style fraction notation', () => {
    const m = inferSimModel('C', f({ Value: '4u7' }), ['1', '2'])!;
    expect(m.value).toBe('4.7u');
  });

  it('treats 3,300uF as thousands-separated, 3,3 as a decimal', () => {
    expect(inferSimModel('C', f({ Value: '3,300uF' }), ['1', '2'])!.value).toBe('3300u');
    expect(inferSimModel('C', f({ Value: '3,3u' }), ['1', '2'])!.value).toBe('3.3u');
  });

  it('falls back to a behavioural model for non-numeric values', () => {
    const m = inferSimModel('R', f({ Value: 'V(a)/1k' }), ['1', '2'])!;
    expect(m.modelType).toBe('=');
    expect(m.value).toBe('V(a)/1k');
  });

  it('infers DC and AC sources with prefix stripping', () => {
    const dc = inferSimModel('V', f({ Value: '5V' }), ['1', '2'])!;
    expect(dc.modelType).toBe('DC');
    expect(dc.value).toBe('5');
    const ac = inferSimModel('V', f({ Value: 'AC 1' }), ['1', '2'])!;
    expect(ac.value).toBe('');
    expect(ac.ac).toBe('1');
  });

  it('requires exactly two pins and yields nothing for explicit models', () => {
    expect(inferSimModel('R', f({ Value: '10k' }), ['1', '2', '3'])).toBeNull();
    expect(
      inferSimModel('U', f({ Value: 'OPAMP', 'Sim.Library': 'x.lib' }), ['1', '2']),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const LIB = `(lib_symbols
  (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
    (symbol "R_1_1"
      (pin passive line (at 0 2.54 270) (length 0)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 0 -2.54 90) (length 0)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))))))`;

const sym = (ref: string, value: string, x: number, uuid: string): string => `
  (symbol (lib_id "Device:R") (at ${x} 10 90) (unit 1) (uuid "${uuid}")
    (property "Reference" "${ref}" (at 0 0 0))
    (property "Value" "${value}" (at 0 0 0)))`;

const doc = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${LIB} ${body})`));

describe('generateSpiceNetlist', () => {
  it('emits title, item lines with converted net names, and .end', () => {
    const d = doc(`
      ${sym('R1', '10k', 10, 'r1')}
      (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
      (wire (pts (xy 12.54 10) (xy 20 10)) (uuid "wb"))
      (label "IN" (at 0 10 0) (uuid "la"))
      (label "OUT" (at 20 10 0) (uuid "lb"))`);
    const lib = new Map(d.libSymbols.map((l) => [l.libId, l]));
    const { text, errors } = generateSpiceNetlist(d, lib);
    expect(errors).toEqual([]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('.title KiCad schematic');
    // Node names are the connection names, so a local label carries its sheet path.
    expect(text).toContain('R1 /IN /OUT 10k');
    expect(lines[lines.length - 2]).toBe('.end');
  });

  it('names dangling pins like KiCad and writes directives + save options', () => {
    const d = doc(`
      ${sym('R1', '1M', 10, 'r1')}
      (text ".tran 1u 10m" (at 50 50 0) (uuid "t1"))
      (text "just a note" (at 50 60 0) (uuid "t2"))`);
    const lib = new Map(d.libSymbols.map((l) => [l.libId, l]));
    const { text } = generateSpiceNetlist(d, lib, null, {
      saveAllVoltages: true,
      saveAllCurrents: true,
      saveAllDissipations: true,
    });
    // Dangling pins carry their auto net names (Net-(R1-Pad1)), sanitised.
    expect(text).toContain('R1 Net-_R1-Pad1_ Net-_R1-Pad2_ 1Meg');
    expect(text).toContain('.save all');
    expect(text).toContain('.probe alli');
    expect(text).toContain('.probe p(R1)');
    expect(text).toContain('.tran 1u 10m');
    expect(text).not.toContain('just a note');
    // Assembly order: save options and directives precede item lines.
    expect(text.indexOf('.save all')).toBeLessThan(text.indexOf('R1 Net-'));
  });

  it('reports and skips symbols it cannot infer', () => {
    const d = doc(`
      (symbol (lib_id "Device:R") (at 10 10 90) (unit 1) (uuid "u1")
        (property "Reference" "U1" (at 0 0 0))
        (property "Value" "OPAMP" (at 0 0 0))
        (property "Sim.Library" "opamp.lib" (at 0 0 0)))`);
    const lib = new Map(d.libSymbols.map((l) => [l.libId, l]));
    const { text, errors } = generateSpiceNetlist(d, lib);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('U1');
    expect(text).not.toContain('U1');
  });

  it('skips excluded-from-sim symbols and mutual-inductance K lines pass', () => {
    const d = doc(`
      (symbol (lib_id "Device:R") (at 10 10 90) (unit 1) (uuid "r1") (exclude_from_sim yes)
        (property "Reference" "R1" (at 0 0 0))
        (property "Value" "10k" (at 0 0 0)))
      ${sym('R2', '1k', 30, 'r2')}
      (text "K1 L1 L2 0.99" (at 50 50 0) (uuid "t1"))`);
    const lib = new Map(d.libSymbols.map((l) => [l.libId, l]));
    const { text } = generateSpiceNetlist(d, lib);
    expect(text).not.toContain('R1 ');
    expect(text).toContain('R2 ');
    expect(text).toContain('K1 L1 L2 0.99');
  });

  it('suppresses directives entirely when no items netlist (ngspice-segfault guard)', () => {
    const d = doc('(text ".tran 1u 10m" (at 50 50 0) (uuid "t1"))');
    const lib = new Map(d.libSymbols.map((l) => [l.libId, l]));
    expect(generateSpiceNetlist(d, lib).text).toBe('.title KiCad schematic\n.end\n');
  });

  it('collectSpiceDirectives recognises the exact directive token list', () => {
    const d = doc(`
      (text ".MODEL sw SW(Ron=1)" (at 0 0 0) (uuid "t1"))
      (text ".settings nope" (at 0 10 0) (uuid "t2"))`);
    const dirs = collectSpiceDirectives(d);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toContain('.MODEL');
  });
});
