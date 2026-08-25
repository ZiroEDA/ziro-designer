// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint tree's right-click menu, row by row, per selection.
 *
 * Counterparts: `FOOTPRINT_EDITOR_CONTROL::Init`
 * (`pcbnew/tools/footprint_editor_control.cpp:81-171`) and
 * `LIBRARY_EDITOR_CONTROL::AddContextMenuItems`
 * (`common/tool/library_editor_control.cpp:41-85`).
 *
 * There was no such menu at all before this: right-clicking the tree did
 * nothing, so rename, duplicate, revert, cut/copy/paste, pin and Hide Library
 * Tree had no way in. The rows below are the full upstream set.
 *
 * The expectations are the WHOLE evaluated list, in order, separators included.
 * A "does it contain Rename" check would pass with the separators eliding
 * wrongly or the two tools' orders interleaved backwards, and interleaving is
 * the only thing `CONDITIONAL_MENU`'s `aOrder` argument exists to do.
 */
import { describe, expect, it } from 'vitest';
import {
  footprintTreeContextMenu,
  type FpTreeSelection,
} from '@ziroeda/designer/src/editors/footprint/tree_context_menu.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const noop = (): void => {};
const handlers = { action: noop };

const menu = (sel: Partial<FpTreeSelection>, haveFootprint = false): MenuItem[] =>
  footprintTreeContextMenu(
    handlers,
    { library: '', footprint: '', pinned: false, ...sel },
    { haveFootprint },
  );

const rows = (items: MenuItem[]): string[] => items.map((i) => (i.sep ? '---' : (i.label ?? '?')));

describe('a library row', () => {
  /**
   * `libSelectedCondition` (:89-94) is true and `fpSelectedCondition` (:105-110)
   * false, so New/Create Footprint and Save As appear and the whole
   * cut/copy/duplicate/rename/delete group does not — except Paste, which is on
   * `libInferredCondition` (:98-103), the looser "we know the library context"
   * condition.
   */
  it('is upstream, row for row', () => {
    expect(rows(menu({ library: 'Audio_Module' }))).toEqual([
      'Pin Library',
      '---',
      'New Footprint',
      'Create Footprint...',
      '---',
      'Save',
      'Save As...',
      'Revert',
      '---',
      'Paste Footprint',
      '---',
      'Import Footprint...',
      '---',
      'Hide Library Tree',
    ]);
  });

  /**
   * `pinnedLibSelectedCondition` / `unpinnedLibSelectedCondition` (:69-77) —
   * one row or the other, never both and never neither.
   */
  it('offers Unpin when the library is pinned', () => {
    const r = rows(menu({ library: 'Audio_Module', pinned: true }));
    expect(r[0]).toBe('Unpin Library');
    expect(r).not.toContain('Pin Library');
  });
});

describe('a footprint row', () => {
  /**
   * `fpSelectedCondition` true, `libSelectedCondition` false: the editing group
   * appears, New/Create Footprint do not, and Save As is on
   * `libSelectedCondition || fpSelectedCondition` so it stays.
   */
  it('is upstream, row for row', () => {
    expect(rows(menu({ library: 'Audio_Module', footprint: 'Reverb_BTDR-1H' }))).toEqual([
      'Pin Library',
      '---',
      'Save',
      'Save As...',
      'Revert',
      '---',
      'Cut Footprint',
      'Copy Footprint',
      'Paste Footprint',
      'Duplicate Footprint',
      'Rename Footprint...',
      'Delete Footprint from Library',
      'Footprint Properties...',
      '---',
      'Import Footprint...',
      '---',
      'Hide Library Tree',
    ]);
  });

  /**
   * `fpExportCondition` (:113-118) asks the BOARD, not the tree: "Export
   * Current Footprint..." needs a footprint open on the canvas, which a
   * selected tree row is not.
   */
  it('shows Export only with a footprint loaded', () => {
    const withFp = rows(menu({ library: 'L', footprint: 'F' }, true));
    expect(withFp).toContain('Export Current Footprint...');
    expect(rows(menu({ library: 'L', footprint: 'F' }, false))).not.toContain(
      'Export Current Footprint...',
    );
    // And it sits after Import, in the order-100 group.
    expect(withFp.indexOf('Export Current Footprint...')).toBe(
      withFp.indexOf('Import Footprint...') + 1,
    );
  });
});

