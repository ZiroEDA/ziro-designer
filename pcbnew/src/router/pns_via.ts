// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A via, and the virtual via the router invents to pin a track down.
 * Counterparts: `pcbnew/router/pns_via.h` and `pns_via.cpp` (`VIA`, `VVIA`,
 * `VIA_HANDLE`).
 *
 * The only item whose *shape depends on which layer you ask about*. Everything
 * else in the model answers `shape(-1)` with one shape and means it; a via with
 * a real padstack has a different annular ring per layer, which is why
 * `uniqueShapeLayers` and `relevantShapeLayers` exist at all and why the index
 * queries a multilayer item once per layer.
 *
 * ## `effectiveLayer` is the whole padstack mechanism
 *
 * Diameters and shapes are stored in maps keyed not by board layer but by
 * *padstack slot*, and `effectiveLayer` is the function from one to the other.
 * A `NORMAL` via has a single slot, `ALL_LAYERS`, and every query — including
 * `shape(-1)` — funnels into it. `FRONT_INNER_BACK` has three. `CUSTOM` keys by
 * the layer itself, and answers a layer it does not span with its start layer
 * rather than nothing. Read the map directly and a normal via appears to have no
 * shape on layer 3; go through `effectiveLayer` and it has the right one.
 *
 * ## `VIA_HANDLE` exists because pointers do not survive branching
 *
 * A node branch clones items, so a `VIA*` held across a branch points at the
 * wrong node's copy. A handle — position, layers, net — is looked up afresh in
 * whichever node is current. Upstream's comment on it is a request for smart
 * pointers; the handle is what it has instead.
 */
import { PnsHole } from './pns_hole.js';
import { PnsKind, PnsLinkedItem, type PnsItem, type PnsViaLike } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { NetHandle } from './pns_collision.js';
import type { PcbVia, UnconnectedLayerMode } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `VIATYPE`, as this repo already spells it on a board via. */
export type PnsViaType = PcbVia['kind'];

/** `VIA::STACK_MODE`. */
export enum ViaStackMode {
  /** The via is the same size on every layer. */
  NORMAL = 0,
  /**
   * Three sizes. "Front" means `layers().start()` and "back" means
   * `layers().end()`, which does *not* line up with KiCad's front and back for a
   * blind or buried via — this mode only makes sense for a via through the
   * whole board.
   */
  FRONT_INNER_BACK = 1,
  /** A different size on each layer. */
  CUSTOM = 2,
}

/** `VIA_HANDLE`: a via identified without a pointer. */
export interface ViaHandle {
  valid: boolean;
  pos: Vec2;
  layers: PnsLayerRange;
  net: NetHandle;
}

/** `VIA`. */
export class PnsVia extends PnsLinkedItem implements PnsViaLike {
  static readonly ALL_LAYERS = 0;
  static readonly INNER_LAYERS = 1;

  private mStackMode: ViaStackMode = ViaStackMode.NORMAL;
  /** 1..n diameters, depending on the stack mode. */
  private mDiameters = new Map<number, number>();
  private mShapes = new Map<number, { c: Vec2; r: number }>();
  private mDrill: number;
  private mPos: Vec2;
  private mViaType: PnsViaType = 'through';
  private mUnconnectedLayerMode: UnconnectedLayerMode = 'keep_all';
  private mIsFree = false;
  private mHole: PnsHole | null = null;
  private mHoleLayers: PnsLayerRange = new PnsLayerRange();
  private mSecondaryHoleLayers: PnsLayerRange | null = null;
  private mSecondaryDrill: number | null = null;

  /**
   * With no arguments this is upstream's default constructor, dummy values and
   * all: diameter 2, drill 1, and — importantly — an *empty* shape map, so
   * `shape()` answers null until a diameter is set.
   */
  constructor(
    aPos?: Vec2,
    aLayers?: PnsLayerRange,
    aDiameter?: number,
    aDrill?: number,
    aNet: NetHandle = null,
    aViaType: PnsViaType = 'through',
  ) {
    super(PnsKind.VIA_T);

    if (aPos === undefined) {
      this.mPos = { x: 0, y: 0 };
      this.mDiameters.set(PnsVia.ALL_LAYERS, 2); // dummy value
      this.mDrill = 1; // dummy value
      this.setHoleLayers(new PnsLayerRange());
      this.setHole(
        PnsHole.makeCircularHole(this.mPos, Math.trunc(this.mDrill / 2), new PnsLayerRange()),
      );
      return;
    }

    this.setNet(aNet);
    if (aLayers) this.setLayers(aLayers);
    this.mPos = { x: aPos.x, y: aPos.y };
    this.mDiameters.set(PnsVia.ALL_LAYERS, aDiameter ?? 2);
    this.mDrill = aDrill ?? 1;
    this.mShapes.set(PnsVia.ALL_LAYERS, {
      c: { ...this.mPos },
      r: Math.trunc((aDiameter ?? 2) / 2),
    });
    this.setHoleLayers(aLayers ?? new PnsLayerRange());
    this.setHole(
      PnsHole.makeCircularHole(this.mPos, Math.trunc(this.mDrill / 2), new PnsLayerRange()),
    );
    this.mViaType = aViaType;
  }

