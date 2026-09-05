// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * We must not identify ourselves as KiCad or any of its programs
 * (common/src/generator.ts).
 *
 * KiCad's formats carry a `(generator ...)` token naming the program that wrote
 * the file. Writing KiCad's own program names there misuses the KiCad name, and
 * is practically harmful in a way that is easy to miss: a file we wrote becomes
 * indistinguishable from one KiCad wrote, so a bug in our writers gets reported
 * against KiCad by a user with no way of knowing otherwise.
 *
 * This scans the writers rather than any single output, so a new writer that
 * copies an old header cannot quietly reintroduce the problem.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GENERATOR,
  GENERATOR_APPLICATION,
  GENERATOR_VENDOR,
  GENERATOR_VERSION,
} from '@ziroeda/common/src/generator.js';

/** KiCad's own program names, as they appear in `(generator ...)` tokens. */
const KICAD_PROGRAM_NAMES = [
  'pcbnew',
  'eeschema',
  'kicad_symbol_editor',
  'pl_editor',
  'bitmap2component',
  'gerbview',
  'kicad',
];

const ROOT = new URL('../../../', import.meta.url).pathname;
const PACKAGES = ['common', 'eeschema', 'pcbnew', 'designer', 'gerbview'];

/**
 * Bundled library content that KiCad itself authored. The rule against wearing
 * KiCad's name cuts both ways: we must not claim to be KiCad, and we must not
 * strip KiCad's name off files it really wrote. Their provenance stands.
 */
const KICAD_AUTHORED_CONTENT = ['designer/src/pcm/defaultRepo.ts'];

const exempt = (file: string): boolean =>
  KICAD_AUTHORED_CONTENT.some((p) => file.replace(/\\/g, '/').endsWith(p));

/** Comments describe KiCad's format; only emitted strings are claims we make. */
const isComment = (line: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(line);

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Every generator value a line would emit, in either form the writers use:
 * a literal `(generator "x")` inside a template, or the AST-builder call
 * `atom('generator'), str('x')` (aliased to `A`/`S` in some modules).
 *
 * The builder form was missed by an earlier version of this check, which made
 * it blind to most of the writers it exists to guard: reintroducing
 * `str('pcbnew')` in write-footprint.ts passed cleanly.
 */
function emittedGenerators(text: string): string[] {
  const literal = [...text.matchAll(/\(generator\s+"?([A-Za-z0-9_${}.]+)"?\)/g)];
  const builder = [
    ...text.matchAll(
      /(?:atom|A)\(\s*['"]generator['"]\s*\)\s*,\s*(?:str|S)\(\s*['"]([^'"]+)['"]\s*\)/g,
    ),
  ];
  return [...literal, ...builder].map((m) => m[1] ?? '');
}

describe('generator identity', () => {
  it('names the application, not the company', () => {
    // The company and the application are both ZiroEDA now -- the app was
    // renamed to the company's name. The format still asks the two questions
    // separately (Gerber X2's `.GenerationSoftware`), and gets one answer
    // twice, which is honest. The generator
    // token names the program that wrote the file, so it is the application.
    expect(GENERATOR).toBe('ziroeda');
    expect(GENERATOR_APPLICATION).toBe('ZiroEDA');
    expect(GENERATOR_VENDOR).toBe('ZiroEDA');
  });

  it('does not borrow a KiCad program name', () => {
    expect(KICAD_PROGRAM_NAMES).not.toContain(GENERATOR);
    expect(GENERATOR_VERSION).not.toBe('9.0'); // KiCad's version, not ours
  });

  it('no writer emits a KiCad program name as its generator', () => {
    const offenders: string[] = [];
    for (const pkg of PACKAGES) {
      for (const file of sourceFiles(join(ROOT, pkg, 'src'))) {
        if (exempt(file)) continue;
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (isComment(line)) continue;
          for (const value of emittedGenerators(line)) {
            // Template placeholders resolve to our constant at runtime.
            if (value.includes('${')) continue;
            if (KICAD_PROGRAM_NAMES.includes(value.toLowerCase())) {
              offenders.push(`${file.slice(ROOT.length)}: (generator "${value}")`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no writer claims to be Pcbnew in Gerber generation software', () => {
    const offenders: string[] = [];
    for (const pkg of PACKAGES) {
      for (const file of sourceFiles(join(ROOT, pkg, 'src'))) {
        if (exempt(file)) continue;
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (isComment(line)) continue;
          // Gerber X2 .GenerationSoftware is "vendor,application,version".
          for (const m of line.matchAll(/GenerationSoftware[,:]\s*([^*\n]*)/g)) {
            const body = m[1] ?? '';
            if (/pcbnew|eeschema|kicad/i.test(body) && !body.includes('${')) {
              offenders.push(`${file.slice(ROOT.length)}: ${body.trim()}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
