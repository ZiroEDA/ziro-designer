// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Netlist export (NETLIST_EXPORTER_XML version "E" and NETLIST_EXPORTER_ORCADPCB2):
 * two output pins wired together must land on one net with both nodes, and the
 * component/footprint sections must reflect the placed symbols.
 */
import {
  GENERATOR,
  GENERATOR_APPLICATION,
  GENERATOR_VERSION,
} from '@ziroeda/common/src/generator.js';
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import {
  netlistKicadXml,
  netlistOrcadPcb2,
  netlistPads,
  netlistCadstar,
  generateNetlist,
} from '@ziroeda/eeschema/src/exporters/netlist.js';

// A 2-pin resistor-like part and a wire joining R1 pin 2 to R2 pin 1.
const LIB = `(symbol "Device:R" (pin_names (offset 0))
  (property "Reference" "R" (at 0 0 0))
  (property "Value" "R" (at 0 0 0))
  (property "Footprint" "" (at 0 0 0))
  (symbol "R_1_1"
    (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))
    (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1 1)))) (number "2" (effects (font (size 1 1)))))))`;

const place = (ref: string, x: number, y: number, uuid: string): string =>
  `(symbol (lib_id "Device:R") (at ${x} ${y} 0) (unit 1)
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "1k" (at ${x} ${y} 0))
    (property "Footprint" "Resistor_SMD:R_0603" (at ${x} ${y} 0))
    (uuid "${uuid}"))`;

// After the library +Y-up→down inversion, R1's pin 2 connection point sits at
// y=103.81 and R2's pin 1 at y=106.19. A wire whose endpoints land exactly on
// those pins joins them onto one net (a pin only connects at a wire endpoint).
const doc = readSchematic(
  parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB})
    ${place('R1', 100, 100, 'r1')} ${place('R2', 100, 110, 'r2')}
    (wire (pts (xy 100 103.81) (xy 100 106.19)) (uuid "w1")))`),
);
const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

describe('netlistKicadXml', () => {
  const xml = netlistKicadXml(doc, libById, { source: 'test.kicad_sch' });

  it('emits the export root, components, and both refs', () => {
    expect(xml).toContain('<export version="E">');
    expect(xml).toContain('<comp ref="R1">');
    expect(xml).toContain('<comp ref="R2">');
    expect(xml).toContain('<footprint>Resistor_SMD:R_0603</footprint>');
  });

  it('joins the two wired pins onto one net with both nodes', () => {
    // Find the <net ...> block that carries R1's pin 2.
    const netMatch = [...xml.matchAll(/<net [^>]*>[\s\S]*?<\/net>/g)].find(
      (m) => m[0].includes('ref="R1"') && m[0].includes('pin="2"'),
    );
    expect(netMatch).toBeDefined();
    expect(netMatch![0]).toContain('ref="R2"');
    expect(netMatch![0]).toContain('pin="1"');
  });

  it('lists the lib part with its pins', () => {
    expect(xml).toContain('<libpart lib="Device" part="R">');
    expect(xml).toMatch(/<pin num="1"/);
    expect(xml).toMatch(/<pin num="2"/);
  });
});

describe('netlistOrcadPcb2', () => {
  const net = netlistOrcadPcb2(doc, libById, { source: 'test.kicad_sch' });

  it('writes each symbol with its footprint, ref and value', () => {
    expect(net.startsWith(`( { ${GENERATOR_APPLICATION} netlist created`)).toBe(true);
    expect(net).toContain('Resistor_SMD:R_0603  R1 1k');
    expect(net).toContain('Resistor_SMD:R_0603  R2 1k');
    expect(net.trimEnd().endsWith('*')).toBe(true);
  });
});

/**
 * The PADS-PCB and CadStar netlists (NETLIST_EXPORTER_PADS /
 * NETLIST_EXPORTER_CADSTAR). Both are plain text with a fixed section order, so
 * the shape of the output is the thing to pin — along with the two ordering
 * rules they share, which exist "to ensure file stability for version control
 * and QA comparisons".
 */
/**
 * A part with `n` pins chained onto one net, for the line-breaking rule.
 *
 * A pin connects only where a wire *ends*, not where one passes through, so the
 * pins are joined by a chain of segments rather than one long wire.
 */
function pinRow(n: number): { doc: ReturnType<typeof readSchematic>; libById: Map<string, any> } {
  const pins = Array.from({ length: n }, (_v, i) => {
    const y = 3.81 - i * 2.54;
    return `(pin passive line (at 0 ${y} 270) (length 0) (name "~") (number "${i + 1}"))`;
  }).join('\n    ');
  const lib = `(symbol "Device:U" (pin_names (offset 0))
    (property "Reference" "U" (at 0 0 0))
    (property "Value" "U" (at 0 0 0))
    (symbol "U_1_1" ${pins}))`;
  // The library's +Y-up geometry is inverted on load, so pin i sits at
  // y = 100 - (3.81 - i*2.54).
  const yOf = (i: number): number => 100 - 3.81 + i * 2.54;
  const wires = Array.from(
    { length: n - 1 },
    (_v, i) => `(wire (pts (xy 0 ${yOf(i)}) (xy 0 ${yOf(i + 1)})) (uuid "wn${i}"))`,
  ).join('\n      ');
  const doc = readSchematic(
    parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${lib})
      (symbol (lib_id "Device:U") (at 0 100 0) (unit 1)
        (property "Reference" "U1" (at 0 100 0))
        (property "Value" "U" (at 0 100 0))
        (property "Footprint" "F" (at 0 100 0))
        (uuid "u1"))
      ${wires})`),
  );
  return { doc, libById: new Map(doc.libSymbols.map((l) => [l.libId, l])) };
}

