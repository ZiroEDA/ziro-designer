// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Typed read helpers over the S-expression AST.
 *
 * The typed document model is a *view* over the lossless AST: readers use these
 * helpers to pull named children and scalar values out of an `SList` without
 * losing the underlying node (which remains the source of truth for serializing
 * unchanged items). Nothing here mutates or discards AST nodes.
 */

import { head, isList, type SList, type SNode } from './types.js';

/** All direct child lists of `node` whose head matches `name`. */
export function childrenNamed(node: SList, name: string): SList[] {
  const out: SList[] = [];
  for (const item of node.items) {
    if (isList(item) && head(item) === name) out.push(item);
  }
  return out;
}

/** The first direct child list of `node` whose head matches `name`, if any. */
export function childNamed(node: SList, name: string): SList | undefined {
  for (const item of node.items) {
    if (isList(item) && head(item) === name) return item;
  }
  return undefined;
}

/**
 * The positional arguments of a list: its items after the head, as scalar values.
 * For `(at 161.29 109.22 180)` this is `['161.29', '109.22', '180']`. Sub-lists
 * are skipped (they are not positional scalars).
 */
export function args(node: SList): string[] {
  const out: string[] = [];
  for (let i = 1; i < node.items.length; i++) {
    const it = node.items[i]!;
    if (!isList(it)) out.push(it.value);
  }
  return out;
}

/** The raw scalar value of the nth positional argument (0-based, after the head). */
export function arg(node: SList, index: number): string | undefined {
  return args(node)[index];
}

/** The nth positional argument parsed as a finite number, or `undefined`. */
export function numArg(node: SList, index: number): number | undefined {
  const raw = arg(node, index);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Thrown where KiCad's parsers call `Expecting( … )` — a token the grammar does
 * not allow in that position. KiCad raises `IO_ERROR` and abandons the load; so
 * do we, rather than silently substituting a default and mis-reading the file.
 */
export class ExpectingError extends Error {
  constructor(
    readonly expected: string,
    readonly context: string,
  ) {
    super(`Expecting "${expected}" in ${context}`);
    this.name = 'ExpectingError';
  }
}

/**
 * Which spellings of a boolean a parser accepts, because the two KiCad parsers
 * differ and the difference is load-bearing:
 *
 * - `'yes-no'` — `SCH_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool`
 *   (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:147) takes
 *   `T_yes`/`T_no` only.
 * - `'yes-no-true-false'` — `PCB_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool`
 *   (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp:265) also takes
 *   `T_true`/`T_false`.
 *
 * Anything else is `Expecting( "yes or no" )` in both.
 */
export type BoolDialect = 'yes-no' | 'yes-no-true-false';

/**
 * The list half of `parseMaybeAbsentBool`: the `PrevTok() == T_LEFT` branch,
 * given the child list itself.
 *
 * `(hide)` is the `DSN_RIGHT` early return — the token is present with no
 * argument, which means `whenPresent`, the same as the bare form. `(hide yes)`
 * / `(hide no)` (plus `true`/`false` in pcbnew's dialect) are the explicit
 * bool. Everything else — a quoted `"yes"`, a nested list, a second argument
 * that would fail `NeedRIGHT()` — is an error.
 */
export function maybeAbsentBoolOf(
  node: SList,
  whenPresent: boolean,
  dialect: BoolDialect,
): boolean {
  const name = head(node) ?? '?';
  const first = node.items[1];

  // "hide)": DSN_RIGHT straight after the token.
  if (first === undefined) return whenPresent;

  if (first.kind !== 'atom') throw new ExpectingError('yes or no', `(${name} …)`);

  const wide = dialect === 'yes-no-true-false';
  let value: boolean;

  if (first.value === 'yes' || (wide && first.value === 'true')) value = true;
  else if (first.value === 'no' || (wide && first.value === 'false')) value = false;
  else throw new ExpectingError('yes or no', `(${name} ${first.value})`);

  // NeedRIGHT().
  if (node.items.length > 2) throw new ExpectingError(')', `(${name} …)`);

  return value;
}

/**
 * `parseMaybeAbsentBool( aDefaultValue )` —
 * `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp:265` and its twin at
 * `eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:147`.
 *
 * A flag token written three different ways across the format's history, all of
 * which a current KiCad still reads:
 *
 * 1. a **bare positional token** — `(fp_text value "G***" (at 0.75 0) hide …)`.
 *    `PrevTok()` is not `T_LEFT`, so the parser takes the `else` branch and
 *    returns `aDefaultValue`: the token's presence *is* the value.
 * 2. `(hide)` — a list holding the token and nothing else. The `DSN_RIGHT`
 *    early return gives `aDefaultValue` again.
 * 3. `(hide yes)` / `(hide no)` — the explicit bool modern KiCad writes.
 *
 * `whenPresent` is the call site's `aDefaultValue`; it is *not* the value for an
 * absent token. Absent is `undefined`, so a caller can tell "the file never
 * mentioned this flag" (keep the item's own constructed default) from "the file
 * said the flag is on".
 *
 * Where a token appears more than once, the last wins: KiCad's parsers are
 * token loops and each `case` assigns over the last.
 */
export function maybeAbsentBool(
  parent: SList,
  name: string,
  whenPresent: boolean,
  dialect: BoolDialect,
): boolean | undefined {
  let result: boolean | undefined;

  // Skip items[0]: that is the parent's own head token, not a child of its body.
  for (let i = 1; i < parent.items.length; i++) {
    const item = parent.items[i]!;

    // Shape 1. A quoted `"hide"` is a DSN_STRING to KiCad, never the T_hide
    // token, so only a bare atom counts.
    if (item.kind === 'atom') {
      if (item.value === name) result = whenPresent;
      continue;
    }

    // Shapes 2 and 3.
    if (isList(item) && head(item) === name) result = maybeAbsentBoolOf(item, whenPresent, dialect);
  }

  return result;
}

/**
 * A KiCad "maybe absent" boolean. KiCad encodes booleans as the tokens `yes`/`no`
 * (and tolerates legacy `true`/`false`). Returns `fallback` when the value is
 * missing or unrecognised.
 */
export function boolArg(node: SList, index: number, fallback = false): boolean {
  const raw = arg(node, index);
  if (raw === 'yes' || raw === 'true') return true;
  if (raw === 'no' || raw === 'false') return false;
  return fallback;
}

/** Convenience: read a named child's first positional argument as a string. */
export function stringField(node: SList, name: string): string | undefined {
  const child = childNamed(node, name);
  return child ? arg(child, 0) : undefined;
}

/** Convenience: read a named child's first positional argument as a number. */
export function numberField(node: SList, name: string): number | undefined {
  const child = childNamed(node, name);
  return child ? numArg(child, 0) : undefined;
}

/** Convenience: read a named yes/no child as a boolean. */
export function boolField(node: SList, name: string, fallback = false): boolean {
  const child = childNamed(node, name);
  return child ? boolArg(child, 0, fallback) : fallback;
}

/** Type guard re-export for readers that walk mixed `SNode` arrays. */
export { isList, type SNode, type SList };
