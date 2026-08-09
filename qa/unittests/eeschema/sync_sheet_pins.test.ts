// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sync Sheet Pins, counterpart `PANEL_SYNC_SHEET_PINS::UpdateForms` and
 * `GenericSync`: the three lists, and the two directions that settle a
 * disagreement between a sheet pin and the label inside the sheet.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  advanceSyncPlacement,
  deleteSyncLabels,
  deleteSyncPins,
  hasUnmatched,
  reassociate,
  splitAssociated,
  syncLabelsFromPin,
  syncPinFromLabel,
  syncPlacementFor,
  syncSheetPinBuckets,
} from '@ziroeda/eeschema/src/tools/sync_sheet_pins.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** A parent with one sheet carrying `pins`. */
const parentWith = (pins: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
      (sheet (at 10 10) (size 30 30) (stroke (width 0) (type solid))
        (fill (color 0 0 0 0.0)) (uuid "sh-1")
        (property "Sheetname" "sub" (at 10 9 0) (effects (font (size 1.27 1.27))))
        (property "Sheetfile" "sub.kicad_sch" (at 10 41 0) (effects (font (size 1.27 1.27))))
        ${pins}))`),
  );

/** The sub-sheet, holding `labels`. */
const subWith = (labels: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols) ${labels})`));

const hier = (name: string, shape: string, uuid: string, y = 20): string =>
  `(hierarchical_label "${name}" (shape ${shape}) (at 30 ${y} 0)
     (effects (font (size 1.27 1.27))) (uuid "${uuid}"))`;

const pin = (name: string, shape: string, uuid: string, y = 20): string =>
  `(pin "${name}" ${shape} (at 10 ${y} 180) (effects (font (size 1.27 1.27))) (uuid "${uuid}"))`;

const buckets = (pins: string, labels: string) =>
  syncSheetPinBuckets(parentWith(pins).sheets[0]!, 0, subWith(labels));

describe('sorting the two halves into three lists', () => {
  it('pairs a label and a pin that agree on name and shape', () => {
    const b = buckets(pin('CLK', 'input', 'p1'), hier('CLK', 'input', 'l1'));
    expect(b.associated.map((a) => a.label.text)).toEqual(['CLK']);
    expect(b.labels).toEqual([]);
    expect(b.pins).toEqual([]);
    expect(hasUnmatched(b)).toBe(false);
  });

  it('does NOT pair them when only the name agrees', () => {
    // The rule the whole panel turns on. A name-only match would hide the
    // disagreement the two template buttons exist to settle.
    const b = buckets(pin('CLK', 'output', 'p1'), hier('CLK', 'input', 'l1'));
    expect(b.associated).toEqual([]);
    expect(b.labels.map((l) => l.text)).toEqual(['CLK']);
    expect(b.pins.map((p) => p.text)).toEqual(['CLK']);
    expect(hasUnmatched(b)).toBe(true);
  });

  it('lists a label with no pin, and a pin with no label', () => {
    const b = buckets(pin('SPARE', 'input', 'p1'), hier('CLK', 'input', 'l1'));
    expect(b.labels.map((l) => l.text)).toEqual(['CLK']);
    expect(b.pins.map((p) => p.text)).toEqual(['SPARE']);
  });

  it('counts one net labelled three times as one connection', () => {
    // De-duplicated by text, first wins: listing it three times would invite
    // three pins for one net.
    const b = buckets(
      '',
      [
        hier('CLK', 'input', 'l1', 20),
        hier('CLK', 'input', 'l2', 25),
        hier('CLK', 'input', 'l3', 30),
      ].join('\n'),
    );
    expect(b.labels).toHaveLength(1);
    expect(b.labels[0]!.id).toBe('l1');
  });

  it('does not let two identical labels claim the same pin', () => {
    // A pin is consumed by the first label that matches it. With the dedup
    // above this cannot arise from equal text — it takes two labels that differ
    // in text but match different pins to exercise the consumption.
    const b = buckets(
      [pin('A', 'input', 'p1', 20), pin('A', 'input', 'p2', 25)].join('\n'),
      hier('A', 'input', 'l1'),
    );
    expect(b.associated).toHaveLength(1);
    expect(b.pins).toHaveLength(1); // the second pin is left over
  });

  it('sorts the labels the way the panel lists them', () => {
    const b = buckets(
      '',
      [
        hier('D10', 'input', 'l3', 20),
        hier('D2', 'input', 'l1', 25),
        hier('D1', 'input', 'l2', 30),
      ].join('\n'),
    );
    // StrNumCmp: digit runs compare by value, so D2 precedes D10.
    expect(b.labels.map((l) => l.text)).toEqual(['D1', 'D2', 'D10']);
  });

  it('ignores labels that are not hierarchical', () => {
    const b = buckets(
      pin('CLK', 'input', 'p1'),
      `(label "CLK" (at 30 20 0) (effects (font (size 1.27 1.27))) (uuid "l1"))`,
    );
    expect(b.labels).toEqual([]);
    expect(b.pins.map((p) => p.text)).toEqual(['CLK']);
  });
});

