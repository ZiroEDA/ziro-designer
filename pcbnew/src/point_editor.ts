// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Point editor: the handles a selected board item carries, and what dragging one
 * does to it. Counterpart: `PCB_POINT_EDITOR` and its `POINT_EDIT_BEHAVIOR`s in
 * `pcbnew/tools/pcb_point_editor.cpp`.
 *
 * Upstream keeps a mutable `EDIT_POINTS` per selected item: an `EDIT_POINT` per
 * corner and an `EDIT_LINE` per edge, whose position is the edge midpoint and
 * whose setter shifts both ends. Dragging one runs the behavior's `UpdateItem`,
 * which reads *all* the points back and rewrites the item from them. That
 * indirection is why a rectangle's corner pushes its neighbours: the neighbours
 * are points too.
 *
 * This keeps the same shape without the mutable state, as the schematic port
 * does: `boardEditHandles` derives the handles from the board, and
 * `dragBoardHandle` takes the grabbed handle and its new position and returns
 * the whole reshaped board. A drag is then a pure function of (board, handle,
 * cursor), so the preview during a drag and the committed result cannot
 * disagree.
 *
 * Covered: graphic segments, rectangles, circles, arcs and polygons, zone
 * outlines, tracks and track arcs, barcodes, and all five kinds of dimension.
 * Not covered: pads (their point editing is primitive-level and needs the
 * padstack editor), tables, reference images and generators — none of which we
 * model, or which need UI we do not have.
 *
 * ## Constraints, without the constraint objects
 *
 * Upstream attaches an `EDIT_CONSTRAINT` to a point and applies it to the raw
 * cursor before `UpdateItem` sees it — `EC_LINE` projects onto a line,
 * `EC_45DEGREE` snaps the vector from a partner point. Both are pure functions
 * of the cursor and the item's current geometry, and the constraints upstream
 * rebuilds after every `SetStart`/`SetEnd` are rebuilt from exactly that. So
 * they are applied here at the top of the drag instead of stored, and
 * {@link constrainedDragPosition} is where each one is named.
 */

import {
  boardItemId,
  parseBoardItemId,
  moveZoneCorner,
  moveZoneEdge,
  zoneHandles,
} from './edit-board.js';
import { arcCenter } from './read-board.js';
import { dimensionCrossbar, radialKnee } from './dimension_geometry.js';
import { updateDimension } from './dimension_text.js';
import { segLineProject } from '@ziroeda/kimath/src/geometry/seg.js';
import { vectorSnapped45 } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { Board, PcbBarcode, PcbDimension, PcbShape } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A square handle on a corner or vertex (`EDIT_POINT`), or a circle at an edge
 *  midpoint (`EDIT_LINE`). */
export type HandleKind = 'point' | 'line';

export interface BoardEditHandle {
  readonly kind: HandleKind;
  /** Index within the item's handle list of that kind; the identity a drag carries. */
  readonly index: number;
  readonly at: Vec2;
}

// Point indices, named as upstream names them.
const RECT_TOPLEFT = 0;
const RECT_TOPRIGHT = 1;
const RECT_BOTRIGHT = 2;
const RECT_BOTLEFT = 3;
const RECT_CENTER = 4;
const RECT_TOP = 0;
const RECT_RIGHT = 1;
const RECT_BOT = 2;
const RECT_LEFT = 3;
const SEG_START = 0;
const SEG_END = 1;
const CIRC_CENTER = 0;
const CIRC_END = 1;
const ARC_START = 0;
const ARC_MID = 1;
const ARC_END = 2;
// `pcb_point_editor.h:135-146`. The knee shares the crossbar-start slot because
// no dimension has both.
const DIM_START = 0;
const DIM_END = 1;
const DIM_TEXT = 2;
const DIM_CROSSBARSTART = 3;
const DIM_CROSSBAREND = 4;
const DIM_KNEE = DIM_CROSSBARSTART;

/** The smallest a rectangle may be dragged to, so it cannot invert or vanish. */
const MIN_RECT_SIZE = 1000; // 1 µm

