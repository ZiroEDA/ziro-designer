// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/specctra_import_export/specctra_export.cpp`: the export of a BOARD to
 * the SPECCTRA DSN format (`SPECCTRA_DB::FromBOARD` and its helpers, and
 * `ExportBoardToSpecctraFile`).
 *
 * The file is text here: `ExportBoardToSpecctraFile` returns the DSN, and the
 * frame writes it where the user chose (`PCB_EDIT_FRAME::ExportSpecctraFile`).
 *
 * One ordering difference from the C++: `netclassesInUse` is a
 * `std::unordered_map<wxString, NETCLASS*>`, whose iteration order is the
 * libstdc++ hash order; here it is first-use order. Boards with more than one
 * non-default netclass in use can emit those classes (and their vias) in a
 * different order; the content is the same.
 */

import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { buildConvexHullOfPolySet } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_360,
  EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  SHAPE_POLY_SET,
  TransformRoundChamferedRectToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  ConvertArcToPolylineAboutCentre,
  ERROR_LOC,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { BOARD } from '../board.js';
import { LAYER_T } from '../board_types.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import { PADSTACK as KI_PADSTACK, PAD_SHAPE } from '../padstack.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import type { DSN_T } from './specctra.js';
import {
  BOUNDARY,
  CIRCLE,
  CLASS,
  COPPER_PLANE,
  IMAGE,
  KEEPOUT,
  LAYER,
  NET,
  PADSTACK,
  PATH,
  PIN,
  PIN_REF,
  PLACE,
  POINT,
  RECTANGLE,
  RULE,
  SHAPE,
  SPECCTRA_DB,
  WINDOW,
  WIRE,
  WIRE_VIA,
  g6,
} from './specctra.js';

// comment the line `EXPORT_CUSTOM_PADS_CONVEX_HULL` to export CUSTOM pads exact shapes.
// Shapes can be non convex polygons with holes (linked to outline) that can create issues.
// Especially Freerouter does not handle them very well:
// - too complex shapes are not accepted, especially shapes with holes (dsn files are not loaded).
// - and Freerouter actually uses something like a convex hull of the shape (that works poorly).
// I am guessing non convex polygons with holes linked could create issues with any Router.
const EXPORT_CUSTOM_PADS_CONVEX_HULL = true;

const IU_PER_MM = pcbIUScale.IU_PER_MM;

// "specctra reported units" are what we tell the external router that our exported lengths are in

/** Convert a distance from Pcbnew internal units to the reported Specctra DSN units (um). */
const scale = (kicadDist: number): number => kicadDist / (IU_PER_MM / 1000.0);

/** Convert integer internal units to float um. */
const IU2um = (kicadDist: number): number => kicadDist * (1000.0 / IU_PER_MM);

const mapX = (x: number): number => scale(x);

// make y negative, since it is increasing going down.
const mapY = (y: number): number => -scale(y);

/** Convert a KiCad point into a DSN file point. */
function mapPt(pt: Vec2): POINT {
  const ret = new POINT(mapX(pt.x), mapY(pt.y));

  ret.FixNegativeZero();

  return ret;
}

/** `mapPt( pt, aFootprint )`: relative to the footprint, un-rotated. */
function mapPtInFootprint(pt: Vec2, aFootprint: FOOTPRINT): POINT {
  const p = aFootprint.GetPosition();
  const fpRelative = RotatePoint(
    { x: pt.x - p.x, y: pt.y - p.y },
    aFootprint.GetOrientation().negate(),
  );

  return mapPt(fpRelative);
}

