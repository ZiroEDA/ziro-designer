// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Break Wire and Slice, counterparts SCH_MOVE_TOOL::preprocessBreakOrSliceSelection,
 * SCH_LINE_WIRE_BUS_TOOL::BreakSegment and SCH_LINE::BreakAt.
 *
 * The split itself is the same for both actions; what differs is which halves
 * the following drag carries, and that is what makes one "connected segments"
 * and the other "unconnected".
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  planBreakWire,
  breakableLines,
  brokenHalf,
  segmentMidPoint,
} from '@ziroeda/eeschema/src/tools/break_wire.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });

const wire = (uuid: string, a: Vec2, b: Vec2, kind = 'wire'): string =>
  `(${kind} (pts (xy ${iuToMM(a.x)} ${iuToMM(a.y)}) (xy ${iuToMM(b.x)} ${iuToMM(b.y)}))
     (stroke (width 0) (type default)) (uuid "${uuid}"))`;

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const lineId = (d: Schematic, i: number): string => refId('line', d.lines[i]!.uuid, i);

/** One horizontal wire from 0,0 to 10,0. */
const oneWire = (): Schematic => sheet(wire('w1', at(0, 0), at(10, 0)));

describe('the midpoint', () => {
  it('is the average of the two ends', () => {
    const d = oneWire();
    expect(segmentMidPoint(d.lines[0]!)).toEqual(at(5, 0));
  });

  it('rounds rather than truncating, so an odd span stays on an integer IU', () => {
    const d = sheet(wire('w1', { x: 0, y: 0 }, { x: 3, y: 3 }));
    expect(segmentMidPoint(d.lines[0]!)).toEqual({ x: 2, y: 2 });
  });
});

describe('choosing the segments', () => {
  it('takes only the selected lines, in document order', () => {
    const d = sheet(
      [
        wire('w1', at(0, 0), at(10, 0)),
        wire('w2', at(0, 5), at(10, 5)),
        wire('w3', at(0, 10), at(10, 10)),
      ].join('\n'),
    );
    const picked = breakableLines(d, new Set([lineId(d, 2), lineId(d, 0)]));
    expect(picked.map((p) => p.index)).toEqual([0, 2]);
  });

  it('includes buses and graphic polylines, as any SCH_LINE_T is taken', () => {
    const d = sheet(
      [wire('b1', at(0, 0), at(10, 0), 'bus'), wire('p1', at(0, 5), at(10, 5), 'polyline')].join(
        '\n',
      ),
    );
    const all = new Set([lineId(d, 0), lineId(d, 1)]);
    expect(breakableLines(d, all)).toHaveLength(2);
    expect(planBreakWire(d, all, at(5, 0), 'slice')).not.toBeNull();
  });

  it('plans nothing when the selection holds no line', () => {
    const d = oneWire();
    expect(planBreakWire(d, new Set(), at(5, 0), 'break')).toBeNull();
    expect(planBreakWire(d, new Set(['symbol:nope']), at(5, 0), 'break')).toBeNull();
  });
});

describe('the new half', () => {
  it('runs from the break to the original end, and keeps the original kind and stroke', () => {
    const d = sheet(wire('b1', at(0, 0), at(10, 0), 'bus'));
    const half = brokenHalf(d.lines[0]!, at(4, 0));
    expect(half.start).toEqual(at(4, 0));
    expect(half.end).toEqual(at(10, 0));
    expect(half.kind).toBe('bus');
    expect(half.stroke).toEqual(d.lines[0]!.stroke);
  });

  it('gets a fresh uuid, in its node as well as its model field', () => {
    const d = oneWire();
    const half = brokenHalf(d.lines[0]!, at(4, 0));
    expect(half.uuid).not.toBe(d.lines[0]!.uuid);
    // The node must carry it too, or the copy saves under the original's uuid
    // and the two come back as one item.
    const uuidNode = half.source.items.find(
      (it) => it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'uuid',
    );
    expect(uuidNode).toBeDefined();
    const written = (uuidNode as { items: { value?: string }[] }).items[1]?.value;
    expect(written).toBe(half.uuid);
  });
});

describe('splitting one segment', () => {
  it('shortens the original to the cursor and adds the remainder', () => {
    const d = oneWire();
    const plan = planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), 'break')!;
    const after = plan.command.apply(d);
    expect(after.lines).toHaveLength(2);
    expect(after.lines[0]!.start).toEqual(at(0, 0));
    expect(after.lines[0]!.end).toEqual(at(4, 0));
    expect(after.lines[1]!.start).toEqual(at(4, 0));
    expect(after.lines[1]!.end).toEqual(at(10, 0));
  });

  it('uses the cursor for a single segment but midpoints for several', () => {
    const d = sheet([wire('w1', at(0, 0), at(10, 0)), wire('w2', at(0, 4), at(10, 4))].join('\n'));
    const plan = planBreakWire(d, new Set([lineId(d, 0), lineId(d, 1)]), at(1, 1), 'break')!;
    const after = plan.command.apply(d);
    // Neither break is at the cursor; each is at its own midpoint.
    expect(after.lines[0]!.end).toEqual(at(5, 0));
    expect(after.lines[1]!.end).toEqual(at(5, 4));
  });

  it('does not clamp the point onto the segment, matching BreakAt', () => {
    const d = oneWire();
    const off = at(4, 3); // above the wire
    const after = planBreakWire(d, new Set([lineId(d, 0)]), off, 'break')!.command.apply(d);
    expect(after.lines[0]!.end).toEqual(off);
    expect(after.lines[1]!.start).toEqual(off);
  });
});

