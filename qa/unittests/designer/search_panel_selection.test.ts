// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Search pane's row selection.
 *
 * Upstream is one-directional: `SEARCH_PANE_LISTVIEW` owns its selection —
 * `OnItemSelected` sets `m_selectionDirty` and `OnUpdateUI` pushes the rows
 * *out* through `m_handler->SelectItems()` — and nothing in `search_pane.cpp`,
 * `search_pane_tab.cpp` or `sch_edit_frame.cpp` pushes a canvas selection back
 * in. So in KiCad, picking a symbol on the sheet leaves its row unhighlighted.
 *
 * **We deliberately go further**: the highlight is driven by the editor's
 * selection set, so the row and the symbol agree whichever one you clicked.
 * That is a superset, decided on 2026-08-09 after the one-directional version
 * shipped and read as a bug. It is pinned here so it is not "fixed" back by
 * someone reading the upstream source and finding ours does more.
 *
 * Two things about it *are* upstream and should not drift: picking a row still
 * pushes out to the canvas, and clicking the blank area below the rows clears
 * the selection (a click on empty space in a wxListCtrl deselects every row,
 * and the empty selection is pushed out like any other).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMMON_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../../designer/src/editors/schematic/components/SearchPanel.tsx');
const EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');
const CSS = read('../../../designer/src/ui/shell.css');

/** The `<SearchPanel … />` element as the editor writes it. */
const usage = (): string => {
  const at = EDITOR.indexOf('<SearchPanel');
  expect(at, 'the editor should mount the search pane').toBeGreaterThan(-1);
  return EDITOR.slice(at, EDITOR.indexOf('/>', at));
};

describe('the Search pane row highlight', () => {
  it('is driven by the editor selection, so it works in both directions', () => {
    expect(PANEL).toContain("selection?.has(h.id) ? ' selected' : ''");
    expect(usage()).toMatch(/selection=\{selection\}/);
  });

  it('keeps no row selection of its own to disagree with it', () => {
    expect(PANEL).not.toContain('pickedRow');
  });

  it('still pushes the pick out to the canvas, as OnUpdateUI does', () => {
    expect(PANEL).toContain('onSelect(h.id)');
  });

  it('clears the selection when the blank area below the rows is clicked', () => {
    expect(PANEL).toContain('onClearSelection?.()');
    // Guarded on the target, or a click that bubbled up from a row would
    // immediately undo the selection that row just made.
    expect(PANEL).toContain('e.target === e.currentTarget');
    expect(usage()).toContain('onClearSelection=');
  });

  it('has the row styling to show it with', () => {
    // On the cells: a `tr` background does not survive cells that establish
    // their own formatting, which is why every other table here does it this way.
    expect(CSS).toMatch(/\.ze-search-row\.selected td\s*\{[^}]*background:\s*#e07b1a/);
  });
});

/**
 * Picking a row moves the view. `SCH_SEARCH_HANDLER::SelectItems` selects the
 * hits and then runs `ACTIONS::centerSelection` or `ACTIONS::zoomFitSelection`
 * according to `APP_SETTINGS_BASE::SEARCH_PANE::selection_zoom`, whose default
 * is PAN — so a *single* click centres the sheet on the hit. Ours only moved
 * the view on a double click, which meant one click appeared to do nothing at
 * all on a sheet where the hit was off-screen.
 */
describe('picking a row moves the view', () => {
  it('defaults to pan, as app_settings.cpp does', () => {
    expect(COMMON_DEFAULTS.search_pane.selection_zoom).toBe('pan');
  });

  it('acts on the first click, not a double one', () => {
    expect(PANEL).toContain('onClick=');
    expect(PANEL).not.toContain('onDoubleClick');
  });

  it('routes the two modes to centre and zoom-fit, and none to neither', () => {
    expect(PANEL).toContain("selectionZoom === 'pan'");
    expect(PANEL).toContain('onCenter?.(h.id, h.at)');
    expect(PANEL).toContain("selectionZoom === 'zoom'");
    expect(PANEL).toContain('onZoomFit?.(h.id, h.at)');
  });

  it('is wired to the real zoom-fit extent, not a hand-rolled one', () => {
    // ACTIONS::zoomFitSelection; selectionBBox is the one walk that knows every
    // item kind, and the View menu's Zoom to Selected Objects uses it too.
    expect(usage()).toContain('onZoomFit=');
    expect(EDITOR).toContain('selectionBBox(doc, new Set([id]), libById)');
  });
});
