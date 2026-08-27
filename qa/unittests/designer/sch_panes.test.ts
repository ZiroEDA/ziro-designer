// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order of the Schematic Editor's left dock.
 *
 * Every expectation about ORDER below is one line of
 * `qa/probes/aui_dock_pos_probe.cpp`'s output — wx 3.2.4 laying out eeschema's
 * own four panes and reporting each one's on-screen y — and each test says
 * which scenario of it. They are not derived from `schLeftDockLayout`, which
 * is the code under test.
 *
 * Two bugs have lived here. Ours first rendered Search, Properties, Net
 * Navigator, Schematic Hierarchy. That was fixed by sorting a fixed
 * `Position()` table, which pinned the SYMPTOM: upstream's order is not fixed
 * at all. wxAUI renumbers `dock_pos` at every Update, so the pane opened first
 * takes the top of the column and the next one — still holding its original,
 * larger `Position()` — docks below it, whichever way round they were opened.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SCH_BOTTOM_DOCK,
  SCH_LEFT_PANE_ADD_ORDER,
  SCH_LEFT_PANE_POSITION,
  schLeftDockLayout,
  schPaneGrows,
  schSelectionFilterShown,
  type SchDockPos,
  type SchLeftPane,
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

  /**
   * The `AddPane` order, which is a different order and breaks ties: the
   * hierarchy is added first (sch_edit_frame.cpp:260) and the Net Navigator
   * last (:279) even though its Position is 0.
   */
  it('is not the AddPane order', () => {
    expect(SCH_LEFT_PANE_ADD_ORDER).toEqual([
      'hierarchy',
      'properties',
      'selectionFilter',
      'netNavigator',
    ]);
  });
});

/**
 * A frame's left column, driven the way the editor drives it: a toggle flips
 * one pane, `updateSelectionFilterVisbility` decides the Selection Filter, and
 * one Update lays the result out and renumbers.
 */
function frame(): (
  pane: 'netNavigator' | 'hierarchy' | 'properties',
  on: boolean,
) => readonly SchLeftPane[] {
  let dockPos: SchDockPos = SCH_LEFT_PANE_POSITION;
  const grow = { netNavigator: false, hierarchy: false, properties: false };

  return (pane, on) => {
    grow[pane] = on;
    const layout = schLeftDockLayout(dockPos, {
      ...grow,
      selectionFilter: schSelectionFilterShown(grow),
    });
    dockPos = layout.dockPos;
    return layout.order;
  };
}

describe('the left column is ordered by when each pane was opened', () => {
  /** Probe scenario 1, "Hierarchy first, then Properties". */
  it('puts the hierarchy on top when the hierarchy was opened first', () => {
    const toggle = frame();
    expect(toggle('hierarchy', true)).toEqual(['hierarchy', 'selectionFilter']);
    expect(toggle('properties', true)).toEqual(['hierarchy', 'selectionFilter', 'properties']);
  });

  /**
   * Probe scenario 2, "Properties first, then Hierarchy" — the one ours could
   * not produce. `drawn top-to-bottom: Properties, Hierarchy, SelectionFilter`,
   * from y = 18, 263 and 509 in a 600px frame.
   */
  it('puts Properties on top when Properties was opened first', () => {
    const toggle = frame();
    expect(toggle('properties', true)).toEqual(['properties', 'selectionFilter']);
    expect(toggle('hierarchy', true)).toEqual(['properties', 'hierarchy', 'selectionFilter']);
  });

  /**
   * Probe scenario 3. The hierarchy is compacted to 0 the moment it is alone
   * in the dock, and hiding it does not take that away, so it comes back to
   * the top rather than to the bottom.
   */
  it('returns a re-opened pane to the slot it was compacted into', () => {
    const toggle = frame();
    toggle('hierarchy', true);
    toggle('properties', true);
    expect(toggle('hierarchy', false)).toEqual(['selectionFilter', 'properties']);
    expect(toggle('hierarchy', true)).toEqual(['hierarchy', 'selectionFilter', 'properties']);
  });

  /**
   * Probe scenario 4, "Properties first, then Hierarchy, then re-open
   * Properties". Properties comes back holding 0, ties with the hierarchy —
   * also 0 — and LOSES the tie, because the hierarchy's AddPane runs first.
   * The column ends up Hierarchy, Properties, SelectionFilter although
   * Properties was the first pane ever opened.
   */
  it('breaks a tie by AddPane order', () => {
    const toggle = frame();
    toggle('properties', true);
    toggle('hierarchy', true);
    expect(toggle('properties', false)).toEqual(['hierarchy', 'selectionFilter']);
    expect(toggle('properties', true)).toEqual(['hierarchy', 'properties', 'selectionFilter']);
  });

  /**
   * Probe scenario 5: a frame that restores several panes at once shows them
   * all in ONE Update, so nothing has been compacted yet and `Position()` is
   * the only thing ordering them. This is the case the old fixed table got
   * right, and the only one it got right.
   */
  it('falls back to Position() for panes that appear in the same Update', () => {
    const all = {
      netNavigator: true,
      hierarchy: true,
      properties: true,
      selectionFilter: true,
    };
    expect(schLeftDockLayout(SCH_LEFT_PANE_POSITION, all).order).toEqual([
      'netNavigator',
      'hierarchy',
      'properties',
      'selectionFilter',
    ]);
  });
});

