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

/**
 * AUTOPLACE_MANUAL — what the O hotkey runs. It adds the two steps that need
 * the rest of the sheet: ruling out sides where the fields would land on
 * something (getCollidingSides / chooseSideFiltered), and snapping the box to
 * the wire pitch when it sits among horizontal wires (fitFieldsBetweenWires).
 */
const docWith = (items: string) =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") ${LIB}
      (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "s1")
        (property "Reference" "R1" (at 60 40 0))
        (property "Value" "10k" (at 60 45 0)))
      ${items})`),
  );

const vWire = (x: number, y0: number, y1: number, uuid: string) =>
  `(wire (pts (xy ${x} ${y0}) (xy ${x} ${y1})) (stroke (width 0) (type default)) (uuid "${uuid}"))`;
const hWire = (y: number, x0: number, x1: number, uuid: string) =>
  `(wire (pts (xy ${x0} ${y}) (xy ${x1} ${y})) (stroke (width 0) (type default)) (uuid "${uuid}"))`;

const fieldsOf = (d: ReturnType<typeof readSchematic>) => d.symbols[0]!.fields;
const symAt = (d: ReturnType<typeof readSchematic>) => d.symbols[0]!.at;

describe('manual mode: sides that collide are ruled out', () => {
  it('goes left when the preferred right side is blocked', () => {
    // A vertical wire is a hard obstacle on a horizontal side, so RIGHT is out
    // and LEFT is the next side with no pins on it.
    const d = docWith(vWire(53, 45, 55, 'w1'));
    const out = run(d);
    for (const f of fieldsOf(out)) expect(f.at!.x).toBeLessThan(symAt(out).x);
  });

  it('still takes a colliding side over a clear one with more pins', () => {
    // Surprising but exactly what chooseSideFiltered does: a side removed for
    // colliding stays on as the fallback selection, and a survivor only
    // displaces it if it has no *more* pins. Here RIGHT and LEFT collide but
    // are pin-free, while the clear BOTTOM carries a pin — so the fields go
    // back to the blocked RIGHT rather than down.
    const d = docWith([vWire(53, 45, 55, 'w1'), vWire(46, 45, 55, 'w2')].join('\n'));
    const out = run(d);
    for (const f of fieldsOf(out)) expect(f.at!.x).toBeGreaterThan(symAt(out).x);
  });

  it('is unchanged when nothing is in the way', () => {
    // The collision pass must not disturb an uncluttered sheet.
    expect(fieldsOf(run(docWith('')))).toEqual(fieldsOf(run(doc())));
  });
});

/** A pinless part, so every side has the same (zero) pin count and the
 *  collision sifting is what decides between them. */
const PAD_LIB = `(lib_symbols
  (symbol "Device:Pad"
    (property "Reference" "H" (at 0 0 0))
    (property "Value" "Pad" (at 0 0 0))
    (symbol "Pad_0_1" (rectangle (start -1.27 -1.27) (end 1.27 1.27)))))`;

const padDoc = (items: string) =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") ${PAD_LIB}
      (symbol (lib_id "Device:Pad") (at 50 50 0) (unit 1) (uuid "p1")
        (property "Reference" "H1" (at 60 40 0))
        (property "Value" "Pad" (at 60 45 0)))
      ${items})`),
  );
const runPad = (d: ReturnType<typeof readSchematic>) =>
  autoplaceFields(d, new Set([refId('symbol', 'p1', 0)]), LIBS(d))?.apply(d) ?? d;

