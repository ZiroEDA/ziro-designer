// Stage timings of one board through the classes and the view: parse, view,
// view back, format — heap after each.
//
//   NODE_OPTIONS=--max-old-space-size=12288 npx tsx qa/perf/board_stage_timing.mts <board.kicad_pcb>
import { readFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { FormatBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { boardFromBOARD, boardToBOARD } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/board_view.js';
import { installNodeOutlineFaces } from './node_outline_faces.mjs';
async function main() {
  await EMBEDDED_FILES.InitCodec();
  installNodeOutlineFaces();
  const f = process.argv[2]!;
  const text = readFileSync(f, 'utf8');
  const mb = (): string => (process.memoryUsage().heapUsed / 1e6).toFixed(0);
  let t = performance.now();
  const board = new PCB_IO_KICAD_SEXPR_PARSER(text, f).Parse() as BOARD;
  console.log(
    `parse   ${(performance.now() - t).toFixed(0)} ms  heap ${mb()} MB  items: fp ${board.Footprints().length} tracks ${board.Tracks().length} drawings ${board.Drawings().length} zones ${board.Zones().length}`,
  );
  t = performance.now();
  const view = boardFromBOARD(board, f);
  console.log(`view    ${(performance.now() - t).toFixed(0)} ms  heap ${mb()} MB`);
  t = performance.now();
  const back = boardToBOARD(view);
  console.log(`unview  ${(performance.now() - t).toFixed(0)} ms  heap ${mb()} MB`);
  t = performance.now();
  const out = FormatBoard(back, 'pcbnew');
  console.log(
    `format  ${(performance.now() - t).toFixed(0)} ms  heap ${mb()} MB  ${(out.length / 1e6).toFixed(1)} MB written`,
  );
}
main();
