// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from SGI's GLU libtess (Mesa glu 9.0.2, src/libtess/tess.c and render.c),
// SGI Free Software License B 2.0.
/**
 * `include/kicad_gl/kiglu.h`: KiCad's GLU, which on Linux is Mesa's libGLU - SGI's libtess.
 *
 * libtess.js is the same sweep, but it dropped SGI's vertex cache, and the cache changes the
 * output. `gluTessVertex` holds up to TESS_MAX_CACHE vertices of the polygon's FIRST contour
 * without building a mesh; when `gluTessEndPolygon` finds the polygon still cached (one contour,
 * under 100 vertices, no edge-flag callback) it tries `__gl_renderCache`, which emits the contour
 * as one fan (or one line loop, boundary-only) from its first vertex when every fan triangle has
 * the same orientation. libtess.js would sweep it instead and start the loop elsewhere. This class
 * is that front end, in front of libtess.js for everything else.
 */
import libtess from '@ziroeda/kimath/src/thirdparty/vendor/libtess.js';

/** tess.h: `#define TESS_MAX_CACHE 100`. */
const TESS_MAX_CACHE = 100;
/** render.c: ComputeNormal's "no consistent orientation". */
const SIGN_INCONSISTENT = 2;

export const GLU_TESS_WINDING_ODD = libtess.windingRule.GLU_TESS_WINDING_ODD;
export const GLU_TESS_WINDING_NONZERO = libtess.windingRule.GLU_TESS_WINDING_NONZERO;
export const GLU_TESS_WINDING_POSITIVE = libtess.windingRule.GLU_TESS_WINDING_POSITIVE;
export const GLU_TESS_WINDING_NEGATIVE = libtess.windingRule.GLU_TESS_WINDING_NEGATIVE;
export const GLU_TESS_WINDING_ABS_GEQ_TWO = libtess.windingRule.GLU_TESS_WINDING_ABS_GEQ_TWO;

export const GLU_TESS_WINDING_RULE = libtess.gluEnum.GLU_TESS_WINDING_RULE;
export const GLU_TESS_BOUNDARY_ONLY = libtess.gluEnum.GLU_TESS_BOUNDARY_ONLY;
export const GLU_TESS_BEGIN_DATA = libtess.gluEnum.GLU_TESS_BEGIN_DATA;
export const GLU_TESS_VERTEX_DATA = libtess.gluEnum.GLU_TESS_VERTEX_DATA;
export const GLU_TESS_END_DATA = libtess.gluEnum.GLU_TESS_END_DATA;
export const GLU_TESS_ERROR_DATA = libtess.gluEnum.GLU_TESS_ERROR_DATA;
export const GLU_TESS_COMBINE_DATA = libtess.gluEnum.GLU_TESS_COMBINE_DATA;
export const GLU_TESS_EDGE_FLAG = libtess.gluEnum.GLU_TESS_EDGE_FLAG;
export const GLU_TESS_EDGE_FLAG_DATA = libtess.gluEnum.GLU_TESS_EDGE_FLAG_DATA;

export const GL_LINE_LOOP = libtess.primitiveType.GL_LINE_LOOP;
export const GL_TRIANGLES = libtess.primitiveType.GL_TRIANGLES;
export const GL_TRIANGLE_STRIP = libtess.primitiveType.GL_TRIANGLE_STRIP;
export const GL_TRIANGLE_FAN = libtess.primitiveType.GL_TRIANGLE_FAN;

interface CachedVertex {
  coords: [number, number, number];
  data: unknown;
}

// biome-ignore lint/suspicious/noExplicitAny: the C callbacks take arbitrary user data
type Callback = (...args: any[]) => void;

