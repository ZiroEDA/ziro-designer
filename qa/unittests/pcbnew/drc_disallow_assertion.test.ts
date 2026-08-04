// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two rule-only DRC checks: `disallow` and `assertion`.
 *
 * Neither has any Board Setup equivalent — without a `.kicad_dru` there is
 * nothing to check at all — so every test here is about what a rule file makes
 * DRC say. Counterparts: `drc_test_provider_disallow.cpp` and
 * `DRC_TEST_PROVIDER_MISC::testAssertions`.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (width = MM(0.2), layer = 'F.Cu', net = 1): PcbTrack => ({
  start: { x: 0, y: 0 },
  end: { x: MM(10), y: 0 },
  width,
  layer,
  net,
  source: EMPTY,
});

const via = (
  kind: PcbVia['kind'] = 'through',
  layers: [string, string] = ['F.Cu', 'B.Cu'],
): PcbVia => ({
  at: { x: MM(5), y: MM(5) },
  size: MM(0.6),
  drill: MM(0.3),
  layers,
  kind,
  net: 1,
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 1, name: 'In1.Cu', kind: 'signal' },
    { id: 2, name: 'In2.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'N1'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  groups: [],
  source: EMPTY,
  ...over,
});

/** Board-setup values loose enough that nothing else trips. */
const BASE: DrcOptions = {
  minClearance: MM(0.05),
  minTrackWidth: MM(0.05),
  minViaDiameter: MM(0.2),
  minViaAnnulus: MM(0.02),
  minThroughHole: MM(0.1),
  minHoleToHole: MM(0.1),
};

const run = (b: Board, dru: string, extra: Partial<DrcOptions> = {}) =>
  runDrc(b, { ...BASE, ...extra, customRules: parseDrcRules(dru) });

const notAllowed = (b: Board, dru: string, extra: Partial<DrcOptions> = {}) =>
  run(b, dru, extra).filter((v) => v.code === 'items_not_allowed');

const assertions = (b: Board, dru: string) =>
  run(b, dru).filter((v) => v.code === 'assertion_failure');

describe('disallow', () => {
  it('fires on the item kind it names', () => {
    const b = board({ tracks: [track()] });
    expect(notAllowed(b, `(version 1) (rule "no" (constraint disallow track))`)).toHaveLength(1);
  });

  it('leaves other kinds alone', () => {
    const b = board({ tracks: [track()] });
    expect(notAllowed(b, `(version 1) (rule "no" (constraint disallow zone))`)).toHaveLength(0);
  });

  it('names the rule in the message, as upstream does', () => {
    const b = board({ tracks: [track()] });
    const v = notAllowed(b, `(version 1) (rule "keepClear" (constraint disallow track))`);

    expect(v[0]!.message).toContain("rule 'keepClear'");
    expect(v[0]!.message).toContain('Items not allowed');
  });

  it('honours the rule condition', () => {
    const b = board({ tracks: [track()] });
    const dru = `(version 1)
      (rule "hv" (constraint disallow track) (condition "A.NetClass == 'HV'"))`;

    expect(notAllowed(b, dru)).toHaveLength(0);
    expect(notAllowed(b, dru, { netClassesOf: () => ['HV'] })).toHaveLength(1);
  });

  it('honours the rule layer', () => {
    const b = board({ tracks: [track(MM(0.2), 'F.Cu'), track(MM(0.2), 'In1.Cu')] });
    const v = notAllowed(b, `(version 1) (rule "i" (layer inner) (constraint disallow track))`);

    expect(v).toHaveLength(1);
  });

  it('makes no marker when the rule severity is ignore', () => {
    const b = board({ tracks: [track()] });
    const dru = `(version 1) (rule "no" (severity ignore) (constraint disallow track))`;

    expect(notAllowed(b, dru)).toHaveLength(0);
  });

  it('lets one constraint name several kinds at once', () => {
    const b = board({ tracks: [track()], vias: [via()] });
    expect(notAllowed(b, `(version 1) (rule "no" (constraint disallow track via))`)).toHaveLength(
      2,
    );
  });

  describe('via spans', () => {
    // Upstream's parser expands `via` to all four spans, but each span token
    // matches only itself — so `micro_via` must not catch a through via.
    const cases: [string, PcbVia][] = [
      ['through', via('through', ['F.Cu', 'B.Cu'])],
      ['micro', via('micro', ['F.Cu', 'In1.Cu'])],
      ['blind', via('blind', ['F.Cu', 'In1.Cu'])],
      ['buried', via('blind', ['In1.Cu', 'In2.Cu'])],
    ];

    for (const [name, v] of cases) {
      it(`\`via\` catches a ${name} via`, () => {
        const b = board({ vias: [v] });
        expect(notAllowed(b, `(version 1) (rule "no" (constraint disallow via))`)).toHaveLength(1);
      });
    }

    it('`micro_via` catches only the micro via', () => {
      const dru = `(version 1) (rule "no" (constraint disallow micro_via))`;

      expect(notAllowed(board({ vias: [via('micro', ['F.Cu', 'In1.Cu'])] }), dru)).toHaveLength(1);
      expect(notAllowed(board({ vias: [via('through')] }), dru)).toHaveLength(0);
    });

    it('tells blind from buried by the span, as IsBlindVia does', () => {
      // The file has one token for both; exactly one outer layer is blind.
      const blind = board({ vias: [via('blind', ['F.Cu', 'In1.Cu'])] });
      const buried = board({ vias: [via('blind', ['In1.Cu', 'In2.Cu'])] });
      const dru = `(version 1) (rule "no" (constraint disallow blind_via))`;

      expect(notAllowed(blind, dru)).toHaveLength(1);
      expect(notAllowed(buried, dru)).toHaveLength(0);
    });
  });

  it('reaches a drilled item through the hole pass', () => {
    // A via is evaluated twice, as itself and as its hole (HOLE_PROXY).
    const b = board({ vias: [via()] });

    expect(notAllowed(b, `(version 1) (rule "no" (constraint disallow hole))`)).toHaveLength(1);
    // A track has no hole, so the same rule leaves it alone.
    expect(
      notAllowed(
        board({ tracks: [track()] }),
        `(version 1) (rule "no" (constraint disallow hole))`,
      ),
    ).toHaveLength(0);
  });

  it('lets a later rule stand when an earlier one does not name the kind', () => {
    // Upstream skips a non-matching disallow constraint rather than ending the
    // lookup, so the kind that *is* named still fires.
    const b = board({ tracks: [track()] });
    const dru = `(version 1)
      (rule "zones" (constraint disallow zone))
      (rule "tracks" (constraint disallow track))`;

    const v = notAllowed(b, dru);
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("rule 'tracks'");
  });
});

