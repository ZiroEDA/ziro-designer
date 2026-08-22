// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List's inventory, which is collected from the menu builders and
 * the toolbar tables rather than transcribed.
 *
 * The hand-written table this replaced was 61 rows and had already drifted from
 * the menus it claimed to describe. These tests are mostly about the collection
 * not going quiet: an inventory built by walking modules fails by returning
 * nothing, and a dialog listing nothing looks much like one that is merely
 * empty.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHotkeySections,
  filterHotkeys,
  hotkeyConflicts,
  type HotkeySection,
} from '@ziroeda/designer/src/ui/hotkeys_inventory.js';
import { HOTKEYS, actionName } from '@ziroeda/designer/src/editors/schematic/hotkeys.js';
import {
  APP_ORDER,
  APP_REGISTRIES,
  SECTION_NAMES,
  hasRegistry,
  qualify,
} from '@ziroeda/designer/src/ui/hotkey_apps.js';
import { buildManagerMenus } from '@ziroeda/designer/src/home/menubar.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const sections: HotkeySection[] = buildHotkeySections();
const rows = sections.flatMap((s) => s.entries);
const find = (command: string): (typeof rows)[number] | undefined =>
  rows.find((e) => e.command === command);

const noop = (): void => undefined;
const managerHandlers = {
  newProject: noop,
  openProject: noop,
  selectProjectFiles: noop,
  openRecent: noop,
  clearRecent: noop,
  language: 'Default',
  setLanguage: noop,
  closeProject: noop,
  restoreLocalHistory: noop,
  hasLocalHistory: false,
  saveAs: noop,
  archiveProject: noop,
  unarchiveProject: noop,
  refresh: noop,
  toggleLocalHistory: noop,
  localHistoryShown: false,
  openTextViewer: noop,
  editSchematic: noop,
  editSymbols: noop,
  editPcb: noop,
  editFootprints: noop,
  openImageConverter: noop,
  openGerberViewer: noop,
  openCalculator: noop,
  openDrawingSheetEditor: noop,
  openPreferences: noop,
  showAbout: noop,
  showHotkeys: noop,
  openDemo: noop,
  hasProject: true,
  hasTextFileSelected: true,
  recent: [],
  demos: [],
};

