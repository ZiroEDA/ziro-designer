// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Typed board model for `.kicad_pcb` files.
 *
 * Mirrors the item set of KiCad's `PCB_IO_KICAD_SEXPR_PARSER`
 * (pcbnew/pcb_io/sexpr/pcb_io_sexpr_parser.cpp). Coordinates are in
 * the same integer internal units as the schematic model (mmToIU), positions of
 * footprint children are stored board-absolute (the parent transform is applied
 * at read time exactly like the parser's legacy-file path: rotate by the
 * footprint orientation about its anchor, then translate, `RebakeFromLib`).
 * Every item keeps its source `SList` for lossless round-tripping.
 */

import type { SList } from '@ziroeda/sexpr/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** One `(N "Name" type [userName])` row of the `(layers …)` table. */
export interface PcbLayerDef {
  id: number;
  name: string;
  kind: string;
  userName?: string;
}

export type PadType = 'thru_hole' | 'smd' | 'connect' | 'np_thru_hole';
export type PadShape = 'circle' | 'rect' | 'oval' | 'trapezoid' | 'roundrect' | 'custom';

/** A drawing primitive of a custom pad, in pad-local coordinates. */
export interface PadPrimitive {
  /**
   * `gr_vector` is not copper: it is a PCB_SHAPE proxy item marking where a
   * thermal spoke should attach to a custom pad (the writer spells a proxy
   * SEGMENT `gr_vector` and a real one `gr_line`).
   */
  kind: 'gr_poly' | 'gr_line' | 'gr_circle' | 'gr_arc' | 'gr_rect' | 'gr_vector';
  pts?: Vec2[];
  start?: Vec2;
  mid?: Vec2;
  end?: Vec2;
  center?: Vec2;
  width: number;
  fill: boolean;
}

export interface PcbPad {
  number: string;
  type: PadType;
  shape: PadShape;
  /** Board-absolute centre (footprint transform applied). */
  at: Vec2;
  /** Degrees; the file value is board-frame absolute (parsePAD comment). */
  angle: number;
  size: Vec2;
  drill?: { oblong: boolean; w: number; h: number; offset?: Vec2 };
  layers: string[];
  roundrectRatio?: number;
  chamferRatio?: number;
  chamfer?: string[];
  delta?: Vec2;
  net?: number;
  /** `(pinfunction …)`: the schematic pin name (PAD::GetPinFunction). */
  pinFunction?: string;
  /**
   * `(property pad_prop_…)`, PAD_PROP. Kept as the file's token: the only
   * consumer so far is the courtyard check, which exempts a heatsink pad.
   */
  padProperty?: string;
  /** `(pintype …)`: the schematic electrical type (PAD::GetPinType). */
  pinType?: string;
  primitives?: PadPrimitive[];
  /**
   * Local overrides, same tokens and same three-valued meaning as a footprint's:
   * absent is "inherit", which is not the same as zero. A pad's value wins over
   * its footprint's, which wins over Board Setup.
   */
  localClearance?: number;
  localSolderMaskMargin?: number;
  localSolderPasteMargin?: number;
  /** `(solder_paste_margin_ratio …)`, a fraction of the pad size, not IU. */
  localSolderPasteMarginRatio?: number;
  /** `(zone_connect N)`, ZONE_CONNECTION for this pad alone. */
  zoneConnection?: 'inherited' | 'none' | 'thermal' | 'full';
  /** `(thermal_bridge_width …)` / `(thermal_gap …)`, IU; this pad's relief. */
  thermalBridgeWidth?: number;
  thermalGap?: number;
  /** `(die_length …)`, PAD::GetPadToDieLength, IU. */
  padToDieLength?: number;
  /** `(teardrops …)`, PAD::GetTeardropParams. Absent means upstream's defaults. */
  teardrops?: TeardropParams;
  /**
   * `(remove_unused_layers …)` + `(keep_end_layers …)`, PADSTACK's
   * UNCONNECTED_LAYER_MODE. Absent means the file said nothing, which reads as
   * `keep_all` but is kept distinct so an untouched pad round-trips unchanged.
   * Only meaningful on a `thru_hole` pad — upstream's writer emits the tokens
   * for PAD_ATTRIB::PTH alone.
   */
  unconnectedLayerMode?: UnconnectedLayerMode;
  uuid?: string;
  source: SList;
}

