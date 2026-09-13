// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_BARCODE (`pcbnew/pcb_barcode.cpp`) over the Zint port. Every expected
 * number below was read from KiCad's own `pcbnew` python module on the same
 * inputs (a default 2-copper BOARD, "HELLO", the 40 mm default size, the
 * 1.27 mm default text), not derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { BARCODE_T, PCB_BARCODE } from '@ziroeda/pcbnew/src/pcb_barcode.js';

const box = (
  p:
    | SHAPE_POLY_SET
    | {
        GetBoundingBox(): {
          GetX(): number;
          GetY(): number;
          GetWidth(): number;
          GetHeight(): number;
        };
      },
) => {
  const bb = 'BBox' in p ? p.BBox() : p.GetBoundingBox();
  return [bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()];
};

function hello(): { b: BOARD; bc: PCB_BARCODE } {
  const b = new BOARD();
  const bc = new PCB_BARCODE(b);
  b.Add(bc);
  bc.SetLayer(PCB_LAYER_ID.F_SilkS);
  bc.SetPosition({ x: 10000000, y: 20000000 });
  bc.SetBarcodeText('HELLO');
  return { b, bc };
}

describe('PCB_BARCODE', () => {
  it('a QR code of "HELLO": the symbol scaled to 40 mm, the text 1 mm below, the assembled polygon', () => {
    const { bc } = hello();
    expect(bc.GetWidth()).toBe(40000000);
    expect(bc.GetHeight()).toBe(40000000);
    expect(bc.GetTextSize()).toBe(1270000);
    expect(bc.GetShowText()).toBe(true);
    expect(bc.GetSymbolPoly().OutlineCount()).toBe(80);
    expect(box(bc.GetSymbolPoly())).toEqual([-10000000, 0, 40000000, 40000000]);
    expect(bc.GetTextPoly().OutlineCount()).toBe(5);
    expect(box(bc.GetTextPoly())).toEqual([7259673, 41000000, 5480655, 1428750]);
    expect(bc.GetPolyShape().OutlineCount()).toBe(44);
    expect(box(bc)).toEqual([-10000000, 0, 40000000, 42428750]);
    expect(bc.GetItemDescription(null, true)).toBe("Barcode 'HELLO' on F.Silkscreen");
    expect(bc.HitTest({ x: 10000000, y: 20000000 }, 0)).toBe(true);
    expect(bc.HitTest({ x: 10000000, y: 41000000 }, 0)).toBe(true); // the text's hull
    expect(bc.HitTest({ x: 50000000, y: 20000000 }, 0)).toBe(false);
  });

  it('Code 128 is bars stretched to the box; a knockout inverts the assembly with the 10% margin', () => {
    const { bc } = hello();
    bc.SetBarcodeKind(BARCODE_T.CODE_128);
    expect(bc.GetPolyShape().OutlineCount()).toBe(30);
    expect(box(bc)).toEqual([-10000000, 0, 40000000, 42428750]);

    bc.SetBarcodeKind(BARCODE_T.QR_CODE);
    bc.SetIsKnockout(true);
    expect(bc.GetPolyShape().OutlineCount()).toBe(8);
    expect(bc.GetPolyShape().HoleCount(0)).toBe(0); // fractured
    expect(box(bc)).toEqual([-14000000, -4000000, 48000000, 50428750]);
  });

  it('Rotate and Flip re-assemble; Similarity and equality', () => {
    const { bc } = hello();
    bc.Rotate({ x: 10000000, y: 20000000 }, new EDA_ANGLE(90, EDA_ANGLE_T.DEGREES_T));
    expect(bc.GetAngle().AsDegrees()).toBe(90);
    expect(box(bc)).toEqual([-10000000, 0, 42428750, 40000000]);

    bc.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(bc.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(bc.GetPosition()).toEqual({ x: -10000000, y: 20000000 });
    expect(box(bc)).toEqual([-30000000, 0, 42428750, 40000000]);
    expect(bc.GetItemDescription(null, true)).toBe("Barcode 'HELLO' on B.Silkscreen");

    const d = bc.Duplicate(false) as PCB_BARCODE;
    expect(bc.Similarity(d)).toBeCloseTo(1.0, 12);
    expect(bc.equals(d)).toBe(true);
    d.SetBarcodeWidth(1000000);
    expect(bc.Similarity(d)).toBeCloseTo(4 / 6, 12);
    expect(d.Text().GetParent()).toBe(d);
  });
});
