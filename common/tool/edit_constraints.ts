// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/tool/edit_constraints.h` + `common/tool/edit_constraints.cpp`: the
 * rules a point editor applies to a handle while it is dragged - keep it on a
 * vertical, a horizontal, a 45 or 90 degree line, a line, a circle; keep a
 * polygon edge parallel to itself.
 *
 * `GRID_HELPER` itself is `tool/grid_helper.ts` now, but every rule here still
 * asks it only one thing, `AlignGrid`, so that stays the whole interface these
 * classes take ({@link GRID_HELPER} below) rather than the concrete class -
 * anything with an `AlignGrid` will do, `EC_CONVERGING`'s own default grid
 * included. That default - `GRID_HELPER dummyGrid;`, a 1 x 1 grid at the
 * origin (`grid_helper.cpp:51-53`) - is {@link DEFAULT_GRID_HELPER}.
 */

import { vectorSnapped45, vectorSnapped90 } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  EuclideanNorm,
  EuclideanNormI,
  Perpendicular,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { EDIT_LINE, EDIT_POINT, EDIT_POINTS } from './edit_points.js';
import { computeNearest } from './grid_helper.js';

/**
 * Mode for polygon line edge constraints. Determines what happens to the dragged line's
 * length when moving perpendicular to the line.
 */
export enum POLYGON_LINE_MODE {
  CONVERGING, ///< Adjacent lines converge/diverge, dragged line length changes
  FIXED_LENGTH, ///< Dragged line maintains its length, adjacent lines adjust angles
}

export enum GRID_CONSTRAINT_TYPE {
  IGNORE_GRID,
  SNAP_TO_GRID,
  SNAP_BY_GRID, // Keep it on grid if it started on grid (treat x and y independently)
}

export enum SNAP_CONSTRAINT_TYPE {
  IGNORE_SNAPS,
  OBJECT_LAYERS,
  ALL_LAYERS,
}

/** `GRID_HELPER`, as far as a constraint asks it. */
export interface GRID_HELPER {
  AlignGrid(aPoint: VECTOR2I): VECTOR2I;
}

/** `GRID_HELPER::computeNearest` - re-exported from the real class's module; see the file comment. */
export { computeNearest };

/**
 * A default-constructed GRID_HELPER: no tool manager, so `GetGrid()` is
 * `m_manualGrid` (1, 1) and `GetOrigin()` is `m_manualOrigin` (0, 0)
 * (grid_helper.cpp:42-55, 362-384).
 */
export const DEFAULT_GRID_HELPER: GRID_HELPER = {
  AlignGrid: (aPoint) => computeNearest(aPoint, { x: 1, y: 1 }, { x: 0, y: 0 }),
};

const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const dot = (a: VECTOR2I, b: VECTOR2I): number => a.x * b.x + a.y * b.y;
/** `VECTOR2<int>::operator/( double )`: KiROUND each (vector2d.h:536-542). */
const divI = (a: VECTOR2I, f: number): VECTOR2I => ({ x: KiROUND(a.x / f), y: KiROUND(a.y / f) });

/**
 * Describe constraints between two edit handles.
 *
 * After the constrained handle is changed, Apply() has to be called to fix its coordinates
 * according to the implemented constraint.
 */
export abstract class EDIT_CONSTRAINT<EDIT_TYPE> {
  protected m_constrained: EDIT_TYPE; ///< Point that is constrained by rules implemented by Apply().

  constructor(aConstrained: EDIT_TYPE) {
    this.m_constrained = aConstrained;
  }

  /**
   * Correct coordinates of the constrained edit handle.
   *
   * With only a grid, `Apply( aGrid )`: the handle is `m_constrained`.
   */
  Apply(aGrid: GRID_HELPER): void;
  Apply(aHandle: EDIT_TYPE, aGrid: GRID_HELPER): void;
  Apply(a: EDIT_TYPE | GRID_HELPER, b?: GRID_HELPER): void {
    if (b === undefined) this.applyTo(this.m_constrained, a as GRID_HELPER);
    else this.applyTo(a as EDIT_TYPE, b);
  }

  /** `virtual void Apply( EDIT_TYPE& aHandle, const GRID_HELPER& aGrid ) = 0`. */
  protected abstract applyTo(aHandle: EDIT_TYPE, aGrid: GRID_HELPER): void;
}

/**
 * #EDIT_CONSTRAINT that imposes a constraint that two points have to have the same X coordinate.
 */
