// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_T::ELLIPSE` and `SHAPE_T::ELLIPSE_ARC`, the two shapes the schematic
 * toolbar still had greyed out.
 *
 * They are ordinary `SCH_SHAPE`s, stored as centre + two radii + a tilt rather
 * than as a bounding box (`sch_io_kicad_sexpr_common.cpp`):
 *
 *     aFormatter->Print( "(ellipse %s (center %s) (major_radius %s) (minor_radius %s) "
 *                        "(rotation_angle %s)", … );
 *
 * and the arc adds `(start_angle …) (end_angle …)`. The parser accepts both at
 * schematic level (`case T_ellipse: screen->Append( parseSchEllipse() )`) and
 * inside a symbol, so a file KiCad wrote must survive a load/save here — an
 * unmodelled shape would be dropped on the way through, silently deleting part
 * of someone's drawing.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { makeEllipse, makeEllipseArc } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { hitTest } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  dragHandle,
  editHandles,
  pointEditTarget,
} from '@ziroeda/eeschema/src/tools/point_editor.js';
import { moveRigidItems } from '@ziroeda/eeschema/src/tools/move.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const SRC = `(kicad_sch (version 20250114) (lib_symbols)
  (ellipse (center 100 60) (major_radius 20) (minor_radius 10) (rotation_angle 30)
    (stroke (width 0) (type default)) (fill (type none)) (uuid "el1"))
  (ellipse_arc (center 50 40) (major_radius 15) (minor_radius 8) (rotation_angle 0)
    (start_angle 0) (end_angle 90)
    (stroke (width 0) (type default)) (fill (type none)) (uuid "ea1")))`;

const doc = (): Schematic => readSchematic(parse(SRC));
const noLibs = new Map<string, LibSymbol>();

describe('reading them', () => {
  it('both land in graphics, by kind', () => {
    expect(doc().graphics.map((g) => g.kind)).toEqual(['ellipse', 'ellipse_arc']);
  });

  it('with centre and radii in internal units', () => {
    const [el] = doc().graphics;
    expect(el?.kind === 'ellipse' && el.center).toEqual({ x: mmToIU(100), y: mmToIU(60) });
    if (el?.kind === 'ellipse') {
      expect(el.majorRadius).toBe(mmToIU(20));
      expect(el.minorRadius).toBe(mmToIU(10));
      expect(el.rotation).toBe(30);
    }
  });

  it('and the arc keeps its sweep', () => {
    const ea = doc().graphics[1];
    expect(ea?.kind).toBe('ellipse_arc');
    if (ea?.kind === 'ellipse_arc') {
      expect(ea.startAngle).toBe(0);
      expect(ea.endAngle).toBe(90);
    }
  });
});

describe('writing them back', () => {
  it('round-trips unchanged when nothing was touched', () => {
    const out = serializeSchematic(doc());
    expect(readSchematic(parse(out)).graphics.map((g) => g.kind)).toEqual([
      'ellipse',
      'ellipse_arc',
    ]);
  });

  it('and an edited radius reaches the file', () => {
    // The failure this guards against is the one the sheet fill had: the model
    // changes, the writer only patches nodes that already exist in some other
    // shape, and the edit vanishes on the next load.
    const d = doc();
    const el = d.graphics[0];
    if (el?.kind !== 'ellipse') throw new Error('expected an ellipse');
    const edited: Schematic = {
      ...d,
      graphics: [{ ...el, majorRadius: mmToIU(35) }, ...d.graphics.slice(1)],
    };
    const back = readSchematic(parse(serializeSchematic(edited))).graphics[0];
    expect(back?.kind === 'ellipse' && back.majorRadius).toBe(mmToIU(35));
  });

  it('a freshly drawn one survives a save and load', () => {
    const d = doc();
    const drawn = makeEllipse({ x: mmToIU(10), y: mmToIU(10) }, mmToIU(5), mmToIU(3));
    const back = readSchematic(
      parse(serializeSchematic({ ...d, graphics: [...d.graphics, drawn] })),
    ).graphics[2];
    expect(back?.kind).toBe('ellipse');
    if (back?.kind === 'ellipse') {
      expect(back.center).toEqual({ x: mmToIU(10), y: mmToIU(10) });
      expect(back.majorRadius).toBe(mmToIU(5));
      expect(back.minorRadius).toBe(mmToIU(3));
    }
  });

  it('as does a drawn elliptical arc, sweep and all', () => {
    const d = doc();
    const drawn = makeEllipseArc({ x: mmToIU(10), y: mmToIU(10) }, mmToIU(5), mmToIU(3), 0, 90);
    const back = readSchematic(
      parse(serializeSchematic({ ...d, graphics: [...d.graphics, drawn] })),
    ).graphics[2];
    expect(back?.kind).toBe('ellipse_arc');
    if (back?.kind === 'ellipse_arc') {
      expect(back.startAngle).toBe(0);
      expect(back.endAngle).toBe(90);
    }
  });
});

describe('selecting one', () => {
  // The unrotated arc at (50,40) with radii 15 x 8.
  const at = (xMM: number, yMM: number) => ({ x: mmToIU(xMM), y: mmToIU(yMM) });

  it('hits on the outline', () => {
    const hit = hitTest(doc(), noLibs, at(65, 40), mmToIU(0.5));
    expect(hit?.kind).toBe('graphic');
  });

  it('misses inside it while it is unfilled', () => {
    // `if( … GetFillMode() … )` — an unfilled shape is grabbed by its edge only.
    expect(hitTest(doc(), noLibs, at(50, 40), mmToIU(0.5))).toBe(null);
  });

  it('but hits anywhere inside once it is filled', () => {
    const d = doc();
    const el = d.graphics[0];
    if (el?.kind !== 'ellipse') throw new Error('expected an ellipse');
    const filled: Schematic = {
      ...d,
      graphics: [{ ...el, fill: { type: 'outline' } }, ...d.graphics.slice(1)],
    };
    expect(hitTest(filled, noLibs, at(100, 60), mmToIU(0.5))?.kind).toBe('graphic');
  });

  it('and the minor axis is genuinely shorter than the major one', () => {
    // A circle test that ignored the second radius would hit both of these.
    const d = doc();
    // 15 mm out along x is on the arc's outline; 15 mm out along y is well past
    // its 8 mm minor radius.
    expect(hitTest(d, noLibs, at(65, 40), mmToIU(0.5))).not.toBe(null);
    expect(hitTest(d, noLibs, at(50, 55), mmToIU(0.5))).toBe(null);
  });
});

describe('moving one', () => {
  it('translates the centre and leaves the radii alone', () => {
    // An ellipse is centre + radii, so a move is a move of one point.
    const out = moveRigidItems(doc(), new Set(['graphic:idx:0']), { x: mmToIU(5), y: mmToIU(-5) });
    const moved = out.graphics?.[0];
    expect(moved?.kind === 'ellipse' && moved.center).toEqual({ x: mmToIU(105), y: mmToIU(55) });
    if (moved?.kind === 'ellipse') {
      expect(moved.majorRadius).toBe(mmToIU(20));
      expect(moved.rotation).toBe(30);
    }
  });
});

describe('editing its points', () => {
  it('offers a centre and one handle per axis', () => {
    const d = doc();
    const t = pointEditTarget(d, 'graphic:idx:0');
    expect(t).not.toBe(null);
    expect(editHandles(d, t!)).toHaveLength(3);
  });

  it('the axis handles sit at each radius, turned by the rotation', () => {
    // 30° tilt, major radius 20 mm: the handle is 20 mm from the centre along
    // the tilted axis, not straight out along +x.
    const d = doc();
    const hs = editHandles(d, pointEditTarget(d, 'graphic:idx:0')!);
    const c = { x: mmToIU(100), y: mmToIU(60) };
    const dist = (h: { at: { x: number; y: number } }) => Math.hypot(h.at.x - c.x, h.at.y - c.y);
    expect(dist(hs[1]!)).toBeCloseTo(mmToIU(20), -2);
    expect(dist(hs[2]!)).toBeCloseTo(mmToIU(10), -2);
    expect(hs[1]!.at.y).not.toBe(c.y);
  });

  it('dragging the centre moves the whole shape', () => {
    const d = doc();
    const t = pointEditTarget(d, 'graphic:idx:0')!;
    const hs = editHandles(d, t);
    const out = dragHandle(d, t, hs[0]!, { x: mmToIU(20), y: mmToIU(20) });
    expect(out.graphics[0]?.kind === 'ellipse' && out.graphics[0].center).toEqual({
      x: mmToIU(20),
      y: mmToIU(20),
    });
  });

  it('dragging an axis handle sets that radius alone', () => {
    const d = doc();
    const t = pointEditTarget(d, 'graphic:idx:0')!;
    const hs = editHandles(d, t);
    // 40 mm to the +x of the centre: whatever the tilt, the radius is the
    // distance, as `SetEnd` does for a circle.
    const out = dragHandle(d, t, hs[1]!, { x: mmToIU(140), y: mmToIU(60) });
    const g = out.graphics[0];
    expect(g?.kind === 'ellipse' && g.majorRadius).toBe(mmToIU(40));
    expect(g?.kind === 'ellipse' && g.minorRadius).toBe(mmToIU(10));
  });

  it('and a radius never collapses to nothing', () => {
    const d = doc();
    const t = pointEditTarget(d, 'graphic:idx:0')!;
    const hs = editHandles(d, t);
    const out = dragHandle(d, t, hs[2]!, { x: mmToIU(100), y: mmToIU(60) });
    const g = out.graphics[0];
    expect(g?.kind === 'ellipse' && g.minorRadius).toBeGreaterThan(0);
  });
});

describe('the factories', () => {
  it('refuse a zero radius, so a click without a drag is still a shape', () => {
    const g = makeEllipse({ x: 0, y: 0 }, 0, 0);
    expect(g.kind === 'ellipse' && g.majorRadius).toBeGreaterThan(0);
    expect(g.kind === 'ellipse' && g.minorRadius).toBeGreaterThan(0);
  });

  it('write an unrotated shape by default', () => {
    const g = makeEllipse({ x: 0, y: 0 }, 100, 50);
    expect(g.kind === 'ellipse' && g.rotation).toBe(0);
  });
});
