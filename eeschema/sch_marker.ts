// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_marker.h` / `sch_marker.cpp`: `SCH_MARKER`, an ERC marker on a
 * schematic sheet, over `SCH_ITEM` with `MARKER_BASE` mixed in.
 *
 * Not here: `Plot` (a no-op upstream: markers are never plotted), `Show`
 * (debug). `getColor` reads the built-in default theme, as upstream's
 * `GetColorSettings( DEFAULT_THEME )` does.
 */

import type { EDA_DRAW_FRAME_LIKE, EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { type KIID, KIID_PATH, kiidFromString, niluuid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { MARKER_BASE, MARKER_T } from '@ziroeda/common/marker_base.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/reporter.js';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/settings/builtin_color_themes.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ERC_ITEM } from './erc/erc_item.js';
import { ERCE_T } from './erc/erc_settings.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_LIST } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';

/// Factor to convert the maker unit shape to internal units:
const SCALING_FACTOR = schIUScale.mmToIU(0.15);

/** `dynamic_cast<EDA_TEXT*>`: the text-bearing items answer `GetText`. */
function asText(aItem: EDA_ITEM | null): EDA_TEXT | null {
  const text = aItem as Partial<EDA_TEXT> | null;
  return text && typeof text.GetText === 'function' ? (text as EDA_TEXT) : null;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (MARKER_BASE mixin)
export interface SCH_MARKER extends MARKER_BASE {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (MARKER_BASE mixin)
export class SCH_MARKER extends SCH_ITEM {
  protected m_isLegacyMarker: boolean; ///< True if marker was deserialized from a file version < 20230121.

  constructor(aItem: ERC_ITEM | null, aPos: VECTOR2I) {
    super(null, KICAD_T.SCH_MARKER_T);
    this.initMarkerBase(SCALING_FACTOR, aItem, MARKER_T.MARKER_ERC);

    if (this.m_rcItem) this.m_rcItem.SetParent(this);

    this.m_Pos = { x: aPos.x, y: aPos.y };

    this.m_isLegacyMarker = false;
  }

  /** `SCH_MARKER( const SCH_MARKER& )`: the compiler-generated copy (the ERC_ITEM is shared). */
  static copyOf(aOther: SCH_MARKER): SCH_MARKER {
    const copy = new SCH_MARKER(null, aOther.m_Pos);
    SCH_ITEM.copySchItem(copy, aOther);
    copy.initMarkerBaseFrom(aOther);
    copy.m_isLegacyMarker = aOther.m_isLegacyMarker;
    return copy;
  }

  /** `~SCH_MARKER()`. */
  override Destroy(): void {
    if (this.m_rcItem) this.m_rcItem.SetParent(null);

    super.Destroy();
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_MARKER_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_MARKER';
  }

  GetUUID(): KIID {
    return this.m_Uuid;
  }

  override Clone(): SCH_MARKER {
    return SCH_MARKER.copyOf(this);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    const item = aItem as SCH_MARKER;

    [this.m_isLegacyMarker, item.m_isLegacyMarker] = [item.m_isLegacyMarker, this.m_isLegacyMarker];
    [this.m_Pos, item.m_Pos] = [item.m_Pos, this.m_Pos];

    [this.m_markerType, item.m_markerType] = [item.m_markerType, this.m_markerType];
    [this.m_excluded, item.m_excluded] = [item.m_excluded, this.m_excluded];
    [this.m_comment, item.m_comment] = [item.m_comment, this.m_comment];
    [this.m_rcItem, item.m_rcItem] = [item.m_rcItem, this.m_rcItem];

    [this.m_scalingFactor, item.m_scalingFactor] = [item.m_scalingFactor, this.m_scalingFactor];
    [this.m_shapeBoundingBox, item.m_shapeBoundingBox] = [
      item.m_shapeBoundingBox,
      this.m_shapeBoundingBox,
    ];
  }

  SerializeToString(): string {
    const erc = this.m_rcItem as ERC_ITEM;
    let sheetSpecificPath = '';
    let mainItemPath = '';
    let auxItemPath = '';

    if (erc.IsSheetSpecific()) sheetSpecificPath = erc.GetSpecificSheetPath().Path().AsString();

    if (erc.MainItemHasSheetPath()) mainItemPath = erc.GetMainItemSheetPath().Path().AsString();

    if (erc.AuxItemHasSheetPath()) auxItemPath = erc.GetAuxItemSheetPath().Path().AsString();

    const code = erc.GetErrorCode();

    if (
      code === ERCE_T.ERCE_GENERIC_WARNING ||
      code === ERCE_T.ERCE_GENERIC_ERROR ||
      code === ERCE_T.ERCE_UNRESOLVED_VARIABLE
    ) {
      const sch_item = this.Schematic()!.ResolveItem(erc.GetMainItemID());
      const parent = (sch_item?.GetParent() ?? null) as SCH_ITEM | null;
      const text_item = asText(sch_item);

      // SCH_FIELDs and SCH_ITEMs inside LIB_SYMBOLs don't have persistent KIIDs.  So the
      // exclusion must refer to the parent's KIID, and include the text of the original text
      // item for later look-up.

      if (
        parent?.IsType([KICAD_T.SCH_SYMBOL_T, KICAD_T.SCH_LABEL_T, KICAD_T.SCH_SHEET_T]) &&
        text_item // should always be true, but Coverity doesn't know that
      ) {
        return [
          erc.GetSettingsKey(),
          this.m_Pos.x,
          this.m_Pos.y,
          parent.m_Uuid,
          text_item.GetText(),
          sheetSpecificPath,
          mainItemPath,
          '',
        ].join('|');
      }
    }

    return [
      erc.GetSettingsKey(),
      this.m_Pos.x,
      this.m_Pos.y,
      erc.GetMainItemID(),
      erc.GetAuxItemID(),
      sheetSpecificPath,
      mainItemPath,
      auxItemPath,
    ].join('|');
  }

  static DeserializeFromString(aSheetList: SCH_SHEET_LIST, data: string): SCH_MARKER | null {
    const props = data.split('|');
    // (int) strtol( props[n], nullptr, 10 ): leading digits, 0 when there are none.
    const toInt = (s: string | undefined): number => Number.parseInt(s ?? '', 10) || 0;
    const markerPos: VECTOR2I = { x: toInt(props[1]), y: toInt(props[2]) };

    const ercItem = ERC_ITEM.Create(props[0] ?? '');

    if (!ercItem) return null;

    const code = ercItem.GetErrorCode();
    const prop = (i: number): string => props[i] ?? '';

    if (
      code === ERCE_T.ERCE_GENERIC_WARNING ||
      code === ERCE_T.ERCE_GENERIC_ERROR ||
      code === ERCE_T.ERCE_UNRESOLVED_VARIABLE
    ) {
      // SCH_FIELDs and SCH_ITEMs inside LIB_SYMBOLs don't have persistent KIIDs.  So the
      // exclusion will contain the parent's KIID in prop[3], and the text of the original
      // text item in prop[4].

      if (prop(4).length !== 0) {
        let uuid: KIID = niluuid;
        const parent = aSheetList.ResolveItem(kiidFromString(prop(3)));

        // Check fields and pins for a match
        parent?.RunOnChildren((child: SCH_ITEM) => {
          const text_item = asText(child);

          if (text_item && text_item.GetText() === prop(4)) uuid = child.m_Uuid;
        }, RECURSE_MODE.NO_RECURSE);

        // If it's a symbol, we must also check non-overridden LIB_SYMBOL text children
        if (uuid === niluuid && parent?.Type() === KICAD_T.SCH_SYMBOL_T) {
          (parent as SCH_SYMBOL).GetLibSymbolRef()?.RunOnChildren((child: SCH_ITEM) => {
            if (child.Type() === KICAD_T.SCH_FIELD_T) {
              // Match only on SCH_SYMBOL fields, not LIB_SYMBOL fields.
            } else {
              const text_item = asText(child);

              if (text_item && text_item.GetText() === prop(4)) uuid = child.m_Uuid;
            }
          }, RECURSE_MODE.NO_RECURSE);
        }

        if (uuid !== niluuid) ercItem.SetItems(uuid);
        else return null;
      } else {
        ercItem.SetItems(kiidFromString(prop(3)));
      }
    } else {
      ercItem.SetItems(kiidFromString(prop(3)), kiidFromString(prop(4)));
    }

    let isLegacyMarker = true;

    // Deserialize sheet / item specific paths - we are not able to use the file version to
    // determine if markers are legacy as there could be a file opened with a prior version
    // but which has new markers - this code is called not just during schematic load, but
    // also to match new ERC exceptions to exclusions.
    if (props.length === 8) {
      isLegacyMarker = false;

      if (prop(5).length !== 0) {
        const sheetSpecificKiidPath = new KIID_PATH(prop(5));
        const sheetSpecificPath = aSheetList.GetSheetPathByKIIDPath(sheetSpecificKiidPath, true);

        if (sheetSpecificPath !== undefined) ercItem.SetSheetSpecificPath(sheetSpecificPath);
      }

      if (prop(6).length !== 0) {
        const mainItemKiidPath = new KIID_PATH(prop(6));
        const mainItemPath = aSheetList.GetSheetPathByKIIDPath(mainItemKiidPath, true);

        if (mainItemPath !== undefined) {
          if (prop(7).length === 0) {
            ercItem.SetItemsSheetPaths(mainItemPath);
          } else {
            const auxItemKiidPath = new KIID_PATH(prop(7));
            const auxItemPath = aSheetList.GetSheetPathByKIIDPath(auxItemKiidPath, true);

            if (auxItemPath !== undefined) ercItem.SetItemsSheetPaths(mainItemPath, auxItemPath);
          }
        }
      }
    }

    const marker = new SCH_MARKER(ercItem, markerPos);
    marker.SetIsLegacyMarker(isLegacyMarker);

    return marker;
  }

  override ViewGetLayers(): number[] {
    const schematic = this.Schematic();

    if (!schematic) return []; // wxCHECK2_MSG( Schematic(), return {}, "No SCHEMATIC set" )

    // Don't display sheet-specific markers when SCH_SHEET_PATHs do not match
    const ercItem = this.GetRCItem() as ERC_ITEM;

    if (
      ercItem.IsSheetSpecific() &&
      !ercItem.GetSpecificSheetPath().equals(schematic.CurrentSheet())
    ) {
      return [];
    }

    const layers: number[] = [0, 0];

    if (this.IsExcluded()) {
      layers[0] = SCH_LAYER_ID.LAYER_ERC_EXCLUSION;
    } else {
      switch (schematic.ErcSettings().GetSeverity(this.m_rcItem!.GetErrorCode())) {
        case RPT_SEVERITY_IGNORE:
          return [];
        case RPT_SEVERITY_WARNING:
          layers[0] = SCH_LAYER_ID.LAYER_ERC_WARN;
          break;
        default:
          layers[0] = SCH_LAYER_ID.LAYER_ERC_ERR;
          break;
      }
    }

    layers[1] = SCH_LAYER_ID.LAYER_SELECTION_SHADOWS;
    return layers;
  }

  GetColorLayer(): SCH_LAYER_ID {
    if (this.IsExcluded()) return SCH_LAYER_ID.LAYER_ERC_EXCLUSION;

    const schematic = this.Schematic();

    if (!schematic) return SCH_LAYER_ID.LAYER_ERC_ERR; // wxCHECK_MSG

    switch (schematic.ErcSettings().GetSeverity(this.m_rcItem!.GetErrorCode())) {
      case RPT_SEVERITY_WARNING:
        return SCH_LAYER_ID.LAYER_ERC_WARN;
      default:
        return SCH_LAYER_ID.LAYER_ERC_ERR;
    }
  }

  protected getColor(): Color4d {
    // ::GetColorSettings( DEFAULT_THEME )->GetColor( GetColorLayer() )
    return BUILTIN_DEFAULT_THEME[
      SCH_LAYER_ID[this.GetColorLayer()] as keyof typeof BUILTIN_DEFAULT_THEME
    ];
  }

  GetSeverity(): Severity {
    if (this.IsExcluded()) return RPT_SEVERITY_EXCLUSION;

    const item = this.m_rcItem as ERC_ITEM;

    return this.Schematic()!.ErcSettings().GetSeverity(item.GetErrorCode());
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    return this.matchesText(this.m_rcItem!.GetErrorMessage(true), aSearchData);
  }

  override GetBoundingBox(): BOX2I {
    return this.GetBoundingBoxMarker();
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const rcItem = this.m_rcItem!;

    aList.push(new MSG_PANEL_ITEM('Type', 'Marker'));
    aList.push(new MSG_PANEL_ITEM('Violation', rcItem.GetErrorMessage(true)));

    switch (this.GetSeverity()) {
      case RPT_SEVERITY_IGNORE:
        aList.push(new MSG_PANEL_ITEM('Severity', 'Ignore'));
        break;
      case RPT_SEVERITY_WARNING:
        aList.push(new MSG_PANEL_ITEM('Severity', 'Warning'));
        break;
      case RPT_SEVERITY_ERROR:
        aList.push(new MSG_PANEL_ITEM('Severity', 'Error'));
        break;
      default:
        break;
    }

    if (this.GetMarkerType() === MARKER_T.MARKER_DRAWING_SHEET) {
      aList.push(new MSG_PANEL_ITEM('Drawing Sheet', ''));
    } else {
      let mainText = '';
      let auxText = '';
      let mainItem: EDA_ITEM | null = null;
      let auxItem: EDA_ITEM | null = null;

      if (rcItem.GetMainItemID() !== niluuid) mainItem = aFrame.ResolveItem(rcItem.GetMainItemID());

      if (rcItem.GetAuxItemID() !== niluuid) auxItem = aFrame.ResolveItem(rcItem.GetAuxItemID());

      if (mainItem) mainText = mainItem.GetItemDescription(aFrame, true);

      if (auxItem) auxText = auxItem.GetItemDescription(aFrame, true);

      aList.push(new MSG_PANEL_ITEM(mainText, auxText));
    }

    if (this.IsExcluded()) aList.push(new MSG_PANEL_ITEM('Excluded', this.m_comment));
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'ERC Marker';
  }

  override GetMenuImage(): string {
    return 'erc'; // BITMAPS::erc
  }

  override GetPosition(): VECTOR2I {
    return this.m_Pos;
  }
  override SetPosition(aPosition: VECTOR2I): void {
    this.m_Pos = { x: aPosition.x, y: aPosition.y };
  }

  // Geometric transforms (used in block operations):

  override Move(aMoveVector: VECTOR2I): void {
    this.m_Pos = { x: this.m_Pos.x + aMoveVector.x, y: this.m_Pos.y + aMoveVector.y };
  }

  override MirrorHorizontally(_aCenter: number): void {
    // Marker geometry isn't user-editable
  }

  override MirrorVertically(_aCenter: number): void {
    // Marker geometry isn't user-editable
  }

  override Rotate(_aCenter: VECTOR2I, _aRotateCCW: boolean): void {
    // Marker geometry isn't user-editable
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    // Only the point test is overridden upstream; the area tests are EDA_ITEM's.
    if (typeof (a as VECTOR2I).x === 'number' && typeof (a as VECTOR2I).y === 'number')
      return this.HitTestMarker(a as VECTOR2I, (b as number | undefined) ?? 0);

    return super.HitTest(a as BOX2I, b as boolean, c);
  }

  /**
   * Set this marker as a legacy artifact.
   *
   * Legacy markers are those deserialized from a file version < 20230121.
   */
  SetIsLegacyMarker(isLegacyMarker = true): void {
    this.m_isLegacyMarker = isLegacyMarker;
  }

  /**
   * Determine if this marker is legacy (i.e. does not store sheet paths for specific errors).
   */
  IsLegacyMarker(): boolean {
    return this.m_isLegacyMarker;
  }

  override Similarity(_aOther: SCH_ITEM): number {
    return 0.0;
  }

  override equals(_aOther: SCH_ITEM): boolean {
    return false;
  }
}

applyMixins(SCH_MARKER, [MARKER_BASE]);
