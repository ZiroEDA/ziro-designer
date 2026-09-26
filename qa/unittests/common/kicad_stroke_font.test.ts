// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `qa/tests/common/test_kicad_stroke_font.cpp`, transcribed. */
import { describe, expect, it } from 'vitest';
import { STROKE_FONT } from '@ziroeda/common/font/stroke_font.js';
import type { GLYPH_LIKE } from '@ziroeda/common/font/glyph.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';

describe('KicadStrokeFont', () => {
  /**
   * Test the tab spacing.
   */
  it('TabCheck', () => {
    const font = STROKE_FONT.LoadFont('')!;

    const cases: [string, string][] = [
      [
        'v34_STM23G491\t\tController STM32\t(column 3)',
        'v34_LPC1758\t\t\tController NXP\t\t(column 3)',
      ],
      [
        '1\td9c1892a\t\t\tMOLEX\t\t\t1053071202\t\t\t\t\t12\t\tCONNECTOR',
        'REF\tPART NUMBER\t\t\tMANUFACTURER\tMANUFACTURER PART NUMBER\tQTY\t\tCONNECTOR',
      ],
      [
        '5\tC-000208\t\t\tMCMASTER/CARR\t8054T13 BLUE\t\t\t\t3960MM\tCONNECTOR',
        'REF\tPART NUMBER\t\t\tMANUFACTURER\tMANUFACTURER PART NUMBER\tQTY\t\tCONNECTOR',
      ],
      ['0\t\t\t\tlinvA\t\t\tL', '3\t\t\t\tlloadA\t\t\tL'],
      ['6\t\t\t\tVpccA\t\t\tL', '14\t\t\t\t--\t\t\t\tL'],
    ];

    for (const [text1, text2] of cases) {
      const glyphs: GLYPH_LIKE[] = [];
      const bbox = new BOX2I();

      const output1 = font.GetTextAsGlyphs(
        bbox,
        glyphs,
        text1,
        { x: 1000, y: 1000 },
        { x: 0, y: 0 },
        ANGLE_0,
        false,
        { x: 0, y: 0 },
        0,
      );
      const output2 = font.GetTextAsGlyphs(
        bbox,
        glyphs,
        text2,
        { x: 1000, y: 1000 },
        { x: 0, y: 0 },
        ANGLE_0,
        false,
        { x: 0, y: 0 },
        0,
      );

      expect(output1.x, `Incorrect tab size for \n\t'${text1}' and\n\t'${text2}'`).toBe(output2.x);
    }
  });
});