const pt = (kind: HandleKind, index: number, at: Vec2): BoardEditHandle => ({ kind, index, at });
const mid = (a: Vec2, b: Vec2): Vec2 => ({
  x: Math.round((a.x + b.x) / 2),
  y: Math.round((a.y + b.y) / 2),
});
const add = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** Whether the point editor has anything to offer for this item. */
export function hasEditPoints(board: Board, id: string): boolean {
  return boardEditHandles(board, id).length > 0;
}

/**
 * The handles for `id`, or an empty list when the item has none.
 *
 * Upstream gates on the selection being a single item of a supported type; a
 * multi-item selection simply has no points.
 */
export function boardEditHandles(board: Board, id: string): BoardEditHandle[] {
  const r = parseBoardItemId(id);
  if (!r) return [];

  if (r.kind === 'zone') {
    // Already ported; kept on its own path so the zone filler's handles and
    // these stay the same objects.
    return zoneHandles(board, r.index).map((h) =>
      pt(h.kind === 'corner' ? 'point' : 'line', h.index, h.at),
    );
  }

  if (r.kind === 'track') {
    const t = board.tracks[r.index];
    return t ? [pt('point', SEG_START, t.start), pt('point', SEG_END, t.end)] : [];
  }

  if (r.kind === 'arc') {
    const a = board.arcs[r.index];
    return a
      ? [pt('point', ARC_START, a.start), pt('point', ARC_MID, a.mid), pt('point', ARC_END, a.end)]
      : [];
  }

  if (r.kind === 'barcode') return barcodeHandles(board, r.index);

  if (r.kind === 'dimension') {
    const d = board.dimensions[r.index];
    return d ? dimensionHandles(d) : [];
  }

  if (r.kind !== 'shape') return [];

  const s = board.shapes[r.index];
  if (!s) return [];

  if (s.kind === 'line' && s.start && s.end) {
    return [pt('point', SEG_START, s.start), pt('point', SEG_END, s.end)];
  }

  if (s.kind === 'rect' && s.start && s.end) {
    const c = rectCorners(s.start, s.end);
    return [
      pt('point', RECT_TOPLEFT, c.topLeft),
      pt('point', RECT_TOPRIGHT, c.topRight),
      pt('point', RECT_BOTRIGHT, c.botRight),
      pt('point', RECT_BOTLEFT, c.botLeft),
      pt('point', RECT_CENTER, mid(c.topLeft, c.botRight)),
      pt('line', RECT_TOP, mid(c.topLeft, c.topRight)),
      pt('line', RECT_RIGHT, mid(c.topRight, c.botRight)),
      pt('line', RECT_BOT, mid(c.botRight, c.botLeft)),
      pt('line', RECT_LEFT, mid(c.botLeft, c.topLeft)),
    ];
  }

  if (s.kind === 'circle') {
    const c = s.center ?? s.start;
    if (!c || !s.end) return [];
    return [pt('point', CIRC_CENTER, c), pt('point', CIRC_END, s.end)];
  }

  if (s.kind === 'arc' && s.start && s.mid && s.end) {
    return [
      pt('point', ARC_START, s.start),
      pt('point', ARC_MID, s.mid),
      pt('point', ARC_END, s.end),
    ];
  }

  if (s.kind === 'poly' && s.pts && s.pts.length >= 2) {
    const pts = s.pts;
    const out = pts.map((p, i) => pt('point', i, p));
    // An edge handle per side, the last one closing the ring.
    for (let i = 0; i < pts.length; i++) {
      out.push(pt('line', i, mid(pts[i]!, pts[(i + 1) % pts.length]!)));
    }
    return out;
  }

  return [];
}

/**
 * `BARCODE_POINT_EDIT_BEHAVIOR::MakePoints` (`pcb_point_editor.cpp:696-719`).
 *
 * A barcode is edited as a rectangle — `makeDummyRect()` builds a `PCB_SHAPE`
 * from the centre and size, rotates it by the item's angle, and hands it to
 * `RECTANGLE_POINT_EDIT_BEHAVIOR` — so the nine handles are the rectangle's.
 *
 * Two things are its own. A non-cardinal rotation gets NO handles at all:
 * "Non-cardinal barcode point-editing isn't useful enough to support"
 * (`:698-702`). And the three square symbologies constrain the diagonals to
 * 45 degrees (`KeepSquare`, `pcb_barcode.h:1069-1074`) so a QR code cannot be
 * dragged into a rectangle — which would still encode, and would not scan.
 */
