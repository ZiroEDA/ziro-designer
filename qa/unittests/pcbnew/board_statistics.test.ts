// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board statistics over the live BOARD.
 * Counterparts: `pcbnew/board_statistics.cpp` and
 * `pcbnew/board_statistics_report.cpp`.
 *
 * Expected areas are computed from the rectangle dimensions by hand rather
 * than by re-running the code.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';
import { CollectDrillLineItems, sameDrillLineItem } from '@ziroeda/pcbnew/board_statistics.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  ComputeBoardStatistics,
  FormatBoardStatisticsJson,
  FormatBoardStatisticsReport,
  InitializeBoardStatisticsData,
  ResetCounts,
  STATISTICS_INT_MAX,
} from '@ziroeda/pcbnew/board_statistics_report.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { FOOTPRINT, FOOTPRINT_ATTR_T } from '@ziroeda/pcbnew/footprint.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_PROP, PAD_SHAPE } from '@ziroeda/pcbnew/padstack.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';
import { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { FIELD_T } from '@ziroeda/common/src/template_fieldnames.js';

const P = (x: number, y: number) => ({ x, y });

/** 1 mm in internal units. */
const MM = 1_000_000;

// The builders below return plain specs; `board()` materialises them onto a
// real BOARD. Keeping the spec shape lets each test read as a description of a
// board rather than as a construction sequence.

interface PadSpec {
  type?: 'smd' | 'thru_hole' | 'connect' | 'np_thru_hole';
  padProperty?: 'pad_prop_castellated' | 'pad_prop_pressfit' | 'pad_prop_heatsink';
  layers?: string[];
  drill?: { oblong: boolean; w: number; h: number };
}
interface ShapeSpec {
  start: { x: number; y: number };
  end: { x: number; y: number };
  layer?: string;
  kind?: 'line' | 'rect';
  width?: number;
  /** Accepted and ignored: the fill never affects an Edge.Cuts outline. */
  fillMode?: string;
}
interface TextSpec {
  kind?: 'reference' | 'value' | 'user';
  layer?: string;
  text?: string;
  at?: { x: number; y: number };
  angle?: number;
  size?: { x: number; y: number };
}
interface FpSpec {
  layer?: string;
  attributes?: ('through_hole' | 'smd')[];
  pads?: PadSpec[];
  shapes?: ShapeSpec[];
  texts?: TextSpec[];
}
interface ViaSpec {
  kind?: 'through' | 'blind' | 'buried' | 'micro';
  drill?: number;
  layers?: string[];
}
interface TrackSpec {
  width?: number;
}
interface ArcSpec {
  start?: { x: number; y: number };
  mid?: { x: number; y: number };
  end?: { x: number; y: number };
  width?: number;
  layer?: string;
  net?: number;
}
interface BoardSpec {
  layers?: { id: number; name: string; kind: string }[];
  footprints?: FpSpec[];
  vias?: ViaSpec[];
  tracks?: TrackSpec[];
  arcs?: ArcSpec[];
  shapes?: ShapeSpec[];
}

const pad = (o: PadSpec = {}): PadSpec => ({ type: 'smd', layers: ['F.Cu'], ...o });

const thtPad = (o: PadSpec = {}): PadSpec =>
  pad({
    type: 'thru_hole',
    layers: ['*.Cu'],
    drill: { oblong: false, w: 800_000, h: 800_000 },
    ...o,
  });

const via = (o: ViaSpec = {}): ViaSpec => ({
  kind: 'through',
  drill: 300_000,
  layers: ['F.Cu', 'B.Cu'],
  ...o,
});

const track = (o: TrackSpec = {}): TrackSpec => ({ width: 250_000, ...o });
const fp = (o: FpSpec = {}): FpSpec => ({ layer: 'F.Cu', ...o });

const line = (a: { x: number; y: number }, b: { x: number; y: number }): ShapeSpec => ({
  kind: 'line',
  start: a,
  end: b,
  layer: 'Edge.Cuts',
});

/** A closed Edge.Cuts rectangle, drawn as four separate lines. */
const outlineLines = (x0: number, y0: number, x1: number, y1: number): ShapeSpec[] => [
  line(P(x0, y0), P(x1, y0)),
  line(P(x1, y0), P(x1, y1)),
  line(P(x1, y1), P(x0, y1)),
  line(P(x0, y1), P(x0, y0)),
];

const PAD_ATTR: Record<string, PAD_ATTRIB> = {
  smd: PAD_ATTRIB.SMD,
  thru_hole: PAD_ATTRIB.PTH,
  connect: PAD_ATTRIB.CONN,
  np_thru_hole: PAD_ATTRIB.NPTH,
};
const PAD_PROPS: Record<string, PAD_PROP> = {
  pad_prop_castellated: PAD_PROP.CASTELLATED,
  pad_prop_pressfit: PAD_PROP.PRESSFIT,
};
const VIA_KIND: Record<string, VIATYPE> = {
  through: VIATYPE.THROUGH,
  blind: VIATYPE.BLIND,
  buried: VIATYPE.BURIED,
  micro: VIATYPE.MICROVIA,
};

const lset = (b: BOARD, names: readonly string[]): LSET => {
  const s = new LSET();
  for (const n of names) {
    if (n === '*.Cu') {
      for (const l of b.GetEnabledLayers().CuStack()) s.set(l);
    } else {
      s.set(b.GetLayerID(n));
    }
  }
  return s;
};

const addShape = (b: BOARD, parent: BOARD | FOOTPRINT, spec: ShapeSpec): PCB_SHAPE => {
  const s = new PCB_SHAPE(parent, spec.kind === 'rect' ? SHAPE_T.RECTANGLE : SHAPE_T.SEGMENT);
  s.SetStart(spec.start);
  s.SetEnd(spec.end);
  s.SetLayer(b.GetLayerID(spec.layer ?? 'Edge.Cuts'));
  s.SetWidth(spec.width ?? 100_000);
  return s;
};

const board = (spec: BoardSpec = {}): BOARD => {
  const b = new BOARD();
  b.SetCopperLayerCount(spec.layers ? Math.max(2, spec.layers.length) : 2);

  for (const f of spec.footprints ?? []) {
    const footprint = new FOOTPRINT(b);
    footprint.SetPosition(P(0, 0));
    footprint.SetReference('R1');

    let attrs = 0;
    for (const a of f.attributes ?? [])
      attrs |= a === 'smd' ? FOOTPRINT_ATTR_T.FP_SMD : FOOTPRINT_ATTR_T.FP_THROUGH_HOLE;
    footprint.SetAttributes(attrs);

    if (f.layer === 'B.Cu') footprint.Flip(P(0, 0), FLIP_DIRECTION.TOP_BOTTOM);

    for (const ps of f.pads ?? []) {
      const p = new PAD(footprint);
      p.SetNumber('1');
      p.SetAttribute(PAD_ATTR[ps.type ?? 'smd']!);
      if (ps.padProperty) p.SetProperty(PAD_PROPS[ps.padProperty]!);
      p.SetShape(undefined as unknown as PCB_LAYER_ID, PAD_SHAPE.RECTANGLE);
      p.SetSize(undefined as unknown as PCB_LAYER_ID, P(MM, MM));
      p.SetPosition(P(0, 0));
      p.SetLayerSet(lset(b, ps.layers ?? ['F.Cu']));
      if (ps.drill) {
        p.SetDrillShape(ps.drill.oblong ? PAD_DRILL_SHAPE.OBLONG : PAD_DRILL_SHAPE.CIRCLE);
        p.SetDrillSize(P(ps.drill.w, ps.drill.h));
      }
      footprint.Add(p, ADD_MODE.APPEND);
    }

    for (const sp of f.shapes ?? []) footprint.Add(addShape(b, footprint, sp), ADD_MODE.APPEND);

    for (const t of f.texts ?? []) {
      // Reference and Value are PCB_FIELDs and live in m_fields; only a user
      // PCB_TEXT lands in m_drawings, which is the list GetSide walks.
      if (t.kind === 'reference' || t.kind === 'value') {
        const field = footprint.GetField(
          t.kind === 'reference' ? FIELD_T.REFERENCE : FIELD_T.VALUE,
        );
        field.SetLayer(b.GetLayerID(t.layer ?? 'F.Silkscreen'));
        if (t.text) field.SetText(t.text);
        continue;
      }

      const txt = new PCB_TEXT(footprint);
      txt.SetLayer(b.GetLayerID(t.layer ?? 'F.Silkscreen'));
      footprint.Add(txt, ADD_MODE.APPEND);
    }

    b.Add(footprint, ADD_MODE.APPEND);
  }

  for (const v of spec.vias ?? []) {
    const pv = new PCB_VIA(b);
    pv.SetViaType(VIA_KIND[v.kind ?? 'through']!);
    pv.SetDrill(v.drill ?? 300_000);
    pv.SetWidth(600_000);
    pv.SetPosition(P(0, 0));
    const [top, bottom] = v.layers ?? ['F.Cu', 'B.Cu'];
    pv.SetLayerPair(b.GetLayerID(top!), b.GetLayerID(bottom!));
    b.Add(pv, ADD_MODE.APPEND);
  }

  for (const t of spec.tracks ?? []) {
    const pt = new PCB_TRACK(b);
    pt.SetStart(P(0, 0));
    pt.SetEnd(P(MM, 0));
    pt.SetWidth(t.width ?? 250_000);
    pt.SetLayer(b.GetLayerID('F.Cu'));
    b.Add(pt, ADD_MODE.APPEND);
  }

  for (const a of spec.arcs ?? []) {
    const pa = new PCB_ARC(b);
    pa.SetStart(a.start ?? P(0, 0));
    pa.SetMid(a.mid ?? P(MM / 2, MM / 4));
    pa.SetEnd(a.end ?? P(MM, 0));
    pa.SetWidth(a.width ?? 250_000);
    pa.SetLayer(b.GetLayerID(a.layer ?? 'F.Cu'));
    b.Add(pa, ADD_MODE.APPEND);
  }

  for (const sp of spec.shapes ?? []) b.Add(addShape(b, b, sp), ADD_MODE.APPEND);

  return b;
};

// ---------------------------------------------------------------------------

describe('the entry tables', () => {
  it('lists rows in the order the dialog and the saved report print them', () => {
    // The order is output, not an implementation detail: it is the row order of
    // four grids and of the text report. Reordering silently rewrites both.
    const data = InitializeBoardStatisticsData();

    expect(data.footprintEntries.map((e) => e.title)).toEqual(['THT:', 'SMD:', 'Unspecified:']);
    expect(data.padEntries.map((e) => e.title)).toEqual([
      'Through hole:',
      'SMD:',
      'Connector:',
      'NPTH:',
    ]);
    expect(data.padPropertyEntries.map((e) => e.title)).toEqual(['Castellated:', 'Press-fit:']);
    expect(data.viaEntries.map((e) => e.title)).toEqual([
      'Through vias:',
      'Blind vias:',
      'Buried vias:',
      'Micro vias:',
    ]);
  });

  it('starts the minima at INT_MAX, not at zero', () => {
    // A board with no tracks must report "unknown"-sized minima, and the dialog
    // tells that from the sentinel. Zero would read as a 0 nm track.
    const data = ComputeBoardStatistics(board());

    expect(data.minTrackWidth).toBe(STATISTICS_INT_MAX);
    expect(data.minDrillSize).toBe(STATISTICS_INT_MAX);
  });
});

describe('counting footprints', () => {
  it('splits THT, SMD and unspecified by the attribute mask', () => {
    // The masks are (THT), (SMD) and (THT|SMD)==0, tested in that order with a
    // break, so a footprint claiming both lands in THT.
    const b = board({
      footprints: [
        fp({ attributes: ['through_hole'], pads: [thtPad()] }),
        fp({ attributes: ['smd'], pads: [pad()] }),
        fp({ attributes: [], pads: [pad()] }),
        fp({ attributes: ['through_hole', 'smd'], pads: [pad()] }),
      ],
    });

    const counts = ComputeBoardStatistics(b).footprintEntries.map((e) => e.frontCount);
    expect(counts).toEqual([2, 1, 1]);
  });

  it('counts a back-side footprint in the back column only', () => {
    const b = board({
      footprints: [fp({ layer: 'B.Cu', attributes: ['smd'], pads: [pad({ layers: ['B.Cu'] })] })],
    });

    const smd = ComputeBoardStatistics(b).footprintEntries[1]!;
    expect([smd.frontCount, smd.backCount]).toEqual([0, 1]);
  });

  it('gives no side to a footprint with nothing on a side-specific layer', () => {
    // GetSide returns UNDEFINED_LAYER and the switch increments neither column,
    // so the footprint is matched, consumed by the break, and counted nowhere.
    // A mounting hole whose only pad is an Edge.Cuts aperture behaves this way.
    const b = board({
      footprints: [
        fp({
          attributes: ['through_hole'],
          pads: [pad({ layers: ['Edge.Cuts'] })],
          shapes: [
            {
              kind: 'line',
              start: P(0, 0),
              end: P(MM, 0),
              width: 100_000,
              fillMode: 'none',
              layer: 'User.Drawings',
            },
          ],
        }),
      ],
    });

    const tht = ComputeBoardStatistics(b).footprintEntries[0]!;
    expect([tht.frontCount, tht.backCount]).toEqual([0, 0]);
  });

  it('does not let reference text alone give a footprint a side', () => {
    // Reference and Value are PCB_FIELDs, held in m_fields; GetSide walks
    // m_drawings. Counting them would give a side to footprints KiCad leaves
    // in neither column.
    const ref: TextSpec = {
      kind: 'reference',
      text: 'R1',
      at: P(0, 0),
      angle: 0,
      layer: 'F.Silkscreen',
      size: P(MM, MM),
    };

    const withField = board({
      footprints: [
        fp({ attributes: ['smd'], pads: [pad({ layers: ['Edge.Cuts'] })], texts: [ref] }),
      ],
    });
    expect(ComputeBoardStatistics(withField).footprintEntries[1]!.frontCount).toBe(0);

    // The same text as a user PCB_TEXT *is* in m_drawings and does give a side.
    const withText = board({
      footprints: [
        fp({
          attributes: ['smd'],
          pads: [pad({ layers: ['Edge.Cuts'] })],
          texts: [{ ...ref, kind: 'user' }],
        }),
      ],
    });
    expect(ComputeBoardStatistics(withText).footprintEntries[1]!.frontCount).toBe(1);
  });

  it('drops pinless footprints from the component counts when asked', () => {
    // The option defaults off, so a test that never turns it on leaves the
    // whole branch unexercised.
    // The pinless one needs a silkscreen graphic, or GetSide would leave it out
    // of both columns anyway and the option would look like it did nothing.
    const b = board({
      footprints: [
        fp({ attributes: ['smd'], pads: [pad()] }),
        fp({
          attributes: ['smd'],
          shapes: [{ ...line(P(0, 0), P(MM, 0)), layer: 'F.Silkscreen' }],
        }),
      ],
    });

    expect(ComputeBoardStatistics(b).footprintEntries[1]!.frontCount).toBe(2);

    const excluded = ComputeBoardStatistics(b, {
      excludeFootprintsWithoutPads: true,
      subtractHolesFromBoardArea: false,
      subtractHolesFromCopperAreas: false,
    });
    expect(excluded.footprintEntries[1]!.frontCount).toBe(1);
  });
});

describe('counting pads and vias', () => {
  it('counts pads by attribute and, separately, by property', () => {
    // A castellated pad is counted once as a through-hole pad and once as a
    // castellated one: the two lists are independent, so the property rows are
    // not part of the pad total.
    const b = board({
      footprints: [
        fp({
          pads: [
            thtPad({ padProperty: 'pad_prop_castellated' }),
            thtPad({ type: 'np_thru_hole' }),
            pad({ type: 'connect' }),
            pad({ padProperty: 'pad_prop_pressfit' }),
            pad({ padProperty: 'pad_prop_heatsink' }),
          ],
        }),
      ],
    });

    const data = ComputeBoardStatistics(b);
    expect(data.padEntries.map((e) => e.quantity)).toEqual([1, 2, 1, 1]);
    // A heatsink pad matches neither counted property and is in no row.
    expect(data.padPropertyEntries.map((e) => e.quantity)).toEqual([1, 1]);
  });

  it('counts vias by type', () => {
    const b = board({
      vias: [
        via(),
        via(),
        via({ kind: 'blind', layers: ['F.Cu', 'In1.Cu'] }),
        via({ kind: 'micro' }),
      ],
    });

    // Buried stays zero: our board model reads `(via buried …)` as a through
    // via, so the row exists but can never be reached.
    expect(ComputeBoardStatistics(b).viaEntries.map((e) => e.quantity)).toEqual([2, 1, 0, 1]);
  });

  it('takes the minimum track width from straight tracks only', () => {
    // Upstream tests PCB_TRACE_T before the filter that admits arcs and vias,
    // so a hair-thin arc never narrows the reported minimum.
    const b = board({
      tracks: [track({ width: 250_000 }), track({ width: 150_000 })],
      arcs: [
        {
          start: P(0, 0),
          mid: P(MM, MM),
          end: P(2 * MM, 0),
          width: 50_000,
          layer: 'F.Cu',
          net: 1,
        },
      ],
    });

    expect(ComputeBoardStatistics(b).minTrackWidth).toBe(150_000);
  });
});

describe('grouping drill holes', () => {
  it('treats holes as the same only when all seven fields agree', () => {
    // Same diameter is not enough. A PTH and an NPTH of the same size are two
    // rows, and so are a pad hole and a via hole of the same size.
    const b = board({
      footprints: [
        fp({
          pads: [
            thtPad(),
            thtPad(),
            thtPad({ type: 'np_thru_hole' }),
            thtPad({ drill: { oblong: true, w: 800_000, h: 800_000 } }),
          ],
        }),
      ],
      vias: [via({ drill: 800_000 })],
    });

    const drills = CollectDrillLineItems(b);
    expect(drills.map((d) => [d.xSize, d.shape, d.isPlated, d.isPad, d.qty])).toEqual([
      [800_000, PAD_DRILL_SHAPE.CIRCLE, true, true, 2],
      [800_000, PAD_DRILL_SHAPE.CIRCLE, false, true, 1],
      [800_000, PAD_DRILL_SHAPE.OBLONG, true, true, 1],
      [800_000, PAD_DRILL_SHAPE.CIRCLE, true, false, 1],
    ]);
  });

  it('separates holes that differ only in layer span', () => {
    // startLayer/stopLayer are part of the identity, so a blind via's hole is a
    // different row from a through via's of the same drill.
    const b = board({
      layers: [
        { id: 0, name: 'F.Cu', kind: 'signal' },
        { id: 4, name: 'In1.Cu', kind: 'signal' },
        { id: 2, name: 'B.Cu', kind: 'signal' },
      ],
      // SanitizeLayers forces a through via to F.Cu/B.Cu whatever the file
      // said, so the first two are one row and not two.
      vias: [
        via(),
        via({ layers: ['In1.Cu', 'In1.Cu'] }),
        via({ kind: 'blind', layers: ['In1.Cu', 'F.Cu'] }),
      ],
    });

    const drills = CollectDrillLineItems(b);
    expect(drills.map((d) => [d.startLayer, d.stopLayer, d.qty])).toEqual([
      [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, 2],
      // The blind pair is reordered by depth, not left in file order.
      [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu, 1],
    ]);
  });

  it('leaves a pad with no copper layer at all on undefined layers', () => {
    // CuStack() is empty and upstream stores UNDEFINED_LAYER, which the dialog
    // prints as "N/A" rather than as a layer name.
    const b = board({
      footprints: [fp({ pads: [thtPad({ layers: ['F.Mask'] })] })],
    });

    const [drill] = CollectDrillLineItems(b);
    expect(drill!.startLayer).toBe(PCB_LAYER_ID.UNDEFINED_LAYER);
    expect(drill!.stopLayer).toBe(PCB_LAYER_ID.UNDEFINED_LAYER);
  });

  it('ignores a pad with no hole and one whose drill is zero-sized', () => {
    const b = board({
      footprints: [fp({ pads: [pad(), thtPad({ drill: { oblong: false, w: 0, h: 800_000 } })] })],
    });

    expect(CollectDrillLineItems(b)).toEqual([]);
  });

  it('gives a via with no drill of its own the netclass drill, and counts it', () => {
    // `PCB_VIA::GetDrillValue` falls back to the netclass when the via stores
    // no drill, so a zero is never seen here and the via is a real hole. Our
    // view model stored the raw zero and dropped the via, which was wrong.
    const b = board({ vias: [via({ drill: 0 })] });
    const [drill] = CollectDrillLineItems(b);

    expect(drill!.xSize).toBeGreaterThan(0);
    expect(drill!.isPad).toBe(false);
  });

  it('sorts the rows by descending count and takes the min drill from round holes', () => {
    // Only CIRCLE holes are candidates for the minimum drill diameter: a
    // narrower slot does not lower it.
    const b = board({
      footprints: [
        fp({
          pads: [
            thtPad({ drill: { oblong: true, w: 200_000, h: 900_000 } }),
            thtPad(),
            thtPad(),
            thtPad(),
          ],
        }),
      ],
    });

    const data = ComputeBoardStatistics(b);
    expect(data.drillEntries.map((d) => d.qty)).toEqual([3, 1]);
    expect(data.minDrillSize).toBe(800_000);
  });

  it('compares every identity field', () => {
    const base = CollectDrillLineItems(board({ footprints: [fp({ pads: [thtPad()] })] }))[0]!;

    expect(sameDrillLineItem(base, { ...base, qty: 99 })).toBe(true);
    expect(sameDrillLineItem(base, { ...base, ySize: 1 })).toBe(false);
    expect(sameDrillLineItem(base, { ...base, stopLayer: PCB_LAYER_ID.In1_Cu })).toBe(false);
  });
});

describe('the board outline', () => {
  it('measures a rectangle drawn as four separate lines', () => {
    const b = board({ shapes: outlineLines(0, 0, 100 * MM, 50 * MM) });
    const data = ComputeBoardStatistics(b);

    expect(data.hasOutline).toBe(true);
    expect(data.boardWidth).toBe(100 * MM);
    expect(data.boardHeight).toBe(50 * MM);
    expect(data.boardArea).toBe(100 * MM * (50 * MM));
  });

  it('reports nothing at all when Edge.Cuts is empty', () => {
    const data = ComputeBoardStatistics(board({ shapes: [] }));

    expect(data.hasOutline).toBe(false);
    expect([data.boardWidth, data.boardHeight, data.boardArea]).toEqual([0, 0, 0]);
  });

  it('reports nothing when the outline has a gap', () => {
    // doConvertOutlineToPolygon builds every contour and *then* refuses if any
    // one is open, before adding a single contour to the polygon set. Measuring
    // the three sides that did chain would invent a board.
    const sides = outlineLines(0, 0, 100 * MM, 50 * MM);
    const data = ComputeBoardStatistics(board({ shapes: sides.slice(0, 3) }));

    expect(data.hasOutline).toBe(false);
    expect([data.boardWidth, data.boardHeight, data.boardArea]).toEqual([0, 0, 0]);
  });

  it('closes a gap smaller than the chaining epsilon', () => {
    // 0.01 mm is DEFAULT_CHAINING_EPSILON_MM; a hand-drawn outline that misses
    // by less than that is still a board.
    const sides = outlineLines(0, 0, 100 * MM, 50 * MM);
    sides[3] = line(P(0, 50 * MM), P(0, 5_000));

    expect(ComputeBoardStatistics(board({ shapes: sides })).hasOutline).toBe(true);

    // Twice the epsilon does not close.
    sides[3] = line(P(0, 50 * MM), P(0, 20_000));
    expect(ComputeBoardStatistics(board({ shapes: sides })).hasOutline).toBe(false);
  });

  it('counts a cutout as board area unless asked to subtract it', () => {
    // "Area" is the gross outline area by default. A 10x10 mm window in a
    // 100x50 mm board changes nothing until the checkbox is ticked.
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 100 * MM, 50 * MM),
        ...outlineLines(10 * MM, 10 * MM, 20 * MM, 20 * MM),
      ],
    });

    expect(ComputeBoardStatistics(b).boardArea).toBe(100 * MM * (50 * MM));

    const subtracted = ComputeBoardStatistics(b, {
      excludeFootprintsWithoutPads: false,
      subtractHolesFromBoardArea: true,
      subtractHolesFromCopperAreas: false,
    });
    expect(subtracted.boardArea).toBe(100 * MM * (50 * MM) - 10 * MM * (10 * MM));
  });

  it('adds a second disjoint outline to the area and to the bounding box', () => {
    // aAllowDisjoint is true for a board, so a panel of two boards measures as
    // both, and the dimensions are the bounding box over the pair.
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 10 * MM, 10 * MM),
        ...outlineLines(20 * MM, 0, 30 * MM, 10 * MM),
      ],
    });
    const data = ComputeBoardStatistics(b);

    expect(data.boardArea).toBe(2 * (10 * MM * (10 * MM)));
    expect(data.boardWidth).toBe(30 * MM);
    expect(data.boardHeight).toBe(10 * MM);
  });

  it('subtracts every drilled hole once per outline, as upstream does', () => {
    // The pad and via loops sit *inside* the per-outline loop. On a two-outline
    // panel each hole is therefore subtracted twice. It reads as a bug and is
    // reproduced so that a board measured by KiCad and by us agrees.
    const holes = [fp({ pads: [thtPad({ drill: { oblong: false, w: 1 * MM, h: 1 * MM } })] })];
    const holeArea = Math.PI * 0.25 * MM * MM;

    const one = ComputeBoardStatistics(
      board({ shapes: outlineLines(0, 0, 10 * MM, 10 * MM), footprints: holes }),
      {
        excludeFootprintsWithoutPads: false,
        subtractHolesFromBoardArea: true,
        subtractHolesFromCopperAreas: false,
      },
    );
    expect(one.boardArea).toBeCloseTo(10 * MM * (10 * MM) - holeArea, 0);

    const two = ComputeBoardStatistics(
      board({
        shapes: [
          ...outlineLines(0, 0, 10 * MM, 10 * MM),
          ...outlineLines(20 * MM, 0, 30 * MM, 10 * MM),
        ],
        footprints: holes,
      }),
      {
        excludeFootprintsWithoutPads: false,
        subtractHolesFromBoardArea: true,
        subtractHolesFromCopperAreas: false,
      },
    );
    expect(two.boardArea).toBeCloseTo(2 * (10 * MM * (10 * MM)) - 2 * holeArea, 0);
  });

  it('takes a slot hole as a stadium, not as a circle', () => {
    // GetEffectiveHoleShape is a segment of width min(x,y) whose length is the
    // difference between the two drill dimensions.
    const b = board({
      shapes: outlineLines(0, 0, 10 * MM, 10 * MM),
      footprints: [fp({ pads: [thtPad({ drill: { oblong: true, w: 1 * MM, h: 3 * MM } })] })],
    });

    const data = ComputeBoardStatistics(b, {
      excludeFootprintsWithoutPads: false,
      subtractHolesFromBoardArea: true,
      subtractHolesFromCopperAreas: false,
    });

    // width 1 mm, segment length 2 mm: 2 mm² of body plus a 1 mm round cap.
    const slot = 2 * MM * MM + Math.PI * 0.25 * MM * MM;
    expect(data.boardArea).toBeCloseTo(10 * MM * (10 * MM) - slot, 0);
  });

  it('takes footprint Edge.Cuts graphics as part of the outline', () => {
    // BuildBoardPolygonOutlines collects PCB_SHAPEs from the whole board, so a
    // mounting-hole footprint that draws its own cutout is a hole in the board.
    const b = board({
      shapes: outlineLines(0, 0, 100 * MM, 50 * MM),
      footprints: [fp({ shapes: outlineLines(10 * MM, 10 * MM, 20 * MM, 20 * MM) })],
    });

    const data = ComputeBoardStatistics(b, {
      excludeFootprintsWithoutPads: false,
      subtractHolesFromBoardArea: true,
      subtractHolesFromCopperAreas: false,
    });
    expect(data.boardArea).toBe(100 * MM * (50 * MM) - 10 * MM * (10 * MM));
  });

  it('nests a cutout under its immediate parent, not under every ancestor', () => {
    // Parent parity decides: even means outline, odd means hole. An island
    // inside a cutout has two parents and is an outline again.
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 100 * MM, 100 * MM),
        ...outlineLines(10 * MM, 10 * MM, 90 * MM, 90 * MM),
        ...outlineLines(40 * MM, 40 * MM, 60 * MM, 60 * MM),
      ],
    });

    const polySet = new SHAPE_POLY_SET();
    expect(b.GetBoardPolygonOutlines(polySet, false)).toBe(true);
    expect(polySet.OutlineCount()).toBe(2);
    expect([polySet.HoleCount(0), polySet.HoleCount(1)].sort()).toEqual([0, 1]);
  });

  it('measures an outline drawn as one closed rectangle graphic', () => {
    const b = board({
      shapes: [
        {
          kind: 'rect',
          start: P(0, 0),
          end: P(40 * MM, 25 * MM),
          width: 100_000,
          fillMode: 'none',
          layer: 'Edge.Cuts',
        },
      ],
    });
    const data = ComputeBoardStatistics(b);

    expect(data.hasOutline).toBe(true);
    expect(data.boardArea).toBe(40 * MM * (25 * MM));
  });

  it('ignores graphics on other layers', () => {
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 10 * MM, 10 * MM),
        { ...line(P(0, 0), P(50 * MM, 0)), layer: 'F.Silkscreen' },
      ],
    });

    expect(ComputeBoardStatistics(b).boardWidth).toBe(10 * MM);
  });
});

