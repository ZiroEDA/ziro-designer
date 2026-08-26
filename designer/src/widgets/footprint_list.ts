// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The global footprint list backing the chooser widgets: library/footprint
 * names from the hosted libraries' index, lazy per-footprint `.kicad_mod`
 * fetches, and the symbol footprint-filter matching. Mirrors
 * kicad/common/footprint_info.cpp (FOOTPRINT_LIST) and
 * kicad/common/footprint_filter.cpp (FOOTPRINT_FILTER).
 *
 * Deployments serve the full KiCad footprint set from the same hosted bucket
 * as the symbol libraries (FOOTPRINTS_BASE / VITE_FOOTPRINTS_URL).
 */
import type { PcbFootprint } from '@ziroeda/pcbnew';
import { EdaCombinedMatcher, searchTerm, type SearchTerm } from '@ziroeda/common';
import { fetchLibraryIndex, libraryBase } from '../libraryHosts.js';
import { trackLibraryLoad } from './library_loading.js';
import { parseFootprint } from '../editors/footprint/footprintBoard.js';

export interface FpIndexEntry {
  name: string;
  footprints: string[];
  /**
   * Distinct numbered pads per footprint, parallel to `footprints`.
   *
   * Absent on an index generated before this field existed, and the pin-count
   * filter degrades to "no filtering" rather than to "nothing matches" — the
   * same graceful shape the power flag uses. It only takes effect once
   * `tools/libraries/upload.mjs` has regenerated the index.
   *
   * Counted the way `FOOTPRINT_INFO::GetUniquePadCount` does: distinct pad
   * *numbers*, so a two-pad SMD resistor is 2 and the unnumbered mechanical
   * pads on a connector shell add nothing.
   */
  pads?: number[];
  /**
   * `(descr …)` and `(tags …)` per footprint, parallel to `footprints`:
   * FOOTPRINT_INFO's `m_doc` and `m_keywords` (`footprint_info_impl.cpp:53-55`).
   *
   * They are here for the same reason `pads` is. `FOOTPRINT_INFO::GetSearchTerms`
   * scores the keywords and the description alongside the name, so a filter box
   * that cannot see them can never match "smd" or a manufacturer's name — and
   * fetching 15 000 `.kicad_mod` files to find out is not an option. Carrying
   * them costs the index about 220 kB gzipped, measured over the 15 447
   * footprints of the official library.
   *
   * Absent on an index generated before these fields existed, in which case the
   * search degrades to matching the nickname, the name and the LIB_ID — the
   * three terms that need no extra data.
   */
  descr?: string[];
  tags?: string[];
}

/**
 * `FOOTPRINT_INFO::GetSearchTerms` (common/footprint_info.cpp:67-86) — what the
 * filter box actually matches against, with upstream's weights:
 *
 *     nickname            4
 *     name                8   (a "name" term: only these can be an exact match)
 *     LIB_ID              16  (likewise)
 *     each keyword token  4
 *     the whole keywords  1   ("just in case", upstream's comment)
 *     the description     1
 *
 * Matching only the `Lib:Name` string, as this dialog did, throws away four of
 * the six: typing `smd`, `handsolder` or a manufacturer's name found nothing
 * here and dozens of footprints in KiCad.
 */
export function footprintSearchTerms(
  nickname: string,
  name: string,
  keywords = '',
  description = '',
): SearchTerm[] {
  const terms: SearchTerm[] = [
    searchTerm(nickname, 4),
    searchTerm(name, 8, true),
    searchTerm(`${nickname}:${name}`, 16, true),
  ];
  for (const token of keywords.split(/[\s\r\n\t]+/)) {
    if (token) terms.push(searchTerm(token, 4));
  }
  // Also include keywords as one long string, just in case.
  terms.push(searchTerm(keywords, 1));
  terms.push(searchTerm(description, 1));
  return terms;
}

/**
 * `FOOTPRINT_FILTER::FilterByTextPattern` (common/footprint_filter.cpp:214-227):
 * the box is split on whitespace and **each** token becomes its own
 * EDA_COMBINED_MATCHER, lower-cased, in the CTX_LIBITEM context (regex, then
 * wildcard, then plain substring — "whatever syntax users prefer, it shall be
 * matched"). An empty box produces no matchers, which matches everything.
 */
export function footprintTextMatchers(pattern: string): EdaCombinedMatcher[] {
  return pattern
    .toLowerCase()
    .split(/[\s\r\n\t]+/)
    .filter(Boolean)
    .map((term) => new EdaCombinedMatcher(term));
}

/**
 * The text-pattern half of `FOOTPRINT_FILTER::ITERATOR::increment`
 * (footprint_filter.cpp:86-101): a candidate is excluded as soon as **one**
 * matcher scores zero against its search terms, so every token in the box has
 * to hit something — but each token may hit a *different* term. `smd 0402`
 * keeps a footprint whose keywords say "smd" and whose name says "0402".
 *
 * Note this is a score test, not a position test: a hit anywhere in any term
 * counts. Substring, not anchored.
 */
export function matchesFootprintText(
  matchers: readonly EdaCombinedMatcher[],
  terms: SearchTerm[],
): boolean {
  for (const matcher of matchers) {
    if (matcher.scoreTerms(terms).score === 0) return false;
  }
  return true;
}

let indexPromise: Promise<FpIndexEntry[]> | null = null;

