// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_BARCODE's assembled geometry (pcbnew/pcb_barcode.cpp): the symbol scaled
 * to the item's size, the human-readable line under it, the knockout, the
 * back-side mirror and the hull a click is tested against.
 */
import { describe, expect, it, vi } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { encodeBarcode } from '@ziroeda/zint';
import type { PCB_BARCODE } from '@ziroeda/pcbnew/pcb_barcode.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

// Every read assembles the symbol, and a knockout QR takes a while.
vi.setConfig({ testTimeout: 30_000 });

const MM = (n: number): number => pcbIUScale.mmToIU(n);

interface Opts {
  at?: string;
  layer?: string;
  size?: string;
  text?: string;
  kind?: string;
  hide?: 'yes' | 'no';
  knockout?: 'yes' | 'no';
  margins?: string;
}

/** An 8 mm QR "ZIRO" at (10, 20) on Dwgs.User, its text hidden, as a file carries it. */
const barcode = (o: Opts = {}): PCB_BARCODE => {
  const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (17 "Dwgs.User" user)
          (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen"))
  (net 0 "")
  (barcode (at ${o.at ?? '10 20 0'}) (layer "${o.layer ?? 'Dwgs.User'}") (size ${o.size ?? '8 8'})
    (text "${o.text ?? 'ZIRO'}") (text_height 1.27) (type ${o.kind ?? 'qr'}) (ecc_level L)
    (hide ${o.hide ?? 'yes'}) (knockout ${o.knockout ?? 'no'}) ${o.margins ? `(margins ${o.margins})` : ''}
    (uuid "aaaaaaaa-0000-4000-8000-000000000001"))
)`);
  return board.Drawings().find((d) => d.Type() === KICAD_T.PCB_BARCODE_T) as PCB_BARCODE;
};

const box = (b: PCB_BARCODE): { w: number; h: number; cx: number; cy: number } => {
  const bb = b.GetPolyShape().BBox();
  return { w: bb.GetWidth(), h: bb.GetHeight(), cx: bb.Centre().x, cy: bb.Centre().y };
};

describe('the encoder’s units never reach the board', () => {
  it('fills exactly the size the item asks for', () => {
    // `SetRect` scales the symbol polygon so its bounding box IS the item's
    // width and height (`pcb_barcode.cpp:592-625`).
    expect(box(barcode())).toMatchObject({ w: MM(8), h: MM(8), cx: MM(10), cy: MM(20) });
    expect(box(barcode({ size: '25 3' }))).toMatchObject({ w: MM(25), h: MM(3) });
  });

  it('stretches a linear barcode over the whole height', () => {
    // Code 39 is one row of full-height bars: `row_height` is left at zero and
    // the output stage shares `symbol->height` among the rows (`output.c:842-843`).
    const b = barcode({ kind: 'code39', size: '20 5' });
    expect(b.GetPolyShape().OutlineCount()).toBeGreaterThan(0);
    expect(box(b)).toMatchObject({ w: MM(20), h: MM(5) });
  });

  it('draws one rectangle per horizontal run, not one per module', () => {
    // Zint's vector stage merges adjacent set modules (`vector.c:622-624`).
    const { symbol } = encodeBarcode('code39', 'L', 'ZIRO');
    let darkModules = 0;
    for (let i = 0; i < symbol!.width; i++) if (symbol!.encoded[0]?.[i]) darkModules++;
    const rects = barcode({ kind: 'code39' }).GetSymbolPoly().OutlineCount();

    expect(rects).toBeGreaterThan(0);
    expect(rects).toBeLessThan(darkModules);
  });
});

describe('the human-readable line', () => {
  it('adds height below the symbol when shown, and none above it', () => {
    // `ComputeTextPoly` puts it under the symbol (`pcb_barcode.cpp:398-401`),
    // and `AssembleBarcode` unions it into `m_poly`.
    const hidden = barcode({ hide: 'yes' });
    const shown = barcode({ hide: 'no' });

    expect(box(hidden).h).toBe(MM(8));
    expect(box(shown).h).toBeGreaterThan(box(hidden).h);
    expect(shown.GetPolyShape().BBox().GetTop()).toBe(hidden.GetPolyShape().BBox().GetTop());
  });

  it('sits exactly 1 mm below the symbol', () => {
    // `textPos.y = symbolBBox.GetBottom() - textBBox.GetTop() + textOffset`,
    // `textOffset = pcbIUScale.mmToIU( 1 )` (`pcb_barcode.cpp:398-401`).
    const shown = barcode({ hide: 'no' });
    const symbolBottom = barcode({ hide: 'yes' }).GetPolyShape().BBox().GetBottom();

    expect(shown.GetTextPoly().BBox().GetTop() - symbolBottom).toBe(MM(1));
  });

  it('is centred on the symbol', () => {
    const shown = barcode({ hide: 'no', text: 'W' }).GetPolyShape().BBox().Centre().x;
    const sym = barcode({ hide: 'yes', text: 'W' }).GetPolyShape().BBox().Centre().x;

    expect(Math.abs(shown - sym)).toBeLessThan(MM(0.01));
  });

  it('contributes nothing when the barcode has no text at all', () => {
    // Empty text encodes nothing (`ComputeBarcode` returns early).
    expect(barcode({ text: '', hide: 'no' }).GetPolyShape().OutlineCount()).toBe(0);
  });
});

describe('knockout', () => {
  it('inflates the box by at least 10% of the smaller side', () => {
    // "Enforce minimum margin: at least 10% of the smallest side of the
    // barcode, rounded up to the nearest 0.1 mm" (`pcb_barcode.cpp:409-414`):
    // 0.8 mm each side of an 8 mm symbol.
    expect(box(barcode({ knockout: 'yes' })).w).toBe(box(barcode()).w + MM(1.6));
    expect(box(barcode({ knockout: 'yes' })).h).toBe(box(barcode()).h + MM(1.6));
  });

  it('treats `(margins …)` as a floor on that, not as the value', () => {
    // `std::max( m_margin.x, tenPercentRounded )`.
    const knocked = box(barcode({ knockout: 'yes' })).w;
    expect(box(barcode({ knockout: 'yes', margins: '0.5 0.5' })).w).toBe(knocked);
    expect(box(barcode({ knockout: 'yes', margins: '3 0' })).w).toBe(box(barcode()).w + MM(6));
  });

  it('inverts the symbol: the modules become holes in a filled rectangle', () => {
    const knocked = barcode({ knockout: 'yes' }).GetPolyShape().BBox();
    const plain = barcode().GetPolyShape().BBox();

    expect(knocked.GetLeft()).toBeLessThan(plain.GetLeft());
    expect(knocked.GetBottom()).toBeGreaterThan(plain.GetBottom());
  });

  it('is off unless asked for, so `(margins …)` alone changes nothing', () => {
    expect(box(barcode({ margins: '5 5' }))).toEqual(box(barcode()));
  });
});

describe('orientation and side', () => {
  it('rotating turns the polygon about the item’s own position', () => {
    const upright = box(barcode({ size: '20 4' }));
    const turned = box(barcode({ size: '20 4', at: '10 20 90' }));

    // A 20 x 4 box turned 90 degrees is 4 x 20, still centred on (10, 20).
    expect(turned.w).toBe(upright.h);
    expect(turned.h).toBe(upright.w);
    expect(turned.cx).toBe(MM(10));
  });

  it('mirrors on a back layer, so it reads from that side', () => {
    // `if( IsSideSpecific() && GetBoard()->IsBackLayer( m_layer ) )
    //      m_poly.Mirror( m_pos, LEFT_RIGHT )` (`pcb_barcode.cpp:371-372`).
    const front = barcode({ layer: 'F.SilkS' }).GetPolyShape();
    const back = barcode({ layer: 'B.SilkS' }).GetPolyShape();

    expect(back.BBox()).toEqual(front.BBox());
    expect(back.COutline(0).CPoints()).not.toEqual(front.COutline(0).CPoints());
  });
});

