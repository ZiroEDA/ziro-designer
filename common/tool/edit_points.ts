// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/tool/edit_points.h` + `common/tool/edit_points.cpp`: `EDIT_POINT`
 * and `EDIT_POINTS`, the handles a point editor draws on an item and hit
 * tests the pointer against.
 *
 * The whole unit: `EDIT_POINT` with its constraint and snapping types,
 * `EDIT_LINE` (the midpoint handles), and `EDIT_POINTS` with its contours,
 * lines and `Previous` / `Next`. The constraints are `edit_constraints.ts`.
 * The sizes are `preview_items/edit_points.ts`' and the colour rule is
 * `color4d.ts`' `editPointColors`, the same two the editors already share.
 *
 * `operator==` is by POSITION for a point and by its two ends for a line, and
 * `Previous` / `Next` look a point up with it, as the C++ does: two handles at
 * the same place are the same handle to them.
 */

import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  type EDIT_CONSTRAINT,
  GRID_CONSTRAINT_TYPE,
  type GRID_HELPER,
  SNAP_CONSTRAINT_TYPE,
} from './edit_constraints.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { editPointColors, parseColor4d, toCss } from '../color4d.js';
import { EDA_ITEM } from '../eda_item.js';
import { GAL_SCOPED_ATTRS, GAL_SCOPED_ATTRS_FLAGS } from '../gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import {
  EDIT_POINT_BORDER_SIZE,
  EDIT_POINT_HOVER_SIZE,
  EDIT_POINT_SIZE,
} from '../preview_items/edit_points.js';
import type { VIEW } from '../view/view.js';

/**
 * Represent a single point that can be used for modifying items.
 *
 * It is directly related to one of points in a graphical item (e.g. vertex of a zone or
 * center of a circle).
 */
export class EDIT_POINT {
  /// Single point size in pixels.
  static readonly POINT_SIZE = EDIT_POINT_SIZE;
  /// Border size when not hovering.
  static readonly BORDER_SIZE = EDIT_POINT_BORDER_SIZE;
  /// Border size when hovering.
  static readonly HOVER_SIZE = EDIT_POINT_HOVER_SIZE;

  ///< Position of EDIT_POINT.
  private m_position: VECTOR2I;
  private m_isActive = false; ///< True if this point is being manipulated.
  private m_isHover = false; ///< True if this point is being hovered over.
  private m_drawCircle = false; ///< True if the point is drawn circular.
  ///< Describe the grid snapping behavior.
  private m_gridConstraint = GRID_CONSTRAINT_TYPE.SNAP_TO_GRID;
  ///< Describe the object snapping behavior.
  private m_snapConstraint = SNAP_CONSTRAINT_TYPE.OBJECT_LAYERS;

  /// An optional connected item record used to mimic polyLine behavior with individual
  /// line segments.
  private readonly m_connected: [EDA_ITEM | null, number];

  /// Constraint for the point, NULL if none.
  protected m_constraint: EDIT_CONSTRAINT<EDIT_POINT> | null = null;

  /**
   * @param aPoint stores coordinates for EDIT_POINT.
   * @param aConnected is the item the point is connected to, and its index.
   */
  constructor(aPoint: VECTOR2I, aConnected: [EDA_ITEM | null, number] = [null, 0]) {
    this.m_position = { x: aPoint.x, y: aPoint.y };
    this.m_connected = aConnected;
  }

  /** Return coordinates of an EDIT_POINT. */
  GetPosition(): VECTOR2I {
    return this.m_position;
  }

  /** Return a connected item record comprising an EDA_ITEM* and a STL container-style index. */
  GetConnected(): [EDA_ITEM | null, number] {
    return this.m_connected;
  }

  /** Return X coordinate of an EDIT_POINT. */
  GetX(): number {
    return this.GetPosition().x;
  }

  /** Return Y coordinate of an EDIT_POINT. */
  GetY(): number {
    return this.GetPosition().y;
  }

