// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHAPE_PROPERTIES` (pcbnew/dialogs/dialog_shape_properties.cpp): the GEOM_SYNCERs that
 * keep a shape's alternate definitions in step on a working copy, the class over the live
 * PCB_SHAPE, and its window on DIALOG_SHAPE_PROPERTIES_BASE.
 */
import { type JSX, useState } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T, UI_FILL_MODE } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale, stringFromValue } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { IsCopperLayer, IsExternalCopperLayer } from '@ziroeda/common/layer_id.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { EVENTS } from '@ziroeda/common/tool/tool_event.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcCenterFromAngle, GetRotated } from '@ziroeda/kimath/src/trigo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import { pcbUnitText, pcbUnitValue } from '../pcb_unit_binder.js';
import { DIALOG_SHAPE_PROPERTIES_BASE } from './dialog_shape_properties_base.js';
import type { TransferResult } from './dialog_text_properties.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** A UNIT_BINDER over one generated wxTextCtrl: its label and the text it holds. */
export interface BOUND_CONTROL {
  /** "X:" / "Y:" for a point, else the field's name with its colon. */
  label: string;
  /** EDA_UNITS::DEGREES for an angle field; a length otherwise. */
  isAngle: boolean;
  text: string;
}

/** What AddXYPointToSizer / AddFieldToSizer put in a page's gridbag, at (row, col). */
export type GEOM_ITEM =
  | { type: 'xy'; name: string; row: number; col: number; ctrl: number }
  | { type: 'field'; name: string; row: number; col: number; ctrl: number };

export interface GEOM_PAGE {
  /** The notebook page's AddPage() text. */
  title: string;
  items: GEOM_ITEM[];
}

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
/** VECTOR2I / 2: integer division, truncating toward zero. */
const half = (a: Vec2): Vec2 => ({ x: Math.trunc(a.x / 2), y: Math.trunc(a.y / 2) });

/**
 * `GEOM_SYNCER`: holds the working PCB_SHAPE and the bound controls, and keeps them in step.
 * BindCtrls' wxEVT_TEXT handlers are `OnCtrlChanged`: a control edited calls its group's change.
 */
abstract class GEOM_SYNCER {
  constructor(
    protected readonly m_shape: PCB_SHAPE,
    protected readonly m_boundCtrls: BOUND_CONTROL[],
    private readonly m_units: StatusUnits,
    private readonly m_groups: readonly (readonly [number, number, () => void])[],
  ) {}

  /** The wxEVT_TEXT BindCtrls connects for control `aIndex`. */
  OnCtrlChanged(aIndex: number): void {
    for (const [from, to, cb] of this.m_groups) if (aIndex >= from && aIndex <= to) cb();
  }

  SetShape(aShape: PCB_SHAPE): void {
    // m_shape = aShape: PCB_SHAPE's operator=
    this.m_shape.assignPcbShape(aShape);
    this.updateAll();
  }

  Validate(_aErrs: string[]): boolean {
    return true;
  }

  protected abstract updateAll(): void;

  protected GetIntValue(aIndex: number): number {
    const v = pcbUnitValue(this.m_boundCtrls[aIndex]!.text, this.m_units);
    return Number.isFinite(v) ? Math.trunc(v) : 0;
  }

  protected GetAngleValue(aIndex: number): EDA_ANGLE {
    const v = Number(this.m_boundCtrls[aIndex]!.text.replace(/°$/, '').trim());
    return new EDA_ANGLE(Number.isFinite(v) ? v : 0);
  }

  protected ChangeValue(aIndex: number, aValue: number): void {
    this.m_boundCtrls[aIndex]!.text = pcbUnitText(aValue, this.m_units);
  }

  protected ChangeAngleValue(aIndex: number, aValue: EDA_ANGLE): void {
    // m_orientation.SetPrecision( 4 ) over the degrees UNIT_BINDER
    const deg = Math.round(aValue.AsDegrees() * 1e4) / 1e4;
    this.m_boundCtrls[aIndex]!.text = stringFromValue(pcbIUScale, 'degrees', deg);
  }

  protected GetShape(): PCB_SHAPE {
    return this.m_shape;
  }
}

/** `RECTANGLE_GEOM_SYNCER`. */
export class RECTANGLE_GEOM_SYNCER extends GEOM_SYNCER {
  static readonly START_X = 0;
  static readonly START_Y = 1;
  static readonly END_X = 2;
  static readonly END_Y = 3;
  static readonly CORNER_X = 4;
  static readonly CORNER_Y = 5;
  static readonly CORNER_W = 6;
  static readonly CORNER_H = 7;
  static readonly CENTER_X = 8;
  static readonly CENTER_Y = 9;
  static readonly CENTER_W = 10;
  static readonly CENTER_H = 11;

