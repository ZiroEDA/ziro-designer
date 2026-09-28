// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_rtree.h`: an R-tree for fast spatial and layer indexing of
 * connectable items. Non-owning.
 */
import { LSET } from '@ziroeda/common/lset.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { type OutInt, type SHAPE, SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_NULL } from '@ziroeda/kimath/src/geometry/shape_null.js';
import { SHAPE_POLY_SET, type TRI } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_FIELD } from '../pcb_field.js';

export const ATOMIC_TABLES = true;

/** `std::numeric_limits<int>` bounds of the int-typed tree. */
const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

export class ITEM_WITH_SHAPE {
  parent: BOARD_ITEM;
  shape: SHAPE;
  shapeStorage: SHAPE | null;
  parentShape: SHAPE | null;

  constructor(
    aParent: BOARD_ITEM,
    aShape: SHAPE,
    aParentShape: SHAPE | null = null,
    aOwned = false,
  ) {
    this.parent = aParent;
    this.shape = aShape;
    this.shapeStorage = aOwned ? aShape : null;
    this.parentShape = aParentShape;
  }
}

type drc_rtree = RTree<ITEM_WITH_SHAPE>;

export type LAYER_PAIR = [PCB_LAYER_ID, PCB_LAYER_ID];

export interface PAIR_INFO {
  layerPair: LAYER_PAIR;
  refItem: ITEM_WITH_SHAPE;
  testItem: ITEM_WITH_SHAPE;
}

/**
 * The DRC_LAYER struct provides a layer-specific auto-range iterator to the RTree.  Using
 * this struct, one can write lines like:
 *
 * for( auto item : rtree.OnLayer( In1_Cu ) )
 *
 * and iterate over only the RTree items that are on In1
 */
export class DRC_LAYER implements Iterable<ITEM_WITH_SHAPE> {
  m_min: number[];
  m_max: number[];
  layer_tree: drc_rtree | null;

  constructor(aTree: drc_rtree | null, aRect?: BOX2I) {
    this.layer_tree = aTree;

    if (aRect) {
      this.m_min = [aRect.GetX(), aRect.GetY()];
      this.m_max = [aRect.GetRight(), aRect.GetBottom()];
    } else {
      this.m_min = [INT_MIN, INT_MIN];
      this.m_max = [INT_MAX, INT_MAX];
    }
  }

  *[Symbol.iterator](): IterableIterator<ITEM_WITH_SHAPE> {
    if (!this.layer_tree) return;

    yield* this.layer_tree.Iterate(this.m_min, this.m_max);
  }
}

export class DRC_RTREE {
  private m_tree = new Map<number, drc_rtree>();
  private m_count = 0;

  constructor() {
    for (const layer of LSET.AllLayersMask()) this.m_tree.set(layer, new RTree<ITEM_WITH_SHAPE>(2));

    this.m_count = 0;
  }

  /**
   * Insert an item into the tree on a particular layer with a worst clearance.  Allows the
   * source layer to be different from the tree layer.
   */
  Insert(
    aItem: BOARD_ITEM,
    aRefLayer: PCB_LAYER_ID,
    aTargetLayer?: PCB_LAYER_ID | number,
    aWorstClearance = 0,
    aAtomicTables = false,
  ): void {
    // Insert( aItem, aLayer, aWorstClearance, aAtomicTables )
    if (aTargetLayer === undefined) {
      this.Insert(aItem, aRefLayer, aRefLayer, aWorstClearance, aAtomicTables);
      return;
    }

    const targetLayer = aTargetLayer as PCB_LAYER_ID;

    if (targetLayer === -1) {
      console.assert(false, 'aTargetLayer != UNDEFINED_LAYER');
      return;
    }

    if (aItem.Type() === KICAD_T.PCB_FIELD_T && !(aItem as PCB_FIELD).IsVisible()) return;

    let parent = aItem;

    if (aAtomicTables && aItem.Type() === KICAD_T.PCB_TABLECELL_T)
      parent = aItem.GetParent() as BOARD_ITEM;

    const subshapes: SHAPE[] = [];
    const shape = aItem.GetEffectiveShape(aRefLayer);

    if (!shape) {
      console.assert(false, 'Item does not have a valid shape for this layer');
      return;
    }

    if (shape.HasIndexableSubshapes()) shape.GetIndexableSubshapes(subshapes);
    else subshapes.push(shape);

    for (const subshape of subshapes) {
      if (subshape instanceof SHAPE_NULL) continue;

      const bbox = subshape.BBox();
      bbox.Inflate(aWorstClearance);

      const mmin = [bbox.GetX(), bbox.GetY()];
      const mmax = [bbox.GetRight(), bbox.GetBottom()];
      const itemShape = new ITEM_WITH_SHAPE(parent, subshape, shape);

      this.m_tree.get(targetLayer)!.Insert(mmin, mmax, itemShape);
      this.m_count++;
    }

    if (aItem.Type() === KICAD_T.PCB_PAD_T && aItem.HasHole()) {
      const hole = aItem.GetEffectiveHoleShape()!;
      const bbox = hole.BBox();
      bbox.Inflate(aWorstClearance);

      const mmin = [bbox.GetX(), bbox.GetY()];
      const mmax = [bbox.GetRight(), bbox.GetBottom()];
      const itemShape = new ITEM_WITH_SHAPE(parent, hole, shape, true);

      this.m_tree.get(targetLayer)!.Insert(mmin, mmax, itemShape);
      this.m_count++;
    }
  }

