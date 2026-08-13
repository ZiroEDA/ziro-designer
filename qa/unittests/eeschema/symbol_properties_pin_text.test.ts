// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Show pin numbers" / "Show pin names" from the Symbol Properties dialog.
 *
 * `DIALOG_SYMBOL_PROPERTIES` reads them off the library symbol
 *
 *   m_ShowPinNumButt->SetValue( m_part->GetShowPinNumbers() );
 *
 * and writes them back through the placement
 *
 *   m_symbol->SetShowPinNames( m_ShowPinNameButt->GetValue() );
 *
 * which SCH_SYMBOL forwards to the LIB_SYMBOL it owns a copy of. So they belong
 * to the sheet's cached definition, not to the placement — and only to the
 * definition that placement uses, or hiding one symbol's pin numbers would
 * change every other use of the same part on the sheet.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { editSymbolProperties, readSchematic, refId, type SymbolEdit } from '@ziroeda/eeschema';

const SHEET = `(kicad_sch (version 20250114) (generator "eeschema")
  (uuid "0f1e2d3c-0000-0000-0000-000000000000")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))))
    (symbol "Device:C"
      (property "Reference" "C" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "C_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "Device:R") (at 100 100 0) (unit 1)
    (uuid "11111111-2222-3333-4444-555555555555")
    (property "Reference" "R1" (at 100 95 0) (effects (font (size 1.27 1.27)))))
  (symbol (lib_id "Device:C") (at 150 100 0) (unit 1)
    (uuid "99999999-8888-7777-6666-555555555555")
    (property "Reference" "C1" (at 150 95 0) (effects (font (size 1.27 1.27)))))
  (sheet_instances (path "/" (page "1"))))
`;

const baseEdit = (): SymbolEdit => ({
  fields: [],
  angle: 0,
  unit: 1,
  bodyStyle: 1,
  inBom: true,
  onBoard: true,
  dnp: false,
});

const doc = () => readSchematic(parse(SHEET));
/** By index: an edit rewrites the fields, so a reference is not a stable handle. */
const idAt = (d: ReturnType<typeof doc>, i: number): string =>
  refId('symbol', d.symbols[i]!.uuid, i);
const R = 0;
const def = (d: ReturnType<typeof doc>, libId: string) =>
  d.libSymbols.find((l) => l.libId === libId)!;

describe('the pin text checkboxes', () => {
  it('hides the numbers on the definition the symbol uses', () => {
    const d = doc();
    const after = editSymbolProperties(idAt(d, R), {
      ...baseEdit(),
      showPinNumbers: false,
    }).apply(d);

    expect(def(after, 'Device:R').pinNumbersHidden).toBe(true);
  });

  it('leaves every other definition alone', () => {
    // The reason this is scoped rather than a document-wide flag: two parts on
    // one sheet, and only the one being edited may change.
    const d = doc();
    const after = editSymbolProperties(idAt(d, R), {
      ...baseEdit(),
      showPinNumbers: false,
      showPinNames: false,
    }).apply(d);

    expect(def(after, 'Device:C').pinNumbersHidden).toBe(def(d, 'Device:C').pinNumbersHidden);
    expect(def(after, 'Device:C').pinNamesHidden).toBe(def(d, 'Device:C').pinNamesHidden);
  });

  it('touches nothing when the dialog did not change them', () => {
    // Opening the dialog and pressing OK must not start writing flags the file
    // never had.
    const d = doc();
    const after = editSymbolProperties(idAt(d, R), baseEdit()).apply(d);
    expect(after.libSymbols).toBe(d.libSymbols);
  });

  it('turns them back on', () => {
    const d = doc();
    const hidden = editSymbolProperties(idAt(d, R), {
      ...baseEdit(),
      showPinNames: false,
    }).apply(d);
    expect(def(hidden, 'Device:R').pinNamesHidden).toBe(true);

    const shown = editSymbolProperties(idAt(hidden, R), {
      ...baseEdit(),
      showPinNames: true,
    }).apply(hidden);
    expect(def(shown, 'Device:R').pinNamesHidden).toBe(false);
  });

  it('is undone with the rest of the edit', () => {
    const d = doc();
    const cmd = editSymbolProperties(idAt(d, R), { ...baseEdit(), showPinNumbers: false });
    const after = cmd.apply(d);
    const back = cmd.invert(d).apply(after);

    expect(def(back, 'Device:R').pinNumbersHidden).toBe(def(d, 'Device:R').pinNumbersHidden);
  });
});
