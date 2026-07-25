/**
 * Inter-sheet references — SCHEMATIC::RecomputeIntersheetRefs (map building)
 * and SCH_GLOBALLABEL::ResolveTextVar's `INTERSHEET_REFS` branch
 * (eeschema/schematic.cpp, sch_label.cpp). Quirks asserted straight from the
 * C++: only global labels participate, unknown labels resolve to "?", pages
 * sort numerically by virtual page, the abbreviated form kicks in only above
 * two pages, and removing the own page can leave an empty list (the token
 * branch has no early return, unlike GetIntersheetRefs).
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import {
  buildPageRefsMap,
  intersheetRefsAutoplaced,
  intersheetRefsField,
  intersheetRefsText,
  type IntersheetRefsConfig,
} from '@ziroeda/eeschema/src/tools/intersheet_refs.js';

const sch = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${body})`));

const glabel = (text: string, x = 10, y = 10, props = '') =>
  `(global_label "${text}" (shape input) (at ${x} ${y} 0) ${props} (uuid "g-${text}-${x}-${y}"))`;

describe('buildPageRefsMap (SCHEMATIC::RecomputeIntersheetRefs)', () => {
  it('collects virtual pages per resolved global-label text, ignoring other label kinds', () => {
    const s1 = sch(`${glabel('CLK')} (label "CLK" (at 50 50 0) (uuid "l1"))`);
    const s2 = sch(
      `${glabel('CLK')} (hierarchical_label "CLK" (shape input) (at 60 60 0) (uuid "h1"))`,
    );
    const s3 = sch(glabel('RST'));
    const map = buildPageRefsMap([
      { sch: s1, virtualPage: 1, pageString: '1' },
      { sch: s2, virtualPage: 2, pageString: '2' },
      { sch: s3, virtualPage: 3, pageString: '3' },
    ]);
    expect([...(map.get('CLK') ?? [])].sort()).toEqual([1, 2]);
    expect([...(map.get('RST') ?? [])]).toEqual([3]);
  });

  it('keys by the per-sheet resolved text (GetShownText)', () => {
    const s1 = sch(glabel('BUS_${N}'));
    const map = buildPageRefsMap([
      { sch: s1, virtualPage: 1, pageString: '1', resolve: (t) => t.replace('${N}', '7') },
    ]);
    expect(map.has('BUS_7')).toBe(true);
    expect(map.has('BUS_${N}')).toBe(false);
  });
});

describe('intersheetRefsText (SCH_GLOBALLABEL::ResolveTextVar)', () => {
  const cfg = (over: Partial<IntersheetRefsConfig> = {}): IntersheetRefsConfig => ({
    pageRefsMap: new Map([
      ['CLK', new Set([3, 1, 2])],
      ['RST', new Set([2])],
      ['EN', new Set([1, 2, 3, 4])],
    ]),
    virtualPageToPages: new Map([
      [1, '1'],
      [2, 'ii'],
      [3, 'A'],
      [4, '4'],
    ]),
    currentVirtualPage: 1,
    listOwnPage: true,
    formatShort: false,
    prefix: '[',
    suffix: ']',
    ...over,
  });

  it('lists the sorted page strings comma-separated inside prefix/suffix', () => {
    expect(intersheetRefsText('CLK', cfg())).toBe('[1,ii,A]');
  });

  it('resolves an unknown label to "?"', () => {
    expect(intersheetRefsText('NOPE', cfg())).toBe('[?]');
  });

  it('drops the current page when listOwnPage is off — possibly to empty', () => {
    expect(intersheetRefsText('CLK', cfg({ listOwnPage: false }))).toBe('[ii,A]');
    // The token branch has no early return: an empty list still renders.
    expect(intersheetRefsText('RST', cfg({ listOwnPage: false, currentVirtualPage: 2 }))).toBe(
      '[]',
    );
  });

  it('abbreviates to first..last only above two pages', () => {
    expect(intersheetRefsText('EN', cfg({ formatShort: true }))).toBe('[1..4]');
    // Own-page removal happens before the length check.
    expect(intersheetRefsText('CLK', cfg({ formatShort: true, listOwnPage: false }))).toBe(
      '[ii,A]',
    );
    expect(intersheetRefsText('CLK', cfg({ formatShort: true }))).toBe('[1..A]');
    expect(intersheetRefsText('RST', cfg({ formatShort: true }))).toBe('[ii]');
  });

  it('honours custom prefix/suffix', () => {
    expect(intersheetRefsText('RST', cfg({ prefix: '<', suffix: '>' }))).toBe('<ii>');
  });
});

describe('intersheetRefsField / intersheetRefsAutoplaced', () => {
  it('reads the stored "Intersheet References" property and detects custom placement', () => {
    const auto = sch(
      glabel(
        'CLK',
        10,
        10,
        `(property "Intersheet References" "\${INTERSHEET_REFS}" (at 10 10 0)
           (effects (font (size 1.27 1.27))))`,
      ),
    ).labels[0]!;
    const custom = sch(
      glabel(
        'CLK',
        10,
        10,
        `(property "Intersheet References" "\${INTERSHEET_REFS}" (at 25 30 0)
           (effects (font (size 1.27 1.27)) (justify left)))`,
      ),
    ).labels[0]!;
    const bare = sch(glabel('CLK')).labels[0]!;

    const autoField = intersheetRefsField(auto);
    expect(autoField).not.toBeNull();
    expect(intersheetRefsAutoplaced(auto, autoField)).toBe(true);

    const customField = intersheetRefsField(custom);
    expect(customField?.at).toEqual({ x: 250000, y: 300000 });
    expect(intersheetRefsAutoplaced(custom, customField)).toBe(false);

    expect(intersheetRefsField(bare)).toBeNull();
    expect(intersheetRefsAutoplaced(bare, null)).toBe(true);
  });
});
