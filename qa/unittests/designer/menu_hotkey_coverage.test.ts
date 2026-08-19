// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A frame does not write its own key listener for a command that has a menu row.
 *
 * That rule is the whole point of `ui/menu_hotkeys.ts`, and it is exactly the
 * kind of rule that decays quietly: nothing breaks when somebody adds one more
 * `if ( (e.ctrlKey || e.metaKey) && e.key === 'k' )` next to a menu that
 * already says Ctrl+K. It only breaks later, when the two disagree - which is
 * how Ctrl+Q came to be printed nowhere and do nothing in the Image Converter,
 * how Ctrl+G, Ctrl+Y and Shift+Ctrl+S sat in the project manager's menu bound
 * to nothing, and how CVPCB's Del cleared an assignment its own greyed-out row
 * said could not be cleared.
 *
 * So this walks the tree rather than trusting a convention.
 * `modal_escape_coverage.test.ts` is the precedent, and the reason the files
 * are read as text is the same: `qa`'s tsconfig cannot compile `.tsx`.
 *
 * The second half does what the first cannot - `home/menubar.ts` is a plain
 * `.ts` data module, so the project manager's whole accelerator set can be
 * built and actually pressed here, which is the only proof that a row's key
 * reaches that row's action.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { dispatchMenuHotkey, type HotkeyEvent } from '@ziroeda/designer/src/ui/menu_hotkeys.js';
import { buildManagerMenus } from '@ziroeda/designer/src/home/menubar.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

/**
 * Frames whose menu accelerators are dispatched by the shared module.
 *
 * Each one had a hand-written listener before, and each one's listener is
 * gone: the entries below are checked for the dispatcher and against any
 * remaining modifier comparison.
 */
const CONVERTED = [
  'editors/calculator/CalculatorTools.tsx',
  'editors/gerbview/GerberViewer.tsx',
  'editors/image/ImageConverter.tsx',
  'editors/schematic/components/SymbolLibraryBrowser.tsx',
  'editors/schematic/dialogs/dialog_assign_footprints.tsx',
  'home/HomePage.tsx',
];

/**
 * Frames not converted yet, each of which owns a canvas and a several-hundred
 * branch tool-key chain where a hotkey means "the tool", carries its own
 * conditions (is anything selected, is a tool live, is a drag in progress) and
 * mostly has no menu row at all. Moving those onto the menus is a change per
 * editor, not a sweep, and `editors/schematic/hotkey_bindings.ts` already
 * translates events for them so a user rebinding works.
 *
 * The list is asserted whole rather than as a floor: a *new* frame cannot be
 * added to the app without landing in one list or the other.
 */
const PENDING = [
  'editors/drawingsheet/DrawingSheetEditor.tsx',
  'editors/footprint/FootprintEditor.tsx',
  'editors/pcb/PcbEditor.tsx',
  'editors/schematic/SchematicEditor.tsx',
  'editors/symbol/SymbolEditor.tsx',
];

/**
 * The only modifier reads a converted frame may keep, listed line for line.
 *
 * Neither of these claims a key. The first is `wxListCtrl`'s selection
 * modifiers on a **mouse** event - Ctrl adds a row, Shift ranges - which is
 * what makes CvPcb's symbols pane multi-select at all (`SYMBOLS_LISTBOX` is
 * built without `wxLC_SINGLE_SEL`, symbols_listbox.cpp:37). The second is the
 * opposite of a hotkey: the listbox type-ahead declining to treat a *modified*
 * key as a character, exactly as `OnChar` only ever sees unmodified ones.
 *
 * Both live inside the pane component, not beside a menu row, and neither
 * mentions a key. A real competing binding would need `e.key`, and would show
 * up as a line that is not in this list.
 */
const MODIFIER_EXCEPTIONS = [
  'if (multi && (e.ctrlKey || e.metaKey)) {',
  'if (e.ctrlKey || e.altKey || e.metaKey) return;',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({
  rel: relative(SRC, path).split('\\').join('/'),
  src: readFileSync(path, 'utf8'),
}));

const source = (rel: string): string => {
  const f = FILES.find((x) => x.rel === rel);
  expect(f, `${rel} must exist`).toBeDefined();
  return f!.src;
};

/** Every frame that puts a menu bar on screen. */
const menuBarFiles = FILES.filter((f) => /<MenuBar\b/.test(f.src))
  .map((f) => f.rel)
  .sort();

