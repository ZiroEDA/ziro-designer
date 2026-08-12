// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_SHEET::AutoplaceFields` (sch_sheet.cpp:897).
 *
 * The sheet name sits above the box and the filename below it, both against the
 * left edge, clear of the border by a fraction of a text height:
 *
 *     int borderMargin = KiROUND( GetPenWidth() / 2.0 ) + 4;
 *     int margin = borderMargin + KiROUND( std::max( textSize.x, textSize.y ) * 0.5 );
 *     …
 *     sheetNameField->SetTextPos( m_pos + VECTOR2I( 0, -margin ) );
 *     sheetFilenameField->SetTextPos( m_pos + VECTOR2I( 0, m_size.y + margin ) );
 *
 * with 0.5 of the text size for the name and 0.4 for the filename. A sheet
 * whose pins are all on its top and bottom edges is "vertically oriented" and
 * the two fields stand on end beside it instead.
 *
 * This exists because the context menu offers Autoplace Fields for a sheet —
 * `autoplaceCondition` is `FieldOwners`, which is symbols, sheets and labels —
 * and until now the engine only knew how to place a symbol's.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { autoplaceSheetFields, readSchematic, type SchField } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/** 6 mils, KiCad's DEFAULT_LINE_WIDTH_MILS, in schematic IU. */
const PEN = mmToIU(0.1524);
const AT = { x: mmToIU(20), y: mmToIU(30) };
const SIZE = { w: mmToIU(30), h: mmToIU(20) };
const TEXT = mmToIU(1.27);

/** A sheet with both fields dumped somewhere useless, plus the given pins. */
const sheet = (pins: string) =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 20 30) (size 30 20) (uuid "sh1")
        (stroke (width 0) (type solid))
        (property "Sheetname" "sub" (at 99 99 0) (effects (font (size 1.27 1.27))))
        (property "Sheetfile" "sub.kicad_sch" (at 99 99 0) (effects (font (size 1.27 1.27))))
        ${pins}))`),
  );

const HORIZ = '(pin "IN" input (at 20 35 180) (uuid "p1") (effects (font (size 1.27 1.27))))';
const VERT = '(pin "IN" input (at 25 30 90) (uuid "p1") (effects (font (size 1.27 1.27))))';

const run = (doc: ReturnType<typeof sheet>) =>
  autoplaceSheetFields(doc, new Set(['sh1']), PEN)!.apply(doc).sheets[0]!;

const field = (fields: readonly SchField[], key: string): SchField =>
  fields.find((f) => f.key === key)!;

// borderMargin = round(pen / 2) + 4; the margin adds a fraction of the text size.
const borderMargin = Math.round(PEN / 2) + 4;
const nameMargin = borderMargin + Math.round(TEXT * 0.5);
const fileMargin = borderMargin + Math.round(TEXT * 0.4);

describe('autoplacing a sheet’s fields', () => {
  it('puts the name above the box and the file below it', () => {
    const after = run(sheet(HORIZ));

    expect(field(after.fields, 'Sheetname').at).toEqual({ x: AT.x, y: AT.y - nameMargin });
    expect(field(after.fields, 'Sheetfile').at).toEqual({
      x: AT.x,
      y: AT.y + SIZE.h + fileMargin,
    });
  });

  it('justifies the name off its bottom and the file off its top', () => {
    const after = run(sheet(HORIZ));

    expect(field(after.fields, 'Sheetname').effects?.justify).toEqual(['left', 'bottom']);
    expect(field(after.fields, 'Sheetfile').effects?.justify).toEqual(['left', 'top']);
  });

  it('leaves both horizontal on an ordinary sheet', () => {
    const after = run(sheet(HORIZ));
    expect(field(after.fields, 'Sheetname').angle).toBe(0);
    expect(field(after.fields, 'Sheetfile').angle).toBe(0);
  });

  it('stands them on end when every pin is on the top or bottom edge', () => {
    // `IsVerticalOrientation`: topBottom > 0 && leftRight == 0.
    const after = run(sheet(VERT));

    expect(field(after.fields, 'Sheetname').angle).toBe(90);
    expect(field(after.fields, 'Sheetname').at).toEqual({
      x: AT.x - nameMargin,
      y: AT.y + SIZE.h,
    });
    expect(field(after.fields, 'Sheetfile').at).toEqual({
      x: AT.x + SIZE.w + fileMargin,
      y: AT.y + SIZE.h,
    });
  });

  it('is horizontal again as soon as one pin is on a side edge', () => {
    // `leftRight == 0` is the test, so a single side pin settles it.
    const after = run(
      sheet(`${VERT} (pin "OUT" output (at 20 35 180) (uuid "p2")
      (effects (font (size 1.27 1.27))))`),
    );
    expect(field(after.fields, 'Sheetname').angle).toBe(0);
  });

  it('is horizontal on a sheet with no pins at all', () => {
    // topBottom > 0 fails, so an empty sheet is not "vertical".
    const after = run(sheet(''));
    expect(field(after.fields, 'Sheetname').angle).toBe(0);
  });

  it('rewrites the field’s source so the move survives a save', () => {
    // A field carries the node it was read from; leaving it behind writes the
    // old position back out and the autoplace lasts until the next reload.
    const before = sheet(HORIZ);
    const after = run(before);
    expect(field(after.fields, 'Sheetname').source).not.toBe(
      field(before.sheets[0]!.fields, 'Sheetname').source,
    );
  });

  it('undoes to exactly where the fields were', () => {
    const doc = sheet(HORIZ);
    const cmd = autoplaceSheetFields(doc, new Set(['sh1']), PEN)!;
    const back = cmd.invert(doc).apply(cmd.apply(doc));
    expect(back.sheets[0]!.fields).toEqual(doc.sheets[0]!.fields);
  });

  it('does nothing when no sheet is selected', () => {
    expect(autoplaceSheetFields(sheet(HORIZ), new Set(['something-else']), PEN)).toBeNull();
  });
});
