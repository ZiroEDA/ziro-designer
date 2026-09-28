// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ConnectBoardShapes` (`pcbnew/fix_board_shape.cpp`). Every case below is a
 * direct port of KiCad's own oracle,
 * `qa/tests/pcbnew/test_connect_board_shapes.cpp` — same coordinates, same
 * chaining constant, same expected endpoints.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { ConnectBoardShapes } from '@ziroeda/pcbnew/fix_board_shape.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';

// Coordinates are in nanometres. The weld cap is 0.01 mm (10000 nm).
// The chaining value is large so the ends always get paired and only the gap size decides.
const CHAINING = 3_000_000; // 3 mm, the Heal Shapes default

const seg = (sx: number, sy: number, ex: number, ey: number): PCB_SHAPE => {
  const s = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
  s.SetStart({ x: sx, y: sy });
  s.SetEnd({ x: ex, y: ey });
  return s;
};

describe('ConnectBoardShapes', () => {
  it('welds a hairline collinear gap at the midpoint', () => {
    const a = seg(0, 0, 1_000_000, 10_000);
    const b = seg(1_000_100, 10_100, 2_000_100, 20_100); // 141 nm diagonal gap from a.end

    ConnectBoardShapes([a, b], CHAINING);

    expect(a.GetEnd()).toEqual(b.GetStart());
    expect(a.GetEnd()).toEqual({ x: 1_000_050, y: 10_050 });
  });

  it('leaves a large collinear gap alone (a real feature, not rounding noise)', () => {
    const a = seg(0, 0, 1_000_000, 10_000);
    const b = seg(2_000_000, 20_000, 3_000_000, 30_000); // ~1 mm gap, well over the 0.01 mm cap

    ConnectBoardShapes([a, b], CHAINING);

    expect(a.GetEnd()).toEqual({ x: 1_000_000, y: 10_000 });
    expect(b.GetStart()).toEqual({ x: 2_000_000, y: 20_000 });
  });

  it('extends a real corner to its sharp intersection, not the midpoint', () => {
    const a = seg(0, 0, 999_000, 0); // horizontal, short of the corner
    const b = seg(1_000_000, 1000, 1_000_000, 1_000_000); // vertical, short of the corner

    ConnectBoardShapes([a, b], CHAINING);

    // The two lines cross at (1000000, 0), not at the midpoint.
    expect(a.GetEnd()).toEqual(b.GetStart());
    expect(a.GetEnd()).toEqual({ x: 1_000_000, y: 0 });
  });

  it('welds just under the 0.01 mm cap, leaves just over it alone', () => {
    {
      const a = seg(0, 0, 1_000_000, 0);
      const b = seg(1_009_000, 0, 2_009_000, 0); // 9 um gap, under the 10 um cap

      ConnectBoardShapes([a, b], CHAINING);

      expect(a.GetEnd()).toEqual(b.GetStart());
    }
    {
      const a = seg(0, 0, 1_000_000, 0);
      const b = seg(1_011_000, 0, 2_011_000, 0); // 11 um gap, over the 10 um cap

      ConnectBoardShapes([a, b], CHAINING);

      expect(a.GetEnd().x).toBe(1_000_000);
      expect(b.GetStart().x).toBe(1_011_000);
    }
  });
});