describe('use the label as the template', () => {
  it('gives the pin the label’s name and shape, and it reaches the file', () => {
    const parent = parentWith(pin('CLOCK', 'output', 'p1'));
    const b = buckets(pin('CLOCK', 'output', 'p1'), hier('CLK', 'input', 'l1'));
    const cmd = syncPinFromLabel(parent, { sheet: 0, pin: 0 }, b.labels[0]!)!;
    const after = cmd.apply(parent);
    expect(after.sheets[0]!.pins[0]!.name).toBe('CLK');
    expect(after.sheets[0]!.pins[0]!.shape).toBe('input');
    const text = serializeSchematic(after);
    expect(text).toContain('(pin "CLK" input');
  });

  it('returns null for a pin that is not there', () => {
    const parent = parentWith('');
    expect(
      syncPinFromLabel(parent, { sheet: 0, pin: 0 }, { id: 'x', text: 'CLK', shape: 'input' }),
    ).toBeNull();
  });
});

describe('use the pin as the template', () => {
  it('renames every label with that text, not just the first', () => {
    // The panel shows one row per distinct text, so the row stands for all of
    // them — renaming one and leaving its twins would split a whole net.
    const sub = subWith(
      [
        hier('CLK', 'input', 'l1', 20),
        hier('CLK', 'input', 'l2', 25),
        hier('OTHER', 'input', 'l3', 30),
      ].join('\n'),
    );
    const cmd = syncLabelsFromPin(
      { id: 'l1', text: 'CLK', shape: 'input' },
      { id: 'p1', index: 0, text: 'CLOCK', shape: 'output' },
    );
    const after = cmd.apply(sub);
    expect(after.labels.filter((l) => l.text === 'CLOCK')).toHaveLength(2);
    expect(after.labels.find((l) => l.text === 'OTHER')).toBeDefined();
    for (const l of after.labels.filter((l) => l.text === 'CLOCK')) expect(l.shape).toBe('output');
    const text = serializeSchematic(after);
    expect(text).toContain('(hierarchical_label "CLOCK"');
    expect(text).toContain('(shape output)');
    expect(text).not.toContain('"CLK"');
  });

  it('undoes and redoes', () => {
    const sub = subWith(hier('CLK', 'input', 'l1'));
    const cmd = syncLabelsFromPin(
      { id: 'l1', text: 'CLK', shape: 'input' },
      { id: 'p1', index: 0, text: 'CLOCK', shape: 'output' },
    );
    const after = cmd.apply(sub);
    const undone = cmd.invert(sub).apply(after);
    expect(undone.labels[0]!.text).toBe('CLK');
    const redone = cmd.invert(sub).invert(after).apply(undone);
    expect(redone.labels[0]!.text).toBe('CLOCK');
  });
});