describe('manual mode: objects are sifted before horizontal wires', () => {
  it('takes the most preferred clear side when one is left', () => {
    // RIGHT and LEFT are hard-blocked; TOP and BOTTOM survive, both pin-free,
    // so the pin-free scan returns the higher-ranked of them — TOP.
    const d = padDoc([vWire(53, 45, 55, 'w1'), vWire(47, 45, 55, 'w2')].join('\n'));
    const out = runPad(d);
    for (const f of fieldsOf(out)) expect(f.at!.y).toBeLessThan(symAt(out).y);
  });

  it('falls back to the side blocked only by wires when every side collides', () => {
    // Nothing is clear. A side carrying only horizontal wires is sifted in the
    // second pass, so it ends up the selection ahead of the object-blocked
    // ones — a wire is the softer obstacle.
    const d = padDoc(
      [
        vWire(53, 45, 55, 'w1'),
        vWire(47, 45, 55, 'w2'),
        hWire(46.2, 45, 55, 'w3'),
        hWire(53.8, 45, 55, 'w4'),
        vWire(50, 56, 58, 'w5'),
      ].join('\n'),
    );
    const out = runPad(d);
    for (const f of fieldsOf(out)) expect(f.at!.y).toBeLessThan(symAt(out).y);
  });
});

describe('manual mode: fitting the fields between wires', () => {
  /**
   * Every side blocked, TOP only by horizontal wires — so TOP is the selection
   * and the fit has something to work with. `wires` are the TOP-box obstacles.
   */
  const amongWires = (wires: string[]) =>
    padDoc(
      [
        vWire(53, 45, 55, 'w1'), // RIGHT: object
        vWire(47, 45, 55, 'w2'), // LEFT: object
        vWire(50, 52, 56, 'w3'), // BOTTOM: object
        ...wires,
      ].join('\n'),
    );
  /** Two wires one pitch apart share an offset, so the fit goes ahead. */
  const onPitch = [hWire(45.72, 48, 52, 'h1'), hWire(48.26, 48, 52, 'h2')];
  /** These two do not, and fitFieldsBetweenWires refuses. */
  const offPitch = [hWire(46.0, 48, 52, 'h1'), hWire(47.5, 48, 52, 'h2')];

  const topField = (d: ReturnType<typeof readSchematic>) =>
    Math.min(...fieldsOf(d).map((f) => f.at!.y));

  it('spaces the fields one wire pitch apart', () => {
    // The fit switches the box to fixed spacing — one 100 mil wire slot per
    // field — so each lands in its own gap instead of being packed at the
    // text's own height.
    const ys = fieldsOf(runPad(amongWires(onPitch)))
      .map((f) => f.at!.y)
      .sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBe(mmToIU(2.54));
  });

  it('centres each field in its own wire slot', () => {
    // The box top is snapped to the pitch and each field sits half a slot into
    // it, so the text runs between the wires rather than along one.
    for (const f of fieldsOf(runPad(amongWires(onPitch))))
      expect(f.at!.y % mmToIU(2.54)).toBe(mmToIU(1.27));
  });

  // With align-to-grid off, ordinary spacing is the text height plus its
  // padding — well under a wire pitch — so whether the fit applied is visible
  // in the gap between the fields.
  const freeRun = (d: ReturnType<typeof readSchematic>) =>
    autoplaceFields(d, new Set([refId('symbol', 'p1', 0)]), LIBS(d), {
      allowRejustify: true,
      alignToGrid: false,
    })?.apply(d) ?? d;
  const gap = (d: ReturnType<typeof readSchematic>) => {
    const ys = fieldsOf(d)
      .map((f) => f.at!.y)
      .sort((a, b) => a - b);
    return ys[1]! - ys[0]!;
  };

  it('takes the wire pitch even when align-to-grid is off', () => {
    expect(gap(freeRun(amongWires(onPitch)))).toBe(mmToIU(2.54));
  });

  it('refuses when the wires do not share an offset', () => {
    // `offset != this_offset` bails out: there is no single pitch to fit
    // between, so the fields keep their ordinary spacing.
    expect(gap(freeRun(amongWires(offPitch)))).toBeLessThan(mmToIU(2.54));
  });

  it('refuses when there is nothing in the box to fit between', () => {
    const clearAbove = padDoc(
      [vWire(53, 45, 55, 'w1'), vWire(47, 45, 55, 'w2'), vWire(50, 52, 56, 'w3')].join('\n'),
    );
    expect(gap(freeRun(clearAbove))).toBeLessThan(mmToIU(2.54));
  });
});
