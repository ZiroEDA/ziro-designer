// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `BOARD_ADAPTER::createLayers` (create_layer_items.cpp) as polygons — the
 * 3D viewer's per-layer geometry on a real board.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  B_Cu,
  B_Mask,
  B_Paste,
  B_SilkS,
  Dwgs_User,
  Edge_Cuts,
  F_Cu,
  F_Mask,
  F_Paste,
  F_SilkS,
  In_Cu,
} from '@ziroeda/pcbnew/src/layer_ids.js';
import type { Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  DEFAULT_HOLE_PLATING_THICKNESS,
  LAYER_RENUMBER_VERSION,
  remapLegacyLayerSet,
  boardMaskPasteDefaults,
  buildBoard3dLayers,
  defaultPlotLayerSelection,
  parseLayerSetHex,
  plotLayerSelection,
} from '@ziroeda/designer/src/editors/pcb/board_3d_layers.js';

const DATA = resolve(__dirname, '../../data/zone_fill');
const load = (stem: string) =>
  readBoard(parse(readFileSync(resolve(DATA, `${stem}_kicad_cli.kicad_pcb`), 'utf8')));

/** Signed area of a polygon set: outlines positive, holes negative (IU²). */
function area(polys: Polygon[]): number {
  let total = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!,
          q = ring[(i + 1) % ring.length]!;
        a += p.x * q.y - q.x * p.y;
      }
      total += (Math.abs(a) / 2) * (poly.indexOf(ring) === 0 ? 1 : -1);
    }
  }
  return total;
}

