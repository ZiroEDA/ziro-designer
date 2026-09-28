// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_label.h` / `eeschema/sch_label.cpp`: `SPIN_STYLE`, the label shape enums,
 * `SCH_LABEL_BASE` and its kinds `SCH_LABEL`, `SCH_DIRECTIVE_LABEL`, `SCH_GLOBALLABEL`
 * and `SCH_HIERLABEL` (also the base of `SCH_SHEET_PIN`).
 *
 * Not here: `Plot`, `GetMsgPanelInfo`, `GetMenuImage`, `Serialize`/`Deserialize`, the
 * `*_DESC` property registrations. Anything that asks a `SCH_CONNECTION` (the net name
 * text variables, `${OP}`, net-name search, the net-class colour) waits on the connection
 * graph (E3 part 2) and answers as KiCad does for an item with no connection.
 */

import { ResolveTextVars } from '@ziroeda/common/common.js';
import type { EDA_ITEM, INSPECTOR, OutStr } from '@ziroeda/common/eda_item.js';
import { INSPECT_RESULT, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { IncrementString } from '@ziroeda/common/increment.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import {
  FIELD_T,
  GetDefaultFieldName as GetDefaultFieldNameForId,
} from '@ziroeda/common/template_fieldnames.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KIUI_EllipsizeMenuText } from '@ziroeda/common/widgets/ui_common.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_180,
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
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { DANGLING_SYMBOL_SIZE, DEFAULT_LABEL_SIZE_RATIO } from './default_values.js';
import {
  FindField,
  NextFieldOrdinal,
  SCH_FIELD,
  registerLabelDefaultFieldName,
} from './sch_field.js';
import {
  AUTOPLACE_ALGO,
  DANGLING_END_ITEM,
  DANGLING_END_ITEM_HELPER,
  DANGLING_END_T,
  SCH_ITEM,
} from './sch_item.js';
import type { SCH_RULE_AREA } from './sch_rule_area.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import { SCH_TEXT } from './sch_text.js';

/** `MIRRORVAL`. */
const MIRRORVAL = (aPoint: number, aMirrorRef: number): number =>
  -(aPoint - aMirrorRef) + aMirrorRef;

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `CONNECTION_TYPE` (sch_connection.h). */
export enum CONNECTION_TYPE {
  NONE, ///< No connection to this item
  NET, ///< This item represents a net
  BUS, ///< This item represents a bus vector
  BUS_GROUP, ///< This item represents a bus group
}

/**
 * `SPIN_STYLE`: the four orientations of a label, as a value class.
 */
export class SPIN_STYLE {
  static readonly LEFT = 0;
  static readonly UP = 1;
  static readonly RIGHT = 2;
  static readonly BOTTOM = 3;

  private readonly m_spin: number;

  constructor(aSpin: number) {
    this.m_spin = aSpin;
  }

  /** `operator int()`. */
  valueOf(): number {
    return this.m_spin;
  }

  equals(a: number | SPIN_STYLE): boolean {
    return this.m_spin === Number(a);
  }

  RotateCCW(): SPIN_STYLE {
    let newSpin = this.m_spin;

    switch (this.m_spin) {
      case SPIN_STYLE.LEFT:
        newSpin = SPIN_STYLE.BOTTOM;
        break;
      case SPIN_STYLE.BOTTOM:
        newSpin = SPIN_STYLE.RIGHT;
        break;
      case SPIN_STYLE.RIGHT:
        newSpin = SPIN_STYLE.UP;
        break;
      case SPIN_STYLE.UP:
        newSpin = SPIN_STYLE.LEFT;
        break;
    }

    return new SPIN_STYLE(newSpin);
  }

  /** Mirror the label spin style across the X axis or simply swaps up and bottom. */
  MirrorX(): SPIN_STYLE {
    let newSpin = this.m_spin;

    switch (this.m_spin) {
      case SPIN_STYLE.UP:
        newSpin = SPIN_STYLE.BOTTOM;
        break;
      case SPIN_STYLE.BOTTOM:
        newSpin = SPIN_STYLE.UP;
        break;
      default:
        break;
    }

    return new SPIN_STYLE(newSpin);
  }

  /** Mirror the label spin style across the Y axis or simply swaps left and right. */
  MirrorY(): SPIN_STYLE {
    let newSpin = this.m_spin;

    switch (this.m_spin) {
      case SPIN_STYLE.LEFT:
        newSpin = SPIN_STYLE.RIGHT;
        break;
      case SPIN_STYLE.RIGHT:
        newSpin = SPIN_STYLE.LEFT;
        break;
      default:
        break;
    }

    return new SPIN_STYLE(newSpin);
  }

  /** Get CCW rotation needed to get to the given spin style. */
  CCWRotationsTo(aOther: SPIN_STYLE): number {
    return (((this.m_spin - aOther.m_spin) % 4) + 4) % 4;
  }
}

/** `LABEL_FLAG_SHAPE`. */
export enum LABEL_FLAG_SHAPE {
  L_INPUT,
  L_OUTPUT,
  L_BIDI,
  L_TRISTATE,
  L_UNSPECIFIED,

  F_FIRST,
  F_DOT = F_FIRST,
  F_ROUND,
  F_DIAMOND,
  F_RECTANGLE,
}

/** `LABEL_SHAPE`: the label half of `LABEL_FLAG_SHAPE`. */
export enum LABEL_SHAPE {
  LABEL_INPUT = LABEL_FLAG_SHAPE.L_INPUT,
  LABEL_OUTPUT = LABEL_FLAG_SHAPE.L_OUTPUT,
  LABEL_BIDI = LABEL_FLAG_SHAPE.L_BIDI,
  LABEL_TRISTATE = LABEL_FLAG_SHAPE.L_TRISTATE,
  LABEL_PASSIVE = LABEL_FLAG_SHAPE.L_UNSPECIFIED,
}

/** `FLAG_SHAPE`: the directive-label half of `LABEL_FLAG_SHAPE`. */
export enum FLAG_SHAPE {
  FLAG_DOT = LABEL_FLAG_SHAPE.F_DOT,
  FLAG_CIRCLE = LABEL_FLAG_SHAPE.F_ROUND,
  FLAG_DIAMOND = LABEL_FLAG_SHAPE.F_DIAMOND,
  FLAG_RECTANGLE = LABEL_FLAG_SHAPE.F_RECTANGLE,
}

/* Coding polygons for global symbol graphic shapes.
 *  the first parml is the number of corners
 *  others are the corners coordinates in reduced units
 *  the real coordinate is the reduced coordinate * text half size
 */
const TemplateIN_HN = [6, 0, 0, -1, -1, -2, -1, -2, 1, -1, 1, 0, 0];
const TemplateIN_HI = [6, 0, 0, 1, 1, 2, 1, 2, -1, 1, -1, 0, 0];
const TemplateIN_UP = [6, 0, 0, 1, -1, 1, -2, -1, -2, -1, -1, 0, 0];
const TemplateIN_BOTTOM = [6, 0, 0, 1, 1, 1, 2, -1, 2, -1, 1, 0, 0];

const TemplateOUT_HN = [6, -2, 0, -1, 1, 0, 1, 0, -1, -1, -1, -2, 0];
const TemplateOUT_HI = [6, 2, 0, 1, -1, 0, -1, 0, 1, 1, 1, 2, 0];
const TemplateOUT_UP = [6, 0, -2, 1, -1, 1, 0, -1, 0, -1, -1, 0, -2];
const TemplateOUT_BOTTOM = [6, 0, 2, 1, 1, 1, 0, -1, 0, -1, 1, 0, 2];

const TemplateUNSPC_HN = [5, 0, -1, -2, -1, -2, 1, 0, 1, 0, -1];
const TemplateUNSPC_HI = [5, 0, -1, 2, -1, 2, 1, 0, 1, 0, -1];
const TemplateUNSPC_UP = [5, 1, 0, 1, -2, -1, -2, -1, 0, 1, 0];
const TemplateUNSPC_BOTTOM = [5, 1, 0, 1, 2, -1, 2, -1, 0, 1, 0];

const TemplateBIDI_HN = [5, 0, 0, -1, -1, -2, 0, -1, 1, 0, 0];
const TemplateBIDI_HI = [5, 0, 0, 1, -1, 2, 0, 1, 1, 0, 0];
const TemplateBIDI_UP = [5, 0, 0, -1, -1, 0, -2, 1, -1, 0, 0];
const TemplateBIDI_BOTTOM = [5, 0, 0, -1, 1, 0, 2, 1, 1, 0, 0];

const Template3STATE_HN = [5, 0, 0, -1, -1, -2, 0, -1, 1, 0, 0];
const Template3STATE_HI = [5, 0, 0, 1, -1, 2, 0, 1, 1, 0, 0];
const Template3STATE_UP = [5, 0, 0, -1, -1, 0, -2, 1, -1, 0, 0];
const Template3STATE_BOTTOM = [5, 0, 0, -1, 1, 0, 2, 1, 1, 0, 0];