  /**
   * Remove all items from the RTree.
   */
  clear(): void {
    for (const [, tree] of this.m_tree) tree.RemoveAll();

    this.m_count = 0;
  }

  CheckColliding(
    aRefShape: SHAPE,
    aTargetLayer: PCB_LAYER_ID,
    aClearance = 0,
    aFilter: ((aItem: BOARD_ITEM) => boolean) | null = null,
  ): boolean {
    const box = aRefShape.BBox();
    box.Inflate(aClearance);

    const min = [box.GetX(), box.GetY()];
    const max = [box.GetRight(), box.GetBottom()];

    let count = 0;

    const visit = (aItem: ITEM_WITH_SHAPE): boolean => {
      if (!aFilter || aFilter(aItem.parent)) {
        const actual: OutInt = { value: 0 };

        if (aRefShape.Collide(aItem.shape, aClearance, actual)) {
          count++;
          return false;
        }
      }

      return true;
    };

    const it = this.m_tree.get(aTargetLayer);
    if (it) it.Search(min, max, visit);

    return count > 0;
  }

  /**
   * This is a fast test which essentially does bounding-box overlap given a worst-case
   * clearance.  It's used when looking up the specific item-to-item clearance might be
   * expensive and should be deferred till we know we have a possible hit.
   */
  QueryCollidingItem(
    aRefItem: BOARD_ITEM,
    aRefLayer: PCB_LAYER_ID,
    aTargetLayer: PCB_LAYER_ID,
    aFilter: ((aItem: BOARD_ITEM) => boolean) | null = null,
    aVisitor: ((aItem: BOARD_ITEM) => boolean) | null = null,
    aClearance = 0,
  ): number {
    // keep track of BOARD_ITEMs that have already been found to collide (some items might
    // be built of COMPOUND/triangulated shapes and a single subshape collision means we have
    // a hit)
    const collidingCompounds = new Set<BOARD_ITEM>();

    // keep track of results of client filter so we don't ask more than once for compound
    // shapes
    const filterResults = new Map<BOARD_ITEM, boolean>();

    const box = aRefItem.GetBoundingBox();
    box.Inflate(aClearance);

    const min = [box.GetX(), box.GetY()];
    const max = [box.GetRight(), box.GetBottom()];

    const refShape = aRefItem.GetEffectiveShape(aRefLayer);

    let count = 0;

    const visit = (aItem: ITEM_WITH_SHAPE): boolean => {
      if (aItem.parent === aRefItem) return true;

      if (collidingCompounds.has(aItem.parent)) return true;

      let filtered: boolean;
      const it = filterResults.get(aItem.parent);

      if (it === undefined) {
        filtered = aFilter !== null && !aFilter(aItem.parent);
        filterResults.set(aItem.parent, filtered);
      } else {
        filtered = it;
      }

      if (filtered) return true;

      if (!aItem.shape) {
        console.assert(false);
        return false;
      }

      if (refShape.Collide(aItem.shape, aClearance)) {
        collidingCompounds.add(aItem.parent);
        count++;

        if (aVisitor) return aVisitor(aItem.parent);
      }

      return true;
    };

    const it = this.m_tree.get(aTargetLayer);
    if (it) it.Search(min, max, visit);

    return count;
  }

