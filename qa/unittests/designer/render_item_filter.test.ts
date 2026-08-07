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
    // A dragged symbol must not leave its fields glowing behind it.
    const moving = new Set([symbolIds()[0]!]);
    const hiddenAndSelected = record({ selection: moving, hiddenItems: moving });
    const hiddenNotSelected = record({ hiddenItems: moving });
    expect(hiddenAndSelected.segmentCount).toBe(hiddenNotSelected.segmentCount);
  });

  // Not covered, and known: filtering a *field on its own*
  // (`<symbol>:field<n>`) is inert. Measured on this fixture, hiding one
  // changes nothing and `onlyItems` naming one records no geometry at all, so
  // dragging a field by itself still goes through the whole-sheet repaint. The
  // field text is evidently drawn somewhere other than the loop guarded here;
  // finding where is its own piece of work rather than a guess bolted on.
});

describe('dangling-pin markers', () => {
  /** One symbol with two unconnected pins, so both pins dangle. */
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
    (property "Reference" "R1" (at 54 48 0) (effects (font (size 1.27 1.27))))))`;

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

  it('are left out of the preview pass', () => {
    // Counted by radius through a spy context, not inferred from a segment
    // total: a preview that still drew the markers is *also* smaller than the
    // whole sheet, so a size comparison passes either way and says nothing.
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
    // TARGET_PIN_RADIUS is 15 mil; whatever its exact value, the ordinary
    // render draws some arcs and the preview must draw strictly fewer.
    const plainArcs = arcs({});
    const previewArcs = arcs({ onlyItems: new Set(['s-1']) });
    expect(plainArcs.length).toBeGreaterThan(0);
    expect(previewArcs.length).toBe(0);
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

describe('the preview pass paints over what is already there', () => {
  /**
   * A context that records the calls this cares about and ignores the rest.
   *
   * Deliberately not the GL recorder: that one is told to drop the canvas
   * clear (`skipFirstFillRect`), which is exactly why every GL test passed
   * while the Canvas2D path went blank. A spy that sees every call is the only
   * thing that could have caught it.
   */
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
    // Selecting an item that is hidden must add nothing at all. Comparing a
    // selected background against an unselected one isolates the shadow pass:
    // any halo it still drew would show up here as extra geometry, where
    // comparing against the unfiltered sheet would pass on the main pass's
    // filtering alone and say nothing about the shadow.
    const hiddenAndSelected = record({ selection: moving, hiddenItems: moving });
    const hiddenNotSelected = record({ hiddenItems: moving });
    expect(hiddenAndSelected.segmentCount).toBe(hiddenNotSelected.segmentCount);

    // And the halo is real when the item is not hidden, so the equality above
    // is not passing because nothing draws a halo in the first place.
    const visibleAndSelected = record({ selection: moving });
    expect(visibleAndSelected.segmentCount).toBeGreaterThan(record({}).segmentCount);
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
