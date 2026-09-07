// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board editor's menu bar, against `pcbnew/menubar_pcb_editor.cpp`.
 *
 * `PCB_EDIT_FRAME::doReCreateMenuBar` is 440 lines of `Add()` calls and this is
 * the transcription of them: same menus, same rows, same order, same
 * separators, same submenus.
 *
 * This read the SOURCE of `PcbEditor.tsx` with a regex until the bar moved into
 * `editors/pcb/menubar.ts` — because `qa`'s tsconfig compiles `.ts` only, and a
 * menu built inside a `.tsx` cannot be imported at all. A regex over ten
 * thousand lines can read the labels and say nothing about what a row DOES,
 * whether its condition is right, or whether the accelerator it prints reaches
 * it. It builds the real tree now and presses it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildPcbMenus,
  type PcbMenuChecks,
  type PcbMenuState,
} from '@ziroeda/designer/src/editors/pcb/menubar.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

/** A board with nothing selected and both sibling editors reachable. */
const STATE: PcbMenuState = {
  selectionCount: 0,
  polygonBooleanCount: 0,
  modifiableLineCount: 0,
  hasSchematic: true,
  hasFootprintEditor: true,
  highContrast: false,
  flipBoard: false,
};

/** What each dispatcher was called with, so a row can be pressed and read. */
function build(
  state: Partial<PcbMenuState> = {},
  checks: PcbMenuChecks = {},
): { menus: Menu[]; calls: string[] } {
  const calls: string[] = [];
  const menus = buildPcbMenus(
    {
      action: (id) => calls.push(`action:${id}`),
      tool: (id) => calls.push(`tool:${id}`),
      toggle: (id) => calls.push(`toggle:${id}`),
      language: 'Default',
      onSelectLanguage: () => calls.push('language'),
      showHotkeys: () => calls.push('showHotkeys'),
      showAbout: () => calls.push('showAbout'),
    },
    { ...STATE, ...state },
    checks,
  );
  return { menus, calls };
}

/** One menu's rows in order, `---` for a separator, submenus indented. */
function rows(menu: string, depth = 0, items?: MenuItem[]): string[] {
  const list = items ?? build().menus.find((m) => m.label === menu)?.items;
  expect(list, menu).toBeDefined();

  const out: string[] = [];
  for (const item of list ?? []) {
    const pad = '  '.repeat(depth);
    if (item.sep) {
      out.push(`${pad}---`);
      continue;
    }
    out.push(pad + (item.label ?? ''));
    if (item.submenu) out.push(...rows(menu, depth + 1, item.submenu));
  }
  return out;
}

