// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Navigator tree, counterparts GetNetNavigatorItemText,
 * MakeNetNavigatorNode and SelectNextPrevNetNavigatorItem (net_navigator.cpp).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  buildNetNavigator,
  netNavigatorItemText,
  netNavigatorOrder,
  netNavigatorIndex,
  netOfItem,
  stepNetItem,
} from '@ziroeda/eeschema/src/tools/net_navigator.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

/** A resistor wired to a labelled net, with a junction, a no-connect and a bus. */
const SCH = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "A") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 53 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 53 52 0) (effects (font (size 1.27 1.27)))))
  (wire (pts (xy 50.8 46.99) (xy 63.5 46.99)) (uuid "w1"))
  (wire (pts (xy 63.5 46.99) (xy 76.2 46.99)) (uuid "w2"))
  (junction (at 63.5 46.99) (uuid "j1"))
  (label "CLK" (at 63.5 46.99 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
  (no_connect (at 50.8 54.61) (uuid "nc1"))
  (wire (pts (xy 101.6 101.6) (xy 114.3 101.6)) (uuid "w3"))
  (label "AAA" (at 101.6 101.6 0) (effects (font (size 1.27 1.27))) (uuid "l2")))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const libs = (): Map<string, LibSymbol> => new Map(doc().libSymbols.map((l) => [l.libId, l]));
/** mm to two places, as the message panel shows lengths. */
const fmt = (iu: number): string => `${iuToMM(iu).toFixed(2)} mm`;
const tree = () => buildNetNavigator(doc(), libs(), fmt);

describe('an item describes itself in words', () => {
  it('names a wire by its two ends, in the caller units', () => {
    expect(netNavigatorItemText(doc(), libs(), 'w1', fmt)).toBe(
      'Wire from (50.80 mm, 46.99 mm) to (63.50 mm, 46.99 mm)',
    );
  });

  it('names a symbol pin by reference and number, with the pin name in brackets', () => {
    const d = doc();
    const l = libs();
    // Pin 1 is named "A"; pin 2's name is "~", which upstream shows as nothing.
    expect(netNavigatorItemText(d, l, 'r1:pin0', fmt)).toBe("Symbol 'R1' pin '1' (A)");
    expect(netNavigatorItemText(d, l, 'r1:pin1', fmt)).toBe("Symbol 'R1' pin '2'");
  });

  it('names a label, a junction and a no-connect by position', () => {
    const d = doc();
    const l = libs();
    expect(netNavigatorItemText(d, l, 'l1', fmt)).toBe("Label 'CLK' at (63.50 mm, 46.99 mm)");
    expect(netNavigatorItemText(d, l, 'j1', fmt)).toBe('Junction at (63.50 mm, 46.99 mm)');
    expect(netNavigatorItemText(d, l, 'nc1', fmt)).toBe('No-Connect at (50.80 mm, 54.61 mm)');
  });

  it('returns null for an id that names nothing', () => {
    expect(netNavigatorItemText(doc(), libs(), 'nope', fmt)).toBeNull();
  });

  it('says so for a line that is neither wire nor bus', () => {
    // Upstream names it rather than leaving it out, so a tree holding one
    // explains itself instead of showing a blank row.
    const d = readSchematic(
      parse(`(kicad_sch (version 20250114)
        (polyline (pts (xy 0 0) (xy 10 0)) (stroke (width 0) (type default)) (uuid "g1")))`),
    );
    expect(netNavigatorItemText(d, new Map(), 'g1', fmt)).toBe('Graphic line not connectable');
  });
});

describe('the tree', () => {
  it('lists nets by name with their items under them', () => {
    const t = tree();
    const clk = t.find((n) => n.name.endsWith('CLK'))!;
    expect(clk).toBeDefined();
    // The wire pair, the junction, the label and the resistor's top pin.
    expect(clk.items.map((i) => i.id).sort()).toEqual(['j1', 'l1', 'r1:pin0', 'w1', 'w2']);
    expect(clk.items.find((i) => i.id === 'l1')!.text).toContain("Label 'CLK'");
  });

  it('is sorted by net name, not by the order connectivity found them', () => {
    // "AAA" is the last thing in the file and the first node in the tree.
    const names = tree().map((n) => n.name);
    expect([...names].sort()).toEqual(names);
    expect(names[0]!.endsWith('AAA')).toBe(true);
  });

  it('finds which net an item is on, for Find in Net Navigator', () => {
    expect(netOfItem(tree(), 'j1')).toBe(tree().find((n) => n.name.endsWith('CLK'))!.name);
    expect(netOfItem(tree(), 'nothing')).toBeNull();
  });
});

describe('Tab and Shift+Tab', () => {
  const order = ['a', 'b', 'c'];

  it('step one at a time', () => {
    expect(stepNetItem(order, 'a', true)).toBe('b');
    expect(stepNetItem(order, 'c', false)).toBe('b');
  });

  it('wrap at both ends, unlike the ERC marker stepping', () => {
    // SelectNextPrevNetNavigatorItem walks past the end to the beginning.
    // Previous/Next Marker deliberately stops; the two are not the same.
    expect(stepNetItem(order, 'c', true)).toBe('a');
    expect(stepNetItem(order, 'a', false)).toBe('c');
  });

  it('move nowhere with no selection, an empty tree, or an unknown id', () => {
    expect(stepNetItem(order, null, true)).toBeNull();
    expect(stepNetItem([], 'a', true)).toBeNull();
    expect(stepNetItem(order, 'zzz', true)).toBeNull();
  });

  it('cross from one net to the next, because the tree is flattened first', () => {
    const t = tree();
    const flat = netNavigatorOrder(t);
    expect(flat.length).toBe(t.reduce((n, x) => n + x.items.length, 0));
    const lastOfFirst = t[0]!.items[t[0]!.items.length - 1]!.id;
    if (t.length > 1) expect(stepNetItem(flat, lastOfFirst, true)).toBe(t[1]!.items[0]!.id);
  });
});

describe('the tree is linear in the sheet, not quadratic', () => {
  /** A sheet with `n` resistors, each on its own two-segment labelled net. */
  const bigSheet = (n: number): Schematic => {
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const y = 10 + i * 10;
      parts.push(`(symbol (lib_id "Device:R") (at 50.8 ${y} 0) (unit 1) (uuid "s${i}")
        (property "Reference" "R${i}" (at 53 ${y - 1} 0) (effects (font (size 1.27 1.27))))
        (property "Value" "10k" (at 53 ${y + 1} 0) (effects (font (size 1.27 1.27)))))`);
      parts.push(`(wire (pts (xy 50.8 ${y - 3.81}) (xy 63.5 ${y - 3.81})) (uuid "w${i}"))`);
      parts.push(
        `(label "N${i}" (at 63.5 ${y - 3.81} 0) (effects (font (size 1.27 1.27))) (uuid "l${i}"))`,
      );
    }
    return readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4")
        (lib_symbols
          (symbol "Device:R"
            (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
            (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
            (symbol "R_0_1"
              (pin passive line (at 0 3.81 270) (length 1.27) (name "A") (number "1"))
              (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
        ${parts.join('\n')})`),
    );
  };

  it('builds a 1200-symbol sheet without the quadratic scan', () => {
    // The original resolved every id by scanning the document, and every symbol
    // pin by re-running enumeratePins — which walks every symbol and allocates
    // every pin. On a sheet this size that is tens of millions of operations,
    // and the panel rebuilds on *every* document change.
    //
    // The budget separates the two shapes rather than measuring performance.
    // Measured on this fixture: indexed ~0.14 s, per-item-scan ~3.0 s. 1.5 s is
    // ten times the linear cost and half the quadratic one, so it has room to
    // be slow on a loaded machine and still cannot pass the bug.
    const d = bigSheet(1200);
    const l = new Map(d.libSymbols.map((s) => [s.libId, s]));
    const started = Date.now();
    const tree = buildNetNavigator(d, l, fmt);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(tree.length).toBeGreaterThan(1000);
    // And it still describes things correctly at that size.
    const first = tree.find((n) => n.name.endsWith('N0'))!;
    expect(first.items.some((i) => i.text.startsWith("Label 'N0'"))).toBe(true);
    expect(first.items.some((i) => i.text.startsWith("Symbol 'R0' pin '1'"))).toBe(true);
  });

  it('an index built once answers the same as one built per call', () => {
    // The bulk path passes a shared index; the single-lookup API builds its
    // own. They must not be allowed to drift.
    const d = bigSheet(5);
    const l = new Map(d.libSymbols.map((s) => [s.libId, s]));
    const shared = netNavigatorIndex(d, l);
    for (const id of ['w0', 'l0', 's0:pin0', 'nope']) {
      expect(netNavigatorItemText(d, l, id, fmt, shared)).toEqual(
        netNavigatorItemText(d, l, id, fmt),
      );
    }
  });
});
