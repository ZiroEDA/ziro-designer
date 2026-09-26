// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_connection_width.cpp`.
 *
 * Checks for copper connections that are less than the specified minimum width
 *
 * Errors generated:
 * - DRCE_CONNECTION_WIDTH
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { pcbMmToIU } from '@ziroeda/common/eda_units.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { type Vertex, VertexSet } from '@ziroeda/kimath/src/geometry/vertex_set.js';
import { add, divideI, EuclideanNormI, sub } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

/** `NETCODE_LAYER_CACHE_KEY`, as the string the `unordered_map` is keyed by here. */
const netcodeLayerKey = (aNetcode: number, aLayer: PCB_LAYER_ID): string => `${aNetcode}:${aLayer}`;

export class POLYGON_TEST extends VertexSet {
  private readonly m_limit: number;
  /** `std::set<std::pair<int, int>> m_hits`, keyed `first:second`. */
  private readonly m_hits = new Map<string, [number, number]>();

  constructor(aLimit: number) {
    super(0);
    this.m_limit = aLimit;
  }

  FindPairs(aPoly: SHAPE_LINE_CHAIN): boolean {
    this.m_hits.clear();
    this.vertices.length = 0;
    const bbox = aPoly.BBox();
    this.setBoundingBox({
      x: bbox.GetX(),
      y: bbox.GetY(),
      width: bbox.GetWidth(),
      height: bbox.GetHeight(),
    });

    this.createList(aPoly.CPoints());

    this.vertices[0]!.updateList();

    let p: Vertex = this.vertices[0]!.next;
    const all_hits = new Set<Vertex>();

    while (p !== this.vertices[0]) {
      // Only run the expensive search if we don't already have a match for the point
      const match: Vertex | null = all_hits.size === 0 || !all_hits.has(p) ? this.getKink(p) : null;

      if (match !== null) {
        const key = `${p.i}:${match.i}`;

        if (!all_hits.has(match) && !this.m_hits.has(key)) {
          this.m_hits.set(key, [p.i, match.i]);
          all_hits.add(p);
          all_hits.add(match);
          all_hits.add(p.next);
          all_hits.add(p.prev);
          all_hits.add(match.next);
          all_hits.add(match.prev);
        }
      }

      p = p.next;
    }

    return this.m_hits.size > 0;
  }

  /** The `std::set` iterates its pairs in order; sorted here on the way out. */
  GetVertices(): [number, number][] {
    return [...this.m_hits.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  /**
   * Checks to see if there is a "substantial" protrusion in each polygon produced by the cut from
   * aA to aB.  Substantial in this case means that the polygon bulges out to a wider cross-section
   * than the distance from aA to aB
   * @param aA Starting point in the polygon
   * @param aB Ending point in the polygon
   * @return True if the two polygons are both "substantial"
   */
  isSubstantial(aA: Vertex, aB: Vertex): boolean {
    let x_change = false;
    let y_change = false;

    // This is a failsafe in case of invalid lists.  Never check
    // more than the total number of points in m_vertices
    let checked = 0;
    const total_pts = this.vertices.length;

    const p0 = aA;
    let p = this.getNextOutlineVertex(p0);

    while (
      !this.samePoint(p, aB) && // We've reached the other inflection point
      !this.samePoint(p, aA) && // We've gone around in a circle
      checked < total_pts && // Fail-safe for invalid lists
      !(x_change && y_change) // We've found a substantial change in both directions
    ) {
      const diff_x = Math.abs(p.x - p0.x);
      const diff_y = Math.abs(p.y - p0.y);

      // Check for a substantial change in the x or y direction
      // This is measured by the set value of the minimum connection width
      if (diff_x > this.m_limit) x_change = true;

      if (diff_y > this.m_limit) y_change = true;

      p = this.getNextOutlineVertex(p);

      ++checked;
    }

    // wxCHECK_MSG( checked < total_pts, false, wxT( "Invalid polygon detected.  Missing points to check" ) );
    if (!(checked < total_pts)) return false;

    if (!this.samePoint(p, aA) && (!x_change || !y_change)) return false;

    p = this.getPrevOutlineVertex(p0);

    x_change = false;
    y_change = false;
    checked = 0;

    while (
      !this.samePoint(p, aB) && // We've reached the other inflection point
      !this.samePoint(p, aA) && // We've gone around in a circle
      checked < total_pts && // Fail-safe for invalid lists
      !(x_change && y_change) // We've found a substantial change in both directions
    ) {
      const diff_x = Math.abs(p.x - p0.x);
      const diff_y = Math.abs(p.y - p0.y);

      // Floating point zeros can have a negative sign, so we need to
      // ensure that only substantive diversions count for a direction
      // change
      if (diff_x > this.m_limit) x_change = true;

      if (diff_y > this.m_limit) y_change = true;

      p = this.getPrevOutlineVertex(p);

      ++checked;
    }

    // wxCHECK_MSG( checked < total_pts, false, wxT( "Invalid polygon detected.  Missing points to check" ) );
    if (!(checked < total_pts)) return false;

    return this.samePoint(p, aA) || (x_change && y_change);
  }

  getKink(aPt: Vertex): Vertex | null {
    // The point needs to be at a concave surface
    if (this.locallyInside(aPt.prev, aPt.next)) return null;

    // z-order range for the current point ± limit bounding box
    const maxZ = this.zOrder(aPt.x + this.m_limit, aPt.y + this.m_limit);
    const minZ = this.zOrder(aPt.x - this.m_limit, aPt.y - this.m_limit);
    const limit2 = SEG.Square(this.m_limit);

    // first look for points in increasing z-order
    let p = aPt.nextZ;
    let min_dist = Number.MAX_VALUE;
    let retval: Vertex | null = null;

    while (p && p.z <= maxZ) {
      const delta_i = Math.abs(p.i - aPt.i);
      const dx = p.x - aPt.x;
      const dy = p.y - aPt.y;
      const dist2 = dx * dx + dy * dy;

      if (
        delta_i > 1 &&
        dist2 < limit2 &&
        dist2 < min_dist &&
        dist2 > 0 &&
        this.locallyInside(p, aPt) &&
        this.isSubstantial(p, aPt) &&
        this.isSubstantial(aPt, p)
      ) {
        min_dist = dist2;
        retval = p;
      }

      p = p.nextZ;
    }

    p = aPt.prevZ;

    while (p && p.z >= minZ) {
      const delta_i = Math.abs(p.i - aPt.i);
      const dx = p.x - aPt.x;
      const dy = p.y - aPt.y;
      const dist2 = dx * dx + dy * dy;

      if (
        delta_i > 1 &&
        dist2 < limit2 &&
        dist2 < min_dist &&
        dist2 > 0 &&
        this.locallyInside(p, aPt) &&
        this.isSubstantial(p, aPt) &&
        this.isSubstantial(aPt, p)
      ) {
        min_dist = dist2;
        retval = p;
      }

      p = p.prevZ;
    }
    return retval;
  }
}

interface ITEMS_POLY {
  Items: Set<BOARD_ITEM>;
  Poly: SHAPE_POLY_SET;
}

export class DRC_TEST_PROVIDER_CONNECTION_WIDTH extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'copper width';
  }

