// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Minimal typings for clipper-lib 6.4.2, the JavaScript port of Angus Johnson's
 * Clipper. Only the surface SHAPE_POLY_SET uses is declared — offsetting for
 * Inflate and the clipping executor for the boolean ops; the package ships no
 * types of its own.
 */
declare module 'clipper-lib' {
  export interface IntPoint {
    X: number;
    Y: number;
  }

  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
  export const EndType: {
    etOpenSquare: number;
    etOpenRound: number;
    etOpenButt: number;
    etClosedLine: number;
    etClosedPolygon: number;
  };

  export const ClipType: {
    ctIntersection: number;
    ctUnion: number;
    ctDifference: number;
    ctXor: number;
  };
  export const PolyType: { ptSubject: number; ptClip: number };
  export const PolyFillType: {
    pftEvenOdd: number;
    pftNonZero: number;
    pftPositive: number;
    pftNegative: number;
  };

  /**
   * A node of Clipper's own outline/hole hierarchy. `SHAPE_POLY_SET::importTree`
   * reads this rather than re-deriving the nesting from a flat path list, which
   * is quadratic.
   */
  export class PolyNode {
    Contour(): IntPoint[];
    IsHole(): boolean;
    Childs(): PolyNode[];
    ChildCount(): number;
  }

  export class PolyTree extends PolyNode {
    Clear(): void;
    Total(): number;
  }

  export class Clipper {
    constructor(initOptions?: number);
    AddPath(path: IntPoint[], polyType: number, closed: boolean): boolean;
    AddPaths(paths: IntPoint[][], polyType: number, closed: boolean): boolean;
    Execute(
      clipType: number,
      solution: IntPoint[][] | PolyTree,
      subjFillType?: number,
      clipFillType?: number,
    ): boolean;
    Clear(): void;
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    AddPaths(paths: IntPoint[][], joinType: number, endType: number): void;
    Execute(solution: IntPoint[][] | PolyTree, delta: number): void;
    Clear(): void;
  }

  const ClipperLib: {
    JoinType: typeof JoinType;
    EndType: typeof EndType;
    ClipType: typeof ClipType;
    PolyType: typeof PolyType;
    PolyFillType: typeof PolyFillType;
    Clipper: typeof Clipper;
    PolyTree: typeof PolyTree;
    PolyNode: typeof PolyNode;
    ClipperOffset: typeof ClipperOffset;
  };
  export default ClipperLib;
}
