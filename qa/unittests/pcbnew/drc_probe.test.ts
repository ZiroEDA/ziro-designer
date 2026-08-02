// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRC smoke test over the real ecc83 demo board: a valid KiCad demo must
 * produce zero violations at the default constraints, and the run must be
 * fast (the engine runs synchronously on the UI thread for now).
 */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readBoard, runDrc } from '@ziroeda/pcbnew';

it('runs DRC on the real ecc83 board', () => {
  const text = readFileSync(
    new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
    'utf8',
  );
  const b = readBoard(parse(text));
  // Timed as the *best* of three rather than a single run. A single wall-clock
  // reading here measures the machine, not the engine: under a full parallel
  // `vitest run` this board has been observed at 2.5 s while measuring 183 ms
  // on the same commit run alone. Best-of-three still catches a real
  // regression — the engine cannot be fast once by luck — without failing
  // because another worker happened to be compiling at the time.
  let best = Number.POSITIVE_INFINITY;
  let v: ReturnType<typeof runDrc> = [];

  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    v = runDrc(b, {
      minClearance: 2000,
      minTrackWidth: 2000,
      minViaDiameter: 5000,
      minViaAnnulus: 1000,
      minThroughHole: 3000,
      minHoleToHole: 2500,
    });
    best = Math.min(best, performance.now() - t0);
  }
  // The demo genuinely overhangs its own board edge: two F.SilkS lines run to
  // y = 137.811 mm while the outline's bottom edge is at y = 136.525 mm, so
  // 1.29 mm of legend prints on nothing. KiCad reports it too — at warning
  // severity, which this probe has no model of — so it is named here rather
  // than papered over by loosening the assertion.
  expect(v.filter((x) => x.code !== 'silk_edge_clearance')).toEqual([]);
  expect(v.filter((x) => x.code === 'silk_edge_clearance')).toHaveLength(2);
  expect(best).toBeLessThan(2000);
}, 20000);
