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
import { head, isList, parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { writeBoardNode } from '@ziroeda/pcbnew/src/write-board.js';
import {
  pcbItemFriendlyName,
  pcbPropertiesFor,
  type PcbPropRow,
} from '@ziroeda/pcbnew/src/properties_panel.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
/** What the board WRITES — a model-only edit that never reaches the source reverts on reload. */
const written = (board: Board): string => serialize(writeBoardNode(board));
/** The head of every DIRECT child of the first footprint's source node. */
const fpChildren = (board: Board): string[] => {
  const src = board.footprints[0]?.source;
  return (src?.items ?? []).filter(isList).map((i) => head(i) ?? '');
};

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

  it('groups them Basic / Fields / Footprint Properties / Attributes / Overrides', () => {
    // FOOTPRINT_DESC names the last four (footprint.cpp:4907 groupFields, 4913
    // propertyFields, 4929 groupAttributes, 4944 groupOverrides); the unnamed
    // group is PROPERTIES_PANEL's "Basic Properties" and comes first.
    // Alphabetically the order would be '', Attributes, Fields, Footprint
    // Properties, Overrides — so this assertion can fail if the builder sorts.
    //
    // "Footprint Properties" is its OWN group and not part of Fields: that is
    // where pcbnew differs from eeschema, whose Library Link / Library
    // Description / Keywords ARE registered with groupFields
    // (sch_symbol.cpp:3946-3956).
    expect(groupOrder(rows)).toEqual([
      '',
      'Fields',
      'Footprint Properties',
      'Attributes',
      'Overrides',
    ]);
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
      // The two remaining MANDATORY fields (footprint.cpp:114-117): this
      // footprint's source writes neither, and KiCad shows both regardless
      // because FOOTPRINT's constructor makes all four.
      'Datasheet',
      'Description',
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

  it('gives the Layer row a swatch, the two sides as its choices, and a FLIP', () => {
    // PCB_PROPERTIES_PANEL::createPGProperty turns a PCB_LAYER_ID property into
    // a PGPROPERTY_COLORENUM whose SetColorFunc reads the frame's colour
    // settings. The FOOTPRINT one is writeable: FOOTPRINT_DESC replaces
    // BOARD_ITEM's Layer with `&FOOTPRINT::SetLayerAndFlip` over a wxPGChoices
    // of F.Cu and B.Cu alone (footprint.cpp:4874-4899) — so choosing the other
    // side flips the footprint, and the row is NOT read-only.
    const layer = row(rows, 'Layer');
    expect(layer.value).toBe('F.Cu');
    expect(layer.swatch).toBe('#c83434');
    expect(layer.choices).toEqual(['F.Cu', 'B.Cu']);

    const flipped = layer.set?.('B.Cu');
    expect(flipped?.footprints[0]?.layer).toBe('B.Cu');
    // A flip, not a layer assignment: the children move with it. The first pad
    // is at (10, 21) on the front, mirrored about the anchor's x on the back.
    expect(flipped?.footprints[0]?.pads[0]?.at).toEqual({ x: MM(10), y: MM(19) });
    expect(flipped?.footprints[0]?.pads[0]?.layers).toContain('B.Cu');
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

/**
 * The Attributes and Overrides groups. Every one of these is a plain
 * `PROPERTY<FOOTPRINT, …>` with a real setter (footprint.cpp:4929-4967), so a
 * read-only cell is a bug and not a design decision — the panel edits the same
 * FOOTPRINT methods DIALOG_FOOTPRINT_PROPERTIES does.
 */
describe('FOOTPRINT rows: the editable attributes and overrides', () => {
  const rows = rowsFor('footprint:0');
  const fp = (b: Board | null | undefined) => b?.footprints[0];

  it('toggles each attribute flag, into (attr …) and into the model', () => {
    // The fixture is `(attr smd exclude_from_bom dnp)`, so each assertion moves
    // a flag that is not already where it is being put.
    const boardOnly = row(rows, 'Not in Schematic').set?.(true);
    expect(fp(boardOnly)?.attributes).toContain('board_only');
    expect(written(boardOnly!)).toContain('board_only');

    const posFiles = row(rows, 'Exclude From Position Files').set?.(true);
    expect(fp(posFiles)?.attributes).toContain('exclude_from_pos_files');

    const noBom = row(rows, 'Exclude From Bill of Materials').set?.(false);
    expect(fp(noBom)?.attributes).not.toContain('exclude_from_bom');
    expect(written(noBom!)).not.toContain('exclude_from_bom');

    const dnp = row(rows, 'Do not Populate').set?.(false);
    expect(fp(dnp)?.attributes).not.toContain('dnp');

    const courtyard = row(rows, 'Exempt From Courtyard Requirement').set?.(true);
    expect(fp(courtyard)?.attributes).toContain('allow_missing_courtyard');
  });

  it('keeps Exempt From Courtyard Requirement in Overrides, not Attributes', () => {
    // It is an `(attr …)` flag but is registered with groupOverrides
    // (footprint.cpp:4944-4947), between the two groups.
    expect(row(rows, 'Exempt From Courtyard Requirement').group).toBe('Overrides');
    expect(row(rows, 'Do not Populate').group).toBe('Attributes');
  });

  it('shows an unset override as blank and commits one as its token', () => {
    expect(row(rows, 'Clearance Override').value).toBeNull();
    expect(row(rows, 'Clearance Override').optional).toBe(true);

    const set = row(rows, 'Clearance Override').set?.(MM(0.4));
    expect(fp(set)?.localClearance).toBe(MM(0.4));
    expect(written(set!)).toContain('(clearance 0.4)');

    const paste = row(rows, 'Solderpaste Margin Override').set?.(MM(0.1));
    expect(fp(paste)?.localSolderPasteMargin).toBe(MM(0.1));
    expect(written(paste!)).toContain('(solder_paste_margin 0.1)');
  });

  it('takes the paste ratio as a RATIO, unconverted, and clears it when emptied', () => {
    const ratio = row(rows, 'Solderpaste Margin Ratio Override');
    expect(ratio.value).toBe('');
    const set = ratio.set?.('-0.05');
    expect(fp(set)?.localSolderPasteMarginRatio).toBe(-0.05);
    expect(written(set!)).toContain('(solder_paste_margin_ratio -0.05)');

    const cleared = row(rowsFor('footprint:0', set!), 'Solderpaste Margin Ratio Override').set?.(
      '',
    );
    expect(fp(cleared)?.localSolderPasteMarginRatio).toBeUndefined();
    expect(written(cleared!)).not.toContain('solder_paste_margin_ratio');
  });

  it('has NO Soldermask Margin Override row, because FOOTPRINT_DESC has none', () => {
    // The footprint carries the value and its dialog edits it, but the property
    // manager never registers it (footprint.cpp:4948-4967 lists Clearance,
    // Solderpaste Margin, Solderpaste Margin Ratio and Zone Connection Style).
    expect(names(rows)).not.toContain('Soldermask Margin Override');
    expect(names(rowsFor('pad:0:1'))).toContain('Soldermask Margin Override');
  });

  it("lists ZONE_CONNECTION in the ENUM_MAP's order, PTH reliefs included", () => {
    const zc = row(rows, 'Zone Connection Style');
    expect(zc.value).toBe('Inherited');
    // footprint.cpp:4856-4861, in Map() order — which is what a wxPGChoices
    // lists, and is neither alphabetical nor the enum's numeric order.
    expect(zc.choices).toEqual([
      'Inherited',
      'None',
      'Thermal reliefs',
      'Solid',
      'Thermal reliefs for PTH',
    ]);
  });

  it("commits the zone connection as ZONE_CONNECTION's own number", () => {
    // zones.h:46-53 — NONE 0, THERMAL 1, FULL 2, THT_THERMAL 3, and `(zone_connect
    // N)` is a plain static_cast of it. Solid is 2; writing 3 for it would make
    // KiCad read the footprint back as "thermal reliefs for PTH".
    const solid = row(rows, 'Zone Connection Style').set?.('Solid');
    expect(fp(solid)?.zoneConnection).toBe('full');
    expect(written(solid!)).toContain('(zone_connect 2)');

    const none = row(rows, 'Zone Connection Style').set?.('None');
    expect(written(none!)).toContain('(zone_connect 0)');

    const tht = row(rows, 'Zone Connection Style').set?.('Thermal reliefs for PTH');
    expect(fp(tht)?.zoneConnection).toBe('tht_thermal');
    expect(written(tht!)).toContain('(zone_connect 3)');

    // INHERITED is -1 and is never written: upstream emits the token only when
    // the value differs from it, so "inherit" is the token's ABSENCE. Asserted
    // on the FOOTPRINT's own children, because the fixture's second pad carries
    // a `(zone_connect 1)` of its own and would satisfy a whole-file search.
    expect(fpChildren(solid!)).toContain('zone_connect');
    const back = row(rowsFor('footprint:0', solid!), 'Zone Connection Style').set?.('Inherited');
    expect(fp(back)?.zoneConnection).toBeUndefined();
    expect(fpChildren(back!)).not.toContain('zone_connect');
  });

  it('reads a zone_connect the way KiCad casts it', () => {
    const withZc = (n: number): Board =>
      load(SRC.replace('(attr smd exclude_from_bom dnp)', `(attr smd) (zone_connect ${n})`));
    expect(withZc(0).footprints[0]?.zoneConnection).toBe('none');
    expect(withZc(1).footprints[0]?.zoneConnection).toBe('thermal');
    expect(withZc(2).footprints[0]?.zoneConnection).toBe('full');
    expect(withZc(3).footprints[0]?.zoneConnection).toBe('tht_thermal');
  });
});

/**
 * The Fields group's DYNAMIC rows — `PCB_PROPERTIES_PANEL::rebuildProperties`
 * (pcb_properties_panel.cpp:395-431), which is the half of the panel that is not
 * in FOOTPRINT_DESC: a PCB_FOOTPRINT_FIELD_PROPERTY per name in
 * `footprint->GetFields()`.
 */
describe("FOOTPRINT rows: the footprint's own fields", () => {
  const WITH_FIELDS = SRC.replace(
    '(property "Value" "10k" (at 0 1 0) (layer "F.Fab") (uuid "f2"))',
    `(property "Value" "10k" (at 0 1 0) (layer "F.Fab") (uuid "f2"))
    (property "Datasheet" "https://ds" (at 0 2 0) (layer "F.Fab") (uuid "f3"))
    (property "Description" "Generic resistor" (at 0 3 0) (layer "F.Fab") (uuid "f4"))
    (property "MPN" "RC0805" (at 0 4 0) (layer "F.Fab") (uuid "f5"))
    (property "KiLib_Generator" "kicad" (at 0 5 0) (layer "F.Fab") (uuid "f6"))
    (property "Sheetname" "/" (at 0 6 0) (layer "F.Fab") (uuid "f7"))`,
  );
  const F = load(WITH_FIELDS);
  const rows = rowsFor('footprint:0', F);
  const fieldRows = (): string[] => rows.filter((r) => r.group === 'Fields').map((r) => r.name);

  it('puts Value straight after Reference and then sorts the rest by NAME', () => {
    // "Make sure value comes immediately after reference" (:416-419) — Value is
    // added by hand ahead of the loop, and the loop walks `m_currentFieldNames`,
    // a std::set<wxString>, so the rest are alphabetical and NOT in file order.
    // The file writes Datasheet, Description, MPN, KiLib_Generator in that
    // order; sorted, KiLib_Generator comes third.
    expect(fieldRows()).toEqual([
      'Reference',
      'Value',
      'Datasheet',
      'Description',
      'KiLib_Generator',
      'MPN',
    ]);
  });

  it('reads each field value, and gives every one an editor', () => {
    expect(row(rows, 'MPN').value).toBe('RC0805');
    expect(row(rows, 'Datasheet').value).toBe('https://ds');
    // The FOOTPRINT's Description field, which is NOT the library's `(descr …)`.
    expect(row(rows, 'Description').value).toBe('Generic resistor');
    expect(row(rows, 'Library Description').value).toBe('Resistor 0805');
    for (const n of ['Datasheet', 'Description', 'MPN', 'KiLib_Generator'])
      expect(row(rows, n).set).toBeTypeOf('function');
  });

  it('leaves a reserved property out: it is not a PCB_FIELD', () => {
    // `parseFOOTPRINT` consumes Sheetname into `FOOTPRINT::SetSheetname`
    // (pcb_io_kicad_sexpr_parser.cpp:5176-5180) rather than adding a field, so
    // nothing in GetFields() carries it and the panel never offers a row.
    expect(fieldRows()).not.toContain('Sheetname');
    expect(F.footprints[0]?.sheetname).toBe('/');
  });

  it('commits an edited field into the model AND its source', () => {
    const next = row(rows, 'MPN').set?.('RC0805-B');
    const fp = next?.footprints[0];
    expect(fp?.fields?.find((f) => f.name === 'MPN')?.value).toBe('RC0805-B');
    // The written board is what survives a reload, so the patched source is the
    // half that matters: a model-only edit reverts on the next open.
    expect(written(next!)).toContain('"MPN" "RC0805-B"');
  });

  it('adds a field the footprint does not carry yet', () => {
    // PCB_FOOTPRINT_FIELD_PROPERTY::setter (:99-105): `GetField( m_name )`
    // finding nothing means a new FIELD_T::USER field, not a dropped edit. Here
    // that is Datasheet on the FIXTURE footprint, which writes no such property.
    const bare = rowsFor('footprint:0');
    const next = row(bare, 'Datasheet').set?.('https://example/ds.pdf');
    expect(next?.footprints[0]?.fields?.map((f) => f.name)).toEqual(['Datasheet']);
    expect(written(next!)).toContain('"Datasheet" "https://example/ds.pdf"');
  });

  it('rejects an edit that changes nothing, the way every other row does', () => {
    expect(row(rows, 'MPN').set?.('RC0805')).toBeNull();
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

  it('makes Copper Layers the UNCONNECTED_LAYER_MODE enum, not the layer list', () => {
    // pad.cpp:3757-3759 registers "Copper Layers" as PROPERTY_ENUM<PAD,
    // UNCONNECTED_LAYER_MODE> over SetUnconnectedLayerMode — what a PTH pad does
    // with a copper layer it is NOT connected on. It is not the pad's layer set,
    // which the panel does not show at all; the labels are the ENUM_MAP's
    // (pad.cpp:3394-3397).
    expect(row(pth, 'Copper Layers').value).toBe('All copper layers');
    expect(row(pth, 'Copper Layers').choices).toEqual([
      'All copper layers',
      'Connected layers only',
      'Front, back and connected layers',
    ]);
    // An SMD pad carries no such tokens — upstream's writer emits them for
    // PAD_ATTRIB::PTH alone — so there is nothing to commit.
    expect(row(smd, 'Copper Layers').set).toBeUndefined();
  });

  it('commits Copper Layers as the two booleans a PTH pad stores', () => {
    const next = row(pth, 'Copper Layers').set?.('Front, back and connected layers');
    expect(next?.footprints[0]?.pads[1]?.unconnectedLayerMode).toBe('remove_except_start_and_end');
    const text = written(next!);
    expect(text).toContain('(remove_unused_layers yes)');
    expect(text).toContain('(keep_end_layers yes)');
  });

  it('edits the pin name, and lists the canonical pin types', () => {
    // Both are writeable upstream (`SetPinFunction` / `SetPinType`,
    // pad.cpp:3457-3478), and Pin Type's SetChoicesFunc lists
    // GetCanonicalElectricalTypeName for every ELECTRICAL_PINTYPE — the file
    // tokens, not the display names, which is why it reads "passive" and not
    // "Passive".
    expect(row(smd, 'Pin Name').value).toBe('A');
    expect(row(smd, 'Pin Type').value).toBe('passive');
    expect(row(smd, 'Pin Type').choices).toEqual([
      'input',
      'output',
      'bidirectional',
      'tri_state',
      'passive',
      'free',
      'unspecified',
      'power_in',
      'power_out',
      'open_collector',
      'open_emitter',
      'no_connect',
    ]);

    const named = row(smd, 'Pin Name').set?.('CLK');
    expect(named?.footprints[0]?.pads[0]?.pinFunction).toBe('CLK');
    expect(written(named!)).toContain('(pinfunction "CLK")');

    const typed = row(smd, 'Pin Type').set?.('power_in');
    expect(typed?.footprints[0]?.pads[0]?.pinType).toBe('power_in');
    expect(written(typed!)).toContain('(pintype "power_in")');
  });

  it('shows an unset override as blank, and a set one as its value', () => {
    // PGPROPERTY_DISTANCE over std::optional<int>: DistanceToString returns
    // wxEmptyString when the optional is empty, so "inherit" is not "0".
    const unset = row(smd, 'Clearance Override');
    expect(unset.value).toBeNull();
    expect(unset.optional).toBe(true);
    expect(row(pth, 'Clearance Override').value).toBe(MM(0.3));
    // The model field really is set, so the "cleared" assertion below is not
    // reading an always-undefined property.
    expect(B.footprints[0]?.pads[1]?.localClearance).toBe(MM(0.3));
  });

  it('clears an override when the cell is emptied', () => {
    const next = row(pth, 'Clearance Override').set?.('');
    // Asserted BEFORE the value: a builder that simply refused the empty
    // string would return null here, and `null?.…  ?? null` is also null —
    // the rejection and the clear would be indistinguishable.
    expect(next).not.toBeNull();
    expect(next).not.toBeUndefined();
    expect(next?.footprints[0]?.pads[1]?.localClearance ?? null).toBeNull();
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

  it('reads the name and priority off the pour, and shows NO layer row', () => {
    expect(row(rows, 'Name').value).toBe('pour');
    expect(row(rows, 'Priority').value).toBe(3);
    expect(row(rows, 'Priority').kind).toBe('int');
    // ZONE_DESC replaces BOARD_CONNECTED_ITEM's Layer with one marked
    // `SetIsHiddenFromPropertiesManager()` (zone.cpp:2026-2029), and
    // PROPERTIES_PANEL::rebuildProperties skips a hidden property (:280) — a
    // zone can be on several layers at once, which one cell cannot say.
    expect(names(rows)).not.toContain('Layer');
    expect(names(rows)).not.toContain('Layers');
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
    // Labelled with `BOARD::GetLayerName()`, which is the STANDARD name for a
    // layer the board did not rename — "F.Silkscreen", the string KiCad's own
    // layer list and Appearance panel show, not the file token "F.SilkS".
    expect(row(rows, 'Layer').choices).toEqual([
      'F.Cu',
      'In1.Cu',
      'B.Cu',
      'F.Silkscreen',
      'Edge.Cuts',
    ]);
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
