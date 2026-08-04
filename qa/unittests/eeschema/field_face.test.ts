// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A symbol field's box asks the shared measurement entry point, so a field
 * carrying `(font (face …))` is measured by whatever will draw it (#154).
 *
 * The measurer used to be injected, and every caller passed the stroke font —
 * so the face could not reach the measurement even in principle.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { symbolFieldBoxes } from '@ziroeda/eeschema/src/fieldbox.js';
import { setFontProvider } from '@ziroeda/common/src/font/font_provider.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const src = (face: string): string => `(kicad_sch (version 20250114) (paper "A4")
  (lib_symbols
    (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
        (stroke (width 0) (type default)) (fill (type none))))))
  (symbol (lib_id "L:R") (at 10 50 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
    (property "Reference" "R1" (at 12 48 0)
      (effects (font ${face} (size 1.27 1.27))))))`;

const boxes = (d: Schematic) => symbolFieldBoxes(d.symbols[0]!, d.libSymbols[0]!);

afterEach(() => setFontProvider(null));

describe('a field with a face', () => {
  it('is measured by the provider', () => {
    const d = readSchematic(parse(src('(face "Arial")')));
    let asked: string | undefined;
    setFontProvider({
      measure: (_t, _s, style) => {
        asked = style.face;
        return 500000;
      },
    });
    const w = boxes(d)[0]!.box.w;
    expect(asked).toBe('Arial');
    expect(w).toBeGreaterThan(400000);
  });

  it('is measured by the stroke font when it has no face', () => {
    const d = readSchematic(parse(src('')));
    let asked = false;
    setFontProvider({
      measure: () => {
        asked = true;
        return 500000;
      },
    });
    boxes(d);
    expect(asked).toBe(false);
  });

  it('is unchanged with no provider, face or not', () => {
    // The state every build ships in today.
    const faced = readSchematic(parse(src('(face "Arial")')));
    const plain = readSchematic(parse(src('')));
    expect(boxes(faced)[0]!.box.w).toBe(boxes(plain)[0]!.box.w);
  });
});
