#!/usr/bin/env node
// Add an identifier to every React hook dependency list whose body reads it.
//
//   node qa/probes/add_hook_dep.mjs <name> <file> [file ...]
//
// For each useEffect / useLayoutEffect / useCallback / useMemo /
// useImperativeHandle call whose callback mentions <name> as a free
// identifier (not a property name) and whose dependency array does not list
// it, <name> is appended to the array. Calls without a dependency array are
// left alone. Used when a module singleton becomes a component-scope value
// (the eeschema file-structure pass threading `settings` through EESCHEMA_APP).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const ts = createRequire(resolve(ROOT, 'designer/package.json'))('typescript');
const HOOKS = new Set([
  'useEffect',
  'useLayoutEffect',
  'useCallback',
  'useMemo',
  'useImperativeHandle',
]);
const [name, ...files] = process.argv.slice(2);

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const mentions = (node) => {
    let hit = false;
    const visit = (n) => {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === name) {
        const p = n.parent;
        const isProp =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isJsxAttribute(p) && p.name === n) ||
          (ts.isBindingElement(p) && p.propertyName === n) ||
          (ts.isMethodDeclaration(p) && p.name === n);
        if (!isProp) hit = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return hit;
  };
  const walk = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = ts.isIdentifier(n.expression)
        ? n.expression.text
        : ts.isPropertyAccessExpression(n.expression)
          ? n.expression.name.text
          : '';
      if (HOOKS.has(callee)) {
        const cbIdx = callee === 'useImperativeHandle' ? 1 : 0;
        const cb = n.arguments[cbIdx];
        const deps = n.arguments[cbIdx + 1];
        if (cb && deps && ts.isArrayLiteralExpression(deps) && mentions(cb)) {
          const listed = deps.elements.some((e) => ts.isIdentifier(e) && e.text === name);
          if (!listed) {
            const els = deps.elements;
            if (els.length === 0) edits.push([deps.getStart(sf) + 1, name]);
            else edits.push([els[els.length - 1].getEnd(), `, ${name}`]);
          }
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  edits.sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [pos, ins] of edits) out = out.slice(0, pos) + ins + out.slice(pos);
  writeFileSync(f, out);
  console.log(`${f}: ${edits.length} dependency lists gained ${name}`);
}
