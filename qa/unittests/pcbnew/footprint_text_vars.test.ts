// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `${REFERENCE}` and `${VALUE}` follow the field they quote.
 *
 * Every KiCad footprint library since v6 carries a third text on F.Fab whose
 * content is the literal `${REFERENCE}`. The text keeps that literal;
 * `EDA_TEXT::GetShownText` -> `FOOTPRINT::ResolveTextVar` substitutes it every
 * time the item is drawn, so it can never go stale - which is exactly what a
 * bake-once reader got wrong, leaving every netlist-added footprint labelled
 * "REF**" on F.Fab beside its real designator on the silkscreen.
 */
import { describe, it, expect } from 'vitest';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD, BOARD_USE } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { ParseFootprintFile } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

/** A library footprint the way KiCad ships one: REF** plus a `${REFERENCE}`. */
const SRC = `(footprint "D_DO-41"
  (version 20241229) (generator "pcbnew")
  (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -2.5 0) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "D_DO-41" (at 0 2.5 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (fp_text user "\${REFERENCE}" (at 0 0 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (fp_text user "\${VALUE}" (at 0 4 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (pad "1" thru_hole circle (at -5 0) (size 1.6 1.6) (drill 0.9) (layers "*.Cu"))
)
`;

/** The footprint on a board of that use, as the editor or pcbnew holds it. */
const onBoard = (use: BOARD_USE = BOARD_USE.NORMAL): FOOTPRINT => {
  const board = new BOARD();
  board.SetBoardUse(use);
  const fp = ParseFootprintFile(SRC);
  board.Add(fp);
  return fp;
};
const userTexts = (fp: FOOTPRINT): PCB_TEXT[] =>
  fp.GraphicalItems().filter((t) => t.Type() === KICAD_T.PCB_TEXT_T) as PCB_TEXT[];
const shown = (fp: FOOTPRINT, i: number): string => userTexts(fp)[i]!.GetShownText(true);

describe('footprint text variables (FOOTPRINT::ResolveTextVar)', () => {
  it('resolves them on a board against the fields as they are now', () => {
    expect(shown(onBoard(), 0)).toBe('REF**');
    expect(shown(onBoard(), 1)).toBe('D_DO-41');
  });

  it('leaves the literal alone on an FPHOLDER board', () => {
    // `if( GetBoard() && GetBoard()->GetBoardUse() == BOARD_USE::FPHOLDER )
    // return false;` (footprint.cpp:1185-1188): the footprint editor paints
    // `${REFERENCE}`.
    expect(shown(onBoard(BOARD_USE.FPHOLDER), 0)).toBe('${REFERENCE}');
  });

  it('keeps the literal as the text itself', () => {
    const fp = onBoard();
    expect(userTexts(fp)[0]!.GetText()).toBe('${REFERENCE}');
    expect(userTexts(fp)[1]!.GetText()).toBe('${VALUE}');
  });

  it('follows a new reference, and only ${REFERENCE} does', () => {
    const fp = onBoard();
    fp.SetReference('D1');
    expect(shown(fp, 0)).toBe('D1');
    expect(shown(fp, 1)).toBe('D_DO-41');
  });

  it('follows a new value, and leaves ${REFERENCE} alone', () => {
    const fp = onBoard();
    fp.SetValue('1N4007');
    expect(shown(fp, 1)).toBe('1N4007');
    expect(shown(fp, 0)).toBe('REF**');
  });

  it('follows every rename, the literal surviving each one', () => {
    const fp = onBoard();
    fp.SetReference('D1');
    fp.SetReference('D7');
    expect(shown(fp, 0)).toBe('D7');
    expect(userTexts(fp)[0]!.GetText()).toBe('${REFERENCE}');
  });
});
