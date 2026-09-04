// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board's message-panel rows.
 * Counterparts: the `GetMsgPanelInfo` overrides listed at the top of
 * `pcbnew/src/msg_panel.ts`, and `PCB_CONTROL::UpdateMessagePanel`.
 *
 * **Every row is asserted as a label/value pair, and the whole list is compared
 * at once.** A test that only counted rows, or only checked that some row said
 * `mm`, would pass with the wrong thirteen rows in the wrong order — which is
 * exactly the failure this module exists to fix. Every expected string is
 * transcribed from the C++ (`_( "Rounded rectangle" )`, `_( "Conn" )`,
 * `"%.2fdeg"`) or computed by hand from the fixture, never by running the code.
 */
import { describe, expect, it } from 'vitest';
import {
  arcMsgPanelInfo,
  boardMsgPanelInfo,
  footprintMsgPanelInfo,
  layerMaskDescribe,
  padCountForDisplay,
  padMsgPanelInfo,
  pcbMsgPanelInfo,
  pcbShapeMsgPanelInfo,
  pcbTextMsgPanelInfo,
  trackMsgPanelInfo,
  viaMsgPanelInfo,
  zoneMsgPanelInfo,
  type PcbMsgPanelContext,
} from '@ziroeda/pcbnew/src/msg_panel.js';
import type {
  Board,
  PcbArcTrack,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbTrack,
  PcbVia,
  PcbZone,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });

/** 1 mm in pcbnew internal units. */
const MM = 1_000_000;

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: P(0, 0),
  angle: 0,
  size: P(MM, 2 * MM),
  layers: ['F.Cu', 'F.Mask', 'F.Paste'],
  net: 1,
  source: EMPTY,
  ...over,
});

const fp = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'Resistor_SMD:R_0805_2012Metric',
  at: P(0, 0),
  angle: 0,
  layer: 'F.Cu',
  reference: 'R1',
  value: '10k',
  descr: 'Resistor SMD 0805',
  tags: 'resistor',
  pads: [pad()],
  shapes: [],
  texts: [],
  points: [],
  models: [],
  source: EMPTY,
  ...over,
});

const track = (over: Partial<PcbTrack> = {}): PcbTrack => ({
  start: P(0, 0),
  end: P(3 * MM, 4 * MM),
  width: 250_000,
  layer: 'F.Cu',
  net: 1,
  source: EMPTY,
  ...over,
});

