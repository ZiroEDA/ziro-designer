// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The symbol editor's hit test measures through the shared entry point (#154),
 * so what you can click on a library field will match what is drawn once an
 * outline face is drawable.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { hitTestSymbol } from '@ziroeda/designer/src/editors/symbol/edits.js';
import { setFontProvider } from '@ziroeda/common/src/font/font_provider.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';

const lib = (face: string): LibSymbol =>
  readSymbolLib(
    parse(`(kicad_symbol_lib (version 20241209) (generator "test")
      (symbol "R" (pin_numbers (hide yes)) (pin_names (offset 0))
        (property "Reference" "R" (at 0 0 0)
          (effects (font ${face} (size 1.27 1.27)) (justify left)))
        (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
          (stroke (width 0) (type default)) (fill (type none))))))`),
  )[0]!;

/** Well to the right of where the stroke font puts the end of "R". */
const FAR_RIGHT = { x: 200000, y: 0 };
const hit = (s: LibSymbol) => hitTestSymbol(s, 1, 1, FAR_RIGHT, 0, false, true);

afterEach(() => setFontProvider(null));

describe('a library field with a face', () => {
  it('is not clickable out there with no provider', () => {
    // The state every build ships in: the stroke font decides, as always.
    expect(hit(lib('(face "Arial")'))).toBeNull();
  });

  it('becomes clickable out there when a provider measures it wider', () => {
    // The face reaches the measurement: a provider that says the text is very
    // wide moves the field's hit box with it.
    setFontProvider({ measure: (_t, _s, style) => (style.face ? 400000 : null) });
    expect(hit(lib('(face "Arial")'))?.kind).toBe('field');
  });

  it('is unaffected when it has no face', () => {
    // No face means the provider is never asked, so a faceless field keeps the
    // stroke font's box however wide the provider would have claimed.
    setFontProvider({ measure: () => 400000 });
    expect(hit(lib(''))).toBeNull();
  });
});
