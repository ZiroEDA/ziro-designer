// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TWO_POINT_ASSISTANT`, `ARC_ASSISTANT` and the `DrawTextNextToCursor` /
 * `DRAW_CONTEXT` they are both built on.
 *
 * The readout beside the cursor is the shape tools' equivalent of the polygon's
 * fill: the one thing on screen that says what you are about to draw. The PCB
 * editor had none of it, so every assertion here is a gap rather than a
 * refinement.
 */
import { describe, expect, it } from 'vitest';
import { ArcGeomManager } from '@ziroeda/common/src/preview_items/arc_geom_manager.js';
import {
  arcCursorStrings,
  arcMidPoint,
  drawArcAssistant,
} from '@ziroeda/designer/src/ui/arc_assistant.js';
import {
  drawTwoPointAssistant,
  twoPointCursorStrings,
} from '@ziroeda/designer/src/ui/two_point_assistant.js';
import { angleIsSpecial, specialAngleColour } from '@ziroeda/designer/src/ui/draw_context.js';
import {
  constantLinePitchPx,
  drawTextNextToCursor,
} from '@ziroeda/designer/src/ui/preview_utils.js';

/** pcbnew's internal units per millimetre. */
const IU = 1e6;

interface Call {
  op: string;
  args: unknown[];
  stroke: string;
  align: string;
}

