// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_text.h` / `pcbnew/pcb_text.cpp`: `PCB_TEXT`, board text —
 * `class PCB_TEXT : public BOARD_ITEM, public EDA_TEXT`, the EDA_TEXT half
 * mixed in.
 *
 * Not here: `Serialize`/`Deserialize` (protobuf), `ShowSyntaxHelp` (a
 * dialog) and `PCB_TEXT_DESC`.
 */

import { ResolveTextVars, type TextVarResolverFn } from '@ziroeda/common/common.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  NO_SETTER,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_OPT_INT,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { OutStr } from '@ziroeda/common/font/font.js';
import type { FONT } from '@ziroeda/common/font/font.js';
import type { METRICS } from '@ziroeda/common/font/font_metrics.js';
import type {
  GR_TEXT_H_ALIGN_T,
  GR_TEXT_V_ALIGN_T,
  TEXT_ATTRIBUTES,
} from '@ziroeda/common/font/text_attributes.js';
import { CALLBACK_GAL } from '@ziroeda/common/callback_gal.js';
import { GetKnockoutTextMargin } from '@ziroeda/common/gr_text.js';
import {
  FLASHING,
  GAL_LAYER_ID,
  IsBackLayer,
  IsFrontLayer,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import {
  KIUI_EllipsizeMenuText,
  KIUI_EllipsizeStatusText,
} from '@ziroeda/common/widgets/ui_common.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { FLIP_DIRECTION, MIRRORVAL } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import {
  ANGLE_180,
  ANGLE_90,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
  type EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChainRotated } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  SHAPE_POLY_SET,
  TransformOvalToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD_DESIGN_SETTINGS } from './board_design_settings.js';
import { BOARD_ITEM } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';

export interface PCB_TEXT_KNOCKOUT_CACHE_DATA {
  text: string;
  text_attrs: TEXT_ATTRIBUTES;
  angle: EDA_ANGLE;
  pos: VECTOR2I;
  cache: SHAPE_POLY_SET;
}

