// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Search pane has to fit the left dock.
 *
 * `.ze-leftdock` is a fixed 240px, and `.ze-panel-body` leaves about 222px of
 * it. Three things independently blew past that and put a horizontal scrollbar
 * under the whole panel:
 *
 *  - the search box. A flex item's default `min-width: auto` refuses to shrink
 *    below its content, and a bare `<input>` reports an intrinsic width of
 *    roughly twenty characters, so `flex: 1` alone could not make it narrower.
 *  - the four tabs, at the dialogs' padding, are wider than the dock in a row.
 *  - the results table. An `auto` table is at least as wide as its widest
 *    unbreakable cell, and one footprint name is already over 240px on its own.
 *
 * None of that is visible to a renderer test — jsdom does no layout — so this
 * reads the source, the way `canvas_props_wired` does, and pins the three
 * properties that keep the pane inside its dock.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../../designer/src/editors/schematic/components/SearchPanel.tsx');
const CSS = read('../../../designer/src/ui/shell.css');

describe('the Search pane fits the left dock', () => {
  it('the dock is still the fixed width this is sized against', () => {
    // If the dock becomes resizable this guard should be revisited, not deleted.
    expect(CSS).toMatch(/\.ze-leftdock\s*\{[^}]*width:\s*240px/);
  });

  it('lets the search box shrink below its intrinsic width', () => {
    // `flex: 1` on its own cannot: min-width defaults to auto.
    expect(PANEL).toMatch(/flex:\s*1,\s*minWidth:\s*0/);
  });

  it('keeps the Hidden checkbox on one line instead of squeezing it', () => {
    expect(PANEL).toContain('flexShrink: 0');
    expect(PANEL).toContain("whiteSpace: 'nowrap'");
  });

  it('wraps the tab strip rather than overflowing it', () => {
    expect(PANEL).toContain('className="ze-erc-tabs compact"');
    expect(CSS).toMatch(/\.ze-erc-tabs\.compact\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it('leaves the dialogs that share the tab strip on one row', () => {
    // The modifier has to be opt-in: ERC, netlist export and sync-pins are wide
    // and their tabs should not start wrapping.
    const base = /\.ze-erc-tabs\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(base).not.toContain('flex-wrap');
  });

  it('fixes the results table so a long cell cannot widen it', () => {
    expect(PANEL).toContain("tableLayout: 'fixed'");
    // …and the cells ellipsise, with the full value still reachable on hover.
    expect(PANEL).toContain("textOverflow: 'ellipsis'");
    expect(PANEL).toContain('title={cell}');
  });
});
