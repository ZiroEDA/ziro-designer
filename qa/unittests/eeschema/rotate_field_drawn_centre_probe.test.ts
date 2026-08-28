// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a rotated symbol's field text is actually DRAWN, pinned against KiCad's
 * own plot of the same schematic.
 *
 * The stored `(at …)` in the file is necessary but not sufficient. KiCad does
 * not draw a symbol field at its anchor and it does not draw it with its stored
 * justification — it throws both away:
 *
 *     hjustify = GR_TEXT_H_ALIGN_CENTER;
 *     vjustify = GR_TEXT_V_ALIGN_CENTER;
 *     textpos  = GetBoundingBox().Centre();
 *
 * verbatim in `SCH_FIELD::Plot` (sch_field.cpp:1350-1352) and again in
 * `SCH_PAINTER::draw( const SCH_FIELD* )`, both with the same reason above
 * them: "when a symbol is mirrored the text is not, and justifications become a
 * nightmare … the easier way is to use no justifications (centered text) and
 * use GetBoundingBox to know the text coordinate considered as centered."
 *
 * So the *bounding box* is the whole of the answer to "where does the text
 * land", and a correct anchor with a wrong box still looks wrong on screen —
 * which is the shape of the complaint this file exists to close out. A field
 * anchored at (104.14, 73.6599) is drawn at (105.4909, 73.6598): 1.35 mm away.
 *
 * The oracle is `kicad-cli sch export svg`, run on the files eeschema itself
 * wrote in the rotate probe. The SVG plotter emits an invisible `<text>`
 * alongside the stroked glyphs, and for centre-justified text its anchor is the
 * plot position with `aSize.y / 2` added (SVG_plotter.cpp:880-888) — so
 * `GetBoundingBox().Centre()` is `(x, y - 0.635)` for 1.27 mm text, read
 * straight out of the file:
 *
 *   Device:D at 90°, 3 fields   D1     <text x="105.4909" y="74.2948">
 *                               1N4001 <text x="107.9402" y="76.8348">
 *                               Fp     <text x="120.1563" y="79.3748">
 *   Device:D at 90°, 4 fields   D1     <text x="105.4909" y="73.0248">
 *                               …
 *   Device:R at 180°, 4 fields  R1     <text x="105.4909" y="73.0248">
 *                               10k    <text x="105.9747" y="75.5648">
 *
 * Each case below starts from the symbol and field state eeschema saved, so the
 * autoplacer is not in the loop at all: this pins the box, and only the box.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { fieldBoundingBox, fieldShownText } from '@ziroeda/eeschema/src/fieldbox.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';

const DIODE = `(symbol "Device:D" (pin_numbers (hide yes)) (pin_names (offset 1.016) (hide yes))
    (property "Reference" "D" (at 0 2.54 0))
    (property "Value" "D" (at 0 -2.54 0))
    (symbol "D_0_1"
      (polyline (pts (xy -1.27 1.27) (xy -1.27 -1.27)) (stroke (width 0.254)))
      (polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27) (xy -1.27 0) (xy 1.27 1.27))
        (stroke (width 0.254)))
      (polyline (pts (xy 1.27 0) (xy -1.27 0)) (stroke (width 0))))
    (symbol "D_1_1"
      (pin passive line (at -3.81 0 0) (length 2.54) (name "K") (number "1"))
      (pin passive line (at 3.81 0 180) (length 2.54) (name "A") (number "2"))))`;

const RESISTOR = `(symbol "Device:R" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "R" (at 2.032 0 90))
    (property "Value" "R" (at 0 0 90))
    (symbol "R_0_1"
      (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254))))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27) (name "") (number "1"))
      (pin passive line (at 0 -3.81 90) (length 1.27) (name "") (number "2"))))`;

/** One field, exactly as the saved file records it. */
type Field = [key: string, value: string, x: number, y: number, angle: number];

