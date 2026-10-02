// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_REFERENCE / SCH_REFERENCE_LIST on the live model (sch_reference_list.cpp) and
 * REFDES_TRACKER::GetNextRefDesForUnits (refdes_tracker.cpp:90). Every expectation is read
 * off the C++.
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { ERCE_T } from '@ziroeda/eeschema/erc/erc_settings.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { REFDES_TRACKER } from '@ziroeda/eeschema/refdes_tracker.js';
import {
  ANNOTATE_ALGO_T,
  ANNOTATE_ORDER_T,
  SCH_REFERENCE,
  SCH_REFERENCE_LIST,
} from '@ziroeda/eeschema/sch_reference_list.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { describe, expect, it } from 'vitest';

function setup() {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const sheet = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(sheet);
  return { schematic, sheet, screen: sheet.LastScreen()! };
}

function part(name: string, units = 1, power = false): LIB_SYMBOL {
  const lib = new LIB_SYMBOL(name);
  if (units > 1) lib.SetUnitCount(units, true);
  if (power) lib.SetGlobalPower();
  return lib;
}

/** A symbol on the sheet with reference \a ref, at x \a x, unit \a unit, value \a value. */
function place(
  env: ReturnType<typeof setup>,
  lib: LIB_SYMBOL,
  ref: string,
  x: number,
  unit = 1,
  value = 'v',
): SCH_SYMBOL {
  const sym = new SCH_SYMBOL(lib, new LIB_ID('Lib', lib.GetName()), env.sheet, unit, 0, {
    x,
    y: 0,
  });
  env.screen.Append(sym);
  sym.SetRef(env.sheet, ref);
  sym.SetValueFieldText(value);
  return sym;
}

function listOf(
  env: ReturnType<typeof setup>,
  symbols: SCH_SYMBOL[],
  tracker = new REFDES_TRACKER(),
) {
  const list = new SCH_REFERENCE_LIST();
  list.SetRefDesTracker(tracker);
  for (const s of symbols) list.AddItem(new SCH_REFERENCE(s, env.sheet));
  return list;
}

/** Annotate the not-yet-annotated, incrementally from 1, by X: what Annotate does by default. */
function annotate(list: SCH_REFERENCE_LIST) {
  list.SplitReferences();
  list.AnnotateByOptions(
    ANNOTATE_ORDER_T.SORT_BY_X_POSITION,
    ANNOTATE_ALGO_T.INCREMENTAL_BY_REF,
    0,
    new Map(),
    new SCH_REFERENCE_LIST(),
    false,
  );
  list.UpdateAnnotation();
}

describe('SCH_REFERENCE::Split', () => {
  const split = (ref: string) => {
    const env = setup();
    const r = new SCH_REFERENCE(place(env, part('R'), ref, 0), env.sheet);
    r.Split();
    return [r.GetRef(), r.m_numRef, r.m_numRefStr, r.m_isNew];
  };

  it('splits a prefix from its number, keeping leading zeroes in the string', () => {
    expect(split('U12')).toEqual(['U', 12, '12', false]);
    expect(split('U007')).toEqual(['U', 7, '007', false]);
  });

  it("tags '?' and a non-digit ending as not annotated", () => {
    expect(split('R?')).toEqual(['R', -1, '', true]);
    expect(split('R1A')).toEqual(['R1A', -1, '', true]);
  });
});

describe('SCH_REFERENCE_LIST::Annotate', () => {
  it('numbers new references by X from the first free number, keeping existing ones', () => {
    const env = setup();
    const r = part('R');
    const a = place(env, r, 'R?', 300);
    const b = place(env, r, 'R2', 100);
    const c = place(env, r, 'R?', 200);
    annotate(listOf(env, [a, b, c]));
    expect([a, b, c].map((s) => s.GetRef(env.sheet))).toEqual(['R3', 'R2', 'R1']);
  });

  it('gives a power symbol a zero-padded number', () => {
    const env = setup();
    const g = place(env, part('GND', 1, true), '#PWR?', 0);
    annotate(listOf(env, [g]));
    expect(g.GetRef(env.sheet)).toBe('#PWR01');
  });

  it('shares one number between free units of the same part and value', () => {
    const env = setup();
    const u = part('LM358', 2);
    const a = place(env, u, 'U?', 0, 1);
    const b = place(env, u, 'U?', 100, 2);
    annotate(listOf(env, [a, b]));
    expect([a.GetRef(env.sheet), b.GetRef(env.sheet)]).toEqual(['U1', 'U1']);
  });

  it('does not share a number between units of different values', () => {
    const env = setup();
    const u = part('LM358', 2);
    const a = place(env, u, 'U?', 0, 1, 'x');
    const b = place(env, u, 'U?', 100, 2, 'y');
    annotate(listOf(env, [a, b]));
    expect([a.GetRef(env.sheet), b.GetRef(env.sheet)]).toEqual(['U1', 'U2']);
  });

  it('starts sheet-numbered annotation at the sheet number times the step', () => {
    const env = setup();
    const r = part('R');
    const a = place(env, r, 'R?', 0);
    const list = listOf(env, [a]);
    list.at(0).SetSheetNumber(2);
    list.SplitReferences();
    list.AnnotateByOptions(
      ANNOTATE_ORDER_T.SORT_BY_X_POSITION,
      ANNOTATE_ALGO_T.SHEET_NUMBER_X_100,
      0,
      new Map(),
      new SCH_REFERENCE_LIST(),
      false,
    );
    list.UpdateAnnotation();
    expect(a.GetRef(env.sheet)).toBe('R201');
  });

  it('with reuse off, skips a number used before even though it is free now', () => {
    const env = setup();
    const tracker = new REFDES_TRACKER();
    tracker.SetReuseRefDes(false);
    tracker.Insert('R1');
    const a = place(env, part('R'), 'R?', 0);
    annotate(listOf(env, [a], tracker));
    expect(a.GetRef(env.sheet)).toBe('R2');
  });
});

