// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Load a STEP/IGES model into a three.js object, in the browser. Counterpart:
 * `plugins/3d/occ/loadmodel.cpp` — KiCad tessellates these formats with its
 * OpenCascade kernel; we use the same kernel compiled to WASM
 * (occt-import-js), lazy-loaded on first use so boards without project-local
 * CAD models never pay for it.
 *
 * Three things happen here, in the order KiCad does them
 * (`3d-viewer/3d_cache/3d_cache.cpp:255-315`):
 *
 *   1. hash the file's bytes,
 *   2. answer from the cache if those exact bytes have been tessellated before,
 *   3. otherwise run the kernel — in a worker — and cache what comes back.
 *
 * Step 2 is the whole performance story. Tessellation is 1.5-2x slower here
 * than in native KiCad (measured: 10.99 s of WASM against a 6.87 s
 * `kicad-cli pcb export glb` for the same four models), which is the ordinary
 * WASM penalty and not something a different library fixes. Nobody pays it
 * twice, on either side.
 *
 * Geometry comes out in the file's native millimetres, KiCad model space, with
 * per-BREP-face STEP colors mapped to one material per color, exactly as our
 * offline library converter does for the hosted `.glb` set.
 */
import * as THREE from 'three';
import type { CadKind, Tessellation } from './occt_types.js';
import { tessellate } from './occt_tessellate.js';
import type { OcctRequest, OcctResponse } from './occt_worker.js';
import { cacheGet, cachePut, modelKey } from './model_cache.js';

function toObject3D(tess: Tessellation): THREE.Object3D | null {
  if (tess.meshes.length === 0) return null;
  const root = new THREE.Group();
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const materialFor = (color: [number, number, number] | null): THREE.MeshStandardMaterial => {
    const key = color ? color.join(',') : 'default';
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: color ? new THREE.Color(color[0], color[1], color[2]) : 0xcccccc,
        metalness: 0.1,
        roughness: 0.6,
      });
      matCache.set(key, m);
    }
    return m;
  };

  for (const mesh of tess.meshes) {
    const position = new THREE.Float32BufferAttribute(mesh.position, 3);
    const normal = mesh.normal ? new THREE.Float32BufferAttribute(mesh.normal, 3) : null;
    const allIdx = mesh.index;

    // STEP colors are per-BREP-face; group triangle ranges by color into one
    // mesh per color, sharing the vertex buffers.
    const groups = new Map<
      string,
      { color: [number, number, number] | null; ranges: [number, number][] }
    >();
    const faces = mesh.faces ?? [
      { first: 0, last: allIdx.length / 3 - 1, color: mesh.color ?? null },
    ];
    for (const f of faces) {
      const color = f.color ?? mesh.color ?? null;
      const key = color ? color.join(',') : 'default';
      let g = groups.get(key);
      if (!g) {
        g = { color, ranges: [] };
        groups.set(key, g);
      }
      g.ranges.push([f.first, f.last]);
    }

    for (const { color, ranges } of groups.values()) {
      let n = 0;
      for (const [a, b] of ranges) n += (b - a + 1) * 3;
      const idx = new Uint32Array(n);
      let o = 0;
      for (const [a, b] of ranges) {
        idx.set(allIdx.subarray(a * 3, (b + 1) * 3), o);
        o += (b - a + 1) * 3;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', position);
      if (normal) geom.setAttribute('normal', normal);
      else geom.computeVertexNormals();
      geom.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
      root.add(new THREE.Mesh(geom, materialFor(color)));
    }
  }
  return root;
}

interface Pending {
  resolve: (t: Tessellation | null) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/**
 * The kernel worker, or null where there is no `Worker` to make one from
 * (happy-dom under test, and any environment that has taken workers away).
 * A missing worker must degrade to a slow main thread, never to a blank board.
 */
function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') {
    workerBroken = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./occt_worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<OcctResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      p.resolve(e.data.tess);
    };
    // A worker that dies takes every in-flight request with it. Answer them
    // (as failures) rather than leaving their promises hanging forever, and
    // fall back to the main thread from here on.
    worker.onerror = () => {
      workerBroken = true;
      worker = null;
      for (const [, p] of pending) p.resolve(null);
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function runTessellation(bytes: Uint8Array, kind: CadKind): Promise<Tessellation | null> {
  const w = ensureWorker();
  if (!w) return tessellate(bytes, kind);
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve });
    const req: OcctRequest = { id, bytes, kind };
    // `bytes` belongs to the project's file list and is read again on every
    // board load, so it is copied to the worker rather than transferred.
    w.postMessage(req);
  });
}

/**
 * Tessellate STEP (or IGES) file content to a three.js object; null on failure.
 *
 * Answers from the cache when these exact bytes have been seen before — on
 * this board, another board, or a previous session.
 */
export async function loadCadModel(
  bytes: Uint8Array,
  kind: CadKind,
): Promise<THREE.Object3D | null> {
  let hash: string | null = null;
  try {
    hash = await modelKey(bytes);
  } catch {
    // No SubtleCrypto (an insecure origin, say). Tessellate uncached rather
    // than refuse to draw the model.
    hash = null;
  }

  if (hash) {
    const hit = await cacheGet(hash);
    // A row with `tess: null` is a remembered failure: the kernel already
    // could not read these bytes, and re-running it would cost seconds to
    // reach the same answer.
    if (hit) return hit.tess ? toObject3D(hit.tess) : null;
  }

  const tess = await runTessellation(bytes, kind);
  if (hash) await cachePut(hash, tess);
  return tess ? toObject3D(tess) : null;
}
