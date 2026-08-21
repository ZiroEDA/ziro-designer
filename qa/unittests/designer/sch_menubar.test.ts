// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic menubar's inventory. Counterpart: `SCH_EDIT_FRAME::doReCreateMenuBar`
 * (eeschema/menubar.cpp) — the top-level menus, their order, and the entries
 * whose absence a user would notice.
 *
 * This file exists because until now it could not: `menubar.ts` imported its
 * types from `MenuBar.tsx`, and qa's tsconfig compiles `.ts` only, so the whole
 * menu inventory was untestable however pure the module was. Splitting
 * `menu_types.ts` out fixed that, and #74 (menubar drift vs upstream) is the
 * issue this unblocks.
 *
 * These are inventory assertions, not behaviour: they check an entry exists and
 * is reachable, which is exactly the drift that goes unnoticed when a menu is
 * hand-maintained.
 */
import { describe, it, expect } from 'vitest';
import { buildMenus, TOOL_HOTKEYS } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

/** Every handler is a no-op; we are inspecting structure, not behaviour. */
const handlers = new Proxy({}, { get: () => () => {} }) as Parameters<typeof buildMenus>[0];

const menus = (): Menu[] => buildMenus(handlers);

/** Flatten a menu tree, submenus included. */
function walk(items: readonly MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    out.push(it);
    const sub = it.submenu ?? it.items;
    if (sub) out.push(...walk(sub));
  }
  return out;
}

const allItems = (): MenuItem[] => menus().flatMap((m) => walk(m.items));
const labels = (): string[] =>
  allItems()
    .map((i) => i.label)
    .filter((l): l is string => !!l);

