// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order sections are written in.
 *
 * KiCad sorts a screen's items into a multiset keyed on (type ordinal, uuid)
 * before writing — "Enforce item ordering" in `SCH_IO_KICAD_SEXPR::Format` — so
 * the sequence is the `KICAD_T` enum's, from `include/core/typeinfo.h`, not the
 * order the items happen to sit in.
 *
 * The bundled ecc83 demo pins most of this by byte-comparison, but it contains
 * no global or hierarchical labels, so swapping those two emitted nothing
 * different and the demo stayed green. Our model keeps all four label kinds in
 * one array while KiCad gives each its own ordinal, which is exactly where a
 * mistake would go unnoticed — hence a fixture with one of each.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';

const FIXTURE = `(kicad_sch (version 20250114) (generator "test") (paper "A4") (lib_symbols)
  (sheet (at 60 60) (size 20 20) (stroke (width 0.1) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh-1")
    (property "Sheetname" "sub" (at 60 59 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 60 81 0)
      (effects (font (size 1.27 1.27)))))
  (hierarchical_label "H" (shape input) (at 40 10 0)
    (effects (font (size 1.27 1.27))) (uuid "hl-1"))
  (junction (at 10 10) (diameter 0.9) (color 0 0 0 0) (uuid "j-1"))
  (global_label "G" (shape input) (at 30 10 0)
    (effects (font (size 1.27 1.27))) (uuid "gl-1"))
  (text "T" (at 50 10 0) (effects (font (size 1.27 1.27))) (uuid "t-1"))
  (label "L" (at 20 10 0) (effects (font (size 1.27 1.27))) (uuid "l-1"))
  (rectangle (start 10 30) (end 25 40)
    (stroke (width 0.1) (type solid)) (fill (type none)) (uuid "g-1"))
  (wire (pts (xy 70 10) (xy 90 10)) (stroke (width 0.2) (type solid)) (uuid "w-1")))`;

describe('sections are written in KICAD_T order', () => {
  const out = serializeSchematic(readSchematic(parse(FIXTURE)));
  const at = (token: string): number => out.indexOf(token);

  it('the fixture reaches every kind under test', () => {
    // A token that failed to appear would make every comparison below pass on
    // -1 === -1.
    for (const t of [
      '(rectangle',
      '(text ',
      '(junction',
      '(wire',
      '(label',
      '(global_label',
      '(hierarchical_label',
      '(sheet',
    ]) {
      expect(at(t), `${t} missing from the output`).toBeGreaterThan(-1);
    }
  });

  it('shape, then text, before the connectivity items', () => {
    expect(at('(rectangle')).toBeLessThan(at('(text '));
    expect(at('(text ')).toBeLessThan(at('(junction'));
  });

  it('junction before wire', () => {
    // SCH_JUNCTION_T is three ordinals ahead of SCH_LINE_T. We used to emit
    // lines first.
    expect(at('(junction')).toBeLessThan(at('(wire'));
  });

  it('label, then global_label, then hierarchical_label', () => {
    // The three consecutive ordinals our model flattens into one array.
    expect(at('(label')).toBeLessThan(at('(global_label'));
    expect(at('(global_label')).toBeLessThan(at('(hierarchical_label'));
  });

  it('sheets last', () => {
    expect(at('(sheet')).toBeGreaterThan(at('(hierarchical_label'));
  });
});
