// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fast Grid Switching — `ACTIONS::gridFast1` / `gridFast2` / `gridFastCycle`,
 * and the two rows on every Grids page that store their targets.
 *
 * All three are one-line calls into `GridPreset( int idx, bool aFromHotkey )`
 * (`common/tool/common_tools.cpp:534-541, 571-592`):
 *
 *     currentGrid = std::clamp( idx, 0, (int) m_grids.size() - 1 );
 *
 * so the indices are **0-based**, and clamped rather than offset. The schematic
 * had its own copy that read them as 1-based — `min(max(v, 1), n) - 1` — which
 * with the stock settings (`fast_grid_1` 1, `fast_grid_2` 2) made Alt+1 select
 * 100 mil where it should select 50, and Alt+2 select 50 where it should select
 * 25. `PANEL_GRID_SETTINGS`' two choices have always been 0-based, being
 * `wxChoice` selections over the same list `last_size_idx` indexes, so the page
 * and the hotkey disagreed and nothing pinned either.
 *
 * The other three editors had no binding at all, so their rows stored an index
 * nothing acted on.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  fastGridActionForKey,
  fastGridIndex,
  type FastGridSlice,
} from '@ziroeda/designer/src/ui/grid_settings.js';
import {
  EESCHEMA_DEFAULTS,
  GERBVIEW_DEFAULTS,
  PL_EDITOR_DEFAULTS,
  SYMBOL_EDITOR_DEFAULTS,
} from '@ziroeda/designer/src/prefs/settings.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** A four-entry list, which is what eeschema and the symbol editor have. */
const slice = (over: Partial<FastGridSlice> = {}): FastGridSlice => ({
  sizes: { length: 4 },
  last_size_idx: 1,
  fast_grid_1: 1,
  fast_grid_2: 2,
  ...over,
});

describe('the indices are 0-based, as GridPreset reads them', () => {
  it('gridFast1 selects the row the page shows under "Grid 1:"', () => {
    // The bug: this returned 0 for a stored 1. With eeschema's list
    // [100, 50, 25, 10] mil that is 100 mil where the page says 50.
    expect(fastGridIndex(slice(), 'gridFast1')).toBe(1);
    expect(fastGridIndex(slice({ fast_grid_1: 0 }), 'gridFast1')).toBe(0);
    expect(fastGridIndex(slice({ fast_grid_1: 3 }), 'gridFast1')).toBe(3);
  });

  it('gridFast2 likewise', () => {
    expect(fastGridIndex(slice(), 'gridFast2')).toBe(2);
    expect(fastGridIndex(slice({ fast_grid_2: 0 }), 'gridFast2')).toBe(0);
  });

  it('clamps into the list rather than offsetting', () => {
    // `std::clamp( idx, 0, size - 1 )`, both ends.
    expect(fastGridIndex(slice({ fast_grid_1: 99 }), 'gridFast1')).toBe(3);
    expect(fastGridIndex(slice({ fast_grid_1: -5 }), 'gridFast1')).toBe(0);
  });

  it('has nothing to select in an empty list', () => {
    expect(fastGridIndex(slice({ sizes: { length: 0 } }), 'gridFast1')).toBeNull();
  });
});

describe('gridFastCycle toggles between the two, never steps the list', () => {
  it('goes to the other one from either end', () => {
    // `if( last_size_idx == fast_grid_1 ) return GridPreset( fast_grid_2 );`
    // `return GridPreset( fast_grid_1 );` (`common_tools.cpp:583-592`).
    expect(fastGridIndex(slice({ last_size_idx: 1 }), 'gridFastCycle')).toBe(2);
    expect(fastGridIndex(slice({ last_size_idx: 2 }), 'gridFastCycle')).toBe(1);
  });

  it('lands on Grid 1 from anywhere else', () => {
    expect(fastGridIndex(slice({ last_size_idx: 3 }), 'gridFastCycle')).toBe(1);
    expect(fastGridIndex(slice({ last_size_idx: 0 }), 'gridFastCycle')).toBe(1);
  });
});

