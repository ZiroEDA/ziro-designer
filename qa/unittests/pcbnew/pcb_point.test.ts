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
 * …)` loaded with the marker silently dropped and saved it back out gone.
 *
 * The snap behaviour is the part worth pinning hardest: a point that draws but
 * does not offer an anchor is decoration, and that is the one thing the item
 * is *for*.
 */
import { describe, expect, it } from 'vitest';
import { head, parse, serialize, type SList } from '@ziroeda/sexpr/src/index.js';
import {
  readBoard,
  readFootprintFile,
  DEFAULT_POINT_SIZE,
} from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';
import {
  addBoardPoint,
  boardItemBBox,
  boardHitCandidates,
  boardItemsInBox,
  allBoardItemIds,
  deleteBoardItems,
  moveBoardItems,
  rotateBoardItemsBy,
  mirrorBoardItems,
  duplicateBoardItems,
  flipBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { footprintBBox } from '@ziroeda/pcbnew/src/edit-footprint.js';
import { isBoardItemLocked, setBoardItemsLocked } from '@ziroeda/pcbnew/src/edit-board.js';
import { pcbPropertiesFor } from '@ziroeda/pcbnew/src/properties_panel.js';
import { bestSnapAnchor } from '@ziroeda/pcbnew/src/pcb_cursor_snap.js';
import { pcbPointMsgPanelInfo } from '@ziroeda/pcbnew/src/msg_panel.js';
import { boardIsEmpty } from '@ziroeda/pcbnew/src/pcb_selection_conditions.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

const BOARD = `(kicad_pcb (version 20241229) (generator "ziroeda") (generator_version "1.0")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (point (at 10 20) (size 1.5) (layer "F.SilkS")
    (uuid "aaaaaaaa-0000-0000-0000-000000000001"))
)`;

const read = (src = BOARD): Board => readBoard(parse(src));

describe('reading (point …)', () => {
  it('lands in board.points with position, size, layer and uuid', () => {
    // `parsePCB_POINT` (`pcb_io_kicad_sexpr_parser.cpp:8582-8628`) — four
    // tokens and it `Expecting( "at, size, layer or uuid" )` for anything else.
    const [p] = read().points;

    expect(p).toBeDefined();
    expect(p!.at).toEqual({ x: MM(10), y: MM(20) });
    expect(p!.size).toBe(MM(1.5));
    expect(p!.layer).toBe('F.SilkS');
    expect(p!.uuid).toBe('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('falls back to the constructor’s 1 mm when (size …) is absent', () => {
    // `DEFAULT_PT_SIZE_MM = 1.0` (`pcb_point.cpp:42`). Every token is optional
    // in the grammar, so an absent one has to leave the constructed value
    // behind rather than a zero.
    const b = read(`(kicad_pcb (version 20241229) (net 0 "")
      (point (at 1 2) (layer "F.Cu")))`);

    expect(b.points[0]!.size).toBe(DEFAULT_POINT_SIZE);
    expect(DEFAULT_POINT_SIZE).toBe(MM(1));
  });

  it('is not a graphic: it does not land in board.shapes', () => {
    // The token is a bare `point`, not `gr_point`, and the reader's board loop
    // dispatches on the head — an arm that fell through to `readShape` would
    // put a shape with no geometry on the board.
    const b = read();

    expect(b.shapes).toHaveLength(0);
    expect(b.points).toHaveLength(1);
  });

  it('counts towards BOARD::IsEmpty', () => {
    // `return m_drawings.empty() && m_footprints.empty() && m_tracks.empty()
    //         && m_zones.empty() && m_points.empty();` (`board.cpp:606-609`).
    // A board holding one point is not empty, so Select All is live on it.
    expect(boardIsEmpty(read())).toBe(false);
    expect(boardIsEmpty(read(`(kicad_pcb (version 20241229) (net 0 ""))`))).toBe(true);
  });
});

