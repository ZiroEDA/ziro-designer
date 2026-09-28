// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The shape of a tessellation, and the tolerances KiCad tessellates at.
 *
 * Split from `occt_tessellate.ts` so the cache and its tests can import the
 * types and the constants without pulling in the WASM kernel behind them —
 * that module's `?url` import of the 7.6 MB binary is a Vite construct that
 * neither `tsc` outside the app nor a test runner can resolve.
 *
 * STEP is not a mesh. It is B-rep — NURBS patches, analytic solids, trimmed
 * surfaces — so nothing can draw it until a kernel evaluates those surfaces
 * and meshes them to a tolerance. That is what makes STEP hundreds of times
 * slower to open than an already-tessellated format, on every platform: KiCad
 * pays it too, which is why it keeps `<hash>.3dc` files under its user cache
 * (`3d-viewer/3d_cache/3d_cache.cpp:305`) and tessellates each model once ever.
 *
 * This module is deliberately free of three.js so the worker that calls it does
 * not drag a renderer into its bundle. It returns plain typed arrays, which
 * are also exactly what IndexedDB can structured-clone into the cache.
 */

/**
 * KiCad's tessellation tolerances, mirrored rather than chosen.
 *
 * `ADVANCED_CFG` defaults, `common/advanced_config.cpp:298-299`:
 *
 *     m_OcePluginLinearDeflection  = 0.14;
 *     m_OcePluginAngularDeflection = 30;
 *
 * and `plugins/3d/oce/loadmodel.cpp:1158` feeds them straight to
 * `BRepMesh_IncrementalMesh( face, linDeflection, false, radians( angular ) )`.
 * This is **data** in the sense CLAUDE.md means — a pair of numbers KiCad
 * hardcodes — so it is mirrored, not tuned. Matching them is what makes our
 * curves break into the same facets KiCad's do; measured on the four models
 * CM5 Minima actually renders, the defaults give 41,628 triangles against
 * KiCad's 24,684, so a model looked visibly different from the same file.
 *
 * The angle is in DEGREES. occt-import-js takes degrees where KiCad's C++ call
 * takes radians (it converts with `glm::radians`), and passing 0.5236 here is
 * silently accepted as an extremely fine angle: same four models, 13.79 s and
 * 38,354 triangles, against 9.81 s and 24,684 for the correct 30.
 */
export const OCE_LINEAR_DEFLECTION = 0.14;
export const OCE_ANGULAR_DEFLECTION = 30;

/**
 * `read.precision.val` is set from the same linear deflection upstream
 * (`plugins/3d/oce/loadmodel.cpp:601`), and the models are millimetres in
 * KiCad model space.
 */
export const OCCT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: OCE_LINEAR_DEFLECTION,
  angularDeflection: OCE_ANGULAR_DEFLECTION,
} as const;

/** One BREP face's triangle range and its own colour, when STEP carries one. */
export interface TessFace {
  first: number;
  last: number;
  color: [number, number, number] | null;
}

/** One mesh, in the compact form the cache stores and the loader rebuilds from. */
export interface TessMesh {
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array;
  color: [number, number, number] | null;
  faces: TessFace[] | null;
}

export interface Tessellation {
  meshes: TessMesh[];
}

export type CadKind = 'step' | 'iges';

/**
 * Every buffer the result holds, so a worker can transfer rather than copy it.
 * A board's models run to tens of megabytes of vertex data; structured-cloning
 * that twice (worker -> main, then main -> IndexedDB) is the one avoidable cost
 * in the whole path.
 */
export function tessellationBuffers(t: Tessellation): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const m of t.meshes) {
    out.push(m.position.buffer as ArrayBuffer);
    if (m.normal) out.push(m.normal.buffer as ArrayBuffer);
    out.push(m.index.buffer as ArrayBuffer);
  }
  return out;
}

/** Total bytes of geometry, for the cache's size accounting. */
export function tessellationBytes(t: Tessellation): number {
  let n = 0;
  for (const m of t.meshes) {
    n += m.position.byteLength + (m.normal?.byteLength ?? 0) + m.index.byteLength;
  }
  return n;
}
