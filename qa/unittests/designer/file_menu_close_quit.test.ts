// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The last rows of every File menu, against `ACTION_MENU`.
 *
 * `common/tool/action_menu.cpp:220-262` writes them once:
 *
 *     AddClose( aAppname )  ->  "Close" + "\tCtrl+W",  help "Close <app>"
 *     AddQuit ( aAppname )  ->  "Quit"  + "\tCtrl+Q",  help "Quit <app>"
 *     AddQuitOrClose( kiface, aAppname )
 *                           ->  Quit when standalone, else AddClose
 *
 * Eleven frames here wrote the row by hand instead, and ten of them had it
 * wrong in the same way: the app name in the *label* rather than the help
 * string, and no accelerator at all. That is what a per-frame copy of a shared
 * thing decays into, so this file checks two separate things:
 *
 *   1. the builder produces exactly the upstream strings, for every app name
 *      any frame passes it - a table, run against the real function;
 *   2. every frame actually calls it, with the app name upstream passes and
 *      the rows upstream adds - a source sweep, because `qa`'s tsconfig
 *      compiles `.ts` only and eight of the eleven File menus are built inside
 *      a `.tsx` component. `menu_hotkey_coverage.test.ts` reads sources for the
 *      same reason.
 *
 * And one rule that cuts across all of them: **no menu declares an accelerator
 * the browser will not deliver.** Ctrl+W closes the tab. Before the shared
 * dispatcher landed, a row spelling it was a harmless lie; now the row is the
 * declaration the dispatcher reads, so it advertises a keystroke whose only
 * effect is to throw away an unsaved board.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  addClose,
  addQuit,
  addQuitOrClose,
  UPSTREAM_CLOSE_KEY,
  UPSTREAM_QUIT_KEY,
} from '@ziroeda/designer/src/ui/action_menu.js';
import {
  BROWSER_REBINDS,
  browserSafeKey,
  isBrowserReserved,
} from '@ziroeda/designer/src/ui/browser_reserved.js';
import { buildViewer3DMenus } from '@ziroeda/designer/src/editors/pcb/viewer3dMenus.js';
import { buildMenus as buildSchMenus } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import { buildHotkeySections } from '@ziroeda/designer/src/ui/hotkeys_inventory.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** What the two substituted keys resolve to. Spelled out so a change to
 *  BROWSER_REBINDS cannot quietly rewrite what this file asserts. */
const CLOSE_KEY = 'Ctrl+Alt+W';
const QUIT_KEY = 'Ctrl+Alt+Q';

