// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GetKiCadThreadPool()` over workers (common/thread_pool.ts) and the one job
 * it runs so far, `SHAPE_POLY_SET::CacheTriangulation` as a
 * TRIANGULATION_JOB: what comes back through the pool must be what the set
 * computes for itself, triangle for triangle, and installing it must leave
 * the set exactly as `cacheTriangulation` leaves it — up to date, so the
 * synchronous `BOARD::CacheTriangulation` inside `BuildConnectivity` then has
 * nothing to do. The runner has no `Worker`, so the pool's inline path is
 * what runs here; it is the same runner function the worker calls.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { GetKiCadThreadPool, thread_pool } from '@ziroeda/common/src/thread_pool.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';

const RESAVE = fileURLToPath(new URL('../../data/pcbnew/resave/', import.meta.url));

/** A square with a square hole, big enough for the 1 cm partition grid to cut. */
function holed(): SHAPE_POLY_SET {
  const set = new SHAPE_POLY_SET();
  set.NewOutline();
  set.Append({ x: 0, y: 0 });
  set.Append({ x: 30_000_000, y: 0 });
  set.Append({ x: 30_000_000, y: 25_000_000 });
  set.Append({ x: 0, y: 25_000_000 });
  set.NewHole();
  set.Append({ x: 10_000_000, y: 8_000_000 }, 0, 0);
  set.Append({ x: 10_000_000, y: 16_000_000 }, 0, 0);
  set.Append({ x: 20_000_000, y: 16_000_000 }, 0, 0);
  set.Append({ x: 20_000_000, y: 8_000_000 }, 0, 0);
  return set;
}

function triangles(set: SHAPE_POLY_SET): string[] {
  const out: string[] = [];
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  const c = { x: 0, y: 0 };
  for (let i = 0; i < set.TriangulatedPolyCount(); i++) {
    const tp = set.TriangulatedPolygon(i);
    for (let t = 0; t < tp.GetTriangleCount(); t++) {
      tp.GetTriangle(t, a, b, c);
      out.push(`${tp.GetSourceOutlineIndex()}:${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`);
    }
  }
  return out;
}

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('TRIANGULATION_JOB', () => {
  it("a job run elsewhere and installed is the set's own CacheTriangulation", () => {
    const direct = holed();
    direct.CacheTriangulation();
    expect(direct.IsTriangulationUpToDate()).toBe(true);
    expect(direct.TriangulatedPolyCount()).toBeGreaterThan(1); // the grid cut it

    const viaJob = holed();
    expect(viaJob.IsTriangulationUpToDate()).toBe(false);
    const job = viaJob.TriangulationJob();
    expect(job.partition).toBe(true);
    expect(job.polys[0]!.length).toBe(2); // outline + hole
    viaJob.SetTriangulation(SHAPE_POLY_SET.RunTriangulationJob(job));

    expect(viaJob.IsTriangulationUpToDate()).toBe(true);
    expect(viaJob.GetHash()).toBe(direct.GetHash());
    expect(triangles(viaJob)).toEqual(triangles(direct));
    expect(triangles(viaJob).length).toBeGreaterThan(8);
  });

  it("an unpartitioned job (the zone outline's) is CacheTriangulation( false )", () => {
    const direct = holed();
    direct.CacheTriangulation(false);
    const viaJob = holed();
    viaJob.SetTriangulation(SHAPE_POLY_SET.RunTriangulationJob(viaJob.TriangulationJob(false)));
    expect(viaJob.TriangulatedPolyCount()).toBe(1);
    expect(triangles(viaJob)).toEqual(triangles(direct));
  });

  it('a failed triangulation installs as not valid, as cacheTriangulation leaves it', () => {
    const set = holed();
    set.SetTriangulation({ polys: [], valid: false });
    expect(set.IsTriangulationUpToDate()).toBe(false);
    expect(set.TriangulatedPolyCount()).toBe(0);
  });
});

describe('thread_pool', () => {
  it('sizes itself as BS::thread_pool( 0 ) does, keeping one for the drawing thread', () => {
    expect(new thread_pool(3).get_thread_count()).toBe(3);
    expect(new thread_pool(0).get_thread_count()).toBeGreaterThanOrEqual(1);
    expect(GetKiCadThreadPool()).toBe(GetKiCadThreadPool());
  });

  it("submit_task answers with the job's result, off the caller's stack", async () => {
    const set = holed();
    const pending = GetKiCadThreadPool().submit_task('triangulate', set.TriangulationJob());
    // Not yet: a queued task never runs before its submitter returns
    expect(set.IsTriangulationUpToDate()).toBe(false);
    set.SetTriangulation(await pending);
    expect(set.IsTriangulationUpToDate()).toBe(true);
    await GetKiCadThreadPool().wait();
  });

  it('BOARD::CacheTriangulationAsync leaves every zone cached, so BuildConnectivity recomputes nothing', async () => {
    const f = `${RESAVE}ecc83-pp.kicad_pcb`;
    const board = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
    const fillsOf = (b: BOARD): SHAPE_POLY_SET[] =>
      b.Zones().flatMap((z) =>
        z
          .GetLayerSet()
          .Seq()
          .map((l) => z.GetFilledPolysList(l)),
      );
    const fills = fillsOf(board);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.some((p) => p.IsTriangulationUpToDate())).toBe(false);

    const messages: string[] = [];
    let advanced = 0;
    await board.CacheTriangulationAsync({
      SetMaxProgress: () => {},
      SetCurrentProgress: () => {},
      AdvanceProgress: () => {
        advanced++;
      },
      KeepRefreshing: () => true,
      IsCancelled: () => false,
      Report: (m) => messages.push(m),
    });

    expect(messages).toEqual(['Tessellating copper zones...']);
    expect(advanced).toBe(board.Zones().length);
    for (const p of fills) expect(p.IsTriangulationUpToDate()).toBe(true);
    for (const z of board.Zones()) expect(z.Outline().IsTriangulationUpToDate()).toBe(true);

    // The same triangles the synchronous path computes
    const direct = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
    direct.CacheTriangulation();
    const directFills = fillsOf(direct);
    expect(fills.map(triangles)).toEqual(directFills.map(triangles));

    expect(board.BuildConnectivity()).toBe(true);
    expect(board.GetConnectivity().GetNetCount()).toBe(14);
  }, 60_000);
});
