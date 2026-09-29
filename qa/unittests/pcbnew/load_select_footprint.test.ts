// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/load_select_footprint.cpp`: `PCB_BASE_FRAME::SelectFootprintFromLibrary`,
 * `LoadFootprint`, `loadFootprint`, `PlaceFootprint`, and
 * `FOOTPRINT_EDIT_FRAME::SelectFootprintFromBoard`, run on a real frame and
 * board. The chooser, the library and the list dialog are the window's, so
 * they are the hooks these tests answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { IS_MOVING, IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_USE } from '@ziroeda/pcbnew/board_types.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import type {
  FOOTPRINT_LIBRARY_ADAPTER,
  LIBRARY_TABLE_ROW,
} from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { LoadSelectFootprintStatics } from '@ziroeda/pcbnew/load_select_footprint.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import {
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import {
  clearFootprintHistory,
  footprintHistory,
} from '@ziroeda/pcbnew/widgets/footprint_history.js';

let seq = 0;
const U = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

const footprintText = (fpid: string, ref = 'R1'): string =>
  `(footprint "${fpid}" (layer "F.Cu") (uuid "${U()}") (at 0 0)
    (property "Reference" "${ref}" (at 0 -2 0) (layer "F.SilkS") (uuid "${U()}")
      (effects (font (size 1.27 1.27) (thickness 0.15))))
    (property "Value" "v" (at 0 2 0) (layer "F.Fab") (uuid "${U()}")
      (effects (font (size 1.27 1.27) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste") (net 1 "GND") (uuid "${U()}"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste") (net 2 "VCC") (uuid "${U()}")))`;

const libraryFootprint = (aName = 'R_0805'): FOOTPRINT =>
  ParseFootprintFile(footprintText(aName, 'REF**'));