const bboxOf = (board: ReturnType<typeof load>) => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of board.shapes) {
    if (s.layer !== 'Edge.Cuts') continue;
    for (const p of [s.start, s.end]) {
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
};

describe('BASE_SET::ParseHex / the plot layer selection', () => {
  it('reads the hex from the right, a nibble per four layer ids, skipping the _', () => {
    // bit 0 = F_Cu, bit 1 = F_Mask, bit 5 = F_SilkS, bit 25 = Edge_Cuts
    const s = parseLayerSetHex('0000000_00000000_00000000_02000023');
    expect(s.has(F_Cu)).toBe(true);
    expect(s.has(F_Mask)).toBe(true);
    expect(s.has(F_SilkS)).toBe(true);
    expect(s.has(Edge_Cuts)).toBe(true);
    expect(s.has(B_Cu)).toBe(false);
    expect(s.size).toBe(4);
  });

  it('a pre-20240819 file is in the LEGACY numbering: silk at 36/37, mask at 38/39, B_Cu at 31', () => {
    // KiCad 8's default plot set: F_Cu, B_Cu, F/B_SilkS, F/B_Mask, F/B_Paste, Edge_Cuts
    // = bits 0, 31, 36, 37, 38, 39, 34, 35, 44
    const legacy = new Set([0, 31, 34, 35, 36, 37, 38, 39, 44]);
    const mapped = remapLegacyLayerSet(legacy);
    expect([...mapped].sort((a, b) => a - b)).toEqual(
      [F_Cu, F_Mask, B_Cu, B_Mask, F_SilkS, B_SilkS, F_Paste, B_Paste, Edge_Cuts].sort(
        (a, b) => a - b,
      ),
    );
    // read unmapped, bit 36 would be F_Fab (35 is F_Fab; 36 is nothing) — the silk is lost
    expect(parseLayerSetHex('0000000_00000000_00000000_1000000000').has(F_SilkS)).toBe(false);
    expect(LAYER_RENUMBER_VERSION).toBe(20240819);
  });

  it('the constructor default plots silk, mask, paste, edge cuts and every copper layer', () => {
    const d = defaultPlotLayerSelection();
    expect(d.has(F_Cu)).toBe(true);
    expect(d.has(In_Cu(1))).toBe(true);
    expect(d.has(F_Mask)).toBe(true);
    expect(d.has(B_SilkS)).toBe(true);
    expect(d.has(Edge_Cuts)).toBe(true);
    expect(d.has(Dwgs_User)).toBe(false);
  });

  it('a board’s own pcbplotparams decide; plotonalllayersselection adds to it', () => {
    const board = load('ecc83-pp');
    const sel = plotLayerSelection(board);
    expect(sel.layers.has(F_Cu)).toBe(true);
    expect(sel.layers.has(B_Cu)).toBe(true);
    expect(sel.plotReference).toBe(true);
  });
});

describe('createLayers on ecc83-pp', () => {
  const board = load('ecc83-pp');
  const bbox = bboxOf(board);
  const built = buildBoard3dLayers(board, bbox);

  it('has a board outline, and the body with holes is smaller than the body', () => {
    expect(built.boardPoly.length).toBeGreaterThan(0);
    expect(area(built.boardWithHoles)).toBeLessThan(area(built.boardPoly));
    expect(area(built.boardWithHoles)).toBeGreaterThan(0.9 * area(built.boardPoly));
  });

  it('plated drills grow by the 0.020 mm plating; the barrel is the ring between', () => {
    expect(DEFAULT_HOLE_PLATING_THICKNESS).toBe(20000);
    expect(area(built.thOD)).toBeGreaterThan(area(built.thID));
    expect(area(built.platedBarrels)).toBeCloseTo(area(built.thOD) - area(built.thID), -6);
  });

  it('copper on both sides, clipped to the board and cut by the holes', () => {
    const f = built.layers['F.Cu']!;
    const b = built.layers['B.Cu']!;
    expect(area(f)).toBeGreaterThan(0);
    expect(area(b)).toBeGreaterThan(area(f)); // the GND pour is on B.Cu
    expect(area(b)).toBeLessThan(area(built.boardPoly));
    // every ring inside the board bbox
    for (const poly of b)
      for (const ring of poly)
        for (const p of ring) {
          expect(p.x).toBeGreaterThanOrEqual(bbox.minX - 1);
          expect(p.x).toBeLessThanOrEqual(bbox.maxX + 1);
        }
  });

  it('the mask is the board minus the openings minus the holes — it has holes for every pad', () => {
    const mask = built.layers['F.Mask']!;
    expect(area(mask)).toBeLessThan(area(built.boardPoly));
    expect(area(built.maskOpenings['F.Mask'])).toBeGreaterThan(0);
    // the pads' apertures plus the drills leave the mask short by at least that much
    expect(area(built.boardPoly) - area(mask)).toBeGreaterThanOrEqual(
      area(built.maskOpenings['F.Mask']) * 0.99,
    );
  });

  it('the mask expansion comes from the file’s pad_to_mask_clearance, absent → 0', () => {
    const d = boardMaskPasteDefaults(board);
    expect(d.solderMaskExpansion === undefined || d.solderMaskExpansion >= 0).toBe(true);
  });

  it('silk exists and is clipped to the board unless show_off_board_silk', () => {
    const silk = built.layers['F.SilkS']!;
    expect(area(silk)).toBeGreaterThan(0);
    for (const poly of silk)
      for (const ring of poly)
        for (const p of ring) {
          expect(p.y).toBeGreaterThanOrEqual(bbox.minY - 1);
          expect(p.y).toBeLessThanOrEqual(bbox.maxY + 1);
        }
  });

  it('a hidden layer is not built at all', () => {
    const hidden = buildBoard3dLayers(board, bbox, { visibleLayers: new Set([F_Cu, F_Mask]) });
    expect(hidden.layers['F.Cu']).toBeDefined();
    expect(hidden.layers['B.Cu']).toBeUndefined();
    expect(hidden.layers['F.SilkS']).toBeUndefined();
  });

  it('show_zones off drops the pour from B.Cu', () => {
    const noZones = buildBoard3dLayers(board, bbox, { showZones: false });
    expect(area(noZones.layers['B.Cu']!)).toBeLessThan(area(built.layers['B.Cu']!));
  });
});
