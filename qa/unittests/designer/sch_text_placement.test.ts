// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where stroke text's baseline lands, against FONT::getLinePositions
 * (common/font/font.cpp):
 *
 *     offset.y  = size.y;                      // origin a text height down
 *     height    = size.y * 1.17;               // single line, "fudge to match 6.0"
 *     IsStroke(): offset.y -= strokeWidth * 0.052;
 *                offset.x += strokeWidth / 1.52;
 *     TOP:     (nothing)
 *     CENTER:  offset.y -= height / 2;
 *     BOTTOM:  offset.y -= height;
 *
 * The case that matters visually is BOTTOM: the baseline ends up 0.17 × the
 * text height *above* the anchor, not on it. That gap is what lifts a net label
 * clear of the wire it names, placing the baseline on the anchor draws the
 * wire straight through the glyphs, which is what this guards against.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  renderSchematic,
  DEFAULT_RENDER_OPTS,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

interface Call {
  op: string;
  args: unknown[];
}

function recorder(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        return (...args: unknown[]) => calls.push({ op: String(prop), args });
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D & { __calls: Call[] };
}

class FakePath2D {
  rect(): void {}
  moveTo(): void {}
  lineTo(): void {}
}

const TEXT_H = 12700; // 1.27 mm, eeschema's default
const DEFAULT_PEN = 1524; // 6 mil
/** EDA_TEXT::GetEffectiveTextPenWidth, clamped for tiny text. */
const PEN = Math.min(DEFAULT_PEN, TEXT_H * 0.25);

const SINGLE_LINE_BLOCK = 1.17;
const STROKE_V_FUDGE = 0.052;

/** The label sits at 100 mm on a wire running through the same y. */
const SRC = `(kicad_sch (version 20250114) (lib_symbols)
  (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w1"))
  (label "NET" (at 110 100 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "l1"))
)`;

/** Every `translate` issued while rendering, in order. */
function translates(): { x: number; y: number }[] {
  const doc = readSchematic(parse(SRC));
  const ctx = recorder();
  const scale = 0.002;
  // Centre the label in the canvas, or the renderer culls it.
  renderSchematic(
    ctx,
    doc,
    { scale, offsetX: 400 - 1_100_000 * scale, offsetY: 300 - 1_000_000 * scale },
    KICAD_DEFAULT,
    800,
    600,
    new Set(),
    undefined,
    {
      ...DEFAULT_RENDER_OPTS,
      showPageLimits: false,
      showDrawingSheet: false,
      grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
    },
  );
  return ctx.__calls
    .filter((c) => c.op === 'translate')
    .map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
}

const origPath2D = globalThis.Path2D;

describe('stroke text baseline placement', () => {
  it('lifts a bottom-justified baseline above its anchor', () => {
    (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
    try {
      const ts = translates();
      // drawText: translate(anchor) then translate(offX, offY).
      expect(ts.length).toBeGreaterThanOrEqual(2);
      const offset = ts[1]!;

      // FONT::getLinePositions for BOTTOM, single line.
      const expected = TEXT_H - TEXT_H * SINGLE_LINE_BLOCK - PEN * STROKE_V_FUDGE;
      expect(offset.y).toBeCloseTo(expected, 6);

      // The point of it: negative, i.e. the glyphs clear the wire below.
      expect(offset.y).toBeLessThan(0);
      expect(Math.abs(offset.y)).toBeGreaterThan(TEXT_H * 0.15);
    } finally {
      (globalThis as { Path2D?: unknown }).Path2D = origPath2D;
    }
  });

  it('shifts a left-justified run right by the stroke fudge', () => {
    (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
    try {
      const offset = translates()[1]!;
      expect(offset.x).toBeCloseTo(PEN / 1.52, 6);
    } finally {
      (globalThis as { Path2D?: unknown }).Path2D = origPath2D;
    }
  });
});
