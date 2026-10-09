// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a click on a footprint is tested against: FOOTPRINT::GetBoundingBox(
 * false ) and FOOTPRINT::GetBoundingHull (footprint.cpp:1719-2060), which
 * HitTest collides with. A footprint is picked by its BODY, not by the fields
 * that hang off it — the value string of a terminal block can stand 3 mm away.
 *
 * Every expectation is KiCad 10.0.6's own answer for this footprint (pcbnew
 * python, ~/kicad-oracle/hit/fp.py).
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const mm = (n: number): number => pcbIUScale.mmToIU(n);

/**
 * The screenshot's J1: a 5 x 10 mm courtyard with two pads, and a long value
 * string standing 3 mm to the right of it, running down its side.
 */
const j1 = (extra = ''): FOOTPRINT =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (31 "F.CrtYd" user) (35 "F.Fab" user) (17 "Dwgs.User" user))
  (net 0 "")
  (footprint "TerminalBlock:2P" (layer "F.Cu") (at 10 10) (uuid "aaaaaaaa-0000-4000-8000-000000000001")
    (property "Reference" "J1" (at 0 -7 0) (layer "F.Fab") (uuid "aaaaaaaa-0000-4000-8000-000000000002")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "Screw_Terminal_01x02" (at 5.5 0 90) (layer "F.Fab") (uuid "aaaaaaaa-0000-4000-8000-000000000003")
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start -2.5 -5) (end 2.5 5) (stroke (width 0.05) (type solid)) (fill no) (layer "F.CrtYd")
      (uuid "aaaaaaaa-0000-4000-8000-000000000004"))
    (pad "1" smd rect (at 0 -2.5) (size 2 2) (layers "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000005"))
    (pad "2" smd rect (at 0 2.5) (size 2 2) (layers "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000006"))
    ${extra}))`).Footprints()[0]!;

const SLOP = mm(0.1);

describe('GetBoundingBox( false ) and GetBoundingHull', () => {
  it('the text-free box is the courtyard plus its half stroke, not the fields', () => {
    const b = j1().GetBoundingBox(false);
    expect([b.GetX(), b.GetY(), b.GetRight(), b.GetBottom()]).toEqual([
      7_475_000, 4_975_000, 12_525_000, 15_025_000,
    ]);
  });

  it('the box with text reaches the value string', () => {
    const b = j1().GetBoundingBox(true);
    expect([b.GetX(), b.GetY(), b.GetRight(), b.GetBottom()]).toEqual([
      7_475_000, 1_446_427, 16_348_250, 18_553_572,
    ]);
  });

  it('the hull is one outline of eight points round the courtyard', () => {
    const hull = j1().GetBoundingHull();
    const b = hull.BBox();
    expect(hull.OutlineCount()).toBe(1);
    expect(hull.COutline(0).PointCount()).toBe(8);
    expect([b.GetX(), b.GetY(), b.GetRight(), b.GetBottom()]).toEqual([
      7_475_000, 4_975_000, 12_525_000, 15_025_000,
    ]);
  });

  it('annotation graphics on the user layers are outside the text-free box', () => {
    const annotated = j1(
      '(fp_rect (start -10 -10) (end 20 20) (stroke (width 0.1) (type solid)) (fill no) (layer "Dwgs.User") (uuid "aaaaaaaa-0000-4000-8000-000000000007"))',
    );
    expect(annotated.GetBoundingBox(false).GetRight()).toBe(12_525_000);
    expect(annotated.GetBoundingBox(true).GetRight()).toBe(30_050_000);
  });
});

describe('FOOTPRINT::HitTest collides the hull with the accuracy', () => {
  const hit = (x: number, y: number): boolean => j1().HitTest({ x: mm(x), y: mm(y) }, SLOP);

  it('the body picks the footprint', () => {
    expect(hit(10, 10)).toBe(true);
  });

  it('a hair outside the courtyard still picks; past the slop does not', () => {
    expect(hit(12.6, 10)).toBe(true);
    expect(hit(12.75, 10)).toBe(false);
  });

  it('the value string beside the body is not the footprint', () => {
    expect(hit(15.5, 10)).toBe(false);
    expect(hit(14, 10)).toBe(false);
  });
});
