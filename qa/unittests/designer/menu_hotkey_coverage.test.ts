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
import { buildMenus } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import { symbolEditorMenus } from '@ziroeda/designer/src/editors/symbol/menubar.js';
import { footprintEditorMenus } from '@ziroeda/designer/src/editors/footprint/menubar.js';
import { browserSafeKey } from '@ziroeda/designer/src/ui/browser_reserved.js';
import {
  addClose,
  addQuit,
  UPSTREAM_CLOSE_KEY,
  UPSTREAM_QUIT_KEY,
} from '@ziroeda/designer/src/ui/action_menu.js';
import { eventFromCombo } from '@ziroeda/designer/src/editors/schematic/hotkey_bindings.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

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
  'editors/pcb/PcbEditor.tsx',
  'editors/schematic/SchematicEditor.tsx',
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
const PENDING: readonly string[] = [];

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
    // ACTIONS::toggleUnits (Ctrl+U, actions.cpp:1149-1156). pl_editor puts the
    // units on the LEFT TOOLBAR and gives them no menu row, so there is no
    // accelerator for the dispatcher to read and this is the command's only
    // declaration - a context action, like the symbol editor's Ctrl+D below.
    "if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u') {",
  ],
  'editors/footprint/FootprintEditor.tsx': ['const plain = !e.ctrlKey && !e.metaKey && !e.altKey;'],
  // ACTIONS::zoomIn / zoomOut are F1 / F2 off macOS (actions.cpp:747-764) and
  // AS_GLOBAL, so they belong to the canvas rather than to a menu row: GerbView's
  // View > Zoom In / Zoom Out are zoomInCenter / zoomOutCenter, which declare no
  // hotkey at all. Same `plain` predicate as the two frames above.
  'editors/gerbview/GerberViewer.tsx': ['const plain = !e.ctrlKey && !e.metaKey && !e.altKey;'],
  'editors/pcb/PcbEditor.tsx': [
    // The chain's own "no Ctrl/Cmd held" predicate - the same guard as the
    // other frames' `plain`, spelled the way this file already spelled it.
    'const mod = e.ctrlKey || e.metaKey;',
    // Not keys at all: the snap modifiers, which upstream arrive as their own
    // TOOL_EVENT so that holding Ctrl changes snapping immediately. One is the
    // pointer's, one the keyboard's.
    'ctrlDownRef.current = e.ctrlKey || e.metaKey;',
    'const ctrl = e.ctrlKey || e.metaKey;',
    // The 3D viewer overlay declining to treat a modified key as one of its
    // view keys - upstream the viewer is a separate top-level window, so
    // pcbnew's hotkeys cannot reach the board while it has focus.
    'if (e.ctrlKey || e.metaKey || e.altKey) return;',
    // Ctrl+Enter inside the place-text dialog's own textarea, which is that
    // dialog's OK and reaches nothing outside it.
    "} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {",
  ],
  'editors/symbol/SymbolEditor.tsx': [
    'const plain = !e.ctrlKey && !e.metaKey && !e.altKey;',
    // The library tree's Ctrl+D. `SCH_ACTIONS::duplicateSymbol`
    // (sch_actions.cpp:208-212) declares no hotkey and has no row in this
    // frame, so it is a context action with nowhere else to live.
    "if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {",
  ],
  /**
   * The schematic keeps the most of any frame, and it is the one frame where
   * that is *not* a smell: it owns `editors/schematic/hotkeys.ts`, a registry
   * of `RegistryAction`s which is this app's stand-in for `ACTION_MANAGER`'s
   * table. A combo declared there and carried by no menu row is a command with
   * a real declaration and no row - exactly what upstream calls a context
   * action - so it belongs in the chain, and the entry names which registry
   * action each line is.
   */
  'editors/schematic/SchematicEditor.tsx': [
    // Under the project manager eeschema's File menu starts at Save, so Open
    // has no row here (menubar.cpp).
    "if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {",
    // `redo`'s registry note: "Ctrl+Y also redoes".
    "} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {",
    // SCH_ACTIONS::duplicate - no row in eeschema's Edit menu.
    "} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {",
    // ACTIONS::zoomFitScreen, WXK_HOME off macOS. The Ctrl+0 that used to be
    // excused here was the `#if defined( __WXMAC__ )` branch, bound alongside
    // it; Home is now the only spelling, and the View rows carry no
    // accelerator at all for zoomIn / zoomOut because those are zoomInCenter /
    // zoomOutCenter, which declare no hotkey.
    "} else if (e.key === 'Home' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {",
    // ACTIONS::toggleUnits and ACTIONS::cycleArcEditMode, neither with a row.
    "} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u' && !e.shiftKey) {",
    "} else if ((e.ctrlKey || e.metaKey) && e.key === ' ') {",
    // The two F1 arms. F1 is ACTIONS::zoomIn alone now -- repeatDrawItem is Ins
    // off macOS and used to answer to F1 as well, which is what made the key
    // ambiguous. The modifier reads are what keep Ctrl+F1, ACTIONS::listHotKeys,
    // out of the zoom arm.
    '!e.ctrlKey &&',
    '!e.metaKey &&',
    "} else if (e.key === 'F1' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {",
    "} else if (e.key === 'F1' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {",
    "} else if (e.key === 'F2' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {",
    // SCH_ACTIONS::editWithLibEdit - no row.
    "} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && !e.shiftKey) {",
    // SCH_ACTIONS::nextNetItem / previousNetItem - no row.
    "} else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {",
    // ACTIONS::toggleGridOverrides - no row. Ctrl+G, which does have one, is
    // gone; this arm is what still tells the two apart.
    "} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {",
    // SCH_ACTIONS::selectConnection - no row.
    "} else if ((e.ctrlKey || e.metaKey) && e.key === '4') {",
    // The bare-key block's own guard, the schematic's spelling of `plain`.
    '} else if (!e.ctrlKey && !e.metaKey && !e.altKey) {',
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

/**
 * Where a frame's menu tree is actually declared.
 *
 * Usually the frame itself. The schematic is the one that has already been
 * pulled apart the way the rest should be - `editors/schematic/menubar.ts` is a
 * plain data module, which is why it is the only editor the Hotkey List can
 * collect from (`ui/hotkeys_inventory.ts`) and the only one whose whole
 * accelerator set can be pressed for real down this file.
 */
const MENU_MODULE: Readonly<Record<string, string>> = {
  'editors/schematic/SchematicEditor.tsx': 'editors/schematic/menubar.ts',
  'editors/symbol/SymbolEditor.tsx': 'editors/symbol/menubar.ts',
  'editors/footprint/FootprintEditor.tsx': 'editors/footprint/menubar.ts',
};

/** The frame's source, or the module its menus live in when they were split out. */
const menuSource = (rel: string): string => {
  const moved = MENU_MODULE[rel];
  return moved ? readFileSync(join(SRC, moved), 'utf8') : source(rel);
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

  it('never reads defaultPrevented without asking whose it was', () => {
    // The bug that took every hotkey in the app down (c4a00590): our own
    // browser suppressor runs in the capture phase and `preventDefault()`s
    // every combo the app claims, purely to stop the browser. A frame that
    // reads `defaultPrevented` as "somebody handled this" therefore stands
    // down on exactly the set of keys it exists to serve - and it fails
    // *silently*, which is why it needs a test rather than a review.
    //
    // The four canvas frames converted here all open their chain with that
    // read, for a real reason: the library tree and the 3D viewer overlay both
    // claim keys by cancelling them. So the invariant is per-line - a
    // `defaultPrevented` that does not also consult `wasBrowserSuppressed` is
    // the bug, whichever frame it is in.
    const bare = CONVERTED.flatMap((rel) =>
      source(rel)
        .split('\n')
        .map((line) => line.trim())
        // Code, not the comment above it that explains why the code is there.
        .filter((line) => /\bdefaultPrevented\b/.test(line) && !line.startsWith('//'))
        .filter((line) => !/wasBrowserSuppressed/.test(line))
        .map((line) => `${rel}: ${line}`),
    );
    expect(bare, 'reads our own browser suppression as another handler').toEqual([]);
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
 *
 * `guards` is the third half, and it is the precedence rule written down. A
 * context branch that sits one modifier - or one condition - away from a row's
 * accelerator has to decline the row's case explicitly, or it swallows it
 * before the fall-through is ever reached, and nothing else here would see
 * that: the key would simply stop working. Each entry is the exact condition
 * that keeps one command out of the other's hands.
 */
const CANVAS_KEYS: Readonly<
  Record<
    string,
    {
      moved: readonly [string, RegExp][];
      kept: readonly [string, RegExp][];
      guards?: readonly [string, RegExp][];
    }
  >
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
    guards: [
      // Edit > Delete owns Del whenever the canvas has a selection, so the
      // tree's Del must stand down while it does. Without this the one
      // keystroke deleted the selected item AND the footprint from the
      // library, which is what it did before this branch.
      ['tree Del declines to the canvas', /if \(canvasSelection\) return;/],
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
  'editors/schematic/SchematicEditor.tsx': {
    // Matched on each arm's own comment where it had one: the comment names the
    // upstream action, so "the arm is gone" and "that command no longer has a
    // second declaration here" are the same assertion.
    moved: [
      ['Ctrl+, preferences', /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === ','/],
      ['Ctrl+S save', /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === 's'/],
      ['Ctrl+P print', /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === 'p'/],
      ['Ctrl+Z undo', /e\.key\.toLowerCase\(\) === 'z'/],
      ['Ctrl+Shift+C copy as text', /ACTIONS::copyAsText \(Ctrl\+Shift\+C\)/],
      ['Ctrl+Shift+V paste special', /ACTIONS::pasteSpecial \(Ctrl\+Shift\+V\)/],
      ['Ctrl+L global label', /placeGlobalLabel default hotkey \(Ctrl\+L\)/],
      ['Ctrl+Shift+F import graphics', /importGraphics \(Ctrl\+Shift\+F\)/],
      ['Ctrl+Alt+F find and replace', /findAndReplace \(Ctrl\+Alt\+F\)/],
      ['Ctrl+F find', /ACTIONS::find \(Ctrl\+F\)/],
      ['Ctrl+A select all', /selectAll \/ unselectAll/],
      ['Ctrl+Home zoom to objects', /zoomFitObjects \(Ctrl\+Home\)/],
      ['Ctrl+R refresh', /zoomRedraw \(Ctrl\+R\)/],
      ['Ctrl+F5 zoom tool', /zoomTool \(Ctrl\+F5\)/],
      ['Ctrl+H hierarchy', /showHierarchy \(Ctrl\+H\)/],
      ['Ctrl+G search', /showSearch \(Ctrl\+G\)/],
      ['Alt+Left navigate back', /navigateBack \(Alt\+Left\)/],
      ['PgUp previous sheet', /navigatePrevious \(PgUp\)/],
      ['F8 update PCB', /updatePcbFromSchematic's default hotkey/],
      ['Del delete', /e\.key === 'Delete' \|\| e\.key === 'Backspace'/],
      // The twelve Place-tool letters, which every one of them also a row.
      ['A P W B Z Q J L H S T I', /TOOL_HOTKEYS\[e\.key\.toLowerCase\(\)\]/],
    ],
    kept: [
      // Backspace-as-delete used to sit here. It is gone, not moved: WXK_BACK is
      // `ACTIONS::doDelete`'s `#if defined( __WXMAC__ )` branch and WXK_DELETE
      // the `#else` (actions.cpp:401-406), so on this platform Del is the whole
      // answer. Del itself is in `moved`, declared by Edit > Delete.
      ['Alt+Backspace leave sheet', /leaveSheet \(Alt\+Backspace\)/],
      // ACTIONS::zoomFitScreen is WXK_HOME off macOS (actions.cpp:719-724).
      // `hotkeys.ts` printed Home all along while nothing bound it and Ctrl+0 -
      // the macOS branch - did the work; now Home is bound and Ctrl+0 is not.
      ['Home zoom to fit', /e\.key === 'Home' && !e\.ctrlKey/],
      ['Ctrl+Shift+G grid overrides', /toggleGridOverrides \(Ctrl\+Shift\+G\)/],
      ['Alt+3 select node', /selectNode \(Alt\+3\)/],
      ['Alt+S swap', /swap \(Alt\+S\)/],
      ['Ctrl+4 select connection', /selectConnection \(Ctrl\+4\)/],
      // Ins off macOS (sch_actions.cpp:757-759); F1 stays bound as the macOS
      // spelling. Still a canvas key either way — it has no menu row.
      //
      // Matched on the CONDITION, not on the comment beside it. The comment
      // form alone is what this row used to be, and a mutation sweep walked
      // straight through it: deleting the `'Insert'` arm of the handler left
      // the comment untouched, so the rule still matched and Ins silently
      // stopped repeating. A rule that can only see a comment cannot see the
      // binding.
      ['Ins repeat draw item', /e\.key === 'Insert' &&/],
      ['Ctrl+U toggle units', /toggleUnits \(Ctrl\+U\)/],
      ['Ctrl+Space arc edit mode', /cycleArcEditMode \(Ctrl\+Space\)/],
      ['Ctrl+E edit with lib edit', /editWithLibEdit \(Ctrl\+E\)/],
      ['Tab next net item', /nextNetItem \/ previousNetItem/],
      ['R X Y transform', /rotateCCW\/rotateCW\/mirrorH\/mirrorV/],
      ['M G move and drag', /SCH_ACTIONS::move \/ drag/],
      ['` ~ highlight', /highlightNet \/ clearHighlight/],
      ['Space reset local coords', /resetLocalCoords/],
      ['Shift+Space line mode', /lineModeNext/],
      ['N grid next', /gridNext\/gridPrev/],
      ['C unfold bus', /unfoldBus/],
      ['U V F edit field', /FIELD_KEYS/],
      ['D show datasheet', /showDatasheet/],
      ['O autoplace fields', /autoplaceFields/],
      ['E properties', /openProperties\(\[\.\.\.selection\]\[0\]!\)/],
      ['Esc cancel', /e\.key === 'Escape'/],
    ],
  },
  'editors/pcb/PcbEditor.tsx': {
    moved: [
      // Anchored on `if (mod` rather than `mod`, because `!mod && (e.key ===
      // 'd'` - the drag45 grab, which stays - contains the shorter pattern.
      ['Ctrl+, preferences', /if \(mod && e\.key === ','/],
      ['Ctrl+Z undo', /if \(mod && \(e\.key === 'z'/],
      ['Ctrl+Y redo', /if \(mod && \(e\.key === 'y'/],
      ['Ctrl+F find', /if \(mod && \(e\.key === 'f'/],
      ['Ctrl+D duplicate', /if \(mod && \(e\.key === 'd'/],
      ['F8 update from schematic', /e\.key === 'F8'/],
      ['Del delete', /e\.key === 'Delete'/],
      // …and on `mod && e.shiftKey` for the same reason: the bare-M grab that
      // stays is now spelled `!mod && !e.shiftKey && (e.key === 'm'`.
      ['Shift+M move exactly', /mod && e\.shiftKey && \(e\.key === 'm'/],
      ['Shift+P position relative', /mod && e\.shiftKey && \(e\.key === 'p'/],
      ['E properties', /openTrackViaPropertiesRef/],
      ['F flip', /flipSelectionRef/],
      ['Ctrl+0 zoom to fit', /\(mod && e\.key === '0'\)/],
    ],
    kept: [
      // ACTIONS::highContrastModeCycle, no row.
      ['H contrast cycle', /e\.key === 'h' \|\| e\.key === 'H'/],
      // ROUTER_TOOL's place-a-via-and-switch-layer, and the clearest context
      // action in the app: it claims V only while a route is in progress.
      ['V while routing', /e\.key === 'v' \|\| e\.key === 'V'\) && routeRef\.current/],
      ['R rotate', /rotateSel\(!e\.shiftKey\)/],
      ['M grab move', /grabStartRef\.current\('move'\)/],
      ['G grab drag', /grabStartRef\.current\('drag'\)/],
      ['D grab drag45', /grabStartRef\.current\('drag45'\)/],
      // PCB_ACTIONS::zoneFillAll, no row.
      ['B fill zones', /fillAllZonesRef\.current\(\)/],
      // ACTIONS::zoomFitScreen is Home off macOS; the row prints the macOS
      // Ctrl+0, so Home has no row and stays.
      ['Home zoom to fit', /!mod && e\.key === 'Home'/],
      ['~ clear highlight', /e\.key === '~'/],
      ['` highlight net', /e\.key === '`'/],
      ['Esc cancel', /e\.key === 'Escape'/],
    ],
    guards: [
      // `e.key` is already 'M' when Shift is held, so the bare-M grab has to
      // exclude Shift or Edit > Move Exactly's accelerator never reaches the
      // fall-through - it is swallowed by a branch that then returns.
      ['M grab leaves Shift+M to its row', /!mod && !e\.shiftKey && \(e\.key === 'm'/],
      // …and the zoom-to-fit pair: Home stays here, Ctrl+0 is the row's, so
      // the branch must not answer both the way it used to.
      ['Home leaves Ctrl+0 to its row', /if \(!mod && e\.key === 'Home'\)/],
    ],
  },
};

/**
 * The frame's source with its menu-action dispatcher cut out.
 *
 * A row's action used to sit inline in the row - `action: deleteSel`. Now that
 * three frames build their tree in a `.ts` module the frame reaches those
 * actions by id instead, so the body that used to be the row's `action:` now
 * lives in an `onMenuAction` switch. That switch IS the row's declaration
 * reached the other way round, not a second one - counting it as a restatement
 * would mean no frame could ever move its menus out.
 *
 * What a `moved` entry asks is whether the frame's own KEY CHAIN still claims a
 * key the row already declares. The dispatcher is not the key chain, so it is
 * removed before the question is put; everything else stays, because a `moved`
 * regex like `openTrackViaPropertiesRef` names a ref declared well outside it.
 */
function frameOutsideMenuActions(rel: string): string {
  const src = source(rel);
  const start = src.indexOf('  const onMenuAction = useCallback(');
  if (start < 0) return src;
  const end = src.indexOf('\n  );\n', start);
  expect(end, `${rel}: onMenuAction has no end`).toBeGreaterThan(start);
  return src.slice(0, start) + src.slice(end);
}

describe('a converted canvas frame keeps its tool keys and gives up the rest', () => {
  const frames = Object.keys(CANVAS_KEYS);

  it('covers every converted canvas frame', () => {
    // The frames that own a canvas are exactly the ones this table must list;
    // a new one converted without an entry would otherwise be unchecked.
    expect(frames.every((rel) => CONVERTED.includes(rel))).toBe(true);
  });

  it.each(frames)('%s', (rel) => {
    const src = source(rel);
    const outside = frameOutsideMenuActions(rel);
    // A cut that swallowed the key chain would make every `moved` entry below
    // pass for the wrong reason, which is the one way this check cannot fail.
    expect(outside, `${rel}: the key chain was cut away with the dispatcher`).toContain(
      'dispatchMenuHotkey',
    );
    const { moved, kept } = CANVAS_KEYS[rel]!;
    expect(
      moved.filter(([, re]) => re.test(outside)).map(([name]) => name),
      'restated beside the menu row that already declares it',
    ).toEqual([]);
    expect(
      kept.filter(([, re]) => !re.test(src)).map(([name]) => name),
      'a canvas key with no menu row was deleted rather than left alone',
    ).toEqual([]);
    expect(
      (CANVAS_KEYS[rel]!.guards ?? []).filter(([, re]) => !re.test(src)).map(([name]) => name),
      'a context branch that would swallow a menu row it sits next to',
    ).toEqual([]);
  });
});

const noop = (): void => {};

/**
 * The frames whose menu tree is a data module, and so can simply be BUILT here.
 *
 * Every handler is a no-op and every condition is true, because what is being
 * collected is the set of accelerators the bar prints - a greyed row still
 * prints one, and upstream still attaches the `wxAcceleratorEntry`.
 */
const MENU_BUILDER: Readonly<Record<string, () => Menu[]>> = {
  'editors/symbol/SymbolEditor.tsx': () =>
    symbolEditorMenus(
      {
        action: noop,
        tool: noop,
        toggle: noop,
        language: 'Default',
        onSelectLanguage: noop,
        showHotkeys: noop,
        showAbout: noop,
      },
      {},
      { haveSymbol: true, revert: true, targetSymbol: true, symbolFromSchematic: false },
    ),
  'editors/footprint/FootprintEditor.tsx': () =>
    footprintEditorMenus(
      {
        action: noop,
        tool: noop,
        toggle: noop,
        language: 'Default',
        onSelectLanguage: noop,
        showHotkeys: noop,
        showAbout: noop,
      },
      {},
      {
        haveFootprint: true,
        targetLib: true,
        modified: true,
        targetFootprint: true,
        haveSelection: true,
      },
    ),
};

/**
 * Every accelerator a frame's menu rows declare.
 *
 * A row's accelerator is only real if `ui/menu_hotkeys.ts` can parse it and
 * match a keystroke to it. `Ctrl++`, `Del`, `Home`, `F5` and the
 * `browserSafeKey` substitutions are each a way for that to fail quietly, and
 * before the dispatcher existed every one of them failed by default.
 *
 * Where the tree is a data module this READS THE TREE, which is the whole point
 * of splitting one out. Where it is still inline in a `.tsx` - `qa`'s tsconfig
 * compiles `.ts` only - the declaration has to be scraped out of the source
 * instead, and that scrape is exactly as good as the spelling it happens to
 * find: `shortcut: 'P'` it sees, `tool('Pin', 'placePin', 'placePin', 'P')` it
 * does not.
 */
function declaredAccelerators(rel: string): string[] {
  const out = new Set<string>();
  const build = MENU_BUILDER[rel];

  if (build) {
    const walk = (items: readonly MenuItem[]): void => {
      for (const it of items) {
        if (it.shortcut) out.add(it.shortcut);
        walk(it.submenu ?? it.items ?? []);
      }
    };
    for (const m of build()) walk(m.items);
    return [...out].sort();
  }

  const src = menuSource(rel);
  for (const m of src.matchAll(/shortcut:\s*'([^']+)'/g)) out.add(m[1]!);
  for (const m of src.matchAll(/shortcut:\s*browserSafeKey\('([^']+)'\)/g))
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
    restoreLocalHistory: spy('restoreLocalHistory'),
    hasLocalHistory: hasProject,
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
    // File > Save As… is `disabled: !h.hasProject`, and that IS upstream's:
    //     manager->SetConditions( ACTIONS::saveAs, activeProjectCond );
    // (kicad_manager_frame.cpp:493). The listener this replaced re-stated the
    // condition by hand.
    const { menus, calls } = managerFixture(false);
    expect(dispatchMenuHotkey(menus, ev('s', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does NOT grey Tools > PCB Editor, which upstream never conditions', () => {
    // This row used to be `disabled: !h.hasProject` and Ctrl+P did nothing
    // without a project. Re-derived from the C++ rather than re-baselined:
    // setupUIConditions conditions exactly five actions on an active project -
    // saveAs, closeProject, archiveProject, newJobsetFile, openJobsetFile
    // (kicad_manager_frame.cpp:493-497) - and editPCB is not among them. What
    // refuses is KICAD_MANAGER_CONTROL::ShowPlayer, which raises
    // "Create (or open) a project to edit a pcb." in a message box
    // (kicad_manager_control.cpp:745-749). So the accelerator fires and the
    // handler runs; the handler is what says no.
    const { menus, calls } = managerFixture(false);
    expect(dispatchMenuHotkey(menus, ev('p', { ctrlKey: true }))).toBe(true);
    expect(calls).toEqual(['editPcb']);
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
    // C4: upstream renders the full word, not `Del`. Changed by the same
    // drawing-sheet chrome pass.
    'Delete',
    // View.
    'Home',
    // Added by the drawing-sheet chrome pass (audit finding C3): five rows that
    // upstream declares and we did not. They arrived after this list was first
    // written, and the combined merge is what surfaced the staleness - each
    // branch was green alone.
    //   Save As      Shift+Ctrl+S   File
    //   Print        Ctrl+P         File
    //   Preferences  Ctrl+,         Preferences
    //   Zoom to Sel  Ctrl+F5        View  (ACTIONS::zoomTool)
    //   Refresh      F5             View  (ACTIONS::zoomRedraw)
    'Ctrl+,',
    'Ctrl+F5',
    'Ctrl+P',
    'F5',
    'Shift+Ctrl+S',
  ],
  'editors/footprint/FootprintEditor.tsx': [
    // Every combo below is a `DefaultHotkey` in `common/tool/actions.cpp` or
    // `pcbnew/tools/pcb_actions.cpp`, read off the action its row is built
    // from - plus the two the shared builders add. Nothing here was baselined
    // to whatever the code printed.
    //
    // `addClose` writes File > Close and `standardHelpMenu` writes Help > List
    // Hotkeys. No frame spells a `shortcut:` for either, which is why the
    // source scrape never saw them and every other entry in this table still
    // does not carry them.
    'Ctrl+Alt+W',
    'Ctrl+F1',
    // File. Ctrl+N is BROWSER_RESERVED and carries browserSafeKey's
    // substitution. Ctrl+Shift+S saveAs, Ctrl+Shift+E editLibFpInFpEditor,
    // Ctrl+Shift+F placeImportedGraphics, Ctrl+P print.
    'Ctrl+Alt+N',
    'Ctrl+S',
    'Ctrl+Shift+S',
    'Ctrl+Shift+E',
    'Ctrl+Shift+F',
    'Ctrl+P',
    // Edit. redo is Ctrl+Y and doDelete is Delete off macOS.
    'Ctrl+Z',
    'Ctrl+Y',
    'Ctrl+X',
    'Ctrl+C',
    'Ctrl+V',
    'Delete',
    'Ctrl+D',
    'Ctrl+A',
    'Ctrl+Shift+A',
    // View. zoomFitScreen is WXK_HOME - the F this row used to print is
    // PCB_ACTIONS::flip's key, not this action's. zoomTool Ctrl+F5, zoomRedraw
    // F5, show3DViewer MD_ALT+'3', layerAlphaDec/Inc the brace keys.
    'Home',
    'Ctrl+F5',
    'F5',
    'Alt+3',
    '{',
    '}',
    // Place - the nine accelerators this bar carried none of: drawRuleArea K,
    // drawLine L, drawArc A, drawCircle C, drawPolygon P, drawBezier B,
    // placeText T, drawOrthogonalDimension H, setAnchor N. A, C and P are the
    // same combos Edit already lists.
    'Ctrl+Shift+K',
    'Ctrl+Shift+L',
    'Ctrl+Shift+C',
    'Ctrl+Shift+P',
    'Ctrl+Shift+B',
    'Ctrl+Shift+T',
    'Ctrl+Shift+H',
    'Ctrl+Shift+N',
    // Inspect: measureTool Ctrl+Shift+M, showDatasheet 'D'.
    'Ctrl+Shift+M',
    'D',
    // Preferences: openPreferences Ctrl+,.
    'Ctrl+,',
  ],
  'editors/pcb/PcbEditor.tsx': [
    // Two of these are rows with no `action` yet - Route > Single Track (X) and
    // Inspect > Measure Tool (Ctrl+Shift+M) - so `invocable` skips them and
    // they dispatch nothing. They are listed because the row prints the key,
    // and a row that grows an action must not silently grow a binding too.
    'X',
    'Ctrl+Shift+M',
    // The disambiguation ContextMenu's own rows (1-9 and A), which are not on
    // the menu bar at all. Only the letter is a literal; the digits are built
    // from the index, which is why just this one shows up in the scrape.
    'A',
    'Ctrl+S',
    'Ctrl+Z',
    'Ctrl+Y',
    'Ctrl+D',
    'Delete',
    'Shift+M',
    'Shift+P',
    'Ctrl+F',
    'E',
    'F',
    // View > Zoom In / Zoom Out declare NO accelerator: those rows are
    // `ACTIONS::zoomInCenter` / `zoomOutCenter` (`menubar_pcb_editor.cpp:234`),
    // which carry no DefaultHotkey on any platform. Zoom to Fit is Home, the
    // `#else` branch of zoomFitScreen — the Ctrl++ / Ctrl+- / Ctrl+0 that used
    // to sit here were the macOS branch, and none of them was ever bound.
    'Home',
    'F5',
    'F8',
    'Ctrl+,',
  ],
  'editors/symbol/SymbolEditor.tsx': [
    // As above: every combo is a `DefaultHotkey` out of `common/tool/actions
    // .cpp` or `eeschema/tools/sch_actions.cpp`, plus the two shared builders'.
    'Ctrl+Alt+W',
    'Ctrl+F1',
    // File. saveLibraryAs Ctrl+Shift+S, newSymbol Ctrl+N (substituted),
    // editLibSymbolWithLibEdit Ctrl+Shift+E, importGraphics Ctrl+Shift+F.
    'Ctrl+Shift+S',
    'Ctrl+Alt+N',
    'Ctrl+Shift+E',
    'Ctrl+S',
    'Ctrl+Shift+F',
    // Edit.
    'Ctrl+Z',
    'Ctrl+Y',
    'Ctrl+X',
    'Ctrl+C',
    'Ctrl+Shift+C',
    'Ctrl+V',
    'Delete',
    'Ctrl+D',
    'Ctrl+A',
    'Ctrl+Shift+A',
    'Ctrl+F',
    'Ctrl+Alt+F',
    // View: zoomFitScreen Home, zoomTool Ctrl+F5, zoomRedraw F5.
    'Home',
    'Ctrl+F5',
    'F5',
    // Place. SCH_ACTIONS::placeSymbolPin is 'P' (sch_actions.cpp:379) and is
    // the ONLY Place action in this frame with a key - `placeSymbolText`
    // declares none, so the T this bar used to print was invented.
    'P',
    // Inspect: showDatasheet 'D'.
    'D',
    // Preferences: openPreferences Ctrl+,.
    'Ctrl+,',
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
      (rel) => !/\badd(Close|Quit|QuitOrClose)\(/.test(menuSource(rel)),
    );
    expect(missing, 'a frame hand-rolling the File menu tail').toEqual([]);
  });
});

/**
 * The schematic editor's whole menu, pressed for real.
 *
 * `editors/schematic/menubar.ts` is a plain `.ts` data module, so unlike the
 * other four canvas frames its tree can be built here and actually pressed -
 * which is the only proof that a row's key reaches that row's action rather
 * than merely parsing. It is also the frame with the most to prove: forty-one
 * accelerators, twelve of them the single letters that used to be dispatched
 * from `TOOL_HOTKEYS` beside the menu that already declared them.
 */
function schematicFixture() {
  const calls: string[] = [];
  const menus = buildMenus({
    tool: (id: string) => calls.push(`tool:${id}`),
    action: (id: string) => calls.push(id),
    toggle: (id: string) => calls.push(`toggle:${id}`),
    language: 'Default',
    onSelectLanguage: (label: string) => calls.push(`language:${label}`),
  });
  return { menus, calls };
}

/** Every (combo, label) a row in the tree declares, submenus included. */
function declaredRows(menus: readonly Menu[]): { combo: string; label: string }[] {
  const out: { combo: string; label: string }[] = [];
  const walk = (items: readonly MenuItem[]): void => {
    for (const item of items) {
      if (item.shortcut && item.action) out.push({ combo: item.shortcut, label: item.label ?? '' });
      const kids = item.submenu ?? item.items;
      if (kids) walk(kids);
    }
  };
  for (const m of menus) walk(m.items);
  return out;
}

describe('the schematic editor, pressed for real', () => {
  const rows = declaredRows(schematicFixture().menus);

  it('finds the rows in the first place', () => {
    // A guard on the guard: a tree that stopped being walkable would make
    // every case below vacuous.
    expect(rows.length).toBeGreaterThanOrEqual(40);
  });

  it('the set of accelerators has not drifted', () => {
    expect([...new Set(rows.map((r) => r.combo))].sort()).toEqual(
      [
        // File
        'Ctrl+Alt+W',
        'Ctrl+P',
        'Ctrl+S',
        'Ctrl+Shift+F',
        // Edit
        'Ctrl+A',
        'Ctrl+Alt+F',
        'Ctrl+C',
        'Ctrl+F',
        'Ctrl+Shift+A',
        'Ctrl+Shift+C',
        'Ctrl+Shift+V',
        'Ctrl+V',
        'Ctrl+X',
        // ACTIONS::redo off macOS (actions.cpp:292-302); Ctrl+Shift+Z was the
        // `#if defined( __WXMAC__ )` branch.
        'Ctrl+Y',
        'Ctrl+Z',
        'Delete',
        // View
        'Alt+Left',
        'Alt+Right',
        'Alt+Up',
        'Ctrl+F5',
        'Ctrl+G',
        'Ctrl+H',
        'Ctrl+Home',
        // ACTIONS::zoomRedraw off macOS (actions.cpp:705-716); Ctrl+R was the
        // `#if defined( __WXMAC__ )` branch. The key itself always worked.
        'F5',
        'Home',
        // GTK's labels for WXK_PAGEUP / WXK_PAGEDOWN. `PgUp` / `PgDn` is what
        // the Hotkey List calls them - `ui/key_names.ts` is the split.
        'Page Down',
        'Page Up',
        // Place - the twelve SCH_ACTIONS tool letters, plus Ctrl+L
        'A',
        'B',
        'Ctrl+L',
        'H',
        'I',
        'J',
        'L',
        'P',
        'Q',
        'S',
        'T',
        'W',
        'Z',
        // Tools, Preferences, Help
        'Ctrl+,',
        'Ctrl+F1',
        'F8',
      ].sort(),
    );
  });

  it.each(rows.map((r): [string, string] => [r.combo, r.label]))('%s runs %s', (combo, _label) => {
    const { menus, calls } = schematicFixture();
    expect(dispatchMenuHotkey(menus, eventFromCombo(combo, base)), `${combo} matched nothing`).toBe(
      true,
    );
    // Exactly one command, which is ACTION_MANAGER::RunHotKey's contract: it
    // picks a single action for a keystroke and runs that one.
    //
    // Ctrl+F1 is the exception and not an escape hatch: ACTIONS::listHotKeys is
    // AS_GLOBAL, so `standardHelpMenu` wires the row straight to
    // `ui/hotkey_list_action.ts`'s emitter rather than through the frame's
    // handlers. Nothing reaches the spy because nothing was meant to - the
    // dispatch returning true is the whole assertion there.
    expect(calls, `${combo} ran more or less than one command`).toHaveLength(
      combo === 'Ctrl+F1' ? 0 : 1,
    );
  });

  it('the twelve Place letters reach their tools', () => {
    // These are the ones TOOL_HOTKEYS used to dispatch beside the menu that
    // already carried them, and the pair is exactly the drift this file hunts.
    const { menus, calls } = schematicFixture();
    for (const [combo, tool] of [
      ['A', 'placeSymbol'],
      ['P', 'placePower'],
      ['W', 'drawWire'],
      ['B', 'drawBus'],
      ['Z', 'busEntry'],
      ['Q', 'noConnect'],
      ['J', 'junction'],
      ['L', 'placeLabel'],
      ['H', 'placeHierLabel'],
      ['S', 'drawSheet'],
      ['T', 'placeText'],
      ['I', 'lines'],
    ] as const) {
      calls.length = 0;
      expect(dispatchMenuHotkey(menus, eventFromCombo(combo, base)), combo).toBe(true);
      expect(calls, combo).toEqual([`tool:${tool}`]);
    }
  });

  it('and Ctrl+L is the global label, not the plain one', () => {
    // Two rows one modifier apart. `matchesAccelerator` compares the modifier
    // set rather than a subset, so L cannot be reached by Ctrl+L or the other
    // way round - which is what a hand-written `e.key === 'l'` got wrong.
    const { menus, calls } = schematicFixture();
    expect(dispatchMenuHotkey(menus, eventFromCombo('Ctrl+L', base))).toBe(true);
    expect(calls).toEqual(['tool:placeGlobalLabel']);
  });

  it('does nothing at all while the user is typing', () => {
    const { menus, calls } = schematicFixture();
    const typing = { tagName: 'INPUT', type: 'text' };
    for (const { combo } of rows)
      dispatchMenuHotkey(menus, eventFromCombo(combo, base), { target: typing });
    expect(calls).toEqual([]);
  });
});