const TemplateShape: readonly (readonly (readonly number[])[])[] = [
  [TemplateIN_HN, TemplateIN_UP, TemplateIN_HI, TemplateIN_BOTTOM],
  [TemplateOUT_HN, TemplateOUT_UP, TemplateOUT_HI, TemplateOUT_BOTTOM],
  [TemplateBIDI_HN, TemplateBIDI_UP, TemplateBIDI_HI, TemplateBIDI_BOTTOM],
  [Template3STATE_HN, Template3STATE_UP, Template3STATE_HI, Template3STATE_BOTTOM],
  [TemplateUNSPC_HN, TemplateUNSPC_UP, TemplateUNSPC_HI, TemplateUNSPC_BOTTOM],
];

/** `getElectricalTypeLabel`. */
export function getElectricalTypeLabel(aType: LABEL_FLAG_SHAPE): string {
  switch (aType) {
    case LABEL_FLAG_SHAPE.L_INPUT:
      return 'Input';
    case LABEL_FLAG_SHAPE.L_OUTPUT:
      return 'Output';
    case LABEL_FLAG_SHAPE.L_BIDI:
      return 'Bidirectional';
    case LABEL_FLAG_SHAPE.L_TRISTATE:
      return 'Tri-State';
    case LABEL_FLAG_SHAPE.L_UNSPECIFIED:
      return 'Passive';
    default:
      return '???';
  }
}

/** The parts of `SCH_RENDER_SETTINGS` the label geometry reads. */
interface LABEL_RENDER_SETTINGS extends RENDER_SETTINGS {
  m_LabelSizeRatio?: number;
  m_TextOffsetRatio?: number;
}

const toLabelSettings = (s: RENDER_SETTINGS | null): LABEL_RENDER_SETTINGS | null =>
  s as LABEL_RENDER_SETTINGS | null;

export abstract class SCH_LABEL_BASE extends SCH_TEXT {
  protected m_fields: SCH_FIELD[]; ///< Optional fields
  protected m_shape: LABEL_FLAG_SHAPE;
  protected m_connectionType: CONNECTION_TYPE;
  protected m_isDangling: boolean;
  protected m_autoRotateOnPlacement: boolean;
  protected m_lastResolvedColor: Color4d;
  protected m_cached_driver_name: string;

  constructor(aPos: VECTOR2I, aText: string, aType: KICAD_T) {
    super(aPos, aText, SCH_LAYER_ID.LAYER_NOTES, aType);
    this.m_fields = [];
    this.m_shape = LABEL_FLAG_SHAPE.L_UNSPECIFIED;
    this.m_connectionType = CONNECTION_TYPE.NONE;
    this.m_isDangling = true;
    this.m_autoRotateOnPlacement = false;
    this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };
    this.m_cached_driver_name = '';

    this.SetMultilineAllowed(false);

