// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_silk_clearance.cpp`.
 *
 * Silk to silk clearance test. Check all silkscreen features against each other.
 * Errors generated:
 * - DRCE_SILK_CLEARANCE
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_BOARD_OUTLINE } from '../pcb_board_outline.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { ATOMIC_TABLES, DRC_RTREE, type ITEM_WITH_SHAPE, type LAYER_PAIR } from './drc_rtree.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_SILK_CLEARANCE extends DRC_TEST_PROVIDER {
  private m_largestClearance = 0;

  override GetName(): string {
    return 'silk_clearance';
  }

  Run(): boolean {
    const progressDelta = 500;

    this.m_board = this.m_drcEngine!.GetBoard();

    // If the soldermask min width is greater than 0 then we must use a healing algorithm to generate
    // a whole-board soldermask poly, and then test against that.  However, that can't deal well with
    // DRC exclusions (as any change anywhere on the board that affects the soldermask will null the
    // associated exclusions), so we only use that when soldermask min width is > 0.
    const checkIndividualMaskItems = this.m_board!.GetDesignSettings().m_SolderMaskMinWidth <= 0;

    if (
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SILK_CLEARANCE) &&
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE)
    ) {
      return true; // continue with other tests
    }

    this.m_largestClearance = 0;

    const worstClearanceConstraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT,
    );

    if (worstClearanceConstraint) this.m_largestClearance = worstClearanceConstraint.m_Value.Min();

    if (!this.reportPhase('Checking silkscreen for overlapping items...')) return false; // DRC cancelled

    const silkTree = new DRC_RTREE();
    const targetTree = new DRC_RTREE();
    let ii = 0;
    let items = 0;
    const silkLayers = new LSET([PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS]);
    const targetLayers = LSET.FrontMask()
      .or(LSET.BackMask())
      .or(new LSET([PCB_LAYER_ID.Edge_Cuts, PCB_LAYER_ID.Margin]));

    const countItems = (): boolean => {
      ++items;
      return true;
    };

    const addToSilkTree = (item: BOARD_ITEM): boolean => {
      if (!this.reportProgress(ii++, items, progressDelta)) return false;

      for (const layer of [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS]) {
        if (item.IsOnLayer(layer)) silkTree.Insert(item, layer, undefined, 0, ATOMIC_TABLES);
      }

      return true;
    };

    const addToTargetTree = (item: BOARD_ITEM): boolean => {
      if (!this.reportProgress(ii++, items, progressDelta)) return false;

      for (const layer of item.GetLayerSet().and(targetLayers))
        targetTree.Insert(item, layer, undefined, 0, ATOMIC_TABLES);

      return true;
    };

    this.forEachGeometryItem(DRC_TEST_PROVIDER.s_allBasicItems, silkLayers, countItems);
    this.forEachGeometryItem(DRC_TEST_PROVIDER.s_allBasicItems, targetLayers, countItems);

    this.forEachGeometryItem(DRC_TEST_PROVIDER.s_allBasicItems, silkLayers, addToSilkTree);
    this.forEachGeometryItem(DRC_TEST_PROVIDER.s_allBasicItems, targetLayers, addToTargetTree);

    this.REPORT_AUX(
      `Testing ${silkTree.size()} silkscreen features against ${targetTree.size()} board items.`,
    );

    // Cache the board-outline bounding box and per-subshape collision results so that each
    // subshape is only tested against the outline once during the visitor sweep.  Without
    // caching, QueryCollidingPairs invokes the visitor O(silk * target) times and the outline
    // Collide (which walks the outline's triangulation) was dominating DRC runtime on boards
    // with many silkscreen/mask polygons (see issue 24007).
    let boardOutline: PCB_BOARD_OUTLINE | null = this.m_board!.BoardOutline();
    let outlineBBox = new BOX2I();

    if (boardOutline && !boardOutline.HasOutline()) boardOutline = null;

    if (boardOutline) outlineBBox = boardOutline.GetOutline().BBoxFromCaches();

    const outlineCollisionCache = new Map<SHAPE, boolean>();

    const layerPairs: readonly LAYER_PAIR[] = [
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_SilkS],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_Mask],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_Adhes],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_Paste],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_CrtYd],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_Fab],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_Cu],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.Edge_Cuts],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.Margin],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.B_SilkS],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.B_Mask],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.B_Adhes],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.B_Paste],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.B_CrtYd],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.B_Fab],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.B_Cu],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.Edge_Cuts],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.Margin],
    ];

    targetTree.QueryCollidingPairs(
      silkTree,
      layerPairs,
      (
        aLayers: LAYER_PAIR,
        aRefItemShape: ITEM_WITH_SHAPE,
        aTestItemShape: ITEM_WITH_SHAPE,
        aCollisionDetected: { value: boolean },
      ): boolean => {
        let refItem: BOARD_ITEM = aRefItemShape.parent;
        let refShape: SHAPE = aRefItemShape.shape;
        let testItem: BOARD_ITEM = aTestItemShape.parent;
        let testShape: SHAPE = aTestItemShape.shape;

        let hole: SHAPE | null = null;

        if (
          this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SILK_CLEARANCE) &&
          this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE)
        ) {
          return false;
        }

        if (this.isInvisibleText(refItem) || this.isInvisibleText(testItem)) return true;

        if (testItem.IsTented(aLayers[0])) {
          if (testItem.HasHole()) {
            hole = testItem.GetEffectiveHoleShape();
            testShape = hole!;
          } else {
            return true;
          }
        }

        if (boardOutline) {
          if (!testItem.GetBoundingBox().Intersects(outlineBBox)) return true;

          // Only cache for shapes owned by the R-tree (stable pointers).  Hole
          // shapes are freshly created per visitor call via shared_ptr, so their
          // raw addresses cannot be safely used as cache keys.
          let collidesOutline: boolean;

          if (testShape === aTestItemShape.shape) {
            let cached = outlineCollisionCache.get(testShape);

            if (cached === undefined) {
              cached = testShape.Collide(boardOutline.GetOutline());
              outlineCollisionCache.set(testShape, cached);
            }

            collidesOutline = cached;
          } else {
            collidesOutline = testShape.Collide(boardOutline.GetOutline());
          }

          if (!collidesOutline) return true;
        }

        let errorCode: PCB_DRC_CODE = PCB_DRC_CODE.DRCE_SILK_CLEARANCE;
        const constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT,
          refItem,
          testItem,
          aLayers[1],
        );
        let minClearance = -1;

        if (!constraint.IsNull() && constraint.GetSeverity() !== RPT_SEVERITY_IGNORE)
          minClearance = constraint.GetValue().Min();

        if (aLayers[1] === PCB_LAYER_ID.F_Mask || aLayers[1] === PCB_LAYER_ID.B_Mask) {
          if (checkIndividualMaskItems) minClearance = Math.max(minClearance, 0);

          errorCode = PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE;
        }

        if (minClearance < 0 || this.m_drcEngine!.IsErrorLimitExceeded(errorCode)) return true;

        const actual = { value: 0 };
        const pos: VECTOR2I = { x: 0, y: 0 };

        // Graphics are often compound shapes so ignore collisions between shapes in a
        // single footprint or on the board (both parent footprints will be nullptr).
        if (
          refItem.Type() === KICAD_T.PCB_SHAPE_T &&
          testItem.Type() === KICAD_T.PCB_SHAPE_T &&
          refItem.GetParentFootprint() === testItem.GetParentFootprint()
        ) {
          return true;
        }

        // Collide (and generate violations) based on a well-defined order so that
        // exclusion checking against previously-generated violations will work.
        if (aLayers[0] === aLayers[1]) {
          if (refItem.m_Uuid > testItem.m_Uuid) {
            [refItem, testItem] = [testItem, refItem];
            [refShape, testShape] = [testShape, refShape];
          }
        }

        if (refShape.Collide(testShape, minClearance, actual, pos)) {
          const drcItem = DRC_ITEM.Create(errorCode)!;

          if (minClearance > 0) {
            drcItem.SetErrorDetail(
              this.formatMsg(
                '(%s clearance %s; actual %s)',
                constraint.GetName(),
                minClearance,
                actual.value,
              ),
            );
          }

          drcItem.SetItems(refItem, testItem);
          drcItem.SetViolatingRule(constraint.GetParentRule());
          this.reportTwoShapeGeometry(drcItem, pos, refShape, testShape, aLayers[1], actual.value);
          aCollisionDetected.value = true;
        }

        return true;
      },
      this.m_largestClearance,
      (aCount: number, aSize: number): boolean => {
        return this.reportProgress(aCount, aSize, progressDelta);
      },
    );

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_SILK_CLEARANCE);
