// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every canvas gets its wheel and its Zoom to Fit from the one shared module.
 *
 * Upstream this needs no test: `EDA_DRAW_PANEL_GAL`'s constructor builds a
 * `WX_VIEW_CONTROLS` (`common/draw_panel_gal.cpp:170`) and `COMMON_TOOLS` is
 * registered on every `EDA_DRAW_FRAME`, so a new editor cannot have its own
 * wheel handler without deliberately writing one. Ours are React components
 * that each own a `<canvas>`, so the wiring is per-file and drifts: five
 * independent wheel handlers existed, four hardcoding a 1.2 step and reading
 * no preference at all, which is why "Preferences -> Mouse and Touchpad"
 * worked in one editor out of six.
 *
 * This walks the sources, the way `modal_escape_coverage.test.ts` does, so a
 * seventh canvas that rolls its own fails here instead of in a bug report.
 * They are read as text because `qa`'s tsconfig cannot compile `.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

/** Every file in the app that owns a canvas and handles a wheel event. */
const CANVASES = [
  'editors/schematic/components/SchematicCanvas.tsx',
  'editors/symbol/SymbolCanvas.tsx',
  'editors/pcb/PcbEditor.tsx',
  'editors/footprint/FootprintCanvas.tsx',
  'editors/gerbview/GerberCanvas.tsx',
  'editors/drawingsheet/DrawingSheetCanvas.tsx',
  // The preview panes are EDA_DRAW_PANEL_GALs upstream too, so they get
  // WX_VIEW_CONTROLS on the same terms.
  'widgets/preview_view_controls.ts',
];

/** Where Zoom to Fit's maths lives for each editor. */
const FITTERS = [
  'editors/schematic/render/renderer.ts',
  'editors/symbol/render/symbolRenderer.ts',
  'editors/pcb/PcbEditor.tsx',
  'editors/footprint/FootprintCanvas.tsx',
  'editors/gerbview/GerberCanvas.tsx',
  'editors/drawingsheet/DrawingSheetCanvas.tsx',
];

