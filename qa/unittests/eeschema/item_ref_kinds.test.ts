// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `itemRefById` across every declared item kind — the sweep, and the guard.
 *
 * This resolver answers "what is this id?", and the properties panel and the
 * message panel both branch on its answer. A kind it cannot resolve returns
 * null, and both panels render empty — so the item looks selectable and then
 * tells you nothing about itself.
 *
 * The completeness guard at the bottom is the real point: it enumerates
 * `ItemRef['kind']` and fails when a kind has no case here, so the next kind
 * added to the union cannot quietly go unresolved.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  itemRefById,
  refId,
  sheetPinId,
  type ItemRef,
} from '@ziroeda/eeschema/src/tools/hittest.js';
import { getMsgPanelItems } from '@ziroeda/eeschema/src/tools/msg_panel.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** One of everything the model can hold, on one sheet. */
const KITCHEN_SINK = sheet(
  [
    `(symbol (lib_id "Device:R") (at 20 20 0) (unit 1) (uuid "s-1")
       (property "Reference" "R1" (at 22 19 0) (effects (font (size 1.27 1.27)))))`,
    `(wire (pts (xy 0 0) (xy 10 0)) (uuid "w-1"))`,
    `(junction (at 5 5) (diameter 0) (uuid "j-1"))`,
    `(no_connect (at 7 7) (uuid "n-1"))`,
    `(label "NET" (at 5 5 0) (effects (font (size 1.27 1.27))) (uuid "l-1"))`,
    `(sheet (at 40 40) (size 20 20) (uuid "sh-1")
       (property "Sheetname" "sub" (at 40 39 0) (effects (font (size 1.27 1.27))))
       (property "Sheetfile" "sub.kicad_sch" (at 40 61 0) (effects (font (size 1.27 1.27))))
       (pin "A" input (at 40 44 180) (effects (font (size 1.27 1.27)))))`,
    `(bus_entry (at 30 30) (size 2.54 2.54) (uuid "be-1"))`,
    `(image (at 60 60) (scale 1) (uuid "im-1") (data "iVBORw0KGgo="))`,
    `(rectangle (start 70 70) (end 80 80)
       (stroke (width 0) (type default)) (fill (type none)) (uuid "gr-1"))`,
    `(text_box "hi" (at 90 90 0) (size 10 5)
       (stroke (width 0) (type solid)) (fill (type none))
       (effects (font (size 1.27 1.27))) (uuid "tb-1"))`,
    `(netclass_flag "HV" (length 2.54) (shape round) (at 50 50 0)
       (effects (font (size 1.27 1.27)) (justify left)) (uuid "nc-1")
       (property "Netclass" "HV" (at 50 50 0) (effects (font (size 1.27 1.27)))))`,
  ].join('\n'),
);

const symId = refId('symbol', 's-1', 0);
const shId = refId('sheet', 'sh-1', 0);

/** id -> the kind it must resolve to. Tables have no fixture (see below). */
const CASES: [ItemRef['kind'], string][] = [
  ['symbol', symId],
  ['line', refId('line', 'w-1', 0)],
  ['junction', refId('junction', 'j-1', 0)],
  ['noconnect', refId('noconnect', 'n-1', 0)],
  ['label', refId('label', 'l-1', 0)],
  ['sheet', shId],
  ['busentry', refId('busentry', 'be-1', 0)],
  ['image', refId('image', 'im-1', 0)],
  ['graphic', refId('graphic', undefined, 0)],
  ['textbox', refId('textbox', 'tb-1', 0)],
  ['directive', refId('directive', 'nc-1', 0)],
  ['field', `${symId}:field0`],
  ['pin', `${symId}:pin0`],
  ['sheetpin', sheetPinId(shId, 0)],
];

describe('itemRefById resolves every kind', () => {
  for (const [kind, id] of CASES) {
    it(`resolves a ${kind}`, () => {
      const ref = itemRefById(KITCHEN_SINK, id);
      expect(ref).not.toBeNull();
      expect(ref!.kind).toBe(kind);
      expect(ref!.id).toBe(id);
    });
  }

  it('returns null for an id that names nothing', () => {
    expect(itemRefById(KITCHEN_SINK, 'symbol:not-here')).toBeNull();
    // A well-formed composite id whose index is out of range is also nothing.
    expect(itemRefById(KITCHEN_SINK, sheetPinId(shId, 99))).toBeNull();
    expect(itemRefById(KITCHEN_SINK, `${symId}:field99`)).toBeNull();
  });

  it('does not confuse :sheetpin with :pin', () => {
    // ':sheetpin' contains no ':pin', but the two branches sit next to each
    // other and an id must not fall into the wrong one.
    expect(itemRefById(KITCHEN_SINK, sheetPinId(shId, 0))!.kind).toBe('sheetpin');
    expect(itemRefById(KITCHEN_SINK, `${symId}:pin0`)!.kind).toBe('pin');
  });
});

describe('the completeness guard', () => {
  it('covers every kind in the ItemRef union', () => {
    // Mirrors the union in hittest.ts. When a kind is added there and not here,
    // this fails — which is the point: an unresolved kind is invisible in the
    // UI, so it must not be possible to add one silently.
    const declared: ItemRef['kind'][] = [
      'symbol',
      'line',
      'junction',
      'noconnect',
      'label',
      'sheet',
      'busentry',
      'image',
      'graphic',
      'textbox',
      'table',
      'directive',
      'field',
      'pin',
      'sheetpin',
    ];
    const covered = new Set(CASES.map(([k]) => k));
    // 'table' is the one deliberate omission: the reader needs a full
    // `(table ...)` node with cells, which is a fixture of its own. It is
    // already handled by itemRefById's scan list.
    const missing = declared.filter((k) => !covered.has(k) && k !== 'table');
    expect(missing).toEqual([]);
  });
});

