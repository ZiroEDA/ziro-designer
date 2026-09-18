// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eda_text.h` / `common/eda_text.cpp`: `EDA_TEXT`, the mix-in that handles
 * texts such as labels, parts, components, or footprints.
 *
 * A mix-in here as well: `class PCB_TEXT extends BOARD_ITEM` plus
 * `applyMixins( PCB_TEXT, [ EDA_TEXT ] )`, with the derived constructor
 * calling `initEdaText( aIuScale, aText )`. It is also instantiable on its
 * own, as the C++ one is (`EDA_TEXT text( unityScale )` in the qa suite).
 *
 * Not here: `Serialize`/`Deserialize` (the protobuf API), `Print` /
 * `printOneLineOfText` (a wxDC printing path), and the `PROPERTY_MANAGER`
 * registration (`EDA_TEXT_DESC`), which the properties panels carry.
 *
 * The C++ `protected`/`private` members are public here: the mix-in reaches
 * its host through declaration merging (`interface PCB_X extends Omit<EDA_TEXT,
 * …>`), and a mapped type carries only public members.
 */

import { IsEeschemaType, KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ANGLE_0, EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { GetRotated, RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { CALLBACK_GAL } from './callback_gal.js';
import { type Color4d, COLOR4D_UNSPECIFIED } from './color4d.js';
import { CTL_OMIT_COLOR, CTL_OMIT_HYPERLINK } from './ctl_flags.js';
import type { EDA_SEARCH_DATA } from './eda_search_data.js';
import { EDA_ITEM } from './eda_item.js';
import { type EdaIuScale, FormatInternalUnits, unityScale } from './eda_units.js';
import { FONT, ITALIC_TILT, KICAD_FONT_NAME, type OutStr } from './font/font.js';
import { METRICS } from './font/font_metrics.js';
import { type GLYPH_LIKE, OUTLINE_GLYPH, STROKE_GLYPH } from './font/glyph.js';
import type { OUTLINE_FONT } from './font/outline_font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T, TEXT_ATTRIBUTES } from './font/text_attributes.js';
import { ClampTextPenSize, GetPenSizeForBold, GetPenSizeForNormal } from './gr_text.js';
import { FormatBool } from './io/kicad/kicad_io_utils.js';
import { MARKUP_PARSER, type NODE } from './markup_parser.js';
import type { RENDER_SETTINGS } from './render_settings.js';
import type { OUTPUTFORMATTER } from './richio.js';
import { FormatDouble2Str, unescapeString, wxStringSplit } from './string_utils.js';
import { EXPRESSION_EVALUATOR } from './text_eval/text_eval_wrapper.js';
// `font.cpp` includes `stroke_font.h` and `outline_font.h` and constructs them itself. The ESM
// form of that is these side-effect imports: each registers its loader on `FONT`, so a text
// item can resolve its font the moment this module is loaded.
import './font/stroke_font.js';
import './font/outline_font.js';
import { BUNDLED_FONTS } from './font/fontconfig.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_STRING,
} from './properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from './properties/property_mgr.js';

// `eda_text.h` includes `font/text_attributes.h`; an importer of this module sees the enums too.
export { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from './font/text_attributes.js';

export interface EDA_TEXT_RENDER_CACHE_DATA {
  text: string;
  font: FONT | null;
  angle: EDA_ANGLE;
  offset: VECTOR2I;
  mirrored: boolean;
  glyphs: GLYPH_LIKE[];
}

// These are only here for algorithmic safety, not to tell the user what to do.
// PL_EDITOR has the least resolution (its internal units are microns), so the min size is chosen
// to yield 1 in PL_EDITOR.
// The max size chosen is somewhat arbitrary, but no one has complained yet.
export const TEXT_MIN_SIZE_MM = 0.001; ///< Minimum text size (1 micron).
export const TEXT_MAX_SIZE_MM = 250.0; ///< Maximum text size in mm (~10 inches)

/**
 * This is the "default-of-the-default" hardcoded text size; individual application define their
 * own default policy starting with this (usually with a user option or project).
 */
export const DEFAULT_SIZE_TEXT = 50; // default text height (in mils, i.e. 1/1000")

interface BBOX_CACHE_ENTRY {
  m_pos: VECTOR2I;
  m_bbox: BOX2I;
}

/** `std::clamp`. */
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function recursiveDescent(aNode: NODE): boolean {
  if (aNode.isURL()) return true;

  for (const child of aNode.children) {
    if (recursiveDescent(child)) return true;
  }

  return false;
}

/**
 * A mix-in class (via multiple inheritance) that handles texts such as labels, parts,
 * components, or footprints.  Because it's a mix-in class, care is used to provide
 * function names (accessors) that to not collide with function names likely to be seen
 * in the combined derived classes.
 */
export class EDA_TEXT {
  /**
   * `dynamic_cast<EDA_TEXT*>( x )`: EDA_TEXT is a mixin here, so `instanceof`
   * asks for its state rather than its prototype.
   */
  static [Symbol.hasInstance](aObject: unknown): boolean {
    return (
      typeof aObject === 'object' &&
      aObject !== null &&
      'm_text' in aObject &&
      'm_attributes' in aObject &&
      typeof (aObject as EDA_TEXT).GetTextAngle === 'function'
    );
  }

  /**
   * A hyperlink URL.  If empty, this text object is not a hyperlink.
   */
  m_hyperlink!: string;

  m_activeUrl!: string;

  m_text!: string;
  m_shown_text!: string; // Cache of unescaped text for efficient access
  m_shown_text_has_text_var_refs!: boolean;

  m_IuScale!: EdaIuScale;

  m_render_cache!: EDA_TEXT_RENDER_CACHE_DATA | null;

  m_bbox_cache!: Map<number, BBOX_CACHE_ENTRY>;

  m_attributes!: TEXT_ATTRIBUTES;
  m_unresolvedFontName!: string;
  m_pos!: VECTOR2I;
  m_visible!: boolean; // For SCH_FIELDs and PCB_FIELDs

  constructor(aIuScale: EdaIuScale, aText?: string);
  constructor(aText: EDA_TEXT);
  constructor(a: EdaIuScale | EDA_TEXT, aText = '') {
    if (a instanceof EDA_TEXT) this.initEdaTextFrom(a);
    else this.initEdaText(a, aText);
  }

  /** `EDA_TEXT( const EDA_IU_SCALE& aIuScale, const wxString& aText )`: the mixin's constructor. */
  initEdaText(aIuScale: EdaIuScale, aText = ''): void {
    this.m_hyperlink = '';
    this.m_activeUrl = '';
    this.m_text = aText;
    this.m_IuScale = aIuScale;
    this.m_visible = true;
    this.m_render_cache = null;
    this.m_bbox_cache = new Map();
    this.m_attributes = new TEXT_ATTRIBUTES();
    this.m_unresolvedFontName = '';
    this.m_pos = { x: 0, y: 0 };
    this.m_shown_text = '';
    this.m_shown_text_has_text_var_refs = false;

    this.SetTextSize({
      x: this.m_IuScale.milsToIU(DEFAULT_SIZE_TEXT),
      y: this.m_IuScale.milsToIU(DEFAULT_SIZE_TEXT),
    });

    if (this.m_text === '') {
      this.m_shown_text = '';
      this.m_shown_text_has_text_var_refs = false;
    } else {
      this.m_shown_text = unescapeString(this.m_text);
      this.m_shown_text_has_text_var_refs = this.m_shown_text.includes('${');
    }
  }

  /** `EDA_TEXT( const EDA_TEXT& aText )`: the copy constructor, as an init. */
  initEdaTextFrom(aText: EDA_TEXT): void {
    this.m_IuScale = aText.m_IuScale;
    this.m_hyperlink = aText.m_hyperlink;
    this.m_activeUrl = aText.m_activeUrl;

    this.m_text = aText.m_text;
    this.m_shown_text = aText.m_shown_text;
    this.m_shown_text_has_text_var_refs = aText.m_shown_text_has_text_var_refs;

    this.m_attributes = aText.m_attributes.clone();
    this.m_pos = { x: aText.m_pos.x, y: aText.m_pos.y };
    this.m_visible = aText.m_visible;

    this.m_render_cache = null;

    this.m_bbox_cache = new Map();

    for (const [line, entry] of aText.m_bbox_cache)
      this.m_bbox_cache.set(line, { m_pos: { ...entry.m_pos }, m_bbox: entry.m_bbox.Clone() });

    this.m_unresolvedFontName = aText.m_unresolvedFontName;
  }

  /** `EDA_TEXT& operator=( const EDA_TEXT& aItem )`. */
  assignEdaText(aText: EDA_TEXT): this {
    if (this === aText) return this;

    this.m_text = aText.m_text;
    this.m_shown_text = aText.m_shown_text;
    this.m_shown_text_has_text_var_refs = aText.m_shown_text_has_text_var_refs;

    this.m_attributes = aText.m_attributes.clone();
    this.m_pos = { x: aText.m_pos.x, y: aText.m_pos.y };
    this.m_visible = aText.m_visible;

    this.m_render_cache = null;

    this.m_bbox_cache = new Map();

    for (const [line, entry] of aText.m_bbox_cache)
      this.m_bbox_cache.set(line, { m_pos: { ...entry.m_pos }, m_bbox: entry.m_bbox.Clone() });

    this.m_unresolvedFontName = aText.m_unresolvedFontName;

    return this;
  }

  /**
   * Return the string associated with the text object.
   *
   * @return a const wxString reference containing the string of the item.
   */
  GetText(): string {
    return this.m_text;
  }

  /**
   * Return the string actually shown after processing of the base text.
   *
   * @param aAllowExtraText is true to allow adding more text than the initial expanded text,
   * for intance a title, a prefix for texts in display functions.
   * False to disable any added text (for instance when writing the shown text in netlists).
   * @param aDepth is used to prevent infinite recursions and loops when expanding
   * text variables.
   */
  GetShownText(aAllowExtraText: boolean, aDepth = 0): string {
    return this.m_shown_text;
  }

  /**
   * Indicates the ShownText has text var references which need to be processed.
   */
  HasTextVars(): boolean {
    return this.m_shown_text_has_text_var_refs;
  }

  SetText(aText: string): void {
    this.m_text = aText;
    this.cacheShownText();
  }

  EvaluateText(aText: string): string {
    // Must not be static. EvaluateText runs on parallel workers (e.g.
    // CONNECTION_GRAPH resolving label text) and a shared evaluator races on
    // its internal error collector.
    const evaluator = new EXPRESSION_EVALUATOR();

    return evaluator.Evaluate(aText);
  }

  /**
   * The TextThickness is that set by the user.  The EffectiveTextPenWidth also factors
   * in bold text and thickness clamping.
   */
  SetTextThickness(aWidth: number): void {
    this.m_attributes.m_StrokeWidth = aWidth;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetTextThickness(): number {
    return this.m_attributes.m_StrokeWidth;
  }

  GetTextThicknessProperty(): number {
    if (this.GetAutoThickness()) return this.GetEffectiveTextPenWidth();
    else return this.GetTextThickness();
  }

  SetAutoThickness(aAuto: boolean): void {
    if (this.GetAutoThickness() !== aAuto)
      this.SetTextThickness(aAuto ? 0 : this.GetEffectiveTextPenWidth());
  }
  GetAutoThickness(): boolean {
    return this.GetTextThickness() === 0;
  }

  /**
   * The EffectiveTextPenWidth uses the text thickness if > 1 or aDefaultPenWidth.
   */
  GetEffectiveTextPenWidth(aDefaultPenWidth = 0): number {
    let penWidth = this.GetTextThickness();

    if (penWidth <= 1) {
      penWidth = aDefaultPenWidth;

      if (this.IsBold()) penWidth = GetPenSizeForBold(this.GetTextWidth());
      else if (penWidth <= 1) penWidth = GetPenSizeForNormal(this.GetTextWidth());
    }

    // Clip pen size for small texts:
    penWidth = ClampTextPenSize(penWidth, this.GetTextSize());

    return penWidth;
  }

  SetTextAngle(aAngle: EDA_ANGLE): void {
    this.m_attributes.m_Angle = aAngle;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetTextAngle(): EDA_ANGLE {
    return this.m_attributes.m_Angle;
  }

  // For property system:
  SetTextAngleDegrees(aOrientation: number): void {
    this.SetTextAngle(new EDA_ANGLE(aOrientation, EDA_ANGLE_T.DEGREES_T));
  }
  GetTextAngleDegrees(): number {
    return this.m_attributes.m_Angle.AsDegrees();
  }

  /**
   * Set the text to be italic - this will also update the font if needed.
   *
   * This is the properties system interface.
   */
  SetItalic(aItalic: boolean): void {
    if (this.m_attributes.m_Italic !== aItalic) {
      const font = this.GetFont();

      if (!font || font.IsStroke()) {
        // For stroke fonts, just need to set the attribute.
      } else {
        // For outline fonts, italic-ness is determined by the font itself.
        this.SetFont(FONT.GetFont(font.GetName(), this.IsBold(), aItalic));
      }
    }

    this.SetItalicFlag(aItalic);
  }

  /**
   * Set only the italic flag, without changing the font.
   *
   * Used when bulk-changing text attributes (e.g. from a dialog or import).
   */
  SetItalicFlag(aItalic: boolean): void {
    this.m_attributes.m_Italic = aItalic;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  IsItalic(): boolean {
    return this.m_attributes.m_Italic;
  }

  /**
   * Set the text to be bold - this will also update the font if needed.
   *
   * This is the properties system interface.
   */
  SetBold(aBold: boolean): void {
    if (this.m_attributes.m_Bold !== aBold) {
      const font = this.GetFont();

      if (!font || font.IsStroke()) {
        // For stroke fonts, boldness is determined by the pen size.
        const size = Math.min(this.m_attributes.m_Size.x, this.m_attributes.m_Size.y);

        if (aBold) {
          this.m_attributes.m_StoredStrokeWidth = this.m_attributes.m_StrokeWidth;
          this.m_attributes.m_StrokeWidth = GetPenSizeForBold(size);
        } else {
          // Restore the original stroke width from `m_StoredStrokeWidth` if it was
          // previously stored, resetting the width after unbolding.
          if (this.m_attributes.m_StoredStrokeWidth)
            this.m_attributes.m_StrokeWidth = this.m_attributes.m_StoredStrokeWidth;
          else {
            this.m_attributes.m_StrokeWidth = GetPenSizeForNormal(size);
            // Sets `m_StrokeWidth` to the normal pen size and stores it in
            // `m_StoredStrokeWidth` as the default, but only if the bold option was
            // applied before this feature was implemented.
            this.m_attributes.m_StoredStrokeWidth = this.m_attributes.m_StrokeWidth;
          }
        }
      } else {
        // For outline fonts, boldness is determined by the font itself.
        this.SetFont(FONT.GetFont(font.GetName(), aBold, this.IsItalic()));
      }
    }

    this.SetBoldFlag(aBold);
  }

  /**
   * Set only the bold flag, without changing the font.
   *
   * Used when bulk-changing text attributes (e.g. from a dialog or import).
   */
  SetBoldFlag(aBold: boolean): void {
    this.m_attributes.m_Bold = aBold;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  IsBold(): boolean {
    return this.m_attributes.m_Bold;
  }

  SetVisible(aVisible: boolean): void {
    this.m_visible = aVisible;
    this.ClearRenderCache();
  }
  IsVisible(): boolean {
    return this.m_visible;
  }

  SetMirrored(isMirrored: boolean): void {
    this.m_attributes.m_Mirrored = isMirrored;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  IsMirrored(): boolean {
    return this.m_attributes.m_Mirrored;
  }

  /**
   * @param aAllow true if ok to use multiline option, false if ok to use only single line
   *               text.  (Single line is faster in calculations than multiline.)
   */
  SetMultilineAllowed(aAllow: boolean): void {
    this.m_attributes.m_Multiline = aAllow;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  IsMultilineAllowed(): boolean {
    return this.m_attributes.m_Multiline;
  }

  SetHorizJustify(aType: GR_TEXT_H_ALIGN_T): void {
    this.m_attributes.m_Halign = aType;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetHorizJustify(): GR_TEXT_H_ALIGN_T {
    return this.m_attributes.m_Halign;
  }

  SetVertJustify(aType: GR_TEXT_V_ALIGN_T): void {
    this.m_attributes.m_Valign = aType;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetVertJustify(): GR_TEXT_V_ALIGN_T {
    return this.m_attributes.m_Valign;
  }

  SetKeepUpright(aKeepUpright: boolean): void {
    this.m_attributes.m_KeepUpright = aKeepUpright;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  IsKeepUpright(): boolean {
    return this.m_attributes.m_KeepUpright;
  }

  FlipHJustify(): void {
    if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
      this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    else if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
      this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
  }

  /**
   * Set the text attributes from another instance.
   */
  SetAttributes(aSrc: EDA_TEXT, aSetPosition?: boolean): void;
  SetAttributes(aTextAttrs: TEXT_ATTRIBUTES): void;
  SetAttributes(aSrc: EDA_TEXT | TEXT_ATTRIBUTES, aSetPosition = true): void {
    if (aSrc instanceof TEXT_ATTRIBUTES) {
      this.m_attributes = aSrc.clone();
      return;
    }

    this.m_attributes = aSrc.m_attributes.clone();

    if (aSetPosition) this.m_pos = { x: aSrc.m_pos.x, y: aSrc.m_pos.y };

    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }

  /**
   * Swap the text attributes of the two involved instances.
   */
  SwapAttributes(aTradingPartner: EDA_TEXT): void {
    [this.m_attributes, aTradingPartner.m_attributes] = [
      aTradingPartner.m_attributes,
      this.m_attributes,
    ];
    [this.m_pos, aTradingPartner.m_pos] = [aTradingPartner.m_pos, this.m_pos];

    this.ClearRenderCache();
    aTradingPartner.ClearRenderCache();

    this.ClearBoundingBoxCache();
    aTradingPartner.ClearBoundingBoxCache();
  }

  SwapText(aTradingPartner: EDA_TEXT): void {
    [this.m_text, aTradingPartner.m_text] = [aTradingPartner.m_text, this.m_text];
    this.cacheShownText();
  }

  CopyText(aSrc: EDA_TEXT): void {
    this.m_text = aSrc.m_text;
    this.cacheShownText();
  }

  GetAttributes(): TEXT_ATTRIBUTES {
    return this.m_attributes;
  }

  /**
   * Helper function used in search and replace dialog.
   *
   * Perform a text replace using the find and replace criteria in \a aSearchData.
   *
   * @param aSearchData A reference to a EDA_SEARCH_DATA object containing the
   *                    search and replace criteria.
   * @return True if the text item was modified, otherwise false.
   */
  Replace(aSearchData: EDA_SEARCH_DATA): boolean {
    const text: OutStr = { value: this.m_text };
    const retval = EDA_ITEM.Replace(aSearchData, text);
    this.m_text = text.value;

    this.cacheShownText();

    this.ClearRenderCache();
    this.ClearBoundingBoxCache();

    return retval;
  }

  IsDefaultFormatting(): boolean {
    return (
      !this.IsMirrored() &&
      this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER &&
      this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER &&
      this.GetAutoThickness() &&
      !this.IsItalic() &&
      !this.IsBold() &&
      !this.IsMultilineAllowed() &&
      this.GetFontName() === ''
    );
  }

  SetFont(aFont: FONT | null): void {
    this.m_attributes.m_Font = aFont;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetFont(): FONT | null {
    return this.m_attributes.m_Font;
  }

  SetUnresolvedFontName(aFontName: string): void {
    this.m_unresolvedFontName = aFontName;
  }
  ResolveFont(aEmbeddedFonts: readonly string[] | null): boolean {
    if (this.m_unresolvedFontName !== '') {
      this.m_attributes.m_Font = FONT.GetFont(
        this.m_unresolvedFontName,
        this.IsBold(),
        this.IsItalic(),
        aEmbeddedFonts,
      );

      if (this.m_render_cache && this.m_render_cache.glyphs.length !== 0)
        this.m_render_cache.font = this.m_attributes.m_Font;

      this.m_unresolvedFontName = '';
      return true;
    }

    return false;
  }

  GetFontName(): string {
    if (this.GetFont()) return this.GetFont()!.GetName();
    else return '';
  }

  SetFontProp(aFontName: string): void {
    if (IsEeschemaType(this.itemType())) {
      if (aFontName === 'Default Font') this.SetFont(null);
      else this.SetFont(FONT.GetFont(aFontName, this.IsBold(), this.IsItalic()));
    } else {
      if (aFontName === KICAD_FONT_NAME) this.SetFont(null);
      else this.SetFont(FONT.GetFont(aFontName, this.IsBold(), this.IsItalic()));
    }
  }
  GetFontProp(): string {
    const font = this.GetFont();

    if (font) return font.GetName();

    if (IsEeschemaType(this.itemType())) return 'Default Font';
    else return KICAD_FONT_NAME;
  }

  /**
   * `dynamic_cast<const EDA_ITEM*>( this )->Type()`: the mixin asks the item it is part of.
   * A bare `EDA_TEXT` is no item and takes the non-eeschema branch.
   */
  private itemType(): KICAD_T {
    const item = this as unknown as { Type?: () => KICAD_T };

    return item.Type ? item.Type() : (0 as KICAD_T);
  }

  SetLineSpacing(aLineSpacing: number): void {
    this.m_attributes.m_LineSpacing = aLineSpacing;
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetLineSpacing(): number {
    return this.m_attributes.m_LineSpacing;
  }

  SetTextSize(aNewSize: VECTOR2I, aEnforceMinTextSize = true): void {
    let newSize = aNewSize;

    // Plotting uses unityScale and independently scales the text.  If we clamp here we'll
    // clamp to *really* small values.
    if (this.m_IuScale.IU_PER_MM === unityScale.IU_PER_MM) aEnforceMinTextSize = false;

    if (aEnforceMinTextSize) {
      const min = this.m_IuScale.mmToIU(TEXT_MIN_SIZE_MM);
      const max = this.m_IuScale.mmToIU(TEXT_MAX_SIZE_MM);

      newSize = { x: clamp(newSize.x, min, max), y: clamp(newSize.y, min, max) };
    }

    this.m_attributes.m_Size = { x: newSize.x, y: newSize.y };

    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetTextSize(): VECTOR2I {
    return this.m_attributes.m_Size;
  }

  SetTextWidth(aWidth: number): void {
    const min = this.m_IuScale.mmToIU(TEXT_MIN_SIZE_MM);
    const max = this.m_IuScale.mmToIU(TEXT_MAX_SIZE_MM);

    this.m_attributes.m_Size.x = clamp(aWidth, min, max);
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetTextWidth(): number {
    return this.m_attributes.m_Size.x;
  }

  SetTextHeight(aHeight: number): void {
    const min = this.m_IuScale.mmToIU(TEXT_MIN_SIZE_MM);
    const max = this.m_IuScale.mmToIU(TEXT_MAX_SIZE_MM);

    this.m_attributes.m_Size.y = clamp(aHeight, min, max);
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }
  GetTextHeight(): number {
    return this.m_attributes.m_Size.y;
  }

  SetTextColor(aColor: Color4d): void {
    this.m_attributes.m_Color = aColor;
  }
  GetTextColor(): Color4d {
    return this.m_attributes.m_Color;
  }

  SetTextPos(aPoint: VECTOR2I): void {
    this.Offset({ x: aPoint.x - this.m_pos.x, y: aPoint.y - this.m_pos.y });
  }
  GetTextPos(): VECTOR2I {
    return this.m_pos;
  }

  SetTextX(aX: number): void {
    this.Offset({ x: aX - this.m_pos.x, y: 0 });
  }
  SetTextY(aY: number): void {
    this.Offset({ x: 0, y: aY - this.m_pos.y });
  }

  SetActiveUrl(aUrl: string): void {
    this.m_activeUrl = aUrl;
  }

  Offset(aOffset: VECTOR2I): void {
    if (aOffset.x === 0 && aOffset.y === 0) return;

    this.m_pos = { x: this.m_pos.x + aOffset.x, y: this.m_pos.y + aOffset.y };

    if (this.m_render_cache) {
      const glyphs = this.m_render_cache.glyphs;

      for (let ii = 0; ii < glyphs.length; ii++) {
        const glyph = glyphs[ii]!;

        if (glyph instanceof OUTLINE_GLYPH) glyph.Move(aOffset);
        else if (glyph instanceof STROKE_GLYPH)
          glyphs[ii] = glyph.Transform({ x: 1.0, y: 1.0 }, aOffset, 0, ANGLE_0, false, {
            x: 0,
            y: 0,
          });
      }
    }

    this.ClearBoundingBoxCache();
  }

  Empty(): void {
    this.m_text = '';
    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }

  static MapHorizJustify(aHorizJustify: number): GR_TEXT_H_ALIGN_T {
    if (aHorizJustify > GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
      return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;

    if (aHorizJustify < GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
      return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;

    return aHorizJustify as GR_TEXT_H_ALIGN_T;
  }

  static MapVertJustify(aVertJustify: number): GR_TEXT_V_ALIGN_T {
    if (aVertJustify > GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
      return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;

    if (aVertJustify < GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
      return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;

    return aVertJustify as GR_TEXT_V_ALIGN_T;
  }

  /**
   * build a list of segments (SHAPE_SEGMENT) to describe a text shape.
   * @param aTriangulate: true to build also the triangulation of each shape
   * @param aUseTextRotation: true to use the actual text draw rotation.
   * false to build a list of shape for a not rotated text ("native" shapes).
   */
  GetEffectiveTextShape(
    aTriangulate = true,
    aBBox: BOX2I = new BOX2I(),
    aAngle: EDA_ANGLE = ANGLE_0,
  ): SHAPE_COMPOUND {
    const shape = new SHAPE_COMPOUND();
    const font = this.GetDrawFont(null);
    const penWidth = this.GetEffectiveTextPenWidth();
    const shownText = this.GetShownText(true);
    let drawPos = this.GetDrawPos();
    const attrs = this.GetAttributes().clone();

    let cache: GLYPH_LIKE[] | null = null;

    if (aBBox.GetWidth()) {
      drawPos = aBBox.GetCenter();
      attrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
      attrs.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
      attrs.m_Angle = aAngle;
    } else {
      attrs.m_Angle = this.GetDrawRotation();

      if (font.IsOutline()) cache = this.GetRenderCache(font, shownText, { x: 0, y: 0 });
    }

    if (aTriangulate) {
      const callback_gal = new CALLBACK_GAL(
        // Stroke callback
        (aPt1: VECTOR2I, aPt2: VECTOR2I) => {
          shape.AddShape(new SHAPE_SEGMENT(aPt1, aPt2, penWidth));
        },
        // Triangulation callback
        (aPt1: VECTOR2I, aPt2: VECTOR2I, aPt3: VECTOR2I) => {
          const triShape = new SHAPE_SIMPLE();

          for (const point of [aPt1, aPt2, aPt3]) triShape.Append(point.x, point.y);

          shape.AddShape(triShape);
        },
      );

      if (cache) callback_gal.DrawGlyphs(cache);
      else font.DrawAt(callback_gal, shownText, drawPos, attrs, this.getFontMetrics());
    } else {
      const callback_gal = new CALLBACK_GAL(
        // Stroke callback
        (aPt1: VECTOR2I, aPt2: VECTOR2I) => {
          shape.AddShape(new SHAPE_SEGMENT(aPt1, aPt2, penWidth));
        },
        // Outline callback
        (aPoly: SHAPE_LINE_CHAIN) => {
          shape.AddShape(aPoly.Clone());
        },
      );

      if (cache) callback_gal.DrawGlyphs(cache);
      else font.DrawAt(callback_gal, shownText, drawPos, attrs, this.getFontMetrics());
    }

    return shape;
  }

  /**
   * Test if \a aPoint is within the bounds of this object.
   *
   * @param aPoint A VECTOR2I to test.
   * @param aAccuracy Amount to inflate the bounding box.
   * @return true if a hit, else false.
   */
  TextHitTest(aPoint: VECTOR2I, aAccuracy?: number): boolean;
  /**
   * Test if object bounding box is contained within or intersects \a aRect.
   *
   * @param aRect Rect to test against.
   * @param aContains Test for containment instead of intersection if true.
   * @param aAccuracy Amount to inflate the bounding box.
   * @return true if a hit, else false.
   */
  TextHitTest(aRect: BOX2I, aContains: boolean, aAccuracy?: number): boolean;
  TextHitTest(a: VECTOR2I | BOX2I, b?: number | boolean, c?: number): boolean {
    if (a instanceof BOX2I) {
      const aContains = b as boolean;
      const aAccuracy = c ?? 0;
      const rect = a.GetInflated(aAccuracy);

      if (aContains) return rect.Contains(this.GetTextBox(null));

      return rect.Intersects(this.GetTextBox(null), this.GetDrawRotation());
    }

    const aAccuracy = (b as number | undefined) ?? 0;
    const rect = this.GetTextBox(null).GetInflated(aAccuracy);
    const location = GetRotated(a, this.GetDrawPos(), this.GetDrawRotation().negate());
    return rect.Contains(location);
  }

  /**
   * Useful in multiline texts to calculate the full text or a line area (for zones filling,
   * locate functions....)
   *
   * @param aLine The line of text to consider.  Pass -1 for all lines.
   * @return the rect containing the line of text (i.e. the position and the size of one line)
   *         this rectangle is calculated for 0 orient text.
   *         If orientation is not 0 the rect must be rotated to match the physical area
   */
  GetTextBox(aSettings: RENDER_SETTINGS | null, aLine = -1): BOX2I {
    const drawPos = this.GetDrawPos();

    {
      const cache_it = this.m_bbox_cache.get(aLine);

      if (
        cache_it !== undefined &&
        cache_it.m_pos.x === drawPos.x &&
        cache_it.m_pos.y === drawPos.y
      )
        return cache_it.m_bbox.Clone(); // returned by value in C++: the cache is not aliased
    }

    const bbox = new BOX2I();
    let strings: string[] = [];
    let text = this.GetShownText(true);
    const thickness = this.GetEffectiveTextPenWidth();

    if (this.IsMultilineAllowed()) {
      strings = wxStringSplit(text, '\n');

      if (strings.length) {
        // GetCount() == 0 for void strings with multilines allowed
        if (aLine >= 0 && aLine < strings.length) text = strings[aLine]!;
        else text = strings[0]!;
      }
    }

    // calculate the H and V size
    const font = this.GetDrawFont(aSettings);
    const fontSize = { x: this.GetTextSize().x, y: this.GetTextSize().y };
    const bold = this.IsBold();
    const italic = this.IsItalic();
    let extents = font.StringBoundaryLimits(
      text,
      fontSize,
      thickness,
      bold,
      italic,
      this.getFontMetrics(),
    );
    let overbarOffset = 0;

    // Creates bounding box (rectangle) for horizontal, left and top justified text. The
    // bounding box will be moved later according to the actual text options
    const textsize = { x: extents.x, y: extents.y };
    const pos = { x: drawPos.x, y: drawPos.y };
    const fudgeFactor = KiROUND(extents.y * 0.17);

    if (font.IsStroke()) textsize.y += fudgeFactor;

    if (this.IsMultilineAllowed() && aLine > 0 && aLine < strings.length)
      pos.y -= KiROUND(aLine * font.GetInterline(fontSize.y, this.getFontMetrics()));

    if (text.includes('~{')) overbarOffset = Math.trunc(extents.y / 6);

    bbox.SetOrigin(pos);

    // for multiline texts and aLine < 0, merge all rectangles (aLine == -1 signals all lines)
    if (this.IsMultilineAllowed() && aLine < 0 && strings.length > 1) {
      for (let ii = 1; ii < strings.length; ii++) {
        text = strings[ii]!;
        extents = font.StringBoundaryLimits(
          text,
          fontSize,
          thickness,
          bold,
          italic,
          this.getFontMetrics(),
        );
        textsize.x = Math.max(textsize.x, extents.x);
      }

      // interline spacing is only *between* lines, so total height is the height of the first
      // line plus the interline distance (with interline spacing) for all subsequent lines
      textsize.y += KiROUND(
        (strings.length - 1) * font.GetInterline(fontSize.y, this.getFontMetrics()),
      );
    }

    textsize.y += overbarOffset;

    bbox.SetSize(textsize);

    /*
     * At this point the rectangle origin is the text origin (m_Pos).  This is correct only for
     * left and top justified, non-mirrored, non-overbarred texts. Recalculate for all others.
     */
    const italicOffset = this.IsItalic() ? KiROUND(fontSize.y * ITALIC_TILT) : 0;

    switch (this.GetHorizJustify()) {
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
        if (this.IsMirrored()) bbox.SetX(bbox.GetX() - (bbox.GetWidth() - italicOffset));

        break;

      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
        bbox.SetX(bbox.GetX() - Math.trunc((bbox.GetWidth() - italicOffset) / 2));
        break;

      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
        if (!this.IsMirrored()) bbox.SetX(bbox.GetX() - (bbox.GetWidth() - italicOffset));
        break;

      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE:
        console.assert(false, 'Indeterminate state legal only in dialogs.');
        break;
    }

    switch (this.GetVertJustify()) {
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
        bbox.Offset(0, -fudgeFactor);
        break;

      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
        bbox.SetY(bbox.GetY() - Math.trunc(bbox.GetHeight() / 2));
        break;

      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
        bbox.SetY(bbox.GetY() - bbox.GetHeight());
        bbox.Offset(0, fudgeFactor);
        break;

      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE:
        console.assert(false, 'Indeterminate state legal only in dialogs.');
        break;
    }

    bbox.Normalize(); // Make h and v sizes always >= 0

    this.m_bbox_cache.set(aLine, { m_pos: drawPos, m_bbox: bbox });

    return bbox.Clone();
  }

  /**
   * Return the distance between two lines of text.
   *
   * Calculates the distance (pitch) between two lines of text.  This distance includes the
   * interline distance plus room for characters like j, {, and [.  It also used for single
   * line text, to calculate the text bounding box.
   */
  GetInterline(aSettings: RENDER_SETTINGS | null): number {
    return KiROUND(
      this.GetDrawFont(aSettings).GetInterline(this.GetTextHeight(), this.getFontMetrics()),
    );
  }

  /**
   * @return a wxString with the style name( Normal, Italic, Bold, Bold+Italic).
   */
  GetTextStyleName(): string {
    let style = 0;

    if (this.IsItalic()) style = 1;

    if (this.IsBold()) style += 2;

    const stylemsg = ['Normal', 'Italic', 'Bold', 'Bold+Italic'];

    return stylemsg[style]!;
  }

  /**
   * Populate \a aPositions with the position of each line of a multiline text, according
   * to the vertical justification and the rotation of the whole text.
   *
   * @param aPositions is the list to populate by the VECTOR2I positions.
   * @param aLineCount is the number of lines (not recalculated here for efficiency reasons.
   */
  GetLinePositions(
    aSettings: RENDER_SETTINGS | null,
    aPositions: VECTOR2I[],
    aLineCount: number,
  ): void {
    let pos = { x: this.GetDrawPos().x, y: this.GetDrawPos().y }; // Position of first line of the multiline text according
    // to the center of the multiline text block

    const offset = { x: 0, y: 0 }; // Offset to next line.

    offset.y = this.GetInterline(aSettings);

    if (aLineCount > 1) {
      switch (this.GetVertJustify()) {
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
          break;

        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
          pos.y -= Math.trunc(((aLineCount - 1) * offset.y) / 2);
          break;

        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
          pos.y -= (aLineCount - 1) * offset.y;
          break;

        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE:
          console.assert(false, 'Indeterminate state legal only in dialogs.');
          break;
      }
    }

    // Rotate the position of the first line around the center of the multiline text block
    pos = RotatePoint(pos, this.GetDrawPos(), this.GetDrawRotation());

    // Rotate the offset lines to increase happened in the right direction
    const rotOffset = RotatePoint(offset, this.GetDrawRotation());

    for (let ii = 0; ii < aLineCount; ii++) {
      aPositions.push({ x: pos.x, y: pos.y });
      pos = { x: pos.x + rotOffset.x, y: pos.y + rotOffset.y };
    }
  }

  /**
   * Return the levenstein distance between two texts.
   *
   * Return a value of 0.0 - 1.0 where 1.0 is a perfect match.
   */
  Levenshtein(aOther: EDA_TEXT): number {
    // Compute the Levenshtein distance between the two strings
    const str1 = this.GetText();
    const str2 = aOther.GetText();

    const m = str1.length;
    const n = str2.length;

    if (n === 0 || m === 0) return 0.0;

    // Create a matrix to store the distance values
    const distance: number[][] = [];

    for (let i = 0; i <= m; i++) distance.push(new Array<number>(n + 1).fill(0));

    // Initialize the matrix
    for (let i = 0; i <= m; i++) distance[i]![0] = i;
    for (let j = 0; j <= n; j++) distance[0]![j] = j;

    // Calculate the distance
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          distance[i]![j] = distance[i - 1]![j - 1]!;
        } else {
          distance[i]![j] =
            Math.min(distance[i - 1]![j]!, distance[i]![j - 1]!, distance[i - 1]![j - 1]!) + 1;
        }
      }
    }

    // Calculate similarity score
    const maxLen = Math.max(m, n);
    const similarity = 1.0 - distance[m]![n]! / maxLen;

    return similarity;
  }

  Similarity(aOther: EDA_TEXT): number {
    let retval = 1.0;

    if (!this.m_attributes.equals(aOther.m_attributes)) retval *= 0.9;

    if (this.m_pos.x !== aOther.m_pos.x || this.m_pos.y !== aOther.m_pos.y) retval *= 0.9;

    retval *= this.Levenshtein(aOther);

    return retval;
  }

  /**
   * Output the object to \a aFormatter in s-expression form.
   *
   * @param aFormatter The #OUTPUTFORMATTER object to write to.
   * @param aControlBits The control bit definition for object specific formatting.
   * @throw IO_ERROR on write error.
   */
  Format(aFormatter: OUTPUTFORMATTER, aControlBits: number): void {
    aFormatter.Print('(effects');

    aFormatter.Print('(font');

    const font = this.GetFont();

    if (font && font.GetName() !== '')
      aFormatter.Print(`(face ${aFormatter.Quotew(font.NameAsToken())})`);

    // Text size
    aFormatter.Print(
      `(size ${FormatInternalUnits(this.m_IuScale, this.GetTextHeight())} ${FormatInternalUnits(this.m_IuScale, this.GetTextWidth())})`,
    );

    if (this.GetLineSpacing() !== 1.0) {
      aFormatter.Print(`(line_spacing ${FormatDouble2Str(this.GetLineSpacing())})`);
    }

    if (!this.GetAutoThickness()) {
      aFormatter.Print(
        `(thickness ${FormatInternalUnits(this.m_IuScale, this.GetTextThickness())})`,
      );
    }

    if (this.IsBold()) FormatBool(aFormatter, 'bold', true);

    if (this.IsItalic()) FormatBool(aFormatter, 'italic', true);

    const color = this.GetTextColor();

    if (
      !(aControlBits & CTL_OMIT_COLOR) &&
      !(
        color.r === COLOR4D_UNSPECIFIED.r &&
        color.g === COLOR4D_UNSPECIFIED.g &&
        color.b === COLOR4D_UNSPECIFIED.b &&
        color.a === COLOR4D_UNSPECIFIED.a
      )
    ) {
      aFormatter.Print(
        `(color ${KiROUND(color.r * 255.0)} ${KiROUND(color.g * 255.0)} ${KiROUND(color.b * 255.0)} ${FormatDouble2Str(color.a)})`,
      );
    }

    aFormatter.Print(')'); // (font

    if (
      this.IsMirrored() ||
      this.GetHorizJustify() !== GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER ||
      this.GetVertJustify() !== GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
    ) {
      aFormatter.Print('(justify');

      if (this.GetHorizJustify() !== GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER)
        aFormatter.Print(
          this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT ? ' left' : ' right',
        );

      if (this.GetVertJustify() !== GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER)
        aFormatter.Print(
          this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP ? ' top' : ' bottom',
        );

      if (this.IsMirrored()) aFormatter.Print(' mirror');

      aFormatter.Print(')'); // (justify
    }

    if (!(aControlBits & CTL_OMIT_HYPERLINK) && this.HasHyperlink())
      aFormatter.Print(`(href ${aFormatter.Quotew(this.GetHyperlink())})`);

    aFormatter.Print(')'); // (effects
  }

  GetDrawRotation(): EDA_ANGLE {
    return this.GetTextAngle();
  }
  GetDrawPos(): VECTOR2I {
    return this.GetTextPos();
  }

  GetDrawFont(aSettings: RENDER_SETTINGS | null): FONT {
    let font = this.GetFont();

    if (!font) {
      if (aSettings)
        font = FONT.GetFont(aSettings.GetDefaultFont(), this.IsBold(), this.IsItalic());
      else font = FONT.GetFont('', this.IsBold(), this.IsItalic());
    }

    return font;
  }

  ClearRenderCache(): void {
    this.m_render_cache = null;
  }

  ClearBoundingBoxCache(): void {
    this.m_bbox_cache.clear();
  }

  GetRenderCache(
    aFont: FONT,
    forResolvedText: string,
    aOffset: VECTOR2I = { x: 0, y: 0 },
  ): GLYPH_LIKE[] | null {
    if (aFont.IsOutline()) {
      const resolvedAngle = this.GetDrawRotation();
      const mirrored = this.IsMirrored();

      if (!this.m_render_cache)
        this.m_render_cache = {
          text: '',
          font: null,
          angle: ANGLE_0,
          offset: { x: 0, y: 0 },
          mirrored: false,
          glyphs: [],
        };

      if (
        this.m_render_cache.glyphs.length === 0 ||
        this.m_render_cache.font !== aFont ||
        this.m_render_cache.text !== forResolvedText ||
        !this.m_render_cache.angle.equals(resolvedAngle) ||
        this.m_render_cache.offset.x !== aOffset.x ||
        this.m_render_cache.offset.y !== aOffset.y ||
        this.m_render_cache.mirrored !== mirrored
      ) {
        this.m_render_cache.glyphs.length = 0;

        const font = aFont as OUTLINE_FONT;
        const attrs = this.GetAttributes().clone();

        attrs.m_Angle = resolvedAngle;

        font.GetLinesAsGlyphs(
          this.m_render_cache.glyphs,
          forResolvedText,
          { x: this.GetDrawPos().x + aOffset.x, y: this.GetDrawPos().y + aOffset.y },
          attrs,
          this.getFontMetrics(),
        );
        this.m_render_cache.font = aFont;
        this.m_render_cache.angle = resolvedAngle;
        this.m_render_cache.text = forResolvedText;
        this.m_render_cache.offset = { x: aOffset.x, y: aOffset.y };
        this.m_render_cache.mirrored = mirrored;
      }

      return this.m_render_cache.glyphs;
    }

    return null;
  }

  // Support for reading the cache from disk.
  SetupRenderCache(
    aResolvedText: string,
    aFont: FONT | null,
    aAngle: EDA_ANGLE,
    aOffset: VECTOR2I,
  ): void {
    if (!this.m_render_cache)
      this.m_render_cache = {
        text: '',
        font: null,
        angle: ANGLE_0,
        offset: { x: 0, y: 0 },
        mirrored: false,
        glyphs: [],
      };

    this.m_render_cache.text = aResolvedText;
    this.m_render_cache.font = aFont;
    this.m_render_cache.angle = aAngle;
    this.m_render_cache.offset = { x: aOffset.x, y: aOffset.y };
    this.m_render_cache.mirrored = this.IsMirrored();
    this.m_render_cache.glyphs.length = 0;
  }

  AddRenderCacheGlyph(aPoly: SHAPE_POLY_SET): void {
    if (!this.m_render_cache)
      this.m_render_cache = {
        text: '',
        font: null,
        angle: ANGLE_0,
        offset: { x: 0, y: 0 },
        mirrored: false,
        glyphs: [],
      };

    const glyph = new OUTLINE_GLYPH(aPoly);
    this.m_render_cache.glyphs.push(glyph);
    glyph.CacheTriangulation();
  }

  Compare(aOther: EDA_TEXT | null): number {
    if (!aOther) return 1;

    let val = this.m_attributes.Compare(aOther.m_attributes);

    if (val !== 0) return val;

    if (this.m_pos.x !== aOther.m_pos.x) return this.m_pos.x - aOther.m_pos.x;

    if (this.m_pos.y !== aOther.m_pos.y) return this.m_pos.y - aOther.m_pos.y;

    val = wxCmp(this.GetFontName(), aOther.GetFontName());

    if (val !== 0) return val;

    return wxCmp(this.m_text, aOther.m_text);
  }

  equalsEdaText(aRhs: EDA_TEXT): boolean {
    return this.Compare(aRhs) === 0;
  }
  ltEdaText(aRhs: EDA_TEXT): boolean {
    return this.Compare(aRhs) < 0;
  }
  gtEdaText(aRhs: EDA_TEXT): boolean {
    return this.Compare(aRhs) > 0;
  }

  HasHyperlink(): boolean {
    return this.m_hyperlink !== '';
  }
  GetHyperlink(): string {
    return this.m_hyperlink;
  }
  SetHyperlink(aLink: string): void {
    this.m_hyperlink = aLink;
  }
  RemoveHyperlink(): void {
    this.m_hyperlink = '';
  }

  /**
   * Check if aURL is a valid hyperlink.
   *
   * @param aURL String to validate
   * @return true if aURL is a valid hyperlink
   */
  static ValidateHyperlink(aURL: string): boolean {
    if (aURL === '' || EDA_TEXT.IsGotoPageHref(aURL)) return true;

    // `wxURI::Create` consumes any string (the path, query and fragment take whatever the
    // scheme and authority leave), so the test is `HasScheme()`: `scheme ":"` per RFC 3986.
    return /^[A-Za-z][A-Za-z0-9+\-.]*:/.test(aURL);
  }

  /**
   * Check if aHref is a valid internal hyperlink.
   *
   * @param aHref String to validate
   * @param aDestination [optional] pointer to populate with the destination page
   * @return true if aHref is a valid internal hyperlink.  Does *not* check if the destination
   *         page actually exists.
   */
  static IsGotoPageHref(aHref: string, aDestination: OutStr | null = null): boolean {
    if (!aHref.startsWith('#')) return false;

    if (aDestination) aDestination.value = aHref.slice(1);

    return true;
  }

  /**
   * Generate a href to a page in the current schematic.
   *
   * @param aDestination Destination sheet's page number.
   * @return A hyperlink href string that goes to the specified page.
   */
  static GotoPageHref(aDestination: string): string {
    return `#${aDestination}`;
  }

  getFontMetrics(): METRICS {
    return METRICS.Default();
  }

  cacheShownText(): void {
    if (this.m_text === '') {
      this.m_shown_text = '';
      this.m_shown_text_has_text_var_refs = false;
    } else {
      this.m_shown_text = unescapeString(this.m_text);
      this.m_shown_text_has_text_var_refs =
        this.m_shown_text.includes('${') || this.m_shown_text.includes('@{');
    }

    this.ClearRenderCache();
    this.ClearBoundingBoxCache();
  }

  containsURL(): boolean {
    const showntext = this.GetShownText(false);
    const markupParser = new MARKUP_PARSER(showntext);
    const root = markupParser.Parse();
    return root ? recursiveDescent(root) : false;
  }
}

/** `wxString::Cmp`: a code-unit comparison, as `wcscmp` on the wide string. */
function wxCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `operator<<( std::ostream&, const EDA_TEXT& )`. */
export function edaTextToString(aText: EDA_TEXT): string {
  return aText.GetText();
}

/**
 * `static struct EDA_TEXT_DESC` (common/eda_text.cpp): the justification enums
 * and the text properties.
 */
(() => {
  // These are defined in SCH_FIELD as well but initialization order is
  // not defined, so this needs to be conditional.  Defining in both
  // places leads to duplicate symbols.
  const h_inst = ENUM_MAP.Instance<GR_TEXT_H_ALIGN_T>('GR_TEXT_H_ALIGN_T');

  if (h_inst.Choices().GetCount() === 0) {
    h_inst.Map(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT, 'Left');
    h_inst.Map(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER, 'Center');
    h_inst.Map(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT, 'Right');
  }

  const v_inst = ENUM_MAP.Instance<GR_TEXT_V_ALIGN_T>('GR_TEXT_V_ALIGN_T');

  if (v_inst.Choices().GetCount() === 0) {
    v_inst.Map(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP, 'Top');
    v_inst.Map(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER, 'Center');
    v_inst.Map(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM, 'Bottom');
  }

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(EDA_TEXT);

  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, number>(
      EDA_TEXT,
      'Orientation',
      'SetTextAngleDegrees',
      'GetTextAngleDegrees',
      TYPE_DOUBLE,
      PROPERTY_DISPLAY.PT_DEGREE,
    ),
  );

  const textProps = 'Text Properties';

  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, string>(EDA_TEXT, 'Text', 'SetText', 'GetText', TYPE_STRING),
    textProps,
  );
  propMgr
    .AddProperty(
      new PROPERTY<EDA_TEXT, string>(EDA_TEXT, 'Font', 'SetFontProp', 'GetFontProp', TYPE_STRING),
      textProps,
    )
    .SetIsHiddenFromRulesEditor()
    .SetChoicesFunc((aItem: INSPECTABLE_ITEM): PG_CHOICES => {
      const eda_item = aItem as { Type?: () => KICAD_T };
      const fonts = new PG_CHOICES();
      // Fontconfig()->ListFonts( fontNames, language, eda_item->GetEmbeddedFonts() ):
      // the families the bundled faces provide, each once
      const fontNames: string[] = [];

      for (const f of BUNDLED_FONTS) if (!fontNames.includes(f.family)) fontNames.push(f.family);

      if (typeof eda_item.Type === 'function' && IsEeschemaType(eda_item.Type()))
        fonts.Add('Default Font');

      fonts.Add(KICAD_FONT_NAME);

      for (const fontName of fontNames) fonts.Add(fontName);

      return fonts;
    });
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, boolean>(
      EDA_TEXT,
      'Auto Thickness',
      'SetAutoThickness',
      'GetAutoThickness',
      TYPE_BOOL,
    ),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, number>(
      EDA_TEXT,
      'Thickness',
      'SetTextThickness',
      'GetTextThicknessProperty',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, boolean>(EDA_TEXT, 'Italic', 'SetItalic', 'IsItalic', TYPE_BOOL),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, boolean>(EDA_TEXT, 'Bold', 'SetBold', 'IsBold', TYPE_BOOL),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, boolean>(EDA_TEXT, 'Mirrored', 'SetMirrored', 'IsMirrored', TYPE_BOOL),
    textProps,
  );

  const isField = (aItem: INSPECTABLE_ITEM): boolean => {
    const item = aItem as { Type?: () => KICAD_T };

    if (typeof item.Type === 'function')
      return item.Type() === KICAD_T.SCH_FIELD_T || item.Type() === KICAD_T.PCB_FIELD_T;

    return false;
  };

  propMgr
    .AddProperty(
      new PROPERTY<EDA_TEXT, boolean>(EDA_TEXT, 'Visible', 'SetVisible', 'IsVisible', TYPE_BOOL),
      textProps,
    )
    .SetAvailableFunc(isField);
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, number>(
      EDA_TEXT,
      'Width',
      'SetTextWidth',
      'GetTextWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, number>(
      EDA_TEXT,
      'Height',
      'SetTextHeight',
      'GetTextHeight',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<EDA_TEXT, GR_TEXT_H_ALIGN_T>(
      EDA_TEXT,
      'Horizontal Justification',
      'SetHorizJustify',
      'GetHorizJustify',
      h_inst,
    ),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<EDA_TEXT, GR_TEXT_V_ALIGN_T>(
      EDA_TEXT,
      'Vertical Justification',
      'SetVertJustify',
      'GetVertJustify',
      v_inst,
    ),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, Color4d>(
      EDA_TEXT,
      'Color',
      'SetTextColor',
      'GetTextColor',
      TYPE_COLOR4D,
    ),
    textProps,
  );
  propMgr.AddProperty(
    new PROPERTY<EDA_TEXT, string>(
      EDA_TEXT,
      'Hyperlink',
      'SetHyperlink',
      'GetHyperlink',
      TYPE_STRING,
    ),
    textProps,
  );
})();
