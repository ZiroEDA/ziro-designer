// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a reference image.
 * Counterpart: `DRAWING_TOOL::PlaceReferenceImage`.
 *
 * The tool has a file dialog in the middle of it, which is what makes it worth
 * testing at all: everything interesting is about what happens either side of a
 * modal the user can cancel. In particular Escape means one thing with an image
 * on the cursor and the opposite thing without one.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  cancelPlaceImage,
  clickImage,
  fileChosen,
  moveImage,
  newReferenceImage,
  startPlaceImage,
} from '@ziroeda/pcbnew/src/place_image.js';
import { addBoardImage } from '@ziroeda/pcbnew/src/edit-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number) => ({ x: MM(x), y: MM(y) });
const DATA = 'iVBORw0KGgo=';

describe('before a file is chosen', () => {
  it('holds no image', () => {
    const s = startPlaceImage();

    expect(s.step).toBe('awaiting-file');
    expect(s.image).toBeUndefined();
  });

  it('has nothing to move', () => {
    const s = startPlaceImage();

    expect(moveImage(s, P(10, 10))).toBe(s);
  });

  it('commits nothing on a click', () => {
    // The first click opens the file dialog; it does not place anything.
    expect(clickImage(startPlaceImage(), P(10, 10)).commit).toBeUndefined();
  });
});

describe('once a file is chosen', () => {
  const armed = fileChosen(startPlaceImage(), DATA, P(10, 20), 'F.SilkS');

  it('puts the image on the cursor', () => {
    expect(armed.step).toBe('placing');
    expect(armed.image?.at).toEqual(P(10, 20));
    expect(armed.image?.data).toBe(DATA);
  });

  it('puts it on the layer it was given, not a fixed one', () => {
    expect(fileChosen(startPlaceImage(), DATA, P(0, 0), 'B.SilkS').image?.layer).toBe('B.SilkS');
  });

  it('follows the cursor', () => {
    const moved = moveImage(armed, P(30, 40));

    expect(moved.image?.at).toEqual(P(30, 40));
    expect(moved.image?.data).toBe(DATA);
  });

  it('does not take a second file while one is already in hand', () => {
    // Upstream's first-click branch runs only `if( !image )`.
    const again = fileChosen(armed, 'AAAA', P(99, 99), 'F.Cu');

    expect(again).toBe(armed);
  });
});

describe('the second click', () => {
  it('commits the image where the cursor is, not where the file was chosen', () => {
    const armed = fileChosen(startPlaceImage(), DATA, P(10, 20), 'F.SilkS');
    const { commit } = clickImage(moveImage(armed, P(30, 40)), P(50, 60));

    expect(commit?.at).toEqual(P(50, 60));
  });

  it('leaves the tool armed for another image', () => {
    // Upstream stays in the tool after a commit — only `immediateMode`, which
    // no caller of ours uses, pops it.
    const armed = fileChosen(startPlaceImage(), DATA, P(10, 20), 'F.SilkS');
    const { state } = clickImage(armed, P(50, 60));

    expect(state.step).toBe('awaiting-file');
    expect(state.image).toBeUndefined();
  });
});

describe('escape', () => {
  it('throws away the image on the cursor but keeps the tool running', () => {
    const armed = fileChosen(startPlaceImage(), DATA, P(10, 20), 'F.SilkS');
    const { state, exitTool } = cancelPlaceImage(armed);

    expect(exitTool).toBe(false);
    expect(state.image).toBeUndefined();
    expect(state.step).toBe('awaiting-file');
  });

  it('ends the tool when there is no image to throw away', () => {
    expect(cancelPlaceImage(startPlaceImage()).exitTool).toBe(true);
  });
});

describe('a new reference image', () => {
  it('leaves scale off rather than storing 1', () => {
    // The writer omits a scale of 1, so storing one would make a round-trip
    // grow a token KiCad never writes.
    expect(newReferenceImage(DATA, P(0, 0), 'F.SilkS').scale).toBeUndefined();
  });

  it('is not locked', () => {
    expect(newReferenceImage(DATA, P(0, 0), 'F.SilkS').locked).toBeUndefined();
  });

  it('carries an empty source, so the writer builds it rather than patching', () => {
    expect(newReferenceImage(DATA, P(0, 0), 'F.SilkS').source).toEqual({
      kind: 'list',
      items: [],
    });
  });
});

describe('committing to the board', () => {
  const EMPTY = { kind: 'list' as const, items: [] };
  const board = (): Board => ({
    version: 20240108,
    layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
    nets: new Map([[0, '']]),
    footprints: [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    dimensions: [],
    textBoxes: [],
    tables: [],
    images: [],
    points: [],
    barcodes: [],
    groups: [],
    source: EMPTY,
  });

  it('appends the image and names it by index', () => {
    const { board: b, id } = addBoardImage(board(), newReferenceImage(DATA, P(1, 2), 'F.SilkS'));

    expect(b.images).toHaveLength(1);
    expect(b.images[0]?.at).toEqual(P(1, 2));
    expect(id).toBe('image:0');
  });

  it('appends rather than replacing, so a second image keeps the first', () => {
    const one = addBoardImage(board(), newReferenceImage(DATA, P(1, 2), 'F.SilkS')).board;
    const two = addBoardImage(one, newReferenceImage(DATA, P(3, 4), 'F.SilkS'));

    expect(two.board.images).toHaveLength(2);
    expect(two.id).toBe('image:1');
  });

  it('does not disturb the board’s other item arrays', () => {
    const before = board();
    const after = addBoardImage(before, newReferenceImage(DATA, P(1, 2), 'F.SilkS')).board;

    expect(after.shapes).toBe(before.shapes);
    expect(after.textBoxes).toBe(before.textBoxes);
    expect(after.groups).toBe(before.groups);
  });
});