const via = (over: Partial<PcbVia> = {}): PcbVia => ({
  at: P(0, 0),
  size: 600_000,
  drill: 300_000,
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
    { id: 2, name: 'B.Cu', kind: 'signal' },
    { id: 36, name: 'F.SilkS', kind: 'user' },
    { id: 39, name: 'F.Mask', kind: 'user' },
    { id: 35, name: 'F.Paste', kind: 'user' },
    { id: 44, name: 'Edge.Cuts', kind: 'user' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'GND'],
    [2, '/VCC'],
    [3, 'unused'],
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

const ctx = (over: Partial<PcbMsgPanelContext> = {}): PcbMsgPanelContext => ({
  board: board(),
  units: 'mm',
  frame: 'pcb_edit',
  ...over,
});

// ---------------------------------------------------------------------------

describe('BOARD::GetMsgPanelInfo (pcbnew/board.cpp:2285)', () => {
  it('counts the netcodes the board actually uses, not the size of the net table', () => {
    // board.cpp:2291-2313 walks tracks and pads and inserts GetNetCode() > 0.
    // The fixture's net table declares GND, /VCC and `unused`; only GND and
    // /VCC are on something, so Nets is 2 - `nets.size - 1` would say 3.
    const b = board({
      footprints: [fp({ pads: [pad({ net: 1 }), pad({ net: 0 })] })],
      tracks: [track({ net: 2 })],
      arcs: [],
      vias: [via({ net: 1 })],
    });

    expect(boardMsgPanelInfo(ctx({ board: b, unconnectedCount: 4 }))).toEqual([
      { upper: 'Pads', lower: '2' },
      { upper: 'Vias', lower: '1' },
      { upper: 'Track Segments', lower: '1' },
      { upper: 'Nets', lower: '2' },
      { upper: 'Unrouted', lower: '4' },
    ]);
  });

  it('counts an arc as a track segment and not as a via', () => {
    // m_tracks holds PCB_ARC_T too, and only PCB_VIA_T increments viaCount.
    const b = board({
      tracks: [track()],
      arcs: [{ ...track(), mid: P(MM, 0) } as unknown as PcbArcTrack],
      vias: [via()],
    });
    const rows = boardMsgPanelInfo(ctx({ board: b }));

    expect(rows[1]).toEqual({ upper: 'Vias', lower: '1' });
    expect(rows[2]).toEqual({ upper: 'Track Segments', lower: '2' });
  });
});

describe('FOOTPRINT::GetMsgPanelInfo (pcbnew/footprint.cpp:2131)', () => {
  it('shows the board editor list', () => {
    const f = fp({
      angle: 90,
      locked: true,
      attributes: ['smd', 'exclude_from_bom', 'dnp'],
      models: [
        {
          path: '${KICAD8_3DMODEL_DIR}/R_0805.wrl',
          offset: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotate: { x: 0, y: 0, z: 0 },
        },
      ],
    });

    expect(footprintMsgPanelInfo(ctx({ board: board({ footprints: [f] }) }), f)).toEqual([
      { upper: 'R1', lower: '10k' },
      { upper: 'Board Side', lower: 'Front' },
      { upper: 'Rotation', lower: '90' },
      { upper: 'Status: Locked', lower: 'Attributes: exclude from BOM, DNP' },
      {
        upper: 'Footprint: Resistor_SMD:R_0805_2012Metric',
        lower: '3D-Shape: ${KICAD8_3DMODEL_DIR}/R_0805.wrl',
      },
      { upper: 'Doc: Resistor SMD 0805', lower: 'Keywords: resistor' },
    ]);
  });

  it('says <none> when the footprint carries no 3D shape', () => {
    // footprint.cpp:2212 - _( "<none>" ), not an empty string.
    const rows = footprintMsgPanelInfo(ctx(), fp());
    expect(rows[4]?.lower).toBe('3D-Shape: <none>');
  });

  it('flips the Board Side row for a back-side footprint', () => {
    const f = fp({ layer: 'B.Cu', pads: [pad({ layers: ['B.Cu', 'B.Mask'] })] });
    const rows = footprintMsgPanelInfo(ctx(), f);
    expect(rows[1]).toEqual({ upper: 'Board Side', lower: 'Back (Flipped)' });
  });

  it('omits Board Side entirely when nothing in the footprint is side-specific', () => {
    // FOOTPRINT::GetSide returns UNDEFINED_LAYER and the switch has no case
    // for it (footprint.cpp:2161-2167), so the row is absent - not blank.
    const f = fp({ pads: [], shapes: [], texts: [] });
    const rows = footprintMsgPanelInfo(ctx(), f);
    expect(rows.map((r) => r.upper)).not.toContain('Board Side');
  });

  it('writes the rotation with %.4g, so 33.333333 is four significant digits', () => {
    // footprint.cpp:2170 - wxString::Format( "%.4g", … ).
    const rows = footprintMsgPanelInfo(ctx(), fp({ angle: 33.333333 }));
    expect(rows[2]).toEqual({ upper: 'Rotation', lower: '33.33' });
  });

  it('gives CVPCB’s viewer the BOARD EDITOR’s rows, not the viewer list', () => {
    // FRAME_CVPCB_DISPLAY is not one of the three the early return names
    // (footprint.cpp:2143-2146: FRAME_FOOTPRINT_VIEWER / _CHOOSER / _EDITOR),
    // so DISPLAY_FOOTPRINTS_FRAME falls through to Rotation / Status /
    // Attributes / Footprint / 3D-Shape. A real cvpcb viewer shows exactly
    // that, and reading the branch as "not the board editor means a viewer"
    // gave this one frame Library / Footprint Name / Pads instead.
    const f = fp({ angle: 0 });
    const rows = footprintMsgPanelInfo(ctx({ frame: 'cvpcb_display' }), f);
    expect(rows.map((r) => r.upper)).toEqual([
      'R1',
      'Rotation',
      'Status: ',
      'Footprint: Resistor_SMD:R_0805_2012Metric',
      'Doc: Resistor SMD 0805',
    ]);
    expect(rows.map((r) => r.upper)).not.toContain('Library');
    expect(rows.map((r) => r.upper)).not.toContain('Pads');
  });

  it('and still no Board Side row: its board is a footprint holder', () => {
    // `FOOTPRINT::GetSide` returns UNDEFINED_LAYER for any FPHOLDER board
    // (footprint.cpp:2219-2223), and DISPLAY_FOOTPRINTS_FRAME sets
    // `BOARD_USE::FPHOLDER` on its own board (display_footprints_frame.cpp:83).
    // The same footprint DOES get the row in the board editor, which is what
    // makes this a property of the frame and not of the footprint.
    const f = fp({ layer: 'F.Cu', pads: [pad({ layers: ['F.Cu', 'F.Mask'] })] });
    expect(footprintMsgPanelInfo(ctx({ frame: 'pcb_edit' }), f).map((r) => r.upper)).toContain(
      'Board Side',
    );
    expect(
      footprintMsgPanelInfo(ctx({ frame: 'cvpcb_display' }), f).map((r) => r.upper),
    ).not.toContain('Board Side');
  });

  it('shows the footprint editor list instead, ending at Doc/Keywords', () => {
    const f = fp({
      pads: [pad(), pad({ type: 'np_thru_hole' }), pad({ type: 'np_thru_hole' })],
    });

    expect(footprintMsgPanelInfo(ctx({ frame: 'footprint_edit' }), f)).toEqual([
      { upper: 'R1', lower: '10k' },
      { upper: 'Library', lower: 'Resistor_SMD' },
      { upper: 'Footprint Name', lower: 'R_0805_2012Metric' },
      { upper: 'Pads', lower: '1' },
      { upper: 'Doc: Resistor SMD 0805', lower: 'Keywords: resistor' },
    ]);
  });
});

describe('FOOTPRINT::GetPadCount( DO_NOT_INCLUDE_NPTH ) (footprint.cpp:2514)', () => {
  it('leaves the non-plated holes out', () => {
    const f = fp({
      pads: [pad(), pad(), pad({ type: 'np_thru_hole' }), pad({ type: 'thru_hole' })],
    });
    // Four pads on the footprint; the NPTH one is not counted.
    expect(f.pads.length).toBe(4);
    expect(padCountForDisplay(f)).toBe(3);
  });
});

describe('PAD::GetMsgPanelInfo (pcbnew/pad.cpp:1886)', () => {
  it('gives a through-hole pad its thirteen rows, each with its unit', () => {
    const p = pad({
      number: '2',
      type: 'thru_hole',
      shape: 'roundrect',
      layers: ['*.Cu', '*.Mask'],
      size: P(1_600_000, 1_600_000),
      drill: { oblong: false, w: 800_000, h: 800_000 },
      pinFunction: 'SDA',
      pinType: 'bidirectional',
      padToDieLength: 500_000,
      angle: 45,
      net: 2,
    });
    const parent = fp({ pads: [p] });
    const c = ctx({
      board: board({ footprints: [parent] }),
      netClassOf: new Map([[2, 'Power']]),
    });

    expect(padMsgPanelInfo(c, p, parent)).toEqual([
      { upper: 'Footprint', lower: 'R1' },
      { upper: 'Pad', lower: '2' },
      { upper: 'Pin Name', lower: 'SDA' },
      { upper: 'Pin Type', lower: 'bidirectional' },
      // UnescapeString turns the netlist's `/VCC` back into `/VCC`.
      { upper: 'Net', lower: '/VCC' },
      { upper: 'Resolved Netclass', lower: 'Power' },
      // ShowPadShape( ROUNDRECT ) is "Rounded rectangle", ShowPadAttr( PTH )
      // is "PTH" (pad.cpp:2172, :2206).
      { upper: 'Rounded rectangle', lower: 'PTH' },
      { upper: 'Width', lower: '1.6000 mm' },
      { upper: 'Height', lower: '1.6000 mm' },
      { upper: 'Rotation', lower: '45' },
      { upper: 'Length in Package', lower: '0.5000 mm' },
      { upper: 'Hole', lower: '0.8000 mm' },
    ]);
  });

  it('gives a round pad one Diameter row rather than Width and Height', () => {
    // pad.cpp:1957-1969: CIRCLE or OVAL with a square size.
    const p = pad({ shape: 'circle', size: P(MM, MM) });
    const rows = padMsgPanelInfo(ctx(), p, undefined);
    const labels = rows.map((r) => r.upper);

    expect(labels).toContain('Diameter');
    expect(labels).not.toContain('Height');
    expect(rows.find((r) => r.upper === 'Diameter')?.lower).toBe('1.0000 mm');
  });

  it('shows an SMD pad its Layer row, and a through-hole pad none', () => {
    // pad.cpp:1917-1918 - only SMD and CONN.
    const smd = padMsgPanelInfo(ctx(), pad({ type: 'smd' }), undefined);
    expect(smd.find((r) => r.upper === 'Layer')?.lower).toBe('F.Cu');

    const tht = padMsgPanelInfo(ctx(), pad({ type: 'thru_hole' }), undefined);
    expect(tht.map((r) => r.upper)).not.toContain('Layer');
  });

  it('calls a connector pad "Conn" and appends its property after a comma', () => {
    // ShowPadAttr( CONN ) is _( "Conn" ) (pad.cpp:2208) and the property is
    // joined with a bare ',' (pad.cpp:1934).
    const rows = padMsgPanelInfo(
      ctx(),
      pad({ type: 'connect', shape: 'rect', padProperty: 'pad_prop_testpoint' }),
      undefined,
    );
    expect(rows).toContainEqual({ upper: 'Rectangle', lower: 'Conn,Test point' });
  });

  it('reports the rotation relative to a turned footprint, with the footprint in brackets', () => {
    // pad.cpp:1968-1978 - "%g(+ %g)" of the normalised difference and the
    // footprint's own orientation.
    const parent = fp({ angle: 90 });
    const rows = padMsgPanelInfo(ctx(), pad({ angle: 135 }), parent);
    expect(rows).toContainEqual({ upper: 'Rotation', lower: '45(+ 90)' });
  });

  it('writes an oblong hole as X / Y', () => {
    const rows = padMsgPanelInfo(
      ctx(),
      pad({ type: 'thru_hole', drill: { oblong: true, w: 800_000, h: 1_200_000 } }),
      undefined,
    );
    expect(rows).toContainEqual({ upper: 'Hole X / Y', lower: '0.8000 mm / 1.2000 mm' });
  });

  it('drops the Footprint / Net / Netclass rows in the footprint editor', () => {
    // pad.cpp:1891-1895 and :1905-1914 are both guarded on PCB_EDIT_FRAME.
    const parent = fp();
    const labels = padMsgPanelInfo(ctx({ frame: 'footprint_edit' }), pad(), parent).map(
      (r) => r.upper,
    );

    expect(labels).not.toContain('Footprint');
    expect(labels).not.toContain('Net');
    expect(labels).not.toContain('Resolved Netclass');
    expect(labels[0]).toBe('Pad');
  });

  it('prints in the frame’s units, mils included', () => {
    const rows = padMsgPanelInfo(
      ctx({ units: 'mils' }),
      pad({ shape: 'circle', size: P(MM, MM) }),
      undefined,
    );
    // 1 mm = 39.37 mils, at MessageTextFromValue's long-form %.2f.
    expect(rows).toContainEqual({ upper: 'Diameter', lower: '39.37 mils' });
  });
});

describe('PCB_TRACK / PCB_ARC / PCB_VIA (pcbnew/pcb_track.cpp:2329, :2427)', () => {
  it('gives a track Type, Net, Netclass, Layer, Width and Segment Length', () => {
    // A 3-4-5 triangle, so the length is exactly 5 mm.
    const rows = trackMsgPanelInfo(ctx({ netClassOf: new Map([[1, 'Default']]) }), track());

    expect(rows).toEqual([
      { upper: 'Type', lower: 'Track' },
      { upper: 'Net', lower: 'GND' },
      { upper: 'Resolved Netclass', lower: 'Default' },
      { upper: 'Layer', lower: 'F.Cu' },
      { upper: 'Width', lower: '0.2500 mm' },
      { upper: 'Segment Length', lower: '5.0000 mm' },
    ]);
  });

  it('adds the Status row for a locked track, and only in the board editor', () => {
    // pcb_track.cpp:2477-2478.
    const locked = track({ locked: true });
    expect(trackMsgPanelInfo(ctx(), locked)).toContainEqual({
      upper: 'Status',
      lower: 'Locked',
    });
    expect(trackMsgPanelInfo(ctx({ frame: 'footprint_edit' }), locked)).not.toContainEqual({
      upper: 'Status',
      lower: 'Locked',
    });
  });

  it('calls an arc "Track (arc)" and adds Radius and Angle', () => {
    // A quarter circle of radius 1 mm, centred on the origin.
    const a: PcbArcTrack = {
      start: P(MM, 0),
      mid: P(Math.round(MM * Math.SQRT1_2), Math.round(MM * Math.SQRT1_2)),
      end: P(0, MM),
      width: 250_000,
      layer: 'F.Cu',
      net: 1,
      source: EMPTY,
    };
    const rows = arcMsgPanelInfo(ctx(), a);

    expect(rows[0]).toEqual({ upper: 'Type', lower: 'Track (arc)' });
    expect(rows.find((r) => r.upper === 'Radius')?.lower).toBe('1.0000 mm');
    // "%.2fdeg" - no space before the unit (pcb_track.cpp:2347).
    expect(rows.find((r) => r.upper === 'Angle')?.lower).toBe('90.00deg');
    // A quarter of a 1 mm circle: pi/2 mm = 1.5708, trimmed to 1.571.
    expect(rows.find((r) => r.upper === 'Segment Length')?.lower).toBe('1.5708 mm');
  });

  it('names the via type and gives it a layer pair', () => {
    expect(viaMsgPanelInfo(ctx(), via())).toEqual([
      { upper: 'Type', lower: 'Through Via' },
      { upper: 'Net', lower: 'GND' },
      { upper: 'Resolved Netclass', lower: 'Default' },
      { upper: 'Layer', lower: 'F.Cu - B.Cu' },
      { upper: 'Diameter', lower: '0.6000 mm' },
      { upper: 'Hole', lower: '0.3000 mm' },
    ]);
  });

  it('uses the VIATYPE switch’s own names', () => {
    // pcb_track.cpp:2431-2439.
    expect(viaMsgPanelInfo(ctx(), via({ kind: 'micro' }))[0]?.lower).toBe('Micro Via');
    expect(viaMsgPanelInfo(ctx(), via({ kind: 'blind' }))[0]?.lower).toBe('Blind Via');
  });
});

describe('ZONE::GetMsgPanelInfo (pcbnew/zone.cpp:929)', () => {
  const zone = (over: Partial<PcbZone> = {}): PcbZone => ({
    net: 1,
    layers: ['F.Cu'],
    fills: [{ layer: 'F.Cu', polys: [[P(0, 0), P(2 * MM, 0), P(2 * MM, MM), P(0, MM)]] }],
    source: EMPTY,
    ...over,
  });

  it('gives a copper zone its rows, with the filled area in mm²', () => {
    // 2 mm x 1 mm = 2 mm2; AREA forces short_form, so %.3f then the 2-1/2
    // digit trim leaves "2".
    expect(zoneMsgPanelInfo(ctx(), zone())).toEqual([
      { upper: 'Type', lower: 'Copper Zone' },
      { upper: 'Net', lower: 'GND' },
      { upper: 'Resolved Netclass', lower: 'Default' },
      { upper: 'Priority', lower: '0' },
      { upper: 'Layer', lower: 'F.Cu' },
      { upper: 'Fill Mode', lower: 'Solid' },
      { upper: 'Filled Area', lower: '2.00 mm²' },
      { upper: 'Corner Count', lower: '4' },
    ]);
  });

  it('describes two and three layers the way zone.cpp spells them', () => {
    // zone.cpp:987-1006.
    const two = zoneMsgPanelInfo(ctx(), zone({ layers: ['F.Cu', 'B.Cu'] }));
    expect(two.find((r) => r.upper === 'Layer')?.lower).toBe('F.Cu and B.Cu');

    const three = zoneMsgPanelInfo(ctx(), zone({ layers: ['F.Cu', 'B.Cu', 'F.SilkS'] }));
    expect(three.find((r) => r.upper === 'Layer')?.lower).toBe('F.Cu, B.Cu and F.Silkscreen');

    const four = zoneMsgPanelInfo(ctx(), zone({ layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'F.Mask'] }));
    expect(four.find((r) => r.upper === 'Layer')?.lower).toBe('F.Cu, B.Cu and 2 more');
  });

  it('swaps the copper rows for Restrictions on a rule area', () => {
    const rows = zoneMsgPanelInfo(
      ctx(),
      zone({
        ruleArea: {
          tracks: true,
          vias: true,
          pads: false,
          copperPour: false,
          footprints: false,
        },
        outline: [P(0, 0), P(2 * MM, 0), P(2 * MM, MM), P(0, MM)],
        fills: [],
      }),
    );

    expect(rows).toEqual([
      { upper: 'Type', lower: 'Rule Area' },
      // AccumulateDescription's order is vias, tracks, pads, fills, footprints
      // (zone.cpp:939-953) - not the order of the keepout token.
      { upper: 'Restrictions', lower: 'No vias, No tracks' },
      { upper: 'Layer', lower: 'F.Cu' },
      { upper: 'Outline Area', lower: '2.00 mm²' },
      { upper: 'Corner Count', lower: '4' },
    ]);
  });

  it('calls a teardrop zone a Teardrop Area', () => {
    const rows = zoneMsgPanelInfo(ctx(), zone({ teardropType: 'viapad' }));
    expect(rows[0]).toEqual({ upper: 'Type', lower: 'Teardrop Area' });
  });

  it('adds the Name row only when the zone has one', () => {
    expect(zoneMsgPanelInfo(ctx(), zone()).map((r) => r.upper)).not.toContain('Name');
    expect(zoneMsgPanelInfo(ctx(), zone({ name: 'GND pour' }))).toContainEqual({
      upper: 'Name',
      lower: 'GND pour',
    });
  });
});

describe('PCB_TEXT::GetMsgPanelInfo (pcbnew/pcb_text.cpp:296)', () => {
  const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
    kind: 'user',
    text: 'HELLO',
    at: P(0, 0),
    angle: 0,
    layer: 'F.SilkS',
    size: P(MM, MM),
    source: EMPTY,
    ...over,
  });

  it('calls a board text "PCB Text" and gives it eight rows', () => {
    expect(pcbTextMsgPanelInfo(ctx(), text(), undefined)).toEqual([
      { upper: 'PCB Text', lower: 'HELLO' },
      { upper: 'Layer', lower: 'F.Silkscreen' },
      { upper: 'Mirror', lower: 'No' },
      { upper: 'Angle', lower: '0' },
      { upper: 'Font', lower: 'Default' },
      { upper: 'Text Thickness', lower: 'Auto' },
      { upper: 'Width', lower: '1.0000 mm' },
      { upper: 'Height', lower: '1.0000 mm' },
    ]);
  });

  it('calls footprint text "Text" and adds Footprint and Type rows', () => {
    const parent = fp();
    const rows = pcbTextMsgPanelInfo(ctx(), text({ kind: 'reference', text: 'R1' }), parent);

    expect(rows[0]).toEqual({ upper: 'Footprint', lower: 'R1' });
    expect(rows[1]).toEqual({ upper: 'Text', lower: 'R1' });
    expect(rows[2]).toEqual({ upper: 'Type', lower: 'Reference' });
  });

  it('says Auto when the text has no explicit thickness', () => {
    // pcb_text.cpp:338-341.
    expect(pcbTextMsgPanelInfo(ctx(), text(), undefined)).toContainEqual({
      upper: 'Text Thickness',
      lower: 'Auto',
    });
    expect(pcbTextMsgPanelInfo(ctx(), text({ thickness: 150_000 }), undefined)).toContainEqual({
      upper: 'Text Thickness',
      lower: '0.1500 mm',
    });
  });
});

