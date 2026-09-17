// Our rtree.ts on the same generated set as ~/ziro-perf/rtree_bench/bench.cpp
// (KiCad's rtree.h, g++ -O2): 82k segment-sized rectangles on a 300 mm board
// in nm, inserted then each searched for.
import { RTree, RTreeIntReal } from '@ziroeda/kimath/src/thirdparty/rtree.js';

let g_s = 12345;
const next = (): number => {
  g_s = (Math.imul(g_s, 1103515245) + 12345) >>> 0;
  return g_s >>> 8;
};
const run = (name: string, tree: RTree<number>, n: number): void => {
  g_s = 12345;
  const rects: number[][] = [];
  for (let i = 0; i < n; ++i) {
    const x = next() % 300000000, y = next() % 300000000;
    const w = next() % 2000000, h = next() % 2000000;
    rects.push([x, y, x + w, y + h]);
  }
  const t0 = performance.now();
  for (let i = 0; i < n; ++i) tree.Insert([rects[i]![0]!, rects[i]![1]!], [rects[i]![2]!, rects[i]![3]!], i);
  const t1 = performance.now();
  let hits = 0;
  for (let i = 0; i < n; ++i) tree.Search([rects[i]![0]!, rects[i]![1]!], [rects[i]![2]!, rects[i]![3]!], () => { hits++; return true; });
  const t2 = performance.now();
  console.log(`${name} n=${n} insert ${(t1 - t0).toFixed(0)} ms search ${(t2 - t1).toFixed(0)} ms hits ${hits}`);
};
for (let rep = 0; rep < 1; rep++) {
  run("double  ", new RTree<number>(2), 82000);
  run("intptr_t", new RTreeIntReal<number>(2), 82000);
}