  constructor(aShape: PCB_SHAPE, aBoundCtrls: BOUND_CONTROL[], aUnits: StatusUnits) {
    super(aShape, aBoundCtrls, aUnits, [
      [0, 3, () => this.OnCornersChange()],
      [4, 7, () => this.OnCornerSizeChange()],
      [8, 11, () => this.OnCenterSizeChange()],
    ]);
  }

  override Validate(aErrs: string[]): boolean {
    const p0 = { x: this.GetIntValue(0), y: this.GetIntValue(1) };
    const p1 = { x: this.GetIntValue(2), y: this.GetIntValue(3) };

    if (eq(p0, p1)) {
      aErrs.push(_('Rectangle cannot be zero-sized.'));
      return false;
    }

    return true;
  }

  GetRectangleWidth(): number {
    return Math.abs(this.GetIntValue(2) - this.GetIntValue(0));
  }

  GetRectangleHeight(): number {
    return Math.abs(this.GetIntValue(3) - this.GetIntValue(1));
  }

  protected updateAll(): void {
    this.updateCorners();
    this.updateCornerSize();
    this.updateCenterSize();
  }

  OnCornersChange(): void {
    this.GetShape().SetStart({ x: this.GetIntValue(0), y: this.GetIntValue(1) });
    this.GetShape().SetEnd({ x: this.GetIntValue(2), y: this.GetIntValue(3) });
    this.updateCenterSize();
    this.updateCornerSize();
  }

  private updateCorners(): void {
    const p0 = this.GetShape().GetStart();
    const p1 = this.GetShape().GetEnd();
    this.ChangeValue(0, p0.x);
    this.ChangeValue(1, p0.y);
    this.ChangeValue(2, p1.x);
    this.ChangeValue(3, p1.y);
  }

  OnCornerSizeChange(): void {
    const p0 = { x: this.GetIntValue(4), y: this.GetIntValue(5) };
    const size = { x: this.GetIntValue(6), y: this.GetIntValue(7) };
    this.GetShape().SetStart(p0);
    this.GetShape().SetEnd(add(p0, size));
    this.updateCorners();
    this.updateCenterSize();
  }

  private updateCornerSize(): void {
    const p0 = this.GetShape().GetStart();
    this.ChangeValue(4, p0.x);
    this.ChangeValue(5, p0.y);
    this.ChangeValue(6, this.GetShape().GetRectangleWidth());
    this.ChangeValue(7, this.GetShape().GetRectangleHeight());
  }

  OnCenterSizeChange(): void {
    const center = { x: this.GetIntValue(8), y: this.GetIntValue(9) };
    const size = { x: this.GetIntValue(10), y: this.GetIntValue(11) };
    this.GetShape().SetStart(sub(center, half(size)));
    this.GetShape().SetEnd(add(center, half(size)));
    this.updateCorners();
    this.updateCornerSize();
  }

  private updateCenterSize(): void {
    const c = this.GetShape().GetCenter();
    this.ChangeValue(8, c.x);
    this.ChangeValue(9, c.y);
    this.ChangeValue(10, this.GetShape().GetRectangleWidth());
    this.ChangeValue(11, this.GetShape().GetRectangleHeight());
  }
}

/** `LINE_GEOM_SYNCER`. */
export class LINE_GEOM_SYNCER extends GEOM_SYNCER {
  constructor(aShape: PCB_SHAPE, aBoundCtrls: BOUND_CONTROL[], aUnits: StatusUnits) {
    super(aShape, aBoundCtrls, aUnits, [
      [0, 3, () => this.OnEndsChange()],
      [4, 7, () => this.OnPolarChange()],
      [8, 11, () => this.OnStartMidpointChange()],
    ]);
  }

  protected updateAll(): void {
    this.updateEnds();
    this.updatePolar();
    this.updateStartMidpoint();
  }

  OnEndsChange(): void {
    this.GetShape().SetStart({ x: this.GetIntValue(0), y: this.GetIntValue(1) });
    this.GetShape().SetEnd({ x: this.GetIntValue(2), y: this.GetIntValue(3) });
    this.updatePolar();
    this.updateStartMidpoint();
  }

  private updateEnds(): void {
    const p0 = this.GetShape().GetStart();
    const p1 = this.GetShape().GetEnd();
    this.ChangeValue(0, p0.x);
    this.ChangeValue(1, p0.y);
    this.ChangeValue(2, p1.x);
    this.ChangeValue(3, p1.y);
  }

  OnPolarChange(): void {
    const p0 = { x: this.GetIntValue(4), y: this.GetIntValue(5) };
    const length = this.GetIntValue(6);
    const angle = this.GetAngleValue(7);
    const polar = GetRotated({ x: length, y: 0 }, angle);
    this.GetShape().SetStart(p0);
    this.GetShape().SetEnd(add(p0, polar));
    this.updateEnds();
    this.updateStartMidpoint();
  }

