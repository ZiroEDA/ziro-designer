/**
 * Netclass directive labels (SCH_DIRECTIVE_LABEL): the flag geometry
 * CreateGraphicShape builds, the round trip of a placed one, and the netclass
 * it hands to the net it sits on.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { makeDirectiveLabel, makeWire } from '@ziroeda/eeschema/src/tools/build.js';
import {
  directiveBox,
  directiveGraphic,
  directiveNetclass,
  directiveNetclassAssignments,
} from '@ziroeda/eeschema/src/tools/directive_label.js';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import { hitTest } from '@ziroeda/eeschema/src/tools/hittest.js';
import { addItems, deleteByIds } from '@ziroeda/eeschema/src/tools/mutate.js';
import { moveItems } from '@ziroeda/eeschema/src/tools/move.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const EMPTY = `(kicad_sch (version 20250114) (generator "eeschema"))`;
const load = (): Schematic => readSchematic(parse(EMPTY));
const at = (x: number, y: number): { x: number; y: number } => ({ x: mmToIU(x), y: mmToIU(y) });

describe('flag geometry', () => {
  it('draws a circle at the end of the pin line', () => {
    const flag = makeDirectiveLabel(at(50, 50), { shape: 'round', pinLength: mmToIU(2.54) });
    const g = directiveGraphic(flag);
    // A flag stored at angle 0 is SPIN_STYLE::RIGHT, which CreateGraphicShape
    // rotates by 180°, the pin runs up the sheet from its anchor.
    expect(g.line[0]).toEqual(at(50, 50));
    expect(g.circle).toBeDefined();
    expect(g.circle?.center.y).toBeLessThan(g.line[0].y);
    expect(g.circle?.filled).toBe(false);
    expect(g.polygon).toBeUndefined();
  });

  it('fills the dot and shrinks it to 70%', () => {
    const round = directiveGraphic(makeDirectiveLabel(at(0, 0), { shape: 'round' }));
    const dot = directiveGraphic(makeDirectiveLabel(at(0, 0), { shape: 'dot' }));
    expect(dot.circle?.filled).toBe(true);
    expect(dot.circle!.radius).toBeLessThan(round.circle!.radius);
  });

  it('gives the diamond and rectangle closed outlines', () => {
    expect(
      directiveGraphic(makeDirectiveLabel(at(0, 0), { shape: 'diamond' })).polygon,
    ).toHaveLength(4);
    expect(
      directiveGraphic(makeDirectiveLabel(at(0, 0), { shape: 'rectangle' })).polygon,
    ).toHaveLength(4);
  });

  it('turns with the orientation', () => {
    const up = directiveGraphic(makeDirectiveLabel(at(50, 50), { angle: 90 }));
    // SPIN_STYLE::UP rotates the flag onto the +X axis.
    expect(up.circle!.center.x).toBeGreaterThan(up.line[0].x);
    expect(Math.abs(up.circle!.center.y - up.line[0].y)).toBeLessThan(1);
  });
});

describe('placing, selecting and saving a flag', () => {
  it('round-trips through the writer', () => {
    const flag = makeDirectiveLabel(at(50, 50), { shape: 'diamond', netclass: 'HV' });
    const out = serializeSchematic(addItems({ directiveLabels: [flag] }).apply(load()));
    expect(out).toContain('(directive_label');
    expect(out).toContain('(shape diamond)');
    expect(out).toContain('(property "Netclass" "HV"');
    const back = readSchematic(parse(out));
    expect(back.directiveLabels).toHaveLength(1);
    expect(back.directiveLabels?.[0]?.shape).toBe('diamond');
    expect(directiveNetclass(back.directiveLabels![0]!)).toBe('HV');
  });

  it('is hit-testable, movable and deletable like any other item', () => {
    const flag = makeDirectiveLabel(at(50, 50), { netclass: 'HV' });
    const sch = addItems({ directiveLabels: [flag] }).apply(load());
    const id = refId('directive', flag.uuid, 0);

    const hit = hitTest(sch, new Map(), at(50, 50), mmToIU(0.3));
    expect(hit).toEqual({ kind: 'directive', id });

    const moved = moveItems(new Set([id]), { x: mmToIU(10), y: 0 }).apply(sch);
    expect(moved.directiveLabels?.[0]?.at.x).toBe(at(60, 50).x);
    // The Netclass field travels with the flag.
    expect(moved.directiveLabels?.[0]?.fields[0]?.at?.x).toBe(at(60, 50).x);

    expect(deleteByIds(new Set([id])).apply(sch).directiveLabels).toHaveLength(0);
  });

  it('keeps the box around the whole flag, not just the anchor', () => {
    const box = directiveBox(makeDirectiveLabel(at(50, 50), { shape: 'rectangle' }));
    expect(box.minY).toBeLessThan(at(50, 50).y);
    expect(box.maxX).toBeGreaterThan(box.minX);
  });
});

describe('the netclass it applies', () => {
  it('assigns to the net the flag sits on', () => {
    const flag = makeDirectiveLabel(at(55, 50), { netclass: 'HV' });
    const base = load();
    const sch: Schematic = {
      ...base,
      lines: [makeWire(at(50, 50), at(60, 50))],
      directiveLabels: [flag],
    };
    const netlist = computeNetlist(sch, new Map());
    const assignments = directiveNetclassAssignments(sch, netlist);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.netClass).toBe('HV');
    expect(assignments[0]?.pattern).toBe(netlist.nets[0]?.name);
  });

  it('assigns nothing when the flag names no netclass or touches no wire', () => {
    const base = load();
    const off: Schematic = {
      ...base,
      lines: [makeWire(at(50, 50), at(60, 50))],
      directiveLabels: [makeDirectiveLabel(at(80, 80), { netclass: 'HV' })],
    };
    expect(directiveNetclassAssignments(off, computeNetlist(off, new Map()))).toEqual([]);

    const unnamed: Schematic = {
      ...base,
      lines: [makeWire(at(50, 50), at(60, 50))],
      directiveLabels: [makeDirectiveLabel(at(55, 50))],
    };
    expect(directiveNetclassAssignments(unnamed, computeNetlist(unnamed, new Map()))).toEqual([]);
  });
});
