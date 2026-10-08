// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_sheet_pin.h` / `sch_sheet_pin.cpp`: `SCH_SHEET_PIN`, the hierarchical
 * label drawn on a sheet symbol's edge (eeschema stage E3).
 *
 * Pending: GetMenuImage, Show (debug), the property registration.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { TYPE_CAST } from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KIUI_EllipsizeMenuText } from '@ziroeda/common/widgets/ui_common.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_LINE_WIDTH_MILS } from './default_values.js';
import { DANGLING_END_ITEM, DANGLING_END_T, type SCH_ITEM } from './sch_item.js';
import { LABEL_FLAG_SHAPE, SCH_HIERLABEL, SCH_LABEL_BASE, SPIN_STYLE } from './sch_label.js';
import { SCH_TEXT } from './sch_text.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

/**
 * Define the edge of the sheet that the sheet pin is positioned.
 *
 * SHEET_SIDE::LEFT is 0.
 * SHEET_SIDE::RIGHT is 1.
 * SHEET_SIDE::TOP is 2.
 * SHEET_SIDE::BOTTOM is 3.
 * SHEET_SIDE::UNDEFINED is 4.
 */
export enum SHEET_SIDE {
  LEFT = 0,
  RIGHT,
  TOP,
  BOTTOM,
  UNDEFINED,
}

/**
 * Define a sheet pin (label) used in sheets to create hierarchical schematics.
 *
 * A SCH_SHEET_PIN is used to create a hierarchical sheet in the same way a
 * pin is used in a symbol.  It connects the objects in the sheet object
 * to the objects in the schematic page to the objects in the page that is
 * represented by the sheet.  In a sheet object, a SCH_SHEET_PIN must be
 * connected to a wire, bus, or label.  In the schematic page represented by
 * the sheet, it corresponds to a hierarchical label.
 */
export class SCH_SHEET_PIN extends SCH_HIERLABEL {
  private m_number!: number; ///< Label number use for saving sheet label to file.
  ///< Sheet label numbering begins at 2.
  ///< 0 is reserved for the sheet name.
  ///< 1 is reserve for the sheet file name.

  private m_edge!: SHEET_SIDE;

  /**
   * `SCH_SHEET_PIN( SCH_SHEET* parent, const VECTOR2I& pos, const wxString& text )`.
   * A null parent (upstream asserts one) makes the blank a copy fills in.
   */
  constructor(parent: SCH_SHEET | null, pos: VECTOR2I = { x: 0, y: 0 }, text = '') {
    super(pos, text, KICAD_T.SCH_SHEET_PIN_T);
    this.m_edge = SHEET_SIDE.UNDEFINED;

    this.SetParent(parent as unknown as EDA_ITEM | null);
    this.m_layer = SCH_LAYER_ID.LAYER_SHEETLABEL;

    this.SetTextPos(pos);

    if (parent) {
      if (parent.IsVerticalOrientation()) this.SetSide(SHEET_SIDE.TOP);
      else this.SetSide(SHEET_SIDE.LEFT);
    }

    this.m_shape = LABEL_FLAG_SHAPE.L_INPUT;
    this.m_isDangling = true;
    this.m_number = 2;
  }

  /** `SCH_SHEET_PIN( const SCH_SHEET_PIN& )`: the compiler-generated copy. */
  static override copyOf(aPin: SCH_SHEET_PIN): SCH_SHEET_PIN {
    const copy = SCH_LABEL_BASE.copyLabel(new SCH_SHEET_PIN(null), aPin);
    copy.m_number = aPin.m_number;
    copy.m_edge = aPin.m_edge;
    return copy;
  }

