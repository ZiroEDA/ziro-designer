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
  kind: 'gr_poly' | 'gr_line' | 'gr_circle' | 'gr_arc' | 'gr_rect';
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
  /** `(pintype …)`: the schematic electrical type (PAD::GetPinType). */
  pinType?: string;
  primitives?: PadPrimitive[];
  uuid?: string;
  source: SList;
}

/** A board or footprint graphic (gr_line/fp_line families), board-absolute. */
export interface PcbShape {
  kind: 'line' | 'arc' | 'circle' | 'rect' | 'poly' | 'curve';
  start?: Vec2;
  end?: Vec2;
  mid?: Vec2;
  center?: Vec2;
  pts?: Vec2[];
  width: number;
  fill: boolean;
  layer: string;
  locked?: boolean;
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
  layers: string[];
  fills: PcbZoneFill[];
  /** The user-drawn zone boundary `(polygon (pts …))`, drawn as the zone border. */
  outline?: Vec2[];
  /** Border display style from `(hatch <style> <pitch>)`: none / edge / full. */
  hatchStyle?: 'none' | 'edge' | 'full';
  /** Border hatch pitch in IU (the `(hatch … <pitch>)` distance). */
  hatchPitch?: number;
  locked?: boolean;
  uuid?: string;
  source: SList;
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
  groups: PcbGroup[];
  fileName?: string;
  source: SList;
}
