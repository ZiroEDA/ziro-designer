// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Insert footprint into PCB" end to end at the frame level: a real
 * PCB_EDIT_FRAME registered as FRAME_PCB_EDITOR's player is what
 * FOOTPRINT_VIEWER_FRAME::AddFootprintToPCB reaches through KIWAY, and it
 * answers PlacingFootprint() and takes the footprint through its window's
 * hooks (footprint_viewer_frame.cpp:707-783).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { FOOTPRINT_VIEWER_FRAME } from '@ziroeda/pcbnew/footprint_viewer_frame.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/types.js';

const FOOTPRINT = { lib: 'R:R_0402' } as unknown as PcbFootprint;

function pcbFrame(placing: { on: boolean }, placed: [string, PcbFootprint][]): PCB_EDIT_FRAME {
  const settings = new PCBNEW_SETTINGS();
  // Cast: only the members this path reaches are given.
  const hooks = {
    settings: () => settings,
    onModify: () => {},
    placingFootprint: () => placing.on,
    placeFootprintFromLibrary: (aFpid: string, aFp: PcbFootprint) => placed.push([aFpid, aFp]),
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  return new PCB_EDIT_FRAME(hooks);
}

describe('AddFootprintToPCB into a real PCB_EDIT_FRAME', () => {
  beforeAll(() => {
    installPgm();
  });

  it('asks PlacingFootprint, then hands the footprint to the window and raises the frame', () => {
    const errors: string[] = [];
    SetErrorPresenter((t) => errors.push(t));
    const raised: FRAME_T[] = [];
    const kiway = new KIWAY({
      OnKiCadExit: () => {},
      Player: (t) => {
        raised.push(t);
        return true;
      },
      HasProjectManager: () => true,
      ShowProjectManager: () => {},
      CreateKiWindow: () => false,
    });
    const placing = { on: true };
    const placed: [string, PcbFootprint][] = [];
    const pcb = pcbFrame(placing, placed);
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);

    const viewer = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {},
      getFirstFootprint: () => ({ fpid: 'R:R_0402', footprint: FOOTPRINT }),
    });
    viewer.SetKiway(kiway);

    expect(viewer.AddFootprintToPCB()).toBe(false);
    expect(errors).toEqual(['Previous footprint placement still in progress.']);
    expect(placed).toEqual([]);

    placing.on = false;
    expect(viewer.AddFootprintToPCB()).toBe(true);
    expect(placed).toEqual([['R:R_0402', FOOTPRINT]]);
    expect(raised).toEqual([FRAME_T.FRAME_PCB_EDITOR]);
  });
});
