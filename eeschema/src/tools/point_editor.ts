// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Point editor: the handles a single selected item carries, and what dragging
 * one does to it. Counterpart: `eeschema/tools/sch_point_editor.cpp`
 * (SCH_POINT_EDITOR and its POINT_EDIT_BEHAVIORs) plus the shared behaviors in
 * `common/tool/point_editor_behavior.cpp`.
 *
 * Upstream keeps an EDIT_POINTS for the selected item: an EDIT_POINT per corner
 * or vertex, and an EDIT_LINE per edge whose position is the edge midpoint and
 * whose SetPosition shifts both of its ends. Grabbing one and moving it runs the
 * behavior's UpdateItem, which reads *all* the points back and rewrites the item
 * from them. That indirection is why a rectangle's corner can push its
 * neighbours: the neighbours are points too.
 *
 * We keep the same shape, minus the mutable EDIT_POINTS: `editHandles` derives
 * the handles from the document, and `dragHandle` takes the grabbed handle and
 * its new position and returns the whole reshaped document. Recomputing rather
 * than mutating means a drag is a pure function of (document, handle, cursor),
 * so the preview during a drag and the committed result cannot disagree.
 *
 * Covered here: wires, buses, graphic polylines, rectangles, circles, arcs,
 * ellipses, elliptical arcs, table cells, text boxes, sheets and images. Rule
 * areas edit through their polyline. Arcs live in arc_edit.ts, since what a drag
 * means there depends on the ARC_EDIT_MODE preference and takes real geometry.
 *
 * Note that a sheet-level `(polyline …)` is read into `lines`, not `graphics`
 * (only rectangles, circles and arcs become graphics), so the vertex handles for
 * one are on the line path.
 */

import type {
  Schematic,
  SchSheet,
  SchLine,
  SchTextBox,
  SchImage,
  SheetPin,
  LibGraphic,
  Vec2,
} from '../types.js';
import { refId } from './hittest.js';
import { resolveCell } from './table_cells.js';
import { resizeCellEdge } from './table_layout.js';
import { sheetPinBBox } from './bbox.js';
import { imageSizeIU } from './image_size.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { EditCommand } from './command.js';
import {
  ArcEditMode,
  arcState,
  arcMidOf,
  arcFromState,
  setArcGeometry,
  editArcCenterKeepEndpoints,
  editArcEndpointKeepCenter,
  editArcEndpointKeepRadius,
  editArcEndpointKeepTangent,
  editArcMidKeepCenter,
  editArcMidKeepEndpoints,
} from './arc_edit.js';

/** A square handle on a corner or vertex (EDIT_POINT), or a circle at an edge
 *  midpoint (EDIT_LINE). */
export type HandleKind = 'point' | 'line';

export interface EditHandle {
  readonly kind: HandleKind;
  /** Index within the item's handle list of that kind; the identity a drag carries. */
  readonly index: number;
  readonly at: Vec2;
}

/** The item the handles belong to: which array, and where in it. */
export interface PointEditTarget {
  readonly kind: 'sheet' | 'line' | 'graphic' | 'textbox' | 'image' | 'tablecell';
  readonly index: number;
  /** Table cells only: the cell's index within `doc.tables[index]`. */
  readonly cell?: number;
}

// Point indices, named as upstream names them (sch_point_editor.cpp).
const RECT_TOPLEFT = 0;
const RECT_TOPRIGHT = 1;
const RECT_BOTLEFT = 2;
const RECT_BOTRIGHT = 3;
const RECT_CENTER = 4;
const RECT_TOP = 0;
const RECT_RIGHT = 1;
const RECT_BOT = 2;
const RECT_LEFT = 3;
const LINE_START = 0;
const LINE_END = 1;
const CIRC_CENTER = 0;
const CIRC_END = 1;
/** An ellipse's two radius handles, one on each axis (SHAPE_T::ELLIPSE). */
const ELLIPSE_MAJOR = 1;
const ELLIPSE_MINOR = 2;
const ARC_START = 0;
const ARC_MID = 1;
const ARC_END = 2;
const ARC_CENTER = 3;
/** EDA_TABLECELL_POINT_EDIT_BEHAVIOR's two points. */
const CELL_COL_WIDTH = 0;
const CELL_ROW_HEIGHT = 1;

/**
 * MIN_SHEET_WIDTH / MIN_SHEET_HEIGHT (sch_sheet.h), in mils. Exported because
 * `sizeSheet` holds a sheet to them while it is being *drawn* too, not only
 * while its handles are dragged.
 */
export const MIN_SHEET_WIDTH = mmToIU(500 * 0.0254);
export const MIN_SHEET_HEIGHT = mmToIU(150 * 0.0254);
/** RECTANGLE_POINT_EDIT_BEHAVIOR floors every rectangle at one mil. */
const ONE_MIL = mmToIU(0.0254);

const pt = (kind: HandleKind, index: number, at: Vec2): EditHandle => ({ kind, index, at });
const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The item `id` refers to, if it is one the point editor can edit.
 *
 * Upstream gates on `pointEditorTypes`; a selection of anything else (or of more
 * than one item) simply has no points.
 */
