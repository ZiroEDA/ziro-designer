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
import { IsExternalCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
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
import { TEARDROP_TYPE } from './teardrop_parameters.js';
import {
  TD_TYPE_PADVIA,
  TD_TYPE_TRACKEND,
  type TEARDROP_VARIANT,
  TEARDROP_UTILS,
} from './teardrop_utils.js';

/** The slice of TOOL_MANAGER the manager holds (it only keeps the pointer). */
export type TOOL_MANAGER_LIKE = object;

// The first priority level of a teardrop area (arbitrary value)
const MAGIC_TEARDROP_ZONE_ID = 30000;

const INT_MAX = 2147483647;

export class TEARDROP_MANAGER extends TEARDROP_UTILS {
  static readonly TD_TYPE_PADVIA = TD_TYPE_PADVIA;
  static readonly TD_TYPE_TRACKEND = TD_TYPE_TRACKEND;

  private m_toolManager: TOOL_MANAGER_LIKE | null;
  private m_prmsList: TEARDROP_PARAMETERS_LIST; // the teardrop parameters list, from the board design settings
  private m_createdTdList: ZONE[] = []; // list of new created teardrops

  constructor(aBoard: BOARD, aToolManager: TOOL_MANAGER_LIKE | null) {
    super(aBoard);
    this.m_toolManager = aToolManager;
    this.m_prmsList = this.m_board.GetDesignSettings().GetTeadropParamsList();
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
}
