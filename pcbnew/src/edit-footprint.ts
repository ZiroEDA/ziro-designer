// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint editing operations, pure transforms on the typed PcbFootprint,
 * the geometry behind KiCad's FOOTPRINT_EDIT_FRAME edit tools (move / rotate /
 * mirror / delete / add). The web mirror of PCB_MOVE_TOOL / EDIT_TOOL applied to
 * a footprint's children.
 *
 * Losslessness: an edited item keeps its `source` node, and the specific child
 * that changed (`(at …)`, `(start …)`, `(pts …)`, …) is PATCHED in place. That
 * way serializeFootprint's source-passthrough stays byte-faithful for every
 * unmodelled field (pinfunction, custom pad primitives, stroke type, solder
 * margins …) while the edited coordinate is rewritten. Brand-new items carry an
 * empty source, so the writer builds them canonically.
 *
 * Coordinates are internal units (+Y down), matching the reader/writer.
 */

import { atom, str, list, isList, head, type SList } from '@ziroeda/sexpr/src/index.js';
import { pcbIuToMM as iuToMM } from '@ziroeda/common/src/eda_units.js';
import { textItemBBox, textItemHitTest } from './text_metrics.js';
import { rotatePcb } from './read-board.js';
import type {
  PadShape,
  PadType,
  PcbFootprint,
  PcbPad,
  PcbBarcode,
  PcbPoint,
  PcbShape,
  PcbTextItem,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { isSolidFill } from './shape_fill.js';

// ----- item ids ---------------------------------------------------------------

export type FpItemKind = 'pad' | 'shape' | 'text' | 'point';
export interface FpItemRef {
  kind: FpItemKind;
  index: number;
}

export const fpItemId = (kind: FpItemKind, index: number): string => `${kind}:${index}`;

export function parseFpItemId(id: string): FpItemRef | null {
  const [kind, idx] = id.split(':');
  const index = Number(idx);
  if (
    (kind === 'pad' || kind === 'shape' || kind === 'text' || kind === 'point') &&
    Number.isInteger(index)
  ) {
    return { kind, index };
  }
  return null;
}

// ----- source patching --------------------------------------------------------

const mm = (iu: number): string => {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
};

/** Replace (or append) the first `name` child of a source node. */
function patchChild(src: SList, name: string, node: SList): SList {
  let replaced = false;
  const items = src.items.map((it) => {
    if (!replaced && isList(it) && head(it) === name) {
      replaced = true;
      return node;
    }
    return it;
  });
  if (!replaced) items.push(node);
  return { kind: 'list', items };
}

const atNode = (p: Vec2, angle: number): SList =>
  angle
    ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
    : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));

const xyNode = (name: string, p: Vec2): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));

const ptsNode = (pts: Vec2[]): SList => ({
  kind: 'list',
  items: [atom('pts'), ...pts.map((p) => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y))))],
});

// ----- geometry helpers -------------------------------------------------------

/** Normalise degrees to [0, 360). */
const norm360 = (a: number): number => ((a % 360) + 360) % 360;

/** Rotate a point about a centre by `deg` (KiCad RotatePoint convention). */
const rotAbout = (p: Vec2, c: Vec2, deg: number): Vec2 => {
  const r = rotatePcb({ x: p.x - c.x, y: p.y - c.y }, deg);
  return { x: r.x + c.x, y: r.y + c.y };
};

/** Mirror a point's X about a vertical axis at `cx`. */
const mirrorX = (p: Vec2, cx: number): Vec2 => ({ x: 2 * cx - p.x, y: p.y });

// ----- bounding box -----------------------------------------------------------

export interface FpBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const padPoints = (pad: PcbPad): Vec2[] => {
  const hw = pad.size.x / 2;
  const hh = pad.size.y / 2;
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return corners.map((c) => {
    const r = pad.angle ? rotatePcb(c, -pad.angle) : c;
    return { x: r.x + pad.at.x, y: r.y + pad.at.y };
  });
};

