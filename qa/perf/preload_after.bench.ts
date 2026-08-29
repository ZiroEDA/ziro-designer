/**
 * Baseline A, after: what the preload now costs the MAIN thread.
 *
 * The fetch and the parse moved to the pool in
 * designer/src/editors/schematic/symbols/preload_pool.ts, so the only work left
 * on the thread that draws is receiving each library's `LIB_TREE_ITEM[]` — a
 * structured clone, which is what `postMessage` costs the receiver.
 *
 * `structuredClone` is that exact algorithm, so cloning each library's items is
 * a faithful stand-in for the receive side without needing a browser.
 */
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import {
  libTreeItem,
  type LibTreeItem,
} from '@ziroeda/designer/src/editors/schematic/symbols/lib_tree_item.js';

const DIR = '/home/akshay/ziro-perf-fixtures/symbols';
const index: { name: string }[] = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));
const BUDGET_MB = Number(process.env.BUDGET_MB ?? 3000);

// The worker side, off the main thread in the browser. Timed only so the
// comparison against parse_all.bench.ts is like for like; it is not main-thread
// cost any more.
const perLib: { name: string; items: LibTreeItem[]; parseMs: number }[] = [];
let workerMs = 0;
for (const e of index) {
  const text = readFileSync(`${DIR}/${e.name}.kicad_sym`, 'utf8');
  const s = performance.now();
  const items = readSymbolLib(parse(text)).map(libTreeItem);
  const t = performance.now() - s;
  workerMs += t;
  perLib.push({ name: e.name, items, parseMs: t });
}

// The main-thread side: one structured clone per library, as postMessage does.
const clones = new Map<string, LibTreeItem[]>();
const receive: number[] = [];
const t0 = performance.now();
for (const l of perLib) {
  const s = performance.now();
  clones.set(l.name, structuredClone(l.items));
  receive.push(performance.now() - s);
}
const mainMs = performance.now() - t0;

const sorted = [...receive].sort((a, b) => a - b);
const items = perLib.reduce((a, b) => a + b.items.length, 0);
console.log(`\n=== A(after). main-thread cost of the preload ===`);
console.log(`  worker side (off the main thread)  ${workerMs.toFixed(0)} ms`);
console.log(`  MAIN thread (receiving the items)  ${mainMs.toFixed(0)} ms over ${items} symbols`);
console.log(
  `  tasks >50 ms ${receive.filter((r) => r > 50).length}   >16 ms ${receive.filter((r) => r > 16).length}   max ${Math.max(...receive).toFixed(1)} ms`,
);
console.log(
  `  p50/p90 ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} / ${sorted[Math.floor(sorted.length * 0.9)]!.toFixed(1)} ms`,
);

// Retained heap of what the main thread now keeps.
perLib.length = 0;
const gc = (globalThis as { gc?: () => void }).gc;
if (gc) {
  gc();
  gc();
  console.log(
    `  RETAINED after gc: ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB for all ${clones.size} libraries' LIB_TREE_ITEMs`,
  );
} else {
  console.log(`  (run with --expose-gc for the retained figure; budget ${BUDGET_MB} MB)`);
}