/**
 * `UNCONNECTED_LAYER_MODE` (pcbnew/padstack.h): what a through-hole pad or via
 * does with a copper layer it is not connected on. The removal is never applied
 * to the stored layer set — it is re-evaluated by `FlashLayer()` every time the
 * item is drawn, filled or plotted, so it tracks the routing.
 *
 * `start_end_only` has no pad spelling in the file format (the pad parser has
 * no token for it), so it can only round-trip on a via.
 */
export type UnconnectedLayerMode =
  /** Copper on every layer of the span, connected or not. KiCad's default. */
  | 'keep_all'
  /** Copper only where connected — outer layers included. */
  | 'remove_all'
  /** Copper where connected, plus the end layers: "Keep outside layers". */
  | 'remove_except_start_and_end'
  /** Copper on the two end layers and nowhere else, connections ignored. */
  | 'start_end_only';

/**
 * `(teardrops …)` on a pad or via: TEARDROP_PARAMETERS, in IU.
 *
 * The engine's own type lives in teardrop.ts; this is the file-format shape,
 * kept here so the reader and writer do not have to depend on the generator.
 */
export interface TeardropParams {
  /** `(enabled …)`. */
  enabled: boolean;
  /** `(allow_two_segments …)`. */
  allowUseTwoTracks: boolean;
  /** The *inverse* of `(prefer_zone_connections …)`, as upstream stores it. */
  tdOnPadsInZones: boolean;
  /** `(best_length_ratio …)`. */
  bestLengthRatio: number;
  /** `(max_length …)`, IU. */
  tdMaxLen: number;
  /** `(best_width_ratio …)`. */
  bestWidthRatio: number;
  /** `(max_width …)`, IU. */
  tdMaxWidth: number;
  /** `(curved_edges …)`, or a non-zero legacy `(curve_points …)`. */
  curvedEdges: boolean;
  /** `(filter_ratio …)`. */
  widthtoSizeFilterRatio: number;
}

/** A board or footprint graphic (gr_line/fp_line families), board-absolute. */
/** `(stroke (type …))`, LINE_STYLE. `default` is the layer's own style. */
export type StrokeType = 'default' | 'solid' | 'dash' | 'dot' | 'dash_dot' | 'dash_dot_dot';

export interface PcbShape {
  kind: 'line' | 'arc' | 'circle' | 'rect' | 'poly' | 'curve';
  start?: Vec2;
  end?: Vec2;
  mid?: Vec2;
  center?: Vec2;
  pts?: Vec2[];
  width: number;
  /** `(stroke (type …))`; absent means the file did not say, i.e. solid. */
  strokeType?: StrokeType;
  fill: boolean;
  layer: string;
  /** `(layers "F.SilkS" "F.Mask")`: a graphic can open the solder mask too. */
  maskLayer?: string;
  /** `(solder_mask_margin …)`, IU. */
  solderMaskMargin?: number;
  locked?: boolean;
  /**
   * `(net …)`: the net a copper graphic belongs to.
   *
   * `PCB_SHAPE` derives from `BOARD_CONNECTED_ITEM`, so a graphic on a copper
   * layer can be part of a net exactly as a track is, and the writer emits one
   * whenever `GetNetCode() > 0` (`pcb_io_kicad_sexpr.cpp:1116`). Dropping it on
   * load lost the connection entirely — the net name did not paint, and nothing
   * that reasons about nets could see the copper.
   *
   * Absent on every graphic that is not on copper, which is nearly all of them.
   */
  net?: number;
  /**
   * The net's name, kept beside the code as `PcbZone` keeps it.
   *
   * `PCB_SHAPE` holds a `NETINFO_ITEM*` and so has both; our model has the code
   * and would otherwise need the board to name it. The writer emits the *name*
   * (`pcb_io_kicad_sexpr.cpp:1116`), and the builder is a pure function of one
   * shape, so without this a newly drawn copper graphic could not be written.
   */
  netName?: string;
  uuid?: string;
  source: SList;
}

