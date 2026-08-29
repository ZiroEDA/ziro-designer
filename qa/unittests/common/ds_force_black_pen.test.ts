// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRForceBlackPen( true )` — what a printed drawing sheet is drawn with.
 *
 * `PLEDITOR_PRINTOUT::PrintPage` wraps the whole page render in it
 * (pagelayout_editor/dialogs/dialogs_for_printing.cpp:184, cleared again at
 * :213) and forces the background to `WHITE` alongside (:187). The flag lives
 * in `common/gr_basic.cpp` and it is not a default colour: `GRSetColorPen`
 * consults `s_ForceBlackPen` on every call, so an item that asks for a colour
 * still gets black. A `(tbtext … (color 255 0 0 1))` prints black.
 *
 * Ours passed the layer colour as the base and left `d.color` to win, so a
 * coloured text item printed in its screen colour. This is the smallest test
 * that can tell the two apart: it needs an item that HAS its own colour.
 */
import { describe, expect, it } from 'vitest';
import { drawDrawingSheetItems, type DsDrawItem } from '@ziroeda/common';

/** Records the colour each draw call was made with. */
function recorder() {
  const strokes: string[] = [];
  const fills: string[] = [];
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const ctx = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    getTransform: () => ({ ...m }) as unknown as DOMMatrix,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      m = { a, b, c, d, e, f };
    },
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    rect: () => {},
    arc: () => {},
    clip: () => {},
    stroke: () => strokes.push(String(ctx.strokeStyle)),
    strokeRect: () => strokes.push(String(ctx.strokeStyle)),
    fill: () => fills.push(String(ctx.fillStyle)),
    fillRect: () => fills.push(String(ctx.fillStyle)),
    measureText: () => ({ width: 10 }),
    fillText: () => fills.push(String(ctx.fillStyle)),
    strokeText: () => strokes.push(String(ctx.strokeStyle)),
    drawImage: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, fills };
}

/**
 * A red text item and a plain segment — the two colour paths in the painter.
 * The text carries a `face`, which is what routes it through the filled-glyph
 * branch and so through `fillStyle` rather than `strokeStyle`.
 */
const ITEMS: DsDrawItem[] = [
  { kind: 'line', src: 0, a: { x: 0, y: 0 }, b: { x: 10000, y: 0 }, width: 1500 },
  {
    kind: 'text',
    src: 1,
    text: 'RED',
    at: { x: 0, y: 20000 },
    w: 15000,
    h: 15000,
    thickness: 1500,
    bold: false,
    italic: false,
    face: 'sans',
    color: { r: 255, g: 0, b: 0, a: 1 },
    hjustify: 'left',
    vjustify: 'top',
    rotate: 0,
  },
];

describe('forceBlackPen', () => {
  it('is off by default, and the red text stays red', () => {
    const { ctx, strokes, fills } = recorder();
    drawDrawingSheetItems(ctx, ITEMS, new Set());
    const used = [...strokes, ...fills].join(' ');
    expect(used).toContain('rgba(255,0,0,1)');
  });

  it('paints everything black, the item’s own colour included', () => {
    const { ctx, strokes, fills } = recorder();
    drawDrawingSheetItems(ctx, ITEMS, new Set(), { forceBlackPen: true });
    const used = [...strokes, ...fills];
    expect(used.length).toBeGreaterThan(0);
    expect(used).not.toContain('rgba(255,0,0,1)');
    for (const c of used) expect(c).toBe('#000000');
  });

  it('ignores the selection highlight too', () => {
    // `GRForceBlackPen` is consulted by every GR call, and a printout has no
    // selection to show: `PrintDrawingSheet` is handed the model, not the
    // selection tool's view of it.
    const { ctx, strokes, fills } = recorder();
    drawDrawingSheetItems(ctx, ITEMS, new Set([0, 1]), { forceBlackPen: true });
    for (const c of [...strokes, ...fills]) expect(c).toBe('#000000');
  });
});
