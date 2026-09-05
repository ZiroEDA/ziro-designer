// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board's two origins, and the tools that move them.
 *
 * `PCB_CONTROL::DoSetGridOrigin` (`pcb_control.cpp:757-765`) and
 * `BOARD_EDITOR_CONTROL::DoSetDrillOrigin` (`board_editor_control.cpp:2303-2310`)
 * are the same five lines with a different setter:
 *
 *     aFrame->GetDesignSettings().SetGridOrigin( VECTOR2I( aPoint ) );
 *     aView->GetGAL()->SetGridOrigin( aPoint );
 *     originViewItem->SetPosition( aPoint );
 *     aView->MarkDirty();
 *     aFrame->OnModify();
 *
 * Four of the five are view bookkeeping a redraw does here; the one that has to
 * survive is the design setting, which the file spells `(setup (grid_origin …))`
 * and `(setup (aux_axis_origin …))`.
 *
 * Both were *preserved-opaque* nodes: Board Setup carried them through
 * untouched and nothing could write them, which is why both toolbar buttons
 * were greyed. Two settings that a plot, a drill file and a placement file all
 * measure from.
 */
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { setBoardOrigin } from '@ziroeda/pcbnew/src/edit-board.js';
import { boardAuxOrigin, boardGridOrigin } from '@ziroeda/pcbnew/src/plot_gerber.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { GENERATOR } from '@ziroeda/common/src/generator.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

const WITH_SETUP = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal))
  (setup
    (pad_to_mask_clearance 0)
    (aux_axis_origin 5 6)
    (grid_origin 1 2)
  )
  (net 0 "")
)`;

const read = (src: string): Board => readBoard(parse(src));

describe('moving an origin', () => {
  it('writes the grid origin the file already had', () => {
    const b = setBoardOrigin(read(WITH_SETUP), 'grid_origin', { x: MM(30), y: MM(40) });

    expect(boardGridOrigin(b)).toEqual({ x: MM(30), y: MM(40) });
    expect(serializeBoard(b)).toContain('(grid_origin 30 40)');
  });

  it('and the drill/place origin, without disturbing the other', () => {
    // The two are separate settings on the same `(setup …)` node. A writer that
    // rebuilt the node rather than patching one child would take the other with
    // it, and losing the aux origin silently moves every drill file.
    const b = setBoardOrigin(read(WITH_SETUP), 'aux_axis_origin', { x: MM(7), y: MM(8) });

    expect(boardAuxOrigin(b)).toEqual({ x: MM(7), y: MM(8) });
    expect(boardGridOrigin(b)).toEqual({ x: MM(1), y: MM(2) });
  });

  it('leaves every other setup token alone', () => {
    // `(setup …)` carries the whole of Board Setup. This writer owns exactly two
    // of its children and must be invisible to the rest.
    const b = setBoardOrigin(read(WITH_SETUP), 'grid_origin', { x: MM(30), y: MM(40) });

    expect(serializeBoard(b)).toContain('(pad_to_mask_clearance 0)');
  });

  it('resets to (0, 0), which is what gridResetOrigin does', () => {
    // `PCB_CONTROL::GridResetOrigin` is `DoSetGridOrigin( …, VECTOR2D( 0, 0 ) )`
    // — the same setter, no picker.
    const b = setBoardOrigin(read(WITH_SETUP), 'grid_origin', { x: 0, y: 0 });

    expect(boardGridOrigin(b)).toEqual({ x: 0, y: 0 });
  });
});

describe('a board that never named an origin', () => {
  const NO_ORIGIN = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
)`;

  it('gains the token when one is placed', () => {
    // `BOARD_DESIGN_SETTINGS` always has an origin to write even when the file
    // did not name one, so this is an append rather than a replace.
    const b = setBoardOrigin(read(NO_ORIGIN), 'grid_origin', { x: MM(3), y: MM(4) });

    expect(boardGridOrigin(b)).toEqual({ x: MM(3), y: MM(4) });
    expect(serializeBoard(b)).toContain('(grid_origin 3 4)');
  });

  it('and a board with no (setup …) at all gains that too', () => {
    const bare = `(kicad_pcb (version 20241229) (generator "test") (net 0 ""))`;
    const b = setBoardOrigin(read(bare), 'aux_axis_origin', { x: MM(9), y: 0 });

    expect(boardAuxOrigin(b)).toEqual({ x: MM(9), y: 0 });
  });
});

describe('the file otherwise round-trips', () => {
  it('an untouched board is byte-identical', () => {
    // The guard against the writer running on every save: it must only fire
    // when a tool actually moved an origin.
    // The generator name comes from the constant, not from a literal: the
    // writer stamps it on every save, and a test that spells it out fails when
    // the product is renamed for reasons unrelated to what it checks.
    const src = parse(WITH_SETUP.replace('"test"', `"${GENERATOR}"`));

    expect(serializeBoard(readBoard(src))).toBe(serialize(src));
  });
});
