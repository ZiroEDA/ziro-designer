// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * `thirdparty/potrace/include/lists.h`: the linked-list macros
 * `decompose.cpp` builds its path tree with.
 *
 * The macros take a *hook*, a `T**` pointing at some `next` (or `childlist`,
 * or a list head) slot. A hook here is that slot named: the object holding it
 * and the field. Appending through a hook and advancing it is
 * `list_insert_beforehook`, exactly as the C does it.
 */

export interface LISTED<T> {
  next: T | null;
}

/** A `T**`: the slot `obj[key]`. */
export interface HOOK<T> {
  obj: Record<string, unknown>;
  key: string;
  /** Type witness only. */
  readonly _t?: T;
}

export function hookOf<T>(obj: object, key: string): HOOK<T> {
  return { obj: obj as Record<string, unknown>, key };
}

export function hookGet<T>(h: HOOK<T>): T | null {
  return (h.obj[h.key] as T | null | undefined) ?? null;
}

export function hookSet<T>(h: HOOK<T>, v: T | null): void {
  h.obj[h.key] = v;
}

/**
 * `list_insert_beforehook( elt, hook )`: `elt->next = *hook; *hook = elt;
 * hook = &elt->next`. Returns the advanced hook, which the caller stores back
 * into its own hook variable.
 */
export function list_insert_beforehook<T extends LISTED<T>>(elt: T, hook: HOOK<T>): HOOK<T> {
  elt.next = hookGet(hook);
  hookSet(hook, elt);
  return hookOf<T>(elt, 'next');
}

/** `list_insert_athook( elt, hook )`: `elt->next = *hook; *hook = elt`. */
export function list_insert_athook<T extends LISTED<T>>(elt: T, hook: HOOK<T>): void {
  elt.next = hookGet(hook);
  hookSet(hook, elt);
}

/**
 * `list_append( listtype, list, elt )`: walk to the list's last `next` slot
 * and insert there. `list` is given as the hook holding its head.
 */
export function list_append<T extends LISTED<T>>(list: HOOK<T>, elt: T): void {
  let hook = list;

  for (let cur = hookGet(hook); cur !== null; cur = hookGet(hook)) hook = hookOf<T>(cur, 'next');

  list_insert_athook(elt, hook);
}