  /**
   * Set new coordinates for an EDIT_POINT. It does not change the coordinates of an item.
   */
  SetPosition(aPosition: VECTOR2I): void;
  SetPosition(x: number, y: number): void;
  SetPosition(a: VECTOR2I | number, y?: number): void {
    this.m_position = typeof a === 'number' ? { x: a, y: y! } : { x: a.x, y: a.y };
  }

  /**
   * Check if given point is within a square centered in the EDIT_POINT position.
   *
   * @param aPoint is point to be checked.
   * @param aSize is length of the square side.
   */
  WithinPoint(aPoint: VECTOR2I, aSize: number): boolean {
    // Corners of the EDIT_POINT square
    const topLeft = { x: this.GetPosition().x - aSize, y: this.GetPosition().y - aSize };
    const bottomRight = { x: this.GetPosition().x + aSize, y: this.GetPosition().y + aSize };

    return (
      aPoint.x > topLeft.x &&
      aPoint.y > topLeft.y &&
      aPoint.x < bottomRight.x &&
      aPoint.y < bottomRight.y
    );
  }

  IsActive(): boolean {
    return this.m_isActive;
  }

  SetActive(aActive = true): void {
    this.m_isActive = aActive;
  }

  IsHover(): boolean {
    return this.m_isHover;
  }

  SetHover(aHover = true): void {
    this.m_isHover = aHover;
  }

  DrawCircle(): boolean {
    return this.m_drawCircle;
  }

  SetDrawCircle(aDrawCircle = true): void {
    this.m_drawCircle = aDrawCircle;
  }

  /**
   * Set a constraint for and EDIT_POINT.
   *
   * @param aConstraint is the constraint to be set.
   */
  SetConstraint(aConstraint: EDIT_CONSTRAINT<EDIT_POINT> | null): void {
    this.m_constraint = aConstraint;
  }

  /** Return the constraint imposed on an EDIT_POINT. If there are no constraints, NULL. */
  GetConstraint(): EDIT_CONSTRAINT<EDIT_POINT> | null {
    return this.m_constraint;
  }

  /** Remove previously set constraint. */
  ClearConstraint(): void {
    this.m_constraint = null;
  }

  /** Check if point is constrained. */
  IsConstrained(): boolean {
    return this.m_constraint !== null;
  }

  /** Correct coordinates of an EDIT_POINT by applying previously set constraint. */
  ApplyConstraint(aGrid: GRID_HELPER): void {
    this.m_constraint?.Apply(aGrid);
  }

  GetGridConstraint(): GRID_CONSTRAINT_TYPE {
    return this.m_gridConstraint;
  }

  SetGridConstraint(aConstraint: GRID_CONSTRAINT_TYPE): void {
    this.m_gridConstraint = aConstraint;
  }

  GetSnapConstraint(): SNAP_CONSTRAINT_TYPE {
    return this.m_snapConstraint;
  }

  SetSnapConstraint(aConstraint: SNAP_CONSTRAINT_TYPE): void {
    this.m_snapConstraint = aConstraint;
  }

  /** `operator==`: the same position. */
  equals(aOther: EDIT_POINT): boolean {
    const a = this.GetPosition();
    const b = aOther.GetPosition();
    return a.x === b.x && a.y === b.y;
  }
}

/** `VECTOR2<int>::operator/( double )`: KiROUND each (vector2d.h:536-542). */
const half = (v: VECTOR2I): VECTOR2I => ({ x: KiROUND(v.x / 2), y: KiROUND(v.y / 2) });

/**
 * Represent a line connecting two EDIT_POINTs.
 *
 * That allows one to move them both by dragging the EDIT_POINT in the middle.  It uses
 * references to EDIT_POINTs, all coordinates are automatically synchronized.
 */
export class EDIT_LINE extends EDIT_POINT {
  private readonly m_origin: EDIT_POINT; ///< Origin point for a line.
  private readonly m_end: EDIT_POINT; ///< End point for a line.
  private m_hasCenterPoint = true; ///< True if the line has a (useful) center point.
  private m_showLine = false; ///< True if the line itself should be drawn.
  private m_lineConstraint: EDIT_CONSTRAINT<EDIT_LINE> | null = null;

