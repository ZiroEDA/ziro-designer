// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/symbol.h` / `eeschema/symbol.cpp`: `SYMBOL`, the base class of `LIB_SYMBOL`
 * and `SCH_SYMBOL`, and the symbol orientation enums.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import type { SCH_FIELD } from './sch_field.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_PIN } from './sch_pin.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

/** `SYMBOL_ORIENTATION_T`. */
export enum SYMBOL_ORIENTATION_T {
  SYM_NORMAL, // Normal orientation, no rotation or mirror
  SYM_ROTATE_CLOCKWISE, // Rotate -90
  SYM_ROTATE_COUNTERCLOCKWISE, // Rotate +90
  SYM_ORIENT_0, // No rotation and no mirror id SYM_NORMAL
  SYM_ORIENT_90, // Rotate 90, no mirror
  SYM_ORIENT_180, // Rotate 180, no mirror
  SYM_ORIENT_270, // Rotate -90, no mirror
  SYM_MIRROR_X = 0x100, // Mirror around X axis
  SYM_MIRROR_Y = 0x200, // Mirror around Y axis
}

/** `SYMBOL_ORIENTATION_PROP`: the orientations the property panel offers. */
export enum SYMBOL_ORIENTATION_PROP {
  SYMBOL_ANGLE_0 = SYMBOL_ORIENTATION_T.SYM_ORIENT_0,
  SYMBOL_ANGLE_90 = SYMBOL_ORIENTATION_T.SYM_ORIENT_90,
  SYMBOL_ANGLE_180 = SYMBOL_ORIENTATION_T.SYM_ORIENT_180,
  SYMBOL_ANGLE_270 = SYMBOL_ORIENTATION_T.SYM_ORIENT_270,
}

/**
 * A base class for LIB_SYMBOL and SCH_SYMBOL.
 */
export abstract class SYMBOL extends SCH_ITEM {
  protected m_transform: TRANSFORM; ///< The rotation/mirror transformation.

  /// The offset in mils to draw the pin name.  Set to 0 to draw the pin name above the pin.
  protected m_pinNameOffset: number;

  protected m_showPinNames: boolean;
  protected m_showPinNumbers: boolean;

  protected m_excludedFromSim: boolean;
  protected m_excludedFromBOM: boolean;
  protected m_excludedFromBoard: boolean;
  protected m_excludedFromPosFiles: boolean;
  protected m_DNP: boolean; ///< True if symbol is set to 'Do Not Populate'.

  protected m_previewUnit: number;
  protected m_previewBodyStyle: number;

  /** `SYMBOL( KICAD_T idType )` or `SYMBOL( EDA_ITEM* aParent, KICAD_T idType )`. */
  constructor(aParent: EDA_ITEM | null, idType: KICAD_T) {
    super(aParent, idType);
    this.m_transform = new TRANSFORM();
    this.m_pinNameOffset = 0;
    this.m_showPinNames = true;
    this.m_showPinNumbers = true;
    this.m_excludedFromSim = false;
    this.m_excludedFromBOM = false;
    this.m_excludedFromBoard = false;
    this.m_excludedFromPosFiles = false;
    this.m_DNP = false;
    this.m_previewUnit = 1;
    this.m_previewBodyStyle = 1;
  }

  /** `SYMBOL( const SYMBOL& base )` as a derived copy's step. */
  protected static copySymbol<T extends SYMBOL>(aInto: T, base: SYMBOL): T {
    SCH_ITEM.copySchItem(aInto, base);
    aInto.m_pinNameOffset = base.m_pinNameOffset;
    aInto.m_showPinNames = base.m_showPinNames;
    aInto.m_showPinNumbers = base.m_showPinNumbers;
    aInto.m_excludedFromSim = base.m_excludedFromSim;
    aInto.m_excludedFromBOM = base.m_excludedFromBOM;
    aInto.m_excludedFromBoard = base.m_excludedFromBoard;
    aInto.m_excludedFromPosFiles = base.m_excludedFromPosFiles;
    aInto.m_DNP = base.m_DNP;
    // m_transform keeps its default: the copy constructor does not name it.
    return aInto;
  }

  /** `SYMBOL& operator=( const SYMBOL& aItem )`. */
  assignSymbol(aItem: SYMBOL): this {
    this.assignSchItem(aItem);

    this.m_pinNameOffset = aItem.m_pinNameOffset;
    this.m_showPinNames = aItem.m_showPinNames;
    this.m_showPinNumbers = aItem.m_showPinNumbers;
    this.m_excludedFromSim = aItem.m_excludedFromSim;
    this.m_excludedFromBOM = aItem.m_excludedFromBOM;
    this.m_excludedFromBoard = aItem.m_excludedFromBoard;
    this.m_excludedFromPosFiles = aItem.m_excludedFromPosFiles;
    this.m_DNP = aItem.m_DNP;

    return this;
  }

  abstract GetLibId(): LIB_ID;
  abstract GetDescription(): string;
  abstract GetShownDescription(aDepth?: number): string;
  abstract GetKeyWords(): string;
  abstract GetShownKeyWords(aDepth?: number): string;

  abstract IsGlobalPower(): boolean;
  abstract IsLocalPower(): boolean;
  abstract IsPower(): boolean;
  abstract IsNormal(): boolean;

