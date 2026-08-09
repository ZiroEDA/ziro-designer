// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A sheet's background colour has to survive being written out.
 *
 * `saveSheet` prints the fill for every sheet, unconditionally:
 *
 *     m_out->Print( "(fill (color %d %d %d %s))",
 *                   KiROUND( aSheet->GetBackgroundColor().r * 255.0 ), ... );
 *
 * Ours patched the node only when the source already had one, so a background
 * colour set on a sheet whose file carried no `(fill …)` was written nowhere.
 * That is invisible until you notice *when* it bites: autosave serializes the
 * project 900 ms after every edit and the project is re-read from that text, so
 * setting the colour in Sheet Properties worked, and then undid itself a second
 * later — the sheet went back to transparent and the dialog reopened blank.
 *
 * The same silent drop applies to any child a writer patches but will not
 * create, so the stroke is checked here too.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import type { Schematic, SchSheet } from '@ziroeda/eeschema/src/types.js';

const BLUE = [170, 230, 255, 1] as const;

const sheet = (extra: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 100 50) (size 40 30) ${extra} (uuid "sh1")
        (property "Sheetname" "S" (at 100 49 0))
        (property "Sheetfile" "s.kicad_sch" (at 100 81 0))))`),
  );

/** The document as autosave would hand it back: serialized, then re-read. */
const roundTrip = (doc: Schematic, patch: Partial<SchSheet>): SchSheet => {
  const next: Schematic = { ...doc, sheets: [{ ...doc.sheets[0]!, ...patch }] };
  return readSchematic(parse(serializeSchematic(next))).sheets[0]!;
};

describe('a background colour set in Sheet Properties', () => {
  it('round-trips through a sheet whose file already had a fill', () => {
    const doc = sheet('(fill (color 0 0 0 0.0000))');
    expect(roundTrip(doc, { fillColor: BLUE }).fillColor).toEqual([...BLUE]);
  });

  it('round-trips through a sheet whose file had no fill at all', () => {
    const doc = sheet('');
    expect(doc.sheets[0]!.fillColor).toBeUndefined();
    expect(roundTrip(doc, { fillColor: BLUE }).fillColor).toEqual([...BLUE]);
  });

  it('round-trips through a fill node that carried no colour', () => {
    const doc = sheet('(fill (type none))');
    expect(roundTrip(doc, { fillColor: BLUE }).fillColor).toEqual([...BLUE]);
  });

  it('is written before the uuid, where saveSheet prints it', () => {
    const text = serializeSchematic({
      ...sheet(''),
      sheets: [{ ...sheet('').sheets[0]!, fillColor: BLUE }],
    } as Schematic);
    expect(text.indexOf('(fill')).toBeLessThan(text.indexOf('(uuid "sh1")'));
  });

  it('and clearing it back writes the (0 0 0 0) KiCad uses for unset', () => {
    const doc = sheet('(fill (color 170 230 255 1))');
    expect(doc.sheets[0]!.fillColor).toEqual([...BLUE]);
    const { fillColor: _drop, ...bare } = doc.sheets[0]!;
    const back = readSchematic(parse(serializeSchematic({ ...doc, sheets: [bare as SchSheet] })))
      .sheets[0]!;
    expect(back.fillColor).toBeUndefined();
  });

  it('leaves a sheet that never had a colour with the unset fill', () => {
    // Every other sheet in the file must keep serializing as KiCad writes it.
    const text = serializeSchematic(sheet(''));
    expect(text).toContain('(color 0 0 0 0)');
  });
});

describe('a border set on a sheet whose stroke was partial', () => {
  it('gains the width and type children rather than dropping the edit', () => {
    const doc = sheet('(stroke (color 1 2 3 1))');
    const back = roundTrip(doc, { stroke: { width: 254000, type: 'dash', color: [9, 8, 7, 1] } });
    expect(back.stroke?.width).toBe(254000);
    expect(back.stroke?.type).toBe('dash');
    expect(back.stroke?.color).toEqual([9, 8, 7, 1]);
  });
});
