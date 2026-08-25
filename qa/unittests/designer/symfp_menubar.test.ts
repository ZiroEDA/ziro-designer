// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor and Footprint Editor menu bars, row by row.
 *
 * Counterparts: `SYMBOL_EDIT_FRAME::doReCreateMenuBar`
 * (`eeschema/symbol_editor/menubar_symbol_editor.cpp:36-194`) and
 * `FOOTPRINT_EDIT_FRAME::doReCreateMenuBar`
 * (`pcbnew/menubar_footprint_editor.cpp:38-258`).
 *
 * **This file could not have existed a commit ago.** Both bars were a `useMemo`
 * inside the frame's `.tsx`, and `qa`'s tsconfig compiles `.ts` only, so no
 * test could import either tree. That is the reason 62 upstream rows were
 * missing, 7 were invented and 6 submenus were flattened: not that the rows
 * were hard, but that nothing in the suite could see them.
 *
 * The expectations are **per row**, in order, including separators. A per-menu
 * count or a per-file grep would pass with one row of sixty-two still missing,
 * which is exactly the shape of check that let this drift happen.
 */
import { describe, expect, it } from 'vitest';
import {
  symbolEditorMenus,
  type SymbolMenuConditions,
  type SymbolMenuHandlers,
} from '@ziroeda/designer/src/editors/symbol/menubar.js';
import {
  footprintEditorMenus,
  type FootprintMenuConditions,
  type FootprintMenuHandlers,
} from '@ziroeda/designer/src/editors/footprint/menubar.js';
import { standardHelpMenu } from '@ziroeda/designer/src/ui/help_menu.js';
import { setLanguageMenuItem } from '@ziroeda/designer/src/ui/language_menu.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const noop = (): void => {};

const handlers = (): SymbolMenuHandlers & FootprintMenuHandlers => ({
  action: noop,
  tool: noop,
  toggle: noop,
  language: 'Default',
  onSelectLanguage: noop,
  showHotkeys: noop,
  showAbout: noop,
});

/** Every ENABLE() condition true, so a greyed row is greyed on its own merits. */
const SYM_ON: SymbolMenuConditions = {
  haveSymbol: true,
  isEditable: true,
  isEditableInAlias: true,
  canUpdateFields: true,
  symbolModified: true,
  libSelected: true,
  canEditProperties: true,
  symbolSelectedInTree: true,
  saveSymbolAs: true,
  symbolFromSchematic: false,
  undoAvailable: true,
  redoAvailable: true,
  idle: true,
  noActiveTool: true,
  multiUnitMode: true,
  multiBodyStyle: true,
  haveDatasheet: true,
};
const FP_ON: FootprintMenuConditions = {
  haveFootprint: true,
  targetLib: true,
  targetFootprint: true,
  footprintSelectedInTree: true,
  contentModified: true,
  hasItems: true,
  undoAvailable: true,
  redoAvailable: true,
};

const sym = (
  conds: Partial<SymbolMenuConditions> = {},
  checks: Record<string, boolean> = {},
): Menu[] => symbolEditorMenus(handlers(), checks, { ...SYM_ON, ...conds });
const fp = (
  conds: Partial<FootprintMenuConditions> = {},
  checks: Record<string, boolean> = {},
): Menu[] => footprintEditorMenus(handlers(), checks, { ...FP_ON, ...conds });