  /**
   * @param aOrigin is the origin of EDIT_LINE.
   * @param aEnd is the end of EDIT_LINE.
   */
  constructor(aOrigin: EDIT_POINT, aEnd: EDIT_POINT) {
    const o = aOrigin.GetPosition();
    const e = half(aEnd.GetPosition());
    const oh = half(o);
    super({ x: o.x + (e.x - oh.x), y: o.y + (e.y - oh.y) });
    this.m_origin = aOrigin;
    this.m_end = aEnd;
    this.SetGridConstraint(GRID_CONSTRAINT_TYPE.SNAP_BY_GRID);
  }

  ///< @copydoc EDIT_POINT::GetPosition()
  override GetPosition(): VECTOR2I {
    const a = half(this.m_origin.GetPosition());
    const b = half(this.m_end.GetPosition());
    return { x: a.x + b.x, y: a.y + b.y };
  }

  ///< @copydoc EDIT_POINT::SetPosition()
  override SetPosition(aPosition: VECTOR2I): void;
  override SetPosition(x: number, y: number): void;
  override SetPosition(a: VECTOR2I | number, y?: number): void {
    const aPosition = typeof a === 'number' ? { x: a, y: y! } : a;
    const current = this.GetPosition();
    const difference = { x: aPosition.x - current.x, y: aPosition.y - current.y };
    const o = this.m_origin.GetPosition();
    const e = this.m_end.GetPosition();

    this.m_origin.SetPosition({ x: o.x + difference.x, y: o.y + difference.y });
    this.m_end.SetPosition({ x: e.x + difference.x, y: e.y + difference.y });
  }

  ///< @copydoc EDIT_POINT::ApplyConstraint()
  override ApplyConstraint(aGrid: GRID_HELPER): void {
    this.m_lineConstraint?.Apply(aGrid);

    this.m_origin.ApplyConstraint(aGrid);
    this.m_end.ApplyConstraint(aGrid);
  }

  /**
   * Set a constraint for and EDIT_POINT.
   *
   * @param aConstraint is the constraint to be set.
   */
  override SetConstraint(aConstraint: EDIT_CONSTRAINT<EDIT_LINE> | null): void {
    this.m_lineConstraint = aConstraint;
  }

  /** Return the constraint imposed on an EDIT_POINT. If there are no constraints, NULL. */
  override GetConstraint(): EDIT_CONSTRAINT<EDIT_LINE> | null {
    return this.m_lineConstraint;
  }

  /** Check if line is constrained. */
  override IsConstrained(): boolean {
    return this.m_lineConstraint !== null;
  }

  /** Return the origin EDIT_POINT. */
  GetOrigin(): EDIT_POINT {
    return this.m_origin;
  }

  /** Return the end EDIT_POINT. */
  GetEnd(): EDIT_POINT {
    return this.m_end;
  }

  HasCenterPoint(): boolean {
    return this.m_hasCenterPoint;
  }

  SetHasCenterPoint(aHasCenterPoint: boolean): void {
    this.m_hasCenterPoint = aHasCenterPoint;
  }

  DrawLine(): boolean {
    return this.m_showLine;
  }

  SetDrawLine(aShowLine: boolean): void {
    this.m_showLine = aShowLine;
  }

  /** `operator==( const EDIT_LINE& )`: the same two ends, each by position. */
  equalsLine(aOther: EDIT_LINE): boolean {
    return this.m_origin.equals(aOther.m_origin) && this.m_end.equals(aOther.m_end);
  }
}

/**
 * EDIT_POINTS is a VIEW_ITEM that manages EDIT_POINTs and EDIT_LINEs and draws them.
 */
export class EDIT_POINTS extends EDA_ITEM {
  /// `m_parent`, the parent of the EDIT_POINTs (EDA_ITEM already names its own).
  private readonly m_pointsParent: EDA_ITEM | null;
  private m_swapX = false; ///< Parent's X coords are inverted.
  private m_swapY = false; ///< Parent's Y coords are inverted.
  private m_points: EDIT_POINT[] = []; ///< EDIT_POINTs for modifying m_parent.
  private m_lines: EDIT_LINE[] = []; ///< EDIT_LINEs for modifying m_parent.
  private m_contours: number[] = []; ///< Indices of end contour points.
  private m_allowPoints = true; ///< If false, only allow editing of EDIT_LINES.

