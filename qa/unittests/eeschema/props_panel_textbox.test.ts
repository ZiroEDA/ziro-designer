// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_TEXTBOX had ONE row — Text — against the twenty-six a real panel shows.
 *
 * Almost all of them are inherited. SCH_TEXTBOX registers only its four margins
 * and Text Size; the rest come from EDA_SHAPE (geometry, stroke, fill) and
 * EDA_TEXT (the text half), and what it does NOT show is decided by its `Mask`
 * calls: Shape and Corner Radius out of the shape side, Width, Height,
 * Thickness and Orientation out of the text side (sch_textbox.cpp). It masks
 * neither Mirrored nor Hyperlink, which is where it differs from a table cell.
 *
 * Composed from the DESC blocks plus the inheritance and the masks, with the
 * ordering rules read out of `PROPERTY_MANAGER::CLASS_DESC::rebuild` —
 * `collectGroups` puts a class's own groups before its bases', and
 * `collectPropsRecur` puts a base's properties before the derived class's
 * within a group, which is what a live capture of a table cell shows.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { schPropertiesFor } from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();

const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (text_box "hello" (at 10 20 0) (size 30 15)
        (stroke (width 0.254) (type dash))
        (fill (type none))
        (margins 1 2 3 4)
        (effects (font (size 1.27 1.27)) (justify left top))
        (uuid "tb-1")))`),
  );

const rows = (d: Schematic) =>
  schPropertiesFor(d, LIB, itemRefById(d, refId('textbox', d.textBoxes[0]!.uuid, 0))!);

describe('a text box shows the whole inherited set', () => {
  it('offers the composed list, not just Text', () => {
    expect(rows(doc()).map((r) => r.name)).toEqual([
      'Start X',
      'Start Y',
      'End X',
      'End Y',
      'Width',
      'Height',
      'Line Width',
      'Line Style',
      'Line Color',
      'Fill',
      'Fill Color',
      'Margin Left',
      'Margin Top',
      'Margin Right',
      'Margin Bottom',
      'Text',
      'Font',
      'Auto Thickness',
      'Italic',
      'Bold',
      'Mirrored',
      'Horizontal Justification',
      'Vertical Justification',
      'Color',
      'Hyperlink',
      'Text Size',
    ]);
  });

  it('groups them the way the class chain does', () => {
    const g = new Map(rows(doc()).map((r) => [r.name, r.group]));
    expect(g.get('Start X')).toBe('Shape Properties');
    expect(g.get('Fill Color')).toBe('Shape Properties');
    expect(g.get('Margin Left')).toBe('Margins');
    expect(g.get('Text')).toBe('Text Properties');
    expect(g.get('Text Size')).toBe('Text Properties');
  });

  it('shows the rows it masks nowhere', () => {
    const names = new Set(rows(doc()).map((r) => r.name));
    // Masked by SCH_TEXTBOX; `Visible` carries SetAvailableFunc( isField ).
    for (const gone of ['Shape', 'Corner Radius', 'Thickness', 'Orientation', 'Visible']) {
      expect(names.has(gone), `${gone} must not be shown on a text box`).toBe(false);
    }
  });

  it('shows Mirrored and Hyperlink, which a table CELL masks', () => {
    const names = new Set(rows(doc()).map((r) => r.name));
    expect(names.has('Mirrored')).toBe(true);
    expect(names.has('Hyperlink')).toBe(true);
  });
});

describe('the rows write to the right place', () => {
  it('Width moves the end corner rather than the start', () => {
    const d = doc();
    const before = d.textBoxes[0]!;
    const after = rows(d).find((r) => r.name === 'Width')!.set!(50000)!.apply(d);
    expect(after.textBoxes[0]!.start).toEqual(before.start);
    expect(after.textBoxes[0]!.end.x).toBe(before.start.x + 50000);
  });

  it('Line Color writes bytes into the stroke', () => {
    const d = doc();
    const after = rows(d).find((r) => r.name === 'Line Color')!.set!('#3366cc')!.apply(d);
    expect(after.textBoxes[0]!.stroke?.color?.slice(0, 3)).toEqual([0x33, 0x66, 0xcc]);
    // The style it already had is not disturbed.
    expect(after.textBoxes[0]!.stroke?.type).toBe('dash');
  });

  it('a margin writes only its own side', () => {
    const d = doc();
    const before = d.textBoxes[0]!.margins!;
    const after = rows(d).find((r) => r.name === 'Margin Top')!.set!(12345)!.apply(d);
    expect(after.textBoxes[0]!.margins!.top).toBe(12345);
    expect(after.textBoxes[0]!.margins!.left).toBe(before.left);
    expect(after.textBoxes[0]!.margins!.bottom).toBe(before.bottom);
  });

  it('Hyperlink clears to absent rather than to an empty string', () => {
    const d = doc();
    const set = rows(d).find((r) => r.name === 'Hyperlink')!.set!;
    const withLink = set('https://x')!.apply(d);
    expect(withLink.textBoxes[0]!.hyperlink).toBe('https://x');
    const cleared = rows(withLink).find((r) => r.name === 'Hyperlink')!.set!('')!.apply(withLink);
    expect(cleared.textBoxes[0]!.hyperlink).toBeUndefined();
  });

  it('Mirrored is shown but read-only, the model having nowhere to put it', () => {
    // "Whatever KiCad does" for a property we cannot back: shown, not dropped.
    expect(rows(doc()).find((r) => r.name === 'Mirrored')!.set).toBeUndefined();
  });
});
