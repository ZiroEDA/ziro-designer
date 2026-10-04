// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `BOARD_ADAPTER::createLayers` (create_layer_items.cpp) as polygons — the
 * 3D viewer's per-layer geometry on a real board.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { PAD_ATTRIB } from '@ziroeda/pcbnew/padstack.js';
import { type PCB_VIA, VIATYPE } from '@ziroeda/pcbnew/pcb_track.js';
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
} from '@ziroeda/common/layer_ids.js';
import type { Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import {
  DEFAULT_HOLE_PLATING_THICKNESS,
  LAYER_RENUMBER_VERSION,
  remapLegacyLayerSet,
  buildBoard3dLayers,
  defaultPlotLayerSelection,
  parseLayerSetHex,
  plotLayerSelection,
} from '@ziroeda/3d-viewer/board_3d_layers.js';

const DATA = resolve(__dirname, '../../data/zone_fill');
const load = (stem: string) =>
  ParseBoard(readFileSync(resolve(DATA, `${stem}_kicad_cli.kicad_pcb`), 'utf8'));

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

/** `ComputeBoundingBox( aBoardEdgesOnly = true )`: the Edge.Cuts extent. */
const bboxOf = (board: ReturnType<typeof load>) => {
  const box = board.ComputeBoundingBox(true);
  return { minX: box.GetLeft(), minY: box.GetTop(), maxX: box.GetRight(), maxY: box.GetBottom() };
};

const viasOf = (board: ReturnType<typeof load>): PCB_VIA[] =>
  board.Tracks().filter((t) => t.Type() === KICAD_T.PCB_VIA_T) as PCB_VIA[];

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

describe('blind vias and plated-copper differentiation', () => {
  const board = load('blindvias');
  const bbox = bboxOf(board);
  const built = buildBoard3dLayers(board, bbox);

  it('a blind/micro via is a barrel between its own two layers, never a through hole', () => {
    const blind = viasOf(board).filter((v) => v.GetViaType() !== VIATYPE.THROUGH);
    expect(blind.length).toBeGreaterThan(0);
    expect(built.viaBarrels).toHaveLength(blind.length);
    for (const b of built.viaBarrels) expect(b.topLayer).not.toBe(b.bottomLayer);
    // the through-hole set holds only the through vias and the pads
    const through = viasOf(board).filter((v) => v.GetViaType() === VIATYPE.THROUGH).length;
    const thtPads = board
      .Footprints()
      .flatMap((f) => f.Pads())
      .filter((p) => p.GetDrillSize().x > 0 && p.GetAttribute() !== PAD_ATTRIB.NPTH).length;
    expect(built.thID.length).toBe(through + thtPads);
  });

  it('a board with no mask layers enabled builds none — and so has no plated copper either', () => {
    expect(built.layers['F.Mask']).toBeUndefined();
    const diff = buildBoard3dLayers(board, bbox, { differentiatePlatedCopper: true });
    expect(area(diff.platedCopper['F.Cu'])).toBe(0);
  });

  it('differentiate plated copper: the exposed copper leaves the layer and returns as plated', () => {
    const ecc = load('ecc83-pp');
    const eccBox = bboxOf(ecc);
    const plain = buildBoard3dLayers(ecc, eccBox);
    const diff = buildBoard3dLayers(ecc, eccBox, { differentiatePlatedCopper: true });
    const plated = area(diff.platedCopper['F.Cu']);
    expect(plated).toBeGreaterThan(0);
    expect(area(diff.layers['F.Cu']!) + plated).toBeCloseTo(area(plain.layers['F.Cu']!), -6);
    expect(area(plain.platedCopper['F.Cu'])).toBe(0);
  });
});

describe('addPads takes each pad’s margin from the live PAD', () => {
  // PAD::GetSolderMaskExpansion / GetSolderPasteMargin: pad -> footprint ->
  // BOARD_DESIGN_SETTINGS, the same answer the plotter flashes.
  const TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user)
    (13 "F.Paste" user) (15 "B.Paste" user) (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  (gr_rect (start 0 0) (end 20 20) (stroke (width 0.1) (type default)) (fill no) (layer "Edge.Cuts")
    (uuid "00000000-0000-4000-8000-0000000000e1"))
  (footprint "R" (layer "F.Cu") (at 10 10) (uuid "00000000-0000-4000-8000-0000000000f1")
    (pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu" "F.Mask" "F.Paste")
      (uuid "00000000-0000-4000-8000-0000000000a1")))
)`;
  const MM2 = 1e12; // IU² per mm²

  const build = (mask: number, paste: number, ratio: number) => {
    const board = ParseBoard(TEXT);
    const bds = board.GetDesignSettings();
    bds.m_SolderMaskExpansion = mask;
    bds.m_SolderPasteMargin = paste;
    bds.m_SolderPasteMarginRatio = ratio;
    return buildBoard3dLayers(board, { minX: 0, minY: 0, maxX: 20e6, maxY: 20e6 });
  };

  it('grows the F.Mask opening by the board expansion, rounding its corners', () => {
    const b = build(100_000, 0, 0);
    // 2 x 1 mm grown 0.1 mm a side: 2.2 x 1.2 less the four corners' squares
    // plus their quarter circles, 2.64 - 0.04 + pi 0.01 = 2.6314 mm².
    expect(area(b.maskOpenings['F.Mask']) / MM2).toBeCloseTo(2.6314, 2);
    expect(area(b.layers['F.Cu']!) / MM2).toBeCloseTo(2, 6);
  });

  it('shrinks the F.Paste aperture by the board clearance', () => {
    // 2 x 1 mm less 0.05 mm a side: 1.9 x 0.9.
    const b = build(0, -50_000, 0);
    expect(area(b.layers['F.Paste']!) / MM2).toBeCloseTo(1.71, 6);
  });
});

describe('the 3D board body is the outline pcbnew builds', () => {
  // A 20 x 20 mm board with 3 mm rounded corners (gr_rect radius).
  const TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  (gr_rect (start 0 0) (end 20 20) (radius 3) (stroke (width 0.1) (type default)) (fill no) (layer "Edge.Cuts")
    (uuid "00000000-0000-4000-8000-0000000000e2"))
)`;

  it('keeps a rounded rectangle rounded (GetBoardPolygonOutlines, not a square)', () => {
    const board = ParseBoard(TEXT);
    expect((board.Drawings()[0] as PCB_SHAPE | undefined)?.GetCornerRadius()).toBe(3e6);
    const built = buildBoard3dLayers(board, { minX: 0, minY: 0, maxX: 20e6, maxY: 20e6 });
    const outline = built.boardPoly[0]?.[0] ?? [];
    // A square has 4 corners; a rounded one is tessellated arcs.
    expect(outline.length).toBeGreaterThan(8);
    // Nothing reaches the square's corner: the arc stays (√2 − 1)·3 mm inside it.
    const nearest = Math.min(...outline.map((p) => Math.hypot(p.x, p.y)));
    expect(nearest).toBeGreaterThan(1.2e6);
    expect(nearest).toBeLessThan(1.3e6);
  });
});

