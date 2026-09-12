// Stage 1+2 gate: the new parser + formatter against KiCad's own re-save of
// each oracle board, the whole file. Prints the first difference per board
// with a little context, and the count of differing lines.
//
//   npx tsx qa/perf/kicad_sexpr_board_diff.ts [dir] [name-filter]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ParseBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_board.js';
import { FormatBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const dir = process.argv[2] ?? join(homedir(), 'kicad-oracle/resave');
const filter = process.argv[3] ?? '';
/** `MAX_MB=10` skips the boards above that size, for a quick pass. */
const maxBytes = Number(process.env.MAX_MB ?? Number.POSITIVE_INFINITY) * 1e6;
const outDir = join(homedir(), 'kicad-oracle/ours');
mkdirSync(outDir, { recursive: true });

/** The text with every teardrop zone block moved to the end, sorted. */
function sansTeardropOrder(text: string): string {
  const blocks: string[] = [];
  const rest = text.replace(/\n\t\(zone\n(?:\t\t[^\n]*\n)+?\t\)(?=\n)/g, (block) => {
    if (!block.includes('(teardrop')) return block;
    blocks.push(block);
    return '';
  });
  return rest + blocks.sort().join('');
}

let ok = 0,
  n = 0;
for (const f of readdirSync(dir)
  .filter((f) => f.endsWith('.kicad_pcb') && f.includes(filter))
  .sort()) {
  if (statSync(join(dir, f)).size > maxBytes) continue;
  n++;
  const theirs = readFileSync(join(dir, f), 'utf8');
  try {
    const t0 = performance.now();
    const board = ParseBoard(theirs, f);
    const t1 = performance.now();
    // The oracle was written by KiCad; ours names KiCad's generator here only
    // so the one header token that must differ does not count as a diff.
    const ours = FormatBoard(board, 'pcbnew');
    const t2 = performance.now();
    writeFileSync(join(outDir, f), ours);
    if (ours === theirs) {
      ok++;
      console.log(`OK   ${f}  parse ${(t1 - t0).toFixed(0)} ms, format ${(t2 - t1).toFixed(0)} ms`);
      continue;
    }
    // A teardrop zone is written without its uuid, so every load gives it a
    // fresh random one and KiCad itself orders those zones differently each
    // save. Equal modulo that order is the fixed point.
    if (sansTeardropOrder(ours) === sansTeardropOrder(theirs)) {
      ok++;
      console.log(`OK~  ${f}  (teardrop zones in another random order)`);
      continue;
    }
    const a = ours.split('\n');
    const b = theirs.split('\n');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let diffLines = 0;
    for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) diffLines++;
    console.log(
      `DIFF ${f}: first at line ${i + 1} (${diffLines} lines differ, ours ${a.length} / theirs ${b.length} lines)\n  ours   ${JSON.stringify(a.slice(i, i + 3).join('\n'))}\n  theirs ${JSON.stringify(b.slice(i, i + 3).join('\n'))}`,
    );
  } catch (e) {
    console.log(`ERROR ${f}: ${(e as Error).stack?.split('\n').slice(0, 4).join('\n') ?? e}`);
  }
}
console.log(`${ok}/${n} boards byte-identical`);
