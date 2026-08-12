// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME::setupUIConditions`' `hasElements`, the condition behind
 * Cut / Copy / Delete / Duplicate:
 *
 *     return GetScreen() && ( !GetScreen()->Items().empty() || !Idle( aSel ) );
 *
 * It asks about the *sheet*, not the selection, which is what lets the
 * right-click menu over empty canvas offer Duplicate at all — greyed only when
 * there is nothing on the sheet to duplicate.
 *
 * `Items()` is the screen's whole draw list, so anything a sheet can hold
 * counts. The failure mode this guards is silent: a kind left out of the walk
 * greys the menu on a sheet that plainly has something on it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, screenHasItems } from '@ziroeda/eeschema';

const sheet = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols) ${body})`));

const EMPTY = '';

/** One of each kind the screen can hold, as it appears in a .kicad_sch. */
const KINDS: Record<string, string> = {
  symbol: `(symbol (lib_id "Device:R") (at 100 100 0) (unit 1) (uuid "s1")
    (property "Reference" "R1" (at 100 95 0) (effects (font (size 1.27 1.27)))))`,
  wire: '(wire (pts (xy 60 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "w1"))',
  junction: '(junction (at 60 60) (diameter 0) (color 0 0 0 0) (uuid "j1"))',
  noConnect: '(no_connect (at 70 70) (uuid "n1"))',
  label: '(label "NET" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "l1"))',
  sheet: `(sheet (at 20 20) (size 30 20) (uuid "sh1")
    (property "Sheetname" "sub" (at 20 19 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 20 51 0) (effects (font (size 1.27 1.27)))))`,
  busEntry: '(bus_entry (at 50 50) (size 2.54 2.54) (stroke (width 0) (type default)) (uuid "b1"))',
  graphic: `(rectangle (start 10 10) (end 20 20) (stroke (width 0) (type default))
    (fill (type none)) (uuid "g1"))`,
  textBox: `(text_box "note" (at 30 30 0) (size 20 10) (stroke (width 0) (type solid))
    (fill (type none)) (effects (font (size 1.27 1.27))) (uuid "tb1"))`,
  directiveLabel: `(netclass_flag "HV" (length 2.54) (shape round) (at 60 60 0)
    (effects (font (size 1.27 1.27))) (uuid "d1")
    (property "Netclass" "HV" (at 60 60 0) (effects (font (size 1.27 1.27)))))`,
};

describe('hasElements', () => {
  it('is false on a sheet with nothing on it', () => {
    expect(screenHasItems(sheet(EMPTY))).toBe(false);
  });

  // Table-driven on purpose: a kind added to the document and forgotten here
  // is precisely the bug, and one `it` per kind names the culprit when it goes.
  for (const [kind, body] of Object.entries(KINDS)) {
    it(`counts a ${kind}`, () => {
      const doc = sheet(body);
      expect(screenHasItems(doc)).toBe(true);
    });
  }

  it('ignores the library cache, which is not on the screen', () => {
    // `lib_symbols` is the sheet's cached definitions. A schematic with cached
    // parts and no placements draws nothing, and Duplicate must stay greyed.
    const doc = sheet(EMPTY);
    const withCache = {
      ...doc,
      libSymbols: [...readSchematic(parse(LIB_ONLY)).libSymbols],
    };
    expect(withCache.libSymbols.length).toBeGreaterThan(0);
    expect(screenHasItems(withCache)).toBe(false);
  });
});

const LIB_ONLY = `(kicad_sch (version 20250114)
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))))) `;
