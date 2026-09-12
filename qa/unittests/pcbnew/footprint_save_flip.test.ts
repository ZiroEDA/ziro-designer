// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR::FootprintSave` (pcb_io_kicad_sexpr.cpp:3450-3462):
 *
 *     // It's orientation should be zero and it should be on the front layer.
 *     footprint->SetOrientation( ANGLE_0 );
 *     if( footprint->GetLayer() != F_Cu )
 *         footprint->Flip( footprint->GetPosition(), cfg->m_FlipDirection );
 *
 * A footprint flipped to the back in the Footprint Editor is written to its
 * library the right way up and on the front, through `FOOTPRINT::Flip`
 * (footprint.cpp:2932) and every child's own `Flip`. Each expectation below
 * is the C++ method's arithmetic, not our output.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { FLIP_DIRECTION, serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';
import {
  boardOpposites,
  flipLayerId,
} from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/kicad_footprint_ops.js';
import { B_Cu, F_Cu, In_Cu, User_1 } from '@ziroeda/pcbnew/src/layer_ids.js';
import type { LayerDescr } from '@ziroeda/pcbnew/src/board_file_model.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

/** A footprint the editor flipped to the back: every child on a B.* layer. */
const BACK = `(footprint "R" (version 20241229) (generator "pcbnew") (layer "B.Cu")
  (property "Reference" "REF**" (at 0 -1 0) (layer "B.SilkS") (uuid "a1000000-0000-4000-8000-000000000001")
    (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))
  (property "Value" "R" (at 0 1 0) (layer "B.Fab") (uuid "a1000000-0000-4000-8000-000000000002")
    (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))
  (fp_line (start -1 -0.5) (end 1 -0.5) (stroke (width 0.12) (type solid)) (layer "B.SilkS")
    (uuid "a1000000-0000-4000-8000-000000000003"))
  (fp_arc (start -1 0.5) (mid 0 1.5) (end 1 0.5) (stroke (width 0.12) (type solid)) (layer "B.Fab")
    (uuid "a1000000-0000-4000-8000-000000000004"))
  (pad "1" smd roundrect (at 1 2 30) (size 1 2) (layers "B.Cu" "B.Paste" "B.Mask")
    (roundrect_rratio 0.25) (uuid "a1000000-0000-4000-8000-000000000005"))
  (pad "2" smd roundrect (at -1 2) (size 1 2) (layers "B.Cu" "B.Paste" "B.Mask") (roundrect_rratio 0)
    (chamfer_ratio 0.2) (chamfer top_left top_right) (uuid "a1000000-0000-4000-8000-000000000006"))
  (pad "3" thru_hole oval (at 0 3 90) (size 1.5 2.5) (drill oval 0.8 1.2 (offset 0.1 0.2))
    (layers "*.Cu" "*.Mask") (uuid "a1000000-0000-4000-8000-000000000007"))
  (point (at 4 5) (size 1) (layer "B.SilkS") (uuid "a1000000-0000-4000-8000-000000000008"))
  (zone (net 0) (net_name "") (layer "B.Cu") (uuid "a1000000-0000-4000-8000-000000000009")
    (hatch edge 0.5) (min_thickness 0.25) (fill yes)
    (polygon (pts (xy 0 0) (xy 2 0) (xy 2 1) (xy 0 1))))
)`;

const read = (text: string): PcbFootprint => readFootprintFile(text)!;
const saved = (dir: FLIP_DIRECTION): PcbFootprint =>
  read(serializeFootprint(read(BACK), { flipDirection: dir }));

/** The `(pad "n" …)` node of the written file. */
function padNode(text: string, number: string): SList {
  const root = parse(text);
  const node = root.items.find(
    (i): i is SList =>
      isList(i) &&
      head(i) === 'pad' &&
      i.items[1]?.kind === 'string' &&
      i.items[1].value === number,
  );
  if (!node) throw new Error(`no pad ${number}`);
  return node;
}
const child = (node: SList, name: string): SList | undefined =>
  node.items.find((i): i is SList => isList(i) && head(i) === name);
const words = (node: SList | undefined): string[] =>
  node ? node.items.slice(1).map((i) => ('value' in i ? i.value : '')) : [];

describe('a front footprint', () => {
  it('is written as it is', () => {
    const text = BACK.replace('(layer "B.Cu")', '(layer "F.Cu")');
    const fp = read(serializeFootprint(read(text)));
    expect(fp.layer).toBe('F.Cu');
    expect(fp.pads[0]!.at).toEqual({ x: MM(1), y: MM(2) });
    expect(fp.pads[0]!.angle).toBe(30);
  });
});

