// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The OpenCascade kernel itself: read STEP/IGES bytes, hand back the compact
 * form in `occt_types.ts`.
 *
 * Everything that does not need the kernel lives in that module instead, so
 * importing the cache does not pull 7.6 MB of WASM (and a Vite-only `?url`
 * import) into a test runner or a type check.
 */
import { type CadKind, OCCT_PARAMS, type TessMesh, type Tessellation } from './occt_types.js';

interface OcctFace {
  first: number;
  last: number;
  color?: [number, number, number] | null;
}
interface OcctMesh {
  name?: string;
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
  color?: [number, number, number] | null;
  brep_faces?: OcctFace[];
}
interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}
interface OcctModule {
  ReadStepFile(content: Uint8Array, params: unknown): OcctResult;
  ReadIgesFile(content: Uint8Array, params: unknown): OcctResult;
}

let occtPromise: Promise<OcctModule> | null = null;

// Lazy singleton: the WASM kernel is ~7.6 MB, fetched only when a project
// actually ships a STEP/IGES model that is not already in the cache.
function occt(): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const [{ default: init }, { default: wasmUrl }] = await Promise.all([
        import('occt-import-js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
      return (await init({ locateFile: () => wasmUrl })) as OcctModule;
    })();
  }
  return occtPromise;
}

function compact(result: OcctResult): Tessellation | null {
  if (!result.success || result.meshes.length === 0) return null;
  const meshes: TessMesh[] = [];
  for (const mesh of result.meshes) {
    // occt-import-js hands back plain number[]; the typed copy is what makes
    // the result cheap to transfer, cheap to store, and directly usable as a
    // three.js buffer attribute without a second pass.
    meshes.push({
      position: Float32Array.from(mesh.attributes.position.array),
      normal: mesh.attributes.normal ? Float32Array.from(mesh.attributes.normal.array) : null,
      index: Uint32Array.from(mesh.index.array),
      color: mesh.color ?? null,
      faces:
        mesh.brep_faces && mesh.brep_faces.length > 0
          ? mesh.brep_faces.map((f) => ({ first: f.first, last: f.last, color: f.color ?? null }))
          : null,
    });
  }
  return { meshes };
}

/**
 * Tessellate STEP or IGES content. `null` means the kernel could not read it —
 * a distinct outcome from "not tried", which is why the cache stores it.
 */
export async function tessellate(bytes: Uint8Array, kind: CadKind): Promise<Tessellation | null> {
  try {
    const mod = await occt();
    const result =
      kind === 'step' ? mod.ReadStepFile(bytes, OCCT_PARAMS) : mod.ReadIgesFile(bytes, OCCT_PARAMS);
    return compact(result);
  } catch {
    return null;
  }
}
