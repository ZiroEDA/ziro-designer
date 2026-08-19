// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The legacy `%` variable syntax in a drawing sheet, and the file version that
 * gates the reader's format upgrades.
 *
 * `DRAWING_SHEET_PARSER` (`common/drawing_sheet/drawing_sheet_parser.cpp`) runs
 * EVERY `(tbtext …)` through `convertLegacyVariableRefs()` (`:128-198`) as it
 * builds the item (`:286`), unconditionally. It is not a compatibility mode
 * behind a version check: nothing downstream of the parser — the renderer, the
 * properties frame, the Design Inspector, the formatter — ever sees a `%` ref.
 *
 * That matters because every drawing sheet KiCad ships is still written in the
 * legacy form. All 36 templates in `/usr/share/kicad/template` open with a bare
 * `(page_layout …)` root and spell the title block `%T`/`%D`/`%C0`.
 *
 * Separately, `parseHeader` (`:298-327`) assigns version **0** to that bare
 * root. Zero, not "current": it is what makes `m_requiredVersion < 20210606`
 * true at `:699`, which is the gate on `ConvertToNewOverbarNotation`. A reader
 * that calls a missing version "current" reads as harmless and silently
 * disables every "file older than X" upgrade it owes the file.
 *
 * GROUND TRUTH. `qa/data/` vendors two stock templates alongside what KiCad
 * 10.0.5's own `pl_editor` wrote when it Saved As each of them. Those pairs are
 * the strongest evidence available here, and they are asserted as byte
 * comparisons rather than as spot checks on a few strings.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  convertLegacyVariableRefs,
  parseDrawingSheet,
  serializeDrawingSheet,
  layoutDrawingSheet,
  type DsTextItem,
  type WksText,
} from '@ziroeda/common/src/drawing_sheet/index.js';
import { WKS_FILE_VERSION } from '@ziroeda/common/src/drawing_sheet/types.js';
import { convertToNewOverbarNotation } from '@ziroeda/common/src/string_utils.js';

const DATA = join(import.meta.dirname, '../../data');
const fixture = (name: string): string => readFileSync(join(DATA, name), 'utf8');

/* ------------------------------------------------------------------ *
 * convertLegacyVariableRefs: the mapping table, one case per entry
 * ------------------------------------------------------------------ */

/**
 * Each row asserted on its own so that breaking ONE entry fails a test that
 * names it. A single table-wide assertion would collapse twelve independent
 * facts into one, and a mutation of any of them would read the same.
 */
const MAPPINGS: ReadonlyArray<readonly [string, string]> = [
  ['%D', '${ISSUE_DATE}'],
  ['%R', '${REVISION}'],
  ['%K', '${KICAD_VERSION}'],
  ['%Z', '${PAPER}'],
  ['%S', '${#}'],
  ['%N', '${##}'],
  ['%F', '${FILENAME}'],
  ['%L', '${LAYER}'],
  ['%P', '${SHEETPATH}'],
  ['%Y', '${COMPANY}'],
  ['%T', '${TITLE}'],
  ['%C0', '${COMMENT1}'],
  ['%C1', '${COMMENT2}'],
  ['%C2', '${COMMENT3}'],
  ['%C3', '${COMMENT4}'],
  ['%C4', '${COMMENT5}'],
  ['%C5', '${COMMENT6}'],
  ['%C6', '${COMMENT7}'],
  ['%C7', '${COMMENT8}'],
  ['%C8', '${COMMENT9}'],
];

describe('convertLegacyVariableRefs, the mapping table', () => {
  for (const [legacy, modern] of MAPPINGS) {
    it(`${legacy} becomes ${modern}`, () => {
      expect(convertLegacyVariableRefs(legacy)).toBe(modern);
      // …and in the middle of a sentence, since that is how the stock sheets
      // actually use them ("Rev: %R", "%S/%N").
      expect(convertLegacyVariableRefs(`Sheet: ${legacy} end`)).toBe(`Sheet: ${modern} end`);
    });
  }

  it('covers exactly the entries the C++ switch has, and no more', () => {
    // The comment block above the switch claims `%Cx` for `x = 0 to 9`, but the
    // inner switch only has cases '0'..'8'. Asserting the SIZE here means a
    // future edit that adds a 21st mapping has to come back and justify it
    // against `drawing_sheet_parser.cpp:158-190`.
    expect(MAPPINGS).toHaveLength(20);
  });
});