/** Footprint property/fp_text or gr_text, board-absolute. */
export interface PcbTextItem {
  kind: 'reference' | 'value' | 'user';
  text: string;
  at: Vec2;
  /** Degrees, board-frame absolute (legacy fp_text semantics). */
  angle: number;
  layer: string;
  size: Vec2;
  thickness?: number;
  bold?: boolean;
  italic?: boolean;
  mirror?: boolean;
  justify?: string[];
  /**
   * Footprint text keeps its rotation in ]-90°, 90°] so it stays readable
   * (PCB_TEXT::GetDrawRotation). True for footprint text unless the file carries
   * an `unlocked` flag; never set for board (gr_text) text.
   */
  keepUpright?: boolean;
  hide?: boolean;
  knockout?: boolean;
  locked?: boolean;
  uuid?: string;
  source: SList;
}

/** A 3D model attached to a footprint, KiCad `(model path (offset)(scale)(rotate))`.
 *  `path` usually starts with an env var like `${KICAD6_3DMODEL_DIR}/...` (the
 *  installed library) or `${KIPRJMOD}/...` (project-local). Offset is in mm,
 *  rotation in degrees per axis (KiCad applies it as -Z, -Y, -X), scale unitless. */
export interface Model3D {
  path: string;
  offset: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotate: { x: number; y: number; z: number };
  hide?: boolean;
  /** 0..1 blend factor (FP_3DMODEL::m_Opacity); undefined = 1 (opaque). */
  opacity?: number;
}

/**
 * A footprint `(property "Name" "Value" …)` that is not Reference or Value,
 * KiCad's user PCB_FIELDs (FOOTPRINT::GetFields minus the mandatory two, which
 * this model carries as `texts`). The netlist updater adds, rewrites and removes
 * these to mirror the symbol's fields.
 */
export interface PcbFootprintField {
  name: string;
  value: string;
  source: SList;
}

/**
 * Property names a footprint may carry that are NOT user fields. Before KiCad's PCB
 * fields (file version < 20230620) these reserved keys stood in for what now have
 * their own tokens, `(sheetname …)`, `(sheetfile …)`, `(descr …)`, `(tags …)`, and
 * `Footprint` duplicated the LIB_ID until V9. `parseFOOTPRINT` consumes them rather
 * than making fields of them, so nothing should present them to the user or compare
 * them against a symbol's fields.
 */
export const RESERVED_FOOTPRINT_PROPERTIES: ReadonlySet<string> = new Set([
  'Sheetname',
  'Sheet name',
  'Sheetfile',
  'Sheet file',
  'ki_description',
  'ki_keywords',
  'ki_locked',
  'ki_fp_filters',
  'Footprint',
]);

