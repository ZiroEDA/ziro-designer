// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Ambiguous-click collection (counterpart SCH_SELECTION_TOOL::
 * GuessSelectionCandidates + GetItemDescription): exact hits beat sloppy
 * ones, the tight-box trim drops items with clickable area elsewhere, and
 * genuinely-overlapping items surface for the Clarify Selection menu.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addItems, makeWire, makeJunction, makeLabel } from '@ziroeda/eeschema/src/tools/index.js';
import { collectAndGuess, describeItem } from '@ziroeda/eeschema/src/tools/sch_collectors.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const ACC = mmToIU(0.5);
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));

describe('collectAndGuess', () => {
  it('a lone wire resolves to a single candidate', () => {
    const sch = addItems({ lines: [makeWire(at(0, 0), at(20, 0))] }).apply(EMPTY());
    const cands = collectAndGuess(sch, new Map(), at(10, 0.1), ACC);
    expect(cands.length).toBe(1);
    expect(cands[0]!.kind).toBe('line');
  });

  it('an exact junction hit wins instantly over the wires under it', () => {
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(20, 0)),
        makeWire(at(10, 0), at(10, 10)),
        makeWire(at(10, 0), at(20, 5)),
      ],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    const cands = collectAndGuess(sch, new Map(), at(10, 0), ACC);
    expect(cands[0]!.kind).toBe('junction');
  });

  it('a plain crossing resolves to one wire (the other has area elsewhere)', () => {
    // The tight box around the closest wire excludes the crossing wire,
    // it has plenty of clickable area elsewhere (upstream drops it too).
    const crossing = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(10, -10), at(10, 10))],
    }).apply(EMPTY());
    expect(collectAndGuess(crossing, new Map(), at(10, 0), ACC).length).toBe(1);
  });

  it("a small item inside the closest item's tight box stays ambiguous", () => {
    // A no-connect flag sitting inside a text box: clicking between the two
    // centres hits both exactly, the text box wins the distance race, and the
    // flag survives the tight-box trim, Clarify menu with 2 rows.
    const base = EMPTY();
    const sch = {
      ...base,
      textBoxes: [
        { start: at(0, 0), end: at(60, 40), angle: 0, text: 'note', source: base.source },
      ],
      noConnects: [{ at: at(30.4, 20), source: base.source }],
    } as Schematic;
    const cands = collectAndGuess(sch, new Map(), at(30.1, 20), ACC);
    expect(cands.length).toBe(2);
    expect(new Set(cands.map((c) => c.kind))).toEqual(new Set(['textbox', 'noconnect']));
  });

  it('describes items with KiCad wording', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NETX', at(0, 0))],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    // (12, 0.1) is past the junction dot's radius, so the wire wins there.
    const wireRef = collectAndGuess(sch, new Map(), at(12, 0.1), ACC)[0]!;
    expect(describeItem(sch, new Map(), wireRef)).toBe('Horizontal Wire, length 20.00 mm');
    const jRef = collectAndGuess(sch, new Map(), at(10, 0), ACC)[0]!;
    expect(describeItem(sch, new Map(), jRef)).toBe('Junction');
    const labelRef = collectAndGuess(sch, new Map(), at(0, -1), ACC)[0]!;
    expect(describeItem(sch, new Map(), labelRef)).toBe("Label 'NETX'");
  });
});

describe('collectAndGuess: a pin only wins outright on an exact hit', () => {
  // R1 is vertical at (100, 100); its pins run from (100, 96.19) and
  // (100, 103.81) inward for 1.27 mm. A wire runs horizontally through
  // (100, 96.19), the way a rail does under a part's top pin.
  const rawR = readFileSync(
    fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
    'utf8',
  );
  const R = readSymbolLib(parse(rawR))[0]!;
  const LIB = new Map([[R.libId, R]]);
  const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));
  const withR = (body = ''): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
        (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
          (property "Reference" "R1" (at 106 100 90))
          (property "Value" "R" (at 108 100 90)))
        ${body})`),
    );

  it('takes the pin when the cursor is on it', () => {
    const sch = withR();
    const cands = collectAndGuess(sch, LIB, at(100, 96.6), mmToIU(0.9));
    expect(cands[0]!.kind).toBe('pin');
  });

  it('takes the wire when the cursor is on the wire and merely near a pin', () => {
    // SCH_PIN::HitTest( pos, 0 ) floors its accuracy at m_PinSymbolSize / 4
    // (about 0.16 mm), so a pin 0.5 mm away is collected but is *not* an exact
    // hit and does not short-circuit the closest-item race.
    const sch = withR(`
      (wire (pts (xy 90 95.5) (xy 110 95.5)) (stroke (width 0) (type default)) (uuid "rail"))`);
    const cands = collectAndGuess(sch, LIB, at(100, 95.5), mmToIU(0.9));
    expect(cands[0]!.kind).toBe('line');
  });
});
