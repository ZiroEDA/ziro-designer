// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `qa/tests/common/test_markup_parser.cpp`, transcribed. */
import { describe, expect, it } from 'vitest';
import { MARKUP_PARSER, type NODE } from '@ziroeda/common/markup_parser.js';
import { STROKE_FONT } from '@ziroeda/common/font/stroke_font.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';

function nodeToString(aNode: NODE, aStringToPopulate: { value: string }): void {
  aStringToPopulate.value += ' {';

  if (aNode.isOverbar()) aStringToPopulate.value += 'OVER';
  if (aNode.isSubscript()) aStringToPopulate.value += 'SUB';
  if (aNode.isSuperscript()) aStringToPopulate.value += 'SUP';

  if (aNode.has_content()) aStringToPopulate.value += `'${aNode.string()}'`;

  for (const c of aNode.children) nodeToString(c, aStringToPopulate);

  aStringToPopulate.value += '} ';
}

describe('MarkupParser', () => {
  /**
   * Test the #Parse method.
   */
  it('Parse', () => {
    const cases: [string, string][] = [
      ['A normal string', " { {'A normal string'} } "],
      ['_{A subscript String}', " { {SUB {'A subscript String'} } } "],
      ['^{A superscript String}', " { {SUP {'A superscript String'} } } "],
      ['~{An overbar String}', " { {OVER {'An overbar String'} } } "],
      ['~{An incomplete markup', " { {'~{An incomplete markup'} } "],
      ['A string ~{overbar}', " { {'A string '}  {OVER {'overbar'} } } "],
      ['A string ~{incomplete markup', " { {'A string ~{incomplete markup'} } "],
      [
        'A string ~{overbar} ~{incomplete markup',
        " { {'A string '}  {OVER {'overbar'} }  {' ~{incomplete markup'} } ",
      ],
      [
        'A string ~{incomplete markup ~{overbar}',
        " { {'A string ~{incomplete markup '}  {OVER {'overbar'} } } ",
      ],
    ];

    for (const [Input, ExpectedResult] of cases) {
      const parser = new MARKUP_PARSER(Input);

      const rootNode = parser.Parse();
      expect(rootNode, Input).not.toBeNull();

      const result = { value: '' };
      nodeToString(rootNode!, result);

      expect(result.value, Input).toBe(ExpectedResult);
    }
  });

  /**
   * Verify that LinebreakText preserves multiple spaces inside overbar markup and that
   * the overbar word receives a nonzero width so line-wrapping accounts for it.
   *
   * Regression test for https://gitlab.com/kicad/code/kicad/-/issues/22913
   */
  it('OverbarMultipleSpacesWidth', () => {
    const font = STROKE_FONT.LoadFont('');

    expect(font).not.toBeNull();

    const glyphSize = { x: 1000, y: 1000 };

    // Measure the width of a single space for reference
    const spaceWidth = font!.GetTextAsGlyphs(
      null,
      null,
      ' ',
      glyphSize,
      { x: 0, y: 0 },
      ANGLE_0,
      false,
      { x: 0, y: 0 },
      0,
    ).x;

    expect(spaceWidth).toBeGreaterThan(0);

    // Measure the width of 5 spaces
    const fiveSpaceWidth = font!.GetTextAsGlyphs(
      null,
      null,
      '     ',
      glyphSize,
      { x: 0, y: 0 },
      ANGLE_0,
      false,
      { x: 0, y: 0 },
      0,
    ).x;

    expect(fiveSpaceWidth).toBeGreaterThan(spaceWidth);

    // Verify that LinebreakText preserves overbar with multiple spaces
    const wideColumn = 100000;

    const cases: [string, string][] = [
      ['~{     }', '~{     }'],
      ['A ~{     }', 'A ~{     }'],
      ['A ~{  B  }', 'A ~{  B  }'],
      ['~{     } end', '~{     } end'],
      ['/~{     }', '/~{     }'],
      ['_{     }', '_{     }'],
      ['^{     }', '^{     }'],
    ];

    for (const [Input, Expected] of cases) {
      const text = { value: Input };
      font!.LinebreakText(text, wideColumn, glyphSize, 0, false, false);
      expect(text.value, Input).toBe(Expected);
    }
  });
});