/** A `GLUtesselator*`: SGI's tess.c front end over libtess.js's sweep. */
export class GLUtesselator {
  private readonly m_tess = new libtess.GluTesselator();
  private m_windingRule = GLU_TESS_WINDING_ODD;
  private m_boundaryOnly = false;
  private m_normal: [number, number, number] = [0, 0, 0];
  private m_flagBoundary = false;
  private m_begin: Callback | null = null;
  private m_vertex: Callback | null = null;
  private m_end: Callback | null = null;

  /** tess->mesh != NULL: the cache was emptied into libtess.js. */
  private m_meshed = false;
  private m_cache: CachedVertex[] = [];
  private m_emptyCache = false;
  private m_polygonData: unknown = null;

  gluTessProperty(aWhich: number, aValue: number): void {
    if (aWhich === GLU_TESS_WINDING_RULE) this.m_windingRule = aValue;
    else if (aWhich === GLU_TESS_BOUNDARY_ONLY) this.m_boundaryOnly = aValue !== 0;

    this.m_tess.gluTessProperty(aWhich, aValue);
  }

  gluTessNormal(aX: number, aY: number, aZ: number): void {
    this.m_normal = [aX, aY, aZ];
    this.m_tess.gluTessNormal(aX, aY, aZ);
  }

  gluTessCallback(aWhich: number, aFn: Callback | null): void {
    if (aWhich === GLU_TESS_BEGIN_DATA) this.m_begin = aFn;
    else if (aWhich === GLU_TESS_VERTEX_DATA) this.m_vertex = aFn;
    else if (aWhich === GLU_TESS_END_DATA) this.m_end = aFn;
    else if (aWhich === GLU_TESS_EDGE_FLAG || aWhich === GLU_TESS_EDGE_FLAG_DATA)
      this.m_flagBoundary = aFn !== null;

    this.m_tess.gluTessCallback(aWhich, aFn);
  }

  gluTessBeginPolygon(aData: unknown): void {
    this.m_cache = [];
    this.m_emptyCache = false;
    this.m_meshed = false;
    this.m_polygonData = aData;
  }

  gluTessBeginContour(): void {
    // Just set a flag so we don't get confused by empty contours.
    if (this.m_cache.length > 0) this.m_emptyCache = true;
    else if (this.m_meshed) this.m_tess.gluTessBeginContour();
  }

  /** `EmptyCache`: the cached contour becomes libtess.js's first. */
  private emptyCache(aContinue: boolean): void {
    this.m_tess.gluTessBeginPolygon(this.m_polygonData);
    this.m_tess.gluTessBeginContour();

    for (const v of this.m_cache) this.m_tess.gluTessVertex(v.coords, v.data);

    // A new contour has begun (aContinue false): the cached one is closed and the new one opens.
    if (!aContinue) {
      this.m_tess.gluTessEndContour();
      this.m_tess.gluTessBeginContour();
    }

    this.m_cache = [];
    this.m_emptyCache = false;
    this.m_meshed = true;
  }

  gluTessVertex(aCoords: ArrayLike<number>, aData: unknown): void {
    if (this.m_emptyCache) this.emptyCache(false);

    const coords: [number, number, number] = [aCoords[0]!, aCoords[1]!, aCoords[2]!];

    if (!this.m_meshed) {
      if (this.m_cache.length < TESS_MAX_CACHE) {
        this.m_cache.push({ coords, data: aData });
        return;
      }

      this.emptyCache(true);
    }

    this.m_tess.gluTessVertex(coords, aData);
  }

  gluTessEndContour(): void {
    if (this.m_meshed) this.m_tess.gluTessEndContour();
  }

  gluTessEndPolygon(): void {
    if (!this.m_meshed) {
      if (!this.m_flagBoundary && this.renderCache()) {
        this.m_cache = [];
        this.m_polygonData = null;
        return;
      }

      // EmptyCache, the contour already ended.
      this.m_tess.gluTessBeginPolygon(this.m_polygonData);

      if (this.m_cache.length > 0) {
        this.m_tess.gluTessBeginContour();

        for (const v of this.m_cache) this.m_tess.gluTessVertex(v.coords, v.data);

        this.m_tess.gluTessEndContour();
      }

      this.m_cache = [];
      this.m_meshed = true;
    }

    this.m_tess.gluTessEndPolygon();
    this.m_meshed = false;
    this.m_polygonData = null;
  }

