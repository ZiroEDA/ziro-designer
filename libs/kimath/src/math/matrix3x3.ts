// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `math/matrix3x3.h`: `MATRIX3x3<T>`, the 3x3 matrix the GAL keeps its
 * world <-> screen transforms in. Only the `double` instantiation
 * (`MATRIX3x3D`) is used.
 */

import { cos, sin } from './libm.js';
import type { Vec2 } from './vector2.js';

export interface VECTOR3D {
  x: number;
  y: number;
  z: number;
}

export class MATRIX3x3 {
  m_data: [[number, number, number], [number, number, number], [number, number, number]];

  /**
   * Initialize all matrix members to zero.
   */
  constructor();
  /**
   * Initialize the matrix with 3 vectors (row by row).
   */
  constructor(a1: VECTOR3D, a2: VECTOR3D, a3: VECTOR3D);
  /**
   * Initialize with 9 values.
   */
  constructor(
    a00: number,
    a01: number,
    a02: number,
    a10: number,
    a11: number,
    a12: number,
    a20: number,
    a21: number,
    a22: number,
  );
  constructor(...args: [] | [VECTOR3D, VECTOR3D, VECTOR3D] | number[]) {
    this.m_data = [
      [0.0, 0.0, 0.0],
      [0.0, 0.0, 0.0],
      [0.0, 0.0, 0.0],
    ];

    if (args.length === 3) {
      const [a1, a2, a3] = args as [VECTOR3D, VECTOR3D, VECTOR3D];
      this.m_data[0][0] = a1.x;
      this.m_data[0][1] = a1.y;
      this.m_data[0][2] = a1.z;
      this.m_data[1][0] = a2.x;
      this.m_data[1][1] = a2.y;
      this.m_data[1][2] = a2.z;
      this.m_data[2][0] = a3.x;
      this.m_data[2][1] = a3.y;
      this.m_data[2][2] = a3.z;
    } else if (args.length === 9) {
      const a = args as number[];
      this.m_data[0][0] = a[0]!;
      this.m_data[0][1] = a[1]!;
      this.m_data[0][2] = a[2]!;
      this.m_data[1][0] = a[3]!;
      this.m_data[1][1] = a[4]!;
      this.m_data[1][2] = a[5]!;
      this.m_data[2][0] = a[6]!;
      this.m_data[2][1] = a[7]!;
      this.m_data[2][2] = a[8]!;
    }
  }

  /** The copy the C++ makes on assignment. */
  clone(): MATRIX3x3 {
    const r = new MATRIX3x3();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.m_data[i]![j] = this.m_data[i]![j]!;
    return r;
  }