describe('writing it back', () => {
  it('round-trips a file it did not change, byte for byte', () => {
    const src = parse(BOARD);

    expect(serializeBoard(readBoard(src))).toBe(serialize(src));
  });

  it('builds `(point (at …) (size …) (layer …) (uuid …))` for a fresh one', () => {
    // `format( const PCB_POINT* )` (`pcb_io_kicad_sexpr.cpp:1156-1167`), in
    // that order. A freshly placed point has no source node to emit, so this
    // is the canonical builder and not a patched source.
    //
    // Read back through the parser rather than string-matched: the serializer
    // pretty-prints, so a text compare would be pinning its line breaks.
    const { board } = addBoardPoint(read(), {
      at: { x: MM(3), y: MM(4) },
      size: DEFAULT_POINT_SIZE,
      layer: 'F.Cu',
      uuid: 'bbbbbbbb-0000-0000-0000-000000000002',
    });

    const node = parse(serializeBoard(board)).items.filter(
      (i): i is SList => i.kind === 'list' && head(i) === 'point',
    )[1]!;

    expect(node.items.map((i) => (i.kind === 'list' ? head(i) : i.value))).toEqual([
      'point',
      'at',
      'size',
      'layer',
      'uuid',
    ]);
    expect(readBoard(parse(serializeBoard(board))).points[1]).toMatchObject({
      at: { x: MM(3), y: MM(4) },
      size: MM(1),
      layer: 'F.Cu',
      uuid: 'bbbbbbbb-0000-0000-0000-000000000002',
    });
  });

  it('writes no (locked …), because the formatter has none', () => {
    // `PCB_POINT` inherits `BOARD_ITEM` and so has the flag — `ViewGetLayers`
    // even pushes LAYER_LOCKED_ITEM_SHADOW for it — but neither the formatter
    // nor `parsePCB_POINT` has a token for it, so it cannot survive a save.
    // Modelling it would be inventing a file format.
    const { board } = addBoardPoint(read(), {
      at: { x: 0, y: 0 },
      size: DEFAULT_POINT_SIZE,
      layer: 'F.Cu',
    });

    const points = parse(serializeBoard(board)).items.filter(
      (i): i is SList => i.kind === 'list' && head(i) === 'point',
    );
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
    // `parseFOOTPRINT`, T_point (`…_parser.cpp:5606-5610`): the same unprefixed
    // token a board uses, added to the footprint.
    const fp = readFootprintFile(parse(FP))!;

    expect(fp.points).toHaveLength(1);
    expect(fp.points[0]!.at).toEqual({ x: MM(1), y: MM(2) });
    expect(fp.points[0]!.layer).toBe('F.Fab');
  });

  it('round-trips a library footprint unchanged', () => {
    const src = parse(FP);

    expect(serializeFootprint(readFootprintFile(src)!)).toBe(serialize(src));
  });

  it('is baked into board coordinates when the footprint is placed, and unbaked on save', () => {
    // A footprint's children are read into board coordinates through the
    // placement transform, exactly as its graphics are — and written back
    // footprint-relative. Without both halves a save would move the point by
    // the footprint's own position on every round trip.
    const src = `(kicad_pcb (version 20241229) (net 0 "")
      (footprint "L:P" (layer "F.Cu") (at 100 50)
        (point (at 1 2) (size 1) (layer "F.Fab")
          (uuid "dddddddd-0000-0000-0000-000000000004"))))`;
    const b = read(src);

    expect(b.footprints[0]!.points[0]!.at).toEqual({ x: MM(101), y: MM(52) });
    expect(serializeBoard(b)).toBe(serialize(parse(src)));
  });
});

