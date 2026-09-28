#!/usr/bin/env node
// A file moved INTO a package keeps importing that package through its own
// alias (`@ziroeda/eeschema`, `@ziroeda/eeschema/x.js`). Inside the package
// that goes through index.ts and risks cycles, so rewrite each such import to
// the relative path of the module that actually declares the name.
//
//   node qa/probes/deself_imports.mjs <package-dir> <file> [file ...]
//
// Uses the TypeScript checker to find each bare-index name's declaring file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(join(ROOT, 'designer/package.json'));
function join(...a) {
  return resolve(...a);
}
const ts = require('typescript');

const [pkgDirRel, ...files] = process.argv.slice(2);
const PKG = resolve(ROOT, pkgDirRel);
const alias = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).name;
const cfgPath = join(PKG, 'tsconfig.json');
const cfg = ts.parseJsonConfigFileContent(
  ts.readConfigFile(cfgPath, ts.sys.readFile).config,
  ts.sys,
  PKG,
);
const abs = files.map((f) => resolve(ROOT, f));
const program = ts.createProgram([...abs, join(PKG, 'index.ts')], cfg.options);
const checker = program.getTypeChecker();

const rel = (from, to) => {
  let r = relative(dirname(from), to)
    .split(sep)
    .join('/')
    .replace(/\.tsx?$/, '.js');
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
};

function pkgAlias(src) {
  let d = dirname(src);
  while (d !== ROOT && !existsSync(join(d, 'package.json'))) d = dirname(d);
  const name = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name;
  return `${name}/${relative(d, src)
    .split(sep)
    .join('/')
    .replace(/\.tsx?$/, '.js')}`;
}

for (const file of abs) {
  const sf = program.getSourceFile(file);
  let text = readFileSync(file, 'utf8');
  const edits = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
    const spec = st.moduleSpecifier?.text;
    if (!spec || !(spec === alias || spec.startsWith(`${alias}/`))) continue;
    if (spec !== alias) {
      const target = join(PKG, spec.slice(alias.length + 1)).replace(/\.js$/, '.ts');
      const r = rel(file, target);
      edits.push([st.moduleSpecifier.getStart(sf), st.moduleSpecifier.getEnd(), `'${r}'`]);
      continue;
    }
    // bare index import: split by declaring file
    const clause = ts.isImportDeclaration(st) ? st.importClause : null;
    const named = clause ? clause.namedBindings : st.exportClause;
    if (!named || (!ts.isNamedImports(named) && !ts.isNamedExports(named))) {
      console.log(`SKIP (namespace/default) ${relative(ROOT, file)}: ${st.getText(sf)}`);
      continue;
    }
    const allType = clause?.isTypeOnly || (st.isTypeOnly ?? false);
    const groups = new Map();
    for (const el of named.elements) {
      const nameNode = el.propertyName ?? el.name;
      let sym = checker.getSymbolAtLocation(el.name);
      if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      if (!sym?.declarations?.length) {
        // the package cannot resolve its own alias: look the name up in index.ts
        const idx = program.getSourceFile(join(PKG, 'index.ts'));
        const mod = idx && checker.getSymbolAtLocation(idx);
        sym = mod && checker.getExportsOfModule(mod).find((s) => s.name === nameNode.text);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      }
      const decl = sym?.declarations?.[0];
      if (!decl) {
        console.log(`UNRESOLVED ${nameNode.text} in ${relative(ROOT, file)}`);
        groups.clear();
        break;
      }
      const src = decl.getSourceFile().fileName;
      // a name the index re-exports from another workspace package keeps
      // that package's alias
      const r = src.startsWith(PKG + sep) ? rel(file, src) : pkgAlias(src);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(el.getText(sf));
    }
    if (!groups.size) continue;
    const kw = ts.isImportDeclaration(st) ? 'import' : 'export';
    const out = [...groups]
      .map(([r, els]) => `${kw}${allType ? ' type' : ''} { ${els.join(', ')} } from '${r}';`)
      .join('\n');
    edits.push([st.getStart(sf), st.getEnd(), out]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [s, e, t] of edits) text = text.slice(0, s) + t + text.slice(e);
  writeFileSync(file, text);
  console.log(`${relative(ROOT, file)}: ${edits.length} imports rewritten`);
}
