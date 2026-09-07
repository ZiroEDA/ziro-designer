// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The frame and name tab a selected group draws around itself.
 * Counterpart: `PCB_PAINTER::draw( const PCB_GROUP*, int aLayer )`'s
 * `LAYER_ANCHOR` arm (`pcbnew/pcb_painter.cpp:2866-2931`).
 *
 * Selecting a group used to show *nothing at all* here: the members were not
 * highlighted, because the selection overlay handed the raw selection to
 * `subsetBoardItems` and a group id names no item of its own, and the group
 * drew no frame either because this had no port. KiCad shows both — 153
 * brightened members inside a box captioned `group-boardStackUp`.
 */
import { describe, expect, it } from 'vitest';
import {
  groupBoxSegments,
  groupLabelAnchor,
  groupLabelFits,
  groupLabelTextSize,
} from '@ziroeda/designer/src/editors/pcb/group_box.js';
import { pcbIUScale, pcbMmToIU as MM } from '@ziroeda/common/src/eda_units.js';

const box = { minX: MM(10), minY: MM(20), maxX: MM(110), maxY: MM(70) };

describe('the label size, which is neither fixed on screen nor fixed on the board', () => {
  it('blends two parts board size to one part screen size', () => {
    // `textSize = ( scaledSize + unscaledSize * 2 ) / 3` with
    // `scaledSize = |round(worldPerPixel * 12)|` and
    // `unscaledSize = MilsToIU( 12 )`.
    const unscaled = pcbIUScale.milsToIU(12);
    const worldPerPixel = 5000; // IU per screen pixel
    const expected = Math.trunc((Math.round(worldPerPixel * 12) + unscaled * 2) / 3);
    expect(groupLabelTextSize(worldPerPixel)).toBe(expected);
  });

  it('tends to two thirds of the fixed board size as you zoom in', () => {
    // At an enormous zoom the screen term vanishes and only `unscaledSize * 2 / 3`
    // is left — "scale by zoom a bit, but not too much".
    const unscaled = pcbIUScale.milsToIU(12);
    expect(groupLabelTextSize(0)).toBe(Math.trunc((unscaled * 2) / 3));
  });

  it('grows with the world size of a pixel as you zoom out', () => {
    expect(groupLabelTextSize(20000)).toBeGreaterThan(groupLabelTextSize(1000));
  });
});

describe('whether the name is drawn at all', () => {
  it('needs the name to be narrower than the box', () => {
    // `PrintableCharCount( name ) * textSize < bbox.GetWidth()`. The box is
    // 100 mm across, so at a 1 mm label 99 characters fit and 100 do not.
    const t = MM(1);
    expect(groupLabelFits('x'.repeat(99), box, t)).toBe(true);
    expect(groupLabelFits('x'.repeat(100), box, t)).toBe(false);
  });

  it('says no to an empty name, which upstream returns early on', () => {
    expect(groupLabelFits('', box, MM(1))).toBe(false);
  });

  it('counts printable characters, not bytes — markup does not widen it', () => {
    // `PrintableCharCount` skips the markup braces, so an overbarred name is
    // measured by what it prints.
    const t = MM(1);
    expect(groupLabelFits(`${'x'.repeat(99)}~{}`, box, t)).toBe(true);
  });
});

describe('the box and its tab', () => {
  it('draws four sides and nothing else when the name does not fit', () => {
    const segs = groupBoxSegments(box, 'x'.repeat(200), MM(1));
    expect(segs).toHaveLength(4);
    // Closed: the last segment returns to the first's start.
    expect(segs[3]!.b).toEqual(segs[0]!.a);
  });

  it('adds the three-sided tab above the top edge when it does', () => {
    const t = MM(1);
    const segs = groupBoxSegments(box, 'Stackup', t);
    expect(segs).toHaveLength(7);

    // `titleHeight = ( 0, textSize * 2 )`, SUBTRACTED — so the tab rises.
    const tab = segs.slice(4);
    const topY = box.minY;
    expect(tab[0]!.a).toEqual({ x: box.minX, y: topY });
    expect(tab[0]!.b).toEqual({ x: box.minX, y: topY - 2 * t });
    expect(tab[1]!.b).toEqual({ x: box.maxX, y: topY - 2 * t });
    expect(tab[2]!.b).toEqual({ x: box.maxX, y: topY });
    // and it is above the box, not below it.
    expect(tab[0]!.b.y).toBeLessThan(topY);
  });

  it('spans exactly the group box', () => {
    const segs = groupBoxSegments(box, '', MM(1));
    const xs = segs.flatMap((s) => [s.a.x, s.b.x]);
    const ys = segs.flatMap((s) => [s.a.y, s.b.y]);
    expect(Math.min(...xs)).toBe(box.minX);
    expect(Math.max(...xs)).toBe(box.maxX);
    expect(Math.min(...ys)).toBe(box.minY);
    expect(Math.max(...ys)).toBe(box.maxY);
  });
});

describe('where the name sits', () => {
  it('is centred on the top edge, half a text size above it', () => {
    // `topLeft + KiROUND( width.x / 2.0, -textSize * 0.5 )`.
    const t = MM(1);
    expect(groupLabelAnchor(box, t)).toEqual({
      x: MM(10) + MM(50),
      y: MM(20) - MM(0.5),
    });
  });

  it('sits inside the tab rather than over the members', () => {
    const t = MM(1);
    const at = groupLabelAnchor(box, t);
    const tabTop = box.minY - 2 * t;
    expect(at.y).toBeGreaterThan(tabTop);
    expect(at.y).toBeLessThan(box.minY);
  });
});