describe('hit testing', () => {
  // `PCB_POINT::HitTest` (`pcb_point.cpp:82-96`), whose local `size` is
  // `GetSize() / 2` — so the X's arms reach `GetSize() / 2` from the centre and
  // the circle's radius is `GetSize() / 4`.
  const at = { x: MM(10), y: MM(20) };
  const tol = MM(0.01);
  const hit = (p: { x: number; y: number }): boolean =>
    boardHitCandidates(read(), p, tol).includes('point:0');

  it('picks up the two bars of the X', () => {
    // size is 1.5 mm, so a corner of the X is 0.75 mm out on each axis.
    expect(hit({ x: at.x + MM(0.5), y: at.y + MM(0.5) })).toBe(true);
    expect(hit({ x: at.x + MM(0.5), y: at.y - MM(0.5) })).toBe(true);
  });

  it('and the disc at its centre', () => {
    // `SHAPE_CIRCLE::Collide` is a disc, not a ring: the inside of the little
    // circle is solid to the mouse. Its radius is 1.5/4 = 0.375 mm, and this
    // sample is off both diagonals.
    expect(hit({ x: at.x + MM(0.3), y: at.y })).toBe(true);
  });

  it('misses the empty quadrant between an arm and the ring', () => {
    // (0.6, 0.05) is 0.39 mm from the nearer diagonal and 0.6 mm from the
    // centre — outside both. A bounding-box hit test would call this a hit,
    // which is what makes this the case that separates the two.
    expect(hit({ x: at.x + MM(0.6), y: at.y + MM(0.05) })).toBe(false);
  });

  it('misses well outside the marker', () => {
    expect(hit({ x: at.x + MM(5), y: at.y })).toBe(false);
  });

  it('box-selects by its bounding box, in both drag directions', () => {
    // `PCB_POINT::HitTest( BOX2I )` is `KIGEOM::BoxHitTest` on the bounding box
    // in both modes, so a crossing drag and a window drag agree.
    const b = read();
    const around = [MM(5), MM(15), MM(15), MM(25)] as const;

    expect(boardItemsInBox(b, ...around, true)).toContain('point:0');
    expect(boardItemsInBox(b, ...around, false)).toContain('point:0');
    expect(boardItemsInBox(b, MM(50), MM(50), MM(60), MM(60), false)).not.toContain('point:0');
  });

  it('has the bounding box PCB_POINT::GetBoundingBox does', () => {
    // `BOX2I::ByCenter( m_pos, { m_size, m_size } )` — half a size each way,
    // not a full one.
    expect(boardItemBBox(read(), 'point:0')).toEqual({
      minX: MM(10) - MM(0.75),
      minY: MM(20) - MM(0.75),
      maxX: MM(10) + MM(0.75),
      maxY: MM(20) + MM(0.75),
    });
  });

  it('is reachable from Select All', () => {
    expect(allBoardItemIds(read())).toContain('point:0');
  });
});

