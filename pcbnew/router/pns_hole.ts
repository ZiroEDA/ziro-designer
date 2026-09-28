// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A drilled hole, as a router item in its own right.
 * Counterparts: `pcbnew/router/pns_hole.h` and `pns_hole.cpp` (`HOLE`).
 *
 * A via's hole is not a property of the via — it is a *separate item*, filed in
 * the node's index alongside its parent, with its own layer span and its own
 * entry in every collision search. That is what makes hole-to-hole clearance and
 * hole-to-copper clearance expressible at all: they are rules between two items,
 * and there has to be a second item for them to be between.
 *
 * The consequence is the awkward part of `ITEM::collideSimple` — a hole must
 * never be found colliding with the very pad or via it belongs to, and since a
 * `LINE` carries a *copy* of its via, pointer identity is not enough to spot
 * that case. See `shouldWeConsiderHoleCollisions` in `pns_item.ts`.
 *
 * A hole borrows its parent's net rather than carrying one, so a hole and its
 * own annular ring are same-net and skip clearance for the ordinary reason.
 */
import { moveShape, type Shape } from '../drc/drc_geometry.js';
import { PnsKind, PnsItem, type PnsBoardItem } from './pns_item.js';
import type { PnsLayerRange } from './pns_layerset.js';
import type { NetHandle } from './pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `HOLE`. */
export class PnsHole extends PnsItem {
  private mHoleShape: Shape | null;
  private mParentPadVia: PnsItem | null = null;

  constructor(aShape: Shape | null) {
    super(PnsKind.HOLE_T);
    this.mHoleShape = aShape;
  }

  /**
   * Upstream deep-copies the shape here. Shapes are treated as immutable in
   * this port — every mutator below replaces the whole object rather than
   * writing through it — so sharing the reference is observationally the same
   * thing and one allocation cheaper.
   */
  clone(): PnsHole {
    const h = new PnsHole(this.mHoleShape);

    h.setLayers(this.layers());
    h.setOwner(null);

    h.mRank = this.mRank;
    h.mMarker = this.mMarker;
    h.mParent = this.mParent;
    h.mIsVirtual = this.mIsVirtual;

    return h;
  }

  /** A hole has no net of its own; it answers with its pad's or via's. */
  override net(): NetHandle {
    if (this.mParentPadVia) return this.mParentPadVia.net();

    return this.mNet;
  }

  override shape(_aLayer: number): Shape | null {
    return this.mHoleShape;
  }

  setParentPadVia(aParent: PnsItem | null): void {
    this.mParentPadVia = aParent;
  }

  override parentPadVia(): PnsItem | null {
    return this.mParentPadVia;
  }

  /** A hole's board item is its own parent's when it has none directly. */
  override boardItem(): PnsBoardItem | null {
    if (this.mParent) return this.mParent;

    if (this.mParentPadVia) return this.mParentPadVia.parent();

    return null;
  }

  /** Upstream asserts the shape is a circle; a slot has no single radius. */
  radius(): number {
    if (this.mHoleShape?.kind !== 'circle') {
      throw new Error('PNS: HOLE::Radius() on a non-circular hole');
    }

    return this.mHoleShape.r;
  }

  setCenter(aCenter: Vec2): void {
    if (this.mHoleShape?.kind !== 'circle') {
      throw new Error('PNS: HOLE::SetCenter() on a non-circular hole');
    }

    this.mHoleShape = { ...this.mHoleShape, c: { x: aCenter.x, y: aCenter.y } };
  }

  setRadius(aRadius: number): void {
    if (this.mHoleShape?.kind !== 'circle') {
      throw new Error('PNS: HOLE::SetRadius() on a non-circular hole');
    }

    this.mHoleShape = { ...this.mHoleShape, r: aRadius };
  }

  move(aDelta: Vec2): void {
    if (this.mHoleShape) this.mHoleShape = moveShape(this.mHoleShape, aDelta);
  }

  static makeCircularHole(aPos: Vec2, aRadius: number, aLayers: PnsLayerRange): PnsHole {
    const hole = new PnsHole({ kind: 'circle', c: { x: aPos.x, y: aPos.y }, r: aRadius });
    hole.setLayers(aLayers);
    return hole;
  }
}