describe('a back footprint saved with FLIP_DIRECTION::TOP_BOTTOM', () => {
  const fp = saved(FLIP_DIRECTION.TOP_BOTTOM);
  const pad = (n: string) => fp.pads.find((p) => p.number === n)!;

  it('lands on the front', () => {
    expect(fp.layer).toBe('F.Cu');
  });

  it('mirrors a pad about the anchor and negates its angle', () => {
    // PAD::Flip (pad.cpp:1476-1487): MIRROR( m_pos, aCentre, TOP_BOTTOM ) is
    // y -> -y about the footprint, and the relative orientation is negated;
    // PADSTACK::SetOrientation normalises to [0, 360).
    expect(pad('1').at).toEqual({ x: MM(1), y: MM(-2) });
    expect(pad('1').angle).toBe(330);
    expect(pad('3').angle).toBe(270);
  });

  it('flips every pad layer, keeping the wildcard spelling of a through pad', () => {
    expect(pad('1').layers).toEqual(['F.Cu', 'F.Mask', 'F.Paste']);
    expect(pad('3').layers).toEqual(['*.Cu', '*.Mask']);
  });

  it('mirrors the chamfered corners top to bottom', () => {
    // mirrorBitFlags( TOP_LEFT, BOTTOM_LEFT ) and ( TOP_RIGHT, BOTTOM_RIGHT ) (pad.cpp:1516-1519).
    const node = padNode(serializeFootprint(read(BACK)), '2');
    expect(words(child(node, 'chamfer')).sort()).toEqual(['bottom_left', 'bottom_right']);
  });

  it('mirrors the drill offset with the pad', () => {
    // MIRROR( m_padStack.Offset( aLayer ), VECTOR2I{ 0, 0 }, TOP_BOTTOM ) (pad.cpp:1483).
    expect(pad('3').drill?.offset).toEqual({ x: MM(0.1), y: MM(-0.2) });
  });

  it('turns a text over: mirrored position, 180 - angle, mirror flag toggled', () => {
    // PCB_TEXT::Flip (pcb_text.cpp:487-494): SetTextY( MIRRORVAL ), SetTextAngle( 180 - angle ),
    // FlipLayer, and `if( IsSideSpecific() ) SetMirrored( !IsMirrored() )` — B.SilkS is.
    const ref = fp.texts.find((t) => t.kind === 'reference')!;
    expect(ref.at).toEqual({ x: 0, y: MM(1) });
    expect(ref.angle).toBe(180);
    expect(ref.layer).toBe('F.SilkS');
    expect(ref.mirror).toBeFalsy();
  });

  it('mirrors a segment and swaps the ends of an arc', () => {
    // EDA_SHAPE::flip (eda_shape.cpp:1013-1018): the three points mirror and
    // the arc's start and end trade places so its winding survives. The
    // parse had already put the file's (-1 0.5)..(1 0.5) into the internal
    // winding, start (1 0.5) (`SetArcGeometry`, :1201-1206), so the mirrored
    // and swapped arc is written start (-1 -0.5), end (1 -0.5).
    const line = fp.shapes.find((s) => s.kind === 'line')!;
    expect(line.start).toEqual({ x: MM(-1), y: MM(0.5) });
    expect(line.layer).toBe('F.SilkS');
    const text = serializeFootprint(read(BACK));
    const arc = parse(text).items.find((i): i is SList => isList(i) && head(i) === 'fp_arc')!;
    expect(words(child(arc, 'start'))).toEqual(['-1', '-0.5']);
    expect(words(child(arc, 'mid'))).toEqual(['0', '-1.5']);
    expect(words(child(arc, 'end'))).toEqual(['1', '-0.5']);
    expect(words(child(arc, 'layer'))).toEqual(['F.Fab']);
  });

  it('mirrors a point and flips its layer, as PCB_POINT::Flip does', () => {
    expect(fp.points[0]!.at).toEqual({ x: MM(4), y: MM(-5) });
    expect(fp.points[0]!.layer).toBe('F.SilkS');
  });

  it("mirrors a zone's outline and moves it to the front", () => {
    // ZONE::Flip (zone.cpp:1131): Mirror, then every layer through FlipLayer.
    const text = serializeFootprint(read(BACK));
    const zone = parse(text).items.find((i): i is SList => isList(i) && head(i) === 'zone')!;
    expect(words(child(zone, 'layer'))).toEqual(['F.Cu']);
    const pts = child(child(zone, 'polygon')!, 'pts')!;
    expect(pts.items.filter(isList).map((p) => words(p).join(' '))).toEqual([
      '0 0',
      '2 0',
      '2 -1',
      '0 -1',
    ]);
  });

  it('writes stable bytes: saving the saved footprint changes nothing', () => {
    const once = serializeFootprint(read(BACK));
    expect(serializeFootprint(read(once))).toBe(once);
  });
});