describe('editing', () => {
  it('moves, and the source node moves with it', () => {
    // Patched in place, like every other item: the writer emits the source, so
    // a mover that changed only the model would save the old position.
    const after = moveBoardItems(read(), new Set(['point:0']), { x: MM(1), y: MM(2) });

    expect(after.points[0]!.at).toEqual({ x: MM(11), y: MM(22) });
    expect(serializeBoard(after)).toContain('(at 11 22)');
  });

  it('rotates about a centre', () => {
    // `PCB_POINT::Rotate` is `RotatePoint( m_pos, aRotCentre, aAngle )` and
    // nothing else — there is no orientation to carry round with it.
    const after = rotateBoardItemsBy(read(), new Set(['point:0']), 90, { x: 0, y: 0 });

    // KiCad's RotatePoint on screen coordinates: (x, y) at +90° -> (y, -x).
    expect(after.points[0]!.at).toEqual({ x: MM(20), y: MM(-10) });
  });

  it('mirrors its position and keeps its layer', () => {
    // `PCB_POINT::Mirror` is the one method 10.0.5 forgot: `PCB_POINT_T` is in
    // `EDIT_TOOL::MirrorableItems` and the switch calls it, but `pcb_point.h`
    // overrides `Move`/`Rotate`/`Flip` and not `Mirror`, so it lands on
    // `BOARD_ITEM::Mirror` — a `wxMessageBox( "should not occur" )`.
    //
    // Derived, not invented: `MIRROR( p, ref, LEFT_RIGHT )` is
    // `p.x = -( p.x - ref.x ) + ref.x` (`core/mirror.h:45-61`) and every
    // sibling's `Mirror` is one `MIRROR()` per coordinate. A point has one, so
    // the method is `MIRROR( m_pos, aCentre, aDir )`. The layer is untouched —
    // flipping it is `Flip`, which `PCB_POINT` *does* implement.
    const after = mirrorBoardItems(read(), new Set(['point:0']), 'h', { x: MM(0), y: MM(0) });

    expect(after.points[0]!.at).toEqual({ x: MM(-10), y: MM(20) });
    expect(after.points[0]!.layer).toBe('F.SilkS');
  });

  it('duplicates with a fresh uuid', () => {
    const { board, ids } = duplicateBoardItems(read(), new Set(['point:0']), { x: MM(1), y: 0 });

    expect(ids).toEqual(['point:1']);
    expect(board.points).toHaveLength(2);
    expect(board.points[1]!.uuid).not.toBe(board.points[0]!.uuid);
    expect(board.points[1]!.at).toEqual({ x: MM(11), y: MM(20) });
  });

  it('deletes', () => {
    expect(deleteBoardItems(read(), new Set(['point:0'])).points).toHaveLength(0);
  });

  it('appends a placed point on the active layer at the constructor’s size', () => {
    // `POINT_PLACER::CreateItem` sets exactly one thing on the new item,
    // `SetLayer( m_frame.GetActiveLayer() )` (`drawing_tool.cpp:885-893`).
    const { board, id } = addBoardPoint(read(), {
      at: { x: MM(7), y: MM(8) },
      size: DEFAULT_POINT_SIZE,
      layer: 'B.Cu',
    });

    expect(id).toBe('point:1');
    expect(board.points[1]).toMatchObject({ size: MM(1), layer: 'B.Cu' });
  });
});

describe('as a snap anchor — the thing it exists for', () => {
  // `case PCB_POINT_T: addAnchor( aItem->GetPosition(), ORIGIN | SNAPPABLE, … )`
  // (`pcb_grid_helper.cpp:1790-1797`), and the same for a footprint's own
  // points under the comment "Points are also pick-up points" (`:1607-1617`).
  //
  // The grid is DISABLED here, so `align` returns the cursor untouched and
  // `bestSnapAnchor`'s fallback is the raw position. That is what makes "the
  // point pulled it" and "nothing pulled it" distinguishable — with a grid on,
  // both answers could round to the same node and every assertion below would
  // pass whatever the anchor list held.
  const grid = { size: MM(1), origin: { x: 0, y: 0 }, enableGrid: false, enableSnap: true };
  const snapOpts = { snapScale: MM(1), visibleGrid: MM(100), layer: 'F.SilkS' };
  const near = { x: MM(10) + MM(0.2), y: MM(20) + MM(0.2) };

  it('pulls the cursor onto the point', () => {
    expect(bestSnapAnchor(read(), near, grid, snapOpts)).toEqual({ x: MM(10), y: MM(20) });
  });

  it('and a footprint’s point does too', () => {
    const b = read(`(kicad_pcb (version 20241229)
      (layers (0 "F.Cu" signal) (37 "F.SilkS" user "F.Silkscreen"))
      (net 0 "")
      (footprint "L:P" (layer "F.Cu") (at 100 50)
        (point (at 1 2) (size 1) (layer "F.SilkS"))))`);
    const nearFp = { x: MM(101) + MM(0.2), y: MM(52) + MM(0.2) };

    expect(bestSnapAnchor(b, nearFp, grid, snapOpts)).toEqual({ x: MM(101), y: MM(52) });
  });

  it('offers nothing once the Selection Filter’s Points box is cleared', () => {
    // `if( aSelectionFilter && !aSelectionFilter->points ) continue;` — the
    // filter gates the anchor, not just the click.
    expect(bestSnapAnchor(read(), near, grid, { ...snapOpts, points: false })).toEqual(near);
  });

  it('is not offered from a layer the caller is not on', () => {
    expect(bestSnapAnchor(read(), near, grid, { ...snapOpts, layer: 'B.Cu' })).toEqual(near);
  });
});