  private updatePolar(): void {
    const p0 = this.GetShape().GetStart();
    const p1 = this.GetShape().GetEnd();
    this.ChangeValue(4, p0.x);
    this.ChangeValue(5, p0.y);
    this.ChangeValue(6, Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y)));
    this.ChangeAngleValue(7, EDA_ANGLE.fromVector(sub(p1, p0)).negate());
  }

  OnStartMidpointChange(): void {
    const start = { x: this.GetIntValue(8), y: this.GetIntValue(9) };
    const mid = { x: this.GetIntValue(10), y: this.GetIntValue(11) };
    this.GetShape().SetStart(start);
    this.GetShape().SetEnd(sub(mid, sub(start, mid)));
    this.updateEnds();
    this.updatePolar();
  }

  private updateStartMidpoint(): void {
    const s = this.GetShape().GetStart();
    const c = this.GetShape().GetCenter();
    this.ChangeValue(10, c.x);
    this.ChangeValue(11, c.y);
    this.ChangeValue(8, s.x);
    this.ChangeValue(9, s.y);
  }
}

/** `ARC_GEOM_SYNCER`. */
export class ARC_GEOM_SYNCER extends GEOM_SYNCER {
  constructor(aShape: PCB_SHAPE, aBoundCtrls: BOUND_CONTROL[], aUnits: StatusUnits) {
    super(aShape, aBoundCtrls, aUnits, [
      [0, 4, () => this.OnCSAChange()],
      [5, 10, () => this.OnSMEChange()],
    ]);
  }

  override Validate(aErrs: string[]): boolean {
    const angle = this.GetAngleValue(4);

    if (angle.AsDegrees() === 0) {
      aErrs.push(_('Arc angle must be greater than 0'));
      return false;
    }

    const start = { x: this.GetIntValue(5), y: this.GetIntValue(6) };
    const mid = { x: this.GetIntValue(7), y: this.GetIntValue(8) };
    const end = { x: this.GetIntValue(9), y: this.GetIntValue(10) };

    if (eq(start, mid) || eq(mid, end) || eq(start, end)) {
      aErrs.push(_('Arc must have 3 distinct points'));
      return false;
    }

    const center = CalcArcCenterFromAngle(start, end, angle);
    const radius = Math.hypot(center.x - start.x, center.y - start.y);
    const maxOffset = Math.max(Math.abs(center.x), Math.abs(center.y)) + radius;
    const centerI = { x: Math.trunc(center.x), y: Math.trunc(center.y) };

    if (maxOffset >= 2147483647 / 2.0 || eq(centerI, start) || eq(centerI, end)) {
      aErrs.push(
        `Invalid Arc with radius ${radius.toFixed(6)} and angle ${angle.AsDegrees().toFixed(6)}.`,
      );
      return false;
    }

    return true;
  }

  protected updateAll(): void {
    this.updateCSA();
    this.updateSME();
  }

  OnCSAChange(): void {
    this.GetShape().SetCenter({ x: this.GetIntValue(0), y: this.GetIntValue(1) });
    this.GetShape().SetStart({ x: this.GetIntValue(2), y: this.GetIntValue(3) });
    this.GetShape().SetArcAngleAndEnd(this.GetAngleValue(4));
    this.updateSME();
  }

  private updateCSA(): void {
    const center = this.GetShape().GetCenter();
    const start = this.GetShape().GetStart();
    this.ChangeValue(0, center.x);
    this.ChangeValue(1, center.y);
    this.ChangeValue(2, start.x);
    this.ChangeValue(3, start.y);
    this.ChangeAngleValue(4, this.GetShape().GetArcAngle());
  }

  OnSMEChange(): void {
    const p0 = { x: this.GetIntValue(5), y: this.GetIntValue(6) };
    const p1 = { x: this.GetIntValue(7), y: this.GetIntValue(8) };
    const p2 = { x: this.GetIntValue(9), y: this.GetIntValue(10) };
    this.GetShape().SetArcGeometry(p0, p1, p2);
    this.updateCSA();
  }

  private updateSME(): void {
    const p0 = this.GetShape().GetStart();
    const p1 = this.GetShape().GetArcMid();
    const p2 = this.GetShape().GetEnd();
    this.ChangeValue(5, p0.x);
    this.ChangeValue(6, p0.y);
    this.ChangeValue(7, p1.x);
    this.ChangeValue(8, p1.y);
    this.ChangeValue(9, p2.x);
    this.ChangeValue(10, p2.y);
  }
}