export function pointEditTarget(doc: Schematic, id: string): PointEditTarget | null {
  const find = <T extends { uuid?: string }>(
    xs: readonly T[] | undefined,
    kind: Parameters<typeof refId>[0],
  ): number => (xs ?? []).findIndex((x, i) => refId(kind, x.uuid, i) === id);

  // A table cell (SCH_TABLECELL_POINT_EDIT_BEHAVIOR). Checked first: a cell id
  // contains its table's id, so anything matching it is unambiguous.
  const cell = resolveCell(doc, id);
  if (cell) return { kind: 'tablecell', index: cell.tableIndex, cell: cell.cellIndex };

  const sheet = find(doc.sheets, 'sheet');
  if (sheet !== -1) return { kind: 'sheet', index: sheet };
  const textbox = find(doc.textBoxes, 'textbox');
  if (textbox !== -1) return { kind: 'textbox', index: textbox };
  // Lines, but only *graphic* ones. `pointEditorTypes` lists
  // `SCH_ITEM_LOCATE_GRAPHIC_LINE_T`, not `SCH_LINE_T`, and
  // `SCH_LINE::IsType` matches that pseudo-type only on `LAYER_NOTES`:
  //
  //     if ( scanType == SCH_ITEM_LOCATE_GRAPHIC_LINE_T && m_layer == LAYER_NOTES )
  //         return true;
  //
  // So a selected wire or bus gets no endpoint handles at all upstream — it is
  // reshaped by dragging it, not by grabbing a grip. We showed them on every
  // line, which put a pair of boxes on the ends of every selected wire.
  //
  // `LINE_POINT_EDIT_BEHAVIOR` agrees from the other side: the neighbour it
  // looks for to drag along skips anything that is not on LAYER_NOTES.
  const line = find(doc.lines, 'line');
  if (line !== -1)
    return doc.lines[line]!.kind === 'polyline' ? { kind: 'line', index: line } : null;
  const image = find(doc.images, 'image');
  if (image !== -1) return { kind: 'image', index: image };
  // Graphics carry no uuid of their own, so they are addressed by index.
  const graphic = (doc.graphics ?? []).findIndex((_, i) => refId('graphic', undefined, i) === id);
  if (graphic !== -1) {
    // Text has a position but no geometry to reshape, so it gets no points.
    return doc.graphics[graphic]!.kind === 'text' ? null : { kind: 'graphic', index: graphic };
  }
  return null;
}

// ----- rectangles ------------------------------------------------------------
//
// Rectangles, text boxes and sheets share RECTANGLE_POINT_EDIT_BEHAVIOR's four
// corners and four edge lines. They differ only in their minimum size and in
// what UpdateItem writes the result back into.

interface Corners {
  topLeft: Vec2;
  topRight: Vec2;
  botLeft: Vec2;
  botRight: Vec2;
}

const cornersOf = (topLeft: Vec2, botRight: Vec2): Corners => ({
  topLeft: { ...topLeft },
  topRight: { x: botRight.x, y: topLeft.y },
  botLeft: { x: topLeft.x, y: botRight.y },
  botRight: { ...botRight },
});

/** The corner and edge handles of a box, with the centre point when `center`. */
function rectHandles(topLeft: Vec2, botRight: Vec2, center: boolean): EditHandle[] {
  const c = cornersOf(topLeft, botRight);
  const out = [
    pt('point', RECT_TOPLEFT, c.topLeft),
    pt('point', RECT_TOPRIGHT, c.topRight),
    pt('point', RECT_BOTLEFT, c.botLeft),
    pt('point', RECT_BOTRIGHT, c.botRight),
  ];
  // A sheet has no centre handle; a shape and a text box do.
  if (center) out.push(pt('point', RECT_CENTER, mid(c.topLeft, c.botRight)));
  out.push(
    pt('line', RECT_TOP, mid(c.topLeft, c.topRight)),
    pt('line', RECT_RIGHT, mid(c.topRight, c.botRight)),
    pt('line', RECT_BOT, mid(c.botRight, c.botLeft)),
    pt('line', RECT_LEFT, mid(c.botLeft, c.topLeft)),
  );
  return out;
}

/**
 * Move the grabbed handle to `pos`, as the drag itself does before UpdateItem
 * runs. A corner point follows the cursor; an edge line is under EC_PERPLINE, so
 * it only moves along its own normal, carrying both of its ends.
 */
function moveHandle(c: Corners, h: EditHandle, pos: Vec2): void {
  if (h.kind === 'point') {
    if (h.index === RECT_TOPLEFT) c.topLeft = { ...pos };
    else if (h.index === RECT_TOPRIGHT) c.topRight = { ...pos };
    else if (h.index === RECT_BOTLEFT) c.botLeft = { ...pos };
    else if (h.index === RECT_BOTRIGHT) c.botRight = { ...pos };
    return;
  }
  if (h.index === RECT_TOP) {
    c.topLeft = { ...c.topLeft, y: pos.y };
    c.topRight = { ...c.topRight, y: pos.y };
  } else if (h.index === RECT_BOT) {
    c.botLeft = { ...c.botLeft, y: pos.y };
    c.botRight = { ...c.botRight, y: pos.y };
  } else if (h.index === RECT_LEFT) {
    c.topLeft = { ...c.topLeft, x: pos.x };
    c.botLeft = { ...c.botLeft, x: pos.x };
  } else if (h.index === RECT_RIGHT) {
    c.topRight = { ...c.topRight, x: pos.x };
    c.botRight = { ...c.botRight, x: pos.x };
  }
}

/**
 * RECTANGLE_POINT_EDIT_BEHAVIOR::PinEditedCorner. Clamp the dragged corner so it
 * cannot cross its opposite corner (leaving at least minWidth x minHeight), then
 * push the two corners that share an edge with it so the box stays a rectangle.
 * An edge drag only has to be clamped: it moves both of its ends already.
 */
