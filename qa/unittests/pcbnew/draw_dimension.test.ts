// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a dimension.
 * Counterpart: `DRAWING_TOOL::DrawDimension`, which drives all five drawing
 * actions through one state machine.
 *
 * The two things worth pinning are the ones that are invisible in the C++:
 *
 * - **Centre, radial and leader finish in two clicks; aligned and orthogonal
 *   need three.** Upstream writes that as a bare `++step; KI_FALLTHROUGH;`
 *   inside a switch, which is easy to read straight past.
 * - **`setMeasurementAttributes` is not applied to centre or leader.** Those
 *   keep their constructor values, because neither shows a measurement. Giving
 *   a leader the board's units block would quietly put a suffix on a label.
 *
 * Fixtures are in millimetres; the arithmetic rounds to whole IU.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { addBoardDimension } from '@ziroeda/pcbnew/src/edit-board.js';
import {
  DEFAULT_ARROW_LENGTH,
  DEFAULT_DIMENSION_DEFAULTS,
  clickDimension,
  dimensionClickCount,
  moveDimension,
  radialKnee,
  setHeightFromCursor,
  startDimension,
  type DimensionDraw,
} from '@ziroeda/pcbnew/src/draw_dimension.js';
import type { DimensionKind } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): { x: number; y: number } => ({ x: MM(x), y: MM(y) });
const ALL: DimensionKind[] = ['aligned', 'orthogonal', 'center', 'radial', 'leader'];

/** Place one by clicking through the given points. */
const place = (kind: DimensionKind, ...clicks: Array<{ x: number; y: number }>): DimensionDraw => {
  let d = startDimension(kind, clicks[0]!);
  for (const c of clicks.slice(1)) d = clickDimension(d, c);
  return d;
};

describe('how many clicks each kind takes', () => {
  it('is three for the two that have a crossbar', () => {
    expect(dimensionClickCount('aligned')).toBe(3);
    expect(dimensionClickCount('orthogonal')).toBe(3);
  });

  it('is two for the three that do not', () => {
    // Upstream's SET_END falls through to SET_HEIGHT for these.
    expect(dimensionClickCount('center')).toBe(2);
    expect(dimensionClickCount('radial')).toBe(2);
    expect(dimensionClickCount('leader')).toBe(2);
  });
});

describe('the first click', () => {
  it('puts both feature points on the cursor', () => {
    const d = startDimension('aligned', P(10, 10)).dimension;

    expect(d.start).toEqual(P(10, 10));
    expect(d.end).toEqual(P(10, 10));
  });

  it('starts on the default layer', () => {
    expect(startDimension('aligned', P(0, 0)).dimension.layer).toBe('Dwgs.User');
  });

  it('takes the layer it is given', () => {
    const d = startDimension('aligned', P(0, 0), {
      ...DEFAULT_DIMENSION_DEFAULTS,
      layer: 'F.SilkS',
    }).dimension;

    expect(d.layer).toBe('F.SilkS');
  });

  it('is not finished', () => {
    for (const k of ALL) expect(startDimension(k, P(0, 0)).done, k).toBe(false);
  });
});

