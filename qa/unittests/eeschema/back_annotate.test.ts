// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Update Schematic from PCB, counterpart eeschema/tools/backannotate.cpp:
 * what the board is allowed to change, what it must never overwrite, and how
 * the two halves are matched to each other.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  backAnnotate,
  defaultBackAnnotateOptions,
  type BackAnnotateOptions,
  type PcbFootprintData,
} from '@ziroeda/eeschema/src/tools/back_annotate.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const SCH = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1")))
  (symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (uuid "s-1")
    (property "Reference" "R1" (at 12 9 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 12 11 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0805" (at 10 10 0)
      (effects (font (size 1.27 1.27)) (hide yes)))
    (property "MPN" "RC0805" (at 10 14 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "Device:R") (at 30 10 0) (unit 1) (uuid "s-2") (in_bom no)
    (property "Reference" "R2" (at 32 9 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1k" (at 32 11 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603" (at 30 10 0)
      (effects (font (size 1.27 1.27)) (hide yes)))))`;

const doc = (): Schematic => readSchematic(parse(SCH));

const fp = (over: Partial<PcbFootprintData> = {}): PcbFootprintData => ({
  path: '/s-1',
  reference: 'R1',
  footprint: 'Resistor_SMD:R_0805',
  value: '10k',
  dnp: false,
  excludeFromBom: false,
  excludeFromPosFiles: false,
  ...over,
});

const opts = (over: Partial<BackAnnotateOptions> = {}): BackAnnotateOptions => ({
  ...defaultBackAnnotateOptions(),
  dryRun: false,
  ...over,
});

/** Only R1's footprint, so R2 is the "not on the PCB" case unless said otherwise. */
const bothFps = (over: Partial<PcbFootprintData> = {}): PcbFootprintData[] => [
  fp(over),
  // R2 carries (in_bom no) in the fixture, so its footprint must agree or it
  // contributes an attribute change of its own to every count below.
  fp({
    path: '/s-2',
    reference: 'R2',
    footprint: 'Resistor_SMD:R_0603',
    value: '1k',
    excludeFromBom: true,
  }),
];

const texts = (r: { messages: { text: string }[] }): string[] => r.messages.map((m) => m.text);

describe('matching the board to the schematic', () => {
  it('matches by path, not by reference', () => {
    // The reference changing on the board is the case back-annotation exists
    // for, so matching by it would find nothing.
    const r = backAnnotate(doc(), [fp({ reference: 'R7' }), bothFps()[1]!], opts());
    expect(r.changes).toBe(1);
    expect(texts(r)).toContain("Change R1 reference designator to 'R7'.");
  });

  it('matches by reference when asked to re-link', () => {
    // A footprint whose path is stale but whose reference is right.
    const r = backAnnotate(
      doc(),
      [fp({ path: '/gone', value: '22k' })],
      opts({ relinkFootprints: true }),
    );
    expect(r.changes).toBe(1);
    expect(texts(r)).toContain("Change R1 value from '10k' to '22k'.");
  });

  it('reports a footprint whose symbol it cannot find', () => {
    const r = backAnnotate(doc(), [fp({ path: '/nope', reference: 'R9' })], opts());
    expect(r.messages.find((m) => m.severity === 'error')?.text).toBe(
      "Cannot find symbol for footprint 'R9'.",
    );
  });

  it('warns about a board symbol with no footprint on the PCB', () => {
    // Deliberate divergence, and the comment in the engine says why: upstream
    // gates this on the symbol being *excluded* from the board, which is the
    // set that is expected to be absent. The useful warning is the other one.
    const r = backAnnotate(doc(), [fp()], opts());
    expect(texts(r).some((t) => t.startsWith("Footprint 'R2' is not present on PCB."))).toBe(true);
  });

  it('says so when nothing is selected to annotate', () => {
    const r = backAnnotate(
      doc(),
      [fp()],
      opts({
        processReferences: false,
        processFootprints: false,
        processValues: false,
        processAttributes: false,
        processOtherFields: false,
      }),
    );
    expect(r.changes).toBe(0);
    expect(r.command).toBeNull();
    expect(texts(r)).toContain('Select at least one property to back annotate.');
  });
});

describe('what the board may change', () => {
  it('takes the footprint, value and reference when each is enabled', () => {
    const r = backAnnotate(
      doc(),
      [fp({ reference: 'R5', footprint: 'Resistor_SMD:R_1206', value: '4k7' })],
      opts(),
    );
    const after = r.command!.apply(doc());
    const s = after.symbols[0]!;
    expect(s.fields.find((f) => f.key === 'Reference')!.value).toBe('R5');
    expect(s.fields.find((f) => f.key === 'Footprint')!.value).toBe('Resistor_SMD:R_1206');
    expect(s.fields.find((f) => f.key === 'Value')!.value).toBe('4k7');
    expect(serializeSchematic(after)).toContain('"R5"');
  });

  it('leaves each alone when its switch is off', () => {
    const r = backAnnotate(
      doc(),
      [fp({ reference: 'R5', value: '4k7' })],
      opts({ processReferences: false, processValues: false }),
    );
    expect(r.changes).toBe(0);
    expect(r.command).toBeNull();
  });

  it('flips the three attributes, inverting the two the file stores inverted', () => {
    const r = backAnnotate(
      doc(),
      [fp({ dnp: true, excludeFromBom: true, excludeFromPosFiles: true })],
      opts(),
    );
    const s = r.command!.apply(doc()).symbols[0]!;
    expect(s.dnp).toBe(true);
    expect(s.inBom).toBe(false);
    expect(s.excludedFromPosFiles).toBe(true);
    expect(texts(r)).toContain("Change R1 'Do not populate' from 'false' to 'true'.");
  });

  it('reports an attribute that is already right as no change', () => {
    // R2 already has (in_bom no); a board that agrees must not report a change.
    const r = backAnnotate(
      doc(),
      [
        fp({
          path: '/s-2',
          reference: 'R2',
          footprint: 'Resistor_SMD:R_0603',
          value: '1k',
          excludeFromBom: true,
        }),
      ],
      opts(),
    );
    expect(r.changes).toBe(0);
  });

  it('updates a field the symbol already has, and ignores one it does not', () => {
    const r = backAnnotate(doc(), [fp({ fields: { MPN: 'RC0805-NEW', 'PCB Only': 'x' } })], opts());
    expect(r.changes).toBe(1);
    expect(texts(r)).toContain("Change R1 field 'MPN' from 'RC0805' to 'RC0805-NEW'.");
    const s = r.command!.apply(doc()).symbols[0]!;
    expect(s.fields.some((f) => f.key === 'PCB Only')).toBe(false);
  });
});

describe('what the board must never overwrite', () => {
  it('leaves a field holding a text variable alone', () => {
    // HasTextVars(): writing the resolved text would destroy the ${...} that
    // produced it, and the next resolve would have nothing to work from.
    const src = SCH.replace('"Value" "10k"', '"Value" "${MPN}"');
    const d = readSchematic(parse(src));
    const r = backAnnotate(d, [fp({ value: '4k7' })], opts());
    expect(r.changes).toBe(0);
    expect(texts(r).some((t) => t.includes('value'))).toBe(false);
  });
});

describe('the dry run', () => {
  it('reports every change and applies none', () => {
    const r = backAnnotate(doc(), [fp({ reference: 'R5', value: '4k7' })], opts({ dryRun: true }));
    expect(r.changes).toBe(2);
    expect(r.command).toBeNull();
  });

  it('agrees with the real run about the count', () => {
    const args = [fp({ reference: 'R5', value: '4k7' })];
    const dry = backAnnotate(doc(), args, opts({ dryRun: true }));
    const wet = backAnnotate(doc(), args, opts({ dryRun: false }));
    expect(dry.changes).toBe(wet.changes);
    expect(texts(dry)).toEqual(texts(wet));
  });
});

describe('undo', () => {
  it('puts every changed field back, twice over', () => {
    // invert(before).invert(after) is the redo step — the property that caught
    // two undo bugs in #254.
    const before = doc();
    const r = backAnnotate(before, [fp({ reference: 'R5', value: '4k7', dnp: true })], opts());
    const after = r.command!.apply(before);
    const undone = r.command!.invert(before).apply(after);
    expect(undone.symbols[0]!.fields.find((f) => f.key === 'Reference')!.value).toBe('R1');
    expect(undone.symbols[0]!.dnp).toBe(false);
    const redone = r.command!.invert(before).invert(after).apply(undone);
    expect(redone.symbols[0]!.fields.find((f) => f.key === 'Reference')!.value).toBe('R5');
    expect(redone.symbols[0]!.dnp).toBe(true);
  });
});