function pinEditedCorner(c: Corners, h: EditHandle, minWidth: number, minHeight: number): void {
  if (h.kind === 'point') {
    if (h.index === RECT_TOPLEFT) {
      c.topLeft = {
        x: Math.min(c.topLeft.x, c.botRight.x - minWidth),
        y: Math.min(c.topLeft.y, c.botRight.y - minHeight),
      };
      c.topRight = { ...c.topRight, y: c.topLeft.y };
      c.botLeft = { ...c.botLeft, x: c.topLeft.x };
    } else if (h.index === RECT_TOPRIGHT) {
      c.topRight = {
        x: Math.max(c.topRight.x, c.botLeft.x + minWidth),
        y: Math.min(c.topRight.y, c.botLeft.y - minHeight),
      };
      c.topLeft = { ...c.topLeft, y: c.topRight.y };
      c.botRight = { ...c.botRight, x: c.topRight.x };
    } else if (h.index === RECT_BOTLEFT) {
      c.botLeft = {
        x: Math.min(c.botLeft.x, c.topRight.x - minWidth),
        y: Math.max(c.botLeft.y, c.topRight.y + minHeight),
      };
      c.botRight = { ...c.botRight, y: c.botLeft.y };
      c.topLeft = { ...c.topLeft, x: c.botLeft.x };
    } else if (h.index === RECT_BOTRIGHT) {
      c.botRight = {
        x: Math.max(c.botRight.x, c.topLeft.x + minWidth),
        y: Math.max(c.botRight.y, c.topLeft.y + minHeight),
      };
      c.botLeft = { ...c.botLeft, y: c.botRight.y };
      c.topRight = { ...c.topRight, x: c.botRight.x };
    }
    return;
  }
  if (h.index === RECT_TOP)
    c.topLeft = { ...c.topLeft, y: Math.min(c.topLeft.y, c.botRight.y - minHeight) };
  else if (h.index === RECT_LEFT)
    c.topLeft = { ...c.topLeft, x: Math.min(c.topLeft.x, c.botRight.x - minWidth) };
  else if (h.index === RECT_BOT)
    c.botRight = { ...c.botRight, y: Math.max(c.botRight.y, c.topLeft.y + minHeight) };
  else if (h.index === RECT_RIGHT)
    c.botRight = { ...c.botRight, x: Math.max(c.botRight.x, c.topLeft.x + minWidth) };
}

const isCorner = (h: EditHandle): boolean => h.kind === 'point' && h.index <= RECT_BOTRIGHT;

/**
 * The box a reshape produces, as RECTANGLE_POINT_EDIT_BEHAVIOR::UpdateItem
 * writes it: a corner sets both position and end, the centre translates the
 * whole box, and each edge sets only its own coordinate.
 */
function reshapedBox(
  start: Vec2,
  end: Vec2,
  h: EditHandle,
  pos: Vec2,
  minSize: Vec2,
): { start: Vec2; end: Vec2 } {
  if (h.kind === 'point' && h.index === RECT_CENTER) {
    const delta = { x: pos.x - (start.x + end.x) / 2, y: pos.y - (start.y + end.y) / 2 };
    return {
      start: { x: start.x + delta.x, y: start.y + delta.y },
      end: { x: end.x + delta.x, y: end.y + delta.y },
    };
  }
  const c = cornersOf(start, end);
  moveHandle(c, h, pos);
  pinEditedCorner(c, h, Math.max(ONE_MIL, minSize.x), Math.max(ONE_MIL, minSize.y));

  if (isCorner(h)) return { start: c.topLeft, end: c.botRight };
  if (h.index === RECT_TOP) return { start: { ...start, y: c.topLeft.y }, end };
  if (h.index === RECT_LEFT) return { start: { ...start, x: c.topLeft.x }, end };
  if (h.index === RECT_BOT) return { start, end: { ...end, y: c.botRight.y } };
  if (h.index === RECT_RIGHT) return { start, end: { ...end, x: c.botRight.x } };
  return { start, end };
}

// ----- sheets ----------------------------------------------------------------

/**
 * SCH_SHEET::bumpToNextGrid, which rounds to the 50 mil grid away from zero in
 * `direction`. Used only to pad the pin extents that floor a sheet's size.
 */
function bumpToNextGrid(value: number, direction: number): number {
  const gridSize = mmToIU(50 * 0.0254);
  const base = Math.trunc(value / gridSize);
  const excess = Math.abs(value % gridSize);
  if (direction > 0) return (base + 1) * gridSize;
  if (excess > 0) return base * gridSize;
  return (base - 1) * gridSize;
}

/** Sheet-pin sides, from the file's angle encoding (0 right, 90 top, 180 left, 270 bottom). */
const sideOf = (angle: number): 'right' | 'top' | 'left' | 'bottom' =>
  angle === 90 ? 'top' : angle === 180 ? 'left' : angle === 270 ? 'bottom' : 'right';

/**
 * SCH_SHEET::GetMinWidth / GetMinHeight: a sheet cannot be shrunk past the pins
 * on the two edges perpendicular to the drag, nor below MIN_SHEET_WIDTH /
 * MIN_SHEET_HEIGHT. Pins are measured by their full bounding box, flag and text
 * together, exactly as upstream does.
 */
function sheetMinSize(sh: SchSheet, fromLeft: boolean, fromTop: boolean): Vec2 {
  let pinsLeft = sh.at.x + sh.size.w;
  let pinsRight = sh.at.x;
  let pinsTop = sh.at.y + sh.size.h;
  let pinsBottom = sh.at.y;

  for (const p of sh.pins) {
    const side = sideOf(p.angle);
    const box = sheetPinBBox(p);
    // Pins on the top and bottom edges hold the width; those on the left and
    // right hold the height.
    if (side === 'top' || side === 'bottom') {
      pinsLeft = Math.min(pinsLeft, box.minX);
      pinsRight = Math.max(pinsRight, box.maxX);
    } else {
      pinsTop = Math.min(pinsTop, box.minY);
      pinsBottom = Math.max(pinsBottom, box.maxY);
    }
  }
  pinsLeft = bumpToNextGrid(pinsLeft, -1);
  pinsRight = bumpToNextGrid(pinsRight, 1);
  pinsTop = bumpToNextGrid(pinsTop, -1);
  pinsBottom = bumpToNextGrid(pinsBottom, 1);

  const minWidth =
    pinsLeft >= pinsRight ? 0 : fromLeft ? pinsRight - sh.at.x : sh.at.x + sh.size.w - pinsLeft;
  const minHeight =
    pinsTop >= pinsBottom ? 0 : fromTop ? pinsBottom - sh.at.y : sh.at.y + sh.size.h - pinsTop;

  return {
    x: Math.max(minWidth, MIN_SHEET_WIDTH),
    y: Math.max(minHeight, MIN_SHEET_HEIGHT),
  };
}