const menu = (menus: Menu[], label: string): Menu => {
  const m = menus.find((x) => x.label === label);
  if (!m) throw new Error(`no ${label} menu`);
  return m;
};
/** A row's text; a separator is `---`; a submenu is `Title > [a, b]`. */
const row = (i: MenuItem): string => {
  if (i.sep) return '---';
  const sub = i.submenu ?? i.items;
  if (sub) return `${i.label} > [${sub.map(row).join(', ')}]`;
  return i.label ?? '?';
};
const rows = (menus: Menu[], label: string): string[] => menu(menus, label).items.map(row);
/** Every row of every menu, flattened, for the "is it anywhere" questions. */
const allRows = (menus: Menu[]): string[] => {
  const out: string[] = [];
  const walk = (items: readonly MenuItem[]): void => {
    for (const i of items) {
      if (i.label) out.push(i.label);
      walk(i.submenu ?? i.items ?? []);
    }
  };
  for (const m of menus) walk(m.items);
  return out;
};
const find = (menus: Menu[], label: string): MenuItem | undefined => {
  let hit: MenuItem | undefined;
  const walk = (items: readonly MenuItem[]): void => {
    for (const i of items) {
      if (i.label === label) hit ??= i;
      walk(i.submenu ?? i.items ?? []);
    }
  };
  for (const m of menus) walk(m.items);
  return hit;
};