export interface PcbFootprint {
  lib: string;
  at: Vec2;
  angle: number;
  /** 'F.Cu' or 'B.Cu'. */
  layer: string;
  reference?: string;
  value?: string;
  /** Library metadata: `(descr …)` and `(tags …)`. */
  descr?: string;
  tags?: string;
  /** `(attr …)` flags (board_only, exclude_from_pos_files, exclude_from_bom, dnp, …). */
  attributes?: string[];
  /**
   * `(net_tie_pad_groups "1,2" "3,4")`, FOOTPRINT::GetNetTiePadGroups: one
   * string per group, each a comma-separated list of pad numbers that are
   * *allowed* to short to one another. A backslash escapes the next character,
   * so a pad genuinely numbered `A,1` can be listed as `A\,1` — which is why
   * the strings are kept raw here and parsed by `mapPadNumbersToNetTieGroups`
   * rather than split on read.
   *
   * `FOOTPRINT::IsNetTie()` is "at least one non-empty string", so
   * `(net_tie_pad_groups "")` describes a footprint that is *not* a net tie.
   */
  netTiePadGroups?: string[];
  /**
   * Local overrides of the Board Setup values, all optional and all in IU
   * except the paste ratio. FOOTPRINT::GetLocalClearance and friends: absent
   * means "use the board value", which is not the same as zero.
   */
  localClearance?: number;
  localSolderMaskMargin?: number;
  localSolderPasteMargin?: number;
  /** `(solder_paste_margin_ratio …)`, a fraction of the pad size, not IU. */
  localSolderPasteMarginRatio?: number;
  /** `(zone_connect N)`, ZONE_CONNECTION: how this footprint's pads meet zones. */
  zoneConnection?: 'inherited' | 'none' | 'thermal' | 'full';
  /** `(locked yes)` on the footprint. */
  locked?: boolean;
  /**
   * `(path "/<sheetUuid>/<symbolUuid>")`, FOOTPRINT::GetPath, the KIID_PATH of
   * the schematic symbol this footprint is linked to. Empty for a footprint with
   * no symbol behind it.
   */
  path?: string;
  /** `(sheetname …)` / `(sheetfile …)`, the symbol's sheet (FOOTPRINT::GetSheetname). */
  sheetname?: string;
  sheetfile?: string;
  /** `(property ki_fp_filters …)`, FOOTPRINT::GetFilters, the symbol's fp filters. */
  filters?: string;
  /** User fields: every `(property …)` other than Reference/Value/ki_fp_filters. */
  fields?: PcbFootprintField[];
  pads: PcbPad[];
  shapes: PcbShape[];
  texts: PcbTextItem[];
  /** 3D model references (rendered by the 3D viewer, resolved to hosted assets). */
  models: Model3D[];
  uuid?: string;
  source: SList;
}

export interface PcbTrack {
  start: Vec2;
  end: Vec2;
  width: number;
  layer: string;
  net: number;
  /**
   * `(layers "F.Cu" "F.Mask")`, PCB_TRACK::SetLayerSet: a track can carry a
   * solder-mask opening alongside its copper layer. `HasSolderMask()` is
   * exactly "the layer set named a mask layer".
   */
  maskLayer?: string;
  /** `(solder_mask_margin …)`, PCB_TRACK::GetLocalSolderMaskMargin, in IU. */
  solderMaskMargin?: number;
  /** `(locked yes)` on the track. */
  locked?: boolean;
  uuid?: string;
  source: SList;
}

export interface PcbArcTrack {
  start: Vec2;
  mid: Vec2;
  end: Vec2;
  width: number;
  layer: string;
  net: number;
  /**
   * `(layers "F.Cu" "F.Mask")`, PCB_TRACK::SetLayerSet: a track can carry a
   * solder-mask opening alongside its copper layer. `HasSolderMask()` is
   * exactly "the layer set named a mask layer".
   */
  maskLayer?: string;
  /** `(solder_mask_margin …)`, PCB_TRACK::GetLocalSolderMaskMargin, in IU. */
  solderMaskMargin?: number;
  locked?: boolean;
  uuid?: string;
  source: SList;
}

export interface PcbVia {
  at: Vec2;
  size: number;
  drill: number;
  layers: [string, string];
  kind: 'through' | 'blind' | 'micro';
  net: number;
  /** `(teardrops …)`, PCB_VIA::GetTeardropParams. */
  teardrops?: TeardropParams;
  /**
   * `(remove_unused_layers …)` / `(keep_end_layers …)` / `(start_end_only …)`,
   * PADSTACK's UNCONNECTED_LAYER_MODE. Absent means the file said nothing,
   * which reads as `keep_all`.
   */
  unconnectedLayerMode?: UnconnectedLayerMode;
  locked?: boolean;
  uuid?: string;
  source: SList;
}

export interface PcbZoneFill {
  layer: string;
  /** Filled polygons; arc segments in the file are tessellated at read time. */
  polys: Vec2[][];
}

