/**
 * What one DRC worker costs, which is what decides how many of them there can
 * be. KiCad's threads share one BOARD; a worker cannot share anything, so each
 * one pays for its own copy and its own caches.
 *
 *   cd qa
 *   V=../node_modules/.pnpm/vite-node@*\/node_modules/vite-node/vite-node.mjs
 *   node --max-old-space-size=6000 --expose-gc $V perf/drc_worker_cost.mts \
 *       ~/kicad-reference/demos/cm5_minima/CM5_MINIMA_3.kicad_pcb
 */
import { existsSync, readFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { type DRC_JOB_REQUEST, loadBoardForDrc } from '@ziroeda/pcbnew/src/drc/drc_job.js';

const boardPath = process.argv[2]!;
const base = boardPath.replace(/\.kicad_pcb$/, '');
const gc = (globalThis as { gc?: () => void }).gc!;
const mb = (n: number): string => `${(n / 1048576).toFixed(0)} MB`;

function heap(): number {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

const read = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);

const request: DRC_JOB_REQUEST = {
  boardText: readFileSync(boardPath, 'utf8'),
  boardPath,
  projectText: read(`${base}.kicad_pro`),
  rulesText: read(`${base}.kicad_dru`),
  rulesPath: `${base}.kicad_dru`,
  netlistText: null,
  units: 'mm',
  reportAllTrackErrors: true,
  testFootprints: false,
};

await EMBEDDED_FILES.InitCodec();

const h0 = heap();
const t0 = performance.now();
const board = loadBoardForDrc(request);
const loadMs = performance.now() - t0;
const h1 = heap();

console.log(`request text                ${mb(request.boardText.length * 2)}`);
console.log(`load (parse + connectivity + rules)  ${(loadMs / 1000).toFixed(2)} s`);
console.log(`board + engine resident     ${mb(h1 - h0)}   heap now ${mb(h1)}`);

// The caches DRC_CACHE_GENERATOR fills on the first run are the other half of
// a worker's footprint: the zone tessellation and the layer R-trees.
const t1 = performance.now();

board.GetDesignSettings().m_DRCEngine!.SetViolationHandler(() => {});
board.GetDesignSettings().m_DRCEngine!.RunTests('mm', true, false);

const runMs = performance.now() - t1;
const h2 = heap();

console.log(`run                         ${(runMs / 1000).toFixed(2)} s`);
console.log(`caches added by the run     ${mb(h2 - h1)}`);
console.log(`TOTAL per worker            ${mb(h2 - h0)}`);
