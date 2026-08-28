// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol-level operations on a library definition. Counterpart:
 * `eeschema/lib_symbol.cpp` (LIB_SYMBOL).
 */

import { type Reporter, RPT_SEVERITY_ERROR } from '@ziroeda/common/src/reporter.js';
import { isList, head, str, atom, type SList } from '@ziroeda/sexpr/src/types.js';
import type { LibSymbol, LibSymbolUnit, SchField } from './types.js';
import { writeLibSymbolNode } from './sch_io/sexpr/write-symbol-lib.js';
import { MANDATORY_FIELDS } from './tools/properties.js';

/**
 * The two properties a `.kicad_sym` writes as fields but KiCad does not keep as
 * fields: the parser turns each into a LIB_SYMBOL member
 * (`m_keyWords` / `m_fpFilters`), and `Flatten()` takes them from a derived
 * symbol only when that symbol set them —
 * `if( !m_keyWords.IsEmpty() ) retv->SetKeyWords( m_keyWords )`. We store them
 * on `properties` because that is where the file put them, so the same
 * "only when non-empty" rule has to be applied to them by name.
 */
const INHERITED_UNLESS_SET = new Set(['ki_keywords', 'ki_fp_filters']);

/** LIB_ID::GetLibItemName: the part after the nickname. */
function libItemName(libId: string): string {
  const colon = libId.indexOf(':');
  return colon < 0 ? libId : libId.slice(colon + 1);
}

/**
 * Rename a symbol's unit sub-symbols to `<item name>_<unit>_<body style>`.
 *
 * KiCad has no such name in the model at all: `LIB_SYMBOL_UNIT` is just a unit
 * number, a body-style number and its draw items, and
 * `SCH_IO_KICAD_SEXPR_LIB_CACHE::SaveSymbol` prints `"%s_%d_%d"` from the name
 * it is saving the symbol under (lib cache, :491-498). So a flattened `1N4007`
 * writes `1N4007_0_1`, not the `1N4001_0_1` its geometry came from — which is
 * not cosmetic: the parser rejects a unit whose name does not start with the
 * symbol's own ("Invalid symbol unit name prefix", parser :501-505).
 */
function renameUnits(units: readonly LibSymbolUnit[], itemName: string): LibSymbolUnit[] {
  return units.map((u) => {
    const name = `${itemName}_${u.unit}_${u.bodyStyle}`;
    if (u.name === name) return u;
    const source: SList = {
      kind: 'list',
      items: [u.source.items[0] ?? atom('symbol'), str(name), ...u.source.items.slice(2)],
    };
    return { ...u, name, source };
  });
}

/**
 * One derived symbol's field overrides applied over the fields flattened so far,
 * `Flatten()`'s two field loops (lib_symbol.cpp :588-620 and :641-672).
 *
 * A mandatory field overrides only when the derived symbol filled it in
 * (`if( !derived->GetField( fieldId )->GetText().IsEmpty() )`); every other
 * field replaces the parent's of the same name outright, or is added when the
 * parent has none. Order is the parent's, because the override is in place —
 * `RemoveDrawItem( parentField ); AddDrawItem( newField )` keeps the ordinal.
 */
function mergeFields(base: readonly SchField[], derived: readonly SchField[]): SchField[] {
  const out = [...base];
  for (const field of derived) {
    const onlyWhenSet = MANDATORY_FIELDS.includes(field.key) || INHERITED_UNLESS_SET.has(field.key);
    if (onlyWhenSet && field.value === '') continue;
    const at = out.findIndex((f) => f.key === field.key);
    if (at === -1) out.push(field);
    else out[at] = field;
  }
  return out;
}

/** The source node with any `(extends ...)` child dropped: a flat symbol has no parent. */
function withoutExtends(source: SList): SList {
  if (!source.items.some((it) => isList(it) && head(it) === 'extends')) return source;
  return {
    kind: 'list',
    items: source.items.filter((it) => !(isList(it) && head(it) === 'extends')),
  };
}

