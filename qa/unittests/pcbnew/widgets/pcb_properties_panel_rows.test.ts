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
import { head, isList, parse, serialize } from '@ziroeda/sexpr/index.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { pcbIUScale, pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PAD_DRILL_POST_MACHINING_MODE } from '@ziroeda/pcbnew/padstack.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import type { PCB_DIMENSION_BASE } from '@ziroeda/pcbnew/pcb_dimension.js';
import type { PCB_GROUP } from '@ziroeda/pcbnew/pcb_group.js';
import type { PCB_REFERENCE_IMAGE } from '@ziroeda/pcbnew/pcb_reference_image.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { PCB_TABLE } from '@ziroeda/pcbnew/pcb_table.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import type { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import type { PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/zones.js';
import {
  CAPPING_MODE,
  COVERING_MODE,
  FILLING_MODE,
  PLUGGING_MODE,
  TENTING_MODE,
} from '@ziroeda/pcbnew/pcb_track_types.js';
import { DIM_UNITS_MODE } from '@ziroeda/pcbnew/pcb_dimension.js';
import type { PCB_DIM_ALIGNED } from '@ziroeda/pcbnew/pcb_dimension.js';
import { PAD_SHAPE, UNCONNECTED_LAYER_MODE } from '@ziroeda/pcbnew/padstack.js';
import {
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
} from '@ziroeda/pcbnew/footprint.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  GR_TEXT_H_ALIGN_T as H,
  GR_TEXT_V_ALIGN_T as V,
} from '@ziroeda/common/font/text_attributes.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  PCB_PROPERTIES_PANEL,
  type PCB_GRID_ROW,
} from '@ziroeda/pcbnew/widgets/pcb_properties_panel.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

/**
 * The live panel behind each BOARD these tests read: the frame it sits in and
 * the text it was read from.
 */
interface LIVE {
  kb: BOARD;
  frame: TEST_PCB_FRAME;
  /** The text the BOARD was read from, so an edit can run on a fresh copy. */
  text: string;
}
const LIVE_OF = new WeakMap<BOARD, LIVE>();

function viewOf(ctx: LIVE): BOARD {
  LIVE_OF.set(ctx.kb, ctx);
  return ctx.kb;
}

/** The board's drawings of that type, in board order. */
const drawingsOf = <T extends BOARD_ITEM>(kb: BOARD, ...aTypes: KICAD_T[]): T[] =>
  kb.Drawings().filter((d) => aTypes.includes(d.Type())) as T[];
const tracksOf = <T extends BOARD_ITEM>(kb: BOARD, aType: KICAD_T): T[] =>
  kb.Tracks().filter((t) => t.Type() === aType) as unknown as T[];
const DIMENSION_TYPES = [
  KICAD_T.PCB_DIM_ALIGNED_T,
  KICAD_T.PCB_DIM_ORTHOGONAL_T,
  KICAD_T.PCB_DIM_LEADER_T,
  KICAD_T.PCB_DIM_CENTER_T,
  KICAD_T.PCB_DIM_RADIAL_T,
];

/**
 * The item a `kind:index[:sub]` id names: each kind's items in board order,
 * a pad by its footprint and its index there.
 */
function itemOf(kb: BOARD, id: string): EDA_ITEM | null {
  const [kind, a, b] = id.split(':');
  const i = Number(a);
  const lists: Record<string, readonly EDA_ITEM[]> = {
    footprint: kb.Footprints(),
    track: tracksOf(kb, KICAD_T.PCB_TRACE_T),
    arc: tracksOf(kb, KICAD_T.PCB_ARC_T),
    via: tracksOf(kb, KICAD_T.PCB_VIA_T),
    zone: kb.Zones(),
    shape: drawingsOf(kb, KICAD_T.PCB_SHAPE_T),
    text: drawingsOf(kb, KICAD_T.PCB_TEXT_T),
    textbox: drawingsOf(kb, KICAD_T.PCB_TEXTBOX_T),
    table: drawingsOf(kb, KICAD_T.PCB_TABLE_T),
    image: drawingsOf(kb, KICAD_T.PCB_REFERENCE_IMAGE_T),
    dimension: drawingsOf(kb, ...DIMENSION_TYPES),
    point: kb.Points(),
    group: kb.Groups(),
  };
  if (kind === 'pad') return kb.Footprints()[i]?.Pads()[Number(b)] ?? null;
  return lists[kind!]?.[i] ?? null;
}

// The live items the assertions read back off a board.
const fp0 = (b: BOARD | null | undefined): FOOTPRINT | undefined => b?.Footprints()[0];
const padOf = (b: BOARD | null | undefined, j: number): PAD | undefined => fp0(b)?.Pads()[j];
const track0 = (b: BOARD | null | undefined): PCB_TRACK | undefined =>
  b ? tracksOf<PCB_TRACK>(b, KICAD_T.PCB_TRACE_T)[0] : undefined;
const via0 = (b: BOARD | null | undefined): PCB_VIA | undefined =>
  b ? tracksOf<PCB_VIA>(b, KICAD_T.PCB_VIA_T)[0] : undefined;
const zone0 = (b: BOARD | null | undefined): ZONE | undefined => b?.Zones()[0];
const text0 = (b: BOARD | null | undefined): PCB_TEXT | undefined =>
  b ? drawingsOf<PCB_TEXT>(b, KICAD_T.PCB_TEXT_T)[0] : undefined;
const shapeN = (b: BOARD | null | undefined, n: number): PCB_SHAPE | undefined =>
  b ? drawingsOf<PCB_SHAPE>(b, KICAD_T.PCB_SHAPE_T)[n] : undefined;
const textbox0 = (b: BOARD | null | undefined): PCB_TEXTBOX | undefined =>
  b ? drawingsOf<PCB_TEXTBOX>(b, KICAD_T.PCB_TEXTBOX_T)[0] : undefined;
const table0 = (b: BOARD | null | undefined): PCB_TABLE | undefined =>
  b ? drawingsOf<PCB_TABLE>(b, KICAD_T.PCB_TABLE_T)[0] : undefined;
const image0 = (b: BOARD | null | undefined): PCB_REFERENCE_IMAGE | undefined =>
  b ? drawingsOf<PCB_REFERENCE_IMAGE>(b, KICAD_T.PCB_REFERENCE_IMAGE_T)[0] : undefined;
const dim0 = (b: BOARD | null | undefined): PCB_DIMENSION_BASE | undefined =>
  b ? drawingsOf<PCB_DIMENSION_BASE>(b, ...DIMENSION_TYPES)[0] : undefined;
const group0 = (b: BOARD | null | undefined): PCB_GROUP | undefined => b?.Groups()[0];
/** The via's front and back TENTING_MODE. */
const tenting = (b: BOARD | null | undefined): [TENTING_MODE, TENTING_MODE] | undefined => {
  const v = via0(b);
  return v ? [v.GetFrontTentingMode(), v.GetBackTentingMode()] : undefined;
};
const justify = (t: PCB_TEXT | undefined) => [t?.GetHorizJustify(), t?.GetVertJustify()];

/** An item of the board, children included, by uuid. */
function findByUuid(kb: BOARD, uuid: string): EDA_ITEM | null {
  let found: EDA_ITEM | null = null;
  const visit = (item: BOARD_ITEM): void => {
    if (found) return;
    if (item.m_Uuid === uuid) found = item;
    else item.RunOnChildren((c) => visit(c), RECURSE_MODE.RECURSE);
  };
  for (const list of [
    kb.Footprints(),
    kb.Drawings(),
    kb.Tracks(),
    kb.Zones(),
    kb.Groups(),
    kb.Points(),
  ])
    for (const item of list as BOARD_ITEM[]) visit(item);
  return found;
}

/** The row type these tests read: a grid cell whose edit returns the next view. */
type PcbPropRow = Omit<PCB_GRID_ROW, 'set'> & {
  set?: (v: string | number | boolean) => BOARD | null;
};

