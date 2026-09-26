// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/teardrop/teardrop.h`, `teardrop.cpp` and `teardrop_utils.cpp`:
 * TEARDROP_MANAGER, the teardrop zones a BOARD_COMMIT rebuilds around the
 * pads, vias and track ends it touched. The C++ spreads the class over two
 * files; it is one class here.
 *
 * Some calculations (mainly computeCurvedForRoundShape) are derived from
 * https://github.com/NilujePerchut/kicad_scripts/tree/master/teardrops
 */
import type { COMMIT } from '@ziroeda/common/commit.js';
import { type EDA_ITEM_FLAGS, STARTPOINT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { kiidCombine, kiidIncrement } from '@ziroeda/common/kiid.js';
import { IsExternalCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import {
  ERROR_LOC,
  transformCircleToPolygonSet,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import { buildConvexHull } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import {
  type INTERSECTIONS,
  SHAPE_LINE_CHAIN,
} from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  add,
  EuclideanNorm,
  EuclideanNormI,
  equal,
  ResizeI,
  sub,
  type Vec2,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import { ADD_MODE } from '../board_item_container.js';
import { DRC_RTREE } from '../drc/drc_rtree.js';
import { PAD } from '../pad.js';
import { PAD_SHAPE } from '../padstack.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { ZONE } from '../zone.js';
import { ISLAND_REMOVAL_MODE, ZONE_BORDER_DISPLAY_STYLE, ZONE_SETTINGS } from '../zone_settings.js';
import { ZONE_CONNECTION } from '../zones.js';
import {
  TARGET_TRACK,
  type TEARDROP_PARAMETERS,
  type TEARDROP_PARAMETERS_LIST,
} from './teardrop_parameters.js';
import { TEARDROP_TYPE } from './teardrop_types.js';

/** The slice of TOOL_MANAGER the manager holds (it only keeps the pointer). */
export type TOOL_MANAGER_LIKE = object;

// The first priority level of a teardrop area (arbitrary value)
const MAGIC_TEARDROP_ZONE_ID = 30000;

const INT_MAX = 2147483647;

// A class to store tracks grouped by layer and netcode
export class TRACK_BUFFER {
  // Track buffer, tracks are grouped by layer+netcode
  // std::map<int, ...>: ascending index order
  private m_map_tracks = new Map<number, PCB_TRACK[]>();

  AddTrack(aTrack: PCB_TRACK, aLayer: number, aNetcode: number): void {
    const idx = this.idxFromLayNet(aLayer, aNetcode);
    let buffer = this.m_map_tracks.get(idx);

    if (!buffer) {
      buffer = [];
      this.m_map_tracks.set(idx, buffer);
    }

    buffer.push(aTrack);
  }

  GetTrackList(aLayer: number, aNetcode: number): PCB_TRACK[] {
    const list = this.m_map_tracks.get(this.idxFromLayNet(aLayer, aNetcode));
    if (!list) throw new Error('std::map::at');
    return list;
  }

  /** `GetBuffer()`: the map in key order. */
  GetBuffer(): [number, PCB_TRACK[]][] {
    return [...this.m_map_tracks.entries()].sort((a, b) => a[0] - b[0]);
  }

  static GetNetcodeAndLayerFromIndex(aIdx: number): { layer: number; netcode: number } {
    return { layer: aIdx & 0xff, netcode: aIdx >> 8 };
  }

  // Build an index from the layer id and the netcode, to store a track in buffer
  private idxFromLayNet(aLayer: number, aNetcode: number): number {
    return (aNetcode << 8) + (aLayer & 0xff);
  }
}

export enum TEARDROP_VARIANT {
  TD_TYPE_PADVIA, // Specify a teardrop on a pad via
  TD_TYPE_TRACKEND, // specify a teardrop on a rond end of a wide track
}
export const { TD_TYPE_PADVIA, TD_TYPE_TRACKEND } = TEARDROP_VARIANT;

/**
 * @return a vector unit length from aVector
 */
function NormalizeVector(aVector: Vec2): Vec2 {
  const norm = EuclideanNorm(aVector);
  return { x: aVector.x / norm, y: aVector.y / norm };
}

/** `VECTOR2I( double, double )`: the C++ truncates. */
function vecI(x: number, y: number): VECTOR2I {
  return { x: Math.trunc(x), y: Math.trunc(y) };
}

/**
 * Helper to compute a control point for a teardrop anchor on a rounded rectangle corner.
 * The control point is placed along the tangent to the corner arc at the anchor point,
 * in the direction that best aligns with the desired direction (typically toward the track).
 *
 * @param aAnchor the anchor point on the pad edge
 * @param aCornerCenter the center of the corner arc
 * @param aBias the distance from the anchor to place the control point
 * @param aDesiredDir the direction we want the control point to go (toward track)
 * @return the computed control point
 */
function computeCornerTangentControlPoint(
  aAnchor: VECTOR2I,
  aCornerCenter: VECTOR2I,
  aBias: number,
  aDesiredDir: VECTOR2I,
): VECTOR2I {
  const radial = sub(aAnchor, aCornerCenter);

  if (EuclideanNormI(radial) === 0) return aAnchor;

  // Tangent is perpendicular to the radius. There are two perpendicular directions:
  // (radial.y, -radial.x) and (-radial.y, radial.x)
  // Choose the one that best aligns with the desired direction (toward the track)
  const tangent1: VECTOR2I = { x: radial.y, y: -radial.x };
  const tangent2: VECTOR2I = { x: -radial.y, y: radial.x };

  // Use dot product to determine which tangent direction aligns better with desired direction
  const dot1 = tangent1.x * aDesiredDir.x + tangent1.y * aDesiredDir.y;
  const dot2 = tangent2.x * aDesiredDir.x + tangent2.y * aDesiredDir.y;

  const tangent = dot1 > dot2 ? tangent1 : tangent2;

  return add(aAnchor, ResizeI(tangent, KiROUND(aBias)));
}

/**
 * Check if a point is on the curved (semicircular) end of an oval pad.
 * An oval is a stadium shape with semicircular caps on the ends of the minor axis.
 *
 * @param aPoint the point to check
 * @param aPadPos the pad center position
 * @param aPadSize the pad size (width, height)
 * @param aRotation the pad rotation
 * @return the semicircle center if the point is on a curved end of the oval, else null
 */
function isPointOnOvalEnd(
  aPoint: VECTOR2I,
  aPadPos: VECTOR2I,
  aPadSize: VECTOR2I,
  aRotation: EDA_ANGLE,
): VECTOR2I | null {
  // Transform point to pad-local coordinates (unrotated)
  const localPt = RotatePoint(sub(aPoint, aPadPos), aRotation);

  const halfW = Math.trunc(aPadSize.x / 2);
  const halfH = Math.trunc(aPadSize.y / 2);

  // Oval geometry: semicircle radius is min dimension / 2
  // The semicircle centers are offset along the major axis
  const radius = Math.min(halfW, halfH);
  const isHorizontal = halfW > halfH;

  let aArcCenter: VECTOR2I;

  if (isHorizontal) {
    // Semicircles at left and right ends
    const centerOffset = halfW - radius;

    // Check if point is in the curved region (beyond the straight sides)
    if (Math.abs(localPt.x) <= centerOffset) return null;

    // Determine which end
    const centerX = localPt.x > 0 ? centerOffset : -centerOffset;
    aArcCenter = { x: centerX, y: 0 };
  } else {
    // Semicircles at top and bottom ends
    const centerOffset = halfH - radius;

    // Check if point is in the curved region (beyond the straight sides)
    if (Math.abs(localPt.y) <= centerOffset) return null;

    // Determine which end
    const centerY = localPt.y > 0 ? centerOffset : -centerOffset;
    aArcCenter = { x: 0, y: centerY };
  }

  // Transform arc center back to board coordinates
  aArcCenter = RotatePoint(aArcCenter, aRotation.negate());
  aArcCenter = add(aArcCenter, aPadPos);

  return aArcCenter;
}

/**
 * Check if a point is within a rounded corner region of a rounded rectangle pad.
 * Returns the corner center if the point is in a corner arc region.
 *
 * @param aPoint the point to check
 * @param aPadPos the pad center position
 * @param aPadSize the pad size (width, height)
 * @param aCornerRadius the corner radius
 * @param aRotation the pad rotation
 * @return the corner arc center if the point is in a corner arc region, else null
 */
function isPointOnRoundedCorner(
  aPoint: VECTOR2I,
  aPadPos: VECTOR2I,
  aPadSize: VECTOR2I,
  aCornerRadius: number,
  aRotation: EDA_ANGLE,
): VECTOR2I | null {
  // Transform point to pad-local coordinates (unrotated)
  const localPt = RotatePoint(sub(aPoint, aPadPos), aRotation);

  // Half-sizes minus corner radius define the inner rectangle
  const halfW = Math.trunc(aPadSize.x / 2);
  const halfH = Math.trunc(aPadSize.y / 2);
  const innerHalfW = halfW - aCornerRadius;
  const innerHalfH = halfH - aCornerRadius;

  // Point is in corner region if it's outside the inner rectangle in both dimensions
  const inCornerX = Math.abs(localPt.x) > innerHalfW;
  const inCornerY = Math.abs(localPt.y) > innerHalfH;

  if (!inCornerX || !inCornerY) return null;

  // Determine which corner
  const cornerX = localPt.x > 0 ? innerHalfW : -innerHalfW;
  const cornerY = localPt.y > 0 ? innerHalfH : -innerHalfH;

  let aCornerCenter: VECTOR2I = { x: cornerX, y: cornerY };

  // Transform corner center back to board coordinates
  aCornerCenter = RotatePoint(aCornerCenter, aRotation.negate());
  aCornerCenter = add(aCornerCenter, aPadPos);

  return aCornerCenter;
}

/** `TransformCircleToPolygon( SHAPE_POLY_SET& … )` on an existing set. */
function transformCircleToPolygon(
  aBuffer: SHAPE_POLY_SET,
  aCenter: VECTOR2I,
  aRadius: number,
  aError: number,
  aErrorLoc: ERROR_LOC,
  aMinSegCount: number,
): void {
  aBuffer.NewOutline();
  for (const corner of transformCircleToPolygonSet(
    aCenter,
    aRadius,
    aError,
    aErrorLoc,
    aMinSegCount,
  ))
    aBuffer.Append(corner);
}

export class TEARDROP_MANAGER {
  static readonly TD_TYPE_PADVIA = TD_TYPE_PADVIA;
  static readonly TD_TYPE_TRACKEND = TD_TYPE_TRACKEND;

  private m_tolerance: number; // max dist between track end point and pad/via
  //   center to see them connected to ut a teardrop
  private m_board: BOARD;
  private m_toolManager: TOOL_MANAGER_LIKE | null;
  private m_prmsList: TEARDROP_PARAMETERS_LIST; // the teardrop parameters list, from the board design settings
  private m_tracksRTree = new DRC_RTREE();
  private m_trackLookupList = new TRACK_BUFFER();
  private m_createdTdList: ZONE[] = []; // list of new created teardrops

  constructor(aBoard: BOARD, aToolManager: TOOL_MANAGER_LIKE | null) {
    this.m_board = aBoard;
    this.m_toolManager = aToolManager;
    this.m_prmsList = this.m_board.GetDesignSettings().GetTeadropParamsList();
    this.m_tolerance = 0;
  }

  private createTeardrop(
    aTeardropVariant: TEARDROP_VARIANT,
    aPoints: readonly VECTOR2I[],
    aTrack: PCB_TRACK,
    aCandidate: BOARD_ITEM,
  ): ZONE {
    const teardrop = new ZONE(this.m_board);

    // Create a deterministic UUID from the track and candidate UUIDs so that teardrops
    // maintain stable ordering in the output file across save/load cycles.
    (teardrop as { m_Uuid: string }).m_Uuid = kiidCombine(aTrack.m_Uuid, aCandidate.m_Uuid);

    // teardrop settings are the last zone settings used by a zone dialog.
    // override them by default.
    ZONE_SETTINGS.GetDefaultSettings().ExportSetting(teardrop, false);

    // Add zone properties (priority will be fixed later)
    teardrop.SetTeardropAreaType(
      aTeardropVariant === TD_TYPE_PADVIA ? TEARDROP_TYPE.TD_VIAPAD : TEARDROP_TYPE.TD_TRACKEND,
    );
    teardrop.SetLayer(aTrack.GetLayer());
    teardrop.SetNetCode(aTrack.GetNetCode());
    teardrop.SetLocalClearance(0);
    teardrop.SetMinThickness(pcbIUScale.mmToIU(0.0254)); // The minimum zone thickness
    teardrop.SetPadConnection(ZONE_CONNECTION.FULL);
    teardrop.SetIsFilled(false);
    teardrop.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.NEVER);
    teardrop.SetBorderDisplayStyle(ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER, 0, false);

    const outline = teardrop.Outline();
    outline.NewOutline();

    for (const pt of aPoints) outline.Append(pt.x, pt.y);

    // Until we know better (ie: pay for a potentially very expensive zone refill), the teardrop
    // fill is the same as its outline.
    teardrop.SetFilledPolysList(aTrack.GetLayer(), teardrop.Outline());
    teardrop.SetIsFilled(true);

    // Used in priority calculations:
    teardrop.CalculateFilledArea();

    return teardrop;
  }

  private createTeardropMask(
    aTeardropVariant: TEARDROP_VARIANT,
    aPoints: readonly VECTOR2I[],
    aTrack: PCB_TRACK,
    aCandidate: BOARD_ITEM,
  ): ZONE {
    const teardrop = new ZONE(this.m_board);

    // Create a deterministic UUID from the track and candidate UUIDs, then increment it
    // to differentiate from the copper teardrop zone.
    let maskUuid = kiidCombine(aTrack.m_Uuid, aCandidate.m_Uuid);
    maskUuid = kiidIncrement(maskUuid);
    (teardrop as { m_Uuid: string }).m_Uuid = maskUuid;

    teardrop.SetTeardropAreaType(
      aTeardropVariant === TD_TYPE_PADVIA ? TEARDROP_TYPE.TD_VIAPAD : TEARDROP_TYPE.TD_TRACKEND,
    );
    teardrop.SetLayer(
      aTrack.GetLayer() === PCB_LAYER_ID.F_Cu ? PCB_LAYER_ID.F_Mask : PCB_LAYER_ID.B_Mask,
    );
    teardrop.SetMinThickness(pcbIUScale.mmToIU(0.0254)); // The minimum zone thickness
    teardrop.SetIsFilled(false);
    teardrop.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.NEVER);
    teardrop.SetBorderDisplayStyle(ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER, 0, false);

    const outline = teardrop.Outline();
    outline.NewOutline();

    for (const pt of aPoints) outline.Append(pt.x, pt.y);

    const expansion = aTrack.GetSolderMaskExpansion();

    if (expansion) {
      // The zone-min-thickness deflate/reinflate is going to round corners, so it's more
      // efficient to allow acute corners on the solder mask expansion here, and delegate the
      // rounding to the deflate/reinflate.
      teardrop.SetMinThickness(Math.max(teardrop.GetMinThickness(), expansion));
      outline.Inflate(
        expansion,
        CornerStrategy.ALLOW_ACUTE_CORNERS,
        this.m_board.GetDesignSettings().m_MaxError,
      );
    }

    // Until we know better (ie: pay for a potentially very expensive zone refill), the teardrop
    // fill is the same as its outline.
    teardrop.SetFilledPolysList(teardrop.GetLayer(), teardrop.Outline());
    teardrop.SetIsFilled(true);

    return teardrop;
  }

  private createAndAddTeardropWithMask(
    aCommit: COMMIT,
    aTeardropVariant: TEARDROP_VARIANT,
    aPoints: readonly VECTOR2I[],
    aTrack: PCB_TRACK,
    aCandidate: BOARD_ITEM,
  ): void {
    const new_teardrop = this.createTeardrop(aTeardropVariant, aPoints, aTrack, aCandidate);
    this.m_board.Add(new_teardrop, ADD_MODE.BULK_INSERT);
    this.m_createdTdList.push(new_teardrop);
    aCommit.Added(new_teardrop);

    if (aTrack.HasSolderMask() && IsExternalCopperLayer(aTrack.GetLayer())) {
      const new_teardrop_mask = this.createTeardropMask(
        aTeardropVariant,
        aPoints,
        aTrack,
        aCandidate,
      );
      this.m_board.Add(new_teardrop_mask, ADD_MODE.BULK_INSERT);
      aCommit.Added(new_teardrop_mask);
    }
  }

  private tryCreateTrackTeardrop(
    aCommit: COMMIT,
    aParams: TEARDROP_PARAMETERS,
    aTeardropVariant: TEARDROP_VARIANT,
    aTrack: PCB_TRACK,
    aCandidate: BOARD_ITEM,
    aPos: VECTOR2I,
  ): boolean {
    const points: VECTOR2I[] = [];

    if (this.computeTeardropPolygon(aParams, points, aTrack, aCandidate, aPos)) {
      this.createAndAddTeardropWithMask(aCommit, aTeardropVariant, points, aTrack, aCandidate);
      return true;
    }

    return false;
  }

  RemoveTeardrops(
    aCommit: COMMIT,
    dirtyPadsAndVias: readonly BOARD_ITEM[],
    dirtyTracks: ReadonlySet<PCB_TRACK>,
  ): void {
    const connectivity = this.m_board.GetConnectivity();

    const isStale = (zone: ZONE): boolean => {
      const connectedPads: PAD[] = [];
      const connectedVias: PCB_VIA[] = [];

      connectivity.GetConnectedPadsAndVias(zone, connectedPads, connectedVias);

      for (const pad of connectedPads) {
        if (dirtyPadsAndVias.includes(pad)) return true;
      }

      for (const via of connectedVias) {
        if (dirtyPadsAndVias.includes(via)) return true;
      }

      for (const track of connectivity.GetConnectedTracks(zone)) {
        if (dirtyTracks.has(track)) return true;
      }

      return false;
    };

    for (const zone of this.m_board.Zones()) {
      if (zone.IsTeardropArea() && isStale(zone)) zone.SetFlags(STRUCT_DELETED);
    }

    this.m_board.BulkRemoveStaleTeardrops(aCommit);
  }

  UpdateTeardrops(
    aCommit: COMMIT,
    dirtyPadsAndVias: readonly BOARD_ITEM[],
    dirtyTracks: ReadonlySet<PCB_TRACK>,
    aForceFullUpdate = false,
  ): void {
    if (this.m_board.LegacyTeardrops()) return;

    // Init parameters:
    this.m_tolerance = pcbIUScale.mmToIU(0.01);

    this.BuildTrackCaches();

    // Old teardrops must be removed, to ensure a clean teardrop rebuild
    if (aForceFullUpdate) {
      for (const zone of this.m_board.Zones()) {
        if (zone.IsTeardropArea()) zone.SetFlags(STRUCT_DELETED);
      }

      this.m_board.BulkRemoveStaleTeardrops(aCommit);
    }

    const connectivity = this.m_board.GetConnectivity();

    for (const track of this.m_board.Tracks()) {
      if (!(track.Type() === KICAD_T.PCB_TRACE_T || track.Type() === KICAD_T.PCB_ARC_T)) continue;

      const connectedPads: PAD[] = [];
      const connectedVias: PCB_VIA[] = [];

      connectivity.GetConnectedPadsAndVias(track, connectedPads, connectedVias);

      const forceUpdate = aForceFullUpdate || dirtyTracks.has(track);

      for (const pad of connectedPads) {
        if (!forceUpdate && !dirtyPadsAndVias.includes(pad)) continue;

        const tdParams = pad.GetTeardropParams();
        const padSize = pad.GetSize(track.GetLayer());
        const annularWidth = Math.min(padSize.x, padSize.y);

        if (!tdParams.m_Enabled) continue;

        // Ensure a teardrop shape can be built: track width must be < teardrop width and
        // filter width
        if (
          track.GetWidth() >= tdParams.m_TdMaxWidth ||
          track.GetWidth() >= annularWidth * tdParams.m_BestWidthRatio ||
          track.GetWidth() >= annularWidth * tdParams.m_WidthtoSizeFilterRatio
        ) {
          continue;
        }

        const startHitsPad = pad.HitTest(track.GetStart(), 0, track.GetLayer());
        const endHitsPad = pad.HitTest(track.GetEnd(), 0, track.GetLayer());

        // The track is entirely inside the pad; cannot create a teardrop
        if (startHitsPad && endHitsPad) continue;

        // Reject tangential grazes, but keep short radial entries.
        if (
          startHitsPad !== endHitsPad &&
          this.computeChordThroughShape(
            track,
            pad,
            track.GetLayer(),
            startHitsPad ? track.GetStart() : track.GetEnd(),
          ) < track.GetWidth()
        ) {
          continue;
        }

        // Skip case where pad and the track are within a copper zone with the same net
        // (and the pad can be connected to the zone)
        if (!tdParams.m_TdOnPadsInZones && this.areItemsInSameZone(pad, track)) continue;

        this.tryCreateTrackTeardrop(
          aCommit,
          tdParams,
          TD_TYPE_PADVIA,
          track,
          pad,
          pad.GetPosition(),
        );

        // A track can be connected to pad when just crossing it. So we can create 2 teardrops,
        // one from pad to track start point and the other to track end point.
        // However this is acceptable only if the pad position is inside the track.
        // Otherwise the 2 teardrop shapes can be strange (and of course incorrect
        if (!startHitsPad && !endHitsPad && track.HitTest(pad.GetPosition())) {
          const reversed = PCB_TRACK.copyOf(track);
          reversed.SetStart(track.GetEnd());
          reversed.SetEnd(pad.GetPosition());
          this.tryCreateTrackTeardrop(
            aCommit,
            tdParams,
            TD_TYPE_PADVIA,
            reversed,
            pad,
            pad.GetPosition(),
          );

          reversed.SetStart(track.GetStart());
          this.tryCreateTrackTeardrop(
            aCommit,
            tdParams,
            TD_TYPE_PADVIA,
            reversed,
            pad,
            pad.GetPosition(),
          );
        }
      }

      for (const via of connectedVias) {
        if (!forceUpdate && !dirtyPadsAndVias.includes(via)) continue;

        const tdParams = via.GetTeardropParams();
        const annularWidth = via.GetWidth(track.GetLayer());

        if (!tdParams.m_Enabled) continue;

        // Ensure a teardrop shape can be built: track width must be < teardrop width and
        // filter width
        if (
          track.GetWidth() >= tdParams.m_TdMaxWidth ||
          track.GetWidth() >= annularWidth * tdParams.m_BestWidthRatio ||
          track.GetWidth() >= annularWidth * tdParams.m_WidthtoSizeFilterRatio
        ) {
          continue;
        }

        const startHitsVia = via.HitTest(track.GetStart());
        const endHitsVia = via.HitTest(track.GetEnd());

        // The track is entirely inside the via; cannot create a teardrop
        if (startHitsVia && endHitsVia) continue;

        // Reject tangential grazes, but keep short radial entries.
        if (
          startHitsVia !== endHitsVia &&
          this.computeChordThroughShape(
            track,
            via,
            track.GetLayer(),
            startHitsVia ? track.GetStart() : track.GetEnd(),
          ) < track.GetWidth()
        ) {
          continue;
        }

        this.tryCreateTrackTeardrop(
          aCommit,
          tdParams,
          TD_TYPE_PADVIA,
          track,
          via,
          via.GetPosition(),
        );

        // A track can be connected to via when just crossing it. So we can create 2 teardrops,
        // one from via to track start point and the other to track end point.
        // However this is acceptable only if the via position is inside the track.
        // Otherwise the 2 teardrop shapes can be strange (and of course incorrect
        if (!startHitsVia && !endHitsVia && track.HitTest(via.GetPosition())) {
          const reversed = PCB_TRACK.copyOf(track);
          reversed.SetStart(track.GetEnd());
          reversed.SetEnd(via.GetPosition());
          this.tryCreateTrackTeardrop(
            aCommit,
            tdParams,
            TD_TYPE_PADVIA,
            reversed,
            via,
            via.GetPosition(),
          );

          reversed.SetStart(track.GetStart());
          this.tryCreateTrackTeardrop(
            aCommit,
            tdParams,
            TD_TYPE_PADVIA,
            reversed,
            via,
            via.GetPosition(),
          );
        }
      }
    }

    if (
      (aForceFullUpdate || dirtyTracks.size > 0) &&
      this.m_prmsList.GetParameters(TARGET_TRACK).m_Enabled
    ) {
      this.AddTeardropsOnTracks(aCommit, dirtyTracks, aForceFullUpdate);
    }

    // Now set priority of teardrops now all teardrops are added
    this.setTeardropPriorities();
  }

  DeleteTrackToTrackTeardrops(aCommit: COMMIT): void {
    for (const zone of this.m_board.Zones()) {
      if (zone.IsTeardropArea() && zone.GetTeardropAreaType() === TEARDROP_TYPE.TD_TRACKEND)
        zone.SetFlags(STRUCT_DELETED);
    }

    this.m_board.BulkRemoveStaleTeardrops(aCommit);
  }

  private setTeardropPriorities(): void {
    // Note: a teardrop area is on only one layer, so using GetFirstLayer() is OK
    // to know the zone layer of a teardrop
    let priority_base = MAGIC_TEARDROP_ZONE_ID;

    // The sort function to sort by increasing copper layers. Group by layers.
    // For same layers sort by decreasing areas
    const compareLess = (a: ZONE, b: ZONE): boolean => {
      if (a.GetFirstLayer() === b.GetFirstLayer()) {
        if (a.GetOutlineArea() !== b.GetOutlineArea())
          return a.GetOutlineArea() > b.GetOutlineArea();

        return a.m_Uuid < b.m_Uuid; // stable tiebreak
      }

      return a.GetFirstLayer() < b.GetFirstLayer();
    };

    for (const td of this.m_createdTdList) td.CalculateOutlineArea();

    stdSort(this.m_createdTdList, compareLess);

    let curr_layer = -1;

    for (const td of this.m_createdTdList) {
      if (td.GetFirstLayer() !== curr_layer) {
        curr_layer = td.GetFirstLayer();
        priority_base = MAGIC_TEARDROP_ZONE_ID;
      }

      td.SetAssignedPriority(priority_base++);
    }
  }

  AddTeardropsOnTracks(
    aCommit: COMMIT,
    aTracks: ReadonlySet<PCB_TRACK>,
    aForceFullUpdate = false,
  ): void {
    const connectivity = this.m_board.GetConnectivity();
    const params = this.m_prmsList.GetParameters(TARGET_TRACK).clone();

    // Explore groups (a group is a set of tracks on the same layer and the same net):
    for (const grp of this.m_trackLookupList.GetBuffer()) {
      const sublist = grp[1];

      if (sublist.length <= 1)
        // We need at least 2 track segments
        continue;

      // The sort function to sort by increasing track widths
      const compareLess = (a: PCB_TRACK, b: PCB_TRACK): boolean => a.GetWidth() < b.GetWidth();

      stdSort(sublist, compareLess);

      let min_width = sublist[0]!.GetWidth();
      const max_width = sublist[sublist.length - 1]!.GetWidth();

      // Skip groups having the same track thickness
      if (max_width === min_width) continue;

      for (let ii = 0; ii < sublist.length - 1; ii++) {
        const track = sublist[ii]!;
        const track_len = Math.trunc(track.GetLength());
        const track_needs_update = aForceFullUpdate || aTracks.has(track);
        min_width = track.GetWidth();

        // to avoid creating a teardrop between 2 tracks having similar widths give a threshold
        params.m_WidthtoSizeFilterRatio = Math.max(params.m_WidthtoSizeFilterRatio, 0.1);
        const th = 1.0 / params.m_WidthtoSizeFilterRatio;
        min_width = KiROUND(min_width * th);

        for (let jj = ii + 1; jj < sublist.length; jj++) {
          // Search candidates with thickness > curr thickness
          const candidate = sublist[jj]!;

          if (min_width >= candidate.GetWidth()) continue;

          // Cannot build a teardrop on a too short track segment.
          // The min len is > candidate radius
          if (track_len <= Math.trunc(candidate.GetWidth() / 2)) continue;

          // Now test end to end connection:
          let match_points: EDA_ITEM_FLAGS; // to return the end point EDA_ITEM_FLAGS:
          // 0, STARTPOINT, ENDPOINT

          let pos = candidate.GetStart();
          match_points = track.IsPointOnEnds(pos, this.m_tolerance);

          if (!match_points) {
            pos = candidate.GetEnd();
            match_points = track.IsPointOnEnds(pos, this.m_tolerance);
          }

          if (!match_points) continue;

          if (!track_needs_update && aTracks.has(candidate)) continue;

          // Pads/vias have priority for teardrops; ensure there isn't one at our position
          let existingPadOrVia = false;
          const connectedPads: PAD[] = [];
          const connectedVias: PCB_VIA[] = [];

          connectivity.GetConnectedPadsAndVias(track, connectedPads, connectedVias);

          for (const pad of connectedPads) {
            if (pad.HitTest(pos)) existingPadOrVia = true;
          }

          for (const via of connectedVias) {
            if (via.HitTest(pos)) existingPadOrVia = true;
          }

          if (existingPadOrVia) continue;

          this.tryCreateTrackTeardrop(aCommit, params, TD_TYPE_TRACKEND, track, candidate, pos);
        }
      }
    }
  }

  static GetWidth(aItem: BOARD_ITEM, aLayer: PCB_LAYER_ID): number {
    if (aItem.Type() === KICAD_T.PCB_VIA_T) {
      const via = aItem as PCB_VIA;
      return via.GetWidth(aLayer);
    }
    if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      const pad = aItem as PAD;
      return Math.min(pad.GetSize(aLayer).x, pad.GetSize(aLayer).y);
    }
    if (aItem.Type() === KICAD_T.PCB_TRACE_T || aItem.Type() === KICAD_T.PCB_ARC_T) {
      const track = aItem as PCB_TRACK;
      return track.GetWidth();
    }

    return 0;
  }

  static IsRound(aItem: BOARD_ITEM, aLayer: PCB_LAYER_ID): boolean {
    if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      const pad = aItem as PAD;
      return (
        pad.GetShape(aLayer) === PAD_SHAPE.CIRCLE ||
        (pad.GetShape(aLayer) === PAD_SHAPE.OVAL && pad.GetSize(aLayer).x === pad.GetSize(aLayer).y)
      );
    }

    return true;
  }

  BuildTrackCaches(): void {
    for (const track of this.m_board.Tracks()) {
      if (track.Type() === KICAD_T.PCB_TRACE_T || track.Type() === KICAD_T.PCB_ARC_T) {
        this.m_tracksRTree.Insert(track, track.GetLayer());
        this.m_trackLookupList.AddTrack(track, track.GetLayer(), track.GetNetCode());
      }
    }
  }

  private areItemsInSameZone(aPadOrVia: BOARD_ITEM, aTrack: PCB_TRACK): boolean {
    const layer = aTrack.GetLayer();

    for (const zone of this.m_board.Zones()) {
      // Skip teardrops
      if (zone.IsTeardropArea()) continue;

      // Only consider zones on the same layer as the track
      if (!zone.IsOnLayer(layer)) continue;

      if (zone.GetNetCode() !== aTrack.GetNetCode()) continue;

      // The zone must have filled copper on this layer to provide a connection
      if (!zone.HasFilledPolysForLayer(layer)) continue;

      const fill = zone.GetFilledPolysList(layer);

      if (!fill || fill.IsEmpty()) continue;

      // Check if the zone's filled copper actually contains both the pad/via and the track.
      // The zone outline might contain these items, but the actual fill might not reach them
      // due to thermal settings, minimum width, island removal, etc.
      const padPos = aPadOrVia.GetPosition();

      if (!fill.Contains(padPos)) continue;

      // Also verify the track is within the filled zone (check both endpoints)
      if (!fill.Contains(aTrack.GetStart()) && !fill.Contains(aTrack.GetEnd())) continue;

      // If the first item is a pad, ensure it can be connected to the zone
      if (aPadOrVia.Type() === KICAD_T.PCB_PAD_T) {
        const pad = aPadOrVia as PAD;

        if (
          zone.GetPadConnection() === ZONE_CONNECTION.NONE ||
          pad.GetZoneConnectionOverrides(null) === ZONE_CONNECTION.NONE
        ) {
          return false;
        }
      }

      return true;
    }

    return false;
  }

  /// Return the centerline chord length through aOther's copper span at aInsidePoint.
  /// Degenerate, arc, or non-crossing cases return INT_MAX to avoid rejection.
  private computeChordThroughShape(
    aTrack: PCB_TRACK,
    aOther: BOARD_ITEM,
    aLayer: PCB_LAYER_ID,
    aInsidePoint: VECTOR2I,
  ): number {
    // Arcs are genuine entries, not the short straight grazes this filter targets.
    if (aTrack.Type() === KICAD_T.PCB_ARC_T) return INT_MAX;

    const delta: Vec2 = sub(aTrack.GetEnd(), aTrack.GetStart());
    const len = EuclideanNorm(delta);

    if (len === 0.0) return INT_MAX;

    const maxError = this.m_board.GetDesignSettings().m_MaxError;
    const radius = Math.trunc(TEARDROP_MANAGER.GetWidth(aOther, aLayer) / 2);
    const shapebuffer = new SHAPE_POLY_SET();

    if (TEARDROP_MANAGER.IsRound(aOther, aLayer)) {
      transformCircleToPolygon(
        shapebuffer,
        aOther.GetPosition(),
        radius,
        maxError,
        ERROR_LOC.ERROR_INSIDE,
        16,
      );
    } else {
      if (aOther.Type() !== KICAD_T.PCB_PAD_T) {
        console.assert(false, 'Expected non-round item to be PAD');
        return 0;
      }

      (aOther as PAD).TransformShapeToPolygon(
        shapebuffer,
        aLayer,
        0,
        maxError,
        ERROR_LOC.ERROR_INSIDE,
      );
    }

    // Measure the chord on the extended centerline, not the short track segment.
    // The bbox-diagonal reach spans rotated elongated pads.
    const dir: Vec2 = { x: delta.x / len, y: delta.y / len };
    const mid: VECTOR2I = {
      x: Math.trunc((aTrack.GetStart().x + aTrack.GetEnd().x) / 2),
      y: Math.trunc((aTrack.GetStart().y + aTrack.GetEnd().y) / 2),
    };
    // BOX2I::Diagonal is the integer EuclideanNorm of the size
    const reach = KiROUND(EuclideanNormI(shapebuffer.BBox().GetSize()) + len);
    const extStart = sub(mid, { x: KiROUND(dir.x * reach), y: KiROUND(dir.y * reach) });
    const extEnd = add(mid, { x: KiROUND(dir.x * reach), y: KiROUND(dir.y * reach) });

    // Include every contour and hole in the boundary crossings.
    const pts: INTERSECTIONS = [];

    for (let ii = 0; ii < shapebuffer.OutlineCount(); ++ii) {
      const outline = shapebuffer.Outline(ii);
      outline.SetClosed(true);
      outline.Intersect(new SEG(extStart, extEnd), pts);

      for (let jj = 0; jj < shapebuffer.HoleCount(ii); ++jj) {
        const hole = shapebuffer.Hole(ii, jj);
        hole.SetClosed(true);
        hole.Intersect(new SEG(extStart, extEnd), pts);
      }
    }

    // Degenerate/tangent-only crossings should not drop the teardrop.
    if (pts.length < 2) return INT_MAX;

    // Adjacent projected crossings bound copper/air spans.
    // Use the copper span bracketing the inside endpoint.
    const proj: number[] = [];

    for (const hit of pts)
      proj.push((hit.p.x - extStart.x) * dir.x + (hit.p.y - extStart.y) * dir.y);

    stdSort(proj, (a, b) => a < b);

    const insideProj =
      (aInsidePoint.x - extStart.x) * dir.x + (aInsidePoint.y - extStart.y) * dir.y;

    for (let ii = 0; ii + 1 < proj.length; ++ii) {
      const spanMid = add(extStart, {
        x: KiROUND((dir.x * (proj[ii]! + proj[ii + 1]!)) / 2),
        y: KiROUND((dir.y * (proj[ii]! + proj[ii + 1]!)) / 2),
      });

      if (!shapebuffer.Contains(spanMid)) continue;

      if (insideProj >= proj[ii]! && insideProj <= proj[ii + 1]!)
        return KiROUND(proj[ii + 1]! - proj[ii]!);
    }

    // Boundary-touch fallback: keep the teardrop.
    return INT_MAX;
  }

  private findTouchingTrack(
    aMatchType: { value: EDA_ITEM_FLAGS },
    aTrackRef: PCB_TRACK,
    aEndPoint: VECTOR2I,
  ): PCB_TRACK | null {
    let matches = 0; // Count of candidates: only 1 is acceptable
    let candidate: PCB_TRACK | null = null; // a reference to the track connected

    this.m_tracksRTree.QueryCollidingItem(
      aTrackRef,
      aTrackRef.GetLayer(),
      aTrackRef.GetLayer(),
      // Filter:
      (trackItem: BOARD_ITEM): boolean => {
        return trackItem !== aTrackRef;
      },
      // Visitor
      (trackItem: BOARD_ITEM): boolean => {
        const curr_track = trackItem as PCB_TRACK;

        // IsPointOnEnds() returns 0, EDA_ITEM_FLAGS::STARTPOINT or EDA_ITEM_FLAGS::ENDPOINT
        const match = curr_track.IsPointOnEnds(aEndPoint, this.m_tolerance);

        if (match) {
          // if faced with a Y junction, choose the track longest segment as candidate
          matches++;

          if (matches > 1) {
            const previous_len = candidate!.GetLength();
            const curr_len = curr_track.GetLength();

            if (previous_len >= curr_len) return true;
          }

          aMatchType.value = match;
          candidate = curr_track;
        }

        return true;
      },
      0,
    );

    return candidate;
  }

  /*
   * Compute the curve part points for teardrops connected to a round shape
   * The Bezier curve control points are optimized for a round pad/via shape,
   * and do not give a good curve shape for other pad shapes.
   *
   * For large circles where the teardrop width is constrained, the anchor points
   * are projected onto the circle edge to ensure proper tangent calculation.
   */
  private computeCurvedForRoundShape(
    aParams: TEARDROP_PARAMETERS,
    aPoly: VECTOR2I[],
    aLayer: PCB_LAYER_ID,
    aTrackHalfWidth: number,
    aTrackDir: Vec2,
    aOther: BOARD_ITEM,
    aOtherPos: VECTOR2I,
    pts: VECTOR2I[],
  ): void {
    const maxError = this.m_board.GetDesignSettings().m_MaxError;

    // in pts:
    // A and B are points on the track ( pts[0] and  pts[1] )
    // C and E are points on the aViaPad ( pts[2] and  pts[4] )
    // D is the aViaPad centre ( pts[3] )
    let Vpercent = aParams.m_BestWidthRatio;
    const td_height = KiROUND(TEARDROP_MANAGER.GetWidth(aOther, aLayer) * Vpercent);

    // First, calculate a aVpercent equivalent to the td_height clamped by aTdMaxHeight
    // We cannot use the initial aVpercent because it gives bad shape with points
    // on aViaPad calculated for a clamped aViaPad size
    if (aParams.m_TdMaxWidth > 0 && aParams.m_TdMaxWidth < td_height)
      Vpercent *= aParams.m_TdMaxWidth / td_height;

    let radius = Math.trunc(TEARDROP_MANAGER.GetWidth(aOther, aLayer) / 2);

    // Don't divide by zero.  No good can come of that.
    if (radius === 0) radius = 1;

    const minVpercent = aTrackHalfWidth / radius;
    const weaken = (Vpercent - minVpercent) / (1 - minVpercent) / radius;

    // For large circles where teardrop width is constrained, the anchor points from the
    // convex hull may not be exactly on the circle. Project them onto the circle edge
    // to ensure proper tangent calculation for smooth curves.
    let vecC = sub(pts[2]!, aOtherPos);
    const distC = EuclideanNorm(vecC);

    if (distC > 0 && Math.abs(distC - radius) > maxError) {
      // Point is not on the circle - project it to the circle edge
      pts[2] = add(aOtherPos, ResizeI(vecC, radius));
      vecC = sub(pts[2], aOtherPos);
    }

    let vecE = sub(pts[4]!, aOtherPos);
    const distE = EuclideanNorm(vecE);

    if (distE > 0 && Math.abs(distE - radius) > maxError) {
      // Point is not on the circle - project it to the circle edge
      pts[4] = add(aOtherPos, ResizeI(vecE, radius));
      vecE = sub(pts[4], aOtherPos);
    }

    const biasBC = 0.5 * new SEG(pts[1]!, pts[2]!).Length();
    const biasAE = 0.5 * new SEG(pts[4]!, pts[0]!).Length();

    const tangentC = vecI(
      pts[2]!.x - vecC.y * biasBC * weaken,
      pts[2]!.y + vecC.x * biasBC * weaken,
    );
    const tangentE = vecI(
      pts[4]!.x + vecE.y * biasAE * weaken,
      pts[4]!.y - vecE.x * biasAE * weaken,
    );

    const tangentB = vecI(pts[1]!.x - aTrackDir.x * biasBC, pts[1]!.y - aTrackDir.y * biasBC);
    const tangentA = vecI(pts[0]!.x - aTrackDir.x * biasAE, pts[0]!.y - aTrackDir.y * biasAE);

    let curve_pts = new BezierPoly(pts[1]!, tangentB, tangentC, pts[2]!).getPoly(maxError);

    for (const corner of curve_pts) aPoly.push(corner);

    aPoly.push(pts[3]!);

    curve_pts = new BezierPoly(pts[4]!, tangentE, tangentA, pts[0]!).getPoly(maxError);

    for (const corner of curve_pts) aPoly.push(corner);
  }

  /*
   * Compute the curve part points for teardrops connected to a rectangular/polygonal shape.
   * For rounded rectangles, control points are computed to be tangent to corner arcs,
   * preventing the teardrop curve from intersecting the pad's corner radius.
   */
  private computeCurvedForRectShape(
    _aParams: TEARDROP_PARAMETERS,
    aPoly: VECTOR2I[],
    _aTdWidth: number,
    _aTrackHalfWidth: number,
    aPts: VECTOR2I[],
    aIntersection: VECTOR2I,
    aOther: BOARD_ITEM | null,
    aOtherPos: VECTOR2I,
    aLayer: PCB_LAYER_ID,
  ): void {
    const maxError = this.m_board.GetDesignSettings().m_MaxError;

    // in aPts:
    // A and B are points on the track ( pts[0] and pts[1] )
    // C and E are points on the pad/via ( pts[2] and pts[4] )
    // D is the aViaPad centre ( pts[3] )

    // side1 is( aPts[1], aPts[2] );  from track to via
    const side1 = sub(aPts[2]!, aPts[1]!); // vector from track to via
    // side2 is ( aPts[4], aPts[0] ); from via to track
    const side2 = sub(aPts[4]!, aPts[0]!); // vector from track to via

    const trackDir = sub(aIntersection, {
      x: Math.trunc((aPts[0]!.x + aPts[1]!.x) / 2),
      y: Math.trunc((aPts[0]!.y + aPts[1]!.y) / 2),
    });

    // Check if this is a rounded rectangle or oval pad (both have curved regions)
    let isRoundRect = false;
    let isOval = false;
    let cornerRadius = 0;
    let padSize: VECTOR2I = { x: 0, y: 0 };
    let padRotation = new EDA_ANGLE(0);

    if (aOther && aOther.Type() === KICAD_T.PCB_PAD_T) {
      const pad = aOther as PAD;
      const shape = pad.GetShape(aLayer);

      if (shape === PAD_SHAPE.ROUNDRECT) {
        isRoundRect = true;
        cornerRadius = pad.GetRoundRectCornerRadius(aLayer);
        padSize = pad.GetSize(aLayer);
        padRotation = pad.GetOrientation();
      } else if (shape === PAD_SHAPE.OVAL) {
        isOval = true;
        padSize = pad.GetSize(aLayer);
        padRotation = pad.GetOrientation();
      }
    }

    // Compute control points for the first Bezier curve (track point B to pad point C)
    let ctrl1 = add(aPts[1]!, ResizeI(trackDir, Math.trunc(EuclideanNormI(side1) / 4)));
    let ctrl2: VECTOR2I;

    // Direction from pad anchor toward track (opposite of trackDir which goes pad-ward)
    const towardTrack: VECTOR2I = { x: -trackDir.x, y: -trackDir.y };

    // Default control point - midpoint approach
    ctrl2 = {
      x: Math.trunc((aPts[2]!.x + aIntersection.x) / 2),
      y: Math.trunc((aPts[2]!.y + aIntersection.y) / 2),
    };

    if (isRoundRect && cornerRadius > 0) {
      const cornerCenter = isPointOnRoundedCorner(
        aPts[2]!,
        aOtherPos,
        padSize,
        cornerRadius,
        padRotation,
      );

      if (cornerCenter) {
        // Anchor is on a corner arc - use tangent-based control point
        const bias = 0.5 * EuclideanNormI(side1);
        ctrl2 = computeCornerTangentControlPoint(aPts[2]!, cornerCenter, bias, towardTrack);
      }
    } else if (isOval) {
      const arcCenter = isPointOnOvalEnd(aPts[2]!, aOtherPos, padSize, padRotation);

      if (arcCenter) {
        // Anchor is on a curved end - use tangent-based control point
        const bias = 0.5 * EuclideanNormI(side1);
        ctrl2 = computeCornerTangentControlPoint(aPts[2]!, arcCenter, bias, towardTrack);
      }
    }

    let curve_pts = new BezierPoly(aPts[1]!, ctrl1, ctrl2, aPts[2]!).getPoly(maxError);

    for (const corner of curve_pts) aPoly.push(corner);

    aPoly.push(aPts[3]!);

    // Compute control points for second Bezier curve (pad point E to track point A)

    // Default control point - midpoint approach
    ctrl1 = {
      x: Math.trunc((aPts[4]!.x + aIntersection.x) / 2),
      y: Math.trunc((aPts[4]!.y + aIntersection.y) / 2),
    };

    if (isRoundRect && cornerRadius > 0) {
      const cornerCenter = isPointOnRoundedCorner(
        aPts[4]!,
        aOtherPos,
        padSize,
        cornerRadius,
        padRotation,
      );

      if (cornerCenter) {
        // Anchor is on a corner arc - use tangent-based control point
        const bias = 0.5 * EuclideanNormI(side2);
        ctrl1 = computeCornerTangentControlPoint(aPts[4]!, cornerCenter, bias, towardTrack);
      }
    } else if (isOval) {
      const arcCenter = isPointOnOvalEnd(aPts[4]!, aOtherPos, padSize, padRotation);

      if (arcCenter) {
        // Anchor is on a curved end - use tangent-based control point
        const bias = 0.5 * EuclideanNormI(side2);
        ctrl1 = computeCornerTangentControlPoint(aPts[4]!, arcCenter, bias, towardTrack);
      }
    }

    ctrl2 = add(aPts[0]!, ResizeI(trackDir, Math.trunc(EuclideanNormI(side2) / 4)));

    curve_pts = new BezierPoly(aPts[4]!, ctrl1, ctrl2, aPts[0]!).getPoly(maxError);

    for (const corner of curve_pts) aPoly.push(corner);
  }

  private computeAnchorPoints(
    aParams: TEARDROP_PARAMETERS,
    aLayer: PCB_LAYER_ID,
    aItem: BOARD_ITEM,
    aPos: VECTOR2I,
    aPts: VECTOR2I[],
  ): boolean {
    const maxError = this.m_board.GetDesignSettings().m_MaxError;

    // Compute the 2 anchor points on pad/via/track of the teardrop shape
    const c_buffer = new SHAPE_POLY_SET();

    // m_BestWidthRatio is the factor to calculate the teardrop preferred width.
    // teardrop width = pad, via or track size * m_BestWidthRatio (m_BestWidthRatio <= 1.0)
    // For rectangular (and similar) shapes, the preferred_width is calculated from the min
    // dim of the rectangle
    let preferred_width = KiROUND(
      TEARDROP_MANAGER.GetWidth(aItem, aLayer) * aParams.m_BestWidthRatio,
    );

    // force_clip = true to force the pad/via/track polygon to be clipped to follow
    // constraints
    // Clipping is also needed for rectangular shapes, because the teardrop shape is restricted
    // to a polygonal area smaller than the pad area (the teardrop height use the smaller value
    // of X and Y sizes).
    let force_clip = aParams.m_BestWidthRatio < 1.0;

    // To find the anchor points on the pad/via/track shape, we build the polygonal shape, and
    // clip the polygon to the max size (preferred_width or m_TdMaxWidth) by a rectangle
    // centered on the axis of the expected teardrop shape.
    // (only reduce the size of polygonal shape does not give good anchor points)
    if (TEARDROP_MANAGER.IsRound(aItem, aLayer)) {
      transformCircleToPolygon(
        c_buffer,
        aPos,
        Math.trunc(TEARDROP_MANAGER.GetWidth(aItem, aLayer) / 2),
        maxError,
        ERROR_LOC.ERROR_INSIDE,
        16,
      );
    } // Only PADS can have a not round shape
    else {
      if (aItem.Type() !== KICAD_T.PCB_PAD_T) {
        console.assert(false, 'Expected non-round item to be PAD');
        return false;
      }

      const pad = aItem as PAD;

      force_clip = true;

      preferred_width = KiROUND(TEARDROP_MANAGER.GetWidth(pad, aLayer) * aParams.m_BestWidthRatio);
      pad.TransformShapeToPolygon(c_buffer, aLayer, 0, maxError, ERROR_LOC.ERROR_INSIDE);
    }

    // Clip the pad/via/track shape to match the m_TdMaxWidth constraint, and for non-round pads,
    // clip the shape to the smallest of size.x and size.y values.
    if (force_clip || (aParams.m_TdMaxWidth > 0 && aParams.m_TdMaxWidth < preferred_width)) {
      const halfsize = Math.trunc(Math.min(aParams.m_TdMaxWidth, preferred_width) / 2);

      // teardrop_axis is the line from anchor point on the track and the end point
      // of the teardrop in the pad/via
      // this is the teardrop_axis of the teardrop shape to build
      const ref_on_track: VECTOR2I = {
        x: Math.trunc((aPts[0]!.x + aPts[1]!.x) / 2),
        y: Math.trunc((aPts[0]!.y + aPts[1]!.y) / 2),
      };
      const teardrop_axis = sub(aPts[3]!, ref_on_track);
      const orient = EDA_ANGLE.fromVector(teardrop_axis);
      const len = EuclideanNormI(teardrop_axis);

      // Build the constraint polygon: a rectangle with
      // length = dist between the point on track and the pad/via pos
      // height = m_TdMaxWidth or aViaPad.m_Width
      const clipping_rect = new SHAPE_POLY_SET();
      clipping_rect.NewOutline();

      // Build a horizontal rect: it will be rotated later
      clipping_rect.Append(0, -halfsize);
      clipping_rect.Append(0, halfsize);
      clipping_rect.Append(len, halfsize);
      clipping_rect.Append(len, -halfsize);

      clipping_rect.Rotate(orient.negate());
      clipping_rect.Move(ref_on_track);

      // Clip the shape to the max allowed teadrop area
      c_buffer.BooleanIntersection(clipping_rect);
    }

    /* in aPts:
     * A and B are points on the track ( aPts[0] and  aPts[1] )
     * C and E are points on the aViaPad ( aPts[2] and  aPts[4] )
     * D is midpoint behind the aViaPad centre ( aPts[3] )
     */

    if (c_buffer.OutlineCount() === 0) return false;

    const padpoly = c_buffer.Outline(0);
    const points = padpoly.CPoints();

    const initialPoints: VECTOR2I[] = [];
    initialPoints.push(aPts[0]!);
    initialPoints.push(aPts[1]!);

    for (const pt of points) initialPoints.push({ x: pt.x, y: pt.y });

    const hull = buildConvexHull(initialPoints);

    // Search for end points of segments starting at aPts[0] or aPts[1]
    // In some cases, in convex hull, only one point (aPts[0] or aPts[1]) is still in list
    let PointC: VECTOR2I = { x: 0, y: 0 };
    let PointE: VECTOR2I = { x: 0, y: 0 };
    let found_start = -1; // 2 points (one start and one end) should be found
    let found_end = -1;

    const start = aPts[0]!;
    const pend = aPts[1]!;

    for (let ii = 0, jj = 0; jj < hull.length; ii++, jj++) {
      let next = ii + 1;

      if (next >= hull.length) next = 0;

      let prev = ii - 1;

      if (prev < 0) prev = hull.length - 1;

      if (equal(hull[ii]!, start)) {
        // the previous or the next point is candidate:
        if (!equal(hull[next]!, pend)) PointE = hull[next]!;
        else PointE = hull[prev]!;

        found_start = ii;
      }

      if (equal(hull[ii]!, pend)) {
        if (!equal(hull[next]!, start)) PointC = hull[next]!;
        else PointC = hull[prev]!;

        found_end = ii;
      }
    }

    if (found_start < 0) {
      // PointE was not initialized, because start point does not exit
      let ii = found_end - 1;

      if (ii < 0) ii = hull.length - 1;

      PointE = hull[ii]!;
    }

    if (found_end < 0) {
      // PointC was not initialized, because end point does not exit
      let ii = found_start - 1;

      if (ii < 0) ii = hull.length - 1;

      PointC = hull[ii]!;
    }

    aPts[2] = PointC;
    aPts[4] = PointE;

    // Now we have to know if the choice aPts[2] = PointC is the best, or if
    // aPts[2] = PointE is better.
    // A criteria is to calculate the polygon area in these 2 cases, and choose the case
    // that gives the bigger area, because the segments starting at PointC and PointE
    // maximize their distance.
    const dummy1 = new SHAPE_LINE_CHAIN(aPts, true);
    const area1 = dummy1.Area();

    const t = aPts[2]!;
    aPts[2] = aPts[4]!;
    aPts[4] = t;
    const dummy2 = new SHAPE_LINE_CHAIN(aPts, true);
    const area2 = dummy2.Area();

    if (area1 > area2) {
      // The first choice (without swapping) is the better.
      const u = aPts[2]!;
      aPts[2] = aPts[4]!;
      aPts[4] = u;
    }

    return true;
  }

  private findAnchorPointsOnTrack(
    aParams: TEARDROP_PARAMETERS,
    aOut: {
      start: VECTOR2I;
      end: VECTOR2I;
      intersection: VECTOR2I;
      track: PCB_TRACK;
      effectiveTeardropLen: number;
    },
    aOther: BOARD_ITEM,
    aOtherPos: VECTOR2I,
  ): boolean {
    const found = true;
    let aTrack = aOut.track;
    let start = aTrack.GetStart(); // one reference point on the track, inside teardrop
    let end = aTrack.GetEnd(); // the second reference point on the track, outside teardrop
    const layer = aTrack.GetLayer();
    const radius = Math.trunc(TEARDROP_MANAGER.GetWidth(aOther, layer) / 2);
    const maxError = this.m_board.GetDesignSettings().m_MaxError;

    // Requested length of the teardrop:
    let targetLength = KiROUND(
      TEARDROP_MANAGER.GetWidth(aOther, layer) * aParams.m_BestLengthRatio,
    );

    if (aParams.m_TdMaxLen > 0) targetLength = Math.min(aParams.m_TdMaxLen, targetLength);

    // actualTdLen is the distance between start and the teardrop point on the segment from start to end
    let actualTdLen: number;
    let need_swap = false; // true if the start and end points of the current track are swapped

    // aTrack is expected to have one end inside the via/pad and the other end outside
    // so ensure the start point is inside the via/pad
    if (!aOther.HitTest(start, 0)) {
      const t = start;
      start = end;
      end = t;
      need_swap = true;
    }

    const shapebuffer = new SHAPE_POLY_SET();

    if (TEARDROP_MANAGER.IsRound(aOther, layer)) {
      transformCircleToPolygon(
        shapebuffer,
        aOtherPos,
        radius,
        maxError,
        ERROR_LOC.ERROR_INSIDE,
        16,
      );
    } else {
      if (aOther.Type() !== KICAD_T.PCB_PAD_T) {
        console.assert(false, 'Expected non-round item to be PAD');
        return false;
      }

      (aOther as PAD).TransformShapeToPolygon(
        shapebuffer,
        aTrack.GetLayer(),
        0,
        maxError,
        ERROR_LOC.ERROR_INSIDE,
      );
    }

    const outline = shapebuffer.Outline(0);
    outline.SetClosed(true);

    // Search the intersection point between the pad/via shape and the current track
    // This this the starting point to define the teardrop length
    const pts: INTERSECTIONS = [];
    let pt_count: number;

    if (aTrack.Type() === KICAD_T.PCB_ARC_T) {
      // To find the starting point we convert the arc to a polyline
      // and compute the intersection point with the pad/via shape
      const arc = new SHAPE_ARC(
        aTrack.GetStart(),
        (aTrack as PCB_ARC).GetMid(),
        aTrack.GetEnd(),
        aTrack.GetWidth(),
      );
      const poly = arc.ConvertToPolyline(maxError);
      pt_count = outline.Intersect(poly, pts);
    } else {
      pt_count = outline.Intersect(new SEG(start, end), pts);
    }

    // Ensure a intersection point was found, otherwise we cannot built the teardrop
    // using this track (it is fully outside or inside the pad/via shape)
    if (pt_count < 1) return false;

    aOut.intersection = pts[0]!.p;
    start = aOut.intersection; // This is currently the reference point of the teardrop length

    // actualTdLen for now the distance between start and the teardrop point on the (start end)segment
    // It cannot be bigger than the lenght of this segment
    actualTdLen = Math.min(targetLength, new SEG(start, end).Length());

    const ref_lenght_point = start; // the reference point of actualTdLen

    // If the first track is too short to allow a teardrop having the requested length
    // explore the connected track(s), and try to find a anchor point at targetLength from initial start
    if (actualTdLen < targetLength && aParams.m_AllowUseTwoTracks) {
      let consumed = 0;

      while (actualTdLen + consumed < targetLength) {
        const matchType = { value: 0 as EDA_ITEM_FLAGS };
        const connected_track = this.findTouchingTrack(matchType, aTrack, end);

        if (connected_track === null) break;

        // Reject the extension if the angle between segments is too large.
        // Large angles cause the teardrop shape to bend sharply at the junction.
        // The junction transition code handles bends up to ~60 degrees, so use
        // cos(60) = 0.5 as the threshold.
        const kMinCosForTwoSegmentExtension = 0.5;
        const firstDir = NormalizeVector(sub(end, ref_lenght_point));
        let secondDir: Vec2;

        if (matchType.value === STARTPOINT) {
          secondDir = NormalizeVector(sub(connected_track.GetEnd(), connected_track.GetStart()));
        } else {
          secondDir = NormalizeVector(sub(connected_track.GetStart(), connected_track.GetEnd()));
        }

        const cosAngle = firstDir.x * secondDir.x + firstDir.y * secondDir.y;

        if (cosAngle < kMinCosForTwoSegmentExtension) break;

        consumed += actualTdLen;
        // actualTdLen is the new distance from new start point and the teardrop anchor point
        actualTdLen = Math.min(targetLength - consumed, Math.trunc(connected_track.GetLength()));
        aTrack = connected_track;
        end = connected_track.GetEnd();
        start = connected_track.GetStart();
        need_swap = false;

        if (matchType.value !== STARTPOINT) {
          const t = start;
          start = end;
          end = t;
          need_swap = true;
        }

        // If we do not want to explore more than one connected track, stop search here
        break;
      }
    }

    // if aTrack is an arc, find the best teardrop end point on the arc
    // It is currently on the segment from arc start point to arc end point,
    // therefore not really on the arc, because we have used only the track end points.
    if (aTrack.Type() === KICAD_T.PCB_ARC_T) {
      // To find the best start and end points to build the teardrop shape, we convert
      // the arc to segments, and search for the segment having its start point at a dist
      // < actualTdLen, and its end point at adist > actualTdLen:
      const arc = new SHAPE_ARC(
        aTrack.GetStart(),
        (aTrack as PCB_ARC).GetMid(),
        aTrack.GetEnd(),
        aTrack.GetWidth(),
      );

      if (need_swap) arc.Reverse();

      const poly = arc.ConvertToPolyline(maxError);

      // Now, find the segment of the arc at a distance < actualTdLen from ref_lenght_point.
      // We just search for the first segment (starting from the farest segment) with its
      // start point at a distance < actualTdLen dist
      // This is basic, but it is probably enough.
      if (poly.PointCount() > 2) {
        // Note: the first point is inside or near the pad/via shape
        // The last point is outside and the farest from the ref_lenght_point
        // So we explore segments from the last to the first
        for (let ii = poly.PointCount() - 1; ii >= 0; ii--) {
          const dist_from_start = EuclideanNormI(sub(poly.CPoint(ii), start));

          // The first segment at a distance of the reference point < actualTdLen is OK
          // and is suitable to define the reference segment of the teardrop anchor.
          if (dist_from_start < actualTdLen || ii === 0) {
            start = poly.CPoint(ii);

            if (ii < poly.PointCount() - 1) end = poly.CPoint(ii + 1);

            // actualTdLen is the distance between start (the reference segment start point)
            // and the point on track of the teardrop.
            // This is the difference between the initial actualTdLen value and the
            // distance between start and ref_lenght_point.
            actualTdLen -= EuclideanNormI(sub(start, ref_lenght_point));

            // Ensure validity of actualTdLen: >= 0, and <= segment lenght
            if (actualTdLen < 0)
              // should not happen, but...
              actualTdLen = 0;

            actualTdLen = Math.min(actualTdLen, EuclideanNormI(sub(end, start)));

            break;
          }
        }
      }
    }

    // aStartPoint and aEndPoint will define later a segment to build the 2 anchors points
    // of the teardrop on the aTrack shape.
    // they are two points (both outside the pad/via shape) of aTrack if aTrack is a segment,
    // or a small segment on aTrack if aTrack is an ARC
    aOut.start = start;
    aOut.end = end;
    aOut.track = aTrack;
    aOut.effectiveTeardropLen = actualTdLen;

    return found;
  }

  private computeTeardropPolygon(
    aParams: TEARDROP_PARAMETERS,
    aCorners: VECTOR2I[],
    aTrackIn: PCB_TRACK,
    aOther: BOARD_ITEM,
    aOtherPos: VECTOR2I,
  ): boolean {
    // Start and end points of the track anchor of the teardrop
    // the start point is inside the teardrop shape
    // the end point is outside.
    // intersection: Where the track centerline intersects the pad/via edge
    // track_stub_len: the dist between the start point and the anchor point on the track

    // Note: aTrack can be modified if the initial track is too short.
    // Save the original pointer so we can detect two-segment extension.
    const originalTrack = aTrackIn;
    const found = {
      start: { x: 0, y: 0 } as VECTOR2I,
      end: { x: 0, y: 0 } as VECTOR2I,
      intersection: { x: 0, y: 0 } as VECTOR2I,
      track: aTrackIn,
      effectiveTeardropLen: 0,
    };

    if (!this.findAnchorPointsOnTrack(aParams, found, aOther, aOtherPos)) {
      return false;
    }

    const aTrack = found.track;
    const start = found.start;
    const end = found.end;
    const intersection = found.intersection;
    const track_stub_len = found.effectiveTeardropLen;

    // The start and end points must be different to calculate a valid polygon shape
    if (equal(start, end)) return false;

    const vecT = NormalizeVector(sub(end, start));

    // When spanning two segments, findAnchorPointsOnTrack replaces aTrack with the
    // connected track. The start point becomes the junction between the two segments,
    // which differs from intersection (where the first segment meets the pad/via edge).
    // Use the first segment's direction for all via-side geometry so that the teardrop
    // shape is oriented correctly relative to how the track enters the pad/via.
    // Note: for arcs, start also moves away from intersection during arc refinement, but
    // aTrack remains the same pointer, so arc tracks are correctly excluded here.
    const twoSegments = aTrack !== originalTrack;

    // vecVia is the direction the track enters the pad/via, used for via-side geometry.
    // When the first segment is so short that the junction coincides with the pad edge
    // intersection, start == intersection produces a zero vector whose normalization is
    // NaN. Fall back to the second segment's direction in that case.
    let vecVia = vecT;

    if (twoSegments && !equal(start, intersection))
      vecVia = NormalizeVector(sub(start, intersection));

    // find the 2 points on the track, sharp end of the teardrop
    const track_halfwidth = Math.trunc(aTrack.GetWidth() / 2);
    const pointB = add(
      start,
      vecI(
        vecT.x * track_stub_len + vecT.y * track_halfwidth,
        vecT.y * track_stub_len - vecT.x * track_halfwidth,
      ),
    );
    const pointA = add(
      start,
      vecI(
        vecT.x * track_stub_len - vecT.y * track_halfwidth,
        vecT.y * track_stub_len + vecT.x * track_halfwidth,
      ),
    );

    const layer = aTrack.GetLayer();

    // To build a polygonal valid shape pointA and point B must be outside the pad
    // It can be inside with some pad shapes having very different X and X sizes
    if (!TEARDROP_MANAGER.IsRound(aOther, layer)) {
      const pad = aOther as PAD;

      if (pad.HitTest(pointA, 0, layer)) return false;

      if (pad.HitTest(pointB, 0, layer)) return false;
    }

    // Compute pointD, the "back" point of the teardrop behind the pad/via center.
    // For off-center track connections (where the track doesn't pass through the pad center),
    // we project the pad center onto the track axis so the teardrop is built symmetrically
    // about the track rather than being skewed toward the pad center.
    const padRadius = Math.trunc(TEARDROP_MANAGER.GetWidth(aOther, layer) / 2);
    const intToPad: Vec2 = sub(aOtherPos, intersection);
    const projOnTrack = -(intToPad.x * vecVia.x + intToPad.y * vecVia.y);
    let effectiveDist = Math.max(projOnTrack, padRadius);
    const offset = pcbIUScale.mmToIU(0.001);

    // For non-round pads, clamp effectiveDist so pointD stays within the pad outline.
    // pointD is placed at effectiveDist from the intersection along -vecVia (into the pad).
    // The intersection lies on the pad edge, so the segment from the intersection into the pad
    // must exit again through the far edge. Clamp effectiveDist to that far edge so pointD can
    // never escape the pad outline. This is essential for oblique connections where the track
    // only grazes a corner of an elongated pad. There the track axis crosses the pad rather
    // than entering its body, and an unclamped projection sends pointD spiking out the side.
    if (!TEARDROP_MANAGER.IsRound(aOther, layer) && aOther.Type() === KICAD_T.PCB_PAD_T) {
      const pad = aOther as PAD;
      const maxError = this.m_board.GetDesignSettings().m_MaxError;
      const padPoly = new SHAPE_POLY_SET();
      pad.TransformShapeToPolygon(padPoly, layer, 0, maxError, ERROR_LOC.ERROR_INSIDE);

      const padOutline = padPoly.Outline(0);
      padOutline.SetClosed(true);

      // Cast the into-pad ray from the intersection well past the candidate point so a chord
      // through the pad always produces a far-edge crossing to clamp against. The reach must
      // span the longest possible chord from the entry, so use the pad's circumscribed radius
      // rather than the minor half-axis (padRadius). On an elongated pad entered along its long
      // axis the far edge sits up to two major half-axes away, and a reach scaled by the minor
      // axis stops short of it, leaving farEdge == 0 and wrongly collapsing the teardrop.
      const reach = effectiveDist + 2.0 * pad.GetBoundingRadius() + offset;
      const rayEnd = add(intersection, {
        x: KiROUND(-vecVia.x * reach),
        y: KiROUND(-vecVia.y * reach),
      });

      const hits: INTERSECTIONS = [];
      padOutline.Intersect(new SEG(intersection, rayEnd), hits);

      let farEdge = 0;

      for (const hit of hits) {
        // Ignore the crossing at the intersection point itself.
        const d = EuclideanNormI(sub(hit.p, intersection));

        if (d > offset) farEdge = Math.max(farEdge, d);
      }

      // farEdge == 0 means -vecVia does not penetrate the pad (a tangential graze); collapse
      // pointD onto the entry so the teardrop simply flares from the track to the pad edge.
      effectiveDist = Math.min(effectiveDist, Math.max(0.0, farEdge - 2.0 * offset));
    } else {
      // For round pads/vias, clamp effectiveDist so pointD stays inside the pad circle.
      // The minimum-of-padRadius floor used for projOnTrack overshoots the pad when the
      // teardrop axis (vecVia) is not radial: e.g. a two-segment teardrop where the first
      // segment grazes the pad tangentially produces a projection close to zero, but the
      // floor still pushes pointD outward by padRadius along -vecVia, creating a spike.
      // Solve for the far intersection of the ray (intersection, -vecVia) with the pad
      // circle and use that as the upper bound.
      const R = padRadius;
      const cx = intToPad.x; // (aOtherPos - intersection)
      const cy = intToPad.y;
      const distCenterSq = cx * cx + cy * cy;

      // Quadratic for ||intersection + (-vecVia)*t - aOtherPos||^2 = R^2
      // expands to t^2 - 2*projOnTrack*t + (distCenterSq - R^2) = 0.
      // The far root is projOnTrack + sqrt(projOnTrack^2 - (distCenterSq - R^2)).
      const disc = projOnTrack * projOnTrack - (distCenterSq - R * R);

      if (disc >= 0) {
        const farEdge = projOnTrack + Math.sqrt(disc);
        const maxAllowed = Math.max(0.0, farEdge - 2.0 * offset);

        if (effectiveDist > maxAllowed) effectiveDist = maxAllowed;
      }
    }

    const pointD = add(intersection, {
      x: KiROUND(-vecVia.x * (effectiveDist + offset)),
      y: KiROUND(-vecVia.y * (effectiveDist + offset)),
    });

    const pointC: VECTOR2I = { x: 0, y: 0 }; // Point on pad/via outlines
    const pointE: VECTOR2I = { x: 0, y: 0 };

    // For two-segment teardrops, compute junction edge points where the track
    // changes direction, and use the first segment side of the junction for
    // the convex hull anchor so that C and E are oriented to the via entry axis.
    let junctionB_seg2: VECTOR2I = { x: 0, y: 0 };
    let junctionB_seg1: VECTOR2I = { x: 0, y: 0 };
    let junctionA_seg2: VECTOR2I = { x: 0, y: 0 };
    let junctionA_seg1: VECTOR2I = { x: 0, y: 0 };

    if (twoSegments) {
      junctionB_seg2 = add(start, {
        x: KiROUND(vecT.y * track_halfwidth),
        y: KiROUND(-vecT.x * track_halfwidth),
      });
      junctionA_seg2 = add(start, {
        x: KiROUND(-vecT.y * track_halfwidth),
        y: KiROUND(vecT.x * track_halfwidth),
      });
      junctionB_seg1 = add(start, {
        x: KiROUND(vecVia.y * track_halfwidth),
        y: KiROUND(-vecVia.x * track_halfwidth),
      });
      junctionA_seg1 = add(start, {
        x: KiROUND(-vecVia.y * track_halfwidth),
        y: KiROUND(vecVia.x * track_halfwidth),
      });
    }

    // On the inside of a bend, the seg2 junction point backtracks relative to
    // seg1 and causes self-intersection. Detect with a dot product test and skip
    // the seg2 point on whichever side would backtrack.
    let skipJunctionA = false;
    let skipJunctionB = false;

    if (twoSegments) {
      const transA: Vec2 = sub(junctionA_seg2, junctionA_seg1);
      const anchorDirA: Vec2 = sub(pointA, junctionA_seg1);
      skipJunctionA = transA.x * anchorDirA.x + transA.y * anchorDirA.y < 0;

      const transB: Vec2 = sub(junctionB_seg2, junctionB_seg1);
      const anchorDirB: Vec2 = sub(pointB, junctionB_seg1);
      skipJunctionB = transB.x * anchorDirB.x + transB.y * anchorDirB.y < 0;
    }

    const anchorA = twoSegments ? junctionA_seg1 : pointA;
    const anchorB = twoSegments ? junctionB_seg1 : pointB;

    const pts: VECTOR2I[] = [anchorA, anchorB, pointC, pointD, pointE];

    this.computeAnchorPoints(aParams, aTrack.GetLayer(), aOther, aOtherPos, pts);

    // For off-center track connections, the convex hull produces asymmetric anchor points
    // (C and E at different distances from the track axis). Recompute them to be symmetric
    // so the teardrop flares out evenly from the track on both sides.
    if (TEARDROP_MANAGER.IsRound(aOther, layer)) {
      const perpVia: Vec2 = { x: -vecVia.y, y: vecVia.x };

      // Perpendicular distance from pad center to the track axis
      const padOffset: Vec2 = sub(aOtherPos, intersection);
      const perpDistToCenter = padOffset.x * perpVia.x + padOffset.y * perpVia.y;

      // Only apply the symmetric adjustment when the track is significantly off-center.
      if (Math.abs(perpDistToCenter) > padRadius * 0.1) {
        const d = Math.abs(perpDistToCenter);

        if (d < padRadius) {
          // The maximum symmetric half-width is limited by the shorter side, which is
          // the distance from the track axis to the nearest circle edge (R - d).
          const maxSymmetric = padRadius - d;

          // Apply the configured width ratio and max width constraints
          const preferred_width = KiROUND(
            TEARDROP_MANAGER.GetWidth(aOther, layer) * aParams.m_BestWidthRatio,
          );
          let maxHalfWidth = Math.trunc(preferred_width / 2);

          if (aParams.m_TdMaxWidth > 0)
            maxHalfWidth = Math.min(maxHalfWidth, Math.trunc(aParams.m_TdMaxWidth / 2));

          const symHalfWidth = Math.min(maxSymmetric, maxHalfWidth);

          if (symHalfWidth > track_halfwidth) {
            const center: Vec2 = aOtherPos;
            const R = padRadius;

            // Find C on the circle at perpendicular distance +symHalfWidth from track.
            // Line: p = (perpFoot + perpVia*symHalfWidth) + t * vecVia
            // Intersect with circle (center, R) and pick the point closest to
            // the intersection point (track entry side).
            const findCircleLineIntersection = (perpDist: number): VECTOR2I => {
              const projAlongTrack = padOffset.x * vecVia.x + padOffset.y * vecVia.y;
              const lineOrigin: Vec2 = {
                x: intersection.x + vecVia.x * projAlongTrack + perpVia.x * perpDist,
                y: intersection.y + vecVia.y * projAlongTrack + perpVia.y * perpDist,
              };
              const oc: Vec2 = { x: lineOrigin.x - center.x, y: lineOrigin.y - center.y };
              const b_coeff = oc.x * vecVia.x + oc.y * vecVia.y;
              const c_coeff = oc.x * oc.x + oc.y * oc.y - R * R;
              const disc = b_coeff * b_coeff - c_coeff;

              if (disc < 0) return { x: KiROUND(lineOrigin.x), y: KiROUND(lineOrigin.y) };

              const sqrtDisc = Math.sqrt(disc);
              const t1 = -b_coeff - sqrtDisc;
              const t2 = -b_coeff + sqrtDisc;

              // Pick the point on the intersection side (closer to the track entry)
              const p1: Vec2 = { x: lineOrigin.x + vecVia.x * t1, y: lineOrigin.y + vecVia.y * t1 };
              const p2: Vec2 = { x: lineOrigin.x + vecVia.x * t2, y: lineOrigin.y + vecVia.y * t2 };
              const intPt: Vec2 = intersection;

              if (EuclideanNorm(sub(p1, intPt)) < EuclideanNorm(sub(p2, intPt))) {
                return { x: KiROUND(p1.x), y: KiROUND(p1.y) };
              }

              return { x: KiROUND(p2.x), y: KiROUND(p2.y) };
            };

            // pointA is offset in +perpVia from the track axis, pointB in -perpVia
            // (see the VECTOR2I pointA/pointB construction above). pts[2] is C,
            // which lies adjacent to pointB in the teardrop walk A->B->C->D->E->A,
            // so it must sit on pointB's (-perpVia) side. Likewise pts[4] is E,
            // adjacent to pointA on the +perpVia side. Assigning the opposite signs
            // folds the polygon into a bowtie and produces self-intersecting edges
            // whenever the track is off-center enough to trigger this branch.
            pts[2] = findCircleLineIntersection(-symHalfWidth);
            pts[4] = findCircleLineIntersection(symHalfWidth);
          }
        }
      }
    }

    if (!aParams.m_CurvedEdges) {
      if (twoSegments) {
        aCorners.push(pointA);
        aCorners.push(pointB);

        if (!skipJunctionB) aCorners.push(junctionB_seg2);

        aCorners.push(pts[1]!); // junctionB_seg1
        aCorners.push(pts[2]!); // C
        aCorners.push(pts[3]!); // D
        aCorners.push(pts[4]!); // E
        aCorners.push(pts[0]!); // junctionA_seg1

        if (!skipJunctionA) aCorners.push(junctionA_seg2);
      } else {
        aCorners.length = 0;
        aCorners.push(...pts);
      }

      return true;
    }

    // See if we can use curved teardrop shape
    if (TEARDROP_MANAGER.IsRound(aOther, layer)) {
      if (twoSegments) {
        const curvePoly: VECTOR2I[] = [];
        this.computeCurvedForRoundShape(
          aParams,
          curvePoly,
          layer,
          track_halfwidth,
          vecVia,
          aOther,
          aOtherPos,
          pts,
        );

        aCorners.push(pointB);

        if (!skipJunctionB) aCorners.push(junctionB_seg2);

        for (const pt of curvePoly) aCorners.push(pt);

        if (!skipJunctionA) aCorners.push(junctionA_seg2);

        aCorners.push(pointA);
      } else {
        this.computeCurvedForRoundShape(
          aParams,
          aCorners,
          layer,
          track_halfwidth,
          vecT,
          aOther,
          aOtherPos,
          pts,
        );
      }
    } else {
      let td_width = KiROUND(TEARDROP_MANAGER.GetWidth(aOther, layer) * aParams.m_BestWidthRatio);

      if (aParams.m_TdMaxWidth > 0 && aParams.m_TdMaxWidth < td_width)
        td_width = aParams.m_TdMaxWidth;

      if (twoSegments) {
        const curvePoly: VECTOR2I[] = [];
        this.computeCurvedForRectShape(
          aParams,
          curvePoly,
          td_width,
          track_halfwidth,
          pts,
          intersection,
          aOther,
          aOtherPos,
          layer,
        );

        aCorners.push(pointB);

        if (!skipJunctionB) aCorners.push(junctionB_seg2);

        for (const pt of curvePoly) aCorners.push(pt);

        if (!skipJunctionA) aCorners.push(junctionA_seg2);

        aCorners.push(pointA);
      } else {
        this.computeCurvedForRectShape(
          aParams,
          aCorners,
          td_width,
          track_halfwidth,
          pts,
          intersection,
          aOther,
          aOtherPos,
          layer,
        );
      }
    }

    return true;
  }
}