  static classOf(aItem: PnsItem | null): boolean {
    return aItem !== null && aItem.kind() === PnsKind.VIA_T;
  }

  stackMode(): ViaStackMode {
    return this.mStackMode;
  }

  setStackMode(aStackMode: ViaStackMode): void {
    this.mStackMode = aStackMode;
    // Upstream asserts FRONT_INNER_BACK implies layers().start() == 0, and notes
    // that housekeeping on the diameter/shape maps might be wanted here but that
    // it is not yet clear the mode is ever changed after construction.
  }

  /** Which padstack slot a board layer's shape and diameter are stored under. */
  effectiveLayer(aLayer: number): number {
    switch (this.mStackMode) {
      case ViaStackMode.FRONT_INNER_BACK: {
        if (aLayer === this.mLayers.start() || aLayer === this.mLayers.end()) return aLayer;

        if (this.mLayers.start() + 1 < this.mLayers.end()) return this.mLayers.start() + 1;

        return this.mLayers.start();
      }

      case ViaStackMode.CUSTOM:
        return this.mLayers.overlaps(aLayer) ? aLayer : this.mLayers.start();

      default:
        return PnsVia.ALL_LAYERS;
    }
  }

  override uniqueShapeLayers(): number[] {
    switch (this.mStackMode) {
      case ViaStackMode.FRONT_INNER_BACK:
        return [PnsVia.ALL_LAYERS, PnsVia.INNER_LAYERS, this.mLayers.end()];

      case ViaStackMode.CUSTOM: {
        const ret: number[] = [];

        for (let l = this.mLayers.start(); l <= this.mLayers.end(); l++) ret.push(l);

        return ret;
      }

      default:
        return [PnsVia.ALL_LAYERS];
    }
  }

  override hasUniqueShapeLayers(): boolean {
    return true;
  }

  pos(): Vec2 {
    return this.mPos;
  }

  setPos(aPos: Vec2): void {
    this.mPos = { x: aPos.x, y: aPos.y };

    for (const [layer, shape] of this.mShapes) {
      this.mShapes.set(layer, { c: { ...this.mPos }, r: shape.r });
    }

    if (this.mHole) this.mHole.setCenter(this.mPos);
  }

  viaType(): PnsViaType {
    return this.mViaType;
  }

  setViaType(aViaType: PnsViaType): void {
    this.mViaType = aViaType;
  }

  unconnectedLayerMode(): UnconnectedLayerMode {
    return this.mUnconnectedLayerMode;
  }

  setUnconnectedLayerMode(aMode: UnconnectedLayerMode): void {
    this.mUnconnectedLayerMode = aMode;
  }

  /** A `start_end_only` via has copper on its two end layers and nowhere else. */
  connectsLayer(aLayer: number): boolean {
    if (this.mUnconnectedLayerMode === 'start_end_only') {
      return aLayer === this.mLayers.start() || aLayer === this.mLayers.end();
    }

    return this.mLayers.overlaps(aLayer);
  }

  /** Upstream falls back to the first stored diameter when the slot is absent. */
  diameter(aLayer: number): number {
    const layer = this.effectiveLayer(aLayer);
    const d = this.mDiameters.get(layer);

    if (d !== undefined) return d;

    const first = this.mDiameters.values().next();

    if (first.done) throw new Error('PNS: VIA::Diameter() with no diameters at all');

    return first.value;
  }

  setDiameter(aLayer: number, aDiameter: number): void {
    const layer = this.effectiveLayer(aLayer);
    this.mDiameters.set(layer, aDiameter);

    const existing = this.mShapes.get(layer);

    if (!existing) this.mShapes.set(layer, { c: { ...this.mPos }, r: Math.trunc(aDiameter / 2) });
    else this.mShapes.set(layer, { c: existing.c, r: Math.trunc(aDiameter / 2) });
  }

  /**
   * Do two vias have the same padstack? Same slots, same diameter in each.
   *
   * Upstream's `std::equal` walks only *this* via's slot list against the
   * other's, so a longer list on the other side is never looked at; the length
   * check below is the same comparison written so it cannot read past the end.
   */
  padstackMatches(aOther: PnsViaLike): boolean {
    const other = aOther as PnsVia;
    const myLayers = this.uniqueShapeLayers();
    const otherLayers = other.uniqueShapeLayers();

    if (otherLayers.length < myLayers.length) return false;

    for (let i = 0; i < myLayers.length; i++) {
      if (myLayers[i] !== otherLayers[i]) return false;
    }

    for (const i of myLayers) {
      if (this.diameter(i) !== other.diameter(i)) return false;
    }

    return true;
  }