function barcodeHandles(board: Board, index: number): BoardEditHandle[] {
  const bc = board.barcodes[index];
  if (!bc || !isCardinal(bc.angle)) return [];

  const c = barcodeCorners(bc);

  return [
    pt('point', RECT_TOPLEFT, c.topLeft),
    pt('point', RECT_TOPRIGHT, c.topRight),
    pt('point', RECT_BOTRIGHT, c.botRight),
    pt('point', RECT_BOTLEFT, c.botLeft),
    pt('point', RECT_CENTER, bc.at),
    pt('line', RECT_TOP, mid(c.topLeft, c.topRight)),
    pt('line', RECT_RIGHT, mid(c.topRight, c.botRight)),
    pt('line', RECT_BOT, mid(c.botRight, c.botLeft)),
    pt('line', RECT_LEFT, mid(c.botLeft, c.topLeft)),
  ];
}

/** `EDA_ANGLE::IsCardinal`: a multiple of 90 degrees. */
const isCardinal = (deg: number): boolean => ((deg % 90) + 90) % 90 === 0;

/**
 * `makeDummyRect()`'s corners. The rectangle is the item's width and height
 * about its centre, then turned by its angle — and for a cardinal angle that
 * is a 90-degree multiple, so a quarter turn swaps width and height.
 */
function barcodeCorners(bc: PcbBarcode): Corners {
  const quarter = ((Math.round(bc.angle / 90) % 4) + 4) % 4;
  const swap = quarter === 1 || quarter === 3;
  const w = (swap ? bc.height : bc.width) / 2;
  const h = (swap ? bc.width : bc.height) / 2;

  return {
    topLeft: { x: bc.at.x - w, y: bc.at.y - h },
    topRight: { x: bc.at.x + w, y: bc.at.y - h },
    botRight: { x: bc.at.x + w, y: bc.at.y + h },
    botLeft: { x: bc.at.x - w, y: bc.at.y + h },
  };
}

/**
 * `BARCODE_POINT_EDIT_BEHAVIOR::UpdateItem` (`:731-745`): resize the dummy
 * rectangle, un-rotate it, and read the new centre and size back off it.
 *
 *     dummy.Rotate( dummy.GetCenter(), -m_barcode.GetAngle() );
 *     m_barcode.SetPosition( dummy.GetCenter() );
 *     m_barcode.SetWidth( dummy.GetRectangleWidth() );
 *     m_barcode.SetHeight( dummy.GetRectangleHeight() );
 */
function dragBarcodeHandle(board: Board, index: number, handle: BoardEditHandle, pos: Vec2): Board {
  const bc = board.barcodes[index];
  if (!bc || !isCardinal(bc.angle)) return board;

  const c = barcodeCorners(bc);
  let box: { topLeft: Vec2; botRight: Vec2 };

  if (handle.kind === 'point' && handle.index === RECT_CENTER) {
    const d = { x: pos.x - bc.at.x, y: pos.y - bc.at.y };
    box = { topLeft: add(c.topLeft, d), botRight: add(c.botRight, d) };
  } else if (handle.kind === 'point') {
    if (handle.index > RECT_BOTLEFT) return board;
    const dragged = clampDraggedCorner(c, handle.index, pos);
    box = { topLeft: dragged.topLeft, botRight: dragged.botRight };
  } else {
    let topLeft = c.topLeft;
    let botRight = c.botRight;
    if (handle.index === RECT_TOP)
      topLeft = { ...topLeft, y: Math.min(pos.y, botRight.y - MIN_RECT_SIZE) };
    else if (handle.index === RECT_BOT)
      botRight = { ...botRight, y: Math.max(pos.y, topLeft.y + MIN_RECT_SIZE) };
    else if (handle.index === RECT_LEFT)
      topLeft = { ...topLeft, x: Math.min(pos.x, botRight.x - MIN_RECT_SIZE) };
    else if (handle.index === RECT_RIGHT)
      botRight = { ...botRight, x: Math.max(pos.x, topLeft.x + MIN_RECT_SIZE) };
    else return board;
    box = { topLeft, botRight };
  }

  // `KeepSquare()`: the 45-degree constraints on both diagonals hold the box
  // square while it is dragged, so a QR code stays a QR code.
  if (bc.kind === 'qr' || bc.kind === 'microqr' || bc.kind === 'datamatrix') {
    const w = box.botRight.x - box.topLeft.x;
    const h = box.botRight.y - box.topLeft.y;
    const side = Math.max(w, h);
    const cx = (box.topLeft.x + box.botRight.x) / 2;
    const cy = (box.topLeft.y + box.botRight.y) / 2;
    box = {
      topLeft: { x: cx - side / 2, y: cy - side / 2 },
      botRight: { x: cx + side / 2, y: cy + side / 2 },
    };
  }

  const at = mid(box.topLeft, box.botRight);
  const width = box.botRight.x - box.topLeft.x;
  const height = box.botRight.y - box.topLeft.y;
  // Un-rotating a cardinal angle swaps the axes back for a quarter turn.
  const quarter = ((Math.round(bc.angle / 90) % 4) + 4) % 4;
  const swap = quarter === 1 || quarter === 3;

  return {
    ...board,
    barcodes: board.barcodes.map((x, i) =>
      i === index
        ? {
            ...x,
            at,
            width: swap ? height : width,
            height: swap ? width : height,
            // The writer patches `(at …)` and `(size …)` from the model when
            // the source has been cleared, exactly as a dragged shape's is.
            source: { kind: 'list' as const, items: [] },
          }
        : x,
    ),
  };
}

