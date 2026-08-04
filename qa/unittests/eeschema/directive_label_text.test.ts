// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A directive label's own text. `SCH_DIRECTIVE_LABEL` is a `SCH_LABEL_BASE`, so
 * it has text like any other label and `GetMsgPanelInfo` shows it.
 *
 * It is usually empty in practice — the netclass travels in a field — which is
 * why it went unmodelled. "Usually empty" is not "absent": a file carrying one
 * round-tripped only through `source`, so nothing could read it and an edit
 * elsewhere in the node risked dropping it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { makeDirectiveLabel } from '@ziroeda/eeschema/src/tools/build.js';
import { replaceDirectiveLabel } from '@ziroeda/eeschema/src/tools/mutate.js';
import { getMsgPanelItems } from '@ziroeda/eeschema/src/tools/msg_panel.js';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();
const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const withText = (text: string): Schematic =>
  sheet(`(netclass_flag "${text}" (length 2.54) (shape round) (at 50 50 0)
     (effects (font (size 1.27 1.27)) (justify left)) (uuid "nc-1")
     (property "Netclass" "HV" (at 50 50 0) (effects (font (size 1.27 1.27)))))`);

describe('the reader', () => {
  it('keeps the text', () => {
    expect((withText('HV').directiveLabels ?? [])[0]!.text).toBe('HV');
  });

  it('reads an empty one as empty, not undefined', () => {
    expect((withText('').directiveLabels ?? [])[0]!.text).toBe('');
  });
});

describe('the writer', () => {
  it('round-trips the text unchanged', () => {
    const d = withText('HV');
    const back = readSchematic(parse(serializeSchematic(d)));
    expect((back.directiveLabels ?? [])[0]!.text).toBe('HV');
  });

  it('writes an edited text', () => {
    const d = withText('HV');
    const next = { ...(d.directiveLabels ?? [])[0]!, text: 'LV' };
    const out = serializeSchematic(replaceDirectiveLabel(0, next).apply(d));
    // Assert on the node's *own* first argument. The Netclass field is also
    // "HV", so a bare `not.toContain('"HV"')` would fail for the wrong reason
    // and passing it would mean the field had been clobbered.
    expect(/\(netclass_flag\s+"LV"/.test(out)).toBe(true);
    expect(/\(netclass_flag\s+"HV"/.test(out)).toBe(false);
    expect(out).toContain('"Netclass" "HV"');
  });

  it('leaves an untouched label byte-stable', () => {
    const d = withText('HV');
    const before = serializeSchematic(d);
    const identity = replaceDirectiveLabel(0, { ...(d.directiveLabels ?? [])[0]! }).apply(d);
    expect(serializeSchematic(identity)).toBe(before);
  });

  it('does not disturb the label’s other edits', () => {
    // The text patch runs before the position patch; both must land.
    const d = withText('HV');
    const orig = (d.directiveLabels ?? [])[0]!;
    const next = { ...orig, text: 'LV', at: { x: mmToIU(60), y: orig.at.y } };
    const back = readSchematic(parse(serializeSchematic(replaceDirectiveLabel(0, next).apply(d))));
    const got = (back.directiveLabels ?? [])[0]!;
    expect(got.text).toBe('LV');
    expect(got.at.x).toBe(mmToIU(60));
  });
});

describe('a newly built one', () => {
  it('starts with empty text, matching the node it builds', () => {
    const made = makeDirectiveLabel({ x: 0, y: 0 }, { netclass: 'HV' });
    expect(made.text).toBe('');
  });
});

describe('the message panel', () => {
  const rows = (d: Schematic) =>
    getMsgPanelItems(d, LIB, itemRefById(d, refId('directive', 'nc-1', 0))!, (n) => `${n}`);

  it('shows the label and its text', () => {
    expect(rows(withText('HV'))).toEqual([{ upper: 'Directive Label', lower: 'HV' }]);
  });

  it('has no Type row', () => {
    // GetMsgPanelInfo adds Type only for global labels, hierarchical labels and
    // sheet pins — a directive label is none of those, despite having a shape.
    expect(rows(withText('HV')).map((r) => r.upper)).not.toContain('Type');
  });
});