describe('SCH_REFERENCE_LIST::CheckAnnotation', () => {
  it('reports an unannotated symbol', () => {
    const env = setup();
    const found: [ERCE_T, string][] = [];
    const n = listOf(env, [place(env, part('R'), 'R?', 0)]).CheckAnnotation((t, m) =>
      found.push([t, m]),
    );
    expect(n).toBe(1);
    expect(found).toEqual([[ERCE_T.ERCE_UNANNOTATED, 'Item not annotated: R?']]);
  });

  it('stops at the first unannotated symbol, but the duplicate pass still pairs two R?', () => {
    // sch_reference_list.cpp:652 breaks after one; the loop at :681 compares prefix and
    // m_numRef (-1 for both) and unit, so two `R?` are also "Duplicate items R?".
    const env = setup();
    const r = part('R');
    const found: [ERCE_T, string][] = [];
    const n = listOf(env, [
      place(env, r, 'R?', 0),
      place(env, r, 'R?', 1),
      place(env, r, 'R?', 2),
    ]).CheckAnnotation((t, m) => found.push([t, m]));
    expect(n).toBe(3);
    expect(found).toEqual([
      [ERCE_T.ERCE_UNANNOTATED, 'Item not annotated: R?'],
      [ERCE_T.ERCE_DUPLICATE_REFERENCE, 'Duplicate items R?\n'],
      [ERCE_T.ERCE_DUPLICATE_REFERENCE, 'Duplicate items R?\n'],
    ]);
  });

  it('reports duplicates', () => {
    const env = setup();
    const r = part('R');
    const found: [ERCE_T, string][] = [];
    const n = listOf(env, [place(env, r, 'R1', 0), place(env, r, 'R1', 1)]).CheckAnnotation(
      (t, m) => found.push([t, m]),
    );
    expect(n).toBe(1);
    expect(found).toEqual([[ERCE_T.ERCE_DUPLICATE_REFERENCE, 'Duplicate items R1\n']]);
  });

  it('reports different values between units of one reference', () => {
    const env = setup();
    const u = part('LM358', 2);
    const found: ERCE_T[] = [];
    listOf(env, [place(env, u, 'U1', 0, 1, 'x'), place(env, u, 'U1', 1, 2, 'y')]).CheckAnnotation(
      (t) => found.push(t),
    );
    expect(found).toEqual([ERCE_T.ERCE_DIFFERENT_UNIT_VALUE]);
  });

  it('is clean for a well-annotated sheet', () => {
    const env = setup();
    const r = part('R');
    expect(
      listOf(env, [place(env, r, 'R1', 0), place(env, r, 'R2', 1)]).CheckAnnotation(() => {}),
    ).toBe(0);
  });
});

describe('SCH_REFERENCE_LIST::Shorthand', () => {
  it('collapses runs of three or more with the range delimiter', () => {
    const env = setup();
    const r = part('R');
    const refs = ['R1', 'R2', 'R4', 'R5', 'R6', 'R7', 'U1'].map((ref, i) => {
      const x = new SCH_REFERENCE(place(env, r, ref, i), env.sheet);
      x.Split();
      return x;
    });
    expect(SCH_REFERENCE_LIST.Shorthand(refs, ', ', ' - ')).toBe('R1, R2, R4 - R7, U1');
    expect(SCH_REFERENCE_LIST.Shorthand(refs, ', ', '')).toBe('R1, R2, R4, R5, R6, R7, U1');
  });
});
