// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Grids, and the reader that makes it mean
 * anything.
 *
 * The page itself is the shared `PANEL_GRID_SETTINGS` — one class upstream,
 * one component here — so what is worth asserting is not the widgets a third
 * editor draws for the third time. It is the two things that were actually
 * wrong:
 *
 *  1. `symbol_editor.json` did not exist here at all. The Symbol Editor read
 *     `eeschema.json`'s cursor and grid style, which is a settings file
 *     upstream never hands `SYMBOL_EDIT_FRAME`
 *     (`GetAppSettings<SYMBOL_EDITOR_SETTINGS>( "symbol_editor" )`,
 *     `eeschema/eeschema.cpp:252`).
 *  2. Nothing read the grid. The frame snapped, drew and reported on the
 *     module constant `GRID` in `render/symbolRenderer.ts`, so a Grids page
 *     could have shipped storing a value with no effect whatever — the shape
 *     of defect this suite exists to catch.
 *
 * The defaults below are checked against `~/.config/kicad/10.0/symbol_editor.json`
 * as the installed 10.0.5 writes it, not against `app_settings.cpp` read twice:
 * the parity target is the installed build, and that file is its own answer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  gridSizeToIU,
  SYMBOL_EDITOR_DEFAULTS,
  type SymbolEditorSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import { symbolGridForTool, symbolGridIU } from '@ziroeda/designer/src/editors/symbol/grid.js';
import { DEFAULT_GRID_INDEX, GRID_SIZE_LIST } from '@ziroeda/designer/src/ui/grid_settings.js';
import { OVERRIDE_ROWS } from '@ziroeda/designer/src/dialogs/prefs/grid_settings_rows.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

const cfg = (): SymbolEditorSettings => structuredClone(SYMBOL_EDITOR_DEFAULTS);

// --------------------------------------------------------------- the settings file

describe('symbol_editor.json', () => {
  it('opens on 50 mil, which is defaultGridIdx 1 and not pcbnew’s 15', () => {
    // `common/settings/app_settings.cpp:463-466` names `symbol_editor`
    // alongside `eeschema` in the branch that sets `defaultGridIdx = 1`, and
    // the installed build's file agrees: `"last_size": 1`.
    expect(SYMBOL_EDITOR_DEFAULTS.window.grid.last_size_idx).toBe(1);
    expect(symbolGridIU()).toBe(gridSizeToIU('50 mil'));
    // 50 mil in eeschema IU (100 nm), which is what `symbolRenderer.ts`'
    // `GRID = 1.27 * MM` was. The move from constant to setting must not have
    // changed what a fresh profile snaps to.
    expect(symbolGridIU()).toBe(12700);
  });

  it('carries DefaultGridSizeList()’s symbol_editor row, asked not restated', () => {
    expect(SYMBOL_EDITOR_DEFAULTS.window.grid.sizes.map((g) => g.x)).toEqual(
      GRID_SIZE_LIST.symbol_editor.map((g) => g.x),
    );
    expect(SYMBOL_EDITOR_DEFAULTS.window.grid.fast_grid_1).toBe(DEFAULT_GRID_INDEX.symbol_editor);
    expect(SYMBOL_EDITOR_DEFAULTS.window.grid.fast_grid_2).toBe(
      DEFAULT_GRID_INDEX.symbol_editor + 1,
    );
  });

  it('has the four overrides the installed build writes, at its own indices', () => {
    // `~/.config/kicad/10.0/symbol_editor.json`, verbatim:
    //   override_connected true  / _idx 1  -> 50 mil
    //   override_wires     true  / _idx 1  -> 50 mil
    //   override_text      true  / _idx 3  -> 10 mil
    //   override_graphics  false / _idx 2  -> 25 mil
    // The indices are into the four-entry list above, so they are spelled here
    // as the sizes they name — ours store the string, not the index.
    const o = SYMBOL_EDITOR_DEFAULTS.window.grid.overrides;
    expect(o.connected).toEqual({ enabled: true, size: '50 mil' });
    expect(o.wires).toEqual({ enabled: true, size: '50 mil' });
    expect(o.text).toEqual({ enabled: true, size: '10 mil' });
    expect(o.graphics).toEqual({ enabled: false, size: '25 mil' });
    expect(SYMBOL_EDITOR_DEFAULTS.window.grid.overrides_enabled).toBe(true);
  });

  it('is its own file, not a slice of eeschema’s', () => {
    // The mistake this replaces: the canvas read `settings.eeschema.window.*`,
    // which made every control on the Symbol Editor's Display Options page a
    // second set of switches over the SCHEMATIC's file.
    const canvas = read('editors/symbol/SymbolCanvas.tsx');
    expect(canvas).not.toContain('settings.eeschema');
    expect(canvas).toContain('settings.symbolEditor.window.cursor');
    const frame = read('editors/symbol/SymbolEditor.tsx');
    expect(frame).not.toContain('settings.eeschema');
  });
});

