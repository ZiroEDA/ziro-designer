// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Field helpers. Counterpart: `eeschema/sch_field.cpp`.
 *
 * A netclass directive label stores the netclass it applies in a field whose
 * name is "Netclass", but files written by a translated build (or shared
 * across languages via git) carry the translated name instead, so
 * `SCH_FIELD::GetCanonicalName` maps any of them back. The table below is
 * `GetKnownNetclassFieldTranslations()`, verbatim.
 */

import { GetGeneratedFieldDisplayName, IsGeneratedField } from '@ziroeda/common/common.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { EDA_ITEM as EDA_ITEM_CLASS } from '@ziroeda/common/eda_item.js';
import { SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { type EDA_SEARCH_DATA, SCH_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FONT } from '@ziroeda/common/font/font.js';
import type { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import { IsURL, unescapeString } from '@ziroeda/common/string_utils.js';
import {
  DO_TRANSLATE,
  FIELD_T,
  GetCanonicalFieldName,
  GetDefaultFieldName,
} from '@ziroeda/common/template_fieldnames.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KIUI_EllipsizeMenuText } from '@ziroeda/common/widgets/ui_common.js';
import { wxCmp, wxCmpNoCase, wxLess } from '@ziroeda/common/wx/wxstring.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_270,
  ANGLE_90,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
  type EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

/** GetKnownNetclassFieldTranslations(), "Netclass" in every shipped locale. */
export const NETCLASS_FIELD_TRANSLATIONS: readonly string[] = [
  'صنف الشبكة', // ar
  'Верига Клас', // bg
  'Classe de xarxa', // ca
  'Třídy spojů', // cs
  'Netklasse', // da, nl
  'Netzklasse', // de
  'Κλάση Δικτύου', // el
  'Clase de red', // es, es_MX
  'Ühendusniidiklass', // et
  'Verkkoluokka', // fi
  "Classe d'Equipot", // fr
  'מחלקת רשת', // he
  'नेट क्लास', // hi
  'Hálózatosztály', // hu
  'Kelas Net', // id
  'Netclass', // it, ro (same as canonical)
  'ネットクラス', // ja
  'ქსელის კლასი', // ka
  '네트 클래스', // ko
  'Grandinių klasė', // lt
  'Tīklu klase', // lv
  'Nettklasse', // no
  'Klasy sieci', // pl
  'Classes da rede', // pt_BR
  'Classe de Rede', // pt
  'Класс цепей', // ru
  'Triedy spojov', // sk
  'Razred vozlišča', // sl
  'Класа везе', // sr
  'Nätklass', // sv
  'நிகர வகுப்பு', // ta
  'నెట్ క్లాస్', // te
  'เน็ตคลาส', // th
  'Ağ Sınıfı', // tr
  "Клас зв'язків", // uk
  'Lớp mạng', // vi
  '网络类', // zh_CN
  '網路類', // zh_TW
];

/** SCH_FIELD::IsNetclassLabelFieldName. */
export function isNetclassFieldName(name: string): boolean {
  return name === 'Netclass' || NETCLASS_FIELD_TRANSLATIONS.includes(name);
}

// ---------------------------------------------------------------------------
// `SCH_FIELD` itself: the live-model class (eeschema stage E3). Everything above is the
// record model's helpers, which it leaves untouched.
//
// Not here: `Serialize`/`Deserialize`, `OnScintillaCharAdded` (the editor's autocomplete),
// `DoHypertextAction` (needs SCH_NAVIGATE_TOOL on the live frame), `Plot`,
// `GetMsgPanelInfo`, `GetMenuImage`, `SCH_FIELD_DESC`, and the outline-font render cache
// (`GetRenderCache`), which the painter supplies.
// ---------------------------------------------------------------------------

/**
 * `GetKnownNetclassFieldTranslations()` (sch_field.cpp), in full: it opens with
 * "Net Class", which `NETCLASS_FIELD_TRANSLATIONS` above (the record model's copy) is
 * missing. The record model's table is left as it is until its callers move.
 */
const KNOWN_NETCLASS_FIELD_TRANSLATIONS: readonly string[] = [
  'Net Class',
  ...NETCLASS_FIELD_TRANSLATIONS,
];

const labelTypes: readonly KICAD_T[] = [KICAD_T.SCH_LABEL_LOCATE_ANY_T];

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `wxString::Strip( wxString::both )`: leading and trailing whitespace. */
const stripBoth = (s: string): string => s.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');

/** The parts of the parent classes a field reads; they are ported with those classes. */
interface FIELD_PARENT_SYMBOL extends EDA_ITEM {
  GetNextFieldOrdinal(): number;
  GetTransform(): TRANSFORM;
  GetRef(aSheet: SCH_SHEET_PATH | null, aIncludeUnit?: boolean): string;
  SetRef(aSheet: SCH_SHEET_PATH | null, aReference: string): void;
  GetUnitCount(): number;
  SubReference(aUnit: number, aAddSeparator?: boolean): string;
  GetUnitSelection(aSheet: SCH_SHEET_PATH | null): number;
  SetFieldText(
    aFieldName: string,
    aFieldText: string,
    aPath: SCH_SHEET_PATH | null,
    aVariantName: string,
  ): void;
  GetFieldText(aFieldName: string, aPath: SCH_SHEET_PATH | null, aVariantName: string): string;
  GetVariant(
    aPath: SCH_SHEET_PATH,
    aVariantName: string,
  ): { m_Fields: Map<string, string> } | undefined;
  Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean;
}

interface FIELD_PARENT_LABEL {
  GetNextFieldOrdinal(): number;
  IsConnectivityDirty(): boolean;
  GetSchematicTextOffset(aSettings: RENDER_SETTINGS | null): VECTOR2I;
}

/** `SCH_LABEL_BASE::GetDefaultFieldName` without the import cycle: sch_label.ts registers it. */
let labelDefaultFieldName: ((aName: string, aUseDefaultName: boolean) => string) | null = null;

/** Called once by `sch_label.ts` so `SCH_FIELD::GetName` can ask it. */
export function registerLabelDefaultFieldName(
  aFn: (aName: string, aUseDefaultName: boolean) => string,
): void {
  labelDefaultFieldName = aFn;
}

// `Replace`, `Similarity`, `Compare` and the text/draw virtuals are overloaded or
// overridden across the two bases in C++; the class carries its own forms.
export interface SCH_FIELD
  extends Omit<
    EDA_TEXT,
    | 'Replace'
    | 'Similarity'
    | 'Compare'
    | 'ClearRenderCache'
    | 'GetShownText'
    | 'SetText'
    | 'GetText'
    | 'GetDrawRotation'
    | 'GetDrawFont'
    | 'getFontMetrics'
    | 'Matches'
  > {}

/**
 * Instances are attached to a symbol or sheet and provide a place for the symbol's value,
 * reference designator, footprint, , a sheet's name, filename, and user definable name-value
 * pairs of arbitrary purpose.
 *
 *  - Field 0 is reserved for the symbol reference.
 *  - Field 1 is reserved for the symbol value.
 *  - Field 2 is reserved for the symbol footprint.
 *  - Field 3 is reserved for the symbol data sheet file.
 *  - Field 4 and higher are user defineable.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/mixins.ts
export class SCH_FIELD extends SCH_ITEM {
  private m_id: FIELD_T; ///< Field id, @see enum FIELD_T
  private m_ordinal: number; ///< Sort order for non-mandatory fields
  private m_name: string;
  private m_showName: boolean; ///< Render the field name in addition to its value
  private m_allowAutoPlace: boolean; ///< This field can be autoplaced
  private m_isGeneratedField: boolean; ///< If the field name is a variable name (e.g. ${DNP})
  ///< then the value field is forced to be the same as the name
  private m_autoAdded: boolean; ///< Was this field automatically added to a LIB_SYMBOL?
  private m_showInChooser: boolean; ///< This field is available as a data column for the chooser
  private m_lastResolvedColor: Color4d;

  /**
   * `SCH_FIELD()`, `SCH_FIELD( SCH_ITEM* aParent, FIELD_T aFieldId, const wxString& aName )`,
   * or `SCH_FIELD( SCH_ITEM* aParent, SCH_TEXT* aText )` when the second argument is a text.
   */
  constructor(aParent?: SCH_ITEM | null, aFieldId?: FIELD_T | EDA_TEXT, aName = '') {
    super(null, KICAD_T.SCH_FIELD_T);
    this.initEdaText(schIUScale, '');
    this.m_id = FIELD_T.USER;
    this.m_ordinal = 0;
    this.m_name = '';
    this.m_showName = false;
    this.m_allowAutoPlace = true;
    this.m_isGeneratedField = false;
    this.m_autoAdded = false;
    this.m_showInChooser = true;
    this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };

    if (aParent === undefined) return; // SCH_FIELD(): for std::map::operator[]

    // A text mixes EDA_TEXT in, so it is not an `instanceof EDA_TEXT`: an object argument
    // is the SCH_TEXT overload.
    const fromText =
      typeof aFieldId === 'object' && aFieldId !== null
        ? (aFieldId as unknown as SCH_ITEM & EDA_TEXT)
        : null;
    const fieldId = fromText ? FIELD_T.USER : ((aFieldId as FIELD_T | undefined) ?? FIELD_T.USER);
    const name = fromText ? '' : aName;

    this.m_parent = aParent;

    if (name !== '') this.SetName(name);
    else this.SetName(GetDefaultFieldName(fieldId, DO_TRANSLATE));

    this.setId(fieldId); // will also set the layer
    this.SetVisible(true);

    if (aParent?.Schematic()) {
      const settings = aParent.Schematic()!.Settings();
      this.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });
    }

    if (fieldId === FIELD_T.USER && aParent) {
      if (
        aParent.Type() === KICAD_T.SCH_SYMBOL_T ||
        aParent.Type() === KICAD_T.LIB_SYMBOL_T ||
        aParent.Type() === KICAD_T.SCH_SHEET_T ||
        aParent.IsType(labelTypes)
      ) {
        this.m_ordinal = (aParent as unknown as FIELD_PARENT_LABEL).GetNextFieldOrdinal();
      }
    }

    if (fromText) {
      this.assignSchItem(fromText);
      this.assignEdaText(fromText);
    }
  }

  /** `SCH_FIELD( const SCH_FIELD& aField )`. */
  static copyOf(aField: SCH_FIELD): SCH_FIELD {
    const copy = new SCH_FIELD();
    SCH_ITEM.copySchItem(copy, aField);
    copy.initEdaTextFrom(aField as unknown as EDA_TEXT);

    copy.m_private = aField.m_private;
    copy.setId(aField.m_id); // will also set the layer
    copy.m_ordinal = aField.m_ordinal;
    copy.m_name = aField.m_name;
    copy.m_showName = aField.m_showName;
    copy.m_allowAutoPlace = aField.m_allowAutoPlace;
    copy.m_isGeneratedField = aField.m_isGeneratedField;
    copy.m_autoAdded = aField.m_autoAdded;
    copy.m_showInChooser = aField.m_showInChooser;
    copy.m_lastResolvedColor = { ...aField.m_lastResolvedColor };

    return copy;
  }

  /** `SCH_FIELD& operator=( const SCH_FIELD& aField )`: neither SCH_ITEM's part nor the uuid. */
  assignField(aField: SCH_FIELD): this {
    this.assignEdaText(aField as unknown as EDA_TEXT);

    this.m_private = aField.m_private;
    this.setId(aField.m_id); // will also set the layer
    this.m_ordinal = aField.m_ordinal;
    this.m_name = aField.m_name;
    this.m_showName = aField.m_showName;
    this.m_allowAutoPlace = aField.m_allowAutoPlace;
    this.m_isGeneratedField = aField.m_isGeneratedField;
    this.m_lastResolvedColor = { ...aField.m_lastResolvedColor };

    return this;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_FIELD_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_FIELD';
  }

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    if (super.IsType(aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_FIELD_LOCATE_REFERENCE_T && this.m_id === FIELD_T.REFERENCE)
        return true;
      else if (scanType === KICAD_T.SCH_FIELD_LOCATE_VALUE_T && this.m_id === FIELD_T.VALUE)
        return true;
      else if (scanType === KICAD_T.SCH_FIELD_LOCATE_FOOTPRINT_T && this.m_id === FIELD_T.FOOTPRINT)
        return true;
      else if (scanType === KICAD_T.SCH_FIELD_LOCATE_DATASHEET_T && this.m_id === FIELD_T.DATASHEET)
        return true;
    }

    return false;
  }

  override GetFriendlyName(): string {
    return 'Field';
  }

  override HasHypertext(): boolean {
    if (this.m_id === FIELD_T.INTERSHEET_REFS) return true;

    // SIM_LIBRARY::LIBRARY_FIELD
    if (this.m_name === 'Sim.Library') return true;

    return IsURL(this.GetShownText(false));
  }

  /**
   * Return the field name (not translated).
   *
   * @param aUseDefaultName When true return the default field name if the field name is
   *                        empty.  Otherwise the default field name is returned.
   * @return the name of the field.
   */
  GetName(aUseDefaultName = true): string {
    if (this.m_parent?.IsType(labelTypes) && labelDefaultFieldName)
      return labelDefaultFieldName(this.m_name, aUseDefaultName);

    if (this.IsMandatory()) return GetCanonicalFieldName(this.m_id);
    else if (this.m_name === '' && aUseDefaultName)
      return GetDefaultFieldName(this.m_id, !DO_TRANSLATE);
    else return this.m_name;
  }

  /** Get a non-language-specific name for a field which can be used for storage, variable
   *  look-up, etc. */
  GetCanonicalName(): string {
    if (this.m_parent?.IsType(labelTypes)) {
      // These should be stored in canonical format, but just in case:
      if (SCH_FIELD.IsNetclassLabelFieldName(this.m_name)) return 'Netclass';
    }

    if (this.IsMandatory()) return GetCanonicalFieldName(this.m_id);

    return this.m_name;
  }

  /**
   * True if the name is the canonical "Netclass" or one of its known translations
   * (`GetKnownNetclassFieldTranslations()`).
   */
  static IsNetclassLabelFieldName(aName: string): boolean {
    if (aName === 'Netclass') return true;

    return KNOWN_NETCLASS_FIELD_TRANSLATIONS.includes(aName);
  }

  SetName(aName: string): void {
    this.m_name = aName;
    this.m_isGeneratedField = IsGeneratedField(aName);

    if (this.m_isGeneratedField) EDA_TEXT.prototype.SetText.call(this, aName);
  }

  /**
   * `SetText( const wxString& )`, or `SetText( aText, aPath, aVariantName )` which sets the
   * text for one sheet instance (and variant) on a symbol or sheet parent.
   */
  SetText(aText: string, aPath?: SCH_SHEET_PATH | null, aVariantName = ''): void {
    if (aPath !== undefined) {
      if (!this.m_parent) return; // wxCHECK

      // Generated fields (e.g. ${DNP}) can't have their value changed
      if (this.m_isGeneratedField) return;

      switch (this.m_parent.Type()) {
        case KICAD_T.SCH_SYMBOL_T:
        case KICAD_T.SCH_SHEET_T:
          (this.m_parent as unknown as FIELD_PARENT_SYMBOL).SetFieldText(
            this.GetName(),
            aText,
            aPath,
            aVariantName,
          );
          break;

        default:
          this.SetText(aText);
          break;
      }

      return;
    }

    // Don't allow modification of text value of generated fields.
    if (this.m_isGeneratedField) return;

    // Mandatory fields should not have leading or trailing whitespace.
    if (this.IsMandatory()) EDA_TEXT.prototype.SetText.call(this, stripBoth(aText));
    else EDA_TEXT.prototype.SetText.call(this, aText);
  }

  /** `GetText()`, or `GetText( aPath, aVariantName )` for one sheet instance and variant. */
  GetText(aPath?: SCH_SHEET_PATH | null, aVariantName = ''): string {
    if (aPath === undefined) return EDA_TEXT.prototype.GetText.call(this);

    if (!(aPath && this.m_parent)) return ''; // wxCHECK

    switch (this.m_parent.Type()) {
      case KICAD_T.SCH_SYMBOL_T:
      case KICAD_T.SCH_SHEET_T:
        return (this.m_parent as unknown as FIELD_PARENT_SYMBOL).GetFieldText(
          this.GetName(),
          aPath,
          aVariantName,
        );

      default:
        return this.GetText();
    }
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

  /** Get the fields name as displayed on the schematic or in the symbol fields table. */
  GetShownName(): string {
    return this.m_isGeneratedField ? GetGeneratedFieldDisplayName(this.GetName()) : this.GetName();
  }

  /**
   * `GetShownText( const SCH_SHEET_PATH* aPath, bool aAllowExtraText, int aDepth,
   * const wxString& aVariantName )`, or `GetShownText( bool aAllowExtraText, int aDepth )`
   * which asks for the schematic's current sheet and variant.
   */
  GetShownText(aAllowExtraText: boolean, aDepth?: number): string;
  GetShownText(
    aPath: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    aDepth?: number,
    aVariantName?: string,
  ): string;
  GetShownText(
    a: SCH_SHEET_PATH | null | boolean,
    b?: boolean | number,
    c?: number,
    d?: string,
  ): string {
    if (typeof a === 'boolean') {
      const aAllowExtraText = a;
      const aDepth = (b as number | undefined) ?? 0;
      const schematic = this.Schematic();

      if (schematic) {
        const currentSheet = schematic.CurrentSheet();
        const variantName = schematic.GetCurrentVariant();

        return this.GetShownText(currentSheet, aAllowExtraText, aDepth, variantName);
      }

      return this.GetShownText(null, aAllowExtraText, aDepth);
    }

    const aPath = a;
    const aAllowExtraText = b as boolean;
    const aDepth = c ?? 0;
    const aVariantName = d ?? '';

    let text = this.getUnescapedText(aPath, aVariantName);

    if (this.IsNameShown() && aAllowExtraText) text = `${this.GetShownName()}: ${text}`;

    if (this.HasTextVars()) text = this.ResolveText(text, aPath, aDepth);

    if (this.m_id === FIELD_T.SHEET_FILENAME && aAllowExtraText && !this.IsNameShown())
      text = `File: ${text}`;

    // Convert escape markers back to literal ${} and @{} for final display
    text = text.replaceAll('<<<ESC_DOLLAR:', '${');
    text = text.replaceAll('<<<ESC_AT:', '@{');

    return text;
  }

  /**
   * Return the text of a field.
   *
   * If the field is the reference field, the unit number is used to create a pseudo reference
   * text.  If the base reference field is U, the string returned is U?A for the first unit.
   */
  GetFullText(unit = 1): string {
    if (this.GetId() !== FIELD_T.REFERENCE) return this.GetText();

    let text = `${this.GetText()}?`;

    const symbol = this.GetParentSymbol();

    if (symbol?.IsMultiUnit()) text += symbol.GetUnitDisplayName(unit, false);

    return text;
  }

  /** Return true if both the name and value of the field are empty.  Whitespace does not
   *  count as non-empty. */
  IsEmpty(): boolean {
    return stripBoth(this.m_name) === '' && stripBoth(this.GetText()) === '';
  }

  GetSchTextSize(): number {
    return this.GetTextWidth();
  }
  SetSchTextSize(aSize: number): void {
    this.SetTextSize({ x: aSize, y: aSize });
  }

  GetFieldColor(): Color4d {
    if (!color4dEquals(this.GetTextColor(), COLOR4D_UNSPECIFIED)) {
      this.m_lastResolvedColor = { ...this.GetTextColor() };
    } else {
      // The net class colour of a parent label (when its connectivity is clean) is pending
      // the connection graph (E3 part 2); the text colour stands in as KiCad's else-branch.
      this.m_lastResolvedColor = { ...this.GetTextColor() };
    }

    return this.m_lastResolvedColor;
  }

  override SetLastResolvedState(aItem: SCH_ITEM): void {
    if (aItem instanceof SCH_FIELD) this.m_lastResolvedColor = { ...aItem.m_lastResolvedColor };
  }

  override ViewGetLayers(): number[] {
    return [this.GetDefaultLayer(), SCH_LAYER_ID.LAYER_SELECTION_SHADOWS];
  }

  GetDefaultLayer(): SCH_LAYER_ID {
    if (this.m_parent && this.m_parent.Type() === KICAD_T.SCH_LABEL_T) {
      if (this.GetCanonicalName() === 'Netclass' || this.GetCanonicalName() === 'Component Class') {
        return SCH_LAYER_ID.LAYER_NETCLASS_REFS;
      }
    }

    switch (this.m_id) {
      case FIELD_T.REFERENCE:
        return SCH_LAYER_ID.LAYER_REFERENCEPART;
      case FIELD_T.VALUE:
        return SCH_LAYER_ID.LAYER_VALUEPART;
      case FIELD_T.SHEET_NAME:
        return SCH_LAYER_ID.LAYER_SHEETNAME;
      case FIELD_T.SHEET_FILENAME:
        return SCH_LAYER_ID.LAYER_SHEETFILENAME;
      case FIELD_T.SHEET_USER:
        return SCH_LAYER_ID.LAYER_SHEETFIELDS;
      case FIELD_T.INTERSHEET_REFS:
        return SCH_LAYER_ID.LAYER_INTERSHEET_REFS;
      default:
        return SCH_LAYER_ID.LAYER_FIELDS;
    }
  }

  /** Adjusters to allow EDA_TEXT to draw/print/etc. text in absolute coords. */
  GetDrawRotation(): EDA_ANGLE {
    let orient = this.GetTextAngle();

    if (this.m_parent && this.m_parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      const parentSymbol = this.m_parent as unknown as FIELD_PARENT_SYMBOL;

      if (parentSymbol?.GetTransform().y1) {
        // Rotate symbol 90 degrees.
        if (orient.IsHorizontal()) orient = ANGLE_VERTICAL;
        else orient = ANGLE_HORIZONTAL;
      }
    }

    return orient;
  }

  GetDrawFont(aSettings: RENDER_SETTINGS | null): FONT {
    let font = EDA_TEXT.prototype.GetFont.call(this);

    if (!font) font = FONT.GetFont(this.GetDefaultFont(aSettings), this.IsBold(), this.IsItalic());

    return font;
  }

  override GetBoundingBox(): BOX2I {
    // Calculate the text bounding box:
    const bbox = this.GetTextBox(null).Clone();

    // Calculate the bounding box position relative to the parent:
    const origin = this.GetParentPosition();
    const pos = { x: this.GetTextPos().x - origin.x, y: this.GetTextPos().y - origin.y };
    let begin = { x: bbox.GetOrigin().x - origin.x, y: bbox.GetOrigin().y - origin.y };
    let end = { x: bbox.GetEnd().x - origin.x, y: bbox.GetEnd().y - origin.y };
    begin = RotatePoint(begin, pos, this.GetTextAngle());
    end = RotatePoint(end, pos, this.GetTextAngle());

    // Now, apply the symbol transform (mirror/rot)
    let transform = new TRANSFORM();

    if (this.m_parent && this.m_parent.Type() === KICAD_T.SCH_SYMBOL_T)
      transform = (this.m_parent as unknown as FIELD_PARENT_SYMBOL).GetTransform();

    bbox.SetOrigin(transform.TransformCoordinate(begin));
    bbox.SetEnd(transform.TransformCoordinate(end));

    bbox.Move(origin);
    bbox.Normalize();

    return bbox;
  }

  /**
   * Return whether the field will be rendered with the horizontal justification
   * inverted due to rotation or mirroring of the parent.
   */
  IsHorizJustifyFlipped(): boolean {
    const render_center = this.GetBoundingBox().Centre();
    const pos = this.GetPosition();

    switch (this.GetHorizJustify()) {
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
        if (this.GetDrawRotation().IsVertical()) return render_center.y > pos.y;
        else return render_center.x < pos.x;

      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
        if (this.GetDrawRotation().IsVertical()) return render_center.y < pos.y;
        else return render_center.x > pos.x;

      default:
        return false;
    }
  }

  IsVertJustifyFlipped(): boolean {
    const render_center = this.GetBoundingBox().Centre();
    const pos = this.GetPosition();

    switch (this.GetVertJustify()) {
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
        if (this.GetDrawRotation().IsVertical()) return render_center.x < pos.x;
        else return render_center.y < pos.y;

      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
        if (this.GetDrawRotation().IsVertical()) return render_center.x > pos.x;
        else return render_center.y > pos.y;

      default:
        return false;
    }
  }

  GetEffectiveHorizJustify(): GR_TEXT_H_ALIGN_T {
    switch (this.GetHorizJustify()) {
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
        return this.IsHorizJustifyFlipped()
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
        return this.IsHorizJustifyFlipped()
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
      default:
        return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
    }
  }

  GetEffectiveVertJustify(): GR_TEXT_V_ALIGN_T {
    switch (this.GetVertJustify()) {
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
        return this.IsVertJustifyFlipped()
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
        return this.IsVertJustifyFlipped()
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
      default:
        return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
    }
  }

  SetEffectiveHorizJustify(aJustify: GR_TEXT_H_ALIGN_T): void {
    let actualJustify: GR_TEXT_H_ALIGN_T;

    switch (aJustify) {
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
        actualJustify = this.IsHorizJustifyFlipped()
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
        break;
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
        actualJustify = this.IsHorizJustifyFlipped()
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
        break;
      default:
        actualJustify = aJustify;
    }

    this.SetHorizJustify(actualJustify);
  }

  SetEffectiveVertJustify(aJustify: GR_TEXT_V_ALIGN_T): void {
    let actualJustify: GR_TEXT_V_ALIGN_T;

    switch (aJustify) {
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
        actualJustify = this.IsVertJustifyFlipped()
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
        break;
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
        actualJustify = this.IsVertJustifyFlipped()
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
        break;
      default:
        actualJustify = aJustify;
    }

    this.SetVertJustify(actualJustify);
  }

  IsNameShown(): boolean {
    return this.m_showName;
  }
  SetNameShown(aShown = true): void {
    this.m_showName = aShown;
  }

  IsGeneratedField(): boolean {
    return this.m_isGeneratedField;
  }

  CanAutoplace(): boolean {
    return this.m_allowAutoPlace;
  }
  SetCanAutoplace(aCanPlace: boolean): void {
    this.m_allowAutoPlace = aCanPlace;
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (!(aItem && aItem.Type() === KICAD_T.SCH_FIELD_T)) return; // wxCHECK_RET

    const item = aItem as SCH_FIELD;

    [this.m_showName, item.m_showName] = [item.m_showName, this.m_showName];
    [this.m_allowAutoPlace, item.m_allowAutoPlace] = [item.m_allowAutoPlace, this.m_allowAutoPlace];
    [this.m_isGeneratedField, item.m_isGeneratedField] = [
      item.m_isGeneratedField,
      this.m_isGeneratedField,
    ];
    this.SwapText(item as unknown as EDA_TEXT);
    this.SwapAttributes(item as unknown as EDA_TEXT);

    [this.m_lastResolvedColor, item.m_lastResolvedColor] = [
      item.m_lastResolvedColor,
      this.m_lastResolvedColor,
    ];
  }

  override GetPenWidth(): number {
    return this.GetEffectiveTextPenWidth();
  }

  IsAutoAdded(): boolean {
    return this.m_autoAdded;
  }
  SetAutoAdded(aAutoAdded: boolean): void {
    this.m_autoAdded = aAutoAdded;
  }

  ShowInChooser(): boolean {
    return this.m_showInChooser;
  }
  SetShowInChooser(aShow = true): void {
    this.m_showInChooser = aShow;
  }

  override ClearCaches(): void {
    this.ClearRenderCache();
    EDA_TEXT.prototype.ClearBoundingBoxCache.call(this);
  }

  ClearRenderCache(): void {
    EDA_TEXT.prototype.ClearRenderCache.call(this);
  }

  /**
   * Copy parameters from a SCH_FIELD source.
   *
   * Pointers and specific values (position) are not copied.
   */
  ImportValues(aSource: SCH_FIELD): void {
    this.SetAttributes(aSource as unknown as EDA_TEXT);
    this.SetVisible(aSource.IsVisible());
    this.SetNameShown(aSource.IsNameShown());
    this.SetCanAutoplace(aSource.CanAutoplace());
  }

  /** Copy parameters of this field to another field. Pointers are not copied. */
  Copy(aTarget: SCH_FIELD): void {
    aTarget.assignField(this);
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.Offset(aMoveVector);
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    const horizJustify = this.GetHorizJustify();

    if (this.GetTextAngle().IsVertical()) {
      switch (horizJustify) {
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
          if (aRotateCCW) this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
          if (aRotateCCW) this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
          break;
        default:
          break;
      }

      this.SetTextAngle(ANGLE_HORIZONTAL);
    } else if (this.GetTextAngle().IsHorizontal()) {
      switch (horizJustify) {
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
          if (!aRotateCCW) this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
          if (!aRotateCCW) this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
          break;
        default:
          break;
      }

      this.SetTextAngle(ANGLE_VERTICAL);
    } else {
      // wxFAIL_MSG( "SCH_FIELD text angle is not horizontal or vertical" )
    }

    const pt = RotatePoint(this.GetPosition(), aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
    this.SetPosition(pt);
  }

  override MirrorVertically(aCenter: number): void {
    let y = this.GetTextPos().y;

    y -= aCenter;
    y *= -1;
    y += aCenter;

    this.SetTextY(y);
  }

  override MirrorHorizontally(aCenter: number): void {
    let x = this.GetTextPos().x;

    x -= aCenter;
    x *= -1;
    x += aCenter;

    this.SetTextX(x);
  }

  override BeginEdit(aPosition: VECTOR2I): void {
    this.SetTextPos(aPosition);
  }

  override CalcEdit(aPosition: VECTOR2I): void {
    this.SetTextPos(aPosition);
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    const searchHiddenFields = aSearchData.searchAllFields;
    const searchAndReplace = aSearchData.searchAndReplace;
    const replaceReferences =
      aSearchData instanceof SCH_SEARCH_DATA ? aSearchData.replaceReferences : false;

    let text = unescapeString(this.GetText());

    if (!this.IsVisible() && !searchHiddenFields) return false;

    if (this.m_id === FIELD_T.REFERENCE) {
      if (searchAndReplace && !replaceReferences) return false;

      if (!(this.m_parent && this.m_parent.Type() === KICAD_T.SCH_SYMBOL_T)) return false;

      const parentSymbol = this.m_parent as unknown as FIELD_PARENT_SYMBOL;

      if (aSearchData.searchMetadata && parentSymbol.Matches(aSearchData, aAuxData)) return true;

      if (aAuxData) {
        const sheet = aAuxData as SCH_SHEET_PATH;

        text = parentSymbol.GetRef(sheet);

        if (this.matchesText(text, aSearchData)) return true;

        if (parentSymbol.GetUnitCount() > 1)
          text += parentSymbol.SubReference(parentSymbol.GetUnitSelection(sheet));
      }
    }

    return this.matchesText(text, aSearchData);
  }

  override IsReplaceable(): boolean {
    if (this.m_id === FIELD_T.SHEET_FILENAME || this.m_id === FIELD_T.INTERSHEET_REFS) return false;

    return true;
  }

  override Replace(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown = null): boolean {
    const replaceReferences =
      aSearchData instanceof SCH_SEARCH_DATA ? aSearchData.replaceReferences : false;

    let isReplaced = false;

    if (
      this.m_id === FIELD_T.REFERENCE &&
      this.m_parent &&
      this.m_parent.Type() === KICAD_T.SCH_SYMBOL_T
    ) {
      const parentSymbol = this.m_parent as unknown as FIELD_PARENT_SYMBOL;

      if (!replaceReferences) return false;

      if (!aAuxData) return false; // wxCHECK_MSG: "Need sheetpath to replace in refdes."

      const text = { value: parentSymbol.GetRef(aAuxData as SCH_SHEET_PATH) };
      isReplaced = EDA_ITEM_CLASS.Replace(aSearchData, text);

      if (isReplaced) parentSymbol.SetRef(aAuxData as SCH_SHEET_PATH, text.value);
    } else {
      isReplaced = EDA_TEXT.prototype.Replace.call(this, aSearchData);

      if (this.m_id === FIELD_T.SHEET_FILENAME && isReplaced) {
        // If we allowed this we'd have a bunch of work to do here, including warning
        // about it not being undoable, checking for recursive hierarchies, reloading
        // sheets, etc.  See DIALOG_SHEET_PROPERTIES::TransferDataFromWindow().
      }
    }

    return isReplaced;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    const content = aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText());

    if (content === '') return `Field ${unescapeString(this.GetName())} (empty)`;
    else return `Field ${unescapeString(this.GetName())} '${content}'`;
  }

  GetLibPosition(): VECTOR2I {
    return EDA_TEXT.prototype.GetTextPos.call(this);
  }

  override GetPosition(): VECTOR2I {
    if (this.m_parent && this.m_parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      const parentSymbol = this.m_parent as unknown as FIELD_PARENT_SYMBOL;
      const parentPos = parentSymbol.GetPosition();
      let relativePos = {
        x: this.GetTextPos().x - parentPos.x,
        y: this.GetTextPos().y - parentPos.y,
      };

      relativePos = parentSymbol.GetTransform().TransformCoordinate(relativePos);

      return { x: relativePos.x + parentPos.x, y: relativePos.y + parentPos.y };
    }

    return this.GetTextPos();
  }

  override SetPosition(aPosition: VECTOR2I): void {
    // Actual positions are calculated by the rotation/mirror transform of the parent symbol
    // of the field.  The inverse transform is used to calculate the position relative to the
    // parent symbol.
    if (this.m_parent && this.m_parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      const parentSymbol = this.m_parent as unknown as FIELD_PARENT_SYMBOL;
      const parentPos = parentSymbol.GetPosition();
      let relPos = { x: aPosition.x - parentPos.x, y: aPosition.y - parentPos.y };

      relPos = parentSymbol.GetTransform().InverseTransform().TransformCoordinate(relPos);

      this.SetTextPos({ x: relPos.x + parentPos.x, y: relPos.y + parentPos.y });
      return;
    }

    this.SetTextPos(aPosition);
  }

  GetParentPosition(): VECTOR2I {
    return this.m_parent ? this.m_parent.GetPosition() : { x: 0, y: 0 };
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    // Do not hit test hidden or empty fields.
    if (this.GetShownText(true) === '') return false;

    const globalLabelOffset = (): VECTOR2I | null => {
      if (this.GetParent() && this.GetParent()!.Type() === KICAD_T.SCH_GLOBAL_LABEL_T)
        return (this.GetParent() as unknown as FIELD_PARENT_LABEL).GetSchematicTextOffset(null);

      return null;
    };

    if (a instanceof BOX2I) {
      if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

      const rect = new BOX2I(a.GetPosition(), a.GetSize());
      rect.Inflate(c ?? 0);

      const offset = globalLabelOffset();

      if (offset) rect.Offset(offset);

      if (b as boolean) return rect.Contains(this.GetBoundingBox());

      return rect.Intersects(this.GetBoundingBox());
    }

    if ('x' in a && 'y' in a) {
      let rect = this.GetBoundingBox();

      // Account for the '?' and unit letter of a library symbol's reference.
      if (this.m_parent && this.m_parent.Type() === KICAD_T.LIB_SYMBOL_T) {
        const temp = SCH_FIELD.copyOf(this);
        temp.SetText(this.GetFullText());
        rect = temp.GetBoundingBox();
      }

      rect.Inflate((b as number | undefined) ?? 0);

      const offset = globalLabelOffset();

      if (offset) rect.Offset(offset);

      return rect.Contains(a);
    }

    if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

    const bbox = this.GetBoundingBox();
    const offset = globalLabelOffset();

    if (offset) bbox.Offset(offset);

    return KIGEOM_BoxHitTestChain(a, bbox, b as boolean);
  }

  override Clone(): SCH_FIELD {
    return SCH_FIELD.copyOf(this);
  }

  IsMandatory(): boolean {
    return (
      this.m_id === FIELD_T.REFERENCE ||
      this.m_id === FIELD_T.VALUE ||
      this.m_id === FIELD_T.FOOTPRINT ||
      this.m_id === FIELD_T.DATASHEET ||
      this.m_id === FIELD_T.DESCRIPTION ||
      this.m_id === FIELD_T.SHEET_NAME ||
      this.m_id === FIELD_T.SHEET_FILENAME ||
      this.m_id === FIELD_T.INTERSHEET_REFS
    );
  }

  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const field = aItem as SCH_FIELD;

    if (this.GetId() !== field.GetId()) return this.GetId() < field.GetId();

    if (this.GetText() !== field.GetText()) return wxLess(this.GetText(), field.GetText());

    if (this.GetLibPosition().x !== field.GetLibPosition().x)
      return this.GetLibPosition().x < field.GetLibPosition().x;

    if (this.GetLibPosition().y !== field.GetLibPosition().y)
      return this.GetLibPosition().y < field.GetLibPosition().y;

    return wxLess(this.GetName(), field.GetName());
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.Type() !== aOther.Type()) return 0.0;

    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    const field = aOther as SCH_FIELD;

    let similarity = 0.99; // The UUIDs are different, so we start with non-identity

    if (this.GetId() !== field.GetId()) {
      // We don't allow swapping of mandatory fields, so these cannot be the same item
      if (this.IsMandatory() || field.IsMandatory()) return 0.0;
      else similarity *= 0.5;
    }

    similarity *= this.SimilarityBase(aOther);

    similarity *= EDA_TEXT.prototype.Similarity.call(this, field as unknown as EDA_TEXT);

    if (!samePt(this.GetPosition(), field.GetPosition())) similarity *= 0.5;

    if (this.IsGeneratedField() !== field.IsGeneratedField()) similarity *= 0.5;

    if (this.IsNameShown() !== field.IsNameShown()) similarity *= 0.5;

    if (this.CanAutoplace() !== field.CanAutoplace()) similarity *= 0.5;

    return similarity;
  }

  /** `operator==( const SCH_ITEM& )` and `operator==( const SCH_FIELD& )`. */
  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const other = aOther as SCH_FIELD;

    // Identical fields of different symbols are not equal.
    if (
      !this.GetParentSymbol() ||
      !other.GetParentSymbol() ||
      this.GetParentSymbol()!.m_Uuid !== other.GetParentSymbol()!.m_Uuid
    ) {
      return false;
    }

    if (this.IsMandatory() !== other.IsMandatory()) return false;

    if (this.IsMandatory()) {
      if (this.GetId() !== other.GetId()) return false;
    } else {
      if (this.GetOrdinal() !== other.GetOrdinal()) return false;
    }

    if (!samePt(this.GetPosition(), other.GetPosition())) return false;

    if (this.IsGeneratedField() !== other.IsGeneratedField()) return false;

    if (this.IsNameShown() !== other.IsNameShown()) return false;

    if (this.CanAutoplace() !== other.CanAutoplace()) return false;

    return this.equalsEdaText(other as unknown as EDA_TEXT);
  }

  /**
   * Compare the content of this field to another field, ignoring the parent symbol, the
   * field id and the ordinal.
   */
  HasSameContent(aOther: SCH_FIELD): boolean {
    if (this.GetCanonicalName() !== aOther.GetCanonicalName()) return false;

    if (!samePt(this.GetPosition(), aOther.GetPosition())) return false;

    if (this.IsVisible() !== aOther.IsVisible()) return false;

    if (this.IsPrivate() !== aOther.IsPrivate()) return false;

    if (this.IsGeneratedField() !== aOther.IsGeneratedField()) return false;

    if (this.IsNameShown() !== aOther.IsNameShown()) return false;

    if (this.CanAutoplace() !== aOther.CanAutoplace()) return false;

    return this.equalsEdaText(aOther as unknown as EDA_TEXT);
  }

  getFontMetrics(): METRICS {
    return this.GetFontMetrics();
  }

  override compare(aOther: SCH_ITEM, aCompareFlags = 0): number {
    let compareFlags = aCompareFlags;

    // For ERC tests, the field position has no matter, so do not test it
    if (aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC)
      compareFlags |= SCH_ITEM.COMPARE_FLAGS.SKIP_TST_POS;

    let retv = super.compare(aOther, compareFlags);

    if (retv) return retv;

    const tmp = aOther as SCH_FIELD;

    // Equality test will vary depending whether or not the field is mandatory.  Otherwise,
    // sorting is done by ordinal.
    if (aCompareFlags & SCH_ITEM.COMPARE_FLAGS.EQUALITY) {
      // Mandatory fields have fixed ordinals and their names can vary due to translated field
      // names.  Optional fields have fixed names and their ordinals can vary.
      if (this.IsMandatory()) {
        if (this.m_id !== tmp.m_id) return (this.m_id as number) - (tmp.m_id as number);
      } else {
        retv = wxCmp(this.m_name, tmp.m_name);

        if (retv) return retv;
      }
    } // assume we're sorting
    else {
      if (this.m_id !== tmp.m_id) return (this.m_id as number) - (tmp.m_id as number);
    }

    let ignoreFieldText = false;

    if (this.m_id === FIELD_T.REFERENCE && !(aCompareFlags & SCH_ITEM.COMPARE_FLAGS.EQUALITY))
      ignoreFieldText = true;

    if (this.m_id === FIELD_T.VALUE && aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC)
      ignoreFieldText = true;

    if (!ignoreFieldText) {
      retv = wxCmpNoCase(this.GetText(), tmp.GetText());

      if (retv !== 0) return retv;
    }

    if (aCompareFlags & SCH_ITEM.COMPARE_FLAGS.EQUALITY) {
      if (this.GetTextPos().x !== tmp.GetTextPos().x)
        return this.GetTextPos().x - tmp.GetTextPos().x;

      if (this.GetTextPos().y !== tmp.GetTextPos().y)
        return this.GetTextPos().y - tmp.GetTextPos().y;
    }

    // For ERC tests, the field size has no matter, so do not test it
    if (!(aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC)) {
      if (this.GetTextWidth() !== tmp.GetTextWidth())
        return this.GetTextWidth() - tmp.GetTextWidth();

      if (this.GetTextHeight() !== tmp.GetTextHeight())
        return this.GetTextHeight() - tmp.GetTextHeight();
    }

    return 0;
  }

  /** `setId`: will also set the layer. The parser calls this (a friend in C++). */
  setId(aId: FIELD_T): void {
    this.m_id = aId;
    this.SetLayer(this.GetDefaultLayer());
  }

  protected getUnescapedText(aPath: SCH_SHEET_PATH | null = null, aVariantName = ''): string {
    // This is the default variant field text for all fields except the reference field.
    let retv = EDA_TEXT.prototype.GetShownText.call(this, false);

    // Special handling for parent object field instance and variant information.
    if (this.m_parent && aPath && !aPath.empty()) {
      switch (this.m_parent.Type()) {
        case KICAD_T.SCH_SYMBOL_T: {
          const symbol = this.m_parent as unknown as FIELD_PARENT_SYMBOL;

          if (this.m_id === FIELD_T.REFERENCE) {
            retv = symbol.GetRef(aPath, true);
          } else if (aVariantName !== '') {
            const variant = symbol.GetVariant(aPath, aVariantName);

            if (variant?.m_Fields.has(this.GetName())) retv = variant.m_Fields.get(this.GetName())!;
          }

          break;
        }

        case KICAD_T.SCH_SHEET_T:
          break;

        default:
          break;
      }
    }

    return retv;
  }
}

