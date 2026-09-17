// What a footprint move costs through the view bridge on a big board: the
// tool's moveBoardItems on the view, commitViewToBoard (Modify staging,
// boardToBOARD write-back, BOARD_COMMIT::Push with connectivity + teardrops),
// then boardFromBOARD, the listener's re-derivation React renders from.
//   NODE_OPTIONS=--max-old-space-size=12000 node <vite-node> qa/perf/move_commit_timing.mts <board.kicad_pcb>
import { readFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import { TOOL_MANAGER } from '@ziroeda/common/src/tool/tool_manager.js';
import { parse } from '@ziroeda/sexpr';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/src/board_item_container.js';
import { boardItemId, moveBoardItems } from '@ziroeda/pcbnew/src/edit-board.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/src/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/src/pcb_base_frame.js';
import { boardFromBOARD } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/board_view.js';
import { commitViewToBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/board_view_commit.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/src/pcbnew_settings.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

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
  GetName(): string { return 'PcbFrame'; }
  GetModel(): BOARD_ITEM_CONTAINER | null { return this.m_pcb; }
  GetPcbNewSettings(): PCBNEW_SETTINGS { return this.settings; }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE { return { m_DisplayInvertXAxis: false, m_DisplayInvertYAxis: false }; }
}

await EMBEDDED_FILES.InitCodec();
const f = process.argv[2]!;
const T = (label: string, fn: () => unknown): unknown => { const t = performance.now(); const r = fn(); console.log(`  ${label.padEnd(44)} ${(performance.now() - t).toFixed(0).padStart(7)} ms`); return r; };
let b = T('readBoard (parse + boardFromBOARD)', () => readBoard(parse(readFileSync(f, 'utf8')))) as Board;
T('BuildConnectivity', () => b.k!.BuildConnectivity());
const frame = new TEST_FRAME();
frame.SetBoard(b.k!);
const fp = b.footprints[Math.floor(b.footprints.length / 2)]!;
const id = boardItemId(fp);
for (let rep = 0; rep < 3; rep++) {
  console.log(`move ${rep}:`);
  const next = T('moveBoardItems (the tool, on the view)', () => moveBoardItems(b, new Set([id]), { x: 1000000, y: 0 })) as Board;
  T('commitViewToBoard (stage + write-back + Push)', () => commitViewToBoard(frame, b, next, 'Move'));
  const moved = fp.k!;
  b = T('boardFromBOARD (the listener re-derivation)', () => ({ ...boardFromBOARD(b.k!, 'x', (k) => k !== moved), fileName: 'x' })) as Board;
}