describe('the hotkey inventory', () => {
  it('collects the whole app, not a handful of rows', () => {
    // KiCad's dialog lists 809 actions. Ours is smaller because the app is,
    // but it is the same order of magnitude and it is derived - a drop here
    // means a builder stopped being walked, which is otherwise silent.
    expect(rows.length).toBeGreaterThan(300);
    expect(sections.length).toBeGreaterThanOrEqual(7);
  });

  it('leaves no section empty', () => {
    // buildHotkeySections drops empty ones, so an empty section here means the
    // drop stopped working rather than that a section is genuinely bare.
    for (const s of sections) expect(s.entries.length, `${s.name} is empty`).toBeGreaterThan(0);
  });

  it('orders its sections the way HOTKEY_STORE::Init emits them', () => {
    // Init walks a std::map keyed by the *action name*, so sections appear in
    // the order their app prefix first shows up in that sorted walk:
    //   3DViewer  common  eeschema  gerbview  kicad  pcbnew  plEditor
    // and Gestures is appended after the loop. It is deliberately neither
    // alphabetical by the names shown nor the order the editors appear
    // anywhere else, which is exactly why it is easy to get wrong.
    expect(sections.map((s) => s.name)).toEqual([
      '3D Viewer',
      'Common',
      'Schematic Editor',
      'Gerber Viewer',
      'Project Manager',
      'PCB Editor',
      'Drawing Sheet Editor',
      'Gestures',
    ]);
  });

  it('gives the symbol and footprint editors no section of their own', () => {
    // Their actions are named eeschema.* and pcbnew.*, so GetAppName folds them
    // into those two sections rather than making new ones.
    const names = sections.map((s) => s.name);
    expect(names).not.toContain('Symbol Editor');
    expect(names).not.toContain('Footprint Editor');
  });

  it('ends with the Gestures section, as Init appends it after the loop', () => {
    const last = sections[sections.length - 1];
    expect(last?.name).toBe('Gestures');
    // g_gesturePseudoActions, which have no TOOL_ACTION behind them.
    expect(last?.entries.map((e) => e.command)).toContain('Highlight Net');
    expect(last?.entries.find((e) => e.command === 'Pan Left/Right')?.keys).toBe('Ctrl+Wheel');
  });

  it('strips the ellipsis, as updateFromClientData does', () => {
    //   label.Replace( wxT( "..." ), wxEmptyString );
    //   label.Replace( wxT( "…" ), wxEmptyString );
    for (const e of rows) {
      expect(e.command, `${e.command} keeps its ellipsis`).not.toMatch(/\.\.\.|…/);
    }
    expect(find('Open Project')).toBeDefined();
  });

  it('carries every accelerator the manager menu declares', () => {
    // The one section whose source can be re-read here independently, so the
    // collection is checked against something other than itself.
    const declared = new Map<string, string>();
    const walk = (items: readonly MenuItem[]): void => {
      for (const it of items) {
        if (it.submenu) walk(it.submenu);
        if (it.label && it.shortcut) {
          declared.set(it.label.replace(/\.\.\.|…/g, '').trim(), it.shortcut);
        }
      }
    };
    for (const m of buildManagerMenus(managerHandlers)) walk(m.items);
    expect(declared.size).toBeGreaterThan(8);

    const mgr = sections.find((s) => s.name === 'Project Manager');
    expect(mgr).toBeDefined();
    for (const [label, keys] of declared) {
      const row = mgr?.entries.find((e) => e.command === label);
      expect(row, `${label} missing from the Project Manager section`).toBeDefined();
      expect(row?.keys, `${label} lost its accelerator`).toBe(keys);
    }
  });

  it('leaves out the empty-state placeholders', () => {
    // "(no recent projects)" and "(no demos bundled)" are what a menu says when
    // it has nothing to list; they are not commands and were being listed as
    // two of them. Upstream has no equivalent - an empty FILE_HISTORY just has
    // no rows.
    for (const e of rows) {
      expect(e.command, `${e.command} is a placeholder`).not.toMatch(/^\(.*\)$/);
    }
  });

  it('lists List Hotkeys itself, on Ctrl+F1', () => {
    // ACTIONS::listHotKeys: .DefaultHotkey( MD_CTRL + WXK_F1 ).
    expect(find('List Hotkeys')?.keys).toBe('Ctrl+F1');
  });

  it('never repeats the command in the description column', () => {
    // A ToolButton has one string for both, so a description that is simply the
    // command again fills the column without saying anything. Upstream's two
    // come from GetFriendlyName() and GetDescription(), which differ.
    for (const e of rows) {
      if (e.description !== '') expect(e.description).not.toBe(e.command);
    }
  });

  it('fills the alternate column only where a second key is bound', () => {
    // One row carries a DefaultHotkeyAlt: the PSEUDO_ACTION
    //   new PSEUDO_ACTION( _( "Accept Autocomplete" ), WXK_RETURN, WXK_NUMPAD_ENTER )
    // (hotkeys_basic.cpp). Zoom to Fit used to be the second, because we bound
    // Ctrl+0 -- ACTIONS::zoomFitScreen's `#if defined( __WXMAC__ )` branch --
    // alongside the Home the `#else` declares. That was never a
    // DefaultHotkeyAlt upstream, only two platforms' defaults bound at once, so
    // the row has a single binding now. Everything else has one binding, and a
    // column filled where nothing is bound would be noise.
    const withAlt = rows.filter((e) => e.alt !== '');
    expect(withAlt.map((e) => e.command).sort()).toEqual(['Accept Autocomplete']);
    // `{ wxT( "Num Pad Enter" ), WXK_NUMPAD_ENTER }` — hotkeys_basic.cpp:127.
    // Two words. This assertion used to say 'Numpad Enter', which is not
    // KiCad's spelling of any key and disagreed with `ui/key_names.ts:86`,
    // which had it right — so the wrong one was the one under test.
    expect(rows.find((e) => e.command === 'Accept Autocomplete')?.alt).toBe('Num Pad Enter');
  });

  it('has no duplicate ACTION within a section', () => {
    /**
     * Keyed on the action name, not on the label, because that is what
     * HOTKEY_STORE keys on:
     *
     *     std::map<std::string, HOTKEY> m_actions;
     *     m_actions[action->GetName()].m_Actions.push_back( action );
     *
     * One action reached from two frames is one row however its labels are
     * spelled — that is the rule this protects, and it is why the symbol
     * editor's Bezier and Find-and-Replace carry the same ids the schematic's
     * do.
     *
     * It used to key on the LABEL, which is too strong: upstream really does
     * give two different actions the same FriendlyName. `SCH_ACTIONS::drawLines`
     * and `SCH_ACTIONS::drawSymbolLines` are both "Draw Lines", and
     * `drawTextBox` and `drawSymbolTextBox` are both "Draw Text Boxes" — one
     * pair for the sheet and one for the symbol body, in the same eeschema
     * section. Two rows there is what KiCad shows.
     */
    // The same key `buildHotkeySections` folds on: the action name, or the
    // label where there is no name. A PSEUDO_ACTION — the mouse gestures — has
    // no action behind it, so its label is all it has.
    const keyOf = (e: (typeof rows)[number]): string =>
      e.name !== '' ? e.name : `label:${e.command}`;

    for (const s of sections) {
      const keys = s.entries.map(keyOf);
      expect(new Set(keys).size, `${s.name} lists an action twice`).toBe(keys.length);
    }
  });

  it('has no duplicate action name within a section', () => {
    // The store's own invariant: its map is keyed on the name, so two rows
    // sharing one would be two rows one override moves together.
    for (const s of sections) {
      const named = s.entries.map((e) => e.name).filter((n) => n !== '');
      expect(new Set(named).size, `${s.name} names an action twice`).toBe(named.length);
    }
  });
});