/** `CIRCLE_GEOM_SYNCER`. */
export class CIRCLE_GEOM_SYNCER extends GEOM_SYNCER {
  constructor(aShape: PCB_SHAPE, aBoundCtrls: BOUND_CONTROL[], aUnits: StatusUnits) {
    super(aShape, aBoundCtrls, aUnits, [
      [0, 2, () => this.OnCenterRadiusChange()],
      [3, 6, () => this.OnCenterPointChange()],
    ]);
  }

  protected updateAll(): void {
    this.updateCenterRadius();
    this.updateCenterPoint();
  }

  override Validate(aErrs: string[]): boolean {
    if (this.GetIntValue(2) <= 0) {
      aErrs.push(_('Radius must be greater than 0'));
      return false;
    }

    return true;
  }

  OnCenterRadiusChange(): void {
    this.GetShape().SetCenter({ x: this.GetIntValue(0), y: this.GetIntValue(1) });
    this.GetShape().SetRadius(this.GetIntValue(2));
    this.updateCenterPoint();
  }

  private updateCenterRadius(): void {
    const center = this.GetShape().GetCenter();
    this.ChangeValue(0, center.x);
    this.ChangeValue(1, center.y);
    this.ChangeValue(2, this.GetShape().GetRadius());
  }

  OnCenterPointChange(): void {
    this.GetShape().SetCenter({ x: this.GetIntValue(3), y: this.GetIntValue(4) });
    this.GetShape().SetEnd({ x: this.GetIntValue(5), y: this.GetIntValue(6) });
    this.updateCenterRadius();
  }

  private updateCenterPoint(): void {
    const center = this.GetShape().GetCenter();
    const pt = this.GetShape().GetEnd();
    this.ChangeValue(3, center.x);
    this.ChangeValue(4, center.y);
    this.ChangeValue(5, pt.x);
    this.ChangeValue(6, pt.y);
  }
}

/** `BEZIER_GEOM_SYNCER`. */
export class BEZIER_GEOM_SYNCER extends GEOM_SYNCER {
  constructor(aShape: PCB_SHAPE, aBoundCtrls: BOUND_CONTROL[], aUnits: StatusUnits) {
    super(aShape, aBoundCtrls, aUnits, [[0, 7, () => this.OnBezierChange()]]);
  }

  protected updateAll(): void {
    this.updateBezier();
  }

  OnBezierChange(): void {
    this.GetShape().SetStart({ x: this.GetIntValue(0), y: this.GetIntValue(1) });
    this.GetShape().SetEnd({ x: this.GetIntValue(2), y: this.GetIntValue(3) });
    this.GetShape().SetBezierC1({ x: this.GetIntValue(4), y: this.GetIntValue(5) });
    this.GetShape().SetBezierC2({ x: this.GetIntValue(6), y: this.GetIntValue(7) });
  }

  private updateBezier(): void {
    const p0 = this.GetShape().GetStart();
    const p1 = this.GetShape().GetEnd();
    const c1 = this.GetShape().GetBezierC1();
    const c2 = this.GetShape().GetBezierC2();
    this.ChangeValue(0, p0.x);
    this.ChangeValue(1, p0.y);
    this.ChangeValue(2, p1.x);
    this.ChangeValue(3, p1.y);
    this.ChangeValue(4, c1.x);
    this.ChangeValue(5, c1.y);
    this.ChangeValue(6, c2.x);
    this.ChangeValue(7, c2.y);
  }
}

/** `UI_FILL_MODE` as m_fillCtrl lists it. */
export const FILL_MODE_CHOICES = [
  _HKI('None'),
  _HKI('Solid'),
  _HKI('Hatch'),
  _HKI('Reverse Hatch'),
  _HKI('Cross-hatch'),
] as const;

/** The non-geometry controls DIALOG_SHAPE_PROPERTIES transfers. */
export interface ShapeValues {
  /** `m_thickness`. */
  lineWidth: number;
  /** `m_lineStyleCombo`'s selection, an index into lineTypeNames. */
  lineStyle: number;
  /** `m_cbRoundRect`. */
  roundRect: boolean;
  /** `m_cornerRadius`; null is its empty text. */
  cornerRadius: number | null;
  /** `m_fillCtrl`, a UI_FILL_MODE. */
  fillMode: UI_FILL_MODE;
  layer: string;
  /** `m_netSelector`'s netcode; -1 is indeterminate. */
  net: number;
  hasMask: boolean;
  /** `m_solderMaskMargin`; null is blank, the Board Setup value. */
  maskMargin: number | null;
  locked: boolean;
}

/** The constructor's Show() decisions. */
export interface ShapeWindowShape {
  /** `wxString::Format( "%s Properties", GetFriendlyName() )`. */
  title: string;
  /** The notebook's pages, or none for a polygon (m_notebookShapeDefs->Hide()). */
  pages: readonly GEOM_PAGE[];
  lockedShown: boolean;
  netShown: boolean;
  fillShown: boolean;
  roundRectShown: boolean;
}

