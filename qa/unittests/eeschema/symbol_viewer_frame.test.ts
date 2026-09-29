// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SYMBOL_VIEWER_FRAME::ReCreateLibList` / `ReCreateSymbolList`
 * (eeschema/symbol_viewer_frame.cpp), as `symbol_viewer_frame.ts` ports them.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import type { LibIndexEntry } from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import {
  filterLibraries,
  filterSymbols,
  filterTerms,
  hasDeMorgan,
  symbolName,
  unitCount,
} from '@ziroeda/eeschema/symbol_viewer_frame.js';

const pin = (n: string, x: number): string =>
  `(pin passive line (at ${x} 0 0) (length 2.54) (name "~" (effects (font (size 1.27 1.27)))) (number "${n}" (effects (font (size 1.27 1.27)))))`;

const LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "R"
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "ki_keywords" "resistor res" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "R_1_1" ${pin('1', 0)} ${pin('2', 5)})
  )
  (symbol "Q"
    (property "Reference" "Q" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Q" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "ki_keywords" "transistor" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "Q_1_1" ${pin('1', 0)} ${pin('2', 5)} ${pin('3', 10)})
    (symbol "Q_2_1" ${pin('4', 0)})
    (symbol "Q_1_2" ${pin('1', 0)})
  )
)`;

const [R, Q] = readSymbolLib(parse(LIB));

const idx = (...names: string[]): LibIndexEntry[] =>
  names.map((name) => ({ name }) as unknown as LibIndexEntry);

describe('ReCreateSymbolList', () => {
  it('an empty filter lists every symbol', () => {
    expect(filterSymbols([R!, Q!], '').map(symbolName)).toEqual(['R', 'Q']);
  });

  it('a term that scores nothing against a symbol excludes it', () => {
    expect(filterSymbols([R!, Q!], 'resistor').map(symbolName)).toEqual(['R']);
    expect(filterSymbols([R!, Q!], 'transistor').map(symbolName)).toEqual(['Q']);
  });

  it('a numeric term also matches the pin count', () => {
    // Q has 3 + 1 pins on body style 1 (its _1_2 pin is DeMorgan, not counted).
    expect(filterSymbols([R!, Q!], '4').map(symbolName)).toEqual(['Q']);
    expect(filterSymbols([R!, Q!], '2').map(symbolName)).toEqual(['R']);
  });

  it('every term must match: one miss excludes', () => {
    expect(filterSymbols([R!, Q!], 'resistor transistor')).toEqual([]);
  });
});

describe('ReCreateLibList', () => {
  const index = idx('Device', 'Connector', 'Diode');

  it('pinned libraries come first, the rest in adapter order', () => {
    expect(filterLibraries(index, '', ['Diode']).map((l) => l.name)).toEqual([
      'Diode',
      'Device',
      'Connector',
    ]);
  });

  it('a library any term matches is listed, once', () => {
    expect(filterLibraries(index, 'dev con', []).map((l) => l.name)).toEqual([
      'Device',
      'Connector',
    ]);
    expect(filterLibraries(index, 'di', []).map((l) => l.name)).toEqual(['Diode']);
  });

  it('a library two terms both match is listed once (ours; upstream appends it twice)', () => {
    // `process( lib )` runs per matching term with no de-duplication
    // (symbol_viewer_frame.cpp ReCreateLibList); the move kept this port's
    // `seen` set, so the list shows each library once.
    expect(filterLibraries(index, 'dev devi', []).map((l) => l.name)).toEqual(['Device']);
  });
});

describe('the unit and body-style selectors', () => {
  it('unit count is the highest unit, DeMorgan is a body style 2', () => {
    expect(unitCount(Q!)).toBe(2);
    expect(unitCount(R!)).toBe(1);
    expect(hasDeMorgan(Q!)).toBe(true);
    expect(hasDeMorgan(R!)).toBe(false);
  });

  it('terms split on wxTOKEN_STRTOK whitespace', () => {
    expect(filterTerms(' a\tb \r\nc ')).toEqual(['a', 'b', 'c']);
  });
});