describe('dock_pos, the state that carries the order forward', () => {
  /**
   * Probe scenario 1 again, read off its `dock_pos=` column rather than its
   * geometry: showing the hierarchy alone compacts it to 0 and the Selection
   * Filter to 1, while Properties — hidden — is left at the 2 it was given.
   */
  it('compacts the shown panes and leaves a hidden one alone', () => {
    const layout = schLeftDockLayout(SCH_LEFT_PANE_POSITION, {
      netNavigator: false,
      hierarchy: true,
      properties: false,
      selectionFilter: true,
    });
    expect(layout.dockPos.hierarchy).toBe(0);
    expect(layout.dockPos.selectionFilter).toBe(1);
    expect(layout.dockPos.properties).toBe(2);
    expect(layout.dockPos.netNavigator).toBe(0);
  });

  /** Nothing shown, nothing renumbered — the probe's opening report. */
  it('changes nothing while the column is empty', () => {
    const none = {
      netNavigator: false,
      hierarchy: false,
      properties: false,
      selectionFilter: false,
    };
    expect(schLeftDockLayout(SCH_LEFT_PANE_POSITION, none).dockPos).toEqual(SCH_LEFT_PANE_POSITION);
  });

  /**
   * The editor runs a layout on every render, not only when a toggle changes,
   * so a second pass over the same panes must not shuffle them. (wxAUI's own
   * pass is idempotent for the same reason: SetAuiPaneSize calls Update twice
   * more on every show — `common/widgets/wx_aui_utils.cpp:32,36` — and the
   * probe measures the same order with it as without.)
   */
  it('is idempotent', () => {
    const shown = {
      netNavigator: false,
      hierarchy: true,
      properties: true,
      selectionFilter: true,
    };
    const once = schLeftDockLayout(SCH_LEFT_PANE_POSITION, shown);
    const twice = schLeftDockLayout(once.dockPos, shown);
    expect(twice.order).toEqual(once.order);
    expect(twice.dockPos).toEqual(once.dockPos);
  });
});

