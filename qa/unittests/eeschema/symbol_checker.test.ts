// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CheckLibSymbol` / `CheckDuplicatePins` / `CheckLibSymbolGraphics`
 * (symbol_checker.cpp): reference prefix, duplicate pins, power-symbol
 * rules, hidden power pins, off-grid pins, zero-size graphics.
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { CheckDuplicatePins, CheckLibSymbol } from '@ziroeda/eeschema/symbol_checker.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { describe, expect, it } from 'vitest';

const units = new UNITS_PROVIDER(schIUScale, 'mm');
const GRID_50 = schIUScale.milsToIU(50);

const pin = (
  sym: LIB_SYMBOL,
  num: string,
  opts: {
    unit?: number;
    x?: number;
    y?: number;
    type?: ELECTRICAL_PINTYPE;
    name?: string;
  } = {},
): SCH_PIN => {
  const p = SCH_PIN.makeLibPin(
    sym,
    opts.name ?? `P${num}`,
    num,
    PIN_ORIENTATION.PIN_RIGHT,
    opts.type ?? ELECTRICAL_PINTYPE.PT_PASSIVE,
    25400,
    12700,
    12700,
    0,
    { x: opts.x ?? 0, y: opts.y ?? 0 },
    opts.unit ?? 1,
  );
  return p;
};

function setReference(sym: LIB_SYMBOL, text: string): void {
  const fields: SCH_FIELD[] = [];
  sym.GetFields(fields);
  const ref = fields.find((f) => f.GetId() === FIELD_T.REFERENCE)!;
  ref.SetText(text);
}

describe('CheckLibSymbol: reference prefix', () => {
  it('warns when the reference is empty', () => {
    const s = new LIB_SYMBOL('R');
    setReference(s, '');
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('reference is empty'))).toBe(true);
  });

  it('warns when the prefix ends in a digit or "?"', () => {
    const s = new LIB_SYMBOL('R');
    setReference(s, 'R1');
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('reference prefix'))).toBe(true);
  });

  it('is silent for a clean prefix', () => {
    const s = new LIB_SYMBOL('R');
    setReference(s, 'R');
    s.AddDrawItem(pin(s, '1'));
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('reference'))).toBe(false);
  });
});

describe('CheckDuplicatePins', () => {
  it('flags two pins sharing a number in the same body style', () => {
    const s = new LIB_SYMBOL('U');
    s.AddDrawItem(pin(s, '1', { x: 0 }));
    s.AddDrawItem(pin(s, '1', { x: GRID_50 }));
    const msgs: string[] = [];
    CheckDuplicatePins(s, msgs, units);
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toContain('Duplicate pin');
  });

  it('does not flag the same number in two different (non-zero) body styles', () => {
    const s = new LIB_SYMBOL('U');
    const a = pin(s, '1', { x: 0 });
    const b = pin(s, '1', { x: GRID_50 });
    a.SetBodyStyle(1);
    b.SetBodyStyle(2);
    s.AddDrawItem(a);
    s.AddDrawItem(b);
    const msgs: string[] = [];
    CheckDuplicatePins(s, msgs, units);
    expect(msgs.length).toBe(0);
  });

  it('does not flag distinct pin numbers', () => {
    const s = new LIB_SYMBOL('U');
    s.AddDrawItem(pin(s, '1'));
    s.AddDrawItem(pin(s, '2', { x: GRID_50 }));
    const msgs: string[] = [];
    CheckDuplicatePins(s, msgs, units);
    expect(msgs.length).toBe(0);
  });
});