describe('the hull a click is tested against (pcb_barcode.cpp:562-573)', () => {
  it('is picked up anywhere in it, light modules included', () => {
    // `HitTest` collides against `GetBoundingHull` - a rectangle round the
    // symbol and one round the text - not against the modules.
    const b = barcode();
    expect(b.HitTest({ x: MM(10), y: MM(20) }, MM(0.01))).toBe(true); // the light middle
    expect(b.HitTest({ x: MM(6.2), y: MM(16.2) }, MM(0.01))).toBe(true); // inside a corner
    expect(b.HitTest({ x: MM(2), y: MM(20) }, MM(0.01))).toBe(false); // well outside
  });

  it('follows the rotation, and keeps the empty text box KiCad keeps', () => {
    // Both rectangles are built whatever their source: the hidden text's empty
    // `m_textPoly` has the default BOX2I at the origin, and its corners are
    // turned about `m_pos` like the symbol's (pcb_barcode.cpp:694-727). KiCad
    // 10.0.6 answers this exact barcode 2 outlines, a box at (-10, 10) 22 x 20
    // mm (pcbnew python, ~/kicad-oracle/hit/bc.py), and still misses a click
    // on that stray corner: HitTest collides, it does not take the box.
    const b = barcode({ size: '20 4', at: '10 20 90' });
    const hull = new SHAPE_POLY_SET();
    b.GetBoundingHull(hull, PCB_LAYER_ID.Dwgs_User, 0, 0, ERROR_LOC.ERROR_INSIDE);
    const bb = hull.BBox();
    expect(hull.OutlineCount()).toBe(2);
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      MM(-10),
      MM(10),
      MM(22),
      MM(20),
    ]);
    expect(b.HitTest({ x: MM(10), y: MM(20) }, MM(0.01))).toBe(true);
    expect(b.HitTest({ x: MM(30), y: MM(10) }, MM(0.01))).toBe(false);
  });
});
