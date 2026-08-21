// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The central-value ratchet: colours and chrome metrics, per launcher.
 *
 * CLAUDE.md states the rule this file enforces - "wherever KiCad gets a value
 * from a shared place, we must get it from ours; never a local literal" - and
 * says it is NOT only fonts. `ui_font_tokens.test.ts` already ratchets font
 * sizes; this one ratchets the other two families a launcher drifts in:
 *
 *   colours       every hex, and every rgb()/rgba()/hsl() with literal numbers
 *   chrome px     a px length in a property the GTK THEME decides - padding,
 *                 margin, gap, height, border, border-radius, line-height
 *
 * KiCad writes none of those. wxWidgets asks GTK once, GTK answers out of the
 * desktop theme, and that single answer is why its eight launchers look like
 * one program without anybody maintaining eight themes. Ours is the `:root`
 * block in `designer/src/ui/shell.css`.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS, AND HOW TO MAKE A LITERAL STOP COUNTING
 * ---------------------------------------------------------------------------
 *
 * There are exactly two honest answers to a literal this file reports:
 *
 *  1. CONSUME THE TOKEN. `var(--ctl-height)`, `var(--wx-border)`,
 *     `var(--chrome-active)`. If the right token does not exist, add it to
 *     `ui/shell.css` with its ground truth ([css] the extracted Yaru
 *     stylesheet, or [px] a pixel sampled off a live KiCad window) and say in
 *     the PR which launchers it will move.
 *
 *  2. MARK IT, with the marker on the literal's own line or in the comment
 *     that introduces its run of declarations:
 *
 *       [data] KiCad hardcodes this itself. Cite the C++ - the E-series column
 *              hues (panel_eseries_display.h:93-129), the notebook's 10 px
 *              inset (bitmap2cmp_panel_base.cpp:30). Mirror upstream's table;
 *              do not invent one and call it data.
 *       [css]  straight out of Yaru's own gtk-dark.css.
 *       [px]   sampled off a live KiCad window, with the measurement quoted.
 *       [art]  our icon or glyph geometry, where KiCad ships a BITMAP and there
 *              is therefore no number to copy. Say which bitmap.
 *
 * A literal that is neither is drift, and the number below is what stops it
 * from growing. Restating a token's value locally is NOT an answer: a
 * launcher-local rule at (0,2,0) beats a shared widget at (0,1,0), so the local
 * copy silently wins and fixing the shared thing changes nothing at the call
 * site. State nothing locally.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MARKER GOVERNS A RUN AND NOT A FILE
 * ---------------------------------------------------------------------------
 *
 * CLAUDE.md lists "a file-level check where the rule is per-occurrence" as one
 * of the four shapes of test that cannot fail. The rule here IS per-occurrence,
 * so the marker is too: it covers the literal's OWN line, and the comment
 * lines directly above that line, and nothing else. A marker three
 * declarations up does not reach; a marker at the top of a rule does not reach
 * the rest of the rule. One literal, one marker.
 *
 * Two literals are never counted, and both are deliberate:
 *   - a custom-property DECLARATION (`--ctl-height: 34px`). Declaring the
 *     central value is the opposite of the thing being counted, the same
 *     reasoning ui_font_tokens.test.ts applies to `--ui-font-size:`.
 *   - the value `1px`. Yaru's own stylesheet writes `border: 1px solid`, so a
 *     hairline carries no information and there is no other value it could be.
 *     Every other length counts, `2px` included.
 *
 * font-size is NOT counted here. ui_font_tokens.test.ts owns it, and two
 * ratchets over one site means two numbers to lower for one fix.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBERS
 * ---------------------------------------------------------------------------
 *
 * They come out per launcher, as each launcher's parity work reaches it and can
 * be checked against that launcher's own captures - a 2,500-site sweep can only
 * be verified in aggregate, which is not verification. So this does not demand
 * they be gone. It demands they not GROW, and it demands that a pass which
 * removes some LOWERS the number, so the list stays a live checklist rather
 * than a ceiling nobody is under.
 *
 * The file is read as text rather than through a DOM, for the reason
 * ui_font_tokens.test.ts gives: qa's tsconfig cannot compile .tsx, jsdom does
 * not resolve var(), and a real browser is not available in CI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