describe('the two add buttons', () => {
  it('queue the selected rows for interactive placement', () => {
    // `PreparePlacementTemplate` takes the *set* of selected rows, and the tool
    // places them one click at a time.
    const p = syncPlacementFor('sheetPin', 0, 'top.kicad_sch', [
      { text: 'CLK', shape: 'input' },
      { text: 'RST', shape: 'input' },
    ]);
    expect(p?.queue.map((t) => t.text)).toEqual(['CLK', 'RST']);
  });

  it('and do nothing at all with an empty selection', () => {
    // `if( selected_items_set.empty() ) return;` — the guard both buttons open
    // with, so a stray click cannot arm a tool with nothing to place.
    expect(syncPlacementFor('sheetPin', 0, 'top.kicad_sch', [])).toBe(null);
  });

  it('a placed item leaves the queue, and the last one ends the placement', () => {
    const p = syncPlacementFor('hierLabel', 0, 'sub.kicad_sch', [
      { text: 'A', shape: 'input' },
      { text: 'B', shape: 'output' },
    ])!;
    const after = advanceSyncPlacement(p);
    expect(after?.queue.map((t) => t.text)).toEqual(['B']);
    // `if( m_placementTemplateSet.empty() ) EndPlacement();` — null is what
    // brings the dialog back.
    expect(advanceSyncPlacement(after!)).toBe(null);
  });

  it('pins are written to the parent, labels to the sub-sheet', () => {
    // The two halves live in different files; upstream pops the sheet path for
    // one direction and not the other.
    expect(
      syncPlacementFor('sheetPin', 0, 'top.kicad_sch', [{ text: 'A', shape: 'input' }])?.file,
    ).toBe('top.kicad_sch');
    expect(
      syncPlacementFor('hierLabel', 0, 'sub.kicad_sch', [{ text: 'A', shape: 'input' }])?.file,
    ).toBe('sub.kicad_sch');
  });

  it('carries the shape across, so the new item matches its template', () => {
    const p = syncPlacementFor('sheetPin', 0, 'top.kicad_sch', [{ text: 'D', shape: 'tri_state' }]);
    expect(p?.queue[0]?.shape).toBe('tri_state');
  });
});

describe('the undo button', () => {
  it('puts a matched pair back into the two unmatched lists', () => {
    // `OnBtnUndoClicked` — the pair still agrees, it is simply no longer
    // treated as settled.
    const b = buckets(pin('CLK', 'input', 'p1'), hier('CLK', 'input', 'l1'));
    expect(b.associated).toHaveLength(1);
    const split = splitAssociated(b, new Set([b.associated[0]!.label.id]));
    expect(split.associated).toEqual([]);
    expect(split.labels.map((l) => l.text)).toEqual(['CLK']);
    expect(split.pins.map((p) => p.text)).toEqual(['CLK']);
  });

  it('leaves the pairs it was not asked about alone', () => {
    const b = buckets(
      `${pin('CLK', 'input', 'p1')} ${pin('RST', 'input', 'p2', 25)}`,
      `${hier('CLK', 'input', 'l1')} ${hier('RST', 'input', 'l2', 25)}`,
    );
    const split = splitAssociated(b, new Set([b.associated[0]!.label.id]));
    expect(split.associated.map((a) => a.label.text)).toEqual(['RST']);
    expect(split.labels.map((l) => l.text)).toEqual(['CLK']);
  });

  it('and an empty set is the identity', () => {
    const b = buckets(pin('CLK', 'input', 'p1'), hier('CLK', 'input', 'l1'));
    expect(splitAssociated(b, new Set())).toBe(b);
  });
});

