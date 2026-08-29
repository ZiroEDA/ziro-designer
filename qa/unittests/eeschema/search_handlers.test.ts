// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Search panel's result sets, counterpart eeschema/widgets/search_handlers.cpp.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  searchSchematic,
  hitsOfKind,
  SEARCH_COLUMNS,
} from '@ziroeda/eeschema/src/tools/search_handlers.js';
import {
  matchesText,
  defaultSearchData,
} from '@ziroeda/eeschema/src/tools/sch_find_replace_tool.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
/** The same symbol, marked as a power symbol. */
const POWER_LIB = new Map<string, LibSymbol>([[R.libId, { ...R, isPower: true }]]);

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})\n${body}\n)`));

const SYM = `(symbol (lib_id "${R.libId}") (at 20 20 0) (unit 1) (uuid "s-1")
   (property "Reference" "R1" (at 22 19 0) (effects (font (size 1.27 1.27))))
   (property "Value" "10k" (at 22 21 0) (effects (font (size 1.27 1.27))))
   (property "Footprint" "R_0603" (at 22 23 0) (effects (font (size 1.27 1.27)) (hide yes))))`;
const LABELS = `(label "CLK" (at 5 5 0) (effects (font (size 1.27 1.27))) (uuid "l-1"))
  (global_label "VBUS" (shape input) (at 8 8 0) (effects (font (size 1.27 1.27))) (uuid "g-1"))
  (text "a note" (at 9 9 0) (effects (font (size 1.27 1.27))) (uuid "t-1"))`;

describe('an empty query finds nothing', () => {
  it('does not list the whole schematic', () => {
    // matchesText bails on an empty findString; a panel that fills up the
    // moment it opens is not a search result.
    expect(searchSchematic(sheet(SYM + '\n' + LABELS), LIB, '')).toEqual([]);
  });
});

describe('symbols and power symbols are disjoint', () => {
  it('an ordinary symbol lands on the symbol tab', () => {
    const hits = searchSchematic(sheet(SYM), LIB, 'R1');
    expect(hitsOfKind(hits, 'symbol')).toHaveLength(1);
    expect(hitsOfKind(hits, 'power')).toHaveLength(0);
  });

  it('a power symbol lands on the power tab and nowhere else', () => {
    // SYMBOL_SEARCH_HANDLER rejects IsPower() and POWER_SEARCH_HANDLER requires
    // it, so the two tabs partition the symbols rather than overlapping.
    const hits = searchSchematic(sheet(SYM), POWER_LIB, 'R1');
    expect(hitsOfKind(hits, 'power')).toHaveLength(1);
    expect(hitsOfKind(hits, 'symbol')).toHaveLength(0);
  });

  it('an unresolved library symbol is not treated as power', () => {
    // Upstream guards IsPower() with !IsMissingLibSymbol().
    const hits = searchSchematic(sheet(SYM), new Map(), 'R1');
    expect(hitsOfKind(hits, 'symbol')).toHaveLength(1);
  });
});

describe('labels and free text are separate tabs', () => {
  const doc = () => sheet(LABELS);

  it('a local and a global label are both labels', () => {
    const hits = searchSchematic(doc(), LIB, '*');
    const labels = hitsOfKind(hits, 'label');
    expect(labels.map((h) => h.cells[0])).toEqual(['Local', 'Global']);
  });

  it('free text is text, not a label', () => {
    const hits = searchSchematic(doc(), LIB, 'note');
    expect(hitsOfKind(hits, 'text')).toHaveLength(1);
    expect(hitsOfKind(hits, 'label')).toHaveLength(0);
  });
});

describe('the query is permissive', () => {
  it('matches a plain substring', () => {
    expect(searchSchematic(sheet(LABELS), LIB, 'CL')).toHaveLength(1);
  });

  it('matches a wildcard', () => {
    expect(searchSchematic(sheet(LABELS), LIB, 'CL?')).toHaveLength(1);
  });

  /**
   * PERMISSIVE is `EDA_COMBINED_MATCHER( searchText, CTX_SEARCH )`
   * (common/eda_item.cpp:206-210), so a regex has to be one KiCad recognises AS
   * a regex: `EDA_PATTERN_MATCH_REGEX::SetPattern`
   * (common/eda_pattern_match.cpp:80-104) takes `^…$` or `/…/` and returns
   * false for anything else - "for now regular expressions must be explicit".
   * A bare `^VB` is therefore not a pattern, it is the two characters `^V`
   * followed by `B`, and the wildcard matcher escapes the caret to prove it.
   */
  it('matches a regex, when the query says it is one', () => {
    expect(searchSchematic(sheet(LABELS), LIB, '^VBUS$')).toHaveLength(1);
    expect(searchSchematic(sheet(LABELS), LIB, '/^VB/')).toHaveLength(1);
    expect(searchSchematic(sheet(LABELS), LIB, '/^VB')).toHaveLength(1);
  });

  it('reads a half-anchored `^VB` as literal text, and finds none', () => {
    expect(searchSchematic(sheet(LABELS), LIB, '^VB')).toEqual([]);
  });

  it('falls back to substring when the pattern is not valid regex', () => {
    // EDA_COMBINED_MATCHER tries regex, then wildcard, then substring, so a
    // stray bracket does not make the search fail.
    expect(
      matchesText('a[note', { ...defaultSearchData(), findString: '[no', matchMode: 'permissive' }),
    ).toBe(true);
  });
});

describe('hidden fields are out of scope unless asked for', () => {
  it('a hidden Footprint is not searched by default', () => {
    // The fixture hides Footprint; searchAllFields is off by default.
    expect(searchSchematic(sheet(SYM), LIB, 'R_0603')).toHaveLength(0);
  });

  it('and is searched when they are', () => {
    expect(searchSchematic(sheet(SYM), LIB, 'R_0603', true)).toHaveLength(1);
  });
});

describe('the columns each tab declares', () => {
  it('match the cells its hits carry', () => {
    // A row with a different number of cells than its tab has columns would
    // render misaligned, and nothing else would notice.
    const hits = searchSchematic(sheet(SYM + '\n' + LABELS), LIB, '*');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.cells).toHaveLength(SEARCH_COLUMNS[h.kind].length);
  });
});

describe('a hit carries what the panel needs to act on it', () => {
  it('reports the item position, so a double-click can centre on it', () => {
    // SEARCH_HANDLER::FocusItem centres the view; the row's X/Y cells are
    // formatted strings, so the raw position has to travel alongside them.
    const [hit] = searchSchematic(sheet(SYM), LIB, 'R1');
    expect(hit?.at).toEqual({ x: 200000, y: 200000 });
    const [note] = hitsOfKind(searchSchematic(sheet(LABELS), LIB, 'note'), 'text');
    expect(note?.at).toEqual({ x: 90000, y: 90000 });
  });

  it('formats X and Y through the caller-supplied units formatter', () => {
    // MessageTextFromValue: the engine has no notion of the frame's units, so
    // the panel injects the formatter. Raw IU is only the fallback.
    const mm = (iu: number): string => `${iu / 10000} mm`;
    const [hit] = searchSchematic(sheet(SYM), LIB, 'R1', false, mm);
    expect(hit?.cells.slice(-2)).toEqual(['20 mm', '20 mm']);
    // Without one, the cells stay raw.
    const [raw] = searchSchematic(sheet(SYM), LIB, 'R1');
    expect(raw?.cells.slice(-2)).toEqual(['200000', '200000']);
  });

  it('gives every kind as many cells as its tab has columns', () => {
    // A short row would silently shift every column after the gap.
    // One query, not an alternation: `|` is not syntax here either, so `*` is
    // how you ask for everything (the wildcard matcher turns it into `.*`).
    const hits = searchSchematic(sheet(SYM + '\n' + LABELS), LIB, '*');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.cells).toHaveLength(SEARCH_COLUMNS[h.kind].length);
  });
});