describe('holes: plated, non-plated, through and blind', () => {
  const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal)
    (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  (gr_rect (start 0 0) (end 20 20) (stroke (width 0.1) (type default)) (fill no) (layer "Edge.Cuts")
    (uuid "${U(1)}"))
  (footprint "H" (layer "F.Cu") (at 0 0) (uuid "${U(2)}")
    (pad "" np_thru_hole circle (at 5 5) (size 2 2) (drill 2) (layers "*.Cu" "*.Mask") (uuid "${U(3)}"))
    (pad "1" thru_hole circle (at 15 5) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (uuid "${U(4)}")))
  (via (at 10 15) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (uuid "${U(5)}"))
  (via blind (at 5 15) (size 0.8) (drill 0.4) (layers "F.Cu" "In1.Cu") (uuid "${U(6)}"))
)`;
  const built = buildBoard3dLayers(ParseBoard(TEXT), { minX: 0, minY: 0, maxX: 20e6, maxY: 20e6 });
  const MM2 = 1e12;

  it('the NPTH drill is its own set, not plated', () => {
    // pad->TransformHoleToPolygon( npth, 0 ): a 2 mm hole, π mm² less the
    // ERROR_INSIDE chords.
    expect(area(built.npthOD) / MM2).toBeCloseTo(Math.PI, 1);
    expect(area(built.npthOD) / MM2).toBeLessThanOrEqual(Math.PI);
  });

  it('the plated set holds the PTH pad and the through via, not the blind one', () => {
    expect(built.thID).toHaveLength(2);
    expect(built.viaBarrels).toHaveLength(1);
    expect(built.viaBarrels[0]).toMatchObject({ topLayer: 'F.Cu', bottomLayer: 'In1.Cu' });
  });
});
