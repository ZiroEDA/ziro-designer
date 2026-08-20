// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pen a board text is stroked with comes from its **width**, not its height.
 *
 * `EDA_TEXT::GetEffectiveTextPenWidth` (`common/eda_text.cpp:1093-1108`):
 *
 *     int penWidth = GetTextThickness();
 *     if( penWidth <= 1 )
 *     {
 *         penWidth = aDefaultPenWidth;
 *         if( IsBold() )       penWidth = GetPenSizeForBold( GetTextWidth() );
 *         else if( penWidth <= 1 ) penWidth = GetPenSizeForNormal( GetTextWidth() );
 *     }
 *     penWidth = ClampTextPenSize( penWidth, GetTextSize() );
 *
 * `GetTextWidth()` is `GetTextSize().x`; `GetPenSizeForBold/Normal` are
 * `KiROUND( aTextSize / 5.0 )` and `KiROUND( aTextSize / 8.0 )`
 * (`common/gr_text.cpp:37-70`); and the `VECTOR2I` overload of
 * `ClampTextPenSize` (`gr_text.cpp:91-96`) clamps against
 * `min( abs( x ), abs( y ) ) * 0.25`.
 *
 * `renderBoard.ts` derived the pen from `size.y` and clamped against `size.y`
 * alone, which is invisible for square text and wrong for every condensed or
 * expanded one: a `(size 1.5 0.6)` silkscreen name was stroked at 0.1875 mm
 * where pcbnew strokes it at 0.075 mm — 2.5× too heavy, enough to fill in the
 * counters of the glyphs.
 *
 * The scene keys its text paths by pen width, so the bucket key *is* the pen.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

class RecordingPath2D {
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  arcTo(): void {}
  rect(): void {}
  roundRect(): void {}
  closePath(): void {}
  addPath(): void {}
}
(globalThis as unknown as { Path2D: unknown }).Path2D = RecordingPath2D;

/** `KiROUND`: half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** `(size H W)` in the file; a text at `(at 50 50)` on F.SilkS. */
const board = (font: string): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (gr_text "CONDENSED" (at 50 50) (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000001")
    (effects (font ${font})))
)`),
  );

/** The pen widths the F.SilkS board-text bucket is keyed by. */
const pens = (font: string): number[] => [
  ...(
    buildScene(board(font)).layers.get('F.SilkS') as unknown as {
      textBoard: Map<number, unknown>;
    }
  ).textBoard.keys(),
];

describe('EDA_TEXT::GetEffectiveTextPenWidth on the board', () => {
  it('takes a normal pen from GetTextWidth(), not the height', () => {
    // (size 1.5 0.6) = height 1.5 mm, width 0.6 mm.
    expect(pens('(size 1.5 0.6)')).toEqual([kiRound(mmToIU(0.6) / 8)]);
    // Which is emphatically not what the height would have given.
    expect(pens('(size 1.5 0.6)')).not.toEqual([kiRound(mmToIU(1.5) / 8)]);
  });

  it('takes a bold pen from GetTextWidth() too', () => {
    expect(pens('(size 1.5 0.6) (bold yes)')).toEqual([kiRound(mmToIU(0.6) / 5)]);
  });

  it('clamps against the smaller dimension, not the height', () => {
    // Height 4 mm, width 0.4 mm: the bold pen would be 0.08 mm, and
    // ClampTextPenSize caps it at min(0.4, 4) * 0.25 = 0.1 mm — no change here,
    // but the clamp must read the width. Make the pen exceed it: a stored
    // thickness of 1 mm on a 0.4 mm-wide text clamps to 0.1 mm, where clamping
    // against the 4 mm height would have left the full 1 mm.
    expect(pens('(size 4 0.4) (thickness 1)')).toEqual([kiRound(mmToIU(0.4) * 0.25)]);
    expect(kiRound(mmToIU(0.4) * 0.25)).toBeLessThan(mmToIU(1));
  });

  it('lets a stored thickness above 1 win outright for square text', () => {
    expect(pens('(size 1 1) (thickness 0.15)')).toEqual([mmToIU(0.15)]);
  });

  it('is unchanged for square text, which is why this went unnoticed', () => {
    expect(pens('(size 1 1)')).toEqual([kiRound(mmToIU(1) / 8)]);
  });
});