describe('filterHotkeys (WIDGET_HOTKEY_LIST::updateShownItems)', () => {
  it('matches the command name', () => {
    const out = filterHotkeys(sections, 'undo');
    expect(out.flatMap((s) => s.entries).some((e) => /undo/i.test(e.command))).toBe(true);
  });

  it('matches the keystroke, so searching a key finds its command', () => {
    const out = filterHotkeys(sections, 'ctrl+o');
    expect(out.flatMap((s) => s.entries).some((e) => e.keys === 'Ctrl+O')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(filterHotkeys(sections, '  UNDO ').length).toBeGreaterThan(0);
  });

  it('drops sections with no surviving row', () => {
    for (const s of filterHotkeys(sections, 'undo')) expect(s.entries.length).toBeGreaterThan(0);
  });

  it('an empty filter is not a filter', () => {
    expect(filterHotkeys(sections, '')).toHaveLength(sections.length);
    expect(filterHotkeys(sections, '   ')).toHaveLength(sections.length);
  });

  it('returns nothing for a filter nothing matches', () => {
    expect(filterHotkeys(sections, 'zzzz-no-such-command')).toEqual([]);
  });
});

describe('the schematic registry as a source', () => {
  const sections = buildHotkeySections();
  const rows = sections.flatMap((s) => s.entries);
  const names = new Set(rows.map((e) => e.name));

  it('lists every action the key handler dispatches', () => {
    // hotkeys.ts is what remapEvent resolves against, so an action missing here
    // is one a user cannot see and cannot rebind - and roughly half of it is
    // reachable from no menu and no toolbar at all, so collecting from those
    // two alone found 48 of 98.
    //
    // "Listed" means a row of its own or the Alternate cell of the row for the
    // same TOOL_ACTION, which is where a second binding belongs.
    const alts = new Set(rows.filter((e) => e.alt !== '').map((e) => e.alt));
    const missing = HOTKEYS.filter((h) => !names.has(actionName(h.id)) && !alts.has(h.keys));
    expect(missing.map((h) => h.id)).toEqual([]);
  });

  it('gives Zoom to Fit one row on Home, with no alternate', () => {
    // This used to assert an alternate of Ctrl+0, because the registry carried
    // a second entry (`zoomFitScreenMac`) for the same ACTIONS::zoomFitScreen.
    // Ctrl+0 is that action's `#if defined( __WXMAC__ )` branch and WXK_HOME
    // the `#else` (actions.cpp:719-724) — one key per platform, never a
    // DefaultHotkeyAlt — so on this build there is one binding and the
    // Alternate column stays empty.
    const fit = rows.filter((e) => e.command === 'Zoom to Fit' && e.name.startsWith('eeschema.'));
    expect(fit).toHaveLength(1);
    expect(fit[0]?.keys).toBe('Home');
    expect(fit[0]?.alt).toBe('');
  });

  it('no longer has ANY registry pair to fold, which is a coverage gap', () => {
    // Stated rather than papered over. `registryRows` folds two entries citing
    // one TOOL_ACTION into a single row with an alternate, and the only pair
    // that ever exercised it was zoomFit/zoomFitScreenMac — removed, because
    // Ctrl+0 was ACTIONS::zoomFitScreen's macOS branch rather than a
    // DefaultHotkeyAlt. The one row that still carries an alternate is the
    // "Accept Autocomplete" PSEUDO_ACTION, whose name is '' and which never
    // reaches that fold.
    //
    // So the fold is live code with no test through this door. Covering it
    // needs a seam `registryRows` does not expose today; asserting a pair
    // exists would just fail, and asserting one does not would pin the gap in
    // place. This records it instead, and fails the day a real
    // DefaultHotkeyAlt pair is added so the fold can be tested properly then.
    const foldable = rows.filter((e) => e.alt !== '' && e.name !== '');
    expect(foldable.map((e) => e.name)).toStrictEqual([]);
  });

  it('carries the bindings that exist in no menu and on no toolbar', () => {
    // The ones a user is least likely to discover unaided, which is exactly why
    // a list assembled from menus being blind to them mattered.
    for (const id of ['cursorUp', 'gridNext', 'panLeft', 'move', 'drag', 'cancel']) {
      expect(names.has(actionName(id)), `${id} is not listed`).toBe(true);
    }
  });

  it('gives a row the registry’s name, not the menu icon’s', () => {
    // Rebinding writes an override under this name and the dispatcher reads it
    // back under the same one; a row named after a picture would be a binding
    // nothing honours.
    const save = rows.find((e) => e.command === 'Save' && e.name.startsWith('eeschema.'));
    expect(save?.name).toBe('eeschema.save');
  });

  it('takes the registry’s key over a menu’s, which can be stale', () => {
    for (const h of HOTKEYS) {
      const row = rows.find((e) => e.name === actionName(h.id));
      // Skipped for the one action folded into another's Alternate cell.
      if (!row) continue;
      expect(row.defaultKeys, `${h.id} disagrees with the registry`).toBe(h.keys);
    }
  });
});

describe('an icon is not an action id', () => {
  const sch = buildHotkeySections().find((s) => s.name === 'Schematic Editor')?.entries ?? [];
  const find = (command: string): (typeof sch)[number] | undefined =>
    sch.find((e) => e.command === command);

  it('keeps two commands that share a picture apart', () => {
    // The Edit menu draws Copy and Copy as Text with icon: 'copy', and Paste
    // and Paste Special with icon: 'paste'. Keying identity on the icon merged
    // each pair, so the list showed Copy as Text on Ctrl+C and never mentioned
    // Copy - two commands collapsed into one, which is worse than the duplicate
    // rows the key was meant to prevent.
    expect(find('Copy')?.keys).toBe('Ctrl+C');
    expect(find('Copy as Text')?.keys).toBe('Ctrl+Shift+C');
    expect(find('Paste')?.keys).toBe('Ctrl+V');
    expect(find('Paste Special')?.keys).toBe('Ctrl+Shift+V');
  });

  it('still merges a menu entry with its toolbar button', () => {
    // The guard only fires where an icon is claimed by two labels; an icon used
    // once is still the action id, which is what makes one row out of two
    // sources.
    expect(find('Undo')?.keys).toBe('Ctrl+Z');
    expect(sch.filter((e) => e.command === 'Undo')).toHaveLength(1);
  });
});

describe('a toolbar title that carries its accelerator', () => {
  const rows = buildHotkeySections().flatMap((s) => s.entries);

  it('puts the key in the Hotkey column, not in the command name', () => {
    // wxWidgets appends the key to a tool's short help for display; the
    // action's name is the part in front. Listing "Draw Arcs (Ctrl+Shift+A)"
    // whole put the key in the one column a reader does not look for it in and
    // left the Hotkey column empty.
    const arcs = rows.find((e) => e.name === 'pcbnew.drawArc');
    expect(arcs?.command).toBe('Draw Arcs');
    expect(arcs?.keys).toBe('Ctrl+Shift+A');
  });

  it('leaves no command name ending in a parenthesised key', () => {
    for (const e of rows) {
      expect(e.command, `${e.command} keeps its accelerator`).not.toMatch(
        /\((Ctrl|Alt|Shift|F\d)[^)]*\)$/i,
      );
    }
  });
});

