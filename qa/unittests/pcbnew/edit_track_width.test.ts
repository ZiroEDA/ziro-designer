// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SetTrackSegmentWidth` (`pcbnew/edit_track_width.cpp`). A default `BOARD`'s
 * default netclass carries KiCad's own defaults (`common/netclass.ts`):
 * track width 0.2 mm, via diameter/drill 0.6/0.3 mm, microvia
 * diameter/drill 0.3/0.1 mm — every expected value below is one of those,
 * not a derived or invented number.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PICKED_ITEMS_LIST } from '@ziroeda/common/undo_redo_container.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { VIA_DIMENSION } from '@ziroeda/pcbnew/board_design_settings.js';
import { SetTrackSegmentWidth } from '@ziroeda/pcbnew/edit_track_width.js';
import { PCB_TRACK, PCB_VIA, VIATYPE } from '@ziroeda/pcbnew/pcb_track.js';

const MM = (mm: number) => pcbIUScale.mmToIU(mm);

const mkTrack = (board: BOARD, width = MM(0.35)): PCB_TRACK => {
  const t = new PCB_TRACK(board);
  t.SetStart({ x: 0, y: 0 });
  t.SetEnd({ x: MM(1), y: 0 });
  t.SetWidth(width);
  return t;
};

const mkVia = (board: BOARD, kind: VIATYPE = VIATYPE.THROUGH): PCB_VIA => {
  const v = new PCB_VIA(board);
  v.SetPosition({ x: 0, y: 0 });
  v.SetViaType(kind);
  v.SetWidth(MM(0.9));
  v.SetDrill(MM(0.5));
  return v;
};

describe('SetTrackSegmentWidth', () => {
  it('without design rules, a track takes the board current track width and pushes undo', () => {
    const board = new BOARD();
    const t = mkTrack(board);
    const list = new PICKED_ITEMS_LIST();

    const changed = SetTrackSegmentWidth(t, list, false);

    expect(changed).toBe(true);
    expect(t.GetWidth()).toBe(MM(0.2)); // default netclass track width
    expect(list.GetCount()).toBe(1);
  });

  it('without design rules, a through via takes the board current via size and drill', () => {
    const board = new BOARD();
    const v = mkVia(board, VIATYPE.THROUGH);
    const list = new PICKED_ITEMS_LIST();

    const changed = SetTrackSegmentWidth(v, list, false);

    expect(changed).toBe(true);
    expect(v.GetWidth()).toBe(MM(0.6)); // default netclass via diameter
    expect(v.GetDrillValue()).toBe(MM(0.3)); // default netclass via drill
  });

  it('a microvia ignores the current via size and takes its netclass microvia size, before the generic via branch', () => {
    const board = new BOARD();
    const v = mkVia(board, VIATYPE.MICROVIA);
    const list = new PICKED_ITEMS_LIST();

    SetTrackSegmentWidth(v, list, false);

    expect(v.GetWidth()).toBe(MM(0.3)); // default netclass microvia diameter
    expect(v.GetDrillValue()).toBe(MM(0.1)); // default netclass microvia drill
  });

  it('is a no-op (and pushes nothing) when the item already matches the target', () => {
    const board = new BOARD();
    const t = mkTrack(board, MM(0.2)); // already the board's current track width
    const list = new PICKED_ITEMS_LIST();

    const changed = SetTrackSegmentWidth(t, list, false);

    expect(changed).toBe(false);
    expect(list.GetCount()).toBe(0);
  });

  it('with design rules but no DRC engine, the constraint resolves to nothing and the item is left alone', () => {
    const board = new BOARD();
    const t = mkTrack(board, MM(0.35));
    const list = new PICKED_ITEMS_LIST();

    const changed = SetTrackSegmentWidth(t, list, true);

    expect(changed).toBe(false);
    expect(t.GetWidth()).toBe(MM(0.35));
    expect(list.GetCount()).toBe(0);
  });

  it('a zero drill preset resizes the via pad but leaves the existing hole alone', () => {
    // GetCurrentViaDrill() returns -1 for "no drill set"; SetTrackSegmentWidth's
    // `new_drill <= 0` guard then keeps the via's current drill.
    const board = new BOARD();
    board.GetDesignSettings().m_ViasDimensionsList = [
      new VIA_DIMENSION(0, 0),
      new VIA_DIMENSION(MM(0.5), 0),
    ];
    board.GetDesignSettings().SetViaSizeIndex(1);
    const v = mkVia(board, VIATYPE.THROUGH);
    v.SetDrill(MM(0.4));
    const list = new PICKED_ITEMS_LIST();

    SetTrackSegmentWidth(v, list, false);

    expect(v.GetDrillValue()).toBe(MM(0.4)); // unchanged
  });
});