/** `s_lastTabForShape`: the tab OK left each shape type on. */
const s_lastTabForShape = new Map<SHAPE_T, number>();

export class DIALOG_SHAPE_PROPERTIES {
  private readonly m_parent: PCB_BASE_EDIT_FRAME;
  private readonly m_item: PCB_SHAPE;
  private readonly m_workingCopy: PCB_SHAPE;
  private readonly m_boundCtrls: BOUND_CONTROL[] = [];
  private readonly m_pages: GEOM_PAGE[] = [];
  private readonly m_geomSync: GEOM_SYNCER | null = null;
  private readonly m_units: StatusUnits;
  private m_initialPage = 0;

  constructor(aParent: PCB_BASE_EDIT_FRAME, aShape: PCB_SHAPE) {
    this.m_parent = aParent;
    this.m_item = aShape;
    this.m_workingCopy = aShape.Clone();
    this.m_units = aParent.GetUserUnits() as StatusUnits;

    const page = (aTitle: string, aSelect = false): GEOM_PAGE => {
      const p: GEOM_PAGE = { title: aTitle, items: [] };
      if (aSelect) this.m_initialPage = this.m_pages.length;
      this.m_pages.push(p);
      return p;
    };

    // AddXYPointToSizer: a title over X: and Y:, two bound controls.
    const xy = (aPage: GEOM_PAGE, aRow: number, aCol: number, aName: string): void => {
      aPage.items.push({
        type: 'xy',
        name: aName,
        row: aRow,
        col: aCol,
        ctrl: this.m_boundCtrls.length,
      });
      this.m_boundCtrls.push({ label: 'X:', isAngle: false, text: '' });
      this.m_boundCtrls.push({ label: 'Y:', isAngle: false, text: '' });
    };

    // AddFieldToSizer: one labelled bound control.
    const field = (
      aPage: GEOM_PAGE,
      aRow: number,
      aCol: number,
      aName: string,
      aIsAngle: boolean,
    ): void => {
      aPage.items.push({
        type: 'field',
        name: aName,
        row: aRow,
        col: aCol,
        ctrl: this.m_boundCtrls.length,
      });
      this.m_boundCtrls.push({ label: `${aName}:`, isAngle: aIsAngle, text: '' });
    };

    const wc = this.m_workingCopy;
    const ctrls = this.m_boundCtrls;
    const units = this.m_units;

    switch (aShape.GetShape()) {
      case SHAPE_T.RECTANGLE: {
        const corners = page(_('By Corners'), true);
        xy(corners, 0, 0, _('Start Point'));
        xy(corners, 0, 3, _('End Point'));
        const cornerSize = page(_('By Corner and Size'));
        xy(cornerSize, 0, 0, _('Start Point'));
        xy(cornerSize, 0, 3, _('Size'));
        const centerSize = page(_('By Center and Size'));
        xy(centerSize, 0, 0, _('Center'));
        xy(centerSize, 0, 3, _('Size'));
        this.m_geomSync = new RECTANGLE_GEOM_SYNCER(wc, ctrls, units);
        break;
      }
      case SHAPE_T.SEGMENT: {
        const ends = page(_('By Endpoints'), true);
        xy(ends, 0, 0, _('Start Point'));
        xy(ends, 0, 3, _('End Point'));
        const polar = page(_('By Length and Angle'));
        xy(polar, 0, 0, _('Start Point'));
        field(polar, 1, 3, _('Length'), false);
        field(polar, 2, 3, _('Angle'), true);
        const startMid = page(_('By Start/Midpoint'));
        xy(startMid, 0, 0, _('Start Point'));
        xy(startMid, 0, 3, _('Mid Point'));
        this.m_geomSync = new LINE_GEOM_SYNCER(wc, ctrls, units);
        break;
      }
      case SHAPE_T.ARC: {
        const csa = page(_('By Center/Start/Angle'), true);
        xy(csa, 0, 0, _('Center'));
        xy(csa, 0, 3, _('Start Point'));
        field(csa, 3, 0, _('Included Angle'), true);
        const sme = page(_('By Start/Mid/End'));
        xy(sme, 0, 0, _('Start Point'));
        xy(sme, 0, 3, _('Mid Point'));
        xy(sme, 3, 0, _('End Point'));
        this.m_geomSync = new ARC_GEOM_SYNCER(wc, ctrls, units);
        break;
      }
      case SHAPE_T.CIRCLE: {
        const cr = page(_('By Center/Radius'), true);
        xy(cr, 0, 0, _('Center'));
        field(cr, 3, 0, _('Radius'), false);
        const cp = page(_('By Center/Point'));
        xy(cp, 0, 0, _('Center'));
        xy(cp, 0, 3, _('Point on Circle'));
        this.m_geomSync = new CIRCLE_GEOM_SYNCER(wc, ctrls, units);
        break;
      }
      case SHAPE_T.BEZIER: {
        const bz = page(_('Bezier Control Points'), true);
        xy(bz, 0, 0, _('Start Point'));
        xy(bz, 0, 3, _('End Point'));
        xy(bz, 3, 0, _('Control Point 1'));
        xy(bz, 3, 3, _('Control Point 2'));
        this.m_geomSync = new BEZIER_GEOM_SYNCER(wc, ctrls, units);
        break;
      }
      default:
        // SHAPE_T::POLY: m_notebookShapeDefs->Hide()
        break;
    }

    const last = s_lastTabForShape.get(aShape.GetShape());
    if (last !== undefined && last >= 0 && last < this.m_pages.length) this.m_initialPage = last;
  }