describe('a back footprint saved with FLIP_DIRECTION::LEFT_RIGHT', () => {
  const fp = saved(FLIP_DIRECTION.LEFT_RIGHT);
  const pad = (n: string) => fp.pads.find((p) => p.number === n)!;

  it('is the top-bottom flip turned through 180 degrees', () => {
    // FOOTPRINT::Flip (:2995-2997): `if( LEFT_RIGHT ) Rotate( aCentre, ANGLE_180 )`.
    // Rotating the footprint leaves its footprint-relative children where
    // they are and adds 180 to the absolute angles the file carries.
    expect(fp.layer).toBe('F.Cu');
    expect(pad('1').at).toEqual({ x: MM(1), y: MM(-2) });
    expect(pad('1').angle).toBe(150);
    expect(pad('2').angle).toBe(180);
  });

  it('keeps a text upright after the turn', () => {
    // PCB_TEXT::KeepUpright (pcb_text.cpp:374): 180 + 180 = 360 normalises to
    // 0, which is upright, so nothing else moves.
    const ref = fp.texts.find((t) => t.kind === 'reference')!;
    expect(ref.angle).toBe(0);
    expect(ref.at).toEqual({ x: 0, y: MM(1) });
  });

  it('turns the absolute items about the anchor', () => {
    // A point is written in board coordinates, so the 180 degree turn shows.
    expect(fp.points[0]!.at).toEqual({ x: MM(-4), y: MM(5) });
  });
});

describe('BOARD::FlipLayer', () => {
  it('pairs the inner layers of a four- and a six-layer board', () => {
    // FlipLayer( aLayerId, aCopperLayersCount ) (layer_id.cpp:197-212).
    expect(flipLayerId(In_Cu(1), 4)).toBe(In_Cu(2));
    expect(flipLayerId(In_Cu(2), 4)).toBe(In_Cu(1));
    expect(flipLayerId(In_Cu(1), 6)).toBe(In_Cu(4));
    expect(flipLayerId(In_Cu(3), 6)).toBe(In_Cu(2));
    // A two-layer board has no inner layers to pair.
    expect(flipLayerId(In_Cu(1), 2)).toBe(In_Cu(1));
    expect(flipLayerId(F_Cu, 2)).toBe(B_Cu);
  });

  it('pairs front/back user layers by their name after the dot', () => {
    // recalcOpposites (board.cpp:867-898): "Match up similary-named front/back user layers".
    const d = (number: number, userName: string, type: LayerDescr['type']): LayerDescr => ({
      number,
      name: `User.${(number - User_1) / 2 + 1}`,
      userName,
      type,
      visible: true,
    });
    const descrs = new Map<number, LayerDescr>([
      [User_1, d(User_1, 'F.Glue', 'front')],
      [User_1 + 4, d(User_1 + 4, 'B.Glue', 'back')],
    ]);
    const opp = boardOpposites(descrs, 2);
    expect(opp.get(User_1)).toBe(User_1 + 4);
    expect(opp.get(User_1 + 4)).toBe(User_1);
  });

  it('pairs consecutive renamed front/back user layers', () => {
    // recalcOpposites (board.cpp:900-918): "Match up non-custom-named consecutive front/back user layer pairs".
    const d = (number: number, userName: string, type: LayerDescr['type']): LayerDescr => ({
      number,
      name: `User.${(number - User_1) / 2 + 1}`,
      userName,
      type,
      visible: true,
    });
    const descrs = new Map<number, LayerDescr>([
      [User_1, d(User_1, 'Top Stuff', 'front')],
      [User_1 + 2, d(User_1 + 2, 'Bottom Stuff', 'back')],
    ]);
    const opp = boardOpposites(descrs, 2);
    expect(opp.get(User_1)).toBe(User_1 + 2);
    // A user layer nobody typed or paired stays its own opposite.
    expect(opp.get(User_1 + 4)).toBe(User_1 + 4);
  });
});