/**
 * Seeded 2026-08-20 from the tree, per area, AFTER the central-values pass took
 * editors/image, editors/drawingsheet and editors/calculator's stylesheet.
 *
 * The three that pass did are at or near zero, and their survivors are all
 * labelled in the source:
 *
 *   editors/image         0 colours, 1 metric - the slider box's `+7px`, which
 *                         no GTK metric and no measurement accounts for.
 *   editors/drawingsheet  0 colours, 1 metric - the colour swatch's 26x22
 *                         against COLOR_SWATCH's SWATCH_SIZE_MEDIUM_DU.
 *   editors/calculator    49 colours and 28 metrics, of which calculator.css
 *                         holds 2 and 20. The rest are panels/*.tsx, held by
 *                         another branch when this landed, and the audit of
 *                         them is in that PR: 11 of the 12 resistor bands do
 *                         not match KiCad's own artwork, the galvanic ink rule
 *                         is BT.601@128 where KiCad uses BT.709@140
 *                         (panel_galvanic_corrosion.cpp:33-45), and every hue
 *                         in the four schematic diagrams is invented - KiCad's
 *                         wires are #000090 light / #42b8eb dark, its labels
 *                         #000000 / #f4eff3, its copper #fcb23c on #895502.
 *                         panel_eseries_display.tsx's seven ARE KiCad's, exact
 *                         to the byte, and need only the [data] marker.
 *
 * The rest are seeded where they stand, so they can only go down.
 */
const BASELINE: Record<string, { colours: number; metrics: number }> = {
  auth: { colours: 4, metrics: 0 },
  dialogs: { colours: 5, metrics: 35 },
  'editors/calculator': { colours: 2, metrics: 18 },
  'editors/drawingsheet': { colours: 0, metrics: 0 },
  'editors/footprint': { colours: 9, metrics: 20 },
  'editors/gerbview': { colours: 3, metrics: 4 },
  'editors/image': { colours: 0, metrics: 1 },
  'editors/pcb': { colours: 76, metrics: 397 },
  'editors/schematic': { colours: 70, metrics: 230 },
  'editors/symbol': { colours: 12, metrics: 20 },
  home: { colours: 7, metrics: 7 },
  mobile: { colours: 15, metrics: 23 },
  // 193 colours is the worst in the tree and 176 of them are rgba(): pcm.css
  // paints its status pills with a private palette. It is also the argument for
  // counting rgb() at all - a hex-only rule would have reported 17 here.
  pcm: { colours: 193, metrics: 53 },
  render: { colours: 4, metrics: 0 },
  // ui/ is the shared layer itself, so its literals are the ones that ought to
  // BE tokens. shell.css is 7,000 lines and this is the size of that debt.
  //
  // Two passes lowered this at once and neither side's figure survived the
  // merge: the file chooser took colours and metrics out by deleting the Open
  // Project dialog, and the drawing-sheet pass took more out of the toolbar and
  // the modal frame. The number below is a fresh scan of the merged tree.
  //
  // Lowered again by the GerbView layers-pane pass: the shared `.ze-app input`
  // rule stopped writing panel-chrome values over entry ones, `.ze-tb-textinfo`
  // stopped restating what it was already losing to, the checkbox accent went
  // to --chrome-active and three launchers stopped restating it, and the
  // COLOR_SWATCH border and the layer indicator's invented blue both went.
  //
  // And again by the New Project pass, which deleted the old dialog. Two
  // branches lowered these at once AGAIN and neither figure survived the merge:
  // 341/822 was the GerbView tree and 344/819 the New Project one, and the
  // merged tree is neither. Rescanned here, as it has to be every time.
  ui: { colours: 337, metrics: 816 },
  widgets: { colours: 6, metrics: 46 },
};

