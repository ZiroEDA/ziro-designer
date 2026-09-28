// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_interactive_courtyard_clearance.{h,cpp}`.
 *
 * Not DRC proper: the live courtyard feedback `EDIT_TOOL::doMoveSelection`
 * (and the router's footprint drag) runs on every frame of a move. Colliding
 * footprints (and the rule areas that forbid them) get `COURTYARD_CONFLICT`;
 * the painter shades their courtyards on `LAYER_CONFLICTS_SHADOW`.
 */
import { COURTYARD_CONFLICT } from '@ziroeda/common/eda_item_flags.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import type { DRC_ENGINE } from './drc_engine.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_INTERACTIVE_COURTYARD_CLEARANCE extends DRC_TEST_PROVIDER {
  /** The list of moved footprints. */
  m_FpInMove: FOOTPRINT[] = [];

  private m_largestCourtyardClearance = 0;
  /** The list of items in conflict (a std::set: insertion-unique). */
  private m_itemsInConflict = new Set<BOARD_ITEM>();
  /** The list of items last highlighted. */
  private m_lastItemsInConflict: BOARD_ITEM[] = [];

  constructor(aDRCEngine: DRC_ENGINE) {
    super();
    this.m_isRuleDriven = false;
    this.SetDRCEngine(aDRCEngine);
  }

  override GetName(): string {
    return 'interactive_courtyard_clearance';
  }

  private testCourtyardClearances(): void {
    const board = this.m_board!;
    const fpBBBoxes: BOX2I[] = new Array(this.m_FpInMove.length);
    const movingBBox = new BOX2I();

    for (let i = 0; i < this.m_FpInMove.length; i++) {
      const fpB = this.m_FpInMove[i]!;

      const bbox = fpB.GetBoundingBox(true);
      movingBBox.Merge(bbox);
      fpBBBoxes[i] = bbox;
    }

    movingBBox.Inflate(this.m_largestCourtyardClearance);

    for (const fpA of board.Footprints()) {
      if (fpA.IsSelected()) continue;

      const fpABBox = fpA.GetBoundingBox(true);

      if (!movingBBox.Intersects(fpABBox)) continue;

      const frontA = fpA.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
      const backA = fpA.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

      // No courtyards defined and no hole testing against other footprint's courtyards
      if (frontA.OutlineCount() === 0 && backA.OutlineCount() === 0) continue;

      const frontABBox = frontA.BBoxFromCaches();
      const backABBox = backA.BBoxFromCaches();

      frontABBox.Inflate(this.m_largestCourtyardClearance);
      backABBox.Inflate(this.m_largestCourtyardClearance);

      for (let inMoveId = 0; inMoveId < this.m_FpInMove.length; inMoveId++) {
        const fpB = this.m_FpInMove[inMoveId]!;
        const frontB = fpB.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
        const backB = fpB.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

        const fpBBBox = fpBBBoxes[inMoveId]!;
        const frontBBBox = frontB.BBoxFromCaches();
        const backBBBox = backB.BBoxFromCaches();

        let clearance: number;
        const actual = { value: 0 };
        const pos: VECTOR2I = { x: 0, y: 0 };

        if (
          frontA.OutlineCount() > 0 &&
          frontB.OutlineCount() > 0 &&
          frontABBox.Intersects(frontBBBox)
        ) {
          // Currently, do not use DRC engine for calculation time reasons
          clearance = 0;

          if (frontA.Collide(frontB, clearance, actual, pos)) {
            this.m_itemsInConflict.add(fpA);
            this.m_itemsInConflict.add(fpB);
          }
        }

        if (
          backA.OutlineCount() > 0 &&
          backB.OutlineCount() > 0 &&
          backABBox.Intersects(backBBBox)
        ) {
          // Currently, do not use DRC engine for calculation time reasons
          clearance = 0;

          if (backA.Collide(backB, clearance, actual, pos)) {
            this.m_itemsInConflict.add(fpA);
            this.m_itemsInConflict.add(fpB);
          }
        }

        // Now test if a pad hole of some other footprint is inside the courtyard area
        // of the moved footprint
        const testPadAgainstCourtyards = (pad: PAD, footprint: FOOTPRINT): boolean => {
          if (pad.HasHole()) {
            const hole = pad.GetEffectiveHoleShape()!;
            const front = footprint.GetCachedCourtyard(PCB_LAYER_ID.F_CrtYd);
            const back = footprint.GetCachedCourtyard(PCB_LAYER_ID.B_CrtYd);

            if (front.OutlineCount() > 0 && front.Collide(hole, 0)) return true;
            else if (back.OutlineCount() > 0 && back.Collide(hole, 0)) return true;
          }

          return false;
        };

        let skipNextCmp = false;

        if (
          (frontA.OutlineCount() > 0 && frontABBox.Intersects(fpBBBox)) ||
          (backA.OutlineCount() > 0 && backABBox.Intersects(fpBBBox))
        ) {
          for (const padB of fpB.Pads()) {
            if (testPadAgainstCourtyards(padB, fpA)) {
              this.m_itemsInConflict.add(fpA);
              this.m_itemsInConflict.add(fpB);
              skipNextCmp = true;
              break;
            }
          }
        }

        if (skipNextCmp) continue; // fpA and fpB are already in list

        if (
          (frontB.OutlineCount() > 0 && frontBBBox.Intersects(fpABBox)) ||
          (backB.OutlineCount() > 0 && backBBBox.Intersects(fpABBox))
        ) {
          for (const padA of fpA.Pads()) {
            if (testPadAgainstCourtyards(padA, fpB)) {
              this.m_itemsInConflict.add(fpA);
              this.m_itemsInConflict.add(fpB);
              break;
            }
          }
        }
      }
    }

    for (const zone of board.Zones()) {
      if (
        !zone.GetIsRuleArea() ||
        !zone.HasKeepoutParametersSet() ||
        !zone.GetDoNotAllowFootprints()
      ) {
        continue;
      }

      const disallowFront = zone.GetLayerSet().and(LSET.FrontMask()).any();
      const disallowBack = zone.GetLayerSet().and(LSET.BackMask()).any();

      for (const fp of this.m_FpInMove) {
        if (disallowFront) {
          const frontCourtyard = fp.GetCourtyard(PCB_LAYER_ID.F_CrtYd);

          if (!frontCourtyard.IsEmpty()) {
            if (zone.Outline().Collide(frontCourtyard.Outline(0))) {
              this.m_itemsInConflict.add(fp);
              this.m_itemsInConflict.add(zone);
              break;
            }
          }
        }

        if (disallowBack) {
          const backCourtyard = fp.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

          if (!backCourtyard.IsEmpty()) {
            if (zone.Outline().Collide(backCourtyard.Outline(0))) {
              this.m_itemsInConflict.add(fp);
              this.m_itemsInConflict.add(zone);
              break;
            }
          }
        }
      }
    }
  }

  Init(aBoard: BOARD): void {
    this.m_board = aBoard;

    // Update courtyard data and clear the COURTYARD_CONFLICT flag
    for (const fp of this.m_board.Footprints()) {
      fp.ClearFlags(COURTYARD_CONFLICT);
      fp.BuildCourtyardCaches();
    }
  }

  Run(): boolean {
    this.m_itemsInConflict.clear();
    this.m_largestCourtyardClearance = 0;

    const constraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
    );

    if (constraint) this.m_largestCourtyardClearance = constraint.GetValue().Min();

    this.testCourtyardClearances();

    return true;
  }

  UpdateConflicts(aView: VIEW, aHighlightMoved: boolean): void {
    // Ensure the "old" conflicts are cleared
    for (const item of this.m_lastItemsInConflict) {
      item.ClearFlags(COURTYARD_CONFLICT);
      aView.Update(item);
      aView.MarkTargetDirty(RENDER_TARGET.TARGET_OVERLAY);
    }

    this.m_lastItemsInConflict = [];

    for (const item of this.m_itemsInConflict) {
      if (aHighlightMoved || !this.m_FpInMove.includes(item as FOOTPRINT)) {
        if (!item.HasFlag(COURTYARD_CONFLICT)) {
          item.SetFlags(COURTYARD_CONFLICT);
          aView.Update(item);
          aView.MarkTargetDirty(RENDER_TARGET.TARGET_OVERLAY);
        }

        this.m_lastItemsInConflict.push(item);
      }
    }
  }

  ClearConflicts(aView: VIEW): void {
    for (const item of this.m_lastItemsInConflict) {
      item.ClearFlags(COURTYARD_CONFLICT);
      aView.Update(item);
      aView.MarkTargetDirty(RENDER_TARGET.TARGET_OVERLAY);
    }
  }
}
