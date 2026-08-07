// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `CanvasRenderingContext2D`-shaped recorder that produces GPU geometry.
 *
 * ### Why a recorder rather than a new renderer
 *
 * `renderer.ts` is three thousand lines of carefully matched KiCad drawing
 * behaviour, and rewriting it against a graphics API would be rewriting the
 * part we most want to keep. It does not need rewriting, because it already
 * draws through a small 2D-context interface rather than against the browser's:
 * `plot.ts` has three other backends behind that same interface (SVG, DXF and
 * PostScript), which is what the schematic plotters are.
 *
 * So this is a fourth backend. The renderer is untouched, the drawing logic
 * stays in one place, and the two backends can be compared against each other
 * on the same document, which is how visual parity gets checked.
 *
 * The whole surface used by `renderer.ts` is 26 members, counted from the
 * source; they are all here.
 *
 * ### Everything is recorded in world coordinates
 *
 * The current transform is applied to points as they are recorded, but the view
 * transform is **not** part of it: the caller sets up the recorder without the
 * pan and zoom that `renderer.ts` would normally hand to `setTransform`, and
 * the shader applies those from a uniform. That is what lets one recorded
 * buffer serve every zoom level, and it is the entire point of the exercise
 * (see `scene.ts`).
 *
 * Widths are the one subtlety. A caller asking for "one screen pixel" writes
 * `lineWidth = 1 / scale`, which would bake the zoom into the geometry. The
 * recorder is told the scale that such requests were computed against
 * (`referenceScale`) so it can turn them back into a minimum pixel width and
 * let the shader re-derive the value per frame.
 */

import { arcToPolyline, dashPolyline, triangulatePolygon, type Pt } from './tessellate.js';
import { parseColor, type Rgba, type Scene } from './scene.js';

/** 2D affine transform as Canvas orders it: [a, b, c, d, e, f]. */
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Mat, x: number, y: number): Pt => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

/** The uniform scale a transform carries, for turning widths into world units. */
const matScale = (m: Mat): number => {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  return (sx + sy) / 2 || 1;
};

interface State {
  ctm: Mat;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  dash: number[];
}

/**
 * One subpath: its points interleaved as x, y, x, y, and whether `closePath`
 * was called on it.
 *
 * A flat array rather than `{x, y}` objects because this is the hot path and
 * almost all of it is text. The stroke font is polylines, so glyphs arrive here
 * as `moveTo`/`lineTo` like everything else, and they are 88.8% of every
 * segment a dense sheet records: an object per point meant tens of thousands of
 * short-lived allocations per record, which is most of the garbage that turned
 * a 60 ms record into a 260 ms one.
 */
interface SubPath {
  pts: number[];
  closed: boolean;
}

export interface RecorderOptions {
  /**
   * The view scale that the caller's `1 / scale` width requests were computed
   * against. A stroke whose world width works out to `k / referenceScale` is
   * recorded as "at least k device pixels" instead, so the shader can apply it
   * at whatever the current zoom turns out to be.
   *
   * Defaults to 1, which records widths as pure world units.
   */
  referenceScale?: number;
  /** Device pixel ratio, so a minimum pixel width means a *device* pixel. */
  devicePixelRatio?: number;
  /**
   * Drop the canvas-clearing `fillRect` that `renderSchematic` issues first.
   *
   * It paints the background across the whole canvas in *device* coordinates,
   * under the identity transform, which is meaningful to Canvas2D and
   * meaningless here: this backend records world coordinates, and the device
   * clears to the background colour itself. Recording it would put a pair of
   * triangles the size of the canvas-in-world-units under the document.
   */
  skipFirstFillRect?: boolean;
  /**
   * Subtracted from every recorded point, so the buffer holds true world
   * coordinates.
   *
   * The caller has to record through a *shifted* view: `renderer.ts` culls to
   * the visible rect, whose left edge is `-offsetX / scale`, so recording with
   * no offset would silently drop everything at a negative coordinate. The
   * shift keeps the cull open, and this takes it back out again, which leaves
   * the shader free to apply the real view with nothing else mixed in.
   */
  originX?: number;
  originY?: number;
  /**
   * The view scale the caller recorded *through*, divided back out of every
   * point and width so the buffer holds world units.
   *
   * Recording at scale 1 was the obvious thing and it was wrong. `renderer.ts`
   * derives several screen-space quantities from the view scale, not just
   * widths: the selection halo is
   * `highlightThickness / scale + highlightThickness * MIL`, a field's
   * umbilical is `max(1, 1 / scale)`, and a selected field's anchor cross has a
   * zoom-compensated radius. At scale 1 those all collapse to one or two
   * internal units, and since a millimetre is a million of them, they are drawn
   * perfectly and are invisible.
   *
   * So recording runs at the real view scale, which makes those correct, and
   * this takes the scale back out of the geometry.
   */
  worldScale?: number;
}

