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
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { recordSchematicScene } from '@ziroeda/designer/src/render/gl/schematic_gl.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import type { Theme } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { movingIds } from '@ziroeda/designer/src/editors/schematic/moving_ids.js';

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
function record(opts: {
  hiddenItems?: ReadonlySet<string>;
  onlyItems?: ReadonlySet<string>;
  selection?: ReadonlySet<string>;
}): Scene {
  const scene = new Scene();
  recordSchematicScene(
    scene,
    {
      doc: doc(),
      theme,
      opts: {
        ...DEFAULT_RENDER_OPTS,
        ...(opts.hiddenItems ? { hiddenItems: opts.hiddenItems } : {}),
        ...(opts.onlyItems ? { onlyItems: opts.onlyItems } : {}),
      },
      selection: opts.selection,
      highlight: undefined,
    },
    SCALE,
  );
  return scene;
}

const bytes = (s: Scene): string => s.segments.view().join(',');

/** Every symbol on the sheet, by the id the renderer keys them under. */
const symbolIds = (): string[] => doc().symbols.map((s, i) => refId('symbol', s.uuid, i));
/** Every wire, which unlike a symbol carries no fields and so no anchor crosses. */
const wireIds = (): string[] => doc().lines.map((l, i) => refId('line', l.uuid, i));

describe('with no filter set', () => {
  it('draws exactly what it drew before', () => {
    // The whole point. A guard was added to twenty-odd draw sites in the file
    // that decides what a schematic looks like; if any of them is wrong for
    // the unfiltered case, every user sees it and no other test would say so.
    const plain = record({});
    const emptySets = record({ hiddenItems: new Set(), onlyItems: new Set() });
    expect(emptySets.segmentCount).toBe(plain.segmentCount);
    expect(bytes(emptySets)).toBe(bytes(plain));
  });
});

describe('hiddenItems', () => {
  it('removes the hidden items and leaves the rest untouched', () => {
    const ids = symbolIds();
    expect(ids.length).toBeGreaterThan(2);
    const hidden = new Set(ids.slice(0, 2));

    const plain = record({});
    const without = record({ hiddenItems: hidden });
    expect(without.segmentCount).toBeLessThan(plain.segmentCount);

    // And what remains is a prefix-free subset, not a redrawn sheet: hiding two
    // symbols must not move anything else. Checked by hiding them one at a
    // time and confirming the removals are independent.
    const one = record({ hiddenItems: new Set([ids[0]!]) });
    const other = record({ hiddenItems: new Set([ids[1]!]) });
    const removedByFirst = plain.segmentCount - one.segmentCount;
    const removedBySecond = plain.segmentCount - other.segmentCount;
    expect(plain.segmentCount - without.segmentCount).toBe(removedByFirst + removedBySecond);
  });

  it('hiding every symbol still leaves the sheet furniture', () => {
    const all = record({ hiddenItems: new Set(symbolIds()) });
    // Wires, the page frame and the title block are not symbols.
    expect(all.segmentCount).toBeGreaterThan(0);
  });
});

describe('onlyItems', () => {
  it('draws just those items, at a cost set by how many there are', () => {
    // This is the preview pass: on a drag it runs on every pointer move, so
    // what it must not do is scale with the size of the sheet.
    const ids = symbolIds();
    const plain = record({});
    const preview = record({ onlyItems: new Set([ids[0]!]) });

    expect(preview.segmentCount).toBeGreaterThan(0);
    expect(preview.segmentCount).toBeLessThan(plain.segmentCount / 10);
  });

  it('complements hiddenItems exactly, so a split draws the sheet once over', () => {
    // The invariant a drag depends on: background plus preview is the whole
    // sheet, with nothing drawn twice and nothing missing.
    const moving = new Set(symbolIds().slice(0, 2));
    const plain = record({});
    const background = record({ hiddenItems: moving });
    const preview = record({ onlyItems: moving });
    expect(background.segmentCount + preview.segmentCount).toBe(plain.segmentCount);
  });

  it('wins over hiddenItems when both name the same item', () => {
    // An explicit rule rather than an accident, since the two are set together.
    const id = symbolIds()[0]!;
    const both = record({ onlyItems: new Set([id]), hiddenItems: new Set([id]) });
    expect(both.segmentCount).toBeGreaterThan(0);
  });
});

