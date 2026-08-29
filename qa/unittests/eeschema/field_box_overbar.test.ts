// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * An overbar makes a text box TALLER, and that changes where the text is drawn.
 *
 * `EDA_TEXT::GetTextBox` (`common/eda_text.cpp`) grows the height for an
 * overbar, because the bar climbs above the nominal ascent:
 *
 *     int fudgeFactor = KiROUND( extents.y * 0.17 );
 *     if( font->IsStroke() ) textsize.y += fudgeFactor;
 *     if( text.Contains( wxT( "~{" ) ) ) overbarOffset = extents.y / 6;
 *     textsize.y += overbarOffset;
 *     bbox.SetSize( textsize );
 *
 * WHY THIS IS VISIBLE AND NOT BOOKKEEPING. `SCH_PAINTER::draw( const SCH_FIELD* )`
 * throws the field's own justification away —
 *
 *     VECTOR2I textpos = bbox.Centre();
 *     attributes.m_Halign = GR_TEXT_H_ALIGN_CENTER;
 *     attributes.m_Valign = GR_TEXT_V_ALIGN_CENTER;
 *
 * — with the comment that justification after a mirror is "complicated to
 * calculate so the easier way is to use no justifications (centered text) and
 * use GetBoundingBox to know the text coordinate considered as centered". So
 * the bounding box is not a hit-test detail: it is the *only* thing deciding
 * where the glyphs land. A box that is `extents.y / 6` too short puts the text
 * half that distance off, on screen, for every field carrying an overbar.
 *
 * TWO PORTS OF ONE FUNCTION. `EDA_TEXT` is the base class of both `SCH_FIELD`
 * and `SCH_LABEL`, and upstream has exactly one `GetTextBox`. We have two —
 * `fieldbox.ts`'s `fieldTextBox` and `bbox.ts`'s `labelTextBox` — and they had
 * drifted apart in *both* directions: `label_box_inter_char.test.ts` records
 * the width term the label copy was missing, and the height term here is the
 * one the field copy was missing. The label copy had it but wrote
 * `Math.round( extentsY / 6 )` where C++ divides two ints and truncates.
 *
 * The sizes below are chosen so those two spellings disagree: `extentsY` is
 * 1746250 IU and 1746250 / 6 = 291041.67, so trunc gives 291041 and round
 * gives 291042. A test at a size divisible by six could not tell them apart.
 *
 * Every expectation is built from the size, the pen and the three C++
 * constants. Nothing here asks the code under test what it thinks.
 */
import { describe, expect, it } from 'vitest';
import { fieldTextBox } from '@ziroeda/eeschema/src/fieldbox.js';
import { labelTextBox, textPenWidth } from '@ziroeda/eeschema/src/tools/bbox.js';
import type { SchField } from '@ziroeda/eeschema/src/types.js';

/** `KiROUND`: half away from zero. */
const kiRound = (v: number): number => Math.sign(v) * Math.round(Math.abs(v));

/** 1.27 mm, the default schematic text size, in internal units. */
const SIZE = 1270000;

/**
 * `extents.y` as `FONT::StringBoundaryLimits` returns it: the nominal height
 * inflated by `KiROUND( thickness * 1.5 )` on the top and on the bottom.
 * `thickness` is `GetEffectiveTextPenWidth( 0 )`, which for unbold text is the
 * normal pen, `KiROUND( size / 8 )`.
 */
const PEN = kiRound(SIZE / 8); //   158750
const EXTENTS_Y = SIZE + 2 * kiRound(PEN * 1.5); // 1746250
const FUDGE = kiRound(EXTENTS_Y * 0.17); //  296863
const OVERBAR = Math.trunc(EXTENTS_Y / 6); //  291041

const field = (value: string, justify: string[]): SchField =>
  ({
    key: 'Value',
    value,
    at: { x: 0, y: 0 },
    angle: 0,
    effects: { fontSize: [SIZE, SIZE] as [number, number], justify },
  }) as unknown as SchField;