describe('the keys', () => {
  it('are Alt+1, Alt+2 and Alt+4, and nothing else', () => {
    // `ACTIONS::gridFast1` / `gridFast2` / `gridFastCycle`'s DefaultHotkeys,
    // which `editors/schematic/hotkeys.ts` already lists as Alt+1 / Alt+2 /
    // Alt+4. Alt+3 is SCH_ACTIONS::selectNode and must not be claimed here.
    expect(fastGridActionForKey('1')).toBe('gridFast1');
    expect(fastGridActionForKey('2')).toBe('gridFast2');
    expect(fastGridActionForKey('4')).toBe('gridFastCycle');
    for (const k of ['3', '5', '0', 'a', '']) expect(fastGridActionForKey(k), k).toBeNull();
  });
});

describe('every app’s stored defaults land where the page says', () => {
  it.each([
    ['eeschema', EESCHEMA_DEFAULTS.window.grid],
    ['symbol_editor', SYMBOL_EDITOR_DEFAULTS.window.grid],
    ['pl_editor', PL_EDITOR_DEFAULTS.window.grid],
    ['gerbview', GERBVIEW_DEFAULTS.window.grid],
  ])('%s', (_app, grid) => {
    // `fast_grid_1 = defaultGridIdx` and `fast_grid_2 = defaultGridIdx + 1`
    // (`app_settings.cpp:483-487`), so Alt+1 lands on the grid the frame opens
    // on and Alt+2 on the next one finer. That is the property worth holding:
    // it is true of all four apps and of no particular index.
    expect(fastGridIndex(grid, 'gridFast1')).toBe(grid.last_size_idx);
    expect(fastGridIndex(grid, 'gridFast2')).toBe(grid.last_size_idx + 1);
    // And from the opening grid, cycle goes to the second.
    expect(fastGridIndex(grid, 'gridFastCycle')).toBe(grid.fast_grid_2);
  });
});

// ------------------------------------------------------------ one binding each

/** Every frame `COMMON_TOOLS` gives these three actions, and where it binds them. */
const FRAME: Record<string, string> = {
  eeschema: 'editors/schematic/SchematicEditor.tsx',
  symbol_editor: 'editors/symbol/SymbolEditor.tsx',
  pl_editor: 'editors/drawingsheet/DrawingSheetEditor.tsx',
  gerbview: 'editors/gerbview/GerberViewer.tsx',
};

/** Which settings object each frame must write, and no other. */
const OWN_WRITE: Record<string, string> = {
  eeschema: 'settings.updateEeschema',
  symbol_editor: 'settings.updateSymbolEditor',
  pl_editor: 'settings.plEditor.window.grid',
  gerbview: 'settings.gerbview.window.grid',
};

describe('each frame binds the three actions, through the shared implementation', () => {
  it.each(Object.keys(FRAME))('%s', (app) => {
    const src = read(FRAME[app] as string);
    expect(src, `${app} does not bind the fast grids`).toContain('fastGridActionForKey(e.key)');
    expect(src).toContain('fastGridIndex(');
    expect(src).toContain(OWN_WRITE[app] as string);
  });

  it('the schematic no longer keeps its own 1-based copy', () => {
    // The exact expression that was wrong. It is worth naming: the arm still
    // exists and still handles the same three keys, so only the arithmetic
    // distinguishes the fixed version from the broken one.
    const src = read(FRAME.eeschema as string);
    expect(src).not.toContain('st.window.grid.fast_grid_1, 1), n) - 1');
    expect(src).not.toMatch(/Math\.min\(Math\.max\(st\.window\.grid\.fast_grid_/);
  });

  it('no frame keeps a private copy of the clamp', () => {
    // Upstream this is one method on COMMON_TOOLS. Four copies is how the
    // schematic came to disagree with the page in the first place.
    for (const rel of Object.values(FRAME))
      expect(read(rel), rel).not.toMatch(/fast_grid_2\s*,\s*1\s*\)/);
  });

  it('the drawing sheet writes through its own setter, not past it', () => {
    // It mirrors `last_size_idx` in React state; writing the settings object
    // directly would leave the toolbar's grid selector showing the old row.
    const src = read(FRAME.pl_editor as string);
    const at = src.indexOf('fastGridActionForKey(e.key)');
    expect(src.slice(at, at + 600)).toContain('setGridIndex(idx)');
  });
});