// ------------------------------------------------------------------- the reader

describe('symbolGridIU: which grid the frame is on', () => {
  it('follows the current-grid selection', () => {
    const c = cfg();
    c.window.grid.last_size_idx = 0;
    expect(symbolGridIU(c)).toBe(gridSizeToIU('100 mil'));
    c.window.grid.last_size_idx = 3;
    expect(symbolGridIU(c)).toBe(gridSizeToIU('10 mil'));
  });

  it('follows a grid the user edited, not just the stock list', () => {
    const c = cfg();
    c.window.grid.sizes[1] = { name: 'mine', x: '0.4 mm', y: '0.4 mm' };
    expect(symbolGridIU(c)).toBe(gridSizeToIU('0.4 mm'));
  });

  it('clamps an index that outlived its row, as safeGrid does', () => {
    // `PANEL_GRID_SETTINGS::safeGrid` (`panel_grid_settings.cpp:232-243`).
    // Remove the last grid with the selection on it and the index points past
    // the end; a frame that read `undefined` would snap to nothing at all.
    const c = cfg();
    c.window.grid.last_size_idx = 99;
    expect(symbolGridIU(c)).toBe(gridSizeToIU('10 mil'));
    c.window.grid.last_size_idx = -1;
    expect(symbolGridIU(c)).toBe(gridSizeToIU('100 mil'));
  });
});

describe('symbolGridForTool: EE_GRID_HELPER::GetItemGrid, by tool', () => {
  /** A config whose four overrides are distinguishable from each other. */
  const marked = (): SymbolEditorSettings => {
    const c = cfg();
    c.window.grid.last_size_idx = 0; // 100 mil, so `base` is none of the below
    c.window.grid.overrides = {
      connected: { enabled: true, size: '50 mil' },
      wires: { enabled: true, size: '20 mil' },
      text: { enabled: true, size: '10 mil' },
      graphics: { enabled: true, size: '25 mil' },
    };
    return c;
  };

  it('puts pins on Connected items', () => {
    // `SCH_PIN_T -> GRID_CONNECTABLE` (`ee_grid_helper.cpp:375-388`).
    expect(symbolGridForTool(marked(), 'placePin')).toBe(gridSizeToIU('50 mil'));
  });

  it('puts text on Text', () => {
    // `SCH_TEXT_T`, `SCH_FIELD_T -> GRID_TEXT` (`:389-392`).
    expect(symbolGridForTool(marked(), 'placeText')).toBe(gridSizeToIU('10 mil'));
  });

  it('puts every drawing tool on Graphics', () => {
    // `SCH_SHAPE_T`, `SCH_TEXTBOX_T -> GRID_GRAPHICS` (`:393-398`).
    for (const tool of [
      'drawRectangle',
      'drawCircle',
      'drawArc',
      'drawSymbolLines',
      'drawPolygon',
      'drawSymbolTextBox',
      'bezier',
    ])
      expect(symbolGridForTool(marked(), tool), tool).toBe(gridSizeToIU('25 mil'));
  });

  it('leaves everything else on the current grid', () => {
    for (const tool of ['select', 'placeAnchor', 'deleteTool', 'zoomTool', undefined])
      expect(symbolGridForTool(marked(), tool), String(tool)).toBe(gridSizeToIU('100 mil'));
  });

  it('never reaches the Wires override, because no LIB_SYMBOL item is on it', () => {
    // `GRID_WIRES` is reachable only from a connectable `SCH_LINE_T`, a
    // junction or a bus entry (`ee_grid_helper.cpp:399-411`) — none of which a
    // symbol contains. The row is still DRAWN, because
    // `PANEL_GRID_SETTINGS` keeps it for all four schematic frames; that is
    // upstream's behaviour and the page must not invent a reason to hide it.
    const wires = gridSizeToIU('20 mil');
    const tools = [
      'placePin',
      'placeText',
      'drawRectangle',
      'select',
      'placeAnchor',
      'deleteTool',
      undefined,
    ];
    for (const tool of tools) expect(symbolGridForTool(marked(), tool)).not.toBe(wires);
    expect(OVERRIDE_ROWS.FRAME_SCH_SYMBOL_EDITOR.map(([k]) => k)).toContain('wires');
  });

  it('ignores every override while toggleGridOverrides is off', () => {
    // `GRID_HELPER::GetGrid` returns the current grid when overrides are
    // disabled, whatever the per-item settings say.
    const c = marked();
    c.window.grid.overrides_enabled = false;
    for (const tool of ['placePin', 'placeText', 'drawRectangle'])
      expect(symbolGridForTool(c, tool), tool).toBe(gridSizeToIU('100 mil'));
  });

  it('falls back to the current grid for a row that is unticked', () => {
    const c = marked();
    c.window.grid.overrides.text.enabled = false;
    expect(symbolGridForTool(c, 'placeText')).toBe(gridSizeToIU('100 mil'));
    // and the ticked ones still apply
    expect(symbolGridForTool(c, 'placePin')).toBe(gridSizeToIU('50 mil'));
  });
});

