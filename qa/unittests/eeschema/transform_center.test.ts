// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * *Which point* a rotate or a mirror turns about — audit findings 4, 5 and 6.
 *
 * The other transform suites hand `transformItems` an explicit centre so their
 * assertions are exact. That is exactly what hid these three defects: the centre
 * is chosen by `SCH_EDIT_TOOL::Rotate` (sch_edit_tool.cpp:1004-1010, :1171) and
 * `::Mirror` (:1404, :1417), and none of it ran under a test. **Nothing in this
 * file may pass a centre.**
 *
 * Upstream has two entirely separate answers:
 *
 *  - one item: a connectable item turns about its own `GetPosition()`, anything
 *    else about the half-grid-snapped centre of its bounding box — and then
 *    several types override that in their own `case`;
 *  - more than one: `GetNearestHalfGridPosition( selection.GetCenter() )`, where
 *    `SELECTION::GetCenter` (common/tool/selection.cpp:92) merges bounding
 *    boxes, excludes text, and falls back to the mean of positions.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { transformItems, type TransformOp } from '@ziroeda/eeschema/src/tools/transform.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const GRID = mmToIU(1.27);
const HALF = GRID / 2;

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** No centre argument, ever: the centre is the thing under test. */
const run = (d: Schematic, ids: Set<string>, op: TransformOp): Schematic =>
  transformItems(ids, op).apply(d);

const onGrid = (n: number): boolean => Number.isInteger(n / GRID);

describe('finding 6 — a lone graphic turns about itself, not about the page origin', () => {
  // `selectionPoints` never read doc.graphics, so the centre came out {0,0} and
  // a rectangle on the far side of an A4 sheet swung across the whole page.
  // 25.4 x 12.7 mm at the origin: its centre lands exactly on the half grid, so
  // the snap is not what the assertion is measuring.
  const rect = () =>
    sheet(
      `(rectangle (start 0 0) (end 25.4 12.7)
         (stroke (width 0.254) (type default)) (fill (type none)) (uuid "g-1"))`,
    );
  const ids = new Set([refId('graphic', undefined, 0)]);

  it('keeps the shape centred where it was', () => {
    const d = rect();
    const after = run(d, ids, 'rotateCW');
    const g = after.graphics[0]!;
    if (g.kind !== 'rectangle') throw new Error('fixture');
    expect({ x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 }).toEqual({
      x: mmToIU(12.7),
      y: mmToIU(6.35),
    });
  });

  it('is a real quarter turn, not a translation to the origin', () => {
    const d = rect();
    const after = run(d, ids, 'rotateCW');
    const g = after.graphics[0]!;
    if (g.kind !== 'rectangle') throw new Error('fixture');
    // About {0,0} the rectangle would have landed with a negative left edge.
    expect(g.start.x).toBeGreaterThan(0);
    expect(g.end.x - g.start.x).toBe(mmToIU(12.7));
    expect(g.end.y - g.start.y).toBe(mmToIU(25.4));
  });
});

describe('finding 5 — one item, one rule per type', () => {
  it('a wire rotates about its far endpoint, not its middle', () => {
    // "if( line->HasFlag( STARTPOINT ) ) rotPoint = line->GetEndPoint();"
    // (sch_edit_tool.cpp:1064-1077). Undo clears both flags, so the tool sets
    // both and the first arm wins.
    const d = sheet(`(wire (pts (xy 0 0) (xy 12.7 0)) (uuid "w-1"))`);
    const ids = new Set([refId('line', 'w-1', 0)]);
    const after = run(d, ids, 'rotateCW');
    expect(after.lines[0]!.end).toEqual(d.lines[0]!.end);
    // Clockwise about (12.7, 0): (0,0) -> (12.7, -12.7).
    expect(after.lines[0]!.start).toEqual({ x: mmToIU(12.7), y: mmToIU(-12.7) });
  });

  it('a wire mirrors about its start point, which is its GetPosition()', () => {
    // The mirror switch has no SCH_LINE_T case, so it falls to `default:`
    // `item->MirrorHorizontally( item->GetPosition().x )` (:1404), and
    // SCH_LINE::GetPosition() is m_start — a different point from the rotate's.
    const d = sheet(`(wire (pts (xy 0 0) (xy 12.7 0)) (uuid "w-1"))`);
    const ids = new Set([refId('line', 'w-1', 0)]);
    const after = run(d, ids, 'mirrorY');
    expect(after.lines[0]!.start).toEqual(d.lines[0]!.start);
    expect(after.lines[0]!.end).toEqual({ x: mmToIU(-12.7), y: 0 });
  });

  it('a bus entry turns about its anchor, not about the middle of its stub', () => {
    // Connectable, so rotPoint is GetPosition() = m_pos. Taking the box centre
    // walked the anchor half a stub sideways on every press of R.
    const d = sheet(
      `(bus_entry (at 25.4 25.4) (size 2.54 2.54) (stroke (width 0) (type default)) (uuid "be-1"))`,
    );
    const ids = new Set([refId('busentry', 'be-1', 0)]);
    const after = run(d, ids, 'rotateCW');
    expect(after.busEntries[0]!.at).toEqual(d.busEntries[0]!.at);
    expect(after.busEntries[0]!.size).toEqual({ x: -mmToIU(2.54), y: mmToIU(2.54) });
  });

  it('a text box turns about the snapped centre of its box, not its corner', () => {
    // Not connectable, so `GetNearestHalfGridPosition( GetBoundingBox().GetCenter() )`.
    const d = sheet(
      `(text_box "n" (at 0 0 0) (size 25.4 12.7)
         (stroke (width 0) (type solid)) (fill (type none))
         (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb-1"))`,
    );
    const ids = new Set([refId('textbox', 'tb-1', 0)]);
    const after = run(d, ids, 'rotateCW');
    const t = after.textBoxes[0]!;
    expect({ x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 }).toEqual({
      x: mmToIU(12.7),
      y: mmToIU(6.35),
    });
  });

  it('a text box mirrors about its own corner, which is its GetPosition()', () => {
    const d = sheet(
      `(text_box "n" (at 0 0 0) (size 25.4 12.7)
         (stroke (width 0) (type solid)) (fill (type none))
         (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb-1"))`,
    );
    const ids = new Set([refId('textbox', 'tb-1', 0)]);
    const after = run(d, ids, 'mirrorY');
    // MIRROR about x = 0 puts the box entirely on the negative side.
    expect(after.textBoxes[0]!.start.x).toBe(-mmToIU(25.4));
    expect(after.textBoxes[0]!.end.x).toBe(0);
  });
});

