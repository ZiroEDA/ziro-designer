// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/plugins/3dapi/sg_base.h` + `3d-viewer/3d_cache/sg/sg_base.cpp`: SGCOLOR (three C
 * floats in [0, 1]), SGPOINT and SGVECTOR (always normalised).
 */

export class SGCOLOR {
  red = 0.0;
  green = 0.0;
  blue = 0.0;

  constructor(aRVal?: number, aGVal?: number, aBVal?: number) {
    if (aRVal !== undefined) this.SetColor(aRVal, aGVal!, aBVal!);
  }

  GetColor(): [number, number, number] {
    return [this.red, this.green, this.blue];
  }

  /** `SetColor( float, float, float )`: refused (and left as it was) outside [0, 1]. */
  SetColor(aRedVal: number, aGreenVal: number, aBlueVal: number): boolean {
    const r = Math.fround(aRedVal);
    const g = Math.fround(aGreenVal);
    const b = Math.fround(aBlueVal);

    if (!this.checkRange(r, g, b)) return false;

    this.red = r;
    this.green = g;
    this.blue = b;
    return true;
  }

  private checkRange(aRedVal: number, aGreenVal: number, aBlueVal: number): boolean {
    let ok = true;

    if (aRedVal < 0.0 || aRedVal > 1.0) ok = false;

    if (aGreenVal < 0.0 || aGreenVal > 1.0) ok = false;

    if (aBlueVal < 0.0 || aBlueVal > 1.0) ok = false;

    return ok;
  }
}

export class SGPOINT {
  constructor(
    public x = 0.0,
    public y = 0.0,
    public z = 0.0,
  ) {}

  GetPoint(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  SetPoint(aXPos: number, aYPos: number, aZPos: number): void {
    this.x = aXPos;
    this.y = aYPos;
    this.z = aZPos;
  }
}

export class SGVECTOR {
  private vx = 0.0;
  private vy = 0.0;
  private vz = 1.0;

  constructor(aXVal?: number, aYVal?: number, aZVal?: number) {
    if (aXVal !== undefined) this.SetVector(aXVal, aYVal!, aZVal!);
  }

  GetVector(): [number, number, number] {
    return [this.vx, this.vy, this.vz];
  }

  SetVector(aXVal: number | SGVECTOR, aYVal?: number, aZVal?: number): void {
    if (aXVal instanceof SGVECTOR) {
      [this.vx, this.vy, this.vz] = aXVal.GetVector();
      return;
    }

    this.vx = aXVal;
    this.vy = aYVal!;
    this.vz = aZVal!;
    this.normalize();
  }

  private normalize(): void {
    const dx = this.vx * this.vx;
    const dy = this.vy * this.vy;
    const dz = this.vz * this.vz;
    const dv2 = Math.sqrt(dx + dy + dz);

    if (dx + dy + dz < 1e-8) {
      // use the default; the numbers are too small to be believable
      this.vx = 0.0;
      this.vy = 0.0;
      this.vz = 1.0;
      return;
    }

    this.vx /= dv2;
    this.vy /= dv2;
    this.vz /= dv2;
  }
}
