/**
 * Splitting a symbol library into one file per symbol.
 *
 * Placing a part used to fetch its whole library: 7.0 MB for one connector out
 * of Connector_Generic, 5.2 MB out of Connector, parsed in full to use a single
 * symbol. These are the same `(symbol …)` blocks, byte for byte, rearranged so
 * the app can ask for exactly the one it is placing.
 *
 * Kept apart from upload.mjs so the same code that produces what is uploaded
 * can be run against a library on disk and checked with our own reader.
 */

/** Extract top-level `(symbol "Name" …)` blocks byte-exactly. */
export function topLevelSymbols(text) {
  const out = [];
  let i = text.indexOf('(');
  if (i < 0) return out;
  // walk children of the root list
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '(') {
      depth++;
      if (depth === 2) start = i;
    } else if (c === ')') {
      if (depth === 2 && start >= 0) {
        const block = text.slice(start, i + 1);
        if (/^\(\s*symbol\s/.test(block)) {
          const name = block.match(/^\(\s*symbol\s+"((?:[^"\\]|\\.)*)"/)?.[1];
          out.push({ name: name ?? '?', block });
        }
        start = -1;
      }
      depth--;
    }
  }
  return out;
}

/** The library header every emitted file carries. */
export const wrapLib = (generator, blocks) =>
  `(kicad_symbol_lib\n\t(version 20241209)\n\t(generator "${generator}")\n\t(generator_version "1.0")\n${blocks}\n)\n`;

/** The name a symbol `(extends …)`, or undefined. */
export const extendsOf = (block) =>
  /\(\s*extends\s+"((?:[^"\\]|\\.)*)"/.exec(block)?.[1] ?? undefined;

/**
 * One file per symbol, each holding the symbol and the chain it extends.
 *
 * A derived symbol owns no geometry, only `(extends "Parent")` and its own text
 * properties. `LIB_SYMBOL::Flatten` (our `resolveExtends`) resolves that by
 * looking the parent up **by name among the symbols in the same file** and, when
 * it is not there, silently keeps the child's own empty body: the file parses,
 * the symbol places, and it has no pins at all. So the parents travel with it,
 * emitted before the child, in the order the merged file relies on.
 *
 * @param parts ordered `{name, block}` as `topLevelSymbols` returns them
 * @returns `{name, text}` per symbol, in input order
 */
export function perSymbolFiles(parts) {
  const blockByName = new Map(parts.map((p) => [p.name, p.block]));
  const chainOf = (name, seen = new Set()) => {
    const block = blockByName.get(name);
    if (!block || seen.has(name)) return [];
    seen.add(name);
    const parent = extendsOf(block);
    return parent ? [...chainOf(parent, seen), block] : [block];
  };
  return parts.map(({ name }) => ({
    name,
    text: wrapLib(
      'ziro_library_split',
      chainOf(name)
        .map((b) => `\t${b}`)
        .join('\n'),
    ),
  }));
}

/**
 * The on-disk name for a symbol's file.
 *
 * Only for staging on a filesystem. The uploaded key keeps the symbol name raw,
 * because the app percent-encodes it into the request path and the object store
 * decodes that back to the key; encoding it at both ends would store a key
 * nothing can address.
 */
export const stagedFileName = (name) => `${name.replace(/\//g, '%2F')}.kicad_sym`;

/**
 * How many units a symbol has.
 *
 * `LIB_SYMBOL::GetUnitCount`: the unit sub-symbols are named
 * `<stem>_<unit>_<bodyStyle>`, so the count is the largest unit number that
 * appears. Unit 0 is the "common to all units" body and does not count towards
 * it, which is why a plain resistor (`R_0_1`, `R_1_1`) is one unit and not two.
 */
export function unitCountOf(block) {
  let max = 0;
  for (const m of block.matchAll(/\(\s*symbol\s+"(?:[^"\\]|\\.)*_(\d+)_(\d+)"/g)) {
    const unit = Number(m[1]);
    if (Number.isFinite(unit)) max = Math.max(max, unit);
  }
  return Math.max(1, max);
}
