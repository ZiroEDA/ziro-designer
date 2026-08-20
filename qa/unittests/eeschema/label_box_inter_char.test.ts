// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A schematic text box is the glyph run *minus its last side bearing*.
 *
 * `STROKE_FONT::GetTextAsGlyphs` (`common/font/stroke_font.cpp:281-286`) closes
 * the run's box at
 *
 *     aBBox->SetOrigin( aPosition );
 *     aBBox->SetEnd( cursor.x - KiROUND( glyphSize.x * INTER_CHAR ),
 *                    cursor.y - glyphSize.y );
 *
 * with `constexpr double INTER_CHAR = 0.2` (`stroke_font.cpp:207`): every
 * Newstroke advance carries a trailing bearing so the next glyph does not touch
 * it, and the box of the *whole run* does not include the last one.
 * `FONT::StringBoundaryLimits` (`common/font/font.cpp:451-478`) then inflates a
 * stroke run by `KiROUND( aThickness * 1.5 )` on every side.
 *
 * `bbox.ts`'s `textBoxWidth` added the inflate and omitted the trim, so every
 * label, hierarchical label, sheet pin and free text on a schematic was boxed
 * `0.2 · size` — 10 mil at the default 50 mil text — wider than KiCad boxes it.
 * `fieldbox.ts`, written for symbol fields, has always had the term.
 *
 * None of the existing label tests could see this: they assert which *side* of
 * the anchor a box falls on, never its width. So the numbers below are computed
 * from `measureText` and the two C++ constants, never from `textBoxWidth`.
 */
import { describe, expect, it } from 'vitest';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';
import {
  globalLabelShape,
  labelTextBox,
  textBoxWidth,
  textPenWidth,
} from '@ziroeda/eeschema/src/tools/bbox.js';
import { fieldTextBox } from '@ziroeda/eeschema/src/fieldbox.js';
import type { SchField, SchLabel } from '@ziroeda/eeschema/src/types.js';

/** `KiROUND`: half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

const SIZE = 1_270_000; // the default 50 mil, in schematic IU
const INTER_CHAR = 0.2;

/** `FONT::StringBoundaryLimits().x` for a stroke run, written out from the C++. */
const limitsFromCpp = (text: string, size: number, thickness: number): number =>
  measureText(text, size) - kiRound(size * INTER_CHAR) + 2 * kiRound(thickness * 1.5);

describe('textBoxWidth is FONT::StringBoundaryLimits', () => {
  for (const text of ['IIII', 'WWWW', 'VCC', 'a']) {
    it(`matches the C++ extent for "${text}"`, () => {
      const pen = textPenWidth(SIZE, false);
      expect(textBoxWidth(text, SIZE)).toBe(limitsFromCpp(text, SIZE, pen));
    });
  }

  it('trims exactly one INTER_CHAR bearing, whatever the string length', () => {
    // The trim is per *run*, not per glyph: a four-character string loses the
    // same 0.2 · size as a one-character one.
    const pen = textPenWidth(SIZE, false);
    const raw = (t: string): number => measureText(t, SIZE) + 2 * kiRound(pen * 1.5);
    expect(raw('a') - textBoxWidth('a', SIZE)).toBe(kiRound(SIZE * INTER_CHAR));
    expect(raw('abcd') - textBoxWidth('abcd', SIZE)).toBe(kiRound(SIZE * INTER_CHAR));
    // 0.2 · 50 mil = 10 mil = 254000 IU.
    expect(kiRound(SIZE * INTER_CHAR)).toBe(254_000);
  });

  it('is bold-aware through the pen, not through the trim', () => {
    const boldPen = textPenWidth(SIZE, true);
    expect(textBoxWidth('VCC', SIZE, true)).toBe(limitsFromCpp('VCC', SIZE, boldPen));
    expect(textBoxWidth('VCC', SIZE, true)).toBeGreaterThan(textBoxWidth('VCC', SIZE, false));
  });

  it('agrees with fieldbox.ts, which had the term all along', () => {
    // Same maths, two files: the field box's extent, less its own pen inflate,
    // equals the label box's extent less its own. Only the default pen differs
    // (SCH_FIELD derives it from the size; a label uses the sheet's 6 mil).
    const field = {
      key: 'Value',
      value: 'VCC',
      at: { x: 0, y: 0 },
      effects: { fontSize: [SIZE, SIZE] as [number, number], justify: ['left'] },
    } as unknown as SchField;
    const fieldPen = kiRound(SIZE / 8); // EDA_TEXT::GetEffectiveTextPenWidth( 0 )
    const fieldInk = fieldTextBox(field, 'VCC').w - 2 * kiRound(fieldPen * 1.5);
    const labelInk = textBoxWidth('VCC', SIZE) - 2 * kiRound(textPenWidth(SIZE, false) * 1.5);
    expect(labelInk).toBe(fieldInk);
  });
});

describe('the box a user actually sees', () => {
  const label = (text: string): SchLabel =>
    ({
      kind: 'label',
      text,
      at: { x: 0, y: 0 },
      angle: 0,
      effects: { fontSize: [SIZE, SIZE], justify: ['left'] },
    }) as unknown as SchLabel;

  it('a label box is exactly the C++ extent wide', () => {
    const b = labelTextBox('VCC', SIZE, false, ['left'], { x: 0, y: 0 });
    expect(b.maxX - b.minX).toBe(limitsFromCpp('VCC', SIZE, textPenWidth(SIZE, false)));
  });

  it("a global label's drawn flag shrinks with it", () => {
    // `SCH_GLOBALLABEL::CreateGraphicShape` sizes the flag from
    // `GetTextBox().GetWidth()`, so the outline the user sees was 0.2 · size
    // too long. This is drawn geometry, not just a hit box.
    const pts = globalLabelShape({ ...label('VCC'), kind: 'global_label' } as SchLabel);
    const width = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    // GetLabelBoxExpansion = DEFAULT_LABEL_SIZE_RATIO * GetTextHeight().
    const margin = 0.375 * SIZE;
    const pen = textPenWidth(SIZE, false);
    const symbLen = limitsFromCpp('VCC', SIZE, pen) + 2 * margin;
    const x = symbLen + pen + 3;
    // A bidirectional flag points at both ends: `aPoints[0].x += halfSize` and
    // `aPoints[3].x -= halfSize`, so the drawn outline spans x + 2 · halfSize.
    const halfSize = SIZE / 2 + margin;
    expect(width).toBeCloseTo(x + 2 * halfSize, 6);
  });
});