  /**
   * @param aParent is the item to which EDIT_POINTs are related.
   */
  constructor(aParent: EDA_ITEM | null) {
    super(KICAD_T.NOT_USED);
    this.m_pointsParent = aParent;
  }

  /**
   * Return a point that is at given coordinates or NULL if there is no such point.
   *
   * @param aLocation is the location for searched point.
   */
  FindPoint(aLocation: VECTOR2I, aView: VIEW): EDIT_POINT | null {
    const size = Math.abs(KiROUND(aView.ToWorld(EDIT_POINT.POINT_SIZE)));

    if (this.m_allowPoints) {
      for (const point of this.m_points) {
        if (point.WithinPoint(aLocation, size)) return point;
      }
    }

    for (const line of this.m_lines) {
      if (line.WithinPoint(aLocation, size)) return line;
    }

    return null;
  }

  /** Clear all stored EDIT_POINTs and EDIT_LINEs. */
  Clear(): void {
    this.m_points = [];
    this.m_lines = [];
    this.m_contours = [];
  }

  /** Return parent of the EDIT_POINTS. */
  override GetParent(): EDA_ITEM | null {
    return this.m_pointsParent;
  }

  /**
   * Add an EDIT_POINT.
   *
   * @param aPoint are coordinates of the new point.
   */
  AddPoint(aPoint: EDIT_POINT): void;
  AddPoint(aPoint: VECTOR2I, aConnected?: [EDA_ITEM | null, number]): void;
  AddPoint(aPoint: EDIT_POINT | VECTOR2I, aConnected: [EDA_ITEM | null, number] = [null, 0]): void {
    this.m_points.push(aPoint instanceof EDIT_POINT ? aPoint : new EDIT_POINT(aPoint, aConnected));
  }

  /**
   * Add an EDIT_LINE.
   *
   * @param aLine is the EDIT_LINE to be added, or its origin, with `aEnd` its end.
   */
  AddLine(aLine: EDIT_LINE): void;
  AddLine(aOrigin: EDIT_POINT, aEnd: EDIT_POINT): void;
  AddLine(a: EDIT_POINT, aEnd?: EDIT_POINT): void {
    this.m_lines.push(aEnd ? new EDIT_LINE(a, aEnd) : (a as EDIT_LINE));
  }

  /** Adds an EDIT_LINE that is shown as an indicator, rather than an editable line. */
  AddIndicatorLine(aOrigin: EDIT_POINT, aEnd: EDIT_POINT): void {
    const line = new EDIT_LINE(aOrigin, aEnd);
    this.m_lines.push(line);
    line.SetHasCenterPoint(false);
    line.SetDrawLine(true);
  }

  /** Adds a break, indicating the end of a contour. */
  AddBreak(): void {
    console.assert(this.m_points.length > 0);
    this.m_contours.push(this.m_points.length - 1);
  }

  /**
   * Return index of the contour origin for a point with given index.
   *
   * @param aPointIdx is the index of point for which the contour origin is searched.
   * @return Index of the contour origin point.
   */
  GetContourStartIdx(aPointIdx: number): number {
    let lastIdx = 0;

    for (const idx of this.m_contours) {
      if (idx >= aPointIdx) return lastIdx;

      lastIdx = idx + 1;
    }

    return lastIdx;
  }

  /**
   * Return index of the contour finish for a point with given index.
   *
   * @param aPointIdx is the index of point for which the contour finish is searched.
   * @return Index of the contour finish point.
   */
  GetContourEndIdx(aPointIdx: number): number {
    for (const idx of this.m_contours) {
      if (idx >= aPointIdx) return idx;
    }

    return this.m_points.length - 1;
  }

