// BOARD_COMMIT and the frame's undo/redo (issue 636, stage 2):
// board_commit.cpp and undo_redo.cpp over the item classes, driven the way
// PCB_EDIT_FRAME::setupTools wires them — a TOOL_MANAGER whose model is the
// BOARD and whose holder is the frame. The expectations are the C++'s
// contract: what each Push files on the undo stack, what an undo and a redo
// put back, what the listeners hear, and what Revert restores.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { UR_TRANSIENT } from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_LISTENER } from '@ziroeda/pcbnew/board.js';
import { APPEND_UNDO, BOARD_COMMIT, SKIP_UNDO } from '@ziroeda/pcbnew/board_commit.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';

const RESAVE = fileURLToPath(new URL('../../data/pcbnew/resave/', import.meta.url));

/** A PCB_EDIT_FRAME without the window: the model, the settings and the tool manager. */
class TEST_PCB_EDIT_FRAME extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();
  modifyCount = 0;

  constructor(board: BOARD) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.SetBoard(board);
    // PCB_EDIT_FRAME::setupTools
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(board, null, null, this.settings, this);
  }

  GetName(): string {
    return 'PcbFrame';
  }
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.settings;
  }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }
  override OnModify(): void {
    super.OnModify();
    this.modifyCount++;
  }
}

class COUNTING_LISTENER extends BOARD_LISTENER {
  added: BOARD_ITEM[] = [];
  removed: BOARD_ITEM[] = [];
  changed: BOARD_ITEM[] = [];
  ratsnest = 0;
  override OnBoardCompositeUpdate(
    _b: BOARD,
    a: BOARD_ITEM[],
    r: BOARD_ITEM[],
    c: BOARD_ITEM[],
  ): void {
    this.added.push(...a);
    this.removed.push(...r);
    this.changed.push(...c);
  }
  override OnBoardRatsnestChanged(): void {
    this.ratsnest++;
  }
}

