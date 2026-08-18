// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The rule table `PANEL_SETUP_SEVERITIES` is built from, and its severities.
 *
 * Split out of the panel itself because `qa`'s tsconfig cannot compile `.tsx`,
 * so anything a test needs to import has to be plain TypeScript.
 */

/** `SEVERITY`, the three the panel offers (severity.h, `RPT_SEVERITY_*`). */
export type SetupSeverity = 'error' | 'warning' | 'ignore';

/** An `RC_ITEM` with a non-zero error code: a rule the user can re-grade. */
export interface SeverityItem {
  /** `RC_ITEM::GetErrorCode()`, which is also the key the project file stores. */
  readonly code: string;
  /** `RC_ITEM::GetErrorText()`. */
  readonly title: string;
}

/** An `RC_ITEM` whose error code is 0: a heading row, and the rules under it. */
export interface SeverityGroup {
  readonly heading: string;
  readonly items: readonly SeverityItem[];
}

/**
 * Fold a flat rule list into the panel's groups.
 *
 * `ERC_ITEM::allItemTypes` and `DRC_ITEM::allItemTypes` are single flat lists
 * in which an entry with error code 0 is a heading, and
 * `PANEL_SETUP_SEVERITIES` walks them in order emitting a heading row whenever
 * it meets one (panel_setup_severities.cpp:62-71). `ERC_ITEMS` carries the
 * heading on each row instead, so this reproduces that walk: consecutive rows
 * with the same heading become one group, in the list's order, and a heading
 * that comes back later opens a new group rather than merging — because
 * upstream would emit a second heading row there too.
 */
export function groupSeverityItems(
  rows: readonly { code: string; title: string; group: string }[],
): SeverityGroup[] {
  const out: { heading: string; items: SeverityItem[] }[] = [];
  for (const { code, title, group } of rows) {
    if (out.at(-1)?.heading !== group) out.push({ heading: group, items: [] });
    out.at(-1)?.items.push({ code, title });
  }
  return out;
}