export interface PcbZone {
  net: number;
  netName?: string;
  /** `(name "…")`, ZONE::GetZoneName — the handle DRC rules refer to it by. */
  name?: string;
  layers: string[];
  fills: PcbZoneFill[];
  /** The user-drawn zone boundary `(polygon (pts …))`, drawn as the zone border. */
  outline?: Vec2[];
  /** How the fill connects to same-net pads, `(connect_pads [<mode>] …)`:
   *  ZONE_CONNECTION thermal (the default) / full (solid) / no / thruHoleOnly. */
  padConnection?: 'thermal' | 'full' | 'none' | 'thru_hole_only';
  /** `(connect_pads (clearance …))`, the zone's own copper clearance in IU
   *  (ZONE_SETTINGS::m_ZoneClearance, default ZONE_CLEARANCE_MM = 0.5 mm). */
  clearance?: number;
  /** `(min_thickness …)`, ZONE_THICKNESS_MM = 0.25 mm by default. */
  minThickness?: number;
  /** `(fill … (thermal_gap …))`, ZONE_THERMAL_RELIEF_GAP_MM = 0.5 mm. */
  thermalGap?: number;
  /** `(fill … (thermal_bridge_width …))`, ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM. */
  thermalBridgeWidth?: number;
  /** `(fill … (mode …))`, ZONE_FILL_MODE: solid (the default), hatched or thieving. */
  fillMode?: 'solid' | 'hatch' | 'thieving';
  /** `(fill … (thieving …))`, THIEVING_SETTINGS. */
  thieving?: {
    /** Stamp shape: dots (the default), squares, or a crosshatch of lines. */
    pattern: 'dots' | 'squares' | 'hatch';
    /** Diameter (dots) or side length (squares), in IU. */
    elementSize: number;
    /** Edge-to-edge spacing between stamps, or between crosshatch lines. */
    gap: number;
    /** Line width, crosshatch only. */
    lineWidth: number;
    /** Offset alternating rows by half the stride. */
    stagger: boolean;
    /** Pattern rotation in degrees. */
    orientation: number;
  };
  /** `(fill … (hatch_thickness …))`, the width of the hatch webbing in IU. */
  hatchThickness?: number;
  /** `(fill … (hatch_gap …))`, the opening between webs in IU. */
  hatchGap?: number;
  /** `(fill … (hatch_orientation …))`, the grid's rotation in degrees. */
  hatchOrientation?: number;
  /** `(fill … (hatch_smoothing_level …))`: 0 none, 1 chamfer, 2+ fillet. */
  hatchSmoothingLevel?: number;
  /** `(fill … (hatch_smoothing_value …))`, 0..1 of half the gap. */
  hatchSmoothingValue?: number;
  /** `(fill … (hatch_min_hole_area …))`, as a fraction of a full grid hole. */
  hatchHoleMinArea?: number;
  /** `(fill … (smoothing chamfer|fillet))`, ZONE_SETTINGS::m_cornerSmoothingType. */
  cornerSmoothing?: 'none' | 'chamfer' | 'fillet';
  /** `(fill … (radius …))`, the chamfer distance / fillet radius in IU. */
  cornerRadius?: number;
  /** `(fill yes)` — whether the zone is set to be poured at all. */
  filled?: boolean;
  /**
   * `(fill … (island_removal_mode N))`, ISLAND_REMOVAL_MODE: what to do with a
   * filled island that reaches nothing on the net. 0 always, 1 never, 2 below
   * an area limit.
   */
  islandRemovalMode?: 'always' | 'never' | 'area';
  /** `(fill … (island_area_min …))` in mm², the limit for the `area` mode. */
  islandAreaMin?: number;
  /** `(priority …)`: a higher-priority zone knocks lower ones out of its area. */
  priority?: number;
  /**
   * ZONE_BORDER_DISPLAY_STYLE, from `(hatch <style> <pitch>)`.
   *
   * `invisible` is INVISIBLE_BORDER — no border drawn at all, which the
   * teardrop generator sets. The file format has no token for it (upstream's
   * writer falls through to `none`), so it survives a save only because the
   * reader restores it for teardrop zones.
   */
  hatchStyle?: 'none' | 'edge' | 'full' | 'invisible';
  /** Border hatch pitch in IU (the `(hatch … <pitch>)` distance). */
  hatchPitch?: number;
  /**
   * `(teardrop (type padvia|track_end) …)`: ZONE::GetTeardropAreaType. A zone
   * carrying this is generated copper, not a user zone — the zone filler leaves
   * it alone and the teardrop generator owns its lifetime.
   */
  teardropType?: 'viapad' | 'trackend';
  /**
   * `(keepout …)` — ZONE::GetIsRuleArea. Present means this is a rule area, not
   * a copper zone: it is never poured, it carries no net, and it forbids
   * whatever its flags name.
   *
   * Each flag is *do not allow*, spelled as ZONE::GetDoNotAllow… rather than
   * as the file's `allowed`/`not_allowed`, so `true` always means "forbidden"
   * and the sense cannot be read backwards.
   */
  ruleArea?: RuleAreaKeepout;
  /**
   * `(placement …)` — the *placement* half of a rule area, which restricts
   * where the footprints of one schematic sheet / component class / group may
   * sit. Upstream's parser calls `SetIsRuleArea( true )` from this token too,
   * so a zone carrying only `(placement …)` and no `(keepout …)` is still a
   * rule area; `ruleArea` is therefore never absent while this is present.
   */
  placementArea?: ZonePlacementArea;
  locked?: boolean;
  uuid?: string;
  source: SList;
}

