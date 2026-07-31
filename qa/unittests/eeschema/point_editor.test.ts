// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The handles a selected item carries, and what dragging one does.
 *
 * Counterpart: `eeschema/tools/sch_point_editor.cpp`. The cases that matter are
 * the ones where a drag does more than move the point you grabbed: a corner
 * pushes its two neighbours, an edge carries both of its ends, a sheet cannot
 * close over its own pins, and everything anchored to a sheet pin follows it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  pointEditTarget,
  editHandles,
  dragHandle,
  reshapeCommand,
  type EditHandle,
} from '@ziroeda/eeschema/src/tools/point_editor.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const mm = (v: number): number => mmToIU(v);

/** A sheet 30 x 20 at (50,50) with two pins on its right edge, a wire on one of
 *  them and a no-connect on the other; plus a rectangle, a circle and a
 *  polyline. */
const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  (sheet (at 50 50) (size 30 20) (uuid "sh1")
    (property "Sheetname" "Sub" (at 50 49.4 0))
    (property "Sheetfile" "sub.kicad_sch" (at 50 70.6 0))
    (pin "A" input (at 80 55 0) (uuid "sp1"))
    (pin "B" input (at 80 60 0) (uuid "sp2")))
  (wire (pts (xy 80 55) (xy 90 55)) (uuid "w1"))
  (no_connect (at 80 60) (uuid "nc1"))
  (rectangle (start 10 10) (end 30 20) (uuid "r1"))
  (circle (center 50 10) (radius 5) (uuid "c1"))
  (polyline (pts (xy 10 40) (xy 20 40) (xy 20 50)) (uuid "p1"))
  (text_box "hello" (at 100 10 0) (size 20 10) (uuid "tb1"))
)`;

const sch = readSchematic(parse(DOC));

const targetOf = (id: string) => {
  const t = pointEditTarget(sch, id);
  expect(t, `no point-edit target for ${id}`).not.toBeNull();
  return t!;
};

const SHEET_ID = refId('sheet', sch.sheets[0]?.uuid, 0);
const RECT_ID = refId('graphic', undefined, 0);
const CIRCLE_ID = refId('graphic', undefined, 1);
const WIRE_ID = refId('line', sch.lines[0]?.uuid, 0);
const POLY_ID = refId('line', sch.lines[1]?.uuid, 1);
const TEXTBOX_ID = refId('textbox', sch.textBoxes[0]?.uuid, 0);

/** The handle of `kind` at `index`, as the canvas would have hit-tested it. */
function handle(id: string, kind: 'point' | 'line', index: number): EditHandle {
  const h = editHandles(sch, targetOf(id)).find((x) => x.kind === kind && x.index === index);
  expect(h, `no ${kind} handle ${index}`).toBeDefined();
  return h!;
}

describe('which items have handles', () => {
  it('gives them to the kinds SCH_POINT_EDITOR edits', () => {
    expect(pointEditTarget(sch, SHEET_ID)?.kind).toBe('sheet');
    expect(pointEditTarget(sch, RECT_ID)?.kind).toBe('graphic');
    expect(pointEditTarget(sch, WIRE_ID)?.kind).toBe('line');
    expect(pointEditTarget(sch, TEXTBOX_ID)?.kind).toBe('textbox');
  });

  it('gives none to anything else', () => {
    expect(pointEditTarget(sch, 'nc1')).toBeNull();
    expect(pointEditTarget(sch, 'no-such-item')).toBeNull();
  });

  it('puts a square on each corner and a circle on each edge midpoint', () => {
    // SHEET_POINT_EDIT_BEHAVIOR::MakePoints: four points, four lines, no centre.
    const hs = editHandles(sch, targetOf(SHEET_ID));
    expect(hs.filter((h) => h.kind === 'point')).toHaveLength(4);
    expect(hs.filter((h) => h.kind === 'line')).toHaveLength(4);
    expect(handle(SHEET_ID, 'point', 0).at).toEqual({ x: mm(50), y: mm(50) });
    expect(handle(SHEET_ID, 'point', 3).at).toEqual({ x: mm(80), y: mm(70) });
    // RECT_RIGHT's midpoint.
    expect(handle(SHEET_ID, 'line', 1).at).toEqual({ x: mm(80), y: mm(60) });
  });

  it('gives a rectangle a centre handle, which a sheet does not get', () => {
    // RECTANGLE_POINT_EDIT_BEHAVIOR adds RECT_CENTER; a sheet is dragged by its
    // body instead, so SHEET_POINT_EDIT_BEHAVIOR omits it.
    expect(handle(RECT_ID, 'point', 4).at).toEqual({ x: mm(20), y: mm(15) });
    expect(editHandles(sch, targetOf(SHEET_ID)).some((h) => h.index === 4)).toBe(false);
  });

  it('gives a polyline one handle per vertex', () => {
    const hs = editHandles(sch, targetOf(POLY_ID));
    expect(hs.map((h) => h.at)).toEqual([
      { x: mm(10), y: mm(40) },
      { x: mm(20), y: mm(40) },
      { x: mm(20), y: mm(50) },
    ]);
  });
});

describe('rectangles', () => {
  it('pushes the two neighbouring corners when one is dragged', () => {
    // PinEditedCorner: dragging the top-left takes the top-right's y and the
    // bottom-left's x with it, so the shape stays a rectangle.
    const out = dragHandle(sch, targetOf(RECT_ID), handle(RECT_ID, 'point', 0), {
      x: mm(5),
      y: mm(2),
    });
    const g = out.graphics[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect(g.start).toEqual({ x: mm(5), y: mm(2) });
    expect(g.end).toEqual({ x: mm(30), y: mm(20) });
  });

  it('moves only its own side when an edge is dragged', () => {
    // EC_PERPLINE: the right edge slides along its normal, so x changes and the
    // top and bottom stay where they were.
    const out = dragHandle(sch, targetOf(RECT_ID), handle(RECT_ID, 'line', 1), {
      x: mm(45),
      y: mm(99),
    });
    const g = out.graphics[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect(g.start).toEqual({ x: mm(10), y: mm(10) });
    expect(g.end).toEqual({ x: mm(45), y: mm(20) });
  });

  it('translates from the centre handle without resizing', () => {
    const out = dragHandle(sch, targetOf(RECT_ID), handle(RECT_ID, 'point', 4), {
      x: mm(120),
      y: mm(115),
    });
    const g = out.graphics[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect(g.start).toEqual({ x: mm(110), y: mm(110) });
    expect(g.end).toEqual({ x: mm(130), y: mm(120) });
  });

  it('will not let a corner cross the one opposite it', () => {
    // Dragged well past the bottom-right; PinEditedCorner pins it one mil short.
    const out = dragHandle(sch, targetOf(RECT_ID), handle(RECT_ID, 'point', 0), {
      x: mm(500),
      y: mm(500),
    });
    const g = out.graphics[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect(g.start.x).toBe(mm(30) - mmToIU(0.0254));
    expect(g.start.y).toBe(mm(20) - mmToIU(0.0254));
  });
});

describe('circles', () => {
  it('moves the circle from its centre handle', () => {
    const out = dragHandle(sch, targetOf(CIRCLE_ID), handle(CIRCLE_ID, 'point', 0), {
      x: mm(70),
      y: mm(30),
    });
    const g = out.graphics[1] as { center: { x: number; y: number }; radius: number };
    expect(g.center).toEqual({ x: mm(70), y: mm(30) });
    expect(g.radius).toBe(mm(5));
  });

  it('sets the radius from the distance to the centre', () => {
    // EDA_SHAPE::SetEnd on a circle keeps the centre and takes the radius from
    // the new end, wherever around the circle it is dropped.
    const out = dragHandle(sch, targetOf(CIRCLE_ID), handle(CIRCLE_ID, 'point', 1), {
      x: mm(50),
      y: mm(22),
    });
    const g = out.graphics[1] as { center: { x: number; y: number }; radius: number };
    expect(g.center).toEqual({ x: mm(50), y: mm(10) });
    expect(g.radius).toBe(mm(12));
  });
});

describe('lines', () => {
  it('drags a wire endpoint on its own', () => {
    const out = dragHandle(sch, targetOf(WIRE_ID), handle(WIRE_ID, 'point', 1), {
      x: mm(95),
      y: mm(65),
    });
    expect(out.lines[0]!.start).toEqual({ x: mm(80), y: mm(55) });
    expect(out.lines[0]!.end).toEqual({ x: mm(95), y: mm(65) });
  });

  it('drags one polyline vertex, leaving the rest', () => {
    const out = dragHandle(sch, targetOf(POLY_ID), handle(POLY_ID, 'point', 1), {
      x: mm(25),
      y: mm(35),
    });
    expect(out.lines[1]!.points).toEqual([
      { x: mm(10), y: mm(40) },
      { x: mm(25), y: mm(35) },
      { x: mm(20), y: mm(50) },
    ]);
    // start/end track the ends of the vertex list.
    expect(out.lines[1]!.start).toEqual({ x: mm(10), y: mm(40) });
    expect(out.lines[1]!.end).toEqual({ x: mm(20), y: mm(50) });
  });
});

describe('text boxes', () => {
  it('will not shrink below the height its text needs', () => {
    // TEXTBOX_POINT_EDIT_BEHAVIOR floors the drag at SCH_TEXTBOX::GetMinSize.
    const before = sch.textBoxes[0]!;
    const out = dragHandle(sch, targetOf(TEXTBOX_ID), handle(TEXTBOX_ID, 'line', 2), {
      x: mm(0),
      y: mm(10),
    });
    const after = out.textBoxes[0]!;
    expect(after.end.y).toBeGreaterThan(before.start.y);
    expect(after.end.y - after.start.y).toBeGreaterThan(0);
  });
});

describe('sheets', () => {
  const sheetTarget = () => targetOf(SHEET_ID);

  it('resizes from a corner', () => {
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'point', 3), {
      x: mm(100),
      y: mm(90),
    });
    expect(out.sheets[0]!.at).toEqual({ x: mm(50), y: mm(50) });
    expect(out.sheets[0]!.size).toEqual({ w: mm(50), h: mm(40) });
  });

  it('changes only the width when the right edge is dragged', () => {
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'line', 1), {
      x: mm(100),
      y: mm(0),
    });
    expect(out.sheets[0]!.size).toEqual({ w: mm(50), h: mm(20) });
    expect(out.sheets[0]!.at).toEqual({ x: mm(50), y: mm(50) });
  });

  it('moves its fields when the top-left corner is dragged', () => {
    // SetPositionIgnoringPins: the fields travel with the sheet body, the pins
    // do not, because Resize is about to place them on the new edges.
    const before = sch.sheets[0]!.fields[0]!.at!;
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'point', 0), {
      x: mm(40),
      y: mm(45),
    });
    expect(out.sheets[0]!.fields[0]!.at).toEqual({ x: before.x - mm(10), y: before.y - mm(5) });
  });

  it('keeps its pins on their own edge', () => {
    // SCH_SHEET_PIN::ConstrainOnEdge: both pins are on the right edge, so both
    // follow it out to the new x while keeping their y.
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'line', 1), {
      x: mm(100),
      y: mm(0),
    });
    expect(out.sheets[0]!.pins.map((p) => p.at)).toEqual([
      { x: mm(100), y: mm(55) },
      { x: mm(100), y: mm(60) },
    ]);
  });

  it('clamps a pin that the new edge has moved past', () => {
    // Shrinking the sheet from the bottom pulls the bottom edge above the pins,
    // so their along-edge coordinate is clamped into the new bounds.
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'line', 2), {
      x: mm(0),
      y: mm(56),
    });
    const bottom = out.sheets[0]!.at.y + out.sheets[0]!.size.h;
    for (const p of out.sheets[0]!.pins) expect(p.at.y).toBeLessThanOrEqual(bottom);
  });

  it('drags a wire connected to a sheet pin along with it', () => {
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'line', 1), {
      x: mm(100),
      y: mm(0),
    });
    // The wire started on pin A at (80,55); the far end is untouched.
    expect(out.lines[0]!.start).toEqual({ x: mm(100), y: mm(55) });
    expect(out.lines[0]!.end).toEqual({ x: mm(90), y: mm(55) });
  });

  it('drags a no-connect on a sheet pin along with it', () => {
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'line', 1), {
      x: mm(100),
      y: mm(0),
    });
    expect(out.noConnects[0]!.at).toEqual({ x: mm(100), y: mm(60) });
  });

  it('will not close over its own pins', () => {
    // GetMinHeight: both pins are on the right edge, so they floor the height,
    // at their extent bumped out to the next 50 mil grid line. The width has no
    // pins on the top or bottom edges to hold it, so it falls back to
    // MIN_SHEET_WIDTH (sch_sheet.h, 500 mils).
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'point', 3), {
      x: mm(50),
      y: mm(50),
    });
    expect(out.sheets[0]!.size.w).toBe(mmToIU(500 * 0.0254));
    const pinFloor = out.sheets[0]!.pins.reduce((m, p) => Math.max(m, p.at.y), 0) - mm(50);
    expect(out.sheets[0]!.size.h).toBeGreaterThanOrEqual(pinFloor);
    expect(out.sheets[0]!.size.h).toBeGreaterThan(mmToIU(150 * 0.0254));
  });

  it('falls back to MIN_SHEET_HEIGHT when no pin holds it', () => {
    const bare = readSchematic(
      parse('(kicad_sch (version 1) (lib_symbols) (sheet (at 50 50) (size 30 20) (uuid "s")))'),
    );
    const t = pointEditTarget(bare, refId('sheet', 's', 0))!;
    const h = editHandles(bare, t).find((x) => x.kind === 'point' && x.index === 3)!;
    const out = dragHandle(bare, t, h, { x: mm(50), y: mm(50) });
    expect(out.sheets[0]!.size).toEqual({
      w: mmToIU(500 * 0.0254),
      h: mmToIU(150 * 0.0254),
    });
  });

  it('leaves the document alone when the drag changes nothing', () => {
    // A drag runs on every pointer event, so a no-op frame must not make the
    // document look changed to anything comparing by identity.
    const out = dragHandle(sch, sheetTarget(), handle(SHEET_ID, 'line', 1), {
      x: mm(80),
      y: mm(0),
    });
    expect(out).toBe(sch);
  });
});

describe('the undo record', () => {
  it('puts every reshaped item back exactly', () => {
    const after = dragHandle(sch, targetOf(SHEET_ID), handle(SHEET_ID, 'line', 1), {
      x: mm(100),
      y: mm(0),
    });
    const cmd = reshapeCommand('Resize Sheet', after);
    const back = cmd.invert(sch).apply(cmd.apply(sch));
    expect(back.sheets).toEqual(sch.sheets);
    expect(back.lines).toEqual(sch.lines);
    expect(back.noConnects).toEqual(sch.noConnects);
  });

  it('touches only the arrays the reshape changed', () => {
    const after = dragHandle(sch, targetOf(RECT_ID), handle(RECT_ID, 'line', 1), {
      x: mm(45),
      y: mm(0),
    });
    const out = reshapeCommand('Drag Corner', after).apply(sch);
    expect(out.graphics).not.toBe(sch.graphics);
    expect(out.sheets).toBe(sch.sheets);
    expect(out.lines).toBe(sch.lines);
    expect(out.symbols).toBe(sch.symbols);
  });
});

describe('reshapes survive a save', () => {
  it('round-trips a sheet resize, a rectangle and a circle', () => {
    let out = dragHandle(sch, targetOf(SHEET_ID), handle(SHEET_ID, 'point', 3), {
      x: mm(100),
      y: mm(90),
    });
    out = dragHandle(out, targetOf(RECT_ID), handle(RECT_ID, 'line', 1), { x: mm(45), y: mm(0) });
    out = dragHandle(out, targetOf(CIRCLE_ID), handle(CIRCLE_ID, 'point', 1), {
      x: mm(50),
      y: mm(22),
    });

    const reread = readSchematic(parse(serializeSchematic(out)));
    expect(reread.sheets[0]!.size).toEqual({ w: mm(50), h: mm(40) });
    expect((reread.graphics[0] as { end: { x: number } }).end.x).toBe(mm(45));
    expect((reread.graphics[1] as { radius: number }).radius).toBe(mm(12));
  });
});
