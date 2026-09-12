// Stage 1 gate, header half: the new parser + formatter against KiCad's own
// re-save of each oracle board, header only (everything before the first
// item). Prints the first difference per board.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { formatBoardText } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const ITEM_HEADS =
  /^\t\((footprint|segment|arc|via|zone|gr_|dimension|image|barcode|table|group|generated|target|point|embedded_fonts|embedded_files)/m;
const headerOf = (text: string): string => {
  const m = ITEM_HEADS.exec(text);
  return m ? text.slice(0, m.index) : text;
};

const dir = process.argv[2] ?? join(homedir(), 'kicad-oracle/resave');
let ok = 0,
  n = 0;
for (const f of readdirSync(dir)
  .filter((f) => f.endsWith('.kicad_pcb'))
  .sort()) {
  n++;
  const theirs = readFileSync(join(dir, f), 'utf8');
  try {
    const p = new PCB_IO_KICAD_SEXPR_PARSER(theirs, f);
    const hdr = p.ParseBoardHeader(() => p.skipCurrent());
    const ours = formatBoardText({ ...hdr, generator: 'pcbnew' });
    const a = headerOf(ours).replace(/\)\n$/, ''),
      b = headerOf(theirs);
    if (a === b) {
      ok++;
      continue;
    }
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    console.log(
      `DIFF ${f} at ${i}:\n  ours   ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 80))}\n  theirs ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 80))}`,
    );
  } catch (e) {
    console.log(`ERROR ${f}: ${(e as Error).message.slice(0, 200)}`);
  }
}
console.log(`${ok}/${n} headers byte-identical`);