/** Decide if the pad is a copper-less through hole which needs to be made into a round keepout. */
function isRoundKeepout(aPad: PAD): boolean {
  // TODO(JE) padstacks
  if (aPad.GetShape(KI_PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE) {
    if (aPad.GetDrillSize().x >= aPad.GetSize(KI_PADSTACK.ALL_LAYERS).x) return true;

    if (!aPad.GetLayerSet().and(LSET.AllCuMask()).any()) return true;
  }

  return false;
}

/** Create a PATH element with a single straight line, a pair of vertices. */
function makePath(aStart: POINT, aEnd: POINT, aLayerName: string): PATH {
  const path = new PATH(null, 'path');

  path.AppendPoint(aStart);
  path.AppendPoint(aEnd);
  path.SetLayerId(aLayerName);

  return path;
}

/**
 * Specctra strings have no in-string escape, so a payload holding the quote delimiter would end
 * the token early and desync the reader.  Only fold free-text fields that need no round-trip.
 */
const sanitizeForDSNString = (aValue: string): string => aValue.replaceAll('"', "''");

/** `std::hex << std::uppercase` of an int. */
const hexUpper = (v: number): string => (v >>> 0).toString(16).toUpperCase();

/** `std::fixed << std::setprecision( 6 )`. */
const f6 = (v: number): string => fixed(v, 6);

/** `SPECCTRA_DB` as the exporter extends it. */
export class SPECCTRA_EXPORT_DB extends SPECCTRA_DB {
  /** the board outlines for DSN export */
  m_brd_outlines = new SHAPE_POLY_SET();
  m_padstackset: PADSTACK[] = [];
  m_nets: (NET | null)[] = [];

  /** `buildLayerMaps`. */
  buildLayerMaps(aBoard: BOARD): void {
    this.m_layerIds = [];

    // specctra wants top physical layer first, then going down to the
    // bottom most physical layer in physical sequence.
    const layerset = LSET.AllCuMask(aBoard.GetCopperLayerCount());
    let pcbLayer = 0;

    for (const kiLayer of layerset.CuStack()) {
      this.m_kicadLayer2pcb.set(kiLayer, pcbLayer);
      this.m_pcbLayer2kicad.set(pcbLayer, kiLayer);

      // save the specctra layer name in SPECCTRA_DB::layerIds for later.
      this.m_layerIds.push(aBoard.GetLayerName(kiLayer));

      pcbLayer++;
    }
  }

  BuiltBoardOutlines(aBoard: BOARD): boolean {
    return aBoard.GetBoardPolygonOutlines(this.m_brd_outlines, true);
  }

  /** `makePADSTACK`. */
  makePADSTACK(aBoard: BOARD, aPad: PAD): PADSTACK {
    let uniqifier: string;

    // caller must do these checks before calling here.
    const padstack = new PADSTACK();

    uniqifier = '[';

    const copperCount = aBoard.GetCopperLayerCount();
    const all_cu = LSET.AllCuMask(copperCount);

    let reportedLayers = 0;
    const layerName: string[] = new Array(copperCount).fill('');

    const onAllCopperLayers = aPad.GetLayerSet().and(all_cu).equals(all_cu);

    if (onAllCopperLayers) uniqifier += 'A'; // A for all layers

    for (let layer = 0; layer < copperCount; ++layer) {
      const kilayer = this.m_pcbLayer2kicad.get(layer)!;

      if (onAllCopperLayers || aPad.IsOnLayer(kilayer)) {
        layerName[reportedLayers++] = this.m_layerIds[layer]!;

        if (!onAllCopperLayers) {
          if (layer === 0) uniqifier += 'T';
          else if (layer === copperCount - 1) uniqifier += 'B';
          else uniqifier += String.fromCharCode(48 + layer); // layer index char
        }
      }
    }

    uniqifier += ']';

    let dsnOffset = new POINT();

    // TODO(JE) padstacks
    const padSize = aPad.GetSize(KI_PADSTACK.ALL_LAYERS);
    const offset = aPad.GetOffset(KI_PADSTACK.ALL_LAYERS);

    if (offset.x || offset.y) {
      dsnOffset = mapPt(offset);

      // Using () would cause padstack name to be quoted, and {} locks freerouter, so use [].
      uniqifier += `[${f6(dsnOffset.x)},${f6(dsnOffset.y)}]`;
    }

    switch (aPad.GetShape(KI_PADSTACK.ALL_LAYERS)) {
      case PAD_SHAPE.CIRCLE: {
        const diameter = scale(padSize.x);

        for (let ndx = 0; ndx < reportedLayers; ++ndx) {
          const shape = new SHAPE(padstack);
          padstack.Append(shape);

          const circle = new CIRCLE(shape);
          shape.SetShape(circle);

          circle.SetLayerId(layerName[ndx]!);
          circle.SetDiameter(diameter);
          circle.SetVertex(dsnOffset);
        }

        padstack.SetPadstackId(`Round${uniqifier}Pad_${f6(IU2um(padSize.x))}_um`);
        break;
      }

      case PAD_SHAPE.RECTANGLE: {
        const dx = scale(padSize.x) / 2.0;
        const dy = scale(padSize.y) / 2.0;

        const lowerLeft = new POINT(-dx, -dy);
        const upperRight = new POINT(dx, dy);

        lowerLeft.add(dsnOffset);
        upperRight.add(dsnOffset);

        for (let ndx = 0; ndx < reportedLayers; ++ndx) {
          const shape = new SHAPE(padstack);
          padstack.Append(shape);

          const rect = new RECTANGLE(shape);
          shape.SetShape(rect);

          rect.SetLayerId(layerName[ndx]!);
          rect.SetCorners(lowerLeft, upperRight);
        }

        padstack.SetPadstackId(
          `Rect${uniqifier}Pad_${f6(IU2um(padSize.x))}x${f6(IU2um(padSize.y))}_um`,
        );
        break;
      }

      case PAD_SHAPE.OVAL: {
        const dx = scale(padSize.x) / 2.0;
        const dy = scale(padSize.y) / 2.0;
        let dr = dx - dy;
        let radius: number;
        let pstart: POINT;
        let pstop: POINT;

        if (dr >= 0) {
          // oval is horizontal
          radius = dy;
          pstart = new POINT(-dr, 0.0);
          pstop = new POINT(dr, 0.0);
        } else {
          // oval is vertical
          radius = dx;
          dr = -dr;
          pstart = new POINT(0.0, -dr);
          pstop = new POINT(0.0, dr);
        }

        pstart.add(dsnOffset);
        pstop.add(dsnOffset);

        for (let ndx = 0; ndx < reportedLayers; ++ndx) {
          // see http://www.freerouting.net/usren/viewtopic.php?f=3&t=317#p408
          const shape = new SHAPE(padstack);
          padstack.Append(shape);

          const path = makePath(pstart, pstop, layerName[ndx]!);
          shape.SetShape(path);
          path.aperture_width = 2.0 * radius;
        }

        padstack.SetPadstackId(
          `Oval${uniqifier}Pad_${f6(IU2um(padSize.x))}x${f6(IU2um(padSize.y))}_um`,
        );
        break;
      }

      case PAD_SHAPE.TRAPEZOID: {
        const dx = scale(padSize.x) / 2.0;
        const dy = scale(padSize.y) / 2.0;

        const delta = aPad.GetDelta(KI_PADSTACK.ALL_LAYERS);
        const ddx = scale(delta.x) / 2.0;
        const ddy = scale(delta.y) / 2.0;

        // see class_pad_draw_functions.cpp which draws the trapezoid pad
        const lowerLeft = new POINT(-dx - ddy, -dy - ddx);
        const upperLeft = new POINT(-dx + ddy, +dy + ddx);
        const upperRight = new POINT(+dx - ddy, +dy - ddx);
        const lowerRight = new POINT(+dx + ddy, -dy + ddx);

        lowerLeft.add(dsnOffset);
        upperLeft.add(dsnOffset);
        upperRight.add(dsnOffset);
        lowerRight.add(dsnOffset);

        for (let ndx = 0; ndx < reportedLayers; ++ndx) {
          const shape = new SHAPE(padstack);
          padstack.Append(shape);

          // a polygon exists as a PATH
          const polygon = new PATH(shape, 'polygon');
          shape.SetShape(polygon);

          polygon.SetLayerId(layerName[ndx]!);
          polygon.AppendPoint(lowerLeft.clone());
          polygon.AppendPoint(upperLeft.clone());
          polygon.AppendPoint(upperRight.clone());
          polygon.AppendPoint(lowerRight.clone());
        }

        // this string _must_ be unique for a given physical shape
        padstack.SetPadstackId(
          `Trapz${uniqifier}Pad_${f6(IU2um(padSize.x))}x${f6(IU2um(padSize.y))}_${delta.x < 0 ? 'n' : 'p'}${f6(Math.abs(IU2um(delta.x)))}x${delta.y < 0 ? 'n' : 'p'}${f6(Math.abs(IU2um(delta.y)))}_um`,
        );
        break;
      }

      case PAD_SHAPE.CHAMFERED_RECT:
      case PAD_SHAPE.ROUNDRECT: {
        // Export the shape as as polygon, round rect does not exist as primitive
        const circleToSegmentsCount = 36;

        let rradius = aPad.GetRoundRectCornerRadius(KI_PADSTACK.ALL_LAYERS);
        const cornerBuffer = new SHAPE_POLY_SET();

        // Use a slightly bigger shape because the round corners are approximated by
        // segments, giving to the polygon a slightly smaller shape than the actual shape
        /* calculates the coeff to compensate radius reduction of holes clearance
         * due to the segment approx.
         * For a circle the min radius is radius * cos( 2PI / s_CircleToSegmentsCount / 2)
         * correctionFactor is cos( PI/s_CircleToSegmentsCount  )
         */
        const correctionFactor = Math.cos(Math.PI / circleToSegmentsCount);
        const extra_clearance = KiROUND(rradius * (1.0 - correctionFactor));
        const psize = { x: padSize.x + extra_clearance * 2, y: padSize.y + extra_clearance * 2 };

        rradius += extra_clearance;

        const doChamfer = aPad.GetShape(KI_PADSTACK.ALL_LAYERS) === PAD_SHAPE.CHAMFERED_RECT;

        TransformRoundChamferedRectToPolygon(
          cornerBuffer,
          { x: 0, y: 0 },
          psize,
          ANGLE_0,
          rradius,
          aPad.GetChamferRectRatio(KI_PADSTACK.ALL_LAYERS),
          doChamfer ? aPad.GetChamferPositions(KI_PADSTACK.ALL_LAYERS) : 0,
          0,
          aPad.GetMaxError(),
          ERROR_LOC.ERROR_INSIDE,
        );

        const polygonal_shape = cornerBuffer.Outline(0);

        for (let ndx = 0; ndx < reportedLayers; ++ndx) {
          const shape = new SHAPE(padstack);
          padstack.Append(shape);

          // a polygon exists as a PATH
          const polygon = new PATH(shape, 'polygon');
          shape.SetShape(polygon);

          polygon.SetLayerId(layerName[ndx]!);

          // append a closed polygon
          let first_corner = new POINT();

          for (let idx = 0; idx < polygonal_shape.PointCount(); idx++) {
            const corner = new POINT(
              scale(polygonal_shape.CPoint(idx).x),
              scale(-polygonal_shape.CPoint(idx).y),
            );

            corner.add(dsnOffset);
            polygon.AppendPoint(corner);

            if (idx === 0) first_corner = corner.clone();
          }

          polygon.AppendPoint(first_corner); // Close polygon
        }

        // this string _must_ be unique for a given physical shape
        padstack.SetPadstackId(
          `RoundRect${uniqifier}Pad_${f6(IU2um(padSize.x))}x${f6(IU2um(padSize.y))}_${f6(IU2um(rradius))}_um_${f6(doChamfer ? aPad.GetChamferRectRatio(KI_PADSTACK.ALL_LAYERS) : 0.0)}_${hexUpper(doChamfer ? aPad.GetChamferPositions(KI_PADSTACK.ALL_LAYERS) : 0)}`,
        );
        break;
      }

      case PAD_SHAPE.CUSTOM: {
        let polygonal_shape: Vec2[] = [];
        const pad_shape = new SHAPE_POLY_SET();

        aPad.MergePrimitivesAsPolygon(KI_PADSTACK.ALL_LAYERS, pad_shape);

        if (EXPORT_CUSTOM_PADS_CONVEX_HULL) {
          polygonal_shape = buildConvexHullOfPolySet(pad_shape);
        } else {
          const p_outline = pad_shape.COutline(0);

          for (let ii = 0; ii < p_outline.PointCount(); ++ii)
            polygonal_shape.push(p_outline.CPoint(ii));
        }

        // The polygon must be closed
        const front = polygonal_shape[0]!;
        const back = polygonal_shape[polygonal_shape.length - 1]!;

        if (front.x !== back.x || front.y !== back.y) polygonal_shape.push(front);

        for (let ndx = 0; ndx < reportedLayers; ++ndx) {
          const shape = new SHAPE(padstack);
          padstack.Append(shape);

          // a polygon exists as a PATH
          const polygon = new PATH(shape, 'polygon');
          shape.SetShape(polygon);

          polygon.SetLayerId(layerName[ndx]!);

          for (const pt of polygonal_shape) {
            const corner = new POINT(scale(pt.x), scale(-pt.y));

            corner.add(dsnOffset);
            polygon.AppendPoint(corner);
          }
        }

        // this string _must_ be unique for a given physical shape, so try to make it unique
        const hash = pad_shape.GetHash();
        const rect = aPad.GetBoundingBox();

        padstack.SetPadstackId(
          `Cust${uniqifier}Pad_${f6(IU2um(padSize.x))}x${f6(IU2um(padSize.y))}_${f6(IU2um(rect.GetWidth()))}x${f6(IU2um(rect.GetHeight()))}_${polygonal_shape.length}_um_${hash}`,
        );
        break;
      }
    }

    return padstack;
  }

  /** `makeIMAGE`. */
  makeIMAGE(aBoard: BOARD, aFootprint: FOOTPRINT): IMAGE {
    const pinmap = new Map<string, number>();

    const image = new IMAGE(null);

    image.m_image_id = aFootprint.GetFPID().Format();

    // from the pads, and make an IMAGE using collated padstacks.
    for (const pad of aFootprint.Pads()) {
      // see if this pad is a through hole with no copper on its perimeter
      if (isRoundKeepout(pad)) {
        let diameter = scale(pad.GetDrillSize().x);
        const vertex = mapPt(pad.GetFPRelativePosition());

        diameter += scale(aBoard.GetDesignSettings().m_HoleClearance * 2);

        const layerCount = aBoard.GetCopperLayerCount();

        for (let layer = 0; layer < layerCount; ++layer) {
          const keepout = new KEEPOUT(image, 'keepout');
          image.m_keepouts.push(keepout);

          const circle = new CIRCLE(keepout);
          keepout.SetShape(circle);

          circle.SetDiameter(diameter);
          circle.SetVertex(vertex);
          circle.SetLayerId(this.m_layerIds[layer]!);
        }
      } else {
        // else if() could there be a square keepout here?

        // Pads not on copper layers (i.e. only on tech layers) are ignored
        // because they create invalid pads in .dsn file for freeroute
        const mask_copper_layers = pad.GetLayerSet().and(LSET.AllCuMask());

        if (!mask_copper_layers.any()) continue;

        let padstack = this.makePADSTACK(aBoard, pad);

        const dup = this.m_padstackset.find((ps) => PADSTACK.Compare(ps, padstack) === 0);

        if (dup) {
          // padstack is a duplicate, use the original
          padstack = dup;
        } else {
          this.insertPadstack(padstack);
        }

        const pin = new PIN(image);

        const padNumber = pad.GetNumber();
        pin.m_pin_id = padNumber;

        if (padNumber !== '' && !pinmap.has(padNumber)) {
          pinmap.set(padNumber, 0);
        } else {
          // pad name is a duplicate within this footprint
          const duplicates = (pinmap.get(padNumber) ?? 0) + 1;
          pinmap.set(padNumber, duplicates);

          pin.m_pin_id += `@${duplicates}`; // append "@1" or "@2", etc. to pin name
        }

        pin.m_kiNetCode = pad.GetNetCode();

        image.m_pins.push(pin);

        pin.m_padstack_id = padstack.m_padstack_id;

        const angle = pad.GetOrientation().sub(aFootprint.GetOrientation());
        pin.SetRotation(angle.Normalize().AsDegrees());

        const pos = pad.GetFPRelativePosition();
        pin.SetVertex(mapPt(pos));
      }
    }

    const crtYd = aFootprint.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
    crtYd.Append(aFootprint.GetCourtyard(PCB_LAYER_ID.B_CrtYd));
    crtYd.Simplify();

    // Specctra only supports the first outline, so add courtyard first
    for (const polygon of crtYd.CPolygons()) {
      for (const chain of polygon) {
        const outline = new SHAPE(image, 'outline');
        image.Append(outline);

        const path = new PATH(outline, 'polygon');
        outline.SetShape(path);
        path.SetAperture(0);
        path.SetLayerId('signal');

        for (let ii = 0; ii < chain.PointCount(); ++ii) {
          const corner = { x: chain.CPoint(ii).x, y: chain.CPoint(ii).y };
          path.AppendPoint(mapPtInFootprint(corner, aFootprint));
        }
      }
    }

    // get all the FOOTPRINT's SHAPEs and convert those to DSN outlines.
    for (const item of aFootprint.GraphicalItems()) {
      if (item.Type() !== KICAD_T.PCB_SHAPE_T) continue;

      const graphic = item as PCB_SHAPE;

      if (graphic.IsOnLayer(PCB_LAYER_ID.F_CrtYd) || graphic.IsOnLayer(PCB_LAYER_ID.B_CrtYd))
        continue; // Courtyard already handled above

      switch (graphic.GetShape()) {
        case SHAPE_T.SEGMENT: {
          const outline = new SHAPE(image, 'outline');
          image.Append(outline);

          const path = new PATH(outline);
          outline.SetShape(path);
          path.SetAperture(scale(graphic.GetWidth()));
          path.SetLayerId('signal');
          path.AppendPoint(mapPtInFootprint(graphic.GetStart(), aFootprint));
          path.AppendPoint(mapPtInFootprint(graphic.GetEnd(), aFootprint));
          break;
        }

        case SHAPE_T.CIRCLE: {
          // this is best done by 4 QARC's but freerouter does not yet support QARCs.
          // for now, support by using line segments.
          const outline = new SHAPE(image, 'outline');
          image.Append(outline);

          const path = new PATH(outline);
          outline.SetShape(path);
          path.SetAperture(scale(graphic.GetWidth()));
          path.SetLayerId('signal');

          const radius = graphic.GetRadius();
          const circle_centre = graphic.GetStart();
          const polyline: Vec2[] = [];

          ConvertArcToPolylineAboutCentre(
            polyline,
            circle_centre,
            radius,
            ANGLE_0,
            ANGLE_360,
            ARC_HIGH_DEF,
            ERROR_LOC.ERROR_INSIDE,
          );

          for (const p of polyline)
            path.AppendPoint(mapPtInFootprint({ x: p.x, y: p.y }, aFootprint));
          break;
        }

        case SHAPE_T.RECTANGLE: {
          const outline = new SHAPE(image, 'outline');
          image.Append(outline);

          const path = new PATH(outline);
          outline.SetShape(path);
          path.SetAperture(scale(graphic.GetWidth()));
          path.SetLayerId('signal');

          let corner = { ...graphic.GetStart() };
          path.AppendPoint(mapPtInFootprint(corner, aFootprint));

          corner.x = graphic.GetEnd().x;
          path.AppendPoint(mapPtInFootprint(corner, aFootprint));

          corner.y = graphic.GetEnd().y;
          path.AppendPoint(mapPtInFootprint(corner, aFootprint));

          corner.x = graphic.GetStart().x;
          path.AppendPoint(mapPtInFootprint(corner, aFootprint));

          corner = { ...graphic.GetStart() };
          path.AppendPoint(mapPtInFootprint(corner, aFootprint));
          break;
        }

        case SHAPE_T.ARC: {
          // this is best done by QARC's but freerouter does not yet support QARCs.
          // for now, support by using line segments.
          // So we use a "polygon" (PATH) to create a approximate arc shape
          // Note we can't use "path" with aperture width because FreeRouting converts it to a convex polygon
          const outline = new SHAPE(image, 'outline');
          image.Append(outline);

          const path = new PATH(outline, 'polygon');
          outline.SetShape(path);
          path.SetAperture(0);
          path.SetLayerId('signal');

          const polyBuffer = new SHAPE_POLY_SET();

          graphic.TransformShapeToPolygon(
            polyBuffer,
            graphic.GetLayer(),
            0,
            ARC_HIGH_DEF,
            ERROR_LOC.ERROR_INSIDE,
            false,
          );

          const poly = polyBuffer.COutline(0);

          for (let ii = 0; ii < poly.PointCount(); ++ii) {
            const corner = { x: poly.CPoint(ii).x, y: poly.CPoint(ii).y };
            path.AppendPoint(mapPtInFootprint(corner, aFootprint));
          }
          break;
        }

        default:
          continue;
      }
    }

    for (const zone of aFootprint.Zones()) {
      if (!zone.GetIsRuleArea()) continue;

      // IMAGE object coordinates are relative to the IMAGE not absolute board coordinates.
      const untransformedZone = zone.Clone() as ZONE;
      const angle = aFootprint.GetOrientation().negate();
      angle.Normalize();
      untransformedZone.Rotate(aFootprint.GetPosition(), angle);

      // keepout areas have a type. types are
      // place_keepout, via_keepout, wire_keepout, bend_keepout, elongate_keepout, keepout.
      // Pcbnew knows only keepout, via_keepout and wire_keepout
      const keepout_type = this.keepoutType(zone);

      // Now, build keepout polygon on each copper layer where the zone
      // keepout is living (keepout zones can live on many copper layers)
      const layerset = zone.GetLayerSet().and(LSET.AllCuMask(aBoard.GetCopperLayerCount()));

      for (const layer of layerset.CuStack()) {
        const keepout = new KEEPOUT(this.m_pcb!.m_structure, keepout_type);
        image.m_keepouts.push(keepout);

        const mainPolygon = new PATH(keepout, 'polygon');
        keepout.SetShape(mainPolygon);

        mainPolygon.layer_id = this.m_layerIds[this.m_kicadLayer2pcb.get(layer)!]!;

        const fpPos = aFootprint.GetPosition();
        const rel = (p: Vec2): Vec2 => ({ x: p.x - fpPos.x, y: p.y - fpPos.y });

        this.appendZoneContours(
          untransformedZone.Outline(),
          keepout,
          mainPolygon,
          rel,
          () => this.m_layerIds[this.m_kicadLayer2pcb.get(zone.GetLayer())!]!,
        );
      }
    }

    return image;
  }

  /** Keepout areas have a type; Pcbnew knows only keepout, via_keepout and wire_keepout. */
  private keepoutType(zone: ZONE): DSN_T {
    if (zone.GetDoNotAllowVias() && zone.GetDoNotAllowTracks()) return 'keepout';

    if (zone.GetDoNotAllowVias()) return 'via_keepout';

    if (zone.GetDoNotAllowTracks()) return 'wire_keepout';

    return 'keepout';
  }

  /**
   * The contour walk shared by the zone, keepout and footprint-keepout exports:
   * the first contour is the main polygon (closed by repeating its first
   * point), every following one becomes a WINDOW cutout on the same owner.
   */
  private appendZoneContours(
    poly: SHAPE_POLY_SET,
    owner: KEEPOUT,
    mainPolygon: PATH,
    aMap: (p: Vec2) => Vec2,
    aCutoutLayer: () => string,
  ): void {
    let is_first_point = true;
    let startpoint: Vec2 = { x: 0, y: 0 };

    const iterator = poly.IterateWithHoles();

    // Handle the main outlines
    for (; iterator.valid(); iterator.Advance()) {
      const point = aMap(iterator.Get());

      if (is_first_point) {
        startpoint = point;
        is_first_point = false;
      }

      mainPolygon.AppendPoint(mapPt(point));

      // this was the end of the main polygon
      if (iterator.IsEndContour()) {
        mainPolygon.AppendPoint(mapPt(startpoint));
        break;
      }
    }

    let window: WINDOW | null = null;
    let cutout: PATH | null = null;
    let isStartContour = true;

    // handle the cutouts
    for (iterator.Advance(); iterator.valid(); iterator.Advance()) {
      if (isStartContour) {
        is_first_point = true;

        window = new WINDOW(owner);
        owner.AddWindow(window);

        cutout = new PATH(window, 'polygon');
        window.SetShape(cutout);

        cutout.layer_id = aCutoutLayer();
      }

      // If the point in this iteration is the last of the contour, the next iteration
      // will start with a new contour.
      isStartContour = iterator.IsEndContour();

      const point = aMap(iterator.Get());

      if (is_first_point) {
        startpoint = point;
        is_first_point = false;
      }

      cutout!.AppendPoint(mapPt(point));

      // Close the polygon
      if (iterator.IsEndContour()) cutout!.AppendPoint(mapPt(startpoint));
    }
  }

  /** `makeVia( aCopperDiameter, aDrillDiameter, aTopLayer, aBotLayer )`. */
  makeViaPadstack(
    aCopperDiameter: number,
    aDrillDiameter: number,
    aTopLayer: number,
    aBotLayer: number,
  ): PADSTACK {
    const padstack = new PADSTACK();

    const dsnDiameter = scale(aCopperDiameter);

    for (let layer = aTopLayer; layer <= aBotLayer; ++layer) {
      const shape = new SHAPE(padstack);
      padstack.Append(shape);

      const circle = new CIRCLE(shape);
      shape.SetShape(circle);

      circle.SetDiameter(dsnDiameter);
      circle.SetLayerId(this.m_layerIds[layer]!);
    }

    // encode the drill value into the name for later import; `char name[48]` truncates.
    const name = `Via[${aTopLayer}-${aBotLayer}]_${g6(dsnDiameter)}:${g6(IU2um(aDrillDiameter))}_um`;

    padstack.SetPadstackId(name.slice(0, 47));

    return padstack;
  }

  /** `makeVia( const PCB_VIA* aVia )`. */
  makeVia(aVia: PCB_VIA): PADSTACK {
    const [topLayerNum, botLayerNum] = aVia.LayerPair();

    let topLayer = this.m_kicadLayer2pcb.get(topLayerNum)!;
    let botLayer = this.m_kicadLayer2pcb.get(botLayerNum)!;

    if (topLayer > botLayer) [topLayer, botLayer] = [botLayer, topLayer];

    // TODO(JE) padstacks
    return this.makeViaPadstack(
      aVia.GetWidth(KI_PADSTACK.ALL_LAYERS),
      aVia.GetDrillValue(),
      topLayer,
      botLayer,
    );
  }

  /** `fillBOUNDARY`. */
  fillBOUNDARY(_aBoard: BOARD, boundary: BOUNDARY): void {
    for (let cnt = 0; cnt < this.m_brd_outlines.OutlineCount(); cnt++) {
      // Should be one outline
      const path = new PATH(boundary);
      boundary.paths.push(path);
      path.layer_id = 'pcb';

      const outline = this.m_brd_outlines.Outline(cnt);

      for (let ii = 0; ii < outline.PointCount(); ii++) {
        path.AppendPoint(mapPt({ x: outline.CPoint(ii).x, y: outline.CPoint(ii).y }));
      }

      // Close polygon:
      path.AppendPoint(mapPt({ x: outline.CPoint(0).x, y: outline.CPoint(0).y }));

      // Generate holes as keepout:
      for (let ii = 0; ii < this.m_brd_outlines.HoleCount(cnt); ii++) {
        // emit a signal layers keepout for every interior polygon left...
        const keepout = new KEEPOUT(null, 'keepout');
        const poly_ko = new PATH(null, 'polygon');
        keepout.SetShape(poly_ko);
        poly_ko.SetLayerId('signal');

        this.m_pcb!.m_structure!.m_keepouts.push(keepout);

        const hole = this.m_brd_outlines.Hole(cnt, ii);

        for (let jj = 0; jj < hole.PointCount(); jj++) {
          poly_ko.AppendPoint(mapPt({ x: hole.CPoint(jj).x, y: hole.CPoint(jj).y }));
        }

        // Close polygon:
        poly_ko.AppendPoint(mapPt({ x: hole.CPoint(0).x, y: hole.CPoint(0).y }));
      }
    }
  }

  /** The `std::set<PADSTACK>` insert: ordered by `PADSTACK::Compare`. */
  private insertPadstack(aPadstack: PADSTACK): void {
    let i = 0;

    while (i < this.m_padstackset.length && PADSTACK.Compare(this.m_padstackset[i]!, aPadstack) < 0)
      ++i;

    this.m_padstackset.splice(i, 0, aPadstack);
  }

  /** `FromBOARD`. */
  FromBOARD(aBoard: BOARD): void {
    const netSettings = aBoard.GetDesignSettings().m_NetSettings;

    // Component ids must be unique for the session file to round-trip, but empty and duplicate
    // references (unannotated REF** fiducials, intentional duplicates) are common, so uniquify
    // rather than refuse the export.  Exported DSN defaults to case-insensitive ids, so fold case
    // when checking for collisions.
    const componentIds = new Map<FOOTPRINT, string>();
    {
      const used = new Set<string>();

      for (const footprint of aBoard.Footprints()) {
        let ref = footprint.GetReference();

        if (ref === '') ref = 'REF**';

        let unique = ref;

        for (let suffix = 1; used.has(unique.toLowerCase()); ++suffix) unique = `${ref}_${suffix}`;

        used.add(unique.toLowerCase());
        componentIds.set(footprint, unique);
      }
    }

    if (!this.m_pcb) this.m_pcb = SPECCTRA_DB.MakePCB();

    const pcb = this.m_pcb;
    const structure = pcb.m_structure!;

    // ----- <layer_descriptor> -----
    {
      // Specctra wants top physical layer first, then going down to the bottom most physical
      // layer in physical sequence.
      this.buildLayerMaps(aBoard);

      const layerCount = aBoard.GetCopperLayerCount();

      for (let pcbNdx = 0; pcbNdx < layerCount; ++pcbNdx) {
        const layer = new LAYER(structure);
        structure.m_layers.push(layer);

        layer.name = this.m_layerIds[pcbNdx]!;

        let layerType: DSN_T;

        switch (aBoard.GetLayerType(this.m_pcbLayer2kicad.get(pcbNdx)!)) {
          default:
          case LAYER_T.LT_SIGNAL:
            layerType = 'signal';
            break;
          case LAYER_T.LT_POWER:
            layerType = 'power';
            break;
          // Freerouter does not support type "mixed", only signal and power.
          // Remap "mixed" to "signal".
          case LAYER_T.LT_MIXED:
            layerType = 'signal';
            break;
          case LAYER_T.LT_JUMPER:
            layerType = 'jumper';
            break;
        }

        layer.layer_type = layerType;

        layer.properties.push({ name: 'index', value: `${pcbNdx}` });
      }
    }

    // a space in a quoted token is NOT a terminator, true establishes this.
    pcb.m_parser!.space_in_quoted_tokens = true;

    // ----- <unit_descriptor> & <resolution_descriptor> -----
    {
      // Tell freerouter to use "tenths of micrometers", which is 100 nm resolution.  Possibly
      // more resolution is possible in freerouter, but it would need testing.
      pcb.m_unit!.units = 'um';
      pcb.m_resolution!.units = 'um';
      pcb.m_resolution!.value = 10; // tenths of a um
    }

    // ----- <boundary_descriptor> -----
    {
      // Because fillBOUNDARY() can throw an exception, we link in an empty boundary so the
      // BOUNDARY does not get lost in the event of of an exception.
      const boundary = new BOUNDARY(null);
      structure.SetBOUNDARY(boundary);
      this.fillBOUNDARY(aBoard, boundary);
    }

    // ----- <rules> -----
    {
      const defaultTrackWidth = netSettings.GetDefaultNetclass().GetTrackWidth();
      const defaultClearance = netSettings.GetDefaultNetclass().GetClearance();

      let clearance = scale(defaultClearance);

      const rules = structure.m_rules!.m_rules;

      rules.push(`(width ${g6(scale(defaultTrackWidth))})`);
      rules.push(`(clearance ${g6(clearance)})`);

      // Pad to pad spacing on a single SMT part can be closer than our clearance. We don't want
      // freerouter complaining about that, so output a significantly smaller pad to pad
      // clearance to freerouter.
      clearance = scale(defaultClearance) / 4;
      rules.push(`(clearance ${g6(clearance)} (type smd_smd))`);
    }

    // ----- <zones (not keepout areas) become planes> -----
    // Note: only zones are output here, keepout areas are created later.
    {
      let netlessZones = 0;

      for (const zone of aBoard.Zones()) {
        if (zone.GetIsRuleArea()) continue;

        // Currently, we export only copper layers
        if (!zone.IsOnCopperLayer()) continue;

        // Now, build zone polygon on each copper layer where the zone
        // is living (zones can live on many copper layers)
        const layerset = zone.GetLayerSet().and(LSET.AllCuMask(aBoard.GetCopperLayerCount()));

        for (const layer of layerset.Seq()) {
          const plane = new COPPER_PLANE(structure);
          structure.m_planes.push(plane);

          const mainPolygon = new PATH(plane, 'polygon');
          plane.SetShape(mainPolygon);

          plane.m_name = zone.GetNetname();

          if (plane.m_name.length === 0) {
            // This is one of those no connection zones, netcode=0, and it has no name.
            // Create a unique, bogus netname.
            const no_net = new NET(pcb.m_network);
            no_net.m_net_id = `@:no_net_${netlessZones++}`;

            // add the bogus net name to network->nets.
            pcb.m_network!.m_nets.push(no_net);

            // use the bogus net name in the netless zone.
            plane.m_name = no_net.m_net_id;
          }

          mainPolygon.layer_id = this.m_layerIds[this.m_kicadLayer2pcb.get(layer)!]!;

          this.appendZoneContours(
            zone.Outline(),
            plane,
            mainPolygon,
            (p) => p,
            () => this.m_layerIds[this.m_kicadLayer2pcb.get(layer)!]!,
          );
        } // end build zones by layer
      }
    }

    // ----- <zones flagged keepout areas become keepout> -----
    {
      for (const zone of aBoard.Zones()) {
        if (!zone.GetIsRuleArea()) continue;

        // Keepout areas have a type: place_keepout, via_keepout, wire_keepout,
        // bend_keepout, elongate_keepout, keepout.
        // Pcbnew knows only keepout, via_keepout and wire_keepout
        const keepout_type = this.keepoutType(zone);

        // Now, build keepout polygon on each copper layer where the zone
        // keepout is living (keepout zones can live on many copper layers)
        const layerset = zone.GetLayerSet().and(LSET.AllCuMask(aBoard.GetCopperLayerCount()));

        for (const layer of layerset.Seq()) {
          const keepout = new KEEPOUT(structure, keepout_type);
          structure.m_keepouts.push(keepout);

          const mainPolygon = new PATH(keepout, 'polygon');
          keepout.SetShape(mainPolygon);

          mainPolygon.layer_id = this.m_layerIds[this.m_kicadLayer2pcb.get(layer)!]!;

          this.appendZoneContours(
            zone.Outline(),
            keepout,
            mainPolygon,
            (p) => p,
            () => this.m_layerIds[this.m_kicadLayer2pcb.get(layer)!]!,
          );
        }
      }
    }

    // ----- <build the images, components, and netlist> -----
    {
      let highestNetCode = 0;
      const netInfo = aBoard.GetNetInfo();

      // find the highest numbered netCode within the board.
      for (const net of netInfo) highestNetCode = Math.max(highestNetCode, net.GetNetCode());

      this.m_nets = [];

      // expand the net vector to highestNetCode+1, setting empty to NULL
      this.m_nets.length = highestNetCode + 1;
      this.m_nets.fill(null);

      for (let i = 1 /* skip "No Net" at [0] */; i < this.m_nets.length; ++i)
        this.m_nets[i] = new NET(pcb.m_network);

      for (const net of netInfo) {
        if (net.GetNetCode() > 0)
          this.m_nets[net.GetNetCode()]!.m_net_id = sanitizeForDSNString(net.GetNetname());
      }

      this.m_padstackset = [];

      for (const footprint of aBoard.Footprints()) {
        let image = this.makeIMAGE(aBoard, footprint);

        const componentId = componentIds.get(footprint)!;

        // Create a net list entry for all the actual pins in the current footprint.
        // Location of this code is critical because we fabricated some pin names to ensure
        // unique-ness within a footprint, and the life of this 'IMAGE* image' is not
        // necessarily long.  The exported netlist will have some fabricated pin names in it.
        // If you don't like fabricated pin names, then make sure all pads within your
        // FOOTPRINTs are uniquely named!
        for (const pin of image.m_pins) {
          const netcode = pin.m_kiNetCode;

          if (netcode > 0) {
            const net = this.m_nets[netcode]!;

            const pin_ref = new PIN_REF(pcb.m_network);
            pin_ref.component_id = componentId;
            pin_ref.pin_id = pin.m_pin_id;
            net.m_pins.push(pin_ref);
          }
        }

        const registered = pcb.m_library!.LookupIMAGE(image);

        // If our new 'image' is not a unique IMAGE, use the registered one.
        if (registered !== image) image = registered;

        const comp = pcb.m_placement!.LookupCOMPONENT(image.GetImageId());

        const place = new PLACE(comp);
        comp.m_places.push(place);

        place.SetRotation(footprint.GetOrientationDegrees());
        place.SetVertex(mapPt(footprint.GetPosition()));

        place.m_component_id = componentId;
        place.m_part_number = sanitizeForDSNString(footprint.GetValue());

        // footprint is flipped from bottom side, set side to back
        if (footprint.GetFlag()) {
          const angle = ANGLE_180.sub(footprint.GetOrientation());
          place.SetRotation(angle.Normalize().AsDegrees());
          place.m_side = 'back';
        }
      }

      // copy the SPECCTRA_DB::padstackset to the LIBRARY.
      for (const padstack of this.m_padstackset) pcb.m_library!.AddPadstack(padstack);

      this.m_padstackset = [];

      // copy our SPECCTRA_DB::nets to the pcb->network
      for (let n = 1; n < this.m_nets.length; ++n) {
        const net = this.m_nets[n]!;

        if (net.m_pins.length) {
          // give ownership to pcb->network
          pcb.m_network!.m_nets.push(net);
          this.m_nets[n] = null;
        }
      }
    }

    // Create a list of all in-use non-default netclasses
    const netclassesInUse = new Map<string, NETCLASS>();

    for (const net of aBoard.GetNetInfo()) {
      const netclass = net.GetNetClass();
      const name = netclass.GetName();

      // Don't add the default netclass
      if (name === NETCLASS.Default) continue;

      if (!netclassesInUse.has(name)) netclassesInUse.set(name, netclass);
    }

    // ----- < output vias used in netclasses > -----
    {
      // Assume the netclass vias are all the same kind of thru, blind, or buried vias.
      // This is in lieu of either having each netclass via have its own layer pair in
      // the netclass dialog, or such control in the specctra export dialog.
      this.m_top_via_layer = 0; // first specctra cu layer is number zero.
      this.m_bot_via_layer = aBoard.GetCopperLayerCount() - 1;

      // Add the via from the Default netclass first.  The via container
      // in pcb->library preserves the sequence of addition.
      let via = this.makeViaPadstack(
        netSettings.GetDefaultNetclass().GetViaDiameter(),
        netSettings.GetDefaultNetclass().GetViaDrill(),
        this.m_top_via_layer,
        this.m_bot_via_layer,
      );

      // we AppendVia() this first one, there is no way it can be a duplicate,
      // the pcb->library via container is empty at this point.  After this,
      // we'll have to use LookupVia().
      pcb.m_library!.AppendVia(via);

      // output the non-Default netclass vias
      for (const netclass of netclassesInUse.values()) {
        via = this.makeViaPadstack(
          netclass.GetViaDiameter(),
          netclass.GetViaDrill(),
          this.m_top_via_layer,
          this.m_bot_via_layer,
        );

        // maybe add 'via' to the library, but only if unique.
        pcb.m_library!.LookupVia(via);
      }
    }

    // ----- <create the wires from tracks> -----
    {
      // export all of them for now, later we'll decide what controls we need on this.
      let netname = '';
      const wiring = pcb.m_wiring!;
      let path: PATH | null = null;

      let old_netcode = -1;
      let old_width = -1;
      let old_layer: number = PCB_LAYER_ID.UNDEFINED_LAYER;

      for (const track of aBoard.Tracks() as PCB_TRACK[]) {
        if (!track.IsType([KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T])) continue;

        const netcode = track.GetNetCode();

        if (netcode === 0) continue;

        const lastPt: POINT | null = path ? path.points[path.points.length - 1]! : null;

        if (
          old_netcode !== netcode ||
          old_width !== track.GetWidth() ||
          old_layer !== track.GetLayer() ||
          (lastPt && !lastPt.equals(mapPt(track.GetStart())))
        ) {
          old_width = track.GetWidth();
          old_layer = track.GetLayer();

          if (old_netcode !== netcode) {
            old_netcode = netcode;

            const net = aBoard.FindNet(netcode);
            netname = net!.GetNetname();
          }

          const wire = new WIRE(wiring);
          wiring.wires.push(wire);

          wire.m_net_id = netname;

          if (track.IsLocked())
            wire.m_wire_type = 'fix'; // tracks with fix property are not returned in .ses files
          else wire.m_wire_type = 'route'; // could be protect

          const kiLayer = track.GetLayer();
          const pcbLayer = this.m_kicadLayer2pcb.get(kiLayer)!;

          path = new PATH(wire);
          wire.SetShape(path);
          path.layer_id = this.m_layerIds[pcbLayer]!;
          path.aperture_width = scale(old_width);

          path.AppendPoint(mapPt(track.GetStart()));
        }

        if (path)
          // Should not occur
          path.AppendPoint(mapPt(track.GetEnd()));
      }
    }

    // ----- <export the existing real BOARD instantiated vias> -----
    {
      // Export all vias, once per unique size and drill diameter combo.
      for (const track of aBoard.Tracks() as PCB_TRACK[]) {
        if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

        const via = track as PCB_VIA;
        const netcode = via.GetNetCode();

        if (netcode === 0) continue;

        const padstack = this.makeVia(via);
        const registered = pcb.m_library!.LookupVia(padstack);

        // if the one looked up is not our padstack, then ours was a duplicate.
        const dsnVia = new WIRE_VIA(pcb.m_wiring);
        pcb.m_wiring!.wire_vias.push(dsnVia);

        dsnVia.m_padstack_id = registered.m_padstack_id;
        dsnVia.m_vertexes.push(mapPt(via.GetPosition()));

        const net = aBoard.FindNet(netcode);
        dsnVia.m_net_id = net!.GetNetname();

        if (via.IsLocked())
          dsnVia.m_via_type = 'fix'; // vias with fix property are not returned in .ses files
        else dsnVia.m_via_type = 'route'; // could be protect
      }
    }

    // ----- <via_descriptor> -----
    {
      // The pcb->library will output <padstack_descriptors> which is a combined list of part
      // padstacks and via padstacks.  specctra dsn uses the <via_descriptors> to say which of
      // those padstacks are vias.
      // Output the vias in the padstack list here, by name only.  This must be done after
      // exporting existing vias as WIRE_VIAs.
      const vias = structure.m_via!;

      for (const v of pcb.m_library!.m_vias) vias.AppendVia(v.m_padstack_id);
    }

    // ----- <output NETCLASSs> -----
    // Export netclass info
    this.exportNETCLASS(netSettings.GetDefaultNetclass(), aBoard);

    for (const netclass of netclassesInUse.values()) this.exportNETCLASS(netclass, aBoard);
  }

  /**
   * `exportNETCLASS`. From page 11 of specctra spec, the routing rule precedence order is
   * pcb < layer < class < class layer < ... < padstack < region < class region < net region <
   * class_class region; a rule set at one level overrides conflicting rules set at lower levels.
   */
  exportNETCLASS(aNetClass: NETCLASS, aBoard: BOARD): void {
    const clazz = new CLASS(this.m_pcb!.m_network);
    this.m_pcb!.m_network!.m_classes.push(clazz);

    clazz.m_class_id = aNetClass.GetName();

    for (const net of aBoard.GetNetInfo()) {
      if (net.GetNetClass().GetName() === clazz.m_class_id) clazz.m_net_ids.push(net.GetNetname());
    }

    clazz.m_rules = new RULE(clazz, 'rule');

    // output the track width.
    const trackWidth = aNetClass.GetTrackWidth();
    clazz.m_rules.m_rules.push(`(width ${g6(scale(trackWidth))})`);

    // output the clearance.
    const clearance = aNetClass.GetClearance();
    clazz.m_rules.m_rules.push(`(clearance ${g6(scale(clearance))})`);

    // Freerouter creates a class named 'default' anyway, and if we try to use that we end up
    // with two 'default' via rules so use something else as the name of our default class.
    if (aNetClass.GetName() === NETCLASS.Default) clazz.m_class_id = 'kicad_default';

    // The easiest way to get the via name is to create a temporary via (which generates the
    // name internal to the PADSTACK), and then grab the name.
    const via = this.makeViaPadstack(
      aNetClass.GetViaDiameter(),
      aNetClass.GetViaDrill(),
      this.m_top_via_layer,
      this.m_bot_via_layer,
    );

    clazz.m_circuit.push(`(use_via "${via.GetPadstackId()}")`);
  }

  /**
   * `FlipFOOTPRINTs`: DSN Images (KiCad FOOTPRINTs and PADs) must be presented from the top
   * view, so footprints on the back are flipped around the X axis and flagged.
   */
  FlipFOOTPRINTs(aBoard: BOARD): void {
    for (const footprint of aBoard.Footprints()) {
      footprint.SetFlag(0);

      if (footprint.GetLayer() === PCB_LAYER_ID.B_Cu) {
        footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
        footprint.SetFlag(1);
      }
    }

    this.m_footprintsAreFlipped = true;
  }

  /** `RevertFOOTPRINTs`: restore those that were flipped. */
  RevertFOOTPRINTs(aBoard: BOARD): void {
    if (!this.m_footprintsAreFlipped) return;

    for (const footprint of aBoard.Footprints()) {
      if (footprint.GetFlag()) {
        footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
        footprint.SetFlag(0);
      }
    }

    this.m_footprintsAreFlipped = false;
  }
}

/**
 * `ExportBoardToSpecctraFile`: the DSN text of `aBoard`, and whether its outline
 * was well formed (upstream logs "Board outline is malformed. Run DRC for a full
 * analysis." and carries on).
 */
export function ExportBoardToSpecctraFile(
  aBoard: BOARD,
  aFullFilename: string,
): { text: string; outlineOk: boolean } {
  const db = new SPECCTRA_EXPORT_DB();

  db.SetPCB(SPECCTRA_DB.MakePCB());

  // Build the board outlines *before* flipping footprints
  const outlineOk = db.BuiltBoardOutlines(aBoard);

  // DSN Images (=KiCad FOOTPRINTs and PADs) must be presented from the top view.  So we
  // temporarily flip any footprints which are on the back side of the board to the front,
  // and record this in the FOOTPRINT's flag field.
  db.FlipFOOTPRINTs(aBoard);

  try {
    aBoard.SynchronizeNetsAndNetClasses(false);
    db.FromBOARD(aBoard);

    const text = db.ExportPCB(true, aFullFilename)!;

    db.RevertFOOTPRINTs(aBoard);

    return { text, outlineOk };
  } catch (e) {
    db.RevertFOOTPRINTs(aBoard);
    throw e;
  }
}

/** The slice of `PCB_EDIT_FRAME` the file-level export and import read. */
export interface SpecctraFrame {
  GetBoard(): BOARD | null;
}

/**
 * `PCB_EDIT_FRAME::ExportSpecctraFile`: `ExportBoardToSpecctraFile` with the
 * frame's error handling. `ok` is false with `error` set when the export threw
 * ("Unable to export, please fix and try again"); `warning` carries the
 * "Board outline is malformed. Run DRC for a full analysis." log line.
 */
export function ExportSpecctraFile(
  aFrame: SpecctraFrame,
  aFullFilename: string,
): { ok: boolean; text?: string; warning?: string; error?: string } {
  const board = aFrame.GetBoard();

  if (!board) return { ok: false, error: 'No board' };

  try {
    const { text, outlineOk } = ExportBoardToSpecctraFile(board, aFullFilename);

    return {
      ok: true,
      text,
      ...(outlineOk ? {} : { warning: 'Board outline is malformed. Run DRC for a full analysis.' }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
