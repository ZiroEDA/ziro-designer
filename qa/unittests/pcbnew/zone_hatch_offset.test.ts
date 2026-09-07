// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Board Setup > Zone Hatch Offsets page reaching the copper it is supposed
 * to move — `ZONE_FILLER::addHatchFillTypeOnZone`'s offset phase
 * (`pcbnew/zone_filler.cpp:3929-3958`):
 *
 *     auto& defaultOffsets = m_board->GetDesignSettings().m_ZoneLayerProperties;
 *     auto& localOffsets   = aZone->LayerProperties();
 *
 *     VECTOR2I offset = defaultOffsets[aLayer].hatching_offset.value_or( VECTOR2I() );
 *     if( localOffsets.contains( aLayer ) && localOffsets.at( aLayer ).hatching_offset.has_value() )
 *         offset = localOffsets.at( aLayer ).hatching_offset.value();
 *     ...
 *     hole.Move( VECTOR2I( offset.x % gridsize, offset.y % gridsize ) );
 *
 * This file exists because the page was UI and persistence only: the filler
 * carried a comment saying the phase was "not ported ... needs board design
 * settings this layer has no access to", so every offset the page could store
 * changed nothing on the board.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { fillZones, hatchingOffsetFor } from '@ziroeda/pcbnew/src/zone_filler.js';
// NOT the bare `mmToIU`, which is the DRAWING SHEET scale (1e3 IU/mm). A board
// is 1e6, so `mmToIU(1)` here would be a thousandth of what is meant and every offset below would be
// far too small to move a 3 mm hatch grid — which is exactly how this file
// failed first time round.
import { pcbMmToIU } from '@ziroeda/common/src/eda_units.js';

/** A 20 x 20 mm hatched copper zone on F.Cu, with a coarse enough grid to see. */
const BOARD_TEXT = (extra = ''): string => `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  (zone
    (net 0) (net_name "") (layers "F.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (mode hatch) (thermal_gap 0.5) (thermal_bridge_width 0.5)
      (hatch_thickness 1) (hatch_gap 2) (hatch_orientation 0)
      (hatch_smoothing_level 0) (hatch_smoothing_value 0.1)
      (hatch_min_hole_area 0.3))
    ${extra}
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20)))
  )
)`;

const boardOf = (extra = ''): ReturnType<typeof readBoard> => readBoard(parse(BOARD_TEXT(extra)));

/**
 * A short, stable signature of the filled zone's geometry. Deliberately a hash
 * and not the vertices: a hatch fill is thousands of points, and a failing
 * `toBe` on the raw list buries the reason it failed.
 */
function fillSignature(board: ReturnType<typeof readBoard>, offsets = {}): string {
  const filled = fillZones(board, { hatchingOffsets: offsets });
  const fills = filled.zones[0]?.fills ?? [];
  let h = 0;
  let n = 0;
  for (const f of fills)
    for (const poly of f.polys)
      for (const v of poly) {
        h = (Math.imul(h ^ v.x, 0x01000193) ^ v.y) >>> 0;
        n++;
      }
  return `${n}:${h.toString(16)}`;
}

describe('hatchingOffsetFor — the resolution rule', () => {
  it('falls back to (0,0) when neither has a value', () => {
    expect(hatchingOffsetFor('F.Cu', undefined, undefined)).toEqual({ x: 0, y: 0 });
    expect(hatchingOffsetFor('F.Cu', {}, {})).toEqual({ x: 0, y: 0 });
  });

  it('takes the board default when the zone has none', () => {
    expect(hatchingOffsetFor('F.Cu', { 'F.Cu': { x: 5, y: 6 } }, undefined)).toEqual({
      x: 5,
      y: 6,
    });
  });

  it('lets the zone override the board, per layer', () => {
    // The zone wins ONLY on a layer it actually names — this is not a merge of
    // the two maps, it is a per-layer `contains()` test.
    const board = { 'F.Cu': { x: 5, y: 6 }, 'B.Cu': { x: 7, y: 8 } };
    const zone = { 'F.Cu': { x: 1, y: 2 } };
    expect(hatchingOffsetFor('F.Cu', board, zone)).toEqual({ x: 1, y: 2 });
    expect(hatchingOffsetFor('B.Cu', board, zone)).toEqual({ x: 7, y: 8 });
  });
});

