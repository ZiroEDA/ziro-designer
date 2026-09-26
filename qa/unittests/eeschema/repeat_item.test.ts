// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Repeat Last Item (F1), SCH_EDIT_TOOL::RepeatDrawItem over IncrementString.
 *
 * The point of the action is that a label's *text* is stepped, not just copied:
 * place NET0 and hold F1 to get NET1, NET2, NET3 down the page. Plain
 * duplication is Ctrl+D and already exists.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/tools/hittest.js';
import { IncrementString } from '@ziroeda/common/increment.js';
import { repeatItems } from '@ziroeda/eeschema/tools/repeat_item.js';
import { mmToIU } from '@ziroeda/common/eda_units.js';

const mm = (v: number): number => mmToIU(v);

describe('incrementing a name', () => {
  it('steps the last run of digits', () => {
    expect(IncrementString('NET0', 1)).toBe('NET1');
    expect(IncrementString('NET9', 1)).toBe('NET10');
    expect(IncrementString('D3', 5)).toBe('D8');
  });

  it('keeps the width the number had', () => {
    // D07 goes to D08, not D8: the field width is part of the name.
    expect(IncrementString('D07', 1)).toBe('D08');
    expect(IncrementString('D099', 1)).toBe('D100');
  });

  it('keeps whatever followed the digits', () => {
    expect(IncrementString('CLK0_P', 1)).toBe('CLK1_P');
    expect(IncrementString('A1B', 1)).toBe('A2B');
  });

  it('repeats a name with no digits unchanged, which is not a failure', () => {
    expect(IncrementString('RESET', 1)).toBe('RESET');
    expect(IncrementString('', 1)).toBe('');
  });

  it('refuses to go below zero rather than wrapping', () => {
    // Upstream reports "Label value cannot go below zero" and leaves the value.
    expect(IncrementString('NET0', -1)).toBeNull();
    expect(IncrementString('NET2', -5)).toBeNull();
    expect(IncrementString('NET5', -5)).toBe('NET0');
  });

  it('steps downward when the increment is negative', () => {
    expect(IncrementString('NET5', -1)).toBe('NET4');
    expect(IncrementString('D10', -1)).toBe('D09');
  });
});

describe('repeating a label', () => {
  const sch = readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") (lib_symbols)
      (label "NET0" (at 10 10 0) (uuid "lb1")))`),
  );
  const ID = refId('label', 'lb1', 0);
  const OPTS = { offset: { x: 0, y: mm(2.54) }, labelIncrement: 1 };

  it('adds a stepped copy at the repeat offset', () => {
    const r = repeatItems(sch, [ID], OPTS)!;
    const out = r.command.apply(sch);
    expect(out.labels).toHaveLength(2);
    expect(out.labels[1]!.text).toBe('NET1');
    expect(out.labels[1]!.at).toEqual({ x: mm(10), y: mm(12.54) });
  });

  it('gives the copy its own identity', () => {
    // Two labels sharing a uuid would be one item to everything downstream.
    const out = repeatItems(sch, [ID], OPTS)!.command.apply(sch);
    expect(out.labels[1]!.uuid).not.toBe(out.labels[0]!.uuid);
  });

  it('repeats again from the copy, so holding F1 walks down the page', () => {
    let doc = sch;
    let id = ID;
    for (let i = 0; i < 3; i++) {
      const r = repeatItems(doc, [id], OPTS)!;
      doc = r.command.apply(doc);
      id = r.ids[0]!;
    }
    expect(doc.labels.map((l) => l.text)).toEqual(['NET0', 'NET1', 'NET2', 'NET3']);
  });

  it('reports when the number could not go below zero, and keeps the value', () => {
    const r = repeatItems(sch, [ID], { ...OPTS, labelIncrement: -1 })!;
    expect(r.clampedAtZero).toBe(true);
    expect(r.command.apply(sch).labels[1]!.text).toBe('NET0');
  });

  it('does nothing when there is nothing to repeat', () => {
    expect(repeatItems(sch, [], OPTS)).toBeNull();
    expect(repeatItems(sch, ['no-such-item'], OPTS)).toBeNull();
  });

  it('undoes exactly, and the result saves', () => {
    const cmd = repeatItems(sch, [ID], OPTS)!.command;
    const after = cmd.apply(sch);
    expect(cmd.invert(sch).apply(after).labels).toEqual(sch.labels);
    const reread = readSchematic(parse(serializeSchematic(after)));
    expect(reread.labels.map((l) => l.text)).toEqual(['NET0', 'NET1']);
  });
});