  /**
   * Check if a point with given index is a contour origin.
   *
   * @param aPointIdx is the index of the point to be checked.
   * @return True if the point is an origin of a contour.
   */
  IsContourStart(aPointIdx: number): boolean {
    for (const idx of this.m_contours) {
      if (idx + 1 === aPointIdx) return true;

      // the list is sorted, so we cannot expect it any further
      if (idx > aPointIdx) break;
    }

    return aPointIdx === 0;
  }

  /**
   * Check is a point with given index is a contour finish.
   *
   * @param aPointIdx is the index of the point to be checked.
   * @return True if the point is a finish of a contour.
   */
  IsContourEnd(aPointIdx: number): boolean {
    for (const idx of this.m_contours) {
      if (idx === aPointIdx) return true;

      // the list is sorted, so we cannot expect it any further
      if (idx > aPointIdx) break;
    }

    // the end of the list surely is the end of a contour
    return aPointIdx === this.m_points.length - 1;
  }

  /**
   * Return the point that is after the given point in the list.
   *
   * @param aPoint is the point that is supposed to be preceding the searched point.
   * @param aTraverseContours decides if in case of breaks should we return to the origin
   *                          of contour or continue with the next contour.
   * @return The point following aPoint in the list. If aPoint is the first in
   *         the list, the last from the list will be returned. If there are no points at all,
   *         NULL is returned.
   */
  Previous(aPoint: EDIT_POINT, aTraverseContours = true): EDIT_POINT | null {
    for (let i = 0; i < this.m_points.length; ++i) {
      if (this.m_points[i]!.equals(aPoint)) {
        if (!aTraverseContours && this.IsContourStart(i))
          return this.m_points[this.GetContourEndIdx(i)]!;

        if (i === 0) return this.m_points[this.m_points.length - 1]!;
        return this.m_points[i - 1]!;
      }
    }

    return null;
  }

  PreviousLine(aLine: EDIT_LINE): EDIT_LINE | null {
    for (let i = 0; i < this.m_lines.length; ++i) {
      if (this.m_lines[i]!.equalsLine(aLine)) {
        if (i === 0) return this.m_lines[this.m_lines.length - 1]!;
        return this.m_lines[i - 1]!;
      }
    }

    return null;
  }

  /**
   * Return the point that is before the given point in the list.
   *
   * @param aPoint is the point that is supposed to be following the searched point.
   * @param aTraverseContours decides if in case of breaks should we return to the origin
   *                          of contour or continue with the next contour.
   * @return The point preceding aPoint in the list. If aPoint is the last in
   *         the list, the first point from the list will be returned. If there are no points at
   *         all, NULL is returned.
   */
  Next(aPoint: EDIT_POINT, aTraverseContours = true): EDIT_POINT | null {
    for (let i = 0; i < this.m_points.length; ++i) {
      if (this.m_points[i]!.equals(aPoint)) {
        if (!aTraverseContours && this.IsContourEnd(i))
          return this.m_points[this.GetContourStartIdx(i)]!;

        if (i === this.m_points.length - 1) return this.m_points[0]!;
        return this.m_points[i + 1]!;
      }
    }

    return null;
  }

  NextLine(aLine: EDIT_LINE): EDIT_LINE | null {
    for (let i = 0; i < this.m_lines.length; ++i) {
      if (this.m_lines[i]!.equalsLine(aLine)) {
        if (i === this.m_lines.length - 1) return this.m_lines[0]!;
        return this.m_lines[i + 1]!;
      }
    }

    return null;
  }

  /** The index of `aPoint`, or -1: `EDIT_POINTS`' `&aPoint - &m_points[0]`. */
  IndexOf(aPoint: EDIT_POINT | null): number {
    return aPoint ? this.m_points.indexOf(aPoint) : -1;
  }

  Point(aIndex: number): EDIT_POINT {
    return this.m_points[aIndex]!;
  }

  Line(aIndex: number): EDIT_LINE {
    return this.m_lines[aIndex]!;
  }

  /** Return number of stored EDIT_POINTs. */
  PointsSize(): number {
    return this.m_points.length;
  }