describe('the Symbol Editor menu bar', () => {
  /** `menuBar->Append` order, :184-190, Help last via AddStandardHelpMenu. */
  it('is File, Edit, View, Place, Inspect, Preferences, Help', () => {
    expect(sym().map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Place',
      'Inspect',
      'Preferences',
      'Help',
    ]);
  });

  /** :48-88. Ours was eight rows, with both submenus flattened to one row. */
  it('File is upstream, row for row', () => {
    expect(rows(sym(), 'File')).toEqual([
      'New Library...',
      'Add Library...',
      'Save Library As...',
      'New Symbol...',
      'Edit Library Symbol...',
      '---',
      'Save',
      'Save As...',
      'Save Copy As...',
      'Save All',
      'Revert',
      '---',
      // `submenuImport->Add( action, NORMAL, _( "Symbol..." ) )` — the third
      // argument replaces the FriendlyName (:70-71, :79-81).
      'Import > [Symbol..., Graphics...]',
      'Export > [Symbol..., View as PNG..., Symbol as SVG...]',
      '---',
      'Symbol Properties...',
      '---',
      'Close',
    ]);
  });

  /**
   * `if( !IsSymbolFromSchematic() ) fileMenu->Add( ACTIONS::saveAll );`
   * (:59-60). The row is ABSENT, not greyed — the one conditional row in
   * either bar, and the only way to tell the two branches apart.
   */
  it('drops Save All when the symbol came from a schematic', () => {
    expect(rows(sym(), 'File')).toContain('Save All');
    expect(rows(sym({ symbolFromSchematic: true }), 'File')).not.toContain('Save All');
    // …and nothing else moves with it.
    expect(rows(sym({ symbolFromSchematic: true }), 'File')).toHaveLength(
      rows(sym(), 'File').length - 1,
    );
  });

  /**
   * Edit Library Symbol is `ENABLE( isSymbolFromSchematicCond )` (:535), and
   * ours is greyed either way — a deliberate deviation, recorded here rather
   * than left implicit. Nothing in this port opens the LIBRARY copy of a
   * symbol borrowed from the schematic, so lighting the row up when the
   * condition turns true (which it now does, unlike when this test was
   * written) would offer a click that does nothing. `sym_ui_conditions.test.ts`
   * pins the condition itself, which is live and is what makes Save All above
   * disappear; this pins the row.
   */
  it('greys Edit Library Symbol whichever way the condition goes, unlike upstream', () => {
    expect(find(sym(), 'Edit Library Symbol...')?.disabled).toBe(true);
    expect(find(sym({ symbolFromSchematic: true }), 'Edit Library Symbol...')?.disabled).toBe(true);
  });

  /** :95-116. Ours was six entries against upstream's eighteen. */
  it('Edit is upstream, row for row', () => {
    expect(rows(sym(), 'Edit')).toEqual([
      'Undo',
      'Redo',
      '---',
      'Cut',
      'Copy',
      'Copy as Text',
      'Paste',
      'Delete',
      'Duplicate',
      '---',
      'Select All',
      'Unselect All',
      '---',
      'Find',
      'Find and Replace',
      '---',
      'Pin Table...',
      'Update Symbol Fields...',
    ]);
  });

  /** :121-142. The Panels submenu, and no "Show Pin Electrical Types". */
  it('View is upstream, row for row', () => {
    expect(rows(sym(), 'View')).toEqual([
      'Panels > [Properties, Library Tree]',
      '---',
      'Symbol Library Browser',
      '---',
      'Zoom In',
      'Zoom Out',
      'Zoom to Fit',
      'Zoom to Selection Area',
      'Refresh',
      '---',
      'Show Hidden Pins',
      'Show Hidden Fields',
      'Show Pin Alternate Icons',
    ]);
  });

  /**
   * `SCH_ACTIONS::showElectricalTypes` is a left-toolbar TOGGLE
   * (`toolbars_symbol_editor.cpp:82`) and appears in no menu upstream. Ours
   * had invented a View row for it.
   */
  it('does not carry the toolbar-only Show Pin Electrical Types', () => {
    expect(allRows(sym())).not.toContain('Show Pin Electrical Types');
  });

  /**
   * :149-157. The FriendlyNames are plural imperatives (sch_actions.cpp:376-426,
   * :682-709), and `placeSymbolText` declares **no** DefaultHotkey — the T our
   * Text row printed was invented.
   */
  it('Place uses the plural FriendlyNames, in upstream order', () => {
    expect(rows(sym(), 'Place')).toEqual([
      'Draw Pins',
      'Draw Text',
      'Draw Text Boxes',
      'Draw Rectangles',
      'Draw Circles',
      'Draw Arcs',
      'Draw Bezier Curve',
      'Draw Lines',
      'Draw Polygons',
    ]);
  });

  it('gives Draw Pins P and Draw Text no key at all', () => {
    expect(find(sym(), 'Draw Pins')?.shortcut).toBe('P');
    expect(find(sym(), 'Draw Text')?.shortcut).toBeUndefined();
  });

  /** :164-167. FriendlyName is "Symbol Checker" — no ellipsis. */
  it('Inspect is upstream, row for row', () => {
    expect(rows(sym(), 'Inspect')).toEqual(['Show Datasheet', '---', 'Symbol Checker']);
  });

  /** :174-179 — the same four rows fifteen KiCad frames end Preferences with. */
  it('Preferences is the shared four plus the shared language list', () => {
    expect(rows(sym(), 'Preferences').slice(0, 4)).toEqual([
      'Configure Paths...',
      'Manage Symbol Libraries...',
      'Preferences...',
      '---',
    ]);
    // Compared by label, not deep equality: the rows carry closures. What
    // matters is that this is `ui/language_menu.ts`'s submenu and not a copy.
    const shared = setLanguageMenuItem({ current: 'Default', onSelect: noop });
    const ours = menu(sym(), 'Preferences').items[4]!;
    expect(ours.label).toBe(shared.label);
    expect(ours.submenu?.map((i) => i.label)).toEqual(shared.submenu?.map((i) => i.label));
  });

  it('ends with the shared Help menu', () => {
    const shared = standardHelpMenu({ showHotkeys: noop, showAbout: noop });
    expect(rows(sym(), 'Help')).toEqual(shared.items.map(row));
  });
});

