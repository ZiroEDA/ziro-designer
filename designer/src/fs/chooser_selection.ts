// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * What a click does to the chooser's selection, and what accepting hands over.
 *
 * `wxFD_MULTIPLE` is one flag upstream and the toolkit does the rest
 * (gerbview/files.cpp:151-152). Here it is ours to write, which means it is
 * ours to test — and it lived inside `FileChooser.tsx` as two inline
 * expressions, where a mutation sweep walked straight through all three rules:
 * ctrl-click extending, a batch bypassing `activate`, and the filtered rows
 * being left out. There is no DOM test environment in this repo, so a rule in a
 * `.tsx` can only be asserted as SOURCE TEXT, which pins the spelling and not
 * the behaviour.
 *
 * Same fix as `editors/gerbview/toggles.ts`: pure functions in a `.ts` that a
 * test can call.
 */

/**
 * The extra rows still selected after a click.
 *
 * `anchor` is the row that was selected before this click and stays the
 * "current" one — it is what F2 renames and Delete removes, and both mean one
 * row even in a multiple selection. Everything else lives in the returned set.
 *
 * A plain click replaces the whole selection, as it does in every file manager;
 * ctrl (or cmd) extends. Clicking the anchor again with ctrl held changes
 * nothing: it is already selected and it is the row the others hang off.
 */
export function extendSelection(
  previous: ReadonlySet<string>,
  anchor: string | null,
  clicked: string,
  extend: boolean,
): Set<string> {
  if (!extend || anchor === null) return new Set();

  const next = new Set(previous);
  if (clicked === anchor) return next;

  // Ctrl-clicking a row that is already an extra takes it back out; otherwise
  // the OLD anchor joins the extras and the clicked row becomes the anchor.
  if (next.has(clicked)) next.delete(clicked);
  else next.add(anchor);

  return next;
}

/**
 * The paths an accept hands over: the anchor first, then the rest.
 *
 * `visible` is the filtered list — what the wildcard and the search box left on
 * screen. A row selected earlier and filtered out since is NOT handed over: a
 * person cannot see themselves passing it, and a batch that silently carries an
 * invisible file is the same defect as an overwrite prompt that reads the
 * filtered list instead of the folder.
 *
 * Null when the anchor itself is no longer visible, which is a selection with
 * nothing to accept.
 */
export function selectionToAccept(
  visible: readonly { path: string }[],
  anchor: string | null,
  extras: ReadonlySet<string>,
): { first: string; rest: string[] } | null {
  if (anchor === null) return null;
  if (!visible.some((e) => e.path === anchor)) return null;

  return {
    first: anchor,
    rest: visible.filter((e) => e.path !== anchor && extras.has(e.path)).map((e) => e.path),
  };
}
