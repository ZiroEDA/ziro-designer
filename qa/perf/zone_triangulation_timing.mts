// Serial ZONE::CacheTriangulation per zone, the same loop as python pcbnew's
// `for z in b.Zones(): z.CacheTriangulation()` used as the KiCad oracle.
//   NODE_OPTIONS=--max-old-space-size=12000 node <vite-node> perf/zone_triangulation_timing.mts <board.kicad_pcb>
import { readFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';

await EMBEDDED_FILES.InitCodec();
const f = process.argv[2]!;
const b = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
const rows: [number, string, string][] = [];
let tot = 0;
for (const z of b.Zones()) {
  const t = performance.now();
  z.CacheTriangulation();
  const dt = performance.now() - t;
  tot += dt;
  rows.push([dt, z.GetNetname(), b.GetLayerName(z.GetFirstLayer())]);
}
rows.sort((a, c) => c[0] - a[0]);
console.log(`ZONE::CacheTriangulation, all ${b.Zones().length} zones serial: ${tot.toFixed(0)} ms`);
for (const [dt, n, l] of rows.slice(0, 8))
  console.log(`  ${dt.toFixed(0).padStart(7)} ms  ${n} ${l}`);
