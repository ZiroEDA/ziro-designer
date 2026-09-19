// The view → BOARD_COMMIT bridge (issue 636, stage 2): an edit made on the
// immutable Board view becomes one commit on the live BOARD, undoable through
// the frame, and the view re-derived from the BOARD is the edit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import { TOOL_MANAGER } from '@ziroeda/common/src/tool/tool_manager.js';
import { parse } from '@ziroeda/sexpr';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/src/board_item_container.js';
import { boardItemId, deleteBoardItems, moveBoardItems } from '@ziroeda/pcbnew/src/edit-board.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/src/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/src/pcb_base_frame.js';
import { boardFromBOARD, boardToBOARD } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/board_view.js';
import { commitViewToBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/board_view_commit.js';
import { FormatBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/src/pcbnew_settings.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board, PcbPad } from '@ziroeda/pcbnew/src/types.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';

const RESAVE = fileURLToPath(new URL('../../data/pcbnew/resave/', import.meta.url));

/** An empty view, for the bridge cases that want one item and nothing else. */
const EMPTY_VIEW: Board = {
  version: 20241229,
  layers: [],
  nets: new Map(),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
} as unknown as Board;

class TEST_FRAME extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();
  constructor() {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(null, null, null, this.settings, this);
  }
  override SetBoard(b: Parameters<PCB_BASE_EDIT_FRAME['SetBoard']>[0]): void {
    super.SetBoard(b);
    this.m_toolManager!.SetEnvironment(b, null, null, this.settings, this);
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
}

function load(): Board {
  const text = readFileSync(`${RESAVE}ecc83-pp.kicad_pcb`, 'utf8');
  const b = readBoard(parse(text));
  b.k!.BuildConnectivity();
  return b;
}

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('commitViewToBoard', () => {
  it('a deleted track leaves the BOARD, comes back on undo, and the re-derived view follows', () => {
    const frame = new TEST_FRAME();
    const v0 = load();
    const kb = v0.k!;
    const track = v0.tracks[0]!;
    const nTracks = kb.Tracks().length;

    const v1 = deleteBoardItems(v0, new Set([boardItemId('track', 0)]));
    expect(v1.tracks.length).toBe(v0.tracks.length - 1);

    commitViewToBoard(frame, v0, v1, 'Delete');

    expect(kb.Tracks().length).toBe(nTracks - 1);
    expect(kb.Tracks()).not.toContain(track.k);
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(frame.GetUndoActionDescription()).toBe('Delete');

    const v1b = boardFromBOARD(kb, v0.fileName);
    expect(v1b.tracks.map((t) => t.k!.m_Uuid)).toEqual(v1.tracks.map((t) => t.k!.m_Uuid));

    frame.RestoreCopyFromUndoList();
    expect(kb.Tracks().length).toBe(nTracks);
    expect(kb.Tracks()).toContain(track.k);
    expect(frame.GetRedoCommandCount()).toBe(1);

    const v2 = boardFromBOARD(kb, v0.fileName);
    expect(v2.tracks.map((t) => t.k!.m_Uuid).sort()).toEqual(
      v0.tracks.map((t) => t.k!.m_Uuid).sort(),
    );
    // the file the board writes is the file it read
    expect(FormatBoard(kb, 'pcbnew')).toBe(readFileSync(`${RESAVE}ecc83-pp.kicad_pcb`, 'utf8'));
  });

  it('a moved footprint is one modify of the footprint; undo puts it back', () => {
    const frame = new TEST_FRAME();
    const v0 = load();
    const kb = v0.k!;
    const fp = v0.footprints[0]!;
    const pos = fp.k!.GetPosition();

    const v1 = moveBoardItems(v0, new Set([boardItemId('footprint', 0)]), { x: 1_000_000, y: 0 });
    commitViewToBoard(frame, v0, v1, 'Move');

    expect(fp.k!.GetPosition()).toEqual({ x: pos.x + 1_000_000, y: pos.y });
    expect(fp.k!.Pads()[0]!.GetPosition().x).toBe(v0.footprints[0]!.pads[0]!.k!.GetPosition().x);
    const cmd = frame.PopCommandFromUndoList()!;
    expect(cmd.GetCount()).toBe(1);
    expect(cmd.GetPickedItem(0)).toBe(fp.k);
    frame.PushCommandToUndoList(cmd);

    frame.RestoreCopyFromUndoList();
    expect(fp.k!.GetPosition()).toEqual(pos);
    expect(boardFromBOARD(kb).footprints[0]!.at).toEqual(fp.at);
  });

  it('an unchanged view commits nothing', () => {
    const frame = new TEST_FRAME();
    const v0 = load();
    commitViewToBoard(frame, v0, { ...v0 }, 'Nothing');
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});

/**
 * `boardToBOARD` has to resolve what the view left unsaid the way the PARSER
 * resolves it, not the way a default-constructed model does.
 *
 * `thermalSpokeAngle` is the case that bit. `types.ts` says an absent one
 * means "the file stated none, so `defaultThermalSpokeAngle` answers"; the
 * C++ parser writes that resolution into every pad it reads
 * (`pcb_io_kicad_sexpr_parser.cpp:6442-6469`), so a pad that has been through
 * a file always carries a value. But `PADSTACK`'s constructor seeds
 * `ANGLE_45` (`padstack.cpp:54`), and a bridge that only writes a STATED
 * angle leaves that seed standing - so a rect pad built from a view got 45,
 * an X, where the same pad read from a file gets 90, a `+`.
 */
describe('boardToBOARD resolves an unstated spoke angle as the parser does', () => {
  const padView = (over: Partial<PcbPad>): PcbPad => ({
    number: '1',
    type: 'smd',
    shape: 'rect',
    at: { x: 10_000_000, y: 10_000_000 },
    angle: 0,
    size: { x: 2_000_000, y: 2_000_000 },
    layers: ['F.Cu'],
    net: 0,
    ...over,
  });

  const throughBridge = (over: Partial<PcbPad>): number | undefined => {
    const view: Board = {
      ...EMPTY_VIEW,
      layers: [
        { id: 0, name: 'F.Cu', kind: 'signal' },
        { id: 2, name: 'B.Cu', kind: 'signal' },
      ],
      footprints: [
        {
          lib: 'R',
          at: { x: 0, y: 0 },
          angle: 0,
          layer: 'F.Cu',
          pads: [padView(over)],
          shapes: [],
          texts: [],
          points: [],
          barcodes: [],
          models: [],
        } as unknown as Board['footprints'][number],
      ],
    };

    return boardFromBOARD(boardToBOARD(view)).footprints[0]!.pads[0]!.thermalSpokeAngle;
  };

  it.each([
    ['a rectangle', { shape: 'rect' as const }, 90],
    ['an oval', { shape: 'oval' as const }, 90],
    ['a circle', { shape: 'circle' as const }, 45],
    ['a roundrect', { shape: 'roundrect' as const, roundrectRatio: 0.25 }, 90],
    // The anchor is what a CUSTOM pad's default turns on, and it is the only
    // thing that reads `anchorShape`.
    ['a custom pad on a circular anchor', { shape: 'custom' as const }, 45],
    [
      'a custom pad on a rect anchor',
      { shape: 'custom' as const, anchorShape: 'rect' as const },
      90,
    ],
  ])('%s with no stated angle comes back at %s', (_name, over, want) => {
    expect(throughBridge(over)).toBe(want);
  });

  it('a stated angle is still the one that wins', () => {
    expect(throughBridge({ shape: 'rect', thermalSpokeAngle: 45 })).toBe(45);
    expect(throughBridge({ shape: 'circle', thermalSpokeAngle: 90 })).toBe(90);
  });
});
