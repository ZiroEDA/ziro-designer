// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a save costs on a project the size of a real board.
 *
 * Pushing used to base64-encode the whole project to discover that none of it
 * had changed: a 10 MB project became a 13 MB string and several hundred
 * milliseconds of main thread, every time edits settled, blocking the canvas.
 * The push works from a manifest now and reads bytes only for blobs it is
 * actually going to store.
 *
 * Asserted as a ratio against the work the same project needs anyway, not as a
 * wall-clock budget, so it says something on a slow machine and in CI.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  exportManifest,
  exportProject,
  saveProject,
} from '@ziroeda/designer/src/home/projectStore.js';

// Incompressible, so the stored size is the real size: gzip of repeated text
// would make a 10 MB project a few kB and measure nothing.
const files = Array.from({ length: 107 }, (_, i) => ({
  name: `f${i}.kicad_mod`,
  bytes: new Uint8Array(randomBytes(98_000)),
}));

describe('preparing a push', () => {
  it('does not materialise the project to find out what changed', async () => {
    const id = await saveProject('Big', files);

    const t0 = performance.now();
    const manifest = (await exportManifest(id))!;
    const manifestMs = performance.now() - t0;

    const t1 = performance.now();
    const full = (await exportProject(id))!;
    const fullMs = performance.now() - t1;

    // Same picture of the project, without the bytes.
    expect(manifest.files).toHaveLength(files.length);
    expect(manifest.files.every((f) => f.hash && f.size)).toBe(true);
    expect(manifest.files.every((f) => f.gzB64 === undefined)).toBe(true);
    expect(full.files.every((f) => (f.gzB64?.length ?? 0) > 0)).toBe(true);

    // And it can still produce any file's bytes when one is needed.
    const bytes = await manifest.bytesOf!(manifest.files[3]!.name);
    expect(bytes.byteLength).toBe(manifest.files[3]!.size);

    // The point of the change. Generous, because CI timing is noisy and the
    // claim is about an order of magnitude, not a stopwatch.
    expect(manifestMs).toBeLessThan(fullMs / 2);
  });
});