describe('the defaults each kind starts with', () => {
  it('gives every kind the board line thickness and arrow length', () => {
    for (const k of ALL) {
      const s = startDimension(k, P(0, 0)).dimension.style;
      expect(s.thickness, k).toBe(DEFAULT_DIMENSION_DEFAULTS.lineThickness);
      expect(s.arrowLength, k).toBe(DEFAULT_ARROW_LENGTH);
    }
  });

  it('gives the measuring kinds the board units block', () => {
    for (const k of ['aligned', 'orthogonal', 'radial'] as const) {
      const f = startDimension(k, P(0, 0)).dimension.format!;
      expect(f.units, k).toBe(DEFAULT_DIMENSION_DEFAULTS.unitsMode);
      expect(f.precision, k).toBe(DEFAULT_DIMENSION_DEFAULTS.precision);
      expect(f.suppressZeroes, k).toBe(true);
    }
  });

  it('withholds it from a leader, which shows typed text', () => {
    // The failure this guards: a leader silently gaining a units suffix.
    const f = startDimension('leader', P(0, 0)).dimension.format!;

    expect(f.units).toBe(0);
    expect(f.unitsFormat).toBe(0);
    expect(f.suppressZeroes).toBe(false);
  });

  it('gives a leader its override text', () => {
    expect(startDimension('leader', P(0, 0)).dimension.format!.overrideValue).toBe('Leader');
    expect(startDimension('aligned', P(0, 0)).dimension.format!.overrideValue).toBeUndefined();
  });

  it('gives a radial the R prefix and a leader length of three arrows', () => {
    const d = startDimension('radial', P(0, 0)).dimension;

    expect(d.format!.prefix).toBe('R ');
    expect(d.leaderLength).toBe(DEFAULT_ARROW_LENGTH * 3);
  });

  it('gives a centre dimension no format and no text at all', () => {
    const d = startDimension('center', P(0, 0)).dimension;

    expect(d.format).toBeUndefined();
    expect(d.text).toBeUndefined();
  });

  it('seeds the aligned extension height from the arrow length', () => {
    // PCB_DIM_ALIGNED: m_arrowLength * sin(27.5 deg), "to preserve look of old
    // dimensions".
    const s = startDimension('aligned', P(0, 0)).dimension.style;

    expect(
      s.extensionHeight! / (DEFAULT_ARROW_LENGTH * Math.sin((27.5 * Math.PI) / 180)),
    ).toBeCloseTo(1, 3);
  });

  it('starts an orthogonal one horizontal', () => {
    expect(startDimension('orthogonal', P(0, 0)).dimension.orientation).toBe(0);
  });
});

describe('the second click', () => {
  it('is refused when it lands on the origin', () => {
    // A dimension with both feature points in one spot is not valid, so the
    // click is ignored rather than committing a zero-length one.
    const d = clickDimension(startDimension('aligned', P(5, 5)), P(5, 5));

    expect(d.step).toBe('end');
    expect(d.done).toBe(false);
  });

  it('finishes a centre, radial or leader', () => {
    for (const k of ['center', 'radial', 'leader'] as const)
      expect(place(k, P(0, 0), P(10, 0)).done, k).toBe(true);
  });

  it('does not finish an aligned or orthogonal', () => {
    for (const k of ['aligned', 'orthogonal'] as const)
      expect(place(k, P(0, 0), P(10, 0)).done, k).toBe(false);
  });

  it('sets the end point', () => {
    expect(place('aligned', P(0, 0), P(10, 4)).dimension.end).toEqual(P(10, 4));
  });
});

describe('the orthogonal preview orientation', () => {
  it('measures the longer side while dragging', () => {
    const wide = moveDimension(startDimension('orthogonal', P(0, 0)), P(30, 5)).dimension;
    const tall = moveDimension(startDimension('orthogonal', P(0, 0)), P(5, 30)).dimension;

    expect(wide.orientation).toBe(0);
    expect(tall.orientation).toBe(1);
  });
});

