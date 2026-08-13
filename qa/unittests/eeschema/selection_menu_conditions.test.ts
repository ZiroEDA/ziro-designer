// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two conditions that decide whether a context-menu entry is there at all.
 *
 * Both were missing here, so a hierarchical sheet's menu offered Select/Expand
 * Connection and Copy as Text — neither of which KiCad shows for a sheet, and
 * neither of which has anything to act on.
 *
 *   expandableSelection = MoreThan( 0 ) && HasTypes( expandConnectionGraphTypes )
 *   canCopyText         = OnlyTypes( { SCH_TEXT_T, SCH_TEXTBOX_T, … } )
 *
 * The Has/Only distinction is the whole of it: one item of the right kind is
 * enough to expand a connection, while Copy as Text needs *every* selected item
 * to carry text.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, selectionCanCopyAsText, selectionIsExpandable } from '@ziroeda/eeschema';

const SHEET = `(kicad_sch (version 20250114) (generator "eeschema")
  (uuid "0f1e2d3c-0000-0000-0000-000000000000")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "Device:R") (at 100 100 0) (unit 1) (uuid "sym-1")
    (property "Reference" "R1" (at 100 95 0) (effects (font (size 1.27 1.27)))))
  (wire (pts (xy 60 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "wire-1"))
  (label "NET" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "label-1"))
  (text "a note" (at 40 40 0) (effects (font (size 1.27 1.27))) (uuid "text-1"))
  (sheet (at 20 20) (size 30 20) (uuid "sheet-1")
    (property "Sheetname" "sub" (at 20 19 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 20 51 0) (effects (font (size 1.27 1.27))))
    (pin "IN" input (at 20 25 180) (uuid "sheetpin-1")
      (effects (font (size 1.27 1.27)))))
  (sheet_instances (path "/" (page "1"))))
`;

const doc = readSchematic(parse(SHEET));
const ids = (...list: string[]): Set<string> => new Set(list);
const SYMBOL = 'sym-1';
const WIRE = 'wire-1';
const LABEL = 'label-1';
const SHEET_ID = 'sheet-1';
const FIELD = `${SYMBOL}:field0`;

describe('expandableSelection', () => {
  it('is false for a hierarchical sheet — the reported bug', () => {
    // A sheet is genuinely connected to things, through its pins; it is still
    // not in `expandConnectionGraphTypes`, so the entry is absent.
    expect(selectionIsExpandable(doc, ids(SHEET_ID))).toBe(false);
  });

  it('is true for a wire, a symbol and a label', () => {
    expect(selectionIsExpandable(doc, ids(WIRE))).toBe(true);
    expect(selectionIsExpandable(doc, ids(SYMBOL))).toBe(true);
    expect(selectionIsExpandable(doc, ids(LABEL))).toBe(true);
  });

  it('is true when only one of several items qualifies (HasTypes)', () => {
    expect(selectionIsExpandable(doc, ids(SHEET_ID, WIRE))).toBe(true);
  });

  it('is false for an empty selection', () => {
    expect(selectionIsExpandable(doc, ids())).toBe(false);
  });

  it('is false for an id that resolves to nothing', () => {
    expect(selectionIsExpandable(doc, ids('no-such-item'))).toBe(false);
  });
});

describe('canCopyText', () => {
  it('is false for a sheet', () => {
    expect(selectionCanCopyAsText(doc, ids(SHEET_ID))).toBe(false);
  });

  it('is false for a symbol, which carries no text of its own', () => {
    // Its *fields* do, and a field on its own passes; the symbol does not.
    expect(selectionCanCopyAsText(doc, ids(SYMBOL))).toBe(false);
    expect(selectionCanCopyAsText(doc, ids(FIELD))).toBe(true);
  });

  it('is true for labels and sheet pins', () => {
    expect(selectionCanCopyAsText(doc, ids(LABEL))).toBe(true);
    expect(selectionCanCopyAsText(doc, ids(`${SHEET_ID}:sheetpin0`))).toBe(true);
  });

  it('needs every item to qualify (OnlyTypes)', () => {
    // One symbol in the selection removes it, unlike the Has test above.
    expect(selectionCanCopyAsText(doc, ids(LABEL, SYMBOL))).toBe(false);
    expect(selectionCanCopyAsText(doc, ids(LABEL, FIELD))).toBe(true);
  });

  it('is false for an empty selection', () => {
    expect(selectionCanCopyAsText(doc, ids())).toBe(false);
  });
});