/**
 * `LIB_SYMBOL::Flatten()` (lib_symbol.cpp:551): the symbol a derived symbol
 * stands for once its parent chain is folded in — a copy of the **root**
 * ancestor (its units, pins, pin-name/number visibility and offset, power flag,
 * jumper and pin-map data) carrying the derived chain's own name, fields,
 * keywords and footprint filters, with the attributes of the immediate parent.
 *
 * This is what a *placement* stores. KiCad flattens in `SCH_SYMBOL`'s
 * constructor (sch_symbol.cpp:92) and again whenever a screen caches a library
 * symbol (sch_screen.cpp:262, :844), and the parser is explicit that the
 * schematic's `lib_symbols` block is downstream of that: "Dummy map. No derived
 * symbols are allowed in the library cache" (parser :2865). A schematic never
 * writes the parent alongside, so a derived symbol left un-flattened there is a
 * symbol whose body no longer exists anywhere in the file.
 *
 * A root symbol is returned unchanged (KiCad's `else` branch copies it).
 */
export function flattenLibSymbol(sym: LibSymbol, reporter?: Reporter): LibSymbol {
  if (sym.extends === undefined) return sym;

  // wxCHECK_MSG( parent, retv, "Parent of derived symbol '%s' undefined" ) —
  // upstream returns an empty pointer, which its callers dereference. We hand
  // the symbol back unflattened instead, so a broken link costs the body rather
  // than the document, and say so.
  if (!sym.parent) {
    reporter?.report(
      `Parent of derived symbol '${libItemName(sym.libId)}' undefined`,
      RPT_SEVERITY_ERROR,
    );
    return sym;
  }

  // The chain from the immediate parent up to the root, stopping on a cycle.
  const chain: LibSymbol[] = [];
  const visited = new Set<LibSymbol>([sym]);
  for (let cur: LibSymbol | undefined = sym.parent; cur && !visited.has(cur); cur = cur.parent) {
    visited.add(cur);
    chain.push(cur);
  }

  const flat: { -readonly [K in keyof LibSymbol]: LibSymbol[K] } =
    chain.length === 0
      ? // "Cycle detected at immediate parent level - just copy this symbol."
        { ...sym, source: withoutExtends(sym.source) }
      : (() => {
          const root = chain[chain.length - 1]!;
          // Root first, then each derived symbol's overrides from the root down,
          // then this symbol's.
          let properties: readonly SchField[] = root.properties;
          for (let i = chain.length - 2; i >= 0; i--)
            properties = mergeFields(properties, chain[i]!.properties);
          properties = mergeFields(properties, sym.properties);

          const immediate = chain[0]!;
          return {
            ...root,
            // retv->m_name = m_name; retv->SetLibId( m_libId );
            libId: sym.libId,
            properties,
            units: renameUnits(root.units, libItemName(sym.libId)),
            // "Get excluded flags from the immediate parent (first in chain)."
            excludedFromSim: immediate.excludedFromSim,
            excludedFromBom: immediate.excludedFromBom,
            excludedFromBoard: immediate.excludedFromBoard,
            excludedFromPosFiles: immediate.excludedFromPosFiles,
            source: withoutExtends(root.source),
          };
        })();

  // retv->m_parent.reset(): the flattened symbol is a root.
  delete flat.extends;
  delete flat.parent;
  for (const key of [
    'excludedFromSim',
    'excludedFromBom',
    'excludedFromBoard',
    'excludedFromPosFiles',
  ] as const) {
    if (flat[key] === undefined) delete flat[key];
  }

  // `source` is our lossless backing store, and the schematic writer emits it
  // verbatim (write-schematic.ts, `renameLibSymbol`). A symbol we just built out
  // of two others has no node yet, so give it the one it now serializes to.
  return { ...flat, source: writeLibSymbolNode(flat) };
}
