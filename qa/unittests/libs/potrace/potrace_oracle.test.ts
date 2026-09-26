// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * libs/potrace against KiCad 10.0.5's own vendored potracelib.
 *
 * `qa/data/bitmap2component/potrace_oracle.json` was written by
 * `qa/probes/potrace_oracle_gen.py`, which runs `potrace_trace_probe.cpp` —
 * KiCad's `thirdparty/potrace/src` compiled as-is, with the parameters
 * `BITMAPCONV_INFO::ConvertBitmap` sets (turdsize 0, opttolerance 0.2). Every
 * expected number below is that C's output, printed %.17g and read back, so
 * the comparison is bit for bit: path order, sign, area, segment count, tags,
 * and all six control-point coordinates.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BM_PUT,
  bm_new,
  potrace_param_default,
  potrace_trace,
  POTRACE_STATUS_OK,
  type potrace_path_t,
} from '@ziroeda/potrace';

interface OraclePath {
  sign: string;
  area: number;
  n: number;
  tag: number[];
  c: string[][];
}

interface OracleCase {
  name: string;
  rows: string[];
  paths: OraclePath[];
}

const cases: OracleCase[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../data/bitmap2component/potrace_oracle.json', import.meta.url)),
    'utf8',
  ),
);

function trace(rows: string[]): OraclePath[] {
  const h = rows.length;
  const w = rows[0]!.length;
  const bm = bm_new(w, h)!;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) BM_PUT(bm, x, y, rows[y]![x] === '1' ? 1 : 0);
  }

  const param = potrace_param_default()!;
  param.turdsize = 0;
  param.opttolerance = 0.2;

  const st = potrace_trace(param, bm)!;
  expect(st.status).toBe(POTRACE_STATUS_OK);

  const out: OraclePath[] = [];

  for (let p: potrace_path_t | null = st.plist; p; p = p.next) {
    out.push({
      sign: p.sign,
      area: p.area,
      n: p.curve.n,
      tag: [...p.curve.tag],
      c: p.curve.c.map((seg) => seg.flatMap((pt) => [pt.x, pt.y]).map((v) => String(Number(v)))),
    });
  }

  return out;
}

/** The oracle's `repr()` spelling of a double, as JS spells the same bits. */
const normalise = (paths: OraclePath[]): OraclePath[] =>
  paths.map((p) => ({ ...p, c: p.c.map((seg) => seg.map((v) => String(Number(v)))) }));

describe('potracelib, bit for bit against thirdparty/potrace', () => {
  it('covers curves, holes, ambiguous turns and the 64-bit word boundary', () => {
    expect(cases.map((c) => c.name)).toEqual([
      'hollow5',
      'disc24',
      'ring30',
      'ellipse50x20',
      'triangle',
      'checker8',
      'noise40',
      'noise64x30_sparse',
      'wide150',
      'nested',
      'dot3',
      'blank4',
      'full6',
      'eight',
    ]);
    // Both tags occur, and so do both signs, or the comparison proves less.
    const all = cases.flatMap((c) => c.paths);
    expect(new Set(all.flatMap((p) => p.tag))).toEqual(new Set([1, 2]));
    expect(new Set(all.map((p) => p.sign))).toEqual(new Set(['+', '-']));
  });

  for (const c of cases) {
    it(c.name, () => {
      expect(trace(c.rows)).toEqual(normalise(c.paths));
    });
  }
});