describe("sub-items: a symbol's fields", () => {
  it('are hidden and drawn with their symbol, exactly once', () => {
    // Dragging a symbol must take its reference and value text along, or the
    // text is drawn from the background at the old position *and* from the
    // preview at the cursor. That is the duplicated naming text that was
    // reported, and this is the case that fixes it.
    const symId = symbolIds()[0]!;
    const plain = record({});
    const background = record({ hiddenItems: new Set([symId]) });
    const preview = record({ onlyItems: new Set([symId]) });
    expect(background.segmentCount).toBeLessThan(plain.segmentCount);
    expect(preview.segmentCount).toBeGreaterThan(0);
    // Exact complements: drawing the fields from both sides would over-count.
    expect(background.segmentCount + preview.segmentCount).toBe(plain.segmentCount);
  });

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

  const recordDangling = (opts: { onlyItems?: ReadonlySet<string> }): Scene => {
    const scene = new Scene();
    recordSchematicScene(
      scene,
      {
        doc: readSchematic(parse(DANGLING)),
        theme,
        opts: { ...DEFAULT_RENDER_OPTS, ...(opts.onlyItems ? { onlyItems: opts.onlyItems } : {}) },
        selection: undefined,
        highlight: undefined,
      },
      SCALE,
    );
    return scene;
  };

  it('are drawn on an ordinary render', () => {
    // Establishes that this fixture really does have dangling pins, so the
    // assertion below is about the gate and not about an empty sheet.
    const withMarkers = recordDangling({});
    expect(withMarkers.segmentCount).toBeGreaterThan(0);
  });

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

  it('legacy size check', () => {
    // Deliberate. Working out which pins dangle walks every pin, wire end and
    // label on the sheet, so it cannot be cached per item the way field
    // layouts and body boxes now are. Doing it per pointer move made a drag
    // cost the whole sheet again even though one symbol was being drawn: it
    // was the last 12 ms of the 17 ms frame. The markers return on drop, when
    // the sheet is painted in full and the connectivity has settled.
    const plain = recordDangling({});
    const preview = recordDangling({ onlyItems: new Set(['s-1']) });
    expect(preview.segmentCount).toBeGreaterThan(0); // the symbol still draws
    expect(preview.segmentCount).toBeLessThan(plain.segmentCount);
  });
});

describe('the per-symbol caches', () => {
  /**
   * Field layouts and body boxes are cached against the *symbol object*, so a
   * drag, which rebuilds the document every frame but replaces only what moved,
   * gets hits for everything it did not touch. That is what took a drag frame
   * from 17 ms to 2.
   *
   * The risk a per-object cache carries is staleness, and for a drag it is the
   * worst possible one: serving the moved symbol its old geometry, so it draws
   * at the position it started from and never follows the cursor.
   */
  const geometry = (d: ReturnType<typeof readSchematic>): string => {
    const scene = new Scene();
    recordSchematicScene(
      scene,
      { doc: d, theme, opts: DEFAULT_RENDER_OPTS, selection: undefined, highlight: undefined },
      SCALE,
    );
    return scene.segments.view().join(',');
  };

  it('serve a cached answer for a symbol that has not changed', () => {
    // The optimisation itself: the same symbol objects in a new document
    // object must not be recomputed, and must give the same bytes.
    const d = doc();
    const before = geometry(d);
    // A new document object sharing every symbol, which is what a drag frame
    // hands the renderer for everything it did not move.
    const after = geometry({ ...d });
    expect(after).toBe(before);
  });

  it('recompute a symbol that moved, rather than drawing it where it was', () => {
    const d = doc();
    const before = geometry(d);
    // Replace one symbol with a moved copy, exactly as `buildMove` does.
    const moved = {
      ...d,
      symbols: d.symbols.map((sym, i) =>
        i === 0 ? { ...sym, at: { ...sym.at, x: sym.at.x + 10_000_000 } } : sym,
      ),
    };
    const after = geometry(moved);
    expect(after).not.toBe(before);
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

  it('is not in the recorded buffer at all', () => {
    // `recordSchematicScene` records with `halos: 'skip'`. A halo's width is a
    // fixed number of *screen pixels* plus a small world width
    // (SCH_PAINTER::getShadowWidth), so it is the one thing on the sheet whose
    // geometry depends on the zoom — and this buffer is deliberately never
    // re-recorded on a zoom. Baking one in froze it at the width it had when it
    // was recorded, which is a three-pixel glow at fit-to-page and a
    // twenty-pixel bar once you zoom in on a part.
    // Selecting a WIRE, not a symbol. The count equality is a proxy for "no
    // halo was recorded", and it only isolates the halo if the selection adds
    // nothing else -- but a selected SYMBOL also selects its fields
    // (SCH_SELECTION_TOOL::highlight's child walk) and each of those draws an
    // anchor cross, which `recordSchematicScene` records on purpose: it records
    // through the real view scale precisely so "the selection halo, a field's
    // umbilical, a selected field's anchor cross" come out at the right size.
    // A wire has no fields, so its selection contributes a halo and nothing
    // else, and the proxy measures what this test is named for again.
    const moving = new Set([wireIds()[0]!]);
    expect(moving.size).toBe(1);
    expect(record({ selection: moving }).segmentCount).toBe(record({}).segmentCount);
  });
});

describe('a drag re-records only what is moving', () => {
  /**
   * The preview and the base are exact complements, and the base must not be
   * rebuilt while a drag is running.
   *
   * The failure this guards against is silent: it does not draw anything wrong,
   * it just costs the whole sheet on every pointer move, which reads as "the
   * component lags behind the cursor" and nothing else. Both halves of it come
   * from object identity, so both are easy to reintroduce by writing the
   * obvious thing.
   */
  it('keeps the moving set identity-stable across frames', () => {
    // `SchematicGl` compares its content key by reference. A fresh Set per
    // frame is a new identity, which re-records the sheet every pointer move.
    const spec = {
      fullIds: new Set(['a']),
      wireStart: new Set<string>(),
      wireEnd: new Set<string>(),
      newWires: [],
      labelRides: [],
      splits: [],
    };
    const first = movingIds(spec as never);
    const second = movingIds(spec as never);
    expect(second).toBe(first);
  });

  it('draws the base and the preview exactly once between them', () => {
    const symId = symbolIds()[0]!;
    const moving = new Set([symId]);
    const plain = record({});
    const base = record({ hiddenItems: moving });
    const preview = record({ onlyItems: moving });
    expect(base.segmentCount + preview.segmentCount).toBe(plain.segmentCount);
  });
});