  /**
   * This one is for tessellated items.  (All shapes in the tree will be from a single
   * BOARD_ITEM.)
   * It checks all items in the bbox overlap to find the minimal actual distance and
   * position.
   *
   * Without `aClearance`/`aActual`/`aPos` it is the quicker version that just
   * reports a raw yes/no.
   */
  QueryColliding(aBox: BOX2I, aRefShape: SHAPE, aLayer: PCB_LAYER_ID): boolean;
  QueryColliding(
    aBox: BOX2I,
    aRefShape: SHAPE,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aActual: OutInt | null,
    aPos: { value: VECTOR2I } | null,
  ): boolean;
  QueryColliding(
    aBox: BOX2I,
    aRefShape: SHAPE,
    aLayer: PCB_LAYER_ID,
    aClearance?: number,
    aActual?: OutInt | null,
    aPos?: { value: VECTOR2I } | null,
  ): boolean {
    if (aClearance === undefined) return this.queryCollidingQuick(aBox, aRefShape, aLayer);

    const bbox = new BOX2I(aBox.GetOrigin(), aBox.GetSize());
    bbox.Inflate(aClearance);

    const min = [bbox.GetX(), bbox.GetY()];
    const max = [bbox.GetRight(), bbox.GetBottom()];

    let collision = false;
    let actual = INT_MAX;
    let pos: VECTOR2I = { x: 0, y: 0 };

    const visit = (aItem: ITEM_WITH_SHAPE): boolean => {
      const curActual: OutInt = { value: 0 };
      const curPos: VECTOR2I = { x: 0, y: 0 };

      if (aRefShape.Collide(aItem.shape, aClearance, curActual, curPos)) {
        collision = true;

        if (curActual.value < actual) {
          actual = curActual.value;
          pos = curPos;
        }

        // Stop looking after we have a true collision
        if (actual <= 0) return false;
      }

      return true;
    };

    const it = this.m_tree.get(aLayer);
    if (it) it.Search(min, max, visit);

    if (collision) {
      if (aActual) aActual.value = Math.max(0, actual);

      if (aPos) aPos.value = pos;

      return true;
    }

    return false;
  }

  /**
   * Quicker version of above that just reports a raw yes/no.
   */
  private queryCollidingQuick(aBox: BOX2I, aRefShape: SHAPE, aLayer: PCB_LAYER_ID): boolean {
    const poly = aRefShape instanceof SHAPE_POLY_SET ? aRefShape : null;
    const min = [aBox.GetX(), aBox.GetY()];
    const max = [aBox.GetRight(), aBox.GetBottom()];
    let collision = false;

    // Special case the polygon case.  Otherwise we'll call its Collide() method which will
    // triangulate it as well and then do triangle/triangle collisions.  This ends up being
    // *much* slower than 3 segment Collide()s and a PointInside().
    const polyVisitor = (aItem: ITEM_WITH_SHAPE): boolean => {
      const shape = aItem.shape;

      // There are certain degenerate cases that result in empty zone fills, which
      // will be represented in the rtree with only a root (and no triangles).
      // https://gitlab.com/kicad/code/kicad/-/issues/18600
      if (shape.Type() !== SHAPE_TYPE.SH_POLY_SET_TRIANGLE) return true;

      const tri = shape as TRI;
      const outline = poly!.Outline(0);

      for (let ii = 0; ii < tri.GetSegmentCount(); ++ii) {
        if (outline.Collide(tri.GetSegment(ii))) {
          collision = true;
          return false;
        }
      }

      // Also must check for poly being completely inside the triangle
      if (tri.PointInside(outline.CPoint(0))) {
        collision = true;
        return false;
      }

      return true;
    };

    const visitor = (aItem: ITEM_WITH_SHAPE): boolean => {
      if (aRefShape.Collide(aItem.shape, 0)) {
        collision = true;
        return false;
      }

      return true;
    };

    const it = this.m_tree.get(aLayer);

    if (!it) return false;

    if (poly && poly.OutlineCount() === 1 && poly.HoleCount(0) === 0)
      it.Search(min, max, polyVisitor);
    else it.Search(min, max, visitor);

    return collision;
  }