/** Properties whose value the GTK theme decides, so a px in one is drift. */
const CHROME_PROPS = [
  'line-height',
  'border-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'height',
  'min-height',
  'max-height',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'letter-spacing',
  'outline',
  'outline-width',
  'outline-offset',
];
/**
 * NOT width / min-width / flex-basis / top / left / grid-template-columns.
 * Those are ARRANGEMENT - which column a label sits in, how wide this panel is
 * - which every wxFormBuilder base file states per panel and which therefore
 * belongs to the launcher. calculator.css's own header draws the same line.
 */
const CSS_PROP = new RegExp(`(?<![-\\w])(${CHROME_PROPS.join('|')})\\s*:\\s*([^;{}]*)`, 'g');
const JSX_PROP = new RegExp(
  `(?<![\\w$])(${CHROME_PROPS.map((p) => p.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())).join('|')})\\s*:\\s*([^,;}\\n]*)`,
  'g',
);

const MARKER = /\[art\]|\[data\]|\[css\]|\[px\]/;
const PX = /(?<![-\w.])\d+(?:\.\d+)?px(?![-\w])/g;
/** A bare number in a React style object is px: `gap: 8` renders as 8px. */
const BARE = /^\s*-?\d+(?:\.\d+)?\s*$/;
/**
 * A colour literal. `rgba?\(\s*[\d.]` is deliberate: it matches
 * `rgba(120, 160, 220, 0.3)` and skips `rgba(${c.r},...)`, which is a value
 * computed at runtime from data and not a literal at all.
 */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|(?<![-\w])(?:rgba?|hsla?)\(\s*[\d.]/g;
/** A custom-property declaration: the central value, not a copy of one. */
const TOKEN_DECL = /^\s*--[\w-]+\s*:/;

/** Blank every comment to spaces, keeping newlines so line numbers survive. */
function blankComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text[i] === '/' && text[i + 1] === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? text.length : j + 2;
      for (let k = i; k < j; k++) out += text[k] === '\n' ? '\n' : ' ';
      i = j;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = text.length;
      for (let k = i; k < j; k++) out += ' ';
      i = j;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/**
 * The comment governing line `i`: that line itself, plus the contiguous run of
 * WHOLLY-comment lines immediately above it. Nothing else.
 *
 * This was once generous - it walked up over the neighbouring declarations to
 * the comment that introduced them, so one `[px]` covered a whole rule. Two
 * mutants killed that: putting `#eeeeee` into a run whose first line carried
 * `[art]`, and putting `#101215` back under a line whose TRAILING `[data]` was
 * three declarations above, both went unreported. A marker that reaches past
 * its own line is a marker somebody else's literal can hide behind, which is
 * CLAUDE.md's "file-level check where the rule is per-occurrence" in miniature.
 *
 * So: one literal, one marker. It is more typing and that is the point - each
 * survivor is a decision somebody made on purpose.
 */
function governing(raw: string[], code: string[], i: number): string {
  const whollyComment = (k: number): boolean =>
    /\S/.test(raw[k] ?? '') && !/\S/.test(code[k] ?? '');
  let s = i;
  while (s > 0 && whollyComment(s - 1)) s--;
  return raw.slice(s, i + 1).join('\n');
}

interface Site {
  area: string;
  kind: 'colours' | 'metrics';
  where: string;
  what: string;
}

function scan(): Site[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(css|tsx|ts)$/.test(p)) files.push(p);
    }
  })(SRC);
  files.sort();

  const sites: Site[] = [];
  for (const file of files) {
    const rel = relative(SRC, file);
    const parts = rel.split('/');
    const area = parts[0] === 'editors' ? `editors/${parts[1]}` : (parts[0] ?? '');
    const isCss = file.endsWith('.css');
    const raw = readFileSync(file, 'utf8').split('\n');
    const code = blankComments(raw.join('\n')).split('\n');

    code.forEach((line, i) => {
      if (TOKEN_DECL.test(line)) return;
      const marked = MARKER.test(governing(raw, code, i));

      for (const m of line.matchAll(COLOUR)) {
        if (marked) continue;
        sites.push({ area, kind: 'colours', where: `${rel}:${i + 1}`, what: m[0] });
      }

      for (const m of line.matchAll(isCss ? CSS_PROP : JSX_PROP)) {
        const prop = m[1] ?? '';
        const value = m[2] ?? '';
        let lengths = value.match(PX) ?? [];
        // `lineHeight: 1.4` is a RATIO, which is the correct CSS idiom, not a
        // length; only an explicit px on it is a literal.
        if (!isCss && !lengths.length && prop !== 'lineHeight' && BARE.test(value)) {
          if (Number(value.trim()) !== 0) lengths = [`${value.trim()}px`];
        }
        for (const px of lengths) {
          if (px === '1px' || marked) continue;
          sites.push({ area, kind: 'metrics', where: `${rel}:${i + 1}`, what: `${prop}: ${px}` });
        }
      }
    });
  }
  return sites;
}

