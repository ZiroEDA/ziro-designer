// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * IPC-D-356 bare-board test netlist.
 * Counterpart: `IPC356D_WRITER` (pcbnew/exporters/export_d356.cpp).
 *
 * This is a fixed-column format read by test machines, so the tests assert
 * whole records **byte for byte**. Checking field values individually would
 * pass while every column sat one place to the left, and the failure would
 * surface at the fab rather than here.
 *
 * The expected strings below were derived from upstream's format string —
 * `"%03d%-14.14s   %-6.6s%c%-4.4s%c"`, then the hole block, then
 * `"A%02dX%+07dY%+07dX%04dY%04dR%03d"`, then `"S%d"` — not from running this
 * code.
 */
import { describe, expect, it } from 'vitest';
import {
  boardTentVias,
  computePadAccessCode,
  expandLayerTokens,
  exportD356,
  internNewD356Netname,
  iuToD356,
  layerNameToId,
  viaAccessCode,
  viaLayerPair,
} from '@ziroeda/pcbnew/src/export_d356.js';
import type { Board, PcbPad, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });
const sexpr = (name: string, ...vals: string[]) => ({
  kind: 'list' as const,
  items: [
    {
      kind: 'list' as const,
      items: [
        { kind: 'atom' as const, value: name },
        ...vals.map((v) => ({ kind: 'atom' as const, value: v })),
      ],
    },
  ],
});

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: P(1_000_000, 2_000_000),
  angle: 0,
  size: P(1_500_000, 800_000),
  layers: ['F.Cu', 'F.Mask'],
  net: 1,
  source: EMPTY,
  ...over,
});