  GetWindowShape(): ShapeWindowShape {
    const shape = this.m_item.GetShape();

    return {
      title: wxFormat(_('%s Properties'), this.m_item.GetFriendlyName()),
      pages: this.m_pages,
      lockedShown: this.m_parent.IsType(FRAME_T.FRAME_PCB_EDITOR),
      netShown: !this.m_parent.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR),
      fillShown: shape !== SHAPE_T.ARC && shape !== SHAPE_T.SEGMENT && shape !== SHAPE_T.BEZIER,
      roundRectShown: shape === SHAPE_T.RECTANGLE,
    };
  }

  /** The frame's units, which every UNIT_BINDER here shows. */
  GetUnits(): StatusUnits {
    return this.m_units;
  }

  /** The page the notebook opens on: the selected showPage(), or s_lastTabForShape's. */
  GetInitialPage(): number {
    return this.m_initialPage;
  }

  /** The bound controls' texts, which the syncer rewrites. */
  GetBoundCtrls(): readonly BOUND_CONTROL[] {
    return this.m_boundCtrls;
  }

  /** A bound control's wxEVT_TEXT: store the text and run its syncer group. */
  OnBoundCtrlText(aIndex: number, aText: string): void {
    this.m_boundCtrls[aIndex]!.text = aText;
    this.m_geomSync?.OnCtrlChanged(aIndex);
  }

  /** `m_parent->GetBoard()->GetNetInfo()` for m_netSelector. */
  GetNetInfo(): ReadonlyMap<number, string> {
    return new Map(
      [...this.m_parent.GetBoard()!.GetNetInfo().NetsByNetcode()].map(
        ([code, net]) => [code, net.GetNetname()] as const,
      ),
    );
  }

  /** enableNetInfo(): the net applies on copper only. */
  static NetEnabled(aLayer: string): boolean {
    return IsCopperLayer(LSET_NameToLayer(aLayer));
  }

  /** enableTechLayers(): the solder mask applies on outer copper only. */
  static TechLayersEnabled(aLayer: string): boolean {
    return IsExternalCopperLayer(LSET_NameToLayer(aLayer));
  }

  TransferDataToWindow(): ShapeValues {
    const item = this.m_item;
    this.m_geomSync?.SetShape(item);

    const style = item.GetStroke().GetLineStyle() as number;
    const radius = item.GetShape() === SHAPE_T.RECTANGLE ? item.GetCornerRadius() : 0;

    return {
      lineWidth: item.GetStroke().GetWidth(),
      lineStyle: style >= 0 && style < LINE_STYLE_NAMES.length ? style : 0,
      roundRect: radius > 0,
      cornerRadius: radius > 0 ? radius : null,
      fillMode: item.GetFillModeProp(),
      layer: LSET_Name(item.GetLayer()),
      net: item.GetNetCode() >= 0 ? item.GetNetCode() : -1,
      hasMask: item.HasSolderMask(),
      maskMargin: item.GetLocalSolderMaskMargin() ?? null,
      locked: item.IsLocked(),
    };
  }

  /**
   * `Validate()`: the syncer's checks and the type's own. A corner radius over half the short
   * side is reported and `m_cornerRadius.SetValue( KiROUND( shortSide / 2.0 ) )`, which
   * `aFixedRadius` returns.
   */
  Validate(v: ShapeValues): { errors: string[]; fixedRadius?: number } {
    const errors: string[] = [];
    let fixedRadius: number | undefined;

    this.m_geomSync?.Validate(errors);

    const filled = v.fillMode === UI_FILL_MODE.SOLID;

    switch (this.m_item.GetShape()) {
      case SHAPE_T.ARC:
        if (v.lineWidth <= 0) errors.push(_('Line width must be greater than zero.'));
        break;
      case SHAPE_T.CIRCLE:
        if (!filled && v.lineWidth <= 0)
          errors.push(_('Line width must be greater than zero for an unfilled circle.'));
        break;
      case SHAPE_T.RECTANGLE: {
        if (!filled && v.lineWidth <= 0)
          errors.push(_('Line width must be greater than zero for an unfilled rectangle.'));

        const rect = this.m_geomSync as RECTANGLE_GEOM_SYNCER;
        const shortSide = Math.min(rect.GetRectangleWidth(), rect.GetRectangleHeight());

        if (v.roundRect && (v.cornerRadius ?? 0) * 2 > shortSide) {
          errors.push(_('Corner radius must be less than or equal to half the smaller side.'));
          fixedRadius = Math.round(shortSide / 2.0);
        }
        break;
      }
      case SHAPE_T.POLY:
        if (!filled && v.lineWidth <= 0)
          errors.push(_('Line width must be greater than zero for an unfilled polygon.'));
        break;
      case SHAPE_T.SEGMENT:
        if (v.lineWidth <= 0) errors.push(_('Line width must be greater than zero.'));
        break;
      case SHAPE_T.BEZIER:
        if (!filled && v.lineWidth <= 0)
          errors.push(_('Line width must be greater than zero for an unfilled curve.'));
        break;
      default:
        break;
    }

    return fixedRadius === undefined ? { errors } : { errors, fixedRadius };
  }

  /** TransferDataFromWindow; `aPage` is m_notebookShapeDefs->GetSelection(). */
  TransferDataFromWindow(v: ShapeValues, aPage = this.m_initialPage): TransferResult {
    const { errors } = this.Validate(v);
    if (errors.length > 0) return { ok: false, message: errors.join('\n') };

    const item = this.m_item;
    const layer = LSET_NameToLayer(v.layer);
    const commit = new BOARD_COMMIT(this.m_parent);
    commit.Modify(item);

    // If no other command in progress, prepare undo command
    const pushCommit = item.GetEditFlags() === 0;
    if (!pushCommit) item.SetFlags(IN_EDIT);

    // *m_item = m_workingCopy
    item.assignPcbShape(this.m_workingCopy);

    const wasLocked = item.IsLocked();

    if (item.GetShape() === SHAPE_T.RECTANGLE)
      item.SetCornerRadius(v.roundRect ? (v.cornerRadius ?? 0) : 0);

    item.SetFillModeProp(v.fillMode);
    item.SetLocked(v.locked);
    item.SetWidth(v.lineWidth);
    item.SetLineStyle(LINE_STYLE_NAMES[v.lineStyle]?.style ?? LINE_STYLE.SOLID);
    item.SetLayer(layer);
    item.SetHasSolderMask(v.hasMask);
    item.SetLocalSolderMaskMargin(v.maskMargin ?? undefined);
    item.RebuildBezierToSegmentsPointsList(item.GetMaxError());

    if (item.IsOnCopperLayer()) item.SetNetCode(v.net);
    else item.SetNetCode(-1);

    if (pushCommit) commit.Push(_('Edit Shape Properties'));

    s_lastTabForShape.set(item.GetShape(), aPage);

    // Notify clients which treat locked and unlocked items differently (ie: POINT_EDITOR)
    if (wasLocked !== item.IsLocked())
      this.m_parent.GetToolManager()?.PostEvent(EVENTS.SelectedEvent);

    return { ok: true };
  }
}

