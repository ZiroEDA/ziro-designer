// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Navigator's shape, against `SCH_EDIT_FRAME::RefreshNetNavigator`
 * (eeschema/net_navigator.cpp).
 *
 * Ours was a flat list of nets with an item count in each label. Upstream's is
 * a tree:
 *
 *   - no net highlighted -> root **"Nets"**, expanded, a node per net;
 *   - a net highlighted  -> the root *is* that net, and nothing else is shown;
 *   - a filter box above it, disabled while a net is highlighted, matching with
 *     `*`/`?` wildcards case-insensitively and wrapping a bare pattern in both.
 *
 * Net names are displayed through `UnescapeString`, and a net node carries no
 * count — upstream appends `displayName` and nothing more.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../../designer/src/editors/schematic/components/NetNavigatorPanel.tsx');
const EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');
const CSS = read('../../../designer/src/ui/shell.css');

describe('the Net Navigator matches upstream', () => {
  it('roots the tree at "Nets" when no net is highlighted', () => {
    expect(PANEL).toContain('Nets');
    expect(PANEL).toContain('highlightedNet ?');
  });

  it('puts a sheet level between a net and its items', () => {
    // Nets > net > sheet > item. MakeNetNavigatorNode appends the sheet node
    // unconditionally; aSingleSheetSchematic only picks what is auto-expanded.
    expect(PANEL).toContain('net.sheets.map');
    expect(PANEL).toContain('sheet.items.map');
    expect(PANEL).toContain('{sheet.label}');
    // …and each level has its own chevron, so all three collapse.
    expect(PANEL.match(/twisty expandable/g)?.length).toBe(3);
  });

  it('is handed a hierarchy-wide tree the frame builds', () => {
    // Only the frame can see every sheet, so it builds the tree and the panel
    // renders it; the panel's own single-sheet build is the fallback.
    expect(EDITOR).toContain('buildNetNavigatorHierarchy(');
    expect(EDITOR).toContain('prebuilt={netNavigatorTree}');
    expect(PANEL).toContain('prebuilt ?? buildNetNavigator(');
  });

  it('only builds it while the pane is open', () => {
    // RefreshNetNavigator returns early on !IsShownOnScreen(); a hierarchy-wide
    // netlist on every keystroke would be far too expensive otherwise.
    expect(EDITOR).toMatch(/if \(!toggles\.has\('showNetNavigator'\) \|\| !doc\) return \[\];/);
  });

  it('drops the item count from a net node', () => {
    // The old label was `{net.name} ({net.items.length})`.
    expect(PANEL).not.toMatch(/\{net\.items\.length\}/);
  });

  it('shows net names unescaped, as UnescapeString does', () => {
    expect(PANEL).toContain('unescapeString(net.name)');
  });

  it('filters with wildcards and disables the box while highlighted', () => {
    expect(PANEL).toContain('wildMatch');
    expect(PANEL).toContain('disabled={!!highlightedNet}');
  });

  it('is told which net is highlighted', () => {
    expect(EDITOR).toContain('highlightedNet={highlightedChain}');
  });
});

/**
 * One disclosure mark across the app. The project tree draws a CSS chevron; the
 * net navigator and the fields table's group rows drew solid triangle glyphs
 * instead, so the same gesture looked like three different controls.
 */
describe('disclosure arrows are the project tree chevron', () => {
  it('the chevron is declared without an ancestor so anything can use it', () => {
    expect(CSS).toMatch(/^\.twisty\s*\{/m);
    expect(CSS).toMatch(/^\.twisty\.expandable::before\s*\{/m);
    expect(CSS).toMatch(/^\.twisty\.expandable\.open::before\s*\{/m);
  });

  it('no solid triangle is left as an expander', () => {
    // Only the expander glyphs. A column's ▲/▼ sort indicator stays a triangle:
    // that is what wxGrid's ShowSortIndicator draws, and it is not a disclosure
    // control.
    const FIELDS = read(
      '../../../designer/src/editors/schematic/dialogs/dialog_symbol_fields_table.tsx',
    );
    for (const [name, src] of [
      ['net navigator', PANEL],
      ['fields table', FIELDS],
    ] as const) {
      for (const glyph of ['▸', '▾', '▶']) {
        expect(src.includes(glyph), `${name} still uses ${glyph} as an expander`).toBe(false);
      }
    }
    // …and the sort indicator is still there, deliberately.
    expect(FIELDS).toContain('▲');
  });

  it('both use the twisty markup', () => {
    expect(PANEL).toContain('twisty expandable');
    expect(
      read('../../../designer/src/editors/schematic/dialogs/dialog_symbol_fields_table.tsx'),
    ).toContain('twisty expandable');
  });
});

/**
 * Picking a leaf brings the item under the crosshair: `onNetNavigatorSelection`
 * ends in `FocusOnLocation( itemData->GetItem()->GetBoundingBox().Centre() )`,
 * so the view moves even though the pointer is still inside the panel. Ours only
 * changed the selection, which left the crosshair wherever it was.
 */
describe('picking a leaf focuses the item', () => {
  it('centres on the item bounding box, as FocusOnLocation does', () => {
    expect(EDITOR).toContain('FocusOnLocation');
    expect(EDITOR).toMatch(
      /highlightedNet=\{highlightedChain\}[\s\S]{0,900}?controller\.current\?\.centerOn/,
    );
  });

  it('uses the item extent, not a raw position', () => {
    expect(EDITOR).toMatch(
      /selectionBBox\(doc, new Set\(\[id\]\), libById\)[\s\S]{0,400}?minX \+ box\.maxX/,
    );
  });
});
