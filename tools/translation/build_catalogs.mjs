#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Compile KiCad's `.po` catalogs into `translation/<lang>.json`.
 *
 *     node tools/translation/build_catalogs.mjs [<kicad source tree>]
 *
 * The source tree defaults to `/home/akshay/kicad-reference`, the checkout
 * pinned at the version this port tracks. Run this when that tag moves; the
 * output is committed, because CI and the deploy build from the repository
 * alone and have no KiCad checkout to compile from.
 *
 * `LINGUAS` decides which languages are built, as it does for KiCad's own
 * build (`translation/CMakeLists.txt` reads the same file).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePo, serializeCatalog } from './po_compile.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// `--ziroeda`: the `ziroeda` domain - ZiroEDA's own messages, whose .po files live in this
// repository (translation/ziroeda/pofiles, kept up to date by extract_ziroeda.mjs) - compiled
// to translation/ziroeda/<lang>.json the same way.
const ziroeda = process.argv[2] === '--ziroeda';
const source = ziroeda ? repo : resolve(process.argv[2] ?? '/home/akshay/kicad-reference');
const poDir = ziroeda
  ? join(repo, 'translation/ziroeda/pofiles')
  : join(source, 'translation/pofiles');
const outDir = ziroeda ? join(repo, 'translation/ziroeda') : join(repo, 'translation');

const linguas = readFileSync(join(poDir, 'LINGUAS'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

mkdirSync(outDir, { recursive: true });
// A language KiCad dropped from LINGUAS must not linger as a stale catalog.
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.json') && !linguas.includes(f.slice(0, -5))) rmSync(join(outDir, f));
}

let bytes = 0;
console.log('lang     total  transl   fuzzy  untrans   ident     bytes');
for (const lang of linguas) {
  const { catalog, stats } = compilePo(readFileSync(join(poDir, `${lang}.po`), 'utf8'));
  const out = serializeCatalog(catalog);
  writeFileSync(join(outDir, `${lang}.json`), out);
  const size = Buffer.byteLength(out);
  bytes += size;
  console.log(
    lang.padEnd(6) +
      [stats.total, stats.translated, stats.fuzzy, stats.untranslated, stats.identical]
        .map((v) => String(v).padStart(8))
        .join('') +
      String(size).padStart(10),
  );
}
console.log(`${linguas.length} catalogs, ${bytes} bytes`);
