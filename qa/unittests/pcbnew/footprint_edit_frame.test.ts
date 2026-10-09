// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FOOTPRINT_EDIT_FRAME (`pcbnew/footprint_edit_frame.cpp`) as a
 * PCB_BASE_EDIT_FRAME: its footprint-holder BOARD, the tools it registers in
 * footprint mode, and ReloadFootprint.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD_USE } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SetInfoPresenter, SetQuestionPresenter } from '@ziroeda/common/confirm.js';
import type { LIB_TREE } from '@ziroeda/common/eda_draw_frame.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { FOOTPRINT_LIBRARY_STORE } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { CLEARANCE_LAYER_FOR, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { attachFootprintFrameCanvas } from './support/footprint_frame_canvas.js';
import { PCB_TOOL_BASE } from '@ziroeda/pcbnew/tools/pcb_tool_base.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A footprint placed flipped and rotated on a board, as a library archive can store it. */
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (7 "B.SilkS" user))
  (setup)
  (net 0 "")
  (footprint "Lib:R" (layer "B.Cu") (at 30 40 90) (uuid "${U(1)}")
    (pad "1" smd rect (at 1 0 90) (size 1 1) (layers "B.Cu") (uuid "${U(2)}")))
)`;

let frame: FOOTPRINT_EDIT_FRAME;

const fpFromBoard = (): FOOTPRINT => ParseBoard(BOARD_TEXT).GetFirstFootprint()!;

beforeEach(() => {
  installPgm();
  frame = new FOOTPRINT_EDIT_FRAME({ fpEdit: () => {} });
});

describe('the frame', () => {
  it('holds an empty footprint-holder board with no clearance and no mask margin', () => {
    const board = frame.GetBoard()!;

    expect(board.GetBoardUse()).toBe(BOARD_USE.FPHOLDER);
    expect(board.IsFootprintHolder()).toBe(true);
    expect(board.GetDesignSettings().m_NetSettings.GetDefaultNetclass().GetClearance()).toBe(0);
    expect(board.GetDesignSettings().m_SolderMaskExpansion).toBe(0);
    expect(frame.GetModel()).toBeNull();
  });

  it('registers its tools in footprint mode, none in board mode', () => {
    const tools = [...frame.GetToolManager()!.Tools()].filter((t) => t instanceof PCB_TOOL_BASE);

    expect(tools.length).toBeGreaterThan(0);

    for (const t of tools) {
      expect((t as PCB_TOOL_BASE).IsFootprintEditor()).toBe(true);
      expect((t as PCB_TOOL_BASE).IsBoardEditor()).toBe(false);
    }

    // The board editor's own tools are not the footprint editor's.
    const names = [...frame.GetToolManager()!.Tools()].map((t) => t.GetName());
    expect(names).not.toContain('pcbnew.EditorControl');
    expect(names).not.toContain('pcbnew.InteractiveRouter');
    expect(names).toContain('pcbnew.InteractiveEdit');
  });
});

describe('ReloadFootprint', () => {
  it('replaces the footprint, at the origin, on the front and unrotated', () => {
    frame.ReloadFootprint(fpFromBoard());
    const second = fpFromBoard();
    frame.ReloadFootprint(second);

    const board = frame.GetBoard()!;
    expect(board.Footprints()).toHaveLength(1);
    expect(frame.GetModel() === second).toBe(true);

    expect(second.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(second.IsFlipped()).toBe(false);
    expect(second.GetOrientation().AsDegrees()).toBe(0);
    expect(second.HasFlag(IS_NEW)).toBe(true);
    // The pad came to the front with it.
    expect(second.Pads()[0]!.GetLayerName()).toBe('F.Cu');
  });

  it('keeps an unparented copy of the footprint as loaded, and its name', () => {
    const fp = fpFromBoard();
    frame.ReloadFootprint(fp);

    const copy = frame.GetOriginalFootprintCopy()!;
    expect(copy === fp).toBe(false);
    expect(copy.GetParent()).toBeNull();
    // The copy was taken before AddFootprintToBoard moved the footprint.
    expect(copy.GetPosition()).not.toEqual({ x: 0, y: 0 });
    expect(frame.GetFootprintNameWhenLoaded()).toBe('R');
    expect(frame.GetLoadedFPID().Format()).toBe('Lib:R');
  });
});

describe('the library round trip (footprint_editor_utils.cpp, footprint_libraries_utils.cpp)', () => {
  const FP_TEXT = (aName: string): string => `(footprint "${aName}" (layer "F.Cu") (uuid "${U(10)}")
  (property "Reference" "" (at 0 0 0) (layer "F.SilkS") (uuid "${U(11)}"))
  (property "Value" "${aName}" (at 0 1 0) (layer "F.Fab") (uuid "${U(12)}"))
  (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid "${U(13)}")))`;

  let store: FOOTPRINT_LIBRARY_STORE;
  let written: [string, string, string][];
  let removed: [string, string][];
  let answer: 'save' | 'discard' | 'cancel';
  let loaded: string[];
  let questions: string[];
  let yes: boolean;
  let infobar: string[];
  let reverts: string[];
  let tree: FAKE_LIB_TREE;

  /** `LIB_TREE` as the frame asks it: the selection, and what it was told. */
  class FAKE_LIB_TREE implements LIB_TREE {
    sel = new LIB_ID();
    selected: string[] = [];
    centred: string[] = [];
    GetSelectedTreeNodes(): number {
      return 0;
    }
    Regenerate(): void {}
    CenterLibId(aLibId: LIB_ID): void {
      this.centred.push(aLibId.Format());
    }
    GetSelectedLibId(): LIB_ID {
      return new LIB_ID(this.sel.GetLibNickname(), this.sel.GetLibItemName());
    }
    SelectLibId(aLibId: LIB_ID): void {
      this.sel = aLibId;
      this.selected.push(aLibId.Format());
    }
    Unselect(): void {
      this.sel = new LIB_ID();
    }
    RefreshLibTree(): void {}
  }

  beforeEach(() => {
    written = [];
    removed = [];
    answer = 'cancel';
    loaded = [];
    questions = [];
    yes = true;
    infobar = [];
    reverts = [];
    store = new FOOTPRINT_LIBRARY_STORE({
      footprintText: (_aNick, aName) => Promise.resolve(FP_TEXT(aName)),
      flipLeftRight: () => false,
      writeFootprintFile: (aDir, aFile, aText) => written.push([aDir, aFile, aText]),
      removeFootprintFile: (aDir, aFile) => removed.push([aDir, aFile]),
    });
    store.AddProjectLibrary('Lib', 'Lib.pretty', [
      { fileName: 'R.kicad_mod', text: FP_TEXT('R') },
      { fileName: 'C.kicad_mod', text: FP_TEXT('C') },
      { fileName: 'L.kicad_mod', text: FP_TEXT('L') },
    ]);
    store.AddGlobalLibrary('Hosted', ['H']);
    SetQuestionPresenter((aMessage: string) => {
      questions.push(aMessage);
      return Promise.resolve(yes);
    });
    tree = new FAKE_LIB_TREE();
    frame = new FOOTPRINT_EDIT_FRAME({
      fpEdit: () => {},
      askUnsavedChanges: () => Promise.resolve(answer),
      onFootprintLoaded: (aId: LIB_ID) => loaded.push(aId.Format()),
      showInfoBarError: (aMsg: string) => infobar.push(aMsg),
      showInfoBarWarning: (aMsg: string) => infobar.push(aMsg),
      confirmRevert: (aMsg: string) => {
        reverts.push(aMsg);
        return Promise.resolve(yes);
      },
    });
    frame.SetFootprintLibAdapter(store);
    frame.SetLibTree(tree);
    attachFootprintFrameCanvas(frame);
  });

  const load = (aName: string, aLib = 'Lib'): Promise<void> =>
    frame.LoadFootprintFromLibrary(new LIB_ID(aLib, aName));
  /** Every handler starts its async half and returns; let it finish. */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const run = async (aAction: TOOL_ACTION): Promise<void> => {
    frame.GetToolManager()!.RunAction(aAction);
    await settle();
  };

  it('loads the footprint onto an emptied board, ref and value filled in, unmodified', async () => {
    await load('R');

    const fp = frame.GetBoard()!.GetFirstFootprint()!;
    expect(fp.GetFPID().Format()).toBe('Lib:R');
    expect(fp.GetReference()).toBe('Ref**');
    expect(fp.GetValue()).toBe('R');
    expect(frame.IsContentModified()).toBe(false);
    expect(frame.GetBoard()!.IsFootprintHolder()).toBe(true);
    // Clear_Pcb's new board is given the frame's libraries.
    expect(frame.GetBoard()!.GetFootprintLibAdapter()).toBe(store);
    expect(loaded).toEqual(['Lib:R']);
  });

  it('a hosted footprint is fetched before it is loaded', async () => {
    await load('H', 'Hosted');

    expect(frame.GetLoadedFPID().Format()).toBe('Hosted:H');
  });

  it('a modified footprint asks first: Cancel keeps it, Discard drops it, Save saves it', async () => {
    await load('R');
    frame.OnModify();

    answer = 'cancel';
    await load('C');
    expect(frame.GetLoadedFPID().GetLibItemName()).toBe('R');

    answer = 'save';
    await load('C');
    expect(written.map(([d, f]) => [d, f])).toEqual([['Lib.pretty', 'R.kicad_mod']]);
    expect(frame.GetLoadedFPID().GetLibItemName()).toBe('C');

    frame.OnModify();
    answer = 'discard';
    await load('L');
    expect(written).toHaveLength(1);
    expect(frame.GetLoadedFPID().GetLibItemName()).toBe('L');
  });

  it('writes the footprint under its bare item name, then restores the nickname', async () => {
    await load('R');
    const fp = frame.GetBoard()!.GetFirstFootprint()!;

    expect(await frame.SaveFootprint(fp)).toBe(true);
    expect(written[0]![2]).toMatch(/^\(footprint "R"/);
    expect(fp.GetFPID().Format()).toBe('Lib:R');
  });

  it('saving a renamed footprint deletes the old file first', async () => {
    await load('R');
    const fp = frame.GetBoard()!.GetFirstFootprint()!;
    fp.SetFPID(new LIB_ID('Lib', 'R_new'));

    expect(await frame.SaveFootprint(fp)).toBe(true);
    expect(removed).toEqual([['Lib.pretty', 'R.kicad_mod']]);
    expect(written.map(([, f]) => f)).toEqual(['R_new.kicad_mod']);
    expect(store.GetFootprintNames('Lib')).toEqual(['C', 'L', 'R_new']);
    expect(frame.GetFootprintNameWhenLoaded()).toBe('R_new');
  });

  it('a read-only library refuses a delete, on the infobar, without asking', async () => {
    expect(await frame.DeleteFootprintFromLibrary(new LIB_ID('Hosted', 'H'), true)).toBe(false);
    expect(infobar).toEqual(["Library 'Hosted' is read only."]);
    expect(questions).toEqual([]);
  });

  it('a delete asks first, and No keeps the footprint', async () => {
    yes = false;
    expect(await frame.DeleteFootprintFromLibrary(new LIB_ID('Lib', 'C'), true)).toBe(false);
    expect(questions).toEqual(["Delete footprint 'C' from library 'Lib'?"]);
    expect(store.FootprintExists('Lib', 'C')).toBe(true);

    yes = true;
    expect(await frame.DeleteFootprintFromLibrary(new LIB_ID('Lib', 'C'), true)).toBe(true);
    expect(store.FootprintExists('Lib', 'C')).toBe(false);
  });

  it('a duplicate takes the first free <name>_<n>, its value following', async () => {
    store.AddProjectLibrary('Dup', 'Dup.pretty', [
      { fileName: 'R.kicad_mod', text: FP_TEXT('R') },
      { fileName: 'R_1.kicad_mod', text: FP_TEXT('R_1') },
    ]);
    const fp = store.LoadFootprint('Dup', 'R', true)!;

    expect(await frame.DuplicateFootprint(fp)).toBe(true);
    expect(fp.GetFPID().Format()).toBe('Dup:R_2');
    expect(fp.GetValue()).toBe('R_2');
    expect(store.GetFootprintNames('Dup')).toEqual(['R', 'R_1', 'R_2']);
  });

  it('revert asks, then puts the as-loaded footprint back, unmodified', async () => {
    await load('R');
    frame.GetBoard()!.GetFirstFootprint()!.SetValue('changed');
    frame.OnModify();

    expect(await frame.RevertFootprint()).toBe(true);
    expect(reverts).toEqual(["Revert 'R' to last version saved?"]);
    expect(frame.GetBoard()!.GetFirstFootprint()!.GetValue()).toBe('R');
    expect(frame.IsContentModified()).toBe(false);
  });

  it('an unmodified footprint has nothing to revert to', async () => {
    await load('R');

    expect(await frame.RevertFootprint()).toBe(false);
    expect(reverts).toEqual([]);
  });

  it('GetTargetFPID is the tree selection, else the loaded footprint', async () => {
    await load('R');
    expect(frame.GetTargetFPID().Format()).toBe('Lib:R');

    tree.sel = new LIB_ID('Lib', 'C');
    expect(frame.GetTargetFPID().Format()).toBe('Lib:C');
  });

  it('UpdateTitle is KiCad’s: a star when modified, [Read Only] for a hosted library', async () => {
    const titles: string[] = [];
    frame = new FOOTPRINT_EDIT_FRAME({ fpEdit: () => {}, setTitle: (t) => titles.push(t) });
    frame.SetFootprintLibAdapter(store);
    attachFootprintFrameCanvas(frame);

    frame.UpdateTitle();
    await frame.LoadFootprintFromLibrary(new LIB_ID('Lib', 'R'));
    frame.OnModify();
    frame.UpdateTitle();
    await frame.Clear_Pcb(false);
    await frame.LoadFootprintFromLibrary(new LIB_ID('Hosted', 'H'));
    frame.UpdateTitle();

    expect(titles).toEqual([
      '[no footprint loaded] — Footprint Editor',
      '*Lib:R — Footprint Editor',
      'Hosted:H [Read Only] — Footprint Editor',
    ]);
  });

  describe('FOOTPRINT_EDITOR_CONTROL', () => {
    it('Save writes the loaded footprint and clears the modify flag', async () => {
      await load('R');
      frame.OnModify();
      tree.sel = new LIB_ID('Lib', 'R');

      await run(ACTIONS.save);

      expect(written.map(([, f]) => f)).toEqual(['R.kicad_mod']);
      expect(frame.IsContentModified()).toBe(false);
    });

    it('Save does nothing when the tree targets another footprint', async () => {
      await load('R');
      frame.OnModify();
      tree.sel = new LIB_ID('Lib', 'C');

      await run(ACTIONS.save);

      expect(written).toEqual([]);
      expect(frame.IsContentModified()).toBe(true);
    });

    it('New Footprint in a writable library is saved there at once', async () => {
      tree.sel = new LIB_ID('Lib', '');

      await run(PCB_ACTIONS.newFootprint);

      expect(frame.GetLoadedFPID().Format()).toBe('Lib:Untitled');
      expect(store.FootprintExists('Lib', 'Untitled')).toBe(true);
      expect(frame.IsContentModified()).toBe(false);
    });

    it('New Footprint in a read-only library stays unsaved, with a warning', async () => {
      tree.sel = new LIB_ID('Hosted', '');

      await run(PCB_ACTIONS.newFootprint);

      expect(frame.GetBoard()!.GetFirstFootprint()).not.toBeNull();
      expect(written).toEqual([]);
      expect(infobar).toEqual([
        "The footprint could not be added to the selected library ('Hosted'). This library is read-only.",
      ]);
    });

    it('Delete Footprint removes the tree target and empties the board when it was loaded', async () => {
      await load('R');
      tree.sel = new LIB_ID('Lib', 'R');

      await run(PCB_ACTIONS.deleteFootprint);

      expect(store.FootprintExists('Lib', 'R')).toBe(false);
      expect(frame.GetBoard()!.GetFirstFootprint()).toBeNull();
    });

    it('Copy then Paste Footprint saves a _copy into the selected library and loads it', async () => {
      tree.sel = new LIB_ID('Lib', 'C');
      await run(PCB_ACTIONS.copyFootprint);
      tree.sel = new LIB_ID('Lib', '');
      await run(PCB_ACTIONS.pasteFootprint);

      expect(store.GetFootprintNames('Lib')).toEqual(['R', 'C', 'L', 'C_copy']);
      expect(frame.GetLoadedFPID().Format()).toBe('Lib:C_copy');
      expect(tree.selected).toContain('Lib:C_copy');
    });

    it('Cut Footprint copies, then deletes the original', async () => {
      tree.sel = new LIB_ID('Lib', 'L');
      await run(PCB_ACTIONS.cutFootprint);

      expect(store.FootprintExists('Lib', 'L')).toBe(false);
    });

    it('Repair Footprint replaces duplicate UUIDs, the footprint keeping its own', async () => {
      await load('R');
      const fp = frame.GetBoard()!.GetFirstFootprint()!;
      const pad = fp.Pads()[0]!;
      (pad as { m_Uuid: string }).m_Uuid = fp.m_Uuid;
      const info: string[] = [];
      SetInfoPresenter((aMsg: string) => {
        info.push(aMsg);
        return Promise.resolve();
      });

      await run(PCB_ACTIONS.repairFootprint);

      expect(fp.m_Uuid).toBe(U(10));
      expect(pad.m_Uuid).not.toBe(U(10));
      expect(info).toEqual(['1 potential problems repaired.']);
      expect(frame.IsContentModified()).toBe(true);
    });

    it('a line mode is written into the footprint editor settings', async () => {
      await run(PCB_ACTIONS.lineMode90);

      expect(frame.GetFootprintEditorSettings().m_AngleSnapMode).toBe(LEADER_MODE.DEG90);
    });
  });

  describe('the window-facing half (F2d)', () => {
    it('UpdateStatusBar writes the cursor: X and Y in field 2, dx, dy and dist in field 3', () => {
      const fields: string[] = [];
      frame.SetStatusTextSink((aText, aField) => {
        fields[aField] = aText;
      });
      const canvas = frame.GetCanvas() as unknown as Record<string, unknown>;
      const controls = (canvas.GetViewControls as () => Record<string, unknown>)();
      controls.GetCursorPosition = () => ({ x: 4_000_000, y: 5_000_000 });
      // `ACTIONS::resetLocalCoords`' origin: the deltas run from it.
      frame.GetScreen()!.m_LocalOrigin = { x: 1_000_000, y: 1_000_000 };

      frame.UpdateStatusBar();

      expect(fields[2]).toBe('X 4.0000  Y 5.0000');
      expect(fields[3]).toBe('dx 3.0000  dy 4.0000  dist 5.0000');
    });

    it("SetActiveLayer shows the active copper layer's clearance layer and hides the last one", () => {
      const view = frame.GetCanvas()!.GetView();
      // From a non-copper layer, so the first switch is a change.
      frame.SetActiveLayer(PCB_LAYER_ID.F_SilkS);
      view.SetLayerVisible(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu), false);
      view.SetLayerVisible(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.B_Cu), false);

      frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
      expect(view.IsLayerVisible(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu))).toBe(true);

      frame.SetActiveLayer(PCB_LAYER_ID.B_Cu);
      expect(view.IsLayerVisible(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.F_Cu))).toBe(false);
      expect(view.IsLayerVisible(CLEARANCE_LAYER_FOR(PCB_LAYER_ID.B_Cu))).toBe(true);
      expect(frame.GetActiveLayer()).toBe(PCB_LAYER_ID.B_Cu);
    });

    it("fpedit.json's design settings reach the board now and every board Clear_Pcb makes", async () => {
      const silk = {
        line_width: 0.2,
        text_size_h: 2,
        text_size_v: 2.5,
        text_thickness: 0.3,
        text_italic: true,
      };
      const cfg = {
        default_footprint_text_items: [
          { text: 'U**', visible: true, layer: 'F.SilkS' },
          { text: '', visible: false, layer: 'F.Fab' },
        ],
        default_footprint_layer_names: {},
        user_layer_count: 0,
        silk,
        copper: silk,
        edges: { line_width: 0.05 },
        courtyard: { line_width: 0.05 },
        fab: silk,
        others: silk,
      } as never;

      frame.LoadFootprintEditorDesignSettings(cfg);
      // The board in hand takes them at once (LoadSettings / CommonSettingsChanged)...
      expect(frame.GetBoard()!.GetDesignSettings().m_TextItalic[0]).toBe(true);
      // ...and so does the next one.
      await frame.Clear_Pcb(false);

      const bds = frame.GetBoard()!.GetDesignSettings();
      expect(bds.m_DefaultFPTextItems.map((t) => t.m_Text)).toEqual(['U**', '']);
      expect(bds.m_TextSize[0]).toEqual({ x: 2_000_000, y: 2_500_000 });
      expect(bds.m_TextThickness[0]).toBe(300_000);
      expect(bds.m_TextItalic[0]).toBe(true);
      expect(bds.m_LineThickness[2]).toBe(50_000);

      // CreateNewFootprint takes them: the reference is item 0's text.
      expect(frame.CreateNewFootprint('', '').GetReference()).toBe('U**');
    });

    it('and Cancel saves nothing back', async () => {
      tree.sel = new LIB_ID('Lib', 'C');
      frame = new FOOTPRINT_EDIT_FRAME({
        fpEdit: () => {},
        showFootprintPropertiesFpEditorDialog: (aDialog) => {
          // Whatever the controls hold, Cancel is not OK.
          aDialog.GetFootprint().SetLibDescription('cancelled');
          return Promise.resolve(false);
        },
      });
      frame.SetFootprintLibAdapter(store);
      frame.SetLibTree(tree);
      attachFootprintFrameCanvas(frame);
      await frame.LoadFootprintFromLibrary(new LIB_ID('Lib', 'R'));

      await run(PCB_ACTIONS.footprintProperties);

      expect(written).toEqual([]);
      expect(store.LoadFootprint('Lib', 'C', true)!.GetLibDescription()).toBe('');
    });

    it('Footprint Properties on a tree footprint that is not loaded saves it back on OK', async () => {
      await load('R');
      tree.sel = new LIB_ID('Lib', 'C');
      const edits: string[] = [];
      frame = new FOOTPRINT_EDIT_FRAME({
        fpEdit: () => {},
        showFootprintPropertiesFpEditorDialog: (aDialog) => {
          const v = aDialog.TransferDataToWindow();
          edits.push(aDialog.GetFootprint().GetFPID().Format());
          aDialog.TransferDataFromWindow({ ...v, description: 'from the tree' });
          return Promise.resolve(true);
        },
      });
      frame.SetFootprintLibAdapter(store);
      frame.SetLibTree(tree);
      attachFootprintFrameCanvas(frame);
      await frame.LoadFootprintFromLibrary(new LIB_ID('Lib', 'R'));

      await run(PCB_ACTIONS.footprintProperties);

      expect(edits).toEqual(['Lib:C']);
      expect(store.LoadFootprint('Lib', 'C', true)!.GetLibDescription()).toBe('from the tree');
      // The footprint on the canvas is not the one edited.
      expect(frame.GetBoard()!.GetFirstFootprint()!.GetFPID().Format()).toBe('Lib:R');
    });
  });
});