/** Find a row by label, at any depth. */
function find(items: MenuItem[], label: string): MenuItem | undefined {
  for (const i of items) {
    if (i.label === label) return i;
    const inner = i.submenu ? find(i.submenu, label) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

describe('File', () => {
  it('is the project-manager branch, row for row', () => {
    // `:54-183`. No New Board / Open... / Open Recent: all three are inside
    // `if( Kiface().IsSingle() )`, which means "launched standalone". Every
    // board here belongs to a project, so this is always the other branch —
    // which is also why the row is Save a Copy and not Save As.
    expect(rows('File')).toEqual([
      'Append Board...',
      '---',
      'Save',
      'Save a Copy...',
      'Revert',
      '---',
      'Rescue',
      '---',
      'Import',
      '  Netlist...',
      '  Specctra Session...',
      '  Graphics...',
      '  Non-KiCad Board File...',
      'Export',
      '  Specctra DSN...',
      '  GenCAD...',
      '  VRML...',
      '  IDFv3...',
      '  STEP/GLB/BREP/XAO/PLY/STL...',
      '  Footprint Association (.cmp) File...',
      '  Hyperlynx...',
      '  ---',
      '  Footprints...',
      'Fabrication Outputs',
      '  Gerbers (.gbr)...',
      '  Drill Files (.drl)...',
      '  IPC-2581 File (.xml)...',
      '  ODB++ Output File...',
      '  Component Placement (.pos, .gbr)...',
      '  Footprint Report (.rpt)...',
      '  IPC-D-356 Netlist File...',
      '  Bill of Materials...',
      '---',
      'Board Setup...',
      '---',
      'Page Settings...',
      'Print...',
      'Plot...',
      '---',
      'Close',
    ]);
  });
});

describe('Edit', () => {
  it('is upstream down to Global Deletions', () => {
    // `:180-211`. Everything after Global Deletions belongs to the SELECTION
    // CONTEXT MENU upstream (`edit_tool.cpp`, `pcb_selection_tool.cpp`) and is
    // here only until the context menu carries it — removing it now would make
    // three working features unreachable.
    const r = rows('Edit');
    expect(r.slice(0, r.indexOf('Global Deletions...') + 1)).toEqual([
      'Undo',
      'Redo',
      '---',
      'Cut',
      'Copy',
      'Paste',
      'Paste Special...',
      'Delete',
      '---',
      'Select',
      '  Select All',
      '  Unselect All',
      '---',
      'Find',
      '---',
      'Edit Track & Via Properties...',
      'Edit Text & Graphics Properties...',
      'Edit Teardrops...',
      'Change Footprints...',
      'Swap Layers...',
      'Grid Origin...',
      '---',
      'Fill All Zones',
      'Unfill All Zones',
      'Update All Tuning Patterns',
      '---',
      'Interactive Delete Tool',
      'Global Deletions...',
    ]);
  });

  it('has no row upstream puts in the context menu instead', () => {
    // These three are the whole of the exception, and each names a
    // `PCB_ACTIONS` that appears in `edit_tool.cpp` / `pcb_selection_tool.cpp`
    // and nowhere in `menubar_pcb_editor.cpp`.
    const extra = rows('Edit').slice(rows('Edit').indexOf('Global Deletions...') + 1);
    expect(extra.filter((r) => r !== '---' && !r.startsWith('  '))).toEqual([
      'Polygons',
      'Modify Lines',
      'Filter Selection...',
    ]);
  });
});

describe('View', () => {
  it('is upstream, submenus and all', () => {
    // `:213-281`.
    expect(rows('View')).toEqual([
      'Panels',
      '  Properties',
      '  Search',
      '  Appearance',
      '  Net Inspector',
      '---',
      'Footprint Library Browser',
      '3D Viewer',
      '---',
      'Zoom In',
      'Zoom Out',
      'Zoom to Fit',
      'Zoom to All Objects',
      'Zoom to Selected Objects',
      'Zoom to Selection Area',
      'Refresh',
      '---',
      'Drawing Mode',
      '  Draw Zone Fills',
      '  Draw Zone Outlines',
      '  ---',
      '  Sketch Pads',
      '  Sketch Vias',
      '  Sketch Tracks',
      '  ---',
      '  Sketch Graphic Items',
      '  Sketch Text Items',
      'Contrast Mode',
      '  Inactive Layer View Mode',
      '  Decrease Layer Opacity',
      '  Increase Layer Opacity',
      'Flip Board View',
    ]);
  });
});

describe('Route and Inspect', () => {
  it('Route is upstream, under the FriendlyNames', () => {
    // `:352-368`. "Route Single Track", not "Single Track".
    expect(rows('Route')).toEqual([
      'Set Layer Pair...',
      '---',
      'Route Single Track',
      'Route Differential Pair',
      '---',
      'Tune Length of a Single Track',
      'Tune Length of a Differential Pair',
      'Tune Skew of a Differential Pair',
      '---',
      'Interactive Router Settings...',
    ]);
  });

  it('Inspect is upstream, and the resolution rows carry no ellipsis', () => {
    // `:371-388`. `inspectClearance`'s FriendlyName is "Clearance Resolution".
    expect(rows('Inspect')).toEqual([
      'Show Board Statistics',
      'Measure Tool',
      '---',
      'Design Rules Checker',
      'Previous Marker',
      'Next Marker',
      'Exclude Marker',
      '---',
      'Clearance Resolution',
      'Constraints Resolution',
      'Show Footprint Associations',
      'Compare Footprint with Library',
    ]);
  });
});

describe('what is left out, and why', () => {
  /**
   * Three blocks upstream builds that this menu does not, and none of them is
   * an omission:
   *
   *   * the generators rows and the Design Blocks panel row sit behind
   *     `ADVANCED_CFG` flags (`m_EnableGenerators`, `m_EnablePcbDesignBlocks`),
   *     so a stock KiCad does not draw them either;
   *   * the Scripting Console is inside `SCRIPTING::IsWxAvailable()`;
   *   * "Reveal Plugin Folder in Finder" opens a folder on a disk.
   *
   * The last two are removed rather than greyed, which is what this repo does
   * with a control the browser cannot have.
   */
  it.each([
    ['Scripting Console'],
    ['Reveal Plugin Folder in Finder'],
    ['Rebuild All Generators'],
    ['Design Blocks'],
  ])('%s is absent', (label) => {
    const { menus } = build();
    expect(menus.some((m) => find(m.items ?? [], label) !== undefined)).toBe(false);
  });
});

/**
 * Everything below this line was unreachable while the bar lived inside
 * `PcbEditor.tsx`. A source regex can tell you a row is spelled "Plot..."; it
 * cannot tell you the row runs `plot`, that a greyed row swallows nothing, or
 * that a condition gates the row it is supposed to.
 */
describe('a row runs the command it names', () => {
  const press = (menu: string, label: string): string[] => {
    const { menus, calls } = build();
    const item = find(menus.find((m) => m.label === menu)?.items ?? [], label);
    expect(item, `${menu} > ${label}`).toBeDefined();
    item?.action?.();
    return calls;
  };

  it.each([
    ['File', 'Save', 'action:save'],
    ['File', 'Board Setup...', 'action:boardSetup'],
    ['File', 'Page Settings...', 'action:pageSettings'],
    ['File', 'Print...', 'action:print'],
    ['File', 'Plot...', 'action:plot'],
    ['Edit', 'Cut', 'action:cut'],
    ['Edit', 'Paste Special...', 'action:pasteSpecial'],
    ['Edit', 'Select All', 'action:selectAll'],
    ['Edit', 'Fill All Zones', 'action:zoneFillAll'],
    ['View', '3D Viewer', 'action:threeDViewer'],
    ['View', 'Flip Board View', 'action:flipBoard'],
    ['View', 'Inactive Layer View Mode', 'action:highContrastMode'],
    ['View', 'Zoom to Selection Area', 'tool:zoomTool'],
    ['View', 'Appearance', 'toggle:showLayersManager'],
    ['View', 'Draw Zone Outlines', 'toggle:zoneDisplayOutline'],
    ['Place', 'Place Vias', 'tool:drawVia'],
    ['Place', 'Draw Leaders', 'tool:drawLeader'],
    ['Route', 'Route Single Track', 'tool:routeSingleTrack'],
    ['Route', 'Interactive Router Settings...', 'action:routerSettingsDialog'],
    ['Inspect', 'Design Rules Checker', 'action:runDRC'],
    ['Inspect', 'Measure Tool', 'tool:measureTool'],
    ['Tools', 'Switch to Schematic Editor', 'action:showEeschema'],
    ['Tools', 'Footprint Editor', 'action:showFootprintEditor'],
    ['Preferences', 'Preferences...', 'action:openPreferences'],
  ])('%s > %s runs %s', (menu, label, expected) => {
    expect(press(menu, label)).toEqual([expected]);
  });
});

describe('the conditions gate the rows they are supposed to', () => {
  const row = (menu: string, label: string, state: Partial<PcbMenuState>): MenuItem => {
    const { menus } = build(state);
    const item = find(menus.find((m) => m.label === menu)?.items ?? [], label);
    expect(item, `${menu} > ${label}`).toBeDefined();
    return item as MenuItem;
  };

  it('Clearance Resolution wants exactly two items, Constraints exactly one', () => {
    // `BOARD_INSPECTION_TOOL`'s two reports answer different questions: a
    // clearance is between a PAIR, a constraint is about one item.
    expect(row('Inspect', 'Clearance Resolution', { selectionCount: 2 }).disabled).toBeFalsy();
    expect(row('Inspect', 'Clearance Resolution', { selectionCount: 1 }).disabled).toBe(true);
    expect(row('Inspect', 'Constraints Resolution', { selectionCount: 1 }).disabled).toBeFalsy();
    expect(row('Inspect', 'Constraints Resolution', { selectionCount: 2 }).disabled).toBe(true);
  });

  it('a polygon boolean wants two polygons, not two items', () => {
    // Counted on what the selection actually HOLDS: two rectangles have
    // nothing to merge, so the count is of booleanable shapes.
    expect(row('Edit', 'Merge Polygons', { polygonBooleanCount: 2 }).disabled).toBeFalsy();
    expect(
      row('Edit', 'Merge Polygons', { selectionCount: 9, polygonBooleanCount: 1 }).disabled,
    ).toBe(true);
  });

  it('a line modification wants two straight graphics', () => {
    expect(row('Edit', 'Fillet Lines...', { modifiableLineCount: 2 }).disabled).toBeFalsy();
    expect(row('Edit', 'Fillet Lines...', { modifiableLineCount: 1 }).disabled).toBe(true);
  });

  it('the schematic rows go with the schematic', () => {
    // `toolsMenu->Add( ACTIONS::updatePcbFromSchematic )->Enable( !Kiface().IsSingle() )`.
    for (const label of ['Update PCB from Schematic...', 'Switch to Schematic Editor']) {
      expect(row('Tools', label, { hasSchematic: true }).disabled, label).toBeFalsy();
      expect(row('Tools', label, { hasSchematic: false }).disabled, label).toBe(true);
    }
  });

  it('the CHECK rows tick from the state, not from a guess', () => {
    const { menus } = build(
      { flipBoard: true, highContrast: true },
      { showLayersManager: true, zoneDisplayFilled: true },
    );
    const view = menus.find((m) => m.label === 'View')?.items ?? [];
    expect(find(view, 'Flip Board View')?.checked).toBe(true);
    expect(find(view, 'Inactive Layer View Mode')?.checked).toBe(true);
    expect(find(view, 'Appearance')?.checked).toBe(true);
    expect(find(view, 'Draw Zone Fills')?.checked).toBe(true);
    // ...and off is off, rather than merely absent.
    expect(find(view, 'Draw Zone Outlines')?.checked).toBeFalsy();
    expect(find(view, 'Properties')?.checked).toBeFalsy();
  });
});

describe('no row swallows a click', () => {
  const walk = (items: MenuItem[], path: string[] = []): [string, MenuItem][] =>
    items.flatMap((i) =>
      i.sep
        ? []
        : [
            [[...path, i.label ?? ''].join(' > '), i] as [string, MenuItem],
            ...(i.submenu ? walk(i.submenu, [...path, i.label ?? '']) : []),
          ],
    );

  it('every enabled leaf either runs something or opens a submenu', () => {
    // The failure this catches is a row that looks live, takes the click and
    // does nothing — worse than a greyed row, which at least says so.
    const dead = build().menus.flatMap(({ label, items }) =>
      walk(items ?? [], [label]).filter(
        ([, i]) => !i.disabled && !i.submenu && i.action === undefined,
      ),
    );
    expect(dead.map(([p]) => p)).toEqual([]);
  });

  it('no accelerator is printed twice across the whole bar', () => {
    // `ui/menu_hotkeys.ts` dispatches on the printed text, so two rows sharing
    // one are two commands claiming one key.
    const keys = build()
      .menus.flatMap(({ label, items }) => walk(items ?? [], [label]))
      .filter(([, i]) => i.shortcut)
      .map(([, i]) => i.shortcut as string);
    const dupes = keys.filter((k, n) => keys.indexOf(k) !== n);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it('a greyed row prints no accelerator it cannot honour', () => {
    // A greyed row does not dispatch (`ui/menu_hotkeys.ts`), so a key beside
    // one is a promise nothing can keep.
    const bad = build().menus.flatMap(({ label, items }) =>
      walk(items ?? [], [label]).filter(([, i]) => i.disabled && i.shortcut),
    );
    expect(bad.map(([p]) => p)).toEqual([]);
  });
});

describe('the seam between the module and the frame', () => {
  /**
   * The one thing splitting the bar out could break silently.
   *
   * `menubar.ts` names commands; `PcbEditor.tsx`'s `onTopAction` runs them.
   * Nothing in the type system connects a string in one file to a `case` in the
   * other, so a renamed id, or a row added to the module and never wired,
   * produces a live-looking row whose click reaches the switch's `default:` and
   * is dropped. That is precisely the failure this whole menu pass was fixing,
   * re-introduced by the fix.
   */
  const FRAME = readFileSync(
    resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
    'utf8',
  );

  /**
   * Every id the module hands to `action`, by pressing every row of the eight
   * menus this file transcribes.
   *
   * Help is skipped and that is not a shortcut: it is `standardHelpMenu`'s,
   * shared with every frame and tested with it, and its rows call
   * `window.open` — pressing them here asks a node process to open a browser
   * tab.
   */
  const dispatched = (): string[] => {
    const { menus, calls } = build({
      selectionCount: 2,
      polygonBooleanCount: 2,
      modifiableLineCount: 2,
    });
    const press = (items: MenuItem[]): void => {
      for (const i of items) {
        i.action?.();
        if (i.submenu) press(i.submenu);
      }
    };
    for (const m of menus) if (m.label !== 'Help') press(m.items ?? []);
    return [...new Set(calls.filter((c) => c.startsWith('action:')).map((c) => c.slice(7)))].sort();
  };

  it('every id the menus dispatch has a case in the frame', () => {
    const cases = new Set(
      [...FRAME.matchAll(/case '([A-Za-z0-9_]+)':/g)].map((m) => m[1] as string),
    );
    // `close` is `addQuitOrClose`'s, which the shared helper builds.
    const unhandled = dispatched().filter((id) => !cases.has(id));
    expect(unhandled).toEqual([]);
  });

  it('and the frame answers them rather than falling through', () => {
    // A `case` that only `break`s is the same dead row wearing a case label.
    // Checked on the four the toolbar never had, which are the ones this split
    // moved out of an inline closure.
    for (const id of ['zoneFillAll', 'cut', 'selectAll', 'flipBoard']) {
      const at = FRAME.indexOf(`case '${id}':`);
      expect(at, id).toBeGreaterThan(-1);
      const body = FRAME.slice(at, FRAME.indexOf('break;', at));
      expect(body.replace(`case '${id}':`, '').trim(), id).not.toBe('');
    }
  });
});
