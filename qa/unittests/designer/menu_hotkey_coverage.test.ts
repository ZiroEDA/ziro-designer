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
import { browserSafeKey } from '@ziroeda/designer/src/ui/browser_reserved.js';
import {
  addClose,
  addQuit,
  UPSTREAM_CLOSE_KEY,
  UPSTREAM_QUIT_KEY,
} from '@ziroeda/designer/src/ui/action_menu.js';
import { eventFromCombo } from '@ziroeda/designer/src/editors/schematic/hotkey_bindings.js';
import type { Menu } from '@ziroeda/designer/src/ui/menu_types.js';

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
  'editors/drawingsheet/DrawingSheetEditor.tsx',
  'editors/footprint/FootprintEditor.tsx',
  'editors/gerbview/GerberViewer.tsx',
  'editors/image/ImageConverter.tsx',
  'editors/schematic/components/SymbolLibraryBrowser.tsx',
  'editors/schematic/dialogs/dialog_assign_footprints.tsx',
  'editors/symbol/SymbolEditor.tsx',
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
const PENDING = ['editors/pcb/PcbEditor.tsx', 'editors/schematic/SchematicEditor.tsx'];

/**
 * The only modifier reads a converted frame may keep, per file, line for line.
 *
 * None of these claims a key.
 *
 * `dialog_assign_footprints.tsx` - the first is `wxListCtrl`'s selection
 * modifiers on a **mouse** event (Ctrl adds a row, Shift ranges), which is what
 * makes CvPcb's symbols pane multi-select at all (`SYMBOLS_LISTBOX` is built
 * without `wxLC_SINGLE_SEL`, symbols_listbox.cpp:37). The second is the
 * opposite of a hotkey: the listbox type-ahead declining to treat a *modified*
 * key as a character, exactly as `OnChar` only ever sees unmodified ones.
 *
 * The canvas frames - each keeps one line, and it is always the same line: a
 * canvas tool key is `MD_NONE` upstream, so the chain has to know that no
 * modifier is held before it may treat the key as the tool. It is a guard
 * *against* claiming a modified combo, which is the reverse of the thing this
 * sweep hunts. A real competing binding would name a key as well, and would
 * therefore show up as a line that is not in this list.
 */