describe('SCH_FIELD: an overbar grows the box (EDA_TEXT::GetTextBox)', () => {
  it('plain text is the inflated extent plus the stroke fudge', () => {
    expect(fieldTextBox(field('RESET', ['left']), 'RESET').h).toBe(EXTENTS_Y + FUDGE);
  });

  it('overbarred text adds extents.y / 6 on top of that', () => {
    expect(fieldTextBox(field('~{RESET}', ['left']), '~{RESET}').h).toBe(
      EXTENTS_Y + FUDGE + OVERBAR,
    );
  });

  // The whole point: the painter centres the glyphs in this box, so where the
  // box grows asymmetrically about the anchor, the drawn text MOVES. Asserting
  // only the height would let a mutant that grows the box the other way
  // survive, and that mutant draws the text in the wrong place.
  const centre = (b: { y: number; h: number }) => b.y + Math.trunc(b.h / 2);

  it('a top-justified field hangs off a fixed top edge, so its centre drops', () => {
    const plain = fieldTextBox(field('RESET', ['top', 'left']), 'RESET');
    const bar = fieldTextBox(field('~{RESET}', ['top', 'left']), '~{RESET}');
    // Both start at -FUDGE; only the height differs, so the centre moves by the
    // difference of the two half-heights (each truncated, as C++ truncates).
    expect(centre(bar) - centre(plain)).toBe(
      Math.trunc((EXTENTS_Y + FUDGE + OVERBAR) / 2) - Math.trunc((EXTENTS_Y + FUDGE) / 2),
    );
    expect(centre(bar)).toBeGreaterThan(centre(plain));
  });

  // The counterpart, and the reason the case above had to be top-justified:
  // a centred box grows equally on both sides, so the glyphs do NOT move. This
  // is correct upstream behaviour and is pinned so nobody "fixes" it.
  it('but a centre-justified field grows symmetrically and does not move', () => {
    const plain = fieldTextBox(field('RESET', ['left']), 'RESET');
    const bar = fieldTextBox(field('~{RESET}', ['left']), '~{RESET}');
    expect(centre(plain)).toBe(0);
    expect(centre(bar)).toBe(0);
  });

  // C++ divides two ints. At this size round() would say 291042.
  it('truncates the division rather than rounding it', () => {
    const h = fieldTextBox(field('~{RESET}', ['left']), '~{RESET}').h;
    expect(h - (EXTENTS_Y + FUDGE)).toBe(291041);
    expect(h - (EXTENTS_Y + FUDGE)).not.toBe(Math.round(EXTENTS_Y / 6));
  });

  // The vertical switch offsets by `fudgeFactor`, which is computed BEFORE the
  // overbar is added and does not include it. Only the height carries it.
  it('the top offset stays on the fudge alone, not fudge plus overbar', () => {
    const plain = fieldTextBox(field('RESET', ['top', 'left']), 'RESET');
    const bar = fieldTextBox(field('~{RESET}', ['top', 'left']), '~{RESET}');
    expect(plain.y).toBe(-FUDGE);
    expect(bar.y).toBe(-FUDGE);
  });

  it('the bottom offset likewise, so only the height differs', () => {
    const bar = fieldTextBox(field('~{RESET}', ['bottom', 'left']), '~{RESET}');
    expect(bar.y).toBe(-(EXTENTS_Y + FUDGE + OVERBAR) + FUDGE);
  });

  it('a tilde that opens no overbar does not grow anything', () => {
    expect(fieldTextBox(field('A~B', ['left']), 'A~B').h).toBe(EXTENTS_Y + FUDGE);
  });
});

describe('SCH_LABEL: the same term, truncated the same way', () => {
  // The label copy derives its pen differently, so it is measured on its own
  // terms rather than reusing the field constants above.
  const labelPen = textPenWidth(SIZE, false);
  const labelExtentsY = SIZE + 3 * labelPen;
  const labelFudge = Math.round(labelExtentsY * 0.17);

  it('adds extents.y / 6 for an overbar', () => {
    const plain = labelTextBox('RESET', SIZE, false, ['left'], { x: 0, y: 0 });
    const bar = labelTextBox('~{RESET}', SIZE, false, ['left'], { x: 0, y: 0 });
    expect(bar.maxY - bar.minY - (plain.maxY - plain.minY)).toBe(Math.trunc(labelExtentsY / 6));
  });

  it('truncates rather than rounds, where the two disagree', () => {
    expect(labelExtentsY % 6).not.toBe(0); // else the case proves nothing
    expect(Math.trunc(labelExtentsY / 6)).not.toBe(Math.round(labelExtentsY / 6));
    const plain = labelTextBox('RESET', SIZE, false, ['left'], { x: 0, y: 0 });
    const bar = labelTextBox('~{RESET}', SIZE, false, ['left'], { x: 0, y: 0 });
    expect(bar.maxY - bar.minY - (plain.maxY - plain.minY)).not.toBe(Math.round(labelExtentsY / 6));
  });

  it('and the fudge is unchanged by it', () => {
    expect(labelFudge).toBeGreaterThan(0);
    const plain = labelTextBox('RESET', SIZE, false, ['top'], { x: 0, y: 0 });
    expect(plain.minY).toBe(-labelFudge);
  });
});