// ------------------------------------------------------- the page, and its wiring

describe('the page is the shared panel, constructed for this frame', () => {
  const PAGE = 'editors/symbol/prefs/PanelSymbolEditorGrids.tsx';

  it('calls dialogs/prefs/PanelGridSettings rather than copying it', () => {
    // The rule this editor's Grids page exists to obey: KiCad writes
    // `PANEL_GRID_SETTINGS` once in `common/` and every KIFACE constructs the
    // same type. A second copy here is the defect, not a style choice.
    const src = read(PAGE);
    expect(src).toContain("from '../../../dialogs/prefs/PanelGridSettings.js'");
    expect(src).toContain('frameType="FRAME_SCH_SYMBOL_EDITOR"');
    // It must not restate the panel: no listbox, no override rows of its own.
    expect(src).not.toContain('ze-gridlist');
    // Nor may it reach the per-frame row table: which overrides this frame
    // shows is the shared panel's business, keyed on the `frameType` above.
    expect(src).not.toContain("from '../../../dialogs/prefs/grid_settings_rows.js'");
  });

  it('writes symbol_editor.json and not the schematic’s', () => {
    const src = read(PAGE);
    expect(src).toContain('symbolEditor.window.grid');
    expect(src).not.toContain('ctx.eeschema');
  });

  it('the frame draws the grid the setting names, not the module constant', () => {
    // The whole point. `sizeIU: GRID` in the renderer is what made the page
    // decorative; it is now `opts.gridSizeIU ?? GRID`, and the frame supplies
    // it. Checked as source text because there is no canvas here to render on.
    const renderer = read('editors/symbol/render/symbolRenderer.ts');
    expect(renderer).toContain('sizeIU: opts.gridSizeIU ?? GRID');
    const frame = read('editors/symbol/SymbolEditor.tsx');
    expect(frame).toContain('gridSizeIU: symbolGridIU(symCfg)');
    // and the status bar's grid pane, which is EDA_DRAW_FRAME::DisplayGridMsg
    expect(frame).toContain('gridMsg(fmt(symbolGridIU(symCfg)))');
    expect(frame).not.toContain('gridMsg(fmt(GRID))');
  });

  it('the canvas snaps on it too', () => {
    const canvas = read('editors/symbol/SymbolCanvas.tsx');
    expect(canvas).toContain('symbolGridForTool(symCfg, activeTool)');
    // The old module-level import is gone: a canvas that still took `snap`
    // from `edits.js` would snap on the current grid whatever the overrides
    // said, which is exactly half a wiring.
    expect(canvas).not.toMatch(/^\s*snap,$/m);
  });
});
