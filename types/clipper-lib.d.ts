// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Minimal typings for clipper-lib 6.4.2, the JavaScript port of Angus Johnson's
 * Clipper. Only the offsetting surface SHAPE_POLY_SET::Inflate uses is declared;
 * the package ships no types of its own.
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

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    AddPaths(paths: IntPoint[][], joinType: number, endType: number): void;
    Execute(solution: IntPoint[][], delta: number): void;
    Clear(): void;
  }

  const ClipperLib: {
    JoinType: typeof JoinType;
    EndType: typeof EndType;
    ClipperOffset: typeof ClipperOffset;
  };
  export default ClipperLib;
}