describe('CheckLibSymbol: power symbol rules', () => {
  it('accepts a well-formed power symbol (one unit, one visible PT_POWER_OUT pin)', () => {
    const s = new LIB_SYMBOL('#PWR');
    setReference(s, '#PWR');
    s.SetLocalPower();
    s.AddDrawItem(pin(s, '1', { type: ELECTRICAL_PINTYPE.PT_POWER_OUT }));
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('Power Symbol'))).toBe(false);
  });

  it('warns about a power symbol with more than one pin', () => {
    const s = new LIB_SYMBOL('#PWR');
    setReference(s, '#PWR');
    s.SetLocalPower();
    s.AddDrawItem(pin(s, '1', { type: ELECTRICAL_PINTYPE.PT_POWER_OUT }));
    s.AddDrawItem(pin(s, '2', { type: ELECTRICAL_PINTYPE.PT_POWER_OUT, x: GRID_50 }));
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('should have only one pin'))).toBe(true);
  });

  it('warns about a suspicious (non-power-type) pin on a power symbol', () => {
    const s = new LIB_SYMBOL('#PWR');
    setReference(s, '#PWR');
    s.SetLocalPower();
    s.AddDrawItem(pin(s, '1', { type: ELECTRICAL_PINTYPE.PT_PASSIVE }));
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('Suspicious Power Symbol'))).toBe(true);
  });
});

describe('CheckLibSymbol: hidden power pins and off-grid pins', () => {
  it('reports a hidden PT_POWER_IN pin on a non-power symbol', () => {
    const s = new LIB_SYMBOL('U');
    setReference(s, 'U');
    const p = pin(s, '1', { type: ELECTRICAL_PINTYPE.PT_POWER_IN });
    p.SetVisible(false);
    s.AddDrawItem(p);
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('Hidden power pin'))).toBe(true);
  });

  it('reports a pin whose position is not a multiple of the clamped grid', () => {
    const s = new LIB_SYMBOL('U');
    setReference(s, 'U');
    s.AddDrawItem(pin(s, '1', { x: GRID_50 + 1 }));
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('Off grid pin'))).toBe(true);
  });

  it('clamps a grid smaller than 25 mil up to 25 mil before checking', () => {
    const s = new LIB_SYMBOL('U');
    setReference(s, 'U');
    const grid25 = schIUScale.milsToIU(25);
    s.AddDrawItem(pin(s, '1', { x: grid25 })); // on the 25-mil grid, off any finer grid
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, 1, units); // aGridForPins smaller than 25 mil
    expect(msgs.some((m) => m.includes('Off grid pin'))).toBe(false);
  });
});

describe('CheckLibSymbol: graphics sanity', () => {
  it('never flags a "zero-radius" circle: EDA_SHAPE.GetRadius floors at 1', () => {
    // GetRadius() (common/eda_shape.ts) is Math.max(1, KiROUND(radius)), the
    // same floor eda_shape.cpp:1144 applies, so a degenerate circle reads as
    // radius 1, not 0 - the C++'s `GetRadius() <= 0` branch is dead code in
    // both trees, and this pins that rather than a "fixed" behaviour.
    const s = new LIB_SYMBOL('U');
    setReference(s, 'U');
    s.AddDrawItem(pin(s, '1'));
    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
    circle.SetPosition({ x: 0, y: 0 });
    circle.SetEnd({ x: 0, y: 0 }); // start == end, but GetRadius() still reads 1
    s.AddDrawItem(circle);
    expect(circle.GetRadius()).toBe(1);
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('circle has radius = 0'))).toBe(false);
  });

  it('flags a zero-size rectangle', () => {
    const s = new LIB_SYMBOL('U');
    setReference(s, 'U');
    s.AddDrawItem(pin(s, '1'));
    const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);
    rect.SetPosition({ x: 100, y: 100 });
    rect.SetEnd({ x: 100, y: 100 });
    s.AddDrawItem(rect);
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('rectangle has size 0'))).toBe(true);
  });

  it('is silent for a normal-sized rectangle', () => {
    const s = new LIB_SYMBOL('U');
    setReference(s, 'U');
    s.AddDrawItem(pin(s, '1'));
    const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);
    rect.SetPosition({ x: 0, y: 0 });
    rect.SetEnd({ x: 1000, y: 1000 });
    s.AddDrawItem(rect);
    const msgs: string[] = [];
    CheckLibSymbol(s, msgs, GRID_50, units);
    expect(msgs.some((m) => m.includes('rectangle has size 0'))).toBe(false);
  });
});
