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
import { withCleanup } from '@ziroeda/eeschema/src/tools/cleanup.js';
import { placeSymbol } from '@ziroeda/eeschema/src/tools/index.js';
import { readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { symbolPinPositions } from '@ziroeda/eeschema/src/tools/connect.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const lineId = (sch: Schematic, i: number): string => refId('line', sch.lines[i]!.uuid, i);

const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

/**
 * Two resistors in a row with a horizontal wire between the facing pins: the
 * right-hand one is the symbol being dragged, the left-hand one is the fixed
 * attachment the wire's far end sits on. `corner` adds a vertical wire carrying
 * on from that far end, which is the "a connected line runs along the move"
 * case.
 */
function pinnedWire(opts: { corner?: boolean; vertical?: boolean } = {}): {
  sch: Schematic;
  libById: Map<string, LibSymbol>;
  moving: string;
} {
  // R's pins sit 3.81 mm above and below its origin, so a symbol placed at
  // (0, -3.81) has a pin exactly at the origin.
  let sch = placeSymbol(R, at(0, -3.81)).apply(EMPTY());
  // The second symbol sits to the right, or below for the vertical-wire case.
  sch = placeSymbol(R, opts.vertical ? at(0, 23.81) : at(20, -3.81)).apply(sch);
  const libById = new Map<string, LibSymbol>(sch.libSymbols.map((l) => [l.libId, l]));
  const fixedPin = symbolPinPositions(sch.symbols[0]!, libById.get(sch.symbols[0]!.libId)).filter(
    (p) => p.y === 0,
  )[0]!;
  const movingPin = symbolPinPositions(sch.symbols[1]!, libById.get(sch.symbols[1]!.libId)).filter(
    (p) => (opts.vertical ? p.y === at(0, 20).y : p.y === 0),
  )[0]!;
  sch = addItems({
    lines: [
      makeWire(fixedPin, movingPin),
      ...(opts.corner ? [makeWire(fixedPin, { x: fixedPin.x, y: fixedPin.y - mmToIU(10) })] : []),
    ],
  }).apply(sch);
  return { sch, libById, moving: refId('symbol', sch.symbols[1]!.uuid, 1) };
}

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

describe('orthoLineDrag: where the bend goes', () => {
  it('keeps the wire on the moving pin and bends at the far end', () => {
    // A horizontal wire from a fixed pin to a moving symbol's pin, dragged
    // straight down. Upstream treats the *unselected* end: the original span
    // survives as a new segment and a vertical one drops to the pin, so the
    // wire still meets the pin along its own direction — no bend at the pin.
    const { sch, libById, moving } = pinnedWire();
    const spec = planMove(sch, libById, new Set([moving]));
    const delta = at(0, 10);
    const moved = withCleanup(orthoMove(sch, spec, delta, libById), libById).apply(sch);

    const wires = moved.lines.filter((l) => l.kind === 'wire');
    // The collapsed original is cleaned up; what is left is the old route plus
    // the drop to the pin.
    expect(wires).toHaveLength(2);
    const horizontal = wires.find((l) => l.start.y === l.end.y)!;
    const vertical = wires.find((l) => l.start.x === l.end.x)!;
    // The old route, end to end, and the drop from it to the pin's new spot.
    expect(new Set([horizontal.start.x, horizontal.end.x])).toEqual(
      new Set([at(0, 0).x, at(20, 0).x]),
    );
    expect(horizontal.start.y).toBe(0);
    expect(new Set([vertical.start.y, vertical.end.y])).toEqual(new Set([0, at(0, 10).y]));
    expect(vertical.start.x).toBe(at(20, 0).x);
  });

  it('never flattens a vertical wire into a diagonal when its pin is dragged', () => {
    // The reported shape: a perfectly vertical wire from the dragged symbol's
    // pin down to a fixed pin. In H/V line mode the far end holds still and the
    // wire keeps its axis — every surviving segment is horizontal or vertical.
    const { sch, libById, moving } = pinnedWire({ vertical: true });
    const spec = planMove(sch, libById, new Set([moving]));
    const moved = withCleanup(orthoMove(sch, spec, at(-10, -5), libById), libById).apply(sch);
    for (const l of moved.lines) {
      const ortho = l.start.x === l.end.x || l.start.y === l.end.y;
      expect(ortho).toBe(true);
    }
    // The far end is exactly where it was, still on its pin.
    const fixedPin = symbolPinPositions(sch.symbols[0]!, libById.get(sch.symbols[0]!.libId)).find(
      (p) => p.y === 0,
    )!;
    expect(
      moved.lines.some(
        (l) =>
          (l.start.x === fixedPin.x && l.start.y === fixedPin.y) ||
          (l.end.x === fixedPin.x && l.end.y === fixedPin.y),
      ),
    ).toBe(true);
  });

  it('lengthens a connected wire that runs along the move instead of adding one', () => {
    // The far end is a corner: a vertical wire carries on from it. Dragging the
    // symbol down runs along that wire, so upstream stretches it and adds
    // nothing ("If the move is the same angle as a connected line…").
    const { sch, libById, moving } = pinnedWire({ corner: true });
    const spec = planMove(sch, libById, new Set([moving]));
    const before = sch.lines.length;
    const moved = withCleanup(orthoMove(sch, spec, at(0, 10), libById), libById).apply(sch);
    expect(moved.lines.filter((l) => l.kind === 'wire').length).toBe(before);
    // The vertical neighbour absorbed the move; the horizontal wire slid down.
    const horizontal = moved.lines.find((l) => l.start.y === l.end.y)!;
    expect(horizontal.start).toEqual(at(0, 10));
    expect(horizontal.end).toEqual(at(20, 10));
  });
});
