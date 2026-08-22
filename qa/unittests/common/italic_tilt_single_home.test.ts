// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ITALIC_TILT` is one `constexpr` upstream, and must be one constant here.
 *
 *     include/font/font.h:62:  static constexpr double ITALIC_TILT = 1.0 / 8;
 *
 * with exactly three consumers in the whole of KiCad — `EDA_TEXT::GetTextBox`
 * (`common/eda_text.cpp:820`), `STROKE_FONT::GetTextAsGlyphs`
 * (`common/font/stroke_font.cpp:216`) and the PDF plotter — all of which
 * include that one header.
 *
 * We had grown five separate declarations of it, one per renderer, which is
 * exactly the shape of drift that lets a parity fix land in one editor and
 * leave the others silently wrong. This pins the count so the sixth cannot be
 * added quietly.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ITALIC_TILT } from '@ziroeda/common/src/font/font_metrics.js';
import { ITALIC_TILT as VIA_TEXT_BOX } from '@ziroeda/common/src/font/text_box.js';
import { ITALIC_TILT as VIA_EESCHEMA } from '@ziroeda/eeschema/src/fieldbox.js';

/** Repo root: this file is `qa/unittests/common/…`. */
const ROOT = new URL('../../../', import.meta.url).pathname;

/**
 * Every line in tracked TypeScript that *declares* an ITALIC_TILT, as opposed
 * to importing or re-exporting one. `git grep` so untracked scratch files and
 * `node_modules` cannot affect the count.
 */
const declarations = (): string[] =>
  execFileSync(
    'git',
    ['grep', '-n', '-E', String.raw`^\s*(export\s+)?const ITALIC_TILT\s*=`, '--', '*.ts', '*.tsx'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

describe('ITALIC_TILT has one home', () => {
  it('is declared in common/src/font/font_metrics.ts and nowhere else', () => {
    const files = declarations().map((l) => l.split(':')[0]);
    // The exception is gone. `wksRender.ts` kept a second `1 / 8` and was
    // excused here while its tree was being rewritten; that rewrite moved it to
    // `common/src/drawing_sheet/ds_painter.ts`, where a duplicate of a common/
    // constant two directories away was indefensible, so it imports this one.
    expect(files).toEqual(['common/src/font/font_metrics.ts']);
  });

  it('is 1/8, and every re-export is the same value', () => {
    expect(ITALIC_TILT).toBe(1 / 8);
    expect(VIA_TEXT_BOX).toBe(ITALIC_TILT);
    expect(VIA_EESCHEMA).toBe(ITALIC_TILT);
  });
});