    if (!this.HasTextVars())
      this.m_cached_driver_name = EscapeString(
        EDA_TEXT.prototype.GetShownText.call(this, true, 0),
        ESCAPE_CONTEXT.CTX_NETNAME,
      );
  }

  /** `SCH_LABEL_BASE( const SCH_LABEL_BASE& aLabel )` as a derived copy's step. */
  protected static copyLabel<T extends SCH_LABEL_BASE>(aInto: T, aLabel: SCH_LABEL_BASE): T {
    SCH_TEXT.copyText(aInto, aLabel);
    aInto.m_shape = aLabel.m_shape;
    aInto.m_connectionType = aLabel.m_connectionType;
    aInto.m_isDangling = aLabel.m_isDangling;
    aInto.m_autoRotateOnPlacement = aLabel.m_autoRotateOnPlacement;
    aInto.m_lastResolvedColor = { ...aLabel.m_lastResolvedColor };
    aInto.m_cached_driver_name = aLabel.m_cached_driver_name;

    aInto.SetMultilineAllowed(false);

    aInto.m_fields = aLabel.m_fields.map((f) => f.Clone());

    for (const field of aInto.m_fields) field.SetParent(aInto);

    return aInto;
  }

  /** `SCH_LABEL_BASE& operator=( const SCH_LABEL_BASE& aLabel )`. */
  assignLabel(aLabel: SCH_LABEL_BASE): this {
    this.assignText(aLabel);

    this.m_fields = aLabel.m_fields.map((f) => f.Clone());

    for (const field of this.m_fields) field.SetParent(this);

    this.m_shape = aLabel.m_shape;
    this.m_connectionType = aLabel.m_connectionType;
    this.m_isDangling = aLabel.m_isDangling;
    this.m_autoRotateOnPlacement = aLabel.m_autoRotateOnPlacement;
    this.m_lastResolvedColor = { ...aLabel.m_lastResolvedColor };
    this.m_cached_driver_name = aLabel.m_cached_driver_name;

    return this;
  }

  abstract override GetClass(): string;

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    const wireAndPinTypes = [KICAD_T.SCH_ITEM_LOCATE_WIRE_T, KICAD_T.SCH_PIN_T];
    const busTypes = [KICAD_T.SCH_ITEM_LOCATE_BUS_T];

    if (super.IsType(aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_LABEL_LOCATE_ANY_T) return true;
    }

    if (!this.Schematic()) return false; // wxCHECK_MSG: "No parent SCHEMATIC set for SCH_LABEL!"

    // Ensure m_connected_items for Schematic()->CurrentSheet() exists.
    // Can be not the case when "this" is living in clipboard
    const key = this.Schematic()!.CurrentSheet().PathAsString();
    const item_set = this.m_connected_items.get(key);

    if (!item_set) return false;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_LABEL_LOCATE_WIRE_T) {
        for (const connection of item_set) {
          if (connection.IsType(wireAndPinTypes)) return true;
        }
      }

      if (scanType === KICAD_T.SCH_LABEL_LOCATE_BUS_T) {
        for (const connection of item_set) {
          if (connection.IsType(busTypes)) return true;
        }
      }
    }

    return false;
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    switch (aItem.Type()) {
      case KICAD_T.SCH_LINE_T:
        return (
          aItem.GetLayer() === SCH_LAYER_ID.LAYER_WIRE ||
          aItem.GetLayer() === SCH_LAYER_ID.LAYER_BUS
        );

      case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
        return true;

      case KICAD_T.SCH_SYMBOL_T:
        return true;

      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
      case KICAD_T.SCH_SHEET_PIN_T:
        return true;

      default:
        return false;
    }
  }

  GetLabelShape(): LABEL_SHAPE {
    return this.m_shape as unknown as LABEL_SHAPE;
  }

  private static s_inUpdate = false;

  /**
   * Set the label shape, and keep the hierarchy consistent: a hierarchical label and the
   * sheet pins that stand for it share one shape.
   */
  SetLabelShape(aShape: LABEL_SHAPE): void {
    this.m_shape = aShape as unknown as LABEL_FLAG_SHAPE;

    // Guard against infinite recursion
    if (SCH_LABEL_BASE.s_inUpdate) return;

    SCH_LABEL_BASE.s_inUpdate = true;

    try {
      if (this.Type() === KICAD_T.SCH_HIER_LABEL_T) {
        const label = this;
        const parent = label.GetParent();
        const screen =
          parent && parent.Type() === KICAD_T.SCH_SCREEN_T
            ? (parent as unknown as SCH_SCREEN)
            : null;

        if (screen) {
          const text = label.GetText();

          for (const item of screen.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
            const other = item as SCH_LABEL_BASE;

            if (other !== label && other.GetText() === text) other.SetLabelShape(aShape);
          }

          for (const sheetPath of screen.GetClientSheetPaths()) {
            const sheet = sheetPath.Last();

            if (sheet) {
              for (const pin of sheet.GetPins()) {
                if (pin.GetText() === text) pin.SetLabelShape(aShape);
              }
            }
          }
        }
      } else if (this.Type() === KICAD_T.SCH_SHEET_PIN_T) {
        const pin = this;
        const parent = pin.GetParent() as unknown as SCH_SHEET | null;

        if (parent) {
          const text = pin.GetText();
          const screen = parent.GetScreen();

          if (screen) {
            for (const item of screen.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
              const hlabel = item as SCH_LABEL_BASE;

              if (hlabel.GetText() === text) hlabel.SetLabelShape(aShape);
            }
          }

          for (const other of parent.GetPins()) {
            if ((other as SCH_LABEL_BASE) !== pin && other.GetText() === text)
              other.SetLabelShape(aShape);
          }
        }
      }
    } finally {
      SCH_LABEL_BASE.s_inUpdate = false;
    }
  }

  GetShape(): LABEL_FLAG_SHAPE {
    return this.m_shape;
  }

  SetShape(aShape: LABEL_FLAG_SHAPE): void {
    if (aShape >= LABEL_FLAG_SHAPE.F_FIRST) this.m_shape = aShape;
    else this.SetLabelShape(aShape as unknown as LABEL_SHAPE);
  }

  GetLabelColor(): Color4d {
    if (!color4dEquals(this.GetTextColor(), COLOR4D_UNSPECIFIED))
      this.m_lastResolvedColor = { ...this.GetTextColor() };
    // else if( !IsConnectivityDirty() ) -> net class colour: pending the connection graph.

    return this.m_lastResolvedColor;
  }

  /**
   * Set a spin or rotation angle, along with specific horizontal and vertical justification
   * styles with each angle.
   */
  SetSpinStyle(aSpinStyle: SPIN_STYLE): void {
    // Assume "Right" and Left" mean which side of the anchor the text will be on
    // Thus we want to left justify text up against the anchor if we are on the right
    switch (Number(aSpinStyle)) {
      case SPIN_STYLE.UP: // Vert Orientation UP
        this.SetTextAngle(ANGLE_VERTICAL);
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        break;

      case SPIN_STYLE.LEFT: // Horiz Orientation - Right justified
        this.SetTextAngle(ANGLE_HORIZONTAL);
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        break;

      case SPIN_STYLE.BOTTOM: //  Vert Orientation BOTTOM
        this.SetTextAngle(ANGLE_VERTICAL);
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        break;

      default: // wxFAIL_MSG( "Bad spin style" ), then falls through to RIGHT
      case SPIN_STYLE.RIGHT: // Horiz Normal Orientation
        this.SetTextAngle(ANGLE_HORIZONTAL);
        this.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        break;
    }

    this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
  }

  GetSpinStyle(): SPIN_STYLE {
    if (this.GetTextAngle().equals(ANGLE_VERTICAL)) {
      if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        return new SPIN_STYLE(SPIN_STYLE.BOTTOM);
      else return new SPIN_STYLE(SPIN_STYLE.UP);
    } else {
      if (this.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        return new SPIN_STYLE(SPIN_STYLE.LEFT);
      else return new SPIN_STYLE(SPIN_STYLE.RIGHT);
    }
  }

  override SetLastResolvedState(aItem: SCH_ITEM): void {
    if (aItem instanceof SCH_LABEL_BASE)
      this.m_lastResolvedColor = { ...aItem.m_lastResolvedColor };
  }

  static GetDefaultFieldName(aName: string, aUseDefaultName: boolean): string {
    if (aName === 'Intersheetrefs') return 'Sheet References';
    else if (aName === 'Netclass') return 'Net Class';
    else if (aName === '' && aUseDefaultName) return 'Field';
    else return aName;
  }

  GetNextFieldOrdinal(): number {
    return NextFieldOrdinal(this.m_fields);
  }

  /** Return the number of mandatory fields for this label type. */
  GetMandatoryFieldCount(): number {
    return 0;
  }

  GetFields(): SCH_FIELD[] {
    return this.m_fields;
  }

  /** Set multiple schematic fields: the vector is copied, each field keeps its parent. */
  SetFields(aFields: readonly SCH_FIELD[]): void {
    this.m_fields = aFields.map((f) => f.Clone()); // vector copying, length is changed possibly
  }

  AddFields(aFields: readonly SCH_FIELD[]): void {
    this.m_fields.push(...aFields.map((f) => f.Clone()));
  }

  AddField(aField: SCH_FIELD): void {
    this.m_fields.push(aField.Clone());
  }

  /** Increment the label text, if it ends with a number. */
  IncrementLabel(aIncrement: number): boolean {
    const text = IncrementString(this.GetText(), aIncrement);

    if (text !== null) {
      this.SetText(text);
      return true;
    }

    return false;
  }

  override Move(aMoveVector: VECTOR2I): void {
    super.Move(aMoveVector);

    for (const field of this.m_fields) field.Offset(aMoveVector);
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    const pt = RotatePoint(this.GetTextPos(), aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
    const offset = { x: pt.x - this.GetTextPos().x, y: pt.y - this.GetTextPos().y };

    this.Rotate90(!aRotateCCW);

    const pos = this.GetTextPos();
    this.SetTextPos({ x: pos.x + offset.x, y: pos.y + offset.y });

    for (const field of this.m_fields) {
      const fpos = field.GetTextPos();
      field.SetTextPos({ x: fpos.x + offset.x, y: fpos.y + offset.y });
    }
  }

  override Rotate90(aClockwise: boolean): void {
    super.Rotate90(aClockwise);

    if (
      this.m_fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
      this.m_fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
    ) {
      this.AutoplaceFields(null, this.m_fieldsAutoplaced);
    } else {
      for (const field of this.m_fields) field.Rotate(this.GetPosition(), !aClockwise);
    }
  }

  override MirrorSpinStyle(aLeftRight: boolean): void {
    super.MirrorSpinStyle(aLeftRight);

    for (const field of this.m_fields) {
      if (
        (aLeftRight && field.GetTextAngle().IsHorizontal()) ||
        (!aLeftRight && field.GetTextAngle().IsVertical())
      ) {
        if (field.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
          field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      }

      const pos = field.GetTextPos();
      const delta = { x: this.GetPosition().x - pos.x, y: this.GetPosition().y - pos.y };

      if (aLeftRight) pos.x = this.GetPosition().x + delta.x;
      else pos.y = this.GetPosition().y + delta.y;

      field.SetTextPos(pos);
    }
  }

  override MirrorHorizontally(aCenter: number): void {
    const old_pos = this.GetPosition();
    super.MirrorHorizontally(aCenter);

    for (const field of this.m_fields) {
      if (field.GetTextAngle().equals(ANGLE_HORIZONTAL)) field.FlipHJustify();

      const pos = field.GetTextPos();
      const delta = { x: old_pos.x - pos.x, y: old_pos.y - pos.y };
      pos.x = this.GetPosition().x + delta.x;

      field.SetPosition(pos);
    }
  }

  override MirrorVertically(aCenter: number): void {
    const old_pos = this.GetPosition();
    super.MirrorVertically(aCenter);

    for (const field of this.m_fields) {
      if (field.GetTextAngle().equals(ANGLE_VERTICAL)) field.FlipHJustify();

      const pos = field.GetTextPos();
      const delta = { x: old_pos.x - pos.x, y: old_pos.y - pos.y };
      pos.y = this.GetPosition().y + delta.y;

      field.SetPosition(pos);
    }
  }

  override SetPosition(aPosition: VECTOR2I): void {
    const offset = { x: aPosition.x - this.GetTextPos().x, y: aPosition.y - this.GetTextPos().y };
    this.Move(offset);
  }

  override AutoplaceFields(_aScreen: SCH_SCREEN | null, aAlgo: AUTOPLACE_ALGO): void {
    const margin = this.GetTextOffset() * 2;
    const labelLen = this.GetBodyBoundingBox(null).GetSizeMax();
    let accumulated = Math.trunc(this.GetTextHeight() / 2);

    if (this.Type() === KICAD_T.SCH_GLOBAL_LABEL_T)
      accumulated += margin + this.GetPenWidth() + margin;

    for (const field of this.m_fields) {
      const offset = { x: 0, y: 0 };

      switch (Number(this.GetSpinStyle())) {
        case SPIN_STYLE.UP:
          field.SetTextAngle(ANGLE_VERTICAL);
          field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

          if (field.GetId() === FIELD_T.INTERSHEET_REFS) offset.y = -(labelLen + margin);
          else offset.x = accumulated + Math.trunc(field.GetTextHeight() / 2);

          break;

        case SPIN_STYLE.RIGHT:
          field.SetTextAngle(ANGLE_HORIZONTAL);
          field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

          if (field.GetId() === FIELD_T.INTERSHEET_REFS) offset.x = labelLen + margin;
          else offset.y = accumulated + Math.trunc(field.GetTextHeight() / 2);

          break;

        case SPIN_STYLE.BOTTOM:
          field.SetTextAngle(ANGLE_VERTICAL);
          field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);

          if (field.GetId() === FIELD_T.INTERSHEET_REFS) offset.y = labelLen + margin;
          else offset.x = accumulated + Math.trunc(field.GetTextHeight() / 2);

          break;

        default:
        case SPIN_STYLE.LEFT:
          field.SetTextAngle(ANGLE_HORIZONTAL);
          field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);

          if (field.GetId() === FIELD_T.INTERSHEET_REFS) offset.x = -(labelLen + margin);
          else offset.y = accumulated + Math.trunc(field.GetTextHeight() / 2);

          break;
      }

      const pos = this.GetTextPos();
      field.SetTextPos({ x: pos.x + offset.x, y: pos.y + offset.y });

      if (field.GetId() === FIELD_T.INTERSHEET_REFS) accumulated += field.GetTextHeight() + margin;
    }

    if (aAlgo === AUTOPLACE_ALGO.AUTOPLACE_AUTO || aAlgo === AUTOPLACE_ALGO.AUTOPLACE_MANUAL)
      this.m_fieldsAutoplaced = aAlgo;
  }

  /**
   * Build an array of { pageNumber, pageName } pairs.
   *
   * @param pages [out] Array of { pageNumber, pageName } pairs.
   */
  GetIntersheetRefs(_aPath: SCH_SHEET_PATH | null, pages: [string, string][]): void {
    const schematic = this.Schematic();

    if (!schematic) return;

    const resolvedLabel = this.GetShownText(schematic.CurrentSheet(), false);
    const refs = schematic.GetPageRefsMap().get(resolvedLabel);

    if (!refs) return;

    let pageListCopy = [...refs];

    if (!schematic.Settings().m_IntersheetRefsListOwnPage) {
      const currentPage = schematic.CurrentSheet().GetVirtualPageNumber();
      pageListCopy = pageListCopy.filter((p) => p !== currentPage);

      if (pageListCopy.length === 0) return;
    }

    pageListCopy.sort((a, b) => a - b);

    const sheetPages = schematic.GetVirtualPageToSheetPagesMap();
    const sheetNames = schematic.GetVirtualPageToSheetNamesMap();

    for (const pageNum of pageListCopy)
      pages.push([sheetPages.get(pageNum) ?? '', sheetNames.get(pageNum) ?? '']);
  }

  /** Return the list of system text vars & fields for this label. */
  GetContextualTextVars(aVars: string[]): void {
    for (const field of this.m_fields) {
      if (field.IsMandatory()) aVars.push(field.GetCanonicalName().toUpperCase());
      else aVars.push(field.GetName());
    }

    aVars.push('OP');
    aVars.push('CONNECTION_TYPE');
    aVars.push('SHORT_NET_NAME');
    aVars.push('NET_NAME');
    aVars.push('NET_CLASS');
  }

  /**
   * Resolve any references to system tokens supported by the label.
   *
   * @param aDepth a counter to limit recursion and circular references.
   */
  ResolveTextVar(aPath: SCH_SHEET_PATH | null, token: OutStr, aDepth: number): boolean {
    const operatingPoint = /^OP(.([0-9])?([a-zA-Z]*))?$/;

    if (!aPath) return false; // wxCHECK

    const schematic = this.Schematic();

    if (!schematic) return false;

    const variant = schematic.GetCurrentVariant();

    if (operatingPoint.test(token.value)) {
      // The simulator's operating point needs this label's connection: pending the graph.
      token.value = '?';
      return true;
    }

    if (token.value.includes(':')) {
      if (schematic.ResolveCrossReference(token, aDepth + 1)) return true;
    }

    if (
      (this.Type() === KICAD_T.SCH_GLOBAL_LABEL_T ||
        this.Type() === KICAD_T.SCH_HIER_LABEL_T ||
        this.Type() === KICAD_T.SCH_SHEET_PIN_T) &&
      token.value === 'CONNECTION_TYPE'
    ) {
      token.value = getElectricalTypeLabel(this.GetShape());
      return true;
    } else if (token.value === 'SHORT_NET_NAME') {
      token.value = ''; // no connection until the graph is ported
      return true;
    } else if (token.value === 'NET_NAME') {
      token.value = '';
      return true;
    } else if (token.value === 'NET_CLASS') {
      token.value = '';
      return true;
    } else if (
      this.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T &&
      token.value === 'EXCLUDE_FROM_BOM'
    ) {
      const directive = this as unknown as SCH_DIRECTIVE_LABEL;
      token.value = '';

      for (const ruleArea of directive.GetConnectedRuleAreas()) {
        if (ruleArea.GetExcludedFromBOM(aPath, variant)) token.value = 'Excluded from BOM';
      }

      return true;
    } else if (
      this.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T &&
      token.value === 'EXCLUDE_FROM_BOARD'
    ) {
      const directive = this as unknown as SCH_DIRECTIVE_LABEL;
      token.value = '';

      for (const ruleArea of directive.GetConnectedRuleAreas()) {
        if (ruleArea.GetExcludedFromBoard(aPath, variant)) token.value = 'Excluded from board';
      }

      return true;
    } else if (
      this.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T &&
      token.value === 'EXCLUDE_FROM_SIM'
    ) {
      const directive = this as unknown as SCH_DIRECTIVE_LABEL;
      token.value = '';

      for (const ruleArea of directive.GetConnectedRuleAreas()) {
        if (ruleArea.GetExcludedFromSim(aPath, variant)) token.value = 'Excluded from simulation';
      }

      return true;
    } else if (this.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T && token.value === 'DNP') {
      const directive = this as unknown as SCH_DIRECTIVE_LABEL;
      token.value = '';

      for (const ruleArea of directive.GetConnectedRuleAreas()) {
        if (ruleArea.GetDNP(aPath, variant)) token.value = 'DNP';
      }

      return true;
    }

    for (const field of this.m_fields) {
      if (token.value === field.GetName()) {
        token.value = field.GetShownText(false, aDepth + 1);
        return true;
      }
    }

    // See if parent can resolve it (these will recurse to ancestors)

    if (this.Type() === KICAD_T.SCH_SHEET_PIN_T && this.m_parent) {
      const sheet = this.m_parent as unknown as SCH_SHEET;

      const path = aPath.Clone();

      if (path.Last() !== sheet) path.push_back(sheet);

      if (sheet.ResolveTextVar(path, token, aDepth + 1)) return true;
    } else {
      if (aPath.Last()?.ResolveTextVar(aPath, token, aDepth + 1)) return true;
    }

    return false;
  }

  protected override getShownTextOnPath(
    aPath: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    _aDepth: number,
  ): string {
    const depth = 0;

    const textResolver = (token: OutStr): boolean => this.ResolveTextVar(aPath, token, depth + 1);

    let text = EDA_TEXT.prototype.GetShownText.call(this, aAllowExtraText, depth);

    if (this.HasTextVars()) text = ResolveTextVars(text, textResolver, { value: depth });

    // Convert escape markers back to literal ${} and @{} for final display
    text = text.replaceAll('<<<ESC_DOLLAR:', '${');
    text = text.replaceAll('<<<ESC_AT:', '@{');

    return text;
  }

  override HasCachedDriverName(): boolean {
    return !this.HasTextVars();
  }

  override GetCachedDriverName(): string {
    return this.m_cached_driver_name;
  }

  override cacheShownText(): void {
    EDA_TEXT.prototype.cacheShownText.call(this);

    if (!this.HasTextVars())
      this.m_cached_driver_name = EscapeString(
        EDA_TEXT.prototype.GetShownText.call(this, true, 0),
        ESCAPE_CONTEXT.CTX_NETNAME,
      );
  }

  override RunOnChildren(aFunction: (aItem: SCH_ITEM) => void, _aMode: RECURSE_MODE): void {
    for (const field of this.m_fields) aFunction(field);
  }

  override Visit(aInspector: INSPECTOR, _testData: unknown, aScanTypes: readonly KICAD_T[]) {
    if (this.IsType(aScanTypes)) {
      if (INSPECT_RESULT.QUIT === aInspector(this, null)) return INSPECT_RESULT.QUIT;
    }

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === KICAD_T.SCH_FIELD_T) {
        for (const field of this.m_fields) {
          if (INSPECT_RESULT.QUIT === aInspector(field, this)) return INSPECT_RESULT.QUIT;
        }
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    if (this.matchesText(unescapeString(this.GetText()), aSearchData)) return true;

    // Net-name search asks this label's SCH_CONNECTION: pending the connection graph.
    return false;
  }

  override Replace(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown = null): boolean {
    const localSearchData = new EDA_SEARCH_DATA(aSearchData);
    localSearchData.findString = EscapeString(aSearchData.findString, ESCAPE_CONTEXT.CTX_NETNAME);
    localSearchData.replaceString = EscapeString(
      aSearchData.replaceString,
      ESCAPE_CONTEXT.CTX_NETNAME,
    );

    return EDA_TEXT.prototype.Replace.call(this, localSearchData);
  }

  override GetSchematicTextOffset(aSettings: RENDER_SETTINGS | null): VECTOR2I {
    const text_offset = { x: 0, y: 0 };

    // add an offset to x (or y) position to aid readability of text on a wire
    const dist = this.GetTextOffset(aSettings) + this.GetPenWidth();

    switch (Number(this.GetSpinStyle())) {
      case SPIN_STYLE.UP:
      case SPIN_STYLE.BOTTOM:
        text_offset.x = -dist;
        break; // Vert Orientation
      default:
        text_offset.y = -dist;
        break; // Horiz Orientation
    }

    return text_offset;
  }

  /**
   * Calculate the graphic shape (a polygon) associated to the text.
   *
   * @param aPoints A buffer to fill with polygon corners coordinates
   * @param Pos Position of the shape, for texts and labels: do nothing
   */
  CreateGraphicShape(
    _aSettings: RENDER_SETTINGS | null,
    aPoints: VECTOR2I[],
    _Pos: VECTOR2I,
  ): void {
    aPoints.length = 0;
  }

  GetLabelBoxExpansion(aSettings: RENDER_SETTINGS | null = null): number {
    let ratio: number;

    const s = toLabelSettings(aSettings);

    if (s && s.m_LabelSizeRatio !== undefined) ratio = s.m_LabelSizeRatio;
    else if (this.Schematic()) ratio = this.Schematic()!.Settings().m_LabelSizeRatio;
    else ratio = DEFAULT_LABEL_SIZE_RATIO; // For previews (such as in Preferences), etc.

    return KiROUND(ratio * this.GetTextSize().y);
  }

  /**
   * Return the bounding box of the label only, without taking in account its fields.
   */
  GetBodyBoundingBox(aSettings: RENDER_SETTINGS | null): BOX2I {
    // build the bounding box of the label only, without taking into account its fields

    const box = new BOX2I();
    const pts: VECTOR2I[] = [];

    this.CreateGraphicShape(aSettings, pts, this.GetTextPos());

    for (const pt of pts) box.Merge(pt);

    box.Inflate(Math.trunc(this.GetEffectiveTextPenWidth() / 2));
    box.Normalize();
    return box;
  }

  /** Return the bounding box of the label including its fields. */
  override GetBoundingBox(): BOX2I {
    // build the bounding box of the entire label, including its fields

    const box = this.GetBodyBoundingBox(null);

    for (const field of this.m_fields) {
      if (field.IsVisible() && field.GetText() !== '') {
        const fieldBBox = field.GetBoundingBox();

        if (this.Type() === KICAD_T.SCH_LABEL_T || this.Type() === KICAD_T.SCH_GLOBAL_LABEL_T)
          fieldBBox.Offset(this.GetSchematicTextOffset(null));

        box.Merge(fieldBBox);
      }
    }

    box.Normalize();

    return box;
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    const fieldBox = (field: SCH_FIELD): BOX2I => {
      const fieldBBox = field.GetBoundingBox();

      if (this.Type() === KICAD_T.SCH_LABEL_T || this.Type() === KICAD_T.SCH_GLOBAL_LABEL_T)
        fieldBBox.Offset(this.GetSchematicTextOffset(null));

      return fieldBBox;
    };

    if (a instanceof BOX2I) {
      const rect = new BOX2I(a.GetPosition(), a.GetSize());
      rect.Inflate(c ?? 0);

      if (b as boolean) return rect.Contains(this.GetBoundingBox());

      if (rect.Intersects(this.GetBodyBoundingBox(null))) return true;

      for (const field of this.m_fields) {
        if (field.IsVisible() && rect.Intersects(fieldBox(field))) return true;
      }

      return false;
    }

    if ('x' in a && 'y' in a) {
      const aAccuracy = (b as number | undefined) ?? 0;
      const bbox = this.GetBodyBoundingBox(null);
      bbox.Inflate(aAccuracy);

      if (bbox.Contains(a)) return true;

      for (const field of this.m_fields) {
        if (field.IsVisible()) {
          const fieldBBox = field.GetBoundingBox();
          fieldBBox.Inflate(aAccuracy);

          if (this.Type() === KICAD_T.SCH_LABEL_T || this.Type() === KICAD_T.SCH_GLOBAL_LABEL_T)
            fieldBBox.Offset(this.GetSchematicTextOffset(null));

          if (fieldBBox.Contains(a)) return true;
        }
      }

      return false;
    }

    const aContained = b as boolean;

    if (aContained) return KIGEOM_BoxHitTestChain(a, this.GetBoundingBox(), aContained);

    if (KIGEOM_BoxHitTestChain(a, this.GetBodyBoundingBox(null), aContained)) return true;

    for (const field of this.m_fields) {
      if (field.IsVisible() && KIGEOM_BoxHitTestChain(a, fieldBox(field), aContained)) return true;
    }

    return false;
  }

  override GetConnectionPoints(): VECTOR2I[] {
    return [this.GetTextPos()];
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    const item = new DANGLING_END_ITEM(DANGLING_END_T.LABEL_END, this, this.GetTextPos());
    aItemList.push(item);
  }

  override UpdateDanglingState(
    aItemListByType: DANGLING_END_ITEM[],
    aItemListByPos: DANGLING_END_ITEM[],
    aPath: SCH_SHEET_PATH | null = null,
  ): boolean {
    const previousState = this.m_isDangling;
    const text_pos = this.GetTextPos();
    this.m_isDangling = true;
    this.m_connectionType = CONNECTION_TYPE.NONE;

    for (
      let it = DANGLING_END_ITEM_HELPER.get_lower_pos(aItemListByPos, text_pos);
      it < aItemListByPos.length && samePt(aItemListByPos[it]!.GetPosition(), text_pos);
      it++
    ) {
      const item = aItemListByPos[it]!;

      if (item.GetItem() === this) continue;

      switch (item.GetType()) {
        case DANGLING_END_T.PIN_END:
        case DANGLING_END_T.LABEL_END:
        case DANGLING_END_T.SHEET_LABEL_END:
        case DANGLING_END_T.NO_CONNECT_END:
          if (samePt(text_pos, item.GetPosition())) {
            this.m_isDangling = false;

            if (aPath && item.GetType() !== DANGLING_END_T.PIN_END)
              this.AddConnectionTo(aPath, item.GetItem() as SCH_ITEM);
          }

          break;

        default:
          break;
      }

      if (!this.m_isDangling) break;
    }

    if (this.m_isDangling) {
      for (
        let it = DANGLING_END_ITEM_HELPER.get_lower_type(aItemListByType, DANGLING_END_T.BUS_END);
        it < aItemListByType.length && aItemListByType[it]!.GetType() === DANGLING_END_T.BUS_END;
        it++
      ) {
        const item = aItemListByType[it]!;
        const nextItem = aItemListByType[++it]!;

        const accuracy = 1; // We have rounding issues with an accuracy of 0

        this.m_isDangling = !TestSegmentHit(
          text_pos,
          item.GetPosition(),
          nextItem.GetPosition(),
          accuracy,
        );

        if (this.m_isDangling) continue;

        this.m_connectionType = CONNECTION_TYPE.BUS;

        // Add the line to the connected items, since it won't be picked
        // up by a search of intersecting connection points
        if (aPath) {
          const sch_item = item.GetItem() as SCH_ITEM;
          this.AddConnectionTo(aPath, sch_item);
          sch_item.AddConnectionTo(aPath, this);
        }

        break;
      }

      if (this.m_isDangling) {
        for (
          let it = DANGLING_END_ITEM_HELPER.get_lower_type(
            aItemListByType,
            DANGLING_END_T.WIRE_END,
          );
          it < aItemListByType.length && aItemListByType[it]!.GetType() === DANGLING_END_T.WIRE_END;
          it++
        ) {
          const item = aItemListByType[it]!;
          const nextItem = aItemListByType[++it]!;

          const accuracy = 1; // We have rounding issues with an accuracy of 0

          this.m_isDangling = !TestSegmentHit(
            text_pos,
            item.GetPosition(),
            nextItem.GetPosition(),
            accuracy,
          );

          if (this.m_isDangling) continue;

          this.m_connectionType = CONNECTION_TYPE.NET;

          // Add the line to the connected items, since it won't be picked
          // up by a search of intersecting connection points
          if (aPath) {
            const sch_item = item.GetItem() as SCH_ITEM;
            this.AddConnectionTo(aPath, sch_item);
            sch_item.AddConnectionTo(aPath, this);
          }

          break;
        }
      }
    }

    if (this.m_isDangling) this.m_connectionType = CONNECTION_TYPE.NONE;

    return previousState !== this.m_isDangling;
  }

  override IsDangling(): boolean {
    return this.m_isDangling;
  }
  SetIsDangling(aIsDangling: boolean): void {
    this.m_isDangling = aIsDangling;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this || !this.IsConnectable()) return false;

    if (!(aItem instanceof SCH_LABEL_BASE)) return false; // wxCHECK

    const label = aItem;

    if (!samePt(this.GetPosition(), label.GetPosition())) return true;

    if (this.GetShownText(aInstance, true) !== label.GetShownText(aInstance, true)) return true;

    const netclasses: string[] = [];
    const otherNetclasses: string[] = [];

    for (const field of this.m_fields) {
      if (field.GetCanonicalName() === 'Netclass') netclasses.push(field.GetText());
    }

    for (const field of label.m_fields) {
      if (field.GetCanonicalName() === 'Netclass') otherNetclasses.push(field.GetText());
    }

    return (
      netclasses.length !== otherNetclasses.length ||
      netclasses.some((n, i) => n !== otherNetclasses[i])
    );
  }

  override ViewGetLayers(): number[] {
    return [
      SCH_LAYER_ID.LAYER_DANGLING,
      SCH_LAYER_ID.LAYER_DEVICE,
      SCH_LAYER_ID.LAYER_NETCLASS_REFS,
      SCH_LAYER_ID.LAYER_FIELDS,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
  }

  AutoRotateOnPlacement(): boolean {
    return this.m_autoRotateOnPlacement;
  }

  SetAutoRotateOnPlacement(autoRotate = true): void {
    this.m_autoRotateOnPlacement = autoRotate;
  }

  abstract AutoRotateOnPlacementSupported(): boolean;

  override Similarity(aOther: SCH_ITEM): number {
    if (!(aOther instanceof SCH_LABEL_BASE)) return 0.0;

    const other = aOther;

    if (this.m_Uuid === other.m_Uuid) return 1.0;

    let similarity = super.Similarity(aOther);

    // typeid( *this ) != typeid( aOther )
    if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(aOther)) similarity *= 0.9;

    if (this.m_shape === other.m_shape) similarity *= 0.9;

    if (this.m_connectionType === other.m_connectionType) similarity *= 0.9;

    for (let ii = 0; ii < this.m_fields.length; ++ii) {
      if (ii >= other.m_fields.length) break;

      similarity *= this.m_fields[ii]!.Similarity(other.m_fields[ii]!);
    }

    const diff = Math.abs(this.m_fields.length - other.m_fields.length);

    similarity *= 0.9 ** diff;

    return similarity;
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (!(aOther instanceof SCH_LABEL_BASE)) return false;

    const other = aOther;

    if (this.m_shape !== other.m_shape) return false;

    if (this.m_connectionType !== other.m_connectionType) return false;

    if (this.m_fields.length !== other.m_fields.length) return false;

    for (let ii = 0; ii < this.m_fields.length; ++ii) {
      if (!this.m_fields[ii]!.equals(other.m_fields[ii]!)) return false;
    }

    return super.equals(aOther);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    super.swapData(aItem);

    const label = aItem as SCH_LABEL_BASE;

    [this.m_fields, label.m_fields] = [label.m_fields, this.m_fields];
    [this.m_fieldsAutoplaced, label.m_fieldsAutoplaced] = [
      label.m_fieldsAutoplaced,
      this.m_fieldsAutoplaced,
    ];

    for (const field of this.m_fields) field.SetParent(this);

    for (const field of label.m_fields) field.SetParent(label);

    [this.m_shape, label.m_shape] = [label.m_shape, this.m_shape];
    [this.m_connectionType, label.m_connectionType] = [
      label.m_connectionType,
      this.m_connectionType,
    ];
    [this.m_isDangling, label.m_isDangling] = [label.m_isDangling, this.m_isDangling];
    [this.m_lastResolvedColor, label.m_lastResolvedColor] = [
      label.m_lastResolvedColor,
      this.m_lastResolvedColor,
    ];
  }
}