describe('the message panel', () => {
  it('shows PCB_POINT::GetMsgPanelInfo’s five rows', () => {
    // `pcb_point.cpp:180-188`. The first row is a bare header with an empty
    // value — it stands in for the `Type` row every other item gets from
    // `GetFriendlyName`, which is why it reads "PCB Point" and not "Point" —
    // and X and Y are separate rows, unlike its neighbours' position pair.
    const b = read();
    const rows = pcbPointMsgPanelInfo({ board: b, units: 'mm', frame: 'pcb_edit' }, b.points[0]!);

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
  // — which is why Size comes last. Selecting a point used to fall through the
  // dispatcher's `default` and show an empty panel.
  const ctx = { layerColor: () => 'rgb(0, 0, 0)', units: 'mm' as const };
  const rows = (b = read()): ReturnType<typeof pcbPropertiesFor> =>
    pcbPropertiesFor(b, ['point:0'], ctx);

  it('offers BOARD_ITEM’s four rows and PCB_POINT’s Size, in that order', () => {
    expect(rows().map((r) => r.name)).toEqual([
      'Position X',
      'Position Y',
      'Layer',
      'Locked',
      'Size',
    ]);
  });

  it('reads the point’s own values', () => {
    const r = rows();
    expect(r.find((x) => x.name === 'Position X')!.value).toBe(MM(10));
    expect(r.find((x) => x.name === 'Size')!.value).toBe(MM(1.5));
    // `LSET::Name( layer )` — the CANONICAL name (`pcb_properties_panel.cpp:655`),
    // not `GetLayerName()`. So this cell reads "F.SilkS" even on a board whose
    // layer table renames it "F.Silkscreen", which is the opposite of what the
    // Appearance panel shows and is upstream's own split.
    expect(r.find((x) => x.name === 'Layer')!.value).toBe('F.SilkS');
  });

  it('commits Size, and the edit reaches the file', () => {
    // A row whose `set` updated the model but not the source node would show
    // the new size and save the old one.
    const next = rows().find((x) => x.name === 'Size')!.set!(MM(3))!;

    expect(next.points[0]!.size).toBe(MM(3));
    expect(readBoard(parse(serializeBoard(next))).points[0]!.size).toBe(MM(3));
  });

  it('commits a position, and that reaches the file too', () => {
    const next = rows().find((x) => x.name === 'Position X')!.set!(MM(42))!;

    expect(readBoard(parse(serializeBoard(next))).points[0]!.at.x).toBe(MM(42));
  });

  it('locks in memory and writes no token, because the parser rejects one', () => {
    // `SetLocked` works on a `PCB_POINT` — it is a `BOARD_ITEM` — and the panel
    // offers the row. But `format( const PCB_POINT* )` has no `(locked …)` and
    // `parsePCB_POINT` `Expecting( "at, size, layer or uuid" )`, so emitting one
    // would hand KiCad a `(point …)` its own parser throws on. Upstream's lock
    // is equally unsaveable.
    const next = rows().find((x) => x.name === 'Locked')!.set!(true)!;

    expect(next.points[0]!.locked).toBe(true);
    expect(isBoardItemLocked(next, 'point:0')).toBe(true);
    expect(serializeBoard(next)).not.toContain('locked');
    // And it is gone after a round trip, which is what upstream does too.
    expect(readBoard(parse(serializeBoard(next))).points[0]!.locked).toBeUndefined();
  });

  it('Lock/Unlock reaches a point at all, which is the shared command', () => {
    // `setBoardItemsLocked` is what `PCB_ACTIONS::lock` runs. Points were the
    // one kind it skipped, so the command silently did nothing to them.
    const locked = setBoardItemsLocked(read(), new Set(['point:0']), true);

    expect(isBoardItemLocked(locked, 'point:0')).toBe(true);
    expect(serializeBoard(locked)).not.toContain('locked');
  });
});

describe('a footprint carries its points', () => {
  // Our footprint children are held board-absolute, and the writer un-bakes
  // each one against the footprint's anchor on save. So a transform that moved
  // the footprint and not its points would not merely leave them behind on
  // screen — it would change their footprint-relative offset and SAVE that.
  const FP = `(kicad_pcb (version 20241229) (generator "test")
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user "F.Silkscreen")
            (38 "B.SilkS" user "B.Silkscreen"))
    (net 0 "")
    (footprint "L:P" (layer "F.Cu") (at 100 50)
      (point (at 1 2) (size 2) (layer "F.SilkS"))))`;
  const fpBoard = (): Board => read(FP);
  const pointOf = (b: Board): { x: number; y: number } => b.footprints[0]!.points[0]!.at;

  it('moves with it — `FOOTPRINT::SetPosition`', () => {
    const after = moveBoardItems(fpBoard(), new Set(['footprint:0']), { x: MM(10), y: MM(20) });

    expect(after.footprints[0]!.at).toEqual({ x: MM(110), y: MM(70) });
    expect(pointOf(after)).toEqual({ x: MM(111), y: MM(72) });
    // …and the saved offset is still (1, 2), which is the half that would
    // silently corrupt the file if the point had stayed put.
    expect(serializeBoard(after)).toContain('(at 1 2)');
  });

  it('rotates with it — `FOOTPRINT::SetOrientation`', () => {
    // 90° about the footprint's own anchor: the point is at (+1, +2) from it,
    // and KiCad's RotatePoint on screen coords takes (x, y) to (y, -x).
    const after = rotateBoardItemsBy(fpBoard(), new Set(['footprint:0']), 90, {
      x: MM(100),
      y: MM(50),
    });

    expect(pointOf(after)).toEqual({ x: MM(102), y: MM(49) });
  });

  it('flips with it, layer and all — `FOOTPRINT::Flip`', () => {
    // `for( PCB_POINT* point : m_points ) point->Flip( m_pos, TOP_BOTTOM )`.
    // Upstream's comment there says "Points move but don't flip layer", but
    // `PCB_POINT::Flip` is `MIRROR( m_pos, … )` *and*
    // `SetLayer( GetBoard()->FlipLayer( GetLayer() ) )`. The code is what runs.
    // An explicit centre: with none, `flipBoardItems` takes the selection's
    // bounding-box centre, which for a footprint whose only content is this
    // point IS the point — so it would mirror onto itself and the assertion
    // would hold whatever the code did.
    const after = flipBoardItems(fpBoard(), new Set(['footprint:0']), {
      x: MM(100),
      y: MM(50),
    });
    const p = after.footprints[0]!.points[0]!;

    expect(p.at).toEqual({ x: MM(101), y: MM(48) });
    expect(p.layer).toBe('B.SilkS');
  });

  it('is measured by the footprint’s bounding box', () => {
    // `bbox.Merge( point->GetBoundingBox() )` (`footprint.cpp:1853`). This is
    // what zoom-to-fit and the board box read, so a point outside every other
    // item — which is exactly where a snap anchor goes — would be cropped.
    const fp = fpBoard().footprints[0]!;
    const far = { ...fp, points: [{ ...fp.points[0]!, at: { x: MM(500), y: MM(500) } }] };

    expect(footprintBBox(far)!.maxX).toBeGreaterThanOrEqual(MM(501));
  });
});
