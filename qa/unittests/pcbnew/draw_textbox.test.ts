// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a text box.
 * Counterparts: `DRAWING_TOOL::DrawRectangle` with `isTextBox` (the same
 * handler as `drawRectangle` — the action decides), `PCB_TEXTBOX`'s
 * constructor and `PCB_SHAPE::Normalize`.
 *
 * Two things here are easy to skip and would only show up in a saved file:
 *
 * - **Normalize.** Dragging up-and-left gives `start > end`. Everything in
 *   memory copes, so nothing looks wrong — but the file would carry a rectangle
 *   KiCad itself never writes.
 * - **The margins are a function of the style, not a constant.**
 *   `GetLegacyTextMargin` is half the border stroke plus three quarters of the
 *   text height, so a box drawn with bigger text gets proportionally more
 *   padding. A fixed default would crowd the text against its own border at
 *   large sizes.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { addBoardTextBox } from '@ziroeda/pcbnew/src/edit-board.js';
import {
  DEFAULT_TEXTBOX_DEFAULTS,
  isDrawableTextBox,
  legacyTextMargin,
  newTextBox,
  normalizeCorners,
} from '@ziroeda/pcbnew/src/draw_textbox.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): { x: number; y: number } => ({ x: MM(x), y: MM(y) });

const EMPTY_BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 ""))`;
const emptyBoard = (): Board => readBoard(parse(EMPTY_BOARD));

describe('normalising the two corners', () => {
  it('leaves a box drawn down-and-right alone', () => {
    expect(normalizeCorners(P(10, 10), P(20, 15))).toEqual({
      start: P(10, 10),
      end: P(20, 15),
    });
  });

  it('swaps a box drawn up-and-left', () => {
    // PCB_SHAPE::Normalize. Nothing in memory minds start > end, so this only
    // shows up as a file KiCad would not have written.
    expect(normalizeCorners(P(20, 15), P(10, 10))).toEqual({
      start: P(10, 10),
      end: P(20, 15),
    });
  });

  it('normalises each axis independently', () => {
    // Dragging right-and-up: x is already in order, y is not.
    expect(normalizeCorners(P(10, 15), P(20, 10))).toEqual({
      start: P(10, 10),
      end: P(20, 15),
    });
  });
});

describe('what counts as a drawable box', () => {
  it('accepts a real rectangle', () => {
    expect(isDrawableTextBox(P(0, 0), P(10, 5))).toBe(true);
  });

  it('refuses a zero-width or zero-height one', () => {
    expect(isDrawableTextBox(P(0, 0), P(0, 5))).toBe(false);
    expect(isDrawableTextBox(P(0, 0), P(10, 0))).toBe(false);
  });

  it('refuses a second click on the first', () => {
    expect(isDrawableTextBox(P(3, 3), P(3, 3))).toBe(false);
  });
});

describe('the default margin', () => {
  it('is half the border plus three quarters of the text height', () => {
    // Stated as arithmetic, not by calling the function under test.
    expect(legacyTextMargin(MM(2), MM(0.2))).toBe(MM(0.1) + MM(1.5));
  });

  it('grows with the text, which is the point of it', () => {
    const small = legacyTextMargin(MM(1), MM(0.1));
    const large = legacyTextMargin(MM(4), MM(0.1));

    expect(large).toBeGreaterThan(small * 3);
  });

  it('grows with the border too', () => {
    expect(legacyTextMargin(MM(1), MM(1))).toBeGreaterThan(legacyTextMargin(MM(1), MM(0.1)));
  });
});

describe('a freshly drawn box', () => {
  it('spans the normalised corners', () => {
    const b = newTextBox(P(20, 15), P(10, 10));

    expect(b.start).toEqual(P(10, 10));
    expect(b.end).toEqual(P(20, 15));
  });

  it('starts with no text, because the dialog supplies it', () => {
    expect(newTextBox(P(0, 0), P(10, 5)).text).toBe('');
  });

  it('has a border on, as PCB_TEXTBOX constructs it', () => {
    expect(newTextBox(P(0, 0), P(10, 5)).border).toBe(true);
  });

  it('is left-aligned, storing only the non-default word', () => {
    // The ctor sets LEFT and CENTER; centre is what the file means by silence,
    // so only `left` belongs in the token.
    expect(newTextBox(P(0, 0), P(10, 5)).justify).toEqual(['left']);
  });

  it('takes all four margins from the style', () => {
    const d = { ...DEFAULT_TEXTBOX_DEFAULTS, textSize: MM(2), borderWidth: MM(0.2) };
    const b = newTextBox(P(0, 0), P(10, 5), d);
    const expected = MM(0.1) + MM(1.5);

    expect(b.margins).toEqual({
      left: expected,
      top: expected,
      right: expected,
      bottom: expected,
    });
  });

  it('takes the layer and style it is given', () => {
    const b = newTextBox(P(0, 0), P(10, 5), {
      layer: 'Cmts.User',
      textSize: MM(3),
      textThickness: MM(0.4),
      borderWidth: MM(0.25),
      borderStyle: 'dash',
    });

    expect(b.layer).toBe('Cmts.User');
    expect(b.size).toEqual({ x: MM(3), y: MM(3) });
    expect(b.thickness).toBe(MM(0.4));
    expect(b.strokeWidth).toBe(MM(0.25));
    expect(b.strokeType).toBe('dash');
  });

  it('is not knocked out', () => {
    expect(newTextBox(P(0, 0), P(10, 5)).knockout).toBe(false);
  });
});

describe('committing it to the board', () => {
  it('appends it and hands back its id', () => {
    const { board, id } = addBoardTextBox(emptyBoard(), newTextBox(P(0, 0), P(10, 5)));

    expect(id).toBe('textbox:0');
    expect(board.textBoxes).toHaveLength(1);
  });

  it('writes it into the file and reads it back', () => {
    // Source-less, so the writer builds the node from the model.
    const { board } = addBoardTextBox(emptyBoard(), newTextBox(P(20, 15), P(10, 10)));
    const back = readBoard(parse(serializeBoard(board)));

    expect(back.textBoxes).toHaveLength(1);
    expect(back.textBoxes[0]!.start).toEqual(P(10, 10));
    expect(back.textBoxes[0]!.end).toEqual(P(20, 15));
    expect(back.textBoxes[0]!.border).toBe(true);
  });

  it('keeps the margins through a save', () => {
    const d = { ...DEFAULT_TEXTBOX_DEFAULTS, textSize: MM(2), borderWidth: MM(0.2) };
    const { board } = addBoardTextBox(emptyBoard(), newTextBox(P(0, 0), P(10, 5), d));
    const back = readBoard(parse(serializeBoard(board)));

    expect(back.textBoxes[0]!.margins.left).toBe(MM(0.1) + MM(1.5));
  });

  it('appends to the boxes already there, rather than replacing them', () => {
    // Adding to an *empty* board cannot tell an append from a replace, which is
    // the same blind spot that let #320 ship.
    const first = addBoardTextBox(emptyBoard(), newTextBox(P(0, 0), P(10, 5)));
    const { board, id } = addBoardTextBox(first.board, newTextBox(P(30, 30), P(40, 35)));

    expect(board.textBoxes).toHaveLength(2);
    expect(id).toBe('textbox:1');
    expect(board.textBoxes[0]!.start).toEqual(P(0, 0));
    expect(board.textBoxes[1]!.start).toEqual(P(30, 30));
  });

  it('leaves the rest of the board alone', () => {
    const b = emptyBoard();
    const { board } = addBoardTextBox(b, newTextBox(P(0, 0), P(10, 5)));

    expect(board.shapes).toBe(b.shapes);
    expect(board.texts).toBe(b.texts);
  });
});