registerLabelDefaultFieldName(SCH_LABEL_BASE.GetDefaultFieldName);

export class SCH_LABEL extends SCH_LABEL_BASE {
  constructor(pos: VECTOR2I = { x: 0, y: 0 }, text = '') {
    super(pos, text, KICAD_T.SCH_LABEL_T);
    this.m_layer = SCH_LAYER_ID.LAYER_LOCLABEL;
    this.m_shape = LABEL_FLAG_SHAPE.L_INPUT;
    this.m_isDangling = true;
  }

  static override ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_LABEL_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_LABEL';
  }

  override GetFriendlyName(): string {
    return 'Label';
  }

  override GetBodyBoundingBox(aSettings: RENDER_SETTINGS | null): BOX2I {
    // Labels have a position point that is outside of the TextBox
    const rect = this.GetTextBox(aSettings).Clone();

    rect.Offset(0, -this.GetTextOffset());
    rect.Inflate(this.GetEffectiveTextPenWidth());

    if (!this.GetTextAngle().IsZero()) {
      // Rotate rect
      const pos = RotatePoint(rect.GetOrigin(), this.GetTextPos(), this.GetTextAngle());
      const end = RotatePoint(rect.GetEnd(), this.GetTextPos(), this.GetTextAngle());

      rect.SetOrigin(pos);
      rect.SetEnd(end);

      rect.Normalize();
    }

    // Labels have a position point that is outside of the TextBox
    rect.Merge(this.GetPosition());

    return rect;
  }

  override IsConnectable(): boolean {
    return true;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Label '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}'`;
  }

  override IsReplaceable(): boolean {
    return true;
  }

  override Clone(): SCH_LABEL {
    return SCH_LABEL_BASE.copyLabel(new SCH_LABEL(), this);
  }

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    return this.m_isDangling && samePt(this.GetPosition(), aPos);
  }

  override AutoRotateOnPlacementSupported(): boolean {
    return false;
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    return samePt(EDA_TEXT.prototype.GetTextPos.call(this), aPosition);
  }
}

export class SCH_DIRECTIVE_LABEL extends SCH_LABEL_BASE {
  private m_pinLength: number;
  private m_symbolSize: number;
  private m_connected_rule_areas: Set<SCH_RULE_AREA>;

  constructor(pos: VECTOR2I = { x: 0, y: 0 }) {
    super(pos, '', KICAD_T.SCH_DIRECTIVE_LABEL_T);
    this.m_layer = SCH_LAYER_ID.LAYER_NETCLASS_REFS;
    this.m_shape = LABEL_FLAG_SHAPE.F_ROUND;
    this.m_pinLength = schIUScale.milsToIU(100);
    this.m_symbolSize = schIUScale.milsToIU(20);
    this.m_isDangling = true;
    this.m_connected_rule_areas = new Set();
  }

  /** `SCH_DIRECTIVE_LABEL( const SCH_DIRECTIVE_LABEL& )`: the rule-area links are not copied. */
  static copyOf(aClassLabel: SCH_DIRECTIVE_LABEL): SCH_DIRECTIVE_LABEL {
    const copy = SCH_LABEL_BASE.copyLabel(new SCH_DIRECTIVE_LABEL(), aClassLabel);
    copy.m_pinLength = aClassLabel.m_pinLength;
    copy.m_symbolSize = aClassLabel.m_symbolSize;
    return copy;
  }

  /** `~SCH_DIRECTIVE_LABEL()`: drop this label from the rule areas that know it. */
  override Destroy(): void {
    for (const ruleArea of this.m_connected_rule_areas) ruleArea.RemoveDirective(this);

    super.Destroy();
  }

  static override ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_DIRECTIVE_LABEL_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_DIRECTIVE_LABEL';
  }

  override GetFriendlyName(): string {
    return 'Directive Label';
  }

  override Clone(): SCH_DIRECTIVE_LABEL {
    return SCH_DIRECTIVE_LABEL.copyOf(this);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    super.swapData(aItem);

    const label = aItem as SCH_DIRECTIVE_LABEL;

    [this.m_pinLength, label.m_pinLength] = [label.m_pinLength, this.m_pinLength];
    [this.m_symbolSize, label.m_symbolSize] = [label.m_symbolSize, this.m_symbolSize];
  }

  GetFlagShape(): FLAG_SHAPE {
    return this.m_shape as unknown as FLAG_SHAPE;
  }
  SetFlagShape(aShape: FLAG_SHAPE): void {
    this.m_shape = aShape as unknown as LABEL_FLAG_SHAPE;
  }

  GetPinLength(): number {
    return this.m_pinLength;
  }
  SetPinLength(aLength: number): void {
    this.m_pinLength = aLength;
  }

  override GetPenWidth(): number {
    let pen = 0;

    if (this.Schematic()) pen = this.Schematic()!.Settings().m_DefaultLineWidth;

    return this.GetEffectiveTextPenWidth(pen);
  }

  override CreateGraphicShape(
    _aRenderSettings: RENDER_SETTINGS | null,
    aPoints: VECTOR2I[],
    aPos: VECTOR2I,
  ): void {
    let symbolSize = this.m_symbolSize;
    const m_pinLength = this.m_pinLength;
    const m_symbolSize = this.m_symbolSize;

    aPoints.length = 0;

    switch (this.m_shape) {
      case LABEL_FLAG_SHAPE.F_DOT:
      case LABEL_FLAG_SHAPE.F_ROUND:
        if (this.m_shape === LABEL_FLAG_SHAPE.F_DOT) symbolSize = KiROUND(symbolSize * 0.7);

        // First 3 points are used for generating shape
        aPoints.push({ x: 0, y: 0 });
        aPoints.push({ x: 0, y: m_pinLength - symbolSize });
        aPoints.push({ x: 0, y: m_pinLength });
        // These points are just used to bulk out the bounding box
        aPoints.push({ x: -m_symbolSize, y: m_pinLength });
        aPoints.push({ x: 0, y: m_pinLength });
        aPoints.push({ x: m_symbolSize, y: m_pinLength + symbolSize });
        break;

      case LABEL_FLAG_SHAPE.F_DIAMOND:
        aPoints.push({ x: 0, y: 0 });
        aPoints.push({ x: 0, y: m_pinLength - symbolSize });
        aPoints.push({ x: -2 * m_symbolSize, y: m_pinLength });
        aPoints.push({ x: 0, y: m_pinLength + symbolSize });
        aPoints.push({ x: 2 * m_symbolSize, y: m_pinLength });
        aPoints.push({ x: 0, y: m_pinLength - symbolSize });
        aPoints.push({ x: 0, y: 0 });
        break;

      case LABEL_FLAG_SHAPE.F_RECTANGLE:
        symbolSize = KiROUND(symbolSize * 0.8);

        aPoints.push({ x: 0, y: 0 });
        aPoints.push({ x: 0, y: m_pinLength - symbolSize });
        aPoints.push({ x: -2 * symbolSize, y: m_pinLength - symbolSize });
        aPoints.push({ x: -2 * symbolSize, y: m_pinLength + symbolSize });
        aPoints.push({ x: 2 * symbolSize, y: m_pinLength + symbolSize });
        aPoints.push({ x: 2 * symbolSize, y: m_pinLength - symbolSize });
        aPoints.push({ x: 0, y: m_pinLength - symbolSize });
        aPoints.push({ x: 0, y: 0 });
        break;

      default:
        break;
    }

    // Rotate outlines and move corners to real position
    for (let i = 0; i < aPoints.length; i++) {
      let aPoint = aPoints[i]!;

      switch (Number(this.GetSpinStyle())) {
        case SPIN_STYLE.UP:
          aPoint = RotatePoint(aPoint, ANGLE_90.Invert());
          break;
        case SPIN_STYLE.RIGHT:
          aPoint = RotatePoint(aPoint, ANGLE_180);
          break;
        case SPIN_STYLE.BOTTOM:
          aPoint = RotatePoint(aPoint, ANGLE_90);
          break;
        default:
          break;
      }

      aPoints[i] = { x: aPoint.x + aPos.x, y: aPoint.y + aPos.y };
    }
  }

  override AutoplaceFields(_aScreen: SCH_SCREEN | null, aAlgo: AUTOPLACE_ALGO): void {
    let margin = this.GetTextOffset();
    let symbolWidth = this.m_symbolSize;
    let origin = this.m_pinLength;

    if (
      this.m_shape === LABEL_FLAG_SHAPE.F_DIAMOND ||
      this.m_shape === LABEL_FLAG_SHAPE.F_RECTANGLE
    )
      symbolWidth *= 2;

    if (this.IsItalic()) margin = KiROUND(margin * 1.5);

    let offset = { x: 0, y: 0 };

    for (const field of this.m_fields) {
      if (field.GetText() === '') continue;

      switch (Number(this.GetSpinStyle())) {
        case SPIN_STYLE.UP:
          field.SetTextAngle(ANGLE_VERTICAL);
          offset = { x: -origin, y: -(symbolWidth + margin) };
          break;

        case SPIN_STYLE.RIGHT:
          field.SetTextAngle(ANGLE_HORIZONTAL);
          offset = { x: symbolWidth + margin, y: -origin };
          break;

        case SPIN_STYLE.BOTTOM:
          field.SetTextAngle(ANGLE_VERTICAL);
          offset = { x: origin, y: -(symbolWidth + margin) };
          break;

        default:
        case SPIN_STYLE.LEFT:
          field.SetTextAngle(ANGLE_HORIZONTAL);
          offset = { x: symbolWidth + margin, y: origin };
          break;
      }

      field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      field.SetTextPos({ x: this.GetPosition().x + offset.x, y: this.GetPosition().y + offset.y });

      origin -= field.GetTextHeight() + margin;
    }

    if (aAlgo === AUTOPLACE_ALGO.AUTOPLACE_AUTO || aAlgo === AUTOPLACE_ALGO.AUTOPLACE_MANUAL)
      this.m_fieldsAutoplaced = aAlgo;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    if (this.m_fields.length === 0) {
      return 'Directive Label';
    } else {
      const firstField = this.m_fields[0]!;
      const content = aFull
        ? firstField.GetShownText(false)
        : KIUI_EllipsizeMenuText(firstField.GetText());

      if (content === '')
        return `Directive Label [${unescapeString(this.m_fields[0]!.GetName())} (empty)]`;
      else return `Directive Label [${unescapeString(this.m_fields[0]!.GetName())} ${content}]`;
    }
  }

  override IsConnectable(): boolean {
    return true;
  }

  override AutoRotateOnPlacementSupported(): boolean {
    return false;
  }

  override MirrorSpinStyle(aLeftRight: boolean): void {
    // The "pin" is perpendicular to the label, so flip the spin style the other way.
    SCH_TEXT.prototype.MirrorSpinStyle.call(this, !aLeftRight);

    for (const field of this.m_fields) {
      if (
        (aLeftRight && field.GetTextAngle().IsHorizontal()) ||
        (!aLeftRight && field.GetTextAngle().IsVertical())
      ) {
        if (field.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
          field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      }

      const pos = field.GetTextPos();
      const delta = { x: this.GetPosition().x - pos.x, y: this.GetPosition().y - pos.y };

      if (aLeftRight) pos.x = this.GetPosition().x + delta.x;
      else pos.y = this.GetPosition().y + delta.y;

      field.SetTextPos(pos);
    }
  }

  override MirrorHorizontally(aCenter: number): void {
    const old_pos = this.GetPosition();

    // The "text" is in fact a graphic shape. For a horizontal "text", it looks like a
    // vertical line (the sort of pin) and the only thing to do is mirror its position.
    this.SetSpinStyle(this.GetSpinStyle().MirrorX());
    this.SetTextX(MIRRORVAL(this.GetTextPos().x, aCenter));

    for (const field of this.m_fields) {
      if (field.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
        field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
      else if (field.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

      const pos = field.GetTextPos();
      const delta = { x: old_pos.x - pos.x, y: old_pos.y - pos.y };
      pos.x = this.GetPosition().x + delta.x;

      field.SetPosition(pos);
    }
  }

  override MirrorVertically(aCenter: number): void {
    const old_pos = this.GetPosition();

    // The "text" is in fact a graphic shape. For a vertical "text", it looks like a
    // horizontal line (the sort of pin) and the only thing to do is mirror its position.
    this.SetSpinStyle(this.GetSpinStyle().MirrorY());
    this.SetTextY(MIRRORVAL(this.GetTextPos().y, aCenter));

    for (const field of this.m_fields) {
      const pos = field.GetTextPos();
      const delta = { x: old_pos.x - pos.x, y: old_pos.y - pos.y };
      pos.y = this.GetPosition().y + delta.y;

      field.SetPosition(pos);
    }
  }

  /** Add a rule area to the set of rule areas this label connects to. */
  AddConnectedRuleArea(aRuleArea: SCH_RULE_AREA): void {
    this.m_connected_rule_areas.add(aRuleArea);
  }

  /** Remove all rule areas from the cache. */
  ClearConnectedRuleAreas(): void {
    this.m_connected_rule_areas.clear();
  }

  /** Remove a specific rule area from the cache. */
  RemoveConnectedRuleArea(aRuleArea: SCH_RULE_AREA): void {
    this.m_connected_rule_areas.delete(aRuleArea);
  }

  /** Return the rule areas this label is connected to. */
  GetConnectedRuleAreas(): ReadonlySet<SCH_RULE_AREA> {
    return new Set(this.m_connected_rule_areas);
  }

  /** Determine dangling state from connectivity and cached connected rule areas. */
  override IsDangling(): boolean {
    return this.m_isDangling && this.m_connected_rule_areas.size === 0;
  }

  override IncrementLabel(aIncrement: number): boolean {
    for (const field of this.m_fields) {
      if (
        field.GetCanonicalName() === 'Netclass' ||
        field.GetCanonicalName() === 'Component Class'
      ) {
        const text = IncrementString(field.GetText(), aIncrement);

        if (text !== null) field.SetText(text);
      }
    }

    return true;
  }
}

export class SCH_GLOBALLABEL extends SCH_LABEL_BASE {
  constructor(pos: VECTOR2I = { x: 0, y: 0 }, text = '') {
    super(pos, text, KICAD_T.SCH_GLOBAL_LABEL_T);
    this.m_layer = SCH_LAYER_ID.LAYER_GLOBLABEL;
    this.m_shape = LABEL_FLAG_SHAPE.L_BIDI;
    this.m_isDangling = true;

    this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

    const refs = new SCH_FIELD(
      this,
      FIELD_T.INTERSHEET_REFS,
      GetDefaultFieldNameForId(FIELD_T.INTERSHEET_REFS, false),
    );
    this.m_fields.push(refs);

    refs.SetText('${INTERSHEET_REFS}');
    refs.SetVisible(false);
    refs.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
    refs.SetTextPos(pos);
  }

  static copyOf(aGlobalLabel: SCH_GLOBALLABEL): SCH_GLOBALLABEL {
    const copy = new SCH_GLOBALLABEL();
    return SCH_LABEL_BASE.copyLabel(copy, aGlobalLabel);
  }

  static override ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_GLOBAL_LABEL_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_GLOBALLABEL';
  }

  override GetFriendlyName(): string {
    return 'Global Label';
  }

  override Clone(): SCH_GLOBALLABEL {
    return SCH_GLOBALLABEL.copyOf(this);
  }

  override GetMandatoryFieldCount(): number {
    return 1;
  }

  /** `GetField( FIELD_T )`: the field, created on demand. */
  GetField(aFieldType: FIELD_T): SCH_FIELD {
    const field = FindField(this.m_fields, aFieldType);

    if (field) return field;

    const added = new SCH_FIELD(this, aFieldType);
    this.m_fields.push(added);
    return added;
  }

  override SetSpinStyle(aSpinStyle: SPIN_STYLE): void {
    super.SetSpinStyle(aSpinStyle);
    this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
  }

  override GetSchematicTextOffset(aSettings: RENDER_SETTINGS | null): VECTOR2I {
    let horiz = this.GetLabelBoxExpansion(aSettings);

    // Center the text on the center line of "E" instead of "R" to make room for an overbar
    const vert = Math.trunc(this.GetTextHeight() * 0.0715);

    switch (this.m_shape) {
      case LABEL_FLAG_SHAPE.L_INPUT:
      case LABEL_FLAG_SHAPE.L_BIDI:
      case LABEL_FLAG_SHAPE.L_TRISTATE:
        horiz += Math.trunc((this.GetTextHeight() * 3) / 4); // Use three-quarters-height as proxy for triangle size
        break;

      default:
        break;
    }

    switch (Number(this.GetSpinStyle())) {
      case SPIN_STYLE.UP:
        return { x: vert, y: -horiz };
      case SPIN_STYLE.RIGHT:
        return { x: horiz, y: vert };
      case SPIN_STYLE.BOTTOM:
        return { x: vert, y: horiz };
      default:
        return { x: -horiz, y: vert };
    }
  }

  override CreateGraphicShape(
    aRenderSettings: RENDER_SETTINGS | null,
    aPoints: VECTOR2I[],
    aPos: VECTOR2I,
  ): void {
    const margin = this.GetLabelBoxExpansion(aRenderSettings);
    const halfSize = Math.trunc(this.GetTextHeight() / 2) + margin;
    const linewidth = this.GetPenWidth();
    const symb_len = this.GetTextBox(aRenderSettings).GetWidth() + 2 * margin;

    const x = symb_len + linewidth + 3;
    const y = halfSize + linewidth + 3;

    aPoints.length = 0;

    // Create outline shape : 6 points
    aPoints.push({ x: 0, y: 0 });
    aPoints.push({ x: 0, y: -y }); // Up
    aPoints.push({ x: -x, y: -y }); // left
    aPoints.push({ x: -x, y: 0 }); // Up left
    aPoints.push({ x: -x, y: y }); // left down
    aPoints.push({ x: 0, y: y }); // down

    let x_offset = 0;

    switch (this.m_shape) {
      case LABEL_FLAG_SHAPE.L_INPUT:
        x_offset = -halfSize;
        aPoints[0]!.x += halfSize;
        break;

      case LABEL_FLAG_SHAPE.L_OUTPUT:
        aPoints[3]!.x -= halfSize;
        break;

      case LABEL_FLAG_SHAPE.L_BIDI:
      case LABEL_FLAG_SHAPE.L_TRISTATE:
        x_offset = -halfSize;
        aPoints[0]!.x += halfSize;
        aPoints[3]!.x -= halfSize;
        break;

      default:
        break;
    }

    // Rotate outlines and move corners in real position
    for (let i = 0; i < aPoints.length; i++) {
      let aPoint = { x: aPoints[i]!.x + x_offset, y: aPoints[i]!.y };

      switch (Number(this.GetSpinStyle())) {
        case SPIN_STYLE.UP:
          aPoint = RotatePoint(aPoint, ANGLE_90.Invert());
          break;
        case SPIN_STYLE.RIGHT:
          aPoint = RotatePoint(aPoint, ANGLE_180);
          break;
        case SPIN_STYLE.BOTTOM:
          aPoint = RotatePoint(aPoint, ANGLE_90);
          break;
        default:
          break;
      }

      aPoints[i] = { x: aPoint.x + aPos.x, y: aPoint.y + aPos.y };
    }

    aPoints.push({ ...aPoints[0]! }); // closing
  }

  override ResolveTextVar(aPath: SCH_SHEET_PATH | null, token: OutStr, aDepth: number): boolean {
    if (!aPath) return false; // wxCHECK

    const schematic = this.Schematic();

    if (!schematic) return false;

    if (token.value === 'INTERSHEET_REFS') {
      const settings = schematic.Settings();
      let ref = '';
      const refs = schematic.GetPageRefsMap().get(this.GetShownText(aPath, true));

      if (!refs) {
        ref = '?';
      } else {
        let pageListCopy = [...refs].sort((a, b) => a - b);

        if (!settings.m_IntersheetRefsListOwnPage) {
          const currentPage = schematic.CurrentSheet().GetVirtualPageNumber();
          pageListCopy = pageListCopy.filter((p) => p !== currentPage);
        }

        const sheetPages = schematic.GetVirtualPageToSheetPagesMap();

        if (settings.m_IntersheetRefsFormatShort && pageListCopy.length > 2) {
          ref += `${sheetPages.get(pageListCopy[0]!) ?? ''}..${sheetPages.get(pageListCopy.at(-1)!) ?? ''}`;
        } else {
          for (const pageNo of pageListCopy) ref += `${sheetPages.get(pageNo) ?? ''},`;

          if (ref !== '' && ref.endsWith(',')) ref = ref.slice(0, -1);
        }
      }

      token.value = settings.m_IntersheetRefsPrefix + ref + settings.m_IntersheetRefsSuffix;
      return true;
    }

    return super.ResolveTextVar(aPath, token, aDepth);
  }

  override IsConnectable(): boolean {
    return true;
  }

  override ViewGetLayers(): number[] {
    return [
      SCH_LAYER_ID.LAYER_DANGLING,
      SCH_LAYER_ID.LAYER_GLOBLABEL,
      SCH_LAYER_ID.LAYER_DEVICE,
      SCH_LAYER_ID.LAYER_INTERSHEET_REFS,
      SCH_LAYER_ID.LAYER_NETCLASS_REFS,
      SCH_LAYER_ID.LAYER_FIELDS,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Global Label '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}'`;
  }

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    return this.m_isDangling && samePt(this.GetPosition(), aPos);
  }

  override AutoRotateOnPlacementSupported(): boolean {
    return true;
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    return samePt(EDA_TEXT.prototype.GetTextPos.call(this), aPosition);
  }
}

