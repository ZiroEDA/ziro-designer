// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The STEP/IGES tessellation cache, run against a real IndexedDB.
 *
 * Everything here is silent when wrong. Tessellation is seconds per model
 * (measured: 4.5 s for a 2.5 MB connector, 46 s for a 24 MB module), so a
 * cache that quietly misses does not fail — it just makes every board open
 * slowly, which looks exactly like a board being big. These are the four ways
 * that happens:
 *
 *   - keyed by anything but content, so an edited model keeps its stale mesh;
 *   - a kernel failure not remembered, so it is re-attempted every open;
 *   - eviction dropping the wrong rows;
 *   - the tolerances drifting off KiCad's, which changes what a model looks
 *     like rather than whether it appears.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheClear,
  cacheGet,
  cachePut,
  cacheSweepAged,
  cleanup3dCache,
  modelKey,
} from '@ziroeda/designer/src/editors/pcb/model_cache.js';
import {
  OCCT_PARAMS,
  OCE_ANGULAR_DEFLECTION,
  OCE_LINEAR_DEFLECTION,
  type Tessellation,
  tessellationBytes,
} from '@ziroeda/designer/src/editors/pcb/occt_types.js';

const enc = new TextEncoder();

/** A tessellation of `tris` triangles, so a row has a predictable byte cost. */
const mesh = (tris: number): Tessellation => ({
  meshes: [
    {
      position: new Float32Array(tris * 9),
      normal: null,
      index: new Uint32Array(tris * 3),
      color: null,
      faces: null,
    },
  ],
});

beforeEach(async () => {
  await cacheClear();
});
afterEach(async () => {
  await cacheClear();
});

describe('the cache key is the model file content', () => {
  it('answers for the same bytes and misses for edited bytes', async () => {
    const original = enc.encode('ISO-10303-21;\nHEADER;\nthe original solid\nEND-ISO-10303-21;');
    const edited = enc.encode('ISO-10303-21;\nHEADER;\nthe edited  solid\nEND-ISO-10303-21;');

    const k1 = await modelKey(original);
    await cachePut(k1, mesh(4));

    // Same bytes: a hit, with the geometry we stored.
    const again = await cacheGet(await modelKey(original));
    expect(again?.tess?.meshes[0]?.index.length).toBe(12);

    // Edited bytes: a different key, so a miss. This is the entire staleness
    // mechanism - there is no mtime, no comparison and no sidecar file, and if
    // the key were the path or the basename this would wrongly return the
    // stale mesh for a model that has changed.
    expect(await cacheGet(await modelKey(edited))).toBeUndefined();
  });

  it('is unaffected by the name a model is stored under', async () => {
    // Real projects carry `TRJG0926HENL .stp` (trailing space), `(rev1)`, and
    // `.step`/`.stp`/`.STEP` for the same format. None of that reaches the key.
    const bytes = enc.encode('solid');
    expect(await modelKey(bytes)).toBe(await modelKey(new Uint8Array(bytes)));
  });
});

describe('a kernel failure is remembered', () => {
  it('is a hit, and is distinct from never having tried', async () => {
    const key = await modelKey(enc.encode('not a STEP file at all'));

    expect(await cacheGet(key)).toBeUndefined(); // never tried

    await cachePut(key, null); // the kernel could not read it

    const hit = await cacheGet(key);
    // Present, so the caller does not re-run the kernel...
    expect(hit).toBeDefined();
    // ...and carrying no geometry, so the caller draws nothing.
    expect(hit?.tess).toBeNull();
  });
});

describe('eviction', () => {
  it('drops least-recently-used rows until it is under the cap', async () => {
    const a = await modelKey(enc.encode('model-a'));
    const b = await modelKey(enc.encode('model-b'));
    const c = await modelKey(enc.encode('model-c'));
    const one = tessellationBytes(mesh(100));

    // Two fit; the third does not.
    await cachePut(a, mesh(100), one * 2);
    await cachePut(b, mesh(100), one * 2);
    expect(await cacheGet(a)).toBeDefined();

    await cachePut(c, mesh(100), one * 2);

    // `a` was touched by the `cacheGet` above, so `b` is the oldest and goes.
    expect(await cacheGet(b)).toBeUndefined();
    expect(await cacheGet(a)).toBeDefined();
    expect(await cacheGet(c)).toBeDefined();
  });

  it('keeps everything while under the cap', async () => {
    const keys = await Promise.all(['x', 'y', 'z'].map((n) => modelKey(enc.encode(`model-${n}`))));
    for (const k of keys) await cachePut(k, mesh(10), 10 * 1024 * 1024);
    for (const k of keys) expect(await cacheGet(k)).toBeDefined();
  });
});

/** A day in ms, so the ages below read as days rather than as arithmetic. */
const DAY = 24 * 60 * 60 * 1000;

