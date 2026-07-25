/**
 * LIB_SYMBOL::Compare under ERC's flags (EQUALITY | ERC): what makes a cached
 * schematic symbol count as "doesn't match copy in library".
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSymbolLib } from '@ziroeda/eeschema';
import { compareLibSymbolsForErc } from '@ziroeda/eeschema/src/lib_symbol_compare.js';

const symbol = (body: string) =>
  readSymbolLib(
    parse(`(kicad_symbol_lib (version 20231120) (generator test)
      (symbol "R" (pin_names (offset 1.016)) ${body}))`),
  )[0]!;

const BASE = `
  (property "Reference" "R" (at 0 0 0))
  (property "Value" "R" (at 0 0 0))
  (property "ki_keywords" "resistor" (at 0 0 0))
  (symbol "R_0_1"
    (rectangle (start -1.016 -2.54) (end 1.016 2.54)))
  (symbol "R_1_1"
    (pin passive line (at 0 3.81 270) (length 1.27)
      (name "~" (effects (font (size 1.27 1.27))))
      (number "1" (effects (font (size 1.27 1.27)))))
    (pin passive line (at 0 -3.81 90) (length 1.27)
      (name "~" (effects (font (size 1.27 1.27))))
      (number "2" (effects (font (size 1.27 1.27))))))`;

describe('compareLibSymbolsForErc', () => {
  it('matches a symbol against an identical copy', () => {
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(BASE))).toBeNull();
  });

  it('catches a moved pin', () => {
    const moved = BASE.replace('(at 0 3.81 270)', '(at 0 5.08 270)');
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(moved))).toBe('pin');
  });

  it('catches a pin the library no longer has, and one it gained', () => {
    const renumbered = BASE.replace('(number "2"', '(number "3"');
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(renumbered))).toBe('extra pin');
    expect(compareLibSymbolsForErc(symbol(renumbered), symbol(BASE))).toBe('extra pin');
  });

  it('catches changed body geometry', () => {
    const wider = BASE.replace('(end 1.016 2.54)', '(end 2.032 2.54)');
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(wider))).toBe('graphic item');
    const extra = `${BASE}
      (symbol "R_0_2" (circle (center 0 0) (radius 1)))`;
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(extra))).toBe('graphic item count');
  });

  it('catches field text, keywords and the pin name offset', () => {
    const value = BASE.replace('(property "Value" "R"', '(property "Value" "R_US"');
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(value))).toBe('field');

    const keywords = BASE.replace('"resistor"', '"res"');
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(keywords))).toBe('field');

    const offset = readSymbolLib(
      parse(`(kicad_symbol_lib (version 20231120) (generator test)
        (symbol "R" (pin_names (offset 0.254)) ${BASE}))`),
    )[0]!;
    expect(compareLibSymbolsForErc(symbol(BASE), offset)).toBe('pin name offset');
  });

  it('ignores a field position: ERC compares field text, not placement', () => {
    const movedField = BASE.replace(
      '(property "Value" "R" (at 0 0 0))',
      '(property "Value" "R" (at 2 2 0))',
    );
    expect(compareLibSymbolsForErc(symbol(BASE), symbol(movedField))).toBeNull();
  });
});
