// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order of the Schematic Editor's left dock, against the `Position()` each
 * pane is given upstream.
 *
 * Ours rendered Search, Properties, Net Navigator, Schematic Hierarchy —
 * Properties two places too high and the Net Navigator two too low.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SCH_BOTTOM_DOCK,
  SCH_LEFT_GROW_PANES,
  SCH_LEFT_PANE_ORDER,
  SCH_LEFT_PANE_POSITION,
  schSelectionFilterShown,
} from '@ziroeda/designer/src/editors/schematic/panes.js';

describe('the Position() each pane is docked at', () => {
  /**
   * Transcribed one at a time, not derived: `eeschema_settings.cpp:74` (Net
   * Navigator), `sch_edit_frame.cpp:262` (Schematic Hierarchy),
   * `eeschema_settings.cpp:95` (Properties), `:117` (Selection Filter).
   */
  it('is 0, 1, 2 and 4', () => {
    expect(SCH_LEFT_PANE_POSITION.netNavigator).toBe(0);
    expect(SCH_LEFT_PANE_POSITION.hierarchy).toBe(1);
    expect(SCH_LEFT_PANE_POSITION.properties).toBe(2);
    expect(SCH_LEFT_PANE_POSITION.selectionFilter).toBe(4);
  });

  /** Upstream skips 3. Renumbering to 0..3 would be inventing a table. */
  it('skips 3, as upstream does', () => {
    expect(Object.values(SCH_LEFT_PANE_POSITION)).not.toContain(3);
  });
});

describe('the left dock, top to bottom', () => {
  it('is Net Navigator, Schematic Hierarchy, Properties, Selection Filter', () => {
    expect(SCH_LEFT_PANE_ORDER).toEqual([
      'netNavigator',
      'hierarchy',
      'properties',
      'selectionFilter',
    ]);
  });

  /** The bug in one line: Properties sat above the hierarchy. */
  it('puts Properties below the hierarchy, not above it', () => {
    expect(SCH_LEFT_PANE_ORDER.indexOf('properties')).toBeGreaterThan(
      SCH_LEFT_PANE_ORDER.indexOf('hierarchy'),
    );
  });

  /** `selectionFilterPane.dock_proportion = 0` (sch_edit_frame.cpp:325). */
  it('excludes the Selection Filter from the panes that grow', () => {
    expect(SCH_LEFT_GROW_PANES).toEqual(['netNavigator', 'hierarchy', 'properties']);
    expect(SCH_LEFT_GROW_PANES).not.toContain('selectionFilter');
  });
});

/**
 * The data above only matters if the component renders through it. A JSX block
 * that listed the panes in its own order would satisfy every case above.
 */
describe('the editor renders the dock through that order', () => {
  const SRC = fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  );
  const text = (): string => readFileSync(SRC, 'utf8');

  it('maps over SCH_LEFT_PANE_ORDER', () => {
    expect(text()).toContain('SCH_LEFT_PANE_ORDER.map(');
  });

  it('takes the sash chain from SCH_LEFT_GROW_PANES', () => {
    expect(text()).toContain('SCH_LEFT_GROW_PANES.filter(');
  });

  /**
   * Each pane must be emitted exactly once, inside the map. Two copies of a
   * pane's header would render it twice and no order test would notice.
   */
  it('emits each pane header exactly once', () => {
    const s = text();
    for (const header of [
      'Net Navigator</div>',
      'Schematic Hierarchy</div>',
      'Properties</div>',
      'Selection Filter</div>',
    ]) {
      expect([...s.matchAll(new RegExp(header.replace(/[/]/g, '\\/'), 'g'))].length).toBe(1);
    }
  });
});

/**
 * `SCH_EDIT_FRAME::updateSelectionFilterVisbility` (sch_edit_frame.cpp:2817-2831).
 * Ours keyed on Properties alone, so closing Properties with the hierarchy open
 * took the Selection Filter away with it.
 */
describe('when the Selection Filter is shown', () => {
  const none = { hierarchy: false, netNavigator: false, properties: false };

  it('is hidden when nothing else in the column is shown', () => {
    expect(schSelectionFilterShown(none)).toBe(false);
  });

  /** Each of the three disjuncts on its own — the bug was that two did nothing. */
  it('is shown for the hierarchy alone', () => {
    expect(schSelectionFilterShown({ ...none, hierarchy: true })).toBe(true);
  });

  it('is shown for the net navigator alone', () => {
    expect(schSelectionFilterShown({ ...none, netNavigator: true })).toBe(true);
  });

  it('is shown for Properties alone', () => {
    expect(schSelectionFilterShown({ ...none, properties: true })).toBe(true);
  });

  /** The exact case that was broken: Properties closed, hierarchy still open. */
  it('survives closing Properties while the hierarchy is open', () => {
    expect(schSelectionFilterShown({ ...none, hierarchy: true, properties: true })).toBe(true);
    expect(schSelectionFilterShown({ ...none, hierarchy: true, properties: false })).toBe(true);
  });
});

