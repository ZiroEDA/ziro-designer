// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView code works in the PARSER's internal units, never `common`'s.
 *
 * The two do not agree, and that is a live trap rather than a live bug:
 *
 *   - KiCad: `constexpr double GERB_IU_PER_MM = 1e5;` — "Gerbview IU is 10
 *     nanometers" (`include/base_units.h:69`). Our `common/src/eda_units.ts`
 *     matches it, and `gerbIUScale` is built from it.
 *   - Our Gerber parser: `IU_PER_MM = 1e6` (`gerbview/src/types.ts:15`).
 *
 * Every coordinate on the GerbView canvas — every item, every bounding box, the
 * view transform — is in the parser's 1e6. So anything that reaches for
 * `common`'s 1e5 constant to size or place something on that canvas is out by a
 * factor of ten, and the symptom looks like a layout bug rather than a units
 * one. It has already caught two people: `render/gl/tessellate.ts:61-66`
 * documented it, and the drawing-sheet page rectangle nearly shipped a tenth of
 * its size.
 *
 * Reconciling the two constants is a separate job — it touches every Gerber
 * coordinate in the package — so this guards the boundary instead.
 *
 * Per-file and per-occurrence on purpose: a single tree-wide "nothing imports
 * it" would report a number, and the point is to name the file that has to
 * change. Comments are stripped first, because several of these files
 * legitimately *discuss* the mismatch.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOTS = ['../../../designer/src/editors/gerbview', '../../../designer/src/render/gl'].map(
  (r) => fileURLToPath(new URL(r, import.meta.url)),
);

/** Source with comments blanked — prose about the trap is not an import of it. */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Every offending line, as "file:line  text". */
const offenders = (pattern: RegExp): string[] => {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = relative(fileURLToPath(new URL('../../..', import.meta.url)), file);
      strip(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim()}`);
        });
    }
  }
  return hits;
};

describe('the GerbView / common IU mismatch', () => {
  it('is still there, so this guard still has a reason to exist', () => {
    // If someone reconciles the two, this test should be deleted rather than
    // left passing vacuously — so it fails loudly when the premise goes away.
    const gerb = readFileSync(
      fileURLToPath(new URL('../../../gerbview/src/types.ts', import.meta.url)),
      'utf8',
    );
    const common = readFileSync(
      fileURLToPath(new URL('../../../common/src/eda_units.ts', import.meta.url)),
      'utf8',
    );
    expect(gerb).toContain('export const IU_PER_MM = 1e6');
    expect(common).toContain('export const GERB_IU_PER_MM = 1e5');
  });

  it('never imports common’s GERB_IU_PER_MM into GerbView or GL code', () => {
    expect(offenders(/\bGERB_IU_PER_MM\b/)).toEqual([]);
  });

  it('never reaches for gerbIUScale there either', () => {
    // The same 1e5 by another name.
    expect(offenders(/\bgerbIUScale\b/)).toEqual([]);
  });

  it('scans files at all, so an empty result means something', () => {
    // A broken walk would make both checks above pass for the wrong reason.
    expect(offenders(/\bIU_PER_MM\b/).length).toBeGreaterThan(0);
  });
});