/**
 * SCH_SHEET_PIN::ConstrainOnEdge(pos, false): keep the pin on its own edge of
 * the resized sheet, and clamp its along-edge coordinate into the new bounds.
 */
function constrainPinOnEdge(pin: SheetPin, at: Vec2, size: { w: number; h: number }): SheetPin {
  const left = at.x;
  const right = at.x + size.w;
  const top = at.y;
  const bottom = at.y + size.h;
  switch (sideOf(pin.angle)) {
    case 'left':
      return { ...pin, at: { x: left, y: Math.min(Math.max(pin.at.y, top), bottom) } };
    case 'right':
      return { ...pin, at: { x: right, y: Math.min(Math.max(pin.at.y, top), bottom) } };
    case 'top':
      return { ...pin, at: { x: Math.min(Math.max(pin.at.x, left), right), y: top } };
    case 'bottom':
      return { ...pin, at: { x: Math.min(Math.max(pin.at.x, left), right), y: bottom } };
  }
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * Resize a sheet and bring everything anchored to it along.
 *
 * SHEET_POINT_EDIT_BEHAVIOR::UpdateItem calls SetPositionIgnoringPins (fields
 * follow the sheet, pins do not, because Resize is about to place them) then
 * Resize, then walks the no-connects and wires it recorded at grab time and
 * moves them onto their pin's new position.
 */
function resizeSheet(doc: Schematic, index: number, h: EditHandle, pos: Vec2): Schematic {
  const sh = doc.sheets[index];
  if (!sh) return doc;

  const start = sh.at;
  const end = { x: sh.at.x + sh.size.w, y: sh.at.y + sh.size.h };
  // Which sides the drag is pulling decides which pins floor the new size: a
  // right or bottom drag measures from the far edge, so `fromLeft` / `fromTop`
  // follow the corner being moved (an edge line counts as its own corner).
  const fromLeft =
    (h.kind === 'point' && (h.index === RECT_TOPRIGHT || h.index === RECT_BOTRIGHT)) ||
    (h.kind === 'line' && h.index === RECT_RIGHT);
  const fromTop =
    (h.kind === 'point' && (h.index === RECT_BOTLEFT || h.index === RECT_BOTRIGHT)) ||
    (h.kind === 'line' && h.index === RECT_BOT);

  const box = reshapedBox(start, end, h, pos, sheetMinSize(sh, fromLeft, fromTop));
  const newAt = box.start;
  const newSize = { w: box.end.x - box.start.x, h: box.end.y - box.start.y };
  if (samePoint(newAt, sh.at) && newSize.w === sh.size.w && newSize.h === sh.size.h) return doc;

  const delta = { x: newAt.x - sh.at.x, y: newAt.y - sh.at.y };
  // The no-connect and the wire end sitting on each pin, recorded before the
  // pins move so they can be put back on top of them afterwards.
  const anchored = sh.pins.map((p) => ({
    from: p.at,
    to: constrainPinOnEdge(p, newAt, newSize).at,
  }));

  const resized: SchSheet = {
    ...sh,
    at: newAt,
    size: newSize,
    // SetPositionIgnoringPins moves the fields with the sheet.
    fields: sh.fields.map((f) =>
      f.at ? { ...f, at: { x: f.at.x + delta.x, y: f.at.y + delta.y } } : f,
    ),
    pins: sh.pins.map((p) => constrainPinOnEdge(p, newAt, newSize)),
  };

  const movedTo = (p: Vec2): Vec2 | null => {
    const a = anchored.find((x) => samePoint(x.from, p));
    return a && !samePoint(a.from, a.to) ? a.to : null;
  };

  const out: Schematic = { ...doc, sheets: doc.sheets.map((s, i) => (i === index ? resized : s)) };

  let noConnects = out.noConnects;
  if (noConnects.some((nc) => movedTo(nc.at)))
    noConnects = noConnects.map((nc) => {
      const to = movedTo(nc.at);
      return to ? { ...nc, at: to } : nc;
    });

  let lines = out.lines;
  if (
    lines.some(
      (l) => (l.kind === 'wire' || l.kind === 'bus') && (movedTo(l.start) || movedTo(l.end)),
    )
  )
    lines = lines.map((l) => {
      if (l.kind !== 'wire' && l.kind !== 'bus') return l;
      const s = movedTo(l.start);
      const e = movedTo(l.end);
      return s || e ? { ...l, start: s ?? l.start, end: e ?? l.end } : l;
    });

  return { ...out, noConnects, lines };
}

// ----- handles and drags per item kind ---------------------------------------

/** The handles a graphic shape carries, by kind. */
function graphicHandles(g: LibGraphic): EditHandle[] {
  switch (g.kind) {
    case 'rectangle':
      return rectHandles(g.start, g.end, true);
    case 'circle':
      // EDA_CIRCLE_POINT_EDIT_BEHAVIOR: the centre, and GetEnd(), which sits one
      // radius to the +x side of it.
      return [
        pt('point', CIRC_CENTER, g.center),
        pt('point', CIRC_END, { x: g.center.x + g.radius, y: g.center.y }),
      ];
    case 'ellipse':
    case 'ellipse_arc': {
      // The centre, and one handle per axis at the end of each radius, turned by
      // the ellipse's rotation. An `EDA_SHAPE` ellipse is centre + two radii +
      // a tilt, so those three points describe it completely.
      const rad = (g.rotation * Math.PI) / 180;
      const along = (r: number, extra: number): Vec2 => ({
        x: g.center.x + r * Math.cos(rad + extra),
        y: g.center.y + r * Math.sin(rad + extra),
      });
      return [
        pt('point', CIRC_CENTER, g.center),
        pt('point', ELLIPSE_MAJOR, along(g.majorRadius, 0)),
        pt('point', ELLIPSE_MINOR, along(g.minorRadius, Math.PI / 2)),
      ];
    }
    case 'arc': {
      // EDA_ARC_POINT_EDIT_BEHAVIOR: start, mid, end, centre. The two indicator
      // lines from the centre are drawn, not grabbed, so they are not handles.
      const s = arcState(g.start, g.mid, g.end);
      return [
        pt('point', ARC_START, g.start),
        pt('point', ARC_MID, arcMidOf(s)),
        pt('point', ARC_END, g.end),
        pt('point', ARC_CENTER, s.center),
      ];
    }
    case 'bezier':
      // `EDA_BEZIER_POINT_EDIT_BEHAVIOR::MakePoints` — four handles, in file
      // order, and no edges to grab:
      //
      //     aPoints.AddPoint( m_bezier.GetStart() );
      //     aPoints.AddPoint( m_bezier.GetBezierC1() );
      //     aPoints.AddPoint( m_bezier.GetBezierC2() );
      //     aPoints.AddPoint( m_bezier.GetEnd() );
      //
      // (It then adds two *indicator* lines, start→C1 and C2→end, which are
      // drawn as leaders and never grabbed — the same refinement we leave out
      // for the arc's centre lines.)
      //
      // This is one handle per stored point, which is right only because the
      // four stored points *are* the control points. The bezier tool used to
      // flatten a quadratic into a twenty-five point polyline, and then this
      // put a handle on every one of those points.
      return g.points.map((p, i) => pt('point', i, p));
    case 'polyline': {
      // `EDA_POLYGON_POINT_EDIT_BEHAVIOR` -> `BuildForPolyOutline`, which adds a
      // handle per corner *and* an EDIT_LINE per edge:
      //
      //     for( auto iterator = aOutline.CIterateWithHoles(); iterator; iterator++ )
      //         aPoints.AddPoint( *iterator );
      //     ...
      //     for( int i = 0; i < cornersCount - 1; ++i )
      //         aPoints.AddLine( aPoints.Point( i ), aPoints.Point( i + 1 ) );
      //
      // and `EDIT_POINTS::ViewDraw` draws a point as a square and a line as a
      // circle at its midpoint, so a polygon shows both. Ours emitted the
      // corners only, which is why a rule area came up with squares and nothing
      // in between.
      const out = g.points.map((p, i) => pt('point', i, p));
      for (let i = 0; i + 1 < g.points.length; i++)
        out.push(pt('line', i, mid(g.points[i]!, g.points[i + 1]!)));
      return out;
    }
    case 'text':
      return [];
  }
}

/**
 * EDA_ARC_POINT_EDIT_BEHAVIOR::UpdateItem. Which point moved and which arc edit
 * mode is set together decide what the drag means; every combination is one of
 * the helpers in arc_edit.ts.
 */
function dragArc(
  g: Extract<LibGraphic, { kind: 'arc' }>,
  h: EditHandle,
  pos: Vec2,
  mode: ArcEditMode,
): { start: Vec2; mid: Vec2; end: Vec2 } | null {
  const cur = arcState(g.start, g.mid, g.end);
  const mid = arcMidOf(cur);

  // Upstream only reaches UpdateItem once a point has actually moved, and every
  // mode below decides what to do by comparing the incoming points against the
  // arc's own. Handing it a point that has not moved is therefore ambiguous:
  // the endpoint branches would read it as the *other* end being dragged and
  // re-derive both ends, nudging the arc by a rounding step. A drag frame that
  // did not move the grabbed point leaves the arc alone, and says so by
  // returning null so the caller can hand back the very same document.
  if (pos.x === h.at.x && pos.y === h.at.y) return null;

  if (h.index === ARC_CENTER) {
    if (mode === ArcEditMode.KeepEndpointsOrStartDirection) {
      return arcFromState({
        ...cur,
        center: editArcCenterKeepEndpoints(pos, cur.start, cur.end),
      });
    }
    // Both centre-keeping modes just move the whole arc.
    const d = { x: pos.x - cur.center.x, y: pos.y - cur.center.y };
    return setArcGeometry(
      { x: g.start.x + d.x, y: g.start.y + d.y },
      { x: mid.x + d.x, y: mid.y + d.y },
      { x: g.end.x + d.x, y: g.end.y + d.y },
    );
  }

  if (h.index === ARC_MID) {
    if (mode === ArcEditMode.KeepEndpointsOrStartDirection)
      return editArcMidKeepEndpoints(cur, cur.start, cur.end, pos);
    return arcFromState(editArcMidKeepCenter(cur.center, cur.start, cur.end, pos));
  }

  // A start or end drag: `pos` replaces that endpoint, the other stays put.
  const start = h.index === ARC_START ? pos : cur.start;
  const end = h.index === ARC_END ? pos : cur.end;
  switch (mode) {
    case ArcEditMode.KeepCenterAdjustAngleRadius:
      return arcFromState(editArcEndpointKeepCenter(cur, cur.center, start, end));
    case ArcEditMode.KeepCenterEndsAdjustAngle:
      return arcFromState(editArcEndpointKeepRadius(cur, cur.center, start, end));
    case ArcEditMode.KeepEndpointsOrStartDirection:
      return arcFromState(editArcEndpointKeepTangent(cur, cur.center, start, mid, end));
  }
}

function dragGraphic(g: LibGraphic, h: EditHandle, pos: Vec2, arcMode: ArcEditMode): LibGraphic {
  switch (g.kind) {
    case 'arc': {
      const moved = dragArc(g, h, pos, arcMode);
      return moved ? { ...g, ...moved } : g;
    }
    case 'rectangle': {
      const box = reshapedBox(g.start, g.end, h, pos, { x: 0, y: 0 });
      return { ...g, start: box.start, end: box.end };
    }
    case 'circle':
      // Dragging the centre moves the circle; dragging the end sets the radius
      // from the distance to the centre (EDA_SHAPE::SetEnd on a circle).
      if (h.index === CIRC_CENTER) return { ...g, center: { ...pos } };
      return { ...g, radius: Math.round(Math.hypot(pos.x - g.center.x, pos.y - g.center.y)) };
    case 'ellipse':
    case 'ellipse_arc': {
      if (h.index === CIRC_CENTER) return { ...g, center: { ...pos } };
      // Dragging a radius handle sets that radius from its distance to the
      // centre, the way the circle's end handle sets its radius.
      const r = Math.round(Math.hypot(pos.x - g.center.x, pos.y - g.center.y));
      return h.index === ELLIPSE_MAJOR
        ? { ...g, majorRadius: Math.max(1, r) }
        : { ...g, minorRadius: Math.max(1, r) };
    }
    case 'bezier':
      return { ...g, points: g.points.map((p, i) => (i === h.index ? { ...pos } : p)) };
    case 'polyline': {
      if (h.kind === 'point')
        return { ...g, points: g.points.map((p, i) => (i === h.index ? { ...pos } : p)) };
      // `EDIT_LINE::SetPosition` moves both ends so the midpoint lands on the
      // cursor, i.e. the edge slides as a unit. (Upstream then re-applies an
      // `EC_CONVERGING` constraint to the neighbouring edges; that refinement is
      // not ported, so the two adjacent edges simply stretch to follow.)
      const a = g.points[h.index];
      const b = g.points[h.index + 1];
      if (!a || !b) return g;
      const m = mid(a, b);
      const d = { x: pos.x - m.x, y: pos.y - m.y };
      const first = g.points[0];
      const last = g.points[g.points.length - 1];
      // A closed outline repeats its first vertex, so moving one must move both
      // or the polygon springs open.
      const closed =
        !!first && !!last && g.points.length > 2 && first.x === last.x && first.y === last.y;
      const moves = new Set([h.index, h.index + 1]);
      if (closed && (moves.has(0) || moves.has(g.points.length - 1))) {
        moves.add(0);
        moves.add(g.points.length - 1);
      }
      return {
        ...g,
        points: g.points.map((p, i) => (moves.has(i) ? { x: p.x + d.x, y: p.y + d.y } : p)),
      };
    }
    case 'text':
      return g;
  }
}

/**
 * A note line sharing an endpoint with this one, which
 * LINE_POINT_EDIT_BEHAVIOR::MakePoints records so that dragging the shared
 * endpoint drags both. Only graphic lines connect this way: the check upstream
 * is `test->GetLayer() != LAYER_NOTES`, so wires and buses are left to the
 * connectivity machinery instead.
 */
function connectedNoteLine(
  doc: Schematic,
  self: number,
  p: Vec2,
): { index: number; end: 'start' | 'end' } | null {
  for (let i = 0; i < doc.lines.length; i++) {
    if (i === self) continue;
    const l = doc.lines[i]!;
    if (l.kind !== 'polyline') continue;
    if (samePoint(l.start, p)) return { index: i, end: 'start' };
    if (samePoint(l.end, p)) return { index: i, end: 'end' };
  }
  return null;
}

function dragLine(doc: Schematic, index: number, h: EditHandle, pos: Vec2): Schematic {
  const l = doc.lines[index];
  if (!l) return doc;

  // A multi-point polyline has a handle per vertex and no separate start/end.
  if (l.points && l.points.length > 2) {
    const points = l.points.map((p, i) => (i === h.index ? { ...pos } : p));
    const moved: SchLine = {
      ...l,
      points,
      start: points[0]!,
      end: points[points.length - 1]!,
    };
    return { ...doc, lines: doc.lines.map((x, i) => (i === index ? moved : x)) };
  }

  const from = h.index === LINE_START ? l.start : l.end;
  const moved: SchLine =
    h.index === LINE_START ? { ...l, start: { ...pos } } : { ...l, end: { ...pos } };
  const linked = connectedNoteLine(doc, index, from);

  return {
    ...doc,
    lines: doc.lines.map((x, i) => {
      if (i === index) return moved;
      if (linked && i === linked.index)
        return linked.end === 'start' ? { ...x, start: { ...pos } } : { ...x, end: { ...pos } };
      return x;
    }),
  };
}

// ----- images ----------------------------------------------------------------

/** BITMAP_POINT_EDIT_BEHAVIOR's 50 mil floor on a rescaled image. */
const MIN_IMAGE_SIDE = mmToIU(50 * 0.0254);

/**
 * An image's four corner handles. `at` is its centre, so they sit half its
 * extent away in each direction (BITMAP_POINT_EDIT_BEHAVIOR::MakePoints).
 *
 * Upstream adds a fifth for the transform origin. We do not model
 * `SCH_BITMAP`'s transform-origin offset, so there is nothing to place there
 * and no drag that could write it back; the four corners are the whole set.
 */
function imageHandles(im: SchImage): EditHandle[] {
  const s = imageSizeIU(im);
  const topLeft = { x: im.at.x - s.w / 2, y: im.at.y - s.h / 2 };
  const botRight = { x: im.at.x + s.w / 2, y: im.at.y + s.h / 2 };
  const c = cornersOf(topLeft, botRight);
  return [
    pt('point', RECT_TOPLEFT, c.topLeft),
    pt('point', RECT_TOPRIGHT, c.topRight),
    pt('point', RECT_BOTLEFT, c.botLeft),
    pt('point', RECT_BOTRIGHT, c.botRight),
  ];
}

/**
 * Rescale an image by dragging a corner (BITMAP_POINT_EDIT_BEHAVIOR::UpdateItem).
 *
 * An image scales about its centre and keeps its aspect ratio, so the drag is
 * read as a ratio of distances rather than a new corner position: how far the
 * corner now is from the centre, over how far it was. Dragging through the
 * centre would flip the image, so a corner that crosses it is pinned there, and
 * the result is floored at 50 mils on the shorter side.
 */
function dragImage(im: SchImage, h: EditHandle, pos: Vec2): SchImage {
  const size = imageSizeIU(im);
  const origin = im.at;
  const half = { x: size.w / 2, y: size.h / 2 };

  // The corner being dragged, as it was, relative to the centre.
  let oldCorner: Vec2;
  switch (h.index) {
    case RECT_TOPLEFT:
      oldCorner = { x: -half.x, y: -half.y };
      break;
    case RECT_TOPRIGHT:
      oldCorner = { x: half.x, y: -half.y };
      break;
    case RECT_BOTLEFT:
      oldCorner = { x: -half.x, y: half.y };
      break;
    case RECT_BOTRIGHT:
      oldCorner = { x: half.x, y: half.y };
      break;
    default:
      return im;
  }
  let newCorner = { x: pos.x - origin.x, y: pos.y - origin.y };

  // Crossing the origin would mirror the image, which a resize handle must not
  // do, so a corner that changes sign is clamped onto the centre instead.
  const sign = (v: number): number => (v < 0 ? -1 : v > 0 ? 1 : 0);
  if (sign(newCorner.x) !== sign(oldCorner.x) || sign(newCorner.y) !== sign(oldCorner.y))
    newCorner = { x: 0, y: 0 };

  const newLength = Math.hypot(newCorner.x, newCorner.y);
  const oldLength = Math.hypot(oldCorner.x, oldCorner.y);
  let ratio = oldLength > 0 ? newLength / oldLength : 1;

  // Floor the shorter side at 50 mils, and take whichever ratio that implies.
  const newWidth = Math.max(size.w * ratio, MIN_IMAGE_SIDE);
  const newHeight = Math.max(size.h * ratio, MIN_IMAGE_SIDE);
  ratio = Math.min(newWidth / size.w, newHeight / size.h);
  if (ratio === 1) return im;

  return { ...im, scale: im.scale * ratio };
}

/** The minimum a text box may shrink to (SCH_TEXTBOX::GetMinSize): its text
 *  must still fit vertically. Empty text has no floor. */
function textBoxMinSize(tb: SchTextBox): Vec2 {
  if (tb.text.trim() === '') return { x: 0, y: 0 };
  const lines = tb.text.split('\n').length;
  const fontHeight = tb.effects?.fontSize?.[1] ?? mmToIU(1.27);
  const margins = (tb.margins?.top ?? 0) + (tb.margins?.bottom ?? 0);
  return { x: 0, y: lines * fontHeight * 1.2 + margins };
}

/** The handles of the item, in the order upstream's EDIT_POINTS holds them. */
export function editHandles(doc: Schematic, t: PointEditTarget): EditHandle[] {
  switch (t.kind) {
    case 'sheet': {
      const sh = doc.sheets[t.index];
      if (!sh) return [];
      // A sheet has no centre handle: it is dragged by its body instead.
      return rectHandles(sh.at, { x: sh.at.x + sh.size.w, y: sh.at.y + sh.size.h }, false);
    }
    case 'textbox': {
      const tb = doc.textBoxes[t.index];
      return tb ? rectHandles(tb.start, tb.end, true) : [];
    }
    // A cell gets two handles, not eight: EDA_TABLECELL_POINT_EDIT_BEHAVIOR
    // exposes COL_WIDTH and ROW_HEIGHT only. There is no top-left to drag,
    // because a cell cannot move independently of its grid -- dragging one
    // resizes a whole column or row.
    case 'tablecell': {
      const table = doc.tables[t.index];
      const c = table?.cells[t.cell ?? -1];
      if (!table || !c) return [];
      const x1 = Math.max(c.start.x, c.end.x);
      const y1 = Math.max(c.start.y, c.end.y);
      return [
        pt('point', CELL_COL_WIDTH, { x: x1, y: mid(c.start, c.end).y }),
        pt('point', CELL_ROW_HEIGHT, { x: mid(c.start, c.end).x, y: y1 }),
      ];
    }
    case 'line': {
      const l = doc.lines[t.index];
      if (!l) return [];
      if (l.points && l.points.length > 2) return l.points.map((p, i) => pt('point', i, p));
      return [pt('point', LINE_START, l.start), pt('point', LINE_END, l.end)];
    }
    case 'image': {
      const im = doc.images[t.index];
      return im ? imageHandles(im) : [];
    }
    case 'graphic': {
      const g = doc.graphics[t.index];
      return g ? graphicHandles(g) : [];
    }
  }
}

/**
 * The document with `handle` dragged to `pos`. Pure: same inputs, same result.
 *
 * `arcMode` is the "Arc editing mode" preference
 * (`EESCHEMA_SETTINGS::m_Drawing.arc_edit_mode`), which only an arc reads.
 */
export function dragHandle(
  doc: Schematic,
  t: PointEditTarget,
  handle: EditHandle,
  pos: Vec2,
  arcMode: ArcEditMode = ArcEditMode.KeepCenterAdjustAngleRadius,
): Schematic {
  switch (t.kind) {
    case 'sheet':
      return resizeSheet(doc, t.index, handle, pos);
    case 'textbox': {
      const tb = doc.textBoxes[t.index];
      if (!tb) return doc;
      const box = reshapedBox(tb.start, tb.end, handle, pos, textBoxMinSize(tb));
      const moved: SchTextBox = { ...tb, start: box.start, end: box.end };
      return { ...doc, textBoxes: doc.textBoxes.map((x, i) => (i === t.index ? moved : x)) };
    }
    case 'tablecell': {
      const table = doc.tables[t.index];
      const c = table?.cells[t.cell ?? -1];
      if (!table || !c) return doc;
      const x0 = Math.min(c.start.x, c.end.x);
      const y0 = Math.min(c.start.y, c.end.y);
      // The drag gives the cell's new full extent; resizeCellEdge splits that
      // back across the columns or rows the cell spans.
      const next =
        handle.index === CELL_COL_WIDTH
          ? resizeCellEdge(table, t.cell!, 'right', Math.max(ONE_MIL, pos.x - x0))
          : resizeCellEdge(table, t.cell!, 'bottom', Math.max(ONE_MIL, pos.y - y0));
      return { ...doc, tables: doc.tables.map((x, i) => (i === t.index ? next : x)) };
    }
    case 'line':
      return dragLine(doc, t.index, handle, pos);
    case 'image': {
      const im = doc.images[t.index];
      if (!im) return doc;
      const moved = dragImage(im, handle, pos);
      if (moved === im) return doc;
      return { ...doc, images: doc.images.map((x, i) => (i === t.index ? moved : x)) };
    }
    case 'graphic': {
      const g = doc.graphics[t.index];
      if (!g) return doc;
      const moved = dragGraphic(g, handle, pos, arcMode);
      // A frame that reshaped nothing hands back the very same document, so
      // anything downstream comparing by identity sees no change.
      if (moved === g) return doc;
      return { ...doc, graphics: doc.graphics.map((x, i) => (i === t.index ? moved : x)) };
    }
  }
}

// ----- add / remove corner ---------------------------------------------------
//
// SCH_ACTIONS::pointEditorAddCorner / pointEditorRemoveCorner, the two entries
// SCH_POINT_EDITOR puts in the selection context menu for a polyline.

/** The vertex list a corner can be added to or removed from, or null. */
function polyPointsOf(doc: Schematic, t: PointEditTarget): readonly Vec2[] | null {
  if (t.kind !== 'line') return null;
  const l = doc.lines[t.index];
  // Wires and buses are segments, not outlines; only a graphic polyline has
  // corners to add to (upstream gates on SHAPE_T::POLY).
  if (!l || l.kind !== 'polyline') return null;
  return l.points ?? [l.start, l.end];
}

/**
 * `SCH_POINT_EDITOR::addCornerCondition`: the cursor has to be on the shape
 * itself, within a handle's width of it, since the new corner goes on the
 * segment nearest the cursor.
 */
export function canAddCorner(doc: Schematic, t: PointEditTarget, at: Vec2, tol: number): boolean {
  const pts = polyPointsOf(doc, t);
  if (!pts || pts.length < 2) return false;
  for (let i = 1; i < pts.length; i++)
    if (distanceToSegment(at, pts[i - 1]!, pts[i]!) <= tol) return true;
  return false;
}

/**
 * `SCH_POINT_EDITOR::removeCornerCondition`: a vertex has to be picked, and a
 * polyline may not be reduced below the two points that still make a line.
 */
export function canRemoveCorner(doc: Schematic, t: PointEditTarget, handle: EditHandle): boolean {
  const pts = polyPointsOf(doc, t);
  if (!pts || pts.length <= 2) return false;
  return handle.kind === 'point' && handle.index >= 0 && handle.index < pts.length;
}

/**
 * Insert a corner at `at`, on the segment nearest to it
 * (`SCH_POINT_EDITOR::addCorner`).
 */
export function addCorner(doc: Schematic, t: PointEditTarget, at: Vec2): Schematic | null {
  const pts = polyPointsOf(doc, t);
  if (!pts || pts.length < 2) return null;
  let closest = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    const d = distanceToSegment(at, pts[i - 1]!, pts[i]!);
    if (d < best) {
      best = d;
      closest = i - 1;
    }
  }
  const points = [...pts.slice(0, closest + 1), { ...at }, ...pts.slice(closest + 1)];
  return withPolyPoints(doc, t.index, points);
}

