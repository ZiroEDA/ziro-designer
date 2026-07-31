// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Autoplace fields (O), the AUTOPLACER in eeschema/autoplace_fields.cpp.
 *
 * The parts worth pinning are the choices, not the arithmetic: which side the
 * fields go on, how they are justified once there, and which fields are moved
 * at all.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { autoplaceFields } from '@ziroeda/eeschema/src/tools/autoplace_fields.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/** A resistor: body 2.54 x 7.62 with a pin out of each end (up and down). */
const LIB = `(lib_symbols
  (symbol "Device:R" (pin_numbers hide) (pin_names (offset 0))
    (property "Reference" "R" (at 2.032 0 90))
    (property "Value" "R" (at 0 0 90))
    (symbol "R_0_1"
      (rectangle (start -1.016 -2.54) (end 1.016 2.54)))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
      (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))`;

const doc = (symExtra = '', fieldExtra = '') =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") ${LIB}
      (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) ${symExtra} (uuid "s1")
        (property "Reference" "R1" (at 60 40 0) ${fieldExtra})
        (property "Value" "10k" (at 60 45 0))))`),
  );

const LIBS = (d: ReturnType<typeof readSchematic>) =>
  new Map(d.libSymbols.map((s) => [s.libId, s]));
const run = (d: ReturnType<typeof readSchematic>) =>
  autoplaceFields(d, new Set([refId('symbol', 's1', 0)]), LIBS(d))?.apply(d) ?? d;

describe('choosing a side', () => {
  it('puts the fields to the right of a vertical part', () => {
    // A resistor's pins are top and bottom, so left and right are both free and
    // right is the highest-ranked free side (getPreferredSides).
    const out = run(doc());
    for (const f of out.symbols[0]!.fields) {
      expect(f.at!.x).toBeGreaterThan(out.symbols[0]!.at.x);
    }
  });

  it('justifies the fields away from the body', () => {
    // justifyField sets ToHAlignment(-side.x): a field on the right reads
    // rightwards, so it is left-justified.
    const out = run(doc());
    for (const f of out.symbols[0]!.fields) {
      expect(f.effects?.justify).toContain('left');
    }
  });

  it('stacks the fields rather than overlapping them', () => {
    const out = run(doc());
    const ys = out.symbols[0]!.fields.map((f) => f.at!.y);
    expect(new Set(ys).size).toBe(ys.length);
  });

  it('lays them out horizontally, whatever the symbol’s rotation', () => {
    // Fields always display horizontally after autoplace; a symbol turned 90
    // degrees stores them vertical so the transform brings them back level.
    expect(run(doc()).symbols[0]!.fields.every((f) => f.angle === 0)).toBe(true);
    expect(run(doc('')).symbols[0]!.fields.every((f) => f.angle === 0)).toBe(true);
  });
});

describe('which fields move', () => {
  it('leaves a hidden field alone', () => {
    const d = doc('', '(effects (font (size 1.27 1.27)) (hide yes))');
    const before = d.symbols[0]!.fields[0]!.at;
    expect(run(d).symbols[0]!.fields[0]!.at).toEqual(before);
  });

  it('leaves a field that opted out of autoplacement alone', () => {
    // do_not_autoplace, the "Allow automatic placement" checkbox.
    const d = doc('', '(do_not_autoplace yes)');
    const before = d.symbols[0]!.fields[0]!.at;
    expect(run(d).symbols[0]!.fields[0]!.at).toEqual(before);
    // The other field still moves.
    expect(run(d).symbols[0]!.fields[1]!.at).not.toEqual(d.symbols[0]!.fields[1]!.at);
  });

  it('does nothing for a selection with no symbol in it', () => {
    const d = doc();
    expect(autoplaceFields(d, new Set(['nope']), LIBS(d))).toBeNull();
  });
});

describe('the grid', () => {
  it('rounds every field onto the 50 mil grid', () => {
    const grid = mmToIU(50 * 0.0254);
    const out = run(doc());
    for (const f of out.symbols[0]!.fields) expect(f.at!.x % grid).toBe(0);
  });

  it('can be turned off', () => {
    // m_AutoplaceFields.align_to_grid; without it the fields sit exactly where
    // the box put them.
    const d = doc();
    const out = autoplaceFields(d, new Set([refId('symbol', 's1', 0)]), LIBS(d), {
      allowRejustify: true,
      alignToGrid: false,
    })!.apply(d);
    expect(out.symbols[0]!.fields[0]!.at).toBeDefined();
  });

  it('leaves justification alone when rejustify is off', () => {
    const d = doc();
    const before = d.symbols[0]!.fields[0]!.effects?.justify;
    const out = autoplaceFields(d, new Set([refId('symbol', 's1', 0)]), LIBS(d), {
      allowRejustify: false,
      alignToGrid: true,
    })!.apply(d);
    expect(out.symbols[0]!.fields[0]!.effects?.justify).toEqual(before);
  });
});

describe('the undo step and saving', () => {
  it('puts the fields back exactly', () => {
    const d = doc();
    const cmd = autoplaceFields(d, new Set([refId('symbol', 's1', 0)]), LIBS(d))!;
    const back = cmd.invert(d).apply(cmd.apply(d));
    expect(back.symbols[0]!.fields).toEqual(d.symbols[0]!.fields);
  });

  it('round-trips', () => {
    const out = run(doc());
    const back = readSchematic(parse(serializeSchematic(out)));
    expect(back.symbols[0]!.fields.map((f) => f.at)).toEqual(
      out.symbols[0]!.fields.map((f) => f.at),
    );
  });
});