const SITES = scan();

const countsBy = (kind: Site['kind']): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of SITES) if (s.kind === kind) out[s.area] = (out[s.area] ?? 0) + 1;
  return out;
};

/** The first few offenders, so a failure names files rather than a number. */
const examples = (area: string, kind: Site['kind']): string =>
  SITES.filter((s) => s.area === area && s.kind === kind)
    .slice(0, 4)
    .map((s) => `      ${s.where}  ${s.what}`)
    .join('\n');

const HOWTO =
  'Either consume the token from designer/src/ui/shell.css (adding it there if ' +
  'it is missing), or mark the literal on its own line with [data] and the C++ ' +
  'that hardcodes it, [css] and the Yaru rule, [px] and the measurement, or ' +
  '[art] and the bitmap KiCad ships instead. Restating the token value locally ' +
  'is not an answer - see the head of this file.';

describe('the scan totals, so the numbers in the PR stay true', () => {
  /*
   * Two plain numbers, and they are load-bearing rather than decorative.
   *
   * Mutating the per-area growth check so it compares the baseline to ITSELF -
   * `n` replaced by `BASELINE[area]`, CLAUDE.md's "a value nothing ever reads"
   * - left that check unable to fail while every other test still passed. The
   * totals cannot be satisfied without reading the scan, so a growth that slips
   * a gutted per-area check still lands here.
   *
   * RECOUNTED FROM THE TREE, not summed from a diff: ui_font_tokens.test.ts
   * records that keeping a stale total is the specific way that file has been
   * broken before.
   */
  it('the tree-wide totals, rescanned where three passes met', () => {
    // RECOUNTED FROM THE MERGED TREE, not summed from either branch's diff.
    // Two branches lowered these at the same time, so both of their numbers
    // were wrong here and neither could be adopted; the scan is the only
    // authority. What each pass took out is recorded in its own commit.
    expect(SITES.filter((s) => s.kind === 'colours').length).toBe(743);
    expect(SITES.filter((s) => s.kind === 'metrics').length).toBe(1670);
  });

  it('and the two agree with the per-area table, which is where they come from', () => {
    const sum = (k: 'colours' | 'metrics'): number =>
      Object.values(BASELINE).reduce((a, b) => a + b[k], 0);
    expect(sum('colours')).toBe(SITES.filter((s) => s.kind === 'colours').length);
    expect(sum('metrics')).toBe(SITES.filter((s) => s.kind === 'metrics').length);
  });
});

