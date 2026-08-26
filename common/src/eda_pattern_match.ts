// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Search-pattern matching and weighted scoring for library/item choosers.
 * Mirrors kicad/common/eda_pattern_match.cpp (EDA_PATTERN_MATCH_* and
 * EDA_COMBINED_MATCHER with ScoreTerms).
 *
 * A combined matcher tries, in order: regular expression, wildcard (?/*) and
 * plain substring, "whatever syntax users prefer, it shall be matched"
 * (CTX_LIBITEM). The relational matcher (`pins>4`) is not ported: the web
 * library index carries no per-item numeric fields to relate against.
 *
 * The context argument selects which matchers are built, and it is not a
 * refinement of one predicate: CTX_NETCLASS builds the two ANCHORED matchers
 * and nothing else, so a netclass pattern is a whole-string regular expression
 * OR a whole-string glob, never a substring, and — like wxRegEx::Compile
 * without wxRE_ICASE — it is case-sensitive.
 */

/** One weighted search term of a tree item (upstream SEARCH_TERM, lib_tree_item.h). */
export interface SearchTerm {
  text: string;
  /** Relative weight, e.g. item name 8, LIB_ID 16, keywords 4, description 1. */
  score: number;
  /**
   * Only the item's own name/LIB_ID can promote it into the exact-match tier;
   * an incidental keyword equalling the query shouldn't tie with an item whose
   * actual name is the query.
   */
  isName?: boolean;
  /** Lazily lower-cased/trimmed on first scoring pass (upstream `Normalized`). */
  normalized?: boolean;
}

export function searchTerm(text: string, score: number, isName = false): SearchTerm {
  return { text, score, isName };
}

const NOT_FOUND = -1;

interface PatternMatcher {
  /**
   * `EDA_PATTERN_MATCH::Find( aCandidate )` — position of the first match, or
   * -1, on a candidate that is **already normalised**.
   *
   * Upstream's matchers are all case-SENSITIVE: `wxString::Find` for SUBSTR,
   * and `wxRegEx::Compile( …, wxRE_ADVANCED )` — no `wxRE_ICASE` — for the
   * other two. What makes a library search feel case-insensitive is the caller
   * folding both sides first: `EDA_COMBINED_MATCHER::ScoreTerms` lower-cases
   * `term.Text` (eda_pattern_match.cpp:485-495) and every CTX_LIBITEM caller
   * lower-cases the query token before constructing the matcher.
   *
   * This is therefore the hot entry point, and it must not fold anything.
   *
   * (The two unanchored regex/wildcard matchers below still carry the `i` flag,
   * which upstream does not. That is a separate divergence and costs nothing at
   * run time — a flag, not an allocation — so it is left as it is rather than
   * changed under a performance fix.)
   */
  find(candidate: string): number;
}

/**
 * `EDA_PATTERN_MATCH_SUBSTR::Find` (eda_pattern_match.cpp:49-57), verbatim:
 *
 *     int loc = aCandidate.Find( m_pattern );
 *
 * A plain substring search that folds neither side, because `ScoreTerms` has
 * already lower-cased the candidate and the caller the pattern.
 *
 * Ours folded the candidate here instead, allocating a fresh lower-cased copy
 * of every search term on every keystroke. The symbol chooser's tree holds
 * 219 176 of them, and the same scan measured 35.1 ms with the fold against
 * 18.2 ms without — the largest single item in a 48 ms debounced keystroke.
 */
function substrMatcher(pattern: string): PatternMatcher {
  return { find: (candidate) => candidate.indexOf(pattern) };
}

/**
 * EDA_PATTERN_MATCH_WILDCARD: `?` = any char, `*` = any run, everything else
 * escaped to a literal.
 *
 * `SetPattern` (common/eda_pattern_match.cpp:157-193) always succeeds, so this
 * matcher is built for EVERY pattern, wildcards in it or not — with none it
 * degenerates to the literal the substring matcher already finds, which is
 * exactly why upstream can lean on it as the fallback that "will try its best".
 */
function wildcardMatcher(pattern: string): PatternMatcher | null {
  try {
    // No `i`. `EDA_PATTERN_MATCH_WILDCARD::SetPattern` compiles through
    // `EDA_PATTERN_MATCH_REGEX` with `wxRE_ADVANCED` alone
    // (common/eda_pattern_match.cpp:105) - no `wxRE_ICASE` - because the case
    // fold happens once, in `ScoreTerms`, on the term and on the query. Two
    // separate passes here each flagged this as harmless on its own; together
    // they are not, because the wildcard matcher is now built unconditionally
    // and an `i` on it puts the folding straight back.
    const re = new RegExp(wildcardToRegex(pattern));
    return { find: (candidate) => candidate.search(re) };
  } catch {
    return null;
  }
}

/**
 * EDA_PATTERN_MATCH_REGEX: the query as a regular expression — but only when
 * the query SAYS it is one.
 *
 * `SetPattern` (common/eda_pattern_match.cpp:80-104) takes the pattern whole if
 * it is `^…$`, strips the delimiters if it is `/…/` (the trailing slash is
 * optional, "requiring a '/' on the end means they get no feedback while they
 * type"), and otherwise returns false with the comment "for now regular
 * expressions must be explicit" — whereupon `AddMatcher` drops the matcher
 * entirely.
 *
 * We used to compile any pattern containing a metacharacter, which is a much
 * larger claim: KiCad finds NOTHING for `r+` or `c.` or `(R)` in Device,
 * because the only two matchers left are the escaped wildcard and the plain
 * substring and no symbol contains that literal text. Ours turned `r+` into
 * /r+/ and matched half the library. Measured with qa/probes/chooser_score.
 */
function regexMatcher(pattern: string): PatternMatcher | null {
  let source: string;

  if (pattern.startsWith('^') && pattern.endsWith('$')) {
    source = pattern;
  } else if (pattern.startsWith('/')) {
    source = pattern.slice(1);
    if (source.endsWith('/')) source = source.slice(0, -1);
  } else {
    return null;
  }

  try {
    // `wxRE_ADVANCED` and nothing else; see the wildcard matcher above.
    const re = new RegExp(source);
    return { find: (candidate) => candidate.search(re) };
  } catch {
    return null;
  }
}

/** The characters EDA_PATTERN_MATCH_WILDCARD escapes on its way to a regex. */
const WILDCARD_ESCAPES = new Set([...'.*+?^${}()|[]/\\']);

/** EDA_PATTERN_MATCH_WILDCARD::SetPattern's wildcard -> regex translation. */
function wildcardToRegex(pattern: string): string {
  let out = '';
  for (const c of pattern) {
    if (c === '?') out += '.';
    else if (c === '*') out += '.*';
    else if (WILDCARD_ESCAPES.has(c)) out += `\\${c}`;
    else out += c;
  }
  return out;
}

/**
 * EDA_PATTERN_MATCH_WILDCARD_ANCHORED: the same translation wrapped in `^`/`$`.
 * Unlike the unanchored form this is built even for a pattern with no `*` or
 * `?` in it, because anchoring alone changes what the pattern means.
 */
function wildcardAnchoredMatcher(pattern: string): PatternMatcher | null {
  try {
    const re = new RegExp(`^${wildcardToRegex(pattern)}$`);
    return { find: (candidate) => candidate.search(re) };
  } catch {
    return null;
  }
}

/**
 * EDA_PATTERN_MATCH_REGEX_ANCHORED: `^` and `$` are added if absent and the
 * result is compiled as a regular expression. Case-sensitive, as
 * wxRegEx::Compile( …, wxRE_ADVANCED ) is. A pattern that will not compile
 * yields no matcher at all (EDA_COMBINED_MATCHER::AddMatcher drops it).
 */
function regexAnchoredMatcher(pattern: string): PatternMatcher | null {
  let anchored = pattern;
  if (!anchored.startsWith('^')) anchored = `^${anchored}`;
  if (!anchored.endsWith('$')) anchored = `${anchored}$`;
  try {
    const re = new RegExp(anchored);
    return { find: (candidate) => candidate.search(re) };
  } catch {
    return null;
  }
}

/**
 * COMBINED_MATCHER_CONTEXT. CTX_NET, CTX_SIGNAL and CTX_SEARCH build regex +
 * wildcard + substring, which is what CTX_LIBITEM does here too once the
 * unported relational matcher is set aside; CTX_NETCLASS is the odd one out.
 */
export enum CombinedMatcherContext {
  LIBITEM = 'libitem',
  NET = 'net',
  NETCLASS = 'netclass',
  SIGNAL = 'signal',
  SEARCH = 'search',
}

/**
 * EDA_COMBINED_MATCHER (context CTX_LIBITEM): one search token matched through
 * every syntax the token could plausibly be.
 */
export class EdaCombinedMatcher {
  private readonly pattern: string;
  private readonly matchers: PatternMatcher[] = [];

  constructor(pattern: string, context = CombinedMatcherContext.LIBITEM) {
    this.pattern = pattern;

    if (context === CombinedMatcherContext.NETCLASS) {
      const anchoredRegex = regexAnchoredMatcher(pattern);
      if (anchoredRegex) this.matchers.push(anchoredRegex);
      const anchoredWildcard = wildcardAnchoredMatcher(pattern);
      if (anchoredWildcard) this.matchers.push(anchoredWildcard);
      return;
    }

    const regex = regexMatcher(pattern);
    if (regex) this.matchers.push(regex);
    const wildcard = wildcardMatcher(pattern);
    if (wildcard) this.matchers.push(wildcard);
    // If the above matchers couldn't be created because the pattern syntax
    // does not match, the substring will try its best.
    this.matchers.push(substrMatcher(pattern));
  }

  getPattern(): string {
    return this.pattern;
  }

  /**
   * `EDA_COMBINED_MATCHER::Find`, earliest match position across the matchers,
   * or -1, over a candidate **that has already been normalised**.
   *
   * Every caller has one: `scoreTerms` normalises the term itself, and the
   * library browser passes `lib.name.toLowerCase()`. Both also lower-case the
   * pattern before constructing the matcher, which is the other half of what
   * makes a search case-insensitive; neither half happens in here, exactly as
   * upstream's `Find` does neither.
   */
  find(candidate: string): number {
    let position = NOT_FOUND;
    for (const matcher of this.matchers) {
      const at = matcher.find(candidate);
      if (at >= 0 && (position === NOT_FOUND || at < position)) position = at;
    }
    return position;
  }

  /**
   * EDA_COMBINED_MATCHER::StartsWith, true when any one matcher matches from
   * position 0. Both CTX_NETCLASS matchers are anchored, so for a netclass
   * pattern this reads as "the whole net name is described by the pattern".
   */
  startsWith(term: string): boolean {
    for (const matcher of this.matchers) {
      if (matcher.find(term) === 0) return true;
    }
    return false;
  }

  /**
   * EDA_COMBINED_MATCHER::ScoreTerms, weigh this matcher against an item's
   * search terms: 8× for an exact term match, 2× for a match at the start,
   * 1× anywhere else. `exact` is set only when a name term equals the query.
   */
  scoreTerms(terms: SearchTerm[]): { score: number; exact: boolean } {
    let score = 0;
    let exact = false;

    for (const term of terms) {
      if (!term.normalized) {
        // Don't hang if someone accidentally pastes a whole schematic into
        // the search box.
        term.text = term.text.toLowerCase().trim().slice(0, 1000);
        term.normalized = true;
      }

      if (this.pattern === term.text) {
        score += 8 * term.score;
        if (term.isName) exact = true;
      } else {
        // `Find( term.Text, ... )` — the term was normalised just above (or on
        // an earlier pass), so this is upstream's case-sensitive search and
        // must not fold again.
        const at = this.find(term.text);
        if (at === 0) score += 2 * term.score;
        else if (at > 0) score += term.score;
      }
    }

    return { score, exact };
  }
}

/**
 * Upstream keeps one EDA_COMBINED_MATCHER per netclass assignment for the life
 * of the NET_SETTINGS (net_settings.cpp:614); callers here are handed plain
 * strings, so cache by pattern rather than recompile two regexes per net.
 */
const NETCLASS_MATCHERS = new Map<string, EdaCombinedMatcher>();

/**
 * `EDA_COMBINED_MATCHER( pattern, CTX_NETCLASS ).StartsWith( netName )` — the
 * predicate NET_SETTINGS::GetEffectiveNetClass applies to every
 * `netclass_patterns` row (net_settings.cpp:807).
 *
 * Note what StartsWith means here: "some matcher matched from position 0", and
 * both CTX_NETCLASS matchers are anchored at BOTH ends. It is not a prefix
 * test, it is not a plain glob, and it does not fold case.
 */
export function netclassPatternMatches(pattern: string, netName: string): boolean {
  if (!pattern) return false;
  let matcher = NETCLASS_MATCHERS.get(pattern);
  if (!matcher) {
    matcher = new EdaCombinedMatcher(pattern, CombinedMatcherContext.NETCLASS);
    NETCLASS_MATCHERS.set(pattern, matcher);
  }
  return matcher.startsWith(netName);
}
