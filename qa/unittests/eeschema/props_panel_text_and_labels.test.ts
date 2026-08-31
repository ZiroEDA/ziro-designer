// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_TEXT and the label kinds — and the row that is NOT there.
 *
 * A capture of a selected Text in 10.0.5 shows one category and ten rows:
 *
 *   Text Properties  Text, Font, Auto Thickness, Italic, Bold, Horizontal
 *                    Justification, Vertical Justification, Color, Hyperlink,
 *                    Text Size
 *
 * and no Position X, no Position Y and no Orientation. The registrations agree:
 * `SCH_TEXT_DESC` adds only Text Size, EDA_TEXT supplies the rest, and NEITHER
 * SCH_ITEM NOR EDA_ITEM REGISTERS A POSITION. The generic position rows we put
 * on a label, a junction, a no-connect and a bus entry were ours; SCH_BITMAP is
 * the only schematic item that registers its own.
 *
 * SCH_TEXT also masks Orientation, Thickness, Mirrored, Width and Height out of
 * EDA_TEXT — our old `Height` and `Width` rows were that mask read backwards,
 * a text item having one size and not two.
 *
 * None of this moved a single existing expectation when it was changed, which
 * is the finding CLAUDE.md names: the behaviour was never pinned. It is now.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { schPropertiesFor } from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const rows = (d: Schematic) =>
  schPropertiesFor(d, LIB, itemRefById(d, refId('label', d.labels[0]!.uuid, 0))!);

const TEXT = `(text "hello" (at 10 10 0) (effects (font (size 1.27 1.27)) (justify center)) (uuid "x-1"))`;
const LABEL = `(label "N1" (at 10 10 0) (effects (font (size 1.27 1.27))) (uuid "x-1"))`;
const GLOBAL = `(global_label "N1" (shape input) (at 10 10 0) (effects (font (size 1.27 1.27))) (uuid "x-1"))`;
const HIER = `(hierarchical_label "N1" (shape output) (at 10 10 0) (effects (font (size 1.27 1.27))) (uuid "x-1"))`;

describe('a Text shows the ten rows a real panel shows', () => {
  it('matches the capture, row for row', () => {
    expect(rows(sheet(TEXT)).map((r) => r.name)).toEqual([
      'Text',
      'Font',
      'Auto Thickness',
      'Italic',
      'Bold',
      'Horizontal Justification',
      'Vertical Justification',
      'Color',
      'Hyperlink',
      'Text Size',
    ]);
  });

  it('puts all of them in Text Properties, so there is no Basic category', () => {
    for (const r of rows(sheet(TEXT))) expect(r.group).toBe('Text Properties');
  });

  it('shows no position and no orientation', () => {
    const names = new Set(rows(sheet(TEXT)).map((r) => r.name));
    for (const gone of ['Position X', 'Position Y', 'Orientation']) {
      expect(names.has(gone), `${gone} is not registered on a text item`).toBe(false);
    }
  });

  it('shows one text size, not a Height and a Width', () => {
    // EDA_TEXT's Width and Height are masked by SCH_TEXT; what remains is
    // SCH_TEXT's own `Text Size`, which writes both axes.
    const names = new Set(rows(sheet(TEXT)).map((r) => r.name));
    expect(names.has('Text Size')).toBe(true);
    expect(names.has('Height')).toBe(false);
    expect(names.has('Width')).toBe(false);
  });

  it('writes both axes from the one size', () => {
    const d = sheet(TEXT);
    const after = rows(d).find((r) => r.name === 'Text Size')!.set!(50800)!.apply(d);
    expect(after.labels[0]!.effects?.fontSize).toEqual([50800, 50800]);
  });
});

describe('a label adds Shape, and only where hasLabelShape holds', () => {
  it('a plain label has none', () => {
    expect(rows(sheet(LABEL)).some((r) => r.name === 'Shape')).toBe(false);
  });

  it.each([
    ['global', GLOBAL],
    ['hierarchical', HIER],
  ])('a %s label has one, ungrouped and first', (_k, src) => {
    const r = rows(sheet(src));
    expect(r[0]!.name).toBe('Shape');
    expect(r[0]!.group).toBe('');
  });

  it('a plain label masks Hyperlink, the other kinds keep it', () => {
    expect(rows(sheet(LABEL)).some((r) => r.name === 'Hyperlink')).toBe(false);
    expect(rows(sheet(GLOBAL)).some((r) => r.name === 'Hyperlink')).toBe(true);
    expect(rows(sheet(TEXT)).some((r) => r.name === 'Hyperlink')).toBe(true);
  });

  it('writes the shape token through', () => {
    const d = sheet(GLOBAL);
    const after = rows(d).find((r) => r.name === 'Shape')!.set!('Output')!.apply(d);
    expect(after.labels[0]!.shape).toBe('output');
  });
});

describe('the inherited text rows write to the label', () => {
  it('Color writes bytes, and clears to UNSPECIFIED', () => {
    const d = sheet(TEXT);
    const set = rows(d).find((r) => r.name === 'Color')!.set!;
    const painted = set('#3366cc')!.apply(d);
    expect(painted.labels[0]!.effects?.color?.slice(0, 3)).toEqual([0x33, 0x66, 0xcc]);
    const cleared = rows(painted).find((r) => r.name === 'Color')!.set!('')!.apply(painted);
    expect(cleared.labels[0]!.effects?.color).toBeUndefined();
  });

  it('Horizontal Justification writes the token and leaves the other axis', () => {
    const d = sheet(TEXT);
    const after = rows(d).find((r) => r.name === 'Horizontal Justification')!.set!('Left')!.apply(
      d,
    );
    expect(after.labels[0]!.effects?.justify).toContain('left');
  });
});

describe('the items that register no properties show none', () => {
  it('a no-connect flag has an empty pane', () => {
    // There is no SCH_NO_CONNECT_DESC at all.
    const d = sheet(`(no_connect (at 20 20) (uuid "nc-1"))`);
    const ref = itemRefById(d, refId('noconnect', d.noConnects[0]!.uuid, 0))!;
    expect(schPropertiesFor(d, LIB, ref)).toEqual([]);
  });
});
