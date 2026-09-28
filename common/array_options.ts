// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ARRAY_OPTIONS` and its two kinds (include/array_options.h,
 * common/array_options.cpp): where each copy of an array goes
 * (`GetTransform`), how many there are (`GetArraySize`) and what each is
 * called (`GetItemNumber`, through the `ARRAY_AXIS` numbering).
 */
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { ARRAY_AXIS } from './array_axis.js';

enum ARRAY_TYPE_T {
  ARRAY_GRID, ///< A grid (x*y) array
  ARRAY_CIRCULAR, ///< A circular array
}

/** Options that govern the setup of an "array" of multiple item. */
export abstract class ARRAY_OPTIONS {
  static readonly ARRAY_TYPE_T = ARRAY_TYPE_T;

  protected m_type: ARRAY_TYPE_T;
  /** True if this array numbers the new items */
  protected m_shouldNumber = false;
  /**
   * True if this array should arrange the selected items instead of creating
   * an array of copies of the selection
   */
  protected m_arrangeSelection = false;
  /** True if this array will rename any footprints to be unique */
  protected m_reannotateFootprints = false;
  /**
   * True if this array's number starts from the preset point
   * False if the array numbering starts from some externally provided point
   */
  protected m_numberingStartIsSpecified = false;

  constructor(aType: ARRAY_TYPE_T) {
    this.m_type = aType;
  }

  /**
   * Get the transform of the n-th point in the array.
   *
   * @param  aN the index of the array point (0 is the original point).
   * @param  aPos the existing item's position.
   * @return a transform (an offset and a rotation).
   */
  abstract GetTransform(aN: number, aPos: VECTOR2I): ARRAY_OPTIONS.TRANSFORM;

  /** The number of points in this array. */
  abstract GetArraySize(): number;

  /**
   * Get the position number (name) for the n'th array point.
   *
   * @param  n array point index, from 0 to GetArraySize() - 1.
   * @return the point's name.
   */
  abstract GetItemNumber(n: number): string;

  /** @return are the items in this array numbered, or are all the items numbered the same? */
  ShouldNumberItems(): boolean {
    return this.m_shouldNumber;
  }

  SetShouldNumber(aShouldNumber: boolean): void {
    this.m_shouldNumber = aShouldNumber;
  }

  /** @return are we creating an array of copies of the selection or arranging the selection? */
  ShouldArrangeSelection(): boolean {
    return this.m_arrangeSelection;
  }

  SetShouldArrangeSelection(aShouldArrange: boolean): void {
    this.m_arrangeSelection = aShouldArrange;
  }

  /** @return are the footprints in this array reannotated to be unique (true), or do they keep the original annotation (false)? */
  ShouldReannotateFootprints(): boolean {
    return this.m_reannotateFootprints;
  }

  /** (The C++ spells it with the double S.) */
  SetSShouldReannotateFootprints(aShouldReannotate: boolean): void {
    this.m_reannotateFootprints = aShouldReannotate;
  }

  /** @return is the numbering is enabled and should start at a point specified in these options or is it implicit according to the calling code? */
  GetNumberingStartIsSpecified(): boolean {
    return this.m_shouldNumber && this.m_numberingStartIsSpecified;
  }

  SetNumberingStartIsSpecified(aIsSpecified: boolean): void {
    this.m_numberingStartIsSpecified = aIsSpecified;
  }
}

// biome-ignore lint/style/noNamespace: ARRAY_OPTIONS::TRANSFORM, the struct nested in the class.
export namespace ARRAY_OPTIONS {
  /** Transform applied to an object by this array. */
  export interface TRANSFORM {
    m_offset: VECTOR2I;
    m_rotation: EDA_ANGLE;
  }
}

export class ARRAY_GRID_OPTIONS extends ARRAY_OPTIONS {
  // Are the grid positions relative to item (0, 0), or the grid center?
  m_centred = false;
  m_nx = 0;
  m_ny = 0;
  m_horizontalThenVertical = true;
  m_reverseNumberingAlternate = false;
  m_delta: VECTOR2I = { x: 0, y: 0 };
  m_offset: VECTOR2I = { x: 0, y: 0 };
  m_stagger = 0;
  m_stagger_rows = true;
  m_2dArrayNumbering = false;
  m_pri_axis = new ARRAY_AXIS();
  m_sec_axis = new ARRAY_AXIS();

  constructor() {
    super(ARRAY_TYPE_T.ARRAY_GRID);
  }

  GetArraySize(): number {
    return this.m_nx * this.m_ny;
  }