/** The colour each layer's swatch is painted in: the frame's colour settings. */
const swatchOf = (board: BOARD, layer: string): string => {
  const ctx = LIVE_OF.get(board)!;
  const c = ctx.frame.GetColorSettings().GetColor(ctx.kb.GetLayerID(layer));
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
};

/** `EDA_ITEM::GetFriendlyName()` of the item an id names. */
const pcbItemFriendlyName = (board: BOARD, id: string): string | undefined =>
  itemOf(board, id)?.GetFriendlyName();

const MM = (n: number): number => mmToIU(n);
const load = (text: string): BOARD => {
  const kb = ParseBoard(text);
  return viewOf({ kb, frame: new TEST_PCB_FRAME(kb), text });
};
/** What the board WRITES: `FormatBoard`, KiCad's own formatter over the model. */
const written = (board: BOARD): string => FormatBoard(board);
/** The written board with the pretty-printer's newlines squeezed out. */
const flat = (board: BOARD): string =>
  written(board).replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');

/** The nth top-level node of that head in the written board, flattened. */
const flatNode = (board: BOARD, headName: string, nth = 0): string => {
  const root = parse(written(board));
  const nodes = root.items.filter((i) => isList(i) && head(i) === headName);
  const node = nodes[nth];
  if (!node) throw new Error(`no (${headName} …) #${nth} in the written board`);
  return serialize(node as Parameters<typeof serialize>[0])
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
};

/** The first board text's own node as written. */
const writtenText = (board: BOARD): string => flatNode(board, 'gr_text');

/** The head of every DIRECT child of the first footprint node as written. */
const fpChildren = (board: BOARD): string[] => {
  const root = parse(written(board));
  const fp = root.items.find((i) => isList(i) && head(i) === 'footprint');
  return (fp && isList(fp) ? fp.items : []).filter(isList).map((i) => head(i) ?? '');
};

/**
 * The fixture's uuids, real ones: `KIID( string )` turns anything that is not a
 * uuid (or an 8-digit legacy timestamp) into a fresh random id, as KiCad does,
 * so a group naming `"gl1"` would name nothing and be dropped on write.
 */
