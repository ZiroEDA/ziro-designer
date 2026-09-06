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
import { buildViaNode, writeBoardNode } from '@ziroeda/pcbnew/src/write-board.js';
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
/** One node's bytes with the pretty-printer's newlines squeezed out. */
const flat = (n: { kind: 'list'; items: unknown[] }): string =>
  serialize(n as Parameters<typeof serialize>[0])
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');

/** The first board text's own node, as the writer emits it (it is stored source). */
const writtenText = (board: Board): string => serialize(board.texts[0]!.source);

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
  (gr_text_box "note" (start 60 60) (end 80 70) (margins 0.5 0.6 0.7 0.8)
    (layer "F.SilkS") (uuid "tb1") (border yes)
    (stroke (width 0.15) (type dash))
    (effects (font (size 1 1) (thickness 0.15)) (justify left top)))
  (table (column_count 2) (layer "F.SilkS") (uuid "tbl1")
    (border (external yes) (header no) (stroke (width 0.2) (type solid)))
    (separators (rows yes) (cols no) (stroke (width 0.1) (type dash)))
    (column_widths 10 10) (row_heights 5)
    (cells
      (table_cell "a" (start 0 0) (end 10 5) (margins 0.5 0.5 0.5 0.5)
        (layer "F.SilkS") (span 1 1) (effects (font (size 1 1))))
      (table_cell "b" (start 10 0) (end 20 5) (margins 0.5 0.5 0.5 0.5)
        (layer "F.SilkS") (span 1 1) (effects (font (size 1 1))))))
  (dimension (type orthogonal) (layer "Dwgs.User") (uuid "d1")
    (pts (xy 113.6 58.975) (xy 113.35 28.975)) (height 12.85) (orientation 1)
    (format (prefix "R ") (suffix " typ") (units 3) (units_format 0) (precision 4)
      (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
      (keep_text_aligned yes))
    (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User") (uuid "dt1")
      (effects (font (size 1 1) (thickness 0.15)))))
  (dimension (type leader) (layer "Cmts.User") (uuid "d2")
    (pts (xy 152.9 67.3) (xy 156.2 63.9))
    (format (prefix "") (suffix "") (units 0) (units_format 0) (precision 4)
      (override_value "0.3mm Thickness"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (text_frame 1) (extension_offset 0.5))
    (gr_text "0.3mm Thickness" (at 168.9 63.9 0) (layer "Cmts.User") (uuid "dt2")
      (effects (font (size 1 1) (thickness 0.15)))))
  (group "cluster" (uuid "g1") (members "gl1" "gc1"))
  (gr_line (start 0 0) (end 5 0) (stroke (width 0.1) (type dash)) (layer "Edge.Cuts") (uuid "gl1"))
  (gr_circle (center 30 30) (end 33 34) (stroke (width 0.1) (type solid)) (fill none)
    (layer "F.SilkS") (uuid "gc1"))
  (gr_poly (pts (xy 0 0) (xy 5 0) (xy 5 5)) (stroke (width 0.1) (type solid)) (fill none)
    (layer "F.SilkS") (uuid "gp1"))
  (gr_arc (start 0 5) (mid -5 0) (end 0 -5) (stroke (width 0.1) (type solid))
    (layer "F.SilkS") (uuid "ga1"))
  (gr_rect (start 0 0) (end 20 10) (stroke (width 0.1) (type solid)) (fill none)
    (layer "F.SilkS") (uuid "gr1"))
  (gr_line (start 1 1) (end 2 2) (stroke (width 0.2) (type solid)) (layer "F.Cu") (uuid "gcu1"))
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

  it('groups them Basic / Pad Properties / Overrides / Teardrops', () => {
    // pad.cpp:3444 and :3771 name the middle two; "Teardrops" is
    // BOARD_CONNECTED_ITEM's (board_connected_item.cpp) and comes last, because a
    // base class's groups are collected after the derived class's own
    // (property_mgr.cpp:319-345).
    expect(groupOrder(smd)).toEqual([
      '',
      'Pad Properties',
      // pad.cpp:3445-3446, registered between Pad Properties and Overrides.
      'Post-machining Properties',
      'Backdrill Properties',
      'Overrides',
      'Teardrops',
    ]);
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
      // Upstream's fourth. A pad cannot STORE it — the writer emits
      // GetRemoveUnconnected/GetKeepTopBottom (pad.h:876-894), which spell it
      // exactly as REMOVE_ALL — so KiCad shows the choice, takes it, and loses it
      // on save. The combo is the enum, not the file format.
      'Start and end layers only',
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

  it("lists them in the property manager's order, base class first", () => {
    // `collectPropsRecur` (property_mgr.cpp:349-370) inserts a class's own
    // properties EARLIER than anything a subclass already put in the list, so
    // walking derived-to-base leaves the base's first: BOARD_ITEM's four (with
    // Position X/Y replaced in place by Start X/Y, pcb_track.cpp:3134-3148),
    // then BOARD_CONNECTED_ITEM's Net, then PCB_TRACK's Width, End X, End Y.
    //
    // And they are all in Basic Properties: there is no "Track Properties" group
    // upstream — PCB_TRACK passes no group for any of the three.
    expect(names(track)).toEqual([
      'Start X',
      'Start Y',
      'Layer',
      'Locked',
      'Net',
      'Width',
      'End X',
      'End Y',
      // PCB_TRACK's own group, after its ungrouped properties.
      'Soldermask',
      'Soldermask Margin Override',
    ]);
    expect(groupOrder(track)).toEqual(['', 'Technical Layers']);
  });

  it('has no Net Class row, which upstream hides with its reason written out', () => {
    // `SetIsHiddenFromPropertiesManager()` (board_connected_item.cpp:36-42):
    // "there is no way to edit the netclass of a net from a selected connected
    // item, and showing it makes users think they can change it."
    for (const n of ['Net Class', 'NetClass', 'NetName']) expect(names(track)).not.toContain(n);
  });

  it('gives an external-layer track the Technical Layers group, and an inner one none', () => {
    // `isExternalLayerTrack` (pcb_track.cpp:3152-3159): a solder-mask opening is
    // a front/back thing. The fixture track is on F.Cu and has the group; the
    // same track on In1.Cu loses it entirely rather than greying it.
    expect(groupOrder(track)).toContain('Technical Layers');
    const inner = load(
      SRC.replace(
        '(segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu")',
        '(segment (start 0 0) (end 10 0) (width 0.25) (layer "In1.Cu")',
      ),
    );
    expect(groupOrder(rowsFor('track:0', inner))).not.toContain('Technical Layers');
    expect(names(rowsFor('track:0', inner))).not.toContain('Soldermask');
  });

  it('commits the solder-mask opening, which is a second layer on the track', () => {
    // `PCB_TRACK::SetHasSolderMask` — the track's layer SET gains F.Mask, which
    // the file spells `(layers "F.Cu" "F.Mask")`.
    const masked = row(track, 'Soldermask').set?.(true);
    expect(masked?.tracks[0]?.maskLayer).toBe('F.Mask');
    const margin = row(track, 'Soldermask Margin Override').set?.(MM(0.05));
    expect(margin?.tracks[0]?.solderMaskMargin).toBe(MM(0.05));
    expect(row(track, 'Soldermask Margin Override').optional).toBe(true);
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

  it('puts Via Properties BEFORE Basic Properties, as the group order does', () => {
    // `collectGroupsRecursive` (property_mgr.cpp:319-345) collects the class's
    // OWN groups first and its bases' after — the opposite of the property order
    // inside a group. Every property PCB_VIA registers carries a group, so ''
    // only arrives from BOARD_ITEM, after "Via Properties"; "Teardrops" comes
    // from BOARD_CONNECTED_ITEM and is last.
    expect(groupOrder(rows)).toEqual([
      'Via Properties',
      // pcb_track.cpp:3179-3180 names these two, after groupVia.
      'Backdrill',
      'Post-machining',
      '',
      'Teardrops',
    ]);
  });

  it('shows no Layer row: a via spans a range, and says so with two', () => {
    // `propMgr.Mask( PCB_VIA, BOARD_CONNECTED_ITEM, "Layer" )` (pcb_track.cpp:3182).
    expect(names(rows)).not.toContain('Layer');
    expect(names(rows)).toContain('Layer Top');
    expect(names(rows)).toContain('Layer Bottom');
  });

  it('gives Layer Top and Layer Bottom their own swatches', () => {
    expect(row(rows, 'Layer Top').value).toBe('F.Cu');
    expect(row(rows, 'Layer Top').swatch).toBe('#c83434');
    expect(row(rows, 'Layer Bottom').value).toBe('B.Cu');
    expect(row(rows, 'Layer Bottom').swatch).toBe('#4d7fc4');
  });

  it('lists the Via Properties group in registration order', () => {
    // pcb_track.cpp:3184-3216. The five outer-layer flags come after Via Type,
    // and `capping`/`filling` belong to the DRILL, so they have one row each
    // where tenting, covering and plugging have a front/back pair.
    expect(rows.filter((r) => r.group === 'Via Properties').map((r) => r.name)).toEqual([
      'Diameter',
      'Hole',
      'Layer Top',
      'Layer Bottom',
      'Via Type',
      'Front tenting',
      'Back tenting',
      'Front covering',
      'Back covering',
      'Front plugging',
      'Back plugging',
      'Capping',
      'Filling',
    ]);
  });

  it('makes each outer-layer flag three-state, defaulting to the board stackup', () => {
    // `std::optional<bool>` in PADSTACK: no value is TENTING_MODE::FROM_BOARD,
    // which is a third state and not a false. The fixture via says nothing about
    // any of them.
    const tenting = row(rows, 'Front tenting');
    expect(tenting.value).toBe('From board stackup');
    expect(tenting.choices).toEqual(['From board stackup', 'Tented', 'Not tented']);
    expect(row(rows, 'Front covering').choices).toEqual([
      'From board stackup',
      'Covered',
      'Not covered',
    ]);
    expect(row(rows, 'Capping').choices).toEqual(['From board stackup', 'Capped', 'Not capped']);
    expect(row(rows, 'Filling').choices).toEqual(['From board stackup', 'Filled', 'Not filled']);
  });

  it('writes each flag the way FormatOptBool does, and drops it for the board', () => {
    const tented = row(rows, 'Front tenting').set?.('Tented');
    expect(tented?.vias[0]?.tenting).toEqual({ front: true, back: undefined });
    // `(front yes) (back none)` — the sides are independent, and `none` is how
    // the empty optional is spelled.
    expect(flat(tented!.vias[0]!.source)).toContain('(tenting (front yes) (back none))');

    const capped = row(rows, 'Capping').set?.('Not capped');
    expect(capped?.vias[0]?.capping).toBe(false);
    expect(flat(capped!.vias[0]!.source)).toContain('(capping no)');

    // Back to the board: the token goes away rather than reading `(capping none)`,
    // because the writer emits it only `if( …is_capped.has_value() )`.
    const back = row(rowsFor('via:0', capped!), 'Capping').set?.('From board stackup');
    expect(back?.vias[0]?.capping).toBeUndefined();
    expect(flat(back!.vias[0]!.source)).not.toContain('capping');
  });

  it("reads the flags back, including tenting's legacy bare-word spelling", () => {
    const withFlags = load(
      SRC.replace(
        '(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))',
        `(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1")
           (tenting (front yes) (back no)) (covering (front no) (back none))
           (plugging (front yes) (back yes)) (capping yes) (filling no))`,
      ),
    );
    expect(withFlags.vias[0]?.tenting).toEqual({ front: true, back: false });
    expect(withFlags.vias[0]?.covering).toEqual({ front: false, back: undefined });
    expect(withFlags.vias[0]?.plugging).toEqual({ front: true, back: true });
    expect(withFlags.vias[0]?.capping).toBe(true);
    expect(withFlags.vias[0]?.filling).toBe(false);

    // `parseFrontBackOptBool( true )`: before the sides could differ, tenting was
    // written as bare words, and `none` reset both.
    const legacy = load(
      SRC.replace('(net 1) (uuid "v1"))', '(net 1) (uuid "v1") (tenting front))'),
    );
    expect(legacy.vias[0]?.tenting?.front).toBe(true);
    expect(legacy.vias[0]?.tenting?.back).toBeUndefined();

    // `none` resets BOTH sides whatever came before it, so this is not
    // "front, then nothing" — it is nothing at all.
    const legacyNone = load(
      SRC.replace('(net 1) (uuid "v1"))', '(net 1) (uuid "v1") (tenting front none))'),
    );
    expect(legacyNone.vias[0]?.tenting?.front).toBeUndefined();

    // And a via that says nothing carries no object, not an empty one: the
    // writer's test is `has_value()` on each side.
    expect(B.vias[0]?.tenting).toBeUndefined();
  });

  it('builds no flag tokens for a via that follows the board, and one for each that does not', () => {
    // The BUILDER is the path a newly placed via takes, having no source. The
    // writer's own condition is `has_value()` on the side or the drill flag
    // (pcb_io_kicad_sexpr.cpp:2740-2778), so an opinion-free via gains nothing.
    const bare = flat(
      buildViaNode({
        at: { x: 0, y: 0 },
        size: MM(0.8),
        drill: MM(0.4),
        layers: ['F.Cu', 'B.Cu'],
        kind: 'through',
        net: 0,
        // An EMPTY object, not an absent one: this is the state a `(tenting
        // none)` in the file leaves, and the one the panel leaves when both
        // sides go back to the board. `has_value()` is false on each side, so
        // the token is still not written.
        tenting: {},
        covering: {},
        source: { kind: 'list', items: [] },
      }),
    );
    for (const t of ['tenting', 'covering', 'plugging', 'capping', 'filling'])
      expect(bare, t).not.toContain(t);

    const opinionated = flat(
      buildViaNode({
        at: { x: 0, y: 0 },
        size: MM(0.8),
        drill: MM(0.4),
        layers: ['F.Cu', 'B.Cu'],
        kind: 'through',
        net: 0,
        tenting: { front: true },
        filling: false,
        source: { kind: 'list', items: [] },
      }),
    );
    expect(opinionated).toContain('(tenting (front yes) (back none))');
    expect(opinionated).toContain('(filling no)');
    expect(opinionated).not.toContain('covering');
  });

  it('commits the diameter and the hole', () => {
    expect(row(rows, 'Diameter').set?.(MM(1))?.vias[0]?.size).toBe(MM(1));
    expect(row(rows, 'Hole').set?.(MM(0.5))?.vias[0]?.drill).toBe(MM(0.5));
  });
});

/**
 * The Backdrill and Post-machining groups, which a pad and a via both carry
 * because both are PADSTACKs — and which differ only in their group names, in
 * Top/Bottom versus Front/Back, and in which of the two comes first.
 */
describe('the padstack drill groups, on the pad and the via', () => {
  const drilled = load(
    SRC.replace(
      '(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))',
      `(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1")
         (backdrill (size 0.6) (layers "B.Cu" "In1.Cu"))
         (front_post_machining counterbore (size 1.2) (depth 0.3))
         (back_post_machining countersink (size 1.4) (angle 90)))`,
    ),
  );
  const via = rowsFor('via:0', drilled);

  it('reads a backdrill by its START layer, which is the side', () => {
    // `findBackdrillDrill( aTop )` (padstack.cpp:523-536): the slot number means
    // nothing and the start layer means everything — B.Cu is the bottom side.
    // That is why KiCad 10.0 files, which used the tertiary slot for the top
    // backdrill, still read correctly.
    expect(drilled.vias[0]?.backdrill).toEqual({
      size: MM(0.6),
      start: 'B.Cu',
      end: 'In1.Cu',
    });
    expect(row(via, 'Backdrill Mode').value).toBe('Backdrill bottom');
    expect(row(via, 'Bottom Backdrill Size').value).toBe(MM(0.6));
    expect(row(via, 'Bottom Backdrill Must-Cut').value).toBe('In1.Cu');
  });

  it("shows a side's size and must-cut only when the mode names that side", () => {
    // The two `SetAvailableFunc`s on each pair (pcb_track.cpp:3238-3290).
    expect(names(via)).not.toContain('Top Backdrill Size');
    expect(names(via)).not.toContain('Top Backdrill Must-Cut');

    const both = rowsFor('via:0', row(via, 'Backdrill Mode').set?.('Backdrill both') as Board);
    expect(names(both)).toContain('Top Backdrill Size');
    // `SetBackdrillMode` gives a new side a drill 10% over the main hole
    // (padstack.cpp:549-550) — 0.4 mm here, so 0.44.
    expect(row(both, 'Top Backdrill Size').value).toBe(MM(0.44));
  });

  it('writes the backdrill back as its own node, and drops it with the mode', () => {
    const both = row(via, 'Backdrill Mode').set?.('Backdrill both');
    expect(flat(both!.vias[0]!.source)).toContain('(tertiary_drill (size 0.44)');
    const none = row(via, 'Backdrill Mode').set?.('No backdrill');
    expect(flat(none!.vias[0]!.source)).not.toContain('backdrill');
  });

  it('builds no drill node for a slot with no size, as the writer does not', () => {
    // `if( …SecondaryDrill().size.x > 0 )` (pcb_io_kicad_sexpr.cpp:2657): an
    // empty slot is not a backdrill, and the BUILDER — the path a newly placed
    // via takes — must not write one either.
    const built = flat(
      buildViaNode({
        at: { x: 0, y: 0 },
        size: MM(0.8),
        drill: MM(0.4),
        layers: ['F.Cu', 'B.Cu'],
        kind: 'through',
        net: 0,
        backdrill: { size: 0, start: 'B.Cu', end: 'In1.Cu' },
        source: { kind: 'list', items: [] },
      }),
    );
    expect(built).not.toContain('backdrill');

    const real = flat(
      buildViaNode({
        at: { x: 0, y: 0 },
        size: MM(0.8),
        drill: MM(0.4),
        layers: ['F.Cu', 'B.Cu'],
        kind: 'through',
        net: 0,
        backdrill: { size: MM(0.6), start: 'B.Cu', end: 'In1.Cu' },
        source: { kind: 'list', items: [] },
      }),
    );
    expect(real).toContain('(backdrill (size 0.6) (layers "B.Cu" "In1.Cu"))');
  });

  it('shows a post-machining measurement only for the mode that has it', () => {
    // Size for either mode, Depth for a counterbore, Angle for a countersink
    // (pad.cpp:3564-3614) — and the via says Front and Back where a pad says
    // Top and Bottom for the same two sides.
    expect(row(via, 'Front Post-machining').value).toBe('Counterbore');
    expect(names(via)).toContain('Front Counterbore Depth');
    expect(names(via)).not.toContain('Front Countersink Angle');

    expect(row(via, 'Back Post-machining').value).toBe('Countersink');
    expect(names(via)).toContain('Back Countersink Angle');
    expect(names(via)).not.toContain('Back Counterbore Depth');
  });

  it('keeps the countersink angle in TENTHS of a degree, and writes degrees', () => {
    // `PT_DECIDEGREE`, and the parser's `KiROUND( parseDouble( … ) * 10.0 )`
    // against the writer's `FormatDouble2Str( angle / 10.0 )`.
    expect(drilled.vias[0]?.backPostMachining?.angle).toBe(900);
    expect(row(via, 'Back Countersink Angle').value).toBe('90°');

    const wider = row(via, 'Back Countersink Angle').set?.('120');
    expect(wider?.vias[0]?.backPostMachining?.angle).toBe(1200);
    expect(flat(wider!.vias[0]!.source)).toContain('(angle 120)');
  });

  it('turns post-machining off by dropping the whole token', () => {
    const off = row(via, 'Front Post-machining').set?.('Not post-machined');
    expect(off?.vias[0]?.frontPostMachining).toBeUndefined();
    expect(flat(off!.vias[0]!.source)).not.toContain('front_post_machining');
    expect(flat(off!.vias[0]!.source)).toContain('back_post_machining');
  });

  it("gives a pad the same rows under the pad's own names", () => {
    const pad = rowsFor('pad:0:1');
    // pad.cpp:3445-3446 for the group names, and Top/Bottom for the sides.
    expect(groupOrder(pad)).toContain('Post-machining Properties');
    expect(groupOrder(pad)).toContain('Backdrill Properties');
    expect(names(pad)).toContain('Top Post-machining');
    expect(names(pad)).toContain('Bottom Post-machining');
    expect(names(pad)).not.toContain('Front Post-machining');

    const bored = row(pad, 'Top Post-machining').set?.('Counterbore');
    expect(bored?.footprints[0]?.pads[1]?.frontPostMachining?.mode).toBe('counterbore');
    expect(flat(bored!.footprints[0]!.pads[1]!.source)).toContain(
      '(front_post_machining counterbore)',
    );
  });

  it('registers the two groups in the opposite order on a pad and a via', () => {
    // A via registers Backdrill Mode (pcb_track.cpp:3231) before its
    // post-machining (:3419); a pad registers Top Post-machining
    // (pad.cpp:3551) before its Backdrill Mode (:3681). The panel shows each in
    // its own order.
    const viaGroups = groupOrder(via).filter((g) => g === 'Backdrill' || g === 'Post-machining');
    expect(viaGroups).toEqual(['Backdrill', 'Post-machining']);
    const padGroups = groupOrder(rowsFor('pad:0:1')).filter(
      (g) => g.startsWith('Backdrill') || g.startsWith('Post-machining'),
    );
    expect(padGroups).toEqual(['Post-machining Properties', 'Backdrill Properties']);
  });
});

/**
 * The Teardrops group is `BOARD_CONNECTED_ITEM_DESC`'s, so a pad and a via get
 * the SAME nine rows from the same setters — which is the whole point of testing
 * them together.
 */
describe('the Teardrops group, on both items that have one', () => {
  const via = rowsFor('via:0');
  const pad = rowsFor('pad:0:1');

  it('gives a via eight rows and a pad nine, in registration order', () => {
    const td = (r: PcbPropRow[]): string[] =>
      r.filter((x) => x.group === 'Teardrops').map((x) => x.name);
    expect(td(via)).toEqual([
      'Enable Teardrops',
      'Best Length Ratio',
      'Max Length',
      'Best Width Ratio',
      'Max Width',
      'Curved Teardrops',
      'Allow Teardrops To Span Two Tracks',
      'Max Width Ratio',
    ]);
    // `supportsTeardropPreferZoneSetting` is PCB_PAD_T alone, and it sits where
    // it is registered — after Curved Teardrops.
    expect(td(pad)).toEqual([
      'Enable Teardrops',
      'Best Length Ratio',
      'Max Length',
      'Best Width Ratio',
      'Max Width',
      'Curved Teardrops',
      'Prefer Zone Connections',
      'Allow Teardrops To Span Two Tracks',
      'Max Width Ratio',
    ]);
  });

  it('gives a TRACK none: supportsTeardrops is a pad or a via', () => {
    expect(groupOrder(rowsFor('track:0'))).not.toContain('Teardrops');
  });

  it('shows the ratios as the fraction the property carries, not the percentage', () => {
    // The teardrop DIALOG shows 50%; `GetTeardropBestLengthRatio` is a plain
    // double with no PROPERTY_DISPLAY, so the cell reads 0.5.
    // TEARDROP_PARAMETERS' own defaults (teardrop_parameters.h): best length
    // 0.5, best width 1.0, filter ratio 0.9.
    expect(row(via, 'Best Length Ratio').value).toBe('0.5');
    expect(row(via, 'Best Width Ratio').value).toBe('1');
    expect(row(via, 'Max Width Ratio').value).toBe('0.9');
    // And rejects a negative one — PROPERTY_VALIDATORS::PositiveRatioValidator.
    expect(row(via, 'Best Length Ratio').set?.('-0.2')).toBeNull();
  });

  it('commits through the item, and writes the (teardrops …) node', () => {
    const on = row(via, 'Enable Teardrops').set?.(true);
    expect(on?.vias[0]?.teardrops?.enabled).toBe(true);
    expect(serialize(on!.vias[0]!.source)).toContain('(teardrops');

    const curved = row(pad, 'Curved Teardrops').set?.(true);
    expect(curved?.footprints[0]?.pads[1]?.teardrops?.curvedEdges).toBe(true);
    expect(serialize(curved!.footprints[0]!.pads[1]!.source)).toContain('(curved_edges yes)');
  });

  it('stores Prefer Zone Connections INVERTED, as the parameter is', () => {
    // `SetTeardropPreferZoneConnections( aPrefer )` is
    // `m_TdOnPadsInZones = !aPrefer` (board_connected_item.h:227-228), and the
    // file token `(prefer_zone_connections …)` is the inverse again.
    const prefer = row(pad, 'Prefer Zone Connections');
    expect(prefer.value).toBe(true);
    const off = prefer.set?.(false);
    expect(off?.footprints[0]?.pads[1]?.teardrops?.tdOnPadsInZones).toBe(true);
    expect(serialize(off!.footprints[0]!.pads[1]!.source)).toContain(
      '(prefer_zone_connections no)',
    );
  });

  it('offers no teardrop rows at all on a legacy-teardrop board', () => {
    // `supportsTeardrops` opens with `if( !bci->GetBoard() ||
    // bci->GetBoard()->LegacyTeardrops() ) return false` — those boards draw
    // teardrops as zones, so there is nothing per-item to edit.
    const legacy = load(SRC.replace('(net 0 "")', '(setup (legacy_teardrops yes))\n  (net 0 "")'));
    expect(legacy.legacyTeardrops).toBe(true);
    expect(groupOrder(rowsFor('via:0', legacy))).not.toContain('Teardrops');
    expect(groupOrder(rowsFor('pad:0:1', legacy))).not.toContain('Teardrops');
  });
});

describe('ZONE rows', () => {
  const rows = rowsFor('zone:0');

  it('groups them Basic / Fill Style / Electrical', () => {
    // zone.cpp names groupFill (:2177) and groupElectrical (:2249); the Keepout
    // and Placement groups belong to a rule area and are absent on copper.
    expect(groupOrder(rows)).toEqual(['', 'Fill Style', 'Electrical']);
  });

  it("lists every copper-zone row, in the property manager's order", () => {
    expect(names(rows)).toEqual([
      // BOARD_ITEM's Locked; Position X/Y and Layer are all hidden.
      'Locked',
      // BOARD_CONNECTED_ITEM's Net, then ZONE's own two.
      'Net',
      'Priority',
      'Name',
      'Fill Mode',
      'Hatch Orientation',
      'Hatch Width',
      'Hatch Gap',
      'Hatch Minimum Hole Ratio',
      'Smoothing Effort',
      'Smoothing Amount',
      'Remove Islands',
      'Minimum Island Area',
      'Clearance',
      'Minimum Width',
      'Pad Connections',
      'Thermal Relief Gap',
      'Thermal Relief Spoke Width',
    ]);
  });

  it('shows no Border Display or Filled row: neither is a ZONE_DESC property', () => {
    // ZONE_BORDER_DISPLAY_STYLE is a rendering choice the zone DIALOG offers,
    // and `(fill yes)` is the dialog's too. The property manager registers
    // neither, so the panel shows neither.
    expect(names(rows)).not.toContain('Border Display');
    expect(names(rows)).not.toContain('Filled');
  });

  it('reads the name and priority off the pour, and shows NO layer row', () => {
    expect(row(rows, 'Name').value).toBe('pour');
    expect(row(rows, 'Priority').value).toBe(3);
    expect(row(rows, 'Priority').kind).toBe('int');
    // ZONE_DESC replaces BOARD_CONNECTED_ITEM's Layer with one marked
    // `SetIsHiddenFromPropertiesManager()` (zone.cpp:2113-2118), and
    // PROPERTIES_PANEL::rebuildProperties skips a hidden property (:280) — a
    // zone can be on several layers at once, which one cell cannot say. Position
    // X and Y are hidden the same way, "they aren't useful in current form".
    expect(names(rows)).not.toContain('Layer');
    expect(names(rows)).not.toContain('Position X');
  });

  it('draws the hatch rows greyed until the fill mode is a hatch pattern', () => {
    // `SetWriteableFunc( isHatchedFill )` is wxPG_PROP_READONLY, not absence:
    // the rows are there, and they cannot be typed into. That is a different
    // state from SetAvailableFunc, which removes the row.
    const hatchRows = [
      'Hatch Orientation',
      'Hatch Width',
      'Hatch Gap',
      'Hatch Minimum Hole Ratio',
      'Smoothing Effort',
      'Smoothing Amount',
    ];
    for (const n of hatchRows) expect(row(rows, n).set, n).toBeUndefined();

    const hatchedBoard = row(rows, 'Fill Mode').set?.('Hatch pattern');
    const hatched = rowsFor('zone:0', hatchedBoard as Board);
    for (const n of hatchRows) expect(row(hatched, n).set, n).toBeTypeOf('function');
    expect(row(hatched, 'Hatch Width').set?.(MM(0.6))?.zones[0]?.hatchThickness).toBe(MM(0.6));

    // `hatch_min_hole_area` is a plain number the fill node rebuild writes out,
    // and it is the EDITED value, not the one the zone came in with — the node
    // is rebuilt from scratch on every apply, so reading it off the old zone
    // silently discarded this row's edit.
    const ratio = row(hatched, 'Hatch Minimum Hole Ratio').set?.('0.42');
    expect(ratio?.zones[0]?.hatchHoleMinArea).toBe(0.42);
    expect(flat(ratio!.zones[0]!.source)).toContain('(hatch_min_hole_area 0.42)');
  });

  it('greys Minimum Island Area until Remove Islands is the area mode', () => {
    // `SetWriteableFunc( isAreaBasedIslandRemoval )`.
    expect(row(rows, 'Minimum Island Area').set).toBeUndefined();
    const byArea = row(rows, 'Remove Islands').set?.('Below area limit');
    const area = rowsFor('zone:0', byArea as Board);
    expect(row(area, 'Minimum Island Area').set).toBeTypeOf('function');
  });

  it('offers the two ZONE_FILL_MODEs, and the five pad connections', () => {
    expect(row(rows, 'Fill Mode').choices).toEqual(['Solid fill', 'Hatch pattern']);
    expect(row(rows, 'Pad Connections').choices).toEqual([
      'None',
      'Thermal reliefs',
      'Solid',
      'Thermal reliefs for PTH',
    ]);
  });

  it('commits a priority', () => {
    expect(row(rows, 'Priority').set?.(7)?.zones[0]?.priority).toBe(7);
  });
});

/**
 * A rule area is the other kind of zone, and it shares almost nothing with a
 * copper one: `isRuleArea` and `isCopperZone` are complementary, so each group
 * belongs to exactly one of them.
 */
describe('ZONE rows: a rule area', () => {
  const ruleArea = load(
    SRC.replace(
      '(name "pour") (priority 3)',
      `(name "keepme") (keepout (tracks not_allowed) (vias allowed) (pads not_allowed)
         (copperpour allowed) (footprints allowed))
       (placement (enabled yes) (component_class "PWR"))`,
    ),
  );
  const rows = rowsFor('zone:0', ruleArea);

  it('shows the Keepout and Placement groups, and no copper ones', () => {
    expect(groupOrder(rows)).toEqual(['', 'Keepout', 'Placement']);
    expect(names(rows)).toEqual([
      'Locked',
      // No Net and no Priority: both are `isCopperZone`.
      'Name',
      'Keep Out Tracks',
      'Keep Out Vias',
      'Keep Out Pads',
      'Keep Out Zone Fills',
      'Keep Out Footprints',
      'Enable',
      'Source Type',
      'Source Name',
    ]);
  });

  it('reads each flag in the DO-NOT-ALLOW sense the model stores', () => {
    // The file says `allowed` / `not_allowed`; `ZONE::GetDoNotAllowTracks` is
    // the negation, and it is what the row shows.
    expect(row(rows, 'Keep Out Tracks').value).toBe(true);
    expect(row(rows, 'Keep Out Vias').value).toBe(false);
    expect(row(rows, 'Keep Out Zone Fills').value).toBe(false);
  });

  it('commits a flag back as the file word, not the model bool', () => {
    const next = row(rows, 'Keep Out Vias').set?.(true);
    expect(next?.zones[0]?.ruleArea?.vias).toBe(true);
    expect(flat(next!.zones[0]!.source)).toContain('(vias not_allowed)');
    // The other four are rewritten from the model and must not flip with it.
    expect(flat(next!.zones[0]!.source)).toContain('(tracks not_allowed)');
    expect(flat(next!.zones[0]!.source)).toContain('(copperpour allowed)');
  });

  it('reads and writes the placement source as its own token', () => {
    expect(row(rows, 'Enable').value).toBe(true);
    expect(row(rows, 'Source Type').value).toBe('Component Class');
    expect(row(rows, 'Source Name').value).toBe('PWR');

    const renamed = row(rows, 'Source Name').set?.('GND');
    expect(renamed?.zones[0]?.placementArea?.source).toBe('GND');
    expect(flat(renamed!.zones[0]!.source)).toContain('(component_class "GND")');

    // The source token IS the type, so changing the type moves the name into a
    // different token rather than leaving both.
    const asSheet = row(rows, 'Source Type').set?.('Sheet Name');
    expect(flat(asSheet!.zones[0]!.source)).toContain('(sheetname "PWR")');
    expect(flat(asSheet!.zones[0]!.source)).not.toContain('component_class');
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

  it("lists every row in the property manager's order, inherited first", () => {
    // BOARD_ITEM's four, then EDA_TEXT's ungrouped Orientation and its group,
    // then PCB_TEXT's own — `InheritsAfter( PCB_TEXT, BOARD_ITEM )` followed by
    // `InheritsAfter( PCB_TEXT, EDA_TEXT )` (pcb_text.cpp:747-748). Text used to
    // come first and sit in Basic Properties; it is EDA_TEXT's, in the group
    // (eda_text.cpp:1350-1352).
    expect(names(rows)).toEqual([
      'Position X',
      'Position Y',
      'Layer',
      'Locked',
      'Orientation',
      'Text',
      'Auto Thickness',
      'Thickness',
      'Italic',
      'Bold',
      'Mirrored',
      'Width',
      'Height',
      'Horizontal Justification',
      'Vertical Justification',
      'Knockout',
    ]);
    for (const n of ['Auto Thickness', 'Italic', 'Bold', 'Mirrored', 'Knockout'])
      expect(row(rows, n).kind).toBe('bool');

    // The GROUP as well as the order: Text is EDA_TEXT's, registered with
    // `textProps` (eda_text.cpp:1350-1352), so it heads the group rather than
    // sitting in Basic Properties with the position.
    expect(row(rows, 'Text').group).toBe('Text Properties');
    expect(row(rows, 'Orientation').group).toBe('');
  });

  it('shows none of the four EDA_TEXT rows PCB_TEXT takes away', () => {
    // Color and Hyperlink are `propMgr.Mask`ed (pcb_text.cpp:750, :771) — the
    // writer passes CTL_OMIT_COLOR | CTL_OMIT_HYPERLINK and says so. Visible is
    // `SetAvailableFunc( isField )`, and `(hide yes)` is written for a field
    // alone (pcb_io_kicad_sexpr.cpp:2308-2309), so a gr_text has no Hidden row.
    // Keep Upright is restricted to text with a parent footprint (:760-769).
    for (const n of ['Color', 'Hyperlink', 'Visible', 'Hidden', 'Keep Upright'])
      expect(names(rows)).not.toContain(n);
  });

  it('commits the text', () => {
    expect(row(rows, 'Text').set?.('goodbye')?.texts[0]?.text).toBe('goodbye');
  });

  it('writes the justification as the (justify …) words, in EDA_TEXT order', () => {
    // eda_text.cpp:1100-1114: horizontal, then vertical, then mirror, each
    // omitted at its default (CENTER / not mirrored), and the whole token
    // omitted when all three are.
    expect(row(rows, 'Horizontal Justification').value).toBe('Center');
    expect(row(rows, 'Vertical Justification').value).toBe('Center');

    const left = row(rows, 'Horizontal Justification').set?.('Left');
    expect(left?.texts[0]?.justify).toEqual(['left']);
    expect(written(left!)).toContain('(justify left)');

    const bottom = row(rowsFor('text:0', left!), 'Vertical Justification').set?.('Bottom');
    expect(bottom?.texts[0]?.justify).toEqual(['left', 'bottom']);
    expect(written(bottom!)).toContain('(justify left bottom)');

    const mirrored = row(rowsFor('text:0', bottom!), 'Mirrored').set?.(true);
    expect(written(mirrored!)).toContain('(justify left bottom mirror)');

    // Back to both defaults: the token goes away rather than reading `(justify)`.
    const back = row(rowsFor('text:0', bottom!), 'Horizontal Justification').set?.('Center');
    const centred = row(rowsFor('text:0', back as Board), 'Vertical Justification').set?.('Center');
    expect(centred?.texts[0]?.justify).toBeUndefined();
    // Scoped to the text's own node: the fixture's text BOX carries a
    // `(justify left top)` of its own.
    expect(writtenText(centred as Board)).not.toContain('justify');
  });

  it('makes Auto Thickness a stored thickness of zero, and back', () => {
    // `GetAutoThickness()` is `GetTextThickness() == 0` (eda_text.h:150), and
    // `Format` writes the token only when it is off (eda_text.cpp:1079-1084).
    // The fixture's text has `(thickness 0.15)`, so it starts explicit.
    expect(row(rows, 'Auto Thickness').value).toBe(false);
    expect(row(rows, 'Thickness').value).toBe(MM(0.15));

    const auto = row(rows, 'Auto Thickness').set?.(true);
    expect(auto?.texts[0]?.thickness).toBeUndefined();
    // Scoped to the text's own node: the fixture's zone carries a
    // `(min_thickness …)`, which a whole-file search would match.
    expect(writtenText(auto!)).not.toContain('thickness');

    // The cell now reads the width the text is DRAWN with, not zero:
    // `GetTextThicknessProperty` returns `GetEffectiveTextPenWidth()` while auto
    // is on, which for this 1 mm non-bold text is `GetPenSizeForNormal` = 1/8.
    const autoRows = rowsFor('text:0', auto!);
    expect(row(autoRows, 'Thickness').value).toBe(MM(1) / 8);

    // And back: `SetAutoThickness( false )` materialises exactly that width, so
    // the text keeps the pen it had rather than dropping to zero.
    const explicit = row(autoRows, 'Auto Thickness').set?.(false);
    expect(explicit?.texts[0]?.thickness).toBe(MM(1) / 8);
    expect(writtenText(explicit!)).toContain('(thickness 0.125)');
  });

  it('reads a stored zero as automatic too, not just an absent token', () => {
    // `GetAutoThickness()` is `GetTextThickness() == 0` (eda_text.h:150). A file
    // CAN carry `(thickness 0)` — KiCad reads it as automatic and writes it back
    // without the token. Deriving the flag from "the model field is undefined"
    // agrees on every file KiCad wrote and is wrong on this one.
    const zero = load(SRC.replace('(thickness 0.15)', '(thickness 0)'));
    expect(zero.texts[0]?.thickness).toBe(0);
    expect(row(rowsFor('text:0', zero), 'Auto Thickness').value).toBe(true);
  });
});

describe('SHAPE rows', () => {
  const line = rowsFor('shape:0');
  const circle = rowsFor('shape:1');

  it('lists the geometry rows the SHAPE_T makes available, and no others', () => {
    // Every one of these is a `SetAvailableFunc` upstream, and an unavailable
    // property is ABSENT rather than greyed (properties_panel.cpp:434). PCB_SHAPE
    // rewrites four of EDA_SHAPE's conditions with OverrideAvailability
    // (pcb_shape.cpp:1130-1143): Start/End for anything but a circle, Center and
    // Radius for a circle alone.
    expect(names(line)).toEqual([
      'Layer',
      'Locked',
      // EDA_SHAPE's first row, and the one that changes what the rest are.
      'Shape',
      'Start X',
      'Start Y',
      'End X',
      'End Y',
      'Line Width',
      'Line Style',
    ]);
    expect(names(circle)).toEqual([
      'Layer',
      'Locked',
      'Shape',
      'Center X',
      'Center Y',
      'Radius',
      'Line Width',
      'Line Style',
      'Fill',
    ]);
  });

  it("makes a circle's Radius one distance, derived from the point on it", () => {
    // `GetRadius()` is the centre-to-end distance and `SetRadius( r )` puts the
    // end at `centre + (r, 0)` (eda_shape.h:253-257) — the file stores a POINT on
    // the circle, never a radius, so a "Radius X"/"Radius Y" pair was the end
    // point wearing the wrong label.
    // The fixture is `(center 30 30) (end 33 34)` — a 3/4/5 triangle, so 5 mm,
    // and the end is deliberately NOT level with the centre: a radius taken from
    // the x delta alone would read 3 mm here and 5 mm on an axis-aligned circle.
    expect(row(circle, 'Radius').value).toBe(MM(5));
    expect(row(circle, 'Radius').kind).toBe('dist');

    const bigger = row(circle, 'Radius').set?.(MM(8));
    expect(bigger?.shapes[1]?.end).toEqual({ x: MM(38), y: MM(30) });
    expect(bigger?.shapes[1]?.center).toEqual({ x: MM(30), y: MM(30) });
  });

  it('gives a segment no Fill row, because a segment has nothing to fill', () => {
    // `fillAvailable` is POLY / RECTANGLE / CIRCLE / BEZIER (eda_shape.cpp), and
    // PCB_SHAPE takes BEZIER back out: "fill is not supported in board editor"
    // (pcb_shape.cpp:1101-1114).
    expect(names(line)).not.toContain('Fill');
    expect(names(circle)).toContain('Fill');
  });

  it('offers Fill as the five-way UI_FILL_MODE, not a checkbox', () => {
    // `PROPERTY_ENUM<EDA_SHAPE, UI_FILL_MODE>` (eda_shape.cpp:3025) over
    // SetFillModeProp/GetFillModeProp, whose ENUM_MAP is these five labels in
    // this order. A board graphic can be hatched three ways as well as solid.
    const fill = row(circle, 'Fill');
    expect(fill.kind).toBe('choice');
    expect(fill.choices).toEqual(['None', 'Solid', 'Hatch', 'Reverse Hatch', 'Cross-hatch']);
    expect(fill.value).toBe('None');

    const hatched = fill.set?.('Cross-hatch');
    expect(hatched?.shapes[1]?.fillMode).toBe('cross_hatch');
    expect(serialize(hatched!.shapes[1]!.source)).toContain('(fill cross_hatch)');
  });

  it('shows an arc its read-only sweep, and no Mid row', () => {
    // `GetArcAngle`, PT_DECIDEGREE, NO_SETTER. EDA_SHAPE registers no mid point
    // at all — an arc's third point is the point editor's, not the panel's.
    const arc = rowsFor('shape:3');
    expect(names(arc)).not.toContain('Mid X');
    // `(start 0 5) (mid -5 0) (end 0 -5)`, so the centre is the origin. KiCad's
    // ArcTangente puts the start vector (0, 5) at +90° and the end vector
    // (0, -5) at -90° (eda_angle's x == 0 cases), and `CalcArcAngles` winds the
    // end FORWARD past the start — to 270° — before subtracting. So the sweep is
    // 180° and not -180°: the arc is the half that runs through (-5, 0).
    expect(row(arc, 'Angle').value).toBe('180°');
    expect(row(arc, 'Angle').set).toBeUndefined();
  });

  it('gives a rectangle Width and Height, which move the END corner', () => {
    // `GetRectangleWidth()` is `GetEndX() - GetStartX()`, and the setter is
    // `SetEndX( GetStartX() + width )` (eda_shape.cpp:488-499, 540-552) — the
    // start corner is the anchor.
    const rect = rowsFor('shape:4');
    expect(names(rect)).toContain('Corner Radius');
    expect(row(rect, 'Width').value).toBe(MM(20));
    expect(row(rect, 'Height').value).toBe(MM(10));
    const wider = row(rect, 'Width').set?.(MM(30));
    expect(wider?.shapes[4]?.start).toEqual({ x: MM(0), y: MM(0) });
    expect(wider?.shapes[4]?.end).toEqual({ x: MM(30), y: MM(10) });
  });

  it("changes the SHAPE_T, which is the node's head token", () => {
    // `SetShape` assigns the type and moves no point (eda_shape.cpp:2809-2812),
    // so a segment becomes a rectangle on the same two corners. The head token
    // has to be rewritten for it, which is the one edit that goes through the
    // BUILDER rather than the stored source.
    expect(row(line, 'Shape').value).toBe('Segment');
    expect(row(line, 'Shape').choices).toEqual([
      'Segment',
      'Rectangle',
      'Arc',
      'Circle',
      'Polygon',
      'Bezier',
    ]);

    const asRect = row(line, 'Shape').set?.('Rectangle');
    expect(asRect?.shapes[0]?.kind).toBe('rect');
    expect(asRect?.shapes[0]?.start).toEqual({ x: MM(0), y: MM(0) });
    expect(asRect?.shapes[0]?.end).toEqual({ x: MM(5), y: MM(0) });
    const written = flat(writeBoardNode(asRect as Board));
    expect(written).toContain('(gr_rect (start 0 0) (end 5 0)');
    expect(written).not.toContain('(gr_line (start 0 0) (end 5 0)');
    // The builder has to carry what the source did: this shape's dash type, its
    // uuid and its layer all survive the rewrite.
    expect(written).toContain('(type dash)');
    expect(written).toContain('"gl1"');
  });

  it('gives a rectangle a Corner Radius, and refuses one past half the short side', () => {
    // `SetCornerRadius` clamps to `min(w, h) / 2`, and the property's own
    // validator REFUSES a larger value rather than clamping it
    // (eda_shape.cpp:2827-2850) — a refused edit puts the cell back.
    const rect = rowsFor('shape:4');
    expect(row(rect, 'Corner Radius').value).toBe(0);
    // The fixture rectangle is 20 x 10, so the limit is 5 mm.
    expect(row(rect, 'Corner Radius').set?.(MM(6))).toBeNull();
    expect(row(rect, 'Corner Radius').set?.(MM(-1))).toBeNull();

    const rounded = row(rect, 'Corner Radius').set?.(MM(2));
    expect(rounded?.shapes[4]?.cornerRadius).toBe(MM(2));
    expect(flat(rounded!.shapes[4]!.source)).toContain('(radius 2)');

    // And zero drops the token: the writer emits it only when it is non-zero.
    const square = row(rowsFor('shape:4', rounded as Board), 'Corner Radius').set?.(0);
    expect(square?.shapes[4]?.cornerRadius).toBeUndefined();
    expect(flat(square!.shapes[4]!.source)).not.toContain('radius');
  });

  it('has no Corner Radius on anything but a rectangle', () => {
    for (const r of [line, circle]) expect(names(r)).not.toContain('Corner Radius');
  });

  it('offers a Net on copper only, and writes the net NAME', () => {
    // `OverrideAvailability( …, "Net", isCopper )` (pcb_shape.cpp:1150-1155);
    // PCB_SHAPE is a BOARD_CONNECTED_ITEM, and the writer emits `(net …)` with
    // the name (pcb_io_kicad_sexpr.cpp:1116) whenever the code is non-zero.
    expect(names(line)).not.toContain('Net');
    const copper = rowsFor('shape:5');
    expect(names(copper)).toContain('Net');

    const gnd = row(copper, 'Net').set?.('GND');
    expect(gnd?.shapes[5]?.net).toBe(1);
    expect(gnd?.shapes[5]?.netName).toBe('GND');
    expect(serialize(gnd!.shapes[5]!.source)).toContain('(net "GND")');
  });

  it('offers the Technical Layers group on an external copper layer only', () => {
    // `isExternalCuLayer` (pcb_shape.cpp:1216-1223): a mask opening is a
    // front/back thing, so an inner-layer or silkscreen graphic has no group.
    expect(groupOrder(rowsFor('shape:5'))).toContain('Technical Layers');
    expect(groupOrder(line)).not.toContain('Technical Layers');

    const masked = row(rowsFor('shape:5'), 'Soldermask').set?.(true);
    expect(masked?.shapes[5]?.maskLayer).toBe('F.Mask');
    expect(serialize(masked!.shapes[5]!.source)).toContain('(layers "F.Cu" "F.Mask")');
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

  it('groups them Basic / Shape Properties', () => {
    // EDA_SHAPE_DESC's group is "Shape Properties" (common/eda_shape.cpp:2807);
    // "Stroke" was ours.
    expect(groupOrder(line)).toEqual(['', 'Shape Properties']);
  });
});

/**
 * Four item types whose panel used to be EMPTY — the dispatcher had no case for
 * them, so selecting one showed "Text Box" and nothing under it.
 */
describe('TEXT BOX rows', () => {
  const rows = rowsFor('textbox:0');

  it('shows the text, border and margin groups, and none of the shape ones', () => {
    // PCB_TEXTBOX inherits PCB_SHAPE and masks nearly all of it
    // (pcb_textbox.cpp:415-441): Shape, Start/End X/Y, Width, Height, Line
    // Width, Line Style, Filled, Line Color, Corner Radius and the Soldermask
    // pair. The geometry a box would show belongs to its BORDER instead.
    expect(groupOrder(rows)).toEqual(['', 'Text Properties', 'Border Properties', 'Margins']);
    for (const n of ['Shape', 'Start X', 'End Y', 'Line Width', 'Line Style', 'Fill', 'Soldermask'])
      expect(names(rows), n).not.toContain(n);
  });

  it('takes Width and Height from EDA_TEXT, not from the masked shape', () => {
    // The masks name EDA_SHAPE's Width and Height; EDA_TEXT's survive, so these
    // two rows are the GLYPH box — 1 mm square here — and not the 20x10 rectangle.
    expect(row(rows, 'Width').value).toBe(MM(1));
    expect(row(rows, 'Height').value).toBe(MM(1));
    expect(row(rows, 'Width').group).toBe('Text Properties');
  });

  it('edits the border, the four margins and the text', () => {
    expect(row(rows, 'Border').value).toBe(true);
    expect(row(rows, 'Border Style').value).toBe('Dashed');
    expect(row(rows, 'Border Width').value).toBe(MM(0.15));
    expect(row(rows, 'Margin Left').value).toBe(MM(0.5));
    expect(row(rows, 'Margin Bottom').value).toBe(MM(0.8));

    const off = row(rows, 'Border').set?.(false);
    expect(off?.textBoxes[0]?.border).toBe(false);
    expect(flat(off!.textBoxes[0]!.source)).toContain('(border no)');

    const margin = row(rows, 'Margin Top').set?.(MM(1.25));
    expect(margin?.textBoxes[0]?.margins.top).toBe(MM(1.25));

    const text = row(rows, 'Text').set?.('rewritten');
    expect(text?.textBoxes[0]?.text).toBe('rewritten');
  });

  it('reads its justification, which the fixture sets to left/top', () => {
    expect(row(rows, 'Horizontal Justification').value).toBe('Left');
    expect(row(rows, 'Vertical Justification').value).toBe('Top');
    const centred = row(rows, 'Horizontal Justification').set?.('Center');
    expect(centred?.textBoxes[0]?.justify).not.toContain('left');
  });
});

describe('TABLE rows', () => {
  const rows = rowsFor('table:0');

  it('lists the border and separator properties in one group', () => {
    expect(names(rows)).toEqual([
      'Start X',
      'Start Y',
      'Locked',
      'External Border',
      'Header Border',
      'Border Width',
      'Border Style',
      'Row Separators',
      'Cell Separators',
      'Separators Width',
      'Separators Style',
    ]);
    expect(groupOrder(rows)).toEqual(['', 'Table Properties']);
  });

  it('reads the two strokes separately, and commits each', () => {
    expect(row(rows, 'External Border').value).toBe(true);
    expect(row(rows, 'Header Border').value).toBe(false);
    expect(row(rows, 'Border Width').value).toBe(MM(0.2));
    expect(row(rows, 'Row Separators').value).toBe(true);
    expect(row(rows, 'Cell Separators').value).toBe(false);
    expect(row(rows, 'Separators Style').value).toBe('Dashed');

    const header = row(rows, 'Header Border').set?.(true);
    expect(header?.tables[0]?.borderHeader).toBe(true);
    const width = row(rows, 'Separators Width').set?.(MM(0.3));
    expect(width?.tables[0]?.separatorWidth).toBe(MM(0.3));
  });

  it('shows Start X/Y read-only: a table moves by moving its cells', () => {
    expect(row(rows, 'Start X').value).toBe(MM(0));
    expect(row(rows, 'Start X').set).toBeUndefined();
  });
});

describe('REFERENCE IMAGE rows', () => {
  // A 1x1 PNG is enough: the rows are about the scale, and the size follows it.
  const withImage = load(
    SRC.replace(
      '(group "cluster"',
      `(image (at 100 50) (layer "F.SilkS") (scale 2) (uuid "im1")
         (data "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
       (group "cluster"`,
    ),
  );
  const rows = rowsFor('image:0', withImage);

  it('calls the layer row "Associated Layer", because BOARD_ITEM\'s is replaced', () => {
    // `ReplaceProperty( BOARD_ITEM, "Layer", … "Associated Layer" )`
    // (pcb_reference_image.cpp:432-436): an image is not ON a layer, it is
    // associated with one.
    expect(names(rows)).toContain('Associated Layer');
    expect(names(rows)).not.toContain('Layer');
    expect(row(rows, 'Associated Layer').swatch).toBe('#f2eda1');
  });

  it('lists the Image Properties group, with no Greyscale rows', () => {
    // Upstream declares a `Greyscale` group and never adds a property to it, so
    // it draws nothing there either.
    expect(names(rows)).toEqual([
      'Position X',
      'Position Y',
      'Associated Layer',
      'Locked',
      'Scale',
      'Transform Offset X',
      'Transform Offset Y',
      'Width',
      'Height',
    ]);
    expect(groupOrder(rows)).toEqual(['', 'Image Properties']);
  });

  it('makes Width and Height a SCALE, as REFERENCE_IMAGE::SetWidth is', () => {
    // `SetWidth` divides by the current width and scales by the ratio
    // (common/reference_image.cpp:204-211) — it does not stretch one axis.
    const w = row(rows, 'Width').value as number;
    expect(w).toBeGreaterThan(0);
    const doubled = row(rows, 'Width').set?.(w * 2);
    expect(doubled?.images[0]?.scale).toBeCloseTo(4);
    const next = rowsFor('image:0', doubled as Board);
    // The height went with it: one ratio, both axes. Within a nanometre — the
    // size is pixels/PPI x scale rounded to internal units, so doubling the
    // scale and doubling the rounded size differ in the last IU.
    expect(row(next, 'Height').value as number).toBeCloseTo(
      (row(rows, 'Height').value as number) * 2,
      -1,
    );
  });

  it('keeps the transform offset in memory, because the file has nowhere for it', () => {
    // `format( const PCB_REFERENCE_IMAGE* )` writes (at), the layer, (scale),
    // (locked) and the data — upstream loses this on save too.
    const moved = row(rows, 'Transform Offset X').set?.(MM(3));
    expect(moved?.images[0]?.transformOffset).toEqual({ x: MM(3), y: 0 });
    expect(flat(moved!.images[0]!.source)).not.toContain('transform');
  });
});

describe('GROUP rows', () => {
  const rows = rowsFor('group:0');

  it('has a Name and a Locked flag, and no geometry', () => {
    // PCB_GROUP masks Position X, Position Y and Layer (pcb_group.cpp): a group
    // has no geometry and no layer of its own.
    expect(names(rows)).toEqual(['Locked', 'Name']);
    expect(groupOrder(rows)).toEqual(['', 'Group Properties']);
    expect(row(rows, 'Name').value).toBe('cluster');
  });

  it('renames the group in its own node, which is the first argument', () => {
    const renamed = row(rows, 'Name').set?.('power');
    expect(renamed?.groups[0]?.name).toBe('power');
    expect(flat(renamed!.groups[0]!.source)).toContain('(group "power"');
    // The members are untouched: renaming is not re-grouping.
    expect(renamed?.groups[0]?.members).toEqual(['gl1', 'gc1']);
  });
});

/**
 * A dimension, which had no panel at all. Which rows exist is almost entirely a
 * question of WHICH KIND it is, and the two kinds here — an orthogonal and a
 * leader — are the two extremes of that.
 */
describe('DIMENSION rows', () => {
  const ortho = rowsFor('dimension:0');
  const leader = rowsFor('dimension:1');

  it('opens on Dimension Properties and reaches Basic Properties last', () => {
    // Groups are collected derived-first (property_mgr.cpp:319-345), and every
    // property a dimension registers carries a group, so '' arrives from
    // BOARD_ITEM at the end.
    expect(groupOrder(ortho)).toEqual(['Dimension Properties', 'Text Properties', '']);
  });

  it('gives a measured dimension the format rows and an arrow direction', () => {
    // `isNotLeader` on the seven format rows, and `isMultiArrowDirection` —
    // `dynamic_cast<PCB_DIM_ALIGNED*>`, so an aligned or an orthogonal — on the
    // arrow one (pcb_dimension.cpp:1916-1953).
    expect(row(ortho, 'Prefix').value).toBe('R ');
    expect(row(ortho, 'Suffix').value).toBe(' typ');
    expect(row(ortho, 'Units').value).toBe('Automatic');
    expect(row(ortho, 'Units Format').value).toBe('1234.0');
    expect(row(ortho, 'Precision').value).toBe('0.0000');
    expect(row(ortho, 'Suppress Trailing Zeroes').value).toBe(true);
    expect(row(ortho, 'Arrow Direction').value).toBe('Outward');
    // PCB_DIM_ALIGNED's own two, after the base's.
    expect(row(ortho, 'Crossbar Height').value).toBe(MM(12.85));
    expect(names(ortho)).toContain('Extension Line Overshoot');
    // A leader has none of them.
    for (const n of ['Prefix', 'Units', 'Precision', 'Arrow Direction', 'Crossbar Height'])
      expect(names(leader), n).not.toContain(n);
  });

  it("calls a leader's override text 'Text', because that is all it has", () => {
    // Same setter as the others' Override Text — `ChangeOverrideText`
    // (:1929-1932) — under a different name and the opposite availability.
    expect(names(leader)).toContain('Text');
    expect(names(leader)).not.toContain('Override Text');
    expect(row(leader, 'Text').value).toBe('0.3mm Thickness');
    expect(names(ortho)).toContain('Override Text');
    expect(names(ortho)).not.toContain('Text');

    // And the Text Frame is the leader's alone.
    expect(row(leader, 'Text Frame').value).toBe('Rectangle');
    expect(names(ortho)).not.toContain('Text Frame');
  });

  it('greys the text Orientation while the text is kept aligned', () => {
    // `SetWriteableFunc( isTextOrientationWriteable )` (:1957-1973): when the
    // text follows the dimension, the dimension owns the angle.
    expect(row(ortho, 'Keep Aligned with Dimension').value).toBe(true);
    expect(row(ortho, 'Orientation').set).toBeUndefined();

    const freed = rowsFor(
      'dimension:0',
      row(ortho, 'Keep Aligned with Dimension').set?.(false) as Board,
    );
    expect(row(freed, 'Orientation').set).toBeTypeOf('function');
  });

  it('shows none of the four rows every subtype turns off', () => {
    // Each subtype `OverrideAvailability`s EDA_TEXT's Text, Vertical
    // Justification and Hyperlink and BOARD_ITEM's Knockout to false
    // (pcb_dimension.cpp:2010-2024) — and the base masks EDA_TEXT's Orientation,
    // replacing it with its own in Text Properties.
    for (const n of ['Vertical Justification', 'Hyperlink', 'Knockout'])
      expect(names(ortho), n).not.toContain(n);
    expect(row(ortho, 'Orientation').group).toBe('Text Properties');
  });

  it('commits a format change, and the crossbar height as its own token', () => {
    const mm = row(ortho, 'Units').set?.('Millimeters');
    expect(mm?.dimensions[0]?.format?.units).toBe(2);

    const taller = row(ortho, 'Crossbar Height').set?.(MM(20));
    expect(taller?.dimensions[0]?.height).toBe(MM(20));
    expect(flat(taller!.dimensions[0]!.source)).toContain('(height 20)');
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