describe('convertLegacyVariableRefs, the escaping and ordering rules', () => {
  it('leaves text with no % in it exactly alone', () => {
    expect(convertLegacyVariableRefs('Responsible dept.')).toBe('Responsible dept.');
    expect(convertLegacyVariableRefs('')).toBe('');
  });

  it('treats %% as an escaped literal %', () => {
    expect(convertLegacyVariableRefs('%%')).toBe('%');
    expect(convertLegacyVariableRefs('100%%')).toBe('100%');
    // The escape consumes its second %, so the following letter is ordinary
    // text and is NOT expanded. Getting this wrong turns "%%D" into a date.
    expect(convertLegacyVariableRefs('%%D')).toBe('%D');
    expect(convertLegacyVariableRefs('%%%D')).toBe('%${ISSUE_DATE}');
  });

  it('drops a % that is the last character of the string', () => {
    // `if( ++ii >= aTextbase.Len() ) break;` leaves the loop without emitting
    // anything, so the trailing % is lost rather than kept.
    expect(convertLegacyVariableRefs('50%')).toBe('50');
    expect(convertLegacyVariableRefs('%')).toBe('');
  });

  it('drops an unrecognised %x entirely, both characters', () => {
    // The `default:` arm is a bare `break` — it emits neither the % nor the
    // character after it. "Keep it verbatim" is the intuitive behaviour and is
    // the wrong one.
    expect(convertLegacyVariableRefs('%Q')).toBe('');
    expect(convertLegacyVariableRefs('a%Qb')).toBe('ab');
    expect(convertLegacyVariableRefs('%d')).toBe(''); // case-sensitive: %d is not %D
  });

  it('makes %C consume the following character whatever it is', () => {
    // `format = aTextbase[++ii]` runs before the inner switch, so the character
    // is eaten even when no case matches.
    expect(convertLegacyVariableRefs('%CX!')).toBe('!');
    // '9' is eaten and maps to nothing, despite the comment above the switch
    // saying `x = 0 to 9`.
    expect(convertLegacyVariableRefs('%C9')).toBe('');
    expect(convertLegacyVariableRefs('a%C9b')).toBe('ab');
  });

  it('does not touch an already-modern ${…} reference', () => {
    expect(convertLegacyVariableRefs('${TITLE} / ${COMMENT1}')).toBe('${TITLE} / ${COMMENT1}');
  });
});

/* ------------------------------------------------------------------ *
 * The version, and the overbar upgrade it gates
 * ------------------------------------------------------------------ */

describe('the file version', () => {
  it('is 0 for a bare page_layout root', () => {
    expect(parseDrawingSheet(fixture('pagelayout_default.kicad_wks')).version).toBe(0);
  });

  it('is the file’s own value for a kicad_wks root', () => {
    expect(parseDrawingSheet(fixture('kicad-saved_pagelayout_default.kicad_wks')).version).toBe(
      20231118,
    );
  });

  it('is refused, not guessed, when a kicad_wks root has no (version …)', () => {
    // `parseHeader` does `Expecting( T_version )`. Defaulting here is what let
    // A3 hide: a file with no version silently became "current".
    expect(() => parseDrawingSheet('(kicad_wks (generator "x"))')).toThrow(/version/);
    expect(() => parseDrawingSheet('(drawing_sheet (generator "x"))')).toThrow(/version/);
  });
});