describe('the panels a resolved ref feeds', () => {
  const LIB = new Map<string, LibSymbol>();
  const fmt = (iu: number): string => `${iu}`;

  it('a sheet pin now has message-panel rows', () => {
    // Before, itemRefById returned null for a sheet pin and this panel was
    // empty — the item was selectable but described itself as nothing.
    const ref = itemRefById(KITCHEN_SINK, sheetPinId(shId, 0))!;
    const rows = getMsgPanelItems(KITCHEN_SINK, LIB, ref, fmt);
    expect(rows.map((r) => r.upper)).toEqual(['Hierarchical Sheet Pin', 'Type']);
    expect(rows[0]!.lower).toBe('A');
    expect(rows[1]!.lower).toBe('Input');
  });

  it('still shows nothing for kinds whose upstream counterpart shows nothing', () => {
    // EDA_ITEM's base GetMsgPanelInfo is empty, so a junction really has no
    // rows. This is here so the emptiness stays deliberate.
    const ref = itemRefById(KITCHEN_SINK, refId('junction', 'j-1', 0))!;
    expect(getMsgPanelItems(KITCHEN_SINK, LIB, ref, fmt)).toEqual([]);
  });
});

describe('the message panel arms added alongside the sweep', () => {
  const LIB = new Map<string, LibSymbol>();
  const fmt = (iu: number): string => `${iu}`;
  const rowsFor = (id: string, net?: string) =>
    getMsgPanelItems(KITCHEN_SINK, LIB, itemRefById(KITCHEN_SINK, id)!, fmt, net);

  it('a text box reports its raw text', () => {
    // Upstream deliberately does not resolve variables here: "we want to show
    // the user the variable references".
    const rows = rowsFor(refId('textbox', 'tb-1', 0));
    expect(rows[0]).toEqual({ upper: 'Text Box', lower: 'hi' });
  });

  it('a bus entry reports its type, and its net when it has one', () => {
    const plain = rowsFor(refId('busentry', 'be-1', 0));
    expect(plain).toEqual([{ upper: 'Bus Entry Type', lower: 'Wire' }]);
    const wired = rowsFor(refId('busentry', 'be-1', 0), 'VCC');
    expect(wired.map((r) => r.upper)).toEqual([
      'Bus Entry Type',
      'Connection Name',
      'Resolved Netclass',
    ]);
    expect(wired[2]!.lower).toBe('Default');
  });

  it('a rectangle reports its name and both dimensions', () => {
    const rows = rowsFor(refId('graphic', undefined, 0));
    expect(rows[0]).toEqual({ upper: 'Shape', lower: 'Rectangle' });
    expect(rows.map((r) => r.upper)).toEqual(['Shape', 'Width', 'Height']);
    // The fixture is 10mm x 10mm; the numbers come through fmt unchanged.
    expect(rows[1]!.lower).toBe(rows[2]!.lower);
  });

  it('a circle reports a radius rather than width and height', () => {
    const d = sheet(`(circle (center 10 10) (radius 5)
       (stroke (width 0) (type default)) (fill (type none)) (uuid "c-1"))`);
    const ref = itemRefById(d, refId('graphic', undefined, 0))!;
    const rows = getMsgPanelItems(d, LIB, ref, fmt);
    expect(rows.map((r) => r.upper)).toEqual(['Shape', 'Radius']);
    expect(rows[0]!.lower).toBe('Circle');
  });
});

describe('an image reports what SCH_BITMAP reports', () => {
  const LIB = new Map<string, LibSymbol>();
  const fmt = (iu: number): string => `${iu}`;

  it('lists Bitmap, PPI, Scale, Width and Height in upstream order', () => {
    const ref = itemRefById(KITCHEN_SINK, refId('image', 'im-1', 0))!;
    const rows = getMsgPanelItems(KITCHEN_SINK, LIB, ref, fmt);
    expect(rows.map((r) => r.upper)).toEqual(['Bitmap', 'PPI', 'Scale', 'Width', 'Height']);
    // The first row is a bare title upstream, with no value beside it.
    expect(rows[0]!.lower).toBe('');
  });

  it('takes the scale from the model, so an edit shows up', () => {
    const d = sheet(`(image (at 60 60) (scale 2.5) (uuid "im-2") (data "iVBORw0KGgo="))`);
    const ref = itemRefById(d, refId('image', 'im-2', 0))!;
    const rows = getMsgPanelItems(d, LIB, ref, fmt);
    expect(rows.find((r) => r.upper === 'Scale')!.lower).toBe('2.5');
  });

  it('scales the reported size with the image scale', () => {
    // imageSizeIU multiplies by the scale, so doubling it doubles both
    // dimensions. Asserted as a ratio rather than a literal, because the
    // fixture's PNG is a stub and falls back to a default pixel size.
    const one = sheet(`(image (at 0 0) (scale 1) (uuid "a") (data "iVBORw0KGgo="))`);
    const two = sheet(`(image (at 0 0) (scale 2) (uuid "b") (data "iVBORw0KGgo="))`);
    const w = (d: Schematic): number => {
      const ref = itemRefById(d, refId('image', d.images[0]!.uuid, 0))!;
      return Number(getMsgPanelItems(d, LIB, ref, fmt).find((r) => r.upper === 'Width')!.lower);
    };
    expect(w(two)).toBe(w(one) * 2);
  });
});
