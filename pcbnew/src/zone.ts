// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/zone.h` / `zone.cpp`: `ZONE`, a list of polygons defining a copper zone.
 *
 * A zone is described by a main polygon, a time stamp, a layer or a layer set, and a net name.
 * Other polygons inside the main polygon are holes in the zone.
 *
 * Not here: `Serialize`/`Deserialize` (the protobuf API) and the `ZONE_DESC`
 * property registration. The mutexes guarding the fill lists in the C++ have
 * no counterpart: the filler runs on one thread here.
 */

import { GetKiCadThreadPool } from '@ziroeda/common/src/thread_pool.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/src/eda_draw_frame.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/src/eda_item.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/src/eda_search_data.js';
import { COURTYARD_CONFLICT } from '@ziroeda/common/src/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { OutStr } from '@ziroeda/common/src/font/font.js';
import { FLASHING, GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { AccumulateDescription, unescapeString } from '@ziroeda/common/src/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import { longest_common_subset } from '@ziroeda/core/src/kicad_algo.js';
import type { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_NULL } from '@ziroeda/kimath/src/geometry/shape_null.js';
import {
  CornerStrategy,
  type HASH_128,
  SHAPE_POLY_SET,
  VERTEX_INDEX,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { type VECTOR2I, add, equal, sub } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { BOARD_ITEM, type BOARD_COMMIT_LIKE } from './board_item.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import type { PAD } from './pad.js';
import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';
import { TEARDROP_TYPE } from './teardrop/teardrop_types.js';
import {
  ISLAND_REMOVAL_MODE,
  PLACEMENT_SOURCE_T,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  ZONE_LAYER_PROPERTIES,
  type ZONE_LAYER_PROPERTIES_MAP,
  ZONE_SETTINGS,
  cloneLayerProperties,
} from './zone_settings.js';
import {
  ZONE_BORDER_HATCH_DIST_MM,
  ZONE_BORDER_HATCH_MAXDIST_MM,
  ZONE_BORDER_HATCH_MINDIST_MM,
  ZONE_CONNECTION,
} from './zones.js';

export {
  ISLAND_REMOVAL_MODE,
  PLACEMENT_SOURCE_T,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  ZONE_LAYER_PROPERTIES,
  ZONE_SETTINGS,
} from './zone_settings.js';
export { TEARDROP_TYPE } from './teardrop/teardrop_types.js';

/**
 * A struct recording the isolated and single-pad islands within a zone.  Each array holds
 * indexes into the outlines of a SHAPE_POLY_SET for a zone fill on a particular layer.
 *
 * Isolated outlines are those whose *connectivity cluster* contains no pads.  These generate
 * DRC violations.
 *
 * Single-connection outlines are those with a *direct* connection to only a single item.  These
 * participate in thermal spoke counting as a pad spoke to an *otherwise* unconnected island
 * provides no connectivity to the pad.
 */
export class ISOLATED_ISLANDS {
  m_IsolatedOutlines: number[] = [];
  m_SingleConnectionOutlines: number[] = [];
}

/** The message-panel frame's units, as `PCB_SHAPE` reads them. */
type MSG_PANEL_FRAME = EDA_DRAW_FRAME_LIKE & UNITS_PROVIDER;

/** `static SHAPE_POLY_SET g_nullPoly`. */
const g_nullPoly = new SHAPE_POLY_SET();

/**
 * Handle a list of polygons defining a copper zone.
 *
 * A zone is described by a main polygon, a time stamp, a layer or a layer set, and a net name.
 * Other polygons inside the main polygon are holes in the zone.
 */
export class ZONE extends BOARD_CONNECTED_ITEM {
  protected m_Poly: SHAPE_POLY_SET; ///< Outline of the zone.
  protected m_cornerSmoothingType: number;
  protected m_cornerRadius: number;

  /// An optional unique name for this zone, used for identifying it in DRC checking
  protected m_zoneName: string;

  protected m_layerSet: LSET;
  protected m_layerProperties: ZONE_LAYER_PROPERTIES_MAP;

  /* Priority: when a zone outline is inside and other zone, if its priority is higher
   * the other zone priority, it will be created inside.
   * if priorities are equal, a DRC error is set
   */
  protected m_priority: number;

  /* A zone outline can be a keepout zone.
   * It will be never filled, and DRC should test for pads, tracks and vias
   */
  protected m_isRuleArea: boolean;

  /**
   * Placement rule area data
   */
  protected m_placementAreaEnabled: boolean;
  protected m_placementAreaSourceType: PLACEMENT_SOURCE_T;
  protected m_placementAreaSource: string;

  /* A zone outline can be a teardrop zone with different rules for priority
   * (always bigger priority than copper zones) and never removed from a
   * copper zone having the same netcode
   */
  protected m_teardropType: TEARDROP_TYPE;

  /* For keepout zones only:
   * what is not allowed inside the keepout ( pads, tracks and vias )
   */
  protected m_doNotAllowZoneFills: boolean;
  protected m_doNotAllowVias: boolean;
  protected m_doNotAllowTracks: boolean;
  protected m_doNotAllowPads: boolean;
  protected m_doNotAllowFootprints: boolean;

  protected m_PadConnection: ZONE_CONNECTION;
  protected m_ZoneClearance: number; // Clearance value in internal units.
  protected m_ZoneMinThickness: number; // Minimum thickness value in filled areas.
  protected m_fillVersion: number; // See BOARD_DESIGN_SETTINGS for version
  // differences.
  protected m_islandRemovalMode: ISLAND_REMOVAL_MODE;

  /**
   * When island removal mode is set to AREA, islands below this area will be removed.
   * If this value is negative, all islands will be removed.
   */
  protected m_minIslandArea: number;

  /** True when a zone was filled, false after deleting the filled areas. */
  protected m_isFilled: boolean;

  /**
   * False when a zone was refilled, true after changes in zone params.
   * m_needRefill = false does not imply filled areas are up to date, just
   * the zone was refilled after edition, and does not need refilling
   */
  protected m_needRefill: boolean;

  protected m_thermalReliefGap: number; // Width of the gap in thermal reliefs.
  protected m_thermalReliefSpokeWidth: number; // Width of the copper bridge in thermal reliefs.

  protected m_fillMode: ZONE_FILL_MODE; // fill with POLYGONS vs HATCH_PATTERN
  protected m_hatchThickness: number; // thickness of lines (if 0 -> solid shape)
  protected m_hatchGap: number; // gap between lines (0 -> solid shape
  protected m_hatchOrientation: EDA_ANGLE; // orientation of grid lines
  protected m_hatchSmoothingLevel: number; // 0 = no smoothing
  // 1 = fillet
  // 2 = arc low def
  // 3 = arc high def
  protected m_hatchSmoothingValue: number; // hole chamfer/fillet size (ratio of hole size)
  protected m_hatchHoleMinArea: number; // min size before holes are dropped (ratio)
  protected m_hatchBorderAlgorithm: number; // 0 = use min zone thickness
  // 1 = use hatch thickness

  protected m_localFlgs: number; // Variable used in polygon calculations.

  /* set of filled polygons used to draw a zone as a filled area.
   * from outlines (m_Poly) but unlike m_Poly these filled polygons have no hole
   * (they are all in one piece)  In very simple cases m_FilledPolysList is same
   * as m_Poly.  In less simple cases (when m_Poly has holes) m_FilledPolysList is
   * a polygon equivalent to m_Poly, without holes but with extra outline segment
   * connecting "holes" with external main outline.  In complex cases an outline
   * described by m_Poly can have many filled areas
   */
  protected m_FilledPolysList: Map<PCB_LAYER_ID, SHAPE_POLY_SET>;

  /// Temp variables used while filling
  protected m_fillFlags: LSET;

  /// A hash value used in zone filling calculations to see if the filled areas are up to date
  protected m_filledPolysHash: Map<PCB_LAYER_ID, HASH_128>;

  protected m_borderStyle: ZONE_BORDER_DISPLAY_STYLE; // border display style, see enum above
  protected m_borderHatchPitch: number; // for DIAGONAL_EDGE, distance between 2 lines
  protected m_borderHatchLines: SEG[]; // hatch lines

  /// For each layer, a set of insulated islands that were not removed
  protected m_insulatedIslands: Map<PCB_LAYER_ID, Set<number>>;

  protected m_area: number; // The filled zone area
  protected m_outlinearea: number; // The outline zone area

  constructor(aParent: BOARD_ITEM_CONTAINER | null) {
    super(aParent, KICAD_T.PCB_ZONE_T);

    this.m_Poly = new SHAPE_POLY_SET(); // Outlines
    this.m_cornerSmoothingType = ZONE_SETTINGS.SMOOTHING_NONE;
    this.m_cornerRadius = 0;
    this.m_zoneName = '';
    this.m_layerSet = new LSET();
    this.m_layerProperties = new Map();
    this.m_priority = 0;
    this.m_isRuleArea = false;
    this.m_placementAreaEnabled = false;
    this.m_placementAreaSourceType = PLACEMENT_SOURCE_T.SHEETNAME;
    this.m_placementAreaSource = '';
    this.m_teardropType = TEARDROP_TYPE.TD_NONE;
    this.m_doNotAllowZoneFills = false;
    this.m_doNotAllowVias = false;
    this.m_doNotAllowTracks = false;
    this.m_doNotAllowPads = false;
    this.m_doNotAllowFootprints = false;
    this.m_PadConnection = ZONE_CONNECTION.NONE;
    this.m_ZoneClearance = 0;
    this.m_ZoneMinThickness = 0;
    this.m_fillVersion = 5; // set the "old" way to build filled polygon areas (< 6.0.x)
    this.m_islandRemovalMode = ISLAND_REMOVAL_MODE.ALWAYS;
    this.m_minIslandArea = 0;
    this.m_isFilled = false;
    this.m_needRefill = false;
    this.m_thermalReliefGap = 0;
    this.m_thermalReliefSpokeWidth = 0;
    this.m_fillMode = ZONE_FILL_MODE.POLYGONS;
    this.m_hatchThickness = 0;
    this.m_hatchGap = 0;
    this.m_hatchOrientation = ANGLE_0;
    this.m_hatchSmoothingLevel = 0;
    this.m_hatchSmoothingValue = 0;
    this.m_hatchHoleMinArea = 0;
    this.m_hatchBorderAlgorithm = 0;
    this.m_localFlgs = 0;
    this.m_FilledPolysList = new Map();
    this.m_fillFlags = new LSET();
    this.m_filledPolysHash = new Map();
    this.m_borderStyle = ZONE_BORDER_DISPLAY_STYLE.NO_HATCH;
    this.m_borderHatchPitch = 0;
    this.m_borderHatchLines = [];
    this.m_insulatedIslands = new Map();
    this.m_area = 0.0;
    this.m_outlinearea = 0.0;

    this.SetLocalFlags(0); // flags temporary used in zone calculations

    if (this.GetParentFootprint()) this.SetIsRuleArea(true); // Zones living in footprints have the rule area option

    if (aParent?.GetBoard())
      aParent.GetBoard()!.GetDesignSettings().GetDefaultZoneSettings().ExportSetting(this, false);
    else new ZONE_SETTINGS().ExportSetting(this, false);

    this.m_needRefill = false; // True only after edits.
  }

  /** `ZONE( const ZONE& aZone )`. */
  static copyOfZone(aZone: ZONE): ZONE {
    const copy = new ZONE(null);
    BOARD_CONNECTED_ITEM.copyConnected(copy, aZone);
    copy.InitDataFromSrcInCopyCtor(aZone);
    return copy;
  }

  /** `operator=( const ZONE& aOther )`. */
  assignZone(aOther: ZONE): this {
    this.assignConnected(aOther);
    this.InitDataFromSrcInCopyCtor(aOther);
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_ZONE_T)) return; // wxCHECK

    this.assignZone(aOther as ZONE);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && aItem.Type() === KICAD_T.PCB_ZONE_T;
  }

  /**
   * Not all ZONEs are *really* BOARD_CONNECTED_ITEMs....
   */
  override IsConnected(): boolean {
    return !this.GetIsRuleArea();
  }

  /**
   * Copy aZone data to me
   */
  InitDataFromSrcInCopyCtor(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
  ): void {
    // members are expected non initialize in this.
    // InitDataFromSrcInCopyCtor() is expected to be called only from a copy constructor.

    // Copy only useful EDA_ITEM flags:
    this.m_flags = aZone.m_flags;
    this.m_forceVisible = aZone.m_forceVisible;

    // Replace the outlines for aZone outlines.
    this.m_Poly = new SHAPE_POLY_SET(aZone.m_Poly);

    this.m_cornerSmoothingType = aZone.m_cornerSmoothingType;
    this.m_cornerRadius = aZone.m_cornerRadius;
    this.m_zoneName = aZone.m_zoneName;
    this.m_priority = aZone.m_priority;
    this.m_isRuleArea = aZone.m_isRuleArea;
    this.m_placementAreaEnabled = aZone.m_placementAreaEnabled;
    this.m_placementAreaSourceType = aZone.m_placementAreaSourceType;
    this.m_placementAreaSource = aZone.m_placementAreaSource;

    if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) this.SetLayerSet(aZone.GetLayerSet());
    else this.SetLayerSet(new LSET([aLayer]));

    this.m_doNotAllowZoneFills = aZone.m_doNotAllowZoneFills;
    this.m_doNotAllowVias = aZone.m_doNotAllowVias;
    this.m_doNotAllowTracks = aZone.m_doNotAllowTracks;
    this.m_doNotAllowPads = aZone.m_doNotAllowPads;
    this.m_doNotAllowFootprints = aZone.m_doNotAllowFootprints;

    this.m_PadConnection = aZone.m_PadConnection;
    this.m_ZoneClearance = aZone.m_ZoneClearance; // clearance value
    this.m_ZoneMinThickness = aZone.m_ZoneMinThickness;
    this.m_fillVersion = aZone.m_fillVersion;
    this.m_islandRemovalMode = aZone.m_islandRemovalMode;
    this.m_minIslandArea = aZone.m_minIslandArea;

    this.m_isFilled = aZone.m_isFilled;
    this.m_needRefill = aZone.m_needRefill;

    this.m_teardropType = aZone.m_teardropType;

    this.m_thermalReliefGap = aZone.m_thermalReliefGap;
    this.m_thermalReliefSpokeWidth = aZone.m_thermalReliefSpokeWidth;

    this.m_fillMode = aZone.m_fillMode; // solid vs. hatched
    this.m_hatchThickness = aZone.m_hatchThickness;
    this.m_hatchGap = aZone.m_hatchGap;
    this.m_hatchOrientation = aZone.m_hatchOrientation;
    this.m_hatchSmoothingLevel = aZone.m_hatchSmoothingLevel;
    this.m_hatchSmoothingValue = aZone.m_hatchSmoothingValue;
    this.m_hatchBorderAlgorithm = aZone.m_hatchBorderAlgorithm;
    this.m_hatchHoleMinArea = aZone.m_hatchHoleMinArea;

    aZone.GetLayerSet().RunOnLayers((layer: PCB_LAYER_ID) => {
      if (aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER && aLayer !== layer) return;

      const fill = aZone.m_FilledPolysList.get(layer);

      if (fill) this.m_FilledPolysList.set(layer, new SHAPE_POLY_SET(fill));
      else this.m_FilledPolysList.set(layer, new SHAPE_POLY_SET());

      this.m_filledPolysHash.set(layer, aZone.m_filledPolysHash.get(layer) ?? ''); // .at() throws on a missing key
      this.m_insulatedIslands.set(layer, new Set(aZone.m_insulatedIslands.get(layer) ?? []));
    });

    this.m_layerProperties = cloneLayerProperties(aZone.m_layerProperties);
    this.m_borderStyle = aZone.m_borderStyle;
    this.m_borderHatchPitch = aZone.m_borderHatchPitch;
    this.m_borderHatchLines = aZone.m_borderHatchLines.map((s) => new SEG(s));

    this.SetLocalFlags(aZone.GetLocalFlags());

    this.m_netinfo = aZone.m_netinfo;
    this.m_area = aZone.m_area;
    this.m_outlinearea = aZone.m_outlinearea;
  }

  /** `Clone()` and `Clone( PCB_LAYER_ID aLayer )`. */
  override Clone(aLayer?: PCB_LAYER_ID): ZONE {
    if (aLayer === undefined) return ZONE.copyOfZone(this);

    const clone = new ZONE(BOARD_ITEM.prototype.GetParent.call(this));
    clone.InitDataFromSrcInCopyCtor(this, aLayer);
    return clone;
  }

  override Duplicate(
    addToParentGroup: boolean,
    aCommit: BOARD_COMMIT_LIKE | null = null,
  ): BOARD_ITEM {
    const dupe = super.Duplicate(addToParentGroup, aCommit);

    const board = this.GetBoard();

    if (board) {
      const newZone = dupe as ZONE;

      // Give the copy its own name so it does not collide with the original (issue 23131)
      if (newZone.GetZoneName() !== '')
        newZone.SetZoneName(board.GetUniqueZoneName(newZone.GetZoneName(), newZone));
    }

    return dupe;
  }

  /**
   * For rule areas which exclude footprints (and therefore participate in courtyard conflicts
   * during move).
   */
  IsConflicting(): boolean {
    return this.HasFlag(COURTYARD_CONFLICT);
  }

  /**
   * @return a VECTOR2I, position of the first point of the outline
   */
  override GetPosition(): VECTOR2I {
    if (this.m_Poly.OutlineCount() === 0 || this.m_Poly.TotalVertices() === 0)
      return { x: 0, y: 0 };

    return this.GetCornerPosition(0);
  }

  override SetPosition(aPos: VECTOR2I): void {}

  /**
   * @param aPriority is the priority level.
   */
  SetAssignedPriority(aPriority: number): void {
    this.m_priority = aPriority;
  }

  /**
   * @return the priority level of this zone.
   */
  GetAssignedPriority(): number {
    return this.m_priority;
  }

  HigherPriority(aOther: ZONE): boolean {
    // Teardrops are always higher priority than regular zones, so if one zone is a teardrop
    // and the other is not, then return higher priority as the teardrop
    if (
      (this.m_teardropType === TEARDROP_TYPE.TD_NONE) !==
      (aOther.m_teardropType === TEARDROP_TYPE.TD_NONE)
    )
      return this.m_teardropType > aOther.m_teardropType;

    if (this.m_priority !== aOther.m_priority) return this.m_priority > aOther.m_priority;

    return this.m_Uuid > aOther.m_Uuid;
  }

  SameNet(aOther: ZONE): boolean {
    return this.GetNetCode() === aOther.GetNetCode();
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const frame = aFrame as MSG_PANEL_FRAME;
    let msg = this.GetFriendlyName();

    aList.push(new MSG_PANEL_ITEM('Type', msg));

    if (this.GetIsRuleArea()) {
      msg = '';

      if (this.GetDoNotAllowVias()) msg = AccumulateDescription(msg, 'No vias');

      if (this.GetDoNotAllowTracks()) msg = AccumulateDescription(msg, 'No tracks');

      if (this.GetDoNotAllowPads()) msg = AccumulateDescription(msg, 'No pads');

      if (this.GetDoNotAllowZoneFills()) msg = AccumulateDescription(msg, 'No zone fills');

      if (this.GetDoNotAllowFootprints()) msg = AccumulateDescription(msg, 'No footprints');

      if (msg !== '') aList.push(new MSG_PANEL_ITEM('Restrictions', msg));

      if (this.GetPlacementAreaEnabled())
        aList.push(
          new MSG_PANEL_ITEM('Placement source', unescapeString(this.GetPlacementAreaSource())),
        );
    } else if (this.IsOnCopperLayer()) {
      if (aFrame.GetName() === PCB_EDIT_FRAME_NAME) {
        aList.push(new MSG_PANEL_ITEM('Net', unescapeString(this.GetNetname())));
        aList.push(
          new MSG_PANEL_ITEM(
            'Resolved Netclass',
            unescapeString(this.GetEffectiveNetClass().GetHumanReadableName()),
          ),
        );
      }

      // Display priority level
      aList.push(new MSG_PANEL_ITEM('Priority', `${this.GetAssignedPriority()}`));
    }

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME) {
      if (this.IsLocked()) aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));
    }

    const layers = this.m_layerSet.Seq();
    let layerDesc = '';
    const board = this.GetBoard()!;

    if (layers.length === 1) {
      layerDesc = `${board.GetLayerName(layers[0]!)}`;
    } else if (layers.length === 2) {
      layerDesc = `${board.GetLayerName(layers[0]!)} and ${board.GetLayerName(layers[1]!)}`;
    } else if (layers.length === 3) {
      layerDesc = `${board.GetLayerName(layers[0]!)}, ${board.GetLayerName(layers[1]!)} and ${board.GetLayerName(layers[2]!)}`;
    } else if (layers.length > 3) {
      layerDesc = `${board.GetLayerName(layers[0]!)}, ${board.GetLayerName(layers[1]!)} and ${layers.length - 2} more`;
    }

    aList.push(new MSG_PANEL_ITEM('Layer', layerDesc));

    if (this.m_zoneName !== '') aList.push(new MSG_PANEL_ITEM('Name', this.m_zoneName));

    if (!this.GetIsRuleArea()) {
      // Show fill mode only for not rule areas
      switch (this.m_fillMode) {
        case ZONE_FILL_MODE.POLYGONS:
          msg = 'Solid';
          break;
        case ZONE_FILL_MODE.HATCH_PATTERN:
          msg = 'Hatched';
          break;
        default:
          msg = 'Unknown';
          break;
      }

      aList.push(new MSG_PANEL_ITEM('Fill Mode', msg));

      aList.push(
        new MSG_PANEL_ITEM('Filled Area', frame.MessageTextFromValue(this.m_area, true, 'area')),
      );

      const source: OutStr = { value: '' };
      const clearance = this.GetOwnClearance(PCB_LAYER_ID.UNDEFINED_LAYER, source);

      if (source.value !== '') {
        aList.push(
          new MSG_PANEL_ITEM(
            `Min Clearance: ${frame.MessageTextFromValue(clearance)}`,
            `(from ${source.value})`,
          ),
        );
      }
    }

    let count = 0;

    if (this.GetIsRuleArea()) {
      const outline_area = this.CalculateOutlineArea();

      aList.push(
        new MSG_PANEL_ITEM('Outline Area', frame.MessageTextFromValue(outline_area, true, 'area')),
      );

      const area_outline = this.Outline();
      count = area_outline.FullPointCount();
    } else if (this.m_FilledPolysList.size !== 0) {
      for (const [, poly] of this.m_FilledPolysList) count += poly.TotalVertices();
    }

    aList.push(new MSG_PANEL_ITEM('Corner Count', `${count}`));
  }

  override GetFriendlyName(): string {
    if (this.GetIsRuleArea()) return 'Rule Area';
    else if (this.IsTeardropArea()) return 'Teardrop Area';
    else if (this.IsOnCopperLayer()) return 'Copper Zone';
    else return 'Non-copper Zone';
  }

  override SetLayerSet(aLayerSet: LSET): void {
    if (aLayerSet.count() === 0) return;

    if (!this.m_layerSet.equals(aLayerSet)) {
      this.SetNeedRefill(true);

      this.unFillLocked();

      this.m_FilledPolysList.clear();
      this.m_filledPolysHash.clear();
      this.m_insulatedIslands.clear();

      aLayerSet.RunOnLayers((layer: PCB_LAYER_ID) => {
        this.m_FilledPolysList.set(layer, new SHAPE_POLY_SET());
        this.m_filledPolysHash.set(layer, '');
        this.m_insulatedIslands.set(layer, new Set());
      });

      for (const layer of [...this.m_layerProperties.keys()]) {
        if (!aLayerSet.Contains(layer)) this.m_layerProperties.delete(layer);
      }
    }

    this.m_layerSet = new LSET(aLayerSet);
  }

  override GetLayerSet(): LSET {
    return new LSET(this.m_layerSet);
  }

  /**
   * Set the zone to be on the aLayerSet layers and only remove the fill polygons
   * from the unused layers, while keeping the fills on the layers in both the old
   * and new layer sets.
   */
  SetLayerSetAndRemoveUnusedFills(aLayerSet: LSET): void {
    if (aLayerSet.count() === 0) return;

    if (!this.m_layerSet.equals(aLayerSet)) {
      aLayerSet.RunOnLayers((layer: PCB_LAYER_ID) => {
        // Only keep layers that are present in the new set
        if (!aLayerSet.Contains(layer)) {
          this.m_FilledPolysList.set(layer, new SHAPE_POLY_SET());
          this.m_filledPolysHash.set(layer, '');
          this.m_insulatedIslands.set(layer, new Set());
        }
      });
    }

    this.m_layerSet = new LSET(aLayerSet);
  }

  /** `LayerProperties( PCB_LAYER_ID aLayer )`: the entry, created on first read as `std::map::operator[]` does. */
  LayerProperties(aLayer: PCB_LAYER_ID): ZONE_LAYER_PROPERTIES;
  /** `LayerProperties()`: the whole map. */
  LayerProperties(): ZONE_LAYER_PROPERTIES_MAP;
  LayerProperties(aLayer?: PCB_LAYER_ID): ZONE_LAYER_PROPERTIES | ZONE_LAYER_PROPERTIES_MAP {
    if (aLayer === undefined) return this.m_layerProperties;

    let props = this.m_layerProperties.get(aLayer);

    if (!props) {
      props = new ZONE_LAYER_PROPERTIES();
      this.m_layerProperties.set(aLayer, props);
    }

    return props;
  }

  SetLayerProperties(aOther: ZONE_LAYER_PROPERTIES_MAP): void {
    this.m_layerProperties = cloneLayerProperties(aOther);
  }

  GetZoneName(): string {
    return this.m_zoneName;
  }
  SetZoneName(aName: string): void {
    this.m_zoneName = aName;
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    return this.matchesText(this.GetZoneName(), aSearchData);
  }

  /**
   * @return the bounding box of the zone outline.
   */
  override GetBoundingBox(): BOX2I {
    const board = this.GetBoard();

    if (board) {
      const cache = board.m_ZoneBBoxCache;

      const cached = cache.get(this);

      if (cached) return cached;

      const bbox = this.m_Poly.BBox();

      cache.set(this, bbox);

      return bbox;
    }

    return this.m_Poly.BBox();
  }

  /**
   * Used to preload the zone bounding box cache so we don't have to worry about mutex-locking
   * it each time.
   */
  CacheBoundingBox(): void {
    // GetBoundingBox() will cache it for us, and there's no sense duplicating the somewhat tricky
    // locking code.
    this.GetBoundingBox();
  }

  /**
   * `GetLocalClearance()` (the zone's clearance in internal units) and
   * `GetLocalClearance( wxString* aSource )`, which also reports the source.
   */
  override GetLocalClearance(aSource?: OutStr | null): number | undefined {
    if (aSource === undefined) return this.m_isRuleArea ? 0 : this.m_ZoneClearance;

    if (this.m_isRuleArea) return undefined;

    if (aSource) aSource.value = 'zone';

    return this.GetLocalClearance();
  }

  SetLocalClearance(aClearance: number | undefined): void {
    this.m_ZoneClearance = aClearance ?? 0;
  }

  /**
   * @return true if this zone is on a copper layer, false if on a technical layer.
   */
  override IsOnCopperLayer(): boolean {
    return this.m_layerSet.and(LSET.AllCuMask()).count() > 0;
  }

  override SetLayer(aLayer: PCB_LAYER_ID): void {
    this.SetLayerSet(new LSET([aLayer]));
  }

  override GetLayer(): PCB_LAYER_ID {
    if (this.m_layerSet.count() === 1) {
      // GetFirstLayer would try to acquire the mutex again, so inline its logic here
      if (this.m_layerSet.count() === 0) return PCB_LAYER_ID.UNDEFINED_LAYER;

      const uiLayers = this.m_layerSet.UIOrder();

      if (uiLayers.length) return uiLayers[0]!;

      return this.m_layerSet.Seq()[0]!;
    }

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  // Return the first layer in GUI sequence.
  GetFirstLayer(): PCB_LAYER_ID {
    if (this.m_layerSet.count() === 0) return PCB_LAYER_ID.UNDEFINED_LAYER;

    const uiLayers = this.m_layerSet.UIOrder();

    // This can't use m_layerSet.count() because it's possible to have a zone on
    // a rescue layer that is not in the UI order.
    if (uiLayers.length) return uiLayers[0]!;

    // If it's not in the UI set at all, just return the first layer in the set.
    // (we know the count > 0)
    return this.m_layerSet.Seq()[0]!;
  }

  override IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    return this.m_layerSet.test(aLayer);
  }

  override ViewGetLayers(): number[] {
    const layers: number[] = [];

    this.m_layerSet.RunOnLayers((layer: PCB_LAYER_ID) => {
      layers.push(layer);
      layers.push(layer + GAL_LAYER_ID.LAYER_ZONE_START);
    });

    if (this.IsConflicting()) layers.push(GAL_LAYER_ID.LAYER_CONFLICTS_SHADOW);

    return layers;
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (!aView) return ZONE.LOD_SHOW;

    if (!aView.IsLayerVisible(GAL_LAYER_ID.LAYER_ZONES)) return ZONE.LOD_HIDE;

    const parentFP = this.GetParentFootprint();

    if (parentFP) {
      const zl = this.GetLayerSet();
      let onFront = zl.and(LSET.FrontMask()).any();
      let onBack = zl.and(LSET.BackMask()).any();

      if (!onFront && !onBack) {
        onFront = parentFP.GetLayer() === PCB_LAYER_ID.F_Cu;
        onBack = parentFP.GetLayer() === PCB_LAYER_ID.B_Cu;
      }

      const frHidden = !aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR);
      const bkHidden = !aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK);

      if (onFront && !onBack && frHidden) return ZONE.LOD_HIDE;

      if (onBack && !onFront && bkHidden) return ZONE.LOD_HIDE;

      if (onFront && onBack && frHidden && bkHidden) return ZONE.LOD_HIDE;
    }

    // Other layers are shown without any conditions
    return ZONE.LOD_SHOW;
  }

  SetFillMode(aFillMode: ZONE_FILL_MODE): void {
    this.m_fillMode = aFillMode;
  }
  GetFillMode(): ZONE_FILL_MODE {
    return this.m_fillMode;
  }

  SetThermalReliefGap(aThermalReliefGap: number): void {
    if (this.m_thermalReliefGap !== aThermalReliefGap) this.SetNeedRefill(true);

    this.m_thermalReliefGap = aThermalReliefGap;
  }

  /** `GetThermalReliefGap()` and `GetThermalReliefGap( PAD* aPad, wxString* aSource )`. */
  GetThermalReliefGap(aPad?: PAD, aSource: OutStr | null = null): number {
    if (aPad === undefined) return this.m_thermalReliefGap;

    if (aPad.GetLocalThermalGapOverride() === 0) {
      if (aSource) aSource.value = 'zone';

      return this.m_thermalReliefGap;
    }

    return aPad.GetLocalThermalGapOverride(aSource);
  }

  SetThermalReliefSpokeWidth(aThermalReliefSpokeWidth: number): void {
    if (this.m_thermalReliefSpokeWidth !== aThermalReliefSpokeWidth) this.SetNeedRefill(true);

    this.m_thermalReliefSpokeWidth = aThermalReliefSpokeWidth;
  }

  GetThermalReliefSpokeWidth(): number {
    return this.m_thermalReliefSpokeWidth;
  }

  /**
   * Compute the area currently occupied by the zone fill.
   *
   * @return the currently filled area
   */
  CalculateFilledArea(): number {
    this.m_area = 0.0;

    for (const [, poly] of this.m_FilledPolysList) this.m_area += poly.Area();

    return this.m_area;
  }

  /**
   * Compute the area of the zone outline (not the filled area).
   * @return the currently calculated area
   */
  CalculateOutlineArea(): number {
    this.m_outlinearea = Math.abs(this.m_Poly.Area());
    return this.m_outlinearea;
  }

  /**
   * This area is cached from the most recent call to CalculateFilledArea().
   *
   * @return the filled area
   */
  GetFilledArea(): number {
    return this.m_area;
  }

  /**
   * This area is cached from the most recent call to CalculateOutlineArea().
   *
   * @return the outline area
   */
  GetOutlineArea(): number {
    return this.m_outlinearea;
  }

  GetFillFlag(aLayer: PCB_LAYER_ID): number {
    return this.m_fillFlags.test(aLayer) ? 1 : 0;
  }

  SetFillFlag(aLayer: PCB_LAYER_ID, aFlag: boolean): void {
    this.m_fillFlags.set(aLayer, aFlag);
  }

  IsFilled(): boolean {
    return this.m_isFilled;
  }
  SetIsFilled(isFilled: boolean): void {
    this.m_isFilled = isFilled;
  }

  NeedRefill(): boolean {
    return this.m_needRefill;
  }
  SetNeedRefill(aNeedRefill: boolean): void {
    this.m_needRefill = aNeedRefill;
  }

  GetPadConnection(): ZONE_CONNECTION {
    return this.m_PadConnection;
  }
  SetPadConnection(aPadConnection: ZONE_CONNECTION): void {
    this.m_PadConnection = aPadConnection;
  }

  GetMinThickness(): number {
    return this.m_ZoneMinThickness;
  }
  SetMinThickness(aMinThickness: number): void {
    this.m_ZoneMinThickness = aMinThickness;
    this.m_hatchThickness = Math.max(this.m_hatchThickness, aMinThickness);
    this.m_hatchGap = Math.max(this.m_hatchGap, aMinThickness);
    this.SetNeedRefill(true);
  }

  GetHatchThickness(): number {
    return this.m_hatchThickness;
  }
  SetHatchThickness(aThickness: number): void {
    this.m_hatchThickness = aThickness;
  }

  GetHatchGap(): number {
    return this.m_hatchGap;
  }
  SetHatchGap(aStep: number): void {
    this.m_hatchGap = aStep;
  }

  GetHatchOrientation(): EDA_ANGLE {
    return this.m_hatchOrientation;
  }
  SetHatchOrientation(aStep: EDA_ANGLE): void {
    this.m_hatchOrientation = aStep;
  }

  GetHatchSmoothingLevel(): number {
    return this.m_hatchSmoothingLevel;
  }
  SetHatchSmoothingLevel(aLevel: number): void {
    this.m_hatchSmoothingLevel = aLevel;
  }

  GetHatchSmoothingValue(): number {
    return this.m_hatchSmoothingValue;
  }
  SetHatchSmoothingValue(aValue: number): void {
    this.m_hatchSmoothingValue = aValue;
  }

  GetHatchHoleMinArea(): number {
    return this.m_hatchHoleMinArea;
  }
  SetHatchHoleMinArea(aPct: number): void {
    this.m_hatchHoleMinArea = aPct;
  }

  GetHatchBorderAlgorithm(): number {
    return this.m_hatchBorderAlgorithm;
  }
  SetHatchBorderAlgorithm(aAlgo: number): void {
    this.m_hatchBorderAlgorithm = aAlgo;
  }

  ///
  GetLocalFlags(): number {
    return this.m_localFlgs;
  }
  SetLocalFlags(aFlags: number): void {
    this.m_localFlgs = aFlags;
  }

  Outline(): SHAPE_POLY_SET {
    return this.m_Poly;
  }
  SetOutline(aOutline: SHAPE_POLY_SET): void {
    this.m_Poly = aOutline;
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    // Rule areas are never filled, so fall back to the outline.  DRC relies on this
    // to collide tracks, vias and pads against keepout areas.
    if (this.GetIsRuleArea()) return new SHAPE_POLY_SET(this.Outline());

    const fill = this.m_FilledPolysList.get(aLayer);

    if (!fill) return new SHAPE_NULL();
    else return fill;
  }

  /**
   * Test if a point is near an outline edge or a corner of this zone.
   *
   * @param aPosition the VECTOR2I to test
   * @return true if a hit, else false
   */
  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  /**
   * @copydoc EDA_ITEM::HitTest(const BOX2I& aRect, bool aContained, int aAccuracy) const
   */
  override HitTest(aRect: BOX2I, aContained?: boolean, aAccuracy?: number): boolean;
  /**
   * @copydoc EDA_ITEM::HitTest(const SHAPE_LINE_CHAIN& aPoly, bool aContained ) const
   */
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return this.hitTestRect(a, (b as boolean | undefined) ?? true, c ?? 0);

    if ('x' in a && 'y' in a) return this.hitTestPoint(a, (b as number | undefined) ?? 0);

    return this.hitTestChain(a, b as boolean);
  }

  /** `HitTest( const VECTOR2I& aPosition, int aAccuracy )`. */
  private hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    // When looking for an "exact" hit aAccuracy will be 0 which works poorly for very thin
    // lines.  Give it a floor.
    const accuracy = Math.max(aAccuracy, pcbIUScale.mmToIU(0.1));

    return (
      this.HitTestForCorner(aPosition, accuracy * 2) || this.HitTestForEdge(aPosition, accuracy)
    );
  }

  /**
   * Test if the given VECTOR2I is within the bounds of a filled area of this zone.
   *
   * @param aLayer is the layer to test on
   * @param aRefPos A VECTOR2I to test
   * @param aAccuracy Expand the distance by which the areas are expanded for the hittest
   * @return true if a hit, else false
   */
  HitTestFilledArea(aLayer: PCB_LAYER_ID, aRefPos: VECTOR2I, aAccuracy = 0): boolean {
    // Rule areas have no filled area, but it's generally nice to treat their interior as if it were
    // filled so that people don't have to select them by their outline (which is min-width)
    if (this.GetIsRuleArea()) return this.m_Poly.Contains(aRefPos, -1, aAccuracy);

    const fillPolys = this.m_FilledPolysList.get(aLayer);

    if (!fillPolys) return false;

    return fillPolys.Contains(aRefPos, -1, aAccuracy);
  }

  /**
   * Test if the given point is contained within a cutout of the zone.
   *
   * @param aRefPos is the point to test
   * @param aOutlineIdx is the index of the outline containing the cutout
   * @param aHoleIdx is the index of the hole
   * @return true if aRefPos is inside a zone cutout
   */
  HitTestCutout(
    aRefPos: VECTOR2I,
    aOutlineIdx: { value: number } | null = null,
    aHoleIdx: { value: number } | null = null,
  ): boolean {
    // Iterate over each outline polygon in the zone and then iterate over
    // each hole it has to see if the point is in it.
    for (let i = 0; i < this.m_Poly.OutlineCount(); i++) {
      for (let j = 0; j < this.m_Poly.HoleCount(i); j++) {
        if (this.m_Poly.Hole(i, j).PointInside(aRefPos)) {
          if (aOutlineIdx) aOutlineIdx.value = i;

          if (aHoleIdx) aHoleIdx.value = j;

          return true;
        }
      }
    }

    return false;
  }

  /**
   * Some intersecting zones, despite being on the same layer with the same net, cannot be
   * merged due to other parameters such as fillet radius.  The copper pour will end up
   * effectively merged though, so we need to do some calculations with them in mind.
   */
  GetInteractingZones(
    aLayer: PCB_LAYER_ID,
    aSameNetCollidingZones: ZONE[],
    aOtherNetIntersectingZones: ZONE[],
  ): void {
    const epsilon = pcbIUScale.mmToIU(0.001);
    const bbox = new BOX2I(this.GetBoundingBox().GetPosition(), this.GetBoundingBox().GetSize());

    bbox.Inflate(epsilon);

    for (const candidate of this.GetBoard()!.Zones() as ZONE[]) {
      if (candidate === this) continue;

      if (!candidate.GetLayerSet().test(aLayer)) continue;

      if (candidate.GetIsRuleArea() || candidate.IsTeardropArea()) continue;

      if (!candidate.GetBoundingBox().Intersects(bbox)) continue;

      if (candidate.GetNetCode() === this.GetNetCode()) {
        if (this.m_Poly.Collide(candidate.m_Poly)) aSameNetCollidingZones.push(candidate);
      } else {
        aOtherNetIntersectingZones.push(candidate);
      }
    }
  }

  /**
   * Convert solid areas full shapes to polygon set
   * (the full shape is the polygon area with a thick outline)
   * Used in 3D view
   * Arcs (ends of segments) are approximated by segments
   *
   * @param aLayer is the layer of the zone to retrieve
   * @param aBuffer = a buffer to store the polygons
   * @param aError = Maximum error allowed between true arc and polygon approx
   */
  TransformSolidAreasShapesToPolygon(aLayer: PCB_LAYER_ID, aBuffer: SHAPE_POLY_SET): void {
    const fill = this.m_FilledPolysList.get(aLayer);

    if (fill && !fill.IsEmpty()) aBuffer.Append(fill);
  }

  /**
   * Convert the outlines shape to a polygon with no holes
   * inflated (optional) by max( aClearanceValue, the zone clearance)
   * (holes are linked to external outline by overlapping segments)
   * Used in filling zones calculations
   * Circles (vias) and arcs (ends of tracks) are approximated by segments.
   *
   * @param aBuffer is a buffer to store the polygon
   * @param aClearance is the min clearance around outlines
   * @param aBoardOutline is the board outline (if a valid one exists; nullptr otherwise)
   */
  TransformSmoothedOutlineToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC,
    aBoardOutline: SHAPE_POLY_SET | null,
  ): void {
    // Creates the zone outline polygon (with holes if any)
    const polybuffer = new SHAPE_POLY_SET();

    // TODO: using GetFirstLayer() means it only works for single-layer zones....
    this.BuildSmoothedPoly(polybuffer, this.GetFirstLayer(), aBoardOutline);

    // Calculate the polygon with clearance
    // holes are linked to the main outline, so only one polygon is created.
    if (aClearance) {
      if (aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) aClearance += this.GetMaxError();

      polybuffer.Inflate(aClearance, CornerStrategy.ROUND_ALL_CORNERS, this.GetMaxError());
    }

    polybuffer.Fracture();
    aBuffer.Append(polybuffer);
  }

  /**
   * Convert the zone shape to a closed polygon
   * Used in filling zones calculations
   * Circles and arcs are approximated by segments
   *
   * @param aLayer is the layer of the filled zone to retrieve
   * @param aBuffer is a buffer to store the polygon
   * @param aClearance is the clearance around the pad
   * @param aError is the maximum deviation from true circle
   * @param ignoreLineWidth is used for edge cut items where the line width is only for
   *                        visualization
   */
  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    aIgnoreLineWidth = false,
  ): void {
    console.assert(!aIgnoreLineWidth, 'IgnoreLineWidth has no meaning for zones.');

    const fillPolys = this.m_FilledPolysList.get(aLayer);

    if (!fillPolys) return;

    if (!aClearance) {
      aBuffer.Append(fillPolys);
      return;
    }

    const temp_buf = fillPolys.CloneDropTriangulation();

    // Rebuild filled areas only if clearance is not 0
    if (aClearance > 0 || aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) {
      if (aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) aClearance += aError;

      temp_buf.InflateWithLinkedHoles(aClearance, CornerStrategy.ROUND_ALL_CORNERS, aError);
    }

    aBuffer.Append(temp_buf);
  }

  /**
   * Test if the given VECTOR2I is near a corner.
   *
   * @param  refPos     is the VECTOR2I to test.
   * @param  aAccuracy  increase the item bounding box by this amount.
   * @param  aCornerHit [out, optional] is the index of the closest vertex found when return
   *                    value is true
   * @return true if some corner was found to be closer to refPos than aClearance; false
   *         otherwise.
   */
  HitTestForCorner(refPos: VECTOR2I, aAccuracy: number, aCornerHit?: VERTEX_INDEX): boolean {
    return this.m_Poly.CollideVertex(refPos, aCornerHit, aAccuracy);
  }

  /**
   * Test if the given VECTOR2I is near a segment defined by 2 corners.
   *
   * @param  refPos     is the VECTOR2I to test.
   * @param  aAccuracy  increase the item bounding box by this amount.
   * @param  aCornerHit [out, optional] is the index of the closest vertex found when return
   *                    value is true.
   * @return true if some edge was found to be closer to refPos than aClearance.
   */
  HitTestForEdge(refPos: VECTOR2I, aAccuracy: number, aCornerHit?: VERTEX_INDEX): boolean {
    return this.m_Poly.CollideEdge(refPos, aCornerHit, aAccuracy);
  }

  /** `HitTest( const BOX2I& aRect, bool aContained, int aAccuracy )`. */
  private hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    // Calculate bounding box for zone
    const bbox = new BOX2I(this.GetBoundingBox().GetPosition(), this.GetBoundingBox().GetSize());
    bbox.Normalize();

    const arect = new BOX2I(aRect.GetPosition(), aRect.GetSize());
    arect.Normalize();
    arect.Inflate(aAccuracy);

    if (aContained) {
      return arect.Contains(bbox);
    } else {
      // Fast test: if aBox is outside the polygon bounding box, rectangles cannot intersect
      if (!arect.Intersects(bbox)) return false;

      const count = this.m_Poly.TotalVertices();

      for (let ii = 0; ii < count; ii++) {
        const vertex = this.m_Poly.CVertex(ii);
        const vertexNext = this.m_Poly.CVertex((ii + 1) % count);

        // Test if the point is within the rect
        if (arect.Contains(vertex)) return true;

        // Test if this edge intersects the rect
        if (arect.Intersects(vertex, vertexNext)) return true;
      }

      return false;
    }
  }

  /** `HitTest( const SHAPE_LINE_CHAIN& aPoly, bool aContained )`. */
  private hitTestChain(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean {
    if (aContained) {
      const outlineIntersectingSelection = (): boolean => {
        for (const segment of this.m_Poly.IterateSegments()) {
          if (aPoly.Intersects(segment)) return true;
        }

        return false;
      };

      // In the case of contained selection, all vertices of the zone outline must be inside
      // the selection polygon, so we can check only the first vertex.
      const vertexInsideSelection = (): boolean => {
        return aPoly.PointInside(this.m_Poly.CVertex(0));
      };

      return vertexInsideSelection() && !outlineIntersectingSelection();
    } else {
      // Touching selection - check if any segment of the zone contours collides with the
      // selection shape.
      for (const segment of this.m_Poly.IterateSegmentsWithHoles()) {
        if (aPoly.PointInside(segment.A)) return true;

        if (aPoly.Intersects(segment)) return true;

        // Note: aPoly.Collide() could be used instead of two test above, but it is 3x slower.
      }

      return false;
    }
  }

  /**
   * Removes the zone filling.
   *
   * @return true if a previous filling is removed, false if no change (when no filling found).
   */
  UnFill(): boolean {
    return this.unFillLocked();
  }

  /* Geometric transformations: */

  /**
   * Move the outlines
   *
   * @param offset is moving vector
   */
  override Move(offset: VECTOR2I): void {
    /* move outlines */
    this.m_Poly.Move(offset);

    // Translate existing hatch lines instead of regenerating them. HatchBorder() is expensive
    // (O(n*m) segment intersections + point-in-polygon tests) and the hatch pattern is
    // invariant under translation.
    for (const seg of this.m_borderHatchLines) {
      seg.A = add(seg.A, offset);
      seg.B = add(seg.B, offset);
    }

    /* move fills */
    for (const [, poly] of this.m_FilledPolysList) poly.Move(offset);

    /*
     * move boundingbox cache
     *
     * While the cache will get nuked at the conclusion of the operation, we use it for some
     * things (such as drawing the parent group) during the move.
     */
    const board = this.GetBoard();

    if (board) {
      const it = board.m_ZoneBBoxCache.get(this);

      if (it) it.Move(offset);
    }
  }

  /**
   * Move the outline Edge.
   *
   * @param offset is moving vector
   * @param aEdge is start point of the outline edge
   */
  MoveEdge(offset: VECTOR2I, aEdge: number): void {
    const next_corner = { value: 0 };

    if (this.m_Poly.GetNeighbourIndexes(aEdge, undefined, next_corner)) {
      this.m_Poly.SetVertex(aEdge, add(this.m_Poly.CVertex(aEdge), offset));
      this.m_Poly.SetVertex(next_corner.value, add(this.m_Poly.CVertex(next_corner.value), offset));
      this.HatchBorder();

      this.SetNeedRefill(true);
    }
  }

  /**
   * Rotate the outlines.
   *
   * @param aCentre is rot centre
   */
  override Rotate(aCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_Poly.Rotate(aAngle, aCentre);
    this.HatchBorder();

    /* rotate filled areas: */
    for (const [, poly] of this.m_FilledPolysList) poly.Rotate(aAngle, aCentre);
  }

  /**
   * Flip this object, i.e. change the board side for this object
   * (like Mirror() but changes layer).
   *
   * @param aCentre is the rotation point.
   * @param aFlipDirection is the direction of the flip.
   */
  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.Mirror(aCentre, aFlipDirection);

    const fillsCopy = new Map<PCB_LAYER_ID, SHAPE_POLY_SET>();

    for (const [oldLayer, shape] of this.m_FilledPolysList)
      fillsCopy.set(oldLayer, new SHAPE_POLY_SET(shape));

    const layerPropertiesCopy = cloneLayerProperties(this.m_layerProperties);

    const flipped = new LSET();

    for (const layer of this.GetLayerSet()) flipped.set(this.GetBoard()!.FlipLayer(layer));

    this.SetLayerSet(flipped);

    for (const [oldLayer, properties] of layerPropertiesCopy) {
      const newLayer = this.GetBoard()!.FlipLayer(oldLayer);
      this.m_layerProperties.set(newLayer, properties);
    }

    for (const [oldLayer, shape] of fillsCopy) {
      const newLayer = this.GetBoard()!.FlipLayer(oldLayer);
      this.SetFilledPolysList(newLayer, shape);
    }
  }

  /**
   * Mirror the outlines relative to a given horizontal axis the layer is not changed.
   *
   * @param aMirrorRef is axis position
   * @param aFlipDirection is the direction of the flip.
   */
  override Mirror(aMirrorRef: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.m_Poly.Mirror(aMirrorRef, aFlipDirection);

    this.HatchBorder();

    for (const [, poly] of this.m_FilledPolysList) poly.Mirror(aMirrorRef, aFlipDirection);
  }

  /**
   * @return the class name.
   */
  GetClass(): string {
    return 'ZONE';
  }

  /**
   * Access to m_Poly parameters
   */
  GetNumCorners(): number {
    return this.m_Poly.TotalVertices();
  }

  /**
   * Return an iterator to visit all points of the zone's main outline without holes.
   *
   * @return an iterator to visit the zone vertices without holes.
   */
  Iterate() {
    return this.m_Poly.Iterate();
  }

  /**
   * Return an iterator to visit all points of the zone's main outline with holes.
   *
   * @return an iterator to visit the zone vertices with holes.
   */
  IterateWithHoles() {
    return this.m_Poly.IterateWithHoles();
  }

  /**
   * Return an iterator to visit all points of the zone's main outline with holes.
   *
   * @return an iterator to visit the zone vertices with holes.
   */
  CIterateWithHoles() {
    return this.m_Poly.CIterateWithHoles();
  }

  RemoveAllContours(): void {
    this.m_Poly.RemoveAllContours();
  }

  GetCornerPosition(aCornerIndex: number): VECTOR2I {
    const index = new VERTEX_INDEX();

    // Convert global to relative indices
    if (!this.m_Poly.GetRelativeIndices(aCornerIndex, index))
      throw new RangeError('aCornerIndex-th vertex does not exist'); // std::out_of_range

    return this.m_Poly.CVertex(index);
  }

  /**
   * Create a new hole on the zone; i.e., a new contour on the zone's outline.
   */
  NewHole(): void {
    this.m_Poly.NewHole();
  }

  /**
   * Add a new corner to the zone outline (to the main outline or a hole)
   *
   * @param aPosition         is the position of the new corner.
   * @param aHoleIdx          is the index of the hole (-1 for the main outline, >= 0 for hole).
   * @param aAllowDuplication is a flag to indicate whether it is allowed to add this corner
   *                          even if it is duplicated.
   * @return true if the corner was added, false if error (aHoleIdx > hole count -1)
   */
  AppendCorner(aPosition: VECTOR2I, aHoleIdx: number, aAllowDuplication = false): boolean {
    // Ensure the main outline exists:
    if (this.m_Poly.OutlineCount() === 0) this.m_Poly.NewOutline();

    // If aHoleIdx >= 0, the corner musty be added to the hole, index aHoleIdx.
    // (remember: the index of the first hole is 0)
    // Return error if it does not exist.
    if (aHoleIdx >= this.m_Poly.HoleCount(0)) return false;

    this.m_Poly.Append(aPosition.x, aPosition.y, -1, aHoleIdx, aAllowDuplication);

    this.SetNeedRefill(true);

    return true;
  }

  GetHatchStyle(): ZONE_BORDER_DISPLAY_STYLE {
    return this.m_borderStyle;
  }
  SetHatchStyle(aStyle: ZONE_BORDER_DISPLAY_STYLE): void {
    this.m_borderStyle = aStyle;
  }

  HasFilledPolysForLayer(aLayer: PCB_LAYER_ID): boolean {
    return this.m_FilledPolysList.has(aLayer);
  }

  /**
   * @return a reference to the list of filled polygons.
   */
  GetFilledPolysList(aLayer: PCB_LAYER_ID): SHAPE_POLY_SET {
    console.assert(this.m_FilledPolysList.has(aLayer));

    const fill = this.m_FilledPolysList.get(aLayer);

    if (!fill)
      throw new Error(`ZONE::GetFilledPolysList: no fill for layer ${PCB_LAYER_ID[aLayer]}`); // .at() throws

    return fill;
  }

  GetFill(aLayer: PCB_LAYER_ID): SHAPE_POLY_SET | null {
    const it = this.m_FilledPolysList.get(aLayer);

    if (!it) return null;

    return it;
  }

  /**
   * `CacheTriangulation( UNDEFINED_LAYER )` as `BOARD::CacheTriangulation`'s
   * thread-pool task: every fill and the outline are submitted to
   * `GetKiCadThreadPool()` and installed as the answers come back. A polygon
   * whose triangulation is up to date is skipped, as `cacheTriangulation`
   * itself skips it.
   */
  async CacheTriangulationAsync(): Promise<void> {
    const tp = GetKiCadThreadPool();
    const jobs: Promise<void>[] = [];
    const submit = (poly: SHAPE_POLY_SET, aPartition: boolean): void => {
      if (poly.IsTriangulationUpToDate()) return;

      jobs.push(
        tp
          .submit_task('triangulate', poly.TriangulationJob(aPartition))
          .then((result) => poly.SetTriangulation(result)),
      );
    };

    for (const [, poly] of this.m_FilledPolysList) submit(poly, true);

    submit(this.m_Poly, false);
    await Promise.all(jobs);
  }

  /**
   * Create a list of triangles that "fill" the solid areas used for instance to draw
   * these solid areas on OpenGL.
   */
  CacheTriangulation(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER): void {
    if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      for (const [, poly] of this.m_FilledPolysList) poly.CacheTriangulation();

      this.m_Poly.CacheTriangulation(false);
    } else {
      // Grab a shared_ptr copy under the lock, then triangulate outside it.
      // Each layer's SHAPE_POLY_SET is independent, so concurrent triangulation
      // of different layers is safe once we have the shared_ptr.
      const poly = this.m_FilledPolysList.get(aLayer);

      if (poly) poly.CacheTriangulation();
    }
  }

  /**
   * Set the list of filled polygons.
   */
  SetFilledPolysList(aLayer: PCB_LAYER_ID, aPolysList: SHAPE_POLY_SET): void {
    this.m_FilledPolysList.set(aLayer, new SHAPE_POLY_SET(aPolysList));
  }

  /**
   * Check if a given filled polygon is an insulated island.
   *
   * @param aLayer is the layer to test
   * @param aPolyIdx is an index into m_FilledPolysList[aLayer]
   * @return true if the given polygon is insulated (i.e. has no net connection)
   */
  IsIsland(aLayer: PCB_LAYER_ID, aPolyIdx: number): boolean {
    if (this.GetNetCode() < 1) return true;

    const islands = this.m_insulatedIslands.get(aLayer);

    if (!islands) return false;

    return islands.has(aPolyIdx);
  }

  SetIsIsland(aLayer: PCB_LAYER_ID, aPolyIdx: number): void {
    let islands = this.m_insulatedIslands.get(aLayer);

    if (!islands) {
      islands = new Set();
      this.m_insulatedIslands.set(aLayer, islands);
    }

    islands.add(aPolyIdx);
  }

  BuildSmoothedPoly(
    aSmoothedPoly: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aBoardOutline: SHAPE_POLY_SET | null,
    aSmoothedPolyWithApron: SHAPE_POLY_SET | null = null,
  ): boolean {
    if (this.GetNumCorners() <= 2)
      // malformed zone. polygon calculations will not like it ...
      return false;

    // Processing of arc shapes in zones is not yet supported because Clipper can't do boolean
    // operations on them.  The poly outline must be converted to segments first.
    const flattened = this.m_Poly.CloneDropTriangulation();
    flattened.ClearArcs();

    if (this.GetIsRuleArea()) {
      // We like keepouts just the way they are....
      aSmoothedPoly.assign(flattened);
      return true;
    }

    const board = this.GetBoard();
    let keepExternalFillets = false;
    let smooth_requested =
      this.m_cornerSmoothingType === ZONE_SETTINGS.SMOOTHING_CHAMFER ||
      this.m_cornerSmoothingType === ZONE_SETTINGS.SMOOTHING_FILLET;

    if (this.IsTeardropArea()) {
      // We use teardrop shapes with no smoothing; these shapes are already optimized
      smooth_requested = false;
    }

    if (board) keepExternalFillets = board.GetDesignSettings().m_ZoneKeepExternalFillets;

    const smooth = (aPoly: SHAPE_POLY_SET): void => {
      if (!smooth_requested) return;

      switch (this.m_cornerSmoothingType) {
        case ZONE_SETTINGS.SMOOTHING_CHAMFER:
          aPoly.assign(aPoly.Chamfer(this.m_cornerRadius));
          break;

        case ZONE_SETTINGS.SMOOTHING_FILLET:
          aPoly.assign(aPoly.Fillet(this.m_cornerRadius, this.GetMaxError()));
          break;

        default:
          break;
      }
    };

    let maxExtents = flattened;
    const withFillets = new SHAPE_POLY_SET();

    aSmoothedPoly.assign(flattened);

    // Should external fillets (that is, those applied to concave corners) be kept?  While it
    // seems safer to never have copper extend outside the zone outline, 5.1.x and prior did
    // indeed fill them so we leave the mode available.
    if (keepExternalFillets && smooth_requested) {
      withFillets.assign(flattened);
      smooth(withFillets);
      withFillets.BooleanAdd(flattened);
      maxExtents = withFillets;
    }

    // We now add in the areas of any same-net, intersecting zones.  This keeps us from smoothing
    // corners at an intersection (which often produces undesired divots between the intersecting
    // zones -- see #2752).
    //
    // After smoothing, we'll subtract back out everything outside of our zone.
    const sameNetCollidingZones: ZONE[] = [];
    const diffNetIntersectingZones: ZONE[] = [];
    this.GetInteractingZones(aLayer, sameNetCollidingZones, diffNetIntersectingZones);

    for (const sameNetZone of sameNetCollidingZones) {
      const sameNetBoundingBox = sameNetZone.GetBoundingBox();

      // Note: a two-pass algorithm could use sameNetZone's actual fill instead of its outline.
      // This would obviate the need for the below wrinkles, in addition to fixing both issues
      // in #16095.
      // (And we wouldn't need to collect all the diffNetIntersectingZones either.)

      const sameNetPoly = sameNetZone.Outline().CloneDropTriangulation();
      const diffNetPoly = new SHAPE_POLY_SET();

      sameNetPoly.ClearArcs();

      // Of course there's always a wrinkle.  The same-net intersecting zone *might* get knocked
      // out along the border by a higher-priority, different-net zone.  #12797
      for (const diffNetZone of diffNetIntersectingZones) {
        if (
          diffNetZone.HigherPriority(sameNetZone) &&
          diffNetZone.GetBoundingBox().Intersects(sameNetBoundingBox)
        ) {
          const diffNetOutline = diffNetZone.Outline().CloneDropTriangulation();
          diffNetOutline.ClearArcs();
          diffNetPoly.BooleanAdd(diffNetOutline);
        }
      }

      // Second wrinkle.  After unioning the higher priority, different net zones together, we
      // need to check to see if they completely enclose our zone.  If they do, then we need to
      // treat the enclosed zone as isolated, not connected to the outer zone.  #13915
      let isolated = false;

      if (diffNetPoly.OutlineCount()) {
        const thisPoly = this.Outline().CloneDropTriangulation();
        thisPoly.ClearArcs();

        thisPoly.BooleanSubtract(diffNetPoly);
        isolated = thisPoly.OutlineCount() === 0;
      }

      if (!isolated) aSmoothedPoly.BooleanAdd(sameNetPoly);
    }

    if (aBoardOutline) {
      const boardOutline = aBoardOutline.CloneDropTriangulation();
      boardOutline.ClearArcs();
      aSmoothedPoly.BooleanIntersection(boardOutline);
    }

    const withSameNetIntersectingZones = aSmoothedPoly.CloneDropTriangulation();

    smooth(aSmoothedPoly);

    if (aSmoothedPolyWithApron) {
      // The same-net intersecting-zone code above makes sure the corner-smoothing algorithm
      // doesn't produce divots.  But the min-thickness algorithm applied in fillCopperZone()
      // is *also* going to perform a deflate/inflate cycle, again leading to divots.  So we
      // pre-inflate the contour by the min-thickness within the same-net-intersecting-zones
      // envelope.
      const poly = maxExtents.CloneDropTriangulation();
      poly.Inflate(this.m_ZoneMinThickness, CornerStrategy.ROUND_ALL_CORNERS, this.GetMaxError());

      if (!keepExternalFillets) poly.BooleanIntersection(withSameNetIntersectingZones);

      aSmoothedPolyWithApron.assign(aSmoothedPoly);
      aSmoothedPolyWithApron.BooleanIntersection(poly);
    }

    aSmoothedPoly.BooleanIntersection(maxExtents);

    return true;
  }

  SetCornerSmoothingType(aType: number): void {
    this.m_cornerSmoothingType = aType;
  }
  GetCornerSmoothingType(): number {
    return this.m_cornerSmoothingType;
  }

  SetCornerRadius(aRadius: number): void {
    if (this.m_cornerRadius !== aRadius) this.SetNeedRefill(true);

    this.m_cornerRadius = aRadius;
  }
  GetCornerRadius(): number {
    return this.m_cornerRadius;
  }

  /**
   * Remove a cutout from the zone.
   *
   * @param aOutlineIdx is the zone outline the hole belongs to
   * @param aHoleIdx is the hole in the outline to remove
   */
  RemoveCutout(aOutlineIdx: number, aHoleIdx: number): void {
    // Ensure the requested cutout is valid
    if (this.m_Poly.OutlineCount() < aOutlineIdx || this.m_Poly.HoleCount(aOutlineIdx) < aHoleIdx)
      return;

    const cutPoly = new SHAPE_POLY_SET(this.m_Poly.Hole(aOutlineIdx, aHoleIdx));

    // Add the cutout back to the zone
    this.m_Poly.BooleanAdd(cutPoly);

    this.SetNeedRefill(true);
  }

  /**
   * Add a polygon to the zone outline.
   *
   * If the zone outline is empty, this is the main outline.  Otherwise it is a hole
   * inside the main outline.
   */
  AddPolygon(aPolygon: readonly VECTOR2I[] | SHAPE_LINE_CHAIN): void {
    if (!(aPolygon instanceof SHAPE_LINE_CHAIN)) {
      if (aPolygon.length === 0) return;

      const outline = new SHAPE_LINE_CHAIN();

      // Create an outline and populate it with the points of aPolygon
      for (const pt of aPolygon) outline.Append(pt);

      outline.SetClosed(true);

      this.AddPolygon(outline);
      return;
    }

    console.assert(aPolygon.IsClosed());

    // Add the outline as a new polygon in the polygon set
    if (this.m_Poly.OutlineCount() === 0) this.m_Poly.AddOutline(aPolygon);
    else this.m_Poly.AddHole(aPolygon);

    this.SetNeedRefill(true);
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    const layers = this.m_layerSet.Seq();
    let layerDesc = '';
    const board = this.GetBoard()!;

    if (layers.length === 1) {
      layerDesc = `on ${board.GetLayerName(layers[0]!)}`;
    } else if (layers.length === 2) {
      layerDesc = `on ${board.GetLayerName(layers[0]!)} and ${board.GetLayerName(layers[1]!)}`;
    } else if (layers.length === 3) {
      layerDesc = `on ${board.GetLayerName(layers[0]!)}, ${board.GetLayerName(layers[1]!)} and ${board.GetLayerName(layers[2]!)}`;
    } else if (layers.length > 3) {
      layerDesc = `on ${board.GetLayerName(layers[0]!)}, ${board.GetLayerName(layers[1]!)} and ${layers.length - 2} more`;
    }

    if (this.GetIsRuleArea()) {
      if (this.GetZoneName() === '') {
        return `Rule Area ${layerDesc}`;
      } else {
        return `Rule area '${this.GetZoneName()}' ${layerDesc}`;
      }
    } else if (this.IsTeardropArea()) {
      return `Teardrop ${this.GetNetnameMsg()} ${layerDesc}`;
    } else {
      if (this.GetZoneName() === '') {
        return `Zone ${this.GetNetnameMsg()} ${layerDesc}, priority ${this.GetAssignedPriority()}`;
      } else {
        return `Zone '${this.GetZoneName()}' ${this.GetNetnameMsg()} ${layerDesc}, priority ${this.GetAssignedPriority()}`;
      }
    }
  }

  override GetMenuImage(): string {
    return 'add_zone';
  }

  /**
   * @return true if the zone is a teardrop area
   */
  IsTeardropArea(): boolean {
    return this.m_teardropType !== TEARDROP_TYPE.TD_NONE;
  }

  /**
   * Set the type of teardrop if the zone is a teardrop area
   * for non teardrop area, the type must be TEARDROP_TYPE::TD_NONE
   */
  SetTeardropAreaType(aType: TEARDROP_TYPE): void {
    this.m_teardropType = aType;
  }

  /**
   * @return the type of the teardrop ( has meaning only if the zone is a teardrop area)
   */
  GetTeardropAreaType(): TEARDROP_TYPE {
    return this.m_teardropType;
  }

  /**
   * Accessor to determine if any keepout parameters are set
   */
  HasKeepoutParametersSet(): boolean {
    return (
      this.m_doNotAllowTracks ||
      this.m_doNotAllowVias ||
      this.m_doNotAllowPads ||
      this.m_doNotAllowFootprints ||
      this.m_doNotAllowZoneFills
    );
  }

  /**
   * Accessors to parameters used in Rule Area zones:
   */
  GetIsRuleArea(): boolean {
    return this.m_isRuleArea;
  }
  SetIsRuleArea(aEnable: boolean): void {
    this.m_isRuleArea = aEnable;
  }

  GetPlacementAreaEnabled(): boolean {
    return this.m_placementAreaEnabled;
  }
  SetPlacementAreaEnabled(aEnabled: boolean): void {
    this.m_placementAreaEnabled = aEnabled;
  }

  GetPlacementAreaSource(): string {
    return this.m_placementAreaSource;
  }
  SetPlacementAreaSource(aSource: string): void {
    this.m_placementAreaSource = aSource;
  }

  GetPlacementAreaSourceType(): PLACEMENT_SOURCE_T {
    return this.m_placementAreaSourceType;
  }
  SetPlacementAreaSourceType(aType: PLACEMENT_SOURCE_T): void {
    this.m_placementAreaSourceType = aType;
  }

  GetDoNotAllowZoneFills(): boolean {
    return this.m_doNotAllowZoneFills;
  }
  GetDoNotAllowVias(): boolean {
    return this.m_doNotAllowVias;
  }
  GetDoNotAllowTracks(): boolean {
    return this.m_doNotAllowTracks;
  }
  GetDoNotAllowPads(): boolean {
    return this.m_doNotAllowPads;
  }
  GetDoNotAllowFootprints(): boolean {
    return this.m_doNotAllowFootprints;
  }

  SetDoNotAllowZoneFills(aEnable: boolean): void {
    this.m_doNotAllowZoneFills = aEnable;
  }
  SetDoNotAllowVias(aEnable: boolean): void {
    this.m_doNotAllowVias = aEnable;
  }
  SetDoNotAllowTracks(aEnable: boolean): void {
    this.m_doNotAllowTracks = aEnable;
  }
  SetDoNotAllowPads(aEnable: boolean): void {
    this.m_doNotAllowPads = aEnable;
  }
  SetDoNotAllowFootprints(aEnable: boolean): void {
    this.m_doNotAllowFootprints = aEnable;
  }

  GetIslandRemovalMode(): ISLAND_REMOVAL_MODE {
    return this.m_islandRemovalMode;
  }
  SetIslandRemovalMode(aRemove: ISLAND_REMOVAL_MODE): void {
    this.m_islandRemovalMode = aRemove;
  }

  GetMinIslandArea(): number {
    return this.m_minIslandArea;
  }
  SetMinIslandArea(aArea: number): void {
    this.m_minIslandArea = aArea;
  }

  /**
   * HatchBorder related methods
   */

  /**
   * @return the zone hatch pitch in iu.
   */
  GetBorderHatchPitch(): number {
    return this.m_borderHatchPitch;
  }
  SetBorderHatchPitch(aPitch: number): void {
    this.m_borderHatchPitch = aPitch;
  }

  /**
   * @return the default hatch pitch in internal units.
   */
  static GetDefaultHatchPitch(): number {
    return pcbIUScale.mmToIU(ZONE_BORDER_HATCH_DIST_MM);
  }

  /**
   * Set all hatch parameters for the zone.
   *
   * @param  aBorderHatchStyle   is the style of the hatch, specified as one of HATCH_STYLE
   *                             possible values.
   * @param  aBorderHatchPitch   is the hatch pitch in iu.
   * @param  aRebuildBorderHatch is a flag to indicate whether to re-hatch after having set the
   *                       previous parameters.
   */
  SetBorderDisplayStyle(
    aBorderHatchStyle: ZONE_BORDER_DISPLAY_STYLE,
    aBorderHatchPitch: number,
    aRebuildBorderHatch: boolean,
  ): void {
    aBorderHatchPitch = Math.max(
      aBorderHatchPitch,
      pcbIUScale.mmToIU(ZONE_BORDER_HATCH_MINDIST_MM),
    );
    aBorderHatchPitch = Math.min(
      aBorderHatchPitch,
      pcbIUScale.mmToIU(ZONE_BORDER_HATCH_MAXDIST_MM),
    );
    this.SetBorderHatchPitch(aBorderHatchPitch);
    this.m_borderStyle = aBorderHatchStyle;

    if (aRebuildBorderHatch) this.HatchBorder();
  }

  /**
   * Clear the zone's hatch.
   */
  UnHatchBorder(): void {
    this.m_borderHatchLines = [];
  }

  /**
   * Compute the hatch lines depending on the hatch parameters and stores it in the zone's
   * attribute m_borderHatchLines.
   */
  HatchBorder(): void {
    this.UnHatchBorder();

    if (
      this.m_borderStyle === ZONE_BORDER_DISPLAY_STYLE.NO_HATCH ||
      this.m_borderHatchPitch === 0 ||
      this.m_Poly.IsEmpty()
    ) {
      return;
    }

    // set the "length" of hatch lines (the length on horizontal axis)
    let hatch_line_len = this.m_borderHatchPitch; // OK for DIAGONAL_EDGE style

    // Calculate spacing between 2 hatch lines
    let spacing = this.m_borderHatchPitch; // OK for DIAGONAL_EDGE style

    if (this.m_borderStyle === ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL) {
      // The spacing is twice the spacing for DIAGONAL_EDGE because one
      // full diagonal replaces 2 edge diagonal hatch segments in code
      spacing = this.m_borderHatchPitch * 2;
      hatch_line_len = -1; // Use full diagonal hatch line
    }

    // To have a better look, give a slope depending on the layer
    const layer = this.GetFirstLayer();
    let slopes: number[];

    if (this.IsTeardropArea()) slopes = [0.7, -0.7];
    else if (layer & 1) slopes = [1];
    else slopes = [-1];

    this.m_borderHatchLines = this.m_Poly.GenerateHatchLines(slopes, spacing, hatch_line_len);
  }

  GetHatchLines(): readonly SEG[] {
    return this.m_borderHatchLines;
  }

  /**
   * Build the hash value of m_FilledPolysList, and store it internally in m_filledPolysHash.
   * Used in zone filling calculations, to know if m_FilledPolysList is up to date.
   */
  BuildHashValue(aLayer: PCB_LAYER_ID): void {
    const fill = this.m_FilledPolysList.get(aLayer);

    if (!fill) this.m_filledPolysHash.set(aLayer, g_nullPoly.GetHash());
    else this.m_filledPolysHash.set(aLayer, fill.GetHash());
  }

  /**
   * @return the hash value previously calculated by BuildHashValue().
   */
  GetHashValue(aLayer: PCB_LAYER_ID): HASH_128 {
    const hash = this.m_filledPolysHash.get(aLayer);

    if (hash === undefined) return g_nullPoly.GetHash();
    else return hash;
  }

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as ZONE;

    if (this.GetIsRuleArea() !== other.GetIsRuleArea()) return 0.0;

    let similarity = 1.0;

    if (!this.GetLayerSet().equals(other.GetLayerSet())) similarity *= 0.9;

    if (this.GetNetCode() !== other.GetNetCode()) similarity *= 0.9;

    if (!this.GetIsRuleArea()) {
      if (this.GetAssignedPriority() !== other.GetAssignedPriority()) similarity *= 0.9;

      if (this.GetMinThickness() !== other.GetMinThickness()) similarity *= 0.9;

      if (this.GetCornerSmoothingType() !== other.GetCornerSmoothingType()) similarity *= 0.9;

      if (this.GetCornerRadius() !== other.GetCornerRadius()) similarity *= 0.9;

      if (!this.GetTeardropParams().equals(other.GetTeardropParams())) similarity *= 0.9;
    } else {
      if (this.GetDoNotAllowZoneFills() !== other.GetDoNotAllowZoneFills()) similarity *= 0.9;

      if (this.GetDoNotAllowTracks() !== other.GetDoNotAllowTracks()) similarity *= 0.9;

      if (this.GetDoNotAllowVias() !== other.GetDoNotAllowVias()) similarity *= 0.9;

      if (this.GetDoNotAllowFootprints() !== other.GetDoNotAllowFootprints()) similarity *= 0.9;

      if (this.GetDoNotAllowPads() !== other.GetDoNotAllowPads()) similarity *= 0.9;
    }

    const corners: VECTOR2I[] = [];
    const otherCorners: VECTOR2I[] = [];
    let lastCorner: VECTOR2I = { x: 0, y: 0 };

    for (let ii = 0; ii < this.GetNumCorners(); ii++) {
      corners.push(sub(lastCorner, this.GetCornerPosition(ii)));
      lastCorner = this.GetCornerPosition(ii);
    }

    lastCorner = { x: 0, y: 0 };

    for (let ii = 0; ii < other.GetNumCorners(); ii++) {
      otherCorners.push(sub(lastCorner, other.GetCornerPosition(ii)));
      lastCorner = other.GetCornerPosition(ii);
    }

    const longest = longest_common_subset(corners, otherCorners, equal);

    similarity *= 0.9 ** (this.GetNumCorners() + other.GetNumCorners() - 2 * longest);

    return similarity;
  }

  /** `operator==( const ZONE& aOther )`. */
  equalsZone(aOther: ZONE): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther;

    if (this.GetIsRuleArea() !== other.GetIsRuleArea()) return false;

    if (this.GetIsRuleArea()) {
      if (this.GetDoNotAllowZoneFills() !== other.GetDoNotAllowZoneFills()) return false;

      if (this.GetDoNotAllowTracks() !== other.GetDoNotAllowTracks()) return false;

      if (this.GetDoNotAllowVias() !== other.GetDoNotAllowVias()) return false;

      if (this.GetDoNotAllowFootprints() !== other.GetDoNotAllowFootprints()) return false;

      if (this.GetDoNotAllowPads() !== other.GetDoNotAllowPads()) return false;

      if (this.GetPlacementAreaEnabled() !== other.GetPlacementAreaEnabled()) return false;

      if (this.GetPlacementAreaSourceType() !== other.GetPlacementAreaSourceType()) return false;

      if (this.GetPlacementAreaSource() !== other.GetPlacementAreaSource()) return false;
    } else {
      if (this.GetAssignedPriority() !== other.GetAssignedPriority()) return false;

      if (this.GetMinThickness() !== other.GetMinThickness()) return false;

      if (this.GetCornerSmoothingType() !== other.GetCornerSmoothingType()) return false;

      if (this.GetCornerRadius() !== other.GetCornerRadius()) return false;

      if (!this.GetTeardropParams().equals(other.GetTeardropParams())) return false;
    }

    if (this.GetNumCorners() !== other.GetNumCorners()) return false;

    for (let ii = 0; ii < this.GetNumCorners(); ii++) {
      if (!equal(this.GetCornerPosition(ii), other.GetCornerPosition(ii))) return false;
    }

    return true;
  }

  /** `operator==( const BOARD_ITEM& aOther )`. */
  equals(aOther: BOARD_ITEM): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther as ZONE;

    return this.equalsZone(other);
  }

  /**
   * Internal implementation of UnFill() that assumes the caller already holds
   * m_filledPolysListMutex. This is needed because SetLayerSet() already acquires the mutex
   * via scoped_lock before calling this.
   */
  private unFillLocked(): boolean {
    let change = false;

    for (const [layer, fill] of this.m_FilledPolysList) {
      change ||= !fill.IsEmpty();
      this.m_insulatedIslands.get(layer)?.clear();
      // Replace the shared_ptr with a new empty object rather than clearing the existing one.
      // This ensures that any CN_ZONE_LAYERs holding shared_ptr copies still have valid data
      // (the old, now orphaned SHAPE_POLY_SET) while we get a fresh container.
      this.m_FilledPolysList.set(layer, new SHAPE_POLY_SET());
    }

    this.m_isFilled = false;
    this.m_fillFlags.reset();

    return change;
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_ZONE_T);

    const image = aImage as ZONE;
    const mine = ZONE.copyOfZone(this);

    // std::swap moves every member, the ones operator= leaves alone included
    this.assignZone(image);
    this.swapRestFrom(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;

    image.assignZone(mine);
    image.swapRestFrom(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
  }

  /** The members `InitDataFromSrcInCopyCtor` leaves alone but `std::swap` moves. */
  private swapRestFrom(aOther: ZONE): void {
    this.m_fillFlags = new LSET(aOther.m_fillFlags);
    this.m_localFlgs = aOther.m_localFlgs;
  }
}