/** `ShowQuasiModal()` of DIALOG_SHAPE_PROPERTIES: its base over the shape. */
export function DialogShapeProperties({
  dialog,
  layers,
  layerColor,
  onApplied,
  onClose,
}: {
  dialog: DIALOG_SHAPE_PROPERTIES;
  layers: readonly string[];
  /** The board colour of a layer, for PCB_LAYER_BOX_SELECTOR's swatch. */
  layerColor: (layer: string) => string;
  /** After OK wrote the shape (ShowGraphicItemPropertiesDialog's wxID_OK). */
  onApplied: () => void;
  onClose: () => void;
}): JSX.Element {
  const [v, setV] = useState<ShapeValues>(() => dialog.TransferDataToWindow());
  const [ctrls, setCtrls] = useState<BOUND_CONTROL[]>(() =>
    dialog.GetBoundCtrls().map((c) => ({ ...c })),
  );
  const [page, setPage] = useState(() => dialog.GetInitialPage());
  const [texts, setTexts] = useState<Partial<Record<'width' | 'radius' | 'margin', string>>>({});
  const [errors, setErrors] = useState<string[] | null>(null);

  const shape = dialog.GetWindowShape();
  const units = dialog.GetUnits();
  const set = (patch: Partial<ShapeValues>): void => setV((p) => ({ ...p, ...patch }));
  const techLayers = DIALOG_SHAPE_PROPERTIES.TechLayersEnabled(v.layer);
  const maskMarginEnabled = techLayers && v.hasMask;

  const length = (
    aKey: 'width' | 'radius' | 'margin',
    aLabel: string,
    aValue: number | null,
    aApply: (aIu: number | null) => void,
  ) => ({
    label: aLabel,
    value: texts[aKey] ?? (aValue === null ? '' : pcbUnitText(aValue, units)),
    units: unitLabel(units),
    onChange: (aText: string) => {
      setTexts((t) => ({ ...t, [aKey]: aText }));
      if (aText.trim() === '') {
        aApply(null);
        return;
      }
      const iu = pcbUnitValue(aText, units);
      if (Number.isFinite(iu)) aApply(Math.trunc(iu));
    },
    onBlur: () => setTexts((t) => ({ ...t, [aKey]: undefined })),
  });

  const ok = (): void => {
    const { errors: found, fixedRadius } = dialog.Validate(v);

    if (fixedRadius !== undefined) {
      set({ cornerRadius: fixedRadius });
      setTexts((t) => ({ ...t, radius: undefined }));
    }

    if (found.length > 0) {
      setErrors(found);
      return;
    }

    if (dialog.TransferDataFromWindow(v, page).ok) onApplied();
  };

  return (
    <>
      <DIALOG_SHAPE_PROPERTIES_BASE
        title={shape.title}
        pages={shape.pages}
        page={page}
        onPage={setPage}
        boundCtrls={ctrls}
        units={(c) => (c.isAngle ? unitLabel('degrees') : unitLabel(units))}
        onBoundCtrl={(aIndex, aText) => {
          dialog.OnBoundCtrlText(aIndex, aText);
          // ChangeValue() never echoes into the control being typed in.
          setCtrls(
            dialog.GetBoundCtrls().map((c, i) => (i === aIndex ? { ...c, text: aText } : { ...c })),
          );
        }}
        m_locked={{
          value: v.locked,
          onChange: (aOn) => set({ locked: aOn }),
          shown: shape.lockedShown,
        }}
        m_cbRoundRect={{
          value: v.roundRect,
          shown: shape.roundRectShown,
          // onRoundedRectChanged: unchecked empties the radius.
          onChange: (aOn) => {
            set(aOn ? { roundRect: true } : { roundRect: false, cornerRadius: null });
            if (!aOn) setTexts((t) => ({ ...t, radius: undefined }));
          },
        }}
        m_cornerRadius={length('radius', _('Corner radius:'), v.cornerRadius, (iu) =>
          // onCornerRadius: typing a radius checks Rounded rectangle.
          set({ cornerRadius: iu, roundRect: true }),
        )}
        m_thickness={length('width', _('Line width:'), v.lineWidth, (iu) =>
          set({ lineWidth: iu ?? 0 }),
        )}
        m_lineStyleCombo={{
          rows: LINE_STYLE_NAMES.map((d, i) => ({
            value: String(i),
            label: d.label,
            ...(d.bitmap ? { bitmap: bitmapUrl(d.bitmap) } : {}),
          })),
          value: String(v.lineStyle),
          onChange: (aValue) => set({ lineStyle: Number(aValue) }),
        }}
        m_fillCtrl={{
          value: v.fillMode,
          shown: shape.fillShown,
          onChange: (aIndex) => set({ fillMode: aIndex as UI_FILL_MODE }),
        }}
        m_netSelector={{
          netInfo: dialog.GetNetInfo(),
          netcode: v.net,
          enabled: DIALOG_SHAPE_PROPERTIES.NetEnabled(v.layer),
          shown: shape.netShown,
          onChange: (aNetcode) => set({ net: aNetcode }),
        }}
        m_LayerSelectionCtrl={{
          rows: layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) })),
          value: v.layer,
          onChange: (aLayer) => set({ layer: aLayer }),
        }}
        techLayersEnabled={techLayers}
        m_hasSolderMask={{ value: v.hasMask, onChange: (aOn) => set({ hasMask: aOn }) }}
        m_solderMaskMargin={{
          ...length('margin', _('Expansion:'), v.maskMargin, (iu) => set({ maskMargin: iu })),
          enabled: maskMarginEnabled,
          title: _(
            'This is the local clearance between the shape and the solder mask opening.\nLeave blank to use the value defined in the Board Setup.',
          ),
        }}
        onOK={ok}
        onCancel={onClose}
      />
      {errors !== null && (
        <HtmlMessageBox
          caption={_('Error List')}
          messages={errors}
          onClose={() => setErrors(null)}
        />
      )}
    </>
  );
}