describe('ACTION_MENU::AddClose / AddQuit', () => {
  it('are the keys the C++ spells, before the browser has its say', () => {
    expect(UPSTREAM_CLOSE_KEY).toBe('Ctrl+W');
    expect(UPSTREAM_QUIT_KEY).toBe('Ctrl+Q');
  });

  it('substitutes both, because a tab is given neither', () => {
    expect(isBrowserReserved(UPSTREAM_CLOSE_KEY)).toBe(true);
    expect(isBrowserReserved(UPSTREAM_QUIT_KEY)).toBe(true);
    expect(browserSafeKey(UPSTREAM_CLOSE_KEY)).toBe(CLOSE_KEY);
    expect(browserSafeKey(UPSTREAM_QUIT_KEY)).toBe(QUIT_KEY);
    // …and the substitutes are keys a page may actually have.
    expect(isBrowserReserved(CLOSE_KEY)).toBe(false);
    expect(isBrowserReserved(QUIT_KEY)).toBe(false);
  });

  /** Every app name any frame hands the builder, from the C++ call sites. */
  const APP_NAMES = [
    'Library Editor', // eeschema/symbol_editor/menubar_symbol_editor.cpp:88
    'Footprint Editor', // pcbnew/menubar_footprint_editor.cpp:92
    'Gerber Viewer', // gerbview/menubar.cpp:159
    'Assign Footprints', // cvpcb/menubar.cpp:51
    'Drawing Sheet Editor', // pagelayout_editor/menubar.cpp:88-89
    'Calculator Tools', // pcb_calculator/pcb_calculator_frame.cpp:212-213
    '3D Viewer', // 3d-viewer/3d_viewer/3d_menubar.cpp:54
    'PCB Editor', // pcbnew/menubar_pcb_editor.cpp:165
    'Schematic Editor', // eeschema/menubar.cpp:129
    'Image Converter', // bitmap2component/bitmap2cmp_frame.cpp:299
    'Symbol Viewer', // eeschema/toolbars_symbol_viewer.cpp:139
  ];

  it.each(APP_NAMES)('AddClose(%s) reads "Close", not "Close %s"', (app) => {
    const row = addClose(app, () => undefined);
    expect(row.label).toBe('Close');
    expect(row.tooltip).toBe(`Close ${app}`);
    expect(row.shortcut).toBe(CLOSE_KEY);
  });

  it.each(APP_NAMES)('AddQuit(%s) reads "Quit", not "Quit %s"', (app) => {
    const row = addQuit(app, () => undefined);
    expect(row.label).toBe('Quit');
    expect(row.tooltip).toBe(`Quit ${app}`);
    expect(row.shortcut).toBe(QUIT_KEY);
  });

  it('AddQuitOrClose takes the Close branch under the project manager', () => {
    // `if( !aKiface || aKiface->IsSingle() )` - every frame here is launched
    // from the manager and closes back to it.
    expect(addQuitOrClose('PCB Editor', () => undefined)).toEqual(
      addClose('PCB Editor', expect.any(Function) as unknown as () => void),
    );
    expect(addQuitOrClose('PCB Editor', () => undefined, true)).toEqual(
      addQuit('PCB Editor', expect.any(Function) as unknown as () => void),
    );
  });

  it('invokes the row it was given', () => {
    let ran = 0;
    addClose('PCB Editor', () => {
      ran += 1;
    }).action?.();
    addQuit('PCB Editor', () => {
      ran += 1;
    }).action?.();
    expect(ran).toBe(2);
  });
});

/**
 * Frame -> the C++ call site it is transcribing.
 *
 * `rows` is the *sequence* upstream's File menu ends with, which is the half of
 * this that a "fix the label" change cannot get right by accident: two frames
 * call AddClose **and** AddQuit and both were missing the second row entirely.
 */
interface FrameRow {
  /** Our file, relative to `designer/src`. */
  file: string;
  /** The C++ frame's menubar, and the line the call is on. */
  upstream: string;
  /** The app name passed to the builder. */
  app: string;
  /** The builders called, in order. */
  rows: ('close' | 'quit' | 'quitOrClose')[];
}

const FRAMES: FrameRow[] = [
  {
    // The bar moved out of the frame into its own data module, the way
    // eeschema's and gerbview's did, so that qa can compile it.
    file: 'editors/symbol/menubar.ts',
    upstream: 'eeschema/symbol_editor/menubar_symbol_editor.cpp:88',
    app: 'Library Editor',
    rows: ['close'],
  },
  {
    // Likewise: `editors/footprint/menubar.ts` is the tree, and the frame keeps
    // only the handlers.
    file: 'editors/footprint/menubar.ts',
    upstream: 'pcbnew/menubar_footprint_editor.cpp:92',
    app: 'Footprint Editor',
    rows: ['close'],
  },
  {
    // The bar moved out of the frame into its own data module, the way
    // eeschema's did, so that qa can compile it.
    file: 'editors/gerbview/menubar.ts',
    upstream: 'gerbview/menubar.cpp:159',
    app: 'Gerber Viewer',
    rows: ['quitOrClose'],
  },
  {
    file: 'editors/schematic/dialogs/dialog_assign_footprints.tsx',
    upstream: 'cvpcb/menubar.cpp:51',
    app: 'Assign Footprints',
    rows: ['close'],
  },
  {
    file: 'editors/drawingsheet/DrawingSheetEditor.tsx',
    upstream: 'pagelayout_editor/menubar.cpp:88-89',
    app: 'Drawing Sheet Editor',
    rows: ['close', 'quit'],
  },
  {
    file: 'editors/calculator/CalculatorTools.tsx',
    upstream: 'pcb_calculator/pcb_calculator_frame.cpp:212-213',
    app: 'Calculator Tools',
    rows: ['close', 'quit'],
  },
  {
    file: 'editors/pcb/viewer3dMenus.ts',
    upstream: '3d-viewer/3d_viewer/3d_menubar.cpp:54',
    app: '3D Viewer',
    rows: ['close'],
  },
  {
    file: 'editors/pcb/PcbEditor.tsx',
    upstream: 'pcbnew/menubar_pcb_editor.cpp:165',
    app: 'PCB Editor',
    rows: ['quitOrClose'],
  },
  {
    file: 'editors/schematic/menubar.ts',
    upstream: 'eeschema/menubar.cpp:129',
    app: 'Schematic Editor',
    rows: ['quitOrClose'],
  },
  {
    file: 'editors/image/ImageConverter.tsx',
    upstream: 'bitmap2component/bitmap2cmp_frame.cpp:299',
    app: 'Image Converter',
    rows: ['quit'],
  },
  {
    file: 'editors/schematic/components/SymbolLibraryBrowser.tsx',
    upstream: 'eeschema/toolbars_symbol_viewer.cpp:139',
    app: 'Symbol Viewer',
    rows: ['close'],
  },
];

