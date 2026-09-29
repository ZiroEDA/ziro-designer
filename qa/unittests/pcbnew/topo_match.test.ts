// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * TMATCH (`connectivity/topo_match.cpp`): the footprint-set isomorphism behind
 * Repeat Layout. Each test names what a wrong port would get wrong: a match
 * that ignores nets, a tie broken the wrong way, a global rail read as a
 * mismatch, a reason string that does not say why.
 */
import { describe, expect, it } from 'vitest';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  COMPONENT,
  CONNECTION_GRAPH,
  type COMPONENT_MATCHES,
  TOPOLOGY_MISMATCH_REASON,
} from '@ziroeda/pcbnew/connectivity/topo_match.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo_item.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';

const U_A = '11111111-1111-1111-1111-111111111111';
const U_B = '22222222-2222-2222-2222-222222222222';

interface FpSpec {
  ref: string;
  fpid?: string;
  value?: string;
  path?: string[];
  /** [pad number, net code] */
  pads: [string, number][];
}

function makeBoard(nets: number): BOARD {
  const b = new BOARD();
  for (let i = 1; i <= nets; i++) b.Add(new NETINFO_ITEM(b, `N${i}`, i));
  return b;
}

function mk(b: BOARD, s: FpSpec): FOOTPRINT {
  const fp = new FOOTPRINT(b);
  fp.SetReference(s.ref);
  fp.SetFPIDAsString(s.fpid ?? 'L:R');
  if (s.value) fp.SetValue(s.value);
  if (s.path) fp.SetPath(s.path);
  b.Add(fp);
  for (const [num, net] of s.pads) {
    const p = new PAD(fp);
    p.SetNumber(num);
    if (net > 0) p.SetNet(b.FindNet(net)!);
    fp.Add(p);
  }
  return fp;
}

const graph = (fps: FOOTPRINT[]): CONNECTION_GRAPH =>
  CONNECTION_GRAPH.BuildFromFootprintSet(new Set(fps));

function run(
  a: FOOTPRINT[],
  t: FOOTPRINT[],
  opts: { extA?: number[]; extT?: number[] } = {},
): { ok: boolean; map: Map<string, string>; reasons: TOPOLOGY_MISMATCH_REASON[] } {
  const ga = new CONNECTION_GRAPH();
  const gt = new CONNECTION_GRAPH();
  for (const f of a) ga.AddFootprint(f, { x: 0, y: 0 });
  for (const f of t) gt.AddFootprint(f, { x: 0, y: 0 });
  ga.BuildConnectivity(new Set(opts.extA ?? []));
  gt.BuildConnectivity(new Set(opts.extT ?? []));
  const res: COMPONENT_MATCHES = new Map();
  const reasons: TOPOLOGY_MISMATCH_REASON[] = [];
  const ok = ga.FindIsomorphism(gt, res, reasons);
  return {
    ok,
    map: new Map([...res].map(([k, v]) => [k.GetReference(), v.GetReference()])),
    reasons,
  };
}