describe('a launcher may not gain a colour literal', () => {
  it('every area is at or under its baseline', () => {
    const counts = countsBy('colours');
    const grown = Object.entries(counts)
      .filter(([area, n]) => n > (BASELINE[area]?.colours ?? 0))
      .map(
        ([area, n]) =>
          `${area}: ${n} colour literals now, ${BASELINE[area]?.colours ?? 0} allowed.\n` +
          `${examples(area, 'colours')}\n    ${HOWTO}`,
      );
    expect(grown).toStrictEqual([]);
  });

  it('and a pass that removes some lowers the number here', () => {
    const counts = countsBy('colours');
    const stale = Object.entries(BASELINE)
      .filter(([area, b]) => (counts[area] ?? 0) < b.colours)
      .map(
        ([area, b]) =>
          `${area}: ${counts[area] ?? 0} colour literals now, baseline still says ` +
          `${b.colours}. Lower it - the numbers are the checklist, and one left ` +
          'high is a ceiling nobody is under.',
      );
    expect(stale).toStrictEqual([]);
  });
});

describe('a launcher may not gain a chrome metric literal', () => {
  it('every area is at or under its baseline', () => {
    const counts = countsBy('metrics');
    const grown = Object.entries(counts)
      .filter(([area, n]) => n > (BASELINE[area]?.metrics ?? 0))
      .map(
        ([area, n]) =>
          `${area}: ${n} chrome px literals now, ${BASELINE[area]?.metrics ?? 0} allowed.\n` +
          `${examples(area, 'metrics')}\n    ${HOWTO}`,
      );
    expect(grown).toStrictEqual([]);
  });

  it('and a pass that removes some lowers the number here', () => {
    const counts = countsBy('metrics');
    const stale = Object.entries(BASELINE)
      .filter(([area, b]) => (counts[area] ?? 0) < b.metrics)
      .map(
        ([area, b]) =>
          `${area}: ${counts[area] ?? 0} chrome px literals now, baseline still ` +
          `says ${b.metrics}. Lower it.`,
      );
    expect(stale).toStrictEqual([]);
  });

  it('no area is missing from the baseline - a new one starts at zero, not free', () => {
    // Without this, `designer/src/editors/newthing/` would default to `?? 0`
    // on the way in and simply never be listed, which is how an area escapes a
    // ratchet: not by growing, but by not being in the table at all.
    const areas = new Set(SITES.map((s) => s.area));
    const unlisted = [...areas].filter((a) => !(a in BASELINE));
    expect(unlisted).toStrictEqual([]);
  });
});

describe('the three launchers this pass took are actually on the tokens', () => {
  /*
   * The counts above would still pass if a launcher swapped one literal for
   * another, so these name what is left by NAME. Each is labelled in its own
   * source as unproven, and each is the last one in that launcher.
   */
  it('editors/image has no colour literal at all', () => {
    expect(SITES.filter((s) => s.area === 'editors/image' && s.kind === 'colours')).toStrictEqual(
      [],
    );
  });

  it('editors/drawingsheet has no colour literal at all', () => {
    expect(
      SITES.filter((s) => s.area === 'editors/drawingsheet' && s.kind === 'colours'),
    ).toStrictEqual([]);
  });

  it("editors/image's one metric is the slider box, and it is admitted to", () => {
    const left = SITES.filter((s) => s.area === 'editors/image' && s.kind === 'metrics');
    expect(left.map((s) => s.what)).toStrictEqual(['height: 7px']);
    const css = readFileSync(join(SRC, 'editors/image/imageConverter.css'), 'utf8');
    expect(css).toContain('NOT PROVEN');
  });

  it('editors/drawingsheet has no metric literal left either', () => {
    // Its last one was the colour swatch, marked NOT PROVEN because nobody had
    // measured a real COLOR_SWATCH. qa/probes measures one now — 48 x 23, not
    // the 26 x 22 that stood here — so the size is --swatch-medium-* and the
    // admission is no longer needed.
    expect(
      SITES.filter((s) => s.area === 'editors/drawingsheet' && s.kind === 'metrics'),
    ).toStrictEqual([]);
    const src = readFileSync(join(SRC, 'editors/drawingsheet/PropertiesFrame.tsx'), 'utf8');
    expect(src).not.toContain('NOT PROVEN');
  });

  it('calculator.css keeps only the modal, which says why', () => {
    const left = SITES.filter((s) => s.where.startsWith('editors/calculator/calculator.css'));
    // Every one of them is inside a block the file labels. The two colours are
    // the modal backdrop and its shadow; if either moves out of that block this
    // list changes and the exemption has to be re-argued.
    expect(left.filter((s) => s.kind === 'colours').map((s) => s.what)).toStrictEqual([
      'rgb(0',
      'rgb(0',
    ]);
    const css = readFileSync(join(SRC, 'editors/calculator/calculator.css'), 'utf8');
    expect(css).toContain('NOT DONE, AND DELIBERATELY LEFT COUNTED');
    expect(css).toContain('UNPROVEN, left counted');
  });
});

