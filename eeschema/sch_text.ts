// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_text.h` / `eeschema/sch_text.cpp`: `SCH_TEXT`, graphic text, and the
 * base of every label (`class SCH_TEXT : public SCH_ITEM, public EDA_TEXT`, the
 * EDA_TEXT half mixed in).
 *
 * Not here: `Plot`, `GetMsgPanelInfo`, `GetMenuImage`, `DoHypertextAction` (needs the
 * navigate tool), `ShowSyntaxHelp` (a dialog), `SCH_TEXT_DESC`.
 */

import { ResolveTextVars } from '@ziroeda/common/common.js';
import type { EDA_ITEM, OutStr } from '@ziroeda/common/eda_item.js';
import { SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FONT } from '@ziroeda/common/font/font.js';
import type { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KIUI_EllipsizeMenuText } from '@ziroeda/common/widgets/ui_common.js';
import { wxCmpNoCase, wxLess } from '@ziroeda/common/wx/wxstring.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_270,
  ANGLE_90,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_TEXT_OFFSET_RATIO } from './default_values.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

/** `MIRRORVAL`. */
const MIRRORVAL = (aPoint: number, aMirrorRef: number): number =>
  -(aPoint - aMirrorRef) + aMirrorRef;

/** The `TextVarResolver`s a text's parent offers (`SCH_SYMBOL`, `LIB_SYMBOL`, `SCH_SHEET`). */
interface TEXT_VAR_PARENT {
  ResolveTextVar(...args: unknown[]): boolean;
}

