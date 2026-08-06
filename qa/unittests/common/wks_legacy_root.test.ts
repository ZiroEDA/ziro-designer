// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A drawing sheet with a legacy root token.
 *
 * `DRAWING_SHEET_PARSER::parseHeader` accepts three: `kicad_wks`,
 * `drawing_sheet` and `page_layout`. Only the first carries a `(version …)`;
 * the other two are the older, unversioned spellings, and upstream's own demos
 * still ship one — `demos/interf_u/pagelayout_logo.kicad_wks`, vendored here as
 * `qa/data/`, opens with `(page_layout …)`.
 *
 * We accepted only `kicad_wks` and threw on the rest, so a sheet KiCad opens
 * without complaint was a hard error here. The existing `wks.test.ts` never
 * caught it because every fixture in it is one we generated or hand-wrote in
 * the modern form — the failure mode of testing a reader against your own
 * writer.
 *
 * The legacy form differs in more than its root, which is why this uses a real
 * file rather than a doctored modern one: no version, `(font bold)` as a bare
 * atom rather than `(bold yes)`, and unquoted text arguments.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseDrawingSheet,
  serializeDrawingSheet,
  type WksText,
  type WksSheet,
} from '@ziroeda/common/src/drawing_sheet/index.js';
import { WKS_FILE_VERSION } from '@ziroeda/common/src/drawing_sheet/types.js';

const LEGACY = readFileSync(
  join(import.meta.dirname, '../../data/pagelayout_logo.kicad_wks'),
  'utf8',
);

describe('the vendored fixture', () => {
  it('really is the legacy form', () => {
    // If someone re-exports this file from a modern tool it silently stops
    // testing anything, so assert what makes it worth having.
    expect(LEGACY.trimStart().startsWith('(page_layout')).toBe(true);
    expect(LEGACY).not.toContain('(version');
  });
});

/**
 * Parsed per test, not once in the describe body: a reader that throws on this
 * file would take the whole module down at collection time and report "no
 * tests", which reads far too much like a pass.
 */
const legacy = (): WksSheet => parseDrawingSheet(LEGACY);

describe('reading it', () => {
  it('yields every item, not a truncated prefix', () => {
    expect(legacy().items).toHaveLength(31);
  });

  it('covers the kinds the file actually contains', () => {
    expect(new Set(legacy().items.map((i) => i.type))).toEqual(
      new Set(['rect', 'line', 'text', 'polygon']),
    );
  });

  it('reads the setup block', () => {
    expect(legacy().setup).toEqual({
      textW: 1.5,
      textH: 1.5,
      lineWidth: 0.15,
      textLineWidth: 0.15,
      leftMargin: 10,
      rightMargin: 10,
      topMargin: 10,
      bottomMargin: 10,
    });
  });

  it('honours (font bold) as a bare atom', () => {
    // The legacy spelling. The modern one is `(bold yes)`, and a reader that
    // only knew that would parse this file and quietly lose the emphasis on
    // the title block's rev/title/company lines.
    const bold = legacy().items.filter((i) => i.type === 'text' && (i as WksText).bold);
    expect(bold.map((i) => (i as WksText).text)).toEqual(['Rev: %R', 'Title: %T', '%Y']);
  });

  it('is treated as current, since the legacy form carries no version', () => {
    // Not zero: a missing version means "before versioning existed", and the
    // only sensible reading is the current one, which is also what saving it
    // will stamp. Zero would leak into the writer and produce a file claiming
    // a version that never shipped.
    expect(legacy().version).toBe(WKS_FILE_VERSION);
  });
});

describe('saving it', () => {
  it('writes the modern root and survives a reparse', () => {
    // Upgrading on save is what KiCad does too: the parser accepts three
    // roots, the formatter emits one.
    const out = serializeDrawingSheet(parseDrawingSheet(LEGACY));
    expect(out.trimStart().startsWith('(kicad_wks')).toBe(true);
    expect(parseDrawingSheet(out).items).toHaveLength(31);
    // And the second save is a fixed point, so a file does not keep drifting
    // every time it is opened.
    expect(serializeDrawingSheet(parseDrawingSheet(out))).toBe(out);
  });
});

describe('a root that is not a drawing sheet at all', () => {
  it('is still refused', () => {
    // Widening the accepted set must not widen it to everything: handing the
    // sheet reader a schematic should say so, not half-parse it.
    expect(() => parseDrawingSheet('(kicad_sch (version 20250114))')).toThrow(/kicad_sch/);
  });
});
