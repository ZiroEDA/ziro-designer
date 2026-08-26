/**
 * Baselines B/C/D: the chooser's tree, its per-keystroke scoring pass, and how
 * many rows `lib_tree.tsx` puts in the DOM.
 *
 * Each library is parsed, its item nodes populated exactly as
 * `panel_symbol_chooser.tsx`'s AddLibraries does, and then DROPPED - the tree
 * is what we are measuring, not the resident-library heap (parse_all.bench.ts
 * measures that).
 */
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, type LibSymbol } from '@ziroeda/eeschema';
import { searchTerm } from '@ziroeda/common';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/designer/src/widgets/lib_tree_model.js';

const DIR = '/home/akshay/ziro-perf-fixtures/symbols';
interface Entry {
  name: string;
  symbols: string[];
  descr?: string;
  units?: Record<string, number>;
}
const index: Entry[] = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));
const ms = (n: number) => n.toFixed(1);

const symProp = (sym: LibSymbol, key: string): string =>
  sym.properties.find((p) => p.key === key)?.value ?? '';
const pinCountOf = (sym: LibSymbol): number =>
  sym.units.reduce((n, u) => n + (u.unit === 0 || u.unit === 1 ? u.pins.length : 0), 0);
const unitCountOf = (sym: LibSymbol): number =>
  new Set(sym.units.map((u) => u.unit).filter((u) => u > 0)).size;

const adapter = new LibTreeModelAdapter();
let items = 0;
let unitRows = 0;
let buildT = 0;
for (const e of index) {
  const syms = new Map<string, LibSymbol>();
  for (const sym of readSymbolLib(parse(readFileSync(`${DIR}/${e.name}.kicad_sym`, 'utf8'))))
    syms.set(sym.libId, sym);
  const s = performance.now();
  const libNode = adapter.addLibrary(e.name, e.descr ?? '', false);
  for (const name of e.symbols) {
    const item = new LibTreeNode();
    item.type = LibTreeNodeType.ITEM;
    item.parent = libNode;
    item.name = name;
    item.libNickname = e.name;
    item.libItemName = name;
    const sym = syms.get(name);
    if (sym) {
      const keywords = symProp(sym, 'ki_keywords');
      const desc = symProp(sym, 'Description');
      item.desc = desc;
      item.footprint = symProp(sym, 'Footprint');
      item.isRoot = !sym.extends;
      item.pinCount = pinCountOf(sym);
      item.sourceSearchTerms = [
        searchTerm(e.name, 4),
        searchTerm(name, 8, true),
        searchTerm(`${e.name}:${name}`, 16, true),
        ...keywords
          .split(/\s+/)
          .filter(Boolean)
          .map((kw) => searchTerm(kw, 4)),
        searchTerm(keywords, 1),
        searchTerm(desc, 1),
      ];
      if (item.footprint) item.sourceSearchTerms.push(searchTerm(item.footprint, 1));
      item.fields = new Map<string, string>();
      for (const f of sym.properties) if (f.showInChooser) item.fields.set(f.key, f.value);
      if (!item.fields.has('Keywords')) item.fields.set('Keywords', keywords);
      for (const n of item.fields.keys()) adapter.addColumnIfNecessary(n);
      item.rebuildSearchTerms(adapter.getShownColumns());
      const units = unitCountOf(sym);
      if (units > 1) unitRows += units;
    } else {
      item.sourceSearchTerms = [
        searchTerm(e.name, 4),
        searchTerm(name, 8, true),
        searchTerm(`${e.name}:${name}`, 16, true),
      ];
      item.searchTerms = [...item.sourceSearchTerms];
    }
    libNode.children.push(item);
    items++;
  }
  adapter.finishLibrary(libNode);
  buildT += performance.now() - s;
}
const s0 = performance.now();
adapter.tree.assignIntrinsicRanks();
buildT += performance.now() - s0;

