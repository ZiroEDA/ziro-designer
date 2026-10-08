// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_POINT` — the item `PCB_ACTIONS::placePoint` places.
 *
 * "A 0-dimensional point that is used to mark a position on a PCB, or more
 * usually a footprint … as a defined snap anchor for component alignment [or]
 * as a routing snap point in a custom pad" (`pcbnew/pcb_point.h:31-35`).
 *
 * The button existed here before the item did: `placePoint` sat greyed on both
 * the board editor's and the footprint editor's right toolbars, the Objects
 * tab already had a Points row and the Selection Filter already had a Points
 * box, and `board.points` did not exist — so a `.kicad_pcb` carrying `(point
 * …)` opened with nothing to show for it: not drawn, not selectable, and not
 * offering the snap anchor the item exists for.
 *
 * It was NOT lost from the file, and the first version of this comment said it
 * was. `writeBoardNode` walks the source children and passes through every head
 * it does not own (`else out.push(it)`), so an unmodelled node round-trips
 * byte-identically — which `an unmodelled item survives a save` below now pins,
 * because that property is what makes a half-finished port safe and it was
 * being relied on without ever being checked.
 *
 * The snap behaviour is the part worth pinning hardest: a point that draws but
 * does not offer an anchor is decoration, and that is the one thing the item
 * is *for*.
 */
import { describe, expect, it } from 'vitest';
import { head, parse, serialize, type SList } from '@ziroeda/sexpr/index.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/generator.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DEFAULT_POINT_SIZE, PCB_POINT } from '@ziroeda/pcbnew/pcb_point.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { livePanel } from './support/live_panel.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

const BOARD_SRC = `(kicad_pcb (version 20241229) (generator "${GENERATOR}") (generator_version "${GENERATOR_VERSION}")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (point (at 10 20) (size 1.5) (layer "F.SilkS")
    (uuid "aaaaaaaa-0000-0000-0000-000000000001"))
)`;

const read = (src = BOARD_SRC): BOARD => ParseBoard(src);
const point = (b: BOARD = read()): PCB_POINT => b.Points()[0]!;
const pointNodes = (text: string): SList[] =>
  parse(text).items.filter((i): i is SList => i.kind === 'list' && head(i) === 'point');

