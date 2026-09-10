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
import { ARC_HIGH_DEF } from '@ziroeda/common/src/eda_units.js';
import {
  type Polygon,
  booleanAdd,
  booleanSubtract,
  booleanIntersection,
  simplify,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  transformCircleToPolygonSet,
  transformOvalToPolygon,
  transformRingToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { Board } from '@ziroeda/pcbnew';
import { barcodeGeometry } from '@ziroeda/pcbnew/src/barcode_geometry.js';
import { viaIsTented } from '@ziroeda/pcbnew/src/export_d356.js';
import { padIsOnLayer } from '@ziroeda/pcbnew/src/pad_enumerate.js';
import {
  solderMaskExpansionFor,
  solderPasteMarginFor,
  type BoardMaskPasteDefaults,
} from '@ziroeda/pcbnew/src/pad_margins.js';
import { textTransformTextToPolySet } from '@ziroeda/pcbnew/src/text_to_polyset.js';
import {
  ErrorLoc,
  arcTrackTransformShapeToPolygon,
  edaShapeTransformShapeToPolygon,
  padTransformHoleToPolygon,
  padTransformShapeToPolygon,
  trackTransformShapeToPolygon,
  viaTransformShapeToPolygon,
} from '@ziroeda/pcbnew/src/transform_shape_to_polygon.js';
import type { PcbFootprint, PcbPad, PcbShape, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';
import { childNamed } from '@ziroeda/sexpr/src/query.js';
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
  Edge_Cuts,
  F_Adhes,
  F_Cu,
  F_Mask,
  F_Paste,
  F_SilkS,
  IsCopperLayer,
  PCB_LAYER_ID_COUNT,
} from '@ziroeda/pcbnew/src/layer_ids.js';
import { boardOutlineLoops, type Box } from './boardOutline.js';

/** The PCB_LAYER_IDs the 3D viewer builds (`techLayerList` minus the user ones). */
export type Layer3d =
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
];