  private getGridCoords(n: number): VECTOR2I {
    const axisSize = this.m_horizontalThenVertical ? this.m_nx : this.m_ny;

    let x = n % axisSize;
    const y = Math.trunc(n / axisSize);

    // reverse on this row/col?
    if (this.m_reverseNumberingAlternate && y % 2) x = axisSize - x - 1;

    return { x, y };
  }

  private gtItemPosRelativeToItem0(n: number): VECTOR2I {
    let coords = this.getGridCoords(n);

    // swap axes if needed
    if (!this.m_horizontalThenVertical) coords = { x: coords.y, y: coords.x };

    const point = {
      x: coords.x * this.m_delta.x + coords.y * this.m_offset.x,
      y: coords.y * this.m_delta.y + coords.x * this.m_offset.y,
    };

    if (Math.abs(this.m_stagger) > 1) {
      const stagger = Math.abs(this.m_stagger);
      const sr = this.m_stagger_rows;
      const stagger_idx = (sr ? coords.y : coords.x) % stagger;

      const stagger_delta = {
        x: sr ? this.m_delta.x : this.m_offset.x,
        y: sr ? this.m_offset.y : this.m_delta.y,
      };

      // Stagger to the left/up if the sign of the stagger is negative. The
      // product is a VECTOR2<double> (copysign is a double) and so is its
      // quotient; `+=` converts it back through VECTOR2I's converting
      // constructor, which truncates (vector2d.h:101).
      const signed = Math.sign(this.m_stagger) * stagger_idx;
      point.x += Math.trunc((stagger_delta.x * signed) / stagger);
      point.y += Math.trunc((stagger_delta.y * signed) / stagger);
    }

    return point;
  }

  GetTransform(n: number, _aPos: VECTOR2I): ARRAY_OPTIONS.TRANSFORM {
    const point = this.gtItemPosRelativeToItem0(n);

    // Bump the item by half the array size
    if (this.m_centred) {
      // Get the array extents
      const arrayExtentX = (this.m_nx - 1) * this.m_delta.x + (this.m_ny - 1) * this.m_offset.x;
      const arrayExtentY = (this.m_ny - 1) * this.m_delta.y + (this.m_nx - 1) * this.m_offset.y;

      // VECTOR2I / 2 is KiROUND( x / 2.0 ) for an integral vector (vector2d.h:539).
      point.x -= KiROUND(arrayExtentX / 2);
      point.y -= KiROUND(arrayExtentY / 2);
    }

    return { m_offset: point, m_rotation: ANGLE_0 };
  }

  GetItemNumber(n: number): string {
    if (this.m_2dArrayNumbering) {
      const coords = this.getGridCoords(n);

      return this.m_pri_axis.GetItemNumber(coords.x) + this.m_sec_axis.GetItemNumber(coords.y);
    }

    return this.m_pri_axis.GetItemNumber(n);
  }
}

export class ARRAY_CIRCULAR_OPTIONS extends ARRAY_OPTIONS {
  /** number of point in the array */
  m_nPts = 0;
  /** angle between points, or 0 for each point separated by this value (decideg) */
  m_angle: EDA_ANGLE = ANGLE_0;
  m_angleOffset: EDA_ANGLE = ANGLE_0;
  m_clockwise = false;
  m_centre: VECTOR2I = { x: 0, y: 0 };
  m_rotateItems = false;
  m_axis = new ARRAY_AXIS();

  constructor() {
    super(ARRAY_TYPE_T.ARRAY_CIRCULAR);
  }

  GetArraySize(): number {
    return this.m_nPts;
  }

  GetTransform(n: number, aPos: VECTOR2I): ARRAY_OPTIONS.TRANSFORM {
    let angle: EDA_ANGLE;

    if (this.m_angle.IsZero())
      // angle is zero, divide evenly into m_nPts
      angle = new EDA_ANGLE((360.0 * n) / this.m_nPts);
    // n'th step
    else angle = new EDA_ANGLE(this.m_angle.AsDegrees() * n);

    angle = angle.add(this.m_angleOffset);

    if (this.m_clockwise) angle = angle.negate();

    const new_pos = RotatePoint(aPos, this.m_centre, angle);

    // take off the rotation (but not the translation) if needed
    if (!this.m_rotateItems) angle = ANGLE_0;

    return { m_offset: { x: new_pos.x - aPos.x, y: new_pos.y - aPos.y }, m_rotation: angle };
  }

  GetItemNumber(aN: number): string {
    return this.m_axis.GetItemNumber(aN);
  }
}
