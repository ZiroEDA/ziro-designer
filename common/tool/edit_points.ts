// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/tool/edit_points.h` + `common/tool/edit_points.cpp`: `EDIT_POINT`
 * and `EDIT_POINTS`, the handles a point editor draws on an item and hit
 * tests the pointer against.
 *
 * Ported as far as a point editor that moves plain points needs it - the
 * drawing sheet's `PL_POINT_EDITOR` is the one caller. Not yet here, and
 * named so a later caller knows: `EDIT_LINE` (the midpoint handles), the
 * contour bookkeeping (`AddBreak`, `GetContourStartIdx` / `EndIdx`,
 * `Previous` / `Next`) and `EDIT_CONSTRAINT`s (`edit_constraints.cpp`).
 * The sizes are `preview_items/edit_points.ts`' and the colour rule is
 * `color4d.ts`' `editPointColors`, the same two the editors already share.
 */

import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
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
  private m_drawCircle = false; ///< True to draw a circle instead of a square.

  constructor(aPoint: VECTOR2I) {
    this.m_position = { x: aPoint.x, y: aPoint.y };
  }

  /** Return coordinates of an EDIT_POINT. */
  GetPosition(): VECTOR2I {
    return this.m_position;
  }

  /** Set new coordinates for an EDIT_POINT. It does not change the coordinates of an item. */
  SetPosition(aPosition: VECTOR2I): void {
    this.m_position = { x: aPosition.x, y: aPosition.y };
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
}

/**
 * EDIT_POINTS is a VIEW_ITEM that manages EDIT_POINTs and EDIT_LINEs and draws them.
 */
export class EDIT_POINTS extends EDA_ITEM {
  /// `m_parent`, the parent of the EDIT_POINTs (EDA_ITEM already names its own).
  private readonly m_pointsParent: EDA_ITEM | null;
  private m_points: EDIT_POINT[] = []; ///< EDIT_POINTs for modifying m_parent.
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

    return null;
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
  AddPoint(aPoint: VECTOR2I): void {
    this.m_points.push(new EDIT_POINT(aPoint));
  }

  /** The index of `aPoint`, or -1: `EDIT_POINTS`' `&aPoint - &m_points[0]`. */
  IndexOf(aPoint: EDIT_POINT | null): number {
    return aPoint ? this.m_points.indexOf(aPoint) : -1;
  }

  Point(aIndex: number): EDIT_POINT {
    return this.m_points[aIndex]!;
  }

  PointsSize(): number {
    return this.m_points.length;
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

      for (const point of this.m_points) {
        if (point.IsHover() || point.IsActive()) {
          gal.SetStrokeColor(highlightColor);
          gal.SetLineWidth(hoverSize);
        } else {
          gal.SetStrokeColor(borderColor);
          gal.SetLineWidth(borderSize);
        }

        gal.SetFillColor(drawColor);

        const p = point.GetPosition();

        if (point.DrawCircle()) gal.DrawCircle(p, size);
        else gal.DrawRectangle({ x: p.x - size, y: p.y - size }, { x: p.x + size, y: p.y + size });
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