describe('hotkeyConflicts (WIDGET_HOTKEY_LIST::resolveKeyConflicts)', () => {
  const sections = buildHotkeySections();

  it('names what already holds a combo', () => {
    const hit = hotkeyConflicts(sections, 'Ctrl+Z', 'eeschema.nothing-holds-this')[0];
    expect(hit?.command).toBe('Undo');
  });

  it('ignores the row being rebound', () => {
    const undo = sections
      .flatMap((s) => s.entries)
      .find((e) => e.command === 'Undo' && e.name.startsWith('eeschema.'));
    const hits = hotkeyConflicts(sections, 'Ctrl+Z', undo?.name ?? '');
    expect(hits.every((h) => h.section !== 'Schematic Editor' || h.command !== 'Undo')).toBe(true);
  });

  it('searches the whole store, so a cross-editor collision is still reported', () => {
    // resolveKeyConflicts walks GetSections(), not the one being edited. R is
    // Rotate Clockwise in the schematic and a rotation in the 3D viewer, which
    // is the sort of pair a user rebinding one would want named.
    const hits = hotkeyConflicts(sections, 'R', 'eeschema.rotateCW');
    expect(hits.some((h) => h.section === '3D Viewer')).toBe(true);
  });

  it('never reports a gesture, which is not a keystroke to take a key from', () => {
    expect(hotkeyConflicts(sections, 'Ctrl+Click', 'x')).toEqual([]);
  });

  it('is not a conflict to bind nothing', () => {
    expect(hotkeyConflicts(sections, '', 'eeschema.undo')).toEqual([]);
  });
});