// `Replace`, `Similarity`, `Compare` and the text/draw virtuals are overloaded or
// overridden across the two bases in C++; the class carries its own forms.
export interface SCH_TEXT
  extends Omit<
    EDA_TEXT,
    | 'Replace'
    | 'Similarity'
    | 'Compare'
    | 'GetShownText'
    | 'GetDrawFont'
    | 'getFontMetrics'
    | 'Matches'
    | 'cacheShownText'
  > {
  cacheShownText(): void;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/mixins.ts
export class SCH_TEXT extends SCH_ITEM {
  protected m_excludedFromSim: boolean;

  constructor(
    aPos: VECTOR2I = { x: 0, y: 0 },
    aText = '',
    aLayer: SCH_LAYER_ID = SCH_LAYER_ID.LAYER_NOTES,
    aType: KICAD_T = KICAD_T.SCH_TEXT_T,
  ) {
    super(null, aType);
    this.initEdaText(schIUScale, aText);
    this.m_layer = aLayer;
    this.SetTextPos(aPos);
    this.SetMultilineAllowed(true);

    this.m_excludedFromSim = false;
  }

  /** `SCH_TEXT( const SCH_TEXT& aText )` as a derived copy constructor's first step. */
  protected static copyText<T extends SCH_TEXT>(aInto: T, aText: SCH_TEXT): T {
    SCH_ITEM.copySchItem(aInto, aText);
    aInto.initEdaTextFrom(aText as unknown as EDA_TEXT);
    aInto.m_excludedFromSim = aText.m_excludedFromSim;
    return aInto;
  }

  /** `operator=`: the compiler-generated one over both bases and the member. */
  assignText(aText: SCH_TEXT): this {
    this.assignSchItem(aText);
    this.assignEdaText(aText as unknown as EDA_TEXT);
    this.m_excludedFromSim = aText.m_excludedFromSim;
    return this;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_TEXT_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_TEXT';
  }

  override GetFriendlyName(): string {
    return 'Text';
  }

  GetDrawFont(aSettings: RENDER_SETTINGS | null): FONT {
    let font = EDA_TEXT.prototype.GetFont.call(this);

    if (!font) font = FONT.GetFont(this.GetDefaultFont(aSettings), this.IsBold(), this.IsItalic());

    return font;
  }

  /**
   * `GetShownText( const SCH_SHEET_PATH* aPath, bool aAllowExtraText, int aDepth )`, or
   * `GetShownText( bool aAllowExtraText, int aDepth )`, which asks for the current sheet.
   */
  GetShownText(aAllowExtraText: boolean, aDepth?: number): string;
  GetShownText(aPath: SCH_SHEET_PATH | null, aAllowExtraText: boolean, aDepth?: number): string;
  GetShownText(a: SCH_SHEET_PATH | null | boolean, b?: boolean | number, c?: number): string {
    if (typeof a === 'boolean') {
      const schematic = this.Schematic();

      if (schematic)
        return this.getShownTextOnPath(schematic.CurrentSheet(), a, (b as number) ?? 0);
      else return this.GetText();
    }

    return this.getShownTextOnPath(a, b as boolean, c ?? 0);
  }

  /** `GetShownText( const SCH_SHEET_PATH*, bool, int )`: the virtual labels override. */
  protected getShownTextOnPath(
    aPath: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    _aDepth: number,
  ): string {
    const depth = 0;
    let sheet: TEXT_VAR_PARENT | null = null;

    if (aPath) sheet = aPath.Last() as unknown as TEXT_VAR_PARENT | null;
    else if (this.Schematic())
      sheet = this.Schematic()!.CurrentSheet().Last() as unknown as TEXT_VAR_PARENT | null;

    const parent = this.m_parent;

    const textResolver = (token: OutStr): boolean => {
      if (parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) {
        if ((parent as unknown as TEXT_VAR_PARENT).ResolveTextVar(aPath, token, depth + 1))
          return true;
      } else if (parent && parent.Type() === KICAD_T.LIB_SYMBOL_T) {
        if ((parent as unknown as TEXT_VAR_PARENT).ResolveTextVar(token, depth + 1)) return true;
      }

      if (sheet) {
        if (sheet.ResolveTextVar(aPath, token, depth + 1)) return true;
      }

      return false;
    };

    let text = EDA_TEXT.prototype.GetShownText.call(this, aAllowExtraText, depth);

    if (this.HasTextVars()) text = ResolveTextVars(text, textResolver, { value: depth });

    // Convert escape markers back to literal ${} and @{} for final display
    text = text.replaceAll('<<<ESC_DOLLAR:', '${');
    text = text.replaceAll('<<<ESC_AT:', '@{');

    return text;
  }

  GetSchTextSize(): number {
    return this.GetTextWidth();
  }
  SetSchTextSize(aSize: number): void {
    this.SetTextSize({ x: aSize, y: aSize });
  }

  override HasHypertext(): boolean {
    return this.HasHyperlink() || this.containsURL();
  }

  override HasHoveredHypertext(): boolean {
    return this.m_activeUrl !== '';
  }

  override SetExcludedFromSim(
    aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromSim = aExclude;
  }

  override GetExcludedFromSim(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromSim;
  }

  /**
   * This offset depends on the orientation, the type of text, and the area required to
   * draw the associated graphic symbol or to put the text above a wire.
   *
   * @return the offset between the SCH_TEXT position and the text itself position
   */
  GetSchematicTextOffset(_aSettings: RENDER_SETTINGS | null): VECTOR2I {
    return { x: 0, y: -2500 };
  }

  override GetBoundingBox(): BOX2I {
    const bbox = this.GetTextBox(null).Clone();

    if (!this.GetTextAngle().IsZero()) {
      // Rotate bbox.
      const pos = RotatePoint(bbox.GetOrigin(), this.GetTextPos(), this.GetTextAngle());
      const end = RotatePoint(bbox.GetEnd(), this.GetTextPos(), this.GetTextAngle());

      bbox.SetOrigin(pos);
      bbox.SetEnd(end);
    }

    bbox.Normalize();
    return bbox;
  }

  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const other = aItem as SCH_TEXT;

    if (this.GetLayer() !== other.GetLayer()) return this.GetLayer() < other.GetLayer();

    if (this.GetPosition().x !== other.GetPosition().x)
      return this.GetPosition().x < other.GetPosition().x;

    if (this.GetPosition().y !== other.GetPosition().y)
      return this.GetPosition().y < other.GetPosition().y;

    // `return GetExcludedFromSim() - other->GetExcludedFromSim();`: the int difference as a
    // bool, so any difference answers true.
    if (this.GetExcludedFromSim() !== other.GetExcludedFromSim()) return true;

    return wxLess(this.GetText(), other.GetText());
  }

  GetTextOffset(
    aSettings: (RENDER_SETTINGS & { m_TextOffsetRatio?: number }) | null = null,
  ): number {
    let ratio: number;

    if (aSettings && aSettings.m_TextOffsetRatio !== undefined) ratio = aSettings.m_TextOffsetRatio;
    else if (this.Schematic()) ratio = this.Schematic()!.Settings().m_TextOffsetRatio;
    else ratio = DEFAULT_TEXT_OFFSET_RATIO; // For previews (such as in Preferences), etc.

    return KiROUND(ratio * this.GetTextSize().y);
  }

  override GetPenWidth(): number {
    return this.GetEffectiveTextPenWidth();
  }

  override Move(aMoveVector: VECTOR2I): void {
    EDA_TEXT.prototype.Offset.call(this, aMoveVector);
  }

  /**
   * Move the text so that its justification is centred (or back, with \a inverse):
   * the mirror and rotate transforms of device-layer text work on the centred form.
   */
  NormalizeJustification(inverse: boolean): void {
    if (
      this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER &&
      this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
    )
      return;

    const delta = { x: 0, y: 0 };
    const bbox = this.GetTextBox(null);

    // integer division truncates toward zero
    const half = (v: number): number => Math.trunc(v / 2);

    if (this.GetTextAngle().IsHorizontal()) {
      if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
        delta.x = half(bbox.GetWidth());
      else if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        delta.x = half(-bbox.GetWidth());

      if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
        delta.y = half(-bbox.GetHeight());
      else if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
        delta.y = half(bbox.GetHeight());
    } else {
      if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
        delta.y = half(bbox.GetWidth());
      else if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        delta.y = half(-bbox.GetWidth());

      if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
        delta.x = half(bbox.GetHeight());
      else if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
        delta.x = half(-bbox.GetHeight());
    }

    const pos = this.GetTextPos();

    if (inverse) this.SetTextPos({ x: pos.x - delta.x, y: pos.y - delta.y });
    else this.SetTextPos({ x: pos.x + delta.x, y: pos.y + delta.y });
  }

  override MirrorHorizontally(aCenter: number): void {
    if (this.m_layer === SCH_LAYER_ID.LAYER_DEVICE) {
      this.NormalizeJustification(false);
      let x = this.GetTextPos().x;

      x -= aCenter;
      x *= -1;
      x += aCenter;

      if (this.GetTextAngle().IsHorizontal()) {
        if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
          this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
          this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      } else {
        if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
          this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
        else if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
          this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      }

      this.SetTextX(x);
      this.NormalizeJustification(true);
    } else {
      if (this.GetTextAngle().equals(ANGLE_HORIZONTAL)) this.FlipHJustify();

      this.SetTextX(MIRRORVAL(this.GetTextPos().x, aCenter));
    }
  }

  override MirrorVertically(aCenter: number): void {
    if (this.m_layer === SCH_LAYER_ID.LAYER_DEVICE) {
      this.NormalizeJustification(false);
      let y = this.GetTextPos().y;

      y -= aCenter;
      y *= -1;
      y += aCenter;

      if (this.GetTextAngle().IsHorizontal()) {
        if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
          this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
        else if (this.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
          this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      } else {
        if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
          this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
          this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      }

      this.SetTextY(y);
      this.NormalizeJustification(true);
    } else {
      if (this.GetTextAngle().equals(ANGLE_VERTICAL)) this.FlipHJustify();

      this.SetTextY(MIRRORVAL(this.GetTextPos().y, aCenter));
    }
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    const pt = RotatePoint(this.GetTextPos(), aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
    const offset = { x: pt.x - this.GetTextPos().x, y: pt.y - this.GetTextPos().y };

    this.Rotate90(false);

    const pos = this.GetTextPos();
    this.SetTextPos({ x: pos.x + offset.x, y: pos.y + offset.y });
  }

  Rotate90(aClockwise: boolean): void {
    if (
      (this.GetTextAngle().equals(ANGLE_HORIZONTAL) && aClockwise) ||
      (this.GetTextAngle().equals(ANGLE_VERTICAL) && !aClockwise)
    ) {
      this.FlipHJustify();
    }

    this.SetTextAngle(
      this.GetTextAngle().equals(ANGLE_VERTICAL) ? ANGLE_HORIZONTAL : ANGLE_VERTICAL,
    );
  }

  MirrorSpinStyle(aLeftRight: boolean): void {
    if (
      (this.GetTextAngle().equals(ANGLE_HORIZONTAL) && aLeftRight) ||
      (this.GetTextAngle().equals(ANGLE_VERTICAL) && !aLeftRight)
    ) {
      this.FlipHJustify();
    }
  }

  override BeginEdit(aPosition: VECTOR2I): void {
    this.SetTextPos(aPosition);
  }

  override CalcEdit(aPosition: VECTOR2I): void {
    this.SetTextPos(aPosition);
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    return this.matchesText(this.GetText(), aSearchData);
  }

  override Replace(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown = null): boolean {
    return EDA_TEXT.prototype.Replace.call(this, aSearchData);
  }

  override IsReplaceable(): boolean {
    return true;
  }

  override ViewGetLayers(): number[] {
    if (this.IsPrivate())
      return [SCH_LAYER_ID.LAYER_PRIVATE_NOTES, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS];

    return [this.m_layer, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS];
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Graphic Text '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}'`;
  }

  override GetPosition(): VECTOR2I {
    return EDA_TEXT.prototype.GetTextPos.call(this);
  }

  override SetPosition(aPosition: VECTOR2I): void {
    EDA_TEXT.prototype.SetTextPos.call(this, aPosition);
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) {
      if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

      const bBox = this.GetBoundingBox();

      // Upstream inflates a copy of the rectangle, then tests the original.
      const rect = new BOX2I(a.GetPosition(), a.GetSize());
      rect.Inflate(c ?? 0);

      if (b as boolean) return a.Contains(bBox);

      return a.Intersects(bBox);
    }

    if ('x' in a && 'y' in a) {
      const bBox = this.GetBoundingBox();
      bBox.Inflate((b as number | undefined) ?? 0);
      return bBox.Contains(a);
    }

    if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

    return KIGEOM_BoxHitTestChain(a, this.GetBoundingBox(), b as boolean);
  }

  /**
   * The offset that lines an outline-font text's first line up with a SCH_FIELD's (fields
   * are drawn from their centre).
   */
  GetOffsetToMatchSCH_FIELD(aRenderSettings: RENDER_SETTINGS | null): VECTOR2I {
    // Q: Why is this needed?
    // A: The text in a SCH_TEXT is aligned to the baseline, while the text in a SCH_FIELD is
    //    aligned to the center.  For stroke fonts this doesn't matter, but for outline fonts
    //    it does.
    if (this.GetDrawFont(aRenderSettings).IsOutline()) {
      const firstLineBBox = this.GetTextBox(aRenderSettings, 0);
      const sizeDiff = firstLineBBox.GetHeight() - this.GetTextSize().y;
      const adjust = KiROUND(sizeDiff * 0.4);

      return RotatePoint({ x: 0, y: -adjust }, this.GetDrawRotation());
    }

    return { x: 0, y: 0 };
  }

  override Clone(): SCH_TEXT {
    return SCH_TEXT.copyText(new SCH_TEXT(), this);
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (this.Type() !== aOther.Type()) return 0.0;

    const other = aOther as SCH_TEXT;
    let retval = this.SimilarityBase(aOther);

    if (this.GetLayer() !== other.GetLayer()) retval *= 0.9;

    if (this.GetExcludedFromSim() !== other.GetExcludedFromSim()) retval *= 0.9;

    retval *= EDA_TEXT.prototype.Similarity.call(this, other as unknown as EDA_TEXT);

    return retval;
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const other = aOther as SCH_TEXT;

    if (this.GetLayer() !== other.GetLayer()) return false;

    if (this.GetExcludedFromSim() !== other.GetExcludedFromSim()) return false;

    return this.equalsEdaText(other as unknown as EDA_TEXT);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    const item = aItem as SCH_TEXT;

    this.SwapText(item as unknown as EDA_TEXT);
    this.SwapAttributes(item as unknown as EDA_TEXT);
  }

  getFontMetrics(): METRICS {
    return this.GetFontMetrics();
  }

  override compare(aOther: SCH_ITEM, aCompareFlags = 0): number {
    const retv = super.compare(aOther, aCompareFlags);

    if (retv) return retv;

    const tmp = aOther as SCH_TEXT;

    const result = wxCmpNoCase(this.GetText(), tmp.GetText());

    if (result !== 0) return result;

    if (this.GetTextPos().x !== tmp.GetTextPos().x) return this.GetTextPos().x - tmp.GetTextPos().x;

    if (this.GetTextPos().y !== tmp.GetTextPos().y) return this.GetTextPos().y - tmp.GetTextPos().y;

    if (this.GetTextWidth() !== tmp.GetTextWidth()) return this.GetTextWidth() - tmp.GetTextWidth();

    if (this.GetTextHeight() !== tmp.GetTextHeight())
      return this.GetTextHeight() - tmp.GetTextHeight();

    return 0;
  }
}

applyMixins(SCH_TEXT, [EDA_TEXT]);
