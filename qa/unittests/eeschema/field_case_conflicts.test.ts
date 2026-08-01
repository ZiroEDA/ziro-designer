// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Field-name case conflicts, counterparts DetectFieldCaseConflicts and
 * dialog_resolve_field_case_conflicts.cpp: what counts as a conflict, and the
 * two rules that make resolving one safe — the kept spelling takes the other's
 * value when it is empty, and joining keeps both.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  conflictKey,
  detectFieldCaseConflicts,
  resolveFieldCaseConflicts,
  resolveFieldCaseConflictsCommand,
  type FieldCaseAction,
} from '@ziroeda/eeschema/src/tools/field_case_conflicts.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sch = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20231120) (generator "test") (lib_symbols) ${body})`));

const symbol = (uuid: string, ref: string, props: string): string => `
  (symbol (lib_id "Device:R") (at 0 0 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "${ref}" (at 0 0 0))
    (property "Value" "10k" (at 0 2 0))
    ${props})`;

const CONFLICTED = sch(
  symbol(
    's0',
    'R1',
    `(property "MPN" "RC0805" (at 0 4 0))
     (property "mpn" "RC-0805-ALT" (at 0 6 0))`,
  ),
);

const fields = (d: Schematic, i = 0) =>
  Object.fromEntries(d.symbols[i]!.fields.map((f) => [f.key, f.value]));

const actions = (
  a: FieldCaseAction,
  key = conflictKey('s0', 'mpn'),
): Map<string, FieldCaseAction> => new Map([[key, a]]);

describe('detecting', () => {
  it('finds two spellings of one name on a symbol', () => {
    const found = detectFieldCaseConflicts(CONFLICTED);
    expect(found).toHaveLength(1);
    expect(found[0]?.reference).toBe('R1');
    expect(found[0]?.caseFoldedKey).toBe('mpn');
    expect(found[0]?.variants.map((v) => v.name)).toEqual(['MPN', 'mpn']);
  });

  it('finds nothing when the names differ by more than case', () => {
    const d = sch(
      symbol('s0', 'R1', '(property "MPN" "a" (at 0 4 0)) (property "MPN2" "b" (at 0 6 0))'),
    );
    expect(detectFieldCaseConflicts(d)).toHaveLength(0);
  });

  it('ignores the mandatory fields, whose names are fixed', () => {
    // "value" alongside "Value" cannot be created through the UI, and upstream
    // exempts the mandatory names from the check regardless.
    const d = sch(symbol('s0', 'R1', '(property "value" "x" (at 0 4 0))'));
    expect(detectFieldCaseConflicts(d)).toHaveLength(0);
  });

  it('reports one conflict per symbol per name', () => {
    const d = sch(`
      ${symbol('s0', 'R1', '(property "MPN" "a" (at 0 4 0)) (property "mpn" "b" (at 0 6 0))')}
      ${symbol('s1', 'R2', '(property "Note" "a" (at 0 4 0)) (property "note" "b" (at 0 6 0))')}`);
    const found = detectFieldCaseConflicts(d);
    expect(found.map((c) => c.reference)).toEqual(['R1', 'R2']);
  });
});

describe('resolving', () => {
  const found = () => detectFieldCaseConflicts(CONFLICTED);

  it('keeps the first spelling and drops the other', () => {
    const d = resolveFieldCaseConflicts(CONFLICTED, found(), actions('keepFirst'), ', ');
    expect(fields(d)).toMatchObject({ MPN: 'RC0805' });
    expect(fields(d).mpn).toBeUndefined();
  });

  it('keeps the second spelling and drops the first', () => {
    const d = resolveFieldCaseConflicts(CONFLICTED, found(), actions('keepSecond'), ', ');
    expect(fields(d)).toMatchObject({ mpn: 'RC-0805-ALT' });
    expect(fields(d).MPN).toBeUndefined();
  });

  it('joins both values into the first spelling', () => {
    const d = resolveFieldCaseConflicts(CONFLICTED, found(), actions('join'), ', ');
    expect(fields(d).MPN).toBe('RC0805, RC-0805-ALT');
  });

  it('takes the other value when the kept field is empty', () => {
    // Keeping a spelling is about the name; an empty winner would throw away
    // the only data there was.
    const d0 = sch(
      symbol('s0', 'R1', '(property "MPN" "" (at 0 4 0)) (property "mpn" "real" (at 0 6 0))'),
    );
    const d = resolveFieldCaseConflicts(
      d0,
      detectFieldCaseConflicts(d0),
      actions('keepFirst'),
      ', ',
    );
    expect(fields(d).MPN).toBe('real');
  });

  it('does not put a separator next to an empty value when joining', () => {
    const d0 = sch(
      symbol('s0', 'R1', '(property "MPN" "real" (at 0 4 0)) (property "mpn" "" (at 0 6 0))'),
    );
    const d = resolveFieldCaseConflicts(d0, detectFieldCaseConflicts(d0), actions('join'), ', ');
    expect(fields(d).MPN).toBe('real');
  });

  it('uses the separator it is given', () => {
    const d = resolveFieldCaseConflicts(CONFLICTED, found(), actions('join'), ' | ');
    expect(fields(d).MPN).toBe('RC0805 | RC-0805-ALT');
  });

  it('defaults to keeping the first when no action was chosen', () => {
    const d = resolveFieldCaseConflicts(CONFLICTED, found(), new Map(), ', ');
    expect(fields(d).MPN).toBe('RC0805');
  });

  it('resolves each symbol independently', () => {
    const d0 = sch(`
      ${symbol('s0', 'R1', '(property "MPN" "a" (at 0 4 0)) (property "mpn" "b" (at 0 6 0))')}
      ${symbol('s1', 'R2', '(property "MPN" "c" (at 0 4 0)) (property "mpn" "d" (at 0 6 0))')}`);
    const d = resolveFieldCaseConflicts(
      d0,
      detectFieldCaseConflicts(d0),
      new Map<string, FieldCaseAction>([
        [conflictKey('s0', 'mpn'), 'keepFirst'],
        [conflictKey('s1', 'mpn'), 'keepSecond'],
      ]),
      ', ',
    );
    expect(fields(d, 0)).toMatchObject({ MPN: 'a' });
    expect(fields(d, 1)).toMatchObject({ mpn: 'd' });
  });

  it('resolves only the first two spellings, as upstream does', () => {
    // A third spelling is left for a second pass: the dialog shows two
    // variants per row and applyResolutions only touches those two.
    const d0 = sch(
      symbol(
        's0',
        'R1',
        `(property "MPN" "a" (at 0 4 0)) (property "mpn" "b" (at 0 6 0))
         (property "Mpn" "c" (at 0 8 0))`,
      ),
    );
    const d = resolveFieldCaseConflicts(
      d0,
      detectFieldCaseConflicts(d0),
      actions('keepFirst'),
      ', ',
    );
    expect(fields(d)).toMatchObject({ MPN: 'a', Mpn: 'c' });
    expect(fields(d).mpn).toBeUndefined();
    // …and the leftover is found again.
    expect(detectFieldCaseConflicts(d)).toHaveLength(1);
  });

  it('undoes cleanly, and is null with nothing to resolve', () => {
    const cmd = resolveFieldCaseConflictsCommand(CONFLICTED, found(), actions('join'), ', ')!;
    const after = cmd.apply(CONFLICTED);
    expect(cmd.invert(CONFLICTED).apply(after)).toEqual(CONFLICTED);
    expect(resolveFieldCaseConflictsCommand(CONFLICTED, [], new Map(), ', ')).toBeNull();
  });
});
