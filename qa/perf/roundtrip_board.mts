/**
 * Read a board, write it back, and say whether the bytes survived.
 *
 * The point is what you do NEXT with the output: `kicad-cli pcb drc` on it is
 * KiCad's own verdict on what our writer produced, and comparing that with its
 * verdict on the input is how the DRC job's lossy `*.Cu` round trip was found
 * (see CTL_ENUMERATE_LAYERS). A writer bug that a byte comparison would call
 * "different formatting" shows up there as violations.
 *
 *   cd qa
 *   V=../node_modules/.pnpm/vite-node@*\/node_modules/vite-node/vite-node.mjs
 *   node --max-old-space-size=4000 $V perf/roundtrip_board.mts in.kicad_pcb out.kicad_pcb
 *   cp <the project's .kicad_pro> beside out.kicad_pcb
 *   kicad-cli pcb drc --severity-all --format json -o out.json out.kicad_pcb
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';
import { GENERATOR } from '@ziroeda/common/generator.js';
import {
  CTL_ENUMERATE_LAYERS,
  CTL_FOR_BOARD,
  FormatBoard,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

await EMBEDDED_FILES.InitCodec();
const src = process.argv[2]!;
const out = process.argv[3]!;
const text = readFileSync(src, 'utf8');
const board = ParseBoard(text, src);
const written = FormatBoard(board, GENERATOR, CTL_FOR_BOARD | CTL_ENUMERATE_LAYERS);
writeFileSync(out, written);
console.log('in  bytes', text.length);
console.log('out bytes', written.length);
console.log('identical', written === text);
