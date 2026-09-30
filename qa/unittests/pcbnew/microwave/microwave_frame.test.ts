// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * MICROWAVE_TOOL over a real PCB_EDIT_FRAME and its live BOARD:
 * `PCB_BASE_FRAME::CreateNewFootprint` (footprint_libraries_utils.cpp:1227),
 * the dialogs `TransferDataFromWindow` reaches through the frame's hooks, and
 * the BOARD_COMMIT each placement pushes (microwave_inductor.cpp:314-318,
 * pcb_tool_base.cpp `doInteractiveItemPlacement`).
 *
 * Expected numbers are worked by hand from the C++ with a 0.25 mm track and a
 * 1.0 mm gap, as `microwave.test.ts` does.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { FOOTPRINT, FP_SMD, FP_THROUGH_HOLE } from '@ziroeda/pcbnew/footprint.js';
import { MICROWAVE_FOOTPRINT_SHAPE } from '@ziroeda/pcbnew/microwave/microwave_tool.js';
import { PADSTACK } from '@ziroeda/pcbnew/padstack.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { g_PolyEdges } from '@ziroeda/pcbnew/microwave/microwave_polygon.js';

const TRACK = 250000;

interface Answers {
  text: (string | null)[];
  asked: string[];
  selected: FOOTPRINT[];
  polygon: boolean;
}

