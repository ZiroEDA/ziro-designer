// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sheet pins as items you can select, drag and delete.
 *
 * A sheet pin is a port on the border, not a free item: SCH_SHEET_PIN::
 * ConstrainOnEdge keeps it on the rectangle, moves it to whichever edge the
 * cursor is nearest, and clamps it along that edge's length.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { hitTest, refId, sheetPinId } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  parseSheetPinId,
  moveSheetPin,
  moveSheetPinCommand,
  deleteSheetPin,
  sideOfAngle,
} from '@ziroeda/eeschema/src/tools/sch_sheet_pin_tool.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const mm = (v: number): number => mmToIU(v);
const LIBS = new Map();

// A sheet from (50,50) to (80,70), with a pin on the right edge and a wire
// running off it, plus a no-connect on a second pin.
const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  (sheet (at 50 50) (size 30 20) (uuid "sh1")
    (property "Sheetname" "Sub" (at 50 49.4 0))
    (property "Sheetfile" "sub.kicad_sch" (at 50 70.6 0))
    (pin "A" input (at 80 55 0) (uuid "sp1"))
    (pin "B" input (at 80 60 0) (uuid "sp2")))
  (wire (pts (xy 80 55) (xy 90 55)) (uuid "w1"))
  (no_connect (at 80 60) (uuid "nc1"))
)`;

const sch = readSchematic(parse(DOC));
const SHEET = refId('sheet', 'sh1', 0);
const PIN_A = sheetPinId(SHEET, 0);
const refA = parseSheetPinId(sch, PIN_A)!;

describe('selecting a sheet pin', () => {
  it('is hit before the sheet body it sits on', () => {
    // The pin's flag hangs inside the sheet's rectangle, so testing the body
    // first would mean a pin could never be clicked. Probed just inside the
    // border, clear of the wire that meets the pin at exactly (80,55): that
    // point is ambiguous and goes to whichever item hitTest ranks first, which
    // is what Clarify Selection is for (#96).
    const hit = hitTest(sch, LIBS, { x: mm(79), y: mm(55) }, mm(0.5));
    expect(hit?.kind).toBe('sheetpin');
    expect(hit?.id).toBe(PIN_A);
  });

  it('still lets the sheet body be clicked away from any pin', () => {
    expect(hitTest(sch, LIBS, { x: mm(65), y: mm(65) }, mm(0.5))?.kind).toBe('sheet');
  });

  it('addresses pins the way the netlist already does', () => {
    expect(PIN_A).toBe(`${SHEET}:sheetpin0`);
    expect(parseSheetPinId(sch, PIN_A)).toEqual({ sheet: 0, pin: 0 });
    expect(parseSheetPinId(sch, `${SHEET}:sheetpin9`)).toBeNull();
    expect(parseSheetPinId(sch, 'not-a-pin')).toBeNull();
  });
});

describe('dragging a sheet pin', () => {
  it('slides along its own edge', () => {
    const out = moveSheetPin(sch, refA, { x: mm(82), y: mm(65) });
    // x is pinned to the right border; y follows the cursor.
    expect(out.sheets[0]!.pins[0]!.at).toEqual({ x: mm(80), y: mm(65) });
    expect(sideOfAngle(out.sheets[0]!.pins[0]!.angle)).toBe('right');
  });

  it('clamps to the edge rather than sliding off the end', () => {
    const out = moveSheetPin(sch, refA, { x: mm(80), y: mm(200) });
    expect(out.sheets[0]!.pins[0]!.at.y).toBe(mm(70));
  });

  it('switches edges when the cursor is nearest another one', () => {
    // Dragged up over the top border: the pin moves round the corner and its
    // angle changes with it, which is how a pin is repositioned in KiCad.
    const out = moveSheetPin(sch, refA, { x: mm(65), y: mm(49) });
    expect(sideOfAngle(out.sheets[0]!.pins[0]!.angle)).toBe('top');
    expect(out.sheets[0]!.pins[0]!.at).toEqual({ x: mm(65), y: mm(50) });
  });

  it('never leaves the sheet', () => {
    for (const at of [
      { x: mm(0), y: mm(0) },
      { x: mm(200), y: mm(200) },
      { x: mm(65), y: mm(60) },
    ]) {
      const p = moveSheetPin(sch, refA, at).sheets[0]!.pins[0]!.at;
      expect(p.x).toBeGreaterThanOrEqual(mm(50));
      expect(p.x).toBeLessThanOrEqual(mm(80));
      expect(p.y).toBeGreaterThanOrEqual(mm(50));
      expect(p.y).toBeLessThanOrEqual(mm(70));
    }
  });

  it('brings the wire attached to it along', () => {
    // A pin that stops being connected to what it was is a silently broken
    // hierarchy, so the wire end follows.
    const out = moveSheetPin(sch, refA, { x: mm(80), y: mm(65) });
    expect(out.lines[0]!.start).toEqual({ x: mm(80), y: mm(65) });
    expect(out.lines[0]!.end).toEqual({ x: mm(90), y: mm(55) });
  });

  it('brings a no-connect along', () => {
    const refB = parseSheetPinId(sch, sheetPinId(SHEET, 1))!;
    const out = moveSheetPin(sch, refB, { x: mm(80), y: mm(68) });
    expect(out.noConnects[0]!.at).toEqual({ x: mm(80), y: mm(68) });
  });

  it('returns the same document when nothing moved', () => {
    expect(moveSheetPin(sch, refA, { x: mm(80), y: mm(55) })).toBe(sch);
  });

  it('undoes exactly', () => {
    const after = moveSheetPin(sch, refA, { x: mm(65), y: mm(49) });
    const cmd = moveSheetPinCommand(after);
    const back = cmd.invert(sch).apply(cmd.apply(sch));
    expect(back.sheets).toEqual(sch.sheets);
    expect(back.lines).toEqual(sch.lines);
  });

  it('survives a save', () => {
    const after = moveSheetPin(sch, refA, { x: mm(65), y: mm(49) });
    const back = readSchematic(parse(serializeSchematic(after)));
    expect(back.sheets[0]!.pins[0]!.at).toEqual(after.sheets[0]!.pins[0]!.at);
    expect(back.sheets[0]!.pins[0]!.angle).toBe(after.sheets[0]!.pins[0]!.angle);
  });
});

describe('deleting a sheet pin', () => {
  it('removes it and puts it back in place on undo', () => {
    const cmd = deleteSheetPin(refA);
    const out = cmd.apply(sch);
    expect(out.sheets[0]!.pins.map((p) => p.name)).toEqual(['B']);
    const back = cmd.invert(sch).apply(out);
    expect(back.sheets[0]!.pins.map((p) => p.name)).toEqual(['A', 'B']);
  });
});