describe('no selection', () => {
  /**
   * Every tree condition false. Only `ACTIONS::save` (ShowAlways, :138) and
   * `ACTIONS::hideLibraryTree` (ShowAlways, :83) survive — and the separators
   * around them collapse, because `CONDITIONAL_MENU::Evaluate` skips a
   * separator with nothing emitted since the last one.
   */
  it('leaves the two unconditional rows and no stray rules', () => {
    expect(rows(menu({}))).toEqual(['Save', '---', 'Hide Library Tree']);
  });

  /** Never a leading or trailing separator, whatever the selection. */
  it.each([
    ['nothing', {}],
    ['a library', { library: 'L' }],
    ['a footprint', { library: 'L', footprint: 'F' }],
  ])('opens and ends on a row, not a rule, with %s selected', (_name, sel) => {
    const items = menu(sel as Partial<FpTreeSelection>);
    expect(items[0]?.sep).toBeFalsy();
    expect(items[items.length - 1]?.sep).toBeFalsy();
  });
});

describe('the rows dispatch, or say why not', () => {
  /**
   * Seven commands have no implementation in this port yet. They are shown in
   * their upstream position and greyed, the way `menubar.ts` treats its stubs —
   * a `CONDITIONAL_MENU` condition decides presence, `ACTION_CONDITIONS`
   * decides enabled, and these are the second kind.
   */
  const STUBS = [
    'Create Footprint...',
    'Save As...',
    'Cut Footprint',
    'Copy Footprint',
    'Paste Footprint',
    'Duplicate Footprint',
    'Rename Footprint...',
  ];

  it('greys exactly the commands that do not exist yet', () => {
    const items = menu({ library: 'L', footprint: 'F' }, true);
    const greyed = items.filter((i) => i.disabled).map((i) => i.label);
    expect(greyed.sort()).toEqual(STUBS.filter((s) => items.some((i) => i.label === s)).sort());
  });

  it('gives every other row an action', () => {
    for (const i of menu({ library: 'L', footprint: 'F' }, true)) {
      if (i.sep || i.disabled) continue;
      expect(typeof i.action).toBe('function');
    }
  });

  /**
   * The ids are the menu bar's, because upstream these rows ARE the same
   * `TOOL_ACTION` objects appearing in a second menu. A tree row spelling
   * `delete` where the bar spells `doDelete` would list one action twice in the
   * Hotkey List, which keys on the id.
   */
  it('keys rows by their action id', () => {
    const byLabel = new Map(menu({ library: 'L', footprint: 'F' }, true).map((i) => [i.label, i]));
    expect(byLabel.get('Delete Footprint from Library')?.icon).toBe('deleteFootprint');
    expect(byLabel.get('Footprint Properties...')?.icon).toBe('footprintProperties');
    expect(byLabel.get('Import Footprint...')?.icon).toBe('importFootprint');
    expect(byLabel.get('Hide Library Tree')?.icon).toBe('hideLibraryTree');
    expect(byLabel.get('Revert')?.icon).toBe('revert');
  });
});

describe('the advanced-config rows', () => {
  /**
   * `ACTIONS::openWithTextEditor` and `ACTIONS::openDirectory` are inside
   * `if( ADVANCED_CFG::GetCfg().m_EnableLibWithText )` / `m_EnableLibDir`
   * (:150-161), and both default false (`common/advanced_config.cpp:280-281`),
   * so stock KiCad never draws them.
   */
  it('are absent, as they are in a stock KiCad', () => {
    const all = rows(menu({ library: 'L', footprint: 'F' }, true));
    expect(all).not.toContain('Open with Text Editor');
    expect(all).not.toContain('Open Directory in File Explorer');
  });
});
