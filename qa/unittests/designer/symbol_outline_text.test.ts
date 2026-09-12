// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The symbol editor draws a faced field with the same `FONT::Draw` port the
 * schematic uses: filled glyph polygons, not a stroked Newstroke run.
 *
 * `drawField` is the one text entry the symbol renderer exports. It is run
 * against a context that records what was asked of it; a field in Arial
 * has to end in `fill()` over closed rings, and the same field with no face
 * — or with the face not yet loaded — in `stroke()` of the retained path.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { drawField } from '@ziroeda/designer/src/editors/symbol/render/symbolRenderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  getOutlineFont,
  resetOutlineFonts,
  setFaceFetcher,
} from '@ziroeda/designer/src/font/outline_fonts.js';
import type { SchField } from '@ziroeda/eeschema';

const FONTS = fileURLToPath(new URL('../../../designer/public/fonts/', import.meta.url));

function spy() {
  const calls: string[] = [];
  let moves = 0;
  let closes = 0;
  const noop = (): void => {};
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: () => {
      closes++;
    },
    moveTo: () => {
      moves++;
    },
    lineTo: noop,
    fill: () => {
      calls.push('fill');
    },
    fillRect: () => {
      calls.push('fillRect');
    },
    stroke: () => {
      calls.push('stroke');
    },
  };
  return {
    calls,
    rings: () => closes,
    moves: () => moves,
    ctx: ctx as unknown as CanvasRenderingContext2D,
  };
}

const field = (face?: string): SchField =>
  ({
    key: 'Value',
    value: 'Hello',
    at: { x: 0, y: 0 },
    angle: 0,
    effects: { fontSize: [12700, 12700], ...(face ? { face } : {}) },
  }) as unknown as SchField;

afterEach(() => resetOutlineFonts());

// The stroke path retains a DOM `Path2D`, which node has not got; the fake
// only has to be constructible and accept the path calls.
class FakePath2D {
  moveTo(): void {}
  lineTo(): void {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= FakePath2D;

async function loadArial(): Promise<void> {
  setFaceFetcher(async (file) => {
    const b = readFileSync(FONTS + file);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  getOutlineFont('Arial');
  await new Promise((r) => setTimeout(r, 30));
  expect(getOutlineFont('Arial')).not.toBeNull();
}

describe('symbol editor: a faced field', () => {
  it('is filled as glyph rings once its face has loaded', async () => {
    await loadArial();
    const s = spy();
    drawField(s.ctx, field('Arial'), KICAD_DEFAULT, false);
    expect(s.calls).toEqual(['fill']);
    // "Hello": H, e (2 rings), l, l, o (2 rings) — seven closed rings.
    expect(s.rings()).toBe(7);
  });

  it('is stroked as Newstroke with no face, and while the face is still loading', () => {
    const s1 = spy();
    drawField(s1.ctx, field(), KICAD_DEFAULT, false);
    expect(s1.calls).toEqual(['stroke']);
    setFaceFetcher(() => new Promise(() => {}));
    const s2 = spy();
    drawField(s2.ctx, field('Arial'), KICAD_DEFAULT, false);
    expect(s2.calls).toEqual(['stroke']);
  });
});