  gluDeleteTess(): void {
    this.m_tess.gluDeleteTess();
  }

  /** render.c `ComputeNormal`. */
  private computeNormal(norm: [number, number, number], check: boolean): number {
    const c = this.m_cache;
    const v0 = c[0]!.coords;
    let sign = 0;

    if (!check) norm[0] = norm[1] = norm[2] = 0.0;

    let xc = c[1]!.coords[0] - v0[0];
    let yc = c[1]!.coords[1] - v0[1];
    let zc = c[1]!.coords[2] - v0[2];

    for (let i = 2; i < c.length; ++i) {
      const xp = xc;
      const yp = yc;
      const zp = zc;
      xc = c[i]!.coords[0] - v0[0];
      yc = c[i]!.coords[1] - v0[1];
      zc = c[i]!.coords[2] - v0[2];

      // Compute (vp - v0) cross (vc - v0)
      const n0 = yp * zc - zp * yc;
      const n1 = zp * xc - xp * zc;
      const n2 = xp * yc - yp * xc;

      const dot = n0 * norm[0] + n1 * norm[1] + n2 * norm[2];

      if (!check) {
        // Reverse the contribution of back-facing triangles to get
        // a reasonable normal for self-intersecting polygons
        if (dot >= 0) {
          norm[0] += n0;
          norm[1] += n1;
          norm[2] += n2;
        } else {
          norm[0] -= n0;
          norm[1] -= n1;
          norm[2] -= n2;
        }
      } else if (dot !== 0) {
        // Check the new orientation for consistency with previous triangles
        if (dot > 0) {
          if (sign < 0) return SIGN_INCONSISTENT;

          sign = 1;
        } else {
          if (sign > 0) return SIGN_INCONSISTENT;

          sign = -1;
        }
      }
    }

    return sign;
  }

  /** render.c `__gl_renderCache`: true when the cached contour was rendered (or is empty). */
  private renderCache(): boolean {
    const c = this.m_cache;

    // Degenerate contour -- no output
    if (c.length < 3) return true;

    const norm: [number, number, number] = [...this.m_normal];

    if (norm[0] === 0 && norm[1] === 0 && norm[2] === 0) this.computeNormal(norm, false);

    const sign = this.computeNormal(norm, true);

    // Fan triangles did not have a consistent orientation
    if (sign === SIGN_INCONSISTENT) return false;

    // All triangles were degenerate
    if (sign === 0) return true;

    // Make sure we do the right thing for each winding rule
    switch (this.m_windingRule) {
      case GLU_TESS_WINDING_ODD:
      case GLU_TESS_WINDING_NONZERO:
        break;
      case GLU_TESS_WINDING_POSITIVE:
        if (sign < 0) return true;
        break;
      case GLU_TESS_WINDING_NEGATIVE:
        if (sign > 0) return true;
        break;
      case GLU_TESS_WINDING_ABS_GEQ_TWO:
        return true;
    }

    const data = this.m_polygonData;

    this.m_begin?.(
      this.m_boundaryOnly ? GL_LINE_LOOP : c.length > 3 ? GL_TRIANGLE_FAN : GL_TRIANGLES,
      data,
    );
    this.m_vertex?.(c[0]!.data, data);

    if (sign > 0) {
      for (let i = 1; i < c.length; ++i) this.m_vertex?.(c[i]!.data, data);
    } else {
      for (let i = c.length - 1; i > 0; --i) this.m_vertex?.(c[i]!.data, data);
    }

    this.m_end?.(data);
    return true;
  }
}

/** `gluNewTess()`. */
export function gluNewTess(): GLUtesselator {
  return new GLUtesselator();
}
