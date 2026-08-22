// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Clicking a drawing-sheet item hits its GEOMETRY, not its bounding box.
 *
 * `DS_DRAW_ITEM_*::HitTest` is overridden per shape precisely because a bbox
 * test is useless here: the sheet's border is a rect spanning the whole page,
 * so a bbox hit selects it from anywhere at all. Upstream states the reason in
 * the rect's own box overload (`ds_draw_item.cpp:397-410`):
 *
 *   "For greedy we need to check each side of the rect as we're pretty much
 *    always inside the rect which defines the drawing-sheet frame."
 *
 * Ours tested `inside(drawItemBBox(d), …)` for every kind, which is why a click
 * in the empty middle of the page selected the border.
 */
import { describe, expect, it } from 'vitest';
import { itemsInBox, pickDrawItem } from '@ziroeda/common/src/drawing_sheet/edit.js';
import type { DsDrawItem } from '@ziroeda/common';

/** The page border: a rect over the whole sheet, as the default stationery has. */
const BORDER: DsDrawItem = {
  kind: 'rect',
  src: 0,
  a: { x: 0, y: 0 },
  b: { x: 4_200_000, y: 2_970_000 },
  width: 1500,
};

/** A short line somewhere inside it. */
const LINE: DsDrawItem = {
  kind: 'line',
  src: 1,
  a: { x: 1_000_000, y: 500_000 },
  b: { x: 1_000_000, y: 900_000 },
  width: 1500,
};

const MIDDLE = { x: 2_100_000, y: 1_485_000 };
const TOL = 2000;

describe('the page border rect', () => {
  it('is NOT selected by a click in the middle of the empty sheet', () => {
    // Akshay's report: "even click in center selects the border".
    expect(pickDrawItem([BORDER], MIDDLE, TOL)).toBeNull();
  });

  it('IS selected by a click on its edge', () => {
    expect(pickDrawItem([BORDER], { x: 2_100_000, y: 0 }, TOL)).toBe(0);
    expect(pickDrawItem([BORDER], { x: 0, y: 1_485_000 }, TOL)).toBe(0);
    expect(pickDrawItem([BORDER], { x: 4_200_000, y: 1_485_000 }, TOL)).toBe(0);
    expect(pickDrawItem([BORDER], { x: 2_100_000, y: 2_970_000 }, TOL)).toBe(0);
  });

  it('is selected just inside the edge, within pen width and tolerance', () => {
    // `dist = aAccuracy + GetPenWidth() / 2`, so the band is tol + 750 IU wide.
    expect(pickDrawItem([BORDER], { x: 2_100_000, y: 2500 }, TOL)).toBe(0);
    // …and not beyond it.
    expect(pickDrawItem([BORDER], { x: 2_100_000, y: 20_000 }, TOL)).toBeNull();
  });
});

describe('a line', () => {
  it('is hit along its length', () => {
    expect(pickDrawItem([LINE], { x: 1_000_000, y: 700_000 }, TOL)).toBe(1);
  });

  it('is not hit off to the side of it', () => {
    expect(pickDrawItem([LINE], { x: 1_050_000, y: 700_000 }, TOL)).toBeNull();
  });

  it('is not hit past its end', () => {
    expect(pickDrawItem([LINE], { x: 1_000_000, y: 950_000 }, TOL)).toBeNull();
  });

  it('carries upstream’s extra 1 IU that the rect does not', () => {
    // `mindist = aAccuracy + ( GetPenWidth() / 2 ) + 1` for a line
    // (ds_draw_item.cpp:463) against `aAccuracy + ( GetPenWidth() / 2 )` for a
    // rect (:362). Exactly at tol + width/2 + 1 the line still hits.
    const edge = { x: 1_000_000 + TOL + LINE.width / 2 + 1, y: 700_000 };
    expect(pickDrawItem([LINE], edge, TOL)).toBe(1);
    const past = { x: 1_000_000 + TOL + LINE.width / 2 + 2, y: 700_000 };
    expect(pickDrawItem([LINE], past, TOL)).toBeNull();
  });
});

describe('with both on the sheet, as the real stationery has', () => {
  const both = [BORDER, LINE];

  it('the middle of the page selects nothing at all', () => {
    expect(pickDrawItem(both, MIDDLE, TOL)).toBeNull();
  });

  it('the line is picked on the line', () => {
    expect(pickDrawItem(both, { x: 1_000_000, y: 700_000 }, TOL)).toBe(1);
  });
});

describe('rubber-band selection', () => {
  it('does not sweep in the border just for being drawn inside it', () => {
    // The same defect in the box overload: a drag in open space used to pick up
    // the frame because the drag box is always inside it.
    expect(itemsInBox([BORDER], 1_000_000, 1_000_000, 1_200_000, 1_200_000)).toStrictEqual([]);
  });

  it('does take the border when the box touches one of its sides', () => {
    expect(itemsInBox([BORDER], -10_000, 1_000_000, 10_000, 1_200_000)).toStrictEqual([0]);
  });

  it('and still takes an ordinary item inside the box', () => {
    expect(itemsInBox([BORDER, LINE], 900_000, 400_000, 1_100_000, 1_000_000)).toStrictEqual([1]);
  });
});
