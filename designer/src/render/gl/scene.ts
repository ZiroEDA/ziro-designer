// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The geometry a frame is made of, in world coordinates, ready for the GPU.
 *
 * ### Why this shape
 *
 * Canvas2D re-rasterises every path on the CPU each frame, so a zoom step on a
 * 118-symbol sheet costs about 70 ms of blocking work and the wheel stutters at
 * roughly 14 fps (issue #449). The fix is the one KiCad's OpenGL GAL and
 * EasyEDA both use: put the geometry on the GPU once and let a zoom be a change
 * of one matrix.
 *
 * That only works if the geometry does not depend on the zoom. Ours nearly
 * does not: the schematic renderer consults the view scale in exactly four
 * places, and all four are the same idea, "never draw this thinner than N
 * screen pixels" or "stop drawing this once it is smaller than N screen
 * pixels". So instead of baking a scale-dependent width at record time, a
 * primitive carries **both** its world width and its minimum width in device
 * pixels, and the shader takes the larger. KiCad does exactly this with its
 * `u_minLinePixelWidth` uniform (`common/gal/shaders/kicad_vert.glsl`).
 *
 * The result is a buffer that stays valid at every zoom level and needs
 * rebuilding only when the document, the theme or the display options change.
 *
 * ### Three primitive kinds
 *
 * **Segments** carry almost everything. A round-capped segment covers our
 * strokes, and because the stroke font is itself polylines, it covers all text
 * too. That is a real simplification over EasyEDA, which needs a glyph atlas
 * texture because it draws outline fonts.
 *
 * **Discs** are filled circles, common enough (every junction is one) to be
 * worth a primitive that stays perfectly round at any zoom rather than being
 * frozen into a fixed number of facets at record time.
 *
 * **Triangles** are filled areas, triangulated when recorded.
 *
 * Segments and discs are drawn **instanced**: one instance per primitive
 * against a shared four-vertex quad, rather than four vertices each. On a dense
 * sheet the stroke font alone contributes something like a hundred thousand
 * segments, so the difference is a few megabytes against twenty.
 */

/** A growable Float32Array, since the primitive count is not known up front. */
export class F32Buffer {
  private data: Float32Array;
  private len = 0;

  constructor(initialCapacity = 1024) {
    this.data = new Float32Array(Math.max(1, initialCapacity));
  }

  /** How many floats have been written. */
  get length(): number {
    return this.len;
  }

  /** Make room for `extra` more floats. */
  private ensure(extra: number): void {
    if (this.len + extra <= this.data.length) return;
    const next = new Float32Array(Math.max(this.data.length * 2, this.len + extra));
    next.set(this.data.subarray(0, this.len));
    this.data = next;
  }

  /**
   * Append exactly ten floats: one segment instance.
   *
   * Spelled out rather than taking a rest parameter, which is what this was.
   * A rest parameter allocates an array on every call, and this is called once
   * per segment: a dense sheet records 30,000 of them, so it was 30,000
   * short-lived arrays and about half a megabyte of garbage per record, with
   * a collection every couple of records. Measured on the same workload,
   * fixed-arity writes are seven times faster, and the jitter they remove is
   * worth more than the milliseconds: the collections are what turned a 60 ms
   * record into the 100 to 260 ms outliers.
   */
  push10(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number,
    i: number,
    j: number,
  ): void {
    this.ensure(10);
    const t = this.data;
    let n = this.len;
    t[n++] = a;
    t[n++] = b;
    t[n++] = c;
    t[n++] = d;
    t[n++] = e;
    t[n++] = f;
    t[n++] = g;
    t[n++] = h;
    t[n++] = i;
    t[n++] = j;
    this.len = n;
  }

  /** Append exactly eight floats: one disc instance. */
  push8(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number,
  ): void {
    this.ensure(8);
    const t = this.data;
    let n = this.len;
    t[n++] = a;
    t[n++] = b;
    t[n++] = c;
    t[n++] = d;
    t[n++] = e;
    t[n++] = f;
    t[n++] = g;
    t[n++] = h;
    this.len = n;
  }

  /** Append exactly six floats: one triangle vertex. */
  push6(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ensure(6);
    const t = this.data;
    let n = this.len;
    t[n++] = a;
    t[n++] = b;
    t[n++] = c;
    t[n++] = d;
    t[n++] = e;
    t[n++] = f;
    this.len = n;
  }

  /** Append one glyph vertex: position(2), texture coords(2), rgba(4). */
  pushGlyph(
    x: number,
    y: number,
    u: number,
    v: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    this.ensure(8);
    const t = this.data;
    let n = this.len;
    t[n++] = x;
    t[n++] = y;
    t[n++] = u;
    t[n++] = v;
    t[n++] = r;
    t[n++] = g;
    t[n++] = b;
    t[n++] = a;
    this.len = n;
  }

  /** A view of exactly the written floats. Not a copy: valid until the next push. */
  view(): Float32Array {
    return this.data.subarray(0, this.len);
  }

  clear(): void {
    this.len = 0;
  }
}

/**
 * Added to a segment's positive `minPx` to mark it as *atlas* text (the pad
 * and via net-name strokes that stand in for the OpenGL GAL's mipmapped
 * bitmap-font atlas). Far above any real pixel floor, so the shader can
 * recover both the flag and the value; see SEGMENT_VERT.
 */
export const BITMAP_MINPX_FLAG = 1024;

/** Floats per segment instance: p0(2) p1(2) halfWidth minPx rgba(4). */
export const SEGMENT_STRIDE = 10;
/** Floats per disc instance: centre(2) radius minPx rgba(4). */
export const DISC_STRIDE = 8;
/** Floats per triangle vertex: position(2) rgba(4). */
export const TRIANGLE_STRIDE = 6;
/** Floats per glyph vertex: position(2) texture coords(2) rgba(4). */
export const GLYPH_VERTEX_STRIDE = 8;
/** Vertices per glyph: two triangles, not indexed. */
export const GLYPH_VERTICES = 6;

/** Premultiplied-alpha-free RGBA, each channel 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Which program draws a run. */
export type RunKind = 'tri' | 'seg' | 'disc' | 'glyph';

/**
 * A maximal stretch of consecutive primitives of one kind.
 *
 * `start` and `count` are in that kind's own units: vertices for `tri`,
 * instances for `seg` and `disc`.
 */
export interface Run {
  kind: RunKind;
  start: number;
  count: number;
}

/**
 * One frame's geometry.
 *
 * Everything is in **world** (internal) units. Nothing here knows the zoom,
 * which is the property that lets the same buffers serve every view of the
 * document.
 *
 * ### Painter's order across the three kinds
 *
 * The three buffers each keep the order they were recorded in, but between
 * them the order is lost, and drawing all fills, then all strokes, then all
 * discs is not the same picture. On a schematic it is: there is one layer, and
 * a fill is nearly always under its own outline anyway. On a **board** it is
 * badly wrong — `buildDrawSteps` walks the layers in `PCB_PAINT_ORDER`, so an
 * inner-layer track is painted before, and therefore under, the front copper
 * pour. Drawing every stroke after every fill lifts every inner-layer track out
 * from under every pour, and a four-layer board comes out looking like a net of
 * wires laid over the top of it.
 *
 * So an ordered scene also records **runs**: the boundaries where the kind
 * changes. The device then issues one draw per run in record order instead of
 * three draws in kind order, which reproduces the painter's sequence exactly.
 *
 * It is opt-in because the cost is a draw call per run, and the two callers sit
 * at opposite ends. The board alternates per layer and per bucket, so its runs
 * are bounded by layers x buckets — a few hundred, and crucially **independent
 * of how much is on the board**, which is the property the retained buffer
 * exists to protect. The schematic alternates per *item*, so ordering it would
 * cost thousands of draw calls a frame to fix a difference nobody can see.
 */
/**
 * Where one board item's vertices live, per buffer.
 *
 * Each entry is `[first, count]` in that buffer's own units — instances for
 * segments and discs, vertices for triangles. An item usually has several,
 * because its geometry is spread over the layers and buckets it draws on.
 *
 * This is our answer to KiCad's `CACHED_CONTAINER`, which gives every item a
 * chunk of the cached vertex buffer so that moving one rewrites only its own
 * vertices (`VIEW::Update` → "recache it immediately"). Without it, nudging a
 * footprint means re-recording the whole board — measured at 1228 ms on the
 * coldfire demo, which is the freeze that made dragging unusable.
 */
export interface ItemRanges {
  seg: [number, number][];
  disc: [number, number][];
  tri: [number, number][];
}

export class Scene {
  readonly segments = new F32Buffer(4096);
  readonly discs = new F32Buffer(256);
  readonly triangles = new F32Buffer(1024);
  /**
   * Textured quads sampled from the bitmap-font atlas — the pad numbers and net
   * names KiCad draws with `BitmapText` rather than with the stroke font.
   *
   * Only the per-frame net-name passes record these, so the buffer starts small
   * and is rebuilt each frame from what is actually on screen.
   */
  readonly glyphs = new F32Buffer(512);
  /** Empty on an unordered scene; the device then falls back to three draws. */
  readonly runs: Run[] = [];
  /** Vertex ranges per board item; empty unless the recorder named owners. */
  readonly itemRanges = new Map<string, ItemRanges>();
  /**
   * Named points in the run list, for drawing something else at that depth.
   *
   * KiCad interleaves by giving every layer a depth over one buffer
   * (`VIEW::redrawRect` → `SetLayerDepth`). We draw in painter's order, so the
   * equivalent is to stop the run walk at a known layer boundary, draw the
   * per-frame pass, and carry on — which is what lets back-side net names sit
   * under the inner layers and the front pour, where pcbnew puts them, instead
   * of being faked with a fixed attenuation.
   */
  readonly marks = new Map<string, number>();
  private owner: string | undefined;
  private segMark = 0;
  private discMark = 0;
  private triMark = 0;

  constructor(private readonly ordered = false) {}

  /**
   * Attribute everything recorded from here on to `id`.
   *
   * Closing the previous item's ranges here rather than tracking every push
   * keeps the hot path — a million triangle vertices — free of bookkeeping.
   */
  setItem(id: string | undefined): void {
    if (id === this.owner) return;
    this.closeItem();
    this.owner = id;
    this.segMark = this.segmentCount;
    this.discMark = this.discCount;
    this.triMark = this.triangleVertexCount;
  }

  /** Remember that `name` falls here in the run list. */
  mark(name: string): void {
    if (this.ordered) this.marks.set(name, this.runs.length);
  }

  /** Close the open item's ranges; call once when a recording finishes. */
  closeItem(): void {
    const id = this.owner;
    if (id === undefined) return;
    let r = this.itemRanges.get(id);
    if (!r) {
      r = { seg: [], disc: [], tri: [] };
      this.itemRanges.set(id, r);
    }
    if (this.segmentCount > this.segMark)
      r.seg.push([this.segMark, this.segmentCount - this.segMark]);
    if (this.discCount > this.discMark)
      r.disc.push([this.discMark, this.discCount - this.discMark]);
    if (this.triangleVertexCount > this.triMark)
      r.tri.push([this.triMark, this.triangleVertexCount - this.triMark]);
    this.owner = undefined;
  }

  /**
   * Extend the open run, or start a new one when the kind changes.
   *
   * `count` is in the kind's own units, so a triangle adds three.
   */
  private note(kind: RunKind, count: number): void {
    if (!this.ordered) return;
    const last = this.runs[this.runs.length - 1];
    if (last && last.kind === kind) {
      last.count += count;
      return;
    }
    const start =
      kind === 'tri'
        ? this.triangleVertexCount - count
        : kind === 'seg'
          ? this.segmentCount - count
          : kind === 'glyph'
            ? this.glyphVertexCount - count
            : this.discCount - count;
    this.runs.push({ kind, start, count });
  }

  /**
   * A round-capped segment of world half-width `halfWidth`, never drawn
   * narrower than `minPx` device pixels of half-width.
   *
   * Zero-length segments are kept: a one-point stroke is a dot, which is how
   * the stroke font draws a full stop, and the fragment shader's distance test
   * renders it as a disc without any special case.
   */
  segment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    halfWidth: number,
    minPx: number,
    c: Rgba,
  ): void {
    this.segments.push10(x0, y0, x1, y1, halfWidth, minPx, c.r, c.g, c.b, c.a);
    this.note('seg', 1);
  }

  /** A filled circle that stays round at every zoom. */
  disc(cx: number, cy: number, radius: number, minPx: number, c: Rgba): void {
    this.discs.push8(cx, cy, radius, minPx, c.r, c.g, c.b, c.a);
    this.note('disc', 1);
  }

  /** One filled triangle. Callers triangulate; see `tessellate.ts`. */
  triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: Rgba): void {
    this.triangles.push6(ax, ay, c.r, c.g, c.b, c.a);
    this.triangles.push6(bx, by, c.r, c.g, c.b, c.a);
    this.triangles.push6(cx, cy, c.r, c.g, c.b, c.a);
    this.note('tri', 3);
  }

  /**
   * One glyph from the bitmap-font atlas: the four corners of its box, already
   * placed in world coordinates by `layoutBitmapText`, and its atlas window.
   *
   * Two triangles rather than an instanced quad, because unlike a segment or a
   * disc every corner carries its own texture coordinate and the rectangle can
   * be rotated — there is no shared unit quad to expand from.
   */
  glyph(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    c: Rgba,
  ): void {
    const g = this.glyphs;
    g.pushGlyph(x0, y0, u0, v0, c.r, c.g, c.b, c.a);
    g.pushGlyph(x1, y1, u1, v0, c.r, c.g, c.b, c.a);
    g.pushGlyph(x2, y2, u0, v1, c.r, c.g, c.b, c.a);
    g.pushGlyph(x1, y1, u1, v0, c.r, c.g, c.b, c.a);
    g.pushGlyph(x2, y2, u0, v1, c.r, c.g, c.b, c.a);
    g.pushGlyph(x3, y3, u1, v1, c.r, c.g, c.b, c.a);
    this.note('glyph', GLYPH_VERTICES);
  }

  get segmentCount(): number {
    return this.segments.length / SEGMENT_STRIDE;
  }
  get glyphVertexCount(): number {
    return this.glyphs.length / GLYPH_VERTEX_STRIDE;
  }
  get discCount(): number {
    return this.discs.length / DISC_STRIDE;
  }
  get triangleVertexCount(): number {
    return this.triangles.length / TRIANGLE_STRIDE;
  }

  /** Whether anything at all was recorded. */
  get isEmpty(): boolean {
    return (
      this.segments.length === 0 &&
      this.discs.length === 0 &&
      this.triangles.length === 0 &&
      this.glyphs.length === 0
    );
  }

  clear(): void {
    this.segments.clear();
    this.discs.clear();
    this.triangles.clear();
    this.glyphs.clear();
    this.runs.length = 0;
    this.marks.clear();
    this.itemRanges.clear();
    this.owner = undefined;
    this.segMark = 0;
    this.discMark = 0;
    this.triMark = 0;
  }

  /**
   * Shift one item's vertices by (dx, dy), in place.
   *
   * The whole point of the per-item ranges: a drag is a translation, so the
   * item's recorded geometry does not have to be rebuilt, only moved. Returns
   * the ranges touched so the caller can re-upload exactly those bytes.
   */
  translateItem(id: string, dx: number, dy: number): ItemRanges | null {
    const r = this.itemRanges.get(id);
    if (!r) return null;
    const seg = this.segments.view();
    for (const [first, count] of r.seg) {
      for (let i = 0; i < count; i++) {
        const o = (first + i) * SEGMENT_STRIDE;
        seg[o] = (seg[o] ?? 0) + dx;
        seg[o + 1] = (seg[o + 1] ?? 0) + dy;
        seg[o + 2] = (seg[o + 2] ?? 0) + dx;
        seg[o + 3] = (seg[o + 3] ?? 0) + dy;
      }
    }
    const disc = this.discs.view();
    for (const [first, count] of r.disc) {
      for (let i = 0; i < count; i++) {
        const o = (first + i) * DISC_STRIDE;
        disc[o] = (disc[o] ?? 0) + dx;
        disc[o + 1] = (disc[o + 1] ?? 0) + dy;
      }
    }
    const tri = this.triangles.view();
    for (const [first, count] of r.tri) {
      for (let i = 0; i < count; i++) {
        const o = (first + i) * TRIANGLE_STRIDE;
        tri[o] = (tri[o] ?? 0) + dx;
        tri[o + 1] = (tri[o + 1] ?? 0) + dy;
      }
    }
    return r;
  }
}

/**
 * Parse the CSS colours the renderer already produces.
 *
 * It emits `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgba(r,g,b,a)`, because those
 * are what `cssColor()` and the theme files between them generate. Anything
 * unrecognised comes back opaque black rather than throwing, matching Canvas2D,
 * which silently ignores a colour it cannot parse.
 */
export function parseColor(css: string): Rgba {
  const s = css.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const n = (i: number, len: number): number =>
      len === 1
        ? Number.parseInt(hex[i]! + hex[i]!, 16) / 255
        : Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    if (hex.length === 3) return { r: n(0, 1), g: n(1, 1), b: n(2, 1), a: 1 };
    if (hex.length === 6) return { r: n(0, 2), g: n(2, 2), b: n(4, 2), a: 1 };
    if (hex.length === 8) return { r: n(0, 2), g: n(2, 2), b: n(4, 2), a: n(6, 2) };
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1]!.split(',').map((p) => Number.parseFloat(p.trim()));
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    return { r: r / 255, g: g / 255, b: b / 255, a: Number.isFinite(a) ? a : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}
