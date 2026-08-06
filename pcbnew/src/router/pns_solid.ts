// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A pad, or anything else fixed that copper has to get around.
 * Counterparts: `pcbnew/router/pns_solid.h` and `pns_solid.cpp` (`SOLID`).
 *
 * A solid is the router's immovable furniture: `m_movable` is false from the
 * constructor and nothing sets it true. What makes it more than a shape is the
 * anchor list — a pad may declare several points a track is allowed to land on
 * (the pins of a multi-anchor pad), and when it declares none the single anchor
 * is its own centre. `NODE` links a solid into a joint at `Pos()`, so that
 * centre is also where the connectivity graph attaches.
 *
 * A solid is only linked into the joint graph when it is *routable*. An
 * unroutable pad — one the interface layer has marked as not a valid track
 * target — is still an obstacle, still in the index, and still collides; it just
 * cannot be connected to. `NODE::addSolid` and `NODE::removeSolidIndex` both
 * check the flag, which is why the two stay in step.
 */
import { moveShape, type Shape } from '../drc/drc_geometry.js';
import { PnsKind, PnsItem } from './pns_item.js';
import type { PnsHole } from './pns_hole.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `SOLID`. */
export class PnsSolid extends PnsItem {
  private mPos: Vec2 = { x: 0, y: 0 };
  private mShape: Shape | null = null;
  private mOffset: Vec2 = { x: 0, y: 0 };
  private mPadToDie = 0;
  private mPadToDieDelay = 0;
  private mOrientation: EDA_ANGLE | null = null;
  private mHole: PnsHole | null = null;
  private mAnchorPoints: Vec2[] = [];

  constructor() {
    super(PnsKind.SOLID_T);
    this.mMovable = false;
  }

  clone(): PnsSolid {
    const s = new PnsSolid();
    s.copyFrom(this);

    if (this.mShape) s.setShape(this.mShape);
    if (this.mHole) s.setHole(this.mHole.clone());

    s.mPos = { ...this.mPos };
    s.mPadToDie = this.mPadToDie;
    s.mPadToDieDelay = this.mPadToDieDelay;
    s.mOrientation = this.mOrientation;
    s.mAnchorPoints = this.mAnchorPoints.map((p) => ({ ...p }));

    // `m_offset` is deliberately *not* copied: upstream's copy constructor
    // lists eight members and that is not one of them, so a cloned solid starts
    // with a zero offset. Kept, because a clone that differed from upstream's
    // here would move pads by the offset the original had.

    return s;
  }

  override shape(_aLayer: number): Shape | null {
    return this.mShape;
  }

  setShape(aShape: Shape | null): void {
    this.mShape = aShape;
  }

  pos(): Vec2 {
    return this.mPos;
  }

  /** Move the solid, taking its shape and its hole with it. */
  setPos(aCenter: Vec2): void {
    const delta = { x: aCenter.x - this.mPos.x, y: aCenter.y - this.mPos.y };

    if (this.mShape) this.mShape = moveShape(this.mShape, delta);
    if (this.mHole) this.mHole.move(delta);

    this.mPos = { x: aCenter.x, y: aCenter.y };
  }

  getPadToDie(): number {
    return this.mPadToDie;
  }

  setPadToDie(aLen: number): void {
    this.mPadToDie = aLen;
  }

  getPadToDieDelay(): number {
    return this.mPadToDieDelay;
  }

  setPadToDieDelay(aDelay: number): void {
    this.mPadToDieDelay = aDelay;
  }

  /** With no declared anchors, the solid's own position is the only one. */
  override anchor(aN: number): Vec2 {
    return this.mAnchorPoints.length === 0 ? this.mPos : (this.mAnchorPoints[aN] as Vec2);
  }

  override anchorCount(): number {
    return this.mAnchorPoints.length === 0 ? 1 : this.mAnchorPoints.length;
  }

  anchorPoints(): readonly Vec2[] {
    return this.mAnchorPoints;
  }

  setAnchorPoints(aPoints: Vec2[]): void {
    this.mAnchorPoints = aPoints;
  }

  offset(): Vec2 {
    return this.mOffset;
  }

  setOffset(aOffset: Vec2): void {
    this.mOffset = aOffset;
  }

  getOrientation(): EDA_ANGLE | null {
    return this.mOrientation;
  }

  setOrientation(aOrientation: EDA_ANGLE | null): void {
    this.mOrientation = aOrientation;
  }

  /**
   * Taking a hole makes this solid its owner *and* its parent pad, and forces
   * the hole onto the solid's own layers. Upstream's `fixme` applies: a
   * backdrilled via can have a hole layer set different from its copper one.
   */
  override setHole(aHole: PnsItem | null): void {
    this.mHole = aHole as PnsHole | null;

    if (this.mHole) {
      this.mHole.setParentPadVia(this);
      this.mHole.setOwner(this);
      this.mHole.setLayers(this.mLayers);
    }
  }

  override hasHole(): boolean {
    return this.mHole !== null;
  }

  override hole(): PnsHole | null {
    return this.mHole;
  }
}
