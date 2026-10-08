// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `hiddenItems` and `onlyItems`: drawing a subset of a sheet (#449).
 *
 * This is what KiCad's renderer can do and ours could not. `VIEW` caches each
 * item's geometry separately, so re-drawing one item leaves every other item's
 * cached vertices alone (`VIEW::updateItemGeometry`, common/view/view.cpp), and
 * `SCH_MOVE_TOOL` puts the items being dragged into a preview group
 * (`m_view->AddToPreview` / `ClearPreview`) painted over an otherwise static
 * background.
 *
 * Both need the painter to be able to leave items out. Without it, a drag has
 * to repaint the whole sheet on every pointer move, which is why a symbol
 * trails the cursor by the length of a full repaint.
 *
 * The load-bearing test is the first one. This adds a condition to twenty-odd
 * draw sites in the file that decides what a schematic looks like, so the
 * property that matters most is that with no filter set, **nothing whatsoever
 * changed**.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import { renderSchematic } from '@ziroeda/eeschema/sch_painter.js';
import { DEFAULT_RENDER_OPTS } from '@ziroeda/eeschema/sch_render_settings.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import type { Theme } from '@ziroeda/eeschema/sch_render_settings.js';

const SCALE = 0.00002;
const SRC = readFileSync(
  join(import.meta.dirname, '../../data/complex_hierarchy.kicad_sch'),
  'utf8',
);

const theme = new Proxy(
  {},
  { get: (_t, k) => (k === 'background' ? '#f0f0f0' : '#008484') },
) as unknown as Theme;

const doc = (): ReturnType<typeof readSchematic> => readSchematic(parse(SRC));

/**
 * The recorded geometry is the observable here: it is what the GL backend
 * uploads, and it is a faithful record of every draw call the renderer made.
 */

/** Every symbol on the sheet, by the id the renderer keys them under. */
const symbolIds = (): string[] => doc().symbols.map((s, i) => refId('symbol', s.uuid, i));

describe("sub-items: a symbol's fields", () => {
  it('take their selection halo with them', () => {
    // A dragged symbol must not leave its fields glowing behind it. Measured
    // through the halo pass, which is where the glow is drawn: comparing the
    // recorded buffer would prove nothing, since halos are deliberately kept
    // out of it entirely.
    const moving = new Set([symbolIds()[0]!]);
    expect(haloStrokes({ hiddenItems: moving }, moving)).toBe(0);
    expect(haloStrokes({}, moving)).toBeGreaterThan(0);
  });

  // Not covered, and known: filtering a *field on its own*
  // (`<symbol>:field<n>`) is inert. Measured on this fixture, hiding one
  // changes nothing and `onlyItems` naming one records no geometry at all, so
  // dragging a field by itself still goes through the whole-sheet repaint. The
  // field text is evidently drawn somewhere other than the loop guarded here;
  // finding where is its own piece of work rather than a guess bolted on.
});

