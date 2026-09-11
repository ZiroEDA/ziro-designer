// Our writer against KiCad's own re-save of the same file (~/kicad-oracle/resave,
// made by resave.py there): how many lines differ, and the first few.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
const ORACLE = join(homedir(), 'kicad-oracle/resave');
for (const file of process.argv.slice(2)) {
  const ours = serializeBoard(readBoard(parse(readFileSync(file, 'utf8'))));
  const out = `/tmp/claude-1000/-home-akshay-ziro-designer-1/15148123-613d-432e-97fc-3df8ea77a351/scratchpad/ours_${basename(file)}`;
  writeFileSync(out, ours);
  const theirs = join(ORACLE, basename(file));
  let diff = '';
  try {
    execSync(`diff ${JSON.stringify(theirs)} ${JSON.stringify(out)}`, {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
  } catch (e) {
    diff = (e as { stdout: string }).stdout;
  }
  const changed = diff.split('\n').filter((l) => /^[<>]/.test(l)).length;
  const total = theirs.length;
  console.log(
    `${basename(file)}: ${changed} differing lines of ${readFileSync(theirs, 'utf8').split('\n').length}`,
  );
  console.log(
    diff
      .split('\n')
      .slice(0, Number(process.env.HEAD ?? 30))
      .join('\n'),
  );
}
