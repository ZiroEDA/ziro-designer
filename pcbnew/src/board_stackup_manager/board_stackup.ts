// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_stackup_manager/board_stackup.h` / `.cpp` and the keywords
 * of `stackup_predefined_prms.h`: `DIELECTRIC_PRMS`, `BOARD_STACKUP_ITEM`
 * and `BOARD_STACKUP`, the physical layer list a board carries in its
 * design settings (`BOARD_DESIGN_SETTINGS::GetStackupDescriptor()`).
 *
 * `Serialize` / `Deserialize` (the protobuf API) are not ported.
 */

import { FormatInternalUnits, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { FormatBool } from '@ziroeda/common/src/io/kicad/kicad_io_utils.js';
import {
  B_Cu,
  B_Mask,
  B_Paste,
  B_SilkS,
  F_Cu,
  F_Mask,
  F_Paste,
  F_SilkS,
  IsCopperLayer,
  type PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import type { OUTPUTFORMATTER } from '@ziroeda/common/src/richio.js';
import { FormatDouble2Str, UIDouble2Str } from '@ziroeda/common/src/string_utils.js';
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';

// ---------------------------------------------------------------------------
// stackup_predefined_prms.h
// ---------------------------------------------------------------------------

// Keyword used in file to identify the dielectric layer type
export const KEY_CORE = 'core';
export const KEY_PREPREG = 'prepreg';
export const KEY_COPPER = 'copper';

// key string used for not specified parameters
// Can be translated in dialogs, and is also a keyword outside dialogs
export function NotSpecifiedPrm(): string {
  return 'Not specified';
}

/**
 * @return true if the param value is specified:
 * not empty
 * not NotSpecifiedPrm() value or its translation
 */
export function IsPrmSpecified(aPrmValue: string): boolean {
  // return true if the param value is specified:

  if (
    aPrmValue !== '' &&
    aPrmValue.toLowerCase() !== NotSpecifiedPrm().toLowerCase() &&
    aPrmValue !== NotSpecifiedPrm() // wxGetTranslation( NotSpecifiedPrm() ): no translation here
  )
    return true;

  return false;
}

export const DEFAULT_SOLDERMASK_OPACITY = 0.83;

// A reasonable Epsilon R value for solder mask dielectric
export const DEFAULT_EPSILON_R_SOLDERMASK = 3.3;

// A default Epsilon R value for silkscreen dielectric
export const DEFAULT_EPSILON_R_SILKSCREEN = 1.0;

// ---------------------------------------------------------------------------
// board_stackup.h
// ---------------------------------------------------------------------------

export enum BOARD_STACKUP_ITEM_TYPE {
  BS_ITEM_TYPE_UNDEFINED = 0, // For not yet initialized BOARD_STACKUP_ITEM item
  BS_ITEM_TYPE_COPPER, // A initialized BOARD_STACKUP_ITEM item for copper layers
  BS_ITEM_TYPE_DIELECTRIC, // A initialized BOARD_STACKUP_ITEM item for the
  // dielectric between copper layers
  BS_ITEM_TYPE_SOLDERPASTE, // A initialized BOARD_STACKUP_ITEM item for solder paste layers
  BS_ITEM_TYPE_SOLDERMASK, // A initialized BOARD_STACKUP_ITEM item for solder mask layers
  BS_ITEM_TYPE_SILKSCREEN, // A initialized BOARD_STACKUP_ITEM item for silkscreen layers
}

export const {
  BS_ITEM_TYPE_UNDEFINED,
  BS_ITEM_TYPE_COPPER,
  BS_ITEM_TYPE_DIELECTRIC,
  BS_ITEM_TYPE_SOLDERPASTE,
  BS_ITEM_TYPE_SOLDERMASK,
  BS_ITEM_TYPE_SILKSCREEN,
} = BOARD_STACKUP_ITEM_TYPE;

export enum BS_EDGE_CONNECTOR_CONSTRAINTS {
  BS_EDGE_CONNECTOR_NONE = 0, // No edge connector in board
  BS_EDGE_CONNECTOR_IN_USE, // some edge connector in board
  BS_EDGE_CONNECTOR_BEVELLED, // Some connector in board, and the connector must be beveled
}

export const { BS_EDGE_CONNECTOR_NONE, BS_EDGE_CONNECTOR_IN_USE, BS_EDGE_CONNECTOR_BEVELLED } =
  BS_EDGE_CONNECTOR_CONSTRAINTS;

/**
 * A helper class to manage a dielectric layer set (layer thickness, Epsilon R and
 * loss tangent).
 */
export class DIELECTRIC_PRMS {
  m_Material = ''; /// type of material (for dielectric and solder mask)
  m_Thickness = 0; /// the physical layer thickness in internal units
  m_ThicknessLocked = false; /// true for dielectric layers with a fixed thickness
  /// (for impedance controlled purposes), unused for other layers
  m_EpsilonR = 1.0; /// For dielectric (and solder mask) the dielectric constant
  m_LossTangent = 0.0; /// For dielectric (and solder mask) the dielectric loss
  m_Color = ''; /// mainly for silkscreen and solder mask

  /** The compiler-generated copy. */
  static copyOf(aOther: DIELECTRIC_PRMS): DIELECTRIC_PRMS {
    const p = new DIELECTRIC_PRMS();
    p.m_Material = aOther.m_Material;
    p.m_Thickness = aOther.m_Thickness;
    p.m_ThicknessLocked = aOther.m_ThicknessLocked;
    p.m_EpsilonR = aOther.m_EpsilonR;
    p.m_LossTangent = aOther.m_LossTangent;
    p.m_Color = aOther.m_Color;
    return p;
  }

  equals(aOther: DIELECTRIC_PRMS): boolean {
    if (this.m_Material !== aOther.m_Material) return false;
    if (this.m_Thickness !== aOther.m_Thickness) return false;
    if (this.m_ThicknessLocked !== aOther.m_ThicknessLocked) return false;
    if (this.m_EpsilonR !== aOther.m_EpsilonR) return false;
    if (this.m_LossTangent !== aOther.m_LossTangent) return false;
    if (this.m_Color !== aOther.m_Color) return false;

    return true;
  }
}

/**
 * Manage one layer needed to make a physical board.
 *
 * It can be a solder mask, silk screen, copper or a dielectric.
 */
export class BOARD_STACKUP_ITEM {
  private m_Type: BOARD_STACKUP_ITEM_TYPE;
  private m_LayerName = ''; /// name of layer as shown in layer manager. Useful to create reports
  private m_TypeName = ''; /// type name of layer (copper, silk screen, core, prepreg ...)
  private m_LayerId: PCB_LAYER_ID; /// the layer id (F.Cu to B.Cu, F.Silk, B.silk, F.Mask, B.Mask)
  /// and UNDEFINED_LAYER (-1) for dielectric layers that are not
  /// really board layers
  private m_DielectricLayerId = 0; /// the "layer" id for dielectric layers,
  /// from 1 (top) to 31 (bottom)
  /// (only 31 dielectric layers for 32 copper layers)
  /// List of dielectric parameters
  /// usually only one item, but in complex (microwave) boards, one can have
  /// more than one dielectric layer between 2 copper layers, and therefore
  /// more than one item in list
  private m_DielectricPrmsList: DIELECTRIC_PRMS[] = [];
  private m_enabled = false; /// true if this stackup item must be taken in account,
  /// false to ignore it. Mainly used in dialog stackup editor.

  constructor(aType: BOARD_STACKUP_ITEM_TYPE) {
    const item_prms = new DIELECTRIC_PRMS();
    this.m_DielectricPrmsList.push(item_prms);
    this.m_LayerId = UNDEFINED_LAYER;
    this.m_Type = aType;
    this.SetDielectricLayerId(1);
    this.SetEnabled(true);

    // Initialize parameters to a usual value for allowed types:
    switch (this.m_Type) {
      case BS_ITEM_TYPE_COPPER:
        this.m_TypeName = KEY_COPPER;
        this.SetThickness(BOARD_STACKUP_ITEM.GetCopperDefaultThickness());
        break;

      case BS_ITEM_TYPE_DIELECTRIC:
        this.m_TypeName = KEY_CORE; // or prepreg
        this.SetColor(NotSpecifiedPrm());
        this.SetMaterial('FR4'); // or other dielectric name
        this.SetLossTangent(0.02); // for FR4
        this.SetEpsilonR(4.5); // for FR4
        break;

      case BS_ITEM_TYPE_SOLDERPASTE:
        this.m_TypeName = 'solderpaste';
        break;

      case BS_ITEM_TYPE_SOLDERMASK:
        this.m_TypeName = 'soldermask';
        this.SetColor(NotSpecifiedPrm());
        this.SetMaterial(NotSpecifiedPrm()); // or other solder mask material name
        this.SetThickness(BOARD_STACKUP_ITEM.GetMaskDefaultThickness());
        this.SetEpsilonR(DEFAULT_EPSILON_R_SOLDERMASK);
        break;

      case BS_ITEM_TYPE_SILKSCREEN:
        this.m_TypeName = 'silkscreen';
        this.SetColor(NotSpecifiedPrm());
        this.SetMaterial(NotSpecifiedPrm()); // or other silkscreen material name
        this.SetEpsilonR(DEFAULT_EPSILON_R_SILKSCREEN);
        break;

      case BS_ITEM_TYPE_UNDEFINED:
        break;
    }
  }

  /** `BOARD_STACKUP_ITEM( const BOARD_STACKUP_ITEM& aOther )`. */
  static copyOf(aOther: BOARD_STACKUP_ITEM): BOARD_STACKUP_ITEM {
    const item = new BOARD_STACKUP_ITEM(aOther.m_Type);
    item.assign(aOther);
    return item;
  }

  /** The compiler-generated `operator=` (`*item = *initial_item`). */
  assign(aOther: BOARD_STACKUP_ITEM): this {
    this.m_LayerId = aOther.m_LayerId;
    this.m_DielectricLayerId = aOther.m_DielectricLayerId;
    this.m_Type = aOther.m_Type;
    this.m_enabled = aOther.m_enabled;
    this.m_DielectricPrmsList = aOther.m_DielectricPrmsList.map((p) => DIELECTRIC_PRMS.copyOf(p));
    this.m_TypeName = aOther.m_TypeName;
    this.m_LayerName = aOther.m_LayerName;
    return this;
  }

  equals(aOther: BOARD_STACKUP_ITEM): boolean {
    if (this.m_Type !== aOther.m_Type) return false;
    if (this.m_LayerName !== aOther.m_LayerName) return false;
    if (this.m_TypeName !== aOther.m_TypeName) return false;
    if (this.m_LayerId !== aOther.m_LayerId) return false;
    if (this.m_DielectricLayerId !== aOther.m_DielectricLayerId) return false;
    if (this.m_enabled !== aOther.m_enabled) return false;

    // std::equal over the first list's length, as the C++ does.
    for (let i = 0; i < this.m_DielectricPrmsList.length; i++) {
      const b = aOther.m_DielectricPrmsList[i];

      if (!b || !this.m_DielectricPrmsList[i]!.equals(b)) return false;
    }

    return true;
  }

  /// add (insert) a DIELECTRIC_PRMS item to m_DielectricPrmsList
  /// all values are set to default
  /// @param aDielectricPrmsIdx is a index in m_DielectricPrmsList
  /// the new item will be inserted at this position
  AddDielectricPrms(aDielectricPrmsIdx: number): void {
    // add a DIELECTRIC_PRMS item to m_DielectricPrmsList
    const new_prms = new DIELECTRIC_PRMS();

    this.m_DielectricPrmsList.splice(aDielectricPrmsIdx, 0, new_prms);
  }

  /// Remove a DIELECTRIC_PRMS item from m_DielectricPrmsList
  /// @param aDielectricPrmsIdx is the index of the parameters set
  /// to remove in m_DielectricPrmsList
  RemoveDielectricPrms(aDielectricPrmsIdx: number): void {
    // Remove a DIELECTRIC_PRMS item from m_DielectricPrmsList if possible

    if (
      this.GetSublayersCount() < 2 ||
      aDielectricPrmsIdx < 0 ||
      aDielectricPrmsIdx >= this.GetSublayersCount()
    ) {
      return;
    }

    this.m_DielectricPrmsList.splice(aDielectricPrmsIdx, 1);
  }

  /// @return true if the layer has a meaningful Epsilon R parameter
  /// namely dielectric layers: dielectric and solder mask
  HasEpsilonRValue(): boolean {
    return this.m_Type === BS_ITEM_TYPE_DIELECTRIC || this.m_Type === BS_ITEM_TYPE_SOLDERMASK;
  }

  /// @return true if the layer has a meaningful Epsilon R parameter
  /// namely dielectric layers: dielectric and solder mask
  HasLossTangentValue(): boolean {
    return this.m_Type === BS_ITEM_TYPE_DIELECTRIC || this.m_Type === BS_ITEM_TYPE_SOLDERMASK;
  }

  /// @return true if the material is specified
  HasMaterialValue(aDielectricSubLayer = 0): boolean {
    // return true if the material is specified
    return this.IsMaterialEditable() && IsPrmSpecified(this.GetMaterial(aDielectricSubLayer));
  }

  /// @return true if the material is editable
  IsMaterialEditable(): boolean {
    return (
      this.m_Type === BS_ITEM_TYPE_DIELECTRIC ||
      this.m_Type === BS_ITEM_TYPE_SOLDERMASK ||
      this.m_Type === BS_ITEM_TYPE_SILKSCREEN
    );
  }

  /// @return true if the color is editable
  IsColorEditable(): boolean {
    return (
      this.m_Type === BS_ITEM_TYPE_DIELECTRIC ||
      this.m_Type === BS_ITEM_TYPE_SOLDERMASK ||
      this.m_Type === BS_ITEM_TYPE_SILKSCREEN
    );
  }

  /// @return true if Thickness is editable
  IsThicknessEditable(): boolean {
    return (
      this.m_Type === BS_ITEM_TYPE_COPPER ||
      this.m_Type === BS_ITEM_TYPE_DIELECTRIC ||
      this.m_Type === BS_ITEM_TYPE_SOLDERMASK
    );
  }

  /// @return a reasonable default value for a copper layer thickness
  static GetCopperDefaultThickness(): number {
    // A reasonable thickness for copper layers:
    return pcbIUScale.mmToIU(0.035);
  }

  /// @return a reasonable default value for a solder mask layer thickness
  static GetMaskDefaultThickness(): number {
    // A reasonable thickness for solder mask:
    return pcbIUScale.mmToIU(0.01);
  }

  /// @return the number of sublayers in a dielectric layer.
  /// the count is >= 1 (there is at least one layer)
  GetSublayersCount(): number {
    return this.m_DielectricPrmsList.length;
  }

  /// @return a wxString to print/display Epsilon R
  FormatEpsilonR(aDielectricSubLayer = 0): string {
    // return a wxString to print/display Epsilon R
    // note: we do not want scientific notation
    const txt = UIDouble2Str(this.GetEpsilonR(aDielectricSubLayer));
    return txt;
  }

  /// @return a wxString to print/display Loss Tangent
  FormatLossTangent(aDielectricSubLayer = 0): string {
    // return a wxString to print/display Loss Tangent
    // note: we do not want scientific notation
    const txt = UIDouble2Str(this.GetLossTangent(aDielectricSubLayer));
    return txt;
  }

  /// @return a wxString to print/display a dielectric name
  FormatDielectricLayerName(): string {
    // return a wxString to print/display a dielectric name
    return `Dielectric ${this.GetDielectricLayerId()}`;
  }

  // Getters:
  IsEnabled(): boolean {
    return this.m_enabled;
  }

  GetType(): BOARD_STACKUP_ITEM_TYPE {
    return this.m_Type;
  }

  GetBrdLayerId(): PCB_LAYER_ID {
    return this.m_LayerId;
  }

  GetLayerName(): string {
    return this.m_LayerName;
  }

  GetTypeName(): string {
    return this.m_TypeName;
  }

  GetDielectricLayerId(): number {
    return this.m_DielectricLayerId;
  }

  GetColor(aDielectricSubLayer = 0): string {
    return this.m_DielectricPrmsList[aDielectricSubLayer]!.m_Color;
  }

  GetThickness(aDielectricSubLayer = 0): number {
    return this.m_DielectricPrmsList[aDielectricSubLayer]!.m_Thickness;
  }

  IsThicknessLocked(aDielectricSubLayer = 0): boolean {
    return this.m_DielectricPrmsList[aDielectricSubLayer]!.m_ThicknessLocked;
  }

  GetEpsilonR(aDielectricSubLayer = 0): number {
    return this.m_DielectricPrmsList[aDielectricSubLayer]!.m_EpsilonR;
  }

  GetLossTangent(aDielectricSubLayer = 0): number {
    return this.m_DielectricPrmsList[aDielectricSubLayer]!.m_LossTangent;
  }

  GetMaterial(aDielectricSubLayer = 0): string {
    return this.m_DielectricPrmsList[aDielectricSubLayer]!.m_Material;
  }

  // Setters:
  SetEnabled(aEnable: boolean): void {
    this.m_enabled = aEnable;
  }

  SetBrdLayerId(aBrdLayerId: PCB_LAYER_ID): void {
    this.m_LayerId = aBrdLayerId;
  }

  SetLayerName(aName: string): void {
    this.m_LayerName = aName;
  }

  SetTypeName(aName: string): void {
    this.m_TypeName = aName;
  }

  SetDielectricLayerId(aLayerId: number): void {
    this.m_DielectricLayerId = aLayerId;
  }

  SetColor(aColorName: string, aDielectricSubLayer = 0): void {
    if (aDielectricSubLayer >= 0 && aDielectricSubLayer < this.GetSublayersCount())
      this.m_DielectricPrmsList[aDielectricSubLayer]!.m_Color = aColorName;
  }

  SetThickness(aThickness: number, aDielectricSubLayer = 0): void {
    if (aDielectricSubLayer >= 0 && aDielectricSubLayer < this.GetSublayersCount())
      this.m_DielectricPrmsList[aDielectricSubLayer]!.m_Thickness = aThickness;
  }

  SetThicknessLocked(aLocked: boolean, aDielectricSubLayer = 0): void {
    if (aDielectricSubLayer >= 0 && aDielectricSubLayer < this.GetSublayersCount())
      this.m_DielectricPrmsList[aDielectricSubLayer]!.m_ThicknessLocked = aLocked;
  }

  SetEpsilonR(aEpsilon: number, aDielectricSubLayer = 0): void {
    if (aDielectricSubLayer >= 0 && aDielectricSubLayer < this.GetSublayersCount())
      this.m_DielectricPrmsList[aDielectricSubLayer]!.m_EpsilonR = aEpsilon;
  }

  SetLossTangent(aTg: number, aDielectricSubLayer = 0): void {
    if (aDielectricSubLayer >= 0 && aDielectricSubLayer < this.GetSublayersCount())
      this.m_DielectricPrmsList[aDielectricSubLayer]!.m_LossTangent = aTg;
  }

  SetMaterial(aName: string, aDielectricSubLayer = 0): void {
    if (aDielectricSubLayer >= 0 && aDielectricSubLayer < this.GetSublayersCount())
      this.m_DielectricPrmsList[aDielectricSubLayer]!.m_Material = aName;
  }
}

/**
 * Manage layers needed to make a physical board.
 *
 * They are solder mask, silk screen, copper and dielectric.
 * Some other layers, used in fabrication, are not managed here because they are not used
 * to make a physical board itself.
 *
 * @note There are a few other parameters related to the physical stackup like finish type,
 *       impedance control and a few others.
 */
export class BOARD_STACKUP {
  m_FinishType: string; ///< The name of external copper finish
  m_HasDielectricConstrains: boolean; ///< True if some layers have impedance controlled tracks
  ///< or have specific constrains for micro-wave applications
  ///< If the board has dielectric constrains, the .gbrjob will
  ///< contain the dielectric constrains
  m_HasThicknessConstrains: boolean; ///< True if some dielectric layers have constrains
  ///< (thickness)
  m_EdgeConnectorConstraints: BS_EDGE_CONNECTOR_CONSTRAINTS; ///< If the board has edge connector
  ///< cards, some constrains can be
  ///< specified in job file:
  ///< BS_EDGE_CONNECTOR_NONE
  ///< BS_EDGE_CONNECTOR_IN_USE
  ///< BS_EDGE_CONNECTOR_BEVELLED
  m_EdgePlating: boolean; ///< True if the edge board is plated

  private m_list: BOARD_STACKUP_ITEM[] = [];

  constructor() {
    this.m_HasDielectricConstrains = false; // True if some dielectric layers have constrains
    // (Loss tg and Epison R)
    this.m_HasThicknessConstrains = false; // True if some dielectric or copper layers have constrains
    this.m_EdgeConnectorConstraints = BS_EDGE_CONNECTOR_NONE;
    this.m_EdgePlating = false; // True if edge board is plated
    this.m_FinishType = 'None'; // undefined finish type
  }

  /** `BOARD_STACKUP( const BOARD_STACKUP& aOther )`. */
  static copyOf(aOther: BOARD_STACKUP): BOARD_STACKUP {
    const s = new BOARD_STACKUP();
    s.m_HasDielectricConstrains = aOther.m_HasDielectricConstrains;
    s.m_HasThicknessConstrains = aOther.m_HasThicknessConstrains;
    s.m_EdgeConnectorConstraints = aOther.m_EdgeConnectorConstraints;
    s.m_EdgePlating = aOther.m_EdgePlating;
    s.m_FinishType = aOther.m_FinishType;

    // All items in aOther.m_list have to be duplicated, because aOther.m_list
    // manage pointers to these items
    for (const item of aOther.m_list) {
      const dup_item = BOARD_STACKUP_ITEM.copyOf(item);
      s.Add(dup_item);
    }

    return s;
  }

  /** `operator=`. */
  assign(aOther: BOARD_STACKUP): this {
    this.m_HasDielectricConstrains = aOther.m_HasDielectricConstrains;
    this.m_HasThicknessConstrains = aOther.m_HasThicknessConstrains;
    this.m_EdgeConnectorConstraints = aOther.m_EdgeConnectorConstraints;
    this.m_EdgePlating = aOther.m_EdgePlating;
    this.m_FinishType = aOther.m_FinishType;

    this.RemoveAll();

    // All items in aOther.m_list have to be duplicated, because aOther.m_list
    // manage pointers to these items
    for (const item of aOther.m_list) {
      const dup_item = BOARD_STACKUP_ITEM.copyOf(item);
      this.Add(dup_item);
    }

    return this;
  }

  equals(aOther: BOARD_STACKUP): boolean {
    if (this.m_HasDielectricConstrains !== aOther.m_HasDielectricConstrains) return false;
    if (this.m_HasThicknessConstrains !== aOther.m_HasThicknessConstrains) return false;
    if (this.m_EdgeConnectorConstraints !== aOther.m_EdgeConnectorConstraints) return false;
    if (this.m_EdgePlating !== aOther.m_EdgePlating) return false;
    if (this.m_FinishType !== aOther.m_FinishType) return false;

    // std::equal over the first list's length, as the C++ does.
    for (let i = 0; i < this.m_list.length; i++) {
      const b = aOther.m_list[i];

      if (!b || !this.m_list[i]!.equals(b)) return false;
    }

    return true;
  }

  /**
   * @return the list of stackup items (layers).
   */
  GetList(): readonly BOARD_STACKUP_ITEM[] {
    return this.m_list;
  }

  /**
   * @return a reference to the layer aIndex, or nullptr if not exists.
   */
  GetStackupLayer(aIndex: number): BOARD_STACKUP_ITEM | null {
    if (aIndex < 0 || aIndex >= this.GetCount()) return null;

    return this.GetList()[aIndex]!;
  }

  /**
   * @return the board layers full mask allowed in the stackup list
   * i.e. the SilkS, Mask, Paste and the copper layers
   */
  static StackupAllowedBrdLayers(): LSET {
    return new LSET([F_SilkS, F_Mask, F_Paste, B_SilkS, B_Mask, B_Paste])
      .or(LSET.ExternalCuMask())
      .or(LSET.InternalCuMask());
  }

  /// Delete all items in list and clear the list
  RemoveAll(): void {
    this.m_list.length = 0;
  }

  /// @return the number of layers in the stackup
  GetCount(): number {
    return this.m_list.length;
  }

  /// @return the board thickness ( in UI) from the thickness of BOARD_STACKUP_ITEM list
  BuildBoardThicknessFromStackup(): number {
    // return the board thickness from the thickness of BOARD_STACKUP_ITEM list
    let thickness = 0;

    for (const item of this.m_list) {
      if (item.IsThicknessEditable() && item.IsEnabled()) {
        thickness += item.GetThickness();

        // dielectric layers can have more than one main layer
        // add thickness of all sublayers
        for (let idx = 1; idx < item.GetSublayersCount(); idx++) {
          thickness += item.GetThickness(idx);
        }
      }
    }

    return thickness;
  }

  /// Add a new item in stackup layer
  Add(aItem: BOARD_STACKUP_ITEM): void {
    this.m_list.push(aItem);
  }

  /**
   * Synchronize the BOARD_STACKUP_ITEM* list with the board.
   *
   * Not enabled layers are removed
   * Missing layers are added
   *
   * @param aSettings is the current board setting.
   * @return true if changes are made.
   */
  SynchronizeWithBoard(aSettings: BOARD_DESIGN_SETTINGS): boolean {
    let change = false;
    // Build the suitable stackup:
    const stackup = new BOARD_STACKUP();
    stackup.BuildDefaultStackupList(aSettings);

    // First, find removed layers:
    for (const curr_item of this.m_list) {
      let found = false;

      for (const item of stackup.GetList()) {
        if (curr_item.GetBrdLayerId() !== UNDEFINED_LAYER) {
          if (item.GetBrdLayerId() === curr_item.GetBrdLayerId()) {
            found = true;
            break;
          }
        } // curr_item = dielectric layer
        else {
          if (item.GetBrdLayerId() !== UNDEFINED_LAYER) continue;

          if (item.GetDielectricLayerId() === curr_item.GetDielectricLayerId()) {
            found = true;
            break;
          }
        }
      }

      if (!found) {
        // a layer was removed: a change is found
        change = true;
        break;
      }
    }

    // Now initialize all stackup items to the initial values, when exist
    for (const item of stackup.GetList()) {
      let found = false;
      // Search for initial settings:
      for (const initial_item of this.m_list) {
        if (item.GetBrdLayerId() !== UNDEFINED_LAYER) {
          if (item.GetBrdLayerId() === initial_item.GetBrdLayerId()) {
            item.assign(initial_item);
            found = true;
            break;
          }
        } // dielectric layer: see m_DielectricLayerId for identification
        else {
          // Compare dielectric layer with dielectric layer
          if (initial_item.GetBrdLayerId() !== UNDEFINED_LAYER) continue;

          if (item.GetDielectricLayerId() === initial_item.GetDielectricLayerId()) {
            item.assign(initial_item);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        change = true;
      }
    }

    // Transfer layer settings:
    this.assign(stackup);

    // Transfer other stackup settings from aSettings
    const source_stackup = aSettings.GetStackupDescriptor();
    this.m_HasDielectricConstrains = source_stackup.m_HasDielectricConstrains;
    this.m_EdgeConnectorConstraints = source_stackup.m_EdgeConnectorConstraints;
    this.m_EdgePlating = source_stackup.m_EdgePlating;
    this.m_FinishType = source_stackup.m_FinishType;

    return change;
  }

  /**
   * Create a default stackup, according to the current BOARD_DESIGN_SETTINGS settings.
   *
   * @param aSettings is the current board setting.
   *                  if nullptr, build a full stackup (with 32 copper layers)
   * @param aActiveCopperLayersCount is used only if aSettings == nullptr is the number
   *  of copper layers to use to calculate a default dielectric thickness.
   *  ((<= 0 to use all copper layers)
   */
  BuildDefaultStackupList(
    aSettings: BOARD_DESIGN_SETTINGS | null,
    aActiveCopperLayersCount = 0,
  ): void {
    // Creates a default stackup, according to the current BOARD_DESIGN_SETTINGS settings.
    // Note: the m_TypeName string is made translatable using _HKI marker, but is not
    // translated when building the stackup.
    // It will be used as this in files, and can be translated only in dialog
    // if aSettings == NULL, build a full stackup (with 32 copper layers)
    const enabledLayer = aSettings
      ? aSettings.GetEnabledLayers()
      : BOARD_STACKUP.StackupAllowedBrdLayers();
    const copperLayerCount = aSettings ? aSettings.GetCopperLayerCount() : 32;

    // We need to calculate a suitable dielectric layer thickness.
    // If no settings, and if aActiveCopperLayersCount is given, use it
    // (If no settings, and no aActiveCopperLayersCount, the full 32 layers are used)
    let activeCuLayerCount = copperLayerCount;

    if (aSettings === null && aActiveCopperLayersCount > 0)
      activeCuLayerCount = aActiveCopperLayersCount;

    const brd__thickness = aSettings ? aSettings.GetBoardThickness() : pcbIUScale.mmToIU(1.6);
    let diel_thickness =
      brd__thickness - BOARD_STACKUP_ITEM.GetCopperDefaultThickness() * activeCuLayerCount;

    // Take in account the solder mask thickness:
    const sm_count = new LSET(enabledLayer).and(new LSET([F_Mask, B_Mask])).count();
    diel_thickness -= BOARD_STACKUP_ITEM.GetMaskDefaultThickness() * sm_count;
    diel_thickness = Math.trunc(diel_thickness / Math.max(1, activeCuLayerCount - 1));

    let dielectric_idx = 0;

    // Add silk screen, solder mask and solder paste layers on top
    if (enabledLayer.test(F_SilkS)) {
      const item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_SILKSCREEN);
      item.SetBrdLayerId(F_SilkS);
      item.SetTypeName('Top Silk Screen');
      this.Add(item);
    }

    if (enabledLayer.test(F_Paste)) {
      const item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_SOLDERPASTE);
      item.SetBrdLayerId(F_Paste);
      item.SetTypeName('Top Solder Paste');
      this.Add(item);
    }

    if (enabledLayer.test(F_Mask)) {
      const item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_SOLDERMASK);
      item.SetBrdLayerId(F_Mask);
      item.SetTypeName('Top Solder Mask');
      this.Add(item);
    }

    // Add copper and dielectric layers
    for (const layer of enabledLayer.CuStack()) {
      let item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_COPPER);
      item.SetBrdLayerId(layer);
      item.SetTypeName(KEY_COPPER);
      this.Add(item);

      if (layer === B_Cu) break;

      // Add the dielectric layer:
      item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_DIELECTRIC);
      item.SetThickness(diel_thickness);
      item.SetDielectricLayerId(dielectric_idx + 1);

      // Display a dielectric default layer name:
      if ((dielectric_idx & 1) === 0) {
        item.SetTypeName(KEY_CORE);
        item.SetMaterial('FR4');
      } else {
        item.SetTypeName(KEY_PREPREG);
        item.SetMaterial('FR4');
      }

      this.Add(item);
      dielectric_idx++;
    }

    // Add silk screen, solder mask and solder paste layers on bottom
    if (enabledLayer.test(B_Mask)) {
      const item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_SOLDERMASK);
      item.SetBrdLayerId(B_Mask);
      item.SetTypeName('Bottom Solder Mask');
      this.Add(item);
    }

    if (enabledLayer.test(B_Paste)) {
      const item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_SOLDERPASTE);
      item.SetBrdLayerId(B_Paste);
      item.SetTypeName('Bottom Solder Paste');
      this.Add(item);
    }

    if (enabledLayer.test(B_SilkS)) {
      const item = new BOARD_STACKUP_ITEM(BS_ITEM_TYPE_SILKSCREEN);
      item.SetBrdLayerId(B_SilkS);
      item.SetTypeName('Bottom Silk Screen');
      this.Add(item);
    }

    // Transfer other stackup settings from aSettings
    if (aSettings) {
      const source_stackup = aSettings.GetStackupDescriptor();
      this.m_EdgeConnectorConstraints = source_stackup.m_EdgeConnectorConstraints;
      this.m_HasDielectricConstrains = source_stackup.m_HasDielectricConstrains;
      this.m_EdgePlating = source_stackup.m_EdgePlating;
      this.m_FinishType = source_stackup.m_FinishType;
    }
  }

  /**
   * Write the stackup info on board file
   *
   * @param aFormatter is the OUTPUTFORMATTER used to create the file
   * @param aBoard is the board
   */
  FormatBoardStackup(aFormatter: OUTPUTFORMATTER): void {
    // Board stackup is the ordered list from top to bottom of
    // physical layers and substrate used to build the board.
    if (this.m_list.length === 0) return;

    aFormatter.Print('(stackup');

    // Note:
    // Unspecified parameters are not stored in file.
    for (const item of this.m_list) {
      let layer_name: string;

      if (item.GetBrdLayerId() === UNDEFINED_LAYER)
        layer_name = `dielectric ${item.GetDielectricLayerId()}`;
      else layer_name = LSET.Name(item.GetBrdLayerId());

      aFormatter.Print(
        `(layer ${aFormatter.Quotew(layer_name)} (type ${aFormatter.Quotew(item.GetTypeName())})`,
      );

      // Output other parameters (in sub layer list there is at least one item)
      for (let idx = 0; idx < item.GetSublayersCount(); idx++) {
        if (idx)
          // not for the main (first) layer.
          aFormatter.Print(' addsublayer');

        if (item.IsColorEditable() && IsPrmSpecified(item.GetColor(idx))) {
          aFormatter.Print(`(color ${aFormatter.Quotew(item.GetColor(idx))})`);
        }

        if (item.IsThicknessEditable()) {
          aFormatter.Print(`(thickness ${FormatInternalUnits(pcbIUScale, item.GetThickness(idx))}`);

          if (item.GetType() === BS_ITEM_TYPE_DIELECTRIC && item.IsThicknessLocked(idx))
            aFormatter.Print(' locked');

          aFormatter.Print(')');
        }

        if (item.HasMaterialValue(idx)) {
          aFormatter.Print(`(material ${aFormatter.Quotew(item.GetMaterial(idx))})`);
        }

        if (item.HasEpsilonRValue() && item.HasMaterialValue(idx))
          aFormatter.Print(`(epsilon_r ${FormatDouble2Str(item.GetEpsilonR(idx))})`);

        if (item.HasLossTangentValue() && item.HasMaterialValue(idx)) {
          aFormatter.Print(`(loss_tangent ${FormatDouble2Str(item.GetLossTangent(idx))})`);
        }
      }

      aFormatter.Print(')');
    }

    // Other infos about board, related to layers and other fabrication specifications
    if (IsPrmSpecified(this.m_FinishType))
      aFormatter.Print(`(copper_finish ${aFormatter.Quotew(this.m_FinishType)})`);

    FormatBool(aFormatter, 'dielectric_constraints', this.m_HasDielectricConstrains);

    if (this.m_EdgeConnectorConstraints > 0) {
      aFormatter.Print(
        `(edge_connector ${this.m_EdgeConnectorConstraints > 1 ? 'bevelled' : 'yes'})`,
      );
    }

    if (this.m_EdgePlating) FormatBool(aFormatter, 'edge_plating', true);

    aFormatter.Print(')');
  }

  /**
   * Calculate the distance (height) between the two given copper layers.
   *
   * This is effectively the sum of the thickness of all layers between the two given layers.
   *
   * @param aFirstLayer is the first copper layer
   * @param aSecondLayer is the second copper layer
   * @return the distance between the two layers
   */
  GetLayerDistance(aFirstLayer: PCB_LAYER_ID, aSecondLayer: PCB_LAYER_ID): number {
    if (aFirstLayer === aSecondLayer) return 0;

    // B_Cu is always the last copper layer but doesn't have the last numerical value
    if (aSecondLayer !== B_Cu && (aSecondLayer < aFirstLayer || aFirstLayer === B_Cu))
      [aFirstLayer, aSecondLayer] = [aSecondLayer, aFirstLayer];

    let total = 0;
    let start = false;
    let half = false;

    for (const item of this.m_list) {
      // Will be UNDEFINED_LAYER for dielectrics
      const layer = item.GetBrdLayerId();

      if (layer !== UNDEFINED_LAYER && !IsCopperLayer(layer)) continue; // Silk/mask layer

      // Reached the start copper layer?  Start counting the next dielectric after it
      if (!start && layer !== UNDEFINED_LAYER && layer === aFirstLayer) {
        start = true;

        // Only count half of each internal copper layer
        if (aFirstLayer !== F_Cu && aFirstLayer !== B_Cu) half = true;
      } else if (!start) continue;

      // Reached the stop copper layer?  we're done
      if (start && layer !== UNDEFINED_LAYER && layer === aSecondLayer) {
        // Only count half of each internal copper layer
        if (aSecondLayer !== F_Cu && aSecondLayer !== B_Cu) half = true;
      }

      for (let sublayer = 0; sublayer < item.GetSublayersCount(); sublayer++) {
        const subThickness = item.GetThickness(sublayer);
        total += half ? Math.trunc(subThickness / 2) : subThickness;
      }

      half = false;

      if (layer !== UNDEFINED_LAYER && layer === aSecondLayer) break;
    }

    return total;
  }
}