describe('the two delete buttons', () => {
  it('drop the selected pins from the sheet symbol', () => {
    const parent = parentWith(
      `${pin('A', 'input', 'p1')} ${pin('B', 'input', 'p2', 25)} ${pin('C', 'input', 'p3', 30)}`,
    );
    const after = deleteSyncPins(0, [0, 2]).apply(parent);
    expect(after.sheets[0]?.pins.map((p) => p.name)).toEqual(['B']);
  });

  it('back to front, so the indices do not shift underneath the deletion', () => {
    // Deleting index 0 first would renumber everything above it and the second
    // deletion would take the wrong pin.
    const parent = parentWith(
      `${pin('A', 'input', 'p1')} ${pin('B', 'input', 'p2', 25)} ${pin('C', 'input', 'p3', 30)}`,
    );
    expect(
      deleteSyncPins(0, [0, 1])
        .apply(parent)
        .sheets[0]?.pins.map((p) => p.name),
    ).toEqual(['C']);
  });

  it('and undo puts them back in their original order', () => {
    const parent = parentWith(`${pin('A', 'input', 'p1')} ${pin('B', 'input', 'p2', 25)}`);
    const cmd = deleteSyncPins(0, [0]);
    const back = cmd.invert(parent).apply(cmd.apply(parent));
    expect(back.sheets[0]?.pins.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('drop the selected labels from the sub-sheet, every copy of each', () => {
    // The list is de-duplicated by text, so a row stands for all the labels
    // carrying it — the same rule the rename direction follows.
    const sub = subWith(
      `${hier('CLK', 'input', 'l1')} ${hier('CLK', 'input', 'l2', 25)} ${hier('RST', 'input', 'l3', 30)}`,
    );
    const after = deleteSyncLabels(['CLK']).apply(sub);
    expect(after.labels.map((l) => l.text)).toEqual(['RST']);
  });

  it('and leave anything that is not a hierarchical label alone', () => {
    const sub = readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
        ${hier('CLK', 'input', 'l1')}
        (label "CLK" (at 40 20 0) (effects (font (size 1.27 1.27))) (uuid "l2")))`),
    );
    const after = deleteSyncLabels(['CLK']).apply(sub);
    expect(after.labels.map((l) => l.kind)).toEqual(['label']);
  });

  it('a deleted label survives a round trip through the file', () => {
    const sub = subWith(`${hier('CLK', 'input', 'l1')} ${hier('RST', 'input', 'l2', 25)}`);
    const after = deleteSyncLabels(['CLK']).apply(sub);
    const back = readSchematic(parse(serializeSchematic(after)));
    expect(back.labels.map((l) => l.text)).toEqual(['RST']);
  });

  it('as does a deleted pin', () => {
    const parent = parentWith(`${pin('A', 'input', 'p1')} ${pin('B', 'input', 'p2', 25)}`);
    const after = deleteSyncPins(0, [0]).apply(parent);
    const back = readSchematic(parse(serializeSchematic(after)));
    expect(back.sheets[0]?.pins.map((p) => p.name)).toEqual(['B']);
  });
});

describe('breaking a pair and then settling it again', () => {
  // The sequence that made the two template buttons look dead: break a pair,
  // point one of its halves at something else, press the button. The rename
  // happens, the pair matches — and then `splitAssociated` pulls it straight
  // back apart, because the label id is still in the broken set. Nothing on
  // screen moves.
  const b = () => buckets(pin('CLK', 'input', 'p1'), hier('CLK', 'input', 'l1'));

  it('the pair is settled again, not re-broken', () => {
    const start = b();
    const id = start.associated[0]!.label.id;
    const broken = new Set([id]);
    expect(splitAssociated(start, broken).associated).toEqual([]);
    // `AppendItem` — the pair goes back to the associated list.
    const after = reassociate(broken, id);
    expect(splitAssociated(start, after).associated).toHaveLength(1);
    expect(splitAssociated(start, after).labels).toEqual([]);
    expect(splitAssociated(start, after).pins).toEqual([]);
  });

  it('and the other broken pairs stay broken', () => {
    const broken = new Set(['a', 'b']);
    expect([...reassociate(broken, 'a')]).toEqual(['b']);
  });

  it('a label that was never broken changes nothing, and keeps the same set', () => {
    // Same object back, so a render that did not change the pairs does not
    // recompute the buckets.
    const broken = new Set(['a']);
    expect(reassociate(broken, 'zzz')).toBe(broken);
  });
});