const via = (over: Partial<PcbVia> = {}): PcbVia => ({
  at: P(0, 0),
  size: 800_000,
  drill: 400_000,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'GND'],
    [2, 'VCC'],
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
  points: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const fp = (pads: PcbPad[], reference = 'R1') =>
  ({ reference, layer: 'F.Cu', at: P(0, 0), pads, source: EMPTY }) as never;

const records = (text: string): string[] =>
  text.split('\n').filter((l) => l && !l.startsWith('P  ') && l !== '999');

describe('converting to decimils', () => {
  it('rounds halves away from zero, not toward positive infinity', () => {
    // KiROUND is std::llround. Math.round would send -0.5 to 0 and put every
    // coordinate on a half-decimil below the origin one unit out.
    expect(iuToD356(2540 * 3 + 1270, 9999)).toBe(4);
    expect(iuToD356(-(2540 * 3 + 1270), 9999)).toBe(-4);
  });

  it('clamps at both ends, not just the positive one', () => {
    expect(iuToD356(999_999_999, 9999)).toBe(9999);
    expect(iuToD356(-999_999_999, 9999)).toBe(-9999);
  });
});

describe('layer ids and wildcards', () => {
  it('numbers layers the way layer_ids.h does', () => {
    // B.Cu is 2 — it sits between F.Cu and the inner layers, not after them.
    expect(layerNameToId('F.Cu')).toBe(0);
    expect(layerNameToId('B.Cu')).toBe(2);
    expect(layerNameToId('In1.Cu')).toBe(4);
    expect(layerNameToId('In30.Cu')).toBe(62);
    expect(layerNameToId('F.SilkS')).toBeUndefined();
  });

  it('expands *.Cu to all thirty-two copper layers', () => {
    // Independent of how many the board has, which is why a *.Cu pad on a
    // two-layer board still reports both outer layers.
    const ids = expandLayerTokens(['*.Cu']);

    expect(ids.has(0)).toBe(true);
    expect(ids.has(2)).toBe(true);
    expect(ids.size).toBe(32);
  });

  it('expands F&B.Cu to exactly the two outer layers', () => {
    expect([...expandLayerTokens(['F&B.Cu'])].sort((a, b) => a - b)).toEqual([0, 2]);
  });
});

describe('access codes', () => {
  it('gives a through pad 0, a front pad 1 and a back pad the layer count', () => {
    expect(computePadAccessCode(4, new Set([0, 2]))).toBe(0);
    expect(computePadAccessCode(4, new Set([0]))).toBe(1);
    expect(computePadAccessCode(4, new Set([2]))).toBe(4);
  });

  it('returns -1 for a pad with no copper, so the caller can skip it', () => {
    // A mask-only aperture is not a test point.
    expect(computePadAccessCode(2, new Set([1, 3]))).toBe(-1);
  });

  it('uses a different formula for vias than for pads, as upstream does', () => {
    // Same physical situation, two answers: a pad on In1 gives layerId + 1 = 5,
    // a via topped at In1 gives (4 / 2) + 1 = 3. Upstream is inconsistent here
    // and the test house consumes what KiCad emits, so this is reproduced
    // rather than unified.
    expect(computePadAccessCode(4, new Set([4]))).toBe(5);
    expect(viaAccessCode(4, 4, 6)).toBe(3);
  });

  it('gives a through via 0 whatever its layer tokens claim', () => {
    // PCB_VIA::LayerPair ignores the file's (layers …) for a through via.
    expect(viaLayerPair(via({ kind: 'through', layers: ['In1.Cu', 'In2.Cu'] }))).toEqual({
      top: 0,
      bottom: 2,
    });
  });

  it('orders a blind via pair by physical depth', () => {
    expect(viaLayerPair(via({ kind: 'blind', layers: ['B.Cu', 'In1.Cu'] }))).toEqual({
      top: 4,
      bottom: 2,
    });
  });
});

describe('tenting', () => {
  it('defaults both sides to tented', () => {
    // BOARD_DESIGN_SETTINGS defaults m_TentViasFront/Back to true, and tented
    // means covered by mask, i.e. not probeable. The polarity reads backwards.
    expect(boardTentVias(board())).toEqual({ front: true, back: true });
  });

  it('reads the modern (tenting (front no) (back yes)) form', () => {
    const b = board({
      source: {
        kind: 'list',
        items: [
          {
            kind: 'list',
            items: [
              { kind: 'atom', value: 'setup' },
              {
                kind: 'list',
                items: [
                  { kind: 'atom', value: 'tenting' },
                  {
                    kind: 'list',
                    items: [
                      { kind: 'atom', value: 'front' },
                      { kind: 'atom', value: 'no' },
                    ],
                  },
                  {
                    kind: 'list',
                    items: [
                      { kind: 'atom', value: 'back' },
                      { kind: 'atom', value: 'yes' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(boardTentVias(b)).toEqual({ front: false, back: true });
  });
});

describe('net names', () => {
  it('keeps the tail when a name is too long, not the head', () => {
    // wxString::Right(14). Two long names sharing a suffix therefore collide.
    const map = new Map<string, string>();
    const used = new Set<string>();

    // 27 characters in; the last 14 survive.
    expect(internNewD356Netname('A_VERY_LONG_NET_NAME_SUFFIX', map, used)).toBe('ET_NAME_SUFFIX');
  });

  it('uppercases and replaces anything outside printable ASCII', () => {
    const out = internNewD356Netname('net aµ', new Map(), new Set());

    // Space and the micro sign both become '?'.
    expect(out).toBe('NET?A?');
  });

  it('uniquifies a collision by trimming to ten and appending #N', () => {
    const map = new Map<string, string>();
    const used = new Set<string>();

    const first = internNewD356Netname('SAME_NAME_HERE', map, used);
    const second = internNewD356Netname('XSAME_NAME_HERE', map, used);

    expect(first).toBe('SAME_NAME_HERE');
    expect(second).toBe('_NAME_HERE#1');
  });
});

describe('the emitted file', () => {
  it('writes the header and trailer with exact whitespace', () => {
    // Three spaces after arrayDim, and the mixed case is upstream's.
    const out = exportD356(board());

    expect(out).toBe('P  CODE 00\nP  UNITS CUST 0\nP  arrayDim   N\n999\n');
  });

  it('writes a through via record byte for byte', () => {
    const out = records(exportD356(board({ vias: [via()] })));

    expect(out).toEqual([
      '317GND              VIA        MD0157PA00X+000000Y+000000X0315Y0000R000S3',
    ]);
  });

  it('writes an SMD pad record byte for byte', () => {
    const out = records(exportD356(board({ footprints: [fp([pad()])] })));

    // 327 (SMD), '-' before a named pin, no M (a named pad is a terminal),
    // six blanks where the hole field would be, A01 for front-only copper,
    // and S2 because F.Mask clears bit 1.
    expect(out).toEqual([
      '327GND              R1    -1          A01X+000394Y-000787X0591Y0315R000S2',
    ]);
  });

  it('mirrors Y rather than translating it', () => {
    // y_location = origin.y - pos.y, while x_location = pos.x - origin.x.
    // Writing both as subtractions of the origin is the easy silent error.
    const out = records(exportD356(board({ footprints: [fp([pad({ at: P(0, 2_540_000) })])] })));

    expect(out[0]).toContain('X+000000Y-001000');
  });

  it('forces a round pad’s second dimension to zero', () => {
    // An explicit IPC rule, not an optimisation, and only for `circle`.
    const round = records(exportD356(board({ footprints: [fp([pad({ shape: 'circle' })])] })));
    const oval = records(exportD356(board({ footprints: [fp([pad({ shape: 'oval' })])] })));

    expect(round[0]).toContain('X0591Y0000');
    expect(oval[0]).toContain('X0591Y0315');
  });

  it('truncates rotation toward zero and normalises once', () => {
    // A C++ double assigned to an int truncates toward zero: -30.7 becomes
    // -30, then += 360 gives 330. Rounding would have given 329.
    const out = records(exportD356(board({ footprints: [fp([pad({ angle: 30.7 })])] })));

    expect(out[0]).toContain('R330');
  });

  it('clears a NPTH pad’s number and net, and marks it mechanical', () => {
    // SetAttribute(NPTH) does this at parse time upstream; our reader keeps
    // whatever the file said, so the exporter has to.
    const b = board({
      footprints: [
        fp([
          pad({
            number: '5',
            type: 'np_thru_hole',
            shape: 'circle',
            net: 1,
            drill: { oblong: false, w: 800_000, h: 800_000 },
            layers: ['*.Cu', '*.Mask'],
            source: sexpr('drill', '0.8'),
          }),
        ]),
      ],
    });
    const out = records(exportD356(b));

    // 367 is the mechanical record type, U rather than P in the hole field,
    // N/C because the net was cleared, and M because the pin was.
    expect(out[0]!.startsWith('367N/C')).toBe(true);
    expect(out[0]).toContain('D0315U');
    expect(out[0]).toContain('    M');
  });

  it('gives a NPTH pad with no drill token the 30 mil default', () => {
    // Upstream's NPTH branch never overwrites the PAD constructor default,
    // where thru_hole would have been set to 1 nm. 30 mils = 762000 IU = 300
    // decimils.
    const b = board({
      footprints: [
        fp([pad({ type: 'np_thru_hole', shape: 'circle', layers: ['*.Cu'], source: EMPTY })]),
      ],
    });

    expect(records(exportD356(b))[0]).toContain('D0300U');
  });

  it('still emits a hole field for a via whose drill is zero', () => {
    // `hole` is unconditionally true for a via. A zero drill therefore prints
    // D0000P rather than the six blanks a drill-less pad gets — the test
    // machine is told there is a hole of no recorded size, not that there is
    // no hole.
    const out = records(exportD356(board({ vias: [via({ drill: 0 })] })));

    expect(out[0]).toContain('D0000P');
  });

  it('emits vias before pads', () => {
    // Load-bearing: net names are interned in record order, so vias get first
    // claim on the unsuffixed canonical name.
    const b = board({ vias: [via()], footprints: [fp([pad()])] });
    const out = records(exportD356(b));

    expect(out[0]).toContain('VIA');
    expect(out[1]).toContain('R1');
  });

  it('writes N/C for an empty net without interning it', () => {
    const b = board({ footprints: [fp([pad({ net: 0 })])] });

    expect(records(exportD356(b))[0]!.startsWith('327N/C')).toBe(true);
  });

  it('drops unconnected pads only when asked, and never vias', () => {
    // The filter applies to pads alone; a via on net 0 is always exported.
    const b = board({ vias: [via({ net: 0 })], footprints: [fp([pad({ net: 0 })])] });

    expect(records(exportD356(b))).toHaveLength(2);
    expect(records(exportD356(b, { doNotExportUnconnectedPads: true }))).toHaveLength(1);
  });

  it('skips a pad with no copper at all', () => {
    const b = board({ footprints: [fp([pad({ layers: ['F.Mask'] })])] });

    expect(records(exportD356(b))).toHaveLength(0);
  });
});
