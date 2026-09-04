// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a new sheet's Sheetname and Sheetfile text sits.
 *
 * `SCH_SHEET::AutoplaceFields` anchors both on the sheet's *left edge* and
 * left-justifies them — the name bottom-aligned above the top edge, the file
 * top-aligned below the bottom one:
 *
 *     int borderMargin = KiROUND( GetPenWidth() / 2.0 ) + 4;
 *     int margin = borderMargin + KiROUND( std::max( textSize.x, textSize.y ) * 0.5 );
 *     sheetNameField->SetTextPos( m_pos + VECTOR2I( 0, -margin ) );
 *     sheetNameField->SetHorizJustify( GR_TEXT_H_ALIGN_LEFT );
 *     sheetNameField->SetVertJustify( GR_TEXT_V_ALIGN_BOTTOM );
 *     ...
 *     margin = borderMargin + KiROUND( std::max( textSize.x, textSize.y ) * 0.4 );
 *     sheetFilenameField->SetTextPos( m_pos + VECTOR2I( 0, m_size.y + margin ) );
 *     sheetFilenameField->SetHorizJustify( GR_TEXT_H_ALIGN_LEFT );
 *     sheetFilenameField->SetVertJustify( GR_TEXT_V_ALIGN_TOP );
 *
 * Ours wrote no justification at all. With none, text is centred, so the middle
 * of each string sat on the sheet's corner instead of its left end starting
 * there — the text ran out to the left of the box.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { makeSheet } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const AT = { x: mmToIU(100), y: mmToIU(50) };
const SIZE = { w: mmToIU(40), h: mmToIU(30) };
const sheet = () => makeSheet(AT, SIZE, 'Child', 'child.kicad_sch');
const field = (key: string) => {
  const f = sheet().fields.find((x) => x.key === key)!;
  // Every field this factory builds carries a position; the model type leaves
  // `at` optional for parsed fields that omit it.
  return { ...f, at: f.at! };
};

describe('a new sheet places its two mandatory fields', () => {
  it('both left-justified, on the sheet’s left edge', () => {
    // The bug: with no justify token the renderer centres, so the text's middle
    // landed on the corner.
    for (const key of ['Sheetname', 'Sheetfile']) {
      const f = field(key);
      expect(f.effects?.justify, key).toContain('left');
      expect(f.at.x, key).toBe(AT.x);
    }
  });

  it('the name above the top edge, bottom-aligned', () => {
    const f = field('Sheetname');
    expect(f.effects?.justify).toContain('bottom');
    expect(f.at.y).toBeLessThan(AT.y);
  });

  it('the file below the bottom edge, top-aligned', () => {
    const f = field('Sheetfile');
    expect(f.effects?.justify).toContain('top');
    expect(f.at.y).toBeGreaterThan(AT.y + SIZE.h);
  });

  it('at the margins AutoplaceFields computes, not a flat guess', () => {
    // borderMargin = round(penWidth / 2) + 4, with the 0.1524 mm border this
    // factory writes; then the text size times 0.5 for the name and 0.4 for the
    // file. The two are deliberately different.
    const borderMargin = Math.round(mmToIU(0.1524) / 2) + 4;
    const text = mmToIU(1.27);
    expect(AT.y - field('Sheetname').at.y).toBe(borderMargin + Math.round(text * 0.5));
    expect(field('Sheetfile').at.y - (AT.y + SIZE.h)).toBe(borderMargin + Math.round(text * 0.4));
  });

  /**
   * `GetPenWidth()` is the sheet's OWN border, not the 6-mil default:
   *
   *     if( GetBorderWidth() > 0 ) return GetBorderWidth();
   *
   * and "Defaults for New Objects" sets that border from the project's default
   * line thickness. The margin took the 6-mil default as read, so every sheet
   * drawn in a project with a thicker default had its fields half a border
   * width too close to the box.
   */
  it('widens with the sheet’s own border, which the default thickness sets', () => {
    const thick = makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 20 });
    const at = (key: string) => thick.fields.find((f) => f.key === key)!.at!;
    const text = mmToIU(1.27);
    const borderMargin = Math.round(mmToIU(20 * 0.0254) / 2) + 4;
    expect(AT.y - at('Sheetname').y).toBe(borderMargin + Math.round(text * 0.5));
    expect(at('Sheetfile').y - (AT.y + SIZE.h)).toBe(borderMargin + Math.round(text * 0.4));
    // ...and that really is a different answer from the 6-mil one.
    expect(at('Sheetname').y).not.toBe(field('Sheetname').at.y);
  });
});

describe('and the justification is written to the file', () => {
  const round = (): Schematic => {
    const doc = readSchematic(parse('(kicad_sch (version 20250114) (lib_symbols))'));
    const next: Schematic = { ...doc, sheets: [sheet()] };
    return readSchematic(parse(serializeSchematic(next)));
  };

  it('so it survives a save and reload', () => {
    const sh = round().sheets[0]!;
    const name = sh.fields.find((f) => f.key === 'Sheetname')!;
    const file = sh.fields.find((f) => f.key === 'Sheetfile')!;
    expect(name.effects?.justify).toEqual(expect.arrayContaining(['left', 'bottom']));
    expect(file.effects?.justify).toEqual(expect.arrayContaining(['left', 'top']));
  });

  it('and the text is emitted with a justify token at all', () => {
    const doc = readSchematic(parse('(kicad_sch (version 20250114) (lib_symbols))'));
    const text = serializeSchematic({ ...doc, sheets: [sheet()] } as Schematic);
    expect(text).toContain('(justify left bottom)');
    expect(text).toContain('(justify left top)');
  });
});
