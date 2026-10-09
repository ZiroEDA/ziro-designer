// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_ADAPTER::createLayers` (3d-viewer/3d_canvas/create_layer_items.cpp)
 * and the board/hole polygons `RENDER_3D_OPENGL::reload` derives from it
 * (3d_rendering/opengl/create_scene.cpp:688) — every layer of the 3D board
 * as a `SHAPE_POLY_SET`, in board IU.
 *
 * Upstream builds each layer twice: a BVH of 2D objects for the ray tracer
 * and for the OpenGL top/bottom faces, and a `SHAPE_POLY_SET` (the union of
 * the same items, `Simplify()`'d) for the vertical walls. The renderer then
 * subtracts the holes and clips to the board at draw time with the stencil
 * buffer (`OPENGL_RENDER_LIST::DrawCulled`). The pixels are the union minus
 * the holes, inside the board; that is what this module computes ONCE as
 * polygons, on the same `TransformShapeToPolygon` ports and the same Clipper
 * the rest of pcbnew runs on. The ray tracer's per-object list is not needed
 * for a rasteriser.
 *
 * Coordinates stay in KiCad's frame (IU, y down). `pcb3d.ts` scales into
 * 3D units and flips y, as `BiuTo3dUnits()` / `-pos.y` do upstream.
 */
import { ARC_HIGH_DEF } from '@ziroeda/common/eda_units.js';
import {
  type Polygon,
  booleanAdd,
  booleanSubtract,
  booleanIntersection,
  simplify,
} from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

/** A SHAPE_POLY_SET as outline-plus-holes polygons, in the same IU. */
function polySetToPolygons(set: SHAPE_POLY_SET): Polygon[] {
  const out: Polygon[] = [];
  for (let i = 0; i < set.OutlineCount(); i++) {
    const poly: Vec2[][] = [
      set
        .COutline(i)
        .CPoints()
        .map((p) => ({ x: p.x, y: p.y })),
    ];
    for (let h = 0; h < set.HoleCount(i); h++)
      poly.push(
        set
          .CHole(i, h)
          .CPoints()
          .map((p) => ({ x: p.x, y: p.y })),
      );
    out.push(poly);
  }
  return out;
}
import {
  TransformCircleToPolygon,
  TransformOvalToPolygon,
  TransformRingToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LSET } from '@ziroeda/common/lset.js';
import { IsSolderMaskLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { LAYER_CLASS } from '@ziroeda/pcbnew/board_design_settings.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB, PAD_SHAPE } from '@ziroeda/pcbnew/padstack.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { PCB_TABLE } from '@ziroeda/pcbnew/pcb_table.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import type { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import { type PCB_VIA, VIATYPE } from '@ziroeda/pcbnew/pcb_track.js';
import {
  B_Adhes,
  B_Cu,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  B_CrtYd,
  B_Fab,
  Edge_Cuts,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  In_Cu,
  IsCopperLayer,
  Margin,
  PCB_LAYER_ID_COUNT,
  Rescue,
  User_1,
} from '@ziroeda/common/layer_ids.js';

/** An axis-aligned box in board IU. */
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The PCB_LAYER_IDs the 3D viewer builds (`techLayerList`). */
export type Layer3d =
  | `User.${number}`
  | 'F.Cu'
  | 'B.Cu'
  | 'F.Mask'
  | 'B.Mask'
  | 'F.SilkS'
  | 'B.SilkS'
  | 'F.Paste'
  | 'B.Paste'
  | 'F.Adhes'
  | 'B.Adhes'
  | 'Dwgs.User'
  | 'Cmts.User'
  | 'Eco1.User'
  | 'Eco2.User';

export const LAYERS_3D: readonly Layer3d[] = [
  'F.Cu',
  'B.Cu',
  'F.Mask',
  'B.Mask',
  'F.SilkS',
  'B.SilkS',
  'F.Paste',
  'B.Paste',
  'F.Adhes',
  'B.Adhes',
  'Dwgs.User',
  'Cmts.User',
  'Eco1.User',
  'Eco2.User',
  // User_1 .. User_45 (LAYER_3D_USER_1 .. LAYER_3D_USER_45)
  ...Array.from({ length: 45 }, (_, i) => `User.${i + 1}` as const),
];

/** `User.N`'s index, 1..45, or 0 for any other layer. */
export const userLayerIndex = (l: string): number => {
  const m = /^User\.(\d+)$/.exec(l);
  return m ? Number(m[1]) : 0;
};

/** The PCB_LAYER_ID of each 3D layer (layer_ids.h). */
const NAMED_LAYER_ID: Record<string, number> = {
  'F.Cu': F_Cu,
  'B.Cu': B_Cu,
  'F.Mask': F_Mask,
  'B.Mask': B_Mask,
  'F.SilkS': F_SilkS,
  'B.SilkS': B_SilkS,
  'F.Paste': F_Paste,
  'B.Paste': B_Paste,
  'F.Adhes': F_Adhes,
  'B.Adhes': B_Adhes,
  'Dwgs.User': Dwgs_User,
  'Cmts.User': Cmts_User,
  'Eco1.User': Eco1_User,
  'Eco2.User': Eco2_User,
};
/** `Map3DLayerToPCBLayer`: User_N is `User_1 + 2(N − 1)` — the odd ids after Rescue. */
const layerId = (l: Layer3d): number => {
  const u = userLayerIndex(l);
  return u ? User_1 + 2 * (u - 1) : NAMED_LAYER_ID[l]!;
};
/** The PCB_LAYER_ID of a canonical layer name the 3D viewer knows, or -1. */
export function pcbLayerIdOf(name: string): number {
  const u = userLayerIndex(name);
  if (u) return User_1 + 2 * (u - 1);
  return NAMED_LAYER_ID[name] ?? -1;
}

/**
 * `PCB_PLOT_PARAMS` as the 3D viewer's FOLLOW_PLOT_SETTINGS preset reads it
 * (`BOARD_ADAPTER::GetVisibleLayers`, board_adapter.cpp:907-935): the
 * `layerselection` set plus the plot-on-all-layers set, and the three
 * footprint text flags.
 */
export interface PlotLayerSelection {
  /** PCB_LAYER_IDs in `(layerselection …)` ∪ `(plotonalllayersselection …)`. */
  layers: Set<number>;
  plotReference: boolean;
  plotValue: boolean;
  plotFPText: boolean;
}

/**
 * `BASE_SET::ParseHex` (base_set.h:362): the string is read from its END,
 * one nibble = four layer ids, `_` separators skipped.
 */
export function parseLayerSetHex(hex: string): Set<number> {
  const out = new Set<number>();
  let nibbleNdx = 0;
  for (let i = hex.length - 1; i >= 0; i--) {
    const cc = hex[i]!;
    if (cc === '_') continue;
    const nibble = parseInt(cc, 16);
    if (Number.isNaN(nibble)) break;
    let bit = nibbleNdx * 4;
    for (let ndx = 0; bit < PCB_LAYER_ID_COUNT && ndx < 4; ++bit, ++ndx)
      if (nibble & (1 << ndx)) out.add(bit);
    if (bit >= PCB_LAYER_ID_COUNT) break;
    ++nibbleNdx;
  }
  return out;
}

/**
 * `s_legacyLayerIdMap` (pcb_plot_params.cpp:475): the file's layer NUMBERING
 * changed in 5e0abadb without a version bump, so a `layerselection` written
 * by a board older than 20240819 is in `LEGACY_PCB_LAYER_ID` order —
 * F_Cu 0, In1..In30 1..30, B_Cu 31, then B/F Adhes, B/F Paste, B/F SilkS,
 * B/F Mask (32..39), Dwgs, Cmts, Eco1, Eco2, Edge, Margin (40..45), B/F
 * CrtYd, B/F Fab (46..49), User_1..9 (50..58), Rescue 59. Read unmapped, a
 * KiCad 8 board's silk bit (36) lands on F_Fab and its silk vanishes.
 */
export function remapLegacyLayerSet(legacy: Set<number>): Set<number> {
  const map = new Map<number, number>();
  map.set(0, F_Cu);
  for (let n = 1; n <= 30; n++) map.set(n, In_Cu(n));
  map.set(31, B_Cu);
  const tail = [B_Adhes, F_Adhes, B_Paste, F_Paste, B_SilkS, F_SilkS, B_Mask, F_Mask];
  tail.forEach((id, i) => map.set(32 + i, id));
  const users = [Dwgs_User, Cmts_User, Eco1_User, Eco2_User, Edge_Cuts, Margin];
  users.forEach((id, i) => map.set(40 + i, id));
  [B_CrtYd, F_CrtYd, B_Fab, F_Fab].forEach((id, i) => map.set(46 + i, id));
  // User_n == User_1 + 2(n − 1) — the odd ids after Rescue
  for (let n = 1; n <= 9; n++) map.set(49 + n, User_1 + 2 * (n - 1));
  map.set(59, Rescue);
  const out = new Set<number>();
  for (const [legacyId, newId] of map) if (legacy.has(legacyId)) out.add(newId);
  return out;
}

/** The board file version the new numbering arrived with (pcb_plot_params.cpp:622). */
export const LAYER_RENUMBER_VERSION = 20240819;

/** `PCB_PLOT_PARAMS::PCB_PLOT_PARAMS()`: the layer set a board without one plots. */
export function defaultPlotLayerSelection(): Set<number> {
  const out = new Set<number>([F_SilkS, B_SilkS, F_Mask, B_Mask, F_Paste, B_Paste, Edge_Cuts]);
  for (let id = 0; id < PCB_LAYER_ID_COUNT; id++) if (IsCopperLayer(id)) out.add(id);
  return out;
}

export function plotLayerSelection(aBoard: BOARD): PlotLayerSelection {
  const p = aBoard.GetPlotOptions();
  const layers = new Set(p.GetLayerSelection().Seq());
  for (const id of p.GetPlotOnAllLayersSequence()) layers.add(id);
  // `m_plotReference` / `m_plotValue` / `m_plotFPText` are not board-file
  // tokens in 10.0.5 (`PCB_PLOT_PARAMS::Parse` has no case for them), so a
  // loaded board holds the constructor's `true` for all three.
  return { layers, plotReference: true, plotValue: true, plotFPText: true };
}

export const isBackLayer = (l: string): boolean => l.startsWith('B.');
export const isCopperLayer3d = (l: string): boolean => l === 'F.Cu' || l === 'B.Cu';
export const isSilkLayer = (l: string): boolean => l === 'F.SilkS' || l === 'B.SilkS';
export const isMaskLayer = (l: string): boolean => l === 'F.Mask' || l === 'B.Mask';
export const isPasteLayer = (l: string): boolean => l === 'F.Paste' || l === 'B.Paste';

/** The `EDA_3D_VIEWER_SETTINGS::RENDER_SETTINGS` bits `createLayers` reads. */
export interface Layer3dOptions {
  /**
   * The board has NOTHING on it — `BOARD_ADAPTER::createBoardPolygon` on a
   * footprint holder with no footprint returns false before any outline is
   * tried (board_adapter.cpp:1003-1010), so `m_board_poly` stays empty and no
   * board body is drawn. With this set the bbox fallback rectangle is NOT
   * used; the rectangle is `buildBoardBoundingBoxPoly`'s answer for a board
   * that HAS items and no closed outline.
   */
  empty?: boolean;
  /** `show_zones` (default true). */
  showZones?: boolean;
  /** `show_fp_references` / `show_fp_values` / `show_fp_text` (all default true). */
  showFpReferences?: boolean;
  showFpValues?: boolean;
  showFpText?: boolean;
  /** `opengl_show_off_board_silk` (default false): silk is clipped to the board. */
  showOffBoardSilk?: boolean;
  /** `subtract_mask_from_silk` (default false). */
  subtractMaskFromSilk?: boolean;
  /** `clip_silk_on_via_annulus` (default false): silk is clipped on the via annulus, not just the hole. */
  clipSilkOnViaAnnuli?: boolean;
  /**
   * `plated_and_bare_copper` (`DifferentiatePlatedCopper()`, default false):
   * the copper exposed through the mask is "plated" and drawn in the finish
   * colour; the rest is raw copper.
   */
  differentiatePlatedCopper?: boolean;
  /** `show_plated_barrels` (default true). */
  showPlatedBarrels?: boolean;
  /** `ADVANCED_CFG::m_HoleWallThickness` (0.020 mm): the barrel's plating, IU. */
  holePlatingThickness?: number;
  /** `BOARD_DESIGN_SETTINGS::m_MaxError` (ARC_HIGH_DEF). */
  maxError?: number;
  /**
   * `Is3dLayerEnabled( layer, visibilityFlags )`: the PCB_LAYER_IDs the
   * preset shows. A layer not in the set is not built. Omitted = every layer.
   */
  visibleLayers?: Set<number>;
  /** `createLayers( REPORTER* aStatusReporter )`: the stage names it reports. */
  report?: (text: string) => void;
}

export interface Board3dLayers {
  /** Per layer, the union of every item on it, already minus the holes and clipped to the board. */
  layers: Partial<Record<Layer3d, Polygon[]>>;
  /** `GetBoardPoly()`: the Edge.Cuts outline with its cutouts. */
  boardPoly: Polygon[];
  /** `m_boardWithHoles`: the body, minus plated and non-plated drills. */
  boardWithHoles: Polygon[];
  /** `GetTH_ODPolys()`: plated drills grown by the plating (what the copper is cut by). */
  thOD: Polygon[];
  /** `GetTH_IDPolys()`: the plated drills themselves. */
  thID: Polygon[];
  /** `GetNPTH_ODPolys()`: the non-plated drills. */
  npthOD: Polygon[];
  /** `GetViaAnnuliPolys()`: the through-via annuli (`clip_silk_on_via_annulus`). */
  viaAnnuli: Polygon[];
  /** `generatePlatedHoleShells`: the copper ring between drill and drill+plating, inside the board. */
  platedBarrels: Polygon[];
  /** The mask the silk is subtracted by when `subtract_mask_from_silk` is on (the mask layer's OPENINGS). */
  maskOpenings: { 'F.Mask': Polygon[]; 'B.Mask': Polygon[] };
  /** `m_boardPos` / `m_boardSize`: the bbox the 3D units are derived from, IU. */
  bbox: Box;
  /**
   * `generateViaBarrels`: every via that is not a plain through via — blind
   * and micro vias — as the cylinder between its two end layers, drill/2
   * inside and plating outside. Its hole is already cut from the copper of
   * the layers it spans (`m_outerLayerHoles[layer]`).
   */
  viaBarrels: { at: Vec2; drill: number; topLayer: string; bottomLayer: string }[];
  /**
   * `m_platedPadsFront/Back` when `DifferentiatePlatedCopper()`: the copper
   * under the mask openings, already taken out of `layers['F.Cu'/'B.Cu']`.
   * Empty otherwise.
   */
  platedCopper: { 'F.Cu': Polygon[]; 'B.Cu': Polygon[] };
}

/** `ADVANCED_CFG::m_HoleWallThickness`, 0.020 mm, in IU. */
export const DEFAULT_HOLE_PLATING_THICKNESS = 20000;

/** A SHAPE_POLY_SET as the polygons the rest of this module unions and cuts. */
function polysOf(aSet: SHAPE_POLY_SET): Polygon[] {
  return polySetToPolygons(aSet);
}

/** `textbox->PCB_SHAPE::TransformShapeToPolygon( … )`: the box, not the text's bounds. */
function textboxBorderToPolygon(
  aTextbox: PCB_TEXTBOX,
  aBuffer: SHAPE_POLY_SET,
  aLayer: PCB_LAYER_ID,
  aMaxError: number,
  aErrorLoc: ERROR_LOC,
): void {
  const base = PCB_SHAPE.prototype.TransformShapeToPolygon as (
    this: PCB_SHAPE,
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
  ) => void;
  base.call(aTextbox, aBuffer, aLayer, 0, aMaxError, aErrorLoc);
}

/** `transformFPShapesToPolySet` (create_layer_items.cpp:80-118). */
function transformFPShapesToPolySet(
  aFootprint: FOOTPRINT,
  aLayer: PCB_LAYER_ID,
  aBuffer: SHAPE_POLY_SET,
  aMaxError: number,
  aErrorLoc: ERROR_LOC,
): void {
  for (const item of aFootprint.GraphicalItems()) {
    if (!item.IsOnLayer(aLayer)) continue;

    switch (item.Type()) {
      case KICAD_T.PCB_SHAPE_T: {
        const shape = item as PCB_SHAPE;
        let margin = 0;

        if (IsSolderMaskLayer(aLayer) && shape.HasSolderMask())
          margin = shape.GetSolderMaskExpansion();

        item.TransformShapeToPolySet(aBuffer, aLayer, margin, aMaxError, aErrorLoc);
        break;
      }

      case KICAD_T.PCB_BARCODE_T:
      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        item.TransformShapeToPolySet(aBuffer, aLayer, 0, aMaxError, aErrorLoc);
        break;

      default:
        break;
    }
  }
}

/** The `LAYER_FP_TEXT` / `LAYER_FP_REFERENCES` / `LAYER_FP_VALUES` flags. */
interface FP_TEXT_FLAGS {
  fpText: boolean;
  references: boolean;
  values: boolean;
}

/** `transformFPTextToPolySet` (create_layer_items.cpp:121-176). */
function transformFPTextToPolySet(
  aFootprint: FOOTPRINT,
  aLayer: PCB_LAYER_ID,
  aFlags: FP_TEXT_FLAGS,
  aBuffer: SHAPE_POLY_SET,
  aMaxError: number,
  aErrorLoc: ERROR_LOC,
): void {
  for (const item of aFootprint.GraphicalItems()) {
    if (item.Type() === KICAD_T.PCB_TEXT_T) {
      const text = item as PCB_TEXT;

      if (!aFlags.fpText) continue;

      if (text.GetText() === '${REFERENCE}' && !aFlags.references) continue;

      if (text.GetText() === '${VALUE}' && !aFlags.values) continue;

      if (text.IsOnLayer(aLayer)) text.TransformTextToPolySet(aBuffer, 0, aMaxError, aErrorLoc);
    }

    if (item.Type() === KICAD_T.PCB_TEXTBOX_T) {
      const textbox = item as PCB_TEXTBOX;

      if (textbox.IsOnLayer(aLayer)) {
        // border
        if (textbox.IsBorderEnabled())
          textboxBorderToPolygon(textbox, aBuffer, aLayer, aMaxError, aErrorLoc);

        // text
        textbox.TransformTextToPolySet(aBuffer, 0, aMaxError, aErrorLoc);
      }
    }
  }

  for (const field of aFootprint.GetFields()) {
    if (!aFlags.fpText) continue;

    if (!field) continue;

    if (field.IsReference() && !aFlags.references) continue;

    if (field.IsValue() && !aFlags.values) continue;

    if (field.IsOnLayer(aLayer) && field.IsVisible())
      field.TransformTextToPolySet(aBuffer, 0, aMaxError, aErrorLoc);
  }
}

/** `buildPadOutlineAsPolygon` (create_layer_items.cpp:56-77). */
function buildPadOutlineAsPolygon(
  aPad: PAD,
  aLayer: PCB_LAYER_ID,
  aBuffer: SHAPE_POLY_SET,
  aWidth: number,
  aMaxError: number,
  aErrorLoc: ERROR_LOC,
): void {
  if (aPad.GetShape(aLayer) === PAD_SHAPE.CIRCLE) {
    // Draw a ring
    TransformRingToPolygon(
      aBuffer,
      aPad.ShapePos(aLayer),
      Math.trunc(aPad.GetSize(aLayer).x / 2),
      aWidth,
      aMaxError,
      aErrorLoc,
    );
  } else {
    // For other shapes, add outlines as thick segments in polygon buffer
    const path = aPad.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE).COutline(0);
    const n = path.PointCount();

    for (let ii = 0; ii < n; ++ii)
      TransformOvalToPolygon(
        aBuffer,
        path.CPoint(ii),
        path.CPoint((ii + 1) % n),
        aWidth,
        aMaxError,
        aErrorLoc,
      );
  }
}

/**
 * A board drawing's polygons (create_layer_items.cpp:1525-1600, the same
 * switch the copper pass runs at :1170-1250).
 */
function transformDrawingToPolySet(
  aItem: BOARD_ITEM,
  aLayer: PCB_LAYER_ID,
  aBuffer: SHAPE_POLY_SET,
  aMaxError: number,
): void {
  switch (aItem.Type()) {
    case KICAD_T.PCB_SHAPE_T: {
      const shape = aItem as PCB_SHAPE;
      let margin = 0;

      if (IsSolderMaskLayer(aLayer) && shape.HasSolderMask())
        margin = shape.GetSolderMaskExpansion();

      aItem.TransformShapeToPolySet(aBuffer, aLayer, margin, aMaxError, ERROR_LOC.ERROR_INSIDE);
      break;
    }

    case KICAD_T.PCB_TEXT_T:
      (aItem as PCB_TEXT).TransformTextToPolySet(aBuffer, 0, aMaxError, ERROR_LOC.ERROR_INSIDE);
      break;

    case KICAD_T.PCB_TEXTBOX_T: {
      const textbox = aItem as PCB_TEXTBOX;

      if (textbox.IsBorderEnabled())
        textboxBorderToPolygon(textbox, aBuffer, aLayer, aMaxError, ERROR_LOC.ERROR_INSIDE);

      textbox.TransformTextToPolySet(aBuffer, 0, aMaxError, ERROR_LOC.ERROR_INSIDE);
      break;
    }

    case KICAD_T.PCB_TABLE_T: {
      const table = aItem as PCB_TABLE;

      for (const cell of table.GetCells())
        cell.TransformTextToPolySet(aBuffer, 0, aMaxError, ERROR_LOC.ERROR_INSIDE);

      table.DrawBorders((ptA, ptB, stroke) => {
        TransformOvalToPolygon(
          aBuffer,
          ptA,
          ptB,
          stroke.GetWidth(),
          aMaxError,
          ERROR_LOC.ERROR_INSIDE,
        );
      });
      break;
    }

    case KICAD_T.PCB_BARCODE_T:
      aItem.TransformShapeToPolySet(aBuffer, aLayer, 0, 0, ERROR_LOC.ERROR_INSIDE);
      break;

    case KICAD_T.PCB_DIM_ALIGNED_T:
    case KICAD_T.PCB_DIM_CENTER_T:
    case KICAD_T.PCB_DIM_RADIAL_T:
    case KICAD_T.PCB_DIM_ORTHOGONAL_T:
    case KICAD_T.PCB_DIM_LEADER_T:
      aItem.TransformShapeToPolySet(aBuffer, aLayer, 0, aMaxError, ERROR_LOC.ERROR_INSIDE);
      break;

    default:
      break;
  }
}

/**
 * `BOARD_ADAPTER::createLayers`, the polygon half, over the BOARD's items.
 */
export function buildBoard3dLayers(
  aBoard: BOARD,
  bbox: Box,
  opts: Layer3dOptions = {},
): Board3dLayers {
  const bds = aBoard.GetDesignSettings();
  const maxError = opts.maxError ?? bds.m_MaxError ?? ARC_HIGH_DEF;
  const plating = opts.holePlatingThickness ?? DEFAULT_HOLE_PLATING_THICKNESS;
  const showZones = opts.showZones !== false;
  const flags: FP_TEXT_FLAGS = {
    fpText: opts.showFpText !== false,
    references: opts.showFpReferences !== false,
    values: opts.showFpValues !== false,
  };
  const report = opts.report ?? ((): void => {});
  const vias = aBoard.Tracks().filter((t) => t.Type() === KICAD_T.PCB_VIA_T) as PCB_VIA[];

  // ----- the board -----------------------------------------------------------
  // BOARD_ADAPTER::createBoardPolygon (board_adapter.cpp:1029):
  // `GetBoardPolygonOutlines( m_board_poly, true, nullptr, false, true )`.
  let boardPoly: Polygon[] = [];

  if (!opts.empty) {
    const set = new SHAPE_POLY_SET();
    aBoard.GetBoardPolygonOutlines(set, true, null, false, true);
    boardPoly = polySetToPolygons(set);
  }

  // ----- the holes -----------------------------------------------------------
  // create_layer_items.cpp:527-566 (vias) and :904-930 (pads).
  const thODSet = new SHAPE_POLY_SET();
  const thIDSet = new SHAPE_POLY_SET();
  const npthSet = new SHAPE_POLY_SET();
  const annuliSet = new SHAPE_POLY_SET();

  for (const via of vias) {
    if (via.GetViaType() !== VIATYPE.THROUGH) continue;

    const holeRadius = Math.trunc(via.GetDrillValue() / 2);
    const holeOuterRadius = holeRadius + plating;
    const holeOuterRingRadius = Math.trunc(via.GetWidth(PCB_LAYER_ID.F_Cu) / 2);

    TransformCircleToPolygon(
      thODSet,
      via.GetStart(),
      holeOuterRadius,
      maxError,
      ERROR_LOC.ERROR_INSIDE,
    );
    TransformCircleToPolygon(thIDSet, via.GetStart(), holeRadius, maxError, ERROR_LOC.ERROR_INSIDE);
    TransformCircleToPolygon(
      annuliSet,
      via.GetStart(),
      holeOuterRingRadius,
      maxError,
      ERROR_LOC.ERROR_INSIDE,
    );
  }

  for (const fp of aBoard.Footprints()) {
    for (const pad of fp.Pads()) {
      const drill = pad.GetDrillSize();

      if (drill.x === 0 || drill.y === 0) continue;

      // The hole in the body is inflated by copper thickness.
      if (pad.GetAttribute() === PAD_ATTRIB.NPTH) {
        pad.TransformHoleToPolygon(npthSet, 0, maxError, ERROR_LOC.ERROR_INSIDE);
      } else {
        pad.TransformHoleToPolygon(thODSet, plating, maxError, ERROR_LOC.ERROR_INSIDE);
        pad.TransformHoleToPolygon(thIDSet, 0, maxError, ERROR_LOC.ERROR_INSIDE);
        pad.TransformHoleToPolygon(annuliSet, plating, maxError, ERROR_LOC.ERROR_INSIDE);
      }
    }
  }

  // This will make a union of all added contours
  const thOD = simplify(polysOf(thODSet));
  const thID = simplify(polysOf(thIDSet));
  const npthOD = simplify(polysOf(npthSet));
  const viaAnnuli = simplify(polysOf(annuliSet));

  // Blind/micro vias (create_layer_items.cpp:536-546): their hole is per
  // layer, not through the board.
  const layerViaHoles: Partial<Record<Layer3d, Polygon[]>> = {};
  const viaBarrels: Board3dLayers['viaBarrels'] = [];

  for (const via of vias) {
    if (via.GetViaType() === VIATYPE.THROUGH) continue;

    const [top, bottom] = via.LayerPair();
    viaBarrels.push({
      at: { ...via.GetStart() },
      drill: via.GetDrillValue(),
      topLayer: LSET.Name(top),
      bottomLayer: LSET.Name(bottom),
    });

    const holeOuterRadius = Math.trunc(via.GetDrillValue() / 2) + plating;

    for (const layer of ['F.Cu', 'B.Cu'] as const) {
      if (LSET.Name(top) !== layer && LSET.Name(bottom) !== layer) continue;

      const set = new SHAPE_POLY_SET();
      TransformCircleToPolygon(
        set,
        via.GetStart(),
        holeOuterRadius,
        maxError,
        ERROR_LOC.ERROR_INSIDE,
      );
      const holes = layerViaHoles[layer] ?? [];
      holes.push(...polysOf(set));
      layerViaHoles[layer] = holes;
    }
  }

  // `board_poly_with_holes` (create_scene.cpp:720-744).
  let boardWithHoles = booleanSubtract(boardPoly, thOD);
  boardWithHoles = booleanSubtract(boardWithHoles, npthOD);

  // `generatePlatedHoleShells`: (drill + plating) − drill, inside the board.
  let platedBarrels: Polygon[] = [];

  if (opts.showPlatedBarrels !== false)
    platedBarrels = booleanIntersection(booleanSubtract(thOD, thID), boardPoly);

  // `m_outerThroughHoles` is the plated AND non-plated drills together
  // (create_scene.cpp:757-765), which is what every layer is cut by.
  const allHoles = booleanAdd(thOD, npthOD);

  // ----- per-layer item polygons ----------------------------------------------
  report('Create tracks and vias'); // create_layer_items.cpp:315
  const items: Partial<Record<Layer3d, SHAPE_POLY_SET>> = {};
  const bufferOf = (aLayer: Layer3d): SHAPE_POLY_SET => {
    const existing = items[aLayer];

    if (existing) return existing;

    const created = new SHAPE_POLY_SET();
    items[aLayer] = created;
    return created;
  };

  // Copper layers (create_layer_items.cpp:737-1305).
  for (const name of ['F.Cu', 'B.Cu'] as const) {
    const layer = pcbLayerIdOf(name);
    const buf = bufferOf(name);

    // ADD TRACKS: the track/via contour, skipping a via annulus not flashed here.
    for (const track of aBoard.Tracks()) {
      if (!track.IsOnLayer(layer)) continue;

      if (track.Type() === KICAD_T.PCB_VIA_T && !(track as PCB_VIA).FlashLayer(layer)) continue;

      track.TransformShapeToPolygon(buf, layer, 0, maxError, ERROR_LOC.ERROR_INSIDE);
    }

    for (const fp of aBoard.Footprints()) {
      fp.TransformPadsToPolySet(buf, layer, 0, maxError, ERROR_LOC.ERROR_INSIDE);
      transformFPTextToPolySet(fp, layer, flags, buf, maxError, ERROR_LOC.ERROR_INSIDE);
      transformFPShapesToPolySet(fp, layer, buf, maxError, ERROR_LOC.ERROR_INSIDE);
    }

    for (const item of aBoard.Drawings()) {
      if (item.IsOnLayer(layer)) transformDrawingToPolySet(item, layer, buf, maxError);
    }

    if (showZones) {
      for (const zone of aBoard.Zones())
        if (zone.IsOnLayer(layer)) zone.TransformSolidAreasShapesToPolygon(layer, buf);
    }
  }

  // Tech layers (create_layer_items.cpp:1340-1670).
  report('Build Tech layers');
  const maskOpenings = { 'F.Mask': [] as Polygon[], 'B.Mask': [] as Polygon[] };
  const silkLineWidth = bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_SILK]!;

  for (const name of LAYERS_3D) {
    if (isCopperLayer3d(name)) continue;

    const layer = pcbLayerIdOf(name);
    const buf = bufferOf(name);

    // DRAWINGS
    for (const item of aBoard.Drawings()) {
      if (item.IsOnLayer(layer)) transformDrawingToPolySet(item, layer, buf, maxError);
    }

    // NON-TENTED VIAS
    if (layer === PCB_LAYER_ID.F_Mask || layer === PCB_LAYER_ID.B_Mask) {
      const maskExpansion = bds.m_SolderMaskExpansion;

      for (const track of aBoard.Tracks()) {
        if (track.Type() === KICAD_T.PCB_VIA_T) {
          const via = track as PCB_VIA;

          if (via.FlashLayer(layer) && !via.IsTented(layer))
            track.TransformShapeToPolygon(
              buf,
              layer,
              maskExpansion,
              maxError,
              ERROR_LOC.ERROR_INSIDE,
            );
        } else if (track.HasSolderMask()) {
          track.TransformShapeToPolySet(
            buf,
            layer,
            maskExpansion,
            maxError,
            ERROR_LOC.ERROR_INSIDE,
          );
        }
      }
    }

    // FOOTPRINT CHILDREN
    for (const fp of aBoard.Footprints()) {
      if (layer === PCB_LAYER_ID.F_SilkS || layer === PCB_LAYER_ID.B_SilkS) {
        for (const pad of fp.Pads()) {
          if (pad.IsOnLayer(layer))
            buildPadOutlineAsPolygon(
              pad,
              layer,
              buf,
              silkLineWidth,
              maxError,
              ERROR_LOC.ERROR_INSIDE,
            );
        }
      } else {
        fp.TransformPadsToPolySet(buf, layer, 0, maxError, ERROR_LOC.ERROR_INSIDE);
      }

      transformFPTextToPolySet(fp, layer, flags, buf, maxError, ERROR_LOC.ERROR_INSIDE);
      transformFPShapesToPolySet(fp, layer, buf, maxError, ERROR_LOC.ERROR_INSIDE);
    }

    if (showZones || layer === PCB_LAYER_ID.F_Mask || layer === PCB_LAYER_ID.B_Mask) {
      for (const zone of aBoard.Zones())
        if (zone.IsOnLayer(layer)) zone.TransformSolidAreasShapesToPolygon(layer, buf);
    }
  }

  // ----- union, cut the holes, clip to the board -----------------------------
  report('Simplifying copper layer polygons'); // create_layer_items.cpp:1674
  // `DrawCulled( showThickness, throughHolesOuter, anti_board )` for a tech
  // layer, `( outerTH, viaHoles, m_antiBoard )` for copper. The mask is the
  // odd one: its list is the OPENINGS, and the layer drawn is the BOARD minus
  // them (`renderSolderMaskLayer`).
  const layers: Partial<Record<Layer3d, Polygon[]>> = {};
  // `Is3dLayerEnabled`: the board must have the layer enabled at all, and
  // the preset must show it.
  const visible = (layer: Layer3d): boolean =>
    aBoard.IsLayerEnabled(layerId(layer)) &&
    (!opts.visibleLayers || opts.visibleLayers.has(layerId(layer)));

  for (const layer of LAYERS_3D) {
    if (!visible(layer)) continue;

    const raw = items[layer] ? polysOf(items[layer]!) : [];

    if (raw.length === 0) {
      if (isMaskLayer(layer)) layers[layer] = booleanSubtract(boardPoly, allHoles);
      continue;
    }

    const unioned = simplify(raw);

    if (isMaskLayer(layer)) {
      maskOpenings[layer as 'F.Mask' | 'B.Mask'] = unioned;
      layers[layer] = booleanSubtract(booleanSubtract(boardPoly, unioned), allHoles);
      continue;
    }

    let poly = unioned;

    if (isSilkLayer(layer)) {
      // clip_silk_on_via_annuli: the silk is cut back to the via ring, not just the hole.
      poly = booleanSubtract(poly, opts.clipSilkOnViaAnnuli ? viaAnnuli : allHoles);

      if (!opts.showOffBoardSilk) poly = booleanIntersection(poly, boardPoly);

      if (opts.subtractMaskFromSilk && !opts.showOffBoardSilk) {
        const openings = maskOpenings[layer === 'F.SilkS' ? 'F.Mask' : 'B.Mask'];
        // the silk is only where the MASK is, i.e. not in its openings
        if (openings) poly = booleanSubtract(poly, openings);
      }
    } else {
      poly = booleanSubtract(poly, allHoles);
      // a copper layer is also cut by the blind/micro via holes that end on it
      const viaHoles = layerViaHoles[layer];

      if (viaHoles && viaHoles.length) poly = booleanSubtract(poly, simplify(viaHoles));

      // `LSET::PhysicalLayersMask().test( layer )` — every layer here is physical.
      poly = booleanIntersection(poly, boardPoly);
    }

    layers[layer] = poly;
  }

  // TRIM PLATED COPPER TO SOLDERMASK, then subtract it from the unplated
  // (create_layer_items.cpp:1673-1697).
  if (opts.differentiatePlatedCopper) report('Calculating plated copper');

  const platedCopper = { 'F.Cu': [] as Polygon[], 'B.Cu': [] as Polygon[] };

  if (opts.differentiatePlatedCopper) {
    for (const [cu, mask] of [
      ['F.Cu', 'F.Mask'],
      ['B.Cu', 'B.Mask'],
    ] as const) {
      const copper = layers[cu];

      if (!copper) continue;

      const plated = booleanIntersection(copper, maskOpenings[mask]);
      platedCopper[cu] = plated;
      layers[cu] = booleanSubtract(copper, plated);
    }
  }

  // The mask layers were unioned before the silk asked for their openings;
  // a silk layer visited before its mask would have missed them, so do the
  // subtraction again now that both exist.
  if (opts.subtractMaskFromSilk && !opts.showOffBoardSilk) {
    for (const silk of ['F.SilkS', 'B.SilkS'] as const) {
      const openings = maskOpenings[silk === 'F.SilkS' ? 'F.Mask' : 'B.Mask'];

      if (layers[silk] && openings.length) layers[silk] = booleanSubtract(layers[silk]!, openings);
    }
  }

  return {
    layers,
    boardPoly,
    boardWithHoles,
    thOD,
    thID,
    npthOD,
    viaAnnuli,
    platedBarrels,
    maskOpenings,
    bbox,
    viaBarrels,
    platedCopper,
  };
}
