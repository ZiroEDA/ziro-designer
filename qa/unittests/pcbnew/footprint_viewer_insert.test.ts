// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_VIEWER_FRAME::AddFootprintToPCB` (footprint_viewer_frame.cpp:744-801)
 * end to end: the browser's live footprint, loaded off a library onto its
 * FPHOLDER board, is duplicated onto the board editor KIWAY knows as
 * FRAME_PCB_EDITOR — nets cleared, flags cleared, unflipped, at the origin,
 * committed — and the board editor is raised with `placeFootprint` posted.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo_item.js';
import { ParseFootprintFile } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { FOOTPRINT_LIBRARY_STORE } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import {
  FOOTPRINT_VIEWER_FRAME,
  FPVIEWER_CONSTANTS,
  FPVIEWER_NO_BOARD,
  FPVIEWER_PLACEMENT_IN_PROGRESS,
} from '@ziroeda/pcbnew/footprint_viewer_frame.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_CONTROL } from '@ziroeda/pcbnew/tools/pcb_control.js';
import { PCB_VIEWER_TOOLS } from '@ziroeda/pcbnew/tools/pcb_viewer_tools.js';
import { harnessCanvas, type HARNESS_MOUSE } from './support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A library footprint, stored flipped as one archived off a board can be. */
const FP = (aLayer: string): string => `(footprint "R" (layer "${aLayer}") (uuid "${U(10)}")
  (at 3 4)
  (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "${U(11)}"))
  (property "Value" "R" (at 0 1 0) (layer "F.Fab") (uuid "${U(12)}"))
  (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "N") (uuid "${U(13)}")))`;

/** The board editor, as `AddFootprintToPCB` reaches it through KIWAY. */
class PCB_TARGET extends TEST_PCB_FRAME {
  placing = false;
  closedBlocking = 0;
  posted: [TOOL_ACTION, unknown][] = [];
  PlacingFootprint(): boolean {
    return this.placing;
  }
  CloseBlockingDialog(): void {
    this.closedBlocking++;
  }
}