describe('the app table (hotkey_apps.ts)', () => {
  it('is what decides which editors have a registry, not a name in the code', () => {
    // The whole point of the table: an editor gains the Hotkey List, rebinding,
    // import and conflict reporting by appearing here, without hotkeys_inventory
    // or hotkey_bindings learning its name.
    expect(Object.keys(APP_REGISTRIES)).toEqual(['eeschema']);
    expect(hasRegistry('eeschema')).toBe(true);
    expect(hasRegistry('pcbnew')).toBe(false);
  });

  it('names a section for every app it can order', () => {
    for (const app of APP_ORDER) expect(SECTION_NAMES[app], app).toBeTruthy();
  });

  it('folds a registry in for whichever app declares one', () => {
    // buildHotkeySections walks APP_ORDER and folds APP_REGISTRIES[app]; the
    // schematic is the one that has rows from neither a menu nor a toolbar, so
    // it is the one whose section is bigger than what was collected.
    const sch = buildHotkeySections().find((s) => s.name === 'Schematic Editor');
    for (const id of ['cursorUp', 'panLeft', 'gridNext']) {
      expect(
        sch?.entries.some((e) => e.name === qualify('eeschema', id)),
        id,
      ).toBe(true);
    }
  });

  it('qualifies a name the same way the schematic module does', () => {
    // Two spellings of the same thing is how the key spaces diverged before.
    expect(qualify('eeschema', 'save')).toBe(actionName('save'));
  });
});