describe('the saved report', () => {
  const units = new UNITS_PROVIDER(pcbIUScale, 'mm');

  const twoByOne = (): BOARD =>
    board({
      shapes: outlineLines(0, 0, 40 * MM, 25 * MM),
      footprints: [fp({ attributes: ['smd'], pads: [pad()] })],
      vias: [via()],
    });

  it('pads every table column to its widest cell and rules it with dashes', () => {
    const b = twoByOne();
    const text = FormatBoardStatisticsReport(
      ComputeBoardStatistics(b),
      b,
      units,
      'proj',
      'board.kicad_pcb',
    );

    const lines = text.split('\n');
    const header = lines.findIndex((l) => l.startsWith('|') && l.includes('Front Side'));
    expect(header).toBeGreaterThan(-1);

    // The rule under the header is all dashes and pipes, and every row of the
    // table is exactly as wide as the header.
    expect(lines[header + 1]).toMatch(/^\|[-|]+\|$/);
    expect(lines[header + 1]!.length).toBe(lines[header]!.length);
    expect(lines[header + 2]!.length).toBe(lines[header]!.length);
  });

  it('prints unknown for the dimensions when the board has no outline', () => {
    const b = board({ footprints: [fp({ attributes: ['smd'], pads: [pad()] })] });
    const text = FormatBoardStatisticsReport(ComputeBoardStatistics(b), b, units, '', '');

    expect(text).toContain('- Dimensions: unknown');
    expect(text).toContain('- Area: unknown');
    expect(text).toContain('- Front component density: unknown');
  });

  it('names a drill row layer, or N/A where it has none', () => {
    const b = board({ footprints: [fp({ pads: [thtPad({ layers: ['F.Mask'] })] })] });
    const text = FormatBoardStatisticsReport(ComputeBoardStatistics(b), b, units, '', '');

    expect(text).toContain('N/A');
  });
});