  /**
   * Gets the BOARD_ITEMs that overlap the specified point/layer
   * @param aPt Position on the tree
   * @param aLayer Layer to search
   * @return vector of overlapping BOARD_ITEMS*
   */
  GetObjectsAt(aPt: VECTOR2I, aLayer: PCB_LAYER_ID, aClearance = 0): Set<BOARD_ITEM> {
    const retval = new Set<BOARD_ITEM>();

    const min = [aPt.x - aClearance, aPt.y - aClearance];
    const max = [aPt.x + aClearance, aPt.y + aClearance];

    const visitor = (aItem: ITEM_WITH_SHAPE): boolean => {
      retval.add(aItem.parent);
      return true;
    };

    // m_tree[aLayer]: operator[] creates the layer's tree
    let tree = this.m_tree.get(aLayer);
    if (!tree) {
      tree = new RTree<ITEM_WITH_SHAPE>(2);
      this.m_tree.set(aLayer, tree);
    }
    tree.Search(min, max, visitor);

    return retval;
  }

  QueryCollidingPairs(
    aRefTree: DRC_RTREE,
    aLayerPairs: readonly LAYER_PAIR[],
    aVisitor: (
      aLayers: LAYER_PAIR,
      aRef: ITEM_WITH_SHAPE,
      aTest: ITEM_WITH_SHAPE,
      aCollision: { value: boolean },
    ) => boolean,
    aMaxClearance: number,
    aProgressReporter: (aDone: number, aCount: number) => boolean,
  ): number {
    const pairsToVisit: PAIR_INFO[] = [];

    for (const layerPair of aLayerPairs) {
      const refLayer = layerPair[0];
      const targetLayer = layerPair[1];

      for (const refItem of aRefTree.OnLayer(refLayer)) {
        const box = refItem.shape.BBox();
        box.Inflate(aMaxClearance);

        const min = [box.GetX(), box.GetY()];
        const max = [box.GetRight(), box.GetBottom()];

        const visit = (aItemToTest: ITEM_WITH_SHAPE): boolean => {
          // don't collide items against themselves
          if (aItemToTest.parent === refItem.parent) return true;

          pairsToVisit.push({ layerPair, refItem, testItem: aItemToTest });
          return true;
        };

        const it = this.m_tree.get(targetLayer);

        if (it) it.Search(min, max, visit);
      }
    }

    // keep track of BOARD_ITEMs pairs that have been already found to collide (some items
    // might be build of COMPOUND/triangulated shapes and a single subshape collision
    // means we have a hit)
    const collidingCompounds = new Map<BOARD_ITEM, Set<BOARD_ITEM>>();

    let progress = 0;
    const count = pairsToVisit.length;

    for (const pair of pairsToVisit) {
      if (!aProgressReporter(progress++, count)) break;

      let a = pair.refItem.parent;
      let b = pair.testItem.parent;

      // store canonical order so we don't collide in both directions (a:b and b:a):
      // the C++ orders the two pointers; the pair is looked up both ways here.
      if (collidingCompounds.get(b)?.has(a)) {
        const t = a;
        a = b;
        b = t;
      }

      // don't report multiple collisions for compound or triangulated shapes
      if (collidingCompounds.get(a)?.has(b)) continue;

      const collisionDetected = { value: false };

      if (!aVisitor(pair.layerPair, pair.refItem, pair.testItem, collisionDetected)) break;

      if (collisionDetected.value) {
        let set = collidingCompounds.get(a);
        if (!set) {
          set = new Set();
          collidingCompounds.set(a, set);
        }
        set.add(b);
      }
    }

    return 0;
  }

  /**
   * Return the number of items in the tree.
   *
   * @return number of elements in the tree.
   */
  size(): number {
    return this.m_count;
  }

  empty(): boolean {
    return this.m_count === 0;
  }

  OnLayer(aLayer: PCB_LAYER_ID): DRC_LAYER {
    const it = this.m_tree.get(aLayer);
    return it === undefined ? new DRC_LAYER(null) : new DRC_LAYER(it);
  }

  Overlapping(aLayer: PCB_LAYER_ID, aPoint: VECTOR2I, aAccuracy?: number): DRC_LAYER;
  Overlapping(aLayer: PCB_LAYER_ID, aRect: BOX2I): DRC_LAYER;
  Overlapping(aLayer: PCB_LAYER_ID, a: VECTOR2I | BOX2I, aAccuracy = 0): DRC_LAYER {
    const it = this.m_tree.get(aLayer);

    if (a instanceof BOX2I) return it === undefined ? new DRC_LAYER(null) : new DRC_LAYER(it, a);

    const rect = new BOX2I(a, { x: 0, y: 0 });
    rect.Inflate(aAccuracy);

    return it === undefined ? new DRC_LAYER(null) : new DRC_LAYER(it, rect);
  }
}