describe('every frame with a menu bar is accounted for', () => {
  it('finds the frames in the first place', () => {
    // A guard on the guard: a renamed component would otherwise make this
    // whole file pass by checking nothing.
    expect(menuBarFiles.length).toBeGreaterThanOrEqual(11);
  });

  it('is either on the dispatcher or explicitly still pending', () => {
    expect(menuBarFiles).toEqual([...CONVERTED, ...PENDING].sort());
  });
});

describe('a converted frame has no listener of its own', () => {
  it('asks the shared dispatcher', () => {
    const missing = CONVERTED.filter(
      (rel) => !/\b(useMenuHotkeys|dispatchMenuHotkey)\(/.test(source(rel)),
    );
    expect(missing, 'these render a menu bar and never dispatch its accelerators').toEqual([]);
  });

  it('imports what it calls', () => {
    const unimported = FILES.filter((f) => /\buseMenuHotkeys\(/.test(f.src))
      .filter((f) => !/import \{ useMenuHotkeys \} from/.test(f.src))
      .map((f) => f.rel);
    expect(unimported).toEqual([]);
  });

  it('no longer compares modifier keys by hand', () => {
    // `e.ctrlKey` / `e.metaKey` in one of these files means somebody has
    // written a second, competing declaration of a key the menu already owns.
    // Gerber Viewer keeps four *unmodified* canvas keys (m, Esc, +, -), which
    // is why the test looks for the modifier and not for `keydown`.
    const stray = CONVERTED.flatMap((rel) =>
      source(rel)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /\b(ctrlKey|metaKey)\b/.test(line))
        .filter((line) => !MODIFIER_EXCEPTIONS.includes(line))
        .map((line) => `${rel}: ${line}`),
    );
    expect(stray, 'a converted frame with a hand-written modifier comparison').toEqual([]);
  });

  it('and every exception is still there to be excused', () => {
    // A stale entry would quietly widen the rule above, so the exceptions are
    // asserted present rather than merely tolerated.
    const all = CONVERTED.flatMap((rel) => source(rel).split('\n')).map((line) => line.trim());
    expect(MODIFIER_EXCEPTIONS.filter((line) => !all.includes(line))).toEqual([]);
  });

  it('keeps only the keys that have no menu row', () => {
    // What is left in the Gerber Viewer is the canvas: measure, cancel, zoom
    // in, zoom out - GERBVIEW_ACTIONS / ACTIONS its View menu never lists.
    const gerb = source('editors/gerbview/GerberViewer.tsx');
    expect(gerb).toMatch(/setActiveTool\('measure'\)/);
    // …and neither of the two that do have a row is re-stated beside it.
    expect(gerb).not.toMatch(/e\.key === 'Home'/);
    // CVPCB keeps Enter, which is CVPCB_ACTIONS::associate and has no row.
    const cvpcb = source('editors/schematic/dialogs/dialog_assign_footprints.tsx');
    expect(cvpcb).toMatch(/e\.key === 'Enter'/);
    expect(cvpcb).not.toMatch(/e\.key === 'Delete'/);
  });
});

/** A keyboard event with nothing held down, overridden per case. */
const ev = (key: string, mods: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

/**
 * `buildManagerMenus` with every handler recording its own name, so pressing a
 * key can be checked against the row it was supposed to reach.
 */
function managerFixture(hasProject: boolean) {
  const calls: string[] = [];
  const spy = (name: string) => (): void => {
    calls.push(name);
  };
  const menus = buildManagerMenus({
    newProject: spy('newProject'),
    openProject: spy('openProject'),
    selectProjectFiles: spy('selectProjectFiles'),
    openRecent: spy('openRecent'),
    clearRecent: spy('clearRecent'),
    language: 'Default',
    setLanguage: spy('setLanguage'),
    closeProject: spy('closeProject'),
    saveAs: spy('saveAs'),
    archiveProject: spy('archiveProject'),
    unarchiveProject: spy('unarchiveProject'),
    refresh: spy('refresh'),
    toggleLocalHistory: spy('toggleLocalHistory'),
    localHistoryShown: false,
    openTextViewer: spy('openTextViewer'),
    editSchematic: spy('editSchematic'),
    editSymbols: spy('editSymbols'),
    editPcb: spy('editPcb'),
    editFootprints: spy('editFootprints'),
    openImageConverter: spy('openImageConverter'),
    openGerberViewer: spy('openGerberViewer'),
    openCalculator: spy('openCalculator'),
    openDrawingSheetEditor: spy('openDrawingSheetEditor'),
    openPreferences: spy('openPreferences'),
    showAbout: spy('showAbout'),
    showHotkeys: spy('showHotkeys'),
    openDemo: spy('openDemo'),
    hasProject,
    hasTextFileSelected: false,
    recent: [],
    demos: [],
  });
  return { menus, calls };
}

describe('the project manager, pressed for real', () => {
  /** Every accelerator kicad/menubar.cpp gives the manager, and its handler. */
  const BOUND: [string, HotkeyEvent, string][] = [
    // KICAD_MANAGER_ACTIONS::newProject is MD_CTRL + 'N' upstream; a browser
    // will not give Ctrl+N up, so BROWSER_REBINDS moves it. See browser_hotkeys.
    ['Ctrl+Alt+N', ev('n', { ctrlKey: true, altKey: true }), 'newProject'],
    ['Ctrl+O', ev('o', { ctrlKey: true }), 'openProject'],
    ['Shift+Ctrl+S', ev('s', { ctrlKey: true, shiftKey: true }), 'saveAs'],
    ['F5', ev('F5'), 'refresh'],
    ['Ctrl+E', ev('e', { ctrlKey: true }), 'editSchematic'],
    ['Ctrl+L', ev('l', { ctrlKey: true }), 'editSymbols'],
    ['Ctrl+P', ev('p', { ctrlKey: true }), 'editPcb'],
    ['Ctrl+F', ev('f', { ctrlKey: true }), 'editFootprints'],
    ['Ctrl+G', ev('g', { ctrlKey: true }), 'openGerberViewer'],
    ['Ctrl+B', ev('b', { ctrlKey: true }), 'openImageConverter'],
    ['Ctrl+Y', ev('y', { ctrlKey: true }), 'openDrawingSheetEditor'],
    ['Ctrl+,', ev(',', { ctrlKey: true }), 'openPreferences'],
    ['Ctrl+F1', ev('F1', { ctrlKey: true }), 'showHotkeys'],
  ];

  it.each(BOUND)('%s runs %s', (_combo, event, handler) => {
    const { menus, calls } = managerFixture(true);
    expect(dispatchMenuHotkey(menus, event)).toBe(true);
    expect(calls).toEqual([handler]);
  });

  it.each(BOUND)('%s does not run %s with Shift added', (combo, event, handler) => {
    if (event.shiftKey) return; // already the shifted binding
    // Punctuation is exempt on purpose and the exemption is not a hole: a
    // keyboard cannot deliver `{ key: ',', shiftKey: true }` at all, because
    // Shift+comma *is* '<'. For those keys the character already carries the
    // modifier, which is the same reason Ctrl++ has to work. See
    // menu_hotkeys.test.ts, "does not count Shift twice for a punctuation key".
    if (!/^([a-z0-9]|F([1-9]|1[0-2]))$/i.test(event.key)) return;
    const { menus, calls } = managerFixture(true);
    dispatchMenuHotkey(menus, { ...event, shiftKey: true });
    expect(calls, `${combo} fired on Shift+${combo}`).not.toContain(handler);
  });

  it('runs the same handler whichever case the key arrives in', () => {
    // A literal `e.key === 'e'` loses the binding the moment Caps Lock is on.
    for (const key of ['e', 'E']) {
      const { menus, calls } = managerFixture(true);
      expect(dispatchMenuHotkey(menus, ev(key, { ctrlKey: true }))).toBe(true);
      expect(calls).toEqual(['editSchematic']);
    }
  });

  it('honours the rows the menu greys out when no project is picked', () => {
    // File > Save As… and Tools > PCB Editor are `disabled: !h.hasProject`.
    // The listener this replaced re-stated that condition by hand.
    const { menus, calls } = managerFixture(false);
    expect(dispatchMenuHotkey(menus, ev('s', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(dispatchMenuHotkey(menus, ev('p', { ctrlKey: true }))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('leaves the permanently-greyed clipboard rows to the browser', () => {
    // Edit > Cut/Copy/Paste are disabled upstream too. Swallowing Ctrl+C here
    // would break copying a project name out of the tree.
    const { menus, calls } = managerFixture(true);
    for (const k of ['x', 'c', 'v'])
      expect(dispatchMenuHotkey(menus, ev(k, { ctrlKey: true }))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does nothing at all while the user is typing', () => {
    const { menus, calls } = managerFixture(true);
    const typing = { tagName: 'INPUT', type: 'text' };
    for (const [, event] of BOUND) dispatchMenuHotkey(menus, event, { target: typing });
    expect(calls).toEqual([]);
  });
});
