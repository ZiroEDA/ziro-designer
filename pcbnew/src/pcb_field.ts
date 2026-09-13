// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_field.h` / `pcbnew/pcb_field.cpp`: `PCB_FIELD`, a footprint
 * text field (Reference, Value, Datasheet, Description, or a user field).
 *
 * Not here: `Serialize`/`Deserialize` (protobuf) and `PCB_FIELD_DESC`.
 */

import { ResolveTextVars, type TextVarResolverFn } from '@ziroeda/common/src/common.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/src/eda_search_data.js';
import { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import { GAL_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { GetDefaultVariantName, IsURL, unescapeString } from '@ziroeda/common/src/string_utils.js';
import {
  FIELD_T,
  GetCanonicalFieldName,
  GetUserFieldName,
  DO_TRANSLATE,
} from '@ziroeda/common/src/template_fieldnames.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { KIUI_EllipsizeMenuText } from '@ziroeda/common/src/widgets/ui_common.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_ITEM } from './board_item.js';
import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';
import type { FOOTPRINT } from './footprint.js';
import { PCB_TEXT } from './pcb_text.js';

/** `wxString::CmpNoCase`. */
function cmpNoCase(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  return la < lb ? -1 : la > lb ? 1 : 0;
}

export class PCB_FIELD extends PCB_TEXT {
  private m_id: FIELD_T; ///< Field id, @see enum FIELD_T
  private m_ordinal: number; ///< Sort order for non-mandatory fields
  private m_name: string;

  /**
   * `PCB_FIELD( FOOTPRINT* aParent, FIELD_T aFieldId, const wxString& aName )`, or
   * `PCB_FIELD( const PCB_TEXT& aText, FIELD_T aFieldId, const wxString& aName )` when the
   * first argument is a text: the field takes the text's parent and copies its properties.
   */
  constructor(aParent: BOARD_ITEM | PCB_TEXT | null, aFieldId: FIELD_T, aName = '') {
    const fromText = aParent instanceof PCB_TEXT ? aParent : null;

    super(fromText ? fromText.GetParent() : aParent, KICAD_T.PCB_FIELD_T);

    this.m_id = aFieldId;
    this.m_name = aName;

    if (fromText) {
      this.m_ordinal = aFieldId as number;

      // Copy the text properties from the PCB_TEXT
      this.SetText(fromText.GetText());
      this.SetVisible(fromText.IsVisible());
      this.SetLayer(fromText.GetLayer());
      this.SetPosition(fromText.GetPosition());
      this.SetAttributes(fromText.GetAttributes());
    } else {
      this.m_ordinal = 0;

      if (this.m_id === FIELD_T.USER) this.m_ordinal = (aParent as FOOTPRINT).GetNextFieldOrdinal();
    }
  }

  /** `PCB_FIELD( const PCB_FIELD& )`. */
  static copyOfField(aOther: PCB_FIELD): PCB_FIELD {
    const copy = new PCB_FIELD(aOther.GetParent(), aOther.m_id, aOther.m_name);
    copy.assignPcbText(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    copy.m_id = aOther.m_id;
    copy.m_ordinal = aOther.m_ordinal;
    copy.m_name = aOther.m_name;
    return copy;
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_FIELD_T === aItem.Type();
  }

  override GetClass(): string {
    return 'PCB_FIELD';
  }

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    if (PCB_TEXT.prototype.IsType.call(this, aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.PCB_FIELD_LOCATE_REFERENCE_T && this.m_id === FIELD_T.REFERENCE)
        return true;
      else if (scanType === KICAD_T.PCB_FIELD_LOCATE_VALUE_T && this.m_id === FIELD_T.VALUE)
        return true;
      else if (scanType === KICAD_T.PCB_FIELD_LOCATE_DATASHEET_T && this.m_id === FIELD_T.DATASHEET)
        return true;
    }

    return false;
  }

  IsReference(): boolean {
    return this.m_id === FIELD_T.REFERENCE;
  }
  IsValue(): boolean {
    return this.m_id === FIELD_T.VALUE;
  }
  IsDatasheet(): boolean {
    return this.m_id === FIELD_T.DATASHEET;
  }
  IsComponentClass(): boolean {
    return this.GetName() === 'Component Class';
  }

  IsMandatory(): boolean {
    return (
      this.m_id === FIELD_T.REFERENCE ||
      this.m_id === FIELD_T.VALUE ||
      this.m_id === FIELD_T.DATASHEET ||
      this.m_id === FIELD_T.DESCRIPTION
    );
  }

  HasHypertext(): boolean {
    return IsURL(this.GetShownText(false));
  }

  override GetTextTypeDescription(): string {
    if (this.IsMandatory()) return GetCanonicalFieldName(this.m_id);
    else return 'User Field';
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    if (!this.IsVisible() && !aSearchData.searchAllFields) return false;

    return PCB_TEXT.prototype.Matches.call(this, aSearchData, aAuxData);
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    const content = aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText());
    const ref = this.GetParentFootprint()!.GetReference();

    switch (this.m_id) {
      case FIELD_T.REFERENCE:
        return `Reference field of ${ref}`;

      case FIELD_T.VALUE:
        return `Value field of ${ref} (${content})`;

      case FIELD_T.FOOTPRINT:
        return `Footprint field of ${ref} (${content})`;

      case FIELD_T.DATASHEET:
        return `Datasheet field of ${ref} (${content})`;

      default:
        if (this.GetName() === '') return `Field of ${ref} (${content})`;
        else return `${this.GetName()} field of ${ref} (${content})`;
    }
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (!aView) return PCB_FIELD.LOD_SHOW;

    const renderSettings = aView.GetPainter().GetSettings() as unknown as {
      m_ForceShowFieldsWhenFPSelected?: boolean;
    };
    const parent = this.GetParentFootprint();

    if (parent && parent.IsSelected() && renderSettings.m_ForceShowFieldsWhenFPSelected) {
      return PCB_FIELD.LOD_SHOW;
    }

    // Handle Render tab switches
    if (this.IsValue() && !aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FP_VALUES))
      return PCB_FIELD.LOD_HIDE;

    if (this.IsReference() && !aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FP_REFERENCES))
      return PCB_FIELD.LOD_HIDE;

    return PCB_TEXT.prototype.ViewGetLOD.call(this, aLayer, aView);
  }

  override Clone(): PCB_FIELD {
    return PCB_FIELD.copyOfField(this);
  }

  /**
   * Same as Clone, but returns a PCB_FIELD item.
   *
   * Useful mainly for python scripts, because Clone returns an EDA_ITEM.
   */
  CloneField(): PCB_FIELD {
    return this.Clone();
  }

  /**
   * Return the field name (not translated).
   *
   * @param aUseDefaultName When true return the default field name if the field name is
   *                        empty.  Otherwise the default field name is returned.
   */
  GetName(aUseDefaultName = true): string {
    if (this.IsMandatory()) return GetCanonicalFieldName(this.m_id);
    else if (this.m_name === '' && aUseDefaultName)
      return GetUserFieldName(this.m_ordinal, !DO_TRANSLATE);
    else return this.m_name;
  }

  /**
   * Get a non-language-specific name for a field which can be used for storage, variable
   * look-up, etc.
   */
  GetCanonicalName(): string {
    return this.GetName(true);
  }

  override GetShownText(aAllowExtraText: boolean, aDepth = 0): string {
    const parentFootprint = this.GetParentFootprint();
    const board = this.GetBoard();
    let text = '';
    let hasVariantOverride = false;

    if (parentFootprint && board) {
      const variantName = board.GetCurrentVariant();

      if (variantName !== '' && cmpNoCase(variantName, GetDefaultVariantName()) !== 0) {
        const variant = parentFootprint.GetVariant(variantName);

        if (variant) {
          if (variant.HasFieldValue(this.GetName())) {
            text = parentFootprint.GetFieldValueForVariant(variantName, this.GetName());
            hasVariantOverride = true;
          }
        }
      }
    }

    if (!hasVariantOverride) text = this.GetText();

    text = unescapeString(text);

    const resolver: TextVarResolverFn = (token) => {
      if (token.value === 'LAYER') {
        token.value = this.GetLayerName();
        return true;
      }

      if (parentFootprint && parentFootprint.ResolveTextVar(token, aDepth + 1)) return true;

      if (board && board.ResolveTextVar(token, aDepth + 1)) return true;

      return false;
    };

    if (text.includes('${') || text.includes('@{'))
      text = ResolveTextVars(text, resolver, { value: aDepth });

    text = text.replaceAll('<<<ESC_DOLLAR:', '${');
    text = text.replaceAll('<<<ESC_AT:', '@{');

    return text;
  }

  SetName(aName: string): void {
    this.m_name = aName;
  }

  GetId(): FIELD_T {
    return this.m_id;
  }

  GetOrdinal(): number {
    return this.IsMandatory() ? (this.m_id as number) : this.m_ordinal;
  }

  SetOrdinal(aOrdinal: number): void {
    this.m_id = FIELD_T.USER;
    this.m_ordinal = aOrdinal;
  }

  override Similarity(aOther: BOARD_ITEM | EDA_TEXT): number {
    if (!(aOther instanceof PCB_TEXT)) return PCB_TEXT.prototype.Similarity.call(this, aOther);

    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_FIELD;

    if (this.IsMandatory() || other.IsMandatory()) {
      if (this.m_id === other.m_id) return 1.0;
      else return 0.0;
    }

    if (this.m_name === other.m_name) return 1.0;

    return EDA_TEXT.prototype.Similarity.call(this, other as unknown as EDA_TEXT);
  }

  /** `operator==( const PCB_FIELD& )` and `operator==( const BOARD_ITEM& )`. */
  override equals(aOther: BOARD_ITEM): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther as PCB_FIELD;

    if (this.IsMandatory() !== other.IsMandatory()) return false;

    if (this.IsMandatory()) {
      if (this.m_id !== other.m_id) return false;
    } else {
      if (this.m_ordinal !== other.m_ordinal) return false;
    }

    return this.m_name === other.m_name && this.equalsEdaText(other as unknown as EDA_TEXT);
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_FIELD_T);

    // std::swap( *this, *aImage ): every member of both classes.
    const image = aImage as PCB_FIELD;
    const mine = PCB_FIELD.copyOfField(this);

    this.assignPcbText(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    this.m_id = image.m_id;
    this.m_ordinal = image.m_ordinal;
    this.m_name = image.m_name;

    image.assignPcbText(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
    image.m_id = mine.m_id;
    image.m_ordinal = mine.m_ordinal;
    image.m_name = mine.m_name;
  }

  private setId(aId: FIELD_T): void {
    this.m_id = aId;
  }
}