describe('the Footprint Editor menu bar', () => {
  /** `menuBar->Append` order, :247-254. */
  it('is File, Edit, View, Place, Inspect, Tools, Preferences, Help', () => {
    expect(fp().map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Place',
      'Inspect',
      'Tools',
      'Preferences',
      'Help',
    ]);
  });

  /** :62-92. "New Footprint" carries no ellipsis (pcb_actions.cpp:868). */
  it('File is upstream, row for row', () => {
    expect(rows(fp(), 'File')).toEqual([
      'New Library...',
      'Add Library...',
      'New Footprint',
      'Create Footprint...',
      'Edit Library Footprint...',
      '---',
      'Save',
      'Save As...',
      'Revert',
      '---',
      'Import > [Footprint..., Graphics...]',
      'Export > [Footprint..., View as PNG...]',
      '---',
      'Footprint Properties...',
      '---',
      'Print...',
      '---',
      'Close',
    ]);
  });

  /**
   * `ACTIONS::saveAll` appears nowhere in `menubar_footprint_editor.cpp`. The
   * footprint editor has no Save All row; ours had invented one.
   */
  it('has no Save All, because upstream has none', () => {
    expect(allRows(fp())).not.toContain('Save All');
  });

  /** :95-125, including the `&Select` submenu (:112-117). */
  it('Edit is upstream, row for row', () => {
    expect(rows(fp(), 'Edit')).toEqual([
      'Undo',
      'Redo',
      '---',
      'Cut',
      'Copy',
      'Paste',
      'Delete',
      'Duplicate',
      '---',
      'Select > [Select All, Unselect All]',
      '---',
      'Edit Text & Graphics Properties...',
      'Pad Table...',
      'Default Pad Properties...',
      'Renumber Pads...',
      'Grid Origin...',
    ]);
  });

  /** :128-171 — Panels, Drawing Mode and Contrast Mode, all three submenus. */
  it('View is upstream, row for row', () => {
    expect(rows(fp(), 'View')).toEqual([
      'Panels > [Properties, Library Tree, Appearance]',
      '---',
      'Footprint Library Browser',
      '3D Viewer',
      '---',
      'Zoom In',
      'Zoom Out',
      'Zoom to Fit',
      'Zoom to Selection Area',
      'Refresh',
      '---',
      'Drawing Mode > [Sketch Pads, Sketch Graphic Items, Sketch Text Items]',
      'Contrast Mode > [Inactive Layer View Mode, Decrease Layer Opacity, Increase Layer Opacity]',
      'Flip Board View',
    ]);
  });

  /** :174-206. Nine rows became twenty-two, and every label was wrong. */
  it('Place is upstream, row for row', () => {
    expect(rows(fp(), 'Place')).toEqual([
      'Add Pad',
      'Draw Rule Areas',
      '---',
      'Draw Lines',
      'Draw Arcs',
      'Draw Rectangles',
      'Draw Circles',
      'Draw Polygons',
      'Draw Bezier Curve',
      'Place Reference Images',
      'Draw Text',
      'Draw Text Boxes',
      'Draw Tables',
      'Place Point',
      'Add Barcode',
      '---',
      'Draw Orthogonal Dimensions',
      'Draw Aligned Dimensions',
      'Draw Center Dimensions',
      'Draw Radial Dimensions',
      'Draw Leaders',
      '---',
      'Place the Footprint Anchor',
      'Grid Origin',
      '---',
      'Reset Grid Origin',
    ]);
  });

  /**
   * Place's accelerators, none of which this bar carried. Each is the action's
   * own `DefaultHotkey`; `browserSafeKey` decides the two that Chrome reserves,
   * and today it substitutes neither (`ui/browser_reserved.ts` names
   * `placeText`'s Ctrl+Shift+T as the deliberate exception).
   */
  it.each([
    ['Draw Rule Areas', 'Ctrl+Shift+K'],
    ['Draw Lines', 'Ctrl+Shift+L'],
    ['Draw Arcs', 'Ctrl+Shift+A'],
    ['Draw Circles', 'Ctrl+Shift+C'],
    ['Draw Polygons', 'Ctrl+Shift+P'],
    ['Draw Bezier Curve', 'Ctrl+Shift+B'],
    ['Draw Text', 'Ctrl+Shift+T'],
    ['Draw Orthogonal Dimensions', 'Ctrl+Shift+H'],
    ['Place the Footprint Anchor', 'Ctrl+Shift+N'],
  ])('Place > %s answers %s', (label, combo) => {
    expect(find(fp(), label)?.shortcut).toBe(combo);
  });

  /** Draw Rectangles is the one Place action upstream gives no key. */
  it('gives Draw Rectangles no key, because the action declares none', () => {
    expect(find(fp(), 'Draw Rectangles')?.shortcut).toBeUndefined();
  });

  /** :209-219. FriendlyName is "Footprint Checker" — no ellipsis. */
  it('Inspect is upstream, row for row', () => {
    expect(rows(fp(), 'Inspect')).toEqual([
      'Measure Tool',
      '---',
      'Footprint Checker',
      '---',
      'Show Datasheet',
    ]);
  });

  /** :222-228. The FriendlyNames say "PCB"; only the Tooltips say "board". */
  it('Tools is upstream, row for row', () => {
    expect(rows(fp(), 'Tools')).toEqual([
      'Load footprint from current PCB',
      'Insert footprint into PCB',
      '---',
      'Cleanup Graphics...',
      'Repair Footprint',
    ]);
  });

  /** :234-243 — the shared four, then AddMenuLanguageList. */
  it('Preferences is the shared four plus the shared language list', () => {
    expect(rows(fp(), 'Preferences').slice(0, 4)).toEqual([
      'Configure Paths...',
      'Manage Footprint Libraries...',
      'Preferences...',
      '---',
    ]);
    const shared = setLanguageMenuItem({ current: 'Default', onSelect: noop });
    const ours = menu(fp(), 'Preferences').items[4]!;
    expect(ours.label).toBe(shared.label);
    expect(ours.submenu?.map((i) => i.label)).toEqual(shared.submenu?.map((i) => i.label));
  });

  it('ends with the shared Help menu', () => {
    const shared = standardHelpMenu({ showHotkeys: noop, showAbout: noop });
    expect(rows(fp(), 'Help')).toEqual(shared.items.map(row));
  });
});