describe('PCB_SHAPE::GetMsgPanelInfo (pcbnew/pcb_shape.cpp:699)', () => {
  const shape = (over: Partial<PcbShape> = {}): PcbShape => ({
    kind: 'line',
    start: P(0, 0),
    end: P(3 * MM, 4 * MM),
    width: 100_000,
    fill: false,
    layer: 'F.SilkS',
    source: EMPTY,
    ...over,
  });

  it('reports Type, Shape, the per-shape rows, then the stroke and the layer', () => {
    expect(pcbShapeMsgPanelInfo(ctx(), shape(), undefined)).toEqual([
      { upper: 'Type', lower: 'Drawing' },
      // EDA_SHAPE::getFriendlyName calls a line a "Segment".
      { upper: 'Shape', lower: 'Segment' },
      { upper: 'Length', lower: '5.0000 mm' },
      // The EDA_ANGLE overload of MessageTextFromValue: "%.1f°", counted
      // counter-clockwise from 3 o'clock, so a +y end is -53.1 degrees.
      { upper: 'Angle', lower: '-53.1°' },
      { upper: 'Line Style', lower: 'Solid' },
      { upper: 'Line Width', lower: '0.1000 mm' },
      { upper: 'Layer', lower: 'F.Silkscreen' },
    ]);
  });

  it('gives a rectangle Width and Height and a polygon its Points', () => {
    const rect = pcbShapeMsgPanelInfo(
      ctx(),
      shape({ kind: 'rect', start: P(0, 0), end: P(2 * MM, MM) }),
      undefined,
    );
    expect(rect).toContainEqual({ upper: 'Width', lower: '2.0000 mm' });
    expect(rect).toContainEqual({ upper: 'Height', lower: '1.0000 mm' });

    const poly = pcbShapeMsgPanelInfo(
      ctx(),
      shape({ kind: 'poly', pts: [P(0, 0), P(MM, 0), P(MM, MM)] }),
      undefined,
    );
    expect(poly).toContainEqual({ upper: 'Points', lower: '3' });
  });

  it('names the line style from lineTypeNames', () => {
    // common/stroke_params.cpp:39-45.
    const rows = pcbShapeMsgPanelInfo(ctx(), shape({ strokeType: 'dash_dot' }), undefined);
    expect(rows).toContainEqual({ upper: 'Line Style', lower: 'Dash-Dot' });
  });
});

