// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The properties panel's image rows. Counterpart: SCH_BITMAP's PROPERTY_MANAGER
 * registrations, whose one editable property beyond position is the scale.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { schPropertiesFor } from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();
const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const doc = (scale = 1): Schematic =>
  sheet(`(image (at 60 60) (scale ${scale}) (uuid "im-1") (data "iVBORw0KGgo="))`);

const rows = (d: Schematic) => schPropertiesFor(d, LIB, itemRefById(d, refId('image', 'im-1', 0))!);

describe('an image has properties rows at all', () => {
  it('used to be empty — schPropertiesFor had no image arm', () => {
    expect(rows(doc()).length).toBeGreaterThan(0);
  });

  it('offers position and scale', () => {
    expect(rows(doc()).map((r) => r.name)).toEqual(['Position X', 'Position Y', 'Scale']);
  });
});

describe('the scale row', () => {
  const scaleRow = (d: Schematic) => rows(d).find((r) => r.name === 'Scale')!;

  it('reads the model', () => {
    expect(scaleRow(doc(2.5)).value).toBe(2.5);
  });

  it('writes a new scale as an undoable command', () => {
    const d = doc(1);
    const cmd = scaleRow(d).set!(3)!;
    expect(cmd).not.toBeNull();
    const after = cmd.apply(d);
    expect(after.images[0]!.scale).toBe(3);
    // And it undoes exactly.
    expect(cmd.invert(d).apply(after).images[0]!.scale).toBe(1);
  });

  it('refuses a zero or negative scale', () => {
    // Either would collapse or invert the image; PANEL_IMAGE_EDITOR clamps
    // rather than accepting it, and a null return leaves the value untouched.
    const d = doc(1);
    expect(scaleRow(d).set!(0)).toBeNull();
    expect(scaleRow(d).set!(-2)).toBeNull();
  });

  it('refuses a value that is not a number', () => {
    expect(scaleRow(doc()).set!('banana')).toBeNull();
  });
});

describe('the position rows move the image', () => {
  it('sets an absolute X by moving the difference', () => {
    const d = doc();
    const row = rows(d).find((r) => r.name === 'Position X')!;
    const after = row.set!(mmToIU(100))!.apply(d);
    expect(after.images[0]!.at.x).toBe(mmToIU(100));
    expect(after.images[0]!.at.y).toBe(d.images[0]!.at.y);
  });
});