describe('the overbar upgrade the version gates', () => {
  const SRC = (root: string) =>
    `${root}\n(setup (textsize 1.5 1.5)(linewidth 0.15)(textlinewidth 0.15)` +
    `(left_margin 10)(right_margin 10)(top_margin 10)(bottom_margin 10))\n` +
    `(tbtext "~RESET and ~OE" (name "") (pos 10 10))\n)`;

  const textOf = (src: string) => (parseDrawingSheet(src).items[0] as WksText).text;

  it('fires for an unversioned page_layout sheet', () => {
    // Version 0 < 20210606, so `~RESET` becomes `~{RESET}` and actually draws
    // a bar. Before the version was carried this could never happen.
    expect(textOf(SRC('(page_layout'))).toBe('~{RESET} and ~{OE}');
  });

  it('fires for a kicad_wks sheet older than 20210606', () => {
    expect(textOf(SRC('(kicad_wks (version 20200210)'))).toBe('~{RESET} and ~{OE}');
  });

  it('does not fire at or above 20210606', () => {
    expect(textOf(SRC('(kicad_wks (version 20210606)'))).toBe('~RESET and ~OE');
    expect(textOf(SRC(`(kicad_wks (version ${WKS_FILE_VERSION})`))).toBe('~RESET and ~OE');
  });

  it('runs AFTER the legacy % conversion, not before', () => {
    // Order is load-bearing, and only a case where the expansion lands INSIDE
    // an open overbar shows it. `~A%TB`:
    //   % first  (upstream) -> `~A${TITLE}B`, and the overbar pass then ends
    //                          the bar on the variable's own `}` -> the B is
    //                          outside the bar.
    //   overbar first       -> `~{A%TB}`, and the B is inside it.
    // Most inputs give the same answer either way, so an ordering test built
    // from `~A %T ~B` passes against both and proves nothing.
    expect(textOf(SRC('(page_layout').replace('~RESET and ~OE', '~A%TB'))).toBe('~{A${TITLE}}B');
  });
});

describe('convertToNewOverbarNotation itself', () => {
  it('leaves the legacy empty-string token alone', () => {
    expect(convertToNewOverbarNotation('~')).toBe('~');
  });

  it('closes an overbar left open at the end of the string', () => {
    expect(convertToNewOverbarNotation('~RESET')).toBe('~{RESET}');
  });

  it('treats a space, } or ) as a terminator and keeps the character', () => {
    expect(convertToNewOverbarNotation('~A B')).toBe('~{A} B');
    expect(convertToNewOverbarNotation('~A)B')).toBe('~{A})B');
    expect(convertToNewOverbarNotation('~A}B')).toBe('~{A}}B');
  });

  it('reads ~~ as an escaped tilde', () => {
    expect(convertToNewOverbarNotation('A~~B')).toBe('A~B');
  });

  it('bails out on ~{, which means the string was already converted', () => {
    expect(convertToNewOverbarNotation('~{RESET}')).toBe('~{RESET}');
    // Idempotent, which is what stops a re-read from doubling the markup.
    expect(convertToNewOverbarNotation(convertToNewOverbarNotation('~RESET'))).toBe('~{RESET}');
  });
});

/* ------------------------------------------------------------------ *
 * Ground truth: our bytes against pl_editor's bytes
 * ------------------------------------------------------------------ */

/**
 * We are not `pl_editor`, and we say so in the file. Normalising those two
 * lines is the only licence this comparison takes, and it is spelled out here
 * rather than folded into a fuzzy match.
 */
function normalizeGenerator(text: string): string {
  return text
    .replace(/^\t\(generator "[^"]*"\)$/m, '\t(generator "…")')
    .replace(/^\t\(generator_version "[^"]*"\)$/m, '\t(generator_version "…")');
}

/**
 * FINDING A2, EXCLUDED EXPLICITLY — and its attribution corrected.
 *
 * The audit put the one remaining `pagelayout_default` difference down to the
 * `isShortForm` rule in `kicad_io_utils.cpp:170-180`. Reading the writer, that
 * is not what produces it: `isShortForm` is gated on `textSpecialCase`, i.e. on
 * `FORMAT_MODE::COMPACT_TEXT_PROPERTIES` (`:113`), and the drawing sheet writes
 * through a plain `PRETTIFIED_FILE_OUTPUTFORMATTER( aFilename )`
 * (`ds_data_model_io.cpp:97`), which is `FORMAT_MODE::NORMAL`. It cannot fire
 * for a `.kicad_wks` at all — and indeed KiCad's own output keeps a flagless
 * `(font\n\t(size 1.3 1.3)\n)` broken across lines, which the short-form rule
 * would have packed.
 *
 * What actually produces `(font\n\t(size 2 2) bold italic)` is the GENERAL
 * prettifier: whitespace inside a list becomes a space rather than a newline
 * while `column < consecutiveTokenWrapThreshold` (72, `:100-112`, `:208-213`),
 * and a closing paren only moves to its own line when `lastNonWhitespace == ')'
 * || inMultiLineList` (`:292-298`). So the atoms after a sub-list stay on that
 * sub-list's line, and the parent closes there too.
 *
 * Either way it is a `libs/sexpr` serializer defect that also moves
 * `.kicad_sch`/`.kicad_pcb`, so it is a separate PR. Excluding it silently
 * would let this comparison drift, so it is applied here as a named, narrow
 * transform of OUR text: only trailing bare atoms directly after a `(size …)`
 * inside a `(font …)`, which is the only shape the stock sheets contain. When
 * the serializer fix lands our output is already packed, this finds nothing to
 * do, and the test keeps passing.
 */
function applyA2AtomPacking(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const size = /^(\t+)(\(size [^)]*\))$/.exec(lines[i + 1] ?? '');
    if (!line.endsWith('(font') || !size) {
      out.push(line);
      continue;
    }
    const flags: string[] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const f = /^\t+(bold|italic)$/.exec(lines[j]!);
      if (!f) break;
      flags.push(f[1]!);
    }
    // No trailing atoms means KiCad breaks the closing paren too: leave it.
    if (flags.length === 0 || !/^\t+\)$/.test(lines[j] ?? '')) {
      out.push(line);
      continue;
    }
    out.push(line, `${size[1]}${size[2]}${flags.map((f) => ` ${f}`).join('')})`);
    i = j;
  }
  return out.join('\n');
}

