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
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

const WITH_SETUP = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (setup
    (pad_to_mask_clearance 0)
    (aux_axis_origin 5 6)
    (grid_origin 1 2)
  )
  (net 0 "")
)`;

describe('moving an origin (BOARD_DESIGN_SETTINGS::SetGridOrigin)', () => {
  it('writes the new origin and leaves every other setup token alone', () => {
    const b = ParseBoard(WITH_SETUP);
    b.GetDesignSettings().SetGridOrigin({ x: MM(30), y: MM(40) });
    const out = FormatBoard(b);

    expect(out).toContain('(grid_origin 30 40)');
    expect(out).toContain('(aux_axis_origin 5 6)');
    expect(out).toContain('(pad_to_mask_clearance 0)');
  });
});

describe('the file otherwise round-trips', () => {
  it('an untouched board writes stable bytes with both origins in place', () => {
    // The writer is KiCad's own formatter, so a hand-written fixture is
    // normalised by its first save; the second save must write the first
    // one's bytes again, origins included.
    const once = FormatBoard(ParseBoard(WITH_SETUP));
    expect(once).toContain('(grid_origin 1 2)');
    expect(once).toContain('(aux_axis_origin 5 6)');
    expect(FormatBoard(ParseBoard(once))).toBe(once);
  });
});