describe('what the drag then carries', () => {
  it('break takes both halves — the original by its end, the new by its start', () => {
    const d = oneWire();
    const plan = planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), 'break')!;
    const after = plan.command.apply(d);
    expect(plan.dragEnd).toEqual([lineId(d, 0)]);
    expect(plan.dragStart).toEqual([refId('line', after.lines[1]!.uuid, 1)]);
  });

  it('slice takes only the original, so the two parts separate', () => {
    const d = oneWire();
    const plan = planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), 'slice')!;
    expect(plan.dragEnd).toEqual([lineId(d, 0)]);
    expect(plan.dragStart).toEqual([]);
  });

  it('break reports the break point so the cursor does not jump', () => {
    const d = oneWire();
    expect(planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), 'break')!.at).toEqual(at(4, 0));
  });

  it('break remembers only the first point when several segments split', () => {
    const d = sheet([wire('w1', at(0, 0), at(10, 0)), wire('w2', at(0, 4), at(10, 4))].join('\n'));
    const plan = planBreakWire(d, new Set([lineId(d, 0), lineId(d, 1)]), at(1, 1), 'break')!;
    expect(plan.at).toEqual(at(5, 0)); // the first segment's midpoint, not the second's
  });
});

describe('several segments at once', () => {
  it('splits each and appends the halves in selection order', () => {
    const d = sheet(
      [
        wire('w1', at(0, 0), at(10, 0)),
        wire('w2', at(0, 4), at(10, 4)),
        wire('w3', at(0, 8), at(10, 8)),
      ].join('\n'),
    );
    const plan = planBreakWire(d, new Set([lineId(d, 0), lineId(d, 2)]), at(0, 0), 'break')!;
    const after = plan.command.apply(d);
    expect(after.lines).toHaveLength(5);
    expect(after.lines[1]!.end).toEqual(at(10, 4)); // untouched
    expect(after.lines[3]!.start).toEqual(at(5, 0));
    expect(after.lines[4]!.start).toEqual(at(5, 8));
    expect(plan.dragEnd).toHaveLength(2);
    expect(plan.dragStart).toHaveLength(2);
  });
});

describe('undo', () => {
  const roundTrip = (d: Schematic, mode: 'break' | 'slice'): Schematic => {
    const plan = planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), mode)!;
    return plan.command.invert(d).apply(plan.command.apply(d));
  };

  it('puts the original back and drops the added half', () => {
    const d = oneWire();
    const back = roundTrip(d, 'break');
    expect(back.lines).toHaveLength(1);
    expect(back.lines[0]!.start).toEqual(at(0, 0));
    expect(back.lines[0]!.end).toEqual(at(10, 0));
    expect(back.lines[0]!.uuid).toBe(d.lines[0]!.uuid);
  });

  it('leaves untouched segments where they were, not at the end of the array', () => {
    const d = sheet([wire('w1', at(0, 0), at(10, 0)), wire('w2', at(0, 4), at(10, 4))].join('\n'));
    const back = roundTrip(d, 'slice');
    expect(back.lines.map((l) => l.uuid)).toEqual(d.lines.map((l) => l.uuid));
  });

  it('redoes — invert(before).invert(after) reproduces the split', () => {
    const d = oneWire();
    const plan = planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), 'break')!;
    const after = plan.command.apply(d);
    const undo = plan.command.invert(d);
    const redo = undo.invert(after);
    const again = redo.apply(undo.apply(after));
    expect(again.lines).toHaveLength(2);
    expect(again.lines[0]!.end).toEqual(at(4, 0));
    expect(again.lines[1]!.start).toEqual(at(4, 0));
  });
});

describe('the drag spec handed to the move', () => {
  it('carries the flag sets and nothing else', () => {
    const d = oneWire();
    const plan = planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), 'break')!;
    expect([...plan.spec.wireEnd]).toEqual(plan.dragEnd);
    expect([...plan.spec.wireStart]).toEqual(plan.dragStart);
    expect(plan.spec.fullIds.size).toBe(0);
    expect(plan.spec.newWires).toEqual([]);
    expect(plan.spec.labelRides).toEqual([]);
    expect(plan.spec.splits).toEqual([]);
  });

  it('slices with an empty start set, so only one half follows the cursor', () => {
    const d = oneWire();
    const plan = planBreakWire(d, new Set([lineId(d, 0)]), at(4, 0), 'slice')!;
    expect(plan.spec.wireStart.size).toBe(0);
    expect(plan.spec.wireEnd.size).toBe(1);
  });
});