describe('assertion', () => {
  it('reports an assertion that does not hold', () => {
    const b = board({ tracks: [track(MM(0.1))] });
    const v = assertions(b, `(version 1) (rule "wide" (constraint assertion "A.Width > 0.2mm"))`);

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("rule 'wide'");
  });

  it('says nothing when it holds', () => {
    const b = board({ tracks: [track(MM(0.5))] });
    expect(
      assertions(b, `(version 1) (rule "wide" (constraint assertion "A.Width > 0.2mm"))`),
    ).toHaveLength(0);
  });

  it('reports every failing assertion, not just the last', () => {
    // Assertions are the one constraint type that does not resolve to a single
    // winner: EvalRules would report at most one and drop the rest.
    const b = board({ tracks: [track(MM(0.1))] });
    const v = assertions(
      b,
      `(version 1)
       (rule "a" (constraint assertion "A.Width > 0.2mm"))
       (rule "b" (constraint assertion "A.Width > 0.3mm"))`,
    );

    expect(v).toHaveLength(2);
    expect(v.map((x) => x.message).join()).toContain("rule 'a'");
    expect(v.map((x) => x.message).join()).toContain("rule 'b'");
  });

  it('applies only where its condition holds', () => {
    const b = board({ tracks: [track(MM(0.1), 'F.Cu'), track(MM(0.1), 'In1.Cu')] });
    const v = assertions(
      b,
      `(version 1)
       (rule "w" (constraint assertion "A.Width > 0.2mm") (condition "A.Layer == 'In1.Cu'"))`,
    );

    expect(v).toHaveLength(1);
  });

  it('does not report an assertion it cannot compile', () => {
    // A broken expression is a rule-file problem, not a board one; treating it
    // as a failure would mark every item on the board.
    const b = board({ tracks: [track()] });
    expect(assertions(b, `(version 1) (rule "x" (constraint assertion "A.Width +"))`)).toHaveLength(
      0,
    );
  });
});

describe('units in an expression', () => {
  // `0.2mm` in a condition has to scale exactly as `(min 0.2mm)` does, or a
  // rule and its assertion would disagree about the same number.
  const b = board({ tracks: [track(MM(0.25))] });

  it('scales a suffixed literal to IU', () => {
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > 0.2mm"))`),
    ).toHaveLength(0);
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > 0.3mm"))`),
    ).toHaveLength(1);
  });

  it('accepts a space before the unit', () => {
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > 0.3 mm"))`),
    ).toHaveLength(1);
  });

  it('reads mil and in too', () => {
    // 0.25 mm is about 9.84 mil.
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > 5mil"))`),
    ).toHaveLength(0);
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > 20mil"))`),
    ).toHaveLength(1);
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > 0.1in"))`),
    ).toHaveLength(1);
  });

  it('leaves a bare number as IU, since the resolver has no default unit', () => {
    const iu = MM(0.25);
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > ${iu - 1}"))`),
    ).toHaveLength(0);
    expect(
      assertions(b, `(version 1) (rule "a" (constraint assertion "A.Width > ${iu + 1}"))`),
    ).toHaveLength(1);
  });
});

describe('no rules', () => {
  it('checks nothing at all without a rule file', () => {
    const b = board({ tracks: [track()], vias: [via()] });
    const v = runDrc(b, BASE);

    expect(v.filter((x) => x.code === 'items_not_allowed')).toHaveLength(0);
    expect(v.filter((x) => x.code === 'assertion_failure')).toHaveLength(0);
  });
});