function frameOn(board: BOARD, ans: Answers): PCB_EDIT_FRAME {
  const settings = new PCBNEW_SETTINGS();
  // Cast: only the members this path reaches are given.
  const hooks = {
    settings: () => settings,
    onModify: () => {},
    textEntry: async (prompt: string) => {
      ans.asked.push(prompt);
      return ans.text.shift() ?? null;
    },
    mwavePolygonalShapeDialog: async () => ans.polygon,
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  const frame = new PCB_EDIT_FRAME(hooks);
  frame.SetBoard(board);
  board.GetDesignSettings().m_NetSettings.GetDefaultNetclass().SetTrackWidth(TRACK);
  return frame;
}

const fresh = (text: (string | null)[] = []) => {
  const ans: Answers = { text, asked: [], selected: [], polygon: false };
  const board = new BOARD();
  return { ans, board, frame: frameOn(board, ans) };
};

beforeAll(() => {
  installPgm();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PCB_BASE_FRAME::CreateNewFootprint on the live BOARD', () => {
  it('builds the reference, value and default texts from m_DefaultFPTextItems', () => {
    const { frame } = fresh();
    const fp = frame.CreateNewFootprint('mw');

    expect(fp.GetFPID().GetLibItemName()).toBe('mw');
    expect(fp.GetAttributes()).toBe(FP_SMD);

    // items[0] = ( "REF**", visible, F.SilkS ), items[1] = ( "", visible, F.Fab ),
    // items[2] = ( "${REFERENCE}", visible, F.Fab ). A 1 mm text: the reference
    // sits at y = -size/2, the value at that plus size plus size/2 (+ 1 mm), and
    // the third text half a size below the value's bottom (+ 2.5 mm).
    expect(fp.Reference().GetText()).toBe('REF**');
    expect(fp.Reference().GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(fp.Reference().GetPosition()).toEqual({ x: 0, y: -500000 });

    // An empty value text is filled with the name: `if( GetValue().IsEmpty() )`.
    expect(fp.Value().GetText()).toBe('mw');
    expect(fp.Value().GetLayer()).toBe(PCB_LAYER_ID.F_Fab);
    expect(fp.Value().GetPosition()).toEqual({ x: 0, y: 1000000 });

    const texts = fp.GraphicalItems().filter((i) => i.Type() === KICAD_T.PCB_TEXT_T) as PCB_TEXT[];
    expect(texts).toHaveLength(1);
    expect(texts[0]!.GetText()).toBe('${REFERENCE}');
    expect(texts[0]!.GetLayer()).toBe(PCB_LAYER_ID.F_Fab);
    expect(texts[0]!.GetPosition()).toEqual({ x: 0, y: 2500000 });
  });

  it('takes size, stroke, italics and upright from the layer class of each text', () => {
    const { frame, board } = fresh();
    const bds = board.GetDesignSettings();
    const silk = bds.GetTextSize(PCB_LAYER_ID.F_SilkS);
    const fp = frame.CreateNewFootprint('x');

    expect(fp.Reference().GetTextSize()).toEqual(silk);
    expect(fp.Reference().GetTextThickness()).toBe(bds.GetTextThickness(PCB_LAYER_ID.F_SilkS));
    expect(fp.Value().GetTextSize()).toEqual(bds.GetTextSize(PCB_LAYER_ID.F_Fab));
    expect(fp.Reference().IsKeepUpright()).toBe(bds.GetTextUpright(PCB_LAYER_ID.F_SilkS));
  });

  it('names an unnamed footprint "Untitled"', () => {
    const { frame } = fresh();
    expect(frame.CreateNewFootprint('').GetFPID().GetLibItemName()).toBe('Untitled');
  });

  it('with a library: the first free suffix is _1', () => {
    const { frame, board } = fresh();
    board.SetFootprintLibAdapter({
      FootprintExists: (_lib: string, name: string) => name === 'mw',
    } as unknown as FOOTPRINT_LIBRARY_ADAPTER);

    expect(frame.CreateNewFootprint('mw', 'Lib').GetFPID().GetLibItemName()).toBe('mw_1');
    // A name nobody has is kept as it is.
    expect(frame.CreateNewFootprint('free', 'Lib').GetFPID().GetLibItemName()).toBe('free');
  });

  it('with a library: a unique name (_1, _2) and the attributes of its last footprint', () => {
    const { frame, board } = fresh();
    const loaded = new FOOTPRINT(board);
    loaded.SetAttributes(FP_THROUGH_HOLE);
    const adapter = {
      FootprintExists: (_lib: string, name: string) => name === 'mw' || name === 'mw_1',
      GetFootprintNames: () => ['a', 'b'],
      LoadFootprint: (_lib: string, name: string) => (name === 'b' ? loaded : null),
    } as unknown as FOOTPRINT_LIBRARY_ADAPTER;
    board.SetFootprintLibAdapter(adapter);

    const fp = frame.CreateNewFootprint('mw', 'Lib');
    expect(fp.GetFPID().GetLibItemName()).toBe('mw_2');
    expect(fp.GetAttributes()).toBe(FP_THROUGH_HOLE);
  });
});

describe('MICROWAVE_TOOL through the frame', () => {
  it('a gap asks "Gap Size:" and builds two track-wide pads on the live board', async () => {
    const { frame, ans } = fresh(['1']);
    const fp = await frame.MicrowaveTool().addMicrowaveFootprint(MICROWAVE_FOOTPRINT_SHAPE.GAP);

    expect(ans.asked).toEqual(['Gap Size:']);
    expect(fp).not.toBeNull();
    expect(fp!.GetParent()).toBe(frame.GetBoard());
    expect(fp!.GetFPID().GetLibItemName()).toBe('muwave_gap');

    const pads = fp!.Pads();
    expect(pads).toHaveLength(2);
    expect(pads[0]!.GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: TRACK, y: TRACK });
  });

  it('a gap read as 1 mm puts the pads at -(gap+w)/2 and +(gap+w)/2', async () => {
    const { frame } = fresh(['1']);
    const fp = await frame.MicrowaveTool().addMicrowaveFootprint(MICROWAVE_FOOTPRINT_SHAPE.GAP);
    const pads = fp!.Pads();

    // offsetX = -( 1000000 + 250000 ) / 2 = -625000; pad 2 sits at offsetX + gap + w.
    expect(pads[0]!.GetPosition().x).toBe(-625000);
    expect(pads[1]!.GetPosition().x).toBe(625000);
  });

  it('cancelling the length dialog makes nothing', async () => {
    const { frame } = fresh([null]);
    expect(
      await frame.MicrowaveTool().addMicrowaveFootprint(MICROWAVE_FOOTPRINT_SHAPE.STUB),
    ).toBeNull();
  });

  it('a polygonal shape that is cancelled in its dialog makes nothing', async () => {
    const { frame, ans } = fresh();
    ans.polygon = false;
    g_PolyEdges.push({ x: 1, y: 1 });
    expect(
      await frame.MicrowaveTool().addMicrowaveFootprint(MICROWAVE_FOOTPRINT_SHAPE.FUNCTION_SHAPE),
    ).toBeNull();
    // `g_PolyEdges.clear()` on cancel.
    expect(g_PolyEdges).toHaveLength(0);
  });

  it('the inductor is committed as "Add Microwave Inductor" and selected', async () => {
    const { frame, board, ans } = fresh(['8', 'L1']);
    const push = vi.spyOn(BOARD_COMMIT.prototype, 'Push');

    // 8 mm of track between (0,0) and (4 mm, 0).
    await frame.MicrowaveTool().createInductorBetween({ x: 0, y: 0 }, { x: 4000000, y: 0 });

    expect(ans.asked).toEqual(['Length of track:', 'Component value:']);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toBe('Add Microwave Inductor');
    expect(board.Footprints()).toHaveLength(1);
    // `RunAction<EDA_ITEM*>( ACTIONS::selectItem, inductorFP.get() )`
    expect(frame.GetSelectionTool().GetSelection().GetItems()).toEqual([board.Footprints()[0]]);
    expect(board.Footprints()[0]!.GetFPID().GetLibItemName()).toBe('mw_inductor');
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it('a too-short inductor length reports on the infobar and commits nothing', async () => {
    const errors: string[] = [];
    const { frame, board } = fresh(['1']);
    frame.ShowInfoBarError = (m: string) => {
      errors.push(m);
    };
    await frame.MicrowaveTool().createInductorBetween({ x: 0, y: 0 }, { x: 4000000, y: 0 });
    expect(errors).toEqual(['Requested length < minimum length']);
    expect(board.Footprints()).toHaveLength(0);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});

describe("PlaceInteractiveItem: doInteractiveItemPlacement's left click", () => {
  it('adds the footprint and pushes "Place microwave feature" as one undoable commit', async () => {
    const { frame, board } = fresh(['1']);
    const fp = (await frame.MicrowaveTool().addMicrowaveFootprint(MICROWAVE_FOOTPRINT_SHAPE.GAP))!;
    fp.SetPosition({ x: 3000000, y: 2000000 });
    const push = vi.spyOn(BOARD_COMMIT.prototype, 'Push');

    frame.PlaceInteractiveItem(fp, 'Place microwave feature');

    expect(push.mock.calls.map((c) => c[0])).toEqual(['Place microwave feature']);
    expect(board.Footprints()).toEqual([fp]);
    // The pads moved with the anchor: -625000 + 3000000.
    expect(fp.Pads()[0]!.GetPosition()).toEqual({ x: 2375000, y: 2000000 });
    expect(frame.GetUndoCommandCount()).toBe(1);
  });
});
