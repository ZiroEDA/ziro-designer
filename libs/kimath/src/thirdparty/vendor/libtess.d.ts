/**
 * libtess.js 1.2.2 (brendankenny), the JavaScript port of SGI's GLU
 * polygon tesselator — the same libtess the C++ reaches through
 * `gluNewTess`/`gluTessVertex`. SGI Free Software License B 2.0; see
 * libtess-LICENSE.txt. `export default libtess` replaces the CommonJS tail.
 */
declare namespace libtess {
  const windingRule: {
    GLU_TESS_WINDING_ODD: number;
    GLU_TESS_WINDING_NONZERO: number;
    GLU_TESS_WINDING_POSITIVE: number;
    GLU_TESS_WINDING_NEGATIVE: number;
    GLU_TESS_WINDING_ABS_GEQ_TWO: number;
  };
  const gluEnum: {
    GLU_TESS_WINDING_RULE: number;
    GLU_TESS_BOUNDARY_ONLY: number;
    GLU_TESS_TOLERANCE: number;
    GLU_TESS_BEGIN: number;
    GLU_TESS_VERTEX: number;
    GLU_TESS_END: number;
    GLU_TESS_ERROR: number;
    GLU_TESS_EDGE_FLAG: number;
    GLU_TESS_COMBINE: number;
    GLU_TESS_BEGIN_DATA: number;
    GLU_TESS_VERTEX_DATA: number;
    GLU_TESS_END_DATA: number;
    GLU_TESS_ERROR_DATA: number;
    GLU_TESS_EDGE_FLAG_DATA: number;
    GLU_TESS_COMBINE_DATA: number;
  };
  const primitiveType: {
    GL_LINE_LOOP: number;
    GL_TRIANGLES: number;
    GL_TRIANGLE_STRIP: number;
    GL_TRIANGLE_FAN: number;
  };
  class GluTesselator {
    gluTessProperty(which: number, value: number): void;
    gluGetTessProperty(which: number): number;
    gluTessNormal(x: number, y: number, z: number): void;
    // biome-ignore lint/suspicious/noExplicitAny: the C callbacks take arbitrary user data
    gluTessCallback(which: number, fn: ((...args: any[]) => void) | null): void;
    gluTessBeginPolygon(data: unknown): void;
    gluTessBeginContour(): void;
    gluTessVertex(coords: ArrayLike<number>, data: unknown): void;
    gluTessEndContour(): void;
    gluTessEndPolygon(): void;
    gluDeleteTess(): void;
  }
}
export default libtess;