interface Corners {
  topLeft: Vec2;
  topRight: Vec2;
  botRight: Vec2;
  botLeft: Vec2;
}

/**
 * The rectangle's corners in a fixed visual order.
 *
 * Upstream tracks `SwapX`/`SwapY` so a rectangle stored with start past end
 * still presents its handles top-left first. Normalising here does the same
 * job: the handle the user grabs is the one they see, whichever way the
 * rectangle was drawn.
 */
function rectCorners(start: Vec2, end: Vec2): Corners {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return {
    topLeft: { x: minX, y: minY },
    topRight: { x: maxX, y: minY },
    botRight: { x: maxX, y: maxY },
    botLeft: { x: minX, y: maxY },
  };
}

/**
 * `RECTANGLE_POINT_EDIT_BEHAVIOR::PinEditedCorner`, less the part we do not need.
 *
 * Upstream also pushes the two corners sharing an edge with the dragged one,
 * because its `EDIT_POINTS` holds four independent points that get read back —
 * without the push the shape would come out a trapezium. We store a rectangle
 * as two opposite corners and *derive* the other two, so it cannot stop being a
 * rectangle and there is nothing to push. Only the clamp is real work here:
 * it stops the dragged corner crossing its opposite and inverting the shape.
 *
 * Returns the two stored corners for the dragged handle at `pos`.
 */
function clampDraggedCorner(
  c: Corners,
  index: number,
  pos: Vec2,
): { topLeft: Vec2; botRight: Vec2 } {
  const { topLeft, botRight } = { topLeft: c.topLeft, botRight: c.botRight };

  if (index === RECT_TOPLEFT) {
    return {
      topLeft: {
        x: Math.min(pos.x, botRight.x - MIN_RECT_SIZE),
        y: Math.min(pos.y, botRight.y - MIN_RECT_SIZE),
      },
      botRight,
    };
  }

  if (index === RECT_BOTRIGHT) {
    return {
      topLeft,
      botRight: {
        x: Math.max(pos.x, topLeft.x + MIN_RECT_SIZE),
        y: Math.max(pos.y, topLeft.y + MIN_RECT_SIZE),
      },
    };
  }

  // The other two corners each set one coordinate of *each* stored corner.
  if (index === RECT_TOPRIGHT) {
    return {
      topLeft: { ...topLeft, y: Math.min(pos.y, botRight.y - MIN_RECT_SIZE) },
      botRight: { ...botRight, x: Math.max(pos.x, topLeft.x + MIN_RECT_SIZE) },
    };
  }

  return {
    topLeft: { ...topLeft, x: Math.min(pos.x, botRight.x - MIN_RECT_SIZE) },
    botRight: { ...botRight, y: Math.max(pos.y, topLeft.y + MIN_RECT_SIZE) },
  };
}