// `Replace` and `Similarity` are overloaded across the two bases in C++; the class carries both
// forms, so the merged interface leaves the EDA_TEXT ones out.
// `ClearRenderCache` is re-declared as a method so that a derived class (PCB_DIMENSION_BASE)
// can override it: a mapped type carries it as a property, which TS will not let a method
// override.
export interface PCB_TEXT
  extends Omit<EDA_TEXT, 'Replace' | 'Similarity' | 'Compare' | 'ClearRenderCache'> {
  ClearRenderCache(): void;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/mixins.ts
export class PCB_TEXT extends BOARD_ITEM {
  private m_knockout_cache: PCB_TEXT_KNOCKOUT_CACHE_DATA | null = null;

  /**
   * `PCB_TEXT( BOARD_ITEM* parent, KICAD_T idtype )`, or `PCB_TEXT( FOOTPRINT* aParent, KICAD_T idtype )`
   * when `aParent` is a footprint: the footprint form keeps the text upright, puts it on the
   * silkscreen of the footprint's side and at the footprint's position.
   */
  constructor(parent: BOARD_ITEM | null, idtype: KICAD_T = KICAD_T.PCB_TEXT_T) {
    super(parent, idtype);
    this.initEdaText(pcbIUScale);

    if (parent && parent.Type() === KICAD_T.PCB_FOOTPRINT_T) {
      const aParent = parent as FOOTPRINT;

      this.SetKeepUpright(true);

      // N.B. Do not automatically set text effects
      // These are optional in the file format and so need to be defaulted to off.

      this.SetLayer(PCB_LAYER_ID.F_SilkS);

      this.SetTextPos(aParent.GetPosition());

      if (IsBackLayer(aParent.GetLayer())) this.SetLayer(PCB_LAYER_ID.B_SilkS);
    } else {
      this.SetMultilineAllowed(true);
    }
  }

  /** `PCB_TEXT( const PCB_TEXT& aOther )`. */
  static copyOf(aOther: PCB_TEXT): PCB_TEXT {
    const copy = new PCB_TEXT(null, aOther.Type());
    BOARD_ITEM.copyBase(copy, aOther);
    copy.initEdaTextFrom(aOther as unknown as EDA_TEXT);
    return copy;
  }

  /** `operator=( const PCB_TEXT& aOther )`. */
  assignPcbText(aOther: PCB_TEXT): this {
    if (this === aOther) return this;

    this.assignBoardItem(aOther);
    this.assignEdaText(aOther as unknown as EDA_TEXT);

    this.m_knockout_cache = null;

    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_TEXT_T)) return; // wxCHECK

    this.assignPcbText(aOther as PCB_TEXT);
  }

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_TEXT_T === aItem.Type();
  }

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    if (BOARD_ITEM.prototype.IsType.call(this, aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.PCB_LOCATE_TEXT_T) return true;
    }

    return false;
  }

  override StyleFromSettings(settings: BOARD_DESIGN_SETTINGS, aCheckSide: boolean): void {
    this.SetTextSize(settings.GetTextSize(this.GetLayer()));
    this.SetTextThickness(settings.GetTextThickness(this.GetLayer()));
    this.SetItalic(settings.GetTextItalic(this.GetLayer()));

    if (this.GetParentFootprint()) this.SetKeepUpright(settings.GetTextUpright(this.GetLayer()));

    if (aCheckSide) {
      const board = this.GetBoard();

      if (board) this.SetMirrored(board.IsBackLayer(this.GetLayer()));
      else this.SetMirrored(IsBackLayer(this.GetLayer()));
    }
  }

  /**
   * Called when rotating the parent footprint.
   */
  KeepUpright(): void {
    if (!this.IsKeepUpright()) return;

    const newAngle = this.GetTextAngle().Clone();
    newAngle.Normalize();

    const needsFlipped = newAngle.AsDegrees() >= ANGLE_180.AsDegrees();

    if (needsFlipped) {
      this.SetHorizJustify(-this.GetHorizJustify() as GR_TEXT_H_ALIGN_T);
      this.SetVertJustify(-this.GetVertJustify() as GR_TEXT_V_ALIGN_T);
      const flipped = newAngle.add(ANGLE_180);
      flipped.Normalize();
      this.SetTextAngle(flipped);
    }
  }

  GetShownText(aAllowExtraText: boolean, aDepth = 0): string {
    const parentFootprint = this.GetParentFootprint();
    const board = this.GetBoard();

    const resolver: TextVarResolverFn = (token) => {
      if (token.value === 'LAYER') {
        token.value = this.GetLayerName();
        return true;
      }

      if (parentFootprint && parentFootprint.ResolveTextVar(token, aDepth + 1)) return true;

      // board can be null in some cases when saving a footprint in FP editor
      if (board && board.ResolveTextVar(token, aDepth + 1)) return true;

      return false;
    };

    let text = EDA_TEXT.prototype.GetShownText.call(this, aAllowExtraText, aDepth);

    if (this.HasTextVars()) text = ResolveTextVars(text, resolver, { value: aDepth });

    // Convert escape markers back to literal ${} and @{} for final display
    text = text.replaceAll('<<<ESC_DOLLAR:', '${');
    text = text.replaceAll('<<<ESC_AT:', '@{');

    return text;
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    return this.matchesText(unescapeString(this.GetText()), aSearchData);
  }

  /** `Replace( aSearchData, aAuxData )`: `EDA_TEXT::Replace( aSearchData )`. */
  override Replace(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown = null): boolean {
    return EDA_TEXT.prototype.Replace.call(this, aSearchData);
  }

  override GetPosition(): VECTOR2I {
    return this.GetTextPos();
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.SetTextPos(aPos);
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.Offset(aMoveVector);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    const pt = RotatePoint(this.GetTextPos(), aRotCentre, aAngle);
    this.SetTextPos(pt);

    const new_angle = this.GetTextAngle().add(aAngle);
    new_angle.Normalize();
    this.SetTextAngle(new_angle);
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // the position and justification are mirrored, but not the text itself

    if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM) {
      if (this.GetTextAngle().equals(ANGLE_VERTICAL))
        this.SetHorizJustify(-this.GetHorizJustify() as GR_TEXT_H_ALIGN_T);

      this.SetTextY(MIRRORVAL(this.GetTextPos().y, aCentre.y));
    } else {
      if (this.GetTextAngle().equals(ANGLE_HORIZONTAL))
        this.SetHorizJustify(-this.GetHorizJustify() as GR_TEXT_H_ALIGN_T);

      this.SetTextX(MIRRORVAL(this.GetTextPos().x, aCentre.x));
    }
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      this.SetTextX(MIRRORVAL(this.GetTextPos().x, aCentre.x));
      this.SetTextAngle(this.GetTextAngle().negate());
    } else {
      this.SetTextY(MIRRORVAL(this.GetTextPos().y, aCentre.y));
      this.SetTextAngle(ANGLE_180.sub(this.GetTextAngle()));
    }

    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));

    if (this.IsSideSpecific()) this.SetMirrored(!this.IsMirrored());
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const parentFP = this.GetParentFootprint();

    if (parentFP && aFrame.GetName() === PCB_EDIT_FRAME_NAME)
      aList.push(new MSG_PANEL_ITEM('Footprint', parentFP.GetReference()));

    // Don't use GetShownText() here; we want to show the user the variable references
    let value = this.GetText();

    if (parentFP) {
      if (this.Type() === KICAD_T.PCB_FIELD_T) {
        // dynamic_cast<PCB_FIELD*>( this )
        const field = this as unknown as { GetName(): string };
        let variant = '';

        const board = this.GetBoard();

        if (board) variant = board.GetCurrentVariant();

        value = parentFP.GetFieldValueForVariant(variant, field.GetName());
      }

      aList.push(new MSG_PANEL_ITEM('Text', KIUI_EllipsizeStatusText(aFrame, value)));
    } else {
      aList.push(new MSG_PANEL_ITEM('PCB Text', KIUI_EllipsizeStatusText(aFrame, value)));
    }

    if (parentFP) aList.push(new MSG_PANEL_ITEM('Type', this.GetTextTypeDescription()));

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME && this.IsLocked())
      aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));

    aList.push(new MSG_PANEL_ITEM('Layer', this.GetLayerName()));
    aList.push(new MSG_PANEL_ITEM('Mirror', this.IsMirrored() ? 'Yes' : 'No'));
    aList.push(new MSG_PANEL_ITEM('Angle', `${this.GetTextAngle().AsDegrees()}`));

    aList.push(new MSG_PANEL_ITEM('Font', this.GetFont() ? this.GetFont()!.GetName() : 'Default'));

    const units = aFrame;

    if (this.GetTextThickness())
      aList.push(
        new MSG_PANEL_ITEM(
          'Text Thickness',
          units.MessageTextFromValue(this.GetEffectiveTextPenWidth()),
        ),
      );
    else aList.push(new MSG_PANEL_ITEM('Text Thickness', 'Auto'));

    aList.push(new MSG_PANEL_ITEM('Width', units.MessageTextFromValue(this.GetTextWidth())));
    aList.push(new MSG_PANEL_ITEM('Height', units.MessageTextFromValue(this.GetTextHeight())));
  }

  TextHitTest(aPoint: VECTOR2I, aAccuracy?: number): boolean;
  TextHitTest(aRect: BOX2I, aContains: boolean, aAccuracy?: number): boolean;
  TextHitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  TextHitTest(a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN, b?: number | boolean, c?: number): boolean {
    if (a instanceof BOX2I) {
      const aContains = b as boolean;
      const aAccuracy = c ?? 0;
      const rect = new BOX2I(a.GetOrigin(), a.GetSize());
      rect.Inflate(aAccuracy);

      if (aContains) return rect.Contains(this.GetBoundingBox());

      return rect.Intersects(this.GetBoundingBox());
    }

    if (a instanceof SHAPE_LINE_CHAIN) {
      const aContained = b as boolean;
      const rect = this.GetTextBox(null);

      if (this.IsKnockout()) rect.Inflate(this.getKnockoutMargin());

      return KIGEOM_BoxHitTestChainRotated(
        a,
        rect,
        this.GetDrawRotation(),
        this.GetDrawPos(),
        aContained,
      );
    }

    let accuracy = (b as number | undefined) ?? 0;

    if (this.IsKnockout())
      accuracy += GetKnockoutTextMargin(this.GetTextSize(), this.GetEffectiveTextPenWidth());

    return (
      EDA_TEXT.prototype.TextHitTest as (
        this: EDA_TEXT,
        aPoint: VECTOR2I,
        aAccuracy?: number,
      ) => boolean
    ).call(this as unknown as EDA_TEXT, a as VECTOR2I, accuracy);
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return this.TextHitTest(a, b as boolean, c ?? 0);

    if (a instanceof SHAPE_LINE_CHAIN) return this.TextHitTest(a, b as boolean);

    return this.TextHitTest(a, (b as number | undefined) ?? 0);
  }

  GetClass(): string {
    return 'PCB_TEXT';
  }

  /**
   * Function TransformTextToPolySet
   * Convert the text to a polygonSet describing the actual character strokes (one per segment).
   * Circles and arcs are approximated by segments.
   * @param aBuffer SHAPE_POLY_SET to store the polygon corners
   * @param aClearance the clearance around the text
   * @param aMaxError the maximum error to allow when approximating curves
   */
  TransformTextToPolySet(
    aBuffer: SHAPE_POLY_SET,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC,
  ): void {
    const font = this.GetDrawFont(null);
    const penWidth = this.GetEffectiveTextPenWidth();
    const attrs = this.GetAttributes().clone();
    const shownText = this.GetShownText(true);

    attrs.m_Angle = this.GetDrawRotation();

    // The polygonal shape of a text can have many basic shapes, so combining these shapes can
    // be very useful to create a final shape with a lot less vertices to speedup calculations.
    // Simplify shapes is not usually always efficient, but in this case it is.
    const textShape = new SHAPE_POLY_SET();

    const callback_gal = new CALLBACK_GAL(
      // Stroke callback
      (aPt1: VECTOR2I, aPt2: VECTOR2I) => {
        TransformOvalToPolygon(textShape, aPt1, aPt2, penWidth, aMaxError, aErrorLoc);
      },
      // Triangulation callback
      (aPt1: VECTOR2I, aPt2: VECTOR2I, aPt3: VECTOR2I) => {
        textShape.NewOutline();

        for (const point of [aPt1, aPt2, aPt3]) textShape.Append(point.x, point.y);
      },
    );

    const cache = this.GetRenderCache(font, shownText);

    if (cache) callback_gal.DrawGlyphs(cache);
    else font.DrawAt(callback_gal, shownText, this.GetTextPos(), attrs, this.GetFontMetrics());

    textShape.Simplify();

    if (this.IsKnockout()) {
      const finalPoly = new SHAPE_POLY_SET();
      const margin = GetKnockoutTextMargin(attrs.m_Size, penWidth);

      this.buildBoundingHull(finalPoly, textShape, margin + aClearance);

      finalPoly.BooleanSubtract(textShape);

      aBuffer.Append(finalPoly);
    } else {
      if (aClearance > 0 || aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) {
        if (aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) aClearance += aMaxError;

        textShape.Inflate(aClearance, CornerStrategy.ROUND_ALL_CORNERS, aMaxError);
      }

      aBuffer.Append(textShape);
    }
  }

  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC,
    aIgnoreLineWidth = false,
  ): void {
    const poly = new SHAPE_POLY_SET();

    this.TransformTextToPolySet(poly, 0, aMaxError, aErrorLoc);

    this.buildBoundingHull(aBuffer, poly, aClearance);
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    if (this.IsKnockout()) {
      const poly = new SHAPE_POLY_SET();

      this.TransformTextToPolySet(poly, 0, this.GetMaxError(), ERROR_LOC.ERROR_INSIDE);

      return poly;
    }

    return this.GetEffectiveTextShape();
  }

  GetKnockoutCache(aFont: FONT, forResolvedText: string, aMaxError: number): SHAPE_POLY_SET {
    const attrs = this.GetAttributes();
    const drawAngle = this.GetDrawRotation();
    const drawPos = this.GetDrawPos();

    if (!this.m_knockout_cache)
      this.m_knockout_cache = {
        text: '',
        text_attrs: attrs.clone(),
        angle: drawAngle,
        pos: { x: 0, y: 0 },
        cache: new SHAPE_POLY_SET(),
      };

    if (
      this.m_knockout_cache.cache.IsEmpty() ||
      !this.m_knockout_cache.text_attrs.equals(attrs) ||
      this.m_knockout_cache.text !== forResolvedText ||
      !this.m_knockout_cache.angle.equals(drawAngle)
    ) {
      this.m_knockout_cache.cache.RemoveAllContours();
      this.TransformTextToPolySet(
        this.m_knockout_cache.cache,
        0,
        aMaxError,
        ERROR_LOC.ERROR_INSIDE,
      );
      this.m_knockout_cache.cache.Fracture();
      this.m_knockout_cache.text_attrs = attrs.clone();
      this.m_knockout_cache.angle = drawAngle;
      this.m_knockout_cache.text = forResolvedText;
      this.m_knockout_cache.pos = { x: drawPos.x, y: drawPos.y };
    } else if (
      this.m_knockout_cache.pos.x !== drawPos.x ||
      this.m_knockout_cache.pos.y !== drawPos.y
    ) {
      this.m_knockout_cache.cache.Move({
        x: drawPos.x - this.m_knockout_cache.pos.x,
        y: drawPos.y - this.m_knockout_cache.pos.y,
      });
      this.m_knockout_cache.pos = { x: drawPos.x, y: drawPos.y };
    }

    return this.m_knockout_cache.cache;
  }

  GetTextTypeDescription(): string {
    return 'Text';
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    const content = aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText());

    const parentFP = this.GetParentFootprint();

    if (parentFP) {
      const ref = parentFP.GetReference();
      return `Footprint text of ${ref} (${content})`;
    }

    return `PCB text '${content}' on ${this.GetLayerName()}`;
  }

  override GetMenuImage(): string {
    return 'text';
  }

  /**
   * @return the text rotation for drawings and plotting the footprint rotation is taken
   *         in account.
   */
  GetDrawRotation(): EDA_ANGLE {
    let rotation = this.GetTextAngle().Clone();

    if (this.GetParentFootprint() && this.IsKeepUpright()) {
      // Keep angle between ]-90..90] deg. Otherwise the text is not easy to read
      while (rotation.AsDegrees() > ANGLE_90.AsDegrees()) rotation = rotation.sub(ANGLE_180);

      while (rotation.AsDegrees() <= -ANGLE_90.AsDegrees()) rotation = rotation.add(ANGLE_180);
    } else {
      rotation.Normalize();
    }

    return rotation;
  }

  override ViewBBox(): BOX2I {
    return this.GetBoundingBox();
  }

  override ViewGetLayers(): number[] {
    if (this.IsLocked() || (this.GetParentFootprint() && this.GetParentFootprint()!.IsLocked()))
      return [this.GetLayer(), GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW];

    return [this.GetLayer()];
  }

  ///< @copydoc VIEW_ITEM::ViewGetLOD
  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (!aView) return PCB_TEXT.LOD_SHOW;

    const renderSettings = aView.GetPainter().GetSettings();

    if (!aView.IsLayerVisible(this.GetLayer())) return PCB_TEXT.LOD_HIDE;

    if (aLayer === GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW) {
      // Hide shadow on dimmed tracks
      if (renderSettings.GetHighContrast()) {
        if (this.m_layer !== renderSettings.GetPrimaryHighContrastLayer()) return PCB_TEXT.LOD_HIDE;
      }
    }

    const parentFP = this.GetParentFootprint();

    if (parentFP) {
      // Handle Render tab switches
      if (this.GetText() === '${VALUE}') {
        if (!aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FP_VALUES)) return PCB_TEXT.LOD_HIDE;
      }

      if (this.GetText() === '${REFERENCE}') {
        if (!aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FP_REFERENCES)) return PCB_TEXT.LOD_HIDE;
      }

      let checkLayer = this.GetLayer();

      if (!IsFrontLayer(checkLayer) && !IsBackLayer(checkLayer)) checkLayer = parentFP.GetLayer();

      if (IsFrontLayer(checkLayer) && !aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR))
        return PCB_TEXT.LOD_HIDE;

      if (IsBackLayer(checkLayer) && !aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK))
        return PCB_TEXT.LOD_HIDE;

      if (!aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FP_TEXT)) return PCB_TEXT.LOD_HIDE;
    }

    return PCB_TEXT.LOD_SHOW;
  }

  // Virtual function
  override GetBoundingBox(): BOX2I {
    const angle = this.GetDrawRotation();
    let rect = this.GetTextBox(null).Clone();

    if (this.IsKnockout()) rect.Inflate(this.getKnockoutMargin());

    if (!angle.IsZero()) rect = rect.GetBoundingBoxRotated(this.GetTextPos(), angle);

    return rect;
  }

  override Clone(): PCB_TEXT {
    return PCB_TEXT.copyOf(this);
  }

  /** `Similarity( const BOARD_ITEM& )`, and `EDA_TEXT::Similarity( const EDA_TEXT& )` for a bare text. */
  Similarity(aOther: BOARD_ITEM | EDA_TEXT): number {
    if (!(aOther instanceof BOARD_ITEM)) return EDA_TEXT.prototype.Similarity.call(this, aOther);

    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_TEXT;

    return EDA_TEXT.prototype.Similarity.call(this, other as unknown as EDA_TEXT);
  }

  /** `operator==( const PCB_TEXT& )`: `EDA_TEXT::operator==`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_TEXT;

    return this.equalsEdaText(other as unknown as EDA_TEXT);
  }

  /** `EDA_TEXT::Compare`, reachable on the merged class. */
  Compare(aOther: EDA_TEXT | null): number {
    return EDA_TEXT.prototype.Compare.call(this, aOther);
  }

  /**
   * Build a nominally rectangular bounding box for the rendered text.  (It's not a BOX2I
   * because it will be a diamond shape for non-cardinally rotated text.)
   */
  protected buildBoundingHull(
    aBuffer: SHAPE_POLY_SET,
    aRenderedText: SHAPE_POLY_SET,
    aClearance: number,
  ): void {
    const poly = new SHAPE_POLY_SET(aRenderedText);

    poly.Rotate(this.GetDrawRotation().negate(), this.GetDrawPos());

    const rect = poly.BBox(aClearance);
    const corners: VECTOR2I[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];

    corners[0]!.x = rect.GetOrigin().x;
    corners[0]!.y = rect.GetOrigin().y;
    corners[1]!.y = corners[0]!.y;
    corners[1]!.x = rect.GetRight();
    corners[2]!.x = corners[1]!.x;
    corners[2]!.y = rect.GetBottom();
    corners[3]!.y = corners[2]!.y;
    corners[3]!.x = corners[0]!.x;

    aBuffer.NewOutline();

    for (const corner of corners) {
      const rotated = RotatePoint(corner, this.GetDrawPos(), this.GetDrawRotation());
      aBuffer.Append(rotated.x, rotated.y);
    }
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_TEXT_T);

    // std::swap( *this, *aImage ): every member of both classes.
    const image = aImage as PCB_TEXT;
    const mine = PCB_TEXT.copyOf(this);

    this.assignPcbText(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    image.assignPcbText(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
  }

  protected getKnockoutMargin(): number {
    return GetKnockoutTextMargin(
      { x: this.GetTextWidth(), y: this.GetTextHeight() },
      this.GetEffectiveTextPenWidth(),
    );
  }

  getFontMetrics(): METRICS {
    return this.GetFontMetrics();
  }
}

