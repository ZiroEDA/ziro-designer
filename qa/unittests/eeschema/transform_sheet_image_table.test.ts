// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three kinds R, X and Y did nothing whatever to — audit finding 7.
 *
 * All three are selectable (`hittest.ts:444/503/488`), all three appear in
 * `SCH_EDIT_TOOL::Rotate`'s and `::Mirror`'s switch, and `transformItems` had no
 * arm for any of them. `transform.ts` even promoted a selected table *cell* to
 * its table, into a branch that then ignored tables.
 *
 * Counterparts: `SCH_SHEET::Rotate` / `::MirrorVertically` / `::MirrorHorizontally`
 * (sch_sheet.cpp:1070/1112/1132), `SCH_SHEET_PIN::Rotate` (sch_sheet_pin.cpp:250),
 * `SCH_BITMAP` (sch_bitmap.cpp:123/129/135) and `SCH_TABLE::Rotate`
 * (sch_table.cpp:226).
 *
 * No test here passes an explicit centre: which point each kind turns about is
 * half of what is being checked.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { serializeSchematic } from '@ziroeda/eeschema';
import { transformItems, type TransformOp } from '@ziroeda/eeschema/src/tools/transform.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { tableCellId } from '@ziroeda/eeschema/src/tools/table_cells.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const mm = mmToIU;
const doc = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));
const run = (d: Schematic, ids: Set<string>, op: TransformOp): Schematic =>
  transformItems(ids, op).apply(d);

/**
 * 25.4 x 12.7 mm at the origin, so its centre (12.7, 6.35) already sits on the
 * half grid and the assertions read as pure geometry rather than as snapping.
 */
const SHEET = `(sheet (at 0 0) (size 25.4 12.7) (stroke (width 0) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh-1")
    (property "Sheetname" "sub" (at 0 -1 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 0 14 0) (effects (font (size 1.27 1.27))))
    (pin "IN" input (at 0 5.08 180) (uuid "p-1")
      (effects (font (size 1.27 1.27)) (justify right))))`;

const sheetIds = new Set([refId('sheet', 'sh-1', 0)]);

describe('a sheet', () => {
  it('rotates: the size vector turns with it and a negative extent renormalises', () => {
    // `RotatePoint( &m_size.x, &m_size.y, … )` then
    // "if( m_size.x < 0 ) { m_pos.x += m_size.x; m_size.x = -m_size.x; }".
    const d = doc(SHEET);
    const after = run(d, sheetIds, 'rotateCW').sheets[0]!;
    expect(after.size).toEqual({ w: mm(12.7), h: mm(25.4) });
    expect(after.at).toEqual({ x: mm(6.35), y: mm(-6.35) });
  });

  it('rotates about its own body centre, so it stays where it was drawn', () => {
    // `GetNearestHalfGridPosition( sheet->GetRotationCenter() )`, and
    // GetRotationCenter is BOX2I( m_pos, m_size ).GetCenter() (sch_sheet.cpp:854).
    const d = doc(SHEET);
    const after = run(d, sheetIds, 'rotateCW').sheets[0]!;
    expect({
      x: after.at.x + after.size.w / 2,
      y: after.at.y + after.size.h / 2,
    }).toEqual({ x: mm(12.7), y: mm(6.35) });
  });

  it('rotates its pins onto whichever border they land nearest', () => {
    // "Pins must be rotated first as that's how we determine vertical vs
    // horizontal orientation for auto-placement", then ConstrainOnEdge.
    const d = doc(SHEET);
    const pin = run(d, sheetIds, 'rotateCW').sheets[0]!.pins[0]!;
    // Left edge, a quarter turn clockwise, is the top edge; 90 is the file's
    // encoding for TOP (getSheetPinAngle, sch_io_kicad_sexpr_common.cpp:187).
    expect(pin.angle).toBe(90);
    expect(pin.at).toEqual({ x: mm(13.97), y: mm(-6.35) });
  });

  it('drags its fields along by the sheet‘s own delta, not about the centre', () => {
    // The AUTOPLACE arm is unmodelled, so this is upstream's else arm: "Move the
    // fields to the new position because the parent itself has moved."
    const d = doc(SHEET);
    const before = d.sheets[0]!;
    const after = run(d, sheetIds, 'rotateCW').sheets[0]!;
    const dx = after.at.x - before.at.x;
    const dy = after.at.y - before.at.y;
    expect(after.fields[0]!.at).toEqual({
      x: before.fields[0]!.at!.x + dx,
      y: before.fields[0]!.at!.y + dy,
    });
  });

  it('four turns are the identity', () => {
    let d = doc(SHEET);
    for (let i = 0; i < 4; i++) d = run(d, sheetIds, 'rotateCW');
    expect(d.sheets[0]!.at).toEqual({ x: 0, y: 0 });
    expect(d.sheets[0]!.size).toEqual({ w: mm(25.4), h: mm(12.7) });
    expect(d.sheets[0]!.pins[0]!.angle).toBe(180);
    expect(d.sheets[0]!.pins[0]!.at).toEqual({ x: 0, y: mm(5.08) });
  });

  it('mirrors its pins to the far side, keeping the body where it was', () => {
    // A rectangle mirrored about its own centre is itself; what actually moves
    // is the pins (SCH_SHEET_PIN::MirrorHorizontally swaps LEFT and RIGHT and
    // SetSide plants the pin on that edge).
    const d = doc(SHEET);
    const after = run(d, sheetIds, 'mirrorY').sheets[0]!;
    expect(after.at).toEqual({ x: 0, y: 0 });
    expect(after.pins[0]!.angle).toBe(0); // RIGHT
    expect(after.pins[0]!.at).toEqual({ x: mm(25.4), y: mm(5.08) });
  });

  it('did nothing at all before: every op now changes it', () => {
    const d = doc(SHEET);
    for (const op of ['rotateCW', 'rotateCCW', 'mirrorX', 'mirrorY'] as const) {
      expect(run(d, sheetIds, op).sheets[0], op).not.toEqual(d.sheets[0]);
    }
  });

  it('reaches the file', () => {
    const d = doc(SHEET);
    const text = serializeSchematic(run(d, sheetIds, 'rotateCW'));
    const back = readSchematic(parse(text));
    expect(back.sheets[0]!.size).toEqual({ w: mm(12.7), h: mm(25.4) });
    expect(back.sheets[0]!.pins[0]!.angle).toBe(90);
  });
});

