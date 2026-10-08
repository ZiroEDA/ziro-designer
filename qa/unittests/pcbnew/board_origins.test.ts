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
import { parse } from '@ziroeda/sexpr/index.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { setBoardOrigin } from '@ziroeda/pcbnew/edit-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);

const WITH_SETUP = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (setup
    (pad_to_mask_clearance 0)
    (aux_axis_origin 5 6)
    (grid_origin 1 2)
  )
  (net 0 "")
)`;

const read = (src: string): Board => readBoard(parse(src));

describe('moving an origin', () => {
  it('leaves every other setup token alone', () => {
    // `(setup …)` carries the whole of Board Setup. This writer owns exactly two
    // of its children and must be invisible to the rest.
    const b = setBoardOrigin(read(WITH_SETUP), 'grid_origin', { x: MM(30), y: MM(40) });

    expect(serializeBoard(b)).toContain('(pad_to_mask_clearance 0)');
  });
});

describe('the file otherwise round-trips', () => {
  it('an untouched board writes stable bytes with both origins in place', () => {
    // The writer is KiCad's own formatter, so a hand-written fixture is
    // normalised by its first save; the second save must write the first
    // one's bytes again, origins included.
    const once = serializeBoard(readBoard(WITH_SETUP));
    expect(once).toContain('(grid_origin 1 2)');
    expect(once).toContain('(aux_axis_origin 5 6)');
    expect(serializeBoard(readBoard(once))).toBe(once);
  });
});