/** The symbol and fields eeschema wrote, read back through our own parser. */
function saved(lib: string, libId: string, angle: number, fields: Field[]): Schematic {
  const props = fields
    .map(
      ([key, value, x, y, a]) =>
        `(property "${key}" "${value}" (at ${x} ${y} ${a}) (show_name no) (do_not_autoplace no)
           (effects (font (size 1.27 1.27)) (justify right)))`,
    )
    .join('\n        ');
  return readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") (lib_symbols ${lib})
      (symbol (lib_id "${libId}") (at 101.6 76.2 ${angle}) (unit 1)
        (fields_autoplaced yes) (uuid "d1")
        ${props}))`),
  );
}

/**
 * `GetBoundingBox().Centre()` for every visible field, in mm.
 * `BOX2I::Centre()` is `m_Pos + m_Size / 2` in integer units, hence the trunc.
 */
function drawnCentres(doc: Schematic): [number, number][] {
  const s = doc.symbols[0]!;
  const lib = new Map(doc.libSymbols.map((l) => [l.libId, l])).get(s.libId);
  const unitCount = lib ? lib.units.reduce((m, u) => Math.max(m, u.unit), 0) : 1;
  return s.fields.map((f) => {
    const b = fieldBoundingBox(f, s, fieldShownText(f, s, unitCount));
    return [iuToMM(b.x + Math.trunc(b.w / 2)), iuToMM(b.y + Math.trunc(b.h / 2))];
  });
}

/**
 * The SVG is written to four decimal places of a millimetre, which is one
 * internal unit, and the two sides sum a run of glyph advances in a different
 * order — so agreement is asserted to within two IU. That is 0.0002 mm: at any
 * zoom a person can read a schematic at, a fifth of a thousandth of a
 * millimetre is four orders of magnitude below one pixel, while every placement
 * bug this file is here to catch moves the text by whole millimetres.
 */
const TOLERANCE_IU = 2;

function expectCentres(doc: Schematic, expected: [number, number][]): void {
  const got = drawnCentres(doc);
  expect(got.length).toBe(expected.length);
  got.forEach(([x, y], i) => {
    const [ex, ey] = expected[i]!;
    expect(Math.abs(mmToIU(x) - mmToIU(ex))).toBeLessThanOrEqual(TOLERANCE_IU);
    expect(Math.abs(mmToIU(y) - mmToIU(ey))).toBeLessThanOrEqual(TOLERANCE_IU);
  });
}

describe('a Device:D turned 90° with Reference, Value and Footprint', () => {
  const doc = (): Schematic =>
    saved(DIODE, 'Device:D', 90, [
      ['Reference', 'D1', 104.14, 73.6599, 90],
      ['Value', '1N4001', 104.14, 76.1999, 90],
      ['Footprint', 'Resistor_SMD:R_0805_2012Metric', 104.14, 78.7399, 90],
    ]);

  it('draws each field where kicad-cli plots it', () => {
    expectCentres(doc(), [
      [105.4909, 73.6598],
      [107.9402, 76.1998],
      [120.1563, 78.7398],
    ]);
  });

  it('draws every one of them clear to the right of the anchor', () => {
    // The negative control for the assertion above: the anchor is the *left*
    // edge of the box here, so a box of the wrong width — or one built at the
    // stored angle rather than the drawn one — moves the text along the row
    // rather than off it, and the y would still agree. All three anchors are
    // 104.14; a Footprint field 30 characters long has to end up 16 mm further
    // right than a two-character Reference.
    const xs = drawnCentres(doc()).map(([x]) => x);
    expect(xs.every((x) => x > 104.14)).toBe(true);
    expect(xs[2]! - xs[0]!).toBeGreaterThan(14);
  });
});

describe('a Device:D turned 90° with a fourth field', () => {
  it('draws four rows one 100 mil pitch apart', () => {
    const doc = saved(DIODE, 'Device:D', 90, [
      ['Reference', 'D1', 104.14, 72.3899, 90],
      ['Value', '1N4001', 104.14, 74.9299, 90],
      ['Footprint', 'Resistor_SMD:R_0805_2012Metric', 104.14, 77.4699, 90],
      ['Datasheet', 'https://example.com/datasheet.pdf', 104.14, 80.0099, 90],
    ]);
    expectCentres(doc, [
      [105.4909, 72.3898],
      [107.9402, 74.9298],
      [120.1563, 77.4698],
      [121.5774, 80.0098],
    ]);
  });
});

describe('a Device:R turned upside down with a user field', () => {
  it('draws all four, including the one that is not mandatory', () => {
    // The resistor's fields are stored at angle 0 here while the symbol is at
    // 180°, which is the case `GetDrawRotation` leaves horizontal — so the box
    // is not rotated but the transform still mirrors it through the origin.
    const doc = saved(RESISTOR, 'Device:R', 180, [
      ['Reference', 'R1', 104.14, 72.3899, 0],
      ['Value', '10k', 104.14, 74.9299, 0],
      ['Footprint', 'Resistor_SMD:R_0805_2012Metric', 104.14, 77.4699, 0],
      ['MPN', 'RC0805FR-0710KL', 104.14, 80.0099, 0],
    ]);
    expectCentres(doc, [
      [105.4909, 72.3898],
      [105.9747, 74.9298],
      [120.1563, 77.4698],
      [113.4737, 80.0098],
    ]);
  });
});