export class EC_VERTICAL extends EDIT_CONSTRAINT<EDIT_POINT> {
  private readonly m_constrainer: EDIT_POINT; ///< Point that imposes the constraint.

  constructor(aConstrained: EDIT_POINT, aConstrainer: EDIT_POINT) {
    super(aConstrained);
    this.m_constrainer = aConstrainer;
  }

  protected applyTo(aHandle: EDIT_POINT, aGrid: GRID_HELPER): void {
    let point = aHandle.GetPosition();

    if (aHandle.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_TO_GRID)
      point = aGrid.AlignGrid(point);

    point = { x: this.m_constrainer.GetPosition().x, y: point.y };
    aHandle.SetPosition(point);
  }
}

/**
 * #EDIT_CONSTRAINT that imposes a constraint that two points have to have the same Y coordinate.
 */
export class EC_HORIZONTAL extends EDIT_CONSTRAINT<EDIT_POINT> {
  private readonly m_constrainer: EDIT_POINT; ///< Point that imposes the constraint.

  constructor(aConstrained: EDIT_POINT, aConstrainer: EDIT_POINT) {
    super(aConstrained);
    this.m_constrainer = aConstrainer;
  }

  protected applyTo(aHandle: EDIT_POINT, aGrid: GRID_HELPER): void {
    let point = aHandle.GetPosition();

    if (aHandle.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_TO_GRID)
      point = aGrid.AlignGrid(point);

    point = { x: point.x, y: this.m_constrainer.GetPosition().y };
    aHandle.SetPosition(point);
  }
}

/**
 * #EDIT_CONSTRAINT that imposes a constraint that two points have to be located at angle of 45
 * degree multiplicity.
 */
export class EC_45DEGREE extends EDIT_CONSTRAINT<EDIT_POINT> {
  private readonly m_constrainer: EDIT_POINT; ///< Point that imposes the constraint.

  constructor(aConstrained: EDIT_POINT, aConstrainer: EDIT_POINT) {
    super(aConstrained);
    this.m_constrainer = aConstrainer;
  }

  protected applyTo(aHandle: EDIT_POINT, aGrid: GRID_HELPER): void {
    const lineVector = sub(aHandle.GetPosition(), this.m_constrainer.GetPosition());
    const newLineVector = vectorSnapped45(lineVector);

    if (
      aHandle.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_TO_GRID &&
      (newLineVector.x === 0 || newLineVector.y === 0)
    ) {
      const snap = aGrid.AlignGrid(add(this.m_constrainer.GetPosition(), newLineVector));

      if (newLineVector.x === 0)
        aHandle.SetPosition({ x: this.m_constrainer.GetPosition().x, y: snap.y });
      else aHandle.SetPosition({ x: snap.x, y: this.m_constrainer.GetPosition().y });
    } else {
      aHandle.SetPosition(add(this.m_constrainer.GetPosition(), newLineVector));
    }
  }
}

/**
 * #EDIT_CONSTRAINT that imposes a constraint that two points have to be located at angle of 90
 * degree multiplicity.
 */
export class EC_90DEGREE extends EDIT_CONSTRAINT<EDIT_POINT> {
  private readonly m_constrainer: EDIT_POINT; ///< Point that imposes the constraint.

  constructor(aConstrained: EDIT_POINT, aConstrainer: EDIT_POINT) {
    super(aConstrained);
    this.m_constrainer = aConstrainer;
  }

  protected applyTo(aHandle: EDIT_POINT, aGrid: GRID_HELPER): void {
    const lineVector = sub(aHandle.GetPosition(), this.m_constrainer.GetPosition());
    const newLineVector = vectorSnapped90(lineVector);

    if (aHandle.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_TO_GRID) {
      const snap = aGrid.AlignGrid(add(this.m_constrainer.GetPosition(), newLineVector));

      if (newLineVector.x === 0)
        aHandle.SetPosition({ x: this.m_constrainer.GetPosition().x, y: snap.y });
      else aHandle.SetPosition({ x: snap.x, y: this.m_constrainer.GetPosition().y });
    } else {
      aHandle.SetPosition(add(this.m_constrainer.GetPosition(), newLineVector));
    }
  }
}

/**
 * #EDIT_CONSTRAINT that imposes a constraint that a point has to lie on a line (determined
 * by 2 points).
 */
export class EC_LINE extends EDIT_CONSTRAINT<EDIT_POINT> {
  private readonly m_constrainer: EDIT_POINT; ///< Point that imposes the constraint.
  private readonly m_line: VECTOR2I; ///< Vector representing the constraining line.