describe('the third click, placing the crossbar', () => {
  it('projects the cursor onto the perpendicular for an aligned one', () => {
    // A horizontal dimension: the height is just the vertical offset.
    const d = place('aligned', P(0, 0), P(10, 0));
    const h = setHeightFromCursor(d.dimension, P(5, 7));

    expect(h.height! / MM(7)).toBeCloseTo(1, 3);
  });

  it('ignores movement along the dimension axis', () => {
    // Sliding the cursor parallel to the measurement must not change the
    // crossbar distance — that is what makes the projection the right operation.
    const d = place('aligned', P(0, 0), P(10, 0));
    const a = setHeightFromCursor(d.dimension, P(2, 7)).height!;
    const b = setHeightFromCursor(d.dimension, P(90, 7)).height!;

    expect(a).toBe(b);
  });

  it('projects onto the true perpendicular of a diagonal dimension', () => {
    // 45 degrees: a cursor offset of (0, 10) projects to 10*cos(45).
    const d = place('aligned', P(0, 0), P(10, 10));
    const h = setHeightFromCursor(d.dimension, P(10, 20)).height!;

    expect(h / (MM(10) * Math.SQRT1_2)).toBeCloseTo(1, 2);
  });

  it('takes one raw axis for an orthogonal one', () => {
    const d = place('orthogonal', P(0, 0), P(30, 5));
    const h = setHeightFromCursor(d.dimension, P(15, 20));

    expect(h.orientation).toBe(0);
    expect(h.height).toBe(MM(20));
  });

  it('keeps the orientation while the cursor stays inside the feature box', () => {
    // Otherwise it flickers as you cross the diagonal.
    const d = place('orthogonal', P(0, 0), P(30, 20));
    const before = setHeightFromCursor(d.dimension, P(100, 10)); // outside, picks vertical
    const inside = setHeightFromCursor(before, P(15, 10)); // inside the box

    expect(inside.orientation).toBe(before.orientation);
  });

  it('re-picks the orientation once the cursor leaves the box', () => {
    const d = place('orthogonal', P(0, 0), P(30, 20));
    const right = setHeightFromCursor(d.dimension, P(100, 10));
    const below = setHeightFromCursor(right, P(15, 100));

    expect(right.orientation).toBe(1);
    expect(below.orientation).toBe(0);
  });

  it('finishes on that click', () => {
    expect(place('aligned', P(0, 0), P(10, 0), P(5, 7)).done).toBe(true);
  });
});

describe('the dragged text position', () => {
  it('puts a leader label out to the right when it points right', () => {
    const d = moveDimension(startDimension('leader', P(0, 0)), P(10, 0)).dimension;

    expect(d.text!.at.x).toBe(MM(10) + DEFAULT_ARROW_LENGTH * 10);
  });

  it('flips it to the left when the leader points left', () => {
    // Otherwise the label lands back on top of the geometry.
    const d = moveDimension(startDimension('leader', P(0, 0)), P(-10, 0)).dimension;

    expect(d.text!.at.x).toBe(MM(-10) - DEFAULT_ARROW_LENGTH * 10);
  });

  it('hangs a radial label off the knee, not off the measured point', () => {
    const d = moveDimension(startDimension('radial', P(0, 0)), P(10, 0)).dimension;
    const knee = radialKnee(d);

    expect(knee.x).toBe(MM(10) + DEFAULT_ARROW_LENGTH * 3);
    expect(d.text!.at.x).toBe(knee.x + DEFAULT_ARROW_LENGTH * 10);
  });
});

describe('committing to the board', () => {
  const EMPTY_BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 ""))`;

  it('appends it and hands back its id', () => {
    const board = readBoard(parse(EMPTY_BOARD));
    const { board: next, id } = addBoardDimension(
      board,
      place('aligned', P(0, 0), P(10, 0), P(5, 7)).dimension,
    );

    expect(id).toBe('dimension:0');
    expect(next.dimensions).toHaveLength(1);
  });

  it('writes a placed dimension into the file and reads it back', () => {
    // Source-less, so the writer builds the node from the model.
    const board = readBoard(parse(EMPTY_BOARD));
    const { board: next } = addBoardDimension(
      board,
      place('orthogonal', P(0, 0), P(30, 5), P(15, 20)).dimension,
    );
    const back = readBoard(parse(serializeBoard(next)));

    expect(back.dimensions).toHaveLength(1);
    expect(back.dimensions[0]!.kind).toBe('orthogonal');
    expect(back.dimensions[0]!.start).toEqual(P(0, 0));
    expect(back.dimensions[0]!.end).toEqual(P(30, 5));
    expect(back.dimensions[0]!.height).toBe(MM(20));
  });

  it('round-trips every kind', () => {
    for (const k of ALL) {
      const clicks: Array<{ x: number; y: number }> =
        dimensionClickCount(k) === 3 ? [P(0, 0), P(10, 0), P(5, 7)] : [P(0, 0), P(10, 0)];
      const { board } = addBoardDimension(
        readBoard(parse(EMPTY_BOARD)),
        place(k, ...clicks).dimension,
      );
      const back = readBoard(parse(serializeBoard(board)));

      expect(back.dimensions, k).toHaveLength(1);
      expect(back.dimensions[0]!.kind, k).toBe(k);
    }
  });
});