/**
 * Records drawing calls into a {@link Scene}.
 *
 * Deliberately not `implements CanvasRenderingContext2D`: that interface has a
 * hundred-odd members and claiming all of them would be a lie. The renderer's
 * parameter type is structural, so what matters is that everything it actually
 * calls is here, which `qa/unittests/designer/gl_context_surface.test.ts`
 * checks against the source rather than against a promise in a comment.
 */
export class GlRecorder {
  private st: State = {
    ctm: IDENT,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    dash: [],
  };
  private stack: State[] = [];
  private subs: SubPath[] = [];
  private cur: SubPath | null = null;
  private readonly refScale: number;
  private readonly dpr: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly worldScale: number;
  private pendingSkipFillRect: boolean;

  // Canvas2D exposes these as plain properties, so they are plain properties.
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  font = '';
  textAlign = '';

  constructor(
    readonly scene: Scene,
    opts: RecorderOptions = {},
  ) {
    this.refScale = opts.referenceScale && opts.referenceScale > 0 ? opts.referenceScale : 1;
    this.dpr = opts.devicePixelRatio && opts.devicePixelRatio > 0 ? opts.devicePixelRatio : 1;
    this.pendingSkipFillRect = opts.skipFirstFillRect === true;
    this.originX = opts.originX ?? 0;
    this.originY = opts.originY ?? 0;
    this.worldScale = opts.worldScale && opts.worldScale > 0 ? opts.worldScale : 1;
  }

  /**
   * Transform a point and append it to `sub`, taking the record-time view back
   * out of it. Writes two numbers; allocates nothing.
   */
  private pushPt(sub: SubPath, x: number, y: number): void {
    const m = this.st.ctm;
    sub.pts.push(
      (m[0] * x + m[2] * y + m[4] - this.originX) / this.worldScale,
      (m[1] * x + m[3] * y + m[5] - this.originY) / this.worldScale,
    );
  }