/** Drop the corner the handle picked (`SCH_POINT_EDITOR::removeCorner`). */
export function removeCorner(
  doc: Schematic,
  t: PointEditTarget,
  handle: EditHandle,
): Schematic | null {
  if (!canRemoveCorner(doc, t, handle)) return null;
  const pts = polyPointsOf(doc, t)!;
  return withPolyPoints(
    doc,
    t.index,
    pts.filter((_, i) => i !== handle.index),
  );
}

/** Rewrite a polyline's vertices, keeping start/end at the ends of the list. */
function withPolyPoints(doc: Schematic, index: number, points: readonly Vec2[]): Schematic {
  const l = doc.lines[index];
  if (!l || points.length < 2) return doc;
  const moved: SchLine = {
    ...l,
    points,
    start: points[0]!,
    end: points[points.length - 1]!,
  };
  return { ...doc, lines: doc.lines.map((x, i) => (i === index ? moved : x)) };
}

/** Distance from a point to a segment, `SEG::Distance`. */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * One undo step for a completed drag. A drag runs `dragHandle` per pointer event
 * and only the final document is committed, so the command carries that result
 * and its inverse carries the document as the drag found it.
 *
 * Only the arrays a reshape can touch are taken from `after`, and only when it
 * actually replaced them, so an undo step never disturbs edits made elsewhere in
 * the document between apply and invert.
 */
export function reshapeCommand(label: string, after: Schematic): EditCommand {
  return {
    label,
    apply(doc: Schematic): Schematic {
      const out: { -readonly [K in keyof Schematic]: Schematic[K] } = { ...doc };
      if (after.sheets !== doc.sheets) out.sheets = after.sheets;
      if (after.lines !== doc.lines) out.lines = after.lines;
      if (after.graphics !== doc.graphics) out.graphics = after.graphics;
      if (after.textBoxes !== doc.textBoxes) out.textBoxes = after.textBoxes;
      if (after.noConnects !== doc.noConnects) out.noConnects = after.noConnects;
      if (after.images !== doc.images) out.images = after.images;
      return out;
    },
    invert: (before: Schematic) => reshapeCommand(label, before),
  };
}
