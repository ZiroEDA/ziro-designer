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

  /** A view of exactly the written floats. Not a copy: valid until the next push. */
  view(): Float32Array {
    return this.data.subarray(0, this.len);
  }

  clear(): void {
    this.len = 0;
  }
}

/** Floats per segment instance: p0(2) p1(2) halfWidth minPx rgba(4). */
export const SEGMENT_STRIDE = 10;
/** Floats per disc instance: centre(2) radius minPx rgba(4). */
export const DISC_STRIDE = 8;
/** Floats per triangle vertex: position(2) rgba(4). */
export const TRIANGLE_STRIDE = 6;

/** Premultiplied-alpha-free RGBA, each channel 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * One frame's geometry.
 *
 * Everything is in **world** (internal) units. Nothing here knows the zoom,
 * which is the property that lets the same buffers serve every view of the
 * document.
 */
export class Scene {
  readonly segments = new F32Buffer(4096);
  readonly discs = new F32Buffer(256);
  readonly triangles = new F32Buffer(1024);

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
  }

  /** A filled circle that stays round at every zoom. */
  disc(cx: number, cy: number, radius: number, minPx: number, c: Rgba): void {
    this.discs.push8(cx, cy, radius, minPx, c.r, c.g, c.b, c.a);
  }

  /** One filled triangle. Callers triangulate; see `tessellate.ts`. */
  triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: Rgba): void {
    this.triangles.push6(ax, ay, c.r, c.g, c.b, c.a);
    this.triangles.push6(bx, by, c.r, c.g, c.b, c.a);
    this.triangles.push6(cx, cy, c.r, c.g, c.b, c.a);
  }

  get segmentCount(): number {
    return this.segments.length / SEGMENT_STRIDE;
  }
  get discCount(): number {
    return this.discs.length / DISC_STRIDE;
  }
  get triangleVertexCount(): number {
    return this.triangles.length / TRIANGLE_STRIDE;
  }

  /** Whether anything at all was recorded. */
  get isEmpty(): boolean {
    return this.segments.length === 0 && this.discs.length === 0 && this.triangles.length === 0;
  }

  clear(): void {
    this.segments.clear();
    this.discs.clear();
    this.triangles.clear();
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