  // ----- transform ---------------------------------------------------------

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.st.ctm = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    this.st.ctm = mul(this.st.ctm, [1, 0, 0, 1, x, y]);
  }
  rotate(t: number): void {
    this.st.ctm = mul(this.st.ctm, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
  }
  scale(x: number, y: number): void {
    this.st.ctm = mul(this.st.ctm, [x, 0, 0, y, 0, 0]);
  }
  save(): void {
    this.sync();
    this.stack.push({ ...this.st, dash: [...this.st.dash] });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.st = s;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.lineCap = s.lineCap;
    this.lineJoin = s.lineJoin;
    this.globalAlpha = s.globalAlpha;
  }
  setLineDash(d: number[]): void {
    this.st.dash = [...d];
  }
  /**
   * Clipping is accepted and ignored.
   *
   * The renderer clips only to the visible rect, which the GPU does anyway by
   * discarding fragments outside the viewport. Silently ignoring it is right
   * here and would not be if it were ever used to clip to a shape.
   */
  clip(): void {}

  /** Copy the public properties into the state the drawing calls read. */
  private sync(): void {
    this.st.fillStyle = this.fillStyle;
    this.st.strokeStyle = this.strokeStyle;
    this.st.lineWidth = this.lineWidth;
    this.st.lineCap = this.lineCap;
    this.st.lineJoin = this.lineJoin;
    this.st.globalAlpha = this.globalAlpha;
  }

  // ----- path building -----------------------------------------------------

  beginPath(): void {
    this.subs = [];
    this.cur = null;
  }
  moveTo(x: number, y: number): void {
    this.cur = { pts: [], closed: false };
    this.pushPt(this.cur, x, y);
    this.subs.push(this.cur);
  }
  lineTo(x: number, y: number): void {
    // Canvas2D treats a lineTo with no current point as a moveTo.
    if (!this.cur) {
      this.moveTo(x, y);
      return;
    }
    this.pushPt(this.cur, x, y);
  }
  closePath(): void {
    if (this.cur && this.cur.pts.length > 2) this.cur.closed = true;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
    this.cur = null;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    const poly = arcToPolyline(cx, cy, r, a0, a1, ccw);
    if (poly.length === 0) return;
    // Canvas joins an arc to the current subpath rather than starting one.
    if (!this.cur) {
      this.cur = { pts: [], closed: false };
      this.subs.push(this.cur);
    }
    for (const p of poly) this.pushPt(this.cur, p.x, p.y);
  }
  /**
   * A cubic, flattened uniformly.
   *
   * Used once in the renderer, for a sheet-pin decoration, so a fixed
   * subdivision is plenty and keeps the flattening independent of the zoom.
   */
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.cur) this.moveTo(c1x, c1y);
    const cur = this.cur!;
    const n = cur.pts.length;
    const x0 = cur.pts[n - 2]!;
    const y0 = cur.pts[n - 1]!;
    // The control points transformed once, without allocating a point each.
    const m = this.st.ctm;
    const tx = (px: number, py: number): number =>
      (m[0] * px + m[2] * py + m[4] - this.originX) / this.worldScale;
    const ty = (px: number, py: number): number =>
      (m[1] * px + m[3] * py + m[5] - this.originY) / this.worldScale;
    const x1 = tx(c1x, c1y),
      y1 = ty(c1x, c1y);
    const x2 = tx(c2x, c2y),
      y2 = ty(c2x, c2y);
    const x3 = tx(x, y),
      y3 = ty(x, y);
    const STEPS = 16;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const u = 1 - t;
      cur.pts.push(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      );
    }
  }

  // ----- painting ----------------------------------------------------------

  /**
   * The world half-width and minimum device-pixel half-width for the current
   * pen.
   *
   * A caller asking for `k / referenceScale` world units means "k screen
   * pixels", so that is recorded as a pixel minimum and the world width drops
   * to zero. Anything larger is a genuine world width, and still gets a
   * one-device-pixel floor, which is what KiCad's `u_minLinePixelWidth` does
   * and what stops a hairline vanishing when zoomed out.
   */
  private pen(): { half: number; minPx: number } {
    // The true world half-width, and a constant one-device-pixel floor.
    //
    // This used to classify: a width that worked out to about a screen pixel at
    // the recording scale was stored as `half: 0` plus a *scale-derived*
    // `minPx`, and anything larger as a world width plus a constant floor. Both
    // halves of that were a mistake, and profiling put numbers on it: `minPx`
    // then differed on 98% of segments between one zoom octave and the next,
    // which is the entire reason the buffer had to be re-recorded on a zoom at
    // all. Each of those re-records cost 50 to 100 ms and produced, for eight
    // consecutive octaves, byte-identical output.
    //
    // The classification was also wrong on its own terms: whether a stroke fell
    // above or below the threshold depended on the zoom, so the same wire
    // changed category mid-gesture and its width jumped.
    //
    // A minimum line width belongs to the view, not to a vertex. It is one
    // uniform decision applied at draw time, which is what KiCad's
    // `u_minLinePixelWidth` is and what `SEGMENT_VERT` already does with
    // `max(a_halfWidth * abs(u_view.x), a_minPx)`. Storing the world width and
    // letting the shader clamp makes the geometry genuinely independent of the
    // zoom, which is what lets the buffer be recorded once and never again.
    const world = (Math.max(0, this.st.lineWidth) * matScale(this.st.ctm)) / this.worldScale;
    return { half: world / 2, minPx: this.dpr / 2 };
  }

  private color(css: string, alpha: number): Rgba {
    const c = parseColor(css);
    return alpha >= 1 ? c : { ...c, a: c.a * alpha };
  }

  stroke(): void {
    this.sync();
    const { half, minPx } = this.pen();
    const c = this.color(this.st.strokeStyle, this.st.globalAlpha);
    const dashed = this.st.dash.length > 0 && this.st.dash.some((d) => d > 0);
    for (const sub of this.subs) {
      const p = sub.pts;
      if (p.length === 2) {
        // A lone point strokes as a dot under a round cap, which is how the
        // stroke font draws a full stop.
        this.scene.segment(p[0]!, p[1]!, p[0]!, p[1]!, half, minPx, c);
        continue;
      }
      if (p.length < 4) continue;

      if (!dashed) {
        // The common path, and the one text takes: straight from the flat point
        // list into instances, with nothing allocated in between.
        for (let i = 2; i < p.length; i += 2) {
          this.scene.segment(p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!, half, minPx, c);
        }
        if (sub.closed) {
          this.scene.segment(p[p.length - 2]!, p[p.length - 1]!, p[0]!, p[1]!, half, minPx, c);
        }
        continue;
      }

      // Dashed strokes are rare, so they can afford the point objects that
      // `dashPolyline` works in.
      const pts: Pt[] = [];
      for (let i = 0; i < p.length; i += 2) pts.push({ x: p[i]!, y: p[i + 1]! });
      if (sub.closed) pts.push({ x: p[0]!, y: p[1]! });
      for (const run of dashPolyline(pts, this.st.dash)) {
        for (let i = 1; i < run.length; i++) {
          const a = run[i - 1]!;
          const b = run[i]!;
          this.scene.segment(a.x, a.y, b.x, b.y, half, minPx, c);
        }
      }
    }
  }

  fill(): void {
    this.sync();
    const c = this.color(this.st.fillStyle, this.st.globalAlpha);
    for (const sub of this.subs) {
      if (sub.pts.length < 6) continue;
      // Fills are a few hundred triangles against tens of thousands of
      // segments, so the point objects the triangulator works in cost nothing
      // worth avoiding.
      const poly: Pt[] = [];
      for (let i = 0; i < sub.pts.length; i += 2) poly.push({ x: sub.pts[i]!, y: sub.pts[i + 1]! });
      const tri = triangulatePolygon(poly);
      for (let i = 0; i + 2 < tri.length; i += 3) {
        const a = poly[tri[i]!]!;
        const b = poly[tri[i + 1]!]!;
        const d = poly[tri[i + 2]!]!;
        this.scene.triangle(a.x, a.y, b.x, b.y, d.x, d.y, c);
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (this.pendingSkipFillRect) {
      this.pendingSkipFillRect = false;
      return;
    }
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
  }

  /**
   * Filled text is not recorded.
   *
   * Every glyph the schematic renderer draws goes through the stroke font,
   * which arrives here as ordinary polylines; `fillText` is reached only by the
   * plot backends' own paths. Drawing nothing is better than drawing something
   * in the wrong font.
   */
  fillText(): void {}

  /**
   * Images are not recorded yet.
   *
   * Reference images and logos need a textured quad and a texture cache, which
   * is its own piece of work. Until then a document containing one renders
   * without it under this backend, which is why the backend is not yet the
   * default. Tracked in the follow-up on issue #449.
   */
  drawImage(): void {}
}
