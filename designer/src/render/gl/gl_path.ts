// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `Path2D`-shaped recorder that keeps its vertices.
 *
 * `buildScene` in `renderBoard.ts` compiles the board into `Path2D` objects. A
 * `Path2D` stores what to draw but will not hand the segments back, so a scene
 * built from one cannot feed the GPU. This is the same object with the geometry
 * left readable: pass `GL_PATH_FACTORY` to `buildScene` and every bucket comes
 * back as a `GlPath` whose subpaths can be stroked or filled into a `Scene`.
 *
 * The surface is exactly what `buildScene` uses and no more — eight path methods
 * and two matrix methods, counted from the source. Anything else a `Path2D` can
 * do is deliberately absent rather than stubbed, so a future caller reaching for
 * `bezierCurveTo` fails loudly at the type level instead of silently dropping
 * geometry.
 *
 * ### Everything is world coordinates
 *
 * Like `recorder.ts`, nothing here knows the zoom. `addPath`'s matrix is applied
 * to the points as they are copied, because that is a *model* transform (where a
 * pad sits on the board), not a view one.
 *
 * ### Curves become polylines at record time
 *
 * Arcs are flattened by `arcToPolyline`, whose facet count comes from the world
 * radius rather than the current zoom — the property that lets one recording
 * serve every zoom level. See `tessellate.ts`.
 */

import { arcToPolyline, type Pt } from './tessellate.js';

/** 2D affine transform in Canvas order: [a, b, c, d, e, f]. */
export type Mat = [number, number, number, number, number, number];

const IDENT: Mat = [1, 0, 0, 1, 0, 0];

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Mat, p: Pt): Pt => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

/**
 * One connected run of points.
 *
 * `closed` matters to both consumers: a fill needs the closing edge to
 * triangulate a complete ring, and a stroke must draw it rather than leaving a
 * gap where a zone outline meets itself.
 */
export interface SubPath {
  pts: Pt[];
  closed: boolean;
  /**
   * The board item this run belongs to, when the builder named one.
   *
   * KiCad keeps each item's vertices in its own chunk of the cached container
   * (`CACHED_CONTAINER::SetItem`), which is why moving a footprint there
   * rewrites that footprint and nothing else. Our buckets merge every item on
   * a layer into one path, so ownership is carried per run instead and the
   * recorder groups them back out — same addressability, without giving every
   * item its own object.
   */
  owner?: string;
  /**
   * This run is a whole circle, and these are its true parameters.
   *
   * The points are still flattened into `pts`, so a fill (which triangulates)
   * and anything else that walks the polyline is unaffected. Only a *stroke*
   * looks at this, and it draws an exact ring instead of the facets — which is
   * what `GAL::DrawCircle` gives KiCad at every zoom. See `RING_VERT`.
   *
   * Set only for an arc that sweeps a full turn AND begins its own subpath, so
   * the marker can never disagree with the points beside it: a circle joined
   * onto an existing run (a rounded pad corner, say) is geometry within a
   * larger outline and is left as a polyline.
   */
  circle?: { cx: number; cy: number; r: number };
}

/**
 * The `DOMMatrix` subset `buildScene` uses: `translate(...).rotate(...)`.
 *
 * Both return a **new** matrix, matching `DOMMatrix` — its mutating forms are
 * the separate `translateSelf`/`rotateSelf`. Getting that backwards would make
 * pad placement accumulate transforms across pads, which is the kind of bug that
 * looks like "some footprints drift" rather than like a wrong matrix.
 */
export class GlMatrix {
  constructor(readonly m: Mat = IDENT) {}

  translate(tx: number, ty: number): GlMatrix {
    return new GlMatrix(mul(this.m, [1, 0, 0, 1, tx, ty]));
  }

  /** Degrees, as `DOMMatrix.rotate` takes them. */
  rotate(deg: number): GlMatrix {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return new GlMatrix(mul(this.m, [c, s, -s, c, 0, 0]));
  }
}

/**
 * The item every new run is attributed to, for the length of one `buildScene`.
 *
 * Scoped like `renderBoard`'s own path factory rather than threaded: the
 * builder is synchronous, and threading an owner through thirteen helpers
 * would bury a bookkeeping detail inside the KiCad-derived geometry.
 */
let currentOwner: string | undefined;

/** Attribute everything recorded from here on to `id` (undefined clears it). */
export const setPathOwner = (id: string | undefined): void => {
  currentOwner = id;
};

export class GlPath {
  readonly subpaths: SubPath[] = [];
  /** The open subpath being appended to, if any. */
  private cur: SubPath | null = null;