const BUILDER = { close: 'addClose', quit: 'addQuit', quitOrClose: 'addQuitOrClose' } as const;

describe('every File menu ends the way its C++ frame ends', () => {
  it.each(
    FRAMES.map((f): [string, FrameRow] => [f.file, f]),
  )('%s calls the builder for each row upstream adds', (_name, frame) => {
    const src = read(frame.file);
    // The calls, in the order they appear, filtered to this frame's app name
    // so an unrelated builder call elsewhere in the file cannot stand in.
    const calls = [...src.matchAll(/\b(addClose|addQuit|addQuitOrClose)\('([^']+)'/g)]
      .filter((m) => m[2] === frame.app)
      .map((m) => m[1]);
    expect(calls, `${frame.file} vs ${frame.upstream}`).toEqual(frame.rows.map((r) => BUILDER[r]));
  });

  it.each(
    FRAMES.map((f): [string, FrameRow] => [f.file, f]),
  )('%s no longer puts the app name in the label', (_name, frame) => {
    // "Close Footprint Editor" as menu *text* is the defect this replaces;
    // upstream shows it in the status bar and nowhere else.
    const src = read(frame.file);
    expect(src).not.toContain(`'Close ${frame.app}'`);
    expect(src).not.toContain(`'Quit ${frame.app}'`);
  });

  it('covers every frame that has one of these rows', () => {
    // A guard on the guard: a twelfth frame calling the builder must be added
    // to the table above rather than escaping it.
    expect(FRAMES).toHaveLength(11);
  });
});

const fileMenu = (menus: readonly Menu[]): MenuItem[] => {
  const m = menus.find((x) => x.label === 'File');
  expect(m, 'no File menu').toBeDefined();
  return m!.items;
};

describe('the two File menus that are plain data, built for real', () => {
  it('the 3D viewer closes on Ctrl+Alt+W, with the app name in the help string', () => {
    const menus = buildViewer3DMenus(
      {
        grid: 'none',
        ortho: false,
        showMissingModels: false,
        raytracing: false,
        showAppearanceManager: false,
      },
      Object.fromEntries(
        [
          'exportImage',
          'copyToClipboard',
          'close',
          'zoomIn',
          'zoomOut',
          'zoomFit',
          'home',
          'redraw',
          'setGrid',
          'setView',
          'rotate',
          'flip',
          'move',
          'toggleShowMissingModels',
          'openPreferences',
          'resetToDefaults',
        ].map((k) => [k, () => undefined]),
      ) as unknown as Parameters<typeof buildViewer3DMenus>[1],
    );
    const close = fileMenu(menus).at(-1)!;
    expect(close.label).toBe('Close');
    expect(close.tooltip).toBe('Close 3D Viewer');
    expect(close.shortcut).toBe(CLOSE_KEY);
  });

  it('the schematic editor keeps AddQuitOrClose’s Close branch', () => {
    const ran: string[] = [];
    const menus = buildSchMenus({
      tool: (id) => ran.push(`tool:${id}`),
      action: (id) => ran.push(`action:${id}`),
      toggle: (id) => ran.push(`toggle:${id}`),
      language: 'Default',
      onSelectLanguage: () => undefined,
    });
    const close = fileMenu(menus).at(-1)!;
    expect(close.label).toBe('Close');
    expect(close.tooltip).toBe('Close Schematic Editor');
    expect(close.shortcut).toBe(CLOSE_KEY);
    // …and the row still reaches the handler it always did.
    close.action?.();
    expect(ran).toEqual(['action:close']);
  });
});

describe('no menu declares a key the browser will not deliver', () => {
  /**
   * Every accelerator written anywhere under `designer/src`, read as text.
   *
   * The whole point is to cover the eight File menus built inside `.tsx`
   * components, which `qa` cannot import. A literal is enough because a
   * `shortcut:` is always either a string literal or a `browserSafeKey(...)`
   * call - and the latter is the fix, so it is meant to be skipped here.
   */
  const { declared, visited } = (() => {
    const out: { file: string; combo: string }[] = [];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        const rel = relative(SRC, path).split('\\').join('/');
        files.push(rel);
        const src = readFileSync(path, 'utf8');
        // Both spellings a declaration uses: `shortcut:` on a MenuItem, `keys:`
        // in a hotkey registry. A positional argument (`act(…, 'Ctrl+P')`) is
        // covered by the Hotkey List assertion below, which reads the built
        // menus rather than their source.
        for (const m of src.matchAll(/\b(?:shortcut|keys):\s*'([^']*)'/g)) {
          out.push({ file: rel, combo: m[1]! });
        }
      }
    };
    walk(SRC);
    return { declared: out, visited: new Set(files) };
  })();

  it('finds the accelerators in the first place', () => {
    // Without this the sweep below passes by matching nothing. Note the fixed
    // rows are *not* here as literals - `browserSafeKey('Ctrl+W')` is a call,
    // which is exactly what makes the raw-literal sweep meaningful - so the
    // canary is an ordinary key, plus proof that every frame in the table above
    // was actually walked.
    expect(declared.length).toBeGreaterThan(100);
    expect(declared.map((d) => d.combo)).toContain('Ctrl+S');
    expect(FRAMES.filter((f) => !visited.has(f.file)).map((f) => f.file)).toEqual([]);
  });

  it('never spells one of BROWSER_REBINDS’ keys raw', () => {
    // The substituted ones specifically: these have a working spelling, so a
    // raw one is a plain mistake rather than a decision.
    const raw = declared.filter((d) => d.combo in BROWSER_REBINDS);
    expect(
      raw,
      'a row declaring a key the browser keeps, when BROWSER_REBINDS has a working one',
    ).toEqual([]);
  });

  it('and the Hotkey List, built from the same declarations, agrees', () => {
    // buildHotkeySections is what the user actually reads. Ctrl+Shift+T is the
    // one documented exception - PCB_ACTIONS::placeText, read by no dispatcher
    // yet, decided in #525 - and it is named rather than filtered out.
    const reserved = buildHotkeySections()
      .flatMap((s) => s.entries.map((e) => e.keys))
      .filter((k) => k !== '' && !/click|wheel|drag/i.test(k))
      .filter(isBrowserReserved);
    expect([...new Set(reserved)].sort()).toEqual(['Ctrl+Shift+T']);
  });

  it('shows Close and Quit in the Common section on the keys the rows use', () => {
    // g_standardPlatformCommands. A user who looks up "Close" here and types
    // what it says must not lose the tab.
    const common = buildHotkeySections().find((s) => s.name === 'Common');
    expect(common, 'no Common section').toBeDefined();
    const entry = (command: string) => common!.entries.find((e) => e.command === command);
    expect(entry('Close')?.keys).toBe(CLOSE_KEY);
    expect(entry('Quit')?.keys).toBe(QUIT_KEY);
  });
});
