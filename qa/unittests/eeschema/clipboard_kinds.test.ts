// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The clipboard across the whole item surface — a mechanism sweep rather than a
 * feature test.
 *
 * `SCH_EDITOR_CONTROL::doCopy` copies whatever is selected, so every kind that
 * can be selected must survive copy -> paste. This checks each kind in turn,
 * because the failure mode here is silent: a kind nobody wired up is simply
 * absent after the paste, with no error anywhere.
 *
 * Sheets are the one deliberate exception. KiCad ships each sheet's screen
 * along on the clipboard (`m_supplementaryClipboard`), which needs
 * multi-document paste support we do not have.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { copySelectionText, parsePastedText } from '@ziroeda/eeschema/src/tools/clipboard.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** Copy everything on the sheet, then paste it into an empty one. */
const roundTrip = (d: Schematic, ids: Set<string>) => {
  const text = copySelectionText(d, ids);
  return parsePastedText(text, sheet(''), { mode: 'keep' });
};

const BUS_ENTRY = `(bus_entry (at 10 10) (size 2.54 2.54)
   (stroke (width 0) (type default)) (uuid "be-1"))`;
const TEXT_BOX = `(text_box "hello" (exclude_from_sim no) (at 20 20 0) (size 20 10)
   (stroke (width 0) (type solid)) (fill (type none))
   (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb-1"))`;
const RECT = `(rectangle (start 30 30) (end 40 40)
   (stroke (width 0) (type default)) (fill (type none)) (uuid "gr-1"))`;
const DIRECTIVE = `(netclass_flag "HV" (length 2.54) (shape round) (at 50 50 0)
   (effects (font (size 1.27 1.27)) (justify left)) (uuid "nc-1")
   (property "Netclass" "HV" (at 50 50 0) (effects (font (size 1.27 1.27)))))`;
const IMAGE = `(image (at 60 60) (scale 1)
   (uuid "im-1")
   (data "iVBORw0KGgo="))`;

describe('every selectable kind survives copy and paste', () => {
  const cases: { name: string; body: string; count: (d: Schematic) => number }[] = [
    {
      name: 'a wire',
      body: `(wire (pts (xy 0 0) (xy 10 0)) (uuid "w-1"))`,
      count: (d) => d.lines.length,
    },
    {
      name: 'a junction',
      body: `(junction (at 5 5) (diameter 0) (uuid "j-1"))`,
      count: (d) => d.junctions.length,
    },
    {
      name: 'a label',
      body: `(label "N" (at 5 5 0) (effects (font (size 1.27 1.27))) (uuid "l-1"))`,
      count: (d) => d.labels.length,
    },
    {
      name: 'a no-connect',
      body: `(no_connect (at 7 7) (uuid "n-1"))`,
      count: (d) => d.noConnects.length,
    },
    { name: 'a bus entry', body: BUS_ENTRY, count: (d) => d.busEntries.length },
    { name: 'a text box', body: TEXT_BOX, count: (d) => d.textBoxes.length },
    { name: 'a graphic shape', body: RECT, count: (d) => d.graphics.length },
    { name: 'a directive label', body: DIRECTIVE, count: (d) => (d.directiveLabels ?? []).length },
    { name: 'an image', body: IMAGE, count: (d) => d.images.length },
  ];

  for (const c of cases) {
    it(`${c.name} comes back`, () => {
      const d = sheet(c.body);
      // Guard: the fixture must actually have parsed, or the test proves nothing.
      expect(c.count(d)).toBe(1);
      const ids = new Set<string>();
      d.lines.forEach((l, i) => ids.add(refId('line', l.uuid, i)));
      d.junctions.forEach((j, i) => ids.add(refId('junction', j.uuid, i)));
      d.labels.forEach((l, i) => ids.add(refId('label', l.uuid, i)));
      d.noConnects.forEach((n, i) => ids.add(refId('noconnect', n.uuid, i)));
      d.busEntries.forEach((b, i) => ids.add(refId('busentry', b.uuid, i)));
      d.textBoxes.forEach((t, i) => ids.add(refId('textbox', t.uuid, i)));
      // Graphics are identified by index — LibGraphic carries no uuid field.
      d.graphics.forEach((_g, i) => ids.add(refId('graphic', undefined, i)));
      (d.directiveLabels ?? []).forEach((g, i) => ids.add(refId('directive', g.uuid, i)));
      d.images.forEach((im, i) => ids.add(refId('image', im.uuid, i)));

      const payload = roundTrip(d, ids);
      expect(payload).not.toBeNull();
      const pasted = {
        ...sheet(''),
        ...payload!.batch,
      } as unknown as Schematic;
      expect(c.count(pasted)).toBe(1);
    });
  }
});

describe('a pasted item is a new item, not the same one', () => {
  it('gives every kind a uuid that differs from the original', () => {
    const d = sheet([BUS_ENTRY, TEXT_BOX, RECT].join('\n'));
    const ids = new Set<string>();
    d.busEntries.forEach((b, i) => ids.add(refId('busentry', b.uuid, i)));
    d.textBoxes.forEach((t, i) => ids.add(refId('textbox', t.uuid, i)));
    d.graphics.forEach((_g, i) => ids.add(refId('graphic', undefined, i)));

    const payload = roundTrip(d, ids)!;
    expect(payload.batch.busEntries[0]?.uuid).not.toBe('be-1');
    expect(payload.batch.textBoxes[0]?.uuid).not.toBe('tb-1');
    // A graphic's uuid lives only in its node, so read it back from there.
    const node = payload.batch.graphics[0]!.source;
    const uuidNode = node.items.find(
      (it) => it.kind === 'list' && it.items[0]?.kind === 'atom' && it.items[0].value === 'uuid',
    ) as { items: { value?: string }[] } | undefined;
    expect(uuidNode?.items[1]?.value).not.toBe('gr-1');
  });
});
