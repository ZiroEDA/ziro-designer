// Prettify over the WHOLE oracle corpus (~/kicad-oracle/resave, including the
// 85 MB jetson board that is too big to check in): compact -> Prettify must
// give KiCad's bytes back.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { FORMAT_MODE, Prettify } from '@ziroeda/common/src/io/kicad/kicad_io_utils.js';
const dir = join(homedir(), 'kicad-oracle/resave');
let ok = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.kicad_pcb'))) {
  const theirs = readFileSync(join(dir, f), 'utf8');
  let out = '',
    inQuote = false,
    bs = 0,
    pend = false;
  for (const ch of theirs) {
    if (!inQuote && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) {
      pend = true;
      continue;
    }
    if (pend) {
      out += ' ';
      pend = false;
    }
    if (ch === '\\') bs++;
    else if (ch === '"' && (bs & 1) === 0) inQuote = !inQuote;
    if (ch !== '\\') bs = 0;
    out += ch;
  }
  const t0 = performance.now();
  const ours = Prettify(out, FORMAT_MODE.NORMAL);
  const ms = performance.now() - t0;
  if (ours === theirs) ok++;
  else {
    let i = 0;
    while (i < ours.length && ours[i] === theirs[i]) i++;
    console.log(
      `DIFF ${f} at byte ${i}: ours ${JSON.stringify(ours.slice(i - 40, i + 40))} theirs ${JSON.stringify(theirs.slice(i - 40, i + 40))}`,
    );
  }
  if (ms > 500)
    console.log(`${f}: ${(theirs.length / 1e6).toFixed(1)} MB prettified in ${ms.toFixed(0)} ms`);
}
console.log(`${ok} boards byte-identical`);