/** `(keepout (tracks …) (vias …) (pads …) (copperpour …) (footprints …))`. */
export interface RuleAreaKeepout {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  /** `copperpour`, ZONE::GetDoNotAllowZoneFills. */
  copperPour: boolean;
  footprints: boolean;
}

/**
 * PLACEMENT_SOURCE_T, minus `DESIGN_BLOCK`: that member exists only for the
 * multichannel tool's in-flight rule areas, has no file token, and upstream's
 * writer explicitly emits nothing for it — a saved zone can never carry it.
 */
export type PlacementSourceType = 'sheetname' | 'component_class' | 'group';

/**
 * `(placement (enabled yes|no) (sheetname|component_class|group "…"))`.
 *
 * `sourceType` and `source` are written even when `enabled` is false, because
 * upstream stores the last-chosen source so re-enabling the rule area does not
 * lose it.
 */
export interface ZonePlacementArea {
  enabled: boolean;
  sourceType: PlacementSourceType;
  source: string;
}

/**
 * A `(group "name" (uuid …) [(locked yes)] (members "uuid"…))`, PCB_GROUP.
 * Members reference other board items by their uuid.
 */
export interface PcbGroup {
  name: string;
  uuid?: string;
  locked?: boolean;
  members: string[];
  source: SList;
}

/**
 * A reference image, KiCad `(image (at …) … (data …))`.
 * Counterpart: `PCB_REFERENCE_IMAGE` and its `REFERENCE_IMAGE`
 * (pcbnew/pcb_reference_image.h).
 *
 * A drawing dropped on the board to trace over — a datasheet outline, a
 * mechanical drawing — not something that is fabricated.
 *
 * `data` is the PNG as base64. The file splits it across many quoted strings at
 * the MIME width of 76 characters, which is a transport detail: the model holds
 * the joined string and the writer re-splits it.
 *
 * `scale` is **absent when it is 1**, because the serializer writes it only
 * when it differs. Storing 1 and writing it back would add a token KiCad never
 * produces.
 */
export interface PcbImage {
  at: Vec2;
  layer: string;
  /** `(scale …)`; absent means 1. */
  scale?: number;
  locked?: boolean;
  /** The PNG, base64-encoded, with the file's line splits joined out. */
  data: string;
  uuid?: string;
  source: SList;
}