describe('a sheet KiCad wrote and the same sheet we wrote', () => {
  it('agree byte for byte on the A4 ISO template, with nothing excluded', () => {
    // 69 items, and after A1 this needs no A2 exclusion at all: the template
    // has no multi-flag font node. This is the assertion the whole PR exists
    // for — before A1 it failed on nine `%`-form title-block strings.
    const source = fixture('A4_ISO5457-1999_ISO7200-2004_EN.kicad_wks');
    const sheet = parseDrawingSheet(source);
    expect(sheet.items).toHaveLength(69);
    expect(normalizeGenerator(serializeDrawingSheet(sheet))).toBe(
      normalizeGenerator(fixture('kicad-saved_A4_ISO5457-1999_ISO7200-2004_EN.kicad_wks')),
    );
  });

  it('agree on pagelayout_default once, and only once, A2 is applied', () => {
    const sheet = parseDrawingSheet(fixture('pagelayout_default.kicad_wks'));
    expect(sheet.items).toHaveLength(29);
    const ours = normalizeGenerator(serializeDrawingSheet(sheet));
    const theirs = normalizeGenerator(fixture('kicad-saved_pagelayout_default.kicad_wks'));
    expect(applyA2AtomPacking(ours)).toBe(theirs);
  });

  it('still differ on pagelayout_default WITHOUT the A2 exclusion', () => {
    // Guards the exclusion itself. If A2 ever lands, or if the fixture is
    // regenerated by a tool that does not apply the rule, this fails and the
    // helper above has to be revisited rather than quietly rubber-stamping.
    const ours = normalizeGenerator(
      serializeDrawingSheet(parseDrawingSheet(fixture('pagelayout_default.kicad_wks'))),
    );
    const theirs = normalizeGenerator(fixture('kicad-saved_pagelayout_default.kicad_wks'));
    expect(ours).not.toBe(theirs);
    // And the difference is exactly the one node, three lines' worth.
    expect(ours.split('\n').length - theirs.split('\n').length).toBe(3);
  });

  it('writes the modern ${…} form back, never the legacy one', () => {
    for (const name of [
      'A4_ISO5457-1999_ISO7200-2004_EN.kicad_wks',
      'pagelayout_default.kicad_wks',
    ]) {
      const out = serializeDrawingSheet(parseDrawingSheet(fixture(name)));
      expect(out, name).not.toMatch(/tbtext "?[^"\n]*%[A-Z]/);
      expect(out, name).toContain('${');
    }
  });
});

/* ------------------------------------------------------------------ *
 * The user-visible bug: the rendered title block
 * ------------------------------------------------------------------ */