  private layerDesc(aLayer: PCB_LAYER_ID): string {
    return `(${this.m_drcEngine!.GetBoard()!.GetLayerName(aLayer)})`;
  }

  Run(): boolean {
    if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CONNECTION_WIDTH)) {
      this.REPORT_AUX('Connection width violations ignored. Tests not run.');
      return true; // Continue with other tests
    }

    if (!this.reportPhase('Checking nets for minimum connection width...')) return false; // DRC cancelled

    const board = this.m_drcEngine!.GetBoard()!;
    let epsilon = board.GetDesignSettings().GetDRCEpsilon();

    // Zone knockouts can be approximated, and always have extra clearance built in
    epsilon +=
      board.GetDesignSettings().m_MaxError + pcbMmToIU(ADVANCED_CFG.GetCfg().m_ExtraClearance);

    // A neck in a zone fill can be between two knockouts. In this case it will be epsilon smaller
    // on -each- side.
    epsilon *= 2;

    /*
     * Build a set of distinct minWidths specified by various DRC rules.  We'll run a test for
     * each distinct minWidth, and then decide if any copper which failed that minWidth actually
     * was required to abide by it or not.
     */
    const distinctMinWidths = this.m_drcEngine!.QueryDistinctConstraints(
      DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT,
    );

    if (this.m_drcEngine!.IsCancelled()) return false; // DRC cancelled

    const dataset = new Map<
      string,
      { Netcode: number; Layer: PCB_LAYER_ID; itemsPoly: ITEMS_POLY }
    >();
    let done = 1;

    const entry = (aNetcode: number, aLayer: PCB_LAYER_ID): ITEMS_POLY => {
      const key = netcodeLayerKey(aNetcode, aLayer);
      let e = dataset.get(key);

      if (!e) {
        e = {
          Netcode: aNetcode,
          Layer: aLayer,
          itemsPoly: { Items: new Set(), Poly: new SHAPE_POLY_SET() },
        };
        dataset.set(key, e);
      }

      return e.itemsPoly;
    };

    const calc_effort = (items: Set<BOARD_ITEM>, aLayer: PCB_LAYER_ID): number => {
      let effort = 0;

      for (const item of items) {
        if (item.Type() === KICAD_T.PCB_ZONE_T) {
          const zone = item as ZONE;
          effort += zone.GetFilledPolysList(aLayer).FullPointCount();
        } else {
          effort += 4;
        }
      }

      return effort;
    };

    /*
     * For each net, on each layer, build a polygonSet which contains all the copper associated
     * with that net on that layer.
     */
    const build_netlayer_polys = (aNetcode: number, aLayer: PCB_LAYER_ID): number => {
      if (this.m_drcEngine!.IsCancelled()) return 0;

      const itemsPoly = entry(aNetcode, aLayer);

      for (const item of itemsPoly.Items) {
        item.TransformShapeToPolygon(
          itemsPoly.Poly,
          aLayer,
          0,
          ARC_HIGH_DEF,
          ERROR_LOC.ERROR_OUTSIDE,
        );
      }

      itemsPoly.Poly.Fracture();

      done += calc_effort(itemsPoly.Items, aLayer);

      return 1;
    };

    /*
     * Examine all necks in a given polygonSet which fail a given minWidth.
     */
    const min_checker = (
      aItemsPoly: ITEMS_POLY,
      aLayer: PCB_LAYER_ID,
      aMinWidth: number,
    ): number => {
      if (this.m_drcEngine!.IsCancelled()) return 0;

      const testWidth = aMinWidth - epsilon;

      const test = new POLYGON_TEST(testWidth);

      for (let ii = 0; ii < aItemsPoly.Poly.OutlineCount(); ++ii) {
        const chain = aItemsPoly.Poly.COutline(ii);

        test.FindPairs(chain);
        const ret = test.GetVertices();

        for (const pt of ret) {
          /*
           * We've found a neck that fails the given aMinWidth.  We now need to know
           * if the objects the produced the copper at this location are required to
           * abide by said aMinWidth or not.  (If so, we have a violation.)
           *
           * We find the contributingItems by hit-testing at the choke point (the
           * centre point of the neck), and then run the rules engine on those
           * contributingItems.  If the reported constraint matches aMinWidth, then
           * we've got a violation.
           */
          const span = new SEG(chain.CPoint(pt[0]), chain.CPoint(pt[1]));
          const location = divideI(add(span.A, span.B), 2);
          const dist = EuclideanNormI(sub(span.A, span.B));

          const contributingItems: BOARD_ITEM[] = [];

          for (const item of board.m_CopperItemRTreeCache!.GetObjectsAt(
            location,
            aLayer,
            aMinWidth,
          )) {
            if (item.HitTest(location, aMinWidth)) contributingItems.push(item);
          }

          for (const [zone, rtree] of board.m_CopperZoneRTreeCache) {
            if (!rtree) continue;

            const obj_list = rtree.GetObjectsAt(location, aLayer, aMinWidth);

            if (obj_list.size > 0 && zone.HitTestFilledArea(aLayer, location, aMinWidth))
              contributingItems.push(zone);
          }

          if (contributingItems.length > 0) {
            const item1 = contributingItems[0]!;
            const item2 = contributingItems.length > 1 ? contributingItems[1]! : null;
            const c = this.m_drcEngine!.EvalRules(
              DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT,
              item1,
              item2,
              aLayer,
            );

            if (c.Value().Min() === aMinWidth) {
              const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CONNECTION_WIDTH)!;
              let msg: string;

              msg = this.formatMsg(
                '(%s minimum connection width %s; actual %s)',
                c.GetName(),
                c.Value().Min(),
                dist,
              );

              msg += ` ${this.layerDesc(aLayer)}`;

              drcItem.SetErrorDetail(msg);
              drcItem.SetViolatingRule(c.GetParentRule());

              for (const item of contributingItems) drcItem.AddItem(item);

              this.reportTwoPointGeometry(drcItem, location, span.A, span.B, aLayer);
            }
          }
        }
      }

      done += calc_effort(aItemsPoly.Items, aLayer);

      return 1;
    };

    for (const layer of LSET.AllCuMask(board.GetCopperLayerCount())) {
      for (const zone of board.m_DRCCopperZones) {
        if (!zone.GetIsRuleArea() && zone.IsOnLayer(layer))
          entry(zone.GetNetCode(), layer).Items.add(zone);
      }

      for (const track of board.Tracks()) {
        if (track instanceof PCB_VIA) {
          const via = track;

          if (via.FlashLayer(layer as number)) entry(via.GetNetCode(), layer).Items.add(via);
        } else if (track.IsOnLayer(layer)) {
          entry(track.GetNetCode(), layer).Items.add(track);
        }
      }

      for (const fp of board.Footprints()) {
        for (const pad of fp.Pads()) {
          if (pad.FlashLayer(layer as number)) entry(pad.GetNetCode(), layer).Items.add(pad);
        }

        // Footprint zones are also in the m_DRCCopperZones cache
      }
    }

    let total_effort = 0;

    for (const { Layer, itemsPoly } of dataset.values())
      total_effort += calc_effort(itemsPoly.Items, Layer);

    total_effort += Math.max(1, total_effort) * distinctMinWidths.size;

    // The thread pool's futures run to completion here, one after the other,
    // with the progress reported between them as the wait loop would.
    for (const { Netcode, Layer } of dataset.values()) {
      build_netlayer_polys(Netcode, Layer);
      this.reportProgress(done, total_effort);
    }

    for (const { Layer, itemsPoly } of dataset.values()) {
      for (const minWidth of distinctMinWidths) {
        if (minWidth - epsilon <= 0) continue;

        min_checker(itemsPoly, Layer, minWidth);
        this.reportProgress(done, total_effort);
      }
    }

    return true;
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_CONNECTION_WIDTH);
