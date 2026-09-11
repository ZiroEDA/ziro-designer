// How much heap one library costs at each stage of the symbol preload: the
// text, its full s-expression tree, the LibSymbols read from it -- and the
// pruned tree the preload now builds instead (LIB_TREE_PRUNE). Run with
// --expose-gc; see README.md for the vite-node invocation.
//   node --expose-gc $V perf/parse_memory.ts ~/ziro-perf-fixtures/symbols/MCU_ST_STM32H7.kicad_sym
import { readFileSync } from 'node:fs';
import { parse, type SNode } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import { LIB_TREE_PRUNE } from '@ziroeda/designer/src/editors/schematic/symbols/lib_tree_item.js';
const file = process.argv[2]!;
const mb = (n: number) => (n / 1048576).toFixed(1).padStart(7);
const gc = (globalThis as { gc?: () => void }).gc!;
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};
const count = (x: SNode): number =>
  x.kind === 'list' ? 1 + x.items.reduce((s, i) => s + count(i), 0) : 1;
const base = heap();
const text = readFileSync(file, 'utf8');
const afterText = heap();
let tree: SNode | null = parse(text);
const afterTree = heap();
const nFull = count(tree);
let syms: unknown[] | null = readSymbolLib(tree as never);
const afterSyms = heap();
const nSyms = syms.length;
tree = null;
syms = null;
const cleared = heap();
const pruned = parse(text, LIB_TREE_PRUNE);
const afterPruned = heap();
console.log(
  `${file.split('/').pop()}: text ${mb(text.length)} MB (${mb(afterText - base)} MB heap), full tree ${mb(afterTree - afterText)} MB in ${nFull} nodes, symbols ${mb(afterSyms - afterTree)} MB for ${nSyms}; pruned tree ${mb(afterPruned - cleared)} MB in ${count(pruned)} nodes`,
);