describe('BOARD_ITEM::LayerMaskDescribe (pcbnew/board_item.cpp:210)', () => {
  it('collapses a full copper stack to "all copper layers"', () => {
    expect(layerMaskDescribe(ctx(), ['*.Cu'])).toBe('all copper layers');
    expect(layerMaskDescribe(ctx(), ['F.Cu', 'B.Cu'])).toBe('all copper layers');
  });

  it('names the first copper layer, and says so when there are more', () => {
    expect(layerMaskDescribe(ctx(), ['F.Cu', 'F.Mask'])).toBe('F.Cu');
    expect(layerMaskDescribe(ctx(), ['F.Mask', 'F.Paste'])).toBe('F.Mask and others');
  });

  it('says "no layers" when nothing is left', () => {
    expect(layerMaskDescribe(ctx(), [])).toBe('no layers');
  });
});

describe('PCB_CONTROL::UpdateMessagePanel (pcbnew/tools/pcb_control.cpp:2377)', () => {
  const b = board({
    footprints: [fp({ pads: [pad({ net: 1 }), pad({ net: 1 })] })],
    tracks: [track({ net: 1 }), track({ net: 1 })],
    vias: [via({ net: 1 })],
  });
  const c = ctx({ board: b });
  const describe_ = (id: string) => `desc(${id})`;

  it('shows the board rows with nothing selected', () => {
    const rows = pcbMsgPanelInfo(c, { ids: [], describe: describe_ });
    expect(rows[0]).toEqual({ upper: 'Pads', lower: '2' });
    expect(rows).toHaveLength(5);
  });

  it('shows the footprint’s own rows with nothing selected in the footprint editor', () => {
    // pcb_control.cpp:2399-2403 - fp->GetMsgPanelInfo, not the board's.
    const rows = pcbMsgPanelInfo(
      { ...c, frame: 'footprint_edit' },
      { ids: [], describe: describe_ },
    );
    expect(rows[0]).toEqual({ upper: 'R1', lower: '10k' });
    expect(rows[1]).toEqual({ upper: 'Library', lower: 'Resistor_SMD' });
  });

  it('shows one item’s own rows', () => {
    const rows = pcbMsgPanelInfo(c, { ids: ['track:0'], describe: describe_ });
    expect(rows[0]).toEqual({ upper: 'Type', lower: 'Track' });
  });

  it('pairs the two descriptions when exactly two are selected', () => {
    // pcb_control.cpp:2541-2543 - one MSG_PANEL_ITEM whose upper is a's
    // description and whose lower is b's.
    expect(pcbMsgPanelInfo(c, { ids: ['track:0', 'via:0'], describe: describe_ })).toEqual([
      { upper: 'desc(track:0)', lower: 'desc(via:0)' },
    ]);
  });

  it('summarises a homogeneous selection by its friendly name, and adds the common net', () => {
    const rows = pcbMsgPanelInfo(c, {
      ids: ['track:0', 'track:1', 'via:0'],
      describe: describe_,
    });

    expect(rows).toEqual([
      // Mixed types, so the breakdown form - ordered by KICAD_T, in which
      // PCB_TRACE_T comes before PCB_VIA_T.
      { upper: 'Selected Items', lower: '3 (Track: 2, Via: 1)' },
      { upper: 'Net', lower: 'GND' },
      { upper: 'Resolved Netclass', lower: 'Default' },
    ]);
  });

  it('uses the "Type: N" form when every selected item is the same type', () => {
    const rows = pcbMsgPanelInfo(c, {
      ids: ['pad:0:0', 'pad:0:1', 'via:0'],
      describe: describe_,
    });
    expect(rows[0]).toEqual({ upper: 'Selected Items', lower: '3 (Pad: 2, Via: 1)' });

    const pads = pcbMsgPanelInfo(c, {
      ids: ['pad:0:0', 'pad:0:1', 'pad:0:0'],
      describe: describe_,
    });
    expect(pads[0]).toEqual({ upper: 'Pad', lower: '3' });
    // The three pads share a layer, a shape and a size, so all three rows come.
    expect(pads[1]).toEqual({ upper: 'Layer', lower: 'F.Cu' });
    expect(pads[2]).toEqual({ upper: 'Pad Shape', lower: 'Rectangle' });
    expect(pads[3]).toEqual({ upper: 'Pad Size', lower: '1.0000 mm x 2.0000 mm' });
  });

  it('drops the Net rows when the selection spans more than one net', () => {
    const mixed = board({
      ...b,
      tracks: [track({ net: 1 }), track({ net: 2 }), track({ net: 1 })],
    });
    const rows = pcbMsgPanelInfo(
      { ...c, board: mixed },
      { ids: ['track:0', 'track:1', 'track:2'], describe: describe_ },
    );
    expect(rows.map((r) => r.upper)).not.toContain('Net');
  });
});