const U: Record<string, string> = {
  a1: '10000000-0000-4000-8000-000000000001',
  d1: '10000000-0000-4000-8000-000000000002',
  d2: '10000000-0000-4000-8000-000000000003',
  dt1: '10000000-0000-4000-8000-000000000004',
  dt2: '10000000-0000-4000-8000-000000000005',
  f1: '10000000-0000-4000-8000-000000000006',
  f2: '10000000-0000-4000-8000-000000000007',
  f3: '10000000-0000-4000-8000-000000000008',
  f4: '10000000-0000-4000-8000-000000000009',
  f5: '10000000-0000-4000-8000-00000000000a',
  f6: '10000000-0000-4000-8000-00000000000b',
  f7: '10000000-0000-4000-8000-00000000000c',
  fp1: '10000000-0000-4000-8000-00000000000d',
  g1: '10000000-0000-4000-8000-00000000000e',
  ga1: '10000000-0000-4000-8000-00000000000f',
  gc1: '10000000-0000-4000-8000-000000000010',
  gcu1: '10000000-0000-4000-8000-000000000011',
  gl1: '10000000-0000-4000-8000-000000000012',
  gp1: '10000000-0000-4000-8000-000000000013',
  gr1: '10000000-0000-4000-8000-000000000014',
  gt1: '10000000-0000-4000-8000-000000000015',
  im1: '10000000-0000-4000-8000-000000000016',
  p1: '10000000-0000-4000-8000-000000000017',
  p2: '10000000-0000-4000-8000-000000000018',
  t1: '10000000-0000-4000-8000-000000000019',
  tb1: '10000000-0000-4000-8000-00000000001a',
  tbl1: '10000000-0000-4000-8000-00000000001b',
  v1: '10000000-0000-4000-8000-00000000001c',
  z1: '10000000-0000-4000-8000-00000000001d',
};

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (layers
    (0 "F.Cu" signal)
    (1 "In1.Cu" signal)
    (2 "In2.Cu" signal)
    (31 "B.Cu" signal)
    (37 "F.SilkS" user)
    (44 "Edge.Cuts" user)
  )
  (net 0 "")
  (net 2 "VCC")
  (net 1 "GND")
  (footprint "Lib:R_0805" (layer "F.Cu") (uuid "${U.fp1}") (at 10 20 90)
    (descr "Resistor 0805")
    (tags "resistor smd")
    (attr smd exclude_from_bom dnp)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "${U.f1}"))
    (property "Value" "10k" (at 0 1 0) (layer "F.Fab") (uuid "${U.f2}"))
    (pad "1" smd rect (at -1 0) (size 1 1.2) (layers "F.Cu" "F.Paste" "F.Mask")
      (net 1 "GND") (pinfunction "A") (pintype "passive") (uuid "${U.p1}"))
    (pad "2" thru_hole circle (at 1 0) (size 1.2 1.2) (drill 0.6)
      (layers "*.Cu" "*.Mask") (net 2 "VCC") (uuid "${U.p2}")
      (clearance 0.3) (zone_connect 1))
  )
  (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U.t1}"))
  (arc (start 20 0) (mid 25 5) (end 30 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U.a1}"))
  (via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U.v1}"))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "${U.z1}") (name "pour") (priority 3)
    (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20)))
  )
  (gr_text "hello" (at 5 5 0) (layer "F.SilkS") (uuid "${U.gt1}")
    (effects (font (size 1 1) (thickness 0.15))))
  (gr_text_box "note" (start 60 60) (end 80 70) (margins 0.5 0.6 0.7 0.8)
    (layer "F.SilkS") (uuid "${U.tb1}") (border yes)
    (stroke (width 0.15) (type dash))
    (effects (font (size 1 1) (thickness 0.15)) (justify left top)))
  (table (column_count 2) (layer "F.SilkS") (uuid "${U.tbl1}")
    (border (external yes) (header no) (stroke (width 0.2) (type solid)))
    (separators (rows yes) (cols no) (stroke (width 0.1) (type dash)))
    (column_widths 10 10) (row_heights 5)
    (cells
      (table_cell "a" (start 0 0) (end 10 5) (margins 0.5 0.5 0.5 0.5)
        (layer "F.SilkS") (span 1 1) (effects (font (size 1 1))))
      (table_cell "b" (start 10 0) (end 20 5) (margins 0.5 0.5 0.5 0.5)
        (layer "F.SilkS") (span 1 1) (effects (font (size 1 1))))))
  (dimension (type orthogonal) (layer "Dwgs.User") (uuid "${U.d1}")
    (pts (xy 113.6 58.975) (xy 113.35 28.975)) (height 12.85) (orientation 1)
    (format (prefix "R ") (suffix " typ") (units 3) (units_format 0) (precision 4)
      (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
      (keep_text_aligned yes))
    (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User") (uuid "${U.dt1}")
      (effects (font (size 1 1) (thickness 0.15)))))
  (dimension (type leader) (layer "Cmts.User") (uuid "${U.d2}")
    (pts (xy 152.9 67.3) (xy 156.2 63.9))
    (format (prefix "") (suffix "") (units 0) (units_format 0) (precision 4)
      (override_value "0.3mm Thickness"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (text_frame 1) (extension_offset 0.5))
    (gr_text "0.3mm Thickness" (at 168.9 63.9 0) (layer "Cmts.User") (uuid "${U.dt2}")
      (effects (font (size 1 1) (thickness 0.15)))))
  (group "cluster" (uuid "${U.g1}") (members "${U.gl1}" "${U.gc1}"))
  (gr_line (start 0 0) (end 5 0) (stroke (width 0.1) (type dash)) (layer "Edge.Cuts") (uuid "${U.gl1}"))
  (gr_circle (center 30 30) (end 33 34) (stroke (width 0.1) (type solid)) (fill none)
    (layer "F.SilkS") (uuid "${U.gc1}"))
  (gr_poly (pts (xy 0 0) (xy 5 0) (xy 5 5)) (stroke (width 0.1) (type solid)) (fill none)
    (layer "F.SilkS") (uuid "${U.gp1}"))
  (gr_arc (start 0 5) (mid -5 0) (end 0 -5) (stroke (width 0.1) (type solid))
    (layer "F.SilkS") (uuid "${U.ga1}"))
  (gr_rect (start 0 0) (end 20 10) (stroke (width 0.1) (type solid)) (fill none)
    (layer "F.SilkS") (uuid "${U.gr1}"))
  (gr_line (start 1 1) (end 2 2) (stroke (width 0.2) (type solid)) (layer "F.Cu") (uuid "${U.gcu1}"))
)`;

const B = load(SRC);
/**
 * PCB_PROPERTIES_PANEL's rows for one view id (`UpdateData` then the grid).
 * An edit runs on a FRESH read of the same board — the item found again by
 * uuid — and returns that board's view, so each test's rows stay what they
 * read, as the old view-returning rows did.
 */
const rowsFor = (id: string, board: BOARD = B): PcbPropRow[] => {
  const ctx = LIVE_OF.get(board)!;
  const item = itemOf(board, id);
  const gridRows = (c: LIVE, it: EDA_ITEM | null) => {
    const panel = new PCB_PROPERTIES_PANEL(c.frame);
    panel.SetSelectionProvider(() => (it ? [it] : []));
    panel.UpdateData();
    return panel.GridRows({
      units: 'mm',
      iuScale: pcbIUScale,
      originTransforms: c.frame.GetOriginTransforms(),
    });
  };
  return gridRows(ctx, item).map((r) => {
    if (!r.set) return { ...r, set: undefined };
    return {
      ...r,
      set: (v: string | number | boolean) => {
        const kb = ParseBoard(ctx.text);
        const next: LIVE = { kb, frame: new TEST_PCB_FRAME(kb), text: ctx.text };
        const target = item ? findByUuid(kb, item.m_Uuid) : null;
        const edit = gridRows(next, target)
          .find((x) => x.name === r.name)
          ?.set?.(v);
        if (!edit) return null;
        edit();
        next.text = FormatBoard(kb);
        return viewOf(next);
      },
    };
  });
};
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
    expect(layer.swatch).toBe(swatchOf(B, 'F.Cu'));
    expect(layer.choices).toEqual(['F.Cu', 'B.Cu']);

    const flipped = layer.set?.('B.Cu');
    expect(fp0(flipped)?.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    // A flip, not a layer assignment: the children move with it.
    // FOOTPRINT::SetLayerAndFlip is Flip( GetPosition(), LEFT_RIGHT )
    // (footprint.cpp:2923-2929): the first pad, at (10, 21) on the front,
    // mirrors about the anchor's x — which it sits on — so it stays at (10, 21).
    // (The view panel mirrored top-bottom and put it at (10, 19).)
    expect(padOf(flipped, 0)?.GetPosition()).toEqual({ x: MM(10), y: MM(21) });
    expect(padOf(flipped, 0)?.IsOnLayer(PCB_LAYER_ID.B_Cu)).toBe(true);
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
    expect(fp0(movedX)?.GetPosition()).toEqual({ x: MM(12), y: MM(20) });
    expect(padOf(movedX, 0)?.GetPosition()).toEqual({ x: MM(12), y: MM(21) });

    const movedY = row(rows, 'Position Y').set?.(MM(25));
    expect(fp0(movedY)?.GetPosition()).toEqual({ x: MM(10), y: MM(25) });
    expect(padOf(movedY, 0)?.GetPosition()).toEqual({ x: MM(10), y: MM(26) });
  });

  it('commits Reference and Value into the footprint fields', () => {
    expect(fp0(row(rows, 'Reference').set?.('R7'))?.GetReference()).toBe('R7');
    expect(fp0(row(rows, 'Value').set?.('22k'))?.GetValue()).toBe('22k');
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
  const fp = fp0;
  const attr = (b: BOARD | null | undefined, flag: number): boolean =>
    ((fp(b)?.GetAttributes() ?? 0) & flag) !== 0;

  it('toggles each attribute flag, into (attr …) and into the model', () => {
    // The fixture is `(attr smd exclude_from_bom dnp)`, so each assertion moves
    // a flag that is not already where it is being put.
    const boardOnly = row(rows, 'Not in Schematic').set?.(true);
    expect(attr(boardOnly, FP_BOARD_ONLY)).toBe(true);
    expect(written(boardOnly!)).toContain('board_only');

    const posFiles = row(rows, 'Exclude From Position Files').set?.(true);
    expect(attr(posFiles, FP_EXCLUDE_FROM_POS_FILES)).toBe(true);

    const noBom = row(rows, 'Exclude From Bill of Materials').set?.(false);
    expect(attr(noBom, FP_EXCLUDE_FROM_BOM)).toBe(false);
    expect(written(noBom!)).not.toContain('exclude_from_bom');

    const dnp = row(rows, 'Do not Populate').set?.(false);
    expect(attr(dnp, FP_DNP)).toBe(false);

    const courtyard = row(rows, 'Exempt From Courtyard Requirement').set?.(true);
    expect(fp(courtyard)?.AllowMissingCourtyard()).toBe(true);
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
    expect(fp(set)?.GetLocalClearance()).toBe(MM(0.4));
    expect(written(set!)).toContain('(clearance 0.4)');

    const paste = row(rows, 'Solderpaste Margin Override').set?.(MM(0.1));
    expect(fp(paste)?.GetLocalSolderPasteMargin()).toBe(MM(0.1));
    expect(written(paste!)).toContain('(solder_paste_margin 0.1)');
  });

  it('takes the paste ratio as a RATIO, unconverted, and clears it when emptied', () => {
    const ratio = row(rows, 'Solderpaste Margin Ratio Override');
    expect(ratio.value).toBe('');
    const set = ratio.set?.('-0.05');
    expect(fp(set)?.GetLocalSolderPasteMarginRatio()).toBe(-0.05);
    expect(written(set!)).toContain('(solder_paste_margin_ratio -0.05)');

    const cleared = row(rowsFor('footprint:0', set!), 'Solderpaste Margin Ratio Override').set?.(
      '',
    );
    expect(fp(cleared)?.GetLocalSolderPasteMarginRatio()).toBeUndefined();
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
    expect(fp(solid)?.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.FULL);
    expect(written(solid!)).toContain('(zone_connect 2)');

    const none = row(rows, 'Zone Connection Style').set?.('None');
    expect(written(none!)).toContain('(zone_connect 0)');

    const tht = row(rows, 'Zone Connection Style').set?.('Thermal reliefs for PTH');
    expect(fp(tht)?.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.THT_THERMAL);
    expect(written(tht!)).toContain('(zone_connect 3)');

    // INHERITED is -1 and is never written: upstream emits the token only when
    // the value differs from it, so "inherit" is the token's ABSENCE. Asserted
    // on the FOOTPRINT's own children, because the fixture's second pad carries
    // a `(zone_connect 1)` of its own and would satisfy a whole-file search.
    expect(fpChildren(solid!)).toContain('zone_connect');
    const back = row(rowsFor('footprint:0', solid!), 'Zone Connection Style').set?.('Inherited');
    expect(fp(back)?.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.INHERITED);
    expect(fpChildren(back!)).not.toContain('zone_connect');
  });

  it('reads a zone_connect the way KiCad casts it', () => {
    const withZc = (n: number): BOARD =>
      load(SRC.replace('(attr smd exclude_from_bom dnp)', `(attr smd) (zone_connect ${n})`));
    expect(fp0(withZc(0))?.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.NONE);
    expect(fp0(withZc(1))?.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.THERMAL);
    expect(fp0(withZc(2))?.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.FULL);
    expect(fp0(withZc(3))?.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.THT_THERMAL);
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
    `(property "Value" "10k" (at 0 1 0) (layer "F.Fab") (uuid "${U.f2}"))`,
    `(property "Value" "10k" (at 0 1 0) (layer "F.Fab") (uuid "${U.f2}"))
    (property "Datasheet" "https://ds" (at 0 2 0) (layer "F.Fab") (uuid "${U.f3}"))
    (property "Description" "Generic resistor" (at 0 3 0) (layer "F.Fab") (uuid "${U.f4}"))
    (property "MPN" "RC0805" (at 0 4 0) (layer "F.Fab") (uuid "${U.f5}"))
    (property "KiLib_Generator" "kicad" (at 0 5 0) (layer "F.Fab") (uuid "${U.f6}"))
    (property "Sheetname" "/" (at 0 6 0) (layer "F.Fab") (uuid "${U.f7}"))`,
  );
  const F = load(WITH_FIELDS);
  const rows = rowsFor('footprint:0', F);
  const fieldRows = (): string[] => rows.filter((r) => r.group === 'Fields').map((r) => r.name);

  it('puts Value straight after Reference and then sorts the rest by NAME', () => {
    // "Make sure value comes immediately after reference" (:416-419) — Value is
    // added by hand ahead of the loop, and the loop walks `m_currentFieldNames`,
    // a std::set<wxString>, so the rest are alphabetical and NOT in file order.
    // The file writes Datasheet, Description, MPN, KiLib_Generator in that
    // order; sorted, KiLib_Generator comes third. Sheetname is one of the
    // footprint's fields in a 20230620+ file, so it is a row too (below).
    expect(fieldRows()).toEqual([
      'Reference',
      'Value',
      'Datasheet',
      'Description',
      'KiLib_Generator',
      'MPN',
      'Sheetname',
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

  it('shows a Sheetname property as the user field it is in a new file', () => {
    // `parseFOOTPRINT` consumes Sheetname into `FOOTPRINT::SetSheetname`
    // (pcb_io_kicad_sexpr_parser.cpp:5176-5180) only for a file older than
    // 20230620. This fixture is newer, so it is an ordinary field, and
    // PCB_PROPERTIES_PANEL::rebuildProperties adds a row for every field name
    // (:405-431) — there is no reserved-name filter. The view panel had one.
    expect(fieldRows()).toContain('Sheetname');
    expect(row(rows, 'Sheetname').value).toBe('/');
    expect(fp0(F)?.GetSheetname()).toBe('');
  });

  it('commits an edited field into the model AND its source', () => {
    const next = row(rows, 'MPN').set?.('RC0805-B');
    const fp = fp0(next);
    expect(fp?.GetField('MPN')?.GetText()).toBe('RC0805-B');
    // The written board is what survives a reload, so the patched source is the
    // half that matters: a model-only edit reverts on the next open.
    expect(written(next!)).toContain('"MPN" "RC0805-B"');
  });

  it('adds a field the footprint does not carry yet', () => {
    // PCB_FOOTPRINT_FIELD_PROPERTY::setter (:99-105): `GetField( m_name )`
    // finding nothing means a new FIELD_T::USER field, not a dropped edit. Here
    // that is Datasheet on the FIXTURE footprint, which writes no such property.
    // Datasheet and Description are FOOTPRINT's mandatory fields, so both
    // exist on every footprint whether or not the file wrote them.
    const bare = rowsFor('footprint:0');
    const next = row(bare, 'Datasheet').set?.('https://example/ds.pdf');
    expect(fp0(next)?.GetField('Datasheet')?.GetText()).toBe('https://example/ds.pdf');
    expect(written(next!)).toContain('"Datasheet" "https://example/ds.pdf"');
  });

  it('rejects an edit that changes nothing, the way every other row does', () => {
    // wxPropertyGrid raises no EVT_PG_CHANGED for an unchanged value.
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

  it('drops Size Y for a circle, and greys the hole rows on an SMD pad', () => {
    expect(names(smd)).toContain('Size Y');
    // pad.cpp:3527-3540: the hole rows are WRITEABLE only where
    // padCanHaveHole; they stay available, greyed, on an SMD pad. (The view
    // panel dropped them.)
    expect(row(smd, 'Hole Size X').set).toBeUndefined();
    expect(row(pth, 'Hole Size X').set).toBeTypeOf('function');
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
    // pad.cpp:3757-3759 gives the property no writeable function: KiCad lets
    // an SMD pad take the value too (its writer then emits nothing for it).
    expect(row(smd, 'Copper Layers').set).toBeTypeOf('function');
  });

  it('commits Copper Layers as the two booleans a PTH pad stores', () => {
    const next = row(pth, 'Copper Layers').set?.('Front, back and connected layers');
    expect(padOf(next, 1)?.GetUnconnectedLayerMode()).toBe(
      UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END,
    );
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
    expect(padOf(named, 0)?.GetPinFunction()).toBe('CLK');
    expect(written(named!)).toContain('(pinfunction "CLK")');

    const typed = row(smd, 'Pin Type').set?.('power_in');
    expect(padOf(typed, 0)?.GetPinType()).toBe('power_in');
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
    expect(padOf(B, 1)?.GetLocalClearance()).toBe(MM(0.3));
  });

  it('clears an override when the cell is emptied', () => {
    const next = row(pth, 'Clearance Override').set?.('');
    // Asserted BEFORE the value: a builder that simply refused the empty
    // string would return null here, and `null?.…  ?? null` is also null —
    // the rejection and the clear would be indistinguishable.
    expect(next).not.toBeNull();
    expect(next).not.toBeUndefined();
    expect(padOf(next, 1)?.GetLocalClearance() ?? null).toBeNull();
    // The pad is otherwise untouched, so this is a cleared override and not a
    // dropped pad.
    expect(padOf(next, 1)?.GetNumber()).toBe('2');
  });

  it('offers the board’s nets as the Net choices, sorted by name', () => {
    // PCB_PROPERTIES_PANEL::updateLists sorts CmpNoCase; the file lists VCC
    // before GND, so an unsorted builder would fail here.
    // Net 0 is listed by its name, which is empty (updateLists, :603-612).
    expect(row(smd, 'Net').choices).toEqual(['', 'GND', 'VCC']);
    expect(row(smd, 'Net').value).toBe('GND');
    // The file declares `(net 2 "VCC")` before `(net 1 "GND")`, and
    // `NETINFO_LIST::AppendNet` renumbers a code that is not the next
    // consecutive one (netinfo_list.cpp:160-165): VCC is net 1 on the board.
    expect(padOf(row(smd, 'Net').set?.('VCC'), 0)?.GetNetname()).toBe('VCC');
  });

  it('offers the pad type and shape as labels, and commits the token', () => {
    expect(row(smd, 'Pad Shape').value).toBe('Rectangle');
    // ENUM_MAP<PAD_SHAPE> in its registration order (pad.cpp:3328-3335).
    expect(row(smd, 'Pad Shape').choices).toEqual([
      'Circle',
      'Rectangle',
      'Oval',
      'Trapezoid',
      'Rounded rectangle',
      'Chamfered rectangle',
      'Custom',
    ]);
    expect(padOf(row(smd, 'Pad Shape').set?.('Oval'), 0)?.GetShape(PCB_LAYER_ID.F_Cu)).toBe(
      PAD_SHAPE.OVAL,
    );
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
    // walking derived-to-base leaves the base's first: BOARD_ITEM's Locked,
    // then BOARD_CONNECTED_ITEM's Layer (its ReplaceProperty) and Net, then
    // PCB_TRACK's own in registration order — Width, then Start X/Y (its
    // ReplaceProperty of Position X/Y, which `ReplaceProperty` ADDS to the
    // replacing class's own list, property_mgr.cpp; it does not take the
    // replaced one's place), then End X/Y.
    //
    // And they are all in Basic Properties: there is no "Track Properties" group
    // upstream — PCB_TRACK passes no group for any of them.
    expect(names(track)).toEqual([
      'Locked',
      'Layer',
      'Net',
      'Width',
      'Start X',
      'Start Y',
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
    expect(track0(masked)?.HasSolderMask()).toBe(true);
    const margin = row(track, 'Soldermask Margin Override').set?.(MM(0.05));
    expect(track0(margin)?.GetLocalSolderMaskMargin()).toBe(MM(0.05));
    expect(row(track, 'Soldermask Margin Override').optional).toBe(true);
  });

  it('leaves an arc’s endpoints writeable, as PCB_ARC overrides nothing', () => {
    // pcb_track.cpp:3169-3170 registers PCB_ARC with no writeability override;
    // the view panel greyed the four.
    for (const n of ['Start X', 'Start Y', 'End X', 'End Y']) {
      expect(row(track, n).set, `track ${n}`).toBeTypeOf('function');
      expect(row(arc, n).set, `arc ${n}`).toBeTypeOf('function');
    }
    // Everything else stays writeable on an arc.
    expect(row(arc, 'Width').set).toBeTypeOf('function');
  });

  it('offers COPPER layers only, with the layer colour beside the name', () => {
    // updateLists gives a BOARD_CONNECTED_ITEM `layersCu`, not `layersAll`:
    // F.SilkS and Edge.Cuts are enabled on this board and must not be here.
    const layer = row(track, 'Layer');
    expect(layer.choices).toEqual(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
    expect(layer.swatch).toBe(swatchOf(B, 'F.Cu'));
    expect(track0(layer.set?.('B.Cu'))?.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
  });

  it('commits a width in internal units', () => {
    expect(track0(row(track, 'Width').set?.(MM(0.5)))?.GetWidth()).toBe(MM(0.5));
  });
});

describe('VIA rows', () => {
  const rows = rowsFor('via:0');

  it('orders the groups own-first, after Basic Properties', () => {
    // `collectGroupsRecursive` (property_mgr.cpp:319-345) collects the class's
    // OWN groups first and its bases' after — the opposite of the property order
    // inside a group.
    // Except that every CLASS_DESC starts its own group list with '' (its
    // constructor, property_mgr.h:278-283), so the unnamed group — Basic
    // Properties — leads for every item. Then PCB_VIA's own three
    // (pcb_track.cpp:3179-3180), then BOARD_CONNECTED_ITEM's Teardrops.
    expect(groupOrder(rows)).toEqual([
      '',
      'Via Properties',
      'Backdrill',
      'Post-machining',
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
    expect(row(rows, 'Layer Top').swatch).toBe(swatchOf(B, 'F.Cu'));
    expect(row(rows, 'Layer Bottom').value).toBe('B.Cu');
    expect(row(rows, 'Layer Bottom').swatch).toBe(swatchOf(B, 'B.Cu'));
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
    expect(tenting(tented)).toEqual([TENTING_MODE.TENTED, TENTING_MODE.FROM_BOARD]);
    // `(front yes) (back none)` — the sides are independent, and `none` is how
    // the empty optional is spelled.
    expect(flatNode(tented!, 'via')).toContain('(tenting (front yes) (back none))');

    // A pre-10.0 via reads capping as OFF, not "from board" (the parser's
    // legacy branch, pcb_io_kicad_sexpr_parser.cpp:7420-7430), so the cell
    // already says Not capped and choosing it again is no edit at all.
    expect(row(rows, 'Capping').value).toBe('Not capped');
    expect(row(rows, 'Capping').set?.('Not capped')).toBeNull();
    const capped = row(rows, 'Capping').set?.('Capped');
    expect(via0(capped)?.GetCappingMode()).toBe(CAPPING_MODE.CAPPED);
    expect(flatNode(capped!, 'via')).toContain('(capping yes)');

    // Back to the board: the token goes away rather than reading `(capping none)`,
    // because the writer emits it only `if( …is_capped.has_value() )`.
    const back = row(rowsFor('via:0', capped!), 'Capping').set?.('From board stackup');
    expect(via0(back)?.GetCappingMode()).toBe(CAPPING_MODE.FROM_BOARD);
    expect(flatNode(back!, 'via')).not.toContain('capping');
  });

  it("reads the flags back, including tenting's legacy bare-word spelling", () => {
    const withFlags = load(
      SRC.replace(
        `(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U.v1}"))`,
        `(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U.v1}")
           (tenting (front yes) (back no)) (covering (front no) (back none))
           (plugging (front yes) (back yes)) (capping yes) (filling no))`,
      ),
    );
    const v = via0(withFlags)!;
    expect(tenting(withFlags)).toEqual([TENTING_MODE.TENTED, TENTING_MODE.NOT_TENTED]);
    expect([v.GetFrontCoveringMode(), v.GetBackCoveringMode()]).toEqual([
      COVERING_MODE.NOT_COVERED,
      COVERING_MODE.FROM_BOARD,
    ]);
    expect([v.GetFrontPluggingMode(), v.GetBackPluggingMode()]).toEqual([
      PLUGGING_MODE.PLUGGED,
      PLUGGING_MODE.PLUGGED,
    ]);
    expect(v.GetCappingMode()).toBe(CAPPING_MODE.CAPPED);
    expect(v.GetFillingMode()).toBe(FILLING_MODE.NOT_FILLED);

    // `parseFrontBackOptBool( true )`: before the sides could differ, tenting was
    // written as bare words, and `none` reset both.
    const legacy = load(
      SRC.replace(`(net 1) (uuid "${U.v1}"))`, `(net 1) (uuid "${U.v1}") (tenting front))`),
    );
    expect(tenting(legacy)).toEqual([TENTING_MODE.TENTED, TENTING_MODE.FROM_BOARD]);

    // `none` resets BOTH sides whatever came before it, so this is not
    // "front, then nothing" — it is nothing at all.
    const legacyNone = load(
      SRC.replace(`(net 1) (uuid "${U.v1}"))`, `(net 1) (uuid "${U.v1}") (tenting front none))`),
    );
    expect(tenting(legacyNone)).toEqual([TENTING_MODE.FROM_BOARD, TENTING_MODE.FROM_BOARD]);

    // And a via that says nothing follows the board on both sides: the
    // writer's test is `has_value()` on each side.
    expect(tenting(B)).toEqual([TENTING_MODE.FROM_BOARD, TENTING_MODE.FROM_BOARD]);
  });

  it('commits the diameter and the hole', () => {
    expect(via0(row(rows, 'Diameter').set?.(MM(1)))?.GetWidth(PCB_LAYER_ID.F_Cu)).toBe(MM(1));
    expect(via0(row(rows, 'Hole').set?.(MM(0.5)))?.GetDrillValue()).toBe(MM(0.5));
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
      `(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U.v1}"))`,
      `(via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U.v1}")
         (backdrill (size 0.6) (layers "B.Cu" "In1.Cu"))
         (front_post_machining counterbore (size 1.2) (depth 0.3))
         (back_post_machining countersink (size 1.4) (angle 90)))`,
    ),
  );
  const via = rowsFor('via:0', drilled);
  /** The live PADSTACK of the first via / the PTH pad on a view's BOARD. */
  const viaStack = (b: BOARD) => via0(b)!.Padstack();
  const layerName = (l: number) => LSET_Name(l);

  it('reads a backdrill by its START layer, which is the side', () => {
    // `findBackdrillDrill( aTop )` (padstack.cpp:523-536): the slot number means
    // nothing and the start layer means everything — B.Cu is the bottom side.
    // That is why KiCad 10.0 files, which used the tertiary slot for the top
    // backdrill, still read correctly.
    const slot = viaStack(drilled).SecondaryDrill();
    expect([slot.size.x, layerName(slot.start), layerName(slot.end)]).toEqual([
      MM(0.6),
      'B.Cu',
      'In1.Cu',
    ]);
    expect(row(via, 'Backdrill Mode').value).toBe('Backdrill bottom');
    expect(row(via, 'Bottom Backdrill Size').value).toBe(MM(0.6));
    expect(row(via, 'Bottom Backdrill Must-Cut').value).toBe('In1.Cu');
  });

  it("shows a side's size and must-cut only when the mode names that side", () => {
    // The two `SetAvailableFunc`s on each pair (pcb_track.cpp:3238-3290).
    expect(names(via)).not.toContain('Top Backdrill Size');
    expect(names(via)).not.toContain('Top Backdrill Must-Cut');

    const both = rowsFor('via:0', row(via, 'Backdrill Mode').set?.('Backdrill both') as BOARD);
    expect(names(both)).toContain('Top Backdrill Size');
    // `SetBackdrillMode` gives a new side a drill 10% over the main hole
    // (padstack.cpp:549-550) — 0.4 mm here, so 0.44.
    expect(row(both, 'Top Backdrill Size').value).toBe(MM(0.44));
  });

  it('writes the backdrill back as its own node, and drops it with the mode', () => {
    const both = row(via, 'Backdrill Mode').set?.('Backdrill both');
    expect(flat(both!)).toContain('(tertiary_drill (size 0.44)');
    const none = row(via, 'Backdrill Mode').set?.('No backdrill');
    expect(flat(none!)).not.toContain('backdrill');
  });

  it('writes no drill node for a slot with no size, as the writer does not', () => {
    // `if( …SecondaryDrill().size.x > 0 )` (pcb_io_kicad_sexpr.cpp:2657): an
    // empty slot is not a backdrill.
    const b = load(SRC);
    const stack = viaStack(b);
    stack.SecondaryDrill().size = { x: 0, y: 0 };
    stack.SecondaryDrill().start = LSET_NameToLayer('B.Cu');
    stack.SecondaryDrill().end = LSET_NameToLayer('In1.Cu');
    expect(flat(b)).not.toContain('backdrill');

    stack.SecondaryDrill().size = { x: MM(0.6), y: MM(0.6) };
    expect(flat(b)).toContain('(backdrill (size 0.6) (layers "B.Cu" "In1.Cu"))');
  });

  it('shows a post-machining measurement only for the mode that has it', () => {
    // Size for either mode, Depth for a counterbore, Angle for a countersink
    // (pad.cpp:3564-3614). A via names them "Front/Back Post-machining
    // Depth/Angle" (pcb_track.cpp:3307-3367); only a pad says "Counterbore
    // Depth" / "Countersink Angle", under Top and Bottom.
    expect(row(via, 'Front Post-machining').value).toBe('Counterbore');
    expect(names(via)).toContain('Front Post-machining Depth');
    expect(names(via)).not.toContain('Front Post-machining Angle');

    expect(row(via, 'Back Post-machining').value).toBe('Countersink');
    expect(names(via)).toContain('Back Post-machining Angle');
    expect(names(via)).not.toContain('Back Post-machining Depth');
  });

  it('keeps the countersink angle in TENTHS of a degree, and writes degrees', () => {
    // `PT_DECIDEGREE`, and the parser's `KiROUND( parseDouble( … ) * 10.0 )`
    // against the writer's `FormatDouble2Str( angle / 10.0 )`.
    expect(viaStack(drilled).BackPostMachining().angle).toBe(900);
    expect(row(via, 'Back Post-machining Angle').value).toBe('90°');

    const wider = row(via, 'Back Post-machining Angle').set?.('120');
    expect(viaStack(wider!).BackPostMachining().angle).toBe(1200);
    expect(flat(wider!)).toContain('(angle 120)');
  });

  it('turns post-machining off by dropping the whole token', () => {
    const off = row(via, 'Front Post-machining').set?.('Not post-machined');
    expect(viaStack(off!).FrontPostMachining().mode).toBe(
      PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED,
    );
    expect(flat(off!)).not.toContain('front_post_machining');
    expect(flat(off!)).toContain('back_post_machining');
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
    const pad1 = LIVE_OF.get(bored!)!.kb.Footprints()[0]!.Pads()[1]!;
    expect(pad1.Padstack().FrontPostMachining().mode).toBe(
      PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE,
    );
    expect(flat(bored!)).toContain('(front_post_machining counterbore)');
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
    expect(via0(on)?.GetTeardropParams().m_Enabled).toBe(true);
    expect(flat(on!)).toContain('(teardrops');

    const curved = row(pad, 'Curved Teardrops').set?.(true);
    expect(padOf(curved, 1)?.GetTeardropParams().m_CurvedEdges).toBe(true);
    expect(flat(curved!)).toContain('(curved_edges yes)');
  });

  it('stores Prefer Zone Connections INVERTED, as the parameter is', () => {
    // `SetTeardropPreferZoneConnections( aPrefer )` is
    // `m_TdOnPadsInZones = !aPrefer` (board_connected_item.h:227-228), and the
    // file token `(prefer_zone_connections …)` is the inverse again.
    const prefer = row(pad, 'Prefer Zone Connections');
    expect(prefer.value).toBe(true);
    const off = prefer.set?.(false);
    expect(padOf(off, 1)?.GetTeardropParams().m_TdOnPadsInZones).toBe(true);
    expect(flat(off!)).toContain('(prefer_zone_connections no)');
  });

  it('offers no teardrop rows at all on a legacy-teardrop board', () => {
    // `supportsTeardrops` opens with `if( !bci->GetBoard() ||
    // bci->GetBoard()->LegacyTeardrops() ) return false` — those boards draw
    // teardrops as zones, so there is nothing per-item to edit.
    // `(legacy_teardrops …)` is a `(general …)` token (parseGeneralSection,
    // pcb_io_kicad_sexpr_parser.cpp:1713); `parseSetup` rejects it.
    const legacy = load(
      SRC.replace('(net 0 "")', '(general (legacy_teardrops yes))\n  (net 0 "")'),
    );
    expect(legacy.LegacyTeardrops()).toBe(true);
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

  // The `set` below refills the zone, and a zone switched to a hatch pattern
  // with its hatch gap still 0 is hatched the way KiCad hatches it: holes one
  // minimum thickness across on a pitch a micron wider, thousands of them.
  it('draws the hatch rows greyed until the fill mode is a hatch pattern', {
    timeout: 60_000,
  }, () => {
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
    const hatched = rowsFor('zone:0', hatchedBoard as BOARD);
    for (const n of hatchRows) expect(row(hatched, n).set, n).toBeTypeOf('function');
    expect(zone0(row(hatched, 'Hatch Width').set?.(MM(0.6)))?.GetHatchThickness()).toBe(MM(0.6));

    // `hatch_min_hole_area` is a plain number the fill node rebuild writes out,
    // and it is the EDITED value, not the one the zone came in with — the node
    // is rebuilt from scratch on every apply, so reading it off the old zone
    // silently discarded this row's edit.
    const ratio = row(hatched, 'Hatch Minimum Hole Ratio').set?.('0.42');
    expect(zone0(ratio)?.GetHatchHoleMinArea()).toBe(0.42);
    expect(flat(ratio!)).toContain('(hatch_min_hole_area 0.42)');
  });

  it('greys Minimum Island Area until Remove Islands is the area mode', () => {
    // `SetWriteableFunc( isAreaBasedIslandRemoval )`.
    expect(row(rows, 'Minimum Island Area').set).toBeUndefined();
    const byArea = row(rows, 'Remove Islands').set?.('Below area limit');
    const area = rowsFor('zone:0', byArea as BOARD);
    expect(row(area, 'Minimum Island Area').set).toBeTypeOf('function');
  });

  it('offers the two ZONE_FILL_MODEs, and the five pad connections', () => {
    expect(row(rows, 'Fill Mode').choices).toEqual(['Solid fill', 'Hatch pattern']);
    // ENUM_MAP<ZONE_CONNECTION> whole, Inherited included (zone.cpp:1927-1938):
    // "Pad Connections" takes no choices function (:2175-2177).
    expect(row(rows, 'Pad Connections').choices).toEqual([
      'Inherited',
      'None',
      'Thermal reliefs',
      'Solid',
      'Thermal reliefs for PTH',
    ]);
  });

  it('commits a priority', () => {
    expect(zone0(row(rows, 'Priority').set?.(7))?.GetAssignedPriority()).toBe(7);
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
    expect(zone0(next)?.GetDoNotAllowVias()).toBe(true);
    expect(flat(next!)).toContain('(vias not_allowed)');
    // The other four are rewritten from the model and must not flip with it.
    expect(flat(next!)).toContain('(tracks not_allowed)');
    expect(flat(next!)).toContain('(copperpour allowed)');
  });

  it('reads and writes the placement source as its own token', () => {
    expect(row(rows, 'Enable').value).toBe(true);
    expect(row(rows, 'Source Type').value).toBe('Component Class');
    expect(row(rows, 'Source Name').value).toBe('PWR');

    const renamed = row(rows, 'Source Name').set?.('GND');
    expect(zone0(renamed)?.GetPlacementAreaSource()).toBe('GND');
    expect(flat(renamed!)).toContain('(component_class "GND")');

    // The source token IS the type, so changing the type moves the name into a
    // different token rather than leaving both.
    const asSheet = row(rows, 'Source Type').set?.('Sheet Name');
    expect(flat(asSheet!)).toContain('(sheetname "PWR")');
    expect(flat(asSheet!)).not.toContain('component_class');
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
    // Margin and the courtyards are enabled on every board whatever its
    // `(layers …)` says: `BOARD_DESIGN_SETTINGS::SetEnabledLayers` "Ensures
    // mandatory layers are always enabled" (board_design_settings.cpp).
    expect(row(rows, 'Layer').choices).toEqual([
      'F.Cu',
      'In1.Cu',
      'In2.Cu',
      'B.Cu',
      'F.Silkscreen',
      'Edge.Cuts',
      'Margin',
      'F.Courtyard',
      'B.Courtyard',
    ]);
    expect(row(rows, 'Layer').swatch).toBe(swatchOf(B, 'F.SilkS'));
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
      // EDA_TEXT's Font (eda_text.cpp:1353-1356): no availability function,
      // so a board text shows it; the view panel left it out.
      'Font',
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
    expect(text0(row(rows, 'Text').set?.('goodbye'))?.GetText()).toBe('goodbye');
  });

  it('writes the justification as the (justify …) words, in EDA_TEXT order', () => {
    // eda_text.cpp:1100-1114: horizontal, then vertical, then mirror, each
    // omitted at its default (CENTER / not mirrored), and the whole token
    // omitted when all three are.
    expect(row(rows, 'Horizontal Justification').value).toBe('Center');
    expect(row(rows, 'Vertical Justification').value).toBe('Center');

    const left = row(rows, 'Horizontal Justification').set?.('Left');
    expect(justify(text0(left))).toEqual([H.GR_TEXT_H_ALIGN_LEFT, V.GR_TEXT_V_ALIGN_CENTER]);
    expect(written(left!)).toContain('(justify left)');

    const bottom = row(rowsFor('text:0', left!), 'Vertical Justification').set?.('Bottom');
    expect(justify(text0(bottom))).toEqual([H.GR_TEXT_H_ALIGN_LEFT, V.GR_TEXT_V_ALIGN_BOTTOM]);
    expect(written(bottom!)).toContain('(justify left bottom)');

    const mirrored = row(rowsFor('text:0', bottom!), 'Mirrored').set?.(true);
    expect(written(mirrored!)).toContain('(justify left bottom mirror)');

    // Back to both defaults: the token goes away rather than reading `(justify)`.
    const back = row(rowsFor('text:0', bottom!), 'Horizontal Justification').set?.('Center');
    const centred = row(rowsFor('text:0', back as BOARD), 'Vertical Justification').set?.('Center');
    expect(justify(text0(centred))).toEqual([H.GR_TEXT_H_ALIGN_CENTER, V.GR_TEXT_V_ALIGN_CENTER]);
    // Scoped to the text's own node: the fixture's text BOX carries a
    // `(justify left top)` of its own.
    expect(writtenText(centred as BOARD)).not.toContain('justify');
  });

  it('makes Auto Thickness a stored thickness of zero, and back', () => {
    // `GetAutoThickness()` is `GetTextThickness() == 0` (eda_text.h:150), and
    // `Format` writes the token only when it is off (eda_text.cpp:1079-1084).
    // The fixture's text has `(thickness 0.15)`, so it starts explicit.
    expect(row(rows, 'Auto Thickness').value).toBe(false);
    expect(row(rows, 'Thickness').value).toBe(MM(0.15));

    const auto = row(rows, 'Auto Thickness').set?.(true);
    expect(text0(auto)?.GetTextThickness()).toBe(0);
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
    expect(text0(explicit)?.GetTextThickness()).toBe(MM(1) / 8);
    expect(writtenText(explicit!)).toContain('(thickness 0.125)');
  });

  it('reads a stored zero as automatic too, not just an absent token', () => {
    // `GetAutoThickness()` is `GetTextThickness() == 0` (eda_text.h:150). A file
    // CAN carry `(thickness 0)` — KiCad reads it as automatic and writes it back
    // without the token, and the view spells automatic as no thickness at all.
    const zero = load(SRC.replace('(thickness 0.15)', '(thickness 0)'));
    expect(text0(zero)?.GetTextThickness()).toBe(0);
    expect(row(rowsFor('text:0', zero), 'Auto Thickness').value).toBe(true);
    expect(written(zero)).not.toContain('(thickness 0)');
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
    // Locked before Layer: PCB_SHAPE's Layer is its own ReplaceProperty of
    // BOARD_CONNECTED_ITEM's (pcb_shape.cpp:979), which the property manager
    // adds to PCB_SHAPE's own list, after the inherited Locked.
    expect(names(line)).toEqual([
      'Locked',
      'Layer',
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
      'Locked',
      'Layer',
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
    expect(shapeN(bigger, 1)?.GetEnd()).toEqual({ x: MM(38), y: MM(30) });
    expect(shapeN(bigger, 1)?.GetCenter()).toEqual({ x: MM(30), y: MM(30) });
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
    expect(shapeN(hatched, 1)?.GetFillMode()).toBe(FILL_T.CROSS_HATCH);
    expect(flat(hatched!)).toContain('(fill cross_hatch)');
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
    expect(shapeN(wider, 4)?.GetStart()).toEqual({ x: MM(0), y: MM(0) });
    expect(shapeN(wider, 4)?.GetEnd()).toEqual({ x: MM(30), y: MM(10) });
  });

  it('shows the SHAPE_T, read-only', () => {
    // `PROPERTY_ENUM<EDA_SHAPE, SHAPE_T>( "Shape", NO_SETTER( EDA_SHAPE,
    // SHAPE_T ), &EDA_SHAPE::GetShape )` (eda_shape.cpp:2886-2887): no setter,
    // so the cell is read-only. The view panel rewrote a segment as a
    // rectangle from here; KiCad cannot.
    expect(row(line, 'Shape').value).toBe('Segment');
    expect(row(line, 'Shape').choices).toEqual([
      'Segment',
      'Rectangle',
      'Arc',
      'Circle',
      'Polygon',
      'Bezier',
    ]);
    expect(row(line, 'Shape').set).toBeUndefined();
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
    expect(shapeN(rounded, 4)?.GetCornerRadius()).toBe(MM(2));
    expect(flat(rounded!)).toContain('(radius 2)');

    // And zero drops the token: the writer emits it only when it is non-zero.
    const square = row(rowsFor('shape:4', rounded as BOARD), 'Corner Radius').set?.(0);
    expect(shapeN(square, 4)?.GetCornerRadius()).toBe(0);
    expect(flat(square!)).not.toContain('radius');
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
    // GND is net 2 on the board (see the pad Net test: AppendNet renumbers).
    expect(shapeN(gnd, 5)?.GetNetCode()).toBe(2);
    expect(shapeN(gnd, 5)?.GetNetname()).toBe('GND');
    expect(flat(gnd!)).toContain('(net "GND")');
  });

  it('offers the Technical Layers group on an external copper layer only', () => {
    // `isExternalCuLayer` (pcb_shape.cpp:1216-1223): a mask opening is a
    // front/back thing, so an inner-layer or silkscreen graphic has no group.
    expect(groupOrder(rowsFor('shape:5'))).toContain('Technical Layers');
    expect(groupOrder(line)).not.toContain('Technical Layers');

    const masked = row(rowsFor('shape:5'), 'Soldermask').set?.(true);
    expect(shapeN(masked, 5)?.HasSolderMask()).toBe(true);
    expect(flat(masked!)).toContain('(layers "F.Cu" "F.Mask")');
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
    expect(shapeN(row(line, 'Line Style').set?.('Dotted'), 0)?.GetLineStyle()).toBe(LINE_STYLE.DOT);
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
    expect(textbox0(off)?.IsBorderEnabled()).toBe(false);
    expect(flat(off!)).toContain('(border no)');

    const margin = row(rows, 'Margin Top').set?.(MM(1.25));
    expect(textbox0(margin)?.GetMarginTop()).toBe(MM(1.25));

    const text = row(rows, 'Text').set?.('rewritten');
    expect(textbox0(text)?.GetText()).toBe('rewritten');
  });

  it('reads its justification, which the fixture sets to left/top', () => {
    expect(row(rows, 'Horizontal Justification').value).toBe('Left');
    expect(row(rows, 'Vertical Justification').value).toBe('Top');
    const centred = row(rows, 'Horizontal Justification').set?.('Center');
    expect(textbox0(centred)?.GetHorizJustify()).toBe(H.GR_TEXT_H_ALIGN_CENTER);
  });
});

describe('TABLE rows', () => {
  const rows = rowsFor('table:0');

  it('lists the border and separator properties in one group', () => {
    // PCB_TABLE_DESC (pcb_table.cpp:884-935) masks nothing it inherits, so
    // BOARD_ITEM's Position X/Y and Layer stay beside its own Start X/Y, and it
    // registers a colour for each stroke. The view panel had trimmed all five.
    expect(names(rows)).toEqual([
      'Position X',
      'Position Y',
      'Layer',
      'Locked',
      'Start X',
      'Start Y',
      'External Border',
      'Header Border',
      'Border Width',
      'Border Style',
      'Border Color',
      'Row Separators',
      'Cell Separators',
      'Separators Width',
      'Separators Style',
      'Separators Color',
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
    expect(table0(header)?.StrokeHeaderSeparator()).toBe(true);
    const width = row(rows, 'Separators Width').set?.(MM(0.3));
    expect(table0(width)?.GetSeparatorsWidth()).toBe(MM(0.3));
  });

  it('moves the table from Start X/Y, which have a setter', () => {
    // `&PCB_TABLE::SetPositionX` (pcb_table.cpp:887-892) — writeable.
    expect(row(rows, 'Start X').value).toBe(MM(0));
    const moved = row(rows, 'Start X').set?.(MM(2));
    expect(table0(moved)?.GetCell(0, 0)?.GetStart().x).toBe(MM(2));
  });
});

describe('REFERENCE IMAGE rows', () => {
  // A 1x1 PNG is enough: the rows are about the scale, and the size follows it.
  const withImage = load(
    SRC.replace(
      '(group "cluster"',
      `(image (at 100 50) (layer "F.SilkS") (scale 2) (uuid "${U.im1}")
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
    expect(row(rows, 'Associated Layer').swatch).toBe(swatchOf(B, 'F.SilkS'));
  });

  it('lists the Image Properties group, with no Greyscale rows', () => {
    // Upstream declares a `Greyscale` group and never adds a property to it, so
    // it draws nothing there either.
    // Associated Layer after Locked: it is PCB_REFERENCE_IMAGE's own
    // ReplaceProperty of BOARD_ITEM's Layer (pcb_reference_image.cpp:436).
    expect(names(rows)).toEqual([
      'Position X',
      'Position Y',
      'Locked',
      'Associated Layer',
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
    expect(image0(doubled)?.GetImageScale()).toBeCloseTo(4);
    const next = rowsFor('image:0', doubled as BOARD);
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
    const image = LIVE_OF.get(moved!)!
      .kb.Drawings()
      .find((d) => 'GetTransformOriginOffsetX' in d) as
      | { GetTransformOriginOffsetX(): number; GetTransformOriginOffsetY(): number }
      | undefined;
    expect(image?.GetTransformOriginOffsetX()).toBe(MM(3));
    expect(image?.GetTransformOriginOffsetY()).toBe(0);
    expect(flat(moved!)).not.toContain('transform');
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
    expect(group0(renamed)?.GetName()).toBe('power');
    expect(flat(renamed!)).toContain('(group "power"');
    // The members are untouched: renaming is not re-grouping.
    expect(new Set([...(group0(renamed)?.GetItems() ?? [])].map((i) => i.m_Uuid))).toEqual(
      new Set([U.gl1, U.gc1]),
    );
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

  it('opens on Basic Properties, then the groups in registration order', () => {
    // Groups are collected derived-first (property_mgr.cpp:319-345), but every
    // CLASS_DESC opens its own list with '' (property_mgr.h:278-283), so Basic
    // Properties leads; then the text group, which the dimension classes reach
    // before their own Dimension Properties.
    expect(groupOrder(ortho)).toEqual(['', 'Text Properties', 'Dimension Properties']);
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

  it('gives a leader no Override Text, and a measured dimension no Text', () => {
    // PCB_DIMENSION_BASE registers a second "Text" (isLeader, :1929-1932) beside
    // EDA_TEXT's, which PCB_DIM_LEADER overrides to unavailable (:2122-2124).
    // Which of the two same-named properties the panel meets first is the
    // property manager's POINTER order upstream — not pinned here.
    expect(names(leader)).not.toContain('Override Text');
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
      row(ortho, 'Keep Aligned with Dimension').set?.(false) as BOARD,
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
    expect(dim0(mm)?.GetUnitsMode()).toBe(DIM_UNITS_MODE.MM);

    const taller = row(ortho, 'Crossbar Height').set?.(MM(20));
    expect((dim0(taller) as PCB_DIM_ALIGNED | undefined)?.GetHeight()).toBe(MM(20));
    expect(flat(taller!)).toContain('(height 20)');
  });
});

describe('the selection rule', () => {
  const panelRows = (ids: string[]) => {
    const ctx = LIVE_OF.get(B)!;
    const panel = new PCB_PROPERTIES_PANEL(ctx.frame);
    const items = ids.map((id) => itemOf(B, id)).filter((i) => i !== null);
    panel.SetSelectionProvider(() => items);
    panel.UpdateData();
    return panel.GridRows({ units: 'mm', iuScale: pcbIUScale });
  };

  it('shows the properties a selection has in common', () => {
    // An empty selection has no rows because `reset()` clears the grid; a
    // mixed one keeps what every type offers (properties_panel.cpp:230-262) —
    // the view panel built none for more than one item.
    expect(panelRows([])).toEqual([]);
    const both = names(panelRows(['track:0', 'via:0']) as PcbPropRow[]);
    expect(both).toContain('Net');
    expect(both).not.toContain('Width');
    expect(panelRows(['track:0']).length).toBeGreaterThan(0);
  });

  it('has no rows for an id it cannot resolve, and does not throw', () => {
    expect(panelRows(['nonsense'])).toEqual([]);
    expect(panelRows(['footprint:99'])).toEqual([]);
  });
});