describe('the scanner itself sees what it claims to', () => {
  /*
   * A ratchet whose scanner silently matches nothing passes forever. These pin
   * the four things it must not stop doing, against the tree rather than
   * against a fixture, so they break if the regexes rot.
   */
  it('finds literals in .css, .ts and .tsx alike', () => {
    const exts = new Set(SITES.map((s) => (s.where.match(/\.(\w+):\d+$/) ?? [])[1]));
    expect([...exts].sort()).toStrictEqual(['css', 'ts', 'tsx']);
  });

  it('counts rgb() as a colour, not only hex', () => {
    expect(SITES.some((s) => s.kind === 'colours' && s.what.startsWith('rgb'))).toBe(true);
  });

  it('counts a bare number in a React style object', () => {
    // `gap: 8` is 8px to React. If BARE ever stops matching, every inline style
    // in the tree becomes invisible to this file at once.
    const jsx = SITES.filter((s) => s.kind === 'metrics' && /\.tsx:/.test(s.where));
    expect(jsx.length).toBeGreaterThan(0);
  });

  it('ignores a token declaration, and ignores it only there', () => {
    const shell = readFileSync(join(SRC, 'ui/shell.css'), 'utf8').split('\n');
    const decl = shell.findIndex((l) => /^\s*--ctl-height:\s*34px/.test(l));
    expect(decl, 'ui/shell.css no longer declares --ctl-height: 34px').toBeGreaterThan(0);
    expect(SITES.some((s) => s.where === `ui/shell.css:${decl + 1}`)).toBe(false);

    // ...and ONLY there. shell.css also RESTATES 34px in ordinary rules instead
    // of consuming its own token, and every one of those is still reported -
    // which is what makes the exemption narrow rather than a hole.
    const restated = SITES.filter(
      (s) => s.what === 'height: 34px' && s.where.startsWith('ui/shell.css'),
    );
    expect(restated.length).toBeGreaterThan(0);
    expect(TOKEN_DECL.test('  height: 34px;')).toBe(false);
  });

  it('a marker covers its own line and the comment above it, and nothing else', () => {
    const raw = [
      '.a {',
      '  /* [px] measured */',
      '  padding: 7px;',
      '  margin: 9px;',
      '  gap: 11px; /* [px] measured too */',
      '  row-gap: 13px;',
      '}',
    ];
    const code = blankComments(raw.join('\n')).split('\n');
    expect(MARKER.test(governing(raw, code, 2))).toBe(true); // comment above it
    expect(MARKER.test(governing(raw, code, 3))).toBe(false); // one line further
    expect(MARKER.test(governing(raw, code, 4))).toBe(true); // trailing, own line
    expect(MARKER.test(governing(raw, code, 5))).toBe(false); // the next line
  });
});
