// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TransformArcToPolygon`, vertex for vertex against KiCad 10.0.5.
 *
 * The expectation is KiCad's own polygon for CM5_MINIMA_3's board-corner arc,
 * read through its Python API:
 *
 *     shape.TransformShapeToPolygon( ps, Edge_Cuts, 372500, 5000, ERROR_OUTSIDE, True )
 *
 * That arc's stored mid point is 7.6° off the arc's bisector, and upstream's
 * `ARC_CHORD_PARAMS` derives the circle from the chord and THAT point's
 * distance from it — so its radius is 3101197 for a 3100000 arc, its centre
 * 29 µm further from the chord, and its polygon sags by that much in the
 * middle. The exact circumcircle, which this tree used, is the better circle
 * and the wrong pour: 0.33 mm² on every layer of that board. Matching upstream
 * means matching its arithmetic, and the 81 vertices here are the proof that
 * it does, to the unit.
 */
import { describe, it, expect } from 'vitest';
import { arcToPolygon } from '@ziroeda/pcbnew/src/convert_basic_shapes_to_polygon.js';

const START = { x: 76016039, y: 25598601 };
const MID = { x: 76117273, y: 21009482 };
const END = { x: 80108863, y: 20947324 };

// prettier-ignore
const KICAD: [number, number][] = [
  [76274975, 25330817],
  [76313477, 25368046],
  [76366384, 25461183],
  [76390907, 25565453],
  [76385061, 25672408],
  [76349319, 25773384],
  [76286577, 25860200],
  [76201917, 25925823],
  [76102199, 25964936],
  [75995500, 25974371],
  [75890465, 25953363],
  [75795604, 25903615],
  [75757103, 25866385],
  [75625790, 25739364],
  [75391211, 25459219],
  [75187312, 25156012],
  [75016344, 24833090],
  [74880192, 24494016],
  [74780360, 24142530],
  [74717948, 23782511],
  [74693645, 23417931],
  [74707720, 23052814],
  [74760017, 22691187],
  [74849959, 22337041],
  [74976554, 21994284],
  [75138405, 21666697],
  [75333726, 21357895],
  [75560362, 21071285],
  [75815812, 20810030],
  [76097257, 20577012],
  [76401593, 20374803],
  [76725461, 20205633],
  [77065288, 20071370],
  [77417323, 19973494],
  [77777684, 19913085],
  [78142393, 19890811],
  [78507427, 19906916],
  [78868757, 19961224],
  [79222397, 20053134],
  [79564445, 20181634],
  [79891127, 20345304],
  [80198838, 20542339],
  [80341531, 20656426],
  [80383356, 20689878],
  [80444768, 20777640],
  [80478967, 20879149],
  [80483183, 20986181],
  [80457073, 21090065],
  [80402753, 21182385],
  [80324624, 21255662],
  [80229015, 21303959],
  [80123673, 21323363],
  [80017130, 21312304],
  [79918019, 21271675],
  [79876195, 21238222],
  [79615288, 21053519],
  [79334570, 20900595],
  [79037895, 20781551],
  [78729333, 20698019],
  [78413120, 20651145],
  [78093595, 20641574],
  [77775143, 20669437],
  [77462135, 20734350],
  [77158866, 20835424],
  [76869498, 20971271],
  [76598004, 21140027],
  [76348108, 21339376],
  [76123240, 21566582],
  [75926486, 21818526],
  [75760548, 22091752],
  [75627701, 22382509],
  [75529769, 22686807],
  [75468096, 23000469],
  [75443528, 23319193],
  [75456404, 23638602],
  [75506545, 23954313],
  [75593264, 24261994],
  [75715371, 24557423],
  [75871189, 24836544],
  [76058581, 25095526],
];

/** The same ring whichever vertex it starts at and whichever way it runs. */
function canonical(ring: [number, number][]): string[] {
  const pts = ring.map(([x, y]) => `${x},${y}`);
  const first = pts.indexOf([...pts].sort()[0]!);
  const rotated = [...pts.slice(first), ...pts.slice(0, first)];
  const reversed = [rotated[0]!, ...rotated.slice(1).reverse()];
  return rotated.join(' ') < reversed.join(' ') ? rotated : reversed;
}

describe('TransformArcToPolygon', () => {
  it("is KiCad's polygon for CM5's board corner, to the unit", () => {
    // Edge.Cuts: the line width is ignored, so the width is twice the gap —
    // the 0.372 mm edge clearance plus m_ExtraClearance.
    const ours = arcToPolygon(START, MID, END, 2 * 372500, 5000);
    expect(ours).toHaveLength(KICAD.length);
    expect(canonical(ours)).toEqual(canonical(KICAD));
  });

  it("sags where upstream's does: the middle vertex is 23 µm short of the circumcircle", () => {
    // Distance from the TRUE centre (78150000, 23350000), radius 3100000, at
    // the arc's bisector: the exact offset circle would put it at 3472499.
    const ours = arcToPolygon(START, MID, END, 2 * 372500, 5000);
    const dists = ours.map(([x, y]) => Math.hypot(x - 78150000, y - 23350000));
    const outer = dists.filter((d) => d > 3100000);
    expect(Math.min(...outer)).toBeLessThan(3472499 - 20000);
  });
});