  /** Return number of stored EDIT_LINEs. */
  LinesSize(): number {
    return this.m_lines.length;
  }

  SwapX(): boolean {
    return this.m_swapX;
  }

  SetSwapX(aSwap: boolean): void {
    this.m_swapX = aSwap;
  }

  SwapY(): boolean {
    return this.m_swapY;
  }

  SetSwapY(aSwap: boolean): void {
    this.m_swapY = aSwap;
  }

  SetAllowPoints(aAllow = true): void {
    this.m_allowPoints = aAllow;
  }

  ///< @copydoc VIEW_ITEM::ViewBBox()
  override ViewBBox(): BOX2I {
    const box = new BOX2I();
    let empty = true;

    for (const point of this.m_points) {
      if (empty) {
        box.SetOrigin(point.GetPosition());
        empty = false;
      } else {
        box.Merge(point.GetPosition());
      }
    }

    for (const line of this.m_lines) {
      if (empty) {
        box.SetOrigin(line.GetOrigin().GetPosition());
        box.SetEnd(line.GetEnd().GetPosition());
        empty = false;
      } else {
        box.Merge(line.GetOrigin().GetPosition());
        box.Merge(line.GetEnd().GetPosition());
      }
    }

    return box;
  }

  ///< @copydoc VIEW_ITEM::ViewDraw()
  override ViewDraw(_aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL()!;
    const settings = aView.GetPainter()!.GetSettings();

    // `drawColor` against the clear colour, inverted when too close, and the
    // border / highlight by brightness: editPointColors is that derivation.
    const colors = editPointColors(
      toCss(settings.GetLayerColor(GAL_LAYER_ID.LAYER_AUX_ITEMS)),
      toCss(gal.GetClearColor()),
    );
    const drawColor = parseColor4d(colors.fill);
    const borderColor = parseColor4d(colors.border);
    const highlightColor = parseColor4d(colors.highlight);

    GAL_SCOPED_ATTRS(gal, GAL_SCOPED_ATTRS_FLAGS.ALL_ATTRS, () => {
      gal.SetFillColor(drawColor);
      gal.SetStrokeColor(borderColor);
      gal.SetIsFill(true);
      gal.SetIsStroke(true);
      gal.SetLayerDepth(gal.GetMinDepth());

      const size = aView.ToWorld(EDIT_POINT.POINT_SIZE) / 2.0;
      const borderSize = aView.ToWorld(EDIT_POINT.BORDER_SIZE);
      const hoverSize = aView.ToWorld(EDIT_POINT.HOVER_SIZE);

      const drawPoint = (aPoint: EDIT_POINT, aDrawCircle = false): void => {
        if (aPoint.IsHover() || aPoint.IsActive()) {
          gal.SetStrokeColor(highlightColor);
          gal.SetLineWidth(hoverSize);
        } else {
          gal.SetStrokeColor(borderColor);
          gal.SetLineWidth(borderSize);
        }

        gal.SetFillColor(drawColor);

        const p = aPoint.GetPosition();

        if (aDrawCircle) gal.DrawCircle(p, size);
        else gal.DrawRectangle({ x: p.x - size, y: p.y - size }, { x: p.x + size, y: p.y + size });
      };

      for (const point of this.m_points) drawPoint(point, point.DrawCircle());

      for (const line of this.m_lines) {
        // `drawPoint( line.GetPosition(), true )`: a fresh EDIT_POINT at the
        // centre, so the centre handle is never drawn hovered or active.
        if (line.HasCenterPoint()) drawPoint(new EDIT_POINT(line.GetPosition()), true);

        if (line.DrawLine()) {
          gal.SetLineWidth(borderSize / 4);
          gal.SetStrokeColor(borderColor);
          gal.DrawLine(line.GetOrigin().GetPosition(), line.GetEnd().GetPosition());
        }
      }
    });
  }

  ///< @copydoc VIEW_ITEM::ViewGetLayers()
  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_GP_OVERLAY];
  }

  override GetClass(): string {
    return 'EDIT_POINTS';
  }
}
