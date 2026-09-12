// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a plain SCH_TEXT is drawn from: `SCH_TEXT::GetSchematicTextOffset`'s
 * constant quarter-millimetre lift, and `GetOffsetToMatchSCH_FIELD`'s
 * outline-only 0.4 × (box − size). See `schTextDrawPos` for the C++.
 *
 * [px] kicad-cli's SVG of qa/data/font/fonttest.kicad_sch: the Newstroke
 * row's baseline is 0.69 mm above its anchor (0.25 + 0.17 × 2.54), the
 * Arial row's 1.255 mm (0.25 + 0.4318 + 0.573).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { schTextDrawPos } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import {
  getOutlineFont,
  resetOutlineFonts,
  setFaceFetcher,
} from '@ziroeda/designer/src/font/outline_fonts.js';

const FONTS = fileURLToPath(new URL('../../../designer/public/fonts/', import.meta.url));

afterEach(() => resetOutlineFonts());

async function loadArial(): Promise<void> {
  setFaceFetcher(async (file) => {
    const b = readFileSync(FONTS + file);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  getOutlineFont('Arial');
  // The fetch resolves on a later tick; the second ask finds the face.
  await new Promise((r) => setTimeout(r, 20));
  expect(getOutlineFont('Arial')).not.toBeNull();
}

describe('schTextDrawPos', () => {
  it('a stroke-font text is lifted 2500 IU, whatever its angle', () => {
    expect(schTextDrawPos({ at: { x: 254000, y: 203200 }, angle: 0, text: 'x' }, 25400)).toEqual({
      x: 254000,
      y: 200700,
    });
    expect(schTextDrawPos({ at: { x: 254000, y: 203200 }, angle: 90, text: 'x' }, 25400)).toEqual({
      x: 254000,
      y: 200700,
    });
  });

  it('an outline-font text is lifted a further 0.4 × (ascender + descender − size)', async () => {
    await loadArial();
    const at = { x: 254000, y: 203200 };
    const pos = schTextDrawPos(
      { at, angle: 0, text: 'Arial Hello', effects: { face: 'Arial', hidden: false } },
      25400,
    );
    // Liberation Sans: (1854 + 434) / 2048 em × 1.4 × 25400 × 1432/1433 − 25400 = 14299; × 0.4 = 5720.
    expect(pos.x).toBe(254000);
    expect(203200 - 2500 - pos.y).toBe(5720);
    // Rotated 90°, the lift becomes a shift to the left: RotatePoint (x, y) → (y, -x).
    const rot = schTextDrawPos(
      { at, angle: 90, text: 'Arial Hello', effects: { face: 'Arial', hidden: false } },
      25400,
    );
    expect(rot).toEqual({ x: 254000 - 5720, y: 200700 });
  });

  it('a face still loading is drawn as the stroke font, with the stroke lift only', () => {
    setFaceFetcher(() => new Promise(() => {}));
    const pos = schTextDrawPos(
      { at: { x: 0, y: 0 }, angle: 0, text: 'x', effects: { face: 'Arial', hidden: false } },
      25400,
    );
    expect(pos).toEqual({ x: 0, y: -2500 });
  });
});
