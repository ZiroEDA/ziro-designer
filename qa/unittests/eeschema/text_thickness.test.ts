// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(font … (thickness …))` on schematic text — an explicit glyph pen.
 *
 * The format always had it: `EDA_TEXT::Format` writes the token whenever
 * `GetAutoThickness()` is false, and eeschema's parser reads `T_thickness`. We
 * had neither side, so the value existed in the file and nowhere in the model.
 *
 * That was survivable only by luck. `patchEffects` edits an item's own node in
 * place and never touched the token, so a file that was merely opened and saved
 * kept it — but nothing could *read* it, so the text drew with the default pen
 * while KiCad drew it thicker, and nothing could set one either.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { makeLabel } from '@ziroeda/eeschema/src/tools/build.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const SRC = `(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
  (text "thick" (at 10 10 0)
    (effects (font (size 1.27 1.27) (thickness 0.5)) (justify left bottom)) (uuid "t1"))
  (text "auto" (at 20 10 0)
    (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "t2")))`;

const doc = (): Schematic => readSchematic(parse(SRC));

describe('reading it', () => {
  it('lands in the model, in IU', () => {
    expect(doc().labels[0]!.effects?.thickness).toBe(mmToIU(0.5));
  });

  it('and stays absent when the file gives none', () => {
    // Absence is meaningful — it is KiCad's "auto" — so it must not become 0.
    expect(doc().labels[1]!.effects?.thickness).toBeUndefined();
  });
});

describe('writing it', () => {
  it('round-trips through a save', () => {
    const back = readSchematic(parse(serializeSchematic(doc())));
    expect(back.labels[0]!.effects?.thickness).toBe(mmToIU(0.5));
    expect(back.labels[1]!.effects?.thickness).toBeUndefined();
  });

  it('survives an unrelated edit to the same text', () => {
    // The failure mode this guards: a writer that rebuilds `(effects …)` from a
    // model that cannot hold the token drops it on the first edit, which is how
    // every other lagging-patcher bug in this codebase has looked.
    const d = doc();
    const moved = { ...d.labels[0]!, at: { x: mmToIU(30), y: mmToIU(30) } };
    const back = readSchematic(parse(serializeSchematic({ ...d, labels: [moved, d.labels[1]!] })));
    expect(back.labels[0]!.effects?.thickness).toBe(mmToIU(0.5));
  });

  it('and a newly built label can carry one', () => {
    const made = makeLabel('text', 'x', { x: 0, y: 0 }, { thickness: mmToIU(0.3) });
    const d = readSchematic(parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`));
    const back = readSchematic(parse(serializeSchematic({ ...d, labels: [made] })));
    expect(back.labels[0]!.effects?.thickness).toBe(mmToIU(0.3));
  });

  it('writes no token for a label that did not ask for one', () => {
    const made = makeLabel('text', 'x', { x: 0, y: 0 });
    const d = readSchematic(parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`));
    expect(serializeSchematic({ ...d, labels: [made] })).not.toContain('thickness');
  });
});
