// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `wx/dc.ts` and `wx/prntbase.ts` against wxWidgets itself: every row below is
 * a line of `qa/probes/printout_fit_probe.cpp`'s output on this machine
 * (wxGTK 3.2) - fit a page to the DC, offset it the way PLEDITOR_PRINTOUT
 * centres it, then convert points both ways.
 */
import { describe, expect, it } from 'vitest';
import { wxDC } from '@ziroeda/common/wx/dc.js';
import { wxPrintout } from '@ziroeda/common/wx/prntbase.js';

class FIT_PRINTOUT extends wxPrintout {
  OnPrintPage(): boolean {
    return true;
  }
}

interface ProbeCase {
  dc: [number, number];
  img: [number, number];
  scale: number;
  paperRect: [number, number, number, number];
  offset: [number, number];
  devOrg: [number, number];
  /** [ x, y ] -> [ LogicalToDeviceX, Y, LogicalToDeviceXRel, YRel ] */
  l2d: [[number, number], [number, number, number, number]][];
  /** [ x, y ] -> [ DeviceToLogicalX, Y, DeviceToLogicalXRel, YRel ] */
  d2l: [[number, number], [number, number, number, number]][];
}

const CASES: ProbeCase[] = [
  {
    dc: [2480, 3508],
    img: [210000, 297000],
    scale: 0.0118095238,
    paperRect: [0, 0, 210000, 297048],
    offset: [0, 24],
    devOrg: [0, 0],
    l2d: [
      [
        [210000, 297000],
        [2480, 3507, 2480, 3507],
      ],
      [
        [12345, 6789],
        [146, 80, 146, 80],
      ],
      [
        [-7, 3],
        [0, 0, 0, 0],
      ],
    ],
    d2l: [
      [
        [1, 1],
        [85, 85, 85, 85],
      ],
      [
        [2480, 3508],
        [210000, 297048, 210000, 297048],
      ],
      [
        [100, 37],
        [8468, 3133, 8468, 3133],
      ],
    ],
  },
  {
    dc: [2480, 3508],
    img: [420000, 297000],
    scale: 0.0059047619,
    paperRect: [0, 0, 420000, 594097],
    offset: [0, 148548],
    devOrg: [0, 877],
    l2d: [
      [
        [420000, 297000],
        [2480, 2631, 2480, 1754],
      ],
      [
        [12345, 6789],
        [73, 917, 73, 40],
      ],
    ],
    d2l: [
      [
        [0, 0],
        [0, -148524, 0, 0],
      ],
      [
        [1, 1],
        [169, -148355, 169, 169],
      ],
      [
        [2480, 3508],
        [420000, 445573, 420000, 594097],
      ],
      [
        [100, 37],
        [16935, -142258, 16935, 6266],
      ],
    ],
  },
  {
    dc: [3508, 2480],
    img: [420000, 297000],
    scale: 0.00835016835,
    paperRect: [0, 0, 420111, 297000],
    offset: [55, 0],
    devOrg: [0, 0],
    l2d: [
      [
        [420000, 297000],
        [3507, 2480, 3507, 2480],
      ],
      [
        [12345, 6789],
        [103, 57, 103, 57],
      ],
    ],
    d2l: [
      [
        [3508, 2480],
        [420111, 297000, 420111, 297000],
      ],
      [
        [100, 37],
        [11976, 4431, 11976, 4431],
      ],
    ],
  },
  {
    dc: [1000, 700],
    img: [297000, 210000],
    scale: 0.00333333333,
    paperRect: [0, 0, 300000, 210000],
    offset: [1500, 0],
    devOrg: [5, 0],
    l2d: [
      [
        [297000, 210000],
        [995, 700, 990, 700],
      ],
      [
        [12345, 6789],
        [46, 23, 41, 23],
      ],
      [
        [-7, 3],
        [5, 0, 0, 0],
      ],
    ],
    d2l: [
      [
        [0, 0],
        [-1500, 0, 0, 0],
      ],
      [
        [1, 1],
        [-1200, 300, 300, 300],
      ],
      [
        [1000, 700],
        [298500, 210000, 300000, 210000],
      ],
      [
        [100, 37],
        [28500, 11100, 30000, 11100],
      ],
    ],
  },
  {
    // The centring offset's device distance is 1450 * 0.003367 = 4.88: wx
    // rounds it to 5, where truncating would give 4.
    dc: [1000, 700],
    img: [297000, 205000],
    scale: 0.00336700337,
    paperRect: [0, 0, 297000, 207900],
    offset: [0, 1450],
    devOrg: [0, 5],
    l2d: [
      [
        [297000, 205000],
        [1000, 695, 1000, 690],
      ],
      [
        [12345, 6789],
        [42, 28, 42, 23],
      ],
    ],
    d2l: [
      [
        [0, 0],
        [0, -1485, 0, 0],
      ],
      [
        [1000, 700],
        [297000, 206415, 297000, 207900],
      ],
      [
        [100, 37],
        [29700, 9504, 29700, 10989],
      ],
    ],
  },
];

describe('wxPrintout page fitting, as wxWidgets computes it', () => {
  it.each(CASES)('dc $dc, image $img', (c) => {
    const dc = new wxDC({} as never, {} as CanvasImageSource, { x: c.dc[0], y: c.dc[1] }, 300);
    const po = new FIT_PRINTOUT('probe');
    po.SetDC(dc);
    po.SetPageSizePixels(c.dc[0], c.dc[1]);
    po.SetPaperRectPixels({ x: 0, y: 0, width: c.dc[0], height: c.dc[1] });

    po.FitThisSizeToPaper({ x: c.img[0], y: c.img[1] });
    expect(dc.GetUserScale().x).toBeCloseTo(c.scale, 9);

    const r = po.GetLogicalPaperRect();
    expect([r.x, r.y, r.width, r.height]).toEqual(c.paperRect);

    // PLEDITOR_PRINTOUT::PrintPage's centring: ( fit - image ) / 2, truncated.
    const xoffset = Math.trunc((r.width - c.img[0]) / 2);
    const yoffset = Math.trunc((r.height - c.img[1]) / 2);
    expect([xoffset, yoffset]).toEqual(c.offset);
    po.OffsetLogicalOrigin(xoffset, yoffset);
    expect(dc.GetDeviceOrigin()).toEqual({ x: c.devOrg[0], y: c.devOrg[1] });

    for (const [[x, y], want] of c.l2d)
      expect([
        dc.LogicalToDeviceX(x),
        dc.LogicalToDeviceY(y),
        dc.LogicalToDeviceXRel(x),
        dc.LogicalToDeviceYRel(y),
      ]).toEqual(want);

    for (const [[x, y], want] of c.d2l)
      expect([
        dc.DeviceToLogicalX(x),
        dc.DeviceToLogicalY(y),
        dc.DeviceToLogicalXRel(x),
        dc.DeviceToLogicalYRel(y),
      ]).toEqual(want);
  });
});