const terms = adapter.tree.children.reduce(
  (a, l) => a + l.children.reduce((b, i) => b + i.searchTerms.length, 0),
  0,
);
console.log(`\n=== B. building the tree (AddLibraries, parse cost excluded) ===`);
console.log(`  ${ms(buildT)} ms`);
console.log(
  `  ${adapter.tree.children.length} libraries, ${items} item nodes, ${unitRows} unit rows, ${terms} search terms (${(terms / items).toFixed(1)}/item)`,
);

console.log(`\n=== C. adapter.updateSearchString - ONE debounced keystroke ===`);
const queries = ['r', 're', 'res', 'resi', 'resis', 'resist', 'resistor', 'stm32', 'ter', 'conn 01x', '1'];
const medians: number[] = [];
for (const q of queries) {
  const runs: number[] = [];
  for (let i = 0; i < 7; i++) {
    const s = performance.now();
    adapter.updateSearchString(q);
    runs.push(performance.now() - s);
  }
  runs.sort((a, b) => a - b);
  medians.push(runs[3]!);
  console.log(
    `  ${JSON.stringify(q).padEnd(12)} median ${ms(runs[3]!).padStart(7)} ms   min ${ms(runs[0]!).padStart(7)}   max ${ms(runs[6]!).padStart(7)}`,
  );
}
console.log(`  --- worst median ${ms(Math.max(...medians))} ms; a 60 fps frame is 16.7 ms`);

function rowsFor(query: string, expandAll: boolean): number {
  adapter.updateSearchString(query);
  const searching = query.trim().length > 0;
  let n = 0;
  for (const lib of adapter.tree.children) {
    if (!adapter.isVisible(lib, searching)) continue;
    n++;
    if (!(expandAll || (searching && lib.score > 1))) continue;
    for (const item of lib.children) if (adapter.isVisible(item, searching)) n++;
  }
  return n;
}
console.log(`\n=== D. rows rendered into the DOM (lib_tree.tsx rows.map) ===`);
console.log(`  collapsed, no query    ${rowsFor('', false)}`);
console.log(`  Expand All, no query   ${rowsFor('', true)}`);
console.log(`  query "r"              ${rowsFor('r', false)}`);
console.log(`  query "res"            ${rowsFor('res', false)}`);
console.log(`  query "1"              ${rowsFor('1', false)}`);

// ---- C2: where the keystroke goes.
{
  const { EdaCombinedMatcher } = await import('@ziroeda/common');
  const q = 'res';
  const mk = () => [new EdaCombinedMatcher(q)];
  const time = (f: () => void, n = 5): number => {
    const runs: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = performance.now();
      f();
      runs.push(performance.now() - s);
    }
    runs.sort((a, b) => a - b);
    return runs[Math.floor(n / 2)]!;
  };
  console.log(`\n=== C2. split of one "${q}" keystroke ===`);
  console.log(`  updateScore  ${time(() => adapter.tree.updateScore(mk(), null)).toFixed(1)} ms`);
  console.log(`  sortNodes    ${time(() => adapter.tree.sortNodes(true)).toFixed(1)} ms`);
  // scoreTerms alone, over every term in the tree.
  const all = adapter.tree.children.flatMap((l) => l.children.map((i) => i.searchTerms));
  console.log(
    `  scoreTerms   ${time(() => {
      const [m] = mk();
      for (const t of all) m!.scoreTerms(t);
    }).toFixed(1)} ms over ${all.length} items`,
  );
  // The toLowerCase() our substrMatcher does and KiCad's Find() does not.
  const flat = all.flat().map((t) => t.text);
  console.log(
    `  ...of which lowercasing the candidates: ${time(() => {
      let n = 0;
      for (const t of flat) n += t.toLowerCase().indexOf(q);
      return n;
    }).toFixed(1)} ms vs ${time(() => {
      let n = 0;
      for (const t of flat) n += t.indexOf(q);
      return n;
    }).toFixed(1)} ms without, over ${flat.length} terms`,
  );
}
