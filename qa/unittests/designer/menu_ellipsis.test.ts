// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A label that opens a window ends in three dots — `...`, not `…`.
 *
 * This is not a house style, it is upstream's, and it is unanimous. KiCad
 * 10.0.5's C++ has **530** translatable strings containing `...` and **zero**
 * containing U+2026. GTK does not convert one into the other, so what is in
 * the source is what the user reads: `Preferences...`, `Save As...`,
 * `Loading...`.
 *
 * Ours had 154 of them written with U+2026, spread over 39 files, against 133
 * already written the upstream way — so the app was inconsistent with itself
 * as well as with KiCad, in text on every menu of every editor.
 *
 * The check is per occurrence, not per file: it prints every site by
 * `file:line`, so a single stray one fails and a file that already has a
 * legitimate exception cannot hide a new mistake behind it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SOURCE_DIRS = [
  'designer/src',
  'common/src',
  'eeschema/src',
  'pcbnew/src',
  'gerbview/src',
  'pcb_calculator/src',
];

/**
 * The occurrences that are not this convention at all.
 *
 * Every one is a truncation marker or an elision inside a diagnostic — the
 * character is doing a different job there, and KiCad has no counterpart
 * string to copy. They are listed rather than pattern-matched so that adding
 * one is a decision somebody writes down.
 */
const ALLOWED = new Map<string, string>([
  ['eeschema/src/tools/sch_collectors.ts', 'ellipsize() truncates a long name'],
  ['designer/src/ui/hotkeys_inventory.ts', 'a regex that must keep matching BOTH forms'],
  ['designer/src/editors/pcb/PcbEditor.tsx', 'a leading "…N more" truncation marker'],
  ['designer/src/telemetry/scrub.ts', '"…[truncated]" in a scrubbed report'],
  ['common/src/drawing_sheet/read.ts', 'an elided s-expression in a parser error'],
]);

/** Source files, comments blanked, so prose about the rule is not the rule. */
function* codeLines(): Generator<{ where: string; line: string }> {
  const walk = function* (dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (/\.(ts|tsx|css)$/.test(name)) yield full;
    }
  };

  for (const rel of SOURCE_DIRS) {
    for (const full of walk(ROOT + rel)) {
      const src = readFileSync(full, 'utf8');
      // Both spellings. `'\\u2026'` is the same character to the user and
      // invisible to a search for the glyph — six sites were written that way
      // and survived the first sweep untouched.
      if (!src.includes('…') && !src.includes('\\u2026')) continue;
      // Blanked rather than removed, so line numbers still point at the file.
      const blanked = src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
      const raw = src.split('\n');
      const lines = blanked.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.includes('…') || lines[i]?.includes('\\u2026')) {
          yield { where: `${full.slice(ROOT.length)}:${i + 1}`, line: raw[i] ?? '' };
        }
      }
    }
  }
}

describe('user-visible text uses KiCad’s three dots', () => {
  const found = [...codeLines()];

  it('found source to scan, so the sweep is not passing by finding nothing', () => {
    // Without this the whole file passes if the walk breaks or the paths move.
    expect(SOURCE_DIRS.length).toBeGreaterThan(3);
    expect([...codeLines()].length + 100).toBeGreaterThan(100);
  });

  it('has no U+2026 outside the listed exceptions', () => {
    const stray = found
      .filter(({ where }) => !ALLOWED.has(where.split(':')[0] ?? ''))
      .map(({ where, line }) => `${where}  ${line.trim()}`);
    expect(
      stray,
      'write these as "..." — KiCad has 530 of those and not one U+2026, and ' +
        'GTK does not convert. If the character is doing a different job ' +
        '(truncating, eliding), add the file to ALLOWED with the reason.',
    ).toStrictEqual([]);
  });

  it('keeps every exception honest, so the list cannot outlive its reason', () => {
    // An allowlist nobody prunes becomes a place to hide. If a file stops
    // containing one, it stops being allowed to.
    const filesWithOne = new Set(found.map(({ where }) => where.split(':')[0]));
    const stale = [...ALLOWED.keys()].filter((f) => !filesWithOne.has(f));
    expect(stale, 'these no longer contain U+2026 — drop them from ALLOWED').toStrictEqual([]);
  });

  it('still writes the dots where a dialog follows', () => {
    // The other half of the rule: a label that opens a window must not lose
    // its dots altogether. Spot-checked on the launcher's own menu bar, whose
    // labels all exist upstream.
    const menubar = readFileSync(`${ROOT}designer/src/home/menubar.ts`, 'utf8');
    expect(menubar).toContain('...');
    // In its CODE, not its prose — this file's comments discuss the character
    // by name, and a rule must not be defeated by the note explaining it.
    expect(found.map((f) => f.where.split(':')[0])).not.toContain('designer/src/home/menubar.ts');
  });
});
