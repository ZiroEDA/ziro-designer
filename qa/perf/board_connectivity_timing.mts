// What BOARD::BuildConnectivity costs on a board, phase by phase: the zone
// triangulation it starts with (BOARD::CacheTriangulation, per zone when a
// zone takes over 200 ms), the connectivity search, then the ratsnest.
//
//   NODE_OPTIONS=--max-old-space-size=12000 npx tsx qa/perf/board_connectivity_timing.mts <board.kicad_pcb>
import { readFileSync, writeSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';

const out = (s: string) => writeSync(1, `${s}\n`);
const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;

await EMBEDDED_FILES.InitCodec();
const f = process.argv[2]!;
const text = readFileSync(f, 'utf8');

let t = performance.now();
const board = new PCB_IO_KICAD_SEXPR_PARSER(text, f).Parse() as BOARD;
out(`parse ${ms(t)}`);

t = performance.now();
let zi = 0;
for (const z of board.Zones()) {
  const t0 = performance.now();
  let verts = 0;
  for (const layer of z.GetLayerSet().Seq()) {
    const p = z.GetFilledPolysList(layer);
    if (p) verts += p.TotalVertices();
  }
  z.CacheTriangulation();
  const dt = performance.now() - t0;
  if (dt > 200) out(`  zone ${zi} ${z.GetNetname()} ${verts} vertices ${dt.toFixed(0)} ms`);
  zi++;
}
out(`CacheTriangulation ${ms(t)}`);

t = performance.now();
board.BuildConnectivity();
out(`BuildConnectivity (triangulation cached) ${ms(t)}`);

const c = board.GetConnectivity();
out(`nets ${c.GetNetCount()} unconnected ${c.GetUnconnectedCount(false)}`);

t = performance.now();
c.RecalculateRatsnest();
out(`RecalculateRatsnest ${ms(t)}`);