  /** Test if symbol has more than one body conversion type (DeMorgan). */
  abstract IsMultiUnit(): boolean;

  /** @return the number of units defined for the symbol. */
  abstract GetUnitCount(): number;

  abstract IsMultiBodyStyle(): boolean;
  abstract GetBodyStyleCount(): number;
  abstract HasDeMorganBodyStyles(): boolean;

  abstract GetRef(aSheet: SCH_SHEET_PATH | null, aIncludeUnit?: boolean): string;

  abstract GetValue(
    aResolve: boolean,
    aPath: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    aVariantName?: string,
  ): string;

  /**
   * Populate a std::vector with SCH_FIELDs, sorted by ordinal.
   *
   * @param aVector is the vector to populate.
   * @param aVisibleOnly is used to add only the fields which are visible and contain text.
   */
  abstract GetFields(aVector: SCH_FIELD[], aVisibleOnly: boolean): void;

  abstract GetPins(): SCH_PIN[];

  /**
   * Set the offset in mils of the pin name text from the pin symbol.
   *
   * Set the offset to 0 to draw the pin name above the pin symbol.
   */
  SetPinNameOffset(aOffset: number): void {
    this.m_pinNameOffset = aOffset;
  }
  GetPinNameOffset(): number {
    return this.m_pinNameOffset;
  }

  /** Set or clear the pin name visibility flag. */
  SetShowPinNames(aShow: boolean): void {
    this.m_showPinNames = aShow;
  }
  GetShowPinNames(): boolean {
    return this.m_showPinNames;
  }

  /** Set or clear the pin number visibility flag. */
  SetShowPinNumbers(aShow: boolean): void {
    this.m_showPinNumbers = aShow;
  }
  GetShowPinNumbers(): boolean {
    return this.m_showPinNumbers;
  }

  override SetExcludedFromSim(
    aExcludeFromSim: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromSim = aExcludeFromSim;
  }
  override GetExcludedFromSim(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromSim;
  }

  override SetExcludedFromBOM(
    aExcludeFromBOM: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromBOM = aExcludeFromBOM;
  }
  override GetExcludedFromBOM(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromBOM;
  }

  override SetExcludedFromBoard(
    aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromBoard = aExclude;
  }
  override GetExcludedFromBoard(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromBoard;
  }

  override SetExcludedFromPosFiles(
    aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromPosFiles = aExclude;
  }
  override GetExcludedFromPosFiles(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromPosFiles;
  }

  override GetDNP(_aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): boolean {
    return this.m_DNP;
  }
  override SetDNP(
    aDNP: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_DNP = aDNP;
  }

  GetOrientation(): number {
    return SYMBOL_ORIENTATION_T.SYM_NORMAL;
  }

  GetTransform(): TRANSFORM {
    return this.m_transform;
  }
  SetTransform(aTransform: TRANSFORM): void {
    this.m_transform = aTransform.Clone();
  }

  SetPreviewUnit(aUnit: number): void {
    this.m_previewUnit = aUnit;
  }
  SetPreviewBodyStyle(aBodyStyle: number): void {
    this.m_previewBodyStyle = aBodyStyle;
  }

  /** Return a bounding box for the symbol body but not the pins or fields. */
  abstract GetBodyBoundingBox(): BOX2I;

  /** Return a bounding box for the symbol body and pins but not the fields. */
  abstract GetBodyAndPinsBoundingBox(): BOX2I;

  override ViewGetLayers(): number[] {
    if (this.Type() === KICAD_T.SCH_SYMBOL_T)
      return [
        SCH_LAYER_ID.LAYER_DANGLING,
        SCH_LAYER_ID.LAYER_OP_CURRENTS,
        SCH_LAYER_ID.LAYER_DEVICE,
        SCH_LAYER_ID.LAYER_REFERENCEPART,
        SCH_LAYER_ID.LAYER_VALUEPART,
        SCH_LAYER_ID.LAYER_FIELDS,
        SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND,
        SCH_LAYER_ID.LAYER_SHAPES_BACKGROUND,
        SCH_LAYER_ID.LAYER_NOTES_BACKGROUND,
        SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
      ];

    if (this.Type() === KICAD_T.LIB_SYMBOL_T)
      return [
        SCH_LAYER_ID.LAYER_DEVICE,
        SCH_LAYER_ID.LAYER_REFERENCEPART,
        SCH_LAYER_ID.LAYER_VALUEPART,
        SCH_LAYER_ID.LAYER_FIELDS,
        SCH_LAYER_ID.LAYER_PRIVATE_NOTES,
        SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND,
        SCH_LAYER_ID.LAYER_SHAPES_BACKGROUND,
        SCH_LAYER_ID.LAYER_NOTES_BACKGROUND,
        SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
      ];

    return [
      SCH_LAYER_ID.LAYER_DEVICE,
      SCH_LAYER_ID.LAYER_REFERENCEPART,
      SCH_LAYER_ID.LAYER_VALUEPART,
      SCH_LAYER_ID.LAYER_FIELDS,
      SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND,
      SCH_LAYER_ID.LAYER_SHAPES_BACKGROUND,
      SCH_LAYER_ID.LAYER_NOTES_BACKGROUND,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
  }
}