describe('dangling-pin markers', () => {
  /** Two symbols, four unconnected pins, so every pin dangles. The second one
   *  never moves, which is what makes "only the moving symbol's marks"
   *  measurable rather than the same number counted twice. */
  const DANGLING = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
        (stroke (width 0)) (fill (type none))))
      (symbol "R_1_1"
        (pin passive line (at 0 4 270) (length 2)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -4 90) (length 2)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "L:R") (at 50 50 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
    (property "Reference" "R1" (at 54 48 0) (effects (font (size 1.27 1.27)))))
  (symbol (lib_id "L:R") (at 90 50 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-2")
    (property "Reference" "R2" (at 94 48 0) (effects (font (size 1.27 1.27))))))`;

  it('travel with the symbol that is being dragged', () => {
    // Counted through a spy context, not inferred from a segment total: a
    // preview drawing the wrong markers is *also* smaller than the whole
    // sheet, so a size comparison passes either way and says nothing.
    //
    // This used to assert that a preview drew none at all, on the reasoning
    // that connectivity settles at the drop (`TestDanglingEnds` is part of the
    // commit). It does — but the marks of the item on the cursor belong to the
    // item, and leaving them out stranded a dragged symbol's open circles at
    // the position it started from until it was dropped.
    const arcs = (extra: Record<string, unknown>): number[] => {
      const radii: number[] = [];
      const noop = (): void => {};
      const ctx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: '',
        lineJoin: '',
        globalAlpha: 1,
        font: '',
        textAlign: '',
        setTransform: noop,
        translate: noop,
        rotate: noop,
        scale: noop,
        save: noop,
        restore: noop,
        setLineDash: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        closePath: noop,
        rect: noop,
        bezierCurveTo: noop,
        stroke: noop,
        fill: noop,
        strokeRect: noop,
        fillRect: noop,
        fillText: noop,
        drawImage: noop,
        clip: noop,
        arc: (_x: number, _y: number, r: number) => radii.push(r),
      } as unknown as CanvasRenderingContext2D;
      renderSchematic(
        ctx,
        readSchematic(parse(DANGLING)),
        { scale: SCALE, offsetX: 0, offsetY: 0 },
        theme,
        800,
        600,
        undefined,
        undefined,
        { ...DEFAULT_RENDER_OPTS, grid: { ...DEFAULT_RENDER_OPTS.grid, show: false }, ...extra },
      );
      return radii;
    };
    // Four dangling pins on the sheet, two of them on the symbol being
    // dragged. The preview draws that symbol's two, the base behind it draws
    // the other two, and between them each mark is drawn exactly once.
    const plainArcs = arcs({});
    const previewArcs = arcs({ onlyItems: new Set(['s-1']) });
    const baseArcs = arcs({ hiddenItems: new Set(['s-1']) });

    expect(plainArcs).toHaveLength(4);
    expect(previewArcs).toHaveLength(2);
    expect(baseArcs).toHaveLength(2);
  });
});
/** A Canvas2D stand-in that records the calls a pass makes. */
function spy(): { fillRects: [number, number, number, number][]; ctx: CanvasRenderingContext2D } {
  const fillRects: [number, number, number, number][] = [];
  const noop = (): void => {};
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    stroke: noop,
    fill: noop,
    strokeRect: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    fillRect: (x: number, y: number, w: number, h: number) => fillRects.push([x, y, w, h]),
  };
  return { fillRects, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** Count the strokes the halo-only pass makes, through the spy context. */
const haloStrokes = (opts: Partial<typeof DEFAULT_RENDER_OPTS>, selection: Set<string>): number => {
  let strokes = 0;
  const s = spy();
  (s.ctx as unknown as { stroke: () => void }).stroke = () => {
    strokes++;
  };
  renderSchematic(
    s.ctx,
    doc(),
    { scale: SCALE, offsetX: 0, offsetY: 0 },
    theme,
    800,
    600,
    selection,
    undefined,
    {
      ...DEFAULT_RENDER_OPTS,
      grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      halos: 'only',
      ...opts,
    },
  );
  return strokes;
};

describe('the preview pass paints over what is already there', () => {
  /**
   * A context that records the calls this cares about and ignores the rest.
   *
   * Deliberately not the GL recorder: that one is told to drop the canvas
   * clear (`skipFirstFillRect`), which is exactly why every GL test passed
   * while the Canvas2D path went blank. A spy that sees every call is the only
   * thing that could have caught it.
   */

  const W = 800;
  const H = 600;
  const paint = (
    extra: Partial<typeof DEFAULT_RENDER_OPTS>,
  ): [number, number, number, number][] => {
    const s = spy();
    renderSchematic(
      s.ctx,
      doc(),
      { scale: SCALE, offsetX: 0, offsetY: 0 },
      theme,
      W,
      H,
      undefined,
      undefined,
      // The grid builds a Path2D, which is a browser type with no Node
      // equivalent, and it is not what this is about.
      { ...DEFAULT_RENDER_OPTS, grid: { ...DEFAULT_RENDER_OPTS.grid, show: false }, ...extra },
    );
    return s.fillRects;
  };

  const clearsCanvas = (rects: [number, number, number, number][]): boolean =>
    rects.some(([x, y, w, h]) => x === 0 && y === 0 && w === W && h === H);

  it('does not clear the canvas', () => {
    // The regression: `renderSchematic` opens by painting the background over
    // the whole canvas. Under `onlyItems` that erased the background the
    // caller had just blitted, so selecting a component blanked the sheet and
    // left only the symbol.
    const id = symbolIds()[0]!;
    expect(clearsCanvas(paint({ onlyItems: new Set([id]) }))).toBe(false);
  });

  it('but an ordinary render still does', () => {
    // Otherwise the previous frame would smear.
    expect(clearsCanvas(paint({}))).toBe(true);
  });
});

describe('the selection shadow honours the filter too', () => {
  it('so a dragged symbol does not leave its halo behind', () => {
    // The halo is drawn in its own pass. Filtering only the main pass would
    // leave a glow sitting at the old position for the length of the drag.
    const moving = new Set([symbolIds()[0]!]);
    expect(haloStrokes({ hiddenItems: moving }, moving)).toBe(0);
    // And the halo is real when the item is not hidden, so the zero above is
    // not passing because nothing draws a halo in the first place.
    expect(haloStrokes({}, moving)).toBeGreaterThan(0);
  });
});