describe('finding 4 — the group centre', () => {
  it('is half-grid snapped, so on-grid items stay on the grid', () => {
    // A tiny off-grid shape drags the raw box centre off both grids. Upstream
    // snaps it (`GetNearestHalfGridPosition`, eda_draw_frame.cpp:1098); we did
    // not, so a group rotate left every wire end a fraction off the grid and
    // the pins they were drawn to no longer met them.
    const d = sheet(
      [
        `(junction (at 0 0) (uuid "j-1"))`,
        `(rectangle (start 0 0) (end 0.5 0.5)
           (stroke (width 0.254) (type default)) (fill (type none)) (uuid "g-1"))`,
      ].join('\n'),
    );
    const ids = new Set([refId('junction', 'j-1', 0), refId('graphic', undefined, 0)]);
    const after = run(d, ids, 'rotateCW');
    const at = after.junctions[0]!.at;
    expect(onGrid(at.x) && onGrid(at.y)).toBe(true);
    // The raw centre is (0.25, 0.25) mm, which snaps to the origin.
    expect(at).toEqual({ x: 0, y: 0 });
  });

  it('never lands the centre off the half grid', () => {
    const d = sheet(
      [
        `(junction (at 0 0) (uuid "j-1"))`,
        `(text_box "n" (at 3.1 7.3 0) (size 5.7 2.9)
           (stroke (width 0) (type solid)) (fill (type none))
           (effects (font (size 1.27 1.27))) (uuid "tb-1"))`,
      ].join('\n'),
    );
    const ids = new Set([refId('junction', 'j-1', 0), refId('textbox', 'tb-1', 0)]);
    for (const op of ['rotateCW', 'rotateCCW', 'mirrorX', 'mirrorY'] as const) {
      const at = run(d, ids, op).junctions[0]!.at;
      // Reflecting or turning an on-grid point about a half-grid centre lands
      // on the half grid; about anything else it does not.
      expect(Number.isInteger(at.x / HALF) && Number.isInteger(at.y / HALF), op).toBe(true);
    }
  });

  it('merges bounding boxes, so an item wider than its anchor counts', () => {
    // `SELECTION::GetCenter` merges `GetBoundingBox()`. We merged anchor points,
    // so two items sharing an anchor had no extent at all between them.
    const d = sheet(
      [
        `(junction (at 0 0) (uuid "j-1"))`,
        `(rectangle (start 0 0) (end 25.4 0)
           (stroke (width 0.254) (type default)) (fill (type none)) (uuid "g-1"))`,
      ].join('\n'),
    );
    const ids = new Set([refId('junction', 'j-1', 0), refId('graphic', undefined, 0)]);
    const after = run(d, ids, 'mirrorY');
    // The box spans x 0..25.4, centre 12.7: the junction reflects to 25.4.
    // With anchor points alone both anchors are x=0 and it would not move.
    expect(after.junctions[0]!.at.x).toBe(mmToIU(25.4));
  });

  it('leaves labels out of the merge, so a label cannot drag the group sideways', () => {
    // "If the selection contains only texts ... Otherwise rotating the selection
    // will also translate it." A label's box is wide and one-sided, so counting
    // it moved everything else.
    const body = [
      `(junction (at 0 0) (uuid "j-1"))`,
      `(junction (at 25.4 0) (uuid "j-2"))`,
      `(label "A_VERY_LONG_NET_NAME_INDEED" (at 25.4 0 0)
         (effects (font (size 1.27 1.27)) (justify left)) (uuid "l-1"))`,
    ].join('\n');
    const d = sheet(body);
    const without = new Set([refId('junction', 'j-1', 0), refId('junction', 'j-2', 0)]);
    const with_ = new Set([...without, refId('label', 'l-1', 0)]);
    expect(run(d, with_, 'rotateCW').junctions).toEqual(run(d, without, 'rotateCW').junctions);
  });

  it('falls back to the mean of positions when the selection is all text', () => {
    const d = sheet(
      [
        `(label "A" (at 0 0 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "l-1"))`,
        `(label "B" (at 12.7 0 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "l-2"))`,
      ].join('\n'),
    );
    const ids = new Set([refId('label', 'l-1', 0), refId('label', 'l-2', 0)]);
    const after = run(d, ids, 'rotateCW');
    // Mean of (0,0) and (12.7,0) is (6.35,0), already on the half grid.
    // Clockwise about it: (0,0) -> (6.35, -6.35) and (12.7,0) -> (6.35, 6.35).
    expect(after.labels[0]!.at).toEqual({ x: mmToIU(6.35), y: mmToIU(-6.35) });
    expect(after.labels[1]!.at).toEqual({ x: mmToIU(6.35), y: mmToIU(6.35) });
  });
});