describe('the rendered title block', () => {
  const CTX = {
    title: 'Power Supply',
    rev: 'B',
    date: '2026-08-19',
    company: 'ZiroEDA',
    comments: ['Comment one', 'Comment two', 'Comment three', 'Comment four'],
    paper: 'A4',
    fileName: 'psu.kicad_sch',
    sheetPath: '/',
    pageNumber: 2,
    sheetCount: 7,
    appVersion: '10.0.5',
  };

  const rendered = (name: string): string[] =>
    layoutDrawingSheet(parseDrawingSheet(fixture(name)), { widthMM: 297, heightMM: 210 }, CTX)
      .filter((d): d is DsTextItem => d.kind === 'text')
      .map((d) => d.text);

  it('resolves a real date and title on the A4 ISO sheet, not %D and %T', () => {
    const texts = rendered('A4_ISO5457-1999_ISO7200-2004_EN.kicad_wks');
    expect(texts).toContain('2026-08-19');
    expect(texts).toContain('Power Supply');
    expect(texts).toContain('ZiroEDA');
    expect(texts).toContain('B');
    // `%S/%N` is one string with two refs in it.
    expect(texts).toContain('2/7');
    // The comments, which are what the Design Inspector showed as `%C0`.
    expect(texts).toContain('Comment one');
    expect(texts).toContain('Comment two');
  });

  it('resolves the default sheet’s title block too', () => {
    const texts = rendered('pagelayout_default.kicad_wks');
    expect(texts).toContain('Title: Power Supply');
    expect(texts).toContain('File: psu.kicad_sch');
    expect(texts).toContain('Size: A4');
    expect(texts).toContain('Date: 2026-08-19');
  });

  it('leaves no % ref anywhere on either rendered page', () => {
    // The blunt statement of the bug: a literal %D on the drawing.
    for (const name of [
      'A4_ISO5457-1999_ISO7200-2004_EN.kicad_wks',
      'pagelayout_default.kicad_wks',
    ]) {
      for (const t of rendered(name)) {
        expect(t, `${name}: ${t}`).not.toMatch(/%[A-Z]/);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Breadth: every stock template on this machine
 * ------------------------------------------------------------------ */

const TEMPLATE_DIR = '/usr/share/kicad/template';
const templates = existsSync(TEMPLATE_DIR)
  ? readdirSync(TEMPLATE_DIR)
      .filter((n) => n.endsWith('.kicad_wks'))
      .sort()
  : [];

/**
 * Reads the installed KiCad's own templates. Vendoring all 36 would be 392 KB
 * of duplicated stationery, and the two pairs above already carry the exact
 * assertions; this is the breadth check. It is `skipIf` rather than silently
 * absent so that a run without KiCad installed says so out loud.
 */
describe.skipIf(templates.length === 0)('every stock template in /usr/share/kicad/template', () => {
  it('found the templates it means to check', () => {
    expect(templates.length).toBeGreaterThanOrEqual(30);
  });

  for (const name of templates) {
    it(`${name} converts, keeps version 0 and round-trips`, () => {
      const src = readFileSync(join(TEMPLATE_DIR, name), 'utf8');
      const sheet = parseDrawingSheet(src);

      // All of them are the unversioned legacy root.
      expect(sheet.version).toBe(0);

      // Nothing that reached the model still carries a legacy ref…
      for (const item of sheet.items) {
        if (item.type === 'text') expect((item as WksText).text).not.toMatch(/%[A-Z]/);
      }

      // …and the file we write back is the modern form and a fixed point, so
      // opening and saving does not keep churning the file.
      const out = serializeDrawingSheet(sheet);
      expect(out.trimStart().startsWith('(kicad_wks')).toBe(true);
      expect(serializeDrawingSheet(parseDrawingSheet(out))).toBe(out);
      expect(parseDrawingSheet(out).version).toBe(WKS_FILE_VERSION);
    });
  }

  it('is actually exercising the conversion, not a corpus with no % in it', () => {
    // Without this the sweep above would pass just as happily against a reader
    // that did nothing at all.
    let converted = 0;
    let texts = 0;
    for (const name of templates) {
      const src = readFileSync(join(TEMPLATE_DIR, name), 'utf8');
      texts += parseDrawingSheet(src).items.filter((i) => i.type === 'text').length;
      converted += (src.match(/\(tbtext\s+"?[^"\s()]*%/g) ?? []).length;
    }
    expect(converted).toBeGreaterThan(300);
    expect(texts).toBeGreaterThan(700);
  });
});
