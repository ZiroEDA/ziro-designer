// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_textbox.h` / `eeschema/sch_textbox.cpp`: `SCH_TEXTBOX`, a rectangle
 * that wraps text (`class SCH_TEXTBOX : public SCH_SHAPE, public EDA_TEXT`, the EDA_TEXT
 * half mixed in). Also the base of `SCH_TABLECELL`.
 *
 * Not here: `Plot`, `Print`, `GetMsgPanelInfo`, `GetMenuImage`, `DoHypertextAction`,
 * `Serialize`/`Deserialize`, `SCH_TEXTBOX_DESC`.
 */

import { ResolveTextVars } from '@ziroeda/common/common.js';
import type { EDA_ITEM, OutStr } from '@ziroeda/common/eda_item.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
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
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_ITEM } from './sch_item.js';
import { SCH_SHAPE } from './sch_shape.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

// `Replace`, `Similarity`, `Compare` and the text virtuals are overloaded across the two
// bases in C++; the class carries its own forms.
export interface SCH_TEXTBOX
  extends Omit<
    EDA_TEXT,
    | 'Replace'
    | 'Similarity'
    | 'Compare'
    | 'GetShownText'
    | 'GetDrawFont'
    | 'getFontMetrics'
    | 'GetDrawPos'
    | 'Matches'
  > {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/mixins.ts
export class SCH_TEXTBOX extends SCH_SHAPE {
  protected m_excludedFromSim: boolean;
  protected m_marginLeft: number;
  protected m_marginTop: number;
  protected m_marginRight: number;
  protected m_marginBottom: number;

  constructor(
    aLayer: SCH_LAYER_ID = SCH_LAYER_ID.LAYER_NOTES,
    aLineWidth = 0,
    aFillType: FILL_T = FILL_T.NO_FILL,
    aText = '',
    aType: KICAD_T = KICAD_T.SCH_TEXTBOX_T,
  ) {
    super(SHAPE_T.RECTANGLE, aLayer, aLineWidth, aFillType, aType);
    this.initEdaText(schIUScale, aText);

    this.m_layer = aLayer;
    this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
    this.SetMultilineAllowed(true);

    this.m_excludedFromSim = false;

    const defaultMargin = this.GetLegacyTextMargin();
    this.m_marginLeft = defaultMargin;
    this.m_marginTop = defaultMargin;
    this.m_marginRight = defaultMargin;
    this.m_marginBottom = defaultMargin;
  }

  /** `SCH_TEXTBOX( const SCH_TEXTBOX& aText )` as a derived copy's step. */
  protected static copyTextBox<T extends SCH_TEXTBOX>(aInto: T, aText: SCH_TEXTBOX): T {
    SCH_SHAPE.copyShape(aInto, aText);
    aInto.initEdaTextFrom(aText as unknown as EDA_TEXT);
    aInto.m_excludedFromSim = aText.m_excludedFromSim;
    aInto.m_marginLeft = aText.m_marginLeft;
    aInto.m_marginTop = aText.m_marginTop;
    aInto.m_marginRight = aText.m_marginRight;
    aInto.m_marginBottom = aText.m_marginBottom;
    return aInto;
  }

  static override ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_TEXTBOX_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_TEXTBOX';
  }

  GetLegacyTextMargin(): number {
    if (this.m_layer === SCH_LAYER_ID.LAYER_DEVICE) return KiROUND(this.GetTextSize().y * 0.8);
    else return KiROUND(this.GetStroke().GetWidth() / 2.0) + KiROUND(this.GetTextSize().y * 0.75);
  }

  /** The smallest box the text fits in, margins included: the text box's height only. */
  GetMinSize(): VECTOR2I {
    if (this.GetText() === '') return { x: 0, y: 0 };

    const textBox = this.GetTextBox(null);
    let textHeight = Math.abs(textBox.GetHeight());

    if (this.GetTextAngle().IsVertical()) {
      textHeight += this.GetMarginLeft() + this.GetMarginRight();
      return { x: textHeight, y: 0 };
    }

    textHeight += this.GetMarginTop() + this.GetMarginBottom();
    return { x: 0, y: textHeight };
  }

  SetMarginLeft(aLeft: number): void {
    this.m_marginLeft = aLeft;
  }
  SetMarginTop(aTop: number): void {
    this.m_marginTop = aTop;
  }
  SetMarginRight(aRight: number): void {
    this.m_marginRight = aRight;
  }
  SetMarginBottom(aBottom: number): void {
    this.m_marginBottom = aBottom;
  }

  GetMarginLeft(): number {
    return this.m_marginLeft;
  }
  GetMarginTop(): number {
    return this.m_marginTop;
  }
  GetMarginRight(): number {
    return this.m_marginRight;
  }
  GetMarginBottom(): number {
    return this.m_marginBottom;
  }

  GetSchTextSize(): number {
    return this.GetTextWidth();
  }
  SetSchTextSize(aSize: number): void {
    this.SetTextSize({ x: aSize, y: aSize });
  }

  GetDrawPos(): VECTOR2I {
    const bbox = new BOX2I(this.m_start, {
      x: this.m_end.x - this.m_start.x,
      y: this.m_end.y - this.m_start.y,
    });
    bbox.Normalize();

    const pos = {
      x: bbox.GetLeft() + this.m_marginLeft,
      y: bbox.GetBottom() - this.m_marginBottom,
    };
    const mid = (a: number, b: number): number => Math.trunc((a + b) / 2);

    if (this.GetTextAngle().IsVertical()) {
      switch (this.GetHorizJustify()) {
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
          pos.y = bbox.GetBottom() - this.m_marginBottom;
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
          pos.y = mid(bbox.GetTop(), bbox.GetBottom());
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
          pos.y = bbox.GetTop() + this.m_marginTop;
          break;
        default:
          break; // wxFAIL_MSG: Indeterminate state legal only in dialogs.
      }

      switch (this.GetVertJustify()) {
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
          pos.x = bbox.GetLeft() + this.m_marginLeft;
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
          pos.x = mid(bbox.GetLeft(), bbox.GetRight());
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
          pos.x = bbox.GetRight() - this.m_marginRight;
          break;
        default:
          break;
      }
    } else {
      switch (this.GetHorizJustify()) {
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
          pos.x = bbox.GetLeft() + this.m_marginLeft;
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
          pos.x = mid(bbox.GetLeft(), bbox.GetRight());
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
          pos.x = bbox.GetRight() - this.m_marginRight;
          break;
        default:
          break;
      }

      switch (this.GetVertJustify()) {
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
          pos.y = bbox.GetTop() + this.m_marginTop;
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
          pos.y = mid(bbox.GetTop(), bbox.GetBottom());
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
          pos.y = bbox.GetBottom() - this.m_marginBottom;
          break;
        default:
          break;
      }
    }

    return pos;
  }

  GetDrawFont(aSettings: RENDER_SETTINGS | null): FONT {
    let font = EDA_TEXT.prototype.GetFont.call(this);

    if (!font) font = FONT.GetFont(this.GetDefaultFont(aSettings), this.IsBold(), this.IsItalic());

    return font;
  }

  /**
   * `GetShownText( const RENDER_SETTINGS*, const SCH_SHEET_PATH*, bool, int )` (line-broken
   * to the box's column width), or `GetShownText( bool aAllowExtraText, int aDepth )`
   * which asks for the current sheet.
   */
  GetShownText(aAllowExtraText: boolean, aDepth?: number): string;
  GetShownText(
    aSettings: RENDER_SETTINGS | null,
    aPath: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    aDepth?: number,
  ): string;
  GetShownText(
    a: RENDER_SETTINGS | null | boolean,
    b?: SCH_SHEET_PATH | null | number,
    c?: boolean,
    _d?: number,
  ): string {
    if (typeof a === 'boolean') {
      const schematic = this.Schematic();
      const sheetPath = schematic ? schematic.CurrentSheet() : null;

      return this.GetShownText(null, sheetPath, a, (b as number | undefined) ?? 0);
    }

    const aSettings = a;
    const aPath = (b as SCH_SHEET_PATH | null | undefined) ?? null;
    const aAllowExtraText = c ?? false;

    const depth = 0;
    const sheet = aPath ? aPath.Last() : null;

    const textResolver = (token: OutStr): boolean => {
      if (sheet) {
        if (sheet.ResolveTextVar(aPath, token, depth + 1)) return true;
      }

      return false;
    };

    let text = EDA_TEXT.prototype.GetShownText.call(this, aAllowExtraText, depth);

    if (this.HasTextVars()) text = ResolveTextVars(text, textResolver, { value: depth });

    const size = { x: this.GetEnd().x - this.GetStart().x, y: this.GetEnd().y - this.GetStart().y };
    let colWidth: number;

    if (this.GetTextAngle().IsVertical())
      colWidth = Math.abs(size.y) - (this.GetMarginTop() + this.GetMarginBottom());
    else colWidth = Math.abs(size.x) - (this.GetMarginLeft() + this.GetMarginRight());

    const wrapped = { value: text };
    this.GetDrawFont(aSettings).LinebreakText(
      wrapped,
      colWidth,
      this.GetTextSize(),
      this.GetEffectiveTextPenWidth(),
      this.IsBold(),
      this.IsItalic(),
    );
    text = wrapped.value;

    // Convert escape markers back to literal ${} and @{} for final display
    text = text.replaceAll('<<<ESC_DOLLAR:', '${');
    text = text.replaceAll('<<<ESC_AT:', '@{');

    return text;
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

  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const other = aItem as SCH_TEXTBOX;

    if (this.GetLayer() !== other.GetLayer()) return this.GetLayer() < other.GetLayer();

    if (this.GetPosition().x !== other.GetPosition().x)
      return this.GetPosition().x < other.GetPosition().x;

    if (this.GetPosition().y !== other.GetPosition().y)
      return this.GetPosition().y < other.GetPosition().y;

    if (this.GetMarginLeft() !== other.GetMarginLeft())
      return this.GetMarginLeft() < other.GetMarginLeft();

    if (this.GetMarginTop() !== other.GetMarginTop())
      return this.GetMarginTop() < other.GetMarginTop();

    if (this.GetMarginRight() !== other.GetMarginRight())
      return this.GetMarginRight() < other.GetMarginRight();

    if (this.GetMarginBottom() !== other.GetMarginBottom())
      return this.GetMarginBottom() < other.GetMarginBottom();

    // the int difference as a bool: any difference answers true
    if (this.GetExcludedFromSim() !== other.GetExcludedFromSim()) return true;

    return wxLess(this.GetText(), other.GetText());
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.move(aMoveVector);
    EDA_TEXT.prototype.Offset.call(this, aMoveVector);
  }

  override MirrorHorizontally(aCenter: number): void {
    // Text is NOT really mirrored; it just has its justification flipped
    super.MirrorHorizontally(aCenter);

    if (this.GetTextAngle().equals(ANGLE_HORIZONTAL)) {
      if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
      else if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    }
  }

  override MirrorVertically(aCenter: number): void {
    // Text is NOT really mirrored; it just has its justification flipped
    super.MirrorVertically(aCenter);

    if (this.GetTextAngle().equals(ANGLE_VERTICAL)) {
      if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
      else if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    }
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    super.Rotate(aCenter, aRotateCCW);
    this.SetTextAngle(
      this.GetTextAngle().equals(ANGLE_VERTICAL) ? ANGLE_HORIZONTAL : ANGLE_VERTICAL,
    );
  }

  Rotate90(_aClockwise: boolean): void {
    this.SetTextAngle(
      this.GetTextAngle().equals(ANGLE_VERTICAL) ? ANGLE_HORIZONTAL : ANGLE_VERTICAL,
    );
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
      const rect = new BOX2I(a.GetPosition(), a.GetSize());
      rect.Inflate(c ?? 0);

      if (b as boolean) return rect.Contains(this.GetBoundingBox());

      return rect.Intersects(this.GetBoundingBox());
    }

    if ('x' in a && 'y' in a) {
      const rect = this.GetBoundingBox();
      rect.Inflate((b as number | undefined) ?? 0);
      return rect.Contains(a);
    }

    return KIGEOM_BoxHitTestChain(a, this.GetBoundingBox(), b as boolean);
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

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Text box '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}'`;
  }

  override Clone(): SCH_TEXTBOX {
    return SCH_TEXTBOX.copyTextBox(new SCH_TEXTBOX(), this);
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as SCH_TEXTBOX;

    let similarity = this.SimilarityBase(other);

    if (this.m_excludedFromSim !== other.m_excludedFromSim) similarity *= 0.9;

    if (this.GetMarginLeft() !== other.GetMarginLeft()) similarity *= 0.9;

    if (this.GetMarginTop() !== other.GetMarginTop()) similarity *= 0.9;

    if (this.GetMarginRight() !== other.GetMarginRight()) similarity *= 0.9;

    if (this.GetMarginBottom() !== other.GetMarginBottom()) similarity *= 0.9;

    similarity *= super.Similarity(aOther);
    similarity *= EDA_TEXT.prototype.Similarity.call(this, other as unknown as EDA_TEXT);

    return similarity;
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const other = aOther as SCH_TEXTBOX;

    if (this.m_excludedFromSim !== other.m_excludedFromSim) return false;

    if (this.GetMarginLeft() !== other.GetMarginLeft()) return false;

    if (this.GetMarginTop() !== other.GetMarginTop()) return false;

    if (this.GetMarginRight() !== other.GetMarginRight()) return false;

    if (this.GetMarginBottom() !== other.GetMarginBottom()) return false;

    return super.equals(aOther) && this.equalsEdaText(other as unknown as EDA_TEXT);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    super.swapData(aItem);

    const item = aItem as SCH_TEXTBOX;

    [this.m_marginLeft, item.m_marginLeft] = [item.m_marginLeft, this.m_marginLeft];
    [this.m_marginTop, item.m_marginTop] = [item.m_marginTop, this.m_marginTop];
    [this.m_marginRight, item.m_marginRight] = [item.m_marginRight, this.m_marginRight];
    [this.m_marginBottom, item.m_marginBottom] = [item.m_marginBottom, this.m_marginBottom];

    this.SwapText(item as unknown as EDA_TEXT);
    this.SwapAttributes(item as unknown as EDA_TEXT);
  }

  getFontMetrics(): METRICS {
    return this.GetFontMetrics();
  }

  override compare(aOther: SCH_ITEM, aCompareFlags = 0): number {
    const retv = super.compare(aOther, aCompareFlags);

    if (retv) return retv;

    const tmp = aOther as SCH_TEXTBOX;

    const result = wxCmpNoCase(this.GetText(), tmp.GetText());

    if (result !== 0) return result;

    if (this.GetTextWidth() !== tmp.GetTextWidth()) return this.GetTextWidth() - tmp.GetTextWidth();

    if (this.GetTextHeight() !== tmp.GetTextHeight())
      return this.GetTextHeight() - tmp.GetTextHeight();

    if (this.IsBold() !== tmp.IsBold()) return Number(this.IsBold()) - Number(tmp.IsBold());

    if (this.IsItalic() !== tmp.IsItalic()) return Number(this.IsItalic()) - Number(tmp.IsItalic());

    if (this.GetHorizJustify() !== tmp.GetHorizJustify())
      return this.GetHorizJustify() - tmp.GetHorizJustify();

    if (this.GetTextAngle().AsTenthsOfADegree() !== tmp.GetTextAngle().AsTenthsOfADegree())
      return this.GetTextAngle().AsTenthsOfADegree() - tmp.GetTextAngle().AsTenthsOfADegree();

    if (this.GetMarginLeft() !== tmp.GetMarginLeft())
      return this.GetMarginLeft() - tmp.GetMarginLeft();

    if (this.GetMarginTop() !== tmp.GetMarginTop()) return this.GetMarginTop() - tmp.GetMarginTop();

    if (this.GetMarginRight() !== tmp.GetMarginRight())
      return this.GetMarginRight() - tmp.GetMarginRight();

    if (this.GetMarginBottom() !== tmp.GetMarginBottom())
      return this.GetMarginBottom() - tmp.GetMarginBottom();

    return 0;
  }
}

applyMixins(SCH_TEXTBOX, [EDA_TEXT]);