/** `cacheGet` touches its row without awaiting; let that transaction land. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Preferences > Maintenance > "3D cache file duration", which is
 * `S3D_CACHE::CleanCacheDir` (`3d-viewer/3d_cache/3d_cache.cpp:609-647`)
 * reached from `PROJECT_PCB::Cleanup3DCache` (`pcbnew/project_pcb.cpp:97-118`)
 * as the board frame closes.
 *
 * Only `Date` is faked, and the clock only ever moves FORWARD -- across tests,
 * not just within one. `stamp()` clamps every stamp above the last one it
 * issued and is module state that no test can reset, so a block that set the
 * clock back would get the previous test's timestamps instead of the ones it
 * asked for, and would pass or fail on the order the file happened to run in.
 */
describe('ageing rows out', () => {
  let clock = Date.now();
  /** Move the clock on by `ms` and return the absolute time it now reads. */
  const advance = (ms: number): number => {
    clock += ms;
    vi.setSystemTime(new Date(clock));
    return clock;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    advance(DAY);
  });
  afterEach(() => vi.useRealTimers());

  it('drops what has not been used inside the window and keeps what has', async () => {
    const stale = await modelKey(enc.encode('a connector nobody has opened since'));
    const fresh = await modelKey(enc.encode('the regulator on the board in front of you'));

    await cachePut(stale, mesh(4));
    advance(100 * DAY);
    await cachePut(fresh, mesh(4));

    // 40 days: `stale` was last touched 100 days ago, `fresh` just now.
    expect(await cacheSweepAged(40)).toBe(1);
    expect(await cacheGet(stale)).toBeUndefined();
    expect(await cacheGet(fresh)).toBeDefined();
  });

  it('counts from the last READ, not from when the model was tessellated', async () => {
    // The whole reason `cacheGet` writes `usedAt` back on a hit. Upstream this
    // is the filesystem's access time and comes for free; ours is a column, and
    // a cache that aged by insertion date would throw away the models a user
    // opens every day and keep the ones they opened once.
    const k = await modelKey(enc.encode('opened on every board'));
    await cachePut(k, mesh(4));

    advance(100 * DAY);
    expect(await cacheGet(k)).toBeDefined(); // ...which touches it.
    await settle();

    advance(10 * DAY);
    expect(await cacheSweepAged(40)).toBe(0);
  });

  it('is `IsEarlierThan`: a row used exactly `days` ago stays', async () => {
    const k = await modelKey(enc.encode('right on the boundary'));
    const put = advance(DAY);
    await cachePut(k, mesh(4));

    expect(await cacheSweepAged(30, put + 30 * DAY)).toBe(0);
    expect(await cacheSweepAged(30, put + 30 * DAY + 1)).toBe(1);
  });

  it('clears nothing at all at 0, which is what the tooltip promises', async () => {
    // "If set to 0, cache clearing is disabled" -- and the guard is upstream's
    // (`project_pcb.cpp:114`), NOT a special case inside the sweep: at 0 the
    // threshold IS now, so a sweep called with it would empty the cache. The
    // setting that turns clearing off would turn it all the way up.
    const k = await modelKey(enc.encode('a model from years ago'));
    await cachePut(k, mesh(4));
    advance(1000 * DAY);

    expect(await cleanup3dCache(0)).toBe(0);
    // The row is still there to be swept, which is what proves the line above
    // kept it. Asking `cacheGet` would TOUCH it and answer a different question.
    expect(await cleanup3dCache(30)).toBe(1);
    expect(await cacheGet(k)).toBeUndefined();
  });
});

describe("the tolerances are KiCad's", () => {
  it('mirrors ADVANCED_CFG, in the units occt-import-js reads', () => {
    // common/advanced_config.cpp:298-299.
    expect(OCE_LINEAR_DEFLECTION).toBe(0.14);
    expect(OCE_ANGULAR_DEFLECTION).toBe(30);

    // What actually reaches ReadStepFile. The deflection must be absolute
    // millimetres, not a bounding-box ratio, because 0.14 is a length in
    // KiCad's C++ (BRepMesh_IncrementalMesh takes it as one).
    expect(OCCT_PARAMS.linearUnit).toBe('millimeter');
    expect(OCCT_PARAMS.linearDeflectionType).toBe('absolute_value');
    expect(OCCT_PARAMS.linearDeflection).toBe(0.14);

    // Degrees, not radians. KiCad's call converts with glm::radians, but
    // occt-import-js wants the angle in degrees, and passing 0.5236 here is
    // silently accepted as a far finer angle: measured on the four models CM5
    // Minima renders, 13.79 s and 38,354 triangles against 9.81 s and 24,684.
    expect(OCCT_PARAMS.angularDeflection).toBe(30);
    expect(OCCT_PARAMS.angularDeflection).not.toBeCloseTo(Math.PI / 6, 3);
  });
});
