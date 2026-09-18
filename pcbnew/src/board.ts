// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board.h` / `pcbnew/board.cpp`: `BOARD`, information pertinent to a
 * Pcbnew printed circuit board.
 *
 * IN PROGRESS (#636): the container, the layer table with its opposites,
 * the design settings, the page, title block and plot options, the board
 * use, the file-format bookkeeping, `EMBEDDED_FILES` (the second base,
 * mixed in), `m_NetInfo`, and `Add`/`Remove` over the item collections are
 * here, with `m_connectivity`, the listeners, the outline and the
 * solder-mask bridges zone. Still to land with their classes: the DRC
 * caches (the RTree cache is declared, DRC fills it), the component-class
 * manager, the length/delay calculator, the project. `board_types.ts`
 * carries `LAYER_T`, `LAYER` and `BOARD_USE`, which C++ declares in this
 * header.
 */

import {
  CompareByUuid,
  EDA_ITEM,
  INSPECT_RESULT,
  type INSPECTOR,
  RECURSE_MODE,
} from '@ziroeda/common/src/eda_item.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { PAD_ATTRIB } from './padstack.js';
import {
  BuildBoardPolygonOutlines,
  type OUTLINE_ERROR_HANDLER,
} from './convert_shape_list_to_polygon.js';
import type { EDA_GROUP } from '@ziroeda/common/src/eda_group.js';
import { STRUCT_DELETED } from '@ziroeda/common/src/eda_item_flags.js';
import { type EdaUnits, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { type KIID, niluuid } from '@ziroeda/common/src/kiid.js';
import {
  FlipLayer as flipLayerId,
  type GAL_LAYER_ID,
  GAL_SET,
  IsBackLayer as isBackLayerId,
  IsCopperLayer,
  IsFrontLayer as isFrontLayerId,
  LayerName,
  PCB_LAYER_ID,
  ToLAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import type { OutStr } from '@ziroeda/common/src/font/font.js';
import { GetDefaultVariantName } from '@ziroeda/common/src/string_utils.js';
import { TITLE_BLOCK } from '@ziroeda/common/src/title_block.js';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/src/page_info.js';
import { applyMixins } from '@ziroeda/core/src/mixins.js';
import { PCB_PLOT_PARAMS } from './pcb_plot_params.js';
import { NETCLASS } from '@ziroeda/common/src/netclass.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_DESIGN_SETTINGS } from './board_design_settings.js';
import { BOARD_ITEM, DELETED_BOARD_ITEM } from './board_item.js';
import { ADD_MODE, BOARD_ITEM_CONTAINER, REMOVE_MODE } from './board_item_container.js';
import { type BOARD_LISTENER, HIGH_LIGHT_INFO } from './board_listener.js';
import { BOARD_USE, LAYER, LAYER_T } from './board_types.js';
import { type NETINFO_ITEM, NETINFO_LIST } from './netinfo.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_GENERATOR } from './pcb_generator.js';
import type { PCB_GROUP } from './pcb_group.js';
import type { PCB_POINT } from './pcb_point.js';
import type { PCB_MARKER } from './pcb_marker.js';
import { PCB_TABLE } from './pcb_table.js';
import { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import { EDA_SHAPE } from '@ziroeda/common/src/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import type { PCB_TRACK } from './pcb_track.js';
import type { ENDPOINT_T } from './pcb_track_types.js';
import { type ISOLATED_ISLANDS, ZONE } from './zone.js';
import { ZONE_BORDER_DISPLAY_STYLE } from './zone_settings.js';
import type { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import type { PAD } from './pad.js';
import { MARKER_T } from '@ziroeda/common/src/marker_base.js';
import { PCB_BOARD_OUTLINE } from './pcb_board_outline.js';
import type { DRC_RTREE } from './drc/drc_rtree.js';
import type { COMMIT } from '@ziroeda/common/src/commit.js';
import { CONNECTIVITY_DATA } from './connectivity/connectivity_data.js';
import { COMPONENT_CLASS_MANAGER } from './component_classes/component_class_manager.js';
import type { COMPONENT_CLASS_SETTINGS } from '@ziroeda/common/src/project/component_class_settings.js';
import type { CN_EDGE, PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';

export { BOARD_USE, LAYER, LAYER_T } from './board_types.js';

/** `DEFAULT_CHAINING_EPSILON_MM` (`board.h`): the outline-chaining tolerance. */
export const DEFAULT_CHAINING_EPSILON_MM = 0.01;

/** `LEGACY_BOARD_FILE_VERSION` (cmake/config.h.cmake:76). */
export const LEGACY_BOARD_FILE_VERSION = 2;

// `class BOARD : public BOARD_ITEM_CONTAINER, public EMBEDDED_FILES`
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (EMBEDDED_FILES mixin)
export interface BOARD extends EMBEDDED_FILES {}

/**
 * Information pertinent to a Pcbnew printed circuit board.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (EMBEDDED_FILES mixin)
export class BOARD extends BOARD_ITEM_CONTAINER {
  /**
   * Visibility settings stored in board prior to 6.0, only used for loading legacy files
   */
  m_LegacyVisibleLayers = new LSET();
  m_LegacyVisibleItems = new GAL_SET();

  /**
   * True if the legacy board design settings were loaded from a file
   */
  m_LegacyDesignSettingsLoaded: boolean;
  m_LegacyCopperEdgeClearanceLoaded: boolean;

  /**
   * True if netclasses were loaded from the file
   */
  m_LegacyNetclassesLoaded: boolean;

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_T === aItem.Type();
  }

  private m_boardUse: BOARD_USE;
  private m_timeStamp: number; // actually a modification counter
  private m_userUnits: EdaUnits = 'mm'; // BOARD::BOARD() : m_userUnits( EDA_UNITS::MM )
  private m_fileName = '';

  private m_fileFormatVersionAtLoad: number; // the version loaded from the file
  private m_generator = ''; // the generator tag from the file

  private m_paper: PAGE_INFO;
  private m_plotOptions = new PCB_PLOT_PARAMS();

  /**
   * Teardrops in 7.0 were applied as a post-processing step (rather than from pad and via
   * properties).  If this flag is set, then the teardrops are generated from pad and via
   * properties instead.
   */
  private m_legacyTeardrops = false;

  // Used for dummy boards, such as a footprint holder, where we don't want to make a copy
  // of all the parent's embedded data.
  private m_embeddedFilesDelegate: EMBEDDED_FILES | null;

  private m_designSettings: BOARD_DESIGN_SETTINGS;

  private m_properties = new Map<string, string>();

  private m_titles = new TITLE_BLOCK(); // text in lower right of screen and plots

  private m_currentVariant = ''; // Currently active variant (empty = default)
  private m_variantNames: string[] = []; // All variant names in the board
  private m_variantDescriptions = new Map<string, string>(); // Descriptions for each variant

  private m_layers = new Map<number, LAYER>();

  protected m_NetInfo: NETINFO_LIST; ///< net info list (name, design constraints...)

  // The item collections (`m_footprints`, `m_tracks` are std::deques; the rest vectors).
  protected m_drawings: BOARD_ITEM[] = [];
  protected m_footprints: FOOTPRINT[] = [];
  protected m_tracks: PCB_TRACK[] = [];
  protected m_zones: ZONE[] = [];
  protected m_generators: PCB_GENERATOR[] = [];
  protected m_markers: PCB_MARKER[] = [];
  protected m_groups: PCB_GROUP[] = [];

  private m_listeners: BOARD_LISTENER[] = [];
  private m_highLight = new HIGH_LIGHT_INFO(); // current high light data
  private m_highLightPrevious = new HIGH_LIGHT_INFO(); // a previously stored high light data
  protected m_points: PCB_POINT[] = [];

  protected m_itemByIdCache = new Map<KIID, BOARD_ITEM>();

  protected m_outlinesChainingEpsilon: number;

  // ------------ Run-time caches -------------
  // (`m_CachesMutex` guards them in the C++; there is one thread here.) The
  // PTR_PTR keys are nested Maps: outer by the first pointer, inner by the second.
  m_IntersectsCourtyardCache = new Map<BOARD_ITEM, Map<BOARD_ITEM, boolean>>();
  m_IntersectsFCourtyardCache = new Map<BOARD_ITEM, Map<BOARD_ITEM, boolean>>();
  m_IntersectsBCourtyardCache = new Map<BOARD_ITEM, Map<BOARD_ITEM, boolean>>();
  /** `PTR_PTR_LAYER_CACHE_KEY`: area -> item -> layer -> result. */
  m_IntersectsAreaCache = new Map<BOARD_ITEM, Map<BOARD_ITEM, Map<PCB_LAYER_ID, boolean>>>();
  m_EnclosedByAreaCache = new Map<BOARD_ITEM, Map<BOARD_ITEM, Map<PCB_LAYER_ID, boolean>>>();
  m_LayerExpressionCache = new Map<string, LSET>();

  /** `m_ZoneBBoxCache`: the zone bounding boxes, written by `ZONE::GetBoundingBox` (`friend class ZONE`). */
  m_ZoneBBoxCache = new Map<ZONE, BOX2I>();
  m_maxClearanceValue: number | undefined = undefined;

  m_ItemNetclassCache = new Map<BOARD_ITEM, string>();

  // Zone name lookup cache for DRC rule area functions like enclosedByArea/intersectsArea.
  // Maps zone names to vectors of matching zones to avoid O(n) zone iteration per lookup.
  m_ZonesByNameCache = new Map<string, ZONE[]>();

  // Deflated zone outline cache for DRC area checks. Caches the deflated outline for each zone
  // to avoid repeated expensive deflation operations during collidesWithArea calls.
  m_DeflatedZoneOutlineCache = new Map<ZONE, SHAPE_POLY_SET>();

  /** `std::shared_ptr<DRC_RTREE> m_CopperItemRTreeCache`, filled by DRC_CACHE_GENERATOR. */
  m_CopperItemRTreeCache: DRC_RTREE | null = null;

  /** `std::unordered_map<ZONE*, std::unique_ptr<DRC_RTREE>> m_CopperZoneRTreeCache`, filled by DRC_CACHE_GENERATOR. */
  m_CopperZoneRTreeCache = new Map<ZONE, DRC_RTREE>();

  // ------------ DRC caches -------------
  m_DRCZones: ZONE[] = [];
  m_DRCCopperZones: ZONE[] = [];
  m_DRCMaxClearance = 0;
  m_DRCMaxPhysicalClearance = 0;
  m_ZoneIsolatedIslandsMap = new Map<ZONE, Map<PCB_LAYER_ID, ISOLATED_ISLANDS>>();

  /** Zone to show sloder mask bridges created by a min web value. */
  m_SolderMaskBridges: ZONE;

  private m_boardOutline: PCB_BOARD_OUTLINE;

  private m_connectivity: CONNECTIVITY_DATA;

  private m_componentClassManager: COMPONENT_CLASS_MANAGER;

  constructor() {
    super(null, KICAD_T.PCB_T);
    this.m_LegacyDesignSettingsLoaded = false;
    this.m_LegacyCopperEdgeClearanceLoaded = false;
    this.m_LegacyNetclassesLoaded = false;
    this.m_boardUse = BOARD_USE.NORMAL;
    this.m_timeStamp = 1;
    this.m_paper = new PAGE_INFO(PAGE_SIZE_TYPE.A4);
    this.m_designSettings = new BOARD_DESIGN_SETTINGS();
    this.m_NetInfo = new NETINFO_LIST(this);
    this.m_componentClassManager = new COMPONENT_CLASS_MANAGER(this);
    this.initEmbeddedFiles();
    this.m_embeddedFilesDelegate = null;

    // we have not loaded a board yet, assume latest until then.
    this.m_fileFormatVersionAtLoad = LEGACY_BOARD_FILE_VERSION;

    // A too small value do not allow connecting 2 shapes (i.e. segments) not exactly connected
    // A too large value do not allow safely connecting 2 shapes like very short segments.
    this.m_outlinesChainingEpsilon = pcbIUScale.mmToIU(DEFAULT_CHAINING_EPSILON_MM);

    for (let layer = 0; layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++layer) {
      const entry = this.layerEntry(layer);

      entry.m_name = BOARD.GetStandardLayerName(ToLAYER_ID(layer));

      if (IsCopperLayer(layer)) entry.m_type = LAYER_T.LT_SIGNAL;
      else if (layer >= PCB_LAYER_ID.User_1 && layer & 1) entry.m_type = LAYER_T.LT_AUX;
      else entry.m_type = LAYER_T.LT_UNDEFINED;
    }

    this.recalcOpposites();

    this.m_boardOutline = new PCB_BOARD_OUTLINE(this);

    // Creates a zone to show sloder mask bridges created by a min web value
    // it it just to show them
    this.m_SolderMaskBridges = new ZONE(this);
    this.m_SolderMaskBridges.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER);
    this.m_SolderMaskBridges.SetLayerSet(
      new LSET().set(PCB_LAYER_ID.F_Mask).set(PCB_LAYER_ID.B_Mask),
    );
    const infinity = Math.trunc(2147483647 / 2) - pcbIUScale.mmToIU(1);
    this.m_SolderMaskBridges.Outline().NewOutline();
    this.m_SolderMaskBridges.Outline().Append(-infinity, -infinity);
    this.m_SolderMaskBridges.Outline().Append(-infinity, +infinity);
    this.m_SolderMaskBridges.Outline().Append(+infinity, +infinity);
    this.m_SolderMaskBridges.Outline().Append(+infinity, -infinity);
    this.m_SolderMaskBridges.SetMinThickness(0);

    const bds = this.GetDesignSettings();

    // Initialize default netclass.
    bds.m_NetSettings.SetDefaultNetclass(new NETCLASS(NETCLASS.Default));
    bds.m_NetSettings.GetDefaultNetclass().SetDescription('This is the default net class.');

    bds.UseCustomTrackViaSize(false);

    // Initialize ratsnest
    this.m_connectivity = new CONNECTIVITY_DATA();
  }

  override Visit(
    inspector: INSPECTOR,
    testData: unknown,
    scanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    let footprintsScanned = false;
    let drawingsScanned = false;
    let tracksScanned = false;

    for (const scanType of scanTypes) {
      switch (scanType) {
        case KICAD_T.PCB_T:
          if (inspector(this, testData) === INSPECT_RESULT.QUIT) return INSPECT_RESULT.QUIT;

          break;

        /*
         * Instances of the requested KICAD_T live in a list, either one that I manage, or one
         * that my footprints manage.  If it's a type managed by class FOOTPRINT, then simply
         * pass it on to each footprint's Visit() function via IterateForward( m_footprints, ... ).
         */

        case KICAD_T.PCB_FOOTPRINT_T:
        case KICAD_T.PCB_PAD_T:
        case KICAD_T.PCB_SHAPE_T:
        case KICAD_T.PCB_REFERENCE_IMAGE_T:
        case KICAD_T.PCB_FIELD_T:
        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_TEXTBOX_T:
        case KICAD_T.PCB_TABLE_T:
        case KICAD_T.PCB_TABLECELL_T:
        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        case KICAD_T.PCB_DIM_LEADER_T:
        case KICAD_T.PCB_TARGET_T:
        case KICAD_T.PCB_BARCODE_T:
          if (!footprintsScanned) {
            if (
              EDA_ITEM.IterateForward(this.m_footprints, inspector, testData, scanTypes) ===
              INSPECT_RESULT.QUIT
            ) {
              return INSPECT_RESULT.QUIT;
            }

            footprintsScanned = true;
          }

          if (!drawingsScanned) {
            if (
              EDA_ITEM.IterateForward(this.m_drawings, inspector, testData, scanTypes) ===
              INSPECT_RESULT.QUIT
            ) {
              return INSPECT_RESULT.QUIT;
            }

            drawingsScanned = true;
          }

          break;

        case KICAD_T.PCB_VIA_T:
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
          if (!tracksScanned) {
            if (
              EDA_ITEM.IterateForward(this.m_tracks, inspector, testData, scanTypes) ===
              INSPECT_RESULT.QUIT
            ) {
              return INSPECT_RESULT.QUIT;
            }

            tracksScanned = true;
          }

          break;

        case KICAD_T.PCB_MARKER_T:
          for (const marker of this.m_markers) {
            if (marker.Visit(inspector, testData, [scanType]) === INSPECT_RESULT.QUIT)
              return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_POINT_T:
          for (const point of this.m_points) {
            if (point.Visit(inspector, testData, [scanType]) === INSPECT_RESULT.QUIT)
              return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_ZONE_T:
          if (!footprintsScanned) {
            if (
              EDA_ITEM.IterateForward(this.m_footprints, inspector, testData, scanTypes) ===
              INSPECT_RESULT.QUIT
            ) {
              return INSPECT_RESULT.QUIT;
            }

            footprintsScanned = true;
          }

          for (const zone of this.m_zones) {
            if (zone.Visit(inspector, testData, [scanType]) === INSPECT_RESULT.QUIT)
              return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_GENERATOR_T:
          if (!footprintsScanned) {
            if (
              EDA_ITEM.IterateForward(this.m_footprints, inspector, testData, scanTypes) ===
              INSPECT_RESULT.QUIT
            ) {
              return INSPECT_RESULT.QUIT;
            }

            footprintsScanned = true;
          }

          if (
            EDA_ITEM.IterateForward(this.m_generators, inspector, testData, [scanType]) ===
            INSPECT_RESULT.QUIT
          ) {
            return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_GROUP_T:
          if (
            EDA_ITEM.IterateForward(this.m_groups, inspector, testData, [scanType]) ===
            INSPECT_RESULT.QUIT
          ) {
            return INSPECT_RESULT.QUIT;
          }

          break;

        default:
          break;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * Calculate the bounding box containing all board items (or board edge segments).
   *
   * @param aBoardEdgesOnly is true if we are interested in board edge segments only.
   * @param aPhysicalLayersOnly is true if we are interested in physical layers only.
   * @return the board's bounding box.
   */
  ComputeBoundingBox(aBoardEdgesOnly = false, aPhysicalLayersOnly = false): BOX2I {
    const bbox = new BOX2I();
    let visible = this.GetVisibleLayers();

    if (aPhysicalLayersOnly) visible = visible.and(LSET.PhysicalLayersMask());

    // If the board is just showing a footprint, we want all footprint layers included in the
    // bounding box
    if (this.IsFootprintHolder()) visible.set();

    if (aBoardEdgesOnly) visible.set(PCB_LAYER_ID.Edge_Cuts);

    // Check shapes, dimensions, texts, and fiducials
    for (const item of this.m_drawings) {
      if (
        aBoardEdgesOnly &&
        (item.GetLayer() !== PCB_LAYER_ID.Edge_Cuts || item.Type() !== KICAD_T.PCB_SHAPE_T)
      )
        continue;

      if (item.GetLayerSet().and(visible).any()) bbox.Merge(item.GetBoundingBox());
    }

    // Check footprints
    for (const footprint of this.m_footprints) {
      if (aBoardEdgesOnly) {
        for (const edge of footprint.GraphicalItems()) {
          if (edge.GetLayer() === PCB_LAYER_ID.Edge_Cuts && edge.Type() === KICAD_T.PCB_SHAPE_T)
            bbox.Merge(edge.GetBoundingBox());
        }
      } else if (footprint.GetLayerSet().and(visible).any()) {
        bbox.Merge(footprint.GetBoundingBox(true));
      }
    }

    if (!aBoardEdgesOnly) {
      // Check tracks
      for (const track of this.m_tracks) {
        if (track.GetLayerSet().and(visible).any()) bbox.Merge(track.GetBoundingBox());
      }

      // Check zones
      for (const aZone of this.m_zones) {
        if (aZone.GetLayerSet().and(visible).any()) bbox.Merge(aZone.GetBoundingBox());
      }

      for (const point of this.m_points) {
        bbox.Merge(point.GetBoundingBox());
      }
    }

    return bbox;
  }

  override GetBoundingBox(): BOX2I {
    return this.ComputeBoundingBox(false, false);
  }

  /**
   * Return the board bounding box calculated using exclusively the board edges (graphics
   * on Edge.Cuts layer).
   *
   * If there is no edge, inits the board bounding box to a default size of 100 mm x 100 mm.
   */
  GetBoardEdgesBoundingBox(): BOX2I {
    return this.ComputeBoundingBox(true, true);
  }

  /**
   * Extract the board outlines and build a closed polygon from lines, arcs and circle items
   * on edge cut layer.
   *
   * Any closed outline inside the main outline is a hole.  All contours should be closed,
   * i.e. have valid vertices to build a closed polygon.
   *
   * @param aOutlines is the #SHAPE_POLY_SET to fill in with outlines/holes.
   * @param aInferOutlineIfNecessary is true to build a rectangle outline from the board or
   *                                 items bounding box when no valid outline is found.
   * @param aErrorHandler is an optional DRC_ITEM error handler.
   * @param aAllowUseArcsInPolygons is an optional flag to allow adding arcs in
   *                                #SHAPE_LINE_CHAIN polylines/polygons when building outlines
   *                                from aShapeList
   * @param aIncludeNPTHAsOutlines is an optional flag to include NPTH pad holes in board
   *                               outlines.
   * @return true if success, false if a contour is not valid
   */
  GetBoardPolygonOutlines(
    aOutlines: SHAPE_POLY_SET,
    aInferOutlineIfNecessary: boolean,
    aErrorHandler: OUTLINE_ERROR_HANDLER | null = null,
    aAllowUseArcsInPolygons = false,
    aIncludeNPTHAsOutlines = false,
  ): boolean {
    // max dist from one endPt to next startPt: use the current value
    const chainingEpsilon = this.GetOutlinesChainingEpsilon();

    const success = BuildBoardPolygonOutlines(
      this,
      aOutlines,
      this.GetDesignSettings().m_MaxError,
      chainingEpsilon,
      aInferOutlineIfNecessary,
      aErrorHandler,
      aAllowUseArcsInPolygons,
    );

    // Now subtract NPTH oval holes from outlines if required
    if (aIncludeNPTHAsOutlines) {
      for (const fp of this.Footprints()) {
        for (const pad of fp.Pads()) {
          if (pad.GetAttribute() !== PAD_ATTRIB.NPTH) continue;

          const hole = new SHAPE_POLY_SET();
          pad.TransformHoleToPolygon(hole, 0, pad.GetMaxError(), ERROR_LOC.ERROR_INSIDE);

          if (hole.OutlineCount() > 0) {
            // can be not the case for malformed NPTH holes
            // Issue #20159: BooleanSubtract correctly clips holes extending past board
            // edges (common with oval holes near irregular boards). O(n log n) per hole
            // vs O(1) for AddHole, but only used for 3D viewer generation, not a hot path.
            aOutlines.BooleanSubtract(hole);
          }
        }
      }
    }

    // Make polygon strictly simple to avoid issues (especially in 3D viewer)
    aOutlines.Simplify();

    return success;
  }

  /**
   * Find a #PAD at \a aPosition on the given layers (`GetPad( const VECTOR2I&, const LSET& )`),
   * or the pad a track ends on (`GetPad( const PCB_TRACK*, ENDPOINT_T )`).
   */
  GetPad(aPosition: VECTOR2I, aLayerSet: LSET): PAD | null;
  GetPad(aTrace: PCB_TRACK, aEndPoint: ENDPOINT_T): PAD | null;
  GetPad(a: VECTOR2I | PCB_TRACK, b: LSET | ENDPOINT_T): PAD | null {
    if (!('x' in a)) {
      const aPosition = a.GetEndPoint(b as ENDPOINT_T);

      const lset = new LSET([a.GetLayer()]);

      return this.GetPad(aPosition, lset);
    }

    const aPosition = a;
    const aLayerSet = b as LSET;

    for (const footprint of this.m_footprints) {
      let pad: PAD | null = null;

      if (footprint.HitTest(aPosition))
        pad = footprint.GetPad(aPosition, aLayerSet.any() ? aLayerSet : LSET.AllCuMask());

      if (pad) return pad;
    }

    return null;
  }

  GetComponentClassManager(): COMPONENT_CLASS_MANAGER {
    return this.m_componentClassManager;
  }

  /**
   * Copy NETCLASS info to each NET, based on NET membership in a NETCLASS.
   *
   * The C++ returns early without a PROJECT, because `bds.m_NetSettings` is
   * the project file's; ours is the board's own, filled by
   * `NET_SETTINGS.LoadFromJson`, so there is no guard.
   */
  SynchronizeNetsAndNetClasses(aResetTrackAndViaSizes: boolean): void {
    const bds = this.GetDesignSettings();
    const defaultNetClass = bds.m_NetSettings.GetDefaultNetclass();

    bds.m_NetSettings.ClearAllCaches();

    for (const net of this.m_NetInfo)
      net.SetNetClass(bds.m_NetSettings.GetEffectiveNetClass(net.GetNetname()));

    if (aResetTrackAndViaSizes) {
      // Set initial values for custom track width & via size to match the default
      // netclass settings
      bds.UseCustomTrackViaSize(false);
      bds.SetCustomTrackWidth(defaultNetClass.GetTrackWidth());
      bds.SetCustomViaSize(defaultNetClass.GetViaDiameter());
      bds.SetCustomViaDrill(defaultNetClass.GetViaDrill());
      bds.SetCustomDiffPairWidth(defaultNetClass.GetDiffPairWidth());
      bds.SetCustomDiffPairGap(defaultNetClass.GetDiffPairGap());
      bds.SetCustomDiffPairViaGap(defaultNetClass.GetDiffPairViaGap());
    }

    this.InvokeListeners((l) => l.OnBoardNetSettingsChanged(this));
  }

  /**
   * Synchronise component classes with the project's assignment rules.
   *
   * `GetProject()->GetProjectFile().ComponentClassSettings()` is the C++'s
   * source; the project lands at stage 6, so the settings come in as an
   * argument until then.
   */
  SynchronizeComponentClasses(
    aSettings: COMPONENT_CLASS_SETTINGS,
    aNewSheetPaths: ReadonlySet<string>,
  ): boolean {
    return this.m_componentClassManager.SyncDynamicComponentClassAssignments(
      aSettings.GetComponentClassAssignments(),
      aSettings.GetEnableSheetComponentClasses(),
      aNewSheetPaths,
    );
  }

  GetFirstFootprint(): FOOTPRINT | null {
    return this.m_footprints.length === 0 ? null : this.m_footprints[0]!;
  }

  GetOutlinesChainingEpsilon(): number {
    return this.m_outlinesChainingEpsilon;
  }

  SetOutlinesChainingEpsilon(aValue: number): void {
    this.m_outlinesChainingEpsilon = aValue;
  }

  BuildConnectivity(aReporter: PROGRESS_REPORTER_LIKE | null = null): boolean {
    if (!this.GetConnectivity().Build(this, aReporter)) return false;

    this.UpdateRatsnestExclusions();
    return true;
  }

  /**
   * Return a list of missing connections between components/tracks.
   * @return an object that contains information about missing connections.
   */
  GetConnectivity(): CONNECTIVITY_DATA {
    return this.m_connectivity;
  }

  BoardOutline(): PCB_BOARD_OUTLINE {
    return this.m_boardOutline;
  }

  UpdateBoardOutline(): void {
    this.m_boardOutline.GetOutline().RemoveAllContours();

    const has_outline = this.GetBoardPolygonOutlines(this.m_boardOutline.GetOutline(), false);

    if (has_outline) this.m_boardOutline.GetOutline().Fracture();
  }

  UpdateRatsnestExclusions(): void {
    const m_ratsnestExclusions = new Set<string>();

    for (const marker of this.GetBoard()!.Markers()) {
      if (marker.GetMarkerType() === MARKER_T.MARKER_RATSNEST && marker.IsExcluded()) {
        const rcItem = marker.GetRCItem()!;
        m_ratsnestExclusions.add(`${rcItem.GetMainItemID()}|${rcItem.GetAuxItemID()}`);
        m_ratsnestExclusions.add(`${rcItem.GetAuxItemID()}|${rcItem.GetMainItemID()}`);
      }
    }

    this.GetConnectivity().RunOnUnconnectedEdges((aEdge: CN_EDGE) => {
      if (
        aEdge.GetSourceNode() &&
        aEdge.GetTargetNode() &&
        !aEdge.GetSourceNode()!.Dirty() &&
        !aEdge.GetTargetNode()!.Dirty()
      ) {
        const ids = `${aEdge.GetSourceNode()!.Parent().m_Uuid}|${aEdge.GetTargetNode()!.Parent().m_Uuid}`;

        aEdge.SetVisible(!m_ratsnestExclusions.has(ids));
      }

      return true;
    });
  }

  /**
   * `BOARD::CacheTriangulation` as the C++ runs it: every zone is a task of
   * `GetKiCadThreadPool()`, submitted at once, and this waits for the lot —
   * asynchronously, since a browser's main thread cannot block on a future
   * the way `wait_for( 250ms )` + `KeepRefreshing()` does. The synchronous
   * `CacheTriangulation` below then finds nothing left to do.
   */
  async CacheTriangulationAsync(
    aReporter: PROGRESS_REPORTER_LIKE | null = null,
    aZones: readonly ZONE[] = [],
  ): Promise<void> {
    let zones: readonly ZONE[] = aZones;

    if (zones.length === 0) zones = this.m_zones;

    if (zones.length === 0) return;

    if (aReporter) aReporter.Report('Tessellating copper zones...');

    const cache_zones = async (aZone: ZONE): Promise<number> => {
      if (aReporter?.IsCancelled()) return 0;

      await aZone.CacheTriangulationAsync();

      if (aReporter) aReporter.AdvanceProgress();

      return 1;
    };

    const returns: Promise<number>[] = [];

    for (const zone of zones) returns.push(cache_zones(zone));

    // Finalize the triangulation threads
    await Promise.all(returns);
  }

  CacheTriangulation(
    aReporter: PROGRESS_REPORTER_LIKE | null = null,
    aZones: readonly ZONE[] = [],
  ): void {
    let zones: readonly ZONE[] = aZones;

    if (zones.length === 0) zones = this.m_zones;

    if (zones.length === 0) return;

    if (aReporter) aReporter.Report('Tessellating copper zones...');

    for (const aZone of zones) {
      if (aReporter?.IsCancelled()) continue;

      aZone.CacheTriangulation();

      if (aReporter) aReporter.AdvanceProgress();
    }
  }

  AllConnectedItems(): BOARD_CONNECTED_ITEM[] {
    const items: BOARD_CONNECTED_ITEM[] = [];

    for (const track of this.Tracks()) items.push(track);

    for (const footprint of this.Footprints()) {
      for (const pad of footprint.Pads()) items.push(pad);

      for (const zone of footprint.Zones()) items.push(zone);

      for (const dwg of footprint.GraphicalItems()) {
        if (dwg.IsConnected()) items.push(dwg as BOARD_CONNECTED_ITEM);
      }
    }

    for (const zone of this.Zones()) items.push(zone);

    for (const item of this.Drawings()) {
      if (item.IsConnected()) items.push(item as BOARD_CONNECTED_ITEM);
    }

    return items;
  }

  SanitizeNetcodes(): void {
    for (const item of this.AllConnectedItems()) {
      if (this.FindNet(item.GetNetCode()) === null) item.SetNetCode(NETINFO_LIST.ORPHANED);
    }
  }

  /** `m_layers[layer]`: a `std::map` creates the entry on first access. */
  private layerEntry(aLayer: number): LAYER {
    let entry = this.m_layers.get(aLayer);

    if (!entry) {
      entry = new LAYER();
      entry.m_number = 0;
      this.m_layers.set(aLayer, entry);
    }

    return entry;
  }

  GetClass(): string {
    return 'BOARD';
  }

  Similarity(aItem: BOARD_ITEM): number {
    return 0.0;
  }

  equals(aItem: BOARD_ITEM): boolean {
    return (this as BOARD_ITEM) === aItem;
  }

  override GetPosition(): VECTOR2I {
    return BOARD_ITEM.ZeroOffset;
  }
  override SetPosition(aPos: VECTOR2I): void {
    // wxLogWarning( wxT( "This should not be called on the BOARD object") );
  }

  /**
   * Set what the board is going to be used for.
   *
   * @param aUse is the flag
   */
  SetBoardUse(aUse: BOARD_USE): void {
    this.m_boardUse = aUse;
  }

  /**
   * Get what the board use is.
   *
   * @return what the board is being used for
   */
  GetBoardUse(): BOARD_USE {
    return this.m_boardUse;
  }

  IncrementTimeStamp(): void {
    this.m_timeStamp++;

    if (
      this.m_IntersectsAreaCache.size > 0 ||
      this.m_EnclosedByAreaCache.size > 0 ||
      this.m_IntersectsCourtyardCache.size > 0 ||
      this.m_IntersectsFCourtyardCache.size > 0 ||
      this.m_IntersectsBCourtyardCache.size > 0 ||
      this.m_LayerExpressionCache.size > 0 ||
      this.m_ZoneBBoxCache.size > 0 ||
      this.m_CopperItemRTreeCache !== null ||
      this.m_maxClearanceValue !== undefined ||
      this.m_ItemNetclassCache.size > 0 ||
      this.m_ZonesByNameCache.size > 0 ||
      this.m_DeflatedZoneOutlineCache.size > 0
    ) {
      this.m_IntersectsAreaCache.clear();
      this.m_EnclosedByAreaCache.clear();
      this.m_IntersectsCourtyardCache.clear();
      this.m_IntersectsFCourtyardCache.clear();
      this.m_IntersectsBCourtyardCache.clear();
      this.m_LayerExpressionCache.clear();
      this.m_ItemNetclassCache.clear();
      this.m_ZonesByNameCache.clear();
      this.m_DeflatedZoneOutlineCache.clear();

      this.m_ZoneBBoxCache.clear();

      this.m_CopperItemRTreeCache = null;

      // These are always regenerated before use, but still probably safer to clear them
      // while we're here.
      this.m_DRCMaxClearance = 0;
      this.m_DRCMaxPhysicalClearance = 0;
      this.m_DRCZones.length = 0;
      this.m_DRCCopperZones.length = 0;
      this.m_ZoneIsolatedIslandsMap.clear();
      this.m_CopperZoneRTreeCache.clear();

      this.m_maxClearanceValue = undefined;
    }
  }

  InitializeClearanceCache(): void {
    if (this.m_designSettings && this.m_designSettings.m_DRCEngine)
      this.m_designSettings.m_DRCEngine.InitializeClearanceCache();
  }

  /** `BOARD::GetMaxClearanceValue` (board.cpp:1119). */
  GetMaxClearanceValue(): number {
    if (this.m_maxClearanceValue === undefined) {
      let worstClearance = this.m_designSettings.GetBiggestClearanceValue();

      for (const zone of this.m_zones)
        worstClearance = Math.max(worstClearance, zone.GetLocalClearance() ?? 0);

      for (const footprint of this.m_footprints) {
        for (const pad of footprint.Pads()) {
          const override = pad.GetClearanceOverrides(null);

          if (override !== undefined) worstClearance = Math.max(worstClearance, override);
        }

        for (const zone of footprint.Zones())
          worstClearance = Math.max(worstClearance, zone.GetLocalClearance() ?? 0);
      }

      this.m_maxClearanceValue = worstClearance;
    }

    return this.m_maxClearanceValue ?? 0;
  }

  GetTimeStamp(): number {
    return this.m_timeStamp;
  }

  /**
   * Find out if the board is being used to hold a single footprint for editing/viewing.
   *
   * @return if the board is just holding a footprint
   */
  IsFootprintHolder(): boolean {
    return this.m_boardUse === BOARD_USE.FPHOLDER;
  }

  SetFileName(aFileName: string): void {
    this.m_fileName = aFileName;
  }

  GetFileName(): string {
    return this.m_fileName;
  }

  GetProperties(): Map<string, string> {
    return this.m_properties;
  }
  SetProperties(aProps: Map<string, string>): void {
    this.m_properties = new Map(aProps);
  }

  /**
   * Get the name of the currently active variant.
   * @return The active variant name, or empty string for default
   */
  GetUserUnits(): EdaUnits {
    return this.m_userUnits;
  }
  SetUserUnits(aUnits: EdaUnits): void {
    this.m_userUnits = aUnits;
  }

  GetCurrentVariant(): string {
    return this.m_currentVariant;
  }

  SetCurrentVariant(aVariant: string): void {
    if (aVariant === '' || cmpNoCase(aVariant, GetDefaultVariantName()) === 0) {
      this.m_currentVariant = '';
      return;
    }

    const actualName = FindVariantNameCaseInsensitive(this.m_variantNames, aVariant);

    if (actualName === '') this.m_currentVariant = '';
    else this.m_currentVariant = actualName;
  }

  GetVariantNames(): string[] {
    return this.m_variantNames;
  }
  SetVariantNames(aNames: string[]): void {
    this.m_variantNames = [...aNames];
  }

  HasVariant(aVariantName: string): boolean {
    return FindVariantNameCaseInsensitive(this.m_variantNames, aVariantName) !== '';
  }

  AddVariant(aVariantName: string): void {
    if (
      aVariantName === '' ||
      cmpNoCase(aVariantName, GetDefaultVariantName()) === 0 ||
      this.HasVariant(aVariantName)
    )
      return;

    this.m_variantNames.push(aVariantName);
  }

  GetVariantDescription(aVariantName: string): string {
    if (aVariantName === '' || cmpNoCase(aVariantName, GetDefaultVariantName()) === 0) return '';

    const actualName = FindVariantNameCaseInsensitive(this.m_variantNames, aVariantName);

    if (actualName === '') return '';

    const it = this.m_variantDescriptions.get(actualName);

    if (it !== undefined) return it;

    return '';
  }

  SetVariantDescription(aVariantName: string, aDescription: string): void {
    if (aVariantName === '' || cmpNoCase(aVariantName, GetDefaultVariantName()) === 0) return;

    const actualName = FindVariantNameCaseInsensitive(this.m_variantNames, aVariantName);

    if (actualName === '') return;

    if (aDescription === '') this.m_variantDescriptions.delete(actualName);
    else this.m_variantDescriptions.set(actualName, aDescription);
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.m_titles;
  }
  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.m_titles = aTitleBlock.clone();
  }

  /**
   * Resolve a text variable against the board: a `REF:FIELD` footprint token, the file
   * name tokens, the variant tokens, the board properties and the title block.
   * `PROJECTNAME` and the project's own variables come with `PROJECT` (not ported).
   */
  ConvertCrossReferencesToKIIDs(aSource: string): string {
    let newbuf = '';
    const sourceLen = aSource.length;

    for (let i = 0; i < sourceLen; ++i) {
      // Check for escaped expressions: \${ or \@{
      // These should be copied verbatim without any ref→KIID conversion
      if (
        aSource[i] === '\\' &&
        i + 2 < sourceLen &&
        aSource[i + 2] === '{' &&
        (aSource[i + 1] === '$' || aSource[i + 1] === '@')
      ) {
        // Copy the escape sequence and the entire escaped expression
        newbuf += aSource[i]; // backslash
        newbuf += aSource[i + 1]; // $ or @
        newbuf += aSource[i + 2]; // {
        i += 2;

        // Find and copy everything until the matching closing brace
        let braceDepth = 1;
        for (i = i + 1; i < sourceLen && braceDepth > 0; ++i) {
          if (aSource[i] === '{') braceDepth++;
          else if (aSource[i] === '}') braceDepth--;

          newbuf += aSource[i];
        }
        i--; // Back up one since the for loop will increment
        continue;
      }

      if (aSource[i] === '$' && i + 1 < sourceLen && aSource[i + 1] === '{') {
        let token = '';
        let isCrossRef = false;

        for (i = i + 2; i < sourceLen; ++i) {
          if (aSource[i] === '}') break;

          if (aSource[i] === ':') isCrossRef = true;

          token += aSource[i];
        }

        if (isCrossRef) {
          const colon = token.indexOf(':');
          const ref = token.slice(0, colon);
          const remainder = token.slice(colon + 1);

          for (const footprint of this.Footprints()) {
            if (footprint.GetReference().toLowerCase() === ref.toLowerCase()) {
              const test: OutStr = { value: remainder };

              if (footprint.ResolveTextVar(test)) token = `${footprint.m_Uuid}:${remainder}`;

              break;
            }
          }
        }

        newbuf += `\${${token}}`;
      } else {
        newbuf += aSource[i];
      }
    }

    return newbuf;
  }

  ResolveTextVar(token: OutStr, aDepth: number): boolean {
    if (token.value.includes(':')) {
      const colon = token.value.indexOf(':');
      const ref = token.value.slice(0, colon);
      let remainder = token.value.slice(colon + 1);
      const refItem = this.ResolveItem(ref, true);

      if (refItem && refItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const refFP = refItem as FOOTPRINT;
        const rem: OutStr = { value: remainder };

        if (refFP.ResolveTextVar(rem, aDepth + 1)) {
          token.value = rem.value;
          return true;
        }

        remainder = rem.value;
      }

      // If UUID resolution failed, try to resolve by reference designator
      // This handles typing ${U1:VALUE} directly without save/reload
      if (!refItem) {
        for (const item of this.Footprints()) {
          const footprint = item as FOOTPRINT;

          if (cmpNoCase(footprint.GetReference(), ref) === 0) {
            const remainderCopy: OutStr = { value: remainder };

            if (footprint.ResolveTextVar(remainderCopy, aDepth + 1)) {
              token.value = remainderCopy.value;
            } else {
              // Field/function not found on footprint
              token.value = `<Unresolved: ${footprint.GetReference()}:${remainder}>`;
            }

            return true;
          }
        }

        // Reference not found - show error message
        token.value = `<Unknown reference: ${ref}>`;
        return true;
      }
    }

    if (token.value === 'FILENAME') {
      token.value = wxFileNameFullName(this.GetFileName());
      return true;
    } else if (token.value === 'FILEPATH') {
      token.value = this.GetFileName();
      return true;
    } else if (token.value === 'VARIANT') {
      token.value = this.GetCurrentVariant();
      return true;
    } else if (token.value === 'VARIANT_DESC') {
      token.value = this.GetVariantDescription(this.GetCurrentVariant());
      return true;
    }
    // else if( token->IsSameAs( wxT( "PROJECTNAME" ) ) && GetProject() )    -- PROJECT not ported

    const v = token.value;

    if (this.m_properties.has(v)) {
      token.value = this.m_properties.get(v)!;
      return true;
    } else if (this.GetTitleBlock().TextVarResolver(token, null)) {
      return true;
    }

    // if( GetProject() && GetProject()->TextVarResolver( token ) ) return true;   -- PROJECT not ported

    return false;
  }

  Footprints(): FOOTPRINT[] {
    return this.m_footprints;
  }
  Tracks(): PCB_TRACK[] {
    return this.m_tracks;
  }
  Zones(): ZONE[] {
    return this.m_zones;
  }
  Generators(): PCB_GENERATOR[] {
    return this.m_generators;
  }
  Markers(): PCB_MARKER[] {
    return this.m_markers;
  }
  Drawings(): BOARD_ITEM[] {
    return this.m_drawings;
  }
  Groups(): PCB_GROUP[] {
    return this.m_groups;
  }
  Points(): PCB_POINT[] {
    return this.m_points;
  }

  /**
   * `GetItemSet()`: `BOARD_ITEM_SET`, a `std::set<BOARD_ITEM*, CompareByUuid>`
   * of every top-level item, so the order is the UUIDs'.
   */
  GetItemSet(): BOARD_ITEM[] {
    const items: BOARD_ITEM[] = [];

    items.push(...this.m_tracks);
    items.push(...this.m_zones);
    items.push(...this.m_generators);
    items.push(...this.m_footprints);
    items.push(...this.m_drawings);
    items.push(...this.m_markers);
    items.push(...this.m_groups);
    items.push(...this.m_points);

    items.sort((a, b) => (CompareByUuid(a, b) ? -1 : CompareByUuid(b, a) ? 1 : 0));

    return items;
  }

  /** `EMBEDDED_FILES::GetFontFiles`: the fontconfig cache is not ported (no disk). */
  GetFontFiles(): readonly string[] | null {
    return null;
  }

  SetFileFormatVersionAtLoad(aVersion: number): void {
    this.m_fileFormatVersionAtLoad = aVersion;
  }

  GetFileFormatVersionAtLoad(): number {
    return this.m_fileFormatVersionAtLoad;
  }

  SetGenerator(aGenerator: string): void {
    this.m_generator = aGenerator;
  }

  GetGenerator(): string {
    return this.m_generator;
  }

  GetPageSettings(): PAGE_INFO {
    return this.m_paper;
  }

  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.m_paper.assign(aPageSettings);
  }

  GetPlotOptions(): PCB_PLOT_PARAMS {
    return this.m_plotOptions;
  }

  SetPlotOptions(aOptions: PCB_PLOT_PARAMS): void {
    this.m_plotOptions.assign(aOptions);
  }

  LegacyTeardrops(): boolean {
    return this.m_legacyTeardrops;
  }

  SetLegacyTeardrops(aFlag: boolean): void {
    this.m_legacyTeardrops = aFlag;
  }

  override GetEmbeddedFiles(): EMBEDDED_FILES {
    if (this.m_embeddedFilesDelegate) return this.m_embeddedFilesDelegate;

    return this;
  }

  /** `BOARD::SetEmbeddedFilesDelegate`: the footprint holder shares its parent's files. */
  SetEmbeddedFilesDelegate(aDelegate: EMBEDDED_FILES | null): void {
    this.m_embeddedFilesDelegate = aDelegate;
  }

  RunOnNestedEmbeddedFiles(aFunction: (aFiles: EMBEDDED_FILES) => void): void {
    for (const footprint of this.m_footprints) aFunction(footprint.GetEmbeddedFiles());
  }

  /**
   * Get a list of outline fonts referenced in the board
   */
  GetFonts(): Set<unknown> {
    // for each EDA_TEXT drawing: if the font is an outline font whose EMBEDDING_PERMISSION is
    // EDITABLE or INSTALLABLE, collect it        -- OUTLINE_FONT::GetEmbeddingPermission pending (#636)
    return new Set();
  }

  EmbedFonts(): void {
    // for( OUTLINE_FONT* font : GetFonts() ) GetEmbeddedFiles()->AddFile( font->GetFileName(), false )
    //                                                     -- OUTLINE_FONT embedding pending (#636)
  }

  /**
   * Set the layer information from a #LAYER object.
   */
  SetLayerDescr(aIndex: PCB_LAYER_ID, aLayer: LAYER): boolean {
    this.m_layers.set(aIndex, LAYER.copyOf(aLayer)); // m_layers[aIndex] = aLayer: by value
    this.recalcOpposites();
    return true;
  }

  /**
   * Return the ID of a layer.
   */
  GetLayerID(aLayerName: string): PCB_LAYER_ID {
    // Check the BOARD physical layer names.
    for (const [layer_id, layer] of this.m_layers) {
      if (layer.m_name === aLayerName || layer.m_userName === aLayerName)
        return ToLAYER_ID(layer_id);
    }

    // Otherwise fall back to the system standard layer names for virtual layers.
    for (let layer = 0; layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++layer) {
      if (BOARD.GetStandardLayerName(ToLAYER_ID(layer)) === aLayerName) return ToLAYER_ID(layer);
    }

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  /**
   * Return the name of a \a aLayer.
   *
   * @param aLayer is the #PCB_LAYER_ID of the layer.
   * @return a string containing the name of the layer.
   */
  override GetLayerName(aLayer: PCB_LAYER_ID = this.m_layer): string {
    // All layer names are stored in the BOARD.
    if (this.IsLayerEnabled(aLayer)) {
      const it = this.m_layers.get(aLayer);

      // Standard names were set in BOARD::BOARD() but they may be over-ridden by
      // BOARD::SetLayerName().  For copper layers, return the user defined layer name,
      // if it was set.  Otherwise return the Standard English layer name.
      if (it !== undefined && it.m_userName !== '') return it.m_userName;
    }

    return BOARD.GetStandardLayerName(aLayer);
  }

  /**
   * Changes the name of the layer given by aLayer.
   *
   * @param aLayer A layer, like B_Cu, etc.
   * @param aLayerName The new layer name
   * @return true if aLayerName was legal and unique among other layer names at other layer
   *         indices and aLayer was within range, else false.
   */
  SetLayerName(aLayer: PCB_LAYER_ID, aLayerName: string): boolean {
    if (aLayerName === '') {
      // If the name is empty, we clear the user name.
      this.layerEntry(aLayer).m_userName = '';
      this.recalcOpposites();
    } else {
      // no quote chars in the name allowed
      if (aLayerName.includes('"')) return false;

      if (this.IsLayerEnabled(aLayer)) {
        this.layerEntry(aLayer).m_userName = aLayerName;
        this.recalcOpposites();
        return true;
      }
    }

    return false;
  }

  /**
   * Return an "English Standard" name of a PCB layer when given \a aLayerNumber.
   *
   * This function is static so it can be called without a BOARD instance.  Use
   * GetLayerName() if want the layer names of a specific BOARD, which could
   * be different than the default if the user has renamed any copper layers.
   *
   * @param  aLayerId is the layer identifier (index) to fetch.
   * @return a string containing the layer name or "BAD INDEX" if aLayerId is not legal.
   */
  static GetStandardLayerName(aLayerId: PCB_LAYER_ID): string {
    // a BOARD's standard layer name is the LayerName( )
    return LayerName(aLayerId);
  }

  IsFrontLayer(aLayer: PCB_LAYER_ID): boolean {
    return isFrontLayerId(aLayer) || this.GetLayerType(aLayer) === LAYER_T.LT_FRONT;
  }

  IsBackLayer(aLayer: PCB_LAYER_ID): boolean {
    return isBackLayerId(aLayer) || this.GetLayerType(aLayer) === LAYER_T.LT_BACK;
  }

  /**
   * Return the type of the copper layer given by aLayer.
   *
   * @param aLayer A layer index, like B_Cu, etc.
   * @return the layer type, or LAYER_T(-1) if the index was out of range.
   */
  GetLayerType(aLayer: PCB_LAYER_ID): LAYER_T {
    if (this.IsLayerEnabled(aLayer)) {
      const it = this.m_layers.get(aLayer);

      if (it !== undefined) return it.m_type;
    }

    if (aLayer >= PCB_LAYER_ID.User_1 && !IsCopperLayer(aLayer)) return LAYER_T.LT_AUX;
    else if (IsCopperLayer(aLayer)) return LAYER_T.LT_SIGNAL;
    else return LAYER_T.LT_UNDEFINED;
  }

  /**
   * Change the type of the layer given by aLayer.
   *
   * @param aLayer A layer index, like B_Cu, etc.
   * @param aLayerType The new layer type.
   * @return true if aLayerType was legal and aLayer was within range, else false.
   */
  SetLayerType(aLayer: PCB_LAYER_ID, aLayerType: LAYER_T): boolean {
    if (this.IsLayerEnabled(aLayer)) {
      this.layerEntry(aLayer).m_type = aLayerType;
      this.recalcOpposites();
      return true;
    }

    return false;
  }

  private recalcOpposites(): void {
    for (let layer: number = PCB_LAYER_ID.F_Cu; layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++layer)
      this.layerEntry(layer).m_opposite = flipLayerId(
        ToLAYER_ID(layer),
        this.GetCopperLayerCount(),
      );

    // Match up similary-named front/back user layers
    for (
      let layer: number = PCB_LAYER_ID.User_1;
      layer <= PCB_LAYER_ID.PCB_LAYER_ID_COUNT;
      layer += 2
    ) {
      if (this.layerEntry(layer).m_opposite !== layer)
        // already paired
        continue;

      if (
        this.layerEntry(layer).m_type !== LAYER_T.LT_FRONT &&
        this.layerEntry(layer).m_type !== LAYER_T.LT_BACK
      )
        continue;

      const principalName = wxAfterFirst(this.layerEntry(layer).m_userName, '.');

      for (let ii = layer + 2; ii <= PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ii += 2) {
        if (this.layerEntry(ii).m_opposite !== ii)
          // already paired
          continue;

        if (
          this.layerEntry(ii).m_type !== LAYER_T.LT_FRONT &&
          this.layerEntry(ii).m_type !== LAYER_T.LT_BACK
        )
          continue;

        if (this.layerEntry(layer).m_type === this.layerEntry(ii).m_type) continue;

        const candidate = wxAfterFirst(this.layerEntry(ii).m_userName, '.');

        if (candidate !== '' && candidate === principalName) {
          this.layerEntry(layer).m_opposite = ii;
          this.layerEntry(ii).m_opposite = layer;
          break;
        }
      }
    }

    // Match up non-custom-named consecutive front/back user layer pairs
    for (
      let layer: number = PCB_LAYER_ID.User_1;
      layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT - 2;
      layer += 2
    ) {
      const next = layer + 2;

      // ignore already-matched layers
      if (this.layerEntry(layer).m_opposite !== layer || this.layerEntry(next).m_opposite !== next)
        continue;

      // ignore layer pairs that aren't consecutive front/back
      if (
        this.layerEntry(layer).m_type !== LAYER_T.LT_FRONT ||
        this.layerEntry(next).m_type !== LAYER_T.LT_BACK
      )
        continue;

      if (
        this.layerEntry(layer).m_userName !== this.layerEntry(layer).m_name &&
        this.layerEntry(next).m_userName !== this.layerEntry(next).m_name
      ) {
        this.layerEntry(layer).m_opposite = next;
        this.layerEntry(next).m_opposite = layer;
      }
    }
  }

  /**
   * @return the layer on the opposite side of the board, as the board's stackup pairs them.
   */
  FlipLayer(aLayer: PCB_LAYER_ID): PCB_LAYER_ID {
    const it = this.m_layers.get(aLayer);
    return it === undefined ? aLayer : ToLAYER_ID(it.m_opposite);
  }

  /**
   * @return The number of copper layers in the BOARD.
   */
  GetCopperLayerCount(): number {
    return this.GetDesignSettings().GetCopperLayerCount();
  }
  SetCopperLayerCount(aCount: number): void {
    this.GetDesignSettings().SetCopperLayerCount(aCount);
    this.recalcOpposites();
  }

  GetUserDefinedLayerCount(): number {
    return this.GetDesignSettings().GetUserDefinedLayerCount();
  }
  SetUserDefinedLayerCount(aCount: number): void {
    this.GetDesignSettings().SetUserDefinedLayerCount(aCount);
  }

  GetCopperLayerStackMaxId(): PCB_LAYER_ID {
    const imax = this.GetCopperLayerCount();

    // layers IDs are F_Cu, B_Cu, and even IDs values (imax values)
    if (imax <= 2)
      // at least 2 layers are expected
      return PCB_LAYER_ID.B_Cu;

    // For a 4 layer, last ID is In2_Cu = 6 (IDs are 0, 2, 4, 6)
    return ((imax - 1) * 2) as PCB_LAYER_ID;
  }

  /**
   * Return the number of copper layers between the two given layers (inclusive), counting
   * B_Cu as the bottom of the stack.
   */
  LayerDepth(aStartLayer: PCB_LAYER_ID, aEndLayer: PCB_LAYER_ID): number {
    if (aStartLayer > aEndLayer) [aStartLayer, aEndLayer] = [aEndLayer, aStartLayer];

    if (aEndLayer === PCB_LAYER_ID.B_Cu)
      aEndLayer = ToLAYER_ID(PCB_LAYER_ID.F_Cu + this.GetCopperLayerCount() - 1);

    return aEndLayer - aStartLayer;
  }

  /**
   * A proxy function that calls the corresponding function in m_BoardSettings.
   *
   * @return the enabled layers in bit-mapped form.
   */
  GetEnabledLayers(): LSET {
    return this.GetDesignSettings().GetEnabledLayers();
  }

  /**
   * A proxy function that calls the correspondent function in m_BoardSettings.
   *
   * @param aLayerMask = The new bit-mask of enabled layers.
   */
  SetEnabledLayers(aLayerSet: LSET): void {
    this.GetDesignSettings().SetEnabledLayers(aLayerSet);
  }

  /**
   * Test whether a given element category is visible.
   *
   * @param aLayer is from the enum by the same name.
   * @return true if the element is visible.
   * @see enum GAL_LAYER_ID
   */
  IsElementVisible(aLayer: GAL_LAYER_ID): boolean {
    return true; // !m_project || m_project->GetLocalSettings().m_VisibleItems[aLayer - GAL_LAYER_ID_START] -- PROJECT not ported
  }

  /**
   * Change the visibility of an element category.
   *
   * @param aLayer is from the enum by the same name.
   * @param aNewState is the new visibility state of the element category.
   * @see enum GAL_LAYER_ID
   */
  SetElementVisibility(aLayer: GAL_LAYER_ID, isEnabled: boolean): void {
    // if( m_project ) m_project->GetLocalSettings().m_VisibleItems.set( ... );   -- PROJECT not ported
    // switch( aLayer ) { case LAYER_RATSNEST: ... }                                -- connectivity pending (#636)
  }

  /** `CacheItemById`: add an item (and a group's children) to the item-by-id cache. */
  /**
   * Fetch an item by KIID.
   *
   * Note that this only checks items which are currently in the cache; the linear scan is
   * the fallback and any hit is cached.
   *
   * @return the item, nullptr (when aAllowNullptrReturn), or DELETED_BOARD_ITEM
   */
  ResolveItem(aID: KIID, aAllowNullptrReturn = false): BOARD_ITEM | null {
    if (aID === niluuid) return null;

    const cacheIt = this.m_itemByIdCache.get(aID);

    if (cacheIt !== undefined) return cacheIt;

    // Linear scan fallback for items not in the cache.  Any hit is cached so
    // subsequent lookups for the same item are O(1).

    const cacheAndReturn = (aItem: BOARD_ITEM): BOARD_ITEM => {
      this.m_itemByIdCache.set(aID, aItem);
      return aItem;
    };

    for (const group of this.m_groups) {
      if (group.m_Uuid === aID) return cacheAndReturn(group);
    }

    for (const generator of this.m_generators) {
      if (generator.m_Uuid === aID) return cacheAndReturn(generator);
    }

    for (const track of this.Tracks()) {
      if (track.m_Uuid === aID) return cacheAndReturn(track);
    }

    for (const footprint of this.Footprints()) {
      if (footprint.m_Uuid === aID) return cacheAndReturn(footprint);

      for (const pad of footprint.Pads()) {
        if (pad.m_Uuid === aID) return cacheAndReturn(pad);
      }

      for (const field of footprint.GetFields()) {
        if (!field) continue; // wxCHECK2( field, continue )

        if (field && field.m_Uuid === aID) return cacheAndReturn(field);
      }

      for (const drawing of footprint.GraphicalItems()) {
        if (drawing.m_Uuid === aID) return cacheAndReturn(drawing);
      }

      for (const zone of footprint.Zones()) {
        if (zone.m_Uuid === aID) return cacheAndReturn(zone);
      }

      for (const group of footprint.Groups()) {
        if (group.m_Uuid === aID) return cacheAndReturn(group);
      }

      for (const point of footprint.Points()) {
        if (point.m_Uuid === aID) return cacheAndReturn(point);
      }
    }

    for (const zone of this.Zones()) {
      if (zone.m_Uuid === aID) return cacheAndReturn(zone);
    }

    for (const drawing of this.Drawings()) {
      if (drawing.Type() === KICAD_T.PCB_TABLE_T) {
        for (const cell of (drawing as PCB_TABLE).GetCells()) {
          if (cell.m_Uuid === aID) return cacheAndReturn(drawing);
        }
      }

      if (drawing.m_Uuid === aID) return cacheAndReturn(drawing);
    }

    for (const marker of this.m_markers) {
      if (marker.m_Uuid === aID) return cacheAndReturn(marker);
    }

    for (const point of this.m_points) {
      if (point.m_Uuid === aID) return cacheAndReturn(point);
    }

    for (const netInfo of this.m_NetInfo) {
      if (netInfo.m_Uuid === aID) return cacheAndReturn(netInfo);
    }

    if (this.m_Uuid === aID) return this;

    // Not found; weak reference has been deleted.
    if (aAllowNullptrReturn) return null;

    return DELETED_BOARD_ITEM.GetInstance();
  }

  /**
   * Must be used if Add() is used using a BULK_x ADD_MODE to generate a change event for
   * listeners.
   */
  FinalizeBulkAdd(aNewItems: BOARD_ITEM[]): void {
    this.InvokeListeners((l) => l.OnBoardItemsAdded(this, aNewItems));
  }

  /**
   * Must be used if Remove() is used using a BULK_x REMOVE_MODE to generate a change event
   * for listeners.
   */
  FinalizeBulkRemove(aRemovedItems: BOARD_ITEM[]): void {
    this.InvokeListeners((l) => l.OnBoardItemsRemoved(this, aRemovedItems));
  }

  FixupEmbeddedData(): void {
    this.RunOnNestedEmbeddedFiles((nested) => {
      for (const [filename, embeddedFile] of nested.EmbeddedFileMap()) {
        const file = this.GetEmbeddedFile(filename);

        if (file) {
          embeddedFile.compressedEncodedData = file.compressedEncodedData;
          embeddedFile.decompressedData = file.decompressedData;
          embeddedFile.data_hash = file.data_hash;
          embeddedFile.is_valid = file.is_valid;
        }
      }
    });
  }

  /**
   * Check that the board is valid and that all groups are sane.
   *
   * @param repair if true, the board is repaired (as well as possible).
   * @return the error message, or an empty string on success.
   */
  GroupsSanityCheck(repair = false): string {
    if (repair) {
      while (this.GroupsSanityCheckInternal(repair) !== '') {
        // repeat until clean
      }

      return '';
    }
    return this.GroupsSanityCheckInternal(repair);
  }

  GroupsSanityCheckInternal(repair: boolean): string {
    // Cycle detection
    //
    // Each group has at most one parent group.
    // So we start at group 0 and traverse the parent chain, marking groups seen along the way.
    // If we ever see a group that we've already marked, that's a cycle.
    // If we reach the end of the chain, we know all groups in that chain are not part of any cycle.
    //
    // Algorithm below is linear in the # of groups because each group is visited only once.
    // There may be extra time taken due to the container access calls and iterators.
    //
    // Groups we know are cycle free
    const knownCycleFreeGroups = new Set<EDA_GROUP>();
    // Groups in the current chain we're exploring.
    const currentChainGroups = new Set<EDA_GROUP>();
    // Groups we haven't checked yet.
    const toCheckGroups = new Set<EDA_GROUP>();

    // Initialize set of groups and generators to check that could participate in a cycle.
    for (const group of this.Groups()) toCheckGroups.add(group);

    for (const gen of this.Generators()) toCheckGroups.add(gen);

    while (toCheckGroups.size > 0) {
      currentChainGroups.clear();
      let group: EDA_GROUP | null = toCheckGroups.values().next().value as EDA_GROUP;

      while (true) {
        if (currentChainGroups.has(group)) {
          if (repair) this.Remove(group.AsEdaItem() as BOARD_ITEM);

          return 'Cycle detected in group membership';
        }

        if (knownCycleFreeGroups.has(group)) {
          // Parent is a group we know does not lead to a cycle
          break;
        }

        currentChainGroups.add(group);
        // We haven't visited currIdx yet, so it must be in toCheckGroups
        toCheckGroups.delete(group);

        group = group.AsEdaItem().GetParentGroup();

        if (!group) {
          // end of chain and no cycles found in this chain
          break;
        }
      }

      // No cycles found in chain, so add it to set of groups we know don't participate
      // in a cycle.
      for (const g of currentChainGroups) knownCycleFreeGroups.add(g);
    }

    // Success
    return '';
  }

  /** `BOARD::cmp_items::operator()`. */
  static cmp_items(a: BOARD_ITEM, b: BOARD_ITEM): boolean {
    if (a.Type() !== b.Type()) return a.Type() < b.Type();

    if (a.GetLayer() !== b.GetLayer()) return a.GetLayer() < b.GetLayer();

    if (a.GetPosition().x !== b.GetPosition().x) return a.GetPosition().x < b.GetPosition().x;

    if (a.GetPosition().y !== b.GetPosition().y) return a.GetPosition().y < b.GetPosition().y;

    if (a.m_Uuid !== b.m_Uuid)
      // shopuld be always the case foer valid boards
      return a.m_Uuid < b.m_Uuid;

    return false; // a < b: pointer order, no analogue
  }

  /** `BOARD::cmp_drawings::operator()`. */
  static cmp_drawings(aFirst: BOARD_ITEM, aSecond: BOARD_ITEM): boolean {
    if (aFirst.Type() !== aSecond.Type()) return aFirst.Type() < aSecond.Type();

    if (aFirst.GetLayer() !== aSecond.GetLayer()) return aFirst.GetLayer() < aSecond.GetLayer();

    if (aFirst.Type() === KICAD_T.PCB_SHAPE_T) {
      const shape = aFirst as PCB_SHAPE;
      const other = aSecond as PCB_SHAPE;
      return shape.Compare(other as unknown as EDA_SHAPE) < 0;
    }

    if (aFirst.Type() === KICAD_T.PCB_TEXT_T || aFirst.Type() === KICAD_T.PCB_FIELD_T) {
      const text = aFirst as PCB_TEXT;
      const other = aSecond as PCB_TEXT;
      return text.Compare(other as unknown as EDA_TEXT) < 0;
    }

    if (aFirst.Type() === KICAD_T.PCB_TEXTBOX_T) {
      const textbox = aFirst as PCB_TEXTBOX;
      const other = aSecond as PCB_TEXTBOX;

      const shapeCmp = EDA_SHAPE.prototype.Compare.call(textbox, other as unknown as EDA_SHAPE);

      if (shapeCmp !== 0) return shapeCmp < 0;

      return EDA_TEXT.prototype.Compare.call(textbox, other as unknown as EDA_TEXT) < 0;
    }

    if (aFirst.Type() === KICAD_T.PCB_TABLE_T) {
      const table = aFirst as PCB_TABLE;
      const other = aSecond as PCB_TABLE;

      return PCB_TABLE.Compare(table, other) < 0;
    }

    if (aFirst.Type() === KICAD_T.PCB_BARCODE_T) {
      const barcode = aFirst as PCB_BARCODE;
      const other = aSecond as PCB_BARCODE;

      return PCB_BARCODE.Compare(barcode, other) < 0;
    }

    return aFirst.m_Uuid < aSecond.m_Uuid;
  }

  override RunOnChildren(aFunction: (aItem: BOARD_ITEM) => void, aMode: RECURSE_MODE): void {
    for (const track of this.m_tracks) aFunction(track);

    for (const zone of this.m_zones) aFunction(zone);

    for (const marker of this.m_markers) aFunction(marker);

    for (const group of this.m_groups) aFunction(group);

    for (const point of this.m_points) aFunction(point);

    for (const footprint of this.m_footprints) {
      aFunction(footprint);

      if (aMode === RECURSE_MODE.RECURSE) footprint.RunOnChildren(aFunction, RECURSE_MODE.RECURSE);
    }

    for (const drawing of this.m_drawings) {
      aFunction(drawing);

      if (aMode === RECURSE_MODE.RECURSE) drawing.RunOnChildren(aFunction, RECURSE_MODE.RECURSE);
    }
  }

  GetItemByIdCache(): ReadonlyMap<KIID, BOARD_ITEM> {
    return this.m_itemByIdCache;
  }

  CacheItemById(aItem: BOARD_ITEM): void {
    if (this.IsFootprintHolder()) return;

    this.m_itemByIdCache.set(aItem.m_Uuid, aItem);
  }

  /** `UncacheItemById`: drop an item from the item-by-id cache. */
  UncacheItemById(aId: KIID): void {
    this.m_itemByIdCache.delete(aId);
  }

  /**
   * A proxy function that calls the correspondent function in m_BoardSettings
   * tests whether a given layer is visible
   * @param aLayer = The layer to be tested
   * @return true if the layer is visible.
   */
  IsLayerVisible(aLayer: PCB_LAYER_ID): boolean {
    // If there is no project, assume layer is visible always
    return this.GetDesignSettings().IsLayerEnabled(aLayer); // && ( !m_project || ...m_VisibleLayers[aLayer] ) -- PROJECT not ported
  }

  /**
   * A proxy function that calls the correspondent function in m_BoardSettings.
   *
   * @return the visible layers in bit-mapped form.
   */
  GetVisibleLayers(): LSET {
    return LSET.AllLayersMask(); // m_project ? m_project->GetLocalSettings().m_VisibleLayers : ... -- PROJECT not ported
  }

  /**
   * A proxy function that calls the correspondent function in m_BoardSettings
   * changes the bit-mask of visible layers.
   *
   * @param aLayerMask = The new bit-mask of visible layers.
   */
  SetVisibleLayers(aLayerSet: LSET): void {
    // if( m_project ) m_project->GetLocalSettings().m_VisibleLayers = aLayerSet;   -- PROJECT not ported
  }

  /**
   * A proxy function that calls the correspondent function in m_BoardSettings
   * tests whether a given layer is enabled
   * @param aLayer = The layer to be tested
   * @return true if the layer is visible.
   */
  IsLayerEnabled(aLayer: PCB_LAYER_ID): boolean {
    return this.GetDesignSettings().IsLayerEnabled(aLayer);
  }

  override GetLayerSet(): LSET {
    return this.GetEnabledLayers();
  }

  /**
   * Return a zone name that is unique on this board, derived from aBaseName.
   */
  GetUniqueZoneName(aBaseName: string, aExclude: ZONE | null): string {
    if (aBaseName === '') return aBaseName;

    const inUse = (aName: string): boolean => {
      for (const zone of this.m_zones as ZONE[]) {
        if (zone !== aExclude && zone.GetZoneName() === aName) return true;
      }

      return false;
    };

    if (!inUse(aBaseName)) return aBaseName;

    // Strip a trailing _<number> so repeated copies increment the root (foo_1 -> foo_2),
    // instead of stacking suffixes (foo_1_1_1).
    let root = aBaseName;

    if (aBaseName.includes('_')) {
      const suffix = aBaseName.slice(aBaseName.lastIndexOf('_') + 1);
      let allDigits = suffix !== '';

      for (const ch of suffix) {
        if (!(ch >= '0' && ch <= '9')) {
          allDigits = false;
          break;
        }
      }

      if (allDigits) root = aBaseName.slice(0, aBaseName.lastIndexOf('_'));
    }

    for (let i = 1; ; ++i) {
      const candidate = `${root}_${i}`;

      if (!inUse(candidate)) return candidate;
    }
  }

  /**
   * @return the BOARD_DESIGN_SETTINGS for this BOARD
   */
  GetDesignSettings(): BOARD_DESIGN_SETTINGS {
    return this.m_designSettings;
  }

  /**
   * @return the number of nets (NETINFO_ITEM) in the board.
   */
  GetNetCount(): number {
    return this.m_NetInfo.GetNetCount();
  }

  /**
   * Search for a net with the given netcode.
   *
   * @param aNetcode A netcode to search for.
   * @return the net if found or NULL if not found.
   */
  FindNet(aNetcode: number): NETINFO_ITEM | null;
  /**
   * Search for a net with the given name.
   *
   * @param aNetname A Netname to search for.
   * @return the net if found or NULL if not found.
   */
  FindNet(aNetname: string): NETINFO_ITEM | null;
  FindNet(a: number | string): NETINFO_ITEM | null {
    if (typeof a === 'number') {
      // the first valid netcode is 1 and the last is m_NetInfo.GetCount()-1.
      // zero is reserved for "no connection" and is not actually a net.
      // nullptr is returned for non valid netcodes

      if (a === NETINFO_LIST.UNCONNECTED && this.m_NetInfo.GetNetCount() === 0)
        return NETINFO_LIST.OrphanedItem();
      else return this.m_NetInfo.GetNetItem(a);
    }

    return this.m_NetInfo.GetNetItem(a);
  }

  GetNetInfo(): NETINFO_LIST {
    return this.m_NetInfo;
  }

  /**
   * Adds an item to the container.
   */
  Add(
    aBoardItem: BOARD_ITEM | null,
    aMode: ADD_MODE = ADD_MODE.INSERT,
    aSkipConnectivity = false,
  ): void {
    if (aBoardItem === null) {
      console.assert(false, 'BOARD::Add() param error: aBoardItem nullptr');
      return;
    }

    this.m_itemByIdCache.set(aBoardItem.m_Uuid, aBoardItem);

    switch (aBoardItem.Type()) {
      case KICAD_T.PCB_NETINFO_T:
        this.m_NetInfo.AppendNet(aBoardItem as NETINFO_ITEM);
        break;

      // this one uses a vector
      case KICAD_T.PCB_MARKER_T:
        this.m_markers.push(aBoardItem as PCB_MARKER);
        break;

      // this one uses a vector
      case KICAD_T.PCB_GROUP_T:
        this.m_groups.push(aBoardItem as PCB_GROUP);
        break;

      // this one uses a vector
      case KICAD_T.PCB_GENERATOR_T:
        this.m_generators.push(aBoardItem as PCB_GENERATOR);
        break;

      // this one uses a vector
      case KICAD_T.PCB_ZONE_T:
        this.m_zones.push(aBoardItem as ZONE);
        break;

      case KICAD_T.PCB_VIA_T:
        if (aMode === ADD_MODE.APPEND || aMode === ADD_MODE.BULK_APPEND)
          this.m_tracks.push(aBoardItem as PCB_TRACK);
        else this.m_tracks.unshift(aBoardItem as PCB_TRACK);

        break;

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
        if (!IsCopperLayer(aBoardItem.GetLayer())) {
          // The only current known source of these is SWIG (KICAD-BY7, et al).
          // N.B. This inserts a small memory leak as we lose the track/via/arc.
          console.assert(
            false,
            `BOARD::Add() Cannot place Track on non-copper layer: ${aBoardItem.GetLayer()} = ${this.GetLayerName(aBoardItem.GetLayer())}`,
          );
          return;
        }

        if (aMode === ADD_MODE.APPEND || aMode === ADD_MODE.BULK_APPEND)
          this.m_tracks.push(aBoardItem as PCB_TRACK);
        else this.m_tracks.unshift(aBoardItem as PCB_TRACK);

        break;

      case KICAD_T.PCB_FOOTPRINT_T: {
        const footprint = aBoardItem as FOOTPRINT;

        if (aMode === ADD_MODE.APPEND || aMode === ADD_MODE.BULK_APPEND)
          this.m_footprints.push(footprint);
        else this.m_footprints.unshift(footprint);

        footprint.RunOnChildren((aChild) => {
          this.m_itemByIdCache.set(aChild.m_Uuid, aChild);
        }, RECURSE_MODE.NO_RECURSE);
        break;
      }

      case KICAD_T.PCB_BARCODE_T:
      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_TARGET_T: {
        if (aMode === ADD_MODE.APPEND || aMode === ADD_MODE.BULK_APPEND)
          this.m_drawings.push(aBoardItem);
        else this.m_drawings.unshift(aBoardItem);

        if (aBoardItem.Type() === KICAD_T.PCB_TABLE_T) {
          const table = aBoardItem;

          table.RunOnChildren((aChild) => {
            this.m_itemByIdCache.set(aChild.m_Uuid, aChild);
          }, RECURSE_MODE.NO_RECURSE);
        }

        break;
      }

      case KICAD_T.PCB_POINT_T:
        // These aren't graphics as they have no physical presence
        this.m_points.push(aBoardItem as PCB_POINT);
        break;

      case KICAD_T.PCB_TABLECELL_T:
        // Handled by parent table
        break;

      default:
        console.assert(false, `BOARD::Add() item type ${aBoardItem.GetClass()} not handled`);
        return;
    }

    aBoardItem.SetParent(this);
    aBoardItem.ClearEditFlags();

    if (!aSkipConnectivity) this.m_connectivity.Add(aBoardItem);

    if (aMode !== ADD_MODE.BULK_INSERT && aMode !== ADD_MODE.BULK_APPEND)
      this.InvokeListeners((l) => l.OnBoardItemAdded(this, aBoardItem));
  }

  /**
   * Remove every teardrop zone flagged STRUCT_DELETED, telling the commit.
   */
  BulkRemoveStaleTeardrops(aCommit: COMMIT): void {
    for (let ii = this.m_zones.length - 1; ii >= 0; --ii) {
      const zone = this.m_zones[ii]!;

      if (zone.IsTeardropArea() && zone.HasFlag(STRUCT_DELETED)) {
        this.m_itemByIdCache.delete(zone.m_Uuid);
        this.m_zones.splice(ii, 1);
        this.m_connectivity.Remove(zone);
        aCommit.Removed(zone);
      }
    }
  }

  /**
   * Removes an item from the container.
   */
  Remove(aBoardItem: BOARD_ITEM, aRemoveMode: REMOVE_MODE = REMOVE_MODE.NORMAL): void {
    // find these calls and fix them!  Don't send me no stinking' nullptr.
    console.assert(!!aBoardItem);

    // This is redundant with BOARD_COMMIT::Push but necessary to support SWIG interaction
    // until the SWIG API is completely removed (since it doesn't use the commit system)
    const parentGroup = aBoardItem.GetParentGroup();

    if (parentGroup && !(parentGroup.AsEdaItem().GetFlags() & STRUCT_DELETED)) {
      parentGroup.RemoveItem(aBoardItem);
    }

    this.m_itemByIdCache.delete(aBoardItem.m_Uuid);

    switch (aBoardItem.Type()) {
      case KICAD_T.PCB_NETINFO_T: {
        const netItem = aBoardItem as NETINFO_ITEM;
        const unconnected = this.m_NetInfo.GetNetItem(NETINFO_LIST.UNCONNECTED);

        for (const boardItem of this.AllConnectedItems()) {
          if (boardItem.GetNet() === netItem) boardItem.SetNet(unconnected);
        }

        this.m_NetInfo.RemoveNet(netItem);
        break;
      }

      case KICAD_T.PCB_MARKER_T:
        erase(this.m_markers, aBoardItem);
        break;

      case KICAD_T.PCB_GROUP_T:
        erase(this.m_groups, aBoardItem);
        break;

      case KICAD_T.PCB_ZONE_T:
        erase(this.m_zones, aBoardItem);
        break;

      case KICAD_T.PCB_POINT_T:
        erase(this.m_points, aBoardItem);
        break;

      case KICAD_T.PCB_GENERATOR_T:
        erase(this.m_generators, aBoardItem);
        break;

      case KICAD_T.PCB_FOOTPRINT_T: {
        erase(this.m_footprints, aBoardItem);
        const footprint = aBoardItem;

        footprint.RunOnChildren((aChild) => {
          this.m_itemByIdCache.delete(aChild.m_Uuid);
        }, RECURSE_MODE.NO_RECURSE);

        break;
      }

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
      case KICAD_T.PCB_VIA_T:
        erase(this.m_tracks, aBoardItem);
        break;

      case KICAD_T.PCB_BARCODE_T:
      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_TARGET_T: {
        erase(this.m_drawings, aBoardItem);

        if (aBoardItem.Type() === KICAD_T.PCB_TABLE_T) {
          const table = aBoardItem;

          table.RunOnChildren((aChild) => {
            this.m_itemByIdCache.delete(aChild.m_Uuid);
          }, RECURSE_MODE.NO_RECURSE);
        }

        break;
      }

      case KICAD_T.PCB_TABLECELL_T:
        // Handled by parent table
        break;

      // other types may use linked list
      default:
        console.assert(false, `BOARD::Remove() item type ${aBoardItem.GetClass()} not handled`);
    }

    aBoardItem.SetFlags(STRUCT_DELETED);

    this.m_connectivity.Remove(aBoardItem);

    if (aRemoveMode !== REMOVE_MODE.BULK)
      this.InvokeListeners((l) => l.OnBoardItemRemoved(this, aBoardItem));
  }

  /**
   * Add a listener to the board to receive calls whenever something on the
   * board has been modified.  The board does not take ownership of the
   * listener object.  Make sure to call RemoveListener before deleting the
   * listener object.  The order of listener invocations is not guaranteed.
   * If the specified listener object has been added before, it will not be
   * added again.
   */
  AddListener(aListener: BOARD_LISTENER): void {
    if (!this.m_listeners.includes(aListener)) this.m_listeners.push(aListener);
  }

  /**
   * Remove the specified listener.  If it has not been added before, it
   * will do nothing.
   */
  RemoveListener(aListener: BOARD_LISTENER): void {
    const i = this.m_listeners.indexOf(aListener);

    if (i >= 0) {
      // std::iter_swap( i, end - 1 ); pop_back()
      this.m_listeners[i] = this.m_listeners[this.m_listeners.length - 1]!;
      this.m_listeners.pop();
    }
  }

  /**
   * Remove all listeners
   */
  RemoveAllListeners(): void {
    this.m_listeners = [];
  }

  /**
   * Notify the board and its listeners that an item on the board has
   * been modified in some way.
   */
  OnItemChanged(aItem: BOARD_ITEM): void {
    this.InvokeListeners((l) => l.OnBoardItemChanged(this, aItem));
  }

  /**
   * Notify the board and its listeners that an item on the board has
   * been modified in some way.
   */
  OnItemsChanged(aItems: BOARD_ITEM[]): void {
    this.InvokeListeners((l) => l.OnBoardItemsChanged(this, aItems));
  }

  /**
   * Notify the board and its listeners that items on the board have
   * been modified in a composite operation.
   */
  OnItemsCompositeUpdate(
    aAddedItems: BOARD_ITEM[],
    aRemovedItems: BOARD_ITEM[],
    aChangedItems: BOARD_ITEM[],
  ): void {
    this.InvokeListeners((l) =>
      l.OnBoardCompositeUpdate(this, aAddedItems, aRemovedItems, aChangedItems),
    );
  }

  /**
   * Notify the board and its listeners that the ratsnest has been recomputed.
   */
  OnRatsnestChanged(): void {
    this.InvokeListeners((l) => l.OnBoardRatsnestChanged(this));
  }

  /** `InvokeListeners( &BOARD_LISTENER::X, *this, args... )`. */
  InvokeListeners(aFunc: (aListener: BOARD_LISTENER) => void): void {
    for (const l of this.m_listeners) aFunc(l);
  }

  /**
   * Reset all high light data to the init state
   */
  ResetNetHighLight(): void {
    this.m_highLight.Clear();
    this.m_highLightPrevious.Clear();

    this.InvokeListeners((l) => l.OnBoardHighlightNetChanged(this));
  }

  /**
   * @return the set of net codes that should be highlighted
   */
  GetHighLightNetCodes(): ReadonlySet<number> {
    return this.m_highLight.m_netCodes;
  }

  /**
   * Select the netcode to be highlighted.
   *
   * @param aNetCode is the net to highlight.
   * @param aMulti is true if you want to add a highlighted net without clearing the old one.
   */
  SetHighLightNet(aNetCode: number, aMulti = false): void {
    if (!this.m_highLight.m_netCodes.has(aNetCode)) {
      if (!aMulti) this.m_highLight.m_netCodes.clear();

      this.m_highLight.m_netCodes.add(aNetCode);
      this.InvokeListeners((l) => l.OnBoardHighlightNetChanged(this));
    }
  }

  /**
   * @return true if a net is currently highlighted
   */
  IsHighLightNetON(): boolean {
    return this.m_highLight.m_highLightOn;
  }

  /**
   * Enable or disable net highlighting.
   *
   * If a netcode >= 0 has been set with SetHighLightNet and aValue is true, the net will be
   * highlighted.  If aValue is false, net highlighting will be disabled regardless of
   * the highlight status.
   */
  HighLightON(aValue = true): void {
    if (this.m_highLight.m_highLightOn !== aValue) {
      this.m_highLight.m_highLightOn = aValue;
      this.InvokeListeners((l) => l.OnBoardHighlightNetChanged(this));
    }
  }

  /**
   * Disable net highlight.
   */
  HighLightOFF(): void {
    this.HighLightON(false);
  }
}

/** `wxString::CmpNoCase`. */
function cmpNoCase(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  return la < lb ? -1 : la > lb ? 1 : 0;
}

function FindVariantNameCaseInsensitive(aNames: readonly string[], aVariantName: string): string {
  for (const name of aNames) {
    if (cmpNoCase(name, aVariantName) === 0) return name;
  }

  return '';
}

/** `wxFileName( path ).GetFullName()`: the name with its extension, no directory. */
function wxFileNameFullName(aPath: string): string {
  const i = Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\'));

  return i < 0 ? aPath : aPath.slice(i + 1);
}

/** `std::erase( vector, value )`. */
function erase(aVector: BOARD_ITEM[], aItem: BOARD_ITEM): void {
  const i = aVector.indexOf(aItem);

  if (i >= 0) aVector.splice(i, 1);
}

/** `wxString::AfterFirst`: the part after the first `ch`, or the empty string. */
function wxAfterFirst(aStr: string, ch: string): string {
  const i = aStr.indexOf(ch);

  return i < 0 ? '' : aStr.slice(i + 1);
}

applyMixins(BOARD, [EMBEDDED_FILES]);