  constructor(aConstrained: EDIT_POINT, aConstrainer: EDIT_POINT) {
    super(aConstrained);
    this.m_constrainer = aConstrainer;
    this.m_line = sub(this.m_constrained.GetPosition(), this.m_constrainer.GetPosition());
  }

  protected applyTo(aHandle: EDIT_POINT, aGrid: GRID_HELPER): void {
    const main = new SEG(
      this.m_constrainer.GetPosition(),
      add(this.m_constrainer.GetPosition(), this.m_line),
    );

    if (
      aHandle.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_TO_GRID &&
      (this.m_line.x === 0 || this.m_line.y === 0)
    ) {
      const snappedHandle = aGrid.AlignGrid(aHandle.GetPosition());

      if (this.m_line.x === 0)
        aHandle.SetPosition({ x: aHandle.GetPosition().x, y: snappedHandle.y });
      else aHandle.SetPosition({ x: snappedHandle.x, y: aHandle.GetPosition().y });
    }

    const projection = new SEG(
      aHandle.GetPosition(),
      add(aHandle.GetPosition(), Perpendicular(this.m_line)),
    );
    const intersect = projection.IntersectLines(main);

    if (intersect) aHandle.SetPosition(intersect);
  }

  GetConstrainer(): EDIT_POINT {
    return this.m_constrainer;
  }

  GetLineVector(): VECTOR2I {
    return this.m_line;
  }
}

/**
 * #EDIT_CONSTRAINT that imposes a constraint that a point has to lie on a circle.
 */
export class EC_CIRCLE extends EDIT_CONSTRAINT<EDIT_POINT> {
  /// Point that imposes the constraint (center of the circle).
  private readonly m_center: EDIT_POINT;
  /// Point that imposes the constraint (decides on the radius of the circle).
  private readonly m_end: EDIT_POINT;

  constructor(aConstrained: EDIT_POINT, aCenter: EDIT_POINT, aEnd: EDIT_POINT) {
    super(aConstrained);
    this.m_center = aCenter;
    this.m_end = aEnd;
  }

  protected applyTo(aHandle: EDIT_POINT, _aGrid: GRID_HELPER): void {
    const centerToEnd = sub(this.m_end.GetPosition(), this.m_center.GetPosition());
    const centerToPoint = sub(aHandle.GetPosition(), this.m_center.GetPosition());

    // `VECTOR2<int>::EuclideanNorm`, which rounds (vector2d.h).
    const radius = EuclideanNormI(centerToEnd);
    const angle = EDA_ANGLE.fromVector(centerToPoint);

    const newLine = RotatePoint({ x: radius, y: 0 }, angle.negate());

    aHandle.SetPosition(add(this.m_center.GetPosition(), newLine));
  }
}

/**
 * #EDIT_CONSTRAINT for 3 segments: dragged and two adjacent ones, enforcing to keep their slopes
 * and allows only to change ending points. Applied to zones.
 */
export class EC_CONVERGING extends EDIT_CONSTRAINT<EDIT_LINE> {
  /// Constraint mode
  private m_mode: POLYGON_LINE_MODE;
  /// Constraint for origin side segment.
  private readonly m_originSideConstraint: EC_LINE;
  /// Constraint for end side segment.
  private readonly m_endSideConstraint: EC_LINE;
  /// Additional constraint, applied when at least two points are collinear. It is one of the
  /// two above.
  private readonly m_colinearConstraint: EC_LINE | null;
  /// EDIT_POINTS instance that stores currently modified lines.
  private readonly m_editPoints: EDIT_POINTS;
  /// Vector that represents the initial direction of the dragged segment.
  private readonly m_draggedVector: VECTOR2I;
  /// Original center position of the line
  private readonly m_originalCenter: VECTOR2I;
  /// Perpendicular direction to the dragged segment (for constraining movement)
  private readonly m_perpVector: VECTOR2I;
  /// Original half-length of the line (for fixed-length mode)
  private readonly m_halfLength: number;
  /// Flags to indicate when dragged and neighbouring lines are (almost) collinear.
  private readonly m_originCollinear: boolean;
  private readonly m_endCollinear: boolean;
  /// Previous and next points to keep drag endpoints fixed.
  private readonly m_prevOrigin: EDIT_POINT;
  private readonly m_nextEnd: EDIT_POINT;
  /// Original convergence point of adjacent segments.
  private readonly m_convergencePoint: VECTOR2I;
  /// Vector from the convergence point to the mid-line point.
  private readonly m_midVector: VECTOR2I;

