/**
 * A/B for the matcher fix, in one process and interleaved.
 *
 * The machine this is run on is shared, so absolute wall-clock numbers from two
 * separate runs are not comparable. Scoring the SAME tree with the old matcher
 * and the new one, alternating, and taking each side's minimum removes the
 * contention: whatever else the machine is doing hits both arms equally, and
 * the minimum is the least-contended sample of each.
 *
 * The old arm reproduces exactly what `substrMatcher` used to do —
 * `candidate.toLowerCase().indexOf(pattern)` — against the same
 * already-normalised terms, which is the whole of the change.
 */
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import { searchTerm, type SearchTerm } from '@ziroeda/common';
import { libTreeItem } from '@ziroeda/designer/src/editors/schematic/symbols/lib_tree_item.js';

const DIR = '/home/akshay/ziro-perf-fixtures/symbols';
interface Entry {
  name: string;
  symbols: string[];
}
const index: Entry[] = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));

// The tree's search terms, exactly as populateItemNode builds them.
const perItem: SearchTerm[][] = [];
for (const e of index) {
  const items = new Map(
    readSymbolLib(parse(readFileSync(`${DIR}/${e.name}.kicad_sym`, 'utf8'))).map((s) => {
      const i = libTreeItem(s);
      return [i.name, i];
    }),
  );
  for (const name of e.symbols) {
    const it = items.get(name);
    const kw = it?.keywords ?? '';
    const terms = [
      searchTerm(e.name, 4),
      searchTerm(name, 8, true),
      searchTerm(`${e.name}:${name}`, 16, true),
      ...kw
        .split(/\s+/)
        .filter(Boolean)
        .map((k) => searchTerm(k, 4)),
      searchTerm(kw, 1),
      searchTerm(it?.description ?? '', 1),
    ];
    if (it?.footprint) terms.push(searchTerm(it.footprint, 1));
    // Normalise once, as the first scoring pass does, so neither arm pays for it.
    for (const t of terms) {
      t.text = t.text.toLowerCase().trim().slice(0, 1000);
      t.normalized = true;
    }
    perItem.push(terms);
  }
}

const totalTerms = perItem.reduce((a, t) => a + t.length, 0);

/** `EDA_COMBINED_MATCHER::ScoreTerms`, parameterised on the substring find. */
function score(pattern: string, find: (candidate: string, p: string) => number): number {
  let total = 0;
  for (const terms of perItem) {
    for (const term of terms) {
      if (pattern === term.text) {
        total += 8 * term.score;
      } else {
        const at = find(term.text, pattern);
        if (at === 0) total += 2 * term.score;
        else if (at > 0) total += term.score;
      }
    }
  }
  return total;
}

/** What substrMatcher did: a fresh lower-cased copy of every candidate. */
const oldFind = (c: string, p: string): number => c.toLowerCase().indexOf(p);
/** `EDA_PATTERN_MATCH_SUBSTR::Find`: `aCandidate.Find( m_pattern )`. */
const newFind = (c: string, p: string): number => c.indexOf(p);

console.log(
  `\n=== C(A/B). one scoring pass over ${perItem.length} items / ${totalTerms} terms ===`,
);
console.log(`  query        with the fold   without (upstream)   saved`);
for (const q of ['r', 'res', 'resistor', 'stm32', 'ter', '1']) {
  const olds: number[] = [];
  const news: number[] = [];
  let checkOld = 0;
  let checkNew = 0;
  for (let i = 0; i < 9; i++) {
    let s = performance.now();
    checkOld = score(q, oldFind);
    olds.push(performance.now() - s);
    s = performance.now();
    checkNew = score(q, newFind);
    news.push(performance.now() - s);
  }
  // Both arms must agree, or the comparison is between two different jobs.
  if (checkOld !== checkNew)
    throw new Error(`arms disagree for "${q}": ${checkOld} vs ${checkNew}`);
  const a = Math.min(...olds);
  const b = Math.min(...news);
  console.log(
    `  ${JSON.stringify(q).padEnd(11)} ${a.toFixed(1).padStart(10)} ms ${b.toFixed(1).padStart(14)} ms ${(((a - b) / a) * 100).toFixed(0).padStart(8)}%`,
  );
}