export class SCH_HIERLABEL extends SCH_LABEL_BASE {
  constructor(
    pos: VECTOR2I = { x: 0, y: 0 },
    text = '',
    aType: KICAD_T = KICAD_T.SCH_HIER_LABEL_T,
  ) {
    super(pos, text, aType);
    this.m_layer = SCH_LAYER_ID.LAYER_HIERLABEL;
    this.m_shape = LABEL_FLAG_SHAPE.L_INPUT;
    this.m_isDangling = true;
  }

  static copyOf(aOther: SCH_HIERLABEL): SCH_HIERLABEL {
    return SCH_LABEL_BASE.copyLabel(new SCH_HIERLABEL(), aOther);
  }

  static override ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_HIER_LABEL_T === aItem.Type();
  }

  override GetFriendlyName(): string {
    return 'Hierarchical Label';
  }

  override GetClass(): string {
    return 'SCH_HIERLABEL';
  }

  override SetSpinStyle(aSpinStyle: SPIN_STYLE): void {
    super.SetSpinStyle(aSpinStyle);
    this.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
  }

  override GetSchematicTextOffset(aSettings: RENDER_SETTINGS | null): VECTOR2I {
    const text_offset = { x: 0, y: 0 };
    let dist = this.GetTextOffset(aSettings);

    dist += this.GetTextWidth();

    switch (Number(this.GetSpinStyle())) {
      case SPIN_STYLE.UP:
        text_offset.y = -dist;
        break; // Orientation vert UP
      case SPIN_STYLE.RIGHT:
        text_offset.x = dist;
        break; // Orientation horiz inverse
      case SPIN_STYLE.BOTTOM:
        text_offset.y = dist;
        break; // Orientation vert BOTTOM
      default:
        text_offset.x = -dist;
        break; // Orientation horiz normale
    }

    return text_offset;
  }

  /**
   * `CreateGraphicShape( aSettings, aPoints, aPos )`, or with an explicit shape (the sheet
   * pin draws its label's shape mirrored).
   */
  override CreateGraphicShape(
    _aSettings: RENDER_SETTINGS | null,
    aPoints: VECTOR2I[],
    aPos: VECTOR2I,
    aShape: LABEL_FLAG_SHAPE = this.m_shape,
  ): void {
    const template = TemplateShape[aShape]![Number(this.GetSpinStyle())]!;
    const halfSize = Math.trunc(this.GetTextHeight() / 2);
    const imax = template[0]!;
    let t = 1;

    aPoints.length = 0;

    for (let ii = 0; ii < imax; ii++) {
      const corner = { x: 0, y: 0 };
      corner.x = halfSize * template[t]! + aPos.x;
      t++;

      corner.y = halfSize * template[t]! + aPos.y;
      t++;

      aPoints.push(corner);
    }
  }

  override GetBodyBoundingBox(aSettings: RENDER_SETTINGS | null): BOX2I {
    const penWidth = this.GetEffectiveTextPenWidth();
    const margin = this.GetTextOffset();

    let x = this.GetTextPos().x;
    let y = this.GetTextPos().y;

    const height = this.GetTextHeight() + penWidth + margin;
    let length = this.GetTextBox(aSettings).GetWidth();

    length += height; // add height for triangular shapes

    let dx: number;
    let dy: number;

    switch (Number(this.GetSpinStyle())) {
      case SPIN_STYLE.UP:
        dx = height;
        dy = -length;
        x -= Math.trunc(height / 2);
        y += schIUScale.milsToIU(DANGLING_SYMBOL_SIZE);
        break;

      case SPIN_STYLE.RIGHT:
        dx = length;
        dy = height;
        x -= schIUScale.milsToIU(DANGLING_SYMBOL_SIZE);
        y -= Math.trunc(height / 2);
        break;

      case SPIN_STYLE.BOTTOM:
        dx = height;
        dy = length;
        x -= Math.trunc(height / 2);
        y -= schIUScale.milsToIU(DANGLING_SYMBOL_SIZE);
        break;

      default:
        dx = -length;
        dy = height;
        x += schIUScale.milsToIU(DANGLING_SYMBOL_SIZE);
        y -= Math.trunc(height / 2);
        break;
    }

    const box = new BOX2I({ x, y }, { x: dx, y: dy });
    box.Normalize();
    return box;
  }

  override IsConnectable(): boolean {
    return true;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Hierarchical Label '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}'`;
  }

  override Clone(): SCH_HIERLABEL {
    return SCH_HIERLABEL.copyOf(this);
  }

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    return this.m_isDangling && samePt(this.GetPosition(), aPos);
  }

  override AutoRotateOnPlacementSupported(): boolean {
    return true;
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    return samePt(EDA_TEXT.prototype.GetTextPos.call(this), aPosition);
  }
}
