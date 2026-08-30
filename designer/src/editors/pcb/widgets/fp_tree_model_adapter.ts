// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FP_TREE_MODEL_ADAPTER` (pcbnew/footprint_tree_model_adapter.cpp) — the
 * adapter the FOOTPRINT CHOOSER uses.
 *
 * NOT `FP_TREE_SYNCHRONIZING_ADAPTER`, which is the Footprint *Editor's*: that
 * one knows about the footprint currently open for editing and draws it struck
 * through (`GetAttr`), which is meaningless here. Upstream keeps them as two
 * classes over the same base for exactly that reason, and so do we — this file
 * is the plain one.
 *
 * `AddLibraries` walks the footprint library table and, per library, adds every
 * FOOTPRINT_INFO in it. Ours walks the shipped index instead, because there is
 * no fp-lib-table to read and no 15 447 `.kicad_mod` files to open: the index
 * carries the name, the pad count, the description and the tags per footprint,
 * which is what `FOOTPRINT_INFO` exposes to the tree.
 */
import { LibTreeNode, LibTreeNodeType } from '../../../widgets/lib_tree_model.js';
import type { LibTreeModelAdapter } from '../../../widgets/lib_tree_model_adapter.js';
import { footprintSearchTerms, type FpIndexEntry } from '../../../widgets/footprint_list.js';

/**
 * The filter `FOOTPRINT_CHOOSER_FRAME` installs on the adapter
 * (`adapter->SetFilter( &m_filter )`, panel_footprint_chooser.cpp:104).
 *
 * Both halves are the frame's knowledge, not the tree's: the fp_filters come
 * off the symbol and the pin count out of the symbol netlist, and both arrive
 * by KIWAY mail. Undefined means the corresponding checkbox is unticked or was
 * never shown.
 */
export interface FootprintTreeFilter {
  /** `m_fpFilters`, already lower-cased wildcard patterns. */
  readonly fpFilters?: readonly string[];
  /** `m_pinCount`; a footprint with a different pad count is filtered out. */
  readonly pinCount?: number;
}

/** `EDA_PATTERN_MATCH_WILDCARD_ANCHORED` — the whole string, `*` and `?`. */
function wildcardMatches(pattern: string, text: string): boolean {
  const rx = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  );
  return rx.test(text);
}

/**
 * `FOOTPRINT_CHOOSER_FRAME::filterFootprint`: a footprint survives when it
 * matches ANY of the fp filters and, separately, when its unique pad count
 * equals the symbol's pin count. An absent half does not filter.
 */
export function footprintPassesFilter(
  filter: FootprintTreeFilter,
  libNickname: string,
  name: string,
  pads: number | undefined,
): boolean {
  const { fpFilters, pinCount } = filter;

  if (fpFilters && fpFilters.length > 0) {
    // A filter may be `Lib:Name*` or a bare `Name*`; upstream matches the
    // LIB_ID when the pattern carries a colon and the name when it does not.
    const ok = fpFilters.some((p) =>
      p.includes(':') ? wildcardMatches(p, `${libNickname}:${name}`) : wildcardMatches(p, name),
    );
    if (!ok) return false;
  }

  // `pads === undefined` is an index generated before the field existed, and
  // the filter degrades to "no filtering" rather than to "nothing matches" -
  // the same graceful shape the rest of the footprint list uses.
  if (pinCount !== undefined && pads !== undefined && pads !== pinCount) return false;

  return true;
}

/**
 * `FP_TREE_MODEL_ADAPTER::AddLibraries`, over the shipped index.
 *
 * Presorted: the index is written in name order per library, so `finishLibrary`
 * is told so rather than re-sorting 15 000 rows on every regenerate.
 */
export function addFootprintLibraries(
  adapter: LibTreeModelAdapter,
  index: readonly FpIndexEntry[],
  filter: FootprintTreeFilter = {},
  pinnedLibs: readonly string[] = [],
): void {
  for (const lib of index) {
    const libNode = adapter.addLibrary(lib.name, '', pinnedLibs.includes(lib.name));

    lib.footprints.forEach((name, i) => {
      const pads = lib.pads?.[i];
      if (!footprintPassesFilter(filter, lib.name, name, pads)) return;

      const item = new LibTreeNode();
      item.type = LibTreeNodeType.ITEM;
      item.parent = libNode;
      item.name = name;
      item.libNickname = lib.name;
      item.libItemName = name;
      // `FOOTPRINT_INFO::m_doc` is what the Description column shows.
      item.desc = lib.descr?.[i] ?? '';
      // `FOOTPRINT_INFO::GetSearchTerms` — the six weighted terms, which
      // `footprintSearchTerms` already states once for the whole app.
      item.sourceSearchTerms = footprintSearchTerms(
        lib.name,
        name,
        lib.tags?.[i] ?? '',
        lib.descr?.[i] ?? '',
      );
      libNode.children.push(item);
    });

    adapter.finishLibrary(libNode, true);
  }

  adapter.tree.assignIntrinsicRanks();
}
