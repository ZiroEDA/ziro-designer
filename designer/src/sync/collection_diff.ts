// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Diffing and splicing a keyed collection, shared by every document type that
 * syncs live: `pcb_diff.ts` for boards, `sch_diff.ts` for sheets.
 *
 * One module rather than a copy per editor. The algorithm is the same for both
 * because the *shape* is: a KiCad document is a handful of flat arrays of
 * self-contained, individually-identified items, and both readers preserve
 * each item's own source node so an item can be spliced into another peer's
 * document wholesale.
 *
 * The key is usually `uuid`, which is why that is the default, but it is not
 * always: a schematic's `lib_symbols` cache is keyed by lib id, since a
 * library definition is identified by what it *is* rather than by an instance
 * id it does not have.
 */

export interface CollectionPatch<T> {
  upsert: T[];
  remove: string[];
}

/**
 * Sentinel distinct from `undefined` (= "no change, omit this collection"):
 * some item has no key, so identity across the two arrays cannot be trusted.
 *
 * Kept distinct from "no change" deliberately — collapsing them would make a
 * document-level diff treat every unrelated, unchanged, key-less collection as
 * a reason to abandon the entire patch, when only an actually-changed
 * collection missing keys is a real problem.
 */
export const UNSAFE = Symbol('collection-diff-unsafe');

const byUuid = (item: { uuid?: string }): string | undefined => item.uuid;

/**
 * Both functions below are overloaded rather than taking an optional `keyOf`
 * with a `uuid` default, so that the default is only reachable for a type that
 * actually has a `uuid`. A single signature would have to widen `T` to `any`
 * or cast inside, and then a collection with no `uuid` at all -- a schematic's
 * `lib_symbols` cache, say -- would compile happily on the two-argument form
 * and silently report every item as unkeyed at runtime.
 */

/**
 * Diff one collection by key. Returns `undefined` when nothing changed (omit
 * it from the patch), `UNSAFE` when some item has no key (the caller falls
 * back to whole-document sync rather than risk a wrong splice), or the patch.
 *
 * Reference (not deep) equality decides "changed": every pure edit function in
 * this codebase produces a new object only for the items it actually touches
 * (`arr.map(x => touched.has(x.uuid) ? {...x, …} : x)`), so an untouched item
 * keeps its exact prior reference. That is what makes "select all, nudge one"
 * produce a one-item patch rather than a whole-document one. It holds through
 * the schematic's post-commit cleanup too: `mergeColinearWires` returns the
 * document it was given when it merges nothing, and copies only the lines it
 * actually merges when it does.
 */
export function diffCollection<T extends { uuid?: string }>(
  prev: readonly T[],
  next: readonly T[],
): CollectionPatch<T> | undefined | typeof UNSAFE;
export function diffCollection<T>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (item: T) => string | undefined,
): CollectionPatch<T> | undefined | typeof UNSAFE;
export function diffCollection<T>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (item: T) => string | undefined = byUuid as (item: T) => string | undefined,
): CollectionPatch<T> | undefined | typeof UNSAFE {
  const prevByKey = new Map<string, T>();
  for (const item of prev) {
    const key = keyOf(item);
    if (!key) return UNSAFE;
    prevByKey.set(key, item);
  }
  const nextKeys = new Set<string>();
  const upsert: T[] = [];
  for (const item of next) {
    const key = keyOf(item);
    if (!key) return UNSAFE;
    nextKeys.add(key);
    if (prevByKey.get(key) !== item) upsert.push(item);
  }
  const remove: string[] = [];
  for (const key of prevByKey.keys()) if (!nextKeys.has(key)) remove.push(key);
  if (upsert.length === 0 && remove.length === 0) return undefined; // no change: omit
  return { upsert, remove };
}

/** Splice a patch into a (typically different, receiver-local) collection. */
export function applyCollectionPatch<T extends { uuid?: string }>(
  items: readonly T[],
  patch: CollectionPatch<T> | undefined,
): T[];
export function applyCollectionPatch<T>(
  items: readonly T[],
  patch: CollectionPatch<T> | undefined,
  keyOf: (item: T) => string | undefined,
): T[];
export function applyCollectionPatch<T>(
  items: readonly T[],
  patch: CollectionPatch<T> | undefined,
  keyOf: (item: T) => string | undefined = byUuid as (item: T) => string | undefined,
): T[] {
  if (!patch) return items as T[];
  const removeSet = new Set(patch.remove);
  const upsertByKey = new Map<string, T>();
  for (const item of patch.upsert) {
    const key = keyOf(item);
    if (key) upsertByKey.set(key, item);
  }
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key && removeSet.has(key)) continue;
    const replacement = key ? upsertByKey.get(key) : undefined;
    if (replacement) {
      out.push(replacement);
      upsertByKey.delete(key!);
    } else {
      out.push(item);
    }
  }
  // Whatever is left is genuinely new (an insert, not a replace).
  for (const item of upsertByKey.values()) out.push(item);
  return out;
}