/** Replace one shape, dropping its source node so the writer rebuilds it. */
function withShape(board: Board, index: number, next: Partial<PcbShape>): Board {
  return {
    ...board,
    shapes: board.shapes.map((s, i) =>
      i === index ? { ...s, ...next, source: { kind: 'list', items: [] } } : s,
    ),
  };
}

/**
 * `PCB_POINT_EDITOR::updateItem`: put the grabbed handle at `pos` and rewrite
 * the item from the resulting point set.
 *
 * `pos` is where the *handle* goes, not a delta — an edge handle therefore
 * carries its whole edge, since its position is the edge's midpoint.
 */
export function dragBoardHandle(
  board: Board,
  id: string,
  handle: BoardEditHandle,
  pos: Vec2,
): Board {
  const r = parseBoardItemId(id);
  if (!r) return board;

  if (r.kind === 'zone') {
    if (handle.kind === 'point') return moveZoneCorner(board, r.index, handle.index, pos);
    // An edge moves by the difference between where its midpoint was and is.
    const before = zoneHandles(board, r.index).find(
      (h) => h.kind === 'edge' && h.index === handle.index,
    );
    if (!before) return board;
    return moveZoneEdge(board, r.index, handle.index, {
      x: pos.x - before.at.x,
      y: pos.y - before.at.y,
    });
  }

  if (r.kind === 'track') {
    const t = board.tracks[r.index];
    if (!t) return board;
    const next = handle.index === SEG_START ? { start: pos } : { end: pos };
    return {
      ...board,
      tracks: board.tracks.map((x, i) =>
        i === r.index ? { ...x, ...next, source: { kind: 'list', items: [] } } : x,
      ),
    };
  }

  if (r.kind === 'arc') {
    const a = board.arcs[r.index];
    if (!a) return board;
    const next =
      handle.index === ARC_START
        ? { start: pos }
        : handle.index === ARC_MID
          ? { mid: pos }
          : { end: pos };
    return {
      ...board,
      arcs: board.arcs.map((x, i) =>
        i === r.index ? { ...x, ...next, source: { kind: 'list', items: [] } } : x,
      ),
    };
  }

  if (r.kind === 'barcode') return dragBarcodeHandle(board, r.index, handle, pos);

  if (r.kind === 'dimension') {
    const d = board.dimensions[r.index];
    if (!d) return board;
    const next = dragDimension(d, handle, constrainedDragPosition(d, handle, pos));
    return {
      ...board,
      dimensions: board.dimensions.map((x, i) =>
        i === r.index ? { ...next, source: { kind: 'list', items: [] } } : x,
      ),
    };
  }

  if (r.kind !== 'shape') return board;

  const s = board.shapes[r.index];
  if (!s) return board;

  if (s.kind === 'line' && s.start && s.end) {
    return withShape(board, r.index, handle.index === SEG_START ? { start: pos } : { end: pos });
  }

  if (s.kind === 'rect' && s.start && s.end) {
    const c = rectCorners(s.start, s.end);

    if (handle.kind === 'point' && handle.index === RECT_CENTER) {
      // The centre handle moves the whole rectangle rather than resizing it.
      const centre = mid(c.topLeft, c.botRight);
      const d = { x: pos.x - centre.x, y: pos.y - centre.y };
      return withShape(board, r.index, { start: add(s.start, d), end: add(s.end, d) });
    }

    if (handle.kind === 'point') {
      if (handle.index > RECT_BOTLEFT) return board;
      const box = clampDraggedCorner(c, handle.index, pos);
      return withShape(board, r.index, { start: box.topLeft, end: box.botRight });
    }

    // An edge drag moves only the coordinate that edge controls; the other
    // stays, which is what keeps the rectangle axis-aligned.
    let { topLeft, botRight } = { topLeft: c.topLeft, botRight: c.botRight };
    if (handle.index === RECT_TOP)
      topLeft = { ...topLeft, y: Math.min(pos.y, botRight.y - MIN_RECT_SIZE) };
    else if (handle.index === RECT_BOT)
      botRight = { ...botRight, y: Math.max(pos.y, topLeft.y + MIN_RECT_SIZE) };
    else if (handle.index === RECT_LEFT)
      topLeft = { ...topLeft, x: Math.min(pos.x, botRight.x - MIN_RECT_SIZE) };
    else if (handle.index === RECT_RIGHT)
      botRight = { ...botRight, x: Math.max(pos.x, topLeft.x + MIN_RECT_SIZE) };
    else return board;

    return withShape(board, r.index, { start: topLeft, end: botRight });
  }

  if (s.kind === 'circle') {
    const centre = s.center ?? s.start;
    if (!centre || !s.end) return board;

    if (handle.index === CIRC_CENTER) {
      // Moving the centre carries the radius point, or the circle would resize
      // as it was dragged.
      const d = { x: pos.x - centre.x, y: pos.y - centre.y };
      return withShape(board, r.index, { center: pos, start: pos, end: add(s.end, d) });
    }

    return withShape(board, r.index, { end: pos });
  }

  if (s.kind === 'arc' && s.start && s.mid && s.end) {
    const next =
      handle.index === ARC_START
        ? { start: pos }
        : handle.index === ARC_MID
          ? { mid: pos }
          : { end: pos };
    return withShape(board, r.index, next);
  }

  if (s.kind === 'poly' && s.pts && s.pts.length >= 2) {
    const pts = [...s.pts];

    if (handle.kind === 'point') {
      if (handle.index < 0 || handle.index >= pts.length) return board;
      pts[handle.index] = pos;
      return withShape(board, r.index, { pts });
    }

    // The edge carries both of its ends by the shift of its midpoint.
    const i = handle.index;
    const j = (i + 1) % pts.length;
    if (i < 0 || i >= pts.length) return board;
    const before = mid(pts[i]!, pts[j]!);
    const d = { x: pos.x - before.x, y: pos.y - before.y };
    pts[i] = add(pts[i]!, d);
    pts[j] = add(pts[j]!, d);
    return withShape(board, r.index, { pts });
  }

  return board;
}

