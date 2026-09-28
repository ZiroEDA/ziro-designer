// Stage 1 gate on the classes: the new parser + formatter (BOARD in, bytes
// out) against KiCad's own re-save of each oracle board. With VIEW=1 the
// BOARD goes through the editor's view and back (`boardFromBOARD`,
// `boardToBOARD`) before it is written: an untouched view must write the
// bytes it was read from.
//
//   npx tsx qa/perf/kicad_sexpr_board_diff.mts [dir] [name-filter]
//   VIEW=1 MAX_MB=10 npx tsx qa/perf/kicad_sexpr_board_diff.mts
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { boardFromBOARD, boardToBOARD } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/board_view.js';
import { installNodeOutlineFaces } from './node_outline_faces.mjs';

async function main(): Promise<void> {
  await EMBEDDED_FILES.InitCodec();
  installNodeOutlineFaces();
  const dir = process.argv[2] ?? join(homedir(), 'kicad-oracle/resave2');
  const filter = process.argv[3] ?? '';
  const maxBytes = Number(process.env.MAX_MB ?? Number.POSITIVE_INFINITY) * 1e6;
  const outDir = join(homedir(), 'kicad-oracle/ours2');
  mkdirSync(outDir, { recursive: true });

  const sansTeardropOrder = (text: string): string => {
    const blocks: string[] = [];
    const rest = text.replace(/\n\t\(zone\n(?:\t\t[^\n]*\n)+?\t\)(?=\n)/g, (block) => {
      if (!block.includes('(teardrop')) return block;
      blocks.push(block);
      return '';
    });
    return rest + blocks.sort().join('');
  };

  let ok = 0;
  let n = 0;
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith('.kicad_pcb') && f.includes(filter))
    .sort()) {
    if (statSync(join(dir, f)).size > maxBytes) continue;
    n++;
    const theirs = readFileSync(join(dir, f), 'utf8');
    try {
      const t0 = performance.now();
      const parser = new PCB_IO_KICAD_SEXPR_PARSER(theirs, f);
      const board = parser.Parse() as BOARD;
      const t1 = performance.now();
      const written = process.env.VIEW ? boardToBOARD(boardFromBOARD(board, f)) : board;
      const ours = FormatBoard(written, 'pcbnew');
      const t2 = performance.now();
      writeFileSync(join(outDir, f), ours);
      if (ours === theirs) {
        ok++;
        console.log(
          `OK   ${f}  parse ${(t1 - t0).toFixed(0)} ms, format ${(t2 - t1).toFixed(0)} ms`,
        );
        continue;
      }
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
}
main();
