// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Change To": turning a label, free text, netclass flag or text box into
 * another of those (SCH_EDIT_TOOL::ChangeTextType).
 *
 * The interesting parts are not the retagging but the two conversions that
 * cannot be lossless: text becoming a label has to become a valid *net name*,
 * and a text box has an extent where a label has an anchor.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { changeTextType, validNetname } from '@ziroeda/eeschema/src/tools/change_text_type.js';
import { labelFields } from '@ziroeda/eeschema/src/tools/label_properties.js';

const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  (label "SIG" (at 10 10 0) (uuid "lb1") (effects (font (size 1.27 1.27) (bold yes))))
  (text "some note" (at 30 10 0) (uuid "tx1"))
  (text_box "boxed" (at 50 10 0) (size 20 10) (uuid "tb1")
    (effects (font (size 1.27 1.27)) (justify left top)))
  (netclass_flag "" (shape round) (at 90 10 0) (length 2.54) (uuid "nf1")
    (property "Netclass" "HS" (at 90 10 0)))
)`;

const sch = readSchematic(parse(DOC));
const LABEL = refId('label', 'lb1', 0);
const TEXT = refId('label', 'tx1', 1);
const TEXTBOX = refId('textbox', 'tb1', 0);
const FLAG = refId('directive', 'nf1', 0);

const run = (id: string, to: Parameters<typeof changeTextType>[2]) => {
  const cmd = changeTextType(sch, new Set([id]), to);
  expect(cmd, `no conversion produced for ${to}`).not.toBeNull();
  return cmd!.apply(sch);
};

describe('valid net names', () => {
  it('folds whitespace a net name cannot carry', () => {
    expect(validNetname('a\nb\tc')).toBe('a_b_c');
    expect(validNetname('two words')).toBe('two_words');
  });

  it('keeps the spaces inside a bus group, whose syntax uses them', () => {
    expect(validNetname('GRP{A B}')).toContain(' ');
  });

  it('never produces an unnamed net', () => {
    // An empty label would drive a net with no name at all.
    expect(validNetname('')).toBe('<empty>');
    expect(validNetname('   ')).toBe('___');
  });
});

describe('converting between the label kinds', () => {
  it('turns a local label into a global one', () => {
    const out = run(LABEL, 'global_label');
    expect(out.labels.filter((l) => l.kind === 'label')).toHaveLength(0);
    const g = out.labels.find((l) => l.kind === 'global_label')!;
    expect(g.text).toBe('SIG');
    expect(g.at).toEqual(sch.labels[0]!.at);
  });

  it('carries the font size and weight across', () => {
    const out = run(LABEL, 'hierarchical_label');
    const h = out.labels.find((l) => l.kind === 'hierarchical_label')!;
    expect(h.effects?.fontSize).toEqual(sch.labels[0]!.effects?.fontSize);
    expect(h.effects?.bold).toBe(true);
  });

  it('leaves an item that is already the target alone', () => {
    // ChangeTextType skips items whose type already matches.
    expect(changeTextType(sch, new Set([LABEL]), 'label')).toBeNull();
  });

  it('makes a net name out of free text', () => {
    const out = run(TEXT, 'label');
    // "some note" cannot be a net name with a space in it.
    expect(out.labels.find((l) => l.kind === 'label' && l.text === 'some_note')).toBeDefined();
  });

  it('does not fold text that stays text', () => {
    // Only a label's text is a net name; a text box keeps what it said.
    const out = run(TEXT, 'text_box');
    expect(out.textBoxes.at(-1)!.text).toBe('some note');
  });
});

describe('converting a text box', () => {
  it('anchors the label on the edge its text reads away from', () => {
    // Left-justified horizontal text: the label goes on the left edge, at the
    // middle of it, facing right.
    const out = run(TEXTBOX, 'label');
    const l = out.labels.at(-1)!;
    const tb = sch.textBoxes[0]!;
    const left = Math.min(tb.start.x, tb.end.x) + (tb.margins?.left ?? 0);
    expect(l.at.x).toBe(left);
    expect(l.at.y).toBeGreaterThan(Math.min(tb.start.y, tb.end.y));
    expect(l.at.y).toBeLessThan(Math.max(tb.start.y, tb.end.y));
    expect(l.angle).toBe(0);
  });

  it('gives a box built from a label the label’s own extent', () => {
    const out = run(LABEL, 'text_box');
    const box = out.textBoxes.at(-1)!;
    expect(box.end.x).toBeGreaterThan(box.start.x);
    expect(box.end.y).toBeGreaterThan(box.start.y);
  });
});

describe('converting a netclass flag', () => {
  it('becomes an <empty> label carrying its netclass as a field', () => {
    // ChangeTextType sets txt to "<empty>" for a directive, because it has no
    // text of its own, and then AddFields copies its netclass across. So the
    // label really is named "<empty>"; the netclass is not lost, it is a field.
    const out = run(FLAG, 'label');
    const l = out.labels.at(-1)!;
    expect(l.text).toBe('<empty>');
    expect(labelFields(l).find((f) => f.key === 'Netclass')?.value).toBe('HS');
    expect(out.directiveLabels).toHaveLength(0);
  });

  it('takes text as the netclass when converting the other way', () => {
    const out = run(TEXT, 'directive_label');
    const flag = out.directiveLabels!.at(-1)!;
    expect(flag.fields.find((f) => f.key === 'Netclass')?.value).toBe('some note');
  });
});

describe('the undo step', () => {
  it('puts all three arrays back', () => {
    const cmd = changeTextType(sch, new Set([LABEL]), 'global_label')!;
    const back = cmd.invert(sch).apply(cmd.apply(sch));
    expect(back.labels).toEqual(sch.labels);
    expect(back.directiveLabels).toEqual(sch.directiveLabels);
    expect(back.textBoxes).toEqual(sch.textBoxes);
  });
});

describe('the result saves', () => {
  it('round-trips a converted label', () => {
    const out = run(LABEL, 'global_label');
    const back = readSchematic(parse(serializeSchematic(out)));
    expect(back.labels.find((l) => l.kind === 'global_label')?.text).toBe('SIG');
    expect(back.labels.some((l) => l.kind === 'label')).toBe(false);
  });
});
