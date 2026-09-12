// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOX2I_MINMAX` (`math/box2_minmax.h`): a box as its four edges, the form
 * the chain intersection and self-intersection scans want.
 */

import type { Vec2, VECTOR2I } from './vector2.js';
import { BOX2I, BOX2ISafe } from './box2.js';

export class BOX2I_MINMAX {
  m_Left: number;
  m_Top: number;
  m_Right: number;
  m_Bottom: number;

  constructor();
  constructor(aLeft: number, aTop: number, aRight: number, aBottom: number);
  constructor(aPt: Vec2);
  constructor(aX: number, aY: number);
  constructor(aBox: BOX2I);
  constructor(aA: Vec2, aB: Vec2);
  constructor(a?: number | Vec2 | BOX2I, b?: number | Vec2, c?: number, d?: number) {
    if (a === undefined) {
      this.m_Left = this.m_Top = this.m_Right = this.m_Bottom = 0;
    } else if (a instanceof BOX2I) {
      this.m_Left = a.GetLeft();
      this.m_Top = a.GetTop();
      this.m_Right = a.GetRight();
      this.m_Bottom = a.GetBottom();
    } else if (typeof a === 'number') {
      if (c === undefined) {
        this.m_Left = this.m_Right = a;
        this.m_Top = this.m_Bottom = b as number;
      } else {
        this.m_Left = a;
        this.m_Top = b as number;
        this.m_Right = c;
        this.m_Bottom = d as number;
      }
    } else if (b !== undefined && typeof b !== 'number') {
      this.m_Left = Math.min(a.x, b.x);
      this.m_Right = Math.max(a.x, b.x);
      this.m_Top = Math.min(a.y, b.y);
      this.m_Bottom = Math.max(a.y, b.y);
    } else {
      this.m_Left = this.m_Right = a.x;
      this.m_Top = this.m_Bottom = a.y;
    }
  }

  /** `operator BOX2I()`. */
  ToBOX2I(): BOX2I {
    return BOX2ISafe(
      { x: this.m_Left, y: this.m_Top },
      { x: this.m_Right - this.m_Left, y: this.m_Bottom - this.m_Top },
    );
  }

  Intersects(aOther: BOX2I_MINMAX): boolean {
    // calculate the left common area coordinate:
    const left = Math.max(this.m_Left, aOther.m_Left);
    // calculate the right common area coordinate:
    const right = Math.min(this.m_Right, aOther.m_Right);
    // calculate the upper common area coordinate:
    const top = Math.max(this.m_Top, aOther.m_Top);
    // calculate the lower common area coordinate:
    const bottom = Math.min(this.m_Bottom, aOther.m_Bottom);

    // if a common area exists, it must have a positive (null accepted) size
    return left <= right && top <= bottom;
  }

  Merge(aPt: Vec2): void {
    this.m_Left = Math.min(this.m_Left, aPt.x);
    this.m_Right = Math.max(this.m_Right, aPt.x);
    this.m_Top = Math.min(this.m_Top, aPt.y);
    this.m_Bottom = Math.max(this.m_Bottom, aPt.y);
  }

  GetCenter(): VECTOR2I {
    const cx = Math.trunc((this.m_Left + this.m_Right) / 2);
    const cy = Math.trunc((this.m_Top + this.m_Bottom) / 2);
    return { x: cx, y: cy };
  }

  GetDiameter(): number {
    return Math.hypot(this.m_Right - this.m_Left, this.m_Bottom - this.m_Top);
  }
}
