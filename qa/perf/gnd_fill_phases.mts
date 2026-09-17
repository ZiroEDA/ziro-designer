// The same phases python pcbnew times on KiCad's SHAPE_POLY_SET, on ours.
import { readFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

await EMBEDDED_FILES.InitCodec();
const f = process.argv[2]!;
const b = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
let gnd = b.Zones()[0]!;
let best = 0;
for (const z of b.Zones()) {
  const n = z.GetFilledPolysList(z.GetFirstLayer())?.FullPointCount() ?? 0;
  if (n > best) { best = n; gnd = z; }
}
const fill = gnd.GetFilledPolysList(gnd.GetFirstLayer())!;
let holes = 0;
for (let i = 0; i < fill.OutlineCount(); i++) holes += fill.HoleCount(i);
console.log(`GND fill: outlines ${fill.OutlineCount()} holes ${holes} points ${fill.FullPointCount()}`);
const T = (label: string, fn: () => void) => { const t = performance.now(); fn(); console.log(`  ${label.padEnd(40)} ${(performance.now() - t).toFixed(0).padStart(8)} ms`); };
const s = new SHAPE_POLY_SET(fill);
T('splitCollinearOutlines', () => (s as any).splitCollinearOutlines());
const s0 = new SHAPE_POLY_SET(fill);
T('Simplify (splitCollinear + union)', () => s0.Simplify());
T('Fracture(aSimplify=false)', () => s0.Fracture(false));
const s2 = new SHAPE_POLY_SET(fill);
T('CacheTriangulation(partition=false)', () => s2.CacheTriangulation(false, false));
const s3 = new SHAPE_POLY_SET(fill);
T('CacheTriangulation(partition=true) [the real one]', () => s3.CacheTriangulation(true, false));