const MODIFIER_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  'editors/schematic/dialogs/dialog_assign_footprints.tsx': [
    'if (multi && (e.ctrlKey || e.metaKey)) {',
    'if (e.ctrlKey || e.altKey || e.metaKey) return;',
  ],
  'editors/drawingsheet/DrawingSheetEditor.tsx': [
    'const plain = !e.ctrlKey && !e.metaKey && !e.altKey;',
  ],
  'editors/footprint/FootprintEditor.tsx': ['const plain = !e.ctrlKey && !e.metaKey && !e.altKey;'],
  'editors/symbol/SymbolEditor.tsx': [
    'const plain = !e.ctrlKey && !e.metaKey && !e.altKey;',
    // The library tree's Ctrl+D. `SCH_ACTIONS::duplicateSymbol`
    // (sch_actions.cpp:208-212) declares no hotkey and has no row in this
    // frame, so it is a context action with nowhere else to live.
    "if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {",
  ],
};

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
    const stray = CONVERTED.flatMap((rel) => {
      const allowed = MODIFIER_EXCEPTIONS[rel] ?? [];
      return source(rel)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /\b(ctrlKey|metaKey)\b/.test(line))
        .filter((line) => !allowed.includes(line))
        .map((line) => `${rel}: ${line}`);
    });
    expect(stray, 'a converted frame with a hand-written modifier comparison').toEqual([]);
  });

  it('and every exception is still there to be excused', () => {
    // A stale entry would quietly widen the rule above, so the exceptions are
    // asserted present rather than merely tolerated - and against the file that
    // claims them, so one frame's excuse cannot cover another's.
    const missing = Object.entries(MODIFIER_EXCEPTIONS).flatMap(([rel, lines]) => {
      const all = source(rel)
        .split('\n')
        .map((line) => line.trim());
      return lines.filter((line) => !all.includes(line)).map((line) => `${rel}: ${line}`);
    });
    expect(missing).toEqual([]);
    // …and every file that claims one is a frame the sweep actually walks.
    expect(Object.keys(MODIFIER_EXCEPTIONS).filter((rel) => !CONVERTED.includes(rel))).toEqual([]);
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

/**
 * Per canvas frame: the keys that left its chain, and the keys that stayed.
 *
 * A canvas editor is not converted by deleting its key handler - most of what
 * is in there is a tool, and a tool key has no menu row (`ACTION_MANAGER::
 * RunHotKey` calls those the *context* actions). What converts is the subset
 * that owns a row: those move to the row and must not be restated here, or the
 * two declarations start to drift, which is the whole failure this file exists
 * to catch.
 *
 * So each frame lists both halves. `moved` must be gone; `kept` must still be
 * there, because deleting a rowless tool key would be a silent regression that
 * no other test in the suite would notice.
 */
const CANVAS_KEYS: Readonly<
  Record<string, { moved: readonly [string, RegExp][]; kept: readonly [string, RegExp][] }>
> = {
  'editors/drawingsheet/DrawingSheetEditor.tsx': {
    moved: [
      ['Ctrl+S save', /=== 's'/],
      ['Ctrl+N new', /=== 'n'/],
      ['Ctrl+O open', /=== 'o'/],
      ['Ctrl+Z undo', /=== 'z'/],
      ['Ctrl+Y redo', /=== 'y'/],
      ['Ctrl+C copy', /=== 'c'/],
      ['Ctrl+X cut', /=== 'x'/],
      ['Del delete', /=== 'Delete'/],
      ['Home zoom to fit', /=== 'Home'/],
    ],
    kept: [
      // PL_ACTIONS::move, pl_actions.cpp:84 - the one hotkey pl_editor
      // declares for itself, and it has no row anywhere in the frame.
      ['M move', /e\.key === 'm' \|\| e\.key === 'M'/],
      // The cancel chain. ACTIONS::cancelInteractive is scoped to the running
      // tool, so it is a context action too.
      ['Esc cancel', /e\.key === 'Escape'/],
    ],
  },
  'editors/footprint/FootprintEditor.tsx': {
    moved: [
      ['Ctrl+S save', /e\.key\.toLowerCase\(\) === 's'/],
      ['Ctrl+Z undo', /e\.key\.toLowerCase\(\) === 'z'/],
      ['Ctrl+Y redo', /e\.key\.toLowerCase\(\) === 'y'/],
      ['F zoom to fit', /e\.key === 'f' \|\| e\.key === 'F'/],
      // The canvas Delete. `action: deleteSel` in the row is the same command
      // reached the other way; `deleteSel();` was the second declaration.
      ['Del delete', /deleteSel\(\);/],
    ],
    kept: [
      // PCB_ACTIONS::rotateCcw / rotateCw - R and Shift+R, neither with a row.
      ['R rotate', /rotateSel\(!e\.shiftKey\)/],
      ['Esc cancel', /e\.key === 'Escape'/],
      // The library tree's own Del. Disjoint from the row's, by condition.
      ['tree Del', /onDelete\(treeSel\.lib, treeSel\.name\)/],
    ],
  },
  'editors/symbol/SymbolEditor.tsx': {
    moved: [
      ['Ctrl+S save', /e\.key\.toLowerCase\(\) === 's'/],
      ['Ctrl+Z undo', /e\.key\.toLowerCase\(\) === 'z'/],
      ['Ctrl+Y redo', /e\.key\.toLowerCase\(\) === 'y'/],
      ['Del delete', /e\.key === 'Delete'/],
      ['P place pin', /k === 'p'/],
      ['T place text', /k === 't'/],
    ],
    kept: [
      // SCH_ACTIONS::rotateCCW / rotateCW and mirrorH / mirrorV - R, Shift+R,
      // X, Y. Bare Y is mirrorV and Ctrl+Y is Redo; `plain` is what keeps them
      // apart now that the second lives on its row.
      ['R rotate', /k === 'r'/],
      ['X mirror', /k === 'x'/],
      ['Y mirror', /k === 'y'/],
      // SCH_ACTIONS::properties (E) on one selected item.
      ['E properties', /k === 'e' && selection\.size === 1/],
      ['Esc cancel', /e\.key === 'Escape'/],
      // The library tree's Ctrl+D (duplicate), which has no row.
      ['tree Ctrl+D', /onDuplicate\(treeSel\.lib, treeSel\.name\)/],
    ],
  },
};

describe('a converted canvas frame keeps its tool keys and gives up the rest', () => {
  const frames = Object.keys(CANVAS_KEYS);

  it('covers every converted canvas frame', () => {
    // The frames that own a canvas are exactly the ones this table must list;
    // a new one converted without an entry would otherwise be unchecked.
    expect(frames.every((rel) => CONVERTED.includes(rel))).toBe(true);
  });

  it.each(frames)('%s', (rel) => {
    const src = source(rel);
    const { moved, kept } = CANVAS_KEYS[rel]!;
    expect(
      moved.filter(([, re]) => re.test(src)).map(([name]) => name),
      'restated beside the menu row that already declares it',
    ).toEqual([]);
    expect(
      kept.filter(([, re]) => !re.test(src)).map(([name]) => name),
      'a canvas key with no menu row was deleted rather than left alone',
    ).toEqual([]);
  });
});

/**
 * Every accelerator a frame's menu rows declare, read out of its source.
 *
 * The frames are `.tsx` and `qa`'s tsconfig compiles `.ts` only, so their menu
 * trees cannot be built here the way `buildManagerMenus` can. What *can* be
 * read is the declaration itself - `shortcut: 'Ctrl+S'` - and that is the thing
 * under test: a row's accelerator is only real if `ui/menu_hotkeys.ts` can
 * parse it and match a keystroke to it. `Ctrl++`, `Del`, `Home`, `F5` and the
 * `browserSafeKey` substitutions are each a way for that to fail quietly, and
 * before the dispatcher existed every one of them failed by default.
 */
function declaredAccelerators(rel: string): string[] {
  const out = new Set<string>();
  for (const m of source(rel).matchAll(/shortcut:\s*'([^']+)'/g)) out.add(m[1]!);
  for (const m of source(rel).matchAll(/shortcut:\s*browserSafeKey\('([^']+)'\)/g))
    out.add(browserSafeKey(m[1]!));
  return [...out].sort();
}

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

/**
 * What each converted canvas frame's *own* rows declare today.
 *
 * Asserted whole, not as a floor. #547 gave these five frames correct rows -
 * right label, right accelerator, right help string - while nothing listened,
 * and the point of writing the set down is that the two halves can no longer
 * move apart without a test noticing.
 *
 * The rows a frame does *not* write itself are not in here and must not be:
 * `ACTION_MENU::AddClose` / `AddQuit` and the Help menu are declared once in
 * `ui/action_menu.ts` and `ui/help_menu.ts`, every frame calls the function,
 * and they are pressed once below rather than once per frame. That is the same
 * reason KiCad has them in `common/` at all.
 */
const DECLARED: Readonly<Record<string, readonly string[]>> = {
  'editors/drawingsheet/DrawingSheetEditor.tsx': [
    // File. Ctrl+N / Ctrl+W / Ctrl+Q are BROWSER_RESERVED and carry the
    // substitution `browserSafeKey` gives them - which is exactly the key that
    // was printed and dead before this branch.
    'Ctrl+Alt+N',
    'Ctrl+O',
    'Ctrl+S',
    // Edit.
    'Ctrl+C',
    'Ctrl+V',
    'Ctrl+X',
    'Ctrl+Y',
    'Ctrl+Z',
    'Del',
    // View.
    'Home',
  ],
  'editors/footprint/FootprintEditor.tsx': [
    'Ctrl+Alt+N',
    'Ctrl+S',
    'Ctrl+Y',
    'Ctrl+Z',
    'Del',
    // View > Zoom to Fit. `ACTIONS::zoomFitScreen` is Home off macOS and F is
    // `PCB_ACTIONS::flip`, so this row's key is wrong upstream - but it is the
    // key the frame has always answered, and correcting the row is #547's job,
    // not this one's. Recorded so the divergence is not silent.
    'F',
  ],
  'editors/symbol/SymbolEditor.tsx': [
    'Ctrl+Alt+N',
    'Ctrl+S',
    'Ctrl+Y',
    'Ctrl+Z',
    'Del',
    // Place > Pin / Text. SCH_ACTIONS::placeSymbolPin is P and placeSymbolText
    // is T, both AS_GLOBAL with a row - so both belong on the row.
    'P',
    'T',
  ],
};

/** A stand-in event for `eventFromCombo` to build a synthetic keystroke from. */
const base = {
  key: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  preventDefault: () => {},
  stopPropagation: () => {},
  target: null,
};

describe('every accelerator a converted canvas frame prints is one the dispatcher can press', () => {
  const frames = Object.keys(DECLARED);

  it.each(frames)('%s declares the set it is supposed to', (rel) => {
    expect(declaredAccelerators(rel)).toEqual([...DECLARED[rel]!].sort());
  });

  it.each(frames)('%s: each one reaches its own row', (rel) => {
    for (const combo of DECLARED[rel]!) {
      const calls: string[] = [];
      // One row per accelerator, so "the right row ran" is checkable at all.
      // A frame's real tree nests these across File/Edit/View; `invocable`
      // walks either shape, and menu order is what breaks a tie.
      const menus: Menu[] = [
        {
          label: 'Test',
          items: DECLARED[rel]!.map((c) => ({
            label: c,
            shortcut: c,
            action: () => calls.push(c),
          })),
        },
      ];
      const e = eventFromCombo(combo, base);
      expect(dispatchMenuHotkey(menus, e), `${combo} matched nothing`).toBe(true);
      expect(calls, `${combo} reached the wrong row`).toEqual([combo]);
    }
  });
});

describe('the shared rows every frame ends its File and Help menus with', () => {
  /**
   * `AddClose` and `AddQuit` are one declaration in `common/tool/action_menu
   * .cpp:220-262`, and one here. Pressing them once is pressing them for every
   * frame that calls the function - which, since #547, is all eleven.
   *
   * Both keys are BROWSER_RESERVED, so what the row carries is the
   * `BROWSER_REBINDS` substitution. This is the assertion the reported bug
   * needed: the Drawing Sheet Editor printed Ctrl+Alt+Q and nothing listened.
   */
  it.each([
    ['Close', addClose, browserSafeKey(UPSTREAM_CLOSE_KEY)],
    ['Quit', addQuit, browserSafeKey(UPSTREAM_QUIT_KEY)],
  ])('%s answers %s', (label, make, combo) => {
    const calls: string[] = [];
    const menus: Menu[] = [
      { label: 'File', items: [make('Drawing Sheet Editor', () => calls.push(label))] },
    ];
    expect(menus[0]!.items[0]!.shortcut).toBe(combo);
    expect(dispatchMenuHotkey(menus, eventFromCombo(combo, base))).toBe(true);
    expect(calls).toEqual([label]);
    // The raw upstream key must NOT also fire: it is the browser's, and a row
    // that answered both would be advertising the tab-destroying one.
    const raw = label === 'Close' ? UPSTREAM_CLOSE_KEY : UPSTREAM_QUIT_KEY;
    expect(dispatchMenuHotkey(menus, eventFromCombo(raw, base))).toBe(false);
  });

  it('and every converted canvas frame calls them rather than writing its own', () => {
    // Which of the three a frame calls is upstream's choice, not ours:
    // menubar_footprint_editor.cpp:92 is `AddClose`, pcbnew and eeschema call
    // `AddQuitOrClose`. What matters is that none of them writes the row.
    const missing = Object.keys(CANVAS_KEYS).filter(
      (rel) => !/\badd(Close|Quit|QuitOrClose)\(/.test(source(rel)),
    );
    expect(missing, 'a frame hand-rolling the File menu tail').toEqual([]);
  });
});