/**
 * The handles a dimension carries, in upstream's own point order.
 * Counterparts: the four `MakePoints` in `ALIGNED_DIMENSION_POINT_EDIT_BEHAVIOR`,
 * `DIM_CENTER_POINT_EDIT_BEHAVIOR`, `DIM_RADIAL_POINT_EDIT_BEHAVIOR` and
 * `DIM_LEADER_POINT_EDIT_BEHAVIOR` (pcb_point_editor.cpp:1195-1605).
 *
 * All of them are `EDIT_POINT`s — a dimension has no `EDIT_LINE` — so they all
 * draw as squares. Which ones exist is the kind's signature: five for the two
 * with a crossbar, four for a radial (it has a knee), three for a leader, and
 * two for a centre mark, which is only a cross through a point.
 */
function dimensionHandles(d: PcbDimension): BoardEditHandle[] {
  const out: BoardEditHandle[] = [pt('point', DIM_START, d.start), pt('point', DIM_END, d.end)];

  if (d.kind === 'center') return out;

  if (d.text) out.push(pt('point', DIM_TEXT, d.text.at));

  if (d.kind === 'radial') {
    out.push(pt('point', DIM_KNEE, radialKnee(d)));
    return out;
  }

  if (d.kind === 'leader') return out;

  const bar = dimensionCrossbar(d);
  if (bar) {
    out.push(pt('point', DIM_CROSSBARSTART, bar.start), pt('point', DIM_CROSSBAREND, bar.end));
  }
  return out;
}

/**
 * The `EDIT_CONSTRAINT` on the grabbed handle, applied to the raw cursor.
 *
 * Upstream sets these in `MakePoints` and rebuilds them inside `UpdateItem`
 * whenever a feature point moves, which is the same thing as deriving them from
 * the item's current geometry each time — so that is what happens here.
 *
 * - A **centre** mark's end is `EC_45DEGREE` off its start, which is why its
 *   cross is always square or a true diagonal.
 * - An **aligned** crossbar end is `EC_LINE` along its own extension line, so
 *   dragging it changes the height and nothing else. Orthogonal has no such
 *   constraint: its handles move freely and the update picks an axis.
 * - A **radial** knee is `EC_LINE` along the radius, and its text is
 *   `EC_45DEGREE` off the knee. A **leader**'s text is `EC_45DEGREE` off its
 *   end.
 */