describe('the JSON report', () => {
  const units = new UNITS_PROVIDER(pcbIUScale, 'mm');

  it('snake-cases the UI titles, dropping the via suffix but not the pad one', () => {
    const b = board({ vias: [via()], footprints: [fp({ pads: [pad(), thtPad()] })] });
    const json = JSON.parse(
      FormatBoardStatisticsJson(ComputeBoardStatistics(b), b, units, 'p', 'n'),
    );

    // "Through vias:" loses the suffix; "Through hole:" keeps both words.
    expect(Object.keys(json.vias)).toEqual(['through', 'blind', 'buried', 'micro']);
    expect(Object.keys(json.pads)).toEqual([
      'through_hole',
      'smd',
      'connector',
      'npth',
      'castellated',
      'press_fit',
    ]);
  });

  it('nulls the outline-dependent fields when there is no outline', () => {
    const b = board({ footprints: [fp({ pads: [pad()] })] });
    const json = JSON.parse(FormatBoardStatisticsJson(ComputeBoardStatistics(b), b, units, '', ''));

    expect(json.board.has_outline).toBe(false);
    expect(json.board.width).toBeNull();
    expect(json.board.area).toBeNull();
    expect(json.board.front_component_density).toBeNull();
    // Copper area is not outline-dependent and is still a string.
    expect(typeof json.board.front_copper_area).toBe('string');
  });

  it('totals the component table', () => {
    const b = board({
      footprints: [
        fp({ attributes: ['smd'], pads: [pad()] }),
        fp({ attributes: ['smd'], pads: [pad()] }),
      ],
    });
    const json = JSON.parse(FormatBoardStatisticsJson(ComputeBoardStatistics(b), b, units, '', ''));

    expect(json.components.smd).toEqual({ front: 2, back: 0, total: 2 });
    expect(json.components.total).toEqual({ front: 2, back: 0, total: 2 });
  });
});