applyMixins(SCH_FIELD, [EDA_TEXT]);

/** `NextFieldOrdinal`: one past the highest ordinal in use, and never below 42. */
export function NextFieldOrdinal(aFields: readonly SCH_FIELD[]): number {
  let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T id

  for (const field of aFields) ordinal = Math.max(ordinal, field.GetOrdinal() + 1);

  return ordinal;
}

/** `FindField( aFields, FIELD_T )` or `FindField( aFields, const wxString& aFieldName )`. */
export function FindField(
  aFields: readonly SCH_FIELD[],
  aField: FIELD_T | string,
): SCH_FIELD | null {
  for (const field of aFields) {
    if (typeof aField === 'string' ? field.GetName() === aField : field.GetId() === aField)
      return field;
  }

  return null;
}

/** `GetFieldValue( const std::vector<SCH_FIELD>*, FIELD_T )`. */
export function GetFieldValue(aFields: readonly SCH_FIELD[] | null, aFieldType: FIELD_T): string;
/** `GetFieldValue( const std::vector<SCH_FIELD>*, aFieldName, aResolve, aDepth )`. */
export function GetFieldValue(
  aFields: readonly SCH_FIELD[] | null,
  aFieldName: string,
  aResolve: boolean,
  aDepth: number,
): string;
export function GetFieldValue(
  aFields: readonly SCH_FIELD[] | null,
  aField: FIELD_T | string,
  aResolve = false,
  aDepth = 0,
): string {
  if (!aFields) return '';

  const field = FindField(aFields, aField);

  if (!field) return '';

  if (typeof aField === 'string' && aResolve) return field.GetShownText(false, aDepth);

  return field.GetText();
}

