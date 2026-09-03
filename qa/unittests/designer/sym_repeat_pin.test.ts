// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Insert — `SYMBOL_EDITOR_PIN_TOOL::RepeatPin`
 * (`symbol_editor_pin_tool.cpp:411-457`), reached by
 * `SYMBOL_EDITOR_DRAWING_TOOLS::RepeatDrawItem` (`:854-886`).
 *
 * This is what makes "Pitch of repeated pins" and "Label increment" on
 * Preferences > Symbol Editor > Editing Options mean anything: they were two
 * numbers the page stored and nothing stepped by. Place a pin, hold Insert, and
 * a row of pins walks down the body with its names and numbers counting up —
 * which is the entire point of the action, and why it is not Ctrl+D.
 *
 * The three things worth pinning, because a plausible port gets each wrong:
 *
 *  1. the step is on the axis PERPENDICULAR to the pin, and every arm of the
 *     switch is POSITIVE (`:427-435`) — a left-facing pin steps +y just like a
 *     right-facing one, so the row always walks down or right whichever way the
 *     pins point;
 *  2. BOTH the name and the number are incremented (`:438-445`), not the number
 *     alone;
 *  3. `IncrementString` is a no-op on a string with no digits and refuses to go
 *     below zero, so neither case is an error — the pin repeats with that field
 *     unchanged.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import type { LibPin, LibSymbol } from '@ziroeda/eeschema';
import { repeatPin } from '@ziroeda/designer/src/editors/symbol/edits.js';
import { schIUScale } from '@ziroeda/common';

/** One symbol, one pin, built from the caller's tokens. */
const symbolWith = (pinTokens: string, units = 1): LibSymbol => {
  const bodies = Array.from(
    { length: units },
    (_, i) => `(symbol "U_${i + 1}_1" ${pinTokens})`,
  ).join('\n    ');
  return readSymbolLib(
    parse(`(kicad_symbol_lib (version 20241209) (generator "qa")
    (symbol "U" (pin_names (offset 0))
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "U" (at 0 0 0))
      ${bodies}))`),
  )[0] as LibSymbol;
};

const PIN = (extra: string): string =>
  `(pin input line (at 0 0 0) (length 2.54)
     (name "IN1" (effects (font (size 1.27 1.27))))
     (number "1" (effects (font (size 1.27 1.27)))) ${extra})`;

const allPins = (s: LibSymbol): LibPin[] => s.units.flatMap((u) => u.pins);
const opts = (over: Partial<Parameters<typeof repeatPin>[2]> = {}) => ({
  pinStepMils: 100,
  labelDelta: 1,
  synchronize: false,
  unit: 1,
  bodyStyle: 1,
  ...over,
});

describe('the step', () => {
  it('moves a horizontal pin in Y, by MilsToIU(pin_step)', () => {
    // PIN_RIGHT: `step.y = schIUScale.MilsToIU( cfg->m_Repeat.pin_step )`.
    const sym = symbolWith(PIN(''));
    const src = allPins(sym)[0]!;
    const r = repeatPin(sym, 'pin:0:0', opts())!;
    expect(r).not.toBeNull();
    expect(r.pin.at.x).toBe(src.at.x);
    expect(r.pin.at.y).toBe(src.at.y + schIUScale.milsToIU(100));
  });

  it('moves a VERTICAL pin in X instead', () => {
    // PIN_UP / PIN_DOWN take `step.x`. A vertical pin stacks across the body,
    // not down it.
    const sym = symbolWith(
      `(pin input line (at 0 0 90) (length 2.54)
         (name "IN1" (effects (font (size 1.27 1.27))))
         (number "1" (effects (font (size 1.27 1.27)))))`,
    );
    const src = allPins(sym)[0]!;
    const r = repeatPin(sym, 'pin:0:0', opts())!;
    expect(r.pin.at.x).toBe(src.at.x + schIUScale.milsToIU(100));
    expect(r.pin.at.y).toBe(src.at.y);
  });

  it('steps a LEFT-facing pin the same way as a right-facing one', () => {
    // Every arm of the switch is `+ MilsToIU( pin_step )` — there is no sign
    // flip for PIN_LEFT or PIN_DOWN. A port that "helpfully" mirrors the step
    // to follow the pin direction walks the row the wrong way.
    const right = symbolWith(PIN(''));
    const left = symbolWith(
      `(pin input line (at 0 0 180) (length 2.54)
         (name "IN1" (effects (font (size 1.27 1.27))))
         (number "1" (effects (font (size 1.27 1.27)))))`,
    );
    const dyR = repeatPin(right, 'pin:0:0', opts())!.pin.at.y - allPins(right)[0]!.at.y;
    const dyL = repeatPin(left, 'pin:0:0', opts())!.pin.at.y - allPins(left)[0]!.at.y;
    expect(dyL).toBe(dyR);
    expect(dyL).toBeGreaterThan(0);
  });

  it('follows the configured pitch, so the setting is what moves it', () => {
    const sym = symbolWith(PIN(''));
    const base = allPins(sym)[0]!.at.y;
    expect(repeatPin(sym, 'pin:0:0', opts({ pinStepMils: 50 }))!.pin.at.y - base).toBe(
      schIUScale.milsToIU(50),
    );
    expect(repeatPin(sym, 'pin:0:0', opts({ pinStepMils: 200 }))!.pin.at.y - base).toBe(
      schIUScale.milsToIU(200),
    );
  });
});