function constrainedDragPosition(d: PcbDimension, handle: BoardEditHandle, pos: Vec2): Vec2 {
  if (handle.kind !== 'point') return pos;

  // `EC_45DEGREE::Apply`: `constrainer + GetVectorSnapped45( pos - constrainer )`.
  const snap45 = (constrainer: Vec2): Vec2 =>
    add(constrainer, vectorSnapped45(sub(pos, constrainer)));
  // `EC_LINE::Apply`: the perpendicular projection onto the line through
  // `constrainer` along `line`, which `SEG::LineProject` is.
  const online = (constrainer: Vec2, through: Vec2): Vec2 =>
    same(constrainer, through) ? pos : segLineProject({ a: constrainer, b: through }, pos);

  if (d.kind === 'center') {
    return handle.index === DIM_END ? snap45(d.start) : pos;
  }

  if (d.kind === 'leader') {
    return handle.index === DIM_TEXT ? snap45(d.end) : pos;
  }

  if (d.kind === 'radial') {
    if (handle.index === DIM_KNEE) return online(d.end, d.start);
    if (handle.index === DIM_TEXT) return snap45(radialKnee(d));
    return pos;
  }

  if (d.kind === 'aligned') {
    const bar = dimensionCrossbar(d);
    if (!bar) return pos;
    // `EC_LINE( Point( DIM_CROSSBARSTART ), Point( DIM_START ) )` — the line
    // runs from the feature point out through the crossbar end above it.
    if (handle.index === DIM_CROSSBARSTART) return online(d.start, bar.start);
    if (handle.index === DIM_CROSSBAREND) return online(d.end, bar.end);
  }

  return pos;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const withText = (d: PcbDimension, at: Vec2): PcbDimension =>
  d.text ? { ...d, text: { ...d.text, at } } : d;

/**
 * `UpdateItem` for whichever behaviour this dimension has.
 *
 * Every branch ends in `m_dimension.Update()` — {@link updateDimension} — so a
 * dragged handle re-derives the label and, outside MANUAL mode, puts it back on
 * the crossbar. Dragging the *text* handle is the one thing that switches the
 * position mode to MANUAL: "Force manual mode if we weren't already in it".
 */
function dragDimension(d: PcbDimension, handle: BoardEditHandle, pos: Vec2): PcbDimension {
  if (handle.kind !== 'point') return d;
  const i = handle.index;

  if (d.kind === 'center') {
    return updateDimension(i === DIM_START ? { ...d, start: pos } : { ...d, end: pos });
  }

  if (d.kind === 'leader') {
    if (i === DIM_START) return updateDimension({ ...d, start: pos });
    if (i === DIM_END) {
      // The label rides along with the elbow it hangs off.
      const delta = sub(pos, d.end);
      const moved = withText(d, d.text ? add(d.text.at, delta) : pos);
      return updateDimension({ ...moved, end: pos });
    }
    if (i === DIM_TEXT) return updateDimension(withText(d, pos));
    return d;
  }

  if (d.kind === 'radial') {
    if (i === DIM_START) return updateDimension({ ...d, start: pos });
    if (i === DIM_END) {
      // "VECTOR2I kneeDelta = m_dimension.GetKnee() - oldKnee" — the label keeps
      // its offset from the knee rather than from the measured point.
      const oldKnee = radialKnee(d);
      const moved: PcbDimension = { ...d, end: pos };
      const delta = sub(radialKnee(moved), oldKnee);
      return updateDimension(withText(moved, d.text ? add(d.text.at, delta) : pos));
    }
    if (i === DIM_KNEE) {
      const oldKnee = radialKnee(d);
      const moved: PcbDimension = {
        ...d,
        leaderLength: Math.round(Math.hypot(pos.x - d.end.x, pos.y - d.end.y)),
      };
      const delta = sub(radialKnee(moved), oldKnee);
      return updateDimension(withText(moved, d.text ? add(d.text.at, delta) : pos));
    }
    if (i === DIM_TEXT) return updateDimension(withText(d, pos));
    return d;
  }

  // Aligned and orthogonal.
  if (i === DIM_START) return updateDimension({ ...d, start: pos });
  if (i === DIM_END) return updateDimension({ ...d, end: pos });
  if (i === DIM_TEXT) {
    return updateDimension({
      ...withText(d, pos),
      style: { ...d.style, textPositionMode: 2 }, // DIM_TEXT_POSITION::MANUAL
    });
  }
  if (i === DIM_CROSSBARSTART || i === DIM_CROSSBAREND) {
    return updateDimension(dragCrossbar(d, i, pos));
  }
  return d;
}

/**
 * The crossbar handles, which set the height rather than a point.
 *
 * The two kinds read the cursor completely differently and it is worth saying
 * why. An **aligned** dimension's height is a signed distance along its own
 * normal, so the magnitude is the length of the feature line and the sign comes
 * from which side of the measurement the cursor is on — a cross product. An
 * **orthogonal** one's height is one raw axis of the cursor, and which axis is
 * re-picked only while the cursor is outside the feature box, exactly as the
 * drawing tool's `SET_HEIGHT` does.
 */
function dragCrossbar(d: PcbDimension, index: number, pos: Vec2): PcbDimension {
  if (d.kind === 'aligned') {
    // `featureLine` is measured from whichever feature point this handle sits
    // above, so the two handles agree on the height they produce.
    const from = index === DIM_CROSSBARSTART ? d.start : d.end;
    const featureLine = sub(pos, from);
    const crossBar = sub(d.end, d.start);
    const cross = featureLine.x * crossBar.y - featureLine.y * crossBar.x;
    const len = Math.round(Math.hypot(featureLine.x, featureLine.y));
    return { ...d, height: cross > 0 ? -len : len };
  }

  // `BOX2I bounds( GetStart(), GetEnd() - GetStart() )` again — unnormalised,
  // so its right and bottom edges carry the sign of the feature vector while
  // `Contains()` does not. Same reading as `setHeightFromCursor`.
  const left = d.start.x;
  const right = d.end.x;
  const top = d.start.y;
  const bottom = d.end.y;
  const inside =
    pos.x >= Math.min(left, right) &&
    pos.x <= Math.max(left, right) &&
    pos.y >= Math.min(top, bottom) &&
    pos.y <= Math.max(top, bottom);

  let vert = d.orientation === 1;

  if (!inside) {
    // "Find vector from nearest dimension point to edit position" — the
    // fallback compares against whichever feature point is closer, unlike the
    // drawing tool, which compares against the box centre.
    const dA = sub(pos, d.start);
    const dB = sub(pos, d.end);
    // `( directionA < directionB ) ? directionA : directionB`, and `VECTOR2`'s
    // `operator<` compares `*this * *this` — squared lengths (vector2d.h:578).
    // Strictly less, so an exact tie takes the *end* point's vector.
    const sq = (v: Vec2): number => v.x * v.x + v.y * v.y;
    const dir = sq(dA) < sq(dB) ? dA : dB;

    if (right - left === 0) vert = true;
    else if (bottom - top === 0) vert = false;
    else if (pos.x > left && pos.x < right) vert = false;
    else if (pos.y > top && pos.y < bottom) vert = true;
    else vert = Math.abs(dir.y) < Math.abs(dir.x);
  }

  const featureLine = sub(pos, d.start);
  return { ...d, orientation: vert ? 1 : 0, height: vert ? featureLine.x : featureLine.y };
}

/** The arc's centre, for drawing the radius while an arc handle is dragged. */
export function arcHandleCentre(board: Board, id: string): Vec2 | null {
  const r = parseBoardItemId(id);
  if (r?.kind === 'arc') {
    const a = board.arcs[r.index];
    return a ? arcCenter(a.start, a.mid, a.end) : null;
  }
  if (r?.kind === 'shape') {
    const s = board.shapes[r.index];
    if (s?.kind === 'arc' && s.start && s.mid && s.end) return arcCenter(s.start, s.mid, s.end);
  }
  return null;
}

/** Every item id the point editor can offer handles for, for a whole board. */
export function editablePointItems(board: Board): string[] {
  const out: string[] = [];
  const push = (kind: string, n: number): void => {
    for (let i = 0; i < n; i++) {
      const id = boardItemId(kind as Parameters<typeof boardItemId>[0], i);
      if (boardEditHandles(board, id).length > 0) out.push(id);
    }
  };
  push('track', board.tracks.length);
  push('arc', board.arcs.length);
  push('shape', board.shapes.length);
  push('zone', board.zones.length);
  push('dimension', board.dimensions.length);
  return out;
}