describe('TMATCH: isomorphism', () => {
  it('maps two identical channels component to component', () => {
    const b = makeBoard(6);
    const a = [
      mk(b, {
        ref: 'U1',
        fpid: 'L:U',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 3],
        ],
      }),
    ];
    const t = [
      mk(b, {
        ref: 'U11',
        fpid: 'L:U',
        pads: [
          ['1', 4],
          ['2', 5],
        ],
      }),
      mk(b, {
        ref: 'R11',
        pads: [
          ['1', 4],
          ['2', 6],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.ok).toBe(true);
    expect(r.map).toEqual(
      new Map([
        ['U1', 'U11'],
        ['R1', 'R11'],
      ]),
    );
  });

  it('refuses when the nets connect different pads, and says which pad', () => {
    const b = makeBoard(6);
    const a = [
      mk(b, {
        ref: 'U1',
        fpid: 'L:U',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 3],
        ],
      }),
    ];
    // Here R11 is wired to pad 2 of the U, not pad 1.
    const t = [
      mk(b, {
        ref: 'U11',
        fpid: 'L:U',
        pads: [
          ['1', 4],
          ['2', 5],
        ],
      }),
      mk(b, {
        ref: 'R11',
        pads: [
          ['1', 5],
          ['2', 6],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons[0]!.m_reason).toMatch(/^Pad \d of \w+ (cannot match candidate pad|is on net)/);
  });

  it('a differing component count is its own reason', () => {
    const b = makeBoard(2);
    const a = [
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
    ];
    const t = [
      mk(b, {
        ref: 'R11',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R12',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]!.m_reason).toBe('Component count mismatch');
  });

  it('an empty side is its own reason', () => {
    const b = makeBoard(1);
    const r = run([], [mk(b, { ref: 'R1', pads: [['1', 1]] })]);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]!.m_reason).toBe('One or both of the areas has no components assigned.');
  });

  it('a library link mismatch names both footprints', () => {
    const b = makeBoard(2);
    const a = [
      mk(b, {
        ref: 'R1',
        fpid: 'L:R0603',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
    ];
    const t = [
      mk(b, {
        ref: 'R11',
        fpid: 'L:R0805',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]!.m_reason).toBe(
      "Library link mismatch: R1 expects 'L:R0603' but candidate R11 is 'L:R0805'.",
    );
  });
});

describe('TMATCH: breaking ties', () => {
  it('prefers the counterpart whose symbol instance UUID matches', () => {
    const b = makeBoard(8);
    const a = [
      mk(b, {
        ref: 'R1',
        path: [U_A],
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R2',
        path: [U_B],
        pads: [
          ['1', 3],
          ['2', 4],
        ],
      }),
    ];
    const t = [
      mk(b, {
        ref: 'R11',
        path: [U_B],
        pads: [
          ['1', 5],
          ['2', 6],
        ],
      }),
      mk(b, {
        ref: 'R12',
        path: [U_A],
        pads: [
          ['1', 7],
          ['2', 8],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.ok).toBe(true);
    // Without the tie-break the alphabetical order would give R1 -> R11.
    expect(r.map.get('R1')).toBe('R12');
    expect(r.map.get('R2')).toBe('R11');
  });

  it('falls back to the footprint value when the UUID cannot decide', () => {
    const b = makeBoard(8);
    const a = [
      mk(b, {
        ref: 'R1',
        value: '10k',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R2',
        value: '1k',
        pads: [
          ['1', 3],
          ['2', 4],
        ],
      }),
    ];
    const t = [
      mk(b, {
        ref: 'R11',
        value: '1k',
        pads: [
          ['1', 5],
          ['2', 6],
        ],
      }),
      mk(b, {
        ref: 'R12',
        value: '10k',
        pads: [
          ['1', 7],
          ['2', 8],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.ok).toBe(true);
    expect(r.map.get('R1')).toBe('R12');
    expect(r.map.get('R2')).toBe('R11');
  });

  it('candidates are ranked by how many pads keep the same net, before the reference', () => {
    const b = makeBoard(8);
    const a = [
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R2',
        pads: [
          ['1', 3],
          ['2', 4],
        ],
      }),
    ];
    // R12 shares both nets with R1, R11 shares none: R11 wins alphabetically only if the
    // similarity score is ignored or inverted.
    const t = [
      mk(b, {
        ref: 'R11',
        pads: [
          ['1', 7],
          ['2', 8],
        ],
      }),
      mk(b, {
        ref: 'R12',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.ok).toBe(true);
    expect(r.map.get('R1')).toBe('R12');
  });

  it('a value shared by several candidates decides nothing', () => {
    const b = makeBoard(8);
    const a = [
      mk(b, {
        ref: 'R1',
        value: '10k',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R2',
        value: '10k',
        pads: [
          ['1', 3],
          ['2', 4],
        ],
      }),
    ];
    const t = [
      mk(b, {
        ref: 'R11',
        value: '10k',
        pads: [
          ['1', 5],
          ['2', 6],
        ],
      }),
      mk(b, {
        ref: 'R12',
        value: '10k',
        pads: [
          ['1', 7],
          ['2', 8],
        ],
      }),
    ];
    const r = run(a, t);
    expect(r.map.get('R1')).toBe('R11');
  });
});

describe('TMATCH: external nets', () => {
  it('a rail shared in one channel and split in the other only matches when it is external', () => {
    const b = makeBoard(6);
    // Net 2 is one rail across U1 and R1 here, but two separate nets in the other channel.
    const a = [
      mk(b, {
        ref: 'U1',
        fpid: 'L:U',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
    ];
    const t = [
      mk(b, {
        ref: 'U11',
        fpid: 'L:U',
        pads: [
          ['1', 4],
          ['2', 5],
        ],
      }),
      mk(b, {
        ref: 'R11',
        pads: [
          ['1', 4],
          ['2', 6],
        ],
      }),
    ];
    expect(run(a, t).ok).toBe(false);
    // The target graph's own external set is what the net-consistency check consults.
    expect(run(a, t, { extA: [2], extT: [] }).ok).toBe(false);
    expect(run(a, t, { extA: [2], extT: [2] }).ok).toBe(true);
  });

  it('BuildFromFootprintSet treats a net with 2+ pads in both channels as global', () => {
    const b = makeBoard(3);
    const a = [
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R2',
        pads: [
          ['1', 1],
          ['2', 3],
        ],
      }),
    ];
    const o = [
      mk(b, {
        ref: 'R11',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R12',
        pads: [
          ['1', 1],
          ['2', 3],
        ],
      }),
    ];
    const g = CONNECTION_GRAPH.BuildFromFootprintSet(new Set(a), new Set(o));
    // Net 1 is on two pads in each channel, so no pin of net 1 gets a connection.
    expect(g.Components().every((c) => c.Pins().every((p) => p.m_conns.length === 0))).toBe(true);
    const local = graph(a);
    const linked = local
      .Components()
      .flatMap((c) => c.Pins())
      .filter((p) => p.m_conns.length > 0);
    expect(linked.length).toBe(2);
  });
});

describe('TMATCH: BuildFromFootprintSet, single-pad boundary nets', () => {
  it('a net with one pad in the other channel stays in the comparison', () => {
    const b = makeBoard(3);
    const a = [
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R2',
        pads: [
          ['1', 1],
          ['2', 3],
        ],
      }),
    ];
    const o = [
      mk(b, {
        ref: 'R11',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
    ];
    const g = CONNECTION_GRAPH.BuildFromFootprintSet(new Set(a), new Set(o));
    const linked = g
      .Components()
      .flatMap((c) => c.Pins())
      .filter((p) => p.m_conns.length > 0);
    expect(linked.length).toBe(2);
  });

  it('explicit global rails are excluded whatever their pad count', () => {
    const b = makeBoard(3);
    const a = [
      mk(b, {
        ref: 'R1',
        pads: [
          ['1', 1],
          ['2', 2],
        ],
      }),
      mk(b, {
        ref: 'R2',
        pads: [
          ['1', 1],
          ['2', 3],
        ],
      }),
    ];
    const g = CONNECTION_GRAPH.BuildFromFootprintSet(new Set(a), new Set(), new Set([1]));
    expect(g.Components().every((c) => c.Pins().every((p) => p.m_conns.length === 0))).toBe(true);
  });
});

describe('TMATCH: COMPONENT kinds', () => {
  const b = makeBoard(0);
  const kind = (r1: string, r2: string): boolean =>
    new COMPONENT(r1, mk(b, { ref: r1, pads: [] })).IsSameKind(
      new COMPONENT(r2, mk(b, { ref: r2, pads: [] })),
    );

  it('hierarchical channel prefixes with only digits and separators differ are one kind', () => {
    expect(kind('TRIM_1.1', 'TRIM_2.1')).toBe(true);
  });

  it('a letter in the differing tail makes them different kinds', () => {
    expect(kind('RA1', 'RB1')).toBe(false);
    expect(kind('R1', 'C1')).toBe(false);
  });

  it('an unannotated placeholder matches on footprint alone', () => {
    expect(kind('REF**', 'C7')).toBe(true);
  });
});
