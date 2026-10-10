// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * common/kicad_gl/kiglu.ts against the installed libGLU 9.0.2 (Mesa's SGI libtess, what KiCad's
 * VRML_LAYER calls): qa/probes/glu_tess_probe ran qa/data/common/glu_tess/cases.txt through
 * the real gluTess* and recorded every callback in golden.txt. The same cases through ours must
 * give the same begins, the same vertices in the same order, and combined vertices at the same
 * coordinates to the last bit (%.17g).
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { formatG } from '@ziroeda/common/plotters/fmt.js';
import {
  GLU_TESS_BEGIN_DATA,
  GLU_TESS_BOUNDARY_ONLY,
  GLU_TESS_COMBINE_DATA,
  GLU_TESS_END_DATA,
  GLU_TESS_ERROR_DATA,
  GLU_TESS_VERTEX_DATA,
  GLU_TESS_WINDING_NEGATIVE,
  GLU_TESS_WINDING_NONZERO,
  GLU_TESS_WINDING_ODD,
  GLU_TESS_WINDING_POSITIVE,
  GLU_TESS_WINDING_RULE,
  gluNewTess,
} from '@ziroeda/common/kicad_gl/kiglu.js';

const DIR = new URL('../../../data/common/glu_tess/', import.meta.url).pathname;

interface Vtx {
  x: number;
  y: number;
  id: number;
}

function run(aCases: string): string[] {
  const out: string[] = [];
  const t = gluNewTess();
  let extra = 0;

  t.gluTessCallback(GLU_TESS_BEGIN_DATA, (aType: number) => out.push(`B ${aType}`));
  t.gluTessCallback(GLU_TESS_VERTEX_DATA, (v: Vtx) =>
    out.push(v.id >= 0 ? `V ${v.id}` : `V X${-v.id - 1} ${formatG(v.x, 17)} ${formatG(v.y, 17)}`),
  );
  t.gluTessCallback(GLU_TESS_END_DATA, () => out.push('N'));
  t.gluTessCallback(GLU_TESS_ERROR_DATA, (e: number) => out.push(`R ${e}`));
  t.gluTessCallback(
    GLU_TESS_COMBINE_DATA,
    (c: number[]): Vtx => ({ x: c[0]!, y: c[1]!, id: -++extra }),
  );
  t.gluTessNormal(0, 0, 1);

  let inContour = false;
  let nv = 0;

  for (const line of aCases.split('\n')) {
    const f = line.split(' ');

    if (f[0] === 'P') {
      const rule =
        {
          ODD: GLU_TESS_WINDING_ODD,
          POS: GLU_TESS_WINDING_POSITIVE,
          NEG: GLU_TESS_WINDING_NEGATIVE,
        }[f[1]!] ?? GLU_TESS_WINDING_NONZERO;
      t.gluTessProperty(GLU_TESS_WINDING_RULE, rule);
      t.gluTessProperty(GLU_TESS_BOUNDARY_ONLY, f[2] === '1' ? 1 : 0);
      extra = 0;
      nv = 0;
      out.push('P');
      t.gluTessBeginPolygon(null);
    } else if (f[0] === 'C') {
      if (inContour) t.gluTessEndContour();

      t.gluTessBeginContour();
      inContour = true;
    } else if (f[0] === 'V') {
      const v: Vtx = { x: Number(f[1]), y: Number(f[2]), id: nv++ };
      t.gluTessVertex([v.x, v.y, 0], v);
    } else if (f[0] === 'E') {
      if (inContour) t.gluTessEndContour();

      inContour = false;
      t.gluTessEndPolygon();
    }
  }

  return out;
}

it('kiglu matches libGLU callback for callback', async () => {
  const got = run(readFileSync(`${DIR}cases.txt`, 'utf8'));
  const want = readFileSync(`${DIR}golden.txt`, 'utf8').split('\n').filter(Boolean);

  if (process.env.KIGLU_DUMP)
    (await import('node:fs')).writeFileSync(process.env.KIGLU_DUMP, `${got.join('\n')}\n`);
  expect(want.length).toBeGreaterThan(4000);
  expect(got).toEqual(want);
});
