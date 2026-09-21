// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A compact, network-viable patch between two states of one sheet, for
 * schematic live document sync (designer/src/editors/schematic/SchematicEditor.tsx).
 * The schematic counterpart of `pcb_diff.ts`, and the same argument applies:
 * this diffs the *result* rather than replaying the operation, because an
 * `EditCommand` is a pair of closures and not something that can cross a wire
 * at all.
 *
 * Why it exists: the schematic used to broadcast the whole sheet as text on
 * every edit. That is requirement 3 in
 * docs/proposals/multiplayer-architecture.md -- a small edit has to cost about
 * as much as a small edit -- and dragging one symbol around a sheet whose
 * `lib_symbols` cache is most of its bytes was paying for the cache, the title
 * block and every untouched wire, tens of times a second.
 *
 * ## What can and cannot be diffed
 *
 * Every item collection is keyed by `uuid`, which real KiCad files always
 * carry. Two are not:
 *
 *   * `libSymbols` is keyed by lib id -- a library definition is identified by
 *     what it is, not by an instance id it does not have.
 *   * `graphics` (LibGraphic) has no identity of any kind, because it is the
 *     library shape type reused for sheet notes. It rides whole whenever it
 *     changes, which is cheap: these are a handful of rectangles and arcs, not
 *     a cache.
 *
 * And one thing is deliberately NOT patched at all: `source`, the retained
 * root AST. `writeSchematic` builds items from the typed arrays but takes the
 * header fields and any residual structural nodes straight out of `source`, so
 * an edit that changes it -- page settings, the title block, embedded files --
 * cannot be described by an item patch. Those edits report themselves as
 * undiffable and fall back to whole-sheet text, which is requirement 8: when
 * the fast path cannot honestly describe a change, take the slow one that can.
 * They are also rare, which is what makes that an acceptable trade rather than
 * a routine crutch.
 */
import type {
  LibGraphic,
  LibSymbol,
  Schematic,
  SchBusEntry,
  SchDirectiveLabel,
  SchGroup,
  SchImage,
  SchJunction,
  SchLabel,
  SchLine,
  SchNoConnect,
  SchSheet,
  SchSymbol,
  SchTable,
  SchTextBox,
} from '@ziroeda/eeschema';
import {
  applyCollectionPatch,
  diffCollection,
  UNSAFE,
  type CollectionPatch,
} from './collection_diff.js';

export interface SchematicPatch {
  symbols?: CollectionPatch<SchSymbol>;
  lines?: CollectionPatch<SchLine>;
  junctions?: CollectionPatch<SchJunction>;
  noConnects?: CollectionPatch<SchNoConnect>;
  labels?: CollectionPatch<SchLabel>;
  sheets?: CollectionPatch<SchSheet>;
  busEntries?: CollectionPatch<SchBusEntry>;
  images?: CollectionPatch<SchImage>;
  textBoxes?: CollectionPatch<SchTextBox>;
  tables?: CollectionPatch<SchTable>;
  groups?: CollectionPatch<SchGroup>;
  directiveLabels?: CollectionPatch<SchDirectiveLabel>;
  /** Keyed by `libId`; see the module comment. */
  libSymbols?: CollectionPatch<LibSymbol>;
  /** Whole, not diffed: LibGraphic carries no identity to key on. */
  graphics?: readonly LibGraphic[];
}

const byLibId = (s: LibSymbol): string | undefined => s.libId;

/**
 * `null` means this edit cannot be described as an item patch -- either it
 * touched `source` (see the module comment) or a changed collection has an
 * item with no key. The caller sends whole-sheet text instead.
 */
export function diffSchematic(prev: Schematic, next: Schematic): SchematicPatch | null {
  if (prev === next) return {};
  // The header and every structural node the writer copies through live here,
  // so a change to it is not expressible as an item patch.
  if (prev.source !== next.source) return null;

  const patch: SchematicPatch = {};
  const collections = [
    ['symbols', prev.symbols, next.symbols],
    ['lines', prev.lines, next.lines],
    ['junctions', prev.junctions, next.junctions],
    ['noConnects', prev.noConnects, next.noConnects],
    ['labels', prev.labels, next.labels],
    ['sheets', prev.sheets, next.sheets],
    ['busEntries', prev.busEntries, next.busEntries],
    ['images', prev.images, next.images],
    ['textBoxes', prev.textBoxes, next.textBoxes],
    ['tables', prev.tables, next.tables],
    ['groups', prev.groups, next.groups],
    ['directiveLabels', prev.directiveLabels ?? [], next.directiveLabels ?? []],
  ] as const;
  for (const [key, p, n] of collections) {
    const result = diffCollection(
      p as readonly { uuid?: string }[],
      n as readonly {
        uuid?: string;
      }[],
    );
    if (result === UNSAFE) return null;
    if (result !== undefined) (patch as Record<string, unknown>)[key] = result;
  }

  const libs = diffCollection(prev.libSymbols, next.libSymbols, byLibId);
  if (libs === UNSAFE) return null;
  if (libs !== undefined) patch.libSymbols = libs;

  // Reference equality, like every collection above: an edit that does not
  // touch the notes shapes keeps the same array.
  if (prev.graphics !== next.graphics) patch.graphics = next.graphics;

  return patch;
}

/** Splice a patch into a (typically different, receiver-local) sheet. */
export function applySchematicPatch(doc: Schematic, patch: SchematicPatch): Schematic {
  return {
    ...doc,
    symbols: applyCollectionPatch(doc.symbols, patch.symbols),
    lines: applyCollectionPatch(doc.lines, patch.lines),
    junctions: applyCollectionPatch(doc.junctions, patch.junctions),
    noConnects: applyCollectionPatch(doc.noConnects, patch.noConnects),
    labels: applyCollectionPatch(doc.labels, patch.labels),
    sheets: applyCollectionPatch(doc.sheets, patch.sheets),
    busEntries: applyCollectionPatch(doc.busEntries, patch.busEntries),
    images: applyCollectionPatch(doc.images, patch.images),
    textBoxes: applyCollectionPatch(doc.textBoxes, patch.textBoxes),
    tables: applyCollectionPatch(doc.tables, patch.tables),
    groups: applyCollectionPatch(doc.groups, patch.groups),
    directiveLabels: applyCollectionPatch(doc.directiveLabels ?? [], patch.directiveLabels),
    libSymbols: applyCollectionPatch(doc.libSymbols, patch.libSymbols, byLibId),
    ...(patch.graphics ? { graphics: patch.graphics } : {}),
  };
}

/** Nothing to send. `diffSchematic` returns this for an edit that changed no
 *  item at all, which a debounced broadcast can legitimately observe. */
export function schematicPatchIsEmpty(patch: SchematicPatch): boolean {
  return Object.keys(patch).length === 0;
}