describe('a zone’s own (property …) entries', () => {
  it('are read off the zone, not out of (fill …)', () => {
    // They are written as bare children of the zone, right after the fill block
    // (`pcb_io_kicad_sexpr.cpp:3052-3055`).
    const b = boardOf('(property (layer "F.Cu") (hatch_position (xy 1.5 -0.25)))');
    expect(b.zones[0]?.layerProperties).toEqual({
      'F.Cu': { x: pcbMmToIU(1.5), y: pcbMmToIU(-0.25) },
    });
  });

  it('are absent when the zone declares none', () => {
    expect(boardOf().zones[0]?.layerProperties).toBeUndefined();
  });

  it('ignore a property with no hatch_position', () => {
    // `format()` never writes one without an offset, so a bare property is not
    // an override of anything.
    expect(boardOf('(property (layer "F.Cu"))').zones[0]?.layerProperties).toBeUndefined();
  });
});

describe('the offset actually moves the copper', () => {
  it('shifts the hatch grid when the board setting is set', () => {
    const board = boardOf();
    const plain = fillSignature(board);
    const shifted = fillSignature(board, { 'F.Cu': { x: pcbMmToIU(1), y: pcbMmToIU(1) } });

    expect(plain).not.toBe('[]');
    expect(shifted).not.toBe(plain);
  });

  it('leaves other layers alone', () => {
    const board = boardOf();
    const plain = fillSignature(board);
    // The zone is on F.Cu only; a B.Cu offset must not touch it.
    expect(fillSignature(board, { 'B.Cu': { x: pcbMmToIU(1), y: pcbMmToIU(1) } })).toBe(plain);
  });

  it('offsets each layer of a two-layer zone by ITS own value', () => {
    // The single-layer check above passes even if the layer argument is
    // ignored, because a B.Cu-only map yields nothing either way. A zone poured
    // on BOTH layers with an offset on only one is what pins that
    // `hatchingOffsetFor` is asked per layer.
    const twoLayer = readBoard(
      parse(BOARD_TEXT().replace('(layers "F.Cu")', '(layers "F.Cu" "B.Cu")')),
    );
    const perLayer = (offsets: object): string[] => {
      const filled = fillZones(twoLayer, { hatchingOffsets: offsets });
      return (filled.zones[0]?.fills ?? []).map(
        (f) => `${f.layer}:${f.polys.reduce((n, p) => n + p.length, 0)}`,
      );
    };

    const plain = perLayer({});
    expect(plain).toHaveLength(2);

    // 7 mm is 1 mm after the modulo and drops holes off the far edge, so the
    // count moves — on B.Cu only.
    const shifted = perLayer({ 'B.Cu': { x: pcbMmToIU(7), y: pcbMmToIU(7) } });
    const layerOf = (rows: string[], l: string): string => rows.find((r) => r.startsWith(l)) ?? '';
    expect(layerOf(shifted, 'F.Cu')).toBe(layerOf(plain, 'F.Cu'));
    expect(layerOf(shifted, 'B.Cu')).not.toBe(layerOf(plain, 'B.Cu'));
  });

  it('applies the offset modulo the grid pitch', () => {
    // `hole.Move( offset.x % gridsize, … )`. gridsize is hatch_thickness +
    // hatch_gap = 1 + 2 = 3 mm here.
    //
    // Comparing one WHOLE pitch against zero cannot test this: the holes are
    // generated from one pitch below the bounding box, so shifting the set by
    // exactly a pitch just relabels it and the modulo is unobservable. 7 mm and
    // 1 mm are the pair that separates them — both are 1 mm after the modulo,
    // while a raw 7 mm shift slides two pitches' worth of holes off the far
    // edge without replacing them at the near one.
    const board = boardOf();
    const one = fillSignature(board, { 'F.Cu': { x: pcbMmToIU(1), y: pcbMmToIU(1) } });
    const seven = fillSignature(board, { 'F.Cu': { x: pcbMmToIU(7), y: pcbMmToIU(7) } });
    expect(seven).toBe(one);
    // and both really are a shift, not a no-op.
    expect(one).not.toBe(fillSignature(board));
  });

  it('lets the zone’s own override win over the board’s', () => {
    const withZone = boardOf('(property (layer "F.Cu") (hatch_position (xy 1 1)))');
    // Board says 0 (absent), zone says 1 mm → same as the board saying 1 mm.
    expect(fillSignature(withZone)).toBe(
      fillSignature(boardOf(), { 'F.Cu': { x: pcbMmToIU(1), y: pcbMmToIU(1) } }),
    );
    // and a conflicting board value does not change that.
    expect(fillSignature(withZone, { 'F.Cu': { x: pcbMmToIU(2), y: pcbMmToIU(2) } })).toBe(
      fillSignature(withZone),
    );
  });
});
