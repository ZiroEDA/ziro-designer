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
  dimensionSnapsToGrid,
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

  it('mirrors the label when the dimension goes on a back layer', () => {
    // `dimension->SetMirrored( m_board->IsBackLayer( layer ) )`: a label on a
    // back layer is read through the board.
    const back = { ...DEFAULT_DIMENSION_DEFAULTS, layer: 'B.SilkS' };
    expect(startDimension('aligned', P(0, 0), back).dimension.text!.mirror).toBe(true);

    const front = { ...DEFAULT_DIMENSION_DEFAULTS, layer: 'F.SilkS' };
    expect(startDimension('aligned', P(0, 0), front).dimension.text!.mirror).toBeFalsy();
  });

  it('carries both text axes onto the label', () => {
    // `SetTextSize( boardSettings.GetTextSize( layer ) )` is a VECTOR2I, so a
    // condensed layer class produces a condensed label rather than a square one.
    const d = startDimension('aligned', P(0, 0), {
      ...DEFAULT_DIMENSION_DEFAULTS,
      textWidth: MM(0.6),
      textHeight: MM(1.5),
    }).dimension;

    expect(d.text!.size).toEqual({ x: MM(0.6), y: MM(1.5) });
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

  it('compares the signed box size, not the spans', () => {
    // `BOX2I bounds( GetStart(), GetEnd() - GetStart() )` keeps the size it was
    // handed, sign and all, and `GetWidth()`/`GetHeight()` hand it straight
    // back (box2.h:212-215) — only `Contains()` normalises. So dragging left
    // and slightly down gives width -30 against height +5, and -30 < 5 picks
    // VERTICAL, where a comparison of |30| against |5| would pick horizontal.
    const left = moveDimension(startDimension('orthogonal', P(0, 0)), P(-30, 5)).dimension;
    expect(left.orientation).toBe(1);

    // The mirror image of the passing case above: same spans, opposite signs.
    const up = moveDimension(startDimension('orthogonal', P(0, 0)), P(5, -30)).dimension;
    expect(up.orientation).toBe(0);
  });
});

