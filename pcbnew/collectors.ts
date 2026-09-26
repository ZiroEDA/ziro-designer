// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/collectors.h` + `.cpp`: the COLLECTOR implementations used to
 * augment the functionality of class PCB_EDIT_FRAME.
 *
 * `PCB_COLLECTOR`, `PCB_TYPE_COLLECTOR`, `PCB_LAYER_COLLECTOR`, and
 * `GENERAL_COLLECTOR` with its `COLLECTORS_GUIDE` — the selection tool's
 * hit-tester, which decides what a click lands on.
 */
import { COLLECTOR } from '@ziroeda/common/collector.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { INSPECT_RESULT } from '@ziroeda/common/eda_item.js';
import { IsBackLayer, IsFrontLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import type { LSET } from '@ziroeda/common/lset.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { FOOTPRINT } from './footprint.js';
import { UNCONNECTED_NET } from './netinfo.js';
import { PAD_ATTRIB } from './padstack.js';
import type { PAD } from './pad.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import type { PCB_FIELD } from './pcb_field.js';
import type { PCB_GROUP } from './pcb_group.js';
import type { PCB_MARKER } from './pcb_marker.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { PCB_TRACK, PCB_VIA } from './pcb_track.js';
import { VIATYPE } from './pcb_track_types.js';
import type { ZONE } from './zone.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_ITEM } from './board_item.js';

/**
 * Override #COLLECTOR to allow for #BOARD_ITEM specific access.
 */
export class PCB_COLLECTOR extends COLLECTOR {
  /**
   * Overload the COLLECTOR::operator[](int) to return a #BOARD_ITEM instead of an #EDA_ITEM.
   *
   * @param ndx The index into the list.
   * @return a board item or NULL.
   */
  override at(ndx: number): BOARD_ITEM | null {
    if (ndx >= 0 && ndx < this.GetCount()) return this.m_list[ndx] as BOARD_ITEM;

    return null;
  }
}

/**
 * Collect all #BOARD_ITEM objects of a given set of #KICAD_T type(s).
 */
export class PCB_TYPE_COLLECTOR extends PCB_COLLECTOR {
  /**
   * The examining function within the INSPECTOR which is passed to the Iterate function.
   *
   * @param testItem An EDA_ITEM to examine.
   * @param testData is not used in this class.
   * @return SEARCH_QUIT if the Iterator is to stop the scan, else SCAN_CONTINUE
   */
  override Inspect(testItem: EDA_ITEM, _testData: unknown): INSPECT_RESULT {
    // The Visit() function only visits the testItem if its type was in the the scanList,
    // so therefore we can collect anything given to us here.
    this.Append(testItem);

    return INSPECT_RESULT.CONTINUE; // always when collecting
  }

  /**
   * Collect #BOARD_ITEM objects using this class's Inspector method, which does the collection.
   *
   * @param aBoard The BOARD_ITEM to scan.
   * @param aTypes The KICAD_Ts to gather up.
   */
  Collect(aBoard: BOARD_ITEM, aTypes: readonly KICAD_T[]): void {
    this.Empty();
    aBoard.Visit(this.m_inspector, null, aTypes);
  }
}

/**
 * Collect all #BOARD_ITEM objects on a given layer.
 *
 * This only uses the primary object layer for comparison.
 */
export class PCB_LAYER_COLLECTOR extends PCB_COLLECTOR {
  private m_layer_id: PCB_LAYER_ID;

  constructor(aLayerId: PCB_LAYER_ID) {
    super();
    this.m_layer_id = aLayerId;
  }

  SetLayerId(aLayerId: PCB_LAYER_ID): void {
    this.m_layer_id = aLayerId;
  }

  /**
   * The examining function within the INSPECTOR which is passed to the iterate function.
   *
   * @param testItem An EDA_ITEM to examine.
   * @param testData is not used in this class.
   * @return SEARCH_QUIT if the Iterator is to stop the scan, else SCAN_CONTINUE
   */
  override Inspect(testItem: EDA_ITEM, _testData: unknown): INSPECT_RESULT {
    const item = testItem as BOARD_ITEM;

    if (item.IsOnLayer(this.m_layer_id)) this.Append(testItem);

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * Test a BOARD_ITEM using this class's Inspector method, which does the collection.
   *
   * @param aBoard The BOARD_ITEM to scan.
   * @param aTypes The KICAD_Ts to gather up.
   */
  Collect(aBoard: BOARD_ITEM, aTypes: readonly KICAD_T[]): void {
    this.Empty();
    aBoard.Visit(this.m_inspector, null, aTypes);
  }
}

/**
 * `GENERAL_COLLECTOR`'s scan-type lists (`collectors.cpp:41-150`).
 *
 * The collector proper — `Inspect()` and its `COLLECTORS_GUIDE` — is the
 * selection tool's hit-tester and lands with `PCB_SELECTION_TOOL` (#636
 * stage 3). These eight lists are data, not behaviour, and `BOARD::Visit()`
 * needs them now: they say which `KICAD_T`s a given traversal is asking for,
 * and the order is KiCad's own, so a `Visit` here reaches items in the order
 * upstream reaches them.
 */
const GENERAL_COLLECTOR_LISTS = {
  /** Used to identify:  all items except zones. */
  AllBoardItems: [
    KICAD_T.PCB_MARKER_T, // in m_markers
    KICAD_T.PCB_TEXT_T, // in m_drawings
    KICAD_T.PCB_REFERENCE_IMAGE_T, // in m_drawings
    KICAD_T.PCB_TEXTBOX_T, // in m_drawings
    KICAD_T.PCB_TABLE_T, // in m_drawings
    KICAD_T.PCB_TABLECELL_T, // in tables
    KICAD_T.PCB_SHAPE_T, // in m_drawings
    KICAD_T.PCB_DIM_ALIGNED_T, // in m_drawings
    KICAD_T.PCB_DIM_CENTER_T, // in m_drawings
    KICAD_T.PCB_DIM_RADIAL_T, // in m_drawings
    KICAD_T.PCB_DIM_ORTHOGONAL_T, // in m_drawings
    KICAD_T.PCB_DIM_LEADER_T, // in m_drawings
    KICAD_T.PCB_TARGET_T, // in m_drawings
    KICAD_T.PCB_VIA_T, // in m_tracks
    KICAD_T.PCB_TRACE_T, // in m_tracks
    KICAD_T.PCB_ARC_T, // in m_tracks
    KICAD_T.PCB_PAD_T, // in footprints
    KICAD_T.PCB_FIELD_T, // in footprints
    KICAD_T.PCB_FOOTPRINT_T, // in m_footprints
    KICAD_T.PCB_GROUP_T, // in m_groups
    KICAD_T.PCB_ZONE_T, // in m_zones
    KICAD_T.PCB_POINT_T, // in m_points
    KICAD_T.PCB_GENERATOR_T, // in m_generators
    KICAD_T.PCB_BARCODE_T, // in m_drawings
  ] as const satisfies readonly KICAD_T[],

  /** Used to identify board items at the board level, i.e. not inside a footprint. */
  BoardLevelItems: [
    KICAD_T.PCB_MARKER_T,
    KICAD_T.PCB_REFERENCE_IMAGE_T,
    KICAD_T.PCB_TEXT_T,
    KICAD_T.PCB_TEXTBOX_T,
    KICAD_T.PCB_TABLE_T,
    KICAD_T.PCB_SHAPE_T,
    KICAD_T.PCB_DIM_ALIGNED_T,
    KICAD_T.PCB_DIM_ORTHOGONAL_T,
    KICAD_T.PCB_DIM_CENTER_T,
    KICAD_T.PCB_DIM_RADIAL_T,
    KICAD_T.PCB_DIM_LEADER_T,
    KICAD_T.PCB_TARGET_T,
    KICAD_T.PCB_POINT_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_ARC_T,
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_FOOTPRINT_T,
    KICAD_T.PCB_GROUP_T,
    KICAD_T.PCB_ZONE_T,
    KICAD_T.PCB_GENERATOR_T,
    KICAD_T.PCB_BARCODE_T,
  ] as const satisfies readonly KICAD_T[],

  Footprints: [KICAD_T.PCB_FOOTPRINT_T] as const satisfies readonly KICAD_T[],

  PadsOrTracks: [
    KICAD_T.PCB_PAD_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_ARC_T,
  ] as const satisfies readonly KICAD_T[],

  FootprintItems: [
    KICAD_T.PCB_MARKER_T,
    KICAD_T.PCB_FIELD_T,
    KICAD_T.PCB_TEXT_T,
    KICAD_T.PCB_TEXTBOX_T,
    KICAD_T.PCB_TABLE_T,
    KICAD_T.PCB_TABLECELL_T,
    KICAD_T.PCB_SHAPE_T,
    KICAD_T.PCB_DIM_ALIGNED_T,
    KICAD_T.PCB_DIM_ORTHOGONAL_T,
    KICAD_T.PCB_DIM_CENTER_T,
    KICAD_T.PCB_DIM_RADIAL_T,
    KICAD_T.PCB_DIM_LEADER_T,
    KICAD_T.PCB_PAD_T,
    KICAD_T.PCB_ZONE_T,
    KICAD_T.PCB_GROUP_T,
    KICAD_T.PCB_POINT_T,
    KICAD_T.PCB_REFERENCE_IMAGE_T,
    KICAD_T.PCB_BARCODE_T,
  ] as const satisfies readonly KICAD_T[],

  Tracks: [
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_ARC_T,
    KICAD_T.PCB_VIA_T,
  ] as const satisfies readonly KICAD_T[],

  Dimensions: [
    KICAD_T.PCB_DIM_ALIGNED_T,
    KICAD_T.PCB_DIM_LEADER_T,
    KICAD_T.PCB_DIM_ORTHOGONAL_T,
    KICAD_T.PCB_DIM_CENTER_T,
    KICAD_T.PCB_DIM_RADIAL_T,
  ] as const satisfies readonly KICAD_T[],

  DraggableItems: [
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_FOOTPRINT_T,
    KICAD_T.PCB_ARC_T,
  ] as const satisfies readonly KICAD_T[],
} as const;

/**
 * `COLLECTORS_GUIDE`: what the collector is told to ignore.
 *
 * An interface, because `GENERAL_COLLECTOR` reads it through a pointer and
 * upstream's `PCB_SELECTION_TOOL` builds one per click from the current view
 * — the same collector, steered differently for a Ctrl-click, a drag and a
 * plain click.
 */
export interface COLLECTORS_GUIDE {
  IsLayerVisible(aLayer: PCB_LAYER_ID): boolean;
  GetPreferredLayer(): PCB_LAYER_ID;
  IgnoreLockedItems(): boolean;
  /** "Secondary" means tolerating any visible layer, not just the preferred one. */
  IncludeSecondary(): boolean;
  IgnoreFPTextOnBack(): boolean;
  IgnoreFPTextOnFront(): boolean;
  IgnoreFootprintsOnBack(): boolean;
  IgnoreFootprintsOnFront(): boolean;
  IgnorePadsOnFront(): boolean;
  IgnorePadsOnBack(): boolean;
  IgnoreThroughHolePads(): boolean;
  IgnorePads(): boolean;
  IgnoreFPValues(): boolean;
  IgnoreFPReferences(): boolean;
  IgnoreThroughVias(): boolean;
  IgnoreBlindBuriedVias(): boolean;
  IgnoreMicroVias(): boolean;
  IgnoreTracks(): boolean;
  IgnoreZoneFills(): boolean;
  IgnoreNoNets(): boolean;
  Accuracy(): number;
  OnePixelInIU(): number;
}

/**
 * `GENERAL_COLLECTORS_GUIDE`: the board editor's guide, with the defaults the
 * constructor sets.
 *
 * Two of those defaults are the ones to know. `m_ignoreFootprintsOnBack` is
 * true, so a click on the front of the board does not pick up a back-side
 * footprint until the layer is switched — and `m_ignoreZoneFills` is true, so
 * a click inside a filled zone does not select the zone; only its outline
 * does. Both are what make a busy board clickable.
 *
 * `aOnePixelInIU` is what `KIGFX::VIEW::ToWorld( { 1, 1 } ).x` answers; the
 * caller passes the number because the VIEW is not this module's to ask.
 */
export class GENERAL_COLLECTORS_GUIDE implements COLLECTORS_GUIDE {
  private m_preferredLayer: PCB_LAYER_ID;
  private m_visibleLayers: LSET; ///< bit-mapped layer visible bits
  private m_ignoreLockedItems = false;
  // `#if defined(USE_MATCH_LAYER)` false; the build we target has it true.
  private m_includeSecondary = true;
  private m_ignoreFPTextOnBack = true;
  private m_ignoreFPTextOnFront = false;
  private m_ignoreFootprintsOnBack = true; // !Show_footprints_Cmp;
  private m_ignoreFootprintsOnFront = false;
  private m_ignorePadsOnFront = false;
  private m_ignorePadsOnBack = false;
  private m_ignoreThroughHolePads = false;
  private m_ignoreFPValues = false;
  private m_ignoreFPReferences = false;
  private m_ignoreThroughVias = false;
  private m_ignoreBlindBuriedVias = false;
  private m_ignoreMicroVias = false;
  private m_ignoreTracks = false;
  private m_ignoreZoneFills = true;
  private m_ignoreNoNets = false;
  private m_onePixelInIU: number;
  private m_accuracy: number;

  constructor(aVisibleLayerMask: LSET, aPreferredLayer: PCB_LAYER_ID, aOnePixelInIU: number) {
    this.m_preferredLayer = aPreferredLayer;
    this.m_visibleLayers = aVisibleLayerMask;
    this.m_onePixelInIU = Math.abs(aOnePixelInIU);
    this.m_accuracy = KiROUND(5 * this.m_onePixelInIU);
  }

  IsLayerVisible(aLayer: PCB_LAYER_ID): boolean {
    return this.m_visibleLayers.test(aLayer);
  }
  SetLayerVisibleBits(aLayerBits: LSET): void {
    this.m_visibleLayers = aLayerBits;
  }

  GetPreferredLayer(): PCB_LAYER_ID {
    return this.m_preferredLayer;
  }
  SetPreferredLayer(aLayer: PCB_LAYER_ID): void {
    this.m_preferredLayer = aLayer;
  }

  IgnoreLockedItems(): boolean {
    return this.m_ignoreLockedItems;
  }
  SetIgnoreLockedItems(override: boolean): void {
    this.m_ignoreLockedItems = override;
  }

  IncludeSecondary(): boolean {
    return this.m_includeSecondary;
  }
  SetIncludeSecondary(include: boolean): void {
    this.m_includeSecondary = include;
  }

  IgnoreFPTextOnBack(): boolean {
    return this.m_ignoreFPTextOnBack;
  }
  SetIgnoreFPTextOnBack(ignore: boolean): void {
    this.m_ignoreFPTextOnBack = ignore;
  }

  IgnoreFPTextOnFront(): boolean {
    return this.m_ignoreFPTextOnFront;
  }
  SetIgnoreFPTextOnFront(ignore: boolean): void {
    this.m_ignoreFPTextOnFront = ignore;
  }

  IgnoreFootprintsOnBack(): boolean {
    return this.m_ignoreFootprintsOnBack;
  }
  SetIgnoreFootprintsOnBack(ignore: boolean): void {
    this.m_ignoreFootprintsOnBack = ignore;
  }

  IgnoreFootprintsOnFront(): boolean {
    return this.m_ignoreFootprintsOnFront;
  }
  SetIgnoreFootprintsOnFront(ignore: boolean): void {
    this.m_ignoreFootprintsOnFront = ignore;
  }

  IgnorePadsOnBack(): boolean {
    return this.m_ignorePadsOnBack;
  }
  SetIgnorePadsOnBack(ignore: boolean): void {
    this.m_ignorePadsOnBack = ignore;
  }

  IgnorePadsOnFront(): boolean {
    return this.m_ignorePadsOnFront;
  }
  SetIgnorePadsOnFront(ignore: boolean): void {
    this.m_ignorePadsOnFront = ignore;
  }

  IgnoreThroughHolePads(): boolean {
    return this.m_ignoreThroughHolePads;
  }
  SetIgnoreThroughHolePads(ignore: boolean): void {
    this.m_ignoreThroughHolePads = ignore;
  }

  /** `IgnorePads()`: all three pad flags at once. */
  IgnorePads(): boolean {
    return this.IgnorePadsOnFront() && this.IgnorePadsOnBack() && this.IgnoreThroughHolePads();
  }

  IgnoreFPValues(): boolean {
    return this.m_ignoreFPValues;
  }
  SetIgnoreFPValues(ignore: boolean): void {
    this.m_ignoreFPValues = ignore;
  }

  IgnoreFPReferences(): boolean {
    return this.m_ignoreFPReferences;
  }
  SetIgnoreFPReferences(ignore: boolean): void {
    this.m_ignoreFPReferences = ignore;
  }

  IgnoreThroughVias(): boolean {
    return this.m_ignoreThroughVias;
  }
  SetIgnoreThroughVias(ignore: boolean): void {
    this.m_ignoreThroughVias = ignore;
  }

  IgnoreBlindBuriedVias(): boolean {
    return this.m_ignoreBlindBuriedVias;
  }
  SetIgnoreBlindBuriedVias(ignore: boolean): void {
    this.m_ignoreBlindBuriedVias = ignore;
  }

  IgnoreMicroVias(): boolean {
    return this.m_ignoreMicroVias;
  }
  SetIgnoreMicroVias(ignore: boolean): void {
    this.m_ignoreMicroVias = ignore;
  }

  IgnoreTracks(): boolean {
    return this.m_ignoreTracks;
  }
  SetIgnoreTracks(ignore: boolean): void {
    this.m_ignoreTracks = ignore;
  }

  IgnoreZoneFills(): boolean {
    return this.m_ignoreZoneFills;
  }
  SetIgnoreZoneFills(ignore: boolean): void {
    this.m_ignoreZoneFills = ignore;
  }

  IgnoreNoNets(): boolean {
    return this.m_ignoreNoNets;
  }
  SetIgnoreNoNets(ignore: boolean): void {
    this.m_ignoreNoNets = ignore;
  }

  Accuracy(): number {
    return this.m_accuracy;
  }
  SetAccuracy(aValue: number): void {
    this.m_accuracy = aValue;
  }

  OnePixelInIU(): number {
    return this.m_onePixelInIU;
  }
}

/**
 * `GENERAL_COLLECTOR`: what is under a point.
 *
 * `Inspect` runs once per item the board's `Visit` hands it, and the shape of
 * the function is a funnel: a type-specific switch that may reject early and
 * otherwise picks which hit-test applies, then the common tests, then the
 * hit-test itself into the primary list — and, when `IncludeSecondary` is on,
 * the same tests again for any *visible* layer rather than the preferred one,
 * into the secondary list, which `Collect` appends after the primary. So the
 * items on the layer you are working on come first, and items on other
 * visible layers come after them rather than being lost.
 *
 * The rules that are easy to lose on a re-read:
 *
 * - A through-hole pad is visible even when its footprint is not, because it
 *   exists on both sides. `pad_through` skips the parent-footprint test.
 * - A footprint is hit-tested twice: `HitTest` (its box) AND
 *   `HitTestAccurate` (its outline), so an L-shaped part is not selected
 *   from the empty corner of its bounding box.
 * - Dimensions get `accuracy * 1.5`, because their shape is noisy and they
 *   feel harder to hit than they should.
 * - Markers and groups ignore the layer entirely.
 */
export class GENERAL_COLLECTOR extends PCB_COLLECTOR {
  /** A place to hold collected objects which don't match precisely the search criteria. */
  protected m_List2nd: EDA_ITEM[] = [];
  /** Determines which items are to be collected by Inspect(). */
  protected m_Guide: COLLECTORS_GUIDE | null = null;

  /** Used to identify:  all items except zones. */
  static readonly AllBoardItems = GENERAL_COLLECTOR_LISTS.AllBoardItems;
  /** Used to identify board items at the board level, i.e. not inside a footprint. */
  static readonly BoardLevelItems = GENERAL_COLLECTOR_LISTS.BoardLevelItems;
  static readonly Footprints = GENERAL_COLLECTOR_LISTS.Footprints;
  static readonly PadsOrTracks = GENERAL_COLLECTOR_LISTS.PadsOrTracks;
  static readonly FootprintItems = GENERAL_COLLECTOR_LISTS.FootprintItems;
  static readonly Tracks = GENERAL_COLLECTOR_LISTS.Tracks;
  static readonly Dimensions = GENERAL_COLLECTOR_LISTS.Dimensions;
  static readonly DraggableItems = GENERAL_COLLECTOR_LISTS.DraggableItems;

  constructor() {
    super();
    this.SetScanTypes(GENERAL_COLLECTOR.AllBoardItems);
  }

  Empty2nd(): void {
    this.m_List2nd.length = 0;
  }

  Append2nd(item: EDA_ITEM): void {
    this.m_List2nd.push(item);
  }

  /** Record `aGuide` for use by Inspect(). */
  SetGuide(aGuide: COLLECTORS_GUIDE | null): void {
    this.m_Guide = aGuide;
  }

  GetGuide(): COLLECTORS_GUIDE | null {
    return this.m_Guide;
  }

  /** The examining function within the INSPECTOR which is passed to the Iterate function. */
  override Inspect(aTestItem: EDA_ITEM, _aTestData: unknown): INSPECT_RESULT {
    const guide = this.m_Guide!;
    let boardItem: BOARD_ITEM | null = null;
    let footprint: FOOTPRINT | null = null;
    let group: PCB_GROUP | null = null;
    let pad: PAD | null = null;
    let pad_through = false;
    let via: PCB_VIA | null = null;
    let marker: PCB_MARKER | null = null;
    let zone: ZONE | null = null;
    let field: PCB_FIELD | null = null;
    let text: PCB_TEXT | null = null;
    let dimension: PCB_DIMENSION_BASE | null = null;
    let shape: PCB_SHAPE | null = null;

    switch (aTestItem.Type()) {
      case KICAD_T.PCB_PAD_T:
        // there are pad specific visibility controls.
        // Criteria to select a pad is:
        // for smd pads: the footprint parent must be visible, and pads on the corresponding
        // board side must be visible
        // if pad is a thru hole, then it can be visible when its parent footprint is not.
        // for through pads: pads on Front or Back board sides must be visible
        pad = aTestItem as PAD;
        boardItem = pad;

        if (pad.GetAttribute() !== PAD_ATTRIB.SMD && pad.GetAttribute() !== PAD_ATTRIB.CONN) {
          // a hole is present, so multiple layers
          // proceed to the common tests below, but without the parent footprint test,
          // by leaving footprint==NULL, but having pad != null
          pad_through = true;
        }

        break;

      case KICAD_T.PCB_VIA_T: // vias are on many layers, so layer test is specific
        via = aTestItem as PCB_VIA;
        boardItem = via;
        break;

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
        if (guide.IgnoreTracks()) return INSPECT_RESULT.CONTINUE;

        boardItem = aTestItem as PCB_TRACK;
        break;

      case KICAD_T.PCB_ZONE_T:
        zone = aTestItem as ZONE;

        if (guide.IgnoreNoNets() && zone.GetNetCode() === UNCONNECTED_NET)
          return INSPECT_RESULT.CONTINUE;

        boardItem = zone;
        break;

      case KICAD_T.PCB_SHAPE_T:
        shape = aTestItem as PCB_SHAPE;

        if (guide.IgnoreNoNets() && shape.GetNetCode() === UNCONNECTED_NET)
          return INSPECT_RESULT.CONTINUE;

        boardItem = shape;
        break;

      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_TABLECELL_T:
        if (guide.IgnoreNoNets()) return INSPECT_RESULT.CONTINUE;

        boardItem = aTestItem as BOARD_ITEM;
        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        if (guide.IgnoreNoNets()) return INSPECT_RESULT.CONTINUE;

        dimension = aTestItem as PCB_DIMENSION_BASE;
        boardItem = dimension;
        break;

      case KICAD_T.PCB_TARGET_T:
        if (guide.IgnoreNoNets()) return INSPECT_RESULT.CONTINUE;

        boardItem = aTestItem as BOARD_ITEM;
        break;

      case KICAD_T.PCB_POINT_T:
        boardItem = aTestItem as BOARD_ITEM;
        break;

      case KICAD_T.PCB_FIELD_T: {
        if (guide.IgnoreNoNets()) return INSPECT_RESULT.CONTINUE;

        field = aTestItem as PCB_FIELD;

        if (!field.IsVisible()) return INSPECT_RESULT.CONTINUE;

        if (field.IsReference() && guide.IgnoreFPReferences()) return INSPECT_RESULT.CONTINUE;

        if (field.IsValue() && guide.IgnoreFPValues()) return INSPECT_RESULT.CONTINUE;

        // KI_FALLTHROUGH into PCB_TEXT_T, whose IgnoreNoNets test was just made.
        text = field;
        boardItem = text;

        if (text.GetParentFootprint()) {
          const layer = text.GetLayer();

          if (guide.IgnoreFPTextOnBack() && IsBackLayer(layer)) return INSPECT_RESULT.CONTINUE;

          if (guide.IgnoreFPTextOnFront() && IsFrontLayer(layer)) return INSPECT_RESULT.CONTINUE;
        }

        break;
      }

      case KICAD_T.PCB_TEXT_T:
        if (guide.IgnoreNoNets()) return INSPECT_RESULT.CONTINUE;

        text = aTestItem as PCB_TEXT;
        boardItem = text;

        if (text.GetParentFootprint()) {
          const layer = text.GetLayer();

          if (guide.IgnoreFPTextOnBack() && IsBackLayer(layer)) return INSPECT_RESULT.CONTINUE;

          if (guide.IgnoreFPTextOnFront() && IsFrontLayer(layer)) return INSPECT_RESULT.CONTINUE;
        }

        break;

      case KICAD_T.PCB_BARCODE_T:
        if (guide.IgnoreNoNets()) return INSPECT_RESULT.CONTINUE;

        boardItem = aTestItem as BOARD_ITEM;
        break;

      case KICAD_T.PCB_FOOTPRINT_T:
        footprint = aTestItem as FOOTPRINT;
        boardItem = footprint;
        break;

      case KICAD_T.PCB_GROUP_T:
        group = aTestItem as PCB_GROUP;
        boardItem = group;
        break;

      case KICAD_T.PCB_MARKER_T:
        marker = aTestItem as PCB_MARKER;
        boardItem = marker;
        break;

      default:
        if (aTestItem.IsBOARD_ITEM()) boardItem = aTestItem as BOARD_ITEM;

        break;
    }

    if (boardItem && !footprint) footprint = boardItem.GetParentFootprint();

    // common tests:

    if (footprint) {
      if (guide.IgnoreFootprintsOnBack() && footprint.GetSide() === PCB_LAYER_ID.B_Cu)
        return INSPECT_RESULT.CONTINUE;

      if (guide.IgnoreFootprintsOnFront() && footprint.GetSide() === PCB_LAYER_ID.F_Cu)
        return INSPECT_RESULT.CONTINUE;
    }

    // Pads are not sensitive to the layer visibility controls; they all have their own separate
    // visibility controls.
    if (pad) {
      if (guide.IgnorePads()) return INSPECT_RESULT.CONTINUE;

      if (!pad_through) {
        if (guide.IgnorePadsOnFront() && pad.IsOnLayer(PCB_LAYER_ID.F_Cu))
          return INSPECT_RESULT.CONTINUE;

        if (guide.IgnorePadsOnBack() && pad.IsOnLayer(PCB_LAYER_ID.B_Cu))
          return INSPECT_RESULT.CONTINUE;
      }
    }

    if (marker) {
      // Markers are not sensitive to the layer
      if (marker.HitTest(this.m_refPos)) this.Append(aTestItem);

      return INSPECT_RESULT.CONTINUE;
    }

    if (group) {
      // Groups are not sensitive to the layer ... ?
      if (group.HitTest(this.m_refPos)) this.Append(aTestItem);

      return INSPECT_RESULT.CONTINUE;
    }

    if (via) {
      const type = via.GetViaType();

      if (
        (guide.IgnoreThroughVias() && type === VIATYPE.THROUGH) ||
        (guide.IgnoreBlindBuriedVias() && (type === VIATYPE.BLIND || type === VIATYPE.BURIED)) ||
        (guide.IgnoreMicroVias() && type === VIATYPE.MICROVIA)
      ) {
        return INSPECT_RESULT.CONTINUE;
      }
    }

    if (
      boardItem &&
      boardItem.IsOnLayer(guide.GetPreferredLayer()) &&
      (!boardItem.IsLocked() || !guide.IgnoreLockedItems())
    ) {
      // Footprints and their subcomponents: reference, value and pads are not sensitive to the
      // layer visibility controls; they all have their own separate visibility controls.
      // For vias, GetLayer() has no meaning, but IsOnLayer() works fine.
      // User text and fields in a footprint *are* sensitive to layer visibility but they were
      // already handled.

      let accuracy = guide.Accuracy();

      if (zone) {
        if (
          zone.HitTestForCorner(this.m_refPos, accuracy * 2) ||
          zone.HitTestForEdge(this.m_refPos, accuracy)
        ) {
          this.Append(zone);
          return INSPECT_RESULT.CONTINUE;
        }

        if (!guide.IgnoreZoneFills()) {
          for (const layer of zone.GetLayerSet()) {
            if (guide.IsLayerVisible(layer) && zone.HitTestFilledArea(layer, this.m_refPos)) {
              this.Append(zone);
              return INSPECT_RESULT.CONTINUE;
            }
          }
        }
      } else if (aTestItem === footprint) {
        if (
          footprint.HitTest(this.m_refPos, accuracy) &&
          footprint.HitTestAccurate(this.m_refPos, accuracy)
        ) {
          this.Append(footprint);
          return INSPECT_RESULT.CONTINUE;
        }
      } else if (pad || via) {
        if (boardItem.HitTest(this.m_refPos, accuracy)) {
          this.Append(boardItem);
          return INSPECT_RESULT.CONTINUE;
        }
      } else {
        const layer = boardItem.GetLayer();

        if (guide.IsLayerVisible(layer)) {
          if (dimension) {
            // Dimensions feel particularly hard to select, probably due to their noisy
            // shape making it feel like they should have a larger boundary.
            accuracy = KiROUND(accuracy * 1.5);
          }

          if (boardItem.HitTest(this.m_refPos, accuracy)) {
            this.Append(boardItem);
            return INSPECT_RESULT.CONTINUE;
          }
        }
      }
    }

    if (
      guide.IncludeSecondary() &&
      (!boardItem || !boardItem.IsLocked() || !guide.IgnoreLockedItems())
    ) {
      // For now, "secondary" means "tolerate any visible layer".  It has no effect on other
      // criteria, since there is a separate "ignore" control for those in the COLLECTORS_GUIDE

      let accuracy = guide.Accuracy();

      if (zone) {
        if (
          zone.HitTestForCorner(this.m_refPos, accuracy * 2) ||
          zone.HitTestForEdge(this.m_refPos, accuracy)
        ) {
          this.Append2nd(zone);
          return INSPECT_RESULT.CONTINUE;
        }

        if (!guide.IgnoreZoneFills()) {
          for (const layer of zone.GetLayerSet()) {
            if (guide.IsLayerVisible(layer) && zone.HitTestFilledArea(layer, this.m_refPos)) {
              this.Append2nd(zone);
              return INSPECT_RESULT.CONTINUE;
            }
          }
        }
      } else if (aTestItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        // Already tested above, but Coverity can't figure that out
        if (!footprint) return INSPECT_RESULT.CONTINUE;

        if (
          footprint.HitTest(this.m_refPos, accuracy) &&
          footprint.HitTestAccurate(this.m_refPos, accuracy)
        ) {
          this.Append2nd(footprint);
          return INSPECT_RESULT.CONTINUE;
        }
      } else if (pad || via) {
        if (boardItem!.HitTest(this.m_refPos, accuracy)) {
          this.Append2nd(boardItem!);
          return INSPECT_RESULT.CONTINUE;
        }
      } else if (boardItem && guide.IsLayerVisible(boardItem.GetLayer())) {
        if (dimension) {
          // Dimensions feel particularly hard to select, probably due to their noisy shape
          // making it feel like they should have a larger boundary.
          accuracy = KiROUND(accuracy * 1.5);
        }

        if (boardItem.HitTest(this.m_refPos, accuracy)) {
          this.Append2nd(boardItem);
          return INSPECT_RESULT.CONTINUE;
        }
      }
    }

    return INSPECT_RESULT.CONTINUE; // always when collecting
  }

  /**
   * Scan a BOARD_ITEM using this class's Inspector method, which does the collection.
   *
   * @param aItem A BOARD_ITEM to scan, may be a BOARD or FOOTPRINT, or whatever.
   * @param aScanTypes A list of KICAD_Ts that specs what is to be collected and the priority
   *                   order of the resultant collection in "m_list".
   * @param aRefPos A VECTOR2I to use in hit-testing.
   * @param aGuide The COLLECTORS_GUIDE to use in collecting items.
   */
  Collect(
    aItem: BOARD_ITEM,
    aScanTypes: readonly KICAD_T[],
    aRefPos: VECTOR2I,
    aGuide: COLLECTORS_GUIDE,
  ): void {
    this.Empty(); // empty the collection, primary criteria list
    this.Empty2nd(); // empty the collection, secondary criteria list

    // remember guide, pass it to Inspect()
    this.SetGuide(aGuide);

    this.SetScanTypes(aScanTypes);

    // remember where the snapshot was taken from and pass refPos to
    // the Inspect() function.
    this.SetRefPos(aRefPos);

    aItem.Visit(this.m_inspector, null, this.m_scanTypes);

    // append 2nd list onto end of the first list
    for (const item of this.m_List2nd) this.Append(item);

    this.Empty2nd();
  }
}