/**
 * `FOOTPRINT_LIST::GetFootprintInfo` (common/footprint_info.cpp:37-64) — is
 * this FPID one of the loaded libraries' footprints?
 *
 * The empty-name early return matters and is the whole of CvPcb finding B2:
 *
 *     if( aFootprintName.IsEmpty() )
 *         return nullptr;
 *
 * so an **unassigned** symbol answers "no" exactly as a symbol pointing at a
 * footprint that has gone missing does, and CvPcb's
 * `SYMBOLS_LISTBOX::AppendWarning` (readwrite_dlgs.cpp:277-278,
 * cvpcb_mainframe.cpp:662-666) is written on that answer alone.
 */
export function hasFootprintInfo(known: ReadonlySet<string>, fpid: string): boolean {
  if (!fpid) return false;
  return known.has(fpid);
}

/** Load the footprint-library index (library → footprint names). */
export function loadFootprintIndex(): Promise<FpIndexEntry[]> {
  if (!indexPromise) {
    indexPromise = trackLibraryLoad(
      'footprints',
      'Loading footprint libraries...',
      fetchLibraryIndex<FpIndexEntry>('footprints'),
    );
  }
  return indexPromise;
}

const fpCache = new Map<string, Promise<PcbFootprint | null>>();

/** Fetch + parse one footprint by its LIB_ID text ("Library:Name"). */
export function loadFootprint(libId: string): Promise<PcbFootprint | null> {
  let p = fpCache.get(libId);
  if (!p) {
    const sep = libId.indexOf(':');
    if (sep <= 0) return Promise.resolve(null);
    const lib = libId.slice(0, sep);
    const name = libId.slice(sep + 1);
    p = trackLibraryLoad(
      'footprints',
      `Loading ${lib}...`,
      fetch(
        `${libraryBase.footprints}/${encodeURIComponent(lib)}.pretty/${encodeURIComponent(name)}.kicad_mod`,
      )
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((text) => parseFootprint(text))
        .catch(() => null),
    );
    fpCache.set(libId, p);
  }
  return p;
}

/**
 * `FOOTPRINT_LIBRARY_ADAPTER`'s side of `IFACE::PreloadLibraries`
 * (pcbnew/pcbnew.cpp:772) — the work list the "Loading Footprint Libraries"
 * background job runs. The symbol counterpart is `symbolPreloadWork`
 * (editors/schematic/symbols/index.ts) and the reasoning is the same one:
 * upstream reads every table row off local disk, ours would be 155 hosted
 * libraries and 15 435 footprint files, so what is made resident is the index
 * plus every footprint the open design assigns.
 *
 * A LIB_ID with no library part is dropped; `loadFootprint` answers `null` for
 * one anyway, and counting a guaranteed non-fetch against the gauge would make
 * the preload look like it did more work than it did.
 */
export function footprintPreloadWork(fpIds: Iterable<string>): (() => Promise<unknown>)[] {
  const work: (() => Promise<unknown>)[] = [() => loadFootprintIndex()];
  const seen = new Set<string>();
  for (const fpId of fpIds) {
    const sep = fpId.indexOf(':');
    if (sep <= 0 || sep === fpId.length - 1) continue;
    if (seen.has(fpId)) continue;
    seen.add(fpId);
    work.push(() => loadFootprint(fpId));
  }
  return work;
}

/** One fp_filter glob compiled to an anchored matcher (EDA_PATTERN_MATCH_WILDCARD_ANCHORED). */
function compileFilter(pattern: string): { withLib: boolean; re: RegExp } | null {
  const withLib = pattern.includes(':');
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    return { withLib, re: new RegExp(`^${escaped}$`, 'i') };
  } catch {
    return null;
  }
}

/**
 * `FOOTPRINT_FILTER` over the index: a footprint is offered when it matches ANY
 * of the symbol's `fp_filters` globs (`FilterPattern`) **and**, when a pin
 * count is given, has that many distinct numbered pads (`FilterByPinCount`).
 * Results are "Lib:Name" ids, capped at `max` (upstream `m_max_items`).
 *
 * The two filters are independent, which is the part that is easy to get
 * wrong. Upstream offers pin-count-matched footprints for a symbol with **no**
 * `fp_filters` at all — so an empty glob list plus a pin count is not "match
 * nothing", it is "match on pins alone". Without a pin count an empty glob
 * list still matches nothing, because then there is no criterion left.
 */
export function filterFootprints(
  index: readonly FpIndexEntry[],
  filters: readonly string[],
  max = 400,
  pinCount?: number,
): string[] {
  const compiled = filters.map(compileFilter).filter((f) => f !== null);
  const byPins = pinCount !== undefined && pinCount > 0;
  if (compiled.length === 0 && !byPins) return [];
  const out: string[] = [];
  for (const lib of index) {
    for (const [i, name] of lib.footprints.entries()) {
      const id = `${lib.name}:${name}`;
      if (compiled.length > 0 && !compiled.some((f) => f.re.test(f.withLib ? id : name))) continue;
      if (byPins) {
        const pads = lib.pads?.[i];
        // An index without pad counts cannot answer, so it does not veto:
        // filtering everything out would be worse than not filtering.
        if (pads !== undefined && pads !== pinCount) continue;
      }
      out.push(id);
      if (out.length >= max) return out;
    }
  }
  return out;
}