describe('the 45 degree constraint', () => {
  // `if( constrained || t == PCB_DIM_CENTER_T ) constrainDimension( dimension )`
  // in SET_END. `constrained` is `GetAngleSnapMode() != DIRECT`, and pcbnew
  // defaults to DIRECT (pcbnew_settings.cpp:191-192) — but a centre mark is
  // snapped whatever the preference says, which is why its cross always reads
  // as square or as a true diagonal.
  it('snaps a centre mark onto the axis when it is well off 45', () => {
    // |x| 10 > |y| 3 * 2, so the y component is zeroed.
    const d = moveDimension(startDimension('center', P(0, 0)), P(10, 3)).dimension;
    expect(d.end).toEqual(P(10, 0));
  });

  it('snaps a centre mark onto the diagonal when it is near it', () => {
    // Neither component dominates by 2x and |x| > |y|, so y takes x's magnitude
    // with its own sign: copysign(10, 8).
    const d = moveDimension(startDimension('center', P(0, 0)), P(10, 8)).dimension;
    expect(d.end).toEqual(P(10, 10));
  });

  it('keeps the magnitude of the dominant axis, so the end stays on the grid', () => {
    // `GetVectorSnapped45` deliberately does not preserve the length — it zeroes
    // or matches components. Resizing to the original length here would put the
    // far end off any grid the start was on.
    const d = moveDimension(startDimension('center', P(0, 0)), P(-4, 10)).dimension;
    expect(d.end).toEqual(P(0, 10));
  });

  it('leaves the other four kinds free, because the default snap mode is DIRECT', () => {
    for (const kind of ['aligned', 'orthogonal', 'radial', 'leader'] as DimensionKind[]) {
      const d = moveDimension(startDimension(kind, P(0, 0)), P(10, 3)).dimension;
      expect(d.end).toEqual(P(10, 3));
    }
  });

  it('constrains them once the snap mode says so', () => {
    const d = moveDimension(startDimension('aligned', P(0, 0)), P(10, 3), {
      constrain45: true,
    }).dimension;
    expect(d.end).toEqual(P(10, 0));
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

  it('reads the box edges unnormalised, the way BOX2I hands them back', () => {
    // A tall box built bottom-to-top: start (0,20), end (2,0), so GetTop() is
    // 20 and GetBottom() is 0 — inverted. The cursor at (3,19) is outside the
    // box (x is past the right edge) and *is* between the two y coordinates, so
    // a normalised reading would take the `cursor.y > top && < bottom` branch
    // and answer VERTICAL. Upstream's does not: that test is `19 > 20`, false,
    // so it falls through to comparing the offset from the centre (1,10) —
    // |9| < |2| is false, giving HORIZONTAL.
    const d = place('orthogonal', P(0, 20), P(2, 0));
    expect(setHeightFromCursor(d.dimension, P(3, 19)).orientation).toBe(0);
  });
});

describe('whether the cursor is still snapped to the grid', () => {
  // `if( step == SET_HEIGHT && t != PCB_DIM_ORTHOGONAL_T ) { if( start.x !=
  // end.x && start.y != end.y ) grid.SetUseGrid( false ); }` — "Not cardinal.
  // Grid snapping doesn't make sense for height."
  it('snaps while the end point is still being placed', () => {
    expect(dimensionSnapsToGrid(startDimension('aligned', P(0, 0)))).toBe(true);
  });

  it('stops snapping on the crossbar of a diagonal aligned dimension', () => {
    expect(dimensionSnapsToGrid(place('aligned', P(0, 0), P(10, 7)))).toBe(false);
  });

  it('keeps snapping when the dimension is cardinal', () => {
    // Its normal is then an axis, so grid points along it are evenly spaced.
    expect(dimensionSnapsToGrid(place('aligned', P(0, 0), P(10, 0)))).toBe(true);
    expect(dimensionSnapsToGrid(place('aligned', P(0, 0), P(0, 10)))).toBe(true);
  });

  it('keeps snapping for an orthogonal one however it was dragged', () => {
    // Its height is one raw axis of the cursor, which is on the grid already.
    expect(dimensionSnapsToGrid(place('orthogonal', P(0, 0), P(10, 7)))).toBe(true);
  });
});

describe('the label, which is derived rather than authored', () => {
  it('is already derived on the very first click, before any motion', () => {
    // SET_ORIGIN ends with `dimension->Update()` too, with both feature points
    // still on the cursor. The measurement is 0, and 0 formatted at X_XXXX with
    // zeroes suppressed is "0" — "0.0000" loses its zeroes one at a time and the
    // loop stops after eating the decimal point. An un-updated item would still
    // be carrying the empty string its text child was built with.
    expect(startDimension('aligned', P(3, 4)).dimension.text!.text).toBe('0');
    // A radial's prefix is on it from the start as well.
    expect(startDimension('radial', P(3, 4)).dimension.text!.text).toBe('R 0');
  });

  it('shows the measurement as soon as the second click lands', () => {
    // `dimension->Update()` runs at the end of every step; without it the item
    // is committed with the empty string its text item was built with.
    const d = place('aligned', P(0, 0), P(10, 0));
    expect(d.dimension.text!.text).toBe('10');
  });

  it('tracks the cursor while the end point is still moving', () => {
    let d = startDimension('aligned', P(0, 0));
    d = moveDimension(d, P(3, 4));
    expect(d.dimension.text!.text).toBe('5'); // 3-4-5
    d = moveDimension(d, P(6, 8));
    expect(d.dimension.text!.text).toBe('10');
  });

  it('follows the frame units when the board setup says AUTOMATIC', () => {
    // DEFAULT_DIMENSION_DEFAULTS has unitsMode 3.
    const d = place('aligned', P(0, 0), P(25.4, 0));
    expect(d.dimension.text!.text).toBe('25.4');
    const inches = clickDimension(
      startDimension('aligned', P(0, 0), undefined, { userUnits: 'in' }),
      P(25.4, 0),
      {
        userUnits: 'in',
      },
    );
    expect(inches.dimension.text!.text).toBe('1');
  });

  it('gives a radial its R prefix around the measured radius', () => {
    const d = place('radial', P(0, 0), P(0, 4));
    expect(d.dimension.text!.text).toBe('R 4');
  });

  it('leaves a leader on its typed override, with no units glued on', () => {
    const d = place('leader', P(0, 0), P(10, 10));
    expect(d.dimension.text!.text).toBe('Leader');
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
