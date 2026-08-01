// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Editing a label's text and shape (Properties): the replaceLabel command and
 * the lossless writer patch for `(shape …)` on global/hierarchical labels.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { replaceLabel } from '@ziroeda/eeschema/src/tools/mutate.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';
import { makeLabel } from '@ziroeda/eeschema/src/tools/build.js';
import { globalLabelShape, labelBox } from '@ziroeda/eeschema/src/tools/bbox.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (label "NET1" (at 50 50 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "loc-1"))
  (global_label "BUS_A" (shape input) (at 80 60 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "glb-1"))
)`;

const load = () => readSchematic(parse(SCH));

describe('replaceLabel', () => {
  it('edits a net label’s text and round-trips through the writer', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'loc-1')!;
    const idx = doc.labels.indexOf(orig);
    const after = replaceLabel(idx, { ...orig, text: '+3V3' }).apply(doc);
    expect(after.labels[idx]!.text).toBe('+3V3');
    expect(serializeSchematic(after)).toContain('(label "+3V3"');
  });

  it('edits a global label’s shape and it round-trips', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'glb-1')!;
    const idx = doc.labels.indexOf(orig);
    expect(orig.shape).toBe('input');
    const after = replaceLabel(idx, { ...orig, shape: 'output' }).apply(doc);
    const text = serializeSchematic(after);
    expect(text).toContain('(shape output)');
    expect(text).not.toContain('(shape input)');
  });

  it('is undoable through History', () => {
    const doc = load();
    const h = new History();
    const idx = doc.labels.findIndex((l) => l.uuid === 'loc-1');
    const after = h.execute(doc, replaceLabel(idx, { ...doc.labels[idx]!, text: 'CHANGED' }));
    expect(after.labels[idx]!.text).toBe('CHANGED');
    const undone = h.undo(after)!;
    expect(undone.labels[idx]!.text).toBe('NET1');
  });
});

describe('writeLabel formatting/orientation patches', () => {
  it('bold + text size edits serialize into the (effects (font …)) node', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'loc-1')!;
    const idx = doc.labels.indexOf(orig);
    const after = replaceLabel(idx, {
      ...orig,
      effects: { hidden: false, ...orig.effects, bold: true, fontSize: [25400, 25400] },
    }).apply(doc);
    const text = serializeSchematic(after);
    expect(text).toContain('(bold yes)');
    expect(text).toContain('(size 2.54 2.54)');
  });

  it('an orientation edit updates the (at x y angle) argument', () => {
    const doc = load();
    const orig = doc.labels.find((l) => l.uuid === 'loc-1')!;
    const idx = doc.labels.indexOf(orig);
    const after = replaceLabel(idx, { ...orig, angle: 90 }).apply(doc);
    expect(serializeSchematic(after)).toContain('(at 50 50 90)');
  });

  it('an untouched label round-trips byte-stable despite the new patches', () => {
    const doc = load();
    const before = serializeSchematic(doc);
    const orig = doc.labels.find((l) => l.uuid === 'glb-1')!;
    const idx = doc.labels.indexOf(orig);
    // Identity replace: nothing semantically changed, nothing should move.
    const after = replaceLabel(idx, { ...orig }).apply(doc);
    expect(serializeSchematic(after)).toBe(before);
  });
});

describe('labelBox measures its text (SCH_LABEL::GetBodyBoundingBox)', () => {
  const label = (text: string, fontSize = mmToIU(1.27)) =>
    makeLabel('label', text, { x: 0, y: 0 }, { fontSize });

  it('gives a narrow string a narrower box than a wide one', () => {
    // The old estimate was length x height x 0.7, so these two came out
    // identical - three characters each - when on screen they are nothing
    // like the same width.
    const thin = labelBox(label('III'));
    const wide = labelBox(label('WWW'));
    expect(wide.maxX - wide.minX).toBeGreaterThan(thin.maxX - thin.minX);
  });

  it('grows with the text', () => {
    const short = labelBox(label('A'));
    const long = labelBox(label('AAAAAAAA'));
    expect(long.maxX - long.minX).toBeGreaterThan(short.maxX - short.minX);
  });

  it('scales with the text height', () => {
    const small = labelBox(label('CLK', mmToIU(1)));
    const big = labelBox(label('CLK', mmToIU(2)));
    expect(big.maxX - big.minX).toBeGreaterThan(small.maxX - small.minX);
  });

  it('boxes a global label by its outline, not its text', () => {
    // SCH_LABEL_BASE::GetBodyBoundingBox merges CreateGraphicShape's points:
    // the flag is bigger than the letters on every side, and all of it is
    // clickable.
    const text = makeLabel('label', 'CLK', { x: 0, y: 0 }, { fontSize: mmToIU(1.27) });
    const flag = makeLabel(
      'global_label',
      'CLK',
      { x: 0, y: 0 },
      {
        fontSize: mmToIU(1.27),
        shape: 'bidirectional',
      },
    );
    const t = labelBox(text);
    const g = labelBox(flag);
    expect(g.maxX - g.minX).toBeGreaterThan(t.maxX - t.minX);
    expect(g.maxY - g.minY).toBeGreaterThan(t.maxY - t.minY);
  });

  it('gives an input-shaped global label the same box as its drawn outline', () => {
    const flag = makeLabel(
      'global_label',
      'D0',
      { x: mmToIU(10), y: mmToIU(10) },
      {
        fontSize: mmToIU(1.27),
        shape: 'input',
      },
    );
    const pts = globalLabelShape(flag);
    const box = labelBox(flag);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(box.minX);
      expect(p.x).toBeLessThanOrEqual(box.maxX);
      expect(p.y).toBeGreaterThanOrEqual(box.minY);
      expect(p.y).toBeLessThanOrEqual(box.maxY);
    }
  });

  it('still hangs off the anchor per the justification', () => {
    const l = makeLabel('label', 'CLK', { x: 0, y: 0 }, { fontSize: mmToIU(1.27) });
    const right = labelBox({
      ...l,
      effects: { ...(l.effects ?? { hidden: false }), justify: ['right'] },
    });
    expect(right.maxX).toBe(0);
    expect(right.minX).toBeLessThan(0);
  });
});