  static override ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_SHEET_PIN_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_SHEET_PIN';
  }

  override GetFriendlyName(): string {
    return 'Sheet Pin';
  }

  static GetOppositeSide(aSide: SHEET_SIDE): SHEET_SIDE {
    switch (aSide) {
      case SHEET_SIDE.TOP:
        return SHEET_SIDE.BOTTOM;
      case SHEET_SIDE.BOTTOM:
        return SHEET_SIDE.TOP;
      case SHEET_SIDE.LEFT:
        return SHEET_SIDE.RIGHT;
      case SHEET_SIDE.RIGHT:
        return SHEET_SIDE.LEFT;
      default:
        return SHEET_SIDE.UNDEFINED;
    }
  }

  override IsMovableFromAnchorPoint(): boolean {
    return true;
  }

  /**
   * Calculate the graphic shape (a polygon) associated to the text.  A sheet pin draws
   * its label's shape mirrored: an input pin is an output label seen from outside.
   */
  override CreateGraphicShape(
    aSettings: RENDER_SETTINGS | null,
    aPoints: VECTOR2I[],
    aPos: VECTOR2I,
  ): void {
    /*
     * These are the same icon shapes as SCH_HIERLABEL but the graphic icon is slightly
     * different in 2 cases:
     * for INPUT type the icon is the OUTPUT shape of SCH_HIERLABEL
     * for OUTPUT type the icon is the INPUT shape of SCH_HIERLABEL
     */
    let shape = this.m_shape;

    switch (shape) {
      case LABEL_FLAG_SHAPE.L_INPUT:
        shape = LABEL_FLAG_SHAPE.L_OUTPUT;
        break;
      case LABEL_FLAG_SHAPE.L_OUTPUT:
        shape = LABEL_FLAG_SHAPE.L_INPUT;
        break;
      default:
        break;
    }

    super.CreateGraphicShape(aSettings, aPoints, aPos, shape);
  }

  override GetPenWidth(): number {
    const schematic = this.Schematic();

    if (schematic) return schematic.Settings().m_DefaultLineWidth;

    return schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS);
  }

  /** Get the sheet label number. */
  GetNumber(): number {
    return this.m_number;
  }

  /** Set the sheet label number (2 and up: 0 and 1 are the sheet's name and file). */
  SetNumber(aNumber: number): void {
    this.m_number = aNumber;
  }

  SetSide(aEdge: SHEET_SIDE): void {
    const sheet = this.GetParent();

    // use -1 to adjust text orientation without changing edge
    switch (aEdge) {
      case SHEET_SIDE.LEFT:
        this.m_edge = aEdge;
        this.SetTextX(sheet.GetPosition().x);
        this.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT)); // Orientation horiz inverse
        break;

      case SHEET_SIDE.RIGHT:
        this.m_edge = aEdge;
        this.SetTextX(sheet.GetPosition().x + sheet.GetSize().x);
        this.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT)); // Orientation horiz normal
        break;

      case SHEET_SIDE.TOP:
        this.m_edge = aEdge;
        this.SetTextY(sheet.GetPosition().y);
        this.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM)); // Orientation vert BOTTOM
        break;

      case SHEET_SIDE.BOTTOM:
        this.m_edge = aEdge;
        this.SetTextY(sheet.GetPosition().y + sheet.GetSize().y);
        this.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP)); // Orientation vert UP
        break;

      default:
        break;
    }
  }

  GetSide(): SHEET_SIDE {
    return this.m_edge;
  }

  /**
   * Adjust label position to edge based on proximity to vertical or horizontal edge
   * of the parent sheet.
   */
  ConstrainOnEdge(aPos: VECTOR2I, aAllowEdgeSwitch: boolean): void {
    const sheet = this.GetParent() as SCH_SHEET | null;

    if (sheet === null) return;

    const leftSide = sheet.GetPosition().x;
    const rightSide = sheet.GetPosition().x + sheet.GetSize().x;
    const topSide = sheet.GetPosition().y;
    const botSide = sheet.GetPosition().y + sheet.GetSize().y;

    const sheetEdge = new SHAPE_LINE_CHAIN();

    sheetEdge.Append(leftSide, topSide);
    sheetEdge.Append(rightSide, topSide);
    sheetEdge.Append(rightSide, botSide);
    sheetEdge.Append(leftSide, botSide);
    sheetEdge.Append(leftSide, topSide);

    if (aAllowEdgeSwitch) {
      switch (sheetEdge.NearestSegment(aPos)) {
        case 0:
          this.SetSide(SHEET_SIDE.TOP);
          break;
        case 1:
          this.SetSide(SHEET_SIDE.RIGHT);
          break;
        case 2:
          this.SetSide(SHEET_SIDE.BOTTOM);
          break;
        case 3:
          this.SetSide(SHEET_SIDE.LEFT);
          break;
        default:
          break; // wxASSERT( "Invalid segment number" )
      }
    } else {
      this.SetSide(this.GetSide());
    }

    switch (this.GetSide()) {
      case SHEET_SIDE.RIGHT:
      case SHEET_SIDE.LEFT:
        this.SetTextY(aPos.y);

        if (this.GetTextPos().y < topSide) this.SetTextY(topSide);

        if (this.GetTextPos().y > botSide) this.SetTextY(botSide);

        break;

      case SHEET_SIDE.BOTTOM:
      case SHEET_SIDE.TOP:
        this.SetTextX(aPos.x);

        if (this.GetTextPos().x < leftSide) this.SetTextX(leftSide);

        if (this.GetTextPos().x > rightSide) this.SetTextX(rightSide);

        break;

      case SHEET_SIDE.UNDEFINED:
        break; // wxASSERT( "Undefined sheet side" )
    }
  }

  /**
   * Get the parent sheet object of this sheet pin.
   *
   * @return the sheet that is the parent of this sheet pin or NULL if it does not
   *         have a parent.
   */
  override GetParent(): SCH_SHEET {
    return this.m_parent as unknown as SCH_SHEET;
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.Offset(aMoveVector);
  }

  override MirrorVertically(aCenter: number): void {
    const p = this.GetTextPos().y - aCenter;

    this.SetTextY(aCenter - p);

    switch (this.m_edge) {
      case SHEET_SIDE.TOP:
        this.SetSide(SHEET_SIDE.BOTTOM);
        break;
      case SHEET_SIDE.BOTTOM:
        this.SetSide(SHEET_SIDE.TOP);
        break;
      default:
        break;
    }
  }

  override MirrorHorizontally(aCenter: number): void {
    const p = this.GetTextPos().x - aCenter;

    this.SetTextX(aCenter - p);

    switch (this.m_edge) {
      case SHEET_SIDE.LEFT:
        this.SetSide(SHEET_SIDE.RIGHT);
        break;
      case SHEET_SIDE.RIGHT:
        this.SetSide(SHEET_SIDE.LEFT);
        break;
      default:
        break;
    }
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    let pt = this.GetTextPos();
    const delta = { x: pt.x - aCenter.x, y: pt.y - aCenter.y };

    pt = RotatePoint(pt, aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);

    const oldSide = this.GetSide();
    this.ConstrainOnEdge(pt, true);

    // If the new side is the same as the old side, instead mirror across the center of
    // that side.
    if (this.GetSide() === oldSide) {
      switch (this.GetSide()) {
        case SHEET_SIDE.TOP:
        case SHEET_SIDE.BOTTOM:
          this.SetTextPos({ x: aCenter.x - delta.x, y: this.GetTextPos().y });
          break;

        case SHEET_SIDE.LEFT:
        case SHEET_SIDE.RIGHT:
          this.SetTextPos({ x: this.GetTextPos().x, y: aCenter.y - delta.y });
          break;

        default:
          break;
      }
    }
    // If the new side is opposite to the old side, instead mirror across the center of
    // an adjacent side.
    else if (this.GetSide() === SCH_SHEET_PIN.GetOppositeSide(oldSide)) {
      switch (this.GetSide()) {
        case SHEET_SIDE.TOP:
        case SHEET_SIDE.BOTTOM:
          this.SetTextPos({ x: aCenter.x + delta.x, y: this.GetTextPos().y });
          break;

        case SHEET_SIDE.LEFT:
        case SHEET_SIDE.RIGHT:
          this.SetTextPos({ x: this.GetTextPos().x, y: aCenter.y + delta.y });
          break;

        default:
          break;
      }
    }
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    return this.matchesText(this.GetText(), aSearchData);
  }

  override IsReplaceable(): boolean {
    return true;
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    const item = new DANGLING_END_ITEM(DANGLING_END_T.SHEET_LABEL_END, this, this.GetTextPos());
    aItemList.push(item);
  }

  override IsConnectable(): boolean {
    return true;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    _aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this) return false;

    if (!(aItem instanceof SCH_SHEET_PIN)) return false; // wxCHECK

    const pin = aItem;

    // Don't compare against a different SCH_ITEM.
    const a = this.GetPosition();
    const b = pin.GetPosition();

    if (a.x !== b.x || a.y !== b.y) return true;

    return this.GetText() !== pin.GetText();
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Hierarchical Sheet Pin '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}'`;
  }

  override SetPosition(aPosition: VECTOR2I): void {
    this.ConstrainOnEdge(aPosition, true);
  }

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    const p = this.GetPosition();
    return this.m_isDangling && p.x === aPos.x && p.y === aPos.y;
  }

  /**
   * `HitTest( const VECTOR2I& aPoint, int aAccuracy )`: the bounding box, inflated.
   * The rectangle and polygon tests are the label's.
   */
  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return super.HitTest(a, b as boolean, c);

    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    const rect = this.GetBoundingBox();

    rect.Inflate((b as number | undefined) ?? 0);

    return rect.Contains(a);
  }

  override Clone(): SCH_SHEET_PIN {
    return SCH_SHEET_PIN.copyOf(this);
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as SCH_SHEET_PIN;

    let similarity = 1.0;

    if (this.m_edge !== other.m_edge) similarity *= 0.9;

    if (this.m_number !== other.m_number) similarity *= 0.9;

    similarity *= super.Similarity(aOther);

    return similarity;
  }

  /** `operator==( const SCH_ITEM& aOther )`. */
  override equals(aOther: SCH_ITEM): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther as SCH_SHEET_PIN;

    return this.m_edge === other.m_edge && this.m_number === other.m_number && super.equals(aOther);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    super.swapData(aItem);

    if (aItem.Type() !== KICAD_T.SCH_SHEET_PIN_T)
      throw new Error(`SCH_SHEET_PIN object cannot swap data with ${aItem.GetClass()} object.`);

    const pin = aItem as SCH_SHEET_PIN;

    [this.m_number, pin.m_number] = [pin.m_number, this.m_number];
    [this.m_edge, pin.m_edge] = [pin.m_edge, this.m_edge];
  }
}

/**
 * `static struct SCH_SHEET_PIN_DESC` (eeschema/sch_sheet_pin.cpp:419).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_SHEET_PIN);
  propMgr.AddTypeCast(new TYPE_CAST(SCH_SHEET_PIN, SCH_HIERLABEL));
  propMgr.AddTypeCast(new TYPE_CAST(SCH_SHEET_PIN, SCH_LABEL_BASE));
  propMgr.AddTypeCast(new TYPE_CAST(SCH_SHEET_PIN, SCH_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(SCH_SHEET_PIN, EDA_TEXT));

  propMgr.InheritsAfter(SCH_SHEET_PIN, SCH_HIERLABEL);
})();