  drill(): number {
    return this.mDrill;
  }

  setDrill(aDrill: number): void {
    this.mDrill = aDrill;

    if (this.mHole) this.mHole.setRadius(Math.trunc(this.mDrill / 2));
  }

  setHoleLayers(aLayers: PnsLayerRange): void {
    this.mHoleLayers = aLayers.clone();

    if (this.mHole) this.mHole.setLayers(this.mHoleLayers);
  }

  holeLayers(): PnsLayerRange {
    return this.mHoleLayers;
  }

  setSecondaryDrill(aDrill: number | null): void {
    this.mSecondaryDrill = aDrill;
  }

  secondaryDrill(): number | null {
    return this.mSecondaryDrill;
  }

  setSecondaryHoleLayers(aLayers: PnsLayerRange | null): void {
    this.mSecondaryHoleLayers = aLayers;
  }

  secondaryHoleLayers(): PnsLayerRange | null {
    return this.mSecondaryHoleLayers;
  }

  isFree(): boolean {
    return this.mIsFree;
  }

  setIsFree(aIsFree: boolean): void {
    this.mIsFree = aIsFree;
  }

  /** Null when the padstack has no shape in the slot the layer maps to. */
  override shape(aLayer: number): Shape | null {
    const layer = this.effectiveLayer(aLayer);
    const s = this.mShapes.get(layer);

    if (!s) return null;

    return { kind: 'circle', c: s.c, r: s.r };
  }

  /**
   * Upstream's `Clone()` builds a default via and assigns the fields one by
   * one, and — unlike `ARC::Clone` — it *does* carry the uid across, with its
   * own `fixme: oop` next to the line.
   *
   * The hole is not shared: a fresh circular one is built from the drill, which
   * also means a clone loses any non-circular or offset hole the original had.
   */
  clone(): PnsVia {
    const v = new PnsVia();

    v.mUid = this.mUid;
    v.mParent = this.mParent;
    v.mSourceItem = this.mSourceItem;

    v.setNet(this.net());
    v.setLayers(this.layers());
    v.mMovable = this.mMovable;
    v.mPos = { ...this.mPos };
    v.mStackMode = this.mStackMode;
    v.mDiameters = new Map(this.mDiameters);
    v.mDrill = this.mDrill;

    v.mShapes = new Map();
    for (const [layer, shape] of this.mShapes) {
      v.mShapes.set(layer, { c: { ...v.mPos }, r: shape.r });
    }

    v.setHoleLayers(this.mHoleLayers);
    v.mUnconnectedLayerMode = this.mUnconnectedLayerMode;
    v.mSecondaryHoleLayers = this.mSecondaryHoleLayers;
    v.mSecondaryDrill = this.mSecondaryDrill;
    v.setHole(
      PnsHole.makeCircularHole(this.mPos, Math.trunc(this.mDrill / 2), new PnsLayerRange()),
    );
    v.mRank = this.mRank;
    v.mMarker = this.mMarker;
    v.mRoutable = this.mRoutable;
    v.mViaType = this.mViaType;
    v.mIsFree = this.mIsFree;
    v.mIsVirtual = this.mIsVirtual;

    return v;
  }

  /** A via has one anchor, its centre, whatever index is asked for. */
  override anchor(_n: number): Vec2 {
    return this.mPos;
  }

  override anchorCount(): number {
    return 1;
  }

  makeHandle(): ViaHandle {
    return { pos: this.pos(), layers: this.layers(), net: this.net(), valid: true };
  }

  override setHole(aHole: PnsItem | null): void {
    this.mHole = aHole as PnsHole | null;

    if (this.mHole) {
      this.mHole.setParentPadVia(this);
      this.mHole.setOwner(this);
      this.mHole.setLayers(this.mHoleLayers);
    }
  }

  override hasHole(): boolean {
    return true;
  }

  override hole(): PnsHole | null {
    return this.mHole;
  }
}

/**
 * `VVIA`: a via the router invents, not one the board has.
 *
 * `NODE::FixupVirtualVias` drops one at every joint where a track changes width
 * or a locked segment ends, so that the shove algorithm has something with a
 * *position* to push on where otherwise there would only be two segments
 * meeting. It is virtual, so it never collides with anything, and it has no
 * hole — despite `VIA`'s constructor having built one, which the overridden
 * `hasHole` then hides. Upstream's arrangement, kept: the hole is still there,
 * still owned, and simply never reported.
 */
export class PnsVVia extends PnsVia {
  constructor(aPos: Vec2, aLayer: number, aDiameter: number, aNet: NetHandle) {
    super(aPos, new PnsLayerRange(aLayer, aLayer), aDiameter, Math.trunc(aDiameter / 2), aNet);
    this.mIsVirtual = true;
  }

  override hasHole(): boolean {
    return false;
  }
}
