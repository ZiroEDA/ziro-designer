// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic rule areas (`SCH_RULE_AREA`), which the editor could not read,
 * write or draw at all — the toolbar button was a disabled stub.
 *
 * Upstream models one as nothing more than a shape:
 *
 *     class SCH_RULE_AREA : public SCH_SHAPE
 *     {
 *         SCH_RULE_AREA() :
 *             SCH_SHAPE( SHAPE_T::POLY, LAYER_RULE_AREAS, 0, FILL_T::NO_FILL, SCH_RULE_AREA_T ),
 *
 * so it inherits every shape behaviour — hit-testing, moving, the point editor,
 * the clipboard. Modelling it the same way here, as a schematic graphic
 * carrying a flag, inherits ours instead of adding a parallel item kind to the
 * thirty-odd files a new top-level array would touch.
 *
 * The file format is `saveShape` inside a wrapper:
 *
 *     m_out->Print( "(rule_area " );
 *     ... FormatBool( exclude_from_sim / in_bom / on_board / dnp ) ...
 *     saveShape( aRuleArea );
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { makeRuleArea, makeRuleAreaPreview } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { dragHandle, editHandles } from '@ziroeda/eeschema/src/tools/point_editor.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const SRC = `(kicad_sch (version 20250114) (lib_symbols)
  (rule_area (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)
    (polyline
      (pts (xy 50 50) (xy 100 50) (xy 100 90) (xy 50 90) (xy 50 50))
      (stroke (width 0) (type default)) (fill (type none)) (uuid "ra1")))
  (polyline
    (pts (xy 10 10) (xy 20 20))
    (stroke (width 0) (type default)) (fill (type none)) (uuid "pl1")))`;

const doc = (): Schematic => readSchematic(parse(SRC));

describe('reading a rule area', () => {
  it('lands in graphics as a polyline, flagged', () => {
    const d = doc();
    const ra = d.graphics.find((g) => g.ruleArea);
    expect(ra).toBeDefined();
    expect(ra!.kind).toBe('polyline');
  });

  it('with the points the wrapper held', () => {
    const ra = doc().graphics.find((g) => g.ruleArea)!;
    expect(ra.kind === 'polyline' && ra.points).toHaveLength(5);
    if (ra.kind === 'polyline') {
      expect(ra.points[0]).toEqual({ x: mmToIU(50), y: mmToIU(50) });
      expect(ra.points[2]).toEqual({ x: mmToIU(100), y: mmToIU(90) });
    }
  });

  it('and an ordinary polyline is not flagged', () => {
    // A sheet polyline is a line, not a graphic, so the only graphic here is
    // the rule area — which is itself the point: the flag is what tells them
    // apart, not the node name.
    const d = doc();
    expect(d.graphics.filter((g) => g.ruleArea)).toHaveLength(1);
    expect(d.graphics.filter((g) => !g.ruleArea)).toHaveLength(0);
  });
});

describe('writing one back', () => {
  it('re-emits the wrapper, not a bare shape', () => {
    const text = serializeSchematic(doc());
    expect(text).toContain('(rule_area');
    // The shape is inside it.
    const i = text.indexOf('(rule_area');
    const j = text.indexOf('(polyline', i);
    expect(j).toBeGreaterThan(i);
  });

  it('keeps the attribute flags the file carried', () => {
    const text = serializeSchematic(doc());
    const block = text.slice(text.indexOf('(rule_area'), text.indexOf('(polyline'));
    expect(block).toContain('exclude_from_sim');
    expect(block).toContain('in_bom');
    expect(block).toContain('on_board');
    expect(block).toContain('dnp');
  });

  it('round-trips: read, write, read again', () => {
    const back = readSchematic(parse(serializeSchematic(doc())));
    const ra = back.graphics.find((g) => g.ruleArea);
    expect(ra).toBeDefined();
    expect(ra!.kind).toBe('polyline');
    if (ra?.kind === 'polyline') expect(ra.points).toHaveLength(5);
  });

  it('exactly once — the source node does not also survive alongside it', () => {
    // `writeSchematic` re-emits every graphic from the model and then copies
    // through whatever root nodes it does not recognise. `rule_area` was
    // missing from that recognised set, so each save appended a second copy of
    // every rule area and the count doubled on every round trip.
    const once = serializeSchematic(doc());
    const twice = serializeSchematic(readSchematic(parse(once)));
    expect(readSchematic(parse(twice)).graphics.filter((g) => g.ruleArea)).toHaveLength(1);
    expect(twice.match(/\(rule_area/g) ?? []).toHaveLength(1);
  });

  it('and a moved rule area writes its new points', () => {
    const d = doc();
    const ra = d.graphics.find((g) => g.ruleArea)!;
    if (ra.kind !== 'polyline') throw new Error('expected a polyline');
    const moved = {
      ...ra,
      points: ra.points.map((p) => ({ x: p.x + mmToIU(10), y: p.y })),
    };
    const next: Schematic = { ...d, graphics: [moved] };
    const back = readSchematic(parse(serializeSchematic(next)));
    const out = back.graphics.find((g) => g.ruleArea)!;
    if (out.kind !== 'polyline') throw new Error('expected a polyline');
    expect(out.points[0]).toEqual({ x: mmToIU(60), y: mmToIU(50) });
    // Still a rule area after the move.
    expect(out.ruleArea).toBe(true);
  });

  it('a rule area with no wrapper of its own gets the constructor defaults', () => {
    // What a freshly drawn one looks like: no `ruleAreaSource` to reuse.
    const d = doc();
    const ra = d.graphics.find((g) => g.ruleArea)!;
    if (ra.kind !== 'polyline') throw new Error('expected a polyline');
    const { ruleAreaSource: _drop, ...fresh } = ra;
    const next: Schematic = { ...d, graphics: [fresh] };
    const text = serializeSchematic(next);
    expect(text).toContain('(rule_area');
    const back = readSchematic(parse(text));
    expect(back.graphics.find((g) => g.ruleArea)).toBeDefined();
  });
});

describe('the shape a rule area is committed as', () => {
  /**
   * `RULE_AREA_CREATE_HELPER::createNewRuleArea` adds the one thing the
   * constructor does not:
   *
   *     ruleArea->SetLineStyle( LINE_STYLE::DASH );
   *
   * so a finished rule area is a *dashed* closed polygon with no fill.
   */
  it('is dashed, closed and unfilled', () => {
    const g = makeRuleArea([
      { x: 0, y: 0 },
      { x: mmToIU(10), y: 0 },
      { x: mmToIU(10), y: mmToIU(10) },
    ]);
    expect(g.kind).toBe('polyline');
    if (g.kind !== 'polyline') return;
    expect(g.ruleArea).toBe(true);
    expect(g.stroke?.type).toBe('dash');
    expect(g.fill?.type).toBe('none');
    // Closed: the last vertex repeats the first.
    expect(g.points).toHaveLength(4);
    expect(g.points.at(-1)).toEqual(g.points[0]);
  });

  it('does not add a second closing point when the outline already meets', () => {
    // Which is how it is finished upstream: a point placed on the first one.
    const pts = [
      { x: 0, y: 0 },
      { x: mmToIU(10), y: 0 },
      { x: mmToIU(10), y: mmToIU(10) },
      { x: 0, y: 0 },
    ];
    const g = makeRuleArea(pts);
    if (g.kind !== 'polyline') return;
    expect(g.points).toHaveLength(4);
  });
});

describe('the outline while it is still being drawn', () => {
  /**
   * `POLYGON_ITEM` draws the locked points as an **open** polyline and fills
   * the area enclosed so far:
   *
   *     m_previewItem.SetFillColor( color.WithAlpha( 0.2 ) );
   *
   * so it reads as unfinished until the last point meets the first. Previewing
   * it closed made it look complete from the second click onwards.
   */
  it('is left open, and filled at 20% so the enclosed area shows', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: mmToIU(10), y: 0 },
      { x: mmToIU(10), y: mmToIU(10) },
    ];
    const g = makeRuleAreaPreview(pts);
    if (g.kind !== 'polyline') return;
    // Open: exactly the points given, with no closing vertex added.
    expect(g.points).toHaveLength(3);
    expect(g.points.at(-1)).not.toEqual(g.points[0]);
    expect(g.fill?.type).toBe('color');
    expect(g.fill?.color?.[3]).toBe(0.2);
    // Still flagged, so it takes the rule-area layer colour rather than notes.
    expect(g.ruleArea).toBe(true);
  });

  it('and the finished shape differs from the preview exactly in being closed', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: mmToIU(10), y: 0 },
      { x: mmToIU(10), y: mmToIU(10) },
    ];
    const preview = makeRuleAreaPreview(pts);
    const done = makeRuleArea(pts);
    if (preview.kind !== 'polyline' || done.kind !== 'polyline') return;
    expect(done.points).toHaveLength(preview.points.length + 1);
  });
});

describe('the handles a finished rule area shows', () => {
  /**
   * `BuildForPolyOutline` gives a polygon a handle per corner *and* an
   * `EDIT_LINE` per edge, and `EDIT_POINTS::ViewDraw` draws them differently:
   *
   *     for( const EDIT_POINT& point : m_points )
   *         drawPoint( point, point.DrawCircle() );        // square
   *     for( const EDIT_LINE& line : m_lines )
   *         if( line.HasCenterPoint() )
   *             drawPoint( line.GetPosition(), true );     // circle at the midpoint
   *
   * so a rule area comes up with squares on its corners and circles between
   * them. Ours emitted corners only.
   */
  const square = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (rule_area (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)
          (polyline
            (pts (xy 50 50) (xy 90 50) (xy 90 80) (xy 50 80) (xy 50 50))
            (stroke (width 0) (type dash)) (fill (type none)) (uuid "ra1"))))`),
    );
  const handlesOf = (d: Schematic) => editHandles(d, { kind: 'graphic', index: 0 });

  it('a square handle on every vertex', () => {
    const hs = handlesOf(square());
    expect(hs.filter((h) => h.kind === 'point')).toHaveLength(5);
  });

  it('and a circle between each adjacent pair', () => {
    const hs = handlesOf(square());
    const lines = hs.filter((h) => h.kind === 'line');
    expect(lines).toHaveLength(4);
    // The first edge runs 50->90 along x at y=50, so its handle is at x=70.
    expect(lines[0]!.at).toEqual({ x: mmToIU(70), y: mmToIU(50) });
  });

  it('dragging an edge slides it, taking both its ends', () => {
    const d = square();
    const hs = handlesOf(d);
    const edge = hs.filter((h) => h.kind === 'line')[0]!;
    const out = dragHandle(d, { kind: 'graphic', index: 0 }, edge, {
      x: edge.at.x,
      y: mmToIU(40),
    });
    const g = out.graphics[0]!;
    if (g.kind !== 'polyline') throw new Error('expected a polyline');
    // The top edge moved up; the bottom two corners did not.
    expect(g.points[0]!.y).toBe(mmToIU(40));
    expect(g.points[1]!.y).toBe(mmToIU(40));
    expect(g.points[2]!.y).toBe(mmToIU(80));
  });

  it('and the outline stays closed when the shared vertex moves', () => {
    // The first and last vertices are the same point; moving one has to move
    // the other or the polygon springs open.
    const d = square();
    const hs = handlesOf(d);
    const edge = hs.filter((h) => h.kind === 'line')[0]!;
    const out = dragHandle(d, { kind: 'graphic', index: 0 }, edge, {
      x: edge.at.x,
      y: mmToIU(40),
    });
    const g = out.graphics[0]!;
    if (g.kind !== 'polyline') throw new Error('expected a polyline');
    expect(g.points.at(-1)).toEqual(g.points[0]);
  });
});
