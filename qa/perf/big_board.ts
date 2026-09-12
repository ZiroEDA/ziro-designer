// Where a big board's open goes, stage by stage, with named functions and the
// heap each stage retains: text -> Board (the KiCad model and its view) -> BoardScene ->
// the GL scene the recorder fills. Run with --expose-gc; see README.md.
//   node --max-old-space-size=6000 --expose-gc $V perf/big_board.ts \
//       ~/kicad-reference/demos/jetson-agx-thor-baseboard/jetson-agx-thor-baseboard.kicad_pcb
import { readFileSync } from 'node:fs';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { buildScene, DEFAULT_DRAW_OPTIONS } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import { recordBoardScene } from '@ziroeda/designer/src/render/gl/pcb_gl.js';

const file = process.argv[2]!;
const gc = (globalThis as { gc?: () => void }).gc!;
const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};
const stage = <T>(name: string, fn: () => T): T => {
  const h0 = heap();
  const t0 = performance.now();
  const out = fn();
  const t1 = performance.now();
  const h1 = heap();
  console.log(
    `${name.padEnd(28)} ${((t1 - t0) / 1000).toFixed(2).padStart(6)} s   +${mb(h1 - h0).padStart(8)}   heap now ${mb(h1)}`,
  );
  return out;
};

const text = stage('read text', () => readFileSync(file, 'utf8'));
// The parser reads the text itself now; no s-expression tree is built or kept.
let board: ReturnType<typeof readBoard> | null = stage('readBoard -> Board', () =>
  readBoard(text),
);
console.log(
  `   ${board!.footprints.length} footprints, ${board!.tracks.length} tracks, ${board!.vias.length} vias, ${board!.zones.length} zones`,
);
const scene = stage('buildScene (GL factory)', () => buildScene(board!, {}, GL_PATH_FACTORY));
const gl = new Scene(true);
const visible = new Set(board!.layers.map((l) => l.name));
stage('recordBoardScene -> GPU', () =>
  recordBoardScene(gl, { scene, visible, opts: DEFAULT_DRAW_OPTIONS, emphasis: 'none' }, 0.87),
);
console.log(
  `   segments ${gl.segmentCount}, discs ${gl.discCount}, triangle verts ${gl.triangleVertexCount}`,
);
const withBoard = heap();
board = null;
stage('drop board', () => 0);
console.log(`   heap with board + scene ${mb(withBoard)}`);