const shapePoints = (s: PcbShape): Vec2[] => {
  const pts: Vec2[] = [];
  if (s.start) pts.push(s.start);
  if (s.end) pts.push(s.end);
  if (s.mid) pts.push(s.mid);
  if (s.center) pts.push(s.center);
  if (s.pts) pts.push(...s.pts);
  if (s.kind === 'circle' && s.center && s.end) {
    const rr = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    pts.push(
      { x: s.center.x - rr, y: s.center.y - rr },
      { x: s.center.x + rr, y: s.center.y + rr },
    );
  }
  return pts;
};

const bboxOf = (pts: Vec2[]): FpBBox | null => {
  if (pts.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

/** Bounding box of one item (for drawing a selection highlight), or null. */
export function fpItemBBox(fp: PcbFootprint, id: string): FpBBox | null {
  const ref = parseFpItemId(id);
  if (!ref) return null;
  if (ref.kind === 'pad') {
    const p = fp.pads[ref.index];
    return p ? bboxOf(padPoints(p)) : null;
  }
  if (ref.kind === 'shape') {
    const s = fp.shapes[ref.index];
    return s ? bboxOf(shapePoints(s)) : null;
  }
  if (ref.kind === 'point') {
    // `PCB_POINT::GetBoundingBox`: `BOX2I::ByCenter( m_pos, { m_size, m_size } )`.
    const p = fp.points[ref.index];
    if (!p) return null;
    const h = p.size / 2;
    return { minX: p.at.x - h, minY: p.at.y - h, maxX: p.at.x + h, maxY: p.at.y + h };
  }
  const t = fp.texts[ref.index];
  if (!t) return null;
  // `PCB_TEXT::GetBoundingBox`: `EDA_TEXT::GetTextBox` rotated by the draw
  // rotation, measured by the same stroke font the canvas draws with.
  const b = textItemBBox(t);
  return { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h };
}

/**
 * Bounding box of a footprint's drawable geometry (pads + graphics + text).
 *
 * `FOOTPRINT::GetBoundingBox( aIncludeText = true )` (`pcbnew/footprint.cpp`)
 * merges `text->GetBoundingBox()` for every visible text, which for a
 * `PCB_TEXT` is `EDA_TEXT::GetTextBox` rotated by the draw rotation. This grew
 * the box by the text's *anchor point* only, which is the fifth site of the
 * same class the board's four measurement sites were fixed in: a reference
 * designator hanging off the top of a footprint contributed one point rather
 * than its glyphs.
 *
 * It feeds zoom-to-fit and the spread-footprints layout, so a board whose
 * outermost ink was a silkscreen value was zoomed with that value cropped, and
 * spread footprints were packed close enough for their text to overlap.
 *
 * `aIncludeText` is upstream's own parameter and it has one caller that passes
 * false: the footprint preview panel's zoom-to-fit
 * (`FOOTPRINT_PREVIEW_PANEL::fitToCurrentFootprint`, footprint_preview_panel.cpp:
 * `bool includeText = m_currentFootprint->TextOnly()`). Everything else — the
 * board bounding box (`board.cpp:2255`), selection, spread — takes the default
 * `true`. Upstream also drops annotation *graphics* (dimensions, the four user
 * layers) when text is excluded, but only `if( footprintSide != UNDEFINED_LAYER )`
 * — and `FOOTPRINT::GetSide` answers UNDEFINED_LAYER for every footprint on a
 * footprint-holder board (`footprint.cpp:2219-2225`), which is the only board
 * the false case is ever asked about. So on that path nothing but text is
 * dropped, and that is what this does.
 */
export function footprintBBox(fp: PcbFootprint, includeText = true): FpBBox | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  // NOT ported: `BOX2I bbox( m_pos ); bbox.Inflate( pcbIUScale.mmToIU( 0.25 ) );`,
  // upstream's "give a min size to the bbox" seed (`footprint.cpp:1800-1801`).
  // It only ever shows on a footprint holding nothing at all, and this box is
  // also what board hit-testing and the mirror pivot are measured from, where
  // a synthetic half-millimetre around an empty footprint invents a hit and
  // moves a pivot. Ours answers null for that footprint instead. Left as its
  // own change rather than smuggled in with the preview's framing fix.
  for (const pad of fp.pads) padPoints(pad).forEach(grow);
  for (const s of fp.shapes) shapePoints(s).forEach(grow);
  // `bbox.Merge( point->GetBoundingBox() )` (`footprint.cpp:1853-1854`), and a
  // point's box is `BOX2I::ByCenter( m_pos, { m_size, m_size } )` — half a size
  // each way, not the bare position. Unconditional: a point is not text, so
  // `aIncludeText` does not gate it.
  for (const p of fp.points) {
    grow({ x: p.at.x - p.size / 2, y: p.at.y - p.size / 2 });
    grow({ x: p.at.x + p.size / 2, y: p.at.y + p.size / 2 });
  }
  if (includeText) {
    for (const t of fp.texts) {
      if (t.hide) continue;
      // The same `textItemBBox` `fpItemBBox` selects this text with, so the box
      // that zooms to it and the box that highlights it cannot drift apart.
      const b = textItemBBox(t);
      grow({ x: b.x, y: b.y });
      grow({ x: b.x + b.w, y: b.y + b.h });
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/**
 * `FOOTPRINT::TextOnly` (`pcbnew/footprint.cpp:1749-1761`): is every one of the
 * footprint's graphical items a text?
 *
 * Note what it does *not* look at — pads and zones. A footprint that is nothing
 * but pads is "text only" by this test, and that is deliberate: the one caller
 * uses the answer to decide whether the fit box may exclude text, and a
 * footprint with no graphics has nothing else for the box to be made of.
 */
export function footprintTextOnly(fp: PcbFootprint): boolean {
  return fp.shapes.length === 0;
}

// ----- hit testing ------------------------------------------------------------

const distToSeg = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

export const padHit = (pad: PcbPad, pos: Vec2, tol: number): boolean => {
  // Transform into pad-local frame (undo translate + rotation).
  const d = { x: pos.x - pad.at.x, y: pos.y - pad.at.y };
  const l = pad.angle ? rotatePcb(d, pad.angle) : d;
  return Math.abs(l.x) <= pad.size.x / 2 + tol && Math.abs(l.y) <= pad.size.y / 2 + tol;
};

/** Board-absolute bounding box of a single pad (for board-level selection). */
export const padBBox = (pad: PcbPad): FpBBox | null => bboxOf(padPoints(pad));

/**
 * `PCB_POINT::HitTest( VECTOR2I, int )` (`pcb_point.cpp:82-96`): the two bars
 * of the X, or the disc at its centre.
 *
 * Upstream's local `size` is `GetSize() / 2`, so the X's arms reach `size / 2`
 * from the centre and the disc's radius is `GetSize() / 4` — the drawn ring.
 * The board editor's `pointDist` is the same test as a distance.
 */
const pointHit = (p: PcbPoint, pos: Vec2, tol: number): boolean => {
  const h = p.size / 2;
  return (
    distToSeg(pos, { x: p.at.x - h, y: p.at.y - h }, { x: p.at.x + h, y: p.at.y + h }) <= tol ||
    distToSeg(pos, { x: p.at.x - h, y: p.at.y + h }, { x: p.at.x + h, y: p.at.y - h }) <= tol ||
    Math.hypot(pos.x - p.at.x, pos.y - p.at.y) <= h / 2 + tol
  );
};

const shapeHit = (s: PcbShape, pos: Vec2, tol: number): boolean => {
  const t = tol + s.width / 2;
  if (s.kind === 'line' && s.start && s.end) return distToSeg(pos, s.start, s.end) <= t;
  if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    const d = Math.hypot(pos.x - s.center.x, pos.y - s.center.y);
    return isSolidFill(s) ? d <= r + t : Math.abs(d - r) <= t;
  }
  if (s.kind === 'rect' && s.start && s.end) {
    const x0 = Math.min(s.start.x, s.end.x),
      x1 = Math.max(s.start.x, s.end.x);
    const y0 = Math.min(s.start.y, s.end.y),
      y1 = Math.max(s.start.y, s.end.y);
    if (isSolidFill(s))
      return pos.x >= x0 - t && pos.x <= x1 + t && pos.y >= y0 - t && pos.y <= y1 + t;
    const near = Math.min(
      Math.abs(pos.x - x0),
      Math.abs(pos.x - x1),
      Math.abs(pos.y - y0),
      Math.abs(pos.y - y1),
    );
    return near <= t && pos.x >= x0 - t && pos.x <= x1 + t && pos.y >= y0 - t && pos.y <= y1 + t;
  }
  const pts = shapePoints(s);
  for (let i = 1; i < pts.length; i++) if (distToSeg(pos, pts[i - 1]!, pts[i]!) <= t) return true;
  return false;
};

/**
 * `PCB_TEXT::TextHitTest( aPoint, aAccuracy )` -> `EDA_TEXT::TextHitTest`: the
 * `GetTextBox` rectangle inflated by the accuracy, against the point rotated
 * back into the text's frame.
 *
 * `tol` stays because the accuracy is upstream's own parameter — `HitTest(
 * aPosition, aAccuracy )` is how every board item is picked, and the caller
 * sizes it from the view scale. It is the *extent* that was invented, not the
 * tolerance.
 */
const textHit = (tx: PcbTextItem, pos: Vec2, tol: number): boolean => textItemHitTest(tx, pos, tol);

/** Topmost item id at `pos` (texts, then pads, then graphics), or null. */
export function hitTestFootprint(fp: PcbFootprint, pos: Vec2, tol: number): string | null {
  for (let i = fp.texts.length - 1; i >= 0; i--)
    if (!fp.texts[i]!.hide && textHit(fp.texts[i]!, pos, tol)) return fpItemId('text', i);
  for (let i = fp.pads.length - 1; i >= 0; i--)
    if (padHit(fp.pads[i]!, pos, tol)) return fpItemId('pad', i);
  for (let i = fp.points.length - 1; i >= 0; i--)
    if (pointHit(fp.points[i]!, pos, tol)) return fpItemId('point', i);
  for (let i = fp.shapes.length - 1; i >= 0; i--)
    if (shapeHit(fp.shapes[i]!, pos, tol)) return fpItemId('shape', i);
  return null;
}

/** Every item id whose geometry falls inside the given rectangle (box select). */
export function itemsInBox(
  fp: PcbFootprint,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): string[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const inside = (p: Vec2): boolean => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  const out: string[] = [];
  fp.pads.forEach((pad, i) => {
    if (padPoints(pad).some(inside)) out.push(fpItemId('pad', i));
  });
  fp.shapes.forEach((s, i) => {
    if (shapePoints(s).some(inside)) out.push(fpItemId('shape', i));
  });
  fp.texts.forEach((t, i) => {
    if (!t.hide && inside(t.at)) out.push(fpItemId('text', i));
  });
  fp.points.forEach((p, i) => {
    if (inside(p.at)) out.push(fpItemId('point', i));
  });
  return out;
}

// ----- transforms -------------------------------------------------------------

type PadT = (p: PcbPad) => PcbPad;
type ShapeT = (s: PcbShape) => PcbShape;
type TextT = (t: PcbTextItem) => PcbTextItem;
type PointT = (p: PcbPoint) => PcbPoint;

/**
 * Apply per-kind transforms to just the selected items.
 *
 * The point transform is a position map and never more: `PCB_POINT` has no
 * orientation and no second coordinate, so `Move`, `Rotate` and the mirror all
 * reduce to moving `m_pos`. That is why it is `(p: Vec2) => Vec2` here and not
 * a full `PcbPoint` transformer at every call site.
 */
function mapSelected(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  tp: PadT,
  ts: ShapeT,
  tt: TextT,
  moveAt: (p: Vec2) => Vec2,
): PcbFootprint {
  const sel = new Set<string>();
  for (const id of ids) if (parseFpItemId(id)) sel.add(id);
  const to: PointT = (p) => {
    const at = moveAt(p.at);
    return { ...p, at, source: patchChild(p.source, 'at', xyNode('at', at)) };
  };
  return {
    ...fp,
    pads: fp.pads.map((p, i) => (sel.has(fpItemId('pad', i)) ? tp(p) : p)),
    shapes: fp.shapes.map((s, i) => (sel.has(fpItemId('shape', i)) ? ts(s) : s)),
    texts: fp.texts.map((t, i) => (sel.has(fpItemId('text', i)) ? tt(t) : t)),
    points: fp.points.map((p, i) => (sel.has(fpItemId('point', i)) ? to(p) : p)),
  };
}

const movePad =
  (delta: Vec2): PadT =>
  (p) => {
    const at = { x: p.at.x + delta.x, y: p.at.y + delta.y };
    return { ...p, at, source: patchChild(p.source, 'at', atNode(at, p.angle)) };
  };
const moveText =
  (delta: Vec2): TextT =>
  (t) => {
    const at = { x: t.at.x + delta.x, y: t.at.y + delta.y };
    return { ...t, at, source: patchChild(t.source, 'at', atNode(at, t.angle)) };
  };
const moveShape =
  (delta: Vec2): ShapeT =>
  (s) =>
    shiftShape(s, (p) => ({ x: p.x + delta.x, y: p.y + delta.y }));

/** Apply a point transform to every coordinate of a shape and patch its source. */
function shiftShape(s: PcbShape, fn: (p: Vec2) => Vec2): PcbShape {
  let src = s.source;
  const next: PcbShape = { ...s };
  if (s.center) {
    next.center = fn(s.center);
    src = patchChild(src, 'center', xyNode('center', next.center));
  }
  if (s.start) {
    next.start = fn(s.start);
    src = patchChild(src, 'start', xyNode('start', next.start));
  }
  if (s.end) {
    next.end = fn(s.end);
    src = patchChild(src, 'end', xyNode('end', next.end));
  }
  if (s.mid) {
    next.mid = fn(s.mid);
    src = patchChild(src, 'mid', xyNode('mid', next.mid));
  }
  if (s.pts) {
    next.pts = s.pts.map(fn);
    src = patchChild(src, 'pts', ptsNode(next.pts));
  }
  next.source = src;
  return next;
}

export function moveFootprintItems(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  delta: Vec2,
): PcbFootprint {
  if ((delta.x === 0 && delta.y === 0) || ids.size === 0) return fp;
  return mapSelected(fp, ids, movePad(delta), moveShape(delta), moveText(delta), (p) => ({
    x: p.x + delta.x,
    y: p.y + delta.y,
  }));
}

export function rotateFootprintItems(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  ccw: boolean,
  center: Vec2,
  /**
   * `EDIT_TOOL::Rotate`'s step — `frame()->GetRotationAngle()`, which is the
   * settings object's `m_RotationAngle` and NOT a constant
   * (`pcbnew/tools/edit_tool.cpp`: `EDA_ANGLE rotateAngle = TOOL_EVT_UTILS::
   * GetEventRotationAngle( *editFrame, aEvent )`, whose default arm returns
   * `aFrame.GetRotationAngle()`). It is Preferences > Editing Options' "Step
   * for rotate commands:", and hard-coding 90 here is what made that control
   * unreachable.
   *
   * Defaulted so the two existing callers that do not set it keep KiCad's own
   * default of ANGLE_90.
   */
  degrees = 90,
): PcbFootprint {
  if (ids.size === 0) return fp;
  const deg = ccw ? degrees : -degrees;
  const tp: PadT = (p) => {
    const at = rotAbout(p.at, center, deg);
    const angle = norm360(p.angle + deg);
    return { ...p, at, angle, source: patchChild(p.source, 'at', atNode(at, angle)) };
  };
  const tt: TextT = (t) => {
    const at = rotAbout(t.at, center, deg);
    const angle = norm360(t.angle + deg);
    return { ...t, at, angle, source: patchChild(t.source, 'at', atNode(at, angle)) };
  };
  const ts: ShapeT = (s) => shiftShape(s, (p) => rotAbout(p, center, deg));
  return mapSelected(fp, ids, tp, ts, tt, (p) => rotAbout(p, center, deg));
}

export function mirrorFootprintItems(
  fp: PcbFootprint,
  ids: ReadonlySet<string>,
  center: Vec2,
): PcbFootprint {
  if (ids.size === 0) return fp;
  const cx = center.x;
  const tp: PadT = (p) => {
    const at = mirrorX(p.at, cx);
    const angle = norm360(180 - p.angle);
    return { ...p, at, angle, source: patchChild(p.source, 'at', atNode(at, angle)) };
  };
  const tt: TextT = (t) => {
    const at = mirrorX(t.at, cx);
    return { ...t, at, mirror: !t.mirror, source: patchChild(t.source, 'at', atNode(at, t.angle)) };
  };
  const ts: ShapeT = (s) => shiftShape(s, (p) => mirrorX(p, cx));
  return mapSelected(fp, ids, tp, ts, tt, (p) => mirrorX(p, cx));
}

// ----- add / delete -----------------------------------------------------------

/** Remove the selected items (delete tool / Del key). */
export function deleteFootprintItems(fp: PcbFootprint, ids: ReadonlySet<string>): PcbFootprint {
  const del = {
    pad: new Set<number>(),
    shape: new Set<number>(),
    text: new Set<number>(),
    point: new Set<number>(),
  };
  for (const id of ids) {
    const r = parseFpItemId(id);
    if (r) del[r.kind].add(r.index);
  }
  return {
    ...fp,
    pads: fp.pads.filter((_, i) => !del.pad.has(i)),
    shapes: fp.shapes.filter((_, i) => !del.shape.has(i)),
    texts: fp.texts.filter((_, i) => !del.text.has(i)),
    points: fp.points.filter((_, i) => !del.point.has(i)),
  };
}

export const addPad = (fp: PcbFootprint, pad: PcbPad): PcbFootprint => ({
  ...fp,
  pads: [...fp.pads, pad],
});
export const addShape = (fp: PcbFootprint, shape: PcbShape): PcbFootprint => ({
  ...fp,
  shapes: [...fp.shapes, shape],
});
export const addText = (fp: PcbFootprint, text: PcbTextItem): PcbFootprint => ({
  ...fp,
  texts: [...fp.texts, text],
});
/** `POINT_PLACER`'s commit, in the footprint editor's own `FOOTPRINT::Points()`. */
export const addPoint = (fp: PcbFootprint, point: PcbPoint): PcbFootprint => ({
  ...fp,
  points: [...fp.points, point],
});

/**
 * `DRAWING_TOOL::DrawBarcode`'s commit inside the footprint editor
 * (`drawing_tool.cpp:1528`, where `m_frame->GetModel()` is the footprint).
 */
export const addBarcode = (fp: PcbFootprint, barcode: PcbBarcode): PcbFootprint => ({
  ...fp,
  barcodes: [...fp.barcodes, barcode],
});

/** Replace one of the footprint's barcodes (the properties dialog's OK). */
export const setBarcode = (fp: PcbFootprint, index: number, next: PcbBarcode): PcbFootprint => ({
  ...fp,
  barcodes: fp.barcodes.map((b, i) => (i === index ? next : b)),
});

// ----- footprint properties (Reference / Value / Description / Keywords) ------

/** Replace the index-th positional item of a source node with a string. */
function patchArg(src: SList, index: number, value: string): SList {
  if (src.items.length <= index) return src;
  const items = src.items.slice();
  items[index] = str(value);
  return { kind: 'list', items };
}

/** Patch a Reference/Value text's stored string: `(property "Reference" VAL …)`
 *  or `(fp_text reference VAL …)`, the value is the 3rd positional in both. */
function patchTextValue(src: SList, value: string): SList {
  if (src.items.length === 0) return src; // new item: buildTextNode uses .text
  return patchArg(src, 2, value);
}

/**
 * The text as the FILE holds it, before the reader substituted `${REFERENCE}`
 * and `${VALUE}` into it.
 *
 * KiCad never stores a resolved string: `FOOTPRINT::ResolveTextVar` runs inside
 * `EDA_TEXT::GetShownText` every time the item is drawn (`pcbnew/footprint.cpp`),
 * so the F.Fab `${REFERENCE}` follows the reference the instant it changes. Our
 * reader bakes the substitution once, at parse time (`read-board.ts`, the loop
 * after `parseFOOTPRINT`), which is cheaper but leaves `text` stale the moment
 * something edits the reference or the value. The literal survives in `source`,
 * so it can be recovered and re-run — that is what this pair is for.
 *
 * The value is the 3rd positional in both spellings a footprint text takes,
 * `(property "Reference" "REF**" …)` and `(fp_text user "${REFERENCE}" …)`;
 * board text, `(gr_text "…")`, keeps it at the 2nd and is never substituted.
 */
export function footprintTextRaw(t: PcbTextItem): string {
  if (t.source.items.length === 0) return t.text; // built from scratch: nothing to recover
  const name = head(t.source) ?? '';
  const node = t.source.items[name === 'gr_text' ? 1 : 2];
  return node && node.kind !== 'list' ? node.value : t.text;
}

/**
 * Re-run the reader's `${REFERENCE}` / `${VALUE}` substitution over a BOARD
 * footprint, so a text that quotes one of them follows the field it quotes.
 *
 * Not for a library footprint: `FOOTPRINT::ResolveTextVar` returns false on an
 * FPHOLDER board (`footprint.cpp:1185-1188`), which is why the footprint editor
 * and the chooser's preview paint the literal `${REFERENCE}`.
 */
export function resolveFootprintTextVars(fp: PcbFootprint): PcbFootprint {
  let changed = false;
  const texts = fp.texts.map((t) => {
    const raw = footprintTextRaw(t);
    if (!raw.includes('${')) return t;
    const shown = raw
      .replaceAll('${REFERENCE}', fp.reference ?? '')
      .replaceAll('${VALUE}', fp.value ?? '');
    if (shown === t.text) return t;
    changed = true;
    return { ...t, text: shown };
  });
  return changed ? { ...fp, texts } : fp;
}

const setRefOrVal = (fp: PcbFootprint, kind: 'reference' | 'value', value: string): PcbFootprint =>
  // The re-resolve is the whole point of routing every reference and value edit
  // through here: without it a netlist update renamed the silkscreen "REF**" to
  // "D1" and left the F.Fab `${REFERENCE}` reading "REF**" for ever.
  resolveFootprintTextVars({
    ...fp,
    ...(kind === 'reference' ? { reference: value } : { value }),
    texts: fp.texts.map((t) =>
      t.kind === kind ? { ...t, text: value, source: patchTextValue(t.source, value) } : t,
    ),
  });

export const setFootprintReference = (fp: PcbFootprint, value: string): PcbFootprint =>
  setRefOrVal(fp, 'reference', value);
export const setFootprintValue = (fp: PcbFootprint, value: string): PcbFootprint =>
  setRefOrVal(fp, 'value', value);

/** Set a top-level single-string child of the footprint node (descr / tags). */
function setFootprintStringChild(fp: PcbFootprint, name: string, value: string): PcbFootprint {
  const src = fp.source;
  if (src.items.length === 0) return fp; // built-from-scratch footprints carry no source yet
  return { ...fp, source: patchChild(src, name, list(atom(name), str(value))) };
}

export const setFootprintDescription = (fp: PcbFootprint, value: string): PcbFootprint =>
  setFootprintStringChild(fp, 'descr', value);
export const setFootprintKeywords = (fp: PcbFootprint, value: string): PcbFootprint =>
  setFootprintStringChild(fp, 'tags', value);

/** Read the footprint's `(descr …)` / `(tags …)` text for the properties dialog. */
export function footprintStringChild(fp: PcbFootprint, name: string): string {
  for (const it of fp.source.items) {
    if (isList(it) && head(it) === name) {
      const v = it.items[1];
      return v && v.kind === 'string' ? v.value : v && v.kind === 'atom' ? v.value : '';
    }
  }
  return '';
}

// ----- pad properties ---------------------------------------------------------

export interface PadEdit {
  number?: string;
  type?: PadType;
  shape?: PadShape;
  at?: Vec2;
  angle?: number;
  size?: Vec2;
  /** A drill spec, or null to remove the drill (SMD pads). */
  drill?: { oblong: boolean; w: number; h: number } | null;
  layers?: string[];
}

const patchArgAtom = (src: SList, index: number, value: string): SList => {
  if (src.items.length <= index) return src;
  const items = src.items.slice();
  items[index] = atom(value);
  return { kind: 'list', items };
};

const removeChild = (src: SList, name: string): SList => ({
  kind: 'list',
  items: src.items.filter((it) => !(isList(it) && head(it) === name)),
});

const drillNode = (d: { oblong: boolean; w: number; h: number }): SList => {
  const items: SList['items'] = [atom('drill')];
  if (d.oblong) items.push(atom('oval'));
  if (d.w > 0) items.push(atom(mm(d.w)));
  if (d.oblong && d.h > 0 && d.h !== d.w) items.push(atom(mm(d.h)));
  return { kind: 'list', items };
};

/**
 * Apply a pad-properties edit, patching the pad's source node field-by-field so
 * every unmodelled property (pinfunction, custom primitives, margins…) survives
 * (DIALOG_PAD_PROPERTIES::TransferDataFromWindow). A source-less (just-placed)
 * pad is left for the canonical writer to build.
 */
export function patchPad(pad: PcbPad, e: PadEdit): PcbPad {
  const next: PcbPad = { ...pad };
  let src = pad.source;
  const hasSrc = src.items.length > 0;
  if (e.number !== undefined) {
    next.number = e.number;
    if (hasSrc) src = patchArg(src, 1, e.number);
  }
  if (e.type !== undefined) {
    next.type = e.type;
    if (hasSrc) src = patchArgAtom(src, 2, e.type);
  }
  if (e.shape !== undefined) {
    next.shape = e.shape;
    if (hasSrc) src = patchArgAtom(src, 3, e.shape);
  }
  if (e.angle !== undefined) next.angle = e.angle;
  if (e.at !== undefined || e.angle !== undefined) {
    next.at = e.at ?? pad.at;
    if (hasSrc) src = patchChild(src, 'at', atNode(next.at, next.angle));
  }
  if (e.size !== undefined) {
    next.size = e.size;
    if (hasSrc)
      src = patchChild(src, 'size', list(atom('size'), atom(mm(e.size.x)), atom(mm(e.size.y))));
  }
  if (e.drill !== undefined) {
    next.drill = e.drill ?? undefined;
    if (hasSrc)
      src = e.drill ? patchChild(src, 'drill', drillNode(e.drill)) : removeChild(src, 'drill');
  }
  if (e.layers !== undefined) {
    next.layers = e.layers;
    if (hasSrc)
      src = patchChild(src, 'layers', {
        kind: 'list',
        items: [atom('layers'), ...e.layers.map((l) => str(l))],
      });
  }
  next.source = src;
  return next;
}

/** Replace one item wholesale (a dialog edit); caller supplies a source-consistent item. */
export function replaceFootprintItem(
  fp: PcbFootprint,
  id: string,
  item: PcbPad | PcbShape | PcbTextItem,
): PcbFootprint {
  const ref = parseFpItemId(id);
  if (!ref) return fp;
  if (ref.kind === 'pad')
    return { ...fp, pads: fp.pads.map((p, i) => (i === ref.index ? (item as PcbPad) : p)) };
  if (ref.kind === 'shape')
    return { ...fp, shapes: fp.shapes.map((s, i) => (i === ref.index ? (item as PcbShape) : s)) };
  return { ...fp, texts: fp.texts.map((t, i) => (i === ref.index ? (item as PcbTextItem) : t)) };
}