/**
 * One cell of a table, KiCad `(table_cell "…" …)`.
 * Counterpart: `PCB_TABLECELL`, which *is* a `PCB_TEXTBOX` — upstream
 * serialises a cell by calling `format(static_cast<PCB_TEXTBOX*>(cell))`.
 *
 * So a cell carries everything a text box does, plus `(span cols rows)`. Two
 * things the shared serializer withholds from a cell: `(border …)` and its
 * `(stroke …)`, because a cell does not draw its own border — the table's
 * `(border …)` and `(separators …)` draw all the lines.
 */
export interface PcbTableCell extends PcbTextBox {
  /** `(span cols rows)`; 1x1 unless the cell was merged with its neighbours. */
  colSpan: number;
  rowSpan: number;
}

/**
 * A table, KiCad `(table …)`.
 * Counterpart: `PCB_TABLE` (pcbnew/pcb_table.h).
 *
 * The cells are a flat list in row-major order; `columnCount` is what turns it
 * back into a grid, and the row count is implied by the two together.
 *
 * `border` and `separators` each carry two flags and a stroke, and **the stroke
 * is only written when at least one of that pair's flags is set** — a table with
 * both border flags off has no border stroke in the file at all, so the width
 * has to survive as a model default rather than being read back from nothing.
 */
export interface PcbTable {
  columnCount: number;
  layer: string;
  uuid?: string;
  locked?: boolean;
  /** `(border (external …) (header …) [(stroke …)])`. */
  borderExternal: boolean;
  borderHeader: boolean;
  borderWidth?: number;
  borderStyle?: StrokeType;
  /** `(separators (rows …) (cols …) [(stroke …)])`. */
  separatorRows: boolean;
  separatorCols: boolean;
  separatorWidth?: number;
  separatorStyle?: StrokeType;
  columnWidths: number[];
  rowHeights: number[];
  cells: PcbTableCell[];
  source: SList;
}

/**
 * A text box, KiCad `(gr_text_box "…" …)`.
/**
 * A text box, KiCad `(gr_text_box "…" …)`.
 * Counterpart: `PCB_TEXTBOX` (pcbnew/pcb_textbox.h), which is an `EDA_SHAPE`
 * and an `EDA_TEXT` at once — a rectangle that wraps text inside itself.
 *
 * The box is normally a rectangle given by two corners. A **non-cardinal
 * rotation turns it into a polygon**, exactly as it does for `gr_rect`: the
 * serializer switches on `GetLibraryShape()` and writes `(pts …)` instead of
 * `(start …) (end …)`. So both forms have to round-trip, and which one is
 * present is the shape, not a detail.
 *
 * `margins` is the padding between the border and the wrapped text, in the
 * order the file writes it: left, top, right, bottom.
 */
export interface PcbTextBox {
  text: string;
  /** Rectangle form: two opposite corners. Absent when the box is a polygon. */
  start?: Vec2;
  end?: Vec2;
  /** Polygon form, from a non-cardinal rotation. Absent when it is a rectangle. */
  pts?: Vec2[];
  margins: { left: number; top: number; right: number; bottom: number };
  /** `(angle …)` in degrees; absent (not zero) when the box is upright. */
  angle?: number;
  layer: string;
  uuid?: string;
  locked?: boolean;
  // --- EDA_TEXT::Format ---
  size: Vec2;
  thickness?: number;
  bold?: boolean;
  italic?: boolean;
  justify?: string[];
  /** `(border yes|no)`: whether the rectangle itself is drawn. */
  border: boolean;
  strokeWidth?: number;
  strokeType?: StrokeType;
  knockout?: boolean;
  source: SList;
}

/**
 * The five dimension kinds. Counterpart: the `PCB_DIM_*` classes in
 * `pcbnew/pcb_dimension.h`.
 *
 * Upstream's `PCB_DIM_ORTHOGONAL` *derives from* `PCB_DIM_ALIGNED`, which is why
 * the serializer tests for it first and why an orthogonal dimension still writes
 * every aligned-only field. Here the kind is one explicit tag instead of a class
 * hierarchy, so `isAlignedKind` stands in for that `dynamic_cast`.
 */
