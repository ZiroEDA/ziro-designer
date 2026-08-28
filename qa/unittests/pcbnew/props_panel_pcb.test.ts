// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_PROPERTIES_PANEL's rows — `pcbnew/widgets/pcb_properties_panel.cpp`.
 *
 * The widget these feed is shared with eeschema
 * (`designer/src/widgets/properties_panel.tsx`), so what is pinned here is
 * only what the pcbnew SUBCLASS decides: which properties a selected board
 * item offers, in which groups and which order, which of them are writeable,
 * which choices the LIVE board supplies, and what each one commits.
 *
 * `qa/unittests/eeschema/props_panel_symbol.test.ts` pins the same facts for
 * the other subclass. Both exist because one widget serving two editors is
 * exactly where "right in one, wrong in the other" hides.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  pcbItemFriendlyName,
  pcbPropertiesFor,
  type PcbPropRow,
} from '@ziroeda/pcbnew/src/properties_panel.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));

/** A distinct colour per layer, so a swatch cannot pass by accident. */
const COLOURS: Record<string, string> = {
  'F.Cu': '#c83434',
  'B.Cu': '#4d7fc4',
  'In1.Cu': '#f2eda1',
  'F.SilkS': '#f2eda1',
  'Edge.Cuts': '#d0d2cd',
};
const CTX = { layerColor: (l: string): string => COLOURS[l] ?? '#000000' };

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (layers
    (0 "F.Cu" signal)
    (1 "In1.Cu" signal)
    (31 "B.Cu" signal)
    (37 "F.SilkS" user)
    (44 "Edge.Cuts" user)
  )
  (net 0 "")
  (net 2 "VCC")
  (net 1 "GND")
  (footprint "Lib:R_0805" (layer "F.Cu") (uuid "fp1") (at 10 20 90)
    (descr "Resistor 0805")
    (tags "resistor smd")
    (attr smd exclude_from_bom dnp)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "f1"))
    (property "Value" "10k" (at 0 1 0) (layer "F.Fab") (uuid "f2"))
    (pad "1" smd rect (at -1 0) (size 1 1.2) (layers "F.Cu" "F.Paste" "F.Mask")
      (net 1 "GND") (pinfunction "A") (pintype "passive") (uuid "p1"))
    (pad "2" thru_hole circle (at 1 0) (size 1.2 1.2) (drill 0.6)
      (layers "*.Cu" "*.Mask") (net 2 "VCC") (uuid "p2")
      (clearance 0.3) (zone_connect 1))
  )
  (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "t1"))
  (arc (start 20 0) (mid 25 5) (end 30 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "a1"))
  (via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "z1") (name "pour") (priority 3)
    (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20)))
  )
  (gr_text "hello" (at 5 5 0) (layer "F.SilkS") (uuid "gt1")
    (effects (font (size 1 1) (thickness 0.15))))
  (gr_line (start 0 0) (end 5 0) (stroke (width 0.1) (type dash)) (layer "Edge.Cuts") (uuid "gl1"))
  (gr_circle (center 30 30) (end 35 30) (stroke (width 0.1) (type solid)) (fill none)
    (layer "F.SilkS") (uuid "gc1"))
)`;

const B = load(SRC);
const rowsFor = (id: string, board: Board = B): PcbPropRow[] => pcbPropertiesFor(board, [id], CTX);
const names = (rows: PcbPropRow[]): string[] => rows.map((r) => r.name);
const groupOrder = (rows: PcbPropRow[]): string[] => {
  const seen: string[] = [];
  for (const r of rows) if (!seen.includes(r.group)) seen.push(r.group);
  return seen;
};
const row = (rows: PcbPropRow[], name: string): PcbPropRow => {
  const hit = rows.find((r) => r.name === name);
  if (!hit) throw new Error(`no row named ${name}; have ${names(rows).join(', ')}`);
  return hit;
};

describe('the caption: EDA_ITEM::GetFriendlyName()', () => {
  it('names each board item by its TYPE, not by its description', () => {
    expect(pcbItemFriendlyName(B, 'footprint:0')).toBe('Footprint');
    expect(pcbItemFriendlyName(B, 'pad:0:1')).toBe('Pad');
    expect(pcbItemFriendlyName(B, 'via:0')).toBe('Via');
    expect(pcbItemFriendlyName(B, 'text:0')).toBe('Text');
  });

  it('separates an arc from a track — PCB_TRACK::GetFriendlyName', () => {
    // pcb_track.cpp:2317-2327. PCB_ARC_T is "Track (arc)", and it is the ONLY
    // thing that distinguishes the two captions; the ENUM_MAP maps both
    // PCB_TRACE_T and PCB_ARC_T to the bare "Track".
    expect(pcbItemFriendlyName(B, 'track:0')).toBe('Track');
    expect(pcbItemFriendlyName(B, 'arc:0')).toBe('Track (arc)');
  });

  it('names the kind of zone — ZONE::GetFriendlyName', () => {
    // zone.cpp:1092-1102: a zone on copper is a "Copper Zone", not a "Zone".
    expect(pcbItemFriendlyName(B, 'zone:0')).toBe('Copper Zone');
    const ruleArea = load(
      SRC.replace('(name "pour")', '(name "pour") (keepout (tracks not_allowed))'),
    );
    expect(pcbItemFriendlyName(ruleArea, 'zone:0')).toBe('Rule Area');
  });

  it('names the SHAPE for a graphic — EDA_SHAPE::getFriendlyName', () => {
    // eda_shape.cpp:1262-1286. PCB_SHAPE_T's ENUM_MAP entry is "Graphic";
    // the override replaces it with the shape, so a gr_line is "Segment".
    expect(pcbItemFriendlyName(B, 'shape:0')).toBe('Segment');
    expect(pcbItemFriendlyName(B, 'shape:1')).toBe('Circle');
  });
});

describe('FOOTPRINT rows', () => {
  const rows = rowsFor('footprint:0');

  it('groups them Basic / Fields / Attributes / Overrides, in that order', () => {
    // FOOTPRINT_DESC (footprint.cpp:4907, 4931, 4945) names the last three;
    // the unnamed group is PROPERTIES_PANEL's "Basic Properties" and comes
    // first. Alphabetically the order would be '', Attributes, Fields,
    // Overrides — so this assertion can fail if the builder ever sorts.
    expect(groupOrder(rows)).toEqual(['', 'Fields', 'Attributes', 'Overrides']);
  });

  it('lists every row, in display order', () => {
    expect(names(rows)).toEqual([
      'Position X',
      'Position Y',
      'Locked',
      'Layer',
      'Orientation',
      'Reference',
      'Value',
      'Library Link',
      'Library Description',
      'Keywords',
      'Component Class',
      'Not in Schematic',
      'Exclude From Position Files',
      'Exclude From Bill of Materials',
      'Do not Populate',
      'Exempt From Courtyard Requirement',
      'Clearance Override',
      'Solderpaste Margin Override',
      'Solderpaste Margin Ratio Override',
      'Zone Connection Style',
    ]);
  });

  it('reads the library fields off the footprint, read-only', () => {
    expect(row(rows, 'Library Link').value).toBe('Lib:R_0805');
    expect(row(rows, 'Library Description').value).toBe('Resistor 0805');
    expect(row(rows, 'Keywords').value).toBe('resistor smd');
    for (const n of ['Library Link', 'Library Description', 'Keywords', 'Component Class'])
      expect(row(rows, n).set).toBeUndefined();
  });

  it('reads the attribute flags off (attr …)', () => {
    expect(row(rows, 'Do not Populate').value).toBe(true);
    expect(row(rows, 'Exclude From Bill of Materials').value).toBe(true);
    expect(row(rows, 'Exclude From Position Files').value).toBe(false);
    expect(row(rows, 'Not in Schematic').value).toBe(false);
  });

  it('gives the Layer row a swatch of the layer colour, and no editor', () => {
    // PCB_PROPERTIES_PANEL::createPGProperty turns a PCB_LAYER_ID property
    // into a PGPROPERTY_COLORENUM whose SetColorFunc reads the frame's colour
    // settings. A footprint's layer changes by FLIPPING it, not by writing
    // the property, so this one stays read-only.
    const layer = row(rows, 'Layer');
    expect(layer.value).toBe('F.Cu');
    expect(layer.swatch).toBe('#c83434');
    expect(layer.set).toBeUndefined();
  });

  it('shows the orientation normalised to (-180, 180] with the degree sign', () => {
    // PGPROPERTY_ANGLE::ValueToString is "%g°" (pg_properties.cpp:595-620).
    expect(row(rows, 'Orientation').value).toBe('90°');
    const spun = load(SRC.replace('(at 10 20 90)', '(at 10 20 270)'));
    expect(row(rowsFor('footprint:0', spun), 'Orientation').value).toBe('-90°');
  });

  it('commits a position as a MOVE of the whole footprint', () => {
    // The footprint sits at (10, 20) rotated 90 degrees, so its first pad —
    // local (-1, 0) — sits at (10, 21). Both axes are asserted, and the axis
    // that did NOT move is asserted too: `BOARD_ITEM::SetX` on a FOOTPRINT is
    // `FOOTPRINT::Move`, which shifts the children by the same delta and
    // leaves the other axis alone. A builder that wrote the anchor without
    // moving the children leaves the pad at (10, 21) and fails here.
    const movedX = row(rows, 'Position X').set?.(MM(12));
    expect(movedX?.footprints[0]?.at).toEqual({ x: MM(12), y: MM(20) });
    expect(movedX?.footprints[0]?.pads[0]?.at).toEqual({ x: MM(12), y: MM(21) });

    const movedY = row(rows, 'Position Y').set?.(MM(25));
    expect(movedY?.footprints[0]?.at).toEqual({ x: MM(10), y: MM(25) });
    expect(movedY?.footprints[0]?.pads[0]?.at).toEqual({ x: MM(10), y: MM(26) });
  });

  it('commits Reference and Value into the footprint fields', () => {
    expect(row(rows, 'Reference').set?.('R7')?.footprints[0]?.reference).toBe('R7');
    expect(row(rows, 'Value').set?.('22k')?.footprints[0]?.value).toBe('22k');
  });

  it('rejects an orientation that is not a number rather than writing NaN', () => {
    expect(row(rows, 'Orientation').set?.('sideways')).toBeNull();
  });
});

describe('PAD rows', () => {
  const smd = rowsFor('pad:0:0');
  const pth = rowsFor('pad:0:1');

  it('groups them Basic / Pad Properties / Overrides', () => {
    // pad.cpp:3444 and :3771 name the last two.
    expect(groupOrder(smd)).toEqual(['', 'Pad Properties', 'Overrides']);
  });

  it('drops Size Y for a circle and the hole rows for an SMD pad', () => {
    expect(names(smd)).toContain('Size Y');
    expect(names(smd)).not.toContain('Hole Size X');
    expect(names(pth)).not.toContain('Size Y');
    expect(names(pth)).toContain('Hole Shape');
    expect(names(pth)).toContain('Hole Size X');
    // Hole Size Y is the oblong-hole row only.
    expect(names(pth)).not.toContain('Hole Size Y');
  });

  it('summarises the copper layers read-only', () => {
    expect(row(smd, 'Copper Layers').value).toBe('F.Cu');
    expect(row(pth, 'Copper Layers').value).toBe('All copper layers');
    expect(row(smd, 'Copper Layers').set).toBeUndefined();
  });

  it('reads the pin function and type off the pad, read-only', () => {
    expect(row(smd, 'Pin Name').value).toBe('A');
    expect(row(smd, 'Pin Type').value).toBe('passive');
    expect(row(smd, 'Pin Name').set).toBeUndefined();
  });

  it('shows an unset override as blank, and a set one as its value', () => {
    // PGPROPERTY_DISTANCE over std::optional<int>: DistanceToString returns
    // wxEmptyString when the optional is empty, so "inherit" is not "0".
    const unset = row(smd, 'Clearance Override');
    expect(unset.value).toBeNull();
    expect(unset.optional).toBe(true);
    expect(row(pth, 'Clearance Override').value).toBe(MM(0.3));
  });

  it('clears an override when the cell is emptied', () => {
    const next = row(pth, 'Clearance Override').set?.('');
    // Asserted BEFORE the value: a builder that simply refused the empty
    // string would return null here, and `null?.…  ?? null` is also null —
    // the rejection and the clear would be indistinguishable.
    expect(next).not.toBeNull();
    expect(next).not.toBeUndefined();
    expect(next?.footprints[0]?.pads[1]?.clearance ?? null).toBeNull();
    // The pad is otherwise untouched, so this is a cleared override and not a
    // dropped pad.
    expect(next?.footprints[0]?.pads[1]?.number).toBe('2');
  });

  it('offers the board’s nets as the Net choices, sorted by name', () => {
    // PCB_PROPERTIES_PANEL::updateLists sorts CmpNoCase; the file lists VCC
    // before GND, so an unsorted builder would fail here.
    expect(row(smd, 'Net').choices).toEqual(['<no net>', 'GND', 'VCC']);
    expect(row(smd, 'Net').value).toBe('GND');
    expect(row(smd, 'Net').set?.('VCC')?.footprints[0]?.pads[0]?.net).toBe(2);
  });

  it('offers the pad type and shape as labels, and commits the token', () => {
    expect(row(smd, 'Pad Shape').value).toBe('Rectangle');
    expect(row(smd, 'Pad Shape').choices).toEqual([
      'Circle',
      'Rectangle',
      'Rounded rectangle',
      'Oval',
      'Trapezoidal',
      'Custom',
    ]);
    expect(row(smd, 'Pad Shape').set?.('Oval')?.footprints[0]?.pads[0]?.shape).toBe('oval');
    // A label that is not on the list is refused, not written through.
    expect(row(smd, 'Pad Shape').set?.('Hexagon')).toBeNull();
  });

  it('keeps the zone-connection override a choice with Inherited on it', () => {
    expect(row(pth, 'Zone Connection Style').value).toBe('Thermal reliefs');
    expect(row(smd, 'Zone Connection Style').value).toBe('Inherited');
  });
});

describe('TRACK and ARC rows', () => {
  const track = rowsFor('track:0');
  const arc = rowsFor('arc:0');

  it('lists the endpoints, the net, then the track group', () => {
    expect(names(track)).toEqual([
      'Start X',
      'Start Y',
      'End X',
      'End Y',
      'Net',
      'Layer',
      'Width',
      'Locked',
    ]);
    expect(groupOrder(track)).toEqual(['', 'Track Properties']);
  });

  it('makes an arc’s endpoints read-only, because its mid point drives them', () => {
    for (const n of ['Start X', 'Start Y', 'End X', 'End Y']) {
      expect(row(track, n).set, `track ${n}`).toBeTypeOf('function');
      expect(row(arc, n).set, `arc ${n}`).toBeUndefined();
    }
    // Everything else stays writeable on an arc.
    expect(row(arc, 'Width').set).toBeTypeOf('function');
  });

  it('offers COPPER layers only, with the layer colour beside the name', () => {
    // updateLists gives a BOARD_CONNECTED_ITEM `layersCu`, not `layersAll`:
    // F.SilkS and Edge.Cuts are enabled on this board and must not be here.
    const layer = row(track, 'Layer');
    expect(layer.choices).toEqual(['F.Cu', 'In1.Cu', 'B.Cu']);
    expect(layer.swatch).toBe('#c83434');
    expect(layer.set?.('B.Cu')?.tracks[0]?.layer).toBe('B.Cu');
  });

  it('commits a width in internal units', () => {
    expect(row(track, 'Width').set?.(MM(0.5))?.tracks[0]?.width).toBe(MM(0.5));
  });
});

describe('VIA rows', () => {
  const rows = rowsFor('via:0');

  it('groups them Basic / Via Properties / Teardrops', () => {
    // "Teardrops" is BOARD_CONNECTED_ITEM_DESC's group
    // (board_connected_item.cpp:301); "Via Properties" is pcb_track.cpp:3178.
    expect(groupOrder(rows)).toEqual(['', 'Via Properties', 'Teardrops']);
  });

  it('gives Layer Top and Layer Bottom their own swatches', () => {
    expect(row(rows, 'Layer Top').value).toBe('F.Cu');
    expect(row(rows, 'Layer Top').swatch).toBe('#c83434');
    expect(row(rows, 'Layer Bottom').value).toBe('B.Cu');
    expect(row(rows, 'Layer Bottom').swatch).toBe('#4d7fc4');
  });

  it('commits the diameter and the hole', () => {
    expect(row(rows, 'Diameter').set?.(MM(1))?.vias[0]?.size).toBe(MM(1));
    expect(row(rows, 'Hole').set?.(MM(0.5))?.vias[0]?.drill).toBe(MM(0.5));
  });
});

describe('ZONE rows', () => {
  const rows = rowsFor('zone:0');

  it('groups them Basic / Fill Style', () => {
    // zone.cpp:2089 names "Fill Style".
    expect(groupOrder(rows)).toEqual(['', 'Fill Style']);
  });

  it('reads the name, priority and layers off the pour', () => {
    expect(row(rows, 'Name').value).toBe('pour');
    expect(row(rows, 'Priority').value).toBe(3);
    expect(row(rows, 'Priority').kind).toBe('int');
    expect(row(rows, 'Layers').value).toBe('F.Cu');
    expect(row(rows, 'Layers').set).toBeUndefined();
  });

  it('shows the border display as its ZONE_BORDER_DISPLAY_STYLE label', () => {
    expect(row(rows, 'Border Display').value).toBe('Hatched');
    expect(row(rows, 'Border Display').choices).toEqual([
      'Line',
      'Hatched',
      'Fully hatched',
      'Invisible',
    ]);
  });

  it('commits a priority', () => {
    expect(row(rows, 'Priority').set?.(7)?.zones[0]?.priority).toBe(7);
  });
});

describe('TEXT rows', () => {
  const rows = rowsFor('text:0');

  it('groups them Basic / Text Properties', () => {
    // pcb_text.cpp:754 names "Text Properties".
    expect(groupOrder(rows)).toEqual(['', 'Text Properties']);
  });

  it('offers ALL enabled layers, not only copper — PCB_TEXT is a BOARD_ITEM', () => {
    expect(row(rows, 'Layer').choices).toEqual(['F.Cu', 'In1.Cu', 'B.Cu', 'F.SilkS', 'Edge.Cuts']);
    expect(row(rows, 'Layer').swatch).toBe('#f2eda1');
  });

  it('carries the five EDA_TEXT flags as bool rows', () => {
    expect(names(rows).slice(-5)).toEqual(['Bold', 'Italic', 'Mirrored', 'Knockout', 'Hidden']);
    for (const n of ['Bold', 'Italic', 'Mirrored', 'Knockout', 'Hidden'])
      expect(row(rows, n).kind).toBe('bool');
  });

  it('commits the text', () => {
    expect(row(rows, 'Text').set?.('goodbye')?.texts[0]?.text).toBe('goodbye');
  });
});

describe('SHAPE rows', () => {
  const line = rowsFor('shape:0');
  const circle = rowsFor('shape:1');

  it('lists only the points the shape kind uses', () => {
    // shapePointsUsed: a segment has start/end, a circle centre/radius.
    expect(names(line).slice(0, 4)).toEqual(['Start X', 'Start Y', 'End X', 'End Y']);
    expect(names(circle).slice(0, 4)).toEqual(['Center X', 'Center Y', 'Radius X', 'Radius Y']);
  });

  it('offers ENUM_MAP<LINE_STYLE> without DEFAULT', () => {
    // common/eda_shape.cpp:2833 registers the five lineTypeNames only.
    expect(row(line, 'Line Style').choices).toEqual([
      'Solid',
      'Dashed',
      'Dotted',
      'Dash-Dot',
      'Dash-Dot-Dot',
    ]);
    expect(row(line, 'Line Style').value).toBe('Dashed');
    expect(row(line, 'Line Style').set?.('Dotted')?.shapes[0]?.strokeType).toBe('dot');
  });

  it('groups them Basic / Stroke', () => {
    expect(groupOrder(line)).toEqual(['', 'Stroke']);
  });
});

describe('the selection rule', () => {
  it('builds rows for exactly one selected item', () => {
    // PROPERTIES_PANEL shows the properties common to a multi-selection; we
    // build none, and the caption still counts them. An empty selection has
    // no rows because `reset()` clears the grid.
    expect(pcbPropertiesFor(B, [], CTX)).toEqual([]);
    expect(pcbPropertiesFor(B, ['track:0', 'via:0'], CTX)).toEqual([]);
    expect(pcbPropertiesFor(B, ['track:0'], CTX).length).toBeGreaterThan(0);
  });

  it('has no rows for an id it cannot resolve, and does not throw', () => {
    expect(pcbPropertiesFor(B, ['nonsense'], CTX)).toEqual([]);
    expect(pcbPropertiesFor(B, ['footprint:99'], CTX)).toEqual([]);
  });
});