describe('BOARD_STATISTICS_DATA::ResetCounts', () => {
  it('puts the scalars back and leaves the entry counts alone, as upstream does', () => {
    const data = InitializeBoardStatisticsData();
    data.hasOutline = true;
    data.boardArea = 12.5;
    data.minTrackWidth = 7;
    data.boardThickness = 1_600_000;
    data.footprintEntries[0]!.frontCount = 3;

    ResetCounts(data);

    expect(data.hasOutline).toBe(false);
    expect(data.boardArea).toBe(0);
    expect(data.minTrackWidth).toBe(STATISTICS_INT_MAX);
    expect(data.minDrillSize).toBe(STATISTICS_INT_MAX);
    expect(data.boardThickness).toBe(0);
    // NOT reset: `ResetCounts` never touches the per-entry counters.
    expect(data.footprintEntries[0]!.frontCount).toBe(3);
  });

  it('ComputeBoardStatistics resets the data it is handed before counting into it', () => {
    const data = InitializeBoardStatisticsData();
    data.boardArea = 99;
    data.minTrackWidth = 1;
    const out = ComputeBoardStatistics(new BOARD(), undefined, data);
    expect(out).toBe(data);
    expect(data.boardArea).toBe(0);
    expect(data.minTrackWidth).toBe(STATISTICS_INT_MAX);
  });
});