function setup(): { board: BOARD; frame: TEST_PCB_EDIT_FRAME; listener: COUNTING_LISTENER } {
  const f = `${RESAVE}ecc83-pp.kicad_pcb`;
  const board = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
  board.BuildConnectivity();
  const frame = new TEST_PCB_EDIT_FRAME(board);
  const listener = new COUNTING_LISTENER();
  board.AddListener(listener);
  return { board, frame, listener };
}

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('BOARD_COMMIT + PCB_BASE_EDIT_FRAME undo/redo', () => {
  it('Push adds the item, files one undo command and tells the listeners; undo removes it, redo restores it', () => {
    const { board, frame, listener } = setup();
    const before = board.Tracks().length;

    const track = new PCB_TRACK(board);
    track.SetStart({ x: 100_000_000, y: 100_000_000 });
    track.SetEnd({ x: 110_000_000, y: 100_000_000 });
    track.SetWidth(250_000);
    track.SetLayer(PCB_LAYER_ID.F_Cu);

    const commit = new BOARD_COMMIT(frame);
    commit.Add(track);
    commit.Push('Add track');

    expect(board.Tracks().length).toBe(before + 1);
    expect(board.Tracks()).toContain(track);
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(frame.GetUndoActionDescription()).toBe('Add track');
    expect(frame.modifyCount).toBe(1);
    expect(listener.added).toEqual([track]);
    expect(listener.ratsnest).toBe(1);
    expect(board.GetConnectivity().GetConnectivityAlgo().ItemExists(track)).toBe(true);

    frame.RestoreCopyFromUndoList();
    expect(board.Tracks().length).toBe(before);
    expect(frame.GetUndoCommandCount()).toBe(0);
    expect(frame.GetRedoCommandCount()).toBe(1);
    expect(track.HasFlag(UR_TRANSIENT)).toBe(true);
    expect(listener.removed).toEqual([track]);

    frame.RestoreCopyFromRedoList();
    expect(board.Tracks()).toContain(track);
    expect(track.HasFlag(UR_TRANSIENT)).toBe(false);
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(frame.GetRedoCommandCount()).toBe(0);
    expect(listener.added).toEqual([track, track]);
  });

  it('Modify keeps an image; undo swaps it back; a new Push clears the redo list', () => {
    const { board, frame, listener } = setup();
    const track = board.Tracks().find((t) => t.Type() === KICAD_T.PCB_TRACE_T)!;
    const width = track.GetWidth();

    const commit = new BOARD_COMMIT(frame);
    commit.Modify(track);
    track.SetWidth(width + 100_000);
    commit.Push('Widen');

    expect(track.GetWidth()).toBe(width + 100_000);
    expect(listener.changed).toEqual([track]);
    const cmd = frame.PopCommandFromUndoList()!;
    expect(cmd.GetCount()).toBe(1);
    expect(cmd.GetPickedItemStatus(0)).toBe(UNDO_REDO.CHANGED);
    expect((cmd.GetPickedItemLink(0) as PCB_TRACK).GetWidth()).toBe(width);
    expect(cmd.GetPickedItemLink(0)!.HasFlag(UR_TRANSIENT)).toBe(true);
    frame.PushCommandToUndoList(cmd);

    frame.RestoreCopyFromUndoList();
    expect(track.GetWidth()).toBe(width);
    expect(frame.GetRedoCommandCount()).toBe(1);

    const commit2 = new BOARD_COMMIT(frame);
    commit2.Modify(track);
    track.SetWidth(width + 1);
    commit2.Push('Widen again');
    expect(frame.GetRedoCommandCount()).toBe(0);
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it('in the board editor a pad change is filed against its footprint', () => {
    const { board, frame } = setup();
    const fp = board.Footprints()[0]!;
    const pad = fp.Pads()[0]!;
    const size = pad.GetSize(PCB_LAYER_ID.F_Cu);

    const commit = new BOARD_COMMIT(frame);
    commit.Modify(pad);
    pad.SetSize(PCB_LAYER_ID.F_Cu, { x: size.x + 10_000, y: size.y });
    commit.Push('Pad');

    const cmd = frame.PopCommandFromUndoList()!;
    expect(cmd.GetPickedItem(0)).toBe(fp);
    frame.PushCommandToUndoList(cmd);

    frame.RestoreCopyFromUndoList();
    expect(fp.Pads()[0]!.GetSize(PCB_LAYER_ID.F_Cu)).toEqual(size);
  });

  it('SKIP_UNDO files nothing; APPEND_UNDO joins the previous command', () => {
    const { board, frame } = setup();
    const t1 = new PCB_TRACK(board);
    t1.SetStart({ x: 1, y: 1 });
    t1.SetEnd({ x: 2, y: 2 });
    const t2 = new PCB_TRACK(board);
    t2.SetStart({ x: 3, y: 3 });
    t2.SetEnd({ x: 4, y: 4 });

    const c1 = new BOARD_COMMIT(frame);
    c1.Add(t1);
    c1.Push('One', SKIP_UNDO);
    expect(frame.GetUndoCommandCount()).toBe(0);
    expect(board.Tracks()).toContain(t1);

    const c2 = new BOARD_COMMIT(frame);
    c2.Add(t2);
    c2.Push('Two');
    const c3 = new BOARD_COMMIT(frame);
    c3.Remove(t1);
    c3.Push('Three', APPEND_UNDO);
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(frame.GetUndoActionDescription()).toBe('Two');
    const cmd = frame.PopCommandFromUndoList()!;
    expect(cmd.GetCount()).toBe(2);
    expect(cmd.GetPickedItemStatus(0)).toBe(UNDO_REDO.NEWITEM);
    expect(cmd.GetPickedItemStatus(1)).toBe(UNDO_REDO.DELETED);
  });

  it('Revert puts a modified item back and a staged add away', () => {
    const { board, frame } = setup();
    const track = board.Tracks().find((t) => t.Type() === KICAD_T.PCB_TRACE_T)!;
    const width = track.GetWidth();
    const added = new PCB_TRACK(board);

    const commit = new BOARD_COMMIT(frame);
    commit.Modify(track);
    track.SetWidth(width * 2);
    commit.Added(added);
    board.Add(added);
    commit.Revert();

    expect(track.GetWidth()).toBe(width);
    expect(board.Tracks()).not.toContain(added);
    expect(commit.Empty()).toBe(true);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('a group staged with RECURSE stages its members too', () => {
    const { board, frame } = setup();
    const group = board.Groups()[0];
    if (!group) return;
    const commit = new BOARD_COMMIT(frame);
    commit.Modify(group, null, RECURSE_MODE.RECURSE);
    const staged = new Set<BOARD_ITEM>();
    for (const m of group.GetItems()) if (commit.GetStatus(m)) staged.add(m as BOARD_ITEM);
    expect(staged.size).toBe(group.GetItems().size);
  });
});