applyMixins(PCB_TEXT, [EDA_TEXT]);

/**
 * `static struct PCB_TEXT_DESC` (pcbnew/pcb_text.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_TEXT);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TEXT, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TEXT, EDA_TEXT));
  propMgr.InheritsAfter(PCB_TEXT, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_TEXT, EDA_TEXT);

  propMgr.Mask(PCB_TEXT, EDA_TEXT, 'Color');

  propMgr.AddProperty(
    new PROPERTY<PCB_TEXT, boolean, BOARD_ITEM>(
      PCB_TEXT,
      'Knockout',
      'SetIsKnockout',
      'IsKnockout',
      TYPE_BOOL,
      PROPERTY_DISPLAY.PT_DEFAULT,
      COORD_TYPES_T.NOT_A_COORD,
      BOARD_ITEM,
    ),
    'Text Properties',
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TEXT, boolean, EDA_TEXT>(
      PCB_TEXT,
      'Keep Upright',
      'SetKeepUpright',
      'IsKeepUpright',
      TYPE_BOOL,
      PROPERTY_DISPLAY.PT_DEFAULT,
      COORD_TYPES_T.NOT_A_COORD,
      EDA_TEXT,
    ),
    'Text Properties',
  );

  const isFootprintText = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PCB_TEXT) return !!aItem.GetParentFootprint();

    return false;
  };

  propMgr.OverrideAvailability(PCB_TEXT, EDA_TEXT, 'Keep Upright', isFootprintText);

  propMgr.Mask(PCB_TEXT, EDA_TEXT, 'Hyperlink');
})();