const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('shared view controls', () => {
  it.each(CANVASES)('%s handles the wheel through the shared module', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/from '[./]+ui\/view_controls\.js'/);
    expect(src).toContain('wheelAction(');
  });

  it.each(CANVASES)('%s reads the mouse preferences rather than a constant', (rel) => {
    const src = read(rel);
    // Either it takes an InputPrefs from its frame (the schematic canvas and
    // the preview panes do) or it reads COMMON_SETTINGS itself.
    expect(/commonInputPrefs\(\)|inputPrefs/.test(src)).toBe(true);
  });

  it.each(CANVASES)('%s no longer hardcodes a zoom step in its wheel handler', (rel) => {
    const src = read(rel);
    // The four canvases that ignored the preferences all read exactly
    // `e.deltaY < 0 ? 1.2 : 1 / 1.2`; SymbolCanvas used `Math.exp(-e.deltaY ...)`.
    expect(src).not.toMatch(/deltaY\s*<\s*0\s*\?/);
    expect(src).not.toMatch(/Math\.exp\(\s*-?\s*e\.deltaY/);
  });

  it.each(FITTERS)('%s fits through the shared doZoomFit maths', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/zoomFit(View|Scale)\(/);
  });

  /** Which FRAME_T each editor fits as, i.e. which margin row it lands on. */
  const FRAMES: [string, string][] = [
    ['editors/schematic/render/renderer.ts', "'sch'"],
    ['editors/symbol/render/symbolRenderer.ts', "'symbol_editor'"],
    ['editors/pcb/PcbEditor.tsx', "'pcb'"],
    ['editors/footprint/FootprintCanvas.tsx', "'footprint_editor'"],
    ['editors/gerbview/GerberCanvas.tsx', "'gerber'"],
    ['editors/drawingsheet/DrawingSheetCanvas.tsx', "'pl_editor'"],
  ];

  /** Every FitFrame in the union, so a file can be checked for foreign ones. */
  const ALL_FRAMES = [
    "'sch'",
    "'sch_viewer'",
    "'symbol_editor'",
    "'pcb'",
    "'footprint_editor'",
    "'footprint_viewer'",
    "'gerber'",
    "'pl_editor'",
  ];

  it.each(FRAMES)('%s asks for its own upstream frame type, %s, and no other', (rel, frame) => {
    // Wiring the wrong frame silently swaps 1.04 for 1.48 and back; the
    // library editors are the only two that get the wide margin. Checking only
    // that the right name is present is not enough - these files fit more than
    // once (fitToContent and fitToBBox; zoomToFit and zoomToSelection), so one
    // call can be mis-wired while a sibling keeps the name in the file.
    const src = read(rel);
    expect(src).toContain(frame);
    for (const other of ALL_FRAMES) {
      if (other !== frame) expect(src, `${rel} names ${other}`).not.toContain(other);
    }
  });

  it.each(CANVASES)('%s applies the pan action, not only the zoom', (rel) => {
    // A canvas that handles `zoom` and drops `pan` looks wired but silently
    // eats every shift/ctrl+wheel.
    expect(read(rel)).toMatch(/action\.kind === 'pan'/);
  });

  /**
   * The drag gestures, which went the same way the wheel had.
   *
   * `WX_VIEW_CONTROLS::onButton` (`wx_view_controls.cpp:546-569`) is one
   * branch in front of every GAL canvas: the middle button starts
   * `m_dragMiddle` and the right button `m_dragRight`, each of PAN / ZOOM /
   * NONE. Six of our seven canvases instead wrote `if (e.button === 1)` and
   * panned, so Preferences > Mouse and Touchpad > Drag Gestures was honoured
   * in the schematic editor and nowhere else.
   *
   * Per file, not once over the set: a rule checked across the whole list
   * passes as soon as any single canvas obeys it.
   */
  it.each(CANVASES)('%s asks dragGesture what a button press starts', (rel) => {
    expect(read(rel)).toContain('dragGesture(');
  });

  it.each(CANVASES)('%s does not restate the drag rule as its own comparison', (rel) => {
    // The two shapes that were there: a bare middle-button pan, and the
    // preview panes' `prefs.mouseMiddle === 'pan'` written out by hand.
    const src = read(rel);
    expect(src, `${rel} compares mouseMiddle itself`).not.toMatch(/mouseMiddle\s*===/);
    expect(src, `${rel} compares mouseRight itself`).not.toMatch(/mouseRight\s*===/);
  });

  it('the drag-zoom step is the shared exp(), not a literal', () => {
    // `exp( d.y * m_settings.m_zoomSpeed * 0.001 )` (`:383`). The schematic
    // canvas had `Math.exp((...) * 0.005)`, which is zoom_speed 5 frozen: the
    // Zoom speed slider moved and the gesture did not change.
    for (const rel of CANVASES) {
      expect(read(rel), rel).not.toMatch(/Math\.exp\([^)]*0\.005/);
    }
  });

  it('no canvas invents its own fit margin any more', () => {
    // The margins that used to disagree, each named where it lived. They are
    // absolute world padding, which is what made the framing depend on the
    // document's size; doZoomFit's is a multiplier on the viewport.
    const OLD: [string, RegExp][] = [
      ['editors/drawingsheet/DrawingSheetCanvas.tsx', /const margin = 12 \* MM/],
      ['editors/drawingsheet/DrawingSheetCanvas.tsx', /const margin = 6 \* MM/],
      ['editors/footprint/FootprintCanvas.tsx', /const margin = 2 \* MM/],
      ['editors/gerbview/GerberCanvas.tsx', /const margin = 1\.1/],
      ['editors/pcb/PcbEditor.tsx', /fitWorldBox\([^)]*5 \* MM/],
      // fitToContent / fitToBBox / fitSymbol each inflated their box by 8 mm
      // before scaling. (renderer.ts keeps an unrelated `pad` for a draw-cull
      // test on sheet fields, which is why these match the inflation itself.)
      ['editors/schematic/render/renderer.ts', /minX -= pad;/],
      ['editors/schematic/render/renderer.ts', /box\.minX - pad/],
      ['editors/symbol/render/symbolRenderer.ts', /b\.minX - pad/],
    ];
    for (const [rel, re] of OLD) expect(read(rel), `${rel} ${re}`).not.toMatch(re);
  });

  it('the canonical InputPrefs is not exported from an editor', () => {
    // It used to live inside the 3878-line SchematicCanvas.tsx and be imported
    // back out of it by two shared widgets - an app importing from another app,
    // which KiCad's common/ + include/ split exists to prevent.
    const canvas = read('editors/schematic/components/SchematicCanvas.tsx');
    expect(canvas).not.toMatch(/export\s+(interface\s+InputPrefs|const\s+DEFAULT_INPUT_PREFS)/);
    expect(read('ui/view_controls.ts')).toMatch(/export interface InputPrefs/);
  });

  it('nothing imports view controls sideways out of another editor', () => {
    for (const rel of [...CANVASES, ...FITTERS, 'widgets/footprint_preview_widget.tsx']) {
      expect(read(rel), rel).not.toMatch(/import[^;]*InputPrefs[^;]*SchematicCanvas\.js/);
    }
  });
});