  private startNew(p: Pt): SubPath {
    const sp: SubPath = { pts: [p], closed: false, owner: currentOwner };
    this.subpaths.push(sp);
    this.cur = sp;
    return sp;
  }

  /** Current point, which `arc`/`arcTo` need to know whether to bridge. */
  private tip(): Pt | null {
    const c = this.cur;
    return c && c.pts.length > 0 ? c.pts[c.pts.length - 1]! : null;
  }

  moveTo(x: number, y: number): void {
    this.startNew({ x, y });
  }

  lineTo(x: number, y: number): void {
    if (!this.cur) this.startNew({ x, y });
    else this.cur.pts.push({ x, y });
  }

  /**
   * Canvas2D's `arc`: if a subpath is open, a straight line joins the current
   * point to the arc's start before the arc itself. Omitting that bridge leaves
   * a visible gap wherever a rounded outline is built as line-then-arc, which is
   * how every pad and slot in `buildScene` is drawn.
   */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    const pts = arcToPolyline(cx, cy, r, a0, a1, ccw);
    if (pts.length === 0) return;
    const whole = this.startsAWholeCircle(a0, a1, pts[0]!);
    if (this.cur) for (const p of pts) this.cur.pts.push(p);
    else {
      this.startNew(pts[0]!);
      for (let i = 1; i < pts.length; i++) this.cur!.pts.push(pts[i]!);
    }
    if (whole && this.cur) this.cur.circle = { cx, cy, r };
  }

  /**
   * Is this arc a full turn that owns the run it is being written into?
   *
   * Two callers draw a circle: one with no open subpath at all, and one that
   * did `moveTo(cx + r, cy)` first so the shared bucket does not join this
   * circle to the last one with a straight line. The second is what
   * `renderBoard` does for a `PCB_POINT`'s ring, so both have to count — but
   * the seed point must be the arc's own start, or the run holds something
   * else as well and is not a circle.
   */
  private startsAWholeCircle(a0: number, a1: number, start: Pt): boolean {
    if (Math.abs(a1 - a0) < Math.PI * 2 - 1e-9) return false;
    const c = this.cur;
    if (!c) return true;
    if (c.pts.length !== 1 || c.circle) return false;
    const seed = c.pts[0]!;
    return Math.abs(seed.x - start.x) < 1e-6 && Math.abs(seed.y - start.y) < 1e-6;
  }

  /**
   * Canvas2D's `arcTo`: the arc of radius `r` tangent to both the line from the
   * current point to (x1,y1) and the line from (x1,y1) to (x2,y2).
   *
   * Degenerate inputs — no current point, coincident points, a zero radius, or
   * three collinear points — all fall back to a straight line to (x1,y1), which
   * is what the spec requires.
   */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    const p0 = this.tip();
    if (!p0) {
      this.moveTo(x1, y1);
      return;
    }
    const d1x = p0.x - x1;
    const d1y = p0.y - y1;
    const d2x = x2 - x1;
    const d2y = y2 - y1;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 === 0 || l2 === 0 || r <= 0) {
      this.lineTo(x1, y1);
      return;
    }
    const u1 = { x: d1x / l1, y: d1y / l1 };
    const u2 = { x: d2x / l2, y: d2y / l2 };
    const cosT = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
    const theta = Math.acos(cosT);
    // Collinear either way: no arc fits, so the corner is a plain line.
    if (!Number.isFinite(theta) || theta < 1e-9 || Math.PI - theta < 1e-9) {
      this.lineTo(x1, y1);
      return;
    }
    const tanHalf = Math.tan(theta / 2);
    const t = r / tanHalf;
    // The tangent points, and the centre along the angle bisector.
    const t1 = { x: x1 + u1.x * t, y: y1 + u1.y * t };
    const t2 = { x: x1 + u2.x * t, y: y1 + u2.y * t };
    const bx = u1.x + u2.x;
    const by = u1.y + u2.y;
    const bl = Math.hypot(bx, by);
    if (bl === 0) {
      this.lineTo(x1, y1);
      return;
    }
    const dCentre = r / Math.sin(theta / 2);
    const c = { x: x1 + (bx / bl) * dCentre, y: y1 + (by / bl) * dCentre };
    const a0 = Math.atan2(t1.y - c.y, t1.x - c.x);
    const a1 = Math.atan2(t2.y - c.y, t2.x - c.x);
    // The sweep is always the minor arc (theta is in (0, pi), so the arc is
    // pi - theta); normalising the delta into (-pi, pi] picks it without
    // needing to reason about winding.
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    this.lineTo(t1.x, t1.y);
    this.arc(c.x, c.y, r, a0, a0 + delta, delta < 0);
  }

  /** A closed rectangle as its own subpath; the current point resets to (x,y). */
  rect(x: number, y: number, w: number, h: number): void {
    this.subpaths.push({
      pts: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      closed: true,
      // As `startNew` does. A subpath built here bypasses it, and the emit-time
      // `sp.owner ?? currentOwner` cannot cover for that: a bucket path is
      // appended to directly rather than copied through `addPath`, so by the
      // time it is emitted `buildScene` has already reset the owner to
      // undefined. An untagged subpath has no entry in `Scene.itemRanges`, so
      // `moveItems` cannot find it -- which is why a dragged footprint left its
      // courtyard behind: the courtyard is an `fp_rect`, and it was the only
      // part of the footprint that did not reach the buffer through `startNew`.
      owner: currentOwner,
    });
    this.cur = null;
    this.moveTo(x, y);
  }

  /**
   * A closed rounded rectangle as its own subpath.
   *
   * Only the uniform-radius form is implemented, because that is the only form
   * `buildScene` calls: pads, slots and drill ovals all pass a single number.
   * A per-corner array takes its first entry rather than pretending to support
   * four, and a radius larger than the box is clamped, as the spec requires.
   */
  roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
    const raw = Array.isArray(radii) ? (radii[0] ?? 0) : radii;
    const r = Math.max(0, Math.min(raw, Math.abs(w) / 2, Math.abs(h) / 2));
    if (r === 0) {
      this.rect(x, y, w, h);
      return;
    }
    const HALF_PI = Math.PI / 2;
    const pts: Pt[] = [];
    // Corner centres, clockwise from top-left, each swept a quarter turn. The
    // angles match Canvas2D's y-down convention, which is also board space.
    const corner = (cx: number, cy: number, a0: number): void => {
      for (const p of arcToPolyline(cx, cy, r, a0, a0 + HALF_PI)) pts.push(p);
    };
    corner(x + w - r, y + r, -HALF_PI); // top-right
    corner(x + w - r, y + h - r, 0); // bottom-right
    corner(x + r, y + h - r, HALF_PI); // bottom-left
    corner(x + r, y + r, Math.PI); // top-left
    // Owned for the same reason as `rect` above.
    this.subpaths.push({ pts, closed: true, owner: currentOwner });
    this.cur = null;
  }

  closePath(): void {
    const c = this.cur;
    if (!c || c.pts.length === 0) return;
    c.closed = true;
    // Canvas2D starts a fresh subpath at the closed one's first point.
    const first = c.pts[0]!;
    this.cur = null;
    this.moveTo(first.x, first.y);
  }

  /**
   * Append another path's subpaths, optionally transformed.
   *
   * This is how `buildScene` places pads: it builds the shape at the origin and
   * adds it under a translate/rotate. The points are transformed as they are
   * copied, so the result stays plain world geometry with no transform to carry.
   */
  addPath(other: GlPath, m?: GlMatrix): void {
    const t = m?.m;
    for (const sp of other.subpaths) {
      this.subpaths.push({
        pts: t ? sp.pts.map((p) => apply(t, p)) : sp.pts.map((p) => ({ ...p })),
        closed: sp.closed,
        // Ownership survives the copy, or every pad — which reaches its bucket
        // through `addPath` from a scratch path — would land in the buffer
        // unattributed, and a footprint could not be moved in place.
        owner: sp.owner ?? currentOwner,
      });
    }
    // An appended path leaves no current point, matching Path2D.
    this.cur = null;
  }

  /** Whether anything at all was recorded. */
  get isEmpty(): boolean {
    return this.subpaths.every((s) => s.pts.length < 2);
  }
}

/**
 * The factory handed to `buildScene`.
 *
 * The casts are the price of the agreed design: `BoardScene` keeps its concrete
 * `Path2D` type so that `pcb3d.ts`, `FootprintCanvas.tsx` and
 * `footprint_preview_widget.tsx` need no changes, and the GL side — the only
 * code that passes this factory — knows what it actually put in there.
 */
export const GL_PATH_FACTORY = {
  path: (): Path2D => new GlPath() as unknown as Path2D,
  matrix: (): DOMMatrix => new GlMatrix() as unknown as DOMMatrix,
  setOwner: setPathOwner,
};

/** Read a bucket back as what the factory actually created. */
export const asGlPath = (p: Path2D): GlPath => p as unknown as GlPath;