  constructor(
    aLine: EDIT_LINE,
    aPoints: EDIT_POINTS,
    aMode: POLYGON_LINE_MODE = POLYGON_LINE_MODE.CONVERGING,
  ) {
    super(aLine);
    this.m_mode = aMode;
    this.m_editPoints = aPoints;
    this.m_prevOrigin = aPoints.Previous(aLine.GetOrigin(), false)!;
    this.m_nextEnd = aPoints.Next(aLine.GetEnd(), false)!;

    const origin = aLine.GetOrigin();
    const end = aLine.GetEnd();

    // Constraints for segments adjacent to the dragged one
    this.m_originSideConstraint = new EC_LINE(origin, this.m_prevOrigin);
    this.m_endSideConstraint = new EC_LINE(end, this.m_nextEnd);

    // Store the current vector and center of the line
    this.m_draggedVector = sub(end.GetPosition(), origin.GetPosition());
    this.m_originalCenter = aLine.GetPosition();

    // Perpendicular direction for constraining movement
    this.m_perpVector = Perpendicular(this.m_draggedVector);

    // Half-length for fixed-length mode
    // `VECTOR2<int>::EuclideanNorm` rounds before the halving.
    this.m_halfLength = EuclideanNormI(this.m_draggedVector) / 2.0;

    // Check for colinearity
    const originSide = new SEG(origin.GetPosition(), this.m_prevOrigin.GetPosition());
    const endSide = new SEG(end.GetPosition(), this.m_nextEnd.GetPosition());
    const dragged = new SEG(origin.GetPosition(), end.GetPosition());

    const alignAngle = 10;

    this.m_originCollinear = dragged.Angle(originSide).AsDegrees() < alignAngle;
    this.m_endCollinear = dragged.Angle(endSide).AsDegrees() < alignAngle;

    if (this.m_originCollinear) this.m_colinearConstraint = this.m_originSideConstraint;
    else if (this.m_endCollinear) this.m_colinearConstraint = this.m_endSideConstraint;
    else this.m_colinearConstraint = null;

    const intersect = originSide.IntersectLines(endSide);
    this.m_convergencePoint = intersect ?? aLine.GetPosition();

    this.m_midVector = sub(aLine.GetPosition(), this.m_convergencePoint);
  }

  protected applyTo(aHandle: EDIT_LINE, _aGrid: GRID_HELPER): void {
    const handlePos = aHandle.GetPosition();

    // Project the handle position onto the perpendicular line through the original center.
    // This ensures the line always moves perpendicular to itself.
    const perpLine = new SEG(this.m_originalCenter, add(this.m_originalCenter, this.m_perpVector));
    const toHandle = new SEG(handlePos, add(handlePos, this.m_draggedVector));
    let newCenter = perpLine.IntersectLines(toHandle) ?? handlePos;

    // In converging mode, don't allow movement past the convergence point
    if (this.m_mode === POLYGON_LINE_MODE.CONVERGING) {
      const centerToConv = sub(this.m_convergencePoint, this.m_originalCenter);
      const centerToNew = sub(newCenter, this.m_originalCenter);

      // Check if we've crossed past the convergence point
      if (dot(centerToConv, this.m_perpVector) !== 0) {
        const t = dot(centerToNew, this.m_perpVector) / dot(centerToConv, this.m_perpVector);

        if (t > 1.0) newCenter = this.m_convergencePoint;
      }
    }

    aHandle.SetPosition(newCenter);

    if (this.m_mode === POLYGON_LINE_MODE.FIXED_LENGTH) this.applyFixedLength(aHandle);
    else this.applyConverging(aHandle);
  }

  /// Get the current constraint mode
  GetMode(): POLYGON_LINE_MODE {
    return this.m_mode;
  }

  /// Set the constraint mode (allows switching between converging and fixed-length)
  SetMode(aMode: POLYGON_LINE_MODE): void {
    this.m_mode = aMode;
  }

  /// Original center of the dragged line, captured at drag start.
  GetOriginalCenter(): VECTOR2I {
    return this.m_originalCenter;
  }

  /// Perpendicular direction of motion for the dragged line, captured at drag start.
  /// Length matches the original dragged segment vector.
  GetPerpVector(): VECTOR2I {
    return this.m_perpVector;
  }