export type DimensionKind = 'aligned' | 'orthogonal' | 'leader' | 'center' | 'radial';

/** True where upstream's `dynamic_cast<PCB_DIM_ALIGNED*>` would succeed. */
export const isAlignedKind = (k: DimensionKind): boolean => k === 'aligned' || k === 'orthogonal';

/** `DIM_UNITS_MODE`: 0 inch, 1 mils, 2 mm, 3 automatic. */
export type DimUnitsMode = 0 | 1 | 2 | 3;
/** `DIM_UNITS_FORMAT`: 0 none, 1 bare suffix, 2 parenthesised suffix. */
export type DimUnitsFormat = 0 | 1 | 2;
/** `DIM_PRECISION`: 0-5 fixed digits, 6-9 the scaled `V_*` variants. */
export type DimPrecision = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** `DIM_TEXT_POSITION`: 0 outside, 1 inline, 2 manual. */
export type DimTextPosition = 0 | 1 | 2;
/** `DIM_TEXT_BORDER`: 0 none, 1 rectangle, 2 circle, 3 round rectangle. */
export type DimTextBorder = 0 | 1 | 2 | 3;

/** `(format …)`. Absent on a centre dimension, which measures nothing. */
export interface DimensionFormat {
  prefix: string;
  suffix: string;
  units: DimUnitsMode;
  unitsFormat: DimUnitsFormat;
  precision: DimPrecision;
  /** `(override_value …)`, written only when the override is enabled. */
  overrideValue?: string;
  suppressZeroes?: boolean;
}

/** `(style …)`. Which members are written depends on the kind. */
export interface DimensionStyle {
  thickness: number;
  arrowLength: number;
  textPositionMode: DimTextPosition;
  /** Aligned and orthogonal only. */
  arrowDirection?: 'inward' | 'outward';
  /** Aligned and orthogonal only (ortho derives from aligned). */
  extensionHeight?: number;
  /** Leader only. */
  textFrame?: DimTextBorder;
  extensionOffset: number;
  keepTextAligned?: boolean;
}

/**
 * A dimension, KiCad `(dimension (type …) …)`.
 * Counterpart: `PCB_DIMENSION_BASE` and its five subclasses.
 *
 * `start`/`end` are the *feature points* — what is being measured — not where
 * the drawn lines go; the crossbar and extension lines are derived from these
 * plus the style. A centre dimension carries neither a `format` nor text.
 */
export interface PcbDimension {
  kind: DimensionKind;
  layer: string;
  locked?: boolean;
  uuid?: string;
  start: Vec2;
  end: Vec2;
  /** `(height …)`, aligned and orthogonal: crossbar distance from the feature line. */
  height?: number;
  /** `(leader_length …)`, radial only. */
  leaderLength?: number;
  /** `(orientation …)`, orthogonal only: 0 horizontal, 1 vertical. */
  orientation?: number;
  format?: DimensionFormat;
  style: DimensionStyle;
  /** The `(gr_text …)` child. Absent on a centre dimension. */
  text?: PcbTextItem;
  source: SList;
}

export interface Board {
  version: number;
  thickness?: number;
  paper?: string;
  titleBlock?: {
    title?: string;
    date?: string;
    rev?: string;
    company?: string;
    /** `(comment N "text")` lines, index 0 = comment 1. */
    comments?: string[];
  };
  layers: PcbLayerDef[];
  /** net code -> name, from the top-level `(net N "name")` declarations. */
  nets: Map<number, string>;
  footprints: PcbFootprint[];
  tracks: PcbTrack[];
  arcs: PcbArcTrack[];
  vias: PcbVia[];
  zones: PcbZone[];
  shapes: PcbShape[];
  texts: PcbTextItem[];
  textBoxes: PcbTextBox[];
  tables: PcbTable[];
  images: PcbImage[];
  dimensions: PcbDimension[];
  groups: PcbGroup[];
  fileName?: string;
  source: SList;
}
