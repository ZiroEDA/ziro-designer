// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Preferences MENU — not the dialog — across every frame.
 *
 * `EDA_BASE_FRAME` gives each frame the same tail: the library tables, then
 * `ACTIONS::openPreferences`, then a separator, then
 * `AddMenuLanguageList( prefsMenu, selTool )`
 * (`eda_base_frame.cpp:2062-2087`). Fifteen KiCad frames end this menu the same
 * way, which is exactly why a frame that quietly ends it early is hard to spot:
 * the menu is still there and still opens the dialog.
 *
 * The board editor was that frame. Its Preferences menu held one row where the
 * schematic, symbol, footprint, Gerber and project frames all build the full
 * one — so Set Language, which this port has had all along, was missing from
 * the editor a user spends the most time in.
 *
 * A source check because these menus are built inside the frames rather than in
 * a data module, and what is being pinned is that no frame's menu ends early.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (rel: string): string =>
  readFileSync(resolve(process.cwd(), '../designer/src', rel), 'utf8');

/** Every frame that builds a Preferences menu, and where it does it. */
const FRAMES: [string, string][] = [
  ['schematic', 'editors/schematic/menubar.ts'],
  ['symbol editor', 'editors/symbol/menubar.ts'],
  ['footprint editor', 'editors/footprint/menubar.ts'],
  ['board editor', 'editors/pcb/PcbEditor.tsx'],
  ['gerber viewer', 'editors/gerbview/menubar.ts'],
  ['project manager', 'home/menubar.ts'],
  ['assign footprints', 'editors/schematic/dialogs/dialog_assign_footprints.tsx'],
];

describe('every frame ends Preferences the way EDA_BASE_FRAME does', () => {
  it.each(FRAMES)('%s opens the one shared dialog', (_name, rel) => {
    // `ACTIONS::openPreferences` — one dialog for the whole application.
    expect(src(rel)).toMatch(/'Preferences\.\.\.'/);
  });

  it.each(FRAMES)('%s ends with the shared Set Language submenu', (_name, rel) => {
    // `AddMenuLanguageList`. Not a copy per frame: `ui/language_menu.ts` holds
    // the list, so a frame that builds its own rows is the bug this catches.
    expect(src(rel)).toMatch(/setLanguageMenuItem\(/);
  });
});

describe('Configure Paths is gone from all of them', () => {
  /**
   * `DIALOG_CONFIGURE_PATHS` edits the environment substitutions a library path
   * is written against — `KICAD10_SYMBOL_DIR`, `KIPRJMOD` — so a `.kicad_sym`
   * on one machine's disk is found on another's. There is no disk here and no
   * second machine.
   *
   * Removed rather than greyed. Greying says "not ready yet"; this is not a
   * promise the app can keep, and it had been sitting greyed in four menus.
   */
  it.each(FRAMES)('%s does not draw the row', (_name, rel) => {
    // Comments stripped: the reason it is absent names it, and must be allowed to.
    const code = src(rel)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('Configure Paths');
  });

  it('keeps the ACTION itself, which is KiCad’s table and not our menu', () => {
    // `ui/action_catalogue.ts` is the port of KiCad's TOOL_ACTION list; an
    // action existing there is a fact about KiCad, not a row we draw.
    expect(src('ui/action_catalogue.ts')).toContain('common.SuiteControl.configurePaths');
  });
});

describe('the library tables stay', () => {
  /**
   * These are NOT path configuration, which is the reason to keep them after
   * dropping Configure Paths. `SYMBOL_LIB_TABLE` / `FP_LIB_TABLE` is the
   * IDENTITY of everything in a design: a board stores `Device:R`, where
   * `Device` is a nickname the table resolves. A project that arrives naming a
   * nickname we do not have needs somewhere to be seen and fixed, and both
   * dialogs are built.
   */
  it('the board editor offers the footprint table its board is written against', () => {
    expect(src('editors/pcb/PcbEditor.tsx')).toContain('Manage Footprint Libraries...');
  });

  it('and the schematic actually opens the symbol one', () => {
    const sch = src('editors/schematic/SchematicEditor.tsx');
    expect(sch).toContain('DialogSymLibTable');
    expect(sch).toMatch(/id === 'manageSymbolLibraries'/);
  });
});