const board = (...refs: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (7 "F.Fab" user))
  (setup)
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  ${refs.map((r) => footprintText('L:R', r)).join('\n  ')}
)`);

interface Env {
  frame: PCB_EDIT_FRAME;
  board: BOARD;
  calls: string[];
  modified: number;
  cursor: { x: number; y: number };
}

function setup(aHooks: Partial<PCB_EDIT_FRAME_HOOKS> = {}, aBoard: BOARD = board()): Env {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  const env = { calls: [] as string[], modified: 0, cursor: { x: 0, y: 0 } } as Env;
  const frame = new PCB_EDIT_FRAME({
    settings: () => new PCBNEW_SETTINGS(),
    onModify: () => {
      env.modified++;
    },
    onUndoRedoIncomplete: () => {},
    createDrcDialog: () => {
      throw new Error('no DRC dialog here');
    },
    isSingle: () => true,
    fetchNetlistFromSchematic: () => false,
    schematicNetlistText: () => null,
    projectText: () => null,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
    setHighlightNets: () => {},
    syncSelection: () => {},
    editZoneParams: () => {},
    selectCopperLayerPair: () => {},
    updatePcbFromSchematic: () => {},
    ...aHooks,
  });
  frame.SetBoard(aBoard, false);
  frame.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));
  const view = {
    UpdateDisplayOptions: () => {},
    SetMirror: () => {},
    IsMirroredY: () => false,
    RecacheAllItems: () => {},
    UpdateAllItemsConditionally: () => {},
    SetLayerVisible: () => {},
    Update: () => {},
    Remove: () => {},
    HasItem: () => false,
    Add: () => {},
    GetPainter: () => ({ GetSettings: () => ({}) }),
  };
  frame.SetCanvas({
    GetView: () => view,
    GetViewControls: () => ({ GetCursorPosition: () => env.cursor }),
    SetHighContrastLayer: () => {},
    Refresh: () => {},
    GetGAL: () => null,
    ForceRefresh: () => {},
  } as unknown as PCB_DRAW_PANEL_GAL);
  env.frame = frame;
  env.board = aBoard;
  return env;
}

beforeEach(() => clearFootprintHistory());
afterEach(() => SetPgm(null));

describe('PCB_BASE_FRAME::SelectFootprintFromLibrary', () => {
  it('asks the chooser with the preselected LIB_ID, loads what it returns, and files it in the history', async () => {
    const asked: string[] = [];
    const { frame } = setup({
      selectFootprintFromChooser: async (aPreselect) => {
        asked.push(aPreselect);
        return 'Resistor_SMD:R_0805';
      },
      loadFootprintFromLibrary: async (aId) => libraryFootprint(aId.GetUniStringLibItemName()),
    });

    const fp = await frame.SelectFootprintFromLibrary(new LIB_ID('Resistor_SMD', 'R_0603'));

    expect(asked).toEqual(['Resistor_SMD:R_0603']);
    expect(fp?.GetFPID().GetUniStringLibItemName()).toBe('R_0805');
    expect([...footprintHistory()]).toEqual(['Resistor_SMD:R_0805']);
    expect(LoadSelectFootprintStatics().lastComponentName).toBe('Resistor_SMD:R_0805');
  });

  it('asks with an empty name when nothing is preselected', async () => {
    const asked: string[] = [];
    const { frame } = setup({
      selectFootprintFromChooser: async (aPreselect) => {
        asked.push(aPreselect);
        return null;
      },
    });
    await frame.SelectFootprintFromLibrary();
    expect(asked).toEqual(['']);
  });

  it('a cancelled chooser loads nothing and records nothing', async () => {
    let loads = 0;
    const { frame } = setup({
      selectFootprintFromChooser: async () => null,
      loadFootprintFromLibrary: async () => {
        loads++;
        return libraryFootprint();
      },
    });
    expect(await frame.SelectFootprintFromLibrary()).toBeNull();
    expect(loads).toBe(0);
    expect([...footprintHistory()]).toEqual([]);
  });

  it('with no chooser the window has none to show: nothing is chosen', async () => {
    const { frame } = setup({ loadFootprintFromLibrary: async () => libraryFootprint() });
    expect(await frame.SelectFootprintFromLibrary()).toBeNull();
  });

  it('a name that is not a valid LIB_ID is not loaded', async () => {
    let loads = 0;
    const { frame } = setup({
      selectFootprintFromChooser: async () => 'no-colon-here',
      loadFootprintFromLibrary: async () => {
        loads++;
        return libraryFootprint();
      },
    });
    expect(await frame.SelectFootprintFromLibrary()).toBeNull();
    expect(loads).toBe(0);
  });

  it('a footprint that will not load, or an IO_ERROR, is not put in the history', async () => {
    const missing = setup({
      selectFootprintFromChooser: async () => 'L:Missing',
      loadFootprintFromLibrary: async () => null,
    });
    expect(await missing.frame.SelectFootprintFromLibrary()).toBeNull();

    const broken = setup({
      selectFootprintFromChooser: async () => 'L:Broken',
      loadFootprintFromLibrary: async () => {
        throw new IO_ERROR('unreadable');
      },
    });
    expect(await broken.frame.SelectFootprintFromLibrary()).toBeNull();
    expect([...footprintHistory()]).toEqual([]);
  });

  it('an error that is not an IO_ERROR is not swallowed', async () => {
    const { frame } = setup({
      selectFootprintFromChooser: async () => 'L:X',
      loadFootprintFromLibrary: async () => {
        throw new TypeError('a bug');
      },
    });
    await expect(frame.SelectFootprintFromLibrary()).rejects.toThrow('a bug');
  });

  it('the history holds the most recent first, without duplicates', async () => {
    let next = 'L:A';
    const { frame } = setup({
      selectFootprintFromChooser: async () => next,
      loadFootprintFromLibrary: async (aId) => libraryFootprint(aId.GetUniStringLibItemName()),
    });
    await frame.SelectFootprintFromLibrary();
    next = 'L:B';
    await frame.SelectFootprintFromLibrary();
    next = 'L:A';
    await frame.SelectFootprintFromLibrary();
    expect([...footprintHistory()]).toEqual(['L:A', 'L:B']);
  });
});

describe('PCB_BASE_FRAME::loadFootprint / LoadFootprint', () => {
  const nets = (fp: FOOTPRINT): number[] => fp.Pads().map((p) => p.GetNetCode());

  it('clears every net on the loaded footprint', async () => {
    const { frame } = setup({ loadFootprintFromLibrary: async () => libraryFootprint() });
    const fp = (await frame.LoadFootprint(new LIB_ID('L', 'R_0805')))!;
    expect(nets(fp)).toEqual([0, 0]);
  });

  it('asks for the footprint without keeping its UUIDs (the PCB editor is not the footprint editor)', async () => {
    const keep: boolean[] = [];
    const { frame } = setup({
      loadFootprintFromLibrary: async (_id, aKeepUUID) => {
        keep.push(aKeepUUID);
        return libraryFootprint();
      },
    });
    await frame.LoadFootprint(new LIB_ID('L', 'R_0805'));
    expect(keep).toEqual([false]);
  });

  it("applies the board's default styles when the board asks for them", async () => {
    const style = async (aOn: boolean): Promise<number> => {
      const { frame, board: b } = setup({
        loadFootprintFromLibrary: async () => libraryFootprint(),
      });
      const bds = b.GetDesignSettings();
      bds.m_StyleFPFields = aOn;
      // the board's default text size differs from the library's 1.27 mm
      const fp = (await frame.LoadFootprint(new LIB_ID('L', 'R_0805')))!;
      return fp.GetField(FIELD_T.REFERENCE).GetTextSize().x;
    };
    const lib = pcbIUScale.mmToIU(1.27);
    expect(await style(false)).toBe(lib);
    expect(await style(true)).not.toBe(lib);
  });

  it('leaves a footprint-holder board alone', async () => {
    const { frame, board: b } = setup({ loadFootprintFromLibrary: async () => libraryFootprint() });
    b.GetDesignSettings().m_StyleFPFields = true;
    b.SetBoardUse(BOARD_USE.FPHOLDER);
    const fp = (await frame.LoadFootprint(new LIB_ID('L', 'R_0805')))!;
    expect(fp.GetField(FIELD_T.REFERENCE).GetTextSize().x).toBe(pcbIUScale.mmToIU(1.27));
  });

  it('an IO_ERROR is "not found"; a null answer is too', async () => {
    const broken = setup({
      loadFootprintFromLibrary: async () => {
        throw new IO_ERROR('x');
      },
    });
    expect(await broken.frame.LoadFootprint(new LIB_ID('L', 'A'))).toBeNull();
    const missing = setup({ loadFootprintFromLibrary: async () => null });
    expect(await missing.frame.LoadFootprint(new LIB_ID('L', 'A'))).toBeNull();
  });

  describe("with no window loader, the board's library adapter answers", () => {
    const adapter = (aLoaded: string[]): FOOTPRINT_LIBRARY_ADAPTER => ({
      GetRow: (): LIBRARY_TABLE_ROW | null => null,
      HasLibrary: () => true,
      IsLibraryLoaded: () => true,
      FootprintExists: () => true,
      LoadOne: () => {},
      ProjectTable: () => null,
      GetFullURI: () => '',
      LoadFootprint: (aNick, aName, aKeep) => {
        aLoaded.push(`${aNick}:${aName}:${aKeep}`);
        return libraryFootprint(aName);
      },
    });

    it('a qualified LIB_ID loads from that library', async () => {
      const loaded: string[] = [];
      const { frame, board: b } = setup();
      b.SetFootprintLibAdapter(adapter(loaded));
      const fp = await frame.LoadFootprint(new LIB_ID('Lib', 'R_0805'));
      expect(loaded).toEqual(['Lib:R_0805:false']);
      expect(fp?.GetFPID().GetUniStringLibItemName()).toBe('R_0805');
    });

    it('an unqualified one is not searched for (the adapter does not enumerate)', async () => {
      const loaded: string[] = [];
      const { frame, board: b } = setup();
      b.SetFootprintLibAdapter(adapter(loaded));
      expect(await frame.LoadFootprint(new LIB_ID('', 'R_0805'))).toBeNull();
      expect(loaded).toEqual([]);
    });

    it('no adapter, no footprint', async () => {
      const { frame } = setup();
      expect(await frame.LoadFootprint(new LIB_ID('Lib', 'R_0805'))).toBeNull();
    });
  });
});

describe('PCB_BASE_FRAME::PlaceFootprint', () => {
  const add = (env: Env, aRef: string): FOOTPRINT => {
    const fp = libraryFootprint();
    fp.SetReference(aRef);
    env.board.Add(fp);
    return fp;
  };

  it('a new footprint files a NEWITEM undo entry, and undoing it removes the footprint', () => {
    const env = setup();
    const fp = add(env, 'U1');
    fp.SetFlags(IS_NEW);
    env.frame.PlaceFootprint(fp, false, { x: 100, y: 200 });

    expect(env.frame.GetUndoCommandCount()).toBe(1);
    const cmd = env.frame.PopCommandFromUndoList()!;
    expect(cmd.GetPickedItem(0)).toBe(fp);
    expect(cmd.GetPickedItemStatus(0)).toBe(UNDO_REDO.NEWITEM);
    env.frame.PushCommandToUndoList(cmd);
    env.frame.RestoreCopyFromUndoList();
    expect(env.board.Footprints()).not.toContain(fp);
  });

  it('puts the footprint at the given position, or at the cursor', () => {
    const env = setup();
    const a = add(env, 'A');
    const b = add(env, 'B');
    env.frame.PlaceFootprint(a, false, { x: 1000, y: 2000 });
    expect(a.GetPosition()).toEqual({ x: 1000, y: 2000 });

    env.cursor = { x: 5000, y: 6000 };
    env.frame.PlaceFootprint(b, false);
    expect(b.GetPosition()).toEqual({ x: 5000, y: 6000 });
  });

  it('clears the flags, and tells the window the board changed', () => {
    const env = setup();
    const fp = add(env, 'U1');
    fp.SetFlags(IS_NEW);
    env.frame.PlaceFootprint(fp, false, { x: 0, y: 0 });
    expect(fp.GetFlags()).toBe(0);
    expect(env.modified).toBe(1);
  });

  it('a footprint that is neither new nor moving files nothing', () => {
    const env = setup();
    const fp = add(env, 'U1');
    env.frame.PlaceFootprint(fp, false, { x: 0, y: 0 });
    expect(env.frame.GetUndoCommandCount()).toBe(0);
  });

  it('a footprint being moved files a CHANGED entry', () => {
    const env = setup();
    const fp = add(env, 'U1');
    fp.SetFlags(IS_MOVING);
    env.frame.PlaceFootprint(fp, false, { x: 0, y: 0 });
    expect(env.frame.GetUndoCommandCount()).toBe(1);
    const cmd = env.frame.PopCommandFromUndoList()!;
    expect(cmd.GetPickedItem(0)).toBe(fp);
    expect(cmd.GetPickedItemStatus(0)).toBe(UNDO_REDO.CHANGED);
  });

  it('the pick list is emptied for the next placement: one entry per call, not a growing list', () => {
    const env = setup();
    const a = add(env, 'A');
    const b = add(env, 'B');
    a.SetFlags(IS_MOVING);
    b.SetFlags(IS_MOVING);
    env.frame.PlaceFootprint(a, false, { x: 0, y: 0 });
    env.frame.PlaceFootprint(b, false, { x: 0, y: 0 });
    expect(env.frame.GetUndoCommandCount()).toBe(2);
    expect(env.frame.PopCommandFromUndoList()!.GetCount()).toBe(1);
    expect(env.frame.PopCommandFromUndoList()!.GetCount()).toBe(1);
  });

  it('updates connectivity and the ratsnest only when asked', () => {
    const env = setup();
    const fp = add(env, 'U1');
    const updates: unknown[] = [];
    const conn = env.board.GetConnectivity();
    const original = conn.Update.bind(conn);
    conn.Update = (item) => {
      updates.push(item);
      return original(item);
    };
    env.frame.PlaceFootprint(fp, false, { x: 0, y: 0 });
    expect(updates).toEqual([]);
    env.frame.PlaceFootprint(fp, true, { x: 0, y: 0 });
    expect(updates).toEqual([fp]);
  });

  it('null is nothing', () => {
    const env = setup();
    env.frame.PlaceFootprint(null);
    expect(env.modified).toBe(0);
  });
});

describe('FOOTPRINT_EDIT_FRAME::SelectFootprintFromBoard', () => {
  const editFrame = (aAnswer: string | null) => {
    const shown: [string, readonly string[], readonly (readonly string[])[]][] = [];
    const frame = new FOOTPRINT_EDIT_FRAME({
      fpEdit: () => {},
      selectFromList: async (aMsg, aHeaders, aItems) => {
        shown.push([aMsg, aHeaders, aItems]);
        return aAnswer;
      },
    });
    return { frame, shown };
  };

  it('lists the references, titled with the count, and returns the chosen footprint', async () => {
    const b = board('R1', 'C7', 'U3');
    const { frame, shown } = editFrame('C7');
    const fp = await frame.SelectFootprintFromBoard(b);
    expect(shown).toEqual([['Footprints [3 items]', ['Footprint'], [['R1'], ['C7'], ['U3']]]]);
    expect(fp?.GetReference()).toBe('C7');
    expect(LoadSelectFootprintStatics().oldName).toBe('C7');
  });

  it('a cancelled dialog selects nothing', async () => {
    const { frame } = editFrame(null);
    expect(await frame.SelectFootprintFromBoard(board('R1'))).toBeNull();
  });

  it('a name the board does not have selects nothing', async () => {
    const { frame } = editFrame('X9');
    expect(await frame.SelectFootprintFromBoard(board('R1'))).toBeNull();
  });

  it('an empty board lists zero items', async () => {
    const { frame, shown } = editFrame(null);
    await frame.SelectFootprintFromBoard(board());
    expect(shown[0]![0]).toBe('Footprints [0 items]');
  });
});
