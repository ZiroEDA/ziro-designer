// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live `PIN_LAYOUT_CACHE::GetPinBoundingBox` (on `SCH_PIN`) against the record model's
 * `libPinBoundingBox`, the port of the same C++ that `pin_box.test.ts` pins branch by
 * branch.  Each library pin below is read by both readers from one file and must box the
 * same, in every orientation, decoration, name placement and visibility; and a placed
 * symbol's pin is its library pin's box through the symbol transform.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { libPinBoundingBox } from '@ziroeda/eeschema/pin_layout_cache.js';
import { readSchematic } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

const PINS = `
  (pin input line (at 0 0 0) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
  (pin output inverted (at 0 5.08 90) (length 3.81) (name "LONGNAME" (effects (font (size 1.27 1.27)))) (number "22" (effects (font (size 1.27 1.27)))))
  (pin bidirectional clock (at 10.16 0 180) (length 2.54) (name "CK" (effects (font (size 1 1)))) (number "3" (effects (font (size 1.5 1.5)))))
  (pin passive input_low (at 5.08 -7.62 270) (length 5.08) (name "" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))
  (pin power_in non_logic (at -5.08 0 0) (length 2.54) hide (name "VCC" (effects (font (size 1.27 1.27)))) (number "5" (effects (font (size 1.27 1.27)))))
  (pin no_connect clock_low (at -5.08 2.54 0) (length 2.54) (name "NC" (effects (font (size 1.27 1.27)))) (number "6" (effects (font (size 1.27 1.27)))))
`;

const file = (
  offsetMM: number,
) => `(kicad_sch (version 20250114) (generator "eeschema") (generator_version "9.0")
  (uuid "11111111-2222-3333-4444-555555555555")
  (paper "A4")
  (lib_symbols
    (symbol "T:P" (pin_names (offset ${offsetMM})) (exclude_from_sim no) (in_bom yes) (on_board yes)
      (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "P" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "P_1_1" ${PINS})))
  (symbol (lib_id "T:P") (at 50.8 50.8 90) (mirror x) (unit 1)
    (uuid "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    (property "Reference" "U1" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "P" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (instances (project "t" (path "/11111111-2222-3333-4444-555555555555" (reference "U1") (unit 1))))))
`;

function readBoth(offsetMM: number) {
  const text = file(offsetMM);
  const record = readSchematic(parse(text)).libSymbols[0]!;

  const schematic = new SCHEMATIC(new PROJECT());
  schematic.CreateDefaultScreens();
  const pi = new SCH_IO_KICAD_SEXPR('eeschema');
  const root = pi.LoadSchematicFile('/t/t.kicad_sch', schematic, '/t', (p) =>
    p === '/t/t.kicad_sch' ? text : null,
  );
  schematic.SetTopLevelSheets([root]);
  const screen = root.GetScreen()!;
  const lib = screen.GetLibSymbols().get('T:P')!;
  const symbol = screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)[0] as SCH_SYMBOL;
  return { record, lib, symbol, schematic };
}

describe('PIN_LAYOUT_CACHE::GetPinBoundingBox, live against the record-model port', () => {
  for (const offset of [0, 0.508]) {
    it(`library pins box the same (pin name offset ${offset} mm)`, () => {
      const { record, lib } = readBoth(offset);
      const recordPins = record.units.flatMap((u) => u.pins);
      const livePins = lib.GetPins();

      // LIB_SYMBOL keeps its draw items sorted; pair the pins by number.
      expect(livePins.map((p) => p.GetNumber()).sort()).toEqual(
        recordPins.map((p) => p.number).sort(),
      );

      for (const livePin of livePins) {
        const recordPin = recordPins.find((p) => p.number === livePin.GetNumber())!;
        const b = livePin.GetBoundingBox();
        const want = libPinBoundingBox(recordPin, record);
        expect({
          pin: recordPin.number,
          box: [b.GetLeft(), b.GetTop(), b.GetRight(), b.GetBottom()],
        }).toEqual({
          pin: recordPin.number,
          box: [want.minX, want.minY, want.maxX, want.maxY],
        });
      }
    });
  }

  it("a placed pin is its library pin's box through the symbol's transform", () => {
    const { lib, symbol, schematic } = readBoth(0.508);
    const sheet = schematic.Hierarchy()[0]!;

    for (const pin of symbol.GetPins(sheet)) {
      const libBox = pin.GetLibPin()!.GetBoundingBox();
      const want = symbol.GetTransform().TransformCoordinate(libBox);
      want.Offset(symbol.GetPosition());
      want.Normalize();

      const got = pin.GetBoundingBox();
      expect([got.GetLeft(), got.GetTop(), got.GetRight(), got.GetBottom()]).toEqual([
        want.GetLeft(),
        want.GetTop(),
        want.GetRight(),
        want.GetBottom(),
      ]);
    }

    expect(lib.GetPins().length).toBe(6);
  });
});
