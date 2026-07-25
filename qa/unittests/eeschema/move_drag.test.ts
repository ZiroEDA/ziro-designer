/**
 * Drag connectivity (counterpart SCH_MOVE_TOOL::getConnectedDragItems +
 * SPECIAL_CASE_LABEL_INFO): no-connects join the drag, unselected junctions
 * isolate it behind a stub, sheet pins stub, labels carried by a moved wire
 * keep their place on it, and a label dragged off a wire's middle cuts the
 * wire and takes a stub with it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  addItems,
  makeWire,
  makeJunction,
  makeLabel,
  makeNoConnect,
  refId,
} from '@ziroeda/eeschema/src/tools/index.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const lineId = (sch: Schematic, i: number): string => refId('line', sch.lines[i]!.uuid, i);

describe('planMove drag connectivity', () => {
  it('an unselected no-connect at a moved point joins the drag', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0))],
      noConnects: [makeNoConnect(at(10, 0))],
    }).apply(EMPTY());
    const wire = lineId(sch, 0);
    const spec = planMove(sch, new Map(), new Set([wire]));
    const ncId = refId('noconnect', sch.noConnects[0]!.uuid, 0);
    expect(spec.fullIds.has(ncId)).toBe(true);
    const moved = moveWithConnections(spec, at(0, 5)).apply(sch);
    expect(moved.noConnects[0]!.at).toEqual(at(10, 5));
  });

  it('an unselected junction isolates the drag: neighbours stay, a stub bridges', () => {
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(10, 0)), // selected
        makeWire(at(10, 0), at(20, 0)), // neighbour beyond the junction
        makeWire(at(10, 0), at(10, 10)), // neighbour beyond the junction
      ],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 0)]));
    expect(spec.wireStart.has(lineId(sch, 1))).toBe(false);
    expect(spec.wireStart.has(lineId(sch, 2))).toBe(false);
    expect(spec.newWires.length).toBe(1);
    expect(spec.newWires[0]!.fixed).toEqual(at(10, 0));
  });

  it('a label on a stretching wire stays where it is while the wire still passes through it', () => {
    // W1 spans (0,0)-(20,0) with a label at its middle; dragging W2 along the
    // same axis stretches W1, and the label keeps its place on it — upstream
    // moves such a label by the *fixed* end's delta, which is zero.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(20, 0), at(30, 0))],
      labels: [makeLabel('label', 'NET1', at(10, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 1)]));
    expect(spec.labelRides.length).toBe(1);
    expect(spec.labelRides[0]!.rigid).toBe(false);
    const moved = moveWithConnections(spec, at(5, 0)).apply(sch);
    expect(moved.lines[0]!.end).toEqual(at(25, 0));
    expect(moved.labels[0]!.at).toEqual(at(10, 0));
  });

  it('pulls the label back onto the wire when the drag swings it away', () => {
    // Dragging W2 up turns W1 into (0,0)-(20,10): the label at (10,0) is no
    // longer on it, so it lands on the segment's nearest point (SEG::NearestPoint).
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(20, 0), at(30, 0))],
      labels: [makeLabel('label', 'NET1', at(10, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 1)]));
    const moved = moveWithConnections(spec, at(0, 10)).apply(sch);
    expect(moved.labels[0]!.at).toEqual(at(8, 4));
  });

  it('cuts the wire and stubs out a label dragged off its middle', () => {
    // KiCad's getConnectedDragItems: a selected label mid-span gets a new wire
    // from its old spot, and the wire is split there with a junction.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NET1', at(10, 0))],
    }).apply(EMPTY());
    const labelId = sch.labels[0]!.uuid!;
    const spec = planMove(sch, new Map(), new Set([labelId]));
    expect(spec.splits).toHaveLength(1);
    expect(spec.splits[0]!.at).toEqual(at(10, 0));
    expect(spec.newWires.some((w) => w.fixed.x === at(10, 0).x)).toBe(true);

    const cmd = moveWithConnections(spec, at(0, 10));
    const moved = cmd.apply(sch);
    // The label moved, the wire is cut at the old spot with a junction there,
    // and a stub runs from the cut to the label's new position.
    expect(moved.labels[0]!.at).toEqual(at(10, 10));
    expect(moved.junctions.some((j) => j.at.x === at(10, 0).x && j.at.y === 0)).toBe(true);
    const stub = moved.lines.find(
      (l) => l.start.x === at(10, 0).x && l.start.y === 0 && l.end.y === at(0, 10).y,
    );
    expect(stub).toBeDefined();
    expect(moved.lines.filter((l) => l.kind === 'wire').length).toBe(3); // two halves + stub

    // Undo restores the single wire, with no junction and no stub left behind.
    const back = cmd.invert(sch).apply(moved);
    expect(back.lines.filter((l) => l.kind === 'wire').length).toBe(1);
    expect(back.lines[0]!.end).toEqual(at(20, 0));
    expect(back.junctions).toHaveLength(0);
    expect(back.labels[0]!.at).toEqual(at(10, 0));
  });

  it('leaves a label sitting on a wire end alone — that end is dragged with it', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NET1', at(20, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([sch.labels[0]!.uuid!]));
    expect(spec.splits).toHaveLength(0);
    expect(spec.wireEnd.has(lineId(sch, 0))).toBe(true);
    const moved = moveWithConnections(spec, at(0, 10)).apply(sch);
    expect(moved.lines[0]!.end).toEqual(at(20, 10));
    expect(moved.labels[0]!.at).toEqual(at(20, 10));
  });

  it('a label on a fully-moved wire translates rigidly', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NET1', at(5, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 0)]));
    const moved = moveWithConnections(spec, at(3, 7)).apply(sch);
    expect(moved.labels[0]!.at).toEqual(at(8, 7));
  });

  it('an unselected sheet pin at a moved point anchors a stub', () => {
    const base = addItems({ lines: [makeWire(at(10, 0), at(20, 0))] }).apply(EMPTY());
    const sch = {
      ...base,
      sheets: [
        {
          at: at(0, -5),
          size: { w: mmToIU(10), h: mmToIU(10) },
          fields: [],
          pins: [{ name: 'A', shape: 'input', at: at(10, 0), angle: 0 }],
          instances: [],
          source: base.source,
        },
      ],
    } as unknown as Schematic;
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 0)]));
    expect(spec.newWires.some((w) => w.fixed.x === at(10, 0).x && w.fixed.y === 0)).toBe(true);
  });
});

describe('orthogonal drag (H/V line mode)', () => {
  it('cuts the wire and stubs out a label dragged off its middle, like the free-mode drag', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NET1', at(10, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([sch.labels[0]!.uuid!]));
    const cmd = orthoMove(sch, spec, at(0, 10));
    const moved = cmd.apply(sch);
    expect(moved.labels[0]!.at).toEqual(at(10, 10));
    expect(moved.junctions.some((j) => j.at.x === at(10, 0).x && j.at.y === 0)).toBe(true);
    // Two halves + the stub out to the label.
    expect(moved.lines.filter((l) => l.kind === 'wire').length).toBe(3);

    const back = cmd.invert(sch).apply(moved);
    expect(back.lines.filter((l) => l.kind === 'wire').length).toBe(1);
    expect(back.lines[0]!.end).toEqual(at(20, 0));
    expect(back.junctions).toHaveLength(0);
  });

  it('keeps a label on a wire whose far end is dragged', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(20, 0), at(30, 0))],
      labels: [makeLabel('label', 'NET1', at(10, 0))],
    }).apply(EMPTY());
    const spec = planMove(sch, new Map(), new Set([lineId(sch, 1)]));
    const moved = orthoMove(sch, spec, at(5, 0)).apply(sch);
    expect(moved.labels[0]!.at).toEqual(at(10, 0));
  });
});
