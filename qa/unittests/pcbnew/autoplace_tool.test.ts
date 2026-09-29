// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * AUTOPLACE_TOOL (`autorouter/autoplace_tool.cpp`): which footprints each
 * Autoplace action hands to the placer, and the infobar error.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { AUTOPLACE_TOOL } from '@ziroeda/pcbnew/autorouter/autoplace_tool.js';
import type { Board, PcbFootprint, PcbPad, PcbShape } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);
const NO_CLEARANCE = { padClearance: (): number => 0 };

const line = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: 0,
  fillMode: 'none',
  layer: 'Edge.Cuts',
});

const outline = (x0: number, y0: number, x1: number, y1: number): PcbShape[] => [
  line(x0, y0, x1, y0),
  line(x1, y0, x1, y1),
  line(x1, y1, x0, y1),
  line(x0, y1, x0, y0),
];

const pad = (x: number, y: number, n: string): PcbPad => ({
  number: n,
  type: 'smd',
  shape: 'rect',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net: 0,
});

const fp = (ref: string, x: number, y: number, over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:F',
  reference: ref,
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  layer: 'F.Cu',
  pads: [pad(x, y, '1'), pad(x + 2, y, '2')],
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  ...over,
});

const board = (footprints: PcbFootprint[], shapes: PcbShape[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints,
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes,
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
});

const at = (b: Board, ref: string): { x: number; y: number } =>
  b.footprints.find((f) => f.reference === ref)!.at;

describe('AUTOPLACE_TOOL', () => {
  it('refuses a board with no Edge.Cuts, with the exact infobar text', () => {
    const b = board([fp('U1', 5, 5)], []);
    const r = new AUTOPLACE_TOOL(false, NO_CLEARANCE).autoplace(b, [0]);
    expect(r.error).toBe('Board edges must be defined on the Edge.Cuts layer.');
    expect(r.pushed).toBe(false);
    expect(r.board).toBe(b);
  });

  it('autoplaceSelected places only the selected footprints', () => {
    const b = board([fp('U1', 5, 5), fp('U2', 20, 5)], outline(0, 0, 40, 20));
    const r = new AUTOPLACE_TOOL(false, NO_CLEARANCE).autoplaceSelected(b, ['footprint:0']);
    expect(r.pushed).toBe(true);
    // The unselected part is fixed: it is burned into the matrix, not moved.
    expect(at(r.board, 'U2')).toEqual(at(b, 'U2'));
  });

  it('a locked footprint is skipped unless locks are overridden', () => {
    const b = board([fp('U1', 5, 5, { locked: true }), fp('U2', 20, 5)], outline(0, 0, 40, 20));
    const sel = ['footprint:0', 'footprint:1'];
    const kept = new AUTOPLACE_TOOL(false, NO_CLEARANCE).autoplaceSelected(b, sel);
    expect(at(kept.board, 'U1')).toEqual(at(b, 'U1'));
    const forced = new AUTOPLACE_TOOL(true, NO_CLEARANCE).autoplaceSelected(b, sel);
    expect(at(forced.board, 'U1')).not.toEqual(at(b, 'U1'));
  });

  it('autoplaceOffboard takes exactly the footprints outside the outline', () => {
    const b = board([fp('IN', 10, 10), fp('OUT', 60, 10)], outline(0, 0, 40, 20));
    const r = new AUTOPLACE_TOOL(false, NO_CLEARANCE).autoplaceOffboard(b);
    expect(r.pushed).toBe(true);
    expect(at(r.board, 'IN')).toEqual(at(b, 'IN'));
    expect(at(r.board, 'OUT')).not.toEqual(at(b, 'OUT'));
  });

  it('a zero-width outline is not a board either', () => {
    const b = board([fp('U1', 5, 5)], [line(0, 0, 0, 20)]);
    const r = new AUTOPLACE_TOOL(false, NO_CLEARANCE).autoplace(b, [0]);
    expect(r.error).toBe('Board edges must be defined on the Edge.Cuts layer.');
  });

  it('autoplaceSelected ignores selected items that are not footprints', () => {
    const b = board([fp('U1', 5, 5), fp('U2', 20, 5)], outline(0, 0, 40, 20));
    // 'track:0' names index 0, which must not be read as footprint 0.
    const r = new AUTOPLACE_TOOL(false, NO_CLEARANCE).autoplaceSelected(b, [
      'track:0',
      'footprint:1',
    ]);
    expect(at(r.board, 'U1')).toEqual(at(b, 'U1'));
    expect(at(r.board, 'U2')).not.toEqual(at(b, 'U2'));
  });
});