describe('netlistPads', () => {
  const pads = netlistPads(doc, libById);
  const lines = pads.split('\n');

  it('emits the three sections in order', () => {
    expect(lines[0]).toBe('*PADS-PCB*');
    expect(lines[1]).toBe('*PART*');
    expect(lines).toContain('*NET*');
    expect(lines).toContain('*END*');
    expect(lines.indexOf('*NET*')).toBeGreaterThan(1);
    expect(lines.indexOf('*END*')).toBeGreaterThan(lines.indexOf('*NET*'));
  });

  it('pads each reference to 16 columns in the part list', () => {
    const part = lines.find((l) => l.startsWith('R1'))!;
    expect(part).toBe(`${'R1'.padEnd(16)} Resistor_SMD:R_0603`);
  });

  it('writes the wired net with both of its pins', () => {
    const at = lines.findIndex((l) => l.startsWith('*SIGNAL*'));
    expect(at).toBeGreaterThan(-1);
    // R1.2 and R2.1 are the wired pair, in reference order. The trailing space
    // is upstream's: it prints a separator after every connection and only
    // swaps it for a newline on the break, so a short line keeps the space.
    expect(lines[at + 1]).toBe('R1.2 R2.1 ');
  });

  it('breaks the connection list where upstream breaks it', () => {
    // `cnt != 0 && cnt % 6 == 0` breaks *after the seventh* and every sixth
    // after that, and the final newline then leaves a blank line when the count
    // lands exactly on a break. Both are quirks worth keeping: a diff against a
    // KiCad-written file should be empty.
    const many = pinRow(9);
    const out = netlistPads(many.doc, many.libById).split('\n');
    const at = out.findIndex((l) => l.startsWith('*SIGNAL*'));
    expect(out[at + 1]!.split(' ').filter(Boolean)).toHaveLength(7);
    expect(out[at + 2]!).toBe('U1.8 U1.9 ');
  });

  it('leaves out a net that reaches only one pin', () => {
    // R1.1 and R2.2 are unconnected, so neither gets a *SIGNAL* of its own.
    const signals = lines.filter((l) => l.startsWith('*SIGNAL*'));
    expect(signals).toHaveLength(1);
  });

  it('falls back to the value when a symbol has no footprint', () => {
    const noFp = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB})
        (symbol (lib_id "Device:R") (at 10 10 0) (unit 1)
          (property "Reference" "R9" (at 10 10 0))
          (property "Value" "4k7 ohm" (at 10 10 0))
          (uuid "r9")))`),
    );
    const out = netlistPads(noFp, new Map(noFp.libSymbols.map((l) => [l.libId, l])));
    // The value stands in for the footprint, with spaces turned to underscores.
    expect(out).toContain(`${'R9'.padEnd(16)} 4k7_ohm`);
  });
});

describe('netlistCadstar', () => {
  const cad = netlistCadstar(doc, libById, {
    source: 'test.kicad_sch',
    date: '2026-01-01T00:00:00Z',
  });
  const lines = cad.split('\n');

  it('emits the header block', () => {
    expect(lines[0]).toBe('.HEA');
    expect(lines[1]).toBe('.TIM 2026-01-01T00:00:00Z');
    expect(lines[2]).toMatch(/^\.APP "/);
    expect(lines[3]).toBe('.TYP FULL');
  });

  it('writes one .ADD_COM per symbol, value then footprint', () => {
    expect(cad).toContain('.ADD_COM     R1     "1k"     "Resistor_SMD:R_0603"');
    expect(cad).toContain('.ADD_COM     R2     "1k"     "Resistor_SMD:R_0603"');
  });

  it('names the net on .ADD_TER and continues on .TER', () => {
    const addTer = lines.findIndex((l) => l.startsWith('.ADD_TER'));
    expect(addTer).toBeGreaterThan(-1);
    // The first pin is held back and printed with the net name once a second
    // one turns up; the second goes on the .TER line under it.
    expect(lines[addTer]).toMatch(/^\.ADD_TER {3}R1 {3}2 {5}"/);
    expect(lines[addTer + 1]).toBe('.TER       R2   1');
  });

  it('emits nothing at all for a net with one pin', () => {
    // Upstream drops them by never flushing the held-back first pin, rather
    // than by testing the count.
    expect(lines.filter((l) => l.startsWith('.ADD_TER'))).toHaveLength(1);
  });

  it('closes with .END', () => {
    expect(lines.filter((l) => l !== '').at(-1)).toBe('.END');
  });

  it('uses $noname when a symbol has no footprint', () => {
    const noFp = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB})
        (symbol (lib_id "Device:R") (at 10 10 0) (unit 1)
          (property "Reference" "R9" (at 10 10 0))
          (property "Value" "4k7" (at 10 10 0))
          (uuid "r9")))`),
    );
    const out = netlistCadstar(noFp, new Map(noFp.libSymbols.map((l) => [l.libId, l])), {
      source: 's',
    });
    expect(out).toContain('"$noname"');
  });
});

describe('generateNetlist dispatch', () => {
  it('routes each format to its exporter', () => {
    const meta = { source: 'test.kicad_sch' };
    expect(generateNetlist('pads', doc, libById, meta)).toContain('*PADS-PCB*');
    expect(generateNetlist('cadstar', doc, libById, meta)).toContain('.HEA');
    expect(generateNetlist('kicadxml', doc, libById, meta)).toContain('<export');
    expect(generateNetlist('orcadpcb2', doc, libById, meta)).toContain('( {');
  });
});
