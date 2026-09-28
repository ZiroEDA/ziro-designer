// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_UTILS` (`pcbnew/layer_utils.cpp`). Cases derived from the C++:
 * `AccumulateNames` joins with ", " and falls back to the stock layer name
 * with no board; `GetAllFootprintLayers` unions every child's layer set (the
 * footprint's own `GetLayerSet()` is not a child of itself, so it never
 * counts); `GetOrphanedFootprintLayers` drops `AllTechMask` and `UserMask`
 * (the *fixed* Dwgs/Cmts/Eco user layers, not the numbered `User_1..45`
 * ones) plus whichever numbered custom layers the caller allows, and always
 * drops Rescue.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { LAYER_UTILS } from '@ziroeda/pcbnew/layer_utils.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';

describe('LAYER_UTILS.AccumulateNames', () => {
  it('joins with ", " and uses the stock name with no board', () => {
    const names = LAYER_UTILS.AccumulateNames([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu], null);
    expect(names).toBe('F.Cu, B.Cu');
  });

  it('is empty for an empty layer list', () => {
    expect(LAYER_UTILS.AccumulateNames([], null)).toBe('');
  });

  it('asks the board for its (possibly renamed) layer name when given one', () => {
    const board = new BOARD();
    board.SetLayerName(PCB_LAYER_ID.F_Cu, 'Top');
    expect(LAYER_UTILS.AccumulateNames([PCB_LAYER_ID.F_Cu], board)).toBe('Top');
  });
});

describe('LAYER_UTILS.GetAllFootprintLayers', () => {
  it('unions the layers of every child item - the footprint itself does not count', () => {
    const board = new BOARD();
    const fp = new FOOTPRINT(board); // constructs a Reference field on F.SilkS, Value on F.Fab
    fp.SetLayer(PCB_LAYER_ID.F_Cu); // RunOnChildren visits children only, never the footprint itself

    const pad = new PAD(fp);
    pad.SetLayerSet(new LSET([PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Mask]));
    fp.Add(pad, ADD_MODE.APPEND);

    const used = LAYER_UTILS.GetAllFootprintLayers(fp);

    expect(used.test(PCB_LAYER_ID.F_Cu)).toBe(false); // no child is on it
    expect(used.test(PCB_LAYER_ID.B_Cu)).toBe(true);
    expect(used.test(PCB_LAYER_ID.B_Mask)).toBe(true);
    expect(used.test(PCB_LAYER_ID.F_SilkS)).toBe(true); // the default Reference field's layer
    expect(used.test(PCB_LAYER_ID.B_SilkS)).toBe(false); // nothing put a child there
  });
});

describe('LAYER_UTILS.GetOrphanedFootprintLayers', () => {
  it('drops the tech mask, the FIXED user layers, an allowed custom layer, and always Rescue', () => {
    const board = new BOARD();
    const fp = new FOOTPRINT(board);

    const pad = new PAD(fp);
    pad.SetLayerSet(
      new LSET([
        PCB_LAYER_ID.F_Cu, // a copper (non-tech, non-user) layer: stays an orphan
        PCB_LAYER_ID.F_SilkS, // AllTechMask: dropped
        PCB_LAYER_ID.Dwgs_User, // UserMask (the FIXED Dwgs/Cmts/Eco user layers): dropped
        PCB_LAYER_ID.User_1, // a numbered custom layer NOT in the allowed set: stays an orphan
        PCB_LAYER_ID.User_2, // a numbered custom layer the caller allows: dropped
        PCB_LAYER_ID.Rescue, // always dropped
      ]),
    );
    fp.Add(pad, ADD_MODE.APPEND);

    const orphans = LAYER_UTILS.GetOrphanedFootprintLayers(fp, new LSET([PCB_LAYER_ID.User_2]));

    expect(orphans.test(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(orphans.test(PCB_LAYER_ID.F_SilkS)).toBe(false);
    expect(orphans.test(PCB_LAYER_ID.Dwgs_User)).toBe(false);
    expect(orphans.test(PCB_LAYER_ID.User_1)).toBe(true);
    expect(orphans.test(PCB_LAYER_ID.User_2)).toBe(false);
    expect(orphans.test(PCB_LAYER_ID.Rescue)).toBe(false);
  });
});
