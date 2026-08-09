// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The mark on an unconnected item has to travel with it during a drag.
 *
 * A label that is not on a wire carries a dangling square, and a selected label
 * carries an anchor cross. Both are drawn by the dangling pass, which the base
 * ran over the untouched document and the preview skipped entirely — so the
 * mark stayed at the position the item had before the drag started and only
 * jumped to the cursor on release.
 *
 * A drag splits the sheet into a base recorded without the moving items and a
 * preview holding only them. The marks have to be split the same way: the
 * moving item's mark belongs to the preview, at wherever the drag has put it,
 * and every other mark stays with the base.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** Records the centre of every stroked rectangle (the dangling squares). */
function spy(): { rects: { x: number; y: number }[]; ctx: CanvasRenderingContext2D } {
  const rects: { x: number; y: number }[] = [];
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
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    fill: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: (x: number, y: number, w: number, h: number) =>
      rects.push({ x: x + w / 2, y: y + h / 2 }),
  };
  return { rects, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const OLD_MM = { x: 60, y: 80 };
const NEW_MM = { x: 90, y: 80 };
const OLD = { x: mmToIU(OLD_MM.x), y: mmToIU(OLD_MM.y) };
const NEW = { x: mmToIU(NEW_MM.x), y: mmToIU(NEW_MM.y) };

/** A wire with a connected label, plus a loose one that has nothing under it. */
const sheet = (looseAt: { x: number; y: number }): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (wire (pts (xy 60 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "TIED" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
      (label "LOOSE" (at ${looseAt.x} ${looseAt.y} 0)
        (effects (font (size 1.27 1.27))) (uuid "l2")))`),
  );

const LOOSE = refId('label', 'l2', 1);

const paint = (
  doc: Schematic,
  extra: Partial<typeof DEFAULT_RENDER_OPTS>,
): { x: number; y: number }[] => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      1400,
      1000,
      undefined,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        showDrawingSheet: false,
        ...extra,
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.rects;
};

const near = (rects: { x: number; y: number }[], p: { x: number; y: number }): boolean =>
  // The mark sits on the anchor; a millimetre of slack covers the square's size.
  rects.some((r) => Math.abs(r.x - p.x) < mmToIU(1) && Math.abs(r.y - p.y) < mmToIU(1));

describe('dragging a label that is not connected to anything', () => {
  // The base is the untouched sheet with the label hidden; the preview is the
  // moved sheet holding only it. That is exactly how a drag renders.
  const base = sheet(OLD_MM);
  const moved = sheet(NEW_MM);

  it('the base no longer draws the mark at the old position', () => {
    const rects = paint(base, { hiddenItems: new Set([LOOSE]) });
    expect(near(rects, OLD)).toBe(false);
  });

  it('and the preview draws it at the new one', () => {
    const rects = paint(moved, { onlyItems: new Set([LOOSE]) });
    expect(near(rects, NEW)).toBe(true);
  });

  it('so across the two halves the mark exists once, at the cursor', () => {
    const all = [
      ...paint(base, { hiddenItems: new Set([LOOSE]) }),
      ...paint(moved, { onlyItems: new Set([LOOSE]) }),
    ];
    expect(all.filter((r) => near([r], NEW))).toHaveLength(1);
    expect(near(all, OLD)).toBe(false);
  });

  it('and without a drag it is simply drawn where the label is', () => {
    expect(near(paint(base, {}), OLD)).toBe(true);
  });
});

describe('the marks of everything else are left alone', () => {
  // `TestDanglingEnds` is part of the commit upstream, not of the move loop, so
  // a drag must not re-test the rest of the sheet — and the base plus preview
  // must still draw the sheet exactly once between them.
  const base = sheet(OLD_MM);

  it('a mark belonging to an item that is not moving stays in the base', () => {
    // Hiding the loose label must not disturb anything at the wire.
    const plain = paint(base, {});
    const hidden = paint(base, { hiddenItems: new Set([LOOSE]) });
    expect(hidden).toHaveLength(plain.length - 1);
  });
});

describe("dragging a symbol's reference or value text", () => {
  /**
   * A selected field draws an anchor cross, and a field being moved on its own
   * draws an umbilical back to its symbol instead:
   *
   *     if( aField->IsMoving() && !parentMoving )  draw line field -> parent
   *     else if( aField->IsSelected() && !parentMoving )  drawAnchor( field pos )
   *
   * That pass walked the document without consulting `hiddenItems` /
   * `onlyItems`, so the base drew the cross at the field's *old* position for
   * the length of the drag — the same symptom as the dangling square, and the
   * reason the cross appeared to hop only on release.
   */
  const withSymbol = (fieldX: number): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "s1")
          (property "Reference" "R1" (at ${fieldX} 95 0)
            (effects (font (size 1.27 1.27))))
          (property "Value" "10k" (at 107 100 0)
            (effects (font (size 1.27 1.27))))))`),
    );
  const FIELD = 's1:field0';
  const crosses = (doc: Schematic, extra: Partial<typeof DEFAULT_RENDER_OPTS>): number => {
    // The cross is two strokeLine calls; count segments through a line spy.
    let n = 0;
    const s = spy();
    const ctx = s.ctx as unknown as { moveTo: unknown };
    const seen: { x: number; y: number }[] = [];
    (ctx as { moveTo: (x: number, y: number) => void }).moveTo = (x, y) => {
      seen.push({ x, y });
    };
    setVectorText(true);
    try {
      renderSchematic(
        s.ctx,
        doc,
        { scale: 0.0005, offsetX: 0, offsetY: 0 },
        KICAD_DEFAULT,
        1400,
        1000,
        new Set([FIELD]),
        undefined,
        {
          ...DEFAULT_RENDER_OPTS,
          grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
          showDrawingSheet: false,
          ...extra,
        },
      );
    } finally {
      setVectorText(false);
    }
    // Strokes that start level with the field row are the cross's two arms.
    for (const p of seen) if (Math.abs(p.y - mmToIU(95)) < mmToIU(2)) n++;
    return n;
  };

  it('draws the anchor when nothing is being dragged', () => {
    expect(crosses(withSymbol(105), {})).toBeGreaterThan(0);
  });

  it('but the base leaves it out once the field is being dragged', () => {
    const base = crosses(withSymbol(105), { hiddenItems: new Set([FIELD]) });
    const plain = crosses(withSymbol(105), {});
    expect(base).toBeLessThan(plain);
  });
});
