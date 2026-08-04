// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every field the UI can edit survives a save.
 *
 * This is the writer audit generalised, and it exists because the audit's
 * finding keeps recurring: nine times now a field became editable and its
 * `write-schematic.ts` patcher was never extended, so the edit changed the
 * model and vanished on save. The most recent was self-inflicted — table
 * border flags, made editable in one PR and unwritable until the next.
 *
 * The rule this encodes: **making a field editable and extending its patcher
 * are one change, not two.** A row added to a dialog or the properties panel
 * belongs here in the same commit.
 *
 * Each case sets the field to a value distinguishable from the fixture's,
 * round-trips through writer and reader, and asserts it came back.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  replaceGraphic,
  replaceImage,
  replaceSheet,
  replaceLabel,
} from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { EditCommand } from '@ziroeda/eeschema/src/tools/command.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** Apply, serialize, read back. */
const roundTrip = (d: Schematic, cmd: EditCommand): Schematic =>
  readSchematic(parse(serializeSchematic(cmd.apply(d))));

describe('an image', () => {
  const doc = () => sheet(`(image (at 60 60) (scale 1) (uuid "im-1") (data "iVBORw0KGgo="))`);

  it('keeps an edited scale', () => {
    // Editable through the properties panel's Scale row.
    const d = doc();
    const back = roundTrip(d, replaceImage(0, { ...d.images[0]!, scale: 2.5 }));
    expect(back.images[0]!.scale).toBe(2.5);
  });
});

describe('a graphic shape', () => {
  const doc = () =>
    sheet(`(rectangle (start 10 10) (end 20 20)
       (stroke (width 0) (type solid)) (fill (type none)) (uuid "r-1"))`);

  /** The fixture is a rectangle; narrowing keeps the union out of the way. */
  const rect = (d: Schematic) => {
    const g = d.graphics[0]!;
    if (g.kind !== 'rectangle') throw new Error('fixture is not a rectangle');
    return g;
  };
  const rectBack = (d: Schematic, cmd: EditCommand) => {
    const g = roundTrip(d, cmd).graphics[0]!;
    if (g.kind !== 'rectangle') throw new Error('round trip lost the rectangle');
    return g;
  };

  it('keeps an edited stroke width', () => {
    const d = doc();
    const cmd = replaceGraphic(0, {
      ...rect(d),
      stroke: { width: mmToIU(0.5), type: 'solid' },
    });
    expect(rectBack(d, cmd).stroke?.width).toBe(mmToIU(0.5));
  });

  it('keeps an edited stroke style', () => {
    const d = doc();
    const cmd = replaceGraphic(0, { ...rect(d), stroke: { width: 0, type: 'dash' } });
    expect(rectBack(d, cmd).stroke?.type).toBe('dash');
  });

  it('keeps an edited fill', () => {
    const d = doc();
    const cmd = replaceGraphic(0, { ...rect(d), fill: { type: 'outline' } });
    expect(rectBack(d, cmd).fill?.type).toBe('outline');
  });
});

describe('a sheet pin', () => {
  const doc = () =>
    sheet(`(sheet (at 10 10) (size 20 20) (uuid "sh-1")
       (property "Sheetname" "sub" (at 10 9 0) (effects (font (size 1.27 1.27))))
       (property "Sheetfile" "sub.kicad_sch" (at 10 31 0) (effects (font (size 1.27 1.27))))
       (pin "A" input (at 10 14 180) (effects (font (size 1.27 1.27)))))`);

  const patchPin = (d: Schematic, p: Partial<Schematic['sheets'][number]['pins'][number]>) =>
    replaceSheet(0, {
      ...d.sheets[0]!,
      pins: d.sheets[0]!.pins.map((x, i) => (i === 0 ? { ...x, ...p } : x)),
    });

  it('keeps an edited name', () => {
    const d = doc();
    expect(roundTrip(d, patchPin(d, { name: 'CLK' })).sheets[0]!.pins[0]!.name).toBe('CLK');
  });

  it('keeps an edited shape', () => {
    const d = doc();
    expect(roundTrip(d, patchPin(d, { shape: 'tri_state' })).sheets[0]!.pins[0]!.shape).toBe(
      'tri_state',
    );
  });
});

describe('a label', () => {
  const doc = () =>
    sheet(`(label "NET" (at 50 50 0) (effects (font (size 1.27 1.27)) (justify left))
       (uuid "l-1"))`);

  it('keeps an edited angle', () => {
    // Rotation writes the angle; R on a label is the path that produces this.
    const d = doc();
    expect(roundTrip(d, replaceLabel(0, { ...d.labels[0]!, angle: 90 })).labels[0]!.angle).toBe(90);
  });

  it('keeps an edited justify', () => {
    // Rotation flips it too, so the pair must survive together.
    const d = doc();
    const l = d.labels[0]!;
    const back = roundTrip(
      d,
      replaceLabel(0, { ...l, effects: { ...l.effects!, justify: ['right'] } }),
    );
    expect(back.labels[0]!.effects?.justify).toEqual(['right']);
  });

  it('keeps both when they change together', () => {
    // A quarter turn changes the angle *and* the justify; writing one without
    // the other leaves the label facing a direction it was never turned to.
    const d = doc();
    const l = d.labels[0]!;
    const back = roundTrip(
      d,
      replaceLabel(0, { ...l, angle: 90, effects: { ...l.effects!, justify: ['right'] } }),
    );
    expect(back.labels[0]!.angle).toBe(90);
    expect(back.labels[0]!.effects?.justify).toEqual(['right']);
  });
});
