/**
 * Rebuild `symbols/index.json` from the libraries already in the bucket.
 *
 * Same reasoning as `split_upload.mjs`: `upload.mjs` regenerates everything
 * from an upstream checkout, which is right when moving to a new KiCad release
 * and wrong for adding a field to the index — it would republish the merged
 * libraries from whatever upstream is at today, changing the symbols production
 * serves as a side effect. This reads each `symbols/<Lib>.kicad_sym` back out
 * of the bucket and derives the index from exactly what is being served.
 *
 * The one field that is not derivable from the libraries is `power`, so it is
 * carried across from the existing index rather than recomputed, and an entry
 * whose library cannot be read keeps its old form untouched.
 *
 * Usage (needs .env, see .env.example):
 *   pnpm libraries:reindex            rebuild and upload
 *   pnpm libraries:reindex --dry-run  print the diff and upload nothing
 */
import { getObject, putObject } from '../r2.mjs';
import { topLevelSymbols, unitCountOf } from './split.mjs';

const dryRun = process.argv.includes('--dry-run');

const index = JSON.parse((await getObject('symbols/index.json')) ?? '[]');
console.log(`rebuilding the index for ${index.length} libraries`);

let withUnits = 0;
let multiUnitSymbols = 0;
let unreadable = 0;
const rebuilt = [];

for (const entry of index) {
  const text = await getObject(`symbols/${entry.name}.kicad_sym`);
  if (text === null) {
    console.warn(`  ${entry.name}: no library in the bucket, entry left as it was`);
    unreadable++;
    rebuilt.push(entry);
    continue;
  }

  const units = {};
  for (const { name, block } of topLevelSymbols(text)) {
    const n = unitCountOf(block);
    if (n > 1) units[name] = n;
  }
  if (Object.keys(units).length > 0) {
    withUnits++;
    multiUnitSymbols += Object.keys(units).length;
  }

  rebuilt.push({
    ...entry,
    // Rewritten rather than merged: a symbol that lost a unit upstream should
    // lose it here too.
    ...(Object.keys(units).length ? { units } : {}),
    ...(Object.keys(units).length ? {} : { units: undefined }),
  });
}

// Drop the undefined placeholders JSON would otherwise keep out anyway, so the
// output is identical whether or not a library has multi-unit parts.
const body = Buffer.from(JSON.stringify(rebuilt.map((e) => JSON.parse(JSON.stringify(e)))));

console.log(
  `${withUnits} libraries carry unit counts, ${multiUnitSymbols} multi-unit symbols` +
    (unreadable ? `, ${unreadable} libraries unreadable and left alone` : ''),
);
console.log(`index.json: ${(body.length / 1024).toFixed(1)} kB`);

if (dryRun) {
  console.log('--dry-run: nothing uploaded');
} else {
  await putObject('symbols/index.json', body, 'application/json');
  console.log('uploaded symbols/index.json');
}
