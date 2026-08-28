// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every canvas gets its grid and its crosshair from the one shared module.
 *
 * Upstream this needs no test: `GAL::DrawGrid` and `GAL::blitCursor` are on the
 * GAL that `EDA_DRAW_PANEL_GAL` builds for every frame, so a new editor cannot
 * have its own grid without deliberately writing one. Ours are React components
 * that each own a `<canvas>`, so the wiring is per-file and drifts: four
 * implementations existed, of which one drew the three grid styles and three
 * assumed DOTS; a fifth was hardcoded inside the symbol renderer where no
 * toggle could reach it; and the footprint editor drew nothing at all while its
 * toolbar button rendered pressed.
 *
 * This walks the sources, the way `modal_escape_coverage.test.ts` and
 * `view_controls_coverage.test.ts` do. They are read as text because `qa`'s
 * tsconfig cannot compile `.tsx`.
 *
 * Following #542's lesson: a file that paints twice can be half-wired, so where
 * a canvas has more than one paint path this asserts on the COUNT of shared
 * calls against the count of paint paths, not merely that the name appears
 * somewhere in the file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const count = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

/**
 * The six canvases, and the file that owns each one's grid pass. Two of them
 * keep the grid in a renderer module rather than in the component, which is
 * where their scene painter lives; the other four paint it inline.
 */
const GRID_OWNERS: [canvas: string, file: string][] = [
  ['schematic', 'editors/schematic/render/renderer.ts'],
  ['symbol editor', 'editors/symbol/render/symbolRenderer.ts'],
  ['pcb', 'editors/pcb/PcbEditor.tsx'],
  ['footprint editor', 'editors/footprint/FootprintCanvas.tsx'],
  ['gerbview', 'editors/gerbview/GerberCanvas.tsx'],
  ['pl_editor', 'editors/drawingsheet/DrawingSheetCanvas.tsx'],
];

/** Where each canvas' crosshair (GAL::blitCursor) is drawn. */
const CROSSHAIR_OWNERS: [canvas: string, file: string][] = [
  ['schematic', 'editors/schematic/components/SchematicCanvas.tsx'],
  ['symbol editor', 'editors/symbol/SymbolCanvas.tsx'],
  ['pcb', 'editors/pcb/PcbEditor.tsx'],
  ['footprint editor', 'editors/footprint/FootprintCanvas.tsx'],
  ['gerbview', 'editors/gerbview/GerberCanvas.tsx'],
  ['pl_editor', 'editors/drawingsheet/DrawingSheetCanvas.tsx'],
];

/** Everything that draws a grid or a crosshair, for the no-local-copy sweep. */
const ALL = [...new Set([...GRID_OWNERS, ...CROSSHAIR_OWNERS].map(([, f]) => f))].concat([
  'editors/schematic/components/SchematicCanvas.tsx',
  'editors/pcb/renderBoard.ts',
  'editors/symbol/SymbolCanvas.tsx',
]);

