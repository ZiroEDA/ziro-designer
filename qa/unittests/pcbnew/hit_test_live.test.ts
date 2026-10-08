// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Point hit-tests of the board items: PCB_TRACK / PCB_VIA / PCB_ARC::HitTest
 * and EDA_SHAPE::hitTest under PCB_SHAPE::HitTest. Every expectation is a
 * distance worked out from the C++ cited beside it.
 */
import { describe, expect, it } from 'vitest';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';

const P = (x: number, y: number): { x: number; y: number } => ({ x, y });

describe('PCB_TRACK::HitTest (TestSegmentHit)', () => {
  const t = new PCB_TRACK(new BOARD());
  t.SetStart(P(0, 0));
  t.SetEnd(P(1000, 0));
  t.SetWidth(100);

  it('hits within accuracy + half-width of the segment', () => {
    expect(t.HitTest(P(500, 40), 10)).toBe(true); // 40 <= 10 + 50
  });

  it('misses beyond accuracy + half-width', () => {
    expect(t.HitTest(P(500, 100), 10)).toBe(false); // 100 > 60
  });

  it('misses past the endpoints', () => {
    expect(t.HitTest(P(1200, 0), 10)).toBe(false);
  });
});

describe('PCB_VIA::HitTest', () => {
  const v = new PCB_VIA(new BOARD());
  v.SetPosition(P(2000, 0));
  v.SetWidth(PCB_LAYER_ID.F_Cu, 200); // radius 100

  it('hits inside the pad radius', () => {
    expect(v.HitTest(P(2050, 0), 0)).toBe(true);
  });

  it('misses outside radius + accuracy', () => {
    expect(v.HitTest(P(2000, 150), 10)).toBe(false); // 150 > 110
  });
});

describe('PCB_ARC::HitTest', () => {
  // A quarter arc centred at the origin, radius 1000: (1000,0) -> (707,707) -> (0,1000).
  const a = new PCB_ARC(new BOARD());
  a.SetStart(P(1000, 0));
  a.SetMid(P(707, 707));
  a.SetEnd(P(0, 1000));
  a.SetWidth(100);

  it('hits a point on the arc band within the sweep', () => {
    expect(a.HitTest(P(707, 707), 20)).toBe(true);
  });

  it('hits at an endpoint', () => {
    expect(a.HitTest(P(1000, 0), 5)).toBe(true);
  });

  it('misses a point on the circle but outside the sweep', () => {
    expect(a.HitTest(P(-1000, 0), 20)).toBe(false);
  });

  it('misses a point off the radial band', () => {
    expect(a.HitTest(P(500, 500), 20)).toBe(false); // ~707 from the centre against r 1000
  });
});

describe('PCB_SHAPE::HitTest (EDA_SHAPE::hitTest)', () => {
  const shape = (kind: SHAPE_T, build: (s: PCB_SHAPE) => void): PCB_SHAPE => {
    const s = new PCB_SHAPE(new BOARD(), kind);
    s.SetLayer(PCB_LAYER_ID.F_SilkS);
    build(s);
    return s;
  };

  it('a line: near the segment', () => {
    const s = shape(SHAPE_T.SEGMENT, (x) => {
      x.SetStart(P(0, 2000));
      x.SetEnd(P(1000, 2000));
      x.SetWidth(100);
    });
    expect(s.HitTest(P(500, 2030), 10)).toBe(true);
    expect(s.HitTest(P(500, 2200), 10)).toBe(false);
  });

  it('an unfilled rectangle: the border is live, the interior is not', () => {
    const s = shape(SHAPE_T.RECTANGLE, (x) => {
      x.SetStart(P(0, 0));
      x.SetEnd(P(1000, 1000));
      x.SetWidth(40);
    });
    expect(s.HitTest(P(0, 500), 5)).toBe(true);
    expect(s.HitTest(P(500, 500), 5)).toBe(false);
  });

  it('a filled circle: the interior hits', () => {
    const s = shape(SHAPE_T.CIRCLE, (x) => {
      x.SetCenter(P(0, 0));
      x.SetEnd(P(500, 0));
      x.SetWidth(20);
      x.SetFillMode(FILL_T.FILLED_SHAPE);
    });
    expect(s.HitTest(P(100, 100), 0)).toBe(true);
  });

  it('a rounded rectangle: the corner is an arc, and the square corner is a miss', () => {
    // `EDA_SHAPE::hitTest` takes the ROUNDRECT outline when `m_cornerRadius > 0`
    // (eda_shape.cpp:1500-1508). Expectations read off KiCad 10.0.6 itself
    // (pcbnew python, PCB_SHAPE::HitTest on this exact shape,
    // ~/kicad-oracle/hit/rr.py): its corner arc passes through (150, 150),
    // and the square corner and the points just inside the arc are misses.
    const s = shape(SHAPE_T.RECTANGLE, (x) => {
      x.SetStart(P(0, 0));
      x.SetEnd(P(1000, 1000));
      x.SetWidth(40);
      x.SetCornerRadius(300);
    });
    const hits = (x: number, y: number): boolean => s.HitTest(P(x, y), 5);
    expect(hits(0, 0)).toBe(false);
    expect(hits(88, 88)).toBe(false);
    expect(hits(100, 100)).toBe(false);
    expect(hits(150, 150)).toBe(true);
    expect(hits(200, 200)).toBe(false);
    expect(hits(912, 912)).toBe(false);
    // The straight runs, and where they meet the arcs.
    expect(hits(0, 300)).toBe(true);
    expect(hits(300, 0)).toBe(true);
    expect(hits(500, 0)).toBe(true);
    expect(hits(1000, 500)).toBe(true);
    expect(hits(700, 700)).toBe(false);
  });

  it('a hatched rectangle: a click on a hatch LINE picks the shape', () => {
    // `if( IsHatchedFill() && GetHatching().Collide( … ) )` (eda_shape.cpp:1522-1523),
    // GetHatching() building the hatch first (:636). KiCad 10.0.6 answers the
    // same three points True, False, True (~/kicad-oracle/hit/hit.py).
    const s = shape(SHAPE_T.RECTANGLE, (x) => {
      x.SetStart(P(0, 0));
      x.SetEnd(P(10_000, 10_000));
      x.SetWidth(100);
      x.SetFillMode(FILL_T.HATCH);
    });
    // The line at offset 10000 of the -1 family runs corner to corner.
    expect(s.HitTest(P(5000, 5000), 10)).toBe(true);
    // Half a spacing (10 x the 100 pen) off it is between two lines.
    expect(s.HitTest(P(5000, 5500), 10)).toBe(false);
  });

  it('a hatched circle: live on the lines, dead between them, live on the outline', () => {
    // `IsFilledForHitTesting()` is `IsSolidFill()` (eda_shape.h:143), and a
    // click ON a hatch line still picks the shape (eda_shape.cpp:1522-1523).
    const s = shape(SHAPE_T.CIRCLE, (x) => {
      x.SetCenter(P(0, 0));
      x.SetEnd(P(500, 0));
      x.SetWidth(20);
      x.SetFillMode(FILL_T.CROSS_HATCH);
    });
    // Pen 20, spacing 200: the -1 family runs through (100, 100).
    expect(s.HitTest(P(100, 100), 0)).toBe(true);
    expect(s.HitTest(P(100, 200), 0)).toBe(false);
    expect(s.HitTest(P(500, 0), 5)).toBe(true);
  });
});
