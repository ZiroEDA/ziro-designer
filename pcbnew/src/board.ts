// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board.h` / `pcbnew/board.cpp`: `BOARD`, information pertinent to a
 * Pcbnew printed circuit board.
 *
 * IN PROGRESS (#636 stage 1): the container, the layer table with its
 * opposites, the design settings, the board use, and `Add`/`Remove` over
 * the item collections are here. Each item class lands in turn; the parts
 * of BOARD that read them (`m_NetInfo`, `m_connectivity`, the listeners,
 * the outline, the solder-mask bridges zone, the caches, the item-by-id
 * cache walks into footprints and tables, `EMBEDDED_FILES`, the project)
 * follow as their classes do. `board_types.ts` carries `LAYER_T`, `LAYER`
 * and `BOARD_USE`, which C++ declares in this header.
 */

import { RECURSE_MODE } from '@ziroeda/common/src/eda_item.js';
import { STRUCT_DELETED } from '@ziroeda/common/src/eda_item_flags.js';
import { type EdaUnits, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { type KIID, niluuid } from '@ziroeda/common/src/kiid.js';
import {
  FlipLayer as flipLayerId,
  type GAL_LAYER_ID,
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
import { NETCLASS } from '@ziroeda/common/src/netclass.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_DESIGN_SETTINGS } from './board_design_settings.js';
import { BOARD_ITEM, DELETED_BOARD_ITEM } from './board_item.js';
import { ADD_MODE, BOARD_ITEM_CONTAINER, REMOVE_MODE } from './board_item_container.js';
import { BOARD_USE, LAYER, LAYER_T } from './board_types.js';
import { type NETINFO_ITEM, NETINFO_LIST } from './netinfo.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_GROUP } from './pcb_group.js';
import type { PCB_MARKER } from './pcb_marker.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TRACK } from './pcb_track.js';
import type { ZONE } from './zone.js';

export { BOARD_USE, LAYER, LAYER_T } from './board_types.js';

/** `DEFAULT_CHAINING_EPSILON_MM` (`board.h`): the outline-chaining tolerance. */
export const DEFAULT_CHAINING_EPSILON_MM = 0.01;

/**
 * Information pertinent to a Pcbnew printed circuit board.
 */
export class BOARD extends BOARD_ITEM_CONTAINER {
  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_T === aItem.Type();
  }

  private m_boardUse: BOARD_USE;
  private m_timeStamp: number;
  private m_userUnits: EdaUnits = 'mm'; // BOARD::BOARD() : m_userUnits( EDA_UNITS::MM )
  private m_fileName = '';

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
  protected m_generators: BOARD_ITEM[] = []; // PCB_GENERATOR pending (#636)
  protected m_markers: PCB_MARKER[] = [];
  protected m_groups: PCB_GROUP[] = [];
  protected m_points: BOARD_ITEM[] = []; // PCB_POINT pending (#636)

  protected m_itemByIdCache = new Map<KIID, BOARD_ITEM>();

  protected m_outlinesChainingEpsilon: number;

  /** `m_ZoneBBoxCache`: the zone bounding boxes, written by `ZONE::GetBoundingBox` (`friend class ZONE`). */
  m_ZoneBBoxCache = new Map<ZONE, BOX2I>();

  constructor() {
    super(null, KICAD_T.PCB_T);
    this.m_boardUse = BOARD_USE.NORMAL;
    this.m_timeStamp = 1;
    this.m_designSettings = new BOARD_DESIGN_SETTINGS();
    this.m_NetInfo = new NETINFO_LIST(this);

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

    const bds = this.GetDesignSettings();

    // Initialize default netclass.
    bds.m_NetSettings.SetDefaultNetclass(new NETCLASS(NETCLASS.Default));
    bds.m_NetSettings.GetDefaultNetclass().SetDescription('This is the default net class.');

    bds.UseCustomTrackViaSize(false);
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
  Generators(): BOARD_ITEM[] {
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
  Points(): BOARD_ITEM[] {
    return this.m_points;
  }

  /** `EMBEDDED_FILES::GetFontFiles`: the embedded-files half of BOARD is not ported yet. */
  GetFontFiles(): readonly string[] | null {
    return null;
  }

  /**
   * Set the layer information from a #LAYER object.
   */
  SetLayerDescr(aIndex: PCB_LAYER_ID, aLayer: LAYER): boolean {
    this.m_layers.set(aIndex, aLayer);
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
        this.m_generators.push(aBoardItem);
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
        this.m_points.push(aBoardItem);
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

    // if( !aSkipConnectivity ) m_connectivity->Add( aBoardItem );      -- CONNECTIVITY_DATA pending
    // InvokeListeners( &BOARD_LISTENER::OnBoardItemAdded, ... )       -- BOARD_LISTENER pending
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
        // NETINFO_ITEM* unconnected = m_NetInfo.GetNetItem( NETINFO_LIST::UNCONNECTED );
        // for( BOARD_CONNECTED_ITEM* boardItem : AllConnectedItems() )
        //     if( boardItem->GetNet() == netItem ) boardItem->SetNet( unconnected );
        //                                        -- AllConnectedItems() with the items (#636)
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

    // m_connectivity->Remove( aBoardItem );                              -- CONNECTIVITY_DATA pending
    // InvokeListeners( &BOARD_LISTENER::OnBoardItemRemoved, ... )       -- BOARD_LISTENER pending
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