describe('reading (point …) (parsePCB_POINT)', () => {
  it('lands in BOARD::Points() with position, size, layer and uuid', () => {
    // `parsePCB_POINT` (`pcb_io_kicad_sexpr_parser.cpp:8582-8628`) — four
    // tokens and it `Expecting( "at, size, layer or uuid" )` for anything else.
    const p = point();

    expect(p.GetPosition()).toEqual({ x: MM(10), y: MM(20) });
    expect(p.GetSize()).toBe(MM(1.5));
    expect(p.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(p.m_Uuid).toBe('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('falls back to the constructor’s 1 mm when (size …) is absent', () => {
    // `DEFAULT_PT_SIZE_MM = 1.0` (`pcb_point.cpp:42`).
    const b = read(`(kicad_pcb (version 20241229) (net 0 "")
      (point (at 1 2) (layer "F.Cu")))`);

    expect(point(b).GetSize()).toBe(DEFAULT_POINT_SIZE);
    expect(DEFAULT_POINT_SIZE).toBe(MM(1));
  });

  it('is not a graphic: it does not land in BOARD::Drawings()', () => {
    const b = read();

    expect(b.Drawings()).toHaveLength(0);
    expect(b.Points()).toHaveLength(1);
  });
});

describe('a save is stable from the first one on', () => {
  it('round-trips a board with a point and a barcode, save after save', () => {
    const src = `(kicad_pcb (version 20241229) (generator "${GENERATOR}") (generator_version "${GENERATOR_VERSION}")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (point (at 10 20) (size 1.5) (layer "F.SilkS") (uuid "aaaaaaaa-0000-0000-0000-000000000001"))
  (barcode (at 10 20 0) (layer "F.SilkS") (size 5 5) (text "ABC") (text_height 1)
    (type qr) (ecc_level M) (hide no) (knockout no) (uuid "aaaaaaaa-0000-0000-0000-00000000000b"))
)`;
    const once = FormatBoard(read(src));
    expect(once).toContain('(point');
    expect(once).toContain('(barcode');
    expect(FormatBoard(read(once))).toBe(once);
  });
});

describe('writing it back (format( PCB_POINT* ))', () => {
  /** A fresh 1 mm point at (3, 4) on F.Cu, added to the board. */
  const added = (): { board: BOARD; p: PCB_POINT } => {
    const board = read();
    const p = new PCB_POINT(board);
    p.SetPosition({ x: MM(3), y: MM(4) });
    p.SetLayer(PCB_LAYER_ID.F_Cu);
    board.Add(p);
    return { board, p };
  };

  it('writes `(point (at …) (size …) (layer …) (uuid …))`, in that order', () => {
    // `format( const PCB_POINT* )` (`pcb_io_kicad_sexpr.cpp:1156-1167`).
    const { board, p } = added();
    const node = pointNodes(FormatBoard(board)).find((n) => serialize(n).includes(p.m_Uuid))!;

    expect(node.items.map((i) => (i.kind === 'list' ? head(i) : i.value))).toEqual([
      'point',
      'at',
      'size',
      'layer',
      'uuid',
    ]);
    const back = ParseBoard(FormatBoard(board))
      .Points()
      .find((x) => x.m_Uuid === p.m_Uuid)!;
    expect(back.GetPosition()).toEqual({ x: MM(3), y: MM(4) });
    expect(back.GetSize()).toBe(MM(1));
    expect(back.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
  });

  it('writes no (locked …), because the formatter has none', () => {
    // `PCB_POINT` inherits `BOARD_ITEM` and so has the flag, but neither the
    // formatter nor `parsePCB_POINT` has a token for it.
    const { board, p } = added();
    p.SetLocked(true);

    const points = pointNodes(FormatBoard(board));
    expect(points).toHaveLength(2);
    for (const node of points)
      expect(node.items.some((i) => i.kind === 'list' && head(i) === 'locked')).toBe(false);
  });
});

describe('a footprint’s own points', () => {
  const FP = `(footprint "L:P" (version 20241229) (layer "F.Cu")
    (point (at 1 2) (size 1) (layer "F.Fab")
      (uuid "cccccccc-0000-0000-0000-000000000003")))`;

  it('reads into FOOTPRINT::Points(), not the board’s', () => {
    // `parseFOOTPRINT`, T_point (`…_parser.cpp:5606-5610`).
    const fp = ParseFootprintFile(FP);

    expect(fp.Points()).toHaveLength(1);
    expect(fp.Points()[0]!.GetPosition()).toEqual({ x: MM(1), y: MM(2) });
    expect(fp.Points()[0]!.GetLayer()).toBe(PCB_LAYER_ID.F_Fab);
  });

  it('round-trips a library footprint, its point uuid included', () => {
    // `FP_CACHE::Save`'s path: Format( footprint ) under CTL_FOR_LIBRARY.
    const once = FormatFootprintForLibrary(ParseFootprintFile(FP));
    expect(once).toContain('(point');
    expect(FormatFootprintForLibrary(ParseFootprintFile(once))).toBe(once);
    expect(once).toContain('(uuid "cccccccc-0000-0000-0000-000000000003")');
  });

  it('is stored in ABSOLUTE board coordinates, unlike every graphic', () => {
    // `parsePCB_POINT()` takes no parent (:8582) and `format( const PCB_POINT* )`
    // prints `GetPosition()` through the one-argument overload
    // (`pcb_io_kicad_sexpr.cpp:1158-1160`): `(at 1 2)` under a footprint at
    // (100, 50) is 1 mm, 2 mm on the BOARD.
    const b = read(`(kicad_pcb (version 20241229) (net 0 "")
      (footprint "L:P" (layer "F.Cu") (at 100 50)
        (point (at 1 2) (size 1) (layer "F.Fab")
          (uuid "dddddddd-0000-0000-0000-000000000004"))))`);

    expect(b.Footprints()[0]!.Points()[0]!.GetPosition()).toEqual({ x: MM(1), y: MM(2) });
    expect(FormatBoard(b)).toContain('(at 1 2)');
  });

  it('and a rotated footprint does not turn its points either', () => {
    const b = read(`(kicad_pcb (version 20241229) (net 0 "")
      (footprint "L:P" (layer "F.Cu") (at 100 50 90)
        (point (at 1 2) (size 1) (layer "F.Fab")
          (uuid "dddddddd-0000-0000-0000-000000000005"))))`);

    expect(b.Footprints()[0]!.Points()[0]!.GetPosition()).toEqual({ x: MM(1), y: MM(2) });
    expect(FormatBoard(b)).toContain('(at 1 2)');
  });
});

describe('hit testing (PCB_POINT::HitTest, pcb_point.cpp:82-96)', () => {
  // The local `size` is `GetSize() / 2`, so the X's arms reach `GetSize() / 2`
  // from the centre and the circle's radius is `GetSize() / 4`.
  const at = { x: MM(10), y: MM(20) };
  const tol = MM(0.01);
  const hit = (p: { x: number; y: number }): boolean => point().HitTest(p, tol);

  it('picks up the two bars of the X', () => {
    // size is 1.5 mm, so a corner of the X is 0.75 mm out on each axis.
    expect(hit({ x: at.x + MM(0.5), y: at.y + MM(0.5) })).toBe(true);
    expect(hit({ x: at.x + MM(0.5), y: at.y - MM(0.5) })).toBe(true);
  });

  it('and the disc at its centre', () => {
    // `SHAPE_CIRCLE::Collide` is a disc: radius 1.5/4 = 0.375 mm.
    expect(hit({ x: at.x + MM(0.3), y: at.y })).toBe(true);
  });

  it('misses the empty quadrant between an arm and the ring', () => {
    // (0.6, 0.05) is 0.39 mm from the nearer diagonal and 0.6 mm from the
    // centre — outside both, which a bounding-box test would call a hit.
    expect(hit({ x: at.x + MM(0.6), y: at.y + MM(0.05) })).toBe(false);
  });

  it('misses well outside the marker', () => {
    expect(hit({ x: at.x + MM(5), y: at.y })).toBe(false);
  });

  it('box-selects by its bounding box, in both drag directions', () => {
    // `PCB_POINT::HitTest( BOX2I )` is `KIGEOM::BoxHitTest` on the bounding box.
    const around = new BOX2I({ x: MM(5), y: MM(15) }, { x: MM(10), y: MM(10) });
    const far = new BOX2I({ x: MM(50), y: MM(50) }, { x: MM(10), y: MM(10) });

    expect(point().HitTest(around, true)).toBe(true);
    expect(point().HitTest(around, false)).toBe(true);
    expect(point().HitTest(far, false)).toBe(false);
  });

  it('has the bounding box PCB_POINT::GetBoundingBox does', () => {
    // `BOX2I::ByCenter( m_pos, { m_size, m_size } )` — half a size each way.
    const bb = point().GetBoundingBox();
    expect([bb.GetLeft(), bb.GetTop(), bb.GetRight(), bb.GetBottom()]).toEqual([
      MM(10) - MM(0.75),
      MM(20) - MM(0.75),
      MM(10) + MM(0.75),
      MM(20) + MM(0.75),
    ]);
  });
});

describe('editing', () => {
  it('moves, and the file records it', () => {
    const b = read();
    point(b).Move({ x: MM(1), y: MM(2) });

    expect(point(b).GetPosition()).toEqual({ x: MM(11), y: MM(22) });
    expect(FormatBoard(b)).toContain('(at 11 22)');
  });

  it('rotates about a centre', () => {
    // `PCB_POINT::Rotate` is `RotatePoint( m_pos, aRotCentre, aAngle )`:
    // (x, y) at +90 degrees -> (y, -x).
    const b = read();
    point(b).Rotate({ x: 0, y: 0 }, ANGLE_90);

    expect(point(b).GetPosition()).toEqual({ x: MM(20), y: MM(-10) });
  });

  it('has no Mirror of its own, so a mirror changes nothing (10.0.6 pcb_point.h)', () => {
    // `pcb_point.h` overrides Move, Rotate and Flip, not Mirror; the call lands
    // on `BOARD_ITEM::Mirror`, "should not occur" (board_item.cpp:439-442).
    const p = point();
    const assert = console.assert;
    console.assert = () => {};
    try {
      p.Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    } finally {
      console.assert = assert;
    }

    expect(p.GetPosition()).toEqual({ x: MM(10), y: MM(20) });
    expect(p.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
  });

  it('deletes', () => {
    const b = read();
    b.Remove(point(b));
    expect(b.Points()).toHaveLength(0);
  });
});

describe('the message panel', () => {
  it('shows PCB_POINT::GetMsgPanelInfo’s five rows', () => {
    // `pcb_point.cpp:180-188`. The first row is a bare header with an empty
    // value — it stands in for the `Type` row every other item gets from
    // `GetFriendlyName`, which is why it reads "PCB Point" and not "Point" —
    // and X and Y are separate rows, unlike its neighbours' position pair.
    const board = ParseBoard(BOARD_SRC);
    const frame = new TEST_PCB_FRAME(board);
    frame.SetUserUnits('mm');
    const list: MSG_PANEL_ITEM[] = [];
    board.Points()[0]!.GetMsgPanelInfo(frame.AsDrawFrameLike(), list);
    const rows = list.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }));

    expect(rows.map((r) => r.upper)).toEqual([
      'PCB Point',
      'Position X',
      'Position Y',
      'Size',
      'Layer',
    ]);
    expect(rows[0]!.lower).toBe('');
    expect(rows[1]!.lower).toBe('10.0000 mm');
    expect(rows[3]!.lower).toBe('1.5000 mm');
    expect(rows[4]!.lower).toBe('F.Silkscreen');
  });
});

describe('the Properties panel', () => {
  // `PCB_POINT_DESC` (`pcb_point.cpp:236-252`) registers one property of its
  // own, Size, and `InheritsAfter( PCB_POINT, BOARD_ITEM )` brings Position X,
  // Position Y, Layer and Locked from `BOARD_ITEM_DESC` (`board_item.cpp:449-459`)
  // — which is why Size comes last. This is PCB_PROPERTIES_PANEL on the live
  // BOARD (#636 stage 6).
  const panel = (src = BOARD_SRC) => livePanel(src, (b) => b.Points()[0]!);

  it('offers BOARD_ITEM’s four rows and PCB_POINT’s Size, in that order', () => {
    expect(
      panel()
        .rows()
        .map((r) => r.name),
    ).toEqual(['Position X', 'Position Y', 'Layer', 'Locked', 'Size']);
  });

  it('reads the point’s own values', () => {
    const r = panel().rows();
    expect(r.find((x) => x.name === 'Position X')!.value).toBe(MM(10));
    expect(r.find((x) => x.name === 'Size')!.value).toBe(MM(1.5));
    // `createPGProperty` (:437-461) rebuilds the PCB_LAYER_ID cell's choices
    // from `m_frame->GetBoard()->GetLayerName()` (:451), which for a layer the
    // board did not rename is "F.Silkscreen", NOT the file token "F.SilkS".
    expect(r.find((x) => x.name === 'Layer')!.value).toBe('F.Silkscreen');
  });

  it('commits Size, and the edit reaches the file', () => {
    const p = panel();
    expect(p.set('Size', MM(3))).toBe(true);
    expect(p.board.Points()[0]!.GetSize()).toBe(MM(3));
    expect(ParseBoard(p.written()).Points()[0]!.GetSize()).toBe(MM(3));
  });

  it('commits a position, and that reaches the file too', () => {
    const p = panel();
    expect(p.set('Position X', MM(42))).toBe(true);
    expect(ParseBoard(p.written()).Points()[0]!.GetPosition().x).toBe(MM(42));
  });

  it('locks in memory and writes no token, because the parser rejects one', () => {
    // `SetLocked` works on a `PCB_POINT` — it is a `BOARD_ITEM` — and the panel
    // offers the row. But `format( const PCB_POINT* )` has no `(locked …)` and
    // `parsePCB_POINT` `Expecting( "at, size, layer or uuid" )`, so emitting one
    // would hand KiCad a `(point …)` its own parser throws on.
    const p = panel();
    expect(p.set('Locked', true)).toBe(true);
    expect(p.board.Points()[0]!.IsLocked()).toBe(true);
    expect(p.written()).not.toContain('locked');
    // And it is gone after a round trip, which is what upstream does too.
    expect(ParseBoard(p.written()).Points()[0]!.IsLocked()).toBe(false);
  });

  it('Lock/Unlock reaches a point, and still writes no token', () => {
    const b = read();
    point(b).SetLocked(true);

    expect(point(b).IsLocked()).toBe(true);
    expect(FormatBoard(b)).not.toContain('locked');
  });
});

describe('a footprint carries its points', () => {
  // `FOOTPRINT::Move`, `::Rotate` and `::Flip` each end with a loop over
  // `m_points` calling the same method on every one. A point is stored
  // board-absolute, so a transform that moved the footprint and not its points
  // would move them apart on screen AND save the new gap.
  const FP = `(kicad_pcb (version 20241229) (generator "test")
    (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
            (7 "B.SilkS" user "B.Silkscreen"))
    (net 0 "")
    (footprint "L:P" (layer "F.Cu") (at 100 50)
      (point (at 101 52) (size 2) (layer "F.SilkS"))))`;
  const fp = (b: BOARD) => b.Footprints()[0]!;
  const pointOf = (b: BOARD) => fp(b).Points()[0]!;

  it('moves with it', () => {
    const b = read(FP);
    fp(b).Move({ x: MM(10), y: MM(20) });

    expect(fp(b).GetPosition()).toEqual({ x: MM(110), y: MM(70) });
    expect(pointOf(b).GetPosition()).toEqual({ x: MM(111), y: MM(72) });
    expect(FormatBoard(b)).toContain('(at 111 72)');
  });

  it('rotates with it', () => {
    // 90 degrees about the anchor: (+1, +2) from it goes to (+2, -1).
    const b = read(FP);
    fp(b).Rotate({ x: MM(100), y: MM(50) }, ANGLE_90);

    expect(pointOf(b).GetPosition()).toEqual({ x: MM(102), y: MM(49) });
  });

  it('flips with it, layer and all', () => {
    // `for( PCB_POINT* point : m_points ) point->Flip( m_pos, TOP_BOTTOM )`, and
    // `PCB_POINT::Flip` is `MIRROR( m_pos, … )` and `SetLayer( FlipLayer( … ) )`.
    const b = read(FP);
    fp(b).Flip({ x: MM(100), y: MM(50) }, FLIP_DIRECTION.TOP_BOTTOM);

    expect(pointOf(b).GetPosition()).toEqual({ x: MM(101), y: MM(48) });
    expect(pointOf(b).GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
  });

  it('is measured by the footprint’s bounding box', () => {
    // `bbox.Merge( point->GetBoundingBox() )` (`footprint.cpp:1853`).
    const b = read(FP);
    pointOf(b).SetPosition({ x: MM(500), y: MM(500) });
    fp(b).InvalidateGeometryCaches();

    expect(fp(b).GetBoundingBox().GetRight()).toBeGreaterThanOrEqual(MM(501));
  });
});