describe('which panes grow', () => {
  /** `selectionFilterPane.dock_proportion = 0` (sch_edit_frame.cpp:325). */
  it('is everything except the Selection Filter', () => {
    expect(schPaneGrows('netNavigator')).toBe(true);
    expect(schPaneGrows('hierarchy')).toBe(true);
    expect(schPaneGrows('properties')).toBe(true);
    expect(schPaneGrows('selectionFilter')).toBe(false);
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

  /**
   * Through the layout, not through a constant: a `SCH_LEFT_PANE_ORDER.map(`
   * here would render a fixed column no matter what the two rules above say.
   */
  it('maps over the order that Update produced', () => {
    const s = text();
    expect(s).toMatch(
      /^\s*const dockLayout = schLeftDockLayout\(dockPosRef\.current, paneShown\);$/m,
    );
    expect(s).toContain('dockLayout.order.map(');
  });

  /**
   * ...and it must FEED THE NUMBERS BACK. A layout call that throws away
   * `dockLayout.dockPos` restarts from `Position()` every render, which is the
   * fixed order again with extra steps.
   *
   * Anchored as a whole statement on its own line rather than as a substring:
   * commenting the assignment out leaves the substring in the file, and that
   * mutant survived a `toContain` here.
   */
  it('carries dock_pos forward to the next Update', () => {
    expect(text()).toMatch(/^\s*dockPosRef\.current = dockLayout\.dockPos;$/m);
    expect(text()).toMatch(
      /^\s*const dockPosRef = useRef<SchDockPos>\(SCH_LEFT_PANE_POSITION\);$/m,
    );
  });

  it('takes the sash chain from the same order', () => {
    expect(text()).toContain('dockLayout.order.filter(schPaneGrows)');
  });

  /**
   * Each pane must be emitted exactly once, inside the map. Two copies of a
   * pane's header would render it twice and no order test would notice.
   *
   * The Selection Filter is not in this list any more: it is
   * `PANEL_SCH_SELECTION_FILTER`, ONE class serving both eeschema frames
   * upstream (`sch_edit_frame.cpp` and `symbol_edit_frame.cpp:195`), so it is
   * one shared component here too and its header lives there. The rule this
   * checks is unchanged — see the two assertions below it.
   */
  it('emits each pane header exactly once', () => {
    // The caption is `<span>Title</span>` beside its close box now, not the
    // bare text node it used to be: every one of these palettes asks for
    // `.CloseButton( true )` (sch_edit_frame.cpp:264, eeschema_settings.cpp:100).
    const s = text();
    for (const header of ['Net Navigator', 'Schematic Hierarchy', 'Properties']) {
      expect([...s.matchAll(new RegExp(`<span>${header}</span>`, 'g'))].length).toBe(1);
    }
  });

  it('gives each of those captions its close box', () => {
    // The close box drives the same state as the View > Panels check item, so
    // it must go through the toolbar toggle rather than a local hide.
    const s = text();
    for (const toggle of ['showNetNavigator', 'showHierarchy', 'showProperties']) {
      expect(s).toContain(`onLeftToggle('${toggle}')`);
    }
    expect([...s.matchAll(/ze-pane-close/g)].length).toBe(3);
  });

  it('gives the Selection Filter none, because upstream gives it no control', () => {
    // "Don't give the selection filter its own visibility controls; instead
    // show it if anything else is visible" - `updateSelectionFilterVisbility`
    // (sch_edit_frame.cpp:2817-2831). Its visibility is derived, so a close box
    // would have nothing to write.
    expect(text()).not.toContain("onLeftToggle('showSelectionFilter')");
  });

  /** ...and the shared one is mounted exactly once, for the same reason. */
  it('mounts the shared Selection Filter panel exactly once', () => {
    expect([...text().matchAll(/<SelectionFilterPanel/g)].length).toBe(1);
    // It must not have been left behind inline as well.
    expect(text()).not.toContain('Selection Filter</div>');
  });

  /** The shared component carries the caption, and carries it once. */
  it('keeps the caption in the shared component', () => {
    const panel = readFileSync(
      fileURLToPath(new URL('../../../designer/src/ui/SelectionFilterPanel.tsx', import.meta.url)),
      'utf8',
    );
    // The caption is `<span>` + close box now: `defaultSchSelectionFilterPaneInfo`
    // asks for `.CloseButton( true )` like every other palette
    // (eeschema/eeschema_settings.cpp:120).
    expect([...panel.matchAll(/<span>Selection Filter<\/span>/g)].length).toBe(1);
    expect(panel).toContain('ze-pane-close');
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
    expect(SCH_LEFT_PANE_ADD_ORDER).not.toContain('search');
    expect(Object.keys(SCH_LEFT_PANE_POSITION)).not.toContain('search');
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