/** The PCB_LAYER_ID of each 3D layer (layer_ids.h). */
const LAYER_ID: Record<Layer3d, number> = {
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

/** `PCB_PLOT_PARAMS::PCB_PLOT_PARAMS()`: the layer set a board without one plots. */
export function defaultPlotLayerSelection(): Set<number> {
  const out = new Set<number>([F_SilkS, B_SilkS, F_Mask, B_Mask, F_Paste, B_Paste, Edge_Cuts]);
  for (let id = 0; id < PCB_LAYER_ID_COUNT; id++) if (IsCopperLayer(id)) out.add(id);
  return out;
}

export function plotLayerSelection(board: Board): PlotLayerSelection {
  const setup = childNamed(board.source, 'setup');
  const pp = setup ? childNamed(setup, 'pcbplotparams') : undefined;
  const arg = (name: string): string | undefined => {
    const n = pp ? childNamed(pp, name) : undefined;
    const a = n?.items[1];
    return a && a.kind !== 'list' ? a.value : undefined;
  };
  const yes = (name: string, dflt: boolean): boolean => {
    const v = arg(name);
    return v === undefined ? dflt : v === 'yes' || v === 'true';
  };
  const sel = arg('layerselection');
  const layers =
    sel && sel.startsWith('0x') ? parseLayerSetHex(sel.slice(2)) : defaultPlotLayerSelection();
  const onAll = arg('plotonalllayersselection');
  if (onAll && onAll.startsWith('0x'))
    for (const id of parseLayerSetHex(onAll.slice(2))) layers.add(id);
  return {
    layers,
    plotReference: yes('plotreference', true),
    plotValue: yes('plotvalue', true),
    plotFPText: yes('plotfptext', true),
  };
}

export const isBackLayer = (l: string): boolean => l.startsWith('B.');
export const isCopperLayer3d = (l: string): boolean => l === 'F.Cu' || l === 'B.Cu';
export const isSilkLayer = (l: string): boolean => l === 'F.SilkS' || l === 'B.SilkS';
export const isMaskLayer = (l: string): boolean => l === 'F.Mask' || l === 'B.Mask';
export const isPasteLayer = (l: string): boolean => l === 'F.Paste' || l === 'B.Paste';

/** The `EDA_3D_VIEWER_SETTINGS::RENDER_SETTINGS` bits `createLayers` reads. */
export interface Layer3dOptions {
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
  /** `show_plated_barrels` (default true). */
  showPlatedBarrels?: boolean;
  /** Board Setup > Solder Mask/Paste; read from the file when omitted. */
  maskPaste?: BoardMaskPasteDefaults;
  /** `ADVANCED_CFG::m_HoleWallThickness` (0.020 mm): the barrel's plating, IU. */
  holePlatingThickness?: number;
  /** `BOARD_DESIGN_SETTINGS::m_MaxError` (ARC_HIGH_DEF). */
  maxError?: number;
  /**
   * `Is3dLayerEnabled( layer, visibilityFlags )`: the PCB_LAYER_IDs the
   * preset shows. A layer not in the set is not built. Omitted = every layer.
   */
  visibleLayers?: Set<number>;
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
}

/** `ADVANCED_CFG::m_HoleWallThickness`, 0.020 mm, in IU. */
export const DEFAULT_HOLE_PLATING_THICKNESS = 20000;

/**
 * `BOARD_DESIGN_SETTINGS::m_SolderMaskExpansion` etc. from the file's
 * `(setup …)`. Absent tokens are 0 — the writer omits zeros.
 */
export function boardMaskPasteDefaults(board: Board): BoardMaskPasteDefaults {
  const setup = childNamed(board.source, 'setup');
  const num = (name: string): number | undefined => {
    const n = setup ? childNamed(setup, name) : undefined;
    const a = n?.items[1];
    if (!a || a.kind === 'list') return undefined;
    const v = Number(a.value);
    return Number.isFinite(v) ? Math.round(v * 1e6) : undefined;
  };
  const ratioNode = setup ? childNamed(setup, 'pad_to_paste_clearance_ratio') : undefined;
  const ratioArg = ratioNode?.items[1];
  const ratio = ratioArg && ratioArg.kind !== 'list' ? Number(ratioArg.value) : undefined;
  return {
    solderMaskExpansion: num('pad_to_mask_clearance'),
    solderPasteMargin: num('pad_to_paste_clearance'),
    solderPasteMarginRatio: Number.isFinite(ratio) ? ratio : undefined,
  };
}

const ringPoly = (ring: Vec2[]): Polygon[] => (ring.length >= 3 ? [[ring]] : []);

/** `PCB_TRACK::GetSolderMaskExpansion` — the track's own, else the board's. */
function trackMaskExpansion(own: number | undefined, defaults: BoardMaskPasteDefaults): number {
  return own ?? defaults.solderMaskExpansion ?? 0;
}

/**
 * `BOARD_ADAPTER::createLayers`, the polygon half.
 */
export function buildBoard3dLayers(
  board: Board,
  bbox: Box,
  opts: Layer3dOptions = {},
): Board3dLayers {
  const maxError = opts.maxError ?? ARC_HIGH_DEF;
  const maskPaste = opts.maskPaste ?? boardMaskPasteDefaults(board);
  const plating = opts.holePlatingThickness ?? DEFAULT_HOLE_PLATING_THICKNESS;
  const showZones = opts.showZones !== false;
  const showRefs = opts.showFpReferences !== false;
  const showValues = opts.showFpValues !== false;
  const showFpText = opts.showFpText !== false;

  // ----- the board -----------------------------------------------------------
  // `GetBoardPolygonOutlines`: the first loop is the outer boundary (largest
  // area, as `boardOutlineLoops` orders them), the rest are cutouts.
  const loops = boardOutlineLoops(board, bbox);
  let boardPoly: Polygon[] = loops.length ? simplify([[loops[0]!]]) : [];
  for (const cut of loops.slice(1)) boardPoly = booleanSubtract(boardPoly, [[cut]]);

  // ----- the holes -----------------------------------------------------------
  // create_layer_items.cpp:527-566 (vias) and :877-901 (pads).
  let thOD: Polygon[] = [];
  let thID: Polygon[] = [];
  let npthOD: Polygon[] = [];
  let viaAnnuli: Polygon[] = [];
  for (const via of board.vias) {
    if (via.kind !== 'through') continue;
    const holeRadius = Math.trunc(via.drill / 2);
    const holeOuterRadius = holeRadius + plating;
    const holeOuterRingRadius = Math.trunc(via.size / 2);
    thOD.push([
      transformCircleToPolygonSet(via.at, holeOuterRadius, maxError, ErrorLoc.ERROR_INSIDE),
    ]);
    thID.push([transformCircleToPolygonSet(via.at, holeRadius, maxError, ErrorLoc.ERROR_INSIDE)]);
    viaAnnuli.push([
      transformCircleToPolygonSet(via.at, holeOuterRingRadius, maxError, ErrorLoc.ERROR_INSIDE),
    ]);
  }
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!pad.drill || !pad.drill.w || !pad.drill.h) continue;
      if (pad.type === 'np_thru_hole') {
        npthOD.push(...padTransformHoleToPolygon(pad, 0, maxError, ErrorLoc.ERROR_INSIDE));
      } else {
        thOD.push(...padTransformHoleToPolygon(pad, plating, maxError, ErrorLoc.ERROR_INSIDE));
        thID.push(...padTransformHoleToPolygon(pad, 0, maxError, ErrorLoc.ERROR_INSIDE));
        viaAnnuli.push(...padTransformHoleToPolygon(pad, plating, maxError, ErrorLoc.ERROR_INSIDE));
      }
    }
  }
  thOD = simplify(thOD);
  thID = simplify(thID);
  npthOD = simplify(npthOD);
  viaAnnuli = simplify(viaAnnuli);

  // `board_poly_with_holes` (create_scene.cpp:720-744).
  let boardWithHoles = booleanSubtract(boardPoly, thOD);
  boardWithHoles = booleanSubtract(boardWithHoles, npthOD);

  // `generatePlatedHoleShells`: (drill + plating) − drill, inside the board.
  let platedBarrels: Polygon[] = [];
  if (opts.showPlatedBarrels !== false) {
    platedBarrels = booleanIntersection(booleanSubtract(thOD, thID), boardPoly);
  }
  // `m_outerThroughHoles` is the plated AND non-plated drills together
  // (create_scene.cpp:757-765), which is what every layer is cut by.
  const allHoles = booleanAdd(thOD, npthOD);

  // ----- per-layer item polygons ----------------------------------------------
  const items: Partial<Record<Layer3d, Polygon[]>> = {};
  const add = (layer: string, polys: Polygon[]): void => {
    if (!(LAYERS_3D as readonly string[]).includes(layer)) return;
    const l = layer as Layer3d;
    const list = items[l] ?? [];
    list.push(...polys);
    items[l] = list;
  };

  const addShape = (s: PcbShape, layer: string): void => {
    if (s.layer !== layer) return;
    add(layer, edaShapeTransformShapeToPolygon(s, 0, maxError, ErrorLoc.ERROR_INSIDE, false));
  };
  const addText = (t: PcbTextItem, layer: string): void => {
    if (t.layer !== layer || t.hide || !t.text) return;
    add(layer, textTransformTextToPolySet(t, 0, maxError, ErrorLoc.ERROR_INSIDE));
  };
  /** `transformFPTextToPolySet`: the three `show_fp_*` flags. */
  const addFpText = (fp: PcbFootprint, layer: string): void => {
    if (!showFpText) return;
    for (const t of fp.texts) {
      if (t.kind === 'reference' && !showRefs) continue;
      if (t.kind === 'value' && !showValues) continue;
      addText(t, layer);
    }
  };
  /** `PCB_BARCODE::TransformShapeToPolySet` — the assembled modules, as filled rings. */
  const addBarcodes = (layer: string): void => {
    for (const bc of [...board.barcodes, ...board.footprints.flatMap((f) => f.barcodes)]) {
      if (bc.layer !== layer) continue;
      for (const poly of barcodeGeometry(bc).poly)
        for (const ring of poly) add(layer, ringPoly(ring));
    }
  };
  /** `addPads` / `FOOTPRINT::TransformPadsToPolySet` with the layer's margin. */
  const padMargin = (pad: PcbPad, fp: PcbFootprint, layer: string): Vec2 => {
    if (isMaskLayer(layer)) {
      const m = solderMaskExpansionFor(pad, fp, maskPaste, layer);
      return { x: m, y: m };
    }
    if (isPasteLayer(layer)) return solderPasteMarginFor(pad, fp, maskPaste, layer);
    return { x: 0, y: 0 };
  };
  const addPads = (fp: PcbFootprint, layer: string): void => {
    for (const pad of fp.pads) {
      if (!padIsOnLayer(pad, layer)) continue;
      const m = padMargin(pad, fp, layer);
      // `PAD::TransformShapeToPolygon` takes one clearance; the paste margin's
      // x/y split is applied through the pad size upstream (`addPads` builds a
      // pad copy with `GetSolderPasteMargin` folded into the size). The
      // uniform case is exact; a per-axis margin uses its x.
      add(layer, padTransformShapeToPolygon(pad, m.x, maxError, ErrorLoc.ERROR_INSIDE));
    }
  };
  /** `buildPadOutlineAsPolygon`: a pad ON the silk layer draws as its outline. */
  const addPadOutlines = (fp: PcbFootprint, layer: string): void => {
    // m_LineThickness[ LAYER_CLASS_SILK ], DEFAULT_SILK_LINE_WIDTH
    const linewidth = 100000;
    for (const pad of fp.pads) {
      if (!padIsOnLayer(pad, layer)) continue;
      if (pad.shape === 'circle') {
        add(
          layer,
          transformRingToPolygon(
            pad.at,
            Math.trunc(pad.size.x / 2),
            linewidth,
            maxError,
            ErrorLoc.ERROR_INSIDE,
          ).map((r) => [r]),
        );
      } else {
        const outline = padTransformShapeToPolygon(pad, 0, maxError, ErrorLoc.ERROR_INSIDE)[0]?.[0];
        if (!outline) continue;
        for (let i = 0; i < outline.length; i++) {
          const a = outline[i]!;
          const b = outline[(i + 1) % outline.length]!;
          add(layer, transformOvalToPolygon(a, b, linewidth, maxError, ErrorLoc.ERROR_INSIDE));
        }
      }
    }
  };
  const addZones = (layer: string): void => {
    for (const z of board.zones)
      for (const f of z.fills)
        if (f.layer === layer) for (const ring of f.polys) add(layer, ringPoly(ring));
  };

  // Copper layers (create_layer_items.cpp:497-1275).
  for (const layer of ['F.Cu', 'B.Cu'] as const) {
    for (const t of board.tracks)
      if (t.layer === layer)
        add(layer, trackTransformShapeToPolygon(t, 0, maxError, ErrorLoc.ERROR_INSIDE));
    for (const a of board.arcs)
      if (a.layer === layer)
        add(layer, arcTrackTransformShapeToPolygon(a, 0, maxError, ErrorLoc.ERROR_INSIDE));
    for (const v of board.vias) {
      // `PCB_VIA::IsOnLayer` — the via's layer span. Through vias flash every
      // copper layer; a blind/micro via only its ends.
      const on = v.kind === 'through' || v.layers[0] === layer || v.layers[1] === layer;
      if (on) add(layer, viaTransformShapeToPolygon(v, 0, maxError, ErrorLoc.ERROR_INSIDE));
    }
    for (const fp of board.footprints) {
      addPads(fp, layer);
      for (const s of fp.shapes) addShape(s, layer);
      addFpText(fp, layer);
    }
    for (const s of board.shapes) addShape(s, layer);
    for (const t of board.texts) addText(t, layer);
    addBarcodes(layer);
    if (showZones) addZones(layer);
  }

  // Tech layers (create_layer_items.cpp:1320-1655).
  const maskOpenings = { 'F.Mask': [] as Polygon[], 'B.Mask': [] as Polygon[] };
  for (const layer of LAYERS_3D) {
    if (isCopperLayer3d(layer)) continue;
    for (const s of board.shapes) addShape(s, layer);
    if (isMaskLayer(layer)) {
      // Add track, via and arc tech layers: a track with its own solder mask
      // opening, and every via that is not tented on this side, grown by the
      // mask expansion (:1451-1472, :1582-1608).
      const side = layer === 'F.Mask' ? 'front' : 'back';
      const copperLayer = layer === 'F.Mask' ? 'F.Cu' : 'B.Cu';
      for (const v of board.vias) {
        const on =
          v.kind === 'through' || v.layers[0] === copperLayer || v.layers[1] === copperLayer;
        if (!on || viaIsTented(board, v, side)) continue;
        // A via has no local margin token of its own; `GetSolderMaskExpansion`
        // falls through to the board's.
        const m = trackMaskExpansion(undefined, maskPaste);
        add(layer, viaTransformShapeToPolygon(v, m, maxError, ErrorLoc.ERROR_INSIDE));
      }
      for (const t of board.tracks) {
        // `HasSolderMask()`: the track's layer set names a mask layer.
        if (t.maskLayer !== layer || t.layer !== copperLayer) continue;
        const m = trackMaskExpansion(t.solderMaskMargin, maskPaste);
        add(layer, trackTransformShapeToPolygon(t, m, maxError, ErrorLoc.ERROR_INSIDE));
      }
      for (const a of board.arcs) {
        if (a.maskLayer !== layer || a.layer !== copperLayer) continue;
        const m = trackMaskExpansion(a.solderMaskMargin, maskPaste);
        add(layer, arcTrackTransformShapeToPolygon(a, m, maxError, ErrorLoc.ERROR_INSIDE));
      }
    }
    for (const fp of board.footprints) {
      if (isSilkLayer(layer)) addPadOutlines(fp, layer);
      else addPads(fp, layer);
      for (const s of fp.shapes) addShape(s, layer);
      addFpText(fp, layer);
    }
    for (const t of board.texts) addText(t, layer);
    addBarcodes(layer);
    // Draw non copper zones
    if (showZones || isMaskLayer(layer)) addZones(layer);
  }

  // ----- union, cut the holes, clip to the board -----------------------------
  // `DrawCulled( showThickness, throughHolesOuter, anti_board )` for a tech
  // layer, `( outerTH, viaHoles, m_antiBoard )` for copper. The mask is the
  // odd one: its list is the OPENINGS, and the layer drawn is the BOARD minus
  // them (`renderSolderMaskLayer`).
  const layers: Partial<Record<Layer3d, Polygon[]>> = {};
  // `Is3dLayerEnabled`: the board must have the layer enabled at all, and
  // the preset must show it.
  const enabledNames = new Set(board.layers.map((l) => l.name));
  const visible = (layer: Layer3d): boolean =>
    enabledNames.has(layer) && (!opts.visibleLayers || opts.visibleLayers.has(LAYER_ID[layer]));
  for (const layer of LAYERS_3D) {
    if (!visible(layer)) continue;
    const raw = items[layer];
    if (!raw || raw.length === 0) {
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
      // `LSET::PhysicalLayersMask().test( layer )` — every layer here is physical.
      poly = booleanIntersection(poly, boardPoly);
    }
    layers[layer] = poly;
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
  };
}