function makeKiway(raised: FRAME_T[]): KIWAY {
  return new KIWAY({
    OnKiCadExit: () => {},
    Player: (t) => {
      raised.push(t);
      return true;
    },
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
}

const errors: string[] = [];
let raised: FRAME_T[];
let kiway: KIWAY;
let pcb: PCB_TARGET;
let crosshair: { x: number; y: number }[];

async function viewerShowing(aLayer: string): Promise<FOOTPRINT_VIEWER_FRAME> {
  const store = new FOOTPRINT_LIBRARY_STORE({
    footprintText: () => Promise.reject(new Error('none')),
    flipLeftRight: () => false,
  });
  store.AddProjectLibrary('Lib', 'Lib.pretty', [{ fileName: 'R.kicad_mod', text: FP(aLayer) }]);
  const viewer = new FOOTPRINT_VIEWER_FRAME({
    reCreateLibraryList: () => {},
    selectAndViewFootprint: () => {},
  });
  viewer.SetFootprintLibAdapter(store);
  viewer.setCurNickname('Lib');
  viewer.setCurFootprintName('R');
  await viewer.ViewFootprint();
  viewer.SetKiway(kiway);
  return viewer;
}

beforeEach(() => {
  SetErrorPresenter((t) => errors.push(t));
  raised = [];
  kiway = makeKiway(raised);
  pcb = new PCB_TARGET(new BOARD());
  harnessCanvas(pcb.GetBoard()!, pcb, {
    mouse: { x: 7, y: 9 },
    forced: null,
    shape: null,
  } as unknown as HARNESS_MOUSE);
  crosshair = [];
  Object.assign(pcb.GetCanvas()!.GetViewControls(), {
    SetCrossHairCursorPosition: (aPos: { x: number; y: number }) => crosshair.push({ ...aPos }),
  });
  const mgr = pcb.GetToolManager()!;
  const post = mgr.PostAction.bind(mgr);
  mgr.PostAction = ((aAction: TOOL_ACTION, aParam?: unknown) => {
    pcb.posted.push([aAction, aParam]);
    return post(aAction as never);
  }) as typeof mgr.PostAction;
  kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);
});

afterEach(() => {
  errors.length = 0;
});

describe('FOOTPRINT_VIEWER_FRAME::ViewFootprint', () => {
  it('loads the named footprint onto the FPHOLDER board, in place of the last', async () => {
    const viewer = await viewerShowing('F.Cu');
    const board = viewer.GetBoard()!;
    expect(board.Footprints().length).toBe(1);
    expect(board.GetFirstFootprint()!.GetFPID().Format()).toBe('Lib:R');

    // A name the library does not have empties the board.
    viewer.setCurFootprintName('Nope');
    await viewer.ViewFootprint();
    expect(board.Footprints().length).toBe(0);
  });

  it('a load that finishes after a newer one is dropped', async () => {
    const pending = new Map<string, (aFp: FOOTPRINT | null) => void>();
    const viewer = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {},
      selectAndViewFootprint: () => {},
    });
    viewer.SetFootprintLibAdapter({
      LoadFootprintAsync: (_aLib: string, aName: string) =>
        new Promise<FOOTPRINT | null>((resolve) => pending.set(aName, resolve)),
    } as unknown as FOOTPRINT_LIBRARY_STORE);
    viewer.setCurNickname('Lib');

    viewer.setCurFootprintName('A');
    const first = viewer.ViewFootprint();
    viewer.setCurFootprintName('B');
    const second = viewer.ViewFootprint();

    const b = ParseFootprintFile(FP('F.Cu'), 'Lib:B');
    pending.get('B')!(b);
    await second;
    pending.get('A')!(ParseFootprintFile(FP('F.Cu'), 'Lib:A'));
    await first;

    expect(viewer.GetBoard()!.Footprints()).toEqual([b]);
  });

  it('has the clearance and mask expansion zeroed, as upstream’s constructor does', () => {
    const viewer = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {},
      selectAndViewFootprint: () => {},
    });
    const ds = viewer.GetBoard()!.GetDesignSettings();
    expect(ds.m_NetSettings.GetDefaultNetclass().GetClearance()).toBe(0);
    expect(ds.m_SolderMaskExpansion).toBe(0);
    expect(viewer.GetGalDisplayOptions().m_axesEnabled).toBe(true);
  });
});