describe('a CHECK row ticks in the gutter, not in its text', () => {
  /**
   * Thirteen rows across the two bars used to prepend `'✓ '` to the label
   * string. `MenuItem.checked` has always existed and `MenuBar.tsx` has always
   * drawn it in the icon gutter, so the only effect of the prefix was to shift
   * the label two characters sideways the moment it was ticked.
   */
  const CHECK_ROWS: readonly [string, string][] = [
    ['showProperties', 'Properties'],
    ['showLibraryTree', 'Library Tree'],
    ['showHiddenPins', 'Show Hidden Pins'],
    ['showHiddenFields', 'Show Hidden Fields'],
  ];

  it.each(CHECK_ROWS)('symbol %s', (id, label) => {
    expect(find(sym({}, {}), label)?.checked).toBe(false);
    const on = find(sym({}, { [id]: true }), label);
    expect(on?.checked).toBe(true);
    // The label is the same string either way — no glyph in the text.
    expect(on?.label).toBe(label);
  });

  const FP_CHECK_ROWS: readonly [string, string][] = [
    ['showProperties', 'Properties'],
    ['showLibraryTree', 'Library Tree'],
    ['showLayersManager', 'Appearance'],
    ['padDisplayMode', 'Sketch Pads'],
    ['graphicsOutlines', 'Sketch Graphic Items'],
    ['textOutlines', 'Sketch Text Items'],
    ['highContrast', 'Inactive Layer View Mode'],
  ];

  it.each(FP_CHECK_ROWS)('footprint %s', (id, label) => {
    expect(find(fp({}, {}), label)?.checked).toBe(false);
    const on = find(fp({}, { [id]: true }), label);
    expect(on?.checked).toBe(true);
    expect(on?.label).toBe(label);
  });

  it('no row anywhere in either bar spells a tick into its text', () => {
    const ticked = [
      ...allRows(sym({}, Object.fromEntries(CHECK_ROWS.map(([id]) => [id, true])))),
      ...allRows(fp({}, Object.fromEntries(FP_CHECK_ROWS.map(([id]) => [id, true])))),
    ].filter((l) => l.includes('✓'));
    expect(ticked).toEqual([]);
  });
});
