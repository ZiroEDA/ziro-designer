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
    'Previous Marker',
    'Next Marker',
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

  it('the greyed-out set is exactly the unbuilt features', () => {
    // Pinned deliberately. Implementing one of these and forgetting to drop its
    // `disabled` flag leaves the feature unreachable from the menu with nothing
    // to notice it — that is the stale-entry drift this file exists for. When a
    // feature lands, delete its line here in the same commit.
    const greyed = allItems()
      .filter((i) => i.disabled && i.label)
      .map((i) => i.label);
    expect(greyed).toEqual([
      'Save Current Sheet Copy As...',
      'Revert',
      'Non-KiCad Schematic...',
      'Footprint Assignments...',
      'Graphics...',
      'Drawing to Clipboard',
      'Symbols...',
      'Search',
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
      'Draw Rule Areas',
      'Sync All Sheet Pins...',
      'Import Sheet...',
      'Draw Ellipses',
      'Draw Elliptical Arcs',
      'Show Bus Syntax Help',
      'Previous Marker',
      'Next Marker',
      'Exclude Marker',
      'Compare Symbol with Library',
      'Simulator',
      'Rescue Symbols...',
      'Remap Legacy Library Symbols...',
      'Generate Legacy Bill of Materials...',
      'Update Schematic from PCB...',
      'Add Design Variant...',
      'Remove Design Variant...',
      'Edit Variant Description...',
      'Rename Design Variant...',
      'Copy Design Variant...',
      'Configure Paths...',
      'Manage Symbol Libraries...',
      'Manage Design Block Libraries...',
      'About ZiroEDA',
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