  /**
   * Set the matrix to the identity matrix.
   *
   * The diagonal components of the matrix are set to 1.
   */
  SetIdentity(): void {
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        if (i === j) this.m_data[i]![j] = 1.0;
        else this.m_data[i]![j] = 0.0;
      }
    }
  }

  /**
   * Set the translation components of the matrix.
   *
   * @param aTranslation is the translation, specified as 2D vector.
   */
  SetTranslation(aTranslation: Vec2): void {
    this.m_data[0][2] = aTranslation.x;
    this.m_data[1][2] = aTranslation.y;
  }

  /**
   * Get the translation components of the matrix.
   *
   * @return is the translation (2D vector).
   */
  GetTranslation(): Vec2 {
    return { x: this.m_data[0][2], y: this.m_data[1][2] };
  }

  /**
   * Set the rotation components of the matrix.
   *
   * The angle needs to have a positive value for an anti-clockwise rotation.
   *
   * @param aAngle is the rotation angle in [rad].
   */
  SetRotation(aAngle: number): void {
    const cosValue = cos(aAngle);
    const sinValue = sin(aAngle);
    this.m_data[0][0] = cosValue;
    this.m_data[0][1] = -sinValue;
    this.m_data[1][0] = sinValue;
    this.m_data[1][1] = cosValue;
  }

  /**
   * Set the scale components of the matrix.
   *
   * @param aScale contains the scale factors, specified as 2D vector.
   */
  SetScale(aScale: Vec2): void {
    this.m_data[0][0] = aScale.x;
    this.m_data[1][1] = aScale.y;
  }

  /**
   * Get the scale components of the matrix.
   *
   * @return the scale factors, specified as 2D vector.
   */
  GetScale(): Vec2 {
    return { x: this.m_data[0][0], y: this.m_data[1][1] };
  }

  /**
   * Compute the determinant of the matrix.
   *
   * @return the determinant value.
   */
  Determinant(): number {
    const m = this.m_data;
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  }

  /**
   * Determine the inverse of the matrix.
   *
   * The inverse of a transformation matrix can be used to revert a transformation.
   *
   * @return the inverse matrix.
   */
  Inverse(): MATRIX3x3 {
    const m = this.m_data;
    const result = new MATRIX3x3();
    result.m_data[0][0] = m[1][1] * m[2][2] - m[2][1] * m[1][2];
    result.m_data[0][1] = m[0][2] * m[2][1] - m[2][2] * m[0][1];
    result.m_data[0][2] = m[0][1] * m[1][2] - m[1][1] * m[0][2];
    result.m_data[1][0] = m[1][2] * m[2][0] - m[2][2] * m[1][0];
    result.m_data[1][1] = m[0][0] * m[2][2] - m[2][0] * m[0][2];
    result.m_data[1][2] = m[0][2] * m[1][0] - m[1][2] * m[0][0];
    result.m_data[2][0] = m[1][0] * m[2][1] - m[2][0] * m[1][1];
    result.m_data[2][1] = m[0][1] * m[2][0] - m[2][1] * m[0][0];
    result.m_data[2][2] = m[0][0] * m[1][1] - m[1][0] * m[0][1];

    return result.mulScalar(1.0 / this.Determinant());
  }

  /**
   * Get the transpose of the matrix.
   *
   * @return the transpose matrix.
   */
  Transpose(): MATRIX3x3 {
    const result = new MATRIX3x3();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        result.m_data[j]![i] = this.m_data[i]![j]!;
      }
    }
    return result;
  }

  /** `operator*( MATRIX3x3, MATRIX3x3 )`: matrix multiplication. */
  mul(aB: MATRIX3x3): MATRIX3x3 {
    const result = new MATRIX3x3();
    const a = this.m_data;
    const b = aB.m_data;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        result.m_data[i]![j] = a[i]![0]! * b[0][j]! + a[i]![1]! * b[1][j]! + a[i]![2]! * b[2][j]!;
      }
    }
    return result;
  }

  /** `operator*( MATRIX3x3, VECTOR2 )`: the 3rd z-component is assumed to be 1. */
  mulVec2(aVector: Vec2): Vec2 {
    const m = this.m_data;
    return {
      x: m[0][0] * aVector.x + m[0][1] * aVector.y + m[0][2],
      y: m[1][0] * aVector.x + m[1][1] * aVector.y + m[1][2],
    };
  }

  /** `operator*( MATRIX3x3, VECTOR3 )`. */
  mulVec3(aVector: VECTOR3D): VECTOR3D {
    const m = this.m_data;
    return {
      x: m[0][0] * aVector.x + m[0][1] * aVector.y + m[0][2] * aVector.z,
      y: m[1][0] * aVector.x + m[1][1] * aVector.y + m[1][2] * aVector.z,
      z: m[2][0] * aVector.x + m[2][1] * aVector.y + m[2][2] * aVector.z,
    };
  }

  /** `operator*( MATRIX3x3, S )`: multiplication with a scalar. */
  mulScalar(aScalar: number): MATRIX3x3 {
    const result = new MATRIX3x3();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        result.m_data[i]![j] = this.m_data[i]![j]! * aScalar;
      }
    }
    return result;
  }

  /** Equality operator. */
  equals(aOtherMatrix: MATRIX3x3): boolean {
    const a = aOtherMatrix.m_data;
    const m = this.m_data;
    return (
      a[0][0] === m[0][0] &&
      a[0][1] === m[0][1] &&
      a[0][2] === m[0][2] &&
      a[1][0] === m[1][0] &&
      a[1][1] === m[1][1] &&
      a[1][2] === m[1][2] &&
      a[2][0] === m[2][0] &&
      a[2][1] === m[2][1] &&
      a[2][2] === m[2][2]
    );
  }

  /** `operator<<`: one row per line between bars. */
  toString(): string {
    let s = '';
    for (let i = 0; i < 3; i++) {
      s += '| ';
      for (let j = 0; j < 3; j++) s += `${this.m_data[i]![j]} `;
      s += '|\n';
    }
    return s;
  }
}

export type MATRIX3x3D = MATRIX3x3;
export const MATRIX3x3D = MATRIX3x3;
