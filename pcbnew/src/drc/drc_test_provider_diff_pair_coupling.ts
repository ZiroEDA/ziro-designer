// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_diff_pair_coupling.cpp`.
 *
 * Differential pair gap/coupling test.
 * Errors generated:
 * - DRCE_DIFF_PAIR_GAP_OUT_OF_RANGE
 * - DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG
 * - DRCE_TOO_MANY_VIAS
 */
import { ADVANCED_CFG } from '@ziroeda/common/src/advanced_config.js';
import { type PCB_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/src/reporter.js';
import type { MINOPTMAX } from '@ziroeda/core/src/minoptmax.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { KiROUND, rescale64 } from '@ziroeda/kimath/src/math/util.js';
import {
  add,
  EuclideanNorm,
  SquaredEuclideanNorm,
  sub,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import { PCB_GENERATOR } from '../pcb_generator.js';
import { type PCB_ARC, PCB_TRACK } from '../pcb_track.js';
import { DRC_ENGINE } from './drc_engine.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T, type DRC_RULE } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';
import { ptrOrdinal } from './ptr_order.js';

/** `rescale<int64_t>( a, b, d )`: exact in BigInt, the products pass 2^53. */
const rescaleI64 = (a: number, b: number, d: number): number =>
  Number(rescale64(BigInt(a), BigInt(b), BigInt(d)));

function commonParallelProjectionSeg(p: SEG, n: SEG, pClip: SEG, nClip: SEG): boolean {
  const n_proj_p = new SEG(p.LineProject(n.A), p.LineProject(n.B));

  let t_a = 0;
  let t_b = p.TCoef(p.B);

  let tproj_a = p.TCoef(n_proj_p.A);
  let tproj_b = p.TCoef(n_proj_p.B);

  if (t_b < t_a) [t_b, t_a] = [t_a, t_b];

  if (tproj_b < tproj_a) [tproj_b, tproj_a] = [tproj_a, tproj_b];

  if (t_b <= tproj_a) return false;

  if (t_a >= tproj_b) return false;

  const tv: number[] = [0, p.TCoef(p.B), p.TCoef(n_proj_p.A), p.TCoef(n_proj_p.B)];
  tv.sort((a, b) => a - b); // fixme: awful and disgusting way of finding 2 midpoints

  const pLenSq = p.SquaredLength();

  const dp = sub(p.B, p.A);
  pClip.A = {
    x: p.A.x + rescaleI64(dp.x, tv[1]!, pLenSq),
    y: p.A.y + rescaleI64(dp.y, tv[1]!, pLenSq),
  };

  pClip.B = {
    x: p.A.x + rescaleI64(dp.x, tv[2]!, pLenSq),
    y: p.A.y + rescaleI64(dp.y, tv[2]!, pLenSq),
  };

  nClip.A = n.LineProject(pClip.A);
  nClip.B = n.LineProject(pClip.B);

  return true;
}

function commonParallelProjectionArc(
  p: PCB_ARC,
  n: PCB_ARC,
  aOut: { pClip: SHAPE_ARC; nClip: SHAPE_ARC },
): boolean {
  const p_center = p.GetCenter();
  const n_center = n.GetCenter();
  const p_radius = p.GetRadius();
  const n_radius = n.GetRadius();
  const p_is_ccw = p.IsCCW();
  const n_is_ccw = n.IsCCW();

  // Quick check to ensure arcs are of similar size and close enough to be considered coupled
  const radiusDiffRatio = Math.abs(p_radius - n_radius) / Math.max(p_radius, n_radius);
  const centerDistance = EuclideanNorm(sub(p_center, n_center));

  if (radiusDiffRatio > 0.5 || centerDistance > Math.max(p_radius, n_radius) * 0.5) return false;

  let p_start = p.GetStart();
  let p_end = p.GetEnd();

  if (!p_is_ccw) [p_start, p_end] = [p_end, p_start];

  let n_start = n.GetStart();
  let n_end = n.GetEnd();

  if (!n_is_ccw) [n_start, n_end] = [n_end, n_start];

  const p_arc = new SHAPE_ARC(p_start, p.GetMid(), p_end, 0);
  const n_arc = new SHAPE_ARC(n_start, n.GetMid(), n_end, 0);

  const p_start_angle = p_arc.GetStartAngle();

  // Rotate the arcs to a common 0 starting angle
  p_arc.Rotate(p_start_angle, p_center);
  n_arc.Rotate(p_start_angle, n_center);

  const p_end_angle = p_arc.GetEndAngle();
  const n_start_angle = n_arc.GetStartAngle();
  const n_end_angle = n_arc.GetEndAngle();

  // Determine overlap region
  let clip_start_angle: EDA_ANGLE;
  let clip_end_angle: EDA_ANGLE;

  // No overlap when n starts after p ends or n ends before p starts
  if (n_start_angle.ge(p_end_angle) || n_end_angle.le(new EDA_ANGLE(0))) return false;

  // Calculate the start and end angles of the overlap
  clip_start_angle = new EDA_ANGLE(0).lt(n_start_angle) ? n_start_angle : new EDA_ANGLE(0);
  clip_end_angle = n_end_angle.lt(p_end_angle) ? n_end_angle : p_end_angle;

  // Calculate the total angle of the overlap
  const clip_total_angle = clip_end_angle.sub(clip_start_angle);

  // Now we reset the angles.  However, note that the convention here for adding angles
  // is OPPOSITE the Rotate convention above.  So this undoes the rotation.
  clip_start_angle = clip_start_angle.add(p_start_angle);
  clip_end_angle = clip_end_angle.add(p_start_angle);
  clip_start_angle.Normalize();
  clip_end_angle.Normalize();

  // One arc starts approximately where the other ends or overlap is too small
  if (clip_total_angle.le(new EDA_ANGLE(ADVANCED_CFG.GetCfg().m_MinParallelAngle))) return false;

  // For CCW arcs, we start at clip_start_angle and sweep through clip_total_angle
  // For CW arcs, we start at clip_end_angle and sweep through -clip_total_angle
  let p_clip_point: VECTOR2I;
  let n_clip_point: VECTOR2I;

  if (p_is_ccw) {
    p_clip_point = add(p_center, {
      x: KiROUND(p_radius * clip_start_angle.Cos()),
      y: KiROUND(p_radius * clip_start_angle.Sin()),
    });
    aOut.pClip = new SHAPE_ARC(p_center, p_clip_point, clip_total_angle);
  } else {
    p_clip_point = add(p_center, {
      x: KiROUND(p_radius * clip_end_angle.Cos()),
      y: KiROUND(p_radius * clip_end_angle.Sin()),
    });
    aOut.pClip = new SHAPE_ARC(p_center, p_clip_point, clip_total_angle.negate());
  }

  if (n_is_ccw) {
    n_clip_point = add(n_center, {
      x: KiROUND(n_radius * clip_start_angle.Cos()),
      y: KiROUND(n_radius * clip_start_angle.Sin()),
    });
    aOut.nClip = new SHAPE_ARC(n_center, n_clip_point, clip_total_angle);
  } else {
    n_clip_point = add(n_center, {
      x: KiROUND(n_radius * clip_end_angle.Cos()),
      y: KiROUND(n_radius * clip_end_angle.Sin()),
    });
    aOut.nClip = new SHAPE_ARC(n_center, n_clip_point, clip_total_angle.negate());
  }

  // Ensure the resulting arcs are not degenerate
  if (aOut.pClip.GetLength() < 1.0 || aOut.nClip.GetLength() < 1.0) return false;

  return true;
}

class DIFF_PAIR_KEY {
  netP = 0;
  netN = 0;
  gapRuleName = '';
  uncoupledRuleName = '';
  gapConstraint: MINOPTMAX | null = null;
  gapRule: DRC_RULE | null = null;
  uncoupledConstraint: MINOPTMAX | null = null;
  uncoupledRule: DRC_RULE | null = null;

  /** `operator<`, as a comparator for the `std::map`'s ordering. */
  static compare(a: DIFF_PAIR_KEY, b: DIFF_PAIR_KEY): number {
    if (a.netP < b.netP) return -1;
    else if (a.netP > b.netP) return 1;
    // netP == b.netP
    else if (a.netN < b.netN) return -1;
    else if (a.netN > b.netN) return 1;
    else if (a.gapRuleName === '') return a.gapRuleName < b.gapRuleName ? -1 : 0;
    else
      return a.uncoupledRuleName < b.uncoupledRuleName
        ? -1
        : b.uncoupledRuleName < a.uncoupledRuleName
          ? 1
          : 0;
  }

  /** Two keys the `std::map` treats as one: neither orders before the other. */
  static equivalent(a: DIFF_PAIR_KEY, b: DIFF_PAIR_KEY): boolean {
    return DIFF_PAIR_KEY.compare(a, b) === 0 && DIFF_PAIR_KEY.compare(b, a) === 0;
  }
}

class DIFF_PAIR_COUPLED_SEGMENTS {
  coupledN = new SEG();
  coupledP = new SEG();
  isArc = false;
  coupledArcN = new SHAPE_ARC();
  coupledArcP = new SHAPE_ARC();
  parentN: PCB_TRACK | null = null;
  parentP: PCB_TRACK | null = null;
  computedGap = 0;
  nearestN: VECTOR2I = { x: 0, y: 0 };
  nearestP: VECTOR2I = { x: 0, y: 0 };
  layer: PCB_LAYER_ID = UNDEFINED_LAYER;
  couplingFailMin = false;
  couplingFailMax = false;
}

class DIFF_PAIR_ITEMS {
  /** `std::set<BOARD_CONNECTED_ITEM*>`: kept in pointer order. */
  itemsP: BOARD_CONNECTED_ITEM[] = [];
  itemsN: BOARD_CONNECTED_ITEM[] = [];
  coupled: DIFF_PAIR_COUPLED_SEGMENTS[] = [];
  totalCoupled = 0;
  totalLengthN = 0;
  totalLengthP = 0;
}

/** `std::set<BOARD_CONNECTED_ITEM*>::insert`: in pointer order, once. */
function setInsert(aSet: BOARD_CONNECTED_ITEM[], aItem: BOARD_CONNECTED_ITEM): boolean {
  if (aSet.includes(aItem)) return false;

  aSet.push(aItem);
  aSet.sort((a, b) => ptrOrdinal(a) - ptrOrdinal(b));
  return true;
}

function isInTuningPattern(aItem: BOARD_ITEM): boolean {
  const parent = aItem.GetParentGroup();

  if (parent) {
    if (parent instanceof PCB_GENERATOR) {
      const generator = parent;

      if (generator.GetGeneratorType() === 'tuning_pattern') return true;
    }
  }

  return false;
}

function extractDiffPairCoupledItems(aDp: DIFF_PAIR_ITEMS): void {
  for (const itemP of aDp.itemsP) {
    if (!itemP || itemP.Type() !== KICAD_T.PCB_TRACE_T || isInTuningPattern(itemP)) continue;

    const sp = itemP as PCB_TRACK;
    const coupled_vec: DIFF_PAIR_COUPLED_SEGMENTS[] = [];

    for (const itemN of aDp.itemsN) {
      if (!itemN || itemN.Type() !== KICAD_T.PCB_TRACE_T || isInTuningPattern(itemN)) continue;

      const sn = itemN as PCB_TRACK;

      if (sn.GetLayerSet().and(sp.GetLayerSet()).none()) continue;

      const ssp = new SEG(sp.GetStart(), sp.GetEnd());
      const ssn = new SEG(sn.GetStart(), sn.GetEnd());

      // Segments that are ~ 1 IU in length per side are approximately parallel (tolerance is 1 IU)
      // with everything and their parallel projection is < 1 IU, leading to bad distance calculations
      if (ssp.SquaredLength() > 2 && ssn.SquaredLength() > 2 && !ssp.Intersect(ssn, false, true)) {
        const cpair = new DIFF_PAIR_COUPLED_SEGMENTS();
        const coupled = commonParallelProjectionSeg(ssp, ssn, cpair.coupledP, cpair.coupledN);

        if (coupled) {
          cpair.parentP = sp;
          cpair.parentN = sn;
          cpair.layer = sp.GetLayer();
          const distSq = { value: 0 };
          cpair.coupledP.NearestPoints(cpair.coupledN, cpair.nearestP, cpair.nearestN, distSq);
          cpair.computedGap = Math.trunc(Math.sqrt(distSq.value)); // NearestPoints returns squared distance
          cpair.computedGap -= Math.trunc((sp.GetWidth() + sn.GetWidth()) / 2);
          coupled_vec.push(cpair);
        }
      }
    }

    for (const coupled of coupled_vec) {
      const excludeSelf = (aItem: BOARD_ITEM): boolean => {
        if (aItem === coupled.parentN || aItem === coupled.parentP) return false;

        if (
          aItem.Type() === KICAD_T.PCB_TRACE_T ||
          aItem.Type() === KICAD_T.PCB_VIA_T ||
          aItem.Type() === KICAD_T.PCB_ARC_T
        ) {
          const bci = aItem as PCB_TRACK;

          // Directly connected items don't count
          if (
            bci.HitTest(coupled.coupledN.A, 0) ||
            bci.HitTest(coupled.coupledN.B, 0) ||
            bci.HitTest(coupled.coupledP.A, 0) ||
            bci.HitTest(coupled.coupledP.B, 0)
          ) {
            return false;
          }
        } else if (aItem.Type() === KICAD_T.PCB_PAD_T) {
          const pad = aItem as PAD;

          const trackExitsPad = (track: PCB_TRACK): boolean => {
            const startIn = pad.HitTest(track.GetStart(), 0);
            const endIn = pad.HitTest(track.GetEnd(), 0);

            return startIn !== endIn;
          };

          if (trackExitsPad(coupled.parentP!) || trackExitsPad(coupled.parentN!)) return false;
        }

        return true;
      };

      const checkSeg = new SHAPE_SEGMENT(coupled.nearestN, coupled.nearestP);
      const tree = coupled.parentP!.GetBoard()!.m_CopperItemRTreeCache!;

      // check if there's anything in between the segments suspected to be coupled. If
      // there's nothing, assume they are really coupled.

      if (!tree.CheckColliding(checkSeg, sp.GetLayer(), 0, excludeSelf)) aDp.coupled.push(coupled);
    }
  }

  for (const itemP of aDp.itemsP) {
    if (!itemP || itemP.Type() !== KICAD_T.PCB_ARC_T || isInTuningPattern(itemP)) continue;

    const sp = itemP as PCB_ARC;
    const coupled_vec: DIFF_PAIR_COUPLED_SEGMENTS[] = [];

    for (const itemN of aDp.itemsN) {
      if (!itemN || itemN.Type() !== KICAD_T.PCB_ARC_T || isInTuningPattern(itemN)) continue;

      const sn = itemN as PCB_ARC;

      if (sn.GetLayerSet().and(sp.GetLayerSet()).none()) continue;

      // Segments that are ~ 1 IU in length per side are approximately parallel (tolerance is 1 IU)
      // with everything and their parallel projection is < 1 IU, leading to bad distance calculations
      const sqWidth = sp.GetWidth() * sp.GetWidth();

      if (
        sp.GetLength() > 2 &&
        sn.GetLength() > 2 &&
        SquaredEuclideanNorm(sub(sp.GetCenter(), sn.GetCenter())) < sqWidth
      ) {
        const cpair = new DIFF_PAIR_COUPLED_SEGMENTS();
        cpair.isArc = true;
        const clips = { pClip: cpair.coupledArcP, nClip: cpair.coupledArcN };
        const coupled = commonParallelProjectionArc(sp, sn, clips);
        cpair.coupledArcP = clips.pClip;
        cpair.coupledArcN = clips.nClip;

        if (coupled) {
          cpair.parentP = sp;
          cpair.parentN = sn;
          cpair.layer = sp.GetLayer();
          const distSq = { value: 0 };
          cpair.coupledArcP.NearestPoints(
            cpair.coupledArcN,
            cpair.nearestP,
            cpair.nearestN,
            distSq,
          );
          cpair.computedGap = Math.trunc(Math.sqrt(distSq.value)); // NearestPoints returns squared distance
          cpair.computedGap -= Math.trunc((sp.GetWidth() + sn.GetWidth()) / 2);
          coupled_vec.push(cpair);
        }
      }
    }

    for (const coupled of coupled_vec) {
      const excludeSelf = (aItem: BOARD_ITEM): boolean => {
        if (aItem === coupled.parentN || aItem === coupled.parentP) return false;

        if (
          aItem.Type() === KICAD_T.PCB_TRACE_T ||
          aItem.Type() === KICAD_T.PCB_VIA_T ||
          aItem.Type() === KICAD_T.PCB_ARC_T
        ) {
          const bci = aItem as BOARD_CONNECTED_ITEM;

          if (
            bci.GetNetCode() === coupled.parentN!.GetNetCode() ||
            bci.GetNetCode() === coupled.parentP!.GetNetCode()
          ) {
            return false;
          }
        } else if (aItem.Type() === KICAD_T.PCB_PAD_T) {
          const pad = aItem as PAD;

          const arcExitsPad = (arc: PCB_ARC): boolean => {
            const startIn = pad.HitTest(arc.GetStart(), 0);
            const endIn = pad.HitTest(arc.GetEnd(), 0);

            return startIn !== endIn;
          };

          if (arcExitsPad(coupled.parentP as PCB_ARC) || arcExitsPad(coupled.parentN as PCB_ARC))
            return false;
        }

        return true;
      };

      const checkArcMid = new SHAPE_SEGMENT(
        coupled.coupledArcN.GetArcMid(),
        coupled.coupledArcP.GetArcMid(),
      );
      const tree = coupled.parentP!.GetBoard()!.m_CopperItemRTreeCache!;

      // check if there's anything in between the segments suspected to be coupled. If
      // there's nothing, assume they are really coupled.

      if (!tree.CheckColliding(checkArcMid, sp.GetLayer(), 0, excludeSelf))
        aDp.coupled.push(coupled);
    }
  }
}

export class DRC_TEST_PROVIDER_DIFF_PAIR_COUPLING extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'diff_pair_coupling';
  }

  Run(): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();
    const m_board: BOARD = this.m_board!;

    const epsilon = m_board.GetDesignSettings().GetDRCEpsilon();
    const boardCopperLayers = LSET.AllCuMask(m_board.GetCopperLayerCount());

    /** `std::map<DIFF_PAIR_KEY, DIFF_PAIR_ITEMS>`: kept sorted by `DIFF_PAIR_KEY::operator<`. */
    const dpRuleMatches: { key: DIFF_PAIR_KEY; items: DIFF_PAIR_ITEMS }[] = [];

    const matchesFor = (key: DIFF_PAIR_KEY): DIFF_PAIR_ITEMS => {
      for (const entry of dpRuleMatches) {
        if (DIFF_PAIR_KEY.equivalent(entry.key, key)) return entry.items;
      }

      const items = new DIFF_PAIR_ITEMS();
      dpRuleMatches.push({ key, items });
      dpRuleMatches.sort((a, b) => DIFF_PAIR_KEY.compare(a.key, b.key));
      return items;
    };

    const evaluateDpConstraints = (item: BOARD_ITEM): boolean => {
      const key = new DIFF_PAIR_KEY();
      const citem = item as BOARD_CONNECTED_ITEM;
      const refNet = citem.GetNet();

      const dp = refNet ? DRC_ENGINE.IsNetADiffPair(m_board, refNet) : null;

      if (refNet && dp) {
        key.netP = dp.netP;
        key.netN = dp.netN;

        for (const constraintType of [
          DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT,
          DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT,
        ]) {
          const constraint = this.m_drcEngine!.EvalRules(
            constraintType,
            item,
            null,
            item.GetLayer(),
          );

          if (constraint.IsNull() || constraint.GetSeverity() === RPT_SEVERITY_IGNORE) continue;

          const parentRule = constraint.GetParentRule();
          const ruleName = parentRule ? parentRule.m_Name : constraint.GetName();

          switch (constraintType) {
            case DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT:
              key.gapConstraint = constraint.GetValue();
              key.gapRule = parentRule;
              key.gapRuleName = ruleName;
              break;

            case DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT:
              key.uncoupledConstraint = constraint.GetValue();
              key.uncoupledRule = parentRule;
              key.uncoupledRuleName = ruleName;
              break;

            default:
              break;
          }

          // `dpRuleMatches[key]` looks the key up by its ordering; a later
          // constraint changing the rule names finds (or makes) another entry.
          const snapshot = new DIFF_PAIR_KEY();
          Object.assign(snapshot, key);

          if (refNet.GetNetCode() === key.netN) setInsert(matchesFor(snapshot).itemsN, citem);
          else setInsert(matchesFor(snapshot).itemsP, citem);
        }
      }

      return true;
    };

    m_board.GetConnectivity().GetFromToCache().Rebuild(m_board);

    this.forEachGeometryItem(
      [KICAD_T.PCB_TRACE_T, KICAD_T.PCB_VIA_T, KICAD_T.PCB_ARC_T],
      boardCopperLayers,
      evaluateDpConstraints,
    );

    this.REPORT_AUX('DPs evaluated:');

    for (const { key, items: itemSet } of dpRuleMatches) {
      const niP = m_board.GetNetInfo().GetNetItem(key.netP);
      const niN = m_board.GetNetInfo().GetNetItem(key.netN);

      console.assert(niP !== null);
      console.assert(niN !== null);

      const nameP = niP!.GetNetname();
      const nameN = niN!.GetNetname();

      this.REPORT_AUX(`Rule '${key.gapRuleName}', DP: (+) ${nameP} - (-) ${nameN}`);

      extractDiffPairCoupledItems(itemSet);

      itemSet.totalCoupled = 0;
      itemSet.totalLengthN = 0;
      itemSet.totalLengthP = 0;

      const allItems = new Set<BOARD_CONNECTED_ITEM>();

      for (const item of itemSet.itemsN) {
        if (item instanceof PCB_TRACK) {
          const track = item;

          if (isInTuningPattern(track)) continue;

          if (!allItems.has(item)) {
            allItems.add(item);
            itemSet.totalLengthN += Math.trunc(track.GetLength());
          }
        }
      }

      for (const item of itemSet.itemsP) {
        if (item instanceof PCB_TRACK) {
          const track = item;

          if (isInTuningPattern(track)) continue;

          if (!allItems.has(item)) {
            allItems.add(item);
            itemSet.totalLengthP += Math.trunc(track.GetLength());
          }
        }
      }

      for (const dp of itemSet.coupled) {
        const length = Math.trunc(dp.isArc ? dp.coupledArcN.GetLength() : dp.coupledN.Length());

        if (!(dp.parentN && dp.parentP)) continue; // wxCHECK2

        // m_drcEngine->GetDebugOverlay(): the debug overlay is not ported.

        if (key.gapConstraint) {
          if (
            key.gapConstraint.HasMin() &&
            key.gapConstraint.Min() >= 0 &&
            dp.computedGap < key.gapConstraint.Min() - epsilon
          ) {
            dp.couplingFailMin = true;
          }

          if (
            key.gapConstraint.HasMax() &&
            key.gapConstraint.Max() >= 0 &&
            dp.computedGap > key.gapConstraint.Max() + epsilon
          ) {
            dp.couplingFailMax = true;
          }
        }

        if (!dp.couplingFailMin && !dp.couplingFailMax) itemSet.totalCoupled += length;
      }

      const totalLen = Math.max(itemSet.totalLengthN, itemSet.totalLengthP);

      this.REPORT_AUX(
        `   - coupled length: ${this.MessageTextFromValue(itemSet.totalCoupled)}, total length: ${this.MessageTextFromValue(totalLen)}`,
      );

      const totalUncoupled = totalLen - itemSet.totalCoupled;
      let uncoupledViolation = false;

      if (key.uncoupledConstraint && (itemSet.itemsP.length > 0 || itemSet.itemsN.length > 0)) {
        const val = key.uncoupledConstraint;

        if (val.HasMax() && val.Max() >= 0 && totalUncoupled > val.Max()) {
          const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG)!;
          drce.SetErrorDetail(
            this.formatMsg(
              '(%s maximum uncoupled length %s; actual %s)',
              key.uncoupledRuleName,
              val.Max(),
              totalUncoupled,
            ),
          );

          let item: BOARD_CONNECTED_ITEM | null = null;
          let p_it = 0;
          let n_it = 0;

          if (p_it < itemSet.itemsP.length) {
            item = itemSet.itemsP[p_it]!;
            drce.AddItem(itemSet.itemsP[p_it]!);
            p_it++;
          }

          if (n_it < itemSet.itemsN.length) {
            item = itemSet.itemsN[n_it]!;
            drce.AddItem(itemSet.itemsN[n_it]!);
            n_it++;
          }

          while (p_it < itemSet.itemsP.length) drce.AddItem(itemSet.itemsP[p_it++]!);

          while (n_it < itemSet.itemsN.length) drce.AddItem(itemSet.itemsN[n_it++]!);

          uncoupledViolation = true;

          drce.SetViolatingRule(key.uncoupledRule);

          this.reportViolation(drce, item!.GetPosition(), item!.GetLayer());
        }
      }

      if (key.gapConstraint && (uncoupledViolation || !key.uncoupledConstraint)) {
        for (const dp of itemSet.coupled) {
          if (!(dp.parentP && dp.parentN)) continue; // wxCHECK2

          if (dp.couplingFailMin || dp.couplingFailMax) {
            // We have a candidate violation, now we need to re-query for a constraint
            // given the actual items, because there may be a location-based rule in play.
            const constraint = this.m_drcEngine!.EvalRules(
              DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT,
              dp.parentP,
              dp.parentN,
              dp.parentP.GetLayer(),
            );
            const val = constraint.GetValue();

            if (!val.HasMin() || val.Min() < 0 || dp.computedGap >= val.Min())
              dp.couplingFailMin = false;

            if (!val.HasMax() || val.Max() < 0 || dp.computedGap <= val.Max())
              dp.couplingFailMax = false;

            if (!dp.couplingFailMin && !dp.couplingFailMax) continue;

            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DIFF_PAIR_GAP_OUT_OF_RANGE)!;

            if (dp.couplingFailMin) {
              drcItem.SetErrorDetail(
                this.formatMsg(
                  '(%s minimum gap %s; actual %s)',
                  key.gapRuleName,
                  val.Min(),
                  dp.computedGap,
                ),
              );
            } else if (dp.couplingFailMax) {
              drcItem.SetErrorDetail(
                this.formatMsg(
                  '(%s maximum gap %s; actual %s)',
                  key.gapRuleName,
                  val.Max(),
                  dp.computedGap,
                ),
              );
            }

            drcItem.SetViolatingRule(key.gapRule);

            let item: BOARD_CONNECTED_ITEM | null = null;

            if (dp.parentP) {
              item = dp.parentP;
              drcItem.AddItem(dp.parentP);
            }

            if (dp.parentN) {
              item = dp.parentN;
              drcItem.AddItem(dp.parentN);
            }

            if (item) this.reportViolation(drcItem, item.GetFocusPosition(), item.GetLayer());
          }
        }
      }
    }

    return true;
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_DIFF_PAIR_COUPLING);