  /// Apply converging mode: find intersections with adjacent lines
  private applyConverging(aHandle: EDIT_LINE): void {
    const origin = aHandle.GetOrigin();
    const end = aHandle.GetEnd();

    if (this.m_originCollinear && this.m_endCollinear) {
      if (this.m_colinearConstraint) {
        const dummyGrid = DEFAULT_GRID_HELPER;
        this.m_colinearConstraint.Apply(origin, dummyGrid);
        this.m_colinearConstraint.Apply(end, dummyGrid);
      }

      return;
    }

    // The dragged segment at new position (parallel to original)
    const newCenter = aHandle.GetPosition();
    const halfDragged = divI(this.m_draggedVector, 2);
    const dragged = new SEG(sub(newCenter, halfDragged), add(newCenter, halfDragged));

    // Get the fixed directions of adjacent segments from the stored EC_LINE constraints.
    // These directions were captured at drag start and don't change.
    const originDir = this.m_originSideConstraint.GetLineVector();
    const endDir = this.m_endSideConstraint.GetLineVector();

    // Adjacent segments use fixed directions from the anchor points
    let originSide = new SEG(
      this.m_prevOrigin.GetPosition(),
      add(this.m_prevOrigin.GetPosition(), originDir),
    );
    let endSide = new SEG(this.m_nextEnd.GetPosition(), add(this.m_nextEnd.GetPosition(), endDir));

    // Find intersection of dragged line with origin side
    const originIntersect = dragged.IntersectLines(originSide);

    if (originIntersect) origin.SetPosition(originIntersect);

    // Find intersection of dragged line with end side
    const endIntersect = dragged.IntersectLines(endSide);

    if (endIntersect) end.SetPosition(endIntersect);

    // Check if adjacent segments would intersect (self-intersecting polygon)
    originSide = new SEG(origin.GetPosition(), this.m_prevOrigin.GetPosition());
    endSide = new SEG(end.GetPosition(), this.m_nextEnd.GetPosition());

    const originEndIntersect = endSide.Intersect(originSide);

    if (originEndIntersect) {
      if (this.m_editPoints.LinesSize() > 3) {
        origin.SetPosition(originEndIntersect);
        end.SetPosition(originEndIntersect);
      }
    }
  }

  /// Apply fixed-length mode: maintain line length, adjust adjacent line angles
  private applyFixedLength(aHandle: EDIT_LINE): void {
    const origin = aHandle.GetOrigin();
    const end = aHandle.GetEnd();

    const newCenter = aHandle.GetPosition();

    // Keep the line at its original length, centered on the new position
    let unitDir = { x: this.m_draggedVector.x, y: this.m_draggedVector.y };
    const norm = EuclideanNorm(unitDir);

    if (norm > 0) unitDir = { x: unitDir.x / norm, y: unitDir.y / norm };

    const offset = {
      x: KiROUND(unitDir.x * this.m_halfLength),
      y: KiROUND(unitDir.y * this.m_halfLength),
    };

    origin.SetPosition(sub(newCenter, offset));
    end.SetPosition(add(newCenter, offset));
  }
}

/**
 * #EDIT_CONSTRAINT for a EDIT_LINE, one of the ends is snapped to a spot determined by a
 * transform function passed as parameter (e.g. it can be snapped to a grid), instead of having
 * the line center snapped to a point.
 */
export class EC_PERPLINE extends EDIT_CONSTRAINT<EDIT_LINE> {
  private readonly m_mid: VECTOR2I;
  private readonly m_line: VECTOR2I;

  constructor(aLine: EDIT_LINE) {
    super(aLine);
    this.m_mid = aLine.GetPosition();
    this.m_line = Perpendicular(sub(aLine.GetEnd().GetPosition(), aLine.GetOrigin().GetPosition()));
  }

  protected applyTo(aHandle: EDIT_LINE, _aGrid: GRID_HELPER): void {
    const main = new SEG(this.m_mid, add(this.m_mid, this.m_line));
    const projection = new SEG(
      aHandle.GetPosition(),
      add(aHandle.GetPosition(), Perpendicular(this.m_line)),
    );
    const intersect = projection.IntersectLines(main);

    if (intersect) aHandle.SetPosition(intersect);

    const delta = sub(aHandle.GetEnd().GetPosition(), aHandle.GetOrigin().GetPosition());

    aHandle.GetOrigin().SetPosition(aHandle.GetOrigin().GetPosition());
    aHandle.GetEnd().SetPosition(add(aHandle.GetOrigin().GetPosition(), delta));
  }
}