describe('the increment', () => {
  it('steps the NAME and the NUMBER, both', () => {
    const r = repeatPin(symbolWith(PIN('')), 'pin:0:0', opts())!;
    expect(r.pin.name).toBe('IN2');
    expect(r.pin.number).toBe('2');
  });

  it('follows label_delta rather than always adding one', () => {
    const r = repeatPin(symbolWith(PIN('')), 'pin:0:0', opts({ labelDelta: 4 }))!;
    expect(r.pin.name).toBe('IN5');
    expect(r.pin.number).toBe('5');
  });

  it('keeps the field width, so IN07 becomes IN08', () => {
    const sym = symbolWith(
      `(pin input line (at 0 0 0) (length 2.54)
         (name "IN07" (effects (font (size 1.27 1.27))))
         (number "07" (effects (font (size 1.27 1.27)))))`,
    );
    const r = repeatPin(sym, 'pin:0:0', opts())!;
    expect(r.pin.name).toBe('IN08');
    expect(r.pin.number).toBe('08');
  });

  it('leaves a digitless name alone rather than failing', () => {
    // `IncrementString` returns true with the string untouched when there are
    // no digits, so the repeat still happens.
    const sym = symbolWith(
      `(pin input line (at 0 0 0) (length 2.54)
         (name "VCC" (effects (font (size 1.27 1.27))))
         (number "A" (effects (font (size 1.27 1.27)))))`,
    );
    const r = repeatPin(sym, 'pin:0:0', opts())!;
    expect(r).not.toBeNull();
    expect(r.pin.name).toBe('VCC');
    expect(r.pin.number).toBe('A');
    // ...and it still MOVED, which is what makes it a repeat and not a no-op.
    expect(r.pin.at.y).toBe(allPins(sym)[0]!.at.y + schIUScale.milsToIU(100));
  });

  it('will not step below zero, leaving the field as it was', () => {
    const sym = symbolWith(PIN(''));
    const r = repeatPin(sym, 'pin:0:0', opts({ labelDelta: -50 }))!;
    // "IN1" with -50 would be IN-49; upstream's IncrementString returns false
    // and leaves `name` untouched.
    expect(r.pin.name).toBe('IN1');
    expect(r.pin.number).toBe('1');
  });
});

describe('what the repeat produces', () => {
  it('adds exactly one pin, and returns its id', () => {
    const sym = symbolWith(PIN(''));
    const r = repeatPin(sym, 'pin:0:0', opts())!;
    expect(allPins(r.sym).length).toBe(allPins(sym).length + 1);
    expect(r.id).toBe('pin:0:1');
  });

  it('gives the duplicate no source bytes of its own', () => {
    // `source` is the pin's own parsed s-expression, which the writer prefers
    // over re-serialising. A duplicate that keeps the ORIGINAL's list emits the
    // source pin's tokens for both, so the repeat vanishes on save — the step
    // and the incremented name are in the object and never reach the file.
    //
    // Comparing against a second parse would be trivially true (two objects),
    // so this asserts the shape: the source pin's list has items, the
    // duplicate's is EMPTY_SOURCE.
    const sym = symbolWith(PIN(''));
    const src = allPins(sym)[0]!;
    expect(src.source.items.length, 'fixture must have parsed tokens').toBeGreaterThan(0);
    const r = repeatPin(sym, 'pin:0:0', opts())!;
    expect(r.pin.source.items.length).toBe(0);
  });

  it('is null when the source pin is gone, which is a reload or a delete', () => {
    // `for( SCH_PIN* test : symbol->GetPins() ) if( test->m_Uuid == g_lastPin )`
    // simply finds nothing, and `RepeatDrawItem` returns 0.
    expect(repeatPin(symbolWith(PIN('')), 'pin:0:9', opts())).toBeNull();
  });

  it('fills the other units when synchronized pins is on', () => {
    // `if( m_frame->SynchronizePins() ) CreateImagePins( aCommit, aPin )`.
    const sym = symbolWith(PIN(''), 2);
    const off = repeatPin(sym, 'pin:0:0', opts({ synchronize: false }))!;
    const on = repeatPin(sym, 'pin:0:0', opts({ synchronize: true }))!;
    expect(allPins(on.sym).length).toBeGreaterThan(allPins(off.sym).length);
  });
});