/**
 * The Search pane's dock. `sch_edit_frame.cpp:290-300` — `.Bottom()` with no
 * `.Layer()`, `MinSize( 180, 60 )`, `BestSize( 180, 100 )`.
 */
describe('the Search pane', () => {
  it('opens at its BestSize height and floors at its MinSize height', () => {
    expect(SCH_BOTTOM_DOCK.bestHeight).toBe(100);
    expect(SCH_BOTTOM_DOCK.minHeight).toBe(60);
  });

  it('is not one of the left dock panes', () => {
    expect(SCH_LEFT_PANE_ORDER).not.toContain('search');
    expect(SCH_LEFT_GROW_PANES).not.toContain('search');
  });
});

/**
 * Placement, read off the source. A pane can only be in one place, so the test
 * that matters is *which container* the Search header is inside — a check that
 * it merely exists somewhere passes just as well when it is in the left column,
 * which is exactly the bug.
 */
describe('the editor docks Search at the bottom of the canvas column', () => {
  const SRC = fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  );
  const text = (): string => readFileSync(SRC, 'utf8');

  /** The canvas and the layer-0 dock below it share a column. */
  it('wraps the canvas in .ze-canvas-col', () => {
    expect(text()).toContain('className="ze-canvas-col"');
  });

  it('renders the Search pane in that column, after the canvas', () => {
    const s = text();
    const col = s.indexOf('className="ze-canvas-col"');
    const canvas = s.indexOf('className="ze-canvas-wrap"', col);
    const dock = s.indexOf('ze-bottomdock', col);
    const search = s.indexOf('Search</div>', col);
    expect(col).toBeGreaterThan(-1);
    expect(canvas).toBeGreaterThan(col);
    expect(dock).toBeGreaterThan(canvas);
    expect(search).toBeGreaterThan(dock);
  });

  /**
   * The one that pins the fix: the Search header must not be anywhere inside
   * the left dock. Ours rendered it as that dock's first pane.
   */
  it('does not render Search inside the left dock', () => {
    const s = text();
    const leftdock = s.indexOf('className="ze-leftdock sch-leftdock"');
    const col = s.indexOf('className="ze-canvas-col"');
    expect(leftdock).toBeGreaterThan(-1);
    expect(s.indexOf('Search</div>')).toBeGreaterThan(col);
    expect(col).toBeGreaterThan(leftdock);
  });

  /** Exactly one Search pane, so it was moved and not copied. */
  it('emits the Search header exactly once', () => {
    expect([...text().matchAll(/Search<\/div>/g)].length).toBe(1);
  });

  /**
   * The dock height comes from the pane info, not from a literal in the JSX —
   * at BOTH sites that need it.
   *
   * Checking the name merely appears in the file does not do this: `bestHeight`
   * is read twice, so hardcoding either one leaves the other's mention behind
   * and the check still passes. That mutant survived until this became one
   * expectation per use site.
   */
  it('takes the dock height from SCH_BOTTOM_DOCK at both use sites', () => {
    const s = text();
    // The height the dock opens at.
    expect(s).toContain('height: panelHeights.search ?? SCH_BOTTOM_DOCK.bestHeight,');
    // The height a drag starts from when the pane has not been measured yet.
    expect(s).toContain('.height ?? SCH_BOTTOM_DOCK.bestHeight;');
    // The floor the sash clamps to.
    expect(s).toContain('Math.max(SCH_BOTTOM_DOCK.minHeight,');
  });

  /** And the filter's visibility from the predicate, not from a toggle. */
  it('takes the Selection Filter from schSelectionFilterShown', () => {
    expect(text()).toContain('schSelectionFilterShown(growShown)');
  });

  /**
   * Both classes have to exist in the shared stylesheet, or the JSX names a
   * dock that nothing lays out and the pane falls back to `.ze-panel`'s 220px.
   * They are shared rules, not schematic-local ones: pcbnew docks its own
   * Search pane the same way.
   */
  it('has both dock classes in the shared stylesheet', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
      'utf8',
    );
    expect(css).toMatch(/^\.ze-canvas-col \{/m);
    expect(css).toMatch(/^\.ze-bottomdock \{/m);
  });
});
