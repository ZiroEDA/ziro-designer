// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the Choose Symbol tree ranks a symbol on. Mirrors
 * kicad/eeschema/lib_symbol.cpp — `LIB_SYMBOL::cacheSearchTerms` (:159-183) and
 * `LIB_SYMBOL::cacheChooserFields` (:191-209).
 *
 * These two are separate on purpose and both feed the scorer: the search terms
 * are the symbol's own, and `LIB_TREE_NODE::RebuildSearchTerms`
 * (common/lib_tree_model.cpp:34-43) then appends the value of every chooser
 * field that is currently a SHOWN COLUMN, at weight 4. A column you can see is
 * a column you can search, and it is weighted like a keyword rather than like
 * the incidental description.
 *
 * That last part is what our ranking was missing, and it is not a rounding
 * error. Searching "ter" in Connector, KiCad ranks
 *
 *     DIN-5_180degree (11)  above  Samtec_ASP-134486-01 (10)
 *
 * even though Samtec's keyword "Terminal" matches at position 0 and doubles to
 * 8 where DIN-5's "stereo" matches mid-word for 4. The five points that turn it
 * over are DIN-5's description — one point as the `cacheSearchTerms` term, four
 * more as the shown "Description" column — and Samtec's description has no
 * "ter" in it at all. With only the seven `cacheSearchTerms` terms the two land
 * 10 against 7 the other way up. Measured against KiCad's own scorer in
 * qa/probes/chooser_score.
 */
import { searchTerm, type SearchTerm } from '@ziroeda/common';
import type { LibSymbol } from '@ziroeda/eeschema';

/**
 * The property names `SCH_IO_KICAD_SEXPR_PARSER::parseProperty` consumes into a
 * LIB_SYMBOL member instead of building a SCH_FIELD for
 * (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:1170-1200).
 *
 * We keep them as plain properties on `LibSymbol` — that is how `ki_keywords`
 * is read back below — so the chooser has to filter them out itself. Upstream
 * never sees them as fields, so they are neither chooser columns nor weight-4
 * search terms; `ki_description` is the pre-v8 spelling of the Description
 * field and would otherwise be counted twice.
 */
export const LIB_SYMBOL_MEMBER_PROPERTIES: readonly string[] = [
  'ki_keywords',
  'ki_description',
  'ki_fp_filters',
  'ki_locked',
];

/** The name of the keyword column upstream offers, `_( "Keywords" )`. */
export const KEYWORDS_COLUMN = 'Keywords';

const propValue = (sym: LibSymbol, key: string): string =>
  sym.properties.find((p) => p.key === key)?.value ?? '';

/**
 * `LIB_SYMBOL::cacheChooserFields`: the values the optional extra columns show,
 * keyed by column (field) name.
 *
 * EVERY field is a chooser field. `SCH_FIELD::m_showInChooser` is initialised
 * to true (eeschema/sch_field.cpp:130) and nothing in KiCad 10.0.5 ever clears
 * it — `SetShowInChooser` has no callers and `show_in_chooser` is not a token
 * this file format has. So this must NOT gate on our parsed `showInChooser`
 * flag, which we keep only to round-trip a token a later KiCad may write:
 * gating on it left this map holding nothing but the "Keywords" fallback, the
 * shown Description column contributed no term, and the ranking drifted.
 *
 * "If the user has a field named Keywords, then prefer that. Otherwise add the
 * KiCad keywords."
 */
export function symbolChooserFields(sym: LibSymbol): Map<string, string> {
  const fields = new Map<string, string>();

  for (const f of sym.properties) {
    if (!LIB_SYMBOL_MEMBER_PROPERTIES.includes(f.key)) fields.set(f.key, f.value);
  }

  if (!fields.has(KEYWORDS_COLUMN)) fields.set(KEYWORDS_COLUMN, propValue(sym, 'ki_keywords'));

  return fields;
}

/**
 * `LIB_SYMBOL::cacheSearchTerms`: the nickname at 4, the name at 8, the LIB_ID
 * at 16, then EACH keyword token at 4, the whole keyword string at 1, the
 * description at 1 and — only when it is set — the footprint at 1.
 *
 * The name and the LIB_ID are the only `IsName` terms: an incidental keyword
 * equalling the query must not tie with an item whose actual name is the query
 * (SEARCH_TERM::IsName, include/eda_pattern_match.h).
 *
 * The keyword tokenizer is `wxStringTokenizer( …, " \t\r\n", wxTOKEN_STRTOK )`,
 * which drops empty tokens — hence the filter.
 */
export function symbolSearchTerms(
  libNickname: string,
  name: string,
  sym: LibSymbol,
): SearchTerm[] {
  const keywords = propValue(sym, 'ki_keywords');
  const footprint = propValue(sym, 'Footprint');

  const terms: SearchTerm[] = [
    searchTerm(libNickname, 4),
    searchTerm(name, 8, true),
    searchTerm(`${libNickname}:${name}`, 16, true),
    ...keywords
      .split(/[ \t\r\n]+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(propValue(sym, 'Description'), 1),
  ];

  if (footprint) terms.push(searchTerm(footprint, 1));

  return terms;
}
