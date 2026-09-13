import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';

async function main() {
  await EMBEDDED_FILES.InitCodec();
  const dir = join(homedir(), 'kicad-oracle/resave2');
  const filter = process.argv[2] ?? '';
  const maxBytes = Number(process.env.MAX_MB ?? 10) * 1e6;
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith('.kicad_pcb') && f.includes(filter))
    .sort()) {
    if (statSync(join(dir, f)).size > maxBytes) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    try {
      const t0 = performance.now();
      const p = new PCB_IO_KICAD_SEXPR_PARSER(text, f);
      const b = p.Parse() as BOARD;
      const t1 = performance.now();
      console.log(
        `OK ${f} ${(t1 - t0).toFixed(0)} ms: fp ${b.Footprints().length} tracks ${b.Tracks().length} zones ${b.Zones().length} drawings ${b.Drawings().length} groups ${b.Groups().length} gens ${b.Generators().length} nets ${b.GetNetCount()} warnings ${p.m_parseWarnings.length}`,
      );
    } catch (e) {
      console.log(`ERROR ${f}: ${(e as Error).stack?.split('\n').slice(0, 5).join('\n') ?? e}`);
    }
  }
}
main();