/** `SetFieldValue`: set, add or (for an empty value) remove the named field. */
export function SetFieldValue(
  aFields: SCH_FIELD[],
  aFieldName: string,
  aValue: string,
  aIsVisible = true,
  aSheetPath: SCH_SHEET_PATH | null = null,
  aVariantName = '',
): void {
  if (!aSheetPath || aVariantName === '') {
    if (aValue === '') {
      for (let i = aFields.length - 1; i >= 0; i--) {
        if (aFields[i]!.GetName() === aFieldName) aFields.splice(i, 1);
      }

      return;
    }

    const field = FindField(aFields, aFieldName);

    if (field) {
      field.SetText(aValue);
      return;
    }

    const parent = aFields[0]!.GetParent() as SCH_ITEM;
    const added = new SCH_FIELD(parent, FIELD_T.USER, aFieldName);
    aFields.push(added);
    added.SetText(aValue);
    added.SetVisible(aIsVisible);
    return;
  }

  const field = FindField(aFields, aFieldName);

  if (field) {
    field.SetText(aValue, aSheetPath, aVariantName);
    return;
  }

  const parent = aFields[0]!.GetParent() as SCH_ITEM;
  const added = new SCH_FIELD(parent, FIELD_T.USER, aFieldName);
  aFields.push(added);
  added.SetText(aValue);
  added.SetVisible(aIsVisible);
}