describe('shared grid + crosshair', () => {
  it.each(GRID_OWNERS)('%s draws its grid through the shared module', (_name, rel) => {
    const src = read(rel);
    expect(src).toMatch(/from '[./]+ui\/grid_cursor\.js'/);
    expect(src).toMatch(/\bdrawGrid\(/);
  });

  it.each(CROSSHAIR_OWNERS)('%s draws its crosshair through the shared module', (_name, rel) => {
    const src = read(rel);
    expect(src).toMatch(/from '[./]+ui\/grid_cursor\.js'/);
    expect(src).toMatch(/\bdrawCrosshair\(/);
  });

  it('nobody keeps a local grid or crosshair painter any more', () => {
    // A file that still declares its own `drawGrid` has not been converted; it
    // has grown a second one next to the shared call.
    for (const rel of [...new Set(ALL)]) {
      const src = read(rel);
      expect(src, `${rel} declares its own drawGrid`).not.toMatch(
        /(?:function|const)\s+drawGrid\b/,
      );
      expect(src, `${rel} declares its own drawCrosshair`).not.toMatch(
        /(?:function|const)\s+drawCrosshair\b/,
      );
    }
  });

  it('no canvas hand-rolls a crosshair from its own line segments', () => {
    // Every copy drew its own full-window cross the same way, and each one
    // picked a different colour and a different half-length for the small one.
    for (const rel of [...new Set(ALL)]) {
      const src = read(rel);
      // The 80 px small cross, spelled as its half-arm.
      expect(src, `${rel} hardcodes a 40 px crosshair arm`).not.toMatch(/40\s*\*\s*dpr/);
      // The "oversized diagonal" both PCB and gerbview open-coded.
      expect(src, `${rel} hardcodes the 45-degree diagonal span`).not.toMatch(
        /canvas\.width \+ canvas\.height/,
      );
    }
  });

  it('the schematic paints the grid on every one of its GL paint paths', () => {
    // SchematicCanvas has two GL paths, the drag preview and the plain one, and
    // each clears and repaints the 2D layer under the GL buffer itself; the
    // whole-scene 2D path gets its grid inside renderSchematic instead. GL
    // never draws the grid, so a GL path that does not call drawGrid paints no
    // grid at all — and a conversion that wires one branch and misses the other
    // looks green everywhere except on screen. This is exactly the half-wiring
    // #542's coverage test had to be tightened for.
    const canvas = read('editors/schematic/components/SchematicCanvas.tsx');
    const glPaints = count(canvas, /gl\.render\(/g);
    expect(glPaints).toBeGreaterThan(1);
    expect(count(canvas, /\bdrawGrid\(/g)).toBe(glPaints);
  });

  it('the shared painter, not its callers, decides whether the grid is shown', () => {
    // The gate used to sit at the call site, which is how the GL path came to
    // paint a grid the toolbar said was hidden. Each caller passes `show`; none
    // of them may guard the call with the toggle instead.
    for (const [, rel] of GRID_OWNERS) {
      const src = read(rel);
      expect(src, `${rel} does not pass show:`).toMatch(/show:/);
    }
    expect(read('editors/pcb/PcbEditor.tsx')).not.toMatch(
      /if \([^)]*toggles\.has\('toggleGrid'\)[^)]*\) \{\s*drawGrid/,
    );
  });

  it('the two editors that drew no grid now consume the shared one', () => {
    // The whole point of the change. FootprintCanvas.tsx had zero occurrences
    // of the string "grid"; symbolRenderer.ts had a private painter that no
    // toggle could switch off.
    const fp = read('editors/footprint/FootprintCanvas.tsx');
    expect(fp).toMatch(/\bdrawGrid\(/);
    expect(fp).toMatch(/showGrid/);
    const sym = read('editors/symbol/render/symbolRenderer.ts');
    expect(sym).toMatch(/\bdrawGrid\(/);
    // ...and the symbol editor actually hands the toggle down, rather than the
    // renderer deciding for itself.
    expect(read('editors/symbol/SymbolEditor.tsx')).toMatch(
      /showGrid: toggles\.has\('toggleGrid'\)/,
    );
    // The footprint editor's grid has TWO gates, as pcbnew's does, because it
    // now docks the same APPEARANCE_CONTROLS: ACTIONS::toggleGrid's
    // SetGridVisibility, and the Objects tab's LAYER_GRID row, which
    // `s_allowedInFpEditor` lists (appearance_controls.cpp:377) and
    // `setVisibleObjects`' fp branch drives through
    // `view->SetLayerVisible( LAYER_GRID, … )` (:1420-1432). Unchecking Grid
    // there hides it in the footprint editor exactly as in the PCB editor,
    // where `objects.grid && toggles.has('toggleGrid')` was already the rule.
    expect(read('editors/footprint/FootprintEditor.tsx')).toMatch(
      /showGrid=\{objects\.grid && toggles\.has\('toggleGrid'\)\}/,
    );
  });

  it('the footprint grid combo is live and reads the shared size table', () => {
    const src = read('editors/footprint/FootprintEditor.tsx');
    // It used to be `<select className="ze-select" disabled title="Grid">` with
    // one hardcoded `Grid: 0.635 mm (25 mils)` option.
    expect(src).not.toMatch(/disabled title="Grid"/);
    // The hardcoded single option, `Grid: ${...} mm (... mils)`.
    expect(src).not.toMatch(/<option>\{`Grid:/);
    expect(src).not.toMatch(/0\.635\s*\*/);
    expect(src).toMatch(/from '[./]+ui\/grid_settings\.js'/);
    expect(src).toMatch(/gridSizesIU\('pcbnew'/);
  });

  it('nobody keeps a private copy of DefaultGridSizeList', () => {
    // pcbnew built the same 22 entries by hand from two arrays.
    const pcb = read('editors/pcb/PcbEditor.tsx');
    expect(pcb).toMatch(/gridSizesIU\('pcbnew'/);
    expect(pcb).not.toMatch(/\[1000, 500, 250, 200, 100, 50, 25, 20, 10, 5, 2, 1\]/);
  });

  it('no canvas invents its own grid colour any more', () => {
    // Each copy had picked a value with no upstream source. They come off the
    // frame's COLOR_SETTINGS layer now, which IS per-editor upstream.
    const OLD: [string, RegExp][] = [
      ['editors/drawingsheet/DrawingSheetCanvas.tsx', /rgba\(0,0,0,0\.32\)/],
      ['editors/drawingsheet/DrawingSheetCanvas.tsx', /rgba\(90,160,255,0\.55\)/],
      ['editors/gerbview/gerberColors.ts', /GERBER_GRID_COLOR = '#5A5A5A'/],
      ['editors/gerbview/GerberCanvas.tsx', /rgba\(120,180,255,0\.5\)/],
    ];
    for (const [rel, re] of OLD) expect(read(rel), `${rel} ${re}`).not.toMatch(re);
  });

  it('the shared module owns the coarse-grid factor, not its callers', () => {
    // SetCoarseGrid(10) was spelled three different ways: a GRID_TICK const in
    // the schematic renderer, an `opts.tick` field in the PCB one, and nothing
    // at all in the other two.
    for (const rel of [...new Set(ALL)]) {
      const src = read(rel);
      expect(src, `${rel} redeclares GRID_TICK`).not.toMatch(/const GRID_TICK\b/);
      expect(src, `${rel} carries its own coarse-grid tick`).not.toMatch(/\btick:\s*10\b/);
    }
  });
});