function recorder(): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = [];
  let stroke = '';
  let align = '';
  const push = (op: string, args: unknown[] = []): number =>
    calls.push({ op, args, stroke, align });
  const ctx = {
    calls,
    set strokeStyle(v: string) {
      stroke = v;
    },
    set fillStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(v: string) {
      align = v;
    },
    set textBaseline(_v: string) {},
    set lineJoin(_v: string) {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    setLineDash: () => {},
    beginPath: () => push('beginPath'),
    moveTo: (...a: number[]) => push('moveTo', a),
    lineTo: (...a: number[]) => push('lineTo', a),
    arc: (...a: number[]) => push('arc', a),
    stroke: () => push('stroke'),
    fill: () => push('fill'),
    fillText: (...a: unknown[]) => push('fillText', a),
    strokeText: (...a: unknown[]) => push('strokeText', a),
    measureText: () => ({ actualBoundingBoxAscent: 72 }),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

const identity = (p: { x: number; y: number }): { x: number; y: number } => p;

describe('TWO_POINT_ASSISTANT cursor strings', () => {
  it('a segment reports length and angle, with +90 UP', () => {
    // "Ensures that +90° is up and -90° is down in pcbnew": the board's Y grows
    // downward, so the reported angle negates it. An end 10 mm ABOVE the origin
    // is +90, not -90.
    expect(
      twoPointCursorStrings('segment', { x: 0, y: 0 }, { x: 0, y: -10 * IU }, IU, 'mm'),
    ).toEqual(['l: 10.000 mm', 'θ: 90.0°']);
  });

  it('a rectangle reports its two sides, unsigned', () => {
    // `std::abs( radVec.x )`, `std::abs( radVec.y )` — dragged up-left reads
    // the same as dragged down-right.
    expect(
      twoPointCursorStrings('rect', { x: 0, y: 0 }, { x: -5 * IU, y: -2 * IU }, IU, 'mm'),
    ).toEqual(['x: 5.000 mm', 'y: 2.000 mm']);
  });

  it('a circle reports one radius', () => {
    expect(
      twoPointCursorStrings('circle', { x: 0, y: 0 }, { x: 3 * IU, y: 4 * IU }, IU, 'mm'),
    ).toEqual(['r: 5.000 mm']);
  });

  it('uses DimensionLabel’s coarse per-unit precision', () => {
    // %.3f for mm, %.4f for inches — not the status bar's.
    const [mm] = twoPointCursorStrings('circle', { x: 0, y: 0 }, { x: IU, y: 0 }, IU, 'mm');
    const [inch] = twoPointCursorStrings('circle', { x: 0, y: 0 }, { x: IU, y: 0 }, IU, 'in');
    expect(mm).toBe('r: 1.000 mm');
    expect(inch).toBe('r: 0.0394"');
  });
});

describe('TWO_POINT_ASSISTANT drawing', () => {
  const draw = (shape: 'segment' | 'rect' | 'circle'): Call[] => {
    const ctx = recorder();
    drawTwoPointAssistant(ctx, {
      shape,
      origin: { x: 0, y: 0 },
      end: { x: 10 * IU, y: 0 },
      toPx: identity,
      color: 'rgb(255, 255, 0)',
      backgroundIsDark: true,
      iuPerMm: IU,
      units: 'mm',
      devicePixelRatio: 1,
    });
    return ctx.calls;
  };

  it('only the circle draws a radius line', () => {
    // `preview_ctx.DrawLine( origin, end, false )` is inside the CIRCLE arm
    // alone; the segment and rectangle draw nothing but text.
    expect(draw('circle').some((c) => c.op === 'stroke')).toBe(true);
    expect(draw('segment').some((c) => c.op === 'stroke')).toBe(false);
    expect(draw('rect').some((c) => c.op === 'stroke')).toBe(false);
  });

  it('draws nothing at all while the end is still on the origin', () => {
    // "text next to cursor jumps around a lot in this corner case".
    const ctx = recorder();
    drawTwoPointAssistant(ctx, {
      shape: 'segment',
      origin: { x: 5, y: 5 },
      end: { x: 5, y: 5 },
      toPx: identity,
      color: 'rgb(255, 255, 0)',
      backgroundIsDark: true,
      iuPerMm: IU,
      units: 'mm',
      devicePixelRatio: 1,
    });
    expect(ctx.calls).toEqual([]);
  });
});

describe('ARC_ASSISTANT', () => {
  const started = (): ArcGeomManager => {
    const mgr = new ArcGeomManager();
    mgr.addPoint({ x: 0, y: 0 }, true);
    return mgr;
  };

  it('reports r and θ while the radius is being set', () => {
    const mgr = started();
    mgr.addPoint({ x: 10 * IU, y: 0 }, false);

    expect(arcCursorStrings(mgr, IU, 'mm')).toEqual(['r: 10.000 mm', 'θ: 0.0°']);
  });

  it('switches to Δθ and θ once sweeping', () => {
    const mgr = started();
    mgr.addPoint({ x: 10 * IU, y: 0 }, true); // start angle 0°
    // Exactly a quarter turn, which is the boundary: `min( ccw 90, cw 270 ) >=
    // ANGLE_90` takes the LOCK arm rather than the choose-the-shorter-way arm,
    // and locking leaves `m_clockwise` at its default of true. So the very
    // first 90° sweep goes the long way round and Δθ reads +270, not −90.
    mgr.addPoint({ x: 0, y: 10 * IU }, false);

    const [dtheta, theta] = arcCursorStrings(mgr, IU, 'mm');
    expect(dtheta).toBe('Δθ: 270.0°');
    // `( GetStartAngle() + GetSubtended() ).Normalize180()` = ( 360 + 270 )
    // normalised, which is where the arc actually ends.
    expect(theta).toBe('θ: -90.0°');
  });

  it('reports the shorter sweep while it is under a quarter turn', () => {
    const mgr = started();
    mgr.addPoint({ x: 10 * IU, y: 0 }, true);
    // 45° below +x: ccw 45 beats cw 315, so the posture goes
    // counter-clockwise and the sweep is reported negative.
    mgr.addPoint({ x: 10 * IU, y: 10 * IU }, false);

    expect(arcCursorStrings(mgr, IU, 'mm')[0]).toBe('Δθ: -45.0°');
  });

  it('draws one radius line and a guide circle while setting the radius', () => {
    const mgr = started();
    mgr.addPoint({ x: 10 * IU, y: 0 }, false);
    const ctx = recorder();
    drawArcAssistant(ctx, {
      mgr,
      toPx: identity,
      worldScale: 1,
      color: 'rgb(255, 255, 0)',
      backgroundIsDark: true,
      iuPerMm: IU,
      units: 'mm',
      devicePixelRatio: 1,
    });

    expect(ctx.calls.filter((c) => c.op === 'arc')).toHaveLength(1);
    expect(ctx.calls.filter((c) => c.op === 'lineTo')).toHaveLength(1);
  });

  it('draws three radius lines and no circle once sweeping', () => {
    // The committed radius (dimmed), the swept radius, and a dimmed extender
    // out to the raw cursor — which is off the arc, because the radius is
    // already fixed.
    const mgr = started();
    mgr.addPoint({ x: 10 * IU, y: 0 }, true);
    mgr.addPoint({ x: 0, y: 40 * IU }, false);
    const ctx = recorder();
    drawArcAssistant(ctx, {
      mgr,
      toPx: identity,
      worldScale: 1,
      color: 'rgb(255, 255, 0)',
      backgroundIsDark: true,
      iuPerMm: IU,
      units: 'mm',
      devicePixelRatio: 1,
    });

    expect(ctx.calls.filter((c) => c.op === 'arc')).toHaveLength(0);
    expect(ctx.calls.filter((c) => c.op === 'lineTo')).toHaveLength(3);
  });

  it('dims the first radius only after it has been locked in', () => {
    // `dimFirstLine = GetStep() > SET_START`, and de-emphasis is alpha 0.5.
    const setting = started();
    setting.addPoint({ x: 10 * IU, y: 3 * IU }, false);
    const a = recorder();
    drawArcAssistant(a, {
      mgr: setting,
      toPx: identity,
      worldScale: 1,
      color: 'rgb(255, 255, 0)',
      backgroundIsDark: true,
      iuPerMm: IU,
      units: 'mm',
      devicePixelRatio: 1,
    });
    expect(a.calls.find((c) => c.op === 'lineTo')!.stroke).toBe('rgb(255, 255, 0)');

    const sweeping = started();
    sweeping.addPoint({ x: 10 * IU, y: 3 * IU }, true);
    sweeping.addPoint({ x: 3 * IU, y: 10 * IU }, false);
    const b = recorder();
    drawArcAssistant(b, {
      mgr: sweeping,
      toPx: identity,
      worldScale: 1,
      color: 'rgb(255, 255, 0)',
      backgroundIsDark: true,
      iuPerMm: IU,
      units: 'mm',
      devicePixelRatio: 1,
    });
    expect(b.calls.find((c) => c.op === 'lineTo')!.stroke).toBe('rgba(255, 255, 0, 0.5)');
  });
});

describe('DRAW_CONTEXT’s special-angle highlight', () => {
  it('fires on every multiple of 45°, axes included', () => {
    for (const deg of [0, 45, 90, 135, 180, -45, -90])
      expect(angleIsSpecial((deg * Math.PI) / 180)).toBe(true);
  });

  it('does not fire off one', () => {
    expect(angleIsSpecial((30 * Math.PI) / 180)).toBe(false);
    expect(angleIsSpecial((44 * Math.PI) / 180)).toBe(false);
  });

  it('is a different green on a light background', () => {
    // [data] `draw_context.cpp:138-139` — COLOR4D( 0.5, 1.0, 0.5 ) dark,
    // COLOR4D( 0.0, 0.7, 0.0 ) light.
    expect(specialAngleColour(true)).toBe('rgb(128, 255, 128)');
    expect(specialAngleColour(false)).toBe('rgb(0, 179, 0)');
  });
});

describe('DrawTextNextToCursor', () => {
  const place = (quadrant: { x: number; y: number }): Call[] => {
    const ctx = recorder();
    drawTextNextToCursor(ctx, {
      cursor: { x: 1000, y: 1000 },
      quadrant,
      strings: ['a', 'b'],
      color: 'rgb(255, 255, 0)',
      devicePixelRatio: 1,
    });
    return ctx.calls.filter((c) => c.op === 'fillText');
  };

  it('a NEGATIVE quadrant x left-aligns and moves RIGHT', () => {
    // `if( aTextQuadrant.x < 0 ) { m_Halign = LEFT; textPos.x += 15 }`.
    const calls = place({ x: -1, y: -1 });
    expect(calls[0]!.align).toBe('left');
    expect(calls[0]!.args[1]).toBe(1015);
  });

  it('a positive quadrant x right-aligns and moves left', () => {
    const calls = place({ x: 1, y: -1 });
    expect(calls[0]!.align).toBe('right');
    expect(calls[0]!.args[1]).toBe(985);
  });

  it('the vertical offset is a LINE PITCH, not the 15 px', () => {
    const pitch = constantLinePitchPx(1);
    const down = place({ x: 1, y: -1 });
    expect(down[0]!.args[2]).toBeCloseTo(1000 + pitch, 6);
  });

  it('a POSITIVE quadrant y lifts the whole block above the cursor', () => {
    // `textPos.y -= LinePitch * ( n + 1 )`, then the loop adds one pitch before
    // each line: with two strings the first lands two pitches above.
    const pitch = constantLinePitchPx(1);
    const up = place({ x: 1, y: 1 });
    expect(up[0]!.args[2]).toBeCloseTo(1000 - 2 * pitch, 6);
    expect(up[1]!.args[2]).toBeCloseTo(1000 - pitch, 6);
  });

  it('keeps the strings in the order given', () => {
    expect(place({ x: 1, y: 1 }).map((c) => c.args[0])).toEqual(['a', 'b']);
  });
});

describe('arcMidPoint', () => {
  /** Centre (0,0), radius 10 mm, start on +x, cursor a quarter turn below. */
  const quarter = (): ArcGeomManager => {
    const mgr = new ArcGeomManager();
    mgr.addPoint({ x: 0, y: 0 }, true);
    mgr.addPoint({ x: 10 * IU, y: 0 }, true);
    mgr.addPoint({ x: 0, y: 10 * IU }, false);
    return mgr;
  };

  it('lands on the circle, not on the chord', () => {
    const mgr = quarter();
    const mid = arcMidPoint(mgr);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(10 * IU, 0);
  });

  it('bisects the sweep the manager actually reports, not the short way', () => {
    // That first quarter turn locks clockwise (see above), so the arc runs the
    // LONG way round: 270° from +x, whose midpoint is 135° back — up and to
    // the left. Bisecting the 90° chord instead would put it down-right, and
    // the committed arc would bow the wrong way.
    const mid = arcMidPoint(quarter());
    expect(mid.x).toBeLessThan(0);
    expect(mid.y).toBeLessThan(0);
  });

  it('follows the posture when it is flipped', () => {
    const mgr = quarter();
    mgr.toggleClockwise();
    const mid = arcMidPoint(mgr);
    // Counter-clockwise now: the 90° sweep's midpoint is at 45°, down-right.
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.y).toBeGreaterThan(0);
  });
});

describe('ARC_GEOM_MANAGER radius ends, on this canvas', () => {
  it('a start clicked BELOW the centre comes back below it', () => {
    // A round trip through `EDA_ANGLE( radVec )` and `RotatePoint( vec, -a )`,
    // which is where a sign error would mirror the whole arc.
    const mgr = new ArcGeomManager();
    mgr.addPoint({ x: 0, y: 0 }, true);
    mgr.addPoint({ x: 0, y: 1000 }, true);

    expect(mgr.getStartRadiusEnd()).toEqual({ x: 0, y: 1000 });
  });

  it('and one clicked up-left comes back up-left', () => {
    const mgr = new ArcGeomManager();
    mgr.addPoint({ x: 0, y: 0 }, true);
    mgr.addPoint({ x: -1000, y: -1000 }, true);

    const p = mgr.getStartRadiusEnd();
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0);
  });
});
