/**
 * Baseline A: what `symbolPreloadWork` costs today - readSymbolLib(parse(text))
 * over every hosted symbol library, keeping each parsed library resident the
 * way `loadedLibraries` in designer/src/editors/schematic/symbols/index.ts does.
 *
 * Bounded: stops the moment heapUsed passes BUDGET_MB so the run reports how
 * far it got rather than thrashing the machine to death.
 */
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, type LibSymbol } from '@ziroeda/eeschema';

const DIR = '/home/akshay/ziro-perf-fixtures/symbols';
const index: { name: string }[] = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));
const keep = process.env.KEEP !== '0';
const BUDGET_MB = Number(process.env.BUDGET_MB ?? 1800);

const libs = new Map<string, Map<string, LibSymbol>>();
const per: { name: string; t: number; bytes: number; heap: number }[] = [];
let stoppedAt = -1;
const t0 = performance.now();
for (const [i, e] of index.entries()) {
  const text = readFileSync(`${DIR}/${e.name}.kicad_sym`, 'utf8');
  const s = performance.now();
  const map = new Map<string, LibSymbol>();
  for (const sym of readSymbolLib(parse(text)))
    map.set(sym.libId, { ...sym, libId: `${e.name}:${sym.libId}` });
  const t = performance.now() - s;
  if (keep) libs.set(e.name, map);
  const heap = process.memoryUsage().heapUsed / 1e6;
  per.push({ name: e.name, t, bytes: text.length, heap });
  if (heap > BUDGET_MB) {
    stoppedAt = i + 1;
    break;
  }
}
const total = performance.now() - t0;
const bytes = per.reduce((a, b) => a + b.bytes, 0);
per.sort((a, b) => b.t - a.t);
console.log(
  `KEEP=${keep} libs ${per.length}/${index.length}${stoppedAt > 0 ? ` (STOPPED at heap budget ${BUDGET_MB} MB)` : ''}`,
);
console.log(
  `  wall ${total.toFixed(0)} ms over ${(bytes / 1e6).toFixed(0)} MB  => ${(total / (bytes / 1e6)).toFixed(0)} ms/MB`,
);
console.log(
  `  heapUsed ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB  rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`,
);
console.log(
  `  tasks >50 ms ${per.filter((p) => p.t > 50).length}   >16 ms ${per.filter((p) => p.t > 16).length}   max ${per[0]!.t.toFixed(0)} ms (${per[0]!.name})`,
);
console.log(
  per
    .slice(0, 8)
    .map(
      (p) =>
        `    ${p.name.padEnd(24)} ${p.t.toFixed(0).padStart(7)} ms  ${(p.bytes / 1e6).toFixed(1)} MB`,
    )
    .join('\n'),
);
console.log(`  libs kept ${libs.size}`);

// Retained (post-GC) heap, when run with --expose-gc.
const gc = (globalThis as { gc?: () => void }).gc;
if (gc) {
  gc();
  gc();
  console.log(
    `  RETAINED after gc: heapUsed ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB for ${libs.size} libs / ${(bytes / 1e6).toFixed(0)} MB of source  => ${(process.memoryUsage().heapUsed / bytes).toFixed(1)}x`,
  );
}
