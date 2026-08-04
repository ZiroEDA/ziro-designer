// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The four text checks: height, thickness, and the two mirroring ones.
 * Counterparts: `drc_test_provider_text_dims.cpp` and
 * `drc_test_provider_text_mirroring.cpp`.
 *
 * Height and thickness are *rule-driven*: nothing in Board Setup expresses
 * them, so with no `.kicad_dru` there is nothing to check. Mirroring is the
 * opposite — it is not rule-driven at all and always runs.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'user',
  text: 'REV A',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  layer: 'F.SilkS',
  size: { x: MM(1), y: MM(1) },
  thickness: MM(0.15),
  source: EMPTY,
  ...over,
});

const board = (texts: PcbTextItem[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts,
  dimensions: [],
  textBoxes: [],
  tables: [],
  groups: [],
  source: EMPTY,
});

const BASE: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const codes = (b: Board, code: string, dru?: string) =>
  runDrc(b, { ...BASE, ...(dru ? { customRules: parseDrcRules(dru) } : {}) }).filter(
    (v) => v.code === code,
  );

describe('text height', () => {
  it('is not checked at all without a rule', () => {
    expect(codes(board([text({ size: { x: MM(0.1), y: MM(0.1) } })]), 'text_height')).toHaveLength(
      0,
    );
  });

  it('reports text shorter than the rule minimum', () => {
    const v = codes(
      board([text({ size: { x: MM(0.5), y: MM(0.5) } })]),
      'text_height',
      `(version 1) (rule "big" (constraint text_height (min 1mm)))`,
    );

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('min height');
    expect(v[0]!.message).toContain("rule 'big'");
  });

  it('reports text taller than the rule maximum', () => {
    const v = codes(
      board([text({ size: { x: MM(3), y: MM(3) } })]),
      'text_height',
      `(version 1) (rule "small" (constraint text_height (max 2mm)))`,
    );

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('max height');
  });

  it('measures the y size, which is the height', () => {
    // A wide but short text fails a height minimum; the x size is not it.
    const b = board([text({ size: { x: MM(5), y: MM(0.5) } })]);

    expect(
      codes(b, 'text_height', `(version 1) (rule "r" (constraint text_height (min 1mm)))`),
    ).toHaveLength(1);
  });

  it('accepts text inside the range', () => {
    const b = board([text({ size: { x: MM(1.5), y: MM(1.5) } })]);

    expect(
      codes(
        b,
        'text_height',
        `(version 1) (rule "r" (constraint text_height (min 1mm) (max 2mm)))`,
      ),
    ).toHaveLength(0);
  });

  it('applies only on the layer the rule names', () => {
    const b = board([text({ layer: 'F.SilkS', size: { x: MM(0.5), y: MM(0.5) } })]);
    const dru = `(version 1) (rule "r" (layer "B.SilkS") (constraint text_height (min 1mm)))`;

    expect(codes(b, 'text_height', dru)).toHaveLength(0);
  });
});

describe('text thickness', () => {
  it('reports a pen thinner than the rule minimum', () => {
    const b = board([text({ thickness: MM(0.05), size: { x: MM(2), y: MM(2) } })]);

    expect(
      codes(b, 'text_thickness', `(version 1) (rule "r" (constraint text_thickness (min 0.15mm)))`),
    ).toHaveLength(1);
  });

  it('computes the auto pen width when the file gives none', () => {
    // GetEffectiveTextPenWidth: a stored 0 means auto, which is 1/8 of the
    // smaller text dimension — 0.25 mm for 2 mm text, so a 0.15 mm minimum
    // passes and a 0.3 mm one does not.
    const b = board([text({ thickness: 0, size: { x: MM(2), y: MM(2) } })]);

    expect(
      codes(b, 'text_thickness', `(version 1) (rule "r" (constraint text_thickness (min 0.15mm)))`),
    ).toHaveLength(0);
    expect(
      codes(b, 'text_thickness', `(version 1) (rule "r" (constraint text_thickness (min 0.3mm)))`),
    ).toHaveLength(1);
  });

  it('uses the bolder auto width for bold text', () => {
    // Bold is 1/5 rather than 1/8: 0.4 mm for 2 mm text.
    const b = board([text({ thickness: 0, bold: true, size: { x: MM(2), y: MM(2) } })]);

    expect(
      codes(b, 'text_thickness', `(version 1) (rule "r" (constraint text_thickness (min 0.3mm)))`),
    ).toHaveLength(0);
  });

  it('clamps a pen wider than a quarter of the text', () => {
    // ClampTextPenSize: a 1 mm pen on 1 mm text draws at 0.25 mm, so a maximum
    // of 0.3 mm is met even though the file says 1 mm.
    const b = board([text({ thickness: MM(1), size: { x: MM(1), y: MM(1) } })]);

    expect(
      codes(b, 'text_thickness', `(version 1) (rule "r" (constraint text_thickness (max 0.3mm)))`),
    ).toHaveLength(0);
  });

  it('is not checked at all without a rule', () => {
    const b = board([text({ thickness: MM(0.01), size: { x: MM(2), y: MM(2) } })]);

    expect(codes(b, 'text_thickness')).toHaveLength(0);
  });
});

describe('mirroring', () => {
  it('reports mirrored text on a front layer', () => {
    expect(
      codes(board([text({ layer: 'F.SilkS', mirror: true })]), 'mirrored_text_on_front_layer'),
    ).toHaveLength(1);
  });

  it('reports non-mirrored text on a back layer', () => {
    expect(
      codes(board([text({ layer: 'B.SilkS', mirror: false })]), 'nonmirrored_text_on_back_layer'),
    ).toHaveLength(1);
  });

  it('accepts the two correct combinations', () => {
    const b = board([
      text({ layer: 'F.SilkS', mirror: false }),
      text({ layer: 'B.SilkS', mirror: true }),
    ]);

    expect(codes(b, 'mirrored_text_on_front_layer')).toHaveLength(0);
    expect(codes(b, 'nonmirrored_text_on_back_layer')).toHaveLength(0);
  });

  it('covers copper, mask and fab as well as silkscreen', () => {
    const b = board([
      text({ layer: 'F.Cu', mirror: true }),
      text({ layer: 'F.Mask', mirror: true }),
      text({ layer: 'F.Fab', mirror: true }),
    ]);

    expect(codes(b, 'mirrored_text_on_front_layer')).toHaveLength(3);
  });

  it('ignores a layer that is neither front nor back', () => {
    // User layers and Edge.Cuts have no side, so mirroring says nothing.
    const b = board([text({ layer: 'Cmts.User', mirror: true })]);

    expect(codes(b, 'mirrored_text_on_front_layer')).toHaveLength(0);
    expect(codes(b, 'nonmirrored_text_on_back_layer')).toHaveLength(0);
  });

  it('skips hidden text', () => {
    const b = board([text({ layer: 'F.SilkS', mirror: true, hide: true })]);

    expect(codes(b, 'mirrored_text_on_front_layer')).toHaveLength(0);
  });

  it('runs with no rule file, being the one text check that is not rule-driven', () => {
    expect(
      codes(board([text({ layer: 'B.Fab', mirror: false })]), 'nonmirrored_text_on_back_layer'),
    ).toHaveLength(1);
  });
});
