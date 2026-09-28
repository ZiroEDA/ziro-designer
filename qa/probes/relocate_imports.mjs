#!/usr/bin/env node
// Rewrite import specifiers after a module move (or after some of a module's
// exports move to another module). Used by the eeschema file-structure pass.
//
//   node qa/probes/relocate_imports.mjs <old> <new> [name ...]
//
// <old>/<new> are repo-relative module paths without extension
// (e.g. designer/src/editors/schematic/theme eeschema/sch_render_settings).
// With no names, every import of <old> is repointed to <new>. With names,
// only those specifiers are split off into an import of <new>; the rest stay.
// Prints every file it changed; prints NAMESPACE for `* as` imports it could
// not split (fix those by hand).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const [oldRel, newRel, ...names] = process.argv.slice(2);
if (!oldRel || !newRel) {
  console.error('usage: relocate_imports.mjs <old> <new> [name ...]');
  process.exit(2);
}
const OLD = join(ROOT, oldRel);
const NEW = join(ROOT, newRel);
const PKGS = readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, 'package.json')));
const SCAN = [
  'designer',
  'qa',
  'eeschema',
  'common',
  'pcbnew',
  'cvpcb',
  'gerbview',
  '3d-viewer',
  'libs',
  'pl_editor',
  'kicad',
  'bitmap2component',
  'pcb_calculator',
];

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

function pkgOf(abs) {
  const r = relative(ROOT, abs).split(sep);
  // libs/<x> packages
  if (r[0] === 'libs' && existsSync(join(ROOT, 'libs', r[1], 'package.json')))
    return { dir: join(ROOT, 'libs', r[1]), name: r[1] };
  if (PKGS.includes(r[0])) return { dir: join(ROOT, r[0]), name: r[0] };
  return null;
}

function alias(abs) {
  const p = pkgOf(abs);
  const pj = JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8'));
  return `${pj.name}/${relative(p.dir, abs).split(sep).join('/')}`;
}

const aliasMap = new Map();
for (const d of [
  ...PKGS.map((x) => join(ROOT, x)),
  ...(existsSync(join(ROOT, 'libs'))
    ? readdirSync(join(ROOT, 'libs')).map((x) => join(ROOT, 'libs', x))
    : []),
]) {
  const f = join(d, 'package.json');
  if (!existsSync(f)) continue;
  aliasMap.set(JSON.parse(readFileSync(f, 'utf8')).name, d);
}

function resolveSpec(file, spec) {
  let abs;
  if (spec.startsWith('.')) abs = resolve(dirname(file), spec);
  else {
    const m = /^(@ziroeda\/[^/]+)(\/.*)?$/.exec(spec);
    if (!m || !aliasMap.has(m[1])) return null;
    abs = join(aliasMap.get(m[1]), m[2] ?? '');
  }
  return abs.replace(/\.(js|ts|tsx|mjs)$/, '');
}

function specFor(file, targetAbs, oldSpec) {
  const fp = pkgOf(file);
  const tp = pkgOf(targetAbs);
  const ext = oldSpec.match(/\.(js|ts|tsx)$/)?.[0] ?? '';
  if (fp && tp && fp.dir === tp.dir) {
    let r = relative(dirname(file), targetAbs).split(sep).join('/');
    if (!r.startsWith('.')) r = `./${r}`;
    return r + (ext || '.js');
  }
  return alias(targetAbs) + (ext || '.js');
}

const RE =
  /(import|export)(\s+type)?(\s*\{([^}]*)\}\s*from\s*|\s+\*\s+as\s+\w+\s+from\s*|\s+[\w$]+\s*(?:,\s*\{([^}]*)\})?\s*from\s*|\s*)(['"])([^'"]+)\6/g;
const DYN = /(import\(|vi\.mock\(|vi\.doMock\(|importOriginal<typeof import\()\s*(['"])([^'"]+)\2/g;

let changed = 0;
for (const file of SCAN.flatMap((d) => walk(join(ROOT, d), []))) {
  const src = readFileSync(file, 'utf8');
  let out = src.replace(RE, (whole, kw, typ, mid, braces, braces2, q, spec) => {
    const abs = resolveSpec(file, spec);
    if (abs !== OLD) return whole;
    const ns = specFor(file, NEW, spec);
    if (!names.length) return whole.replace(`${q}${spec}${q}`, `${q}${ns}${q}`);
    const list = braces ?? braces2;
    if (list == null) {
      if (/\*\s+as/.test(mid)) console.log(`NAMESPACE ${relative(ROOT, file)}`);
      return whole;
    }
    const parts = list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const bare = (p) =>
      p
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
    const moved = parts.filter((p) => names.includes(bare(p)));
    if (!moved.length) return whole;
    const kept = parts.filter((p) => !names.includes(bare(p)));
    const t = typ ?? '';
    const movedStmt = `${kw}${t} { ${moved.join(', ')} } from ${q}${ns}${q}`;
    if (!kept.length && braces != null) return movedStmt;
    const keptStmt = whole.replace(list, ` ${kept.join(', ')} `);
    return `${keptStmt};\n${movedStmt}`;
  });
  out = out.replace(DYN, (whole, head, q, spec) => {
    const abs = resolveSpec(file, spec);
    if (abs !== OLD) return whole;
    if (names.length) {
      console.log(`DYNAMIC ${relative(ROOT, file)} (check by hand)`);
      return whole;
    }
    return `${head}${q}${specFor(file, NEW, spec)}${q}`;
  });
  if (out !== src) {
    writeFileSync(file, out);
    changed++;
    console.log(relative(ROOT, file));
  }
}
console.error(`${changed} files rewritten`);
