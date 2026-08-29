// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which symbol the chooser scrolls to, which is a scoring question.
 *
 * `showResults()` keeps the highest-scoring ITEM as `firstMatch` and scrolls to
 * it (common/lib_tree_model_adapter.cpp:820-844, then Select +
 * EnsureVisibleIfEnabled at :376-388). Nothing is hidden; the tree is whole and
 * the view simply lands on the best match.
 *
 * So a tie is not harmless: it falls through to tree order, and the chooser
 * lands on whichever library happens to sort first. Typing "ter" in KiCad
 * selects Connector's Screw_Terminal_01x01; ours selected 74xGxx's
 * Inverter_Schmitt_Dual, because the tree was built from the index and the
 * index can only answer three of the seven terms `LIB_SYMBOL::cacheSearchTerms`
 * caches (eeschema/lib_symbol.cpp:160-183):
 *
 *     nickname                       4
 *     name                           8   IsName
 *     LIB_ID                        16   IsName
 *     EACH keyword token             4
 *     the whole keyword string       1
 *     description                    1
 *     footprint                      1
 *
 * With only the first three both symbols score 8 + 16 and tie. The keyword
 * token is what separates them, because `ScoreTerms` doubles a term matched at
 * position 0 (common/eda_pattern_match.cpp:510-516): "terminal" starts with
 * "ter" and pays 2 x 4, where "inverter" matches mid-word and pays 4.
 */
import { describe, it, expect } from 'vitest';
import { EdaCombinedMatcher, searchTerm } from '@ziroeda/common/src/eda_pattern_match.js';
import type { SearchTerm } from '@ziroeda/common/src/eda_pattern_match.js';

/** `LIB_SYMBOL::cacheSearchTerms`, in its documented order and weights. */
function cacheSearchTerms(
  nickname: string,
  name: string,
  keywords: string,
  description: string,
  footprint = '',
): SearchTerm[] {
  const terms = [
    searchTerm(nickname, 4),
    searchTerm(name, 8, true),
    searchTerm(`${nickname}:${name}`, 16, true),
    ...keywords
      .split(/\s+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(description, 1),
  ];
  if (footprint) terms.push(searchTerm(footprint, 1));
  return terms;
}

const SCREW = (): SearchTerm[] =>
  cacheSearchTerms(
    'Connector',
    'Screw_Terminal_01x01',
    'screw terminal',
    'Generic screw terminal, single row, 01x01',
  );
const INVERTER = (): SearchTerm[] =>
  cacheSearchTerms(
    '74xGxx',
    'Inverter_Schmitt_Dual',
    'dual schmitt inverter',
    'Dual schmitt inverter',
  );

const score = (terms: SearchTerm[], query: string): number =>
  new EdaCombinedMatcher(query).scoreTerms(terms).score;

describe('"ter" lands on the screw terminal, as KiCad does', () => {
  it('ranks Screw_Terminal_01x01 above Inverter_Schmitt_Dual', () => {
    expect(score(SCREW(), 'ter')).toBeGreaterThan(score(INVERTER(), 'ter'));
  });

  it('is the keyword term that separates them, not the name or the LIB_ID', () => {
    // The control, and the reason the index alone cannot rank this. With only
    // the three terms an index can answer, the two are indistinguishable - the
    // tie the chooser used to resolve by tree order.
    const nameOnly = (nickname: string, name: string): SearchTerm[] => [
      searchTerm(nickname, 4),
      searchTerm(name, 8, true),
      searchTerm(`${nickname}:${name}`, 16, true),
    ];

    expect(score(nameOnly('Connector', 'Screw_Terminal_01x01'), 'ter')).toBe(
      score(nameOnly('74xGxx', 'Inverter_Schmitt_Dual'), 'ter'),
    );
  });

  it('doubles a keyword matched at position 0, which is where the gap comes from', () => {
    // `if( found_pos == 0 ) score += 2 * term.Score; else score += term.Score;`
    const atStart = score([searchTerm('terminal', 4)], 'ter');
    const midWord = score([searchTerm('inverter', 4)], 'ter');

    expect(atStart).toBe(8);
    expect(midWord).toBe(4);
  });

  it('gives an exact name match the exact-match tier', () => {
    // `if( GetPattern() == term.Text ) { score += 8 * term.Score; if( IsName ) exact = true; }`
    const r = new EdaCombinedMatcher('screw_terminal_01x01').scoreTerms(SCREW());
    expect(r.exact).toBe(true);
  });

  it('does not promote an incidental description match into that tier', () => {
    // "an incidental keyword or description field equalling the query shouldn't
    // tie with an item whose actual name is the query" (eda_pattern_match.cpp:504-508).
    const r = new EdaCombinedMatcher('dual schmitt inverter').scoreTerms(INVERTER());
    expect(r.exact).toBe(false);
  });
});