describe('the top-level menus', () => {
  it('are KiCad’s, in KiCad’s order', () => {
    // doReCreateMenuBar appends in this order.
    expect(menus().map((m) => m.label)).toEqual([
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

  it('none is empty', () => {
    for (const m of menus()) expect(m.items.length).toBeGreaterThan(0);
  });
});

describe('the inventory, as a drift net', () => {
  const has = (label: string): boolean => labels().includes(label);

  // Checked against SCH_EDIT_FRAME::doReCreateMenuBar 2026-08-04: the inventory
  // is complete. These are the entries whose disappearance would be noticed,
  // recorded with their *actual* labels so the test tracks the menu rather than
  // an idea of it.
  const EXPECTED = [
    // File — no New/Open: a browser app opens projects from the home screen,
    // not from the schematic frame's File menu.
    'Save',
    'Schematic Setup...',
    'Page Settings...',
    'Print...',
    'Plot...',
    // Edit
    'Undo',
    'Redo',
    'Cut',
    'Copy',
    'Paste',
    'Paste Special...',
    'Find',
    'Find and Replace',
    'Edit Text & Graphics Properties...',
    'Change Symbols...',
    // Place — every drawing tool upstream offers
    'Place Symbols',
    'Place Power Symbols',
    'Draw Wires',
    'Draw Buses',
    'Place Wire to Bus Entries',
    'Place No Connect Flags',
    'Place Junctions',
    'Place Net Labels',
    'Place Global Labels',
    'Place Hierarchical Labels',
    'Draw Hierarchical Sheets',
    'Draw Text',
    'Draw Text Boxes',
    'Draw Tables',
    'Draw Rectangles',
    'Draw Circles',
    'Draw Arcs',
    'Draw Bezier Curve',
    'Draw Lines',
    'Place Images',
    // Inspect
    'Electrical Rules Checker',
    // Tools
    'Update PCB from Schematic...',
    'Annotate Schematic...',
    'Assign Footprints...',
    'Bulk Edit Symbol Fields...',
    'Generate Bill of Materials...',
    'Generate Legacy Bill of Materials...',
  ];

  for (const label of EXPECTED) {
    it(`has "${label}"`, () => {
      expect(has(label)).toBe(true);
    });
  }
});

describe('no entry is silently inert', () => {
  it('every labelled row has an action, a submenu, or is marked disabled', () => {
    // The failure this guards is a row that looks clickable and does nothing.
    // A greyed-out row is honest; an enabled row with no action is not.
    const inert = allItems().filter(
      (i) => !i.sep && i.label && !i.action && !(i.submenu ?? i.items)?.length && !i.disabled,
    );
    expect(inert.map((i) => i.label)).toEqual([]);
  });

  /**
   * The Set Language rows are excluded. A language greyed there is not an
   * unbuilt feature: `setLanguageMenuItem` disables the ones with no
   * translation shipped, which is its own `available` gate and is pinned by
   * `language_menu.test.ts`. Folding forty-odd language names into the list
   * below would bury the four entries this check exists to watch.
   */
  it('the greyed-out set is exactly the unbuilt features', () => {
    // Pinned deliberately. Implementing one of these and forgetting to drop its
    // `disabled` flag leaves the feature unreachable from the menu with nothing
    // to notice it — that is the stale-entry drift this file exists for. When a
    // feature lands, delete its line here in the same commit.
    const languages = new Set(
      (
        menus()
          .find((m) => m.label === 'Preferences')
          ?.items?.find((i) => i.label === 'Set Language')?.submenu ?? []
      ).map((i) => i.label),
    );
    const greyed = allItems()
      .filter((i) => i.disabled && i.label && !languages.has(i.label))
      .map((i) => i.label);
    expect(greyed).toEqual([
      'Non-KiCad Schematic...',
      'Footprint Assignments...',
      'Drawing to Clipboard',
      'Symbols...',
      'Design Blocks',
      'Remote Symbols',
      'Show Directive Labels',
      'Show ERC Errors',
      'Show ERC Warnings',
      'Show ERC Exclusions',
      'Mark items excluded from simulation',
      'Show OP Voltages',
      'Show OP Currents',
      'Show Pin Alternate Icons',
      'Show Bus Syntax Help',
      'Compare Symbol with Library',
      'Simulator',
      'Rescue Symbols...',
      'Remap Legacy Library Symbols...',
      'Generate Legacy Bill of Materials...',
      'Add Design Variant...',
      'Remove Design Variant...',
      'Edit Variant Description...',
      'Configure Paths...',
      'Manage Design Block Libraries...',
      // "About ZiroEDA" used to be greyed out here. The Help menu is now the
      // shared AddStandardHelpMenu port, where About is a live action - as it
      // is in every KiCad frame.
    ]);
  });
});

describe('the single-key tool hotkeys', () => {
  it('match the eeschema defaults', () => {
    // sch_actions.cpp's single-key defaults; wrong letters here are silent.
    expect(TOOL_HOTKEYS).toMatchObject({
      a: 'placeSymbol',
      p: 'placePower',
      w: 'drawWire',
      b: 'drawBus',
      j: 'junction',
      l: 'placeLabel',
      h: 'placeHierLabel',
      t: 'placeText',
    });
  });

  it('assigns each key once', () => {
    const keys = Object.keys(TOOL_HOTKEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('assigns each tool once', () => {
    const tools = Object.values(TOOL_HOTKEYS);
    expect(new Set(tools).size).toBe(tools.length);
  });
});

/**
 * Tools > Switch to Project Manager. `menubar.cpp:310` adds
 * `ACTIONS::showProjectManager` between "Switch to PCB Editor" and "Calculator
 * Tools" when the frame runs under the project manager, which is always our
 * case — the launcher is there.
 *
 * The label is the action's whole FriendlyName (actions.cpp:1258), "Switch to
 * Project Manager". Ours had shortened it to "Project Manager", which reads as
 * a different kind of entry — a place rather than a move — beside the "Switch
 * to PCB Editor" directly above it.
 */
describe('Tools > Switch to Project Manager', () => {
  const toolLabels = (): string[] => {
    const menu = menus().find((m) => m.label === 'Tools');
    return (menu?.items ?? []).map((i) => i.label ?? (i.sep ? '---' : ''));
  };

  it('sits between Switch to PCB Editor and Calculator Tools', () => {
    const labels = toolLabels();
    const pcb = labels.indexOf('Switch to PCB Editor');
    const pm = labels.indexOf('Switch to Project Manager');
    const calc = labels.indexOf('Calculator Tools');
    expect(pm, 'Switch to Project Manager should be in Tools').toBeGreaterThan(-1);
    expect(pm).toBe(pcb + 1);
    expect(calc).toBe(pm + 1);
  });

  it('is enabled, not a stub', () => {
    const menu = menus().find((m) => m.label === 'Tools');
    const item = (menu?.items ?? []).find((i) => i.label === 'Switch to Project Manager');
    expect(item!.disabled).toBeFalsy();
  });
});

/**
 * Help > Help. Upstream's `AddStandardHelpMenu` opens the product documentation
 * ("Open product documentation in a web browser") as the *first* Help entry.
 */
describe('Help > Help', () => {
  it('is the first entry in Help and enabled', () => {
    const menu = menus().find((m) => m.label === 'Help');
    expect(menu, 'Help menu').toBeDefined();
    const first = (menu!.items ?? [])[0];
    expect(first!.label).toBe('Help');
    expect(first!.disabled).toBeFalsy();
  });
});

/**
 * Menu entries KiCad 10.0.5 does not have on this menu, named ONE AT A TIME.
 *
 * A single "the Place menu has no ellipse item" would pass with one of the two
 * still present, which is CLAUDE.md's file-level-check-for-a-per-occurrence-rule
 * shape. Each row below is its own assertion for that reason.
 *
 * Two different reasons are mixed here and the distinction matters:
 *
 *  - **No such thing anywhere.** `SHAPE_T` (include/eda_shape.h:44-53) has six
 *    members — SEGMENT, RECTANGLE, ARC, CIRCLE, POLY, BEZIER — and no ELLIPSE;
 *    `grep -rin ellipse eeschema/` hits only the Altium importer; the
 *    `kicad_sexpr` schematic reader/writer has no `ellipse` token at all. And
 *    `grep -rin netchain` over the whole 10.0.5 tree hits nothing outside
 *    translated documentation strings — not eeschema, not pcbnew, not common.
 *    `menubar.cpp:339`, which the deleted test cited for it, is
 *    `prefsMenu->Add( ACTIONS::configurePaths )`.
 *
 *  - **Real, but on a different surface.** `syncSheetPins` exists
 *    (sch_actions.cpp:620) as a CONTEXT-menu item gated on a sheet selection
 *    (sch_selection_tool.cpp:382); menubar.cpp:255 puts only `syncAllSheetsPins`
 *    on the Place menu. Rename/Copy Design Variant exist as BUTTONS in
 *    DIALOG_SYMBOL_FIELDS_TABLE (dialog_symbol_fields_table.cpp:214-215), never
 *    as TOOL_ACTIONs and never in the Tools > Variants submenu, which upstream
 *    builds from exactly three (menubar.cpp:328-330).
 */
describe('entries upstream does not put on these menus', () => {
  const labelsOf = (menu: string): string[] => {
    const m = menus().find((x) => x.label === menu);
    expect(m, menu).toBeDefined();
    const walk = (items: MenuItem[]): string[] =>
      items.flatMap((i) => [i.label ?? '', ...(i.items ? walk(i.items) : [])]);
    return walk(m!.items ?? []);
  };

  for (const label of ['Draw Ellipses', 'Draw Elliptical Arcs']) {
    it(`Place has no ${label} (SHAPE_T has no ELLIPSE)`, () => {
      expect(labelsOf('Place')).not.toContain(label);
    });
  }

  it('Place has no Sync Sheet Pins... (that one is context-menu only)', () => {
    expect(labelsOf('Place')).not.toContain('Sync Sheet Pins...');
  });

  it('Place still has Sync All Sheet Pins..., which upstream does put here', () => {
    expect(labelsOf('Place')).toContain('Sync All Sheet Pins...');
  });

  it('Tools has no Create Net Chain... (no such action in 10.0.5)', () => {
    expect(labelsOf('Tools')).not.toContain('Create Net Chain...');
  });

  for (const label of ['Rename Design Variant...', 'Copy Design Variant...']) {
    it(`Tools > Variants has no ${label} (a fields-table button)`, () => {
      expect(labelsOf('Tools')).not.toContain(label);
    });
  }

  /** menubar.cpp:328-330 — three, and exactly three. */
  it('Tools > Variants holds exactly the three upstream actions', () => {
    const tools = menus().find((m) => m.label === 'Tools')!;
    const variants = (tools.items ?? []).find((i) => i.label === 'Variants');
    expect(variants, 'Variants submenu').toBeDefined();
    expect((variants!.items ?? []).map((i) => i.label)).toEqual([
      'Add Design Variant...',
      'Remove Design Variant...',
      'Edit Variant Description...',
    ]);
  });

  /** menubar.cpp:255-263, the order the shape actions are added in. */
  it('Place draws Circles then Arcs, with nothing between them', () => {
    const l = labelsOf('Place');
    expect(l.indexOf('Draw Arcs')).toBe(l.indexOf('Draw Circles') + 1);
  });
});

/**
 * Preferences, against `menubar.cpp:341-348`:
 *
 *     prefsMenu->Add( ACTIONS::configurePaths );
 *     prefsMenu->Add( ACTIONS::showSymbolLibTable );
 *     prefsMenu->Add( ACTIONS::showDesignBlockLibTable );
 *     prefsMenu->Add( ACTIONS::openPreferences );
 *     prefsMenu->AppendSeparator();
 *     AddMenuLanguageList( prefsMenu, selTool );
 *
 * Ours stopped at Preferences..., so the menu simply ended early. Five other
 * launchers here already call the shared `setLanguageMenuItem`; eeschema was
 * the one that did not.
 */
describe('Preferences ends with a separator and the language list', () => {
  const prefs = () => menus().find((m) => m.label === 'Preferences')!.items ?? [];

  it('has the four upstream rows, then a separator, then Set Language', () => {
    expect(prefs().map((i) => i.label ?? (i.sep ? '---' : ''))).toEqual([
      'Configure Paths...',
      'Manage Symbol Libraries...',
      'Manage Design Block Libraries...',
      'Preferences...',
      '---',
      'Set Language',
    ]);
  });

  /** `langsMenu->SetTitle( _( "Set Language" ) )` — not "Language". */
  it('titles the submenu Set Language', () => {
    expect(prefs().at(-1)?.label).toBe('Set Language');
  });

  /** eda_base_frame.cpp:2078-2082 — every row is a wxITEM_CHECK. */
  it('ticks exactly one language, the current one', () => {
    const rows = prefs().at(-1)?.submenu ?? [];
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['Default']);
  });

  /** The separator is real: pl_editor omits it, eeschema does not. */
  it('separates Preferences... from the list', () => {
    const items = prefs();
    expect(items[items.length - 2]?.sep).toBe(true);
  });

  it('reports the picked language back to the caller', () => {
    const picked: string[] = [];
    const m = buildMenus({
      tool: () => undefined,
      action: () => undefined,
      toggle: () => undefined,
      language: 'Default',
      onSelectLanguage: (l) => picked.push(l),
    });
    const rows = (m.find((x) => x.label === 'Preferences')!.items ?? []).at(-1)?.submenu ?? [];
    rows.find((r) => r.label === 'Deutsch')?.action?.();
    expect(picked).toEqual(['Deutsch']);
  });
});