describe('AddFootprintToPCB', () => {
  it('does nothing when no footprint is on show', async () => {
    const viewer = await viewerShowing('F.Cu');
    viewer.setCurFootprintName('Nope');
    await viewer.ViewFootprint();
    expect(viewer.AddFootprintToPCB()).toBe(false);
    expect(pcb.GetBoard()!.Footprints()).toEqual([]);
    expect(errors).toEqual([]);
    expect(raised).toEqual([]);
  });

  it('"No board currently open." without a board editor', async () => {
    kiway.PlayerDidClose(FRAME_T.FRAME_PCB_EDITOR, pcb);
    const viewer = await viewerShowing('F.Cu');
    expect(viewer.AddFootprintToPCB()).toBe(false);
    expect(errors).toEqual([FPVIEWER_NO_BOARD]);
    expect(FPVIEWER_NO_BOARD).toBe('No board currently open.');
  });

  it('refuses while a previous placement is still riding the cursor', async () => {
    pcb.placing = true;
    const viewer = await viewerShowing('F.Cu');
    expect(viewer.AddFootprintToPCB()).toBe(false);
    expect(errors).toEqual([FPVIEWER_PLACEMENT_IN_PROGRESS]);
    expect(FPVIEWER_PLACEMENT_IN_PROGRESS).toBe('Previous footprint placement still in progress.');
    expect(pcb.GetBoard()!.Footprints()).toEqual([]);
    expect(pcb.closedBlocking).toBe(0);
  });

  it('commits a copy at the origin with orphaned nets cleared, posts placeFootprint, raises', async () => {
    const viewer = await viewerShowing('F.Cu');
    const shown = viewer.GetBoard()!.GetFirstFootprint()!;
    // A net on the holder board, as `displayFootprint` gives a pad with a pin
    // function: the board editor must not inherit it.
    const net = new NETINFO_ITEM(viewer.GetBoard(), 'N', 1);
    viewer.GetBoard()!.Add(net);
    shown.Pads()[0]!.SetNet(net);
    expect(shown.Pads()[0]!.GetNetCode()).toBe(1);

    expect(viewer.AddFootprintToPCB()).toBe(true);

    const placed = pcb.GetBoard()!.Footprints();
    expect(placed.length).toBe(1);
    const fp = placed[0] as FOOTPRINT;
    // A duplicate, not the browser's own.
    expect(fp).not.toBe(shown);
    expect(viewer.GetBoard()!.GetFirstFootprint()).toBe(shown);
    expect(fp.GetParent()).toBe(pcb.GetBoard());
    expect(fp.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(fp.GetFlags()).toBe(0);
    expect(fp.Pads()[0]!.GetNetCode()).toBe(0);
    expect(fp.IsFlipped()).toBe(false);

    // The crosshair parked at the origin for PlaceFootprint, then given back.
    expect(crosshair).toEqual([
      { x: 0, y: 0 },
      { x: 7, y: 9 },
    ]);
    expect(pcb.closedBlocking).toBe(1);
    expect(pcb.posted.map(([a]) => a)).toContain(PCB_ACTIONS.placeFootprint);
    expect(pcb.posted.find(([a]) => a === PCB_ACTIONS.placeFootprint)![1]).toBe(fp);
    expect(raised).toEqual([FRAME_T.FRAME_PCB_EDITOR]);
    expect(errors).toEqual([]);
  });

  it('puts a footprint stored flipped back on the front', async () => {
    const viewer = await viewerShowing('B.Cu');
    expect(viewer.GetBoard()!.GetFirstFootprint()!.IsFlipped()).toBe(true);

    expect(viewer.AddFootprintToPCB()).toBe(true);
    expect((pcb.GetBoard()!.Footprints()[0] as FOOTPRINT).IsFlipped()).toBe(false);
  });

  it('the pads take the global ratsnest setting', async () => {
    pcb.settings.m_Display.m_ShowGlobalRatsnest = false;
    const viewer = await viewerShowing('F.Cu');
    viewer.AddFootprintToPCB();
    const pad = (pcb.GetBoard()!.Footprints()[0] as FOOTPRINT).Pads()[0]!;
    expect(pad.GetLocalRatsnestVisible()).toBe(false);
  });
});

describe('PCB_VIEWER_TOOLS::SetFootprintFrame', () => {
  it('the browser sets it; a board frame does not', () => {
    const viewer = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {},
      selectAndViewFootprint: () => {},
    });
    expect(viewer.GetToolManager()!.GetTool(PCB_VIEWER_TOOLS)!.IsFootprintFrame()).toBe(true);

    const board = new TEST_PCB_FRAME(new BOARD());
    const tool = new PCB_VIEWER_TOOLS();
    board.GetToolManager()!.RegisterTool(tool);
    expect(tool.IsFootprintFrame()).toBe(false);
  });
});

describe('PCB_CONTROL on the browser', () => {
  it('nextFootprint / previousFootprint run SelectAndViewFootprint with the parameter', () => {
    const modes: FPVIEWER_CONSTANTS[] = [];
    const viewer = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {},
      selectAndViewFootprint: (aMode) => modes.push(aMode),
    });
    viewer.setCurNickname('Lib');
    viewer.GetToolManager()!.RunAction(PCB_ACTIONS.nextFootprint);
    viewer.GetToolManager()!.RunAction(PCB_ACTIONS.previousFootprint);
    expect(modes).toEqual([FPVIEWER_CONSTANTS.NEXT_PART, FPVIEWER_CONSTANTS.PREVIOUS_PART]);

    // `if( !getCurNickname() ) return;`
    viewer.setCurNickname('');
    viewer.GetToolManager()!.RunAction(PCB_ACTIONS.nextFootprint);
    expect(modes.length).toBe(2);
  });

  it('saveFpToBoard runs AddFootprintToPCB', async () => {
    const viewer = await viewerShowing('F.Cu');
    expect(viewer.GetToolManager()!.GetTool(PCB_CONTROL)).not.toBeNull();
    viewer.GetToolManager()!.RunAction(PCB_ACTIONS.saveFpToBoard);
    expect(pcb.GetBoard()!.Footprints().length).toBe(1);
  });
});