describe('an image', () => {
  // A 1x1 PNG: only the position is under test, and only the position is
  // portable — upstream also rewrites the pixels (BITMAP_BASE::Rotate).
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const IMG = [
    `(wire (pts (xy 0 0) (xy 25.4 0)) (uuid "w-1"))`,
    `(image (at 0 0) (scale 1) (uuid "im-1") (data "${PNG}"))`,
  ].join('\n');
  const ids = new Set([refId('image', 'im-1', 0), refId('line', 'w-1', 0)]);

  it('travels with the group instead of standing still', () => {
    // `REFERENCE_IMAGE::Flip` mirrors m_pos about the centre
    // (reference_image.cpp:268); ours simply had no images arm.
    const d = doc(IMG);
    const after = run(d, ids, 'mirrorY');
    // The wire spans x 0..25.4, so the group centre is 12.7 and 0 reflects to 25.4.
    expect(after.images[0]!.at).toEqual({ x: mm(25.4), y: 0 });
    expect(after.images[0]!.at).not.toEqual(d.images[0]!.at);
  });

  it('rotates with the group', () => {
    const d = doc(IMG);
    const after = run(d, ids, 'rotateCW');
    expect(after.images[0]!.at).toEqual({ x: mm(12.7), y: mm(-12.7) });
  });
});

describe('a table', () => {
  // Two columns wide so a quarter turn is visible in the geometry.
  const TABLE = `(table (column_count 2) (border (external yes) (header no))
      (separators (rows no) (cols no))
      (column_widths 12.7 12.7) (row_heights 12.7) (uuid "t-1")
      (cells
        (table_cell "a" (at 0 0 0) (size 12.7 12.7)
          (fill (type none)) (effects (font (size 1.27 1.27))) (uuid "c-1"))
        (table_cell "b" (at 12.7 0 0) (size 12.7 12.7)
          (fill (type none)) (effects (font (size 1.27 1.27))) (uuid "c-2"))))`;
  const ids = new Set([refId('table', 't-1', 0)]);

  it('rotates: every cell turns and takes the text angle with it', () => {
    // `SCH_TABLE::Rotate` is "rotate every cell, then Normalize()", and the
    // rotation is recorded nowhere but in the cells' text angle — which is why
    // SchTableCell had to grow one.
    const d = doc(TABLE);
    const after = run(d, ids, 'rotateCW').tables[0]!;
    expect(after.cells.map((c) => c.angle)).toEqual([90, 90]);
    expect(after).not.toEqual(d.tables[0]);
  });

  it('rotates: the second cell moves off the first along the other axis', () => {
    const d = doc(TABLE);
    const after = run(d, ids, 'rotateCW').tables[0]!;
    const a = after.cells[0]!;
    const b = after.cells[1]!;
    expect(a.start.x).toBe(b.start.x);
    expect(a.start.y).not.toBe(b.start.y);
  });

  it('four turns are the identity', () => {
    let d = doc(TABLE);
    for (let i = 0; i < 4; i++) d = run(d, ids, 'rotateCW');
    expect(d.tables[0]!.cells.map((c) => c.angle ?? 0)).toEqual([0, 0]);
    expect(d.tables[0]!.cells.map((c) => c.start)).toEqual([
      { x: 0, y: 0 },
      { x: mm(12.7), y: 0 },
    ]);
  });

  it('does not mirror, exactly as upstream declines to', () => {
    // "We could mirror all the cells, but it doesn't seem useful...."
    // (sch_table.cpp:213/219). Keeping that is the parity, not a gap.
    const d = doc(TABLE);
    for (const op of ['mirrorX', 'mirrorY'] as const) {
      expect(run(d, ids, op).tables[0], op).toBe(d.tables[0]);
    }
  });

  it('a selected cell still stands for its table, and now the table turns', () => {
    // transform.ts already promoted a cell selection to its table id, into a
    // branch that ignored tables.
    const d = doc(TABLE);
    const after = run(d, new Set([tableCellId(refId('table', 't-1', 0), 0)]), 'rotateCW')
      .tables[0]!;
    expect(after.cells[0]!.angle).toBe(90);
  });

  it('reaches the file — the angle is what survives the round trip', () => {
    const d = doc(TABLE);
    const text = serializeSchematic(run(d, ids, 'rotateCW'));
    expect(text).toContain('90');
    const back = readSchematic(parse(text));
    expect(back.tables[0]!.cells.map((c) => c.angle)).toEqual([90, 90]);
    // Without the angle in the file, re-reading and re-laying-out would put the
    // table back the way it started.
    expect(back.tables[0]!.cells[0]!.start).toEqual(
      readSchematic(parse(serializeSchematic(run(d, ids, 'rotateCW')))).tables[0]!.cells[0]!.start,
    );
  });

  it('an unrotated table is still byte-stable through the writer', () => {
    const d = doc(TABLE);
    expect(serializeSchematic(d)).toBe(
      serializeSchematic(readSchematic(parse(serializeSchematic(d)))),
    );
  });
});
