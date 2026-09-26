// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_physical_clearance.cpp`.
 *
 * Physical clearance tests.
 *
 * Errors generated:
 * - DRCE_PHYSICAL_CLEARANCE
 * - DRCE_PHYSICAL_HOLE_CLEARANCE
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetArcToSegmentCount } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import {
  add,
  divideI,
  EuclideanNormI,
  sub,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { ZONE } from '../zone.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { ATOMIC_TABLES, DRC_RTREE } from './drc_rtree.js';
import { DRC_CONSTRAINT, DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';
import { ptrPairKey } from './ptr_order.js';

/** `UNIMPLEMENTED_FOR( x )`: `wxFAIL_MSG`, a debug assertion; nothing in a release build. */
function UNIMPLEMENTED_FOR(_aName: string): void {}

/** `DEG2RAD` (`trigo.h`). */
const DEG2RAD = (deg: number): number => (deg * Math.PI) / 180.0;

const itemTypes: readonly KICAD_T[] = [
  KICAD_T.PCB_TRACE_T,
  KICAD_T.PCB_ARC_T,
  KICAD_T.PCB_VIA_T,
  KICAD_T.PCB_FOOTPRINT_T,
  KICAD_T.PCB_PAD_T,
  KICAD_T.PCB_SHAPE_T,
  KICAD_T.PCB_FIELD_T,
  KICAD_T.PCB_TEXT_T,
  KICAD_T.PCB_TEXTBOX_T,
  KICAD_T.PCB_TABLE_T,
  KICAD_T.PCB_TABLECELL_T,
  KICAD_T.PCB_DIMENSION_T,
  KICAD_T.PCB_BARCODE_T,
];

const courtyards = (): LSET => new LSET([PCB_LAYER_ID.F_CrtYd, PCB_LAYER_ID.B_CrtYd]);

export class DRC_TEST_PROVIDER_PHYSICAL_CLEARANCE extends DRC_TEST_PROVIDER {
  private readonly m_itemTree = new DRC_RTREE();

  override GetName(): string {
    return 'physical_clearance';
  }

  Run(): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();
    this.m_itemTree.clear();

    const errorMax = this.m_board!.GetDesignSettings().m_MaxError;
    const boardCopperLayers = LSET.AllCuMask(this.m_board!.GetCopperLayerCount());

    if (this.m_board!.m_DRCMaxPhysicalClearance <= 0) {
      this.REPORT_AUX('No physical clearance constraints found. Tests not run.');
      return true; // continue with other tests
    }

    let progressDelta = 250;
    let count = 0;
    let ii = 0;

    if (!this.reportPhase('Gathering physical items...')) return false; // DRC cancelled

    //
    // Generate a count for use in progress reporting.
    //

    this.forEachGeometryItem(itemTypes, LSET.AllLayersMask(), (item: BOARD_ITEM): boolean => {
      if (this.isInvisibleText(item)) return true;

      ++count;
      return true;
    });

    //
    // Generate a BOARD_ITEM RTree.
    //

    this.forEachGeometryItem(itemTypes, LSET.AllLayersMask(), (item: BOARD_ITEM): boolean => {
      if (this.isInvisibleText(item)) return true;

      if (!this.reportProgress(ii++, count, progressDelta)) return false;

      let layers = item.GetLayerSet();

      // Special-case holes and edge-cuts which pierce all physical layers
      if (item.HasHole()) {
        if (layers.Contains(PCB_LAYER_ID.F_Cu)) {
          layers.orAssign(new LSET(LSET.FrontBoardTechMask()).set(PCB_LAYER_ID.F_CrtYd));
        }

        if (layers.Contains(PCB_LAYER_ID.B_Cu)) {
          layers.orAssign(new LSET(LSET.BackBoardTechMask()).set(PCB_LAYER_ID.B_CrtYd));
        }

        if (layers.Contains(PCB_LAYER_ID.F_Cu) && layers.Contains(PCB_LAYER_ID.B_Cu))
          layers.orAssign(boardCopperLayers);
      } else if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        layers = courtyards();
      } else if (item.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) {
        layers.orAssign(LSET.PhysicalLayersMask().or(courtyards()));
      }

      for (const layer of layers) {
        this.m_itemTree.Insert(
          item,
          layer,
          layer,
          this.m_board!.m_DRCMaxPhysicalClearance,
          ATOMIC_TABLES,
        );
      }

      return true;
    });

    /** `std::unordered_map<PTR_PTR_CACHE_KEY, LSET> checkedPairs`, keyed by the pair's ordinals. */
    const checkedPairs = new Map<string, LSET>();
    progressDelta = 100;
    ii = 0;

    //
    // Run clearance checks -between- items.
    //

    if (
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE) ||
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)
    ) {
      if (!this.reportPhase('Checking physical clearances...')) return false; // DRC cancelled

      this.forEachGeometryItem(itemTypes, LSET.AllLayersMask(), (item: BOARD_ITEM): boolean => {
        if (this.isInvisibleText(item)) return true;

        if (!this.reportProgress(ii++, count, progressDelta)) return false;

        let layers = item.GetLayerSet();

        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) layers = courtyards();

        for (const layer of layers) {
          const itemShape = item.GetEffectiveShape(layer);

          this.m_itemTree.QueryCollidingItem(
            item,
            layer,
            layer,
            // Filter:
            (other: BOARD_ITEM): boolean => {
              if (item.Type() === KICAD_T.PCB_TABLECELL_T && item.GetParent() === other)
                return false;

              // store canonical order so we don't collide in both
              // directions (a:b and b:a)
              const key = ptrPairKey(item, other);
              const it = checkedPairs.get(key);

              if (it !== undefined && it.test(layer)) {
                return false;
              } else {
                if (it === undefined) checkedPairs.set(key, new LSET().set(layer));
                else it.set(layer);
                return true;
              }
            },
            // Visitor:
            (other: BOARD_ITEM): boolean => {
              if (this.testItemAgainstItem(item, itemShape, layer, other) > 0) {
                // store canonical order
                const key = ptrPairKey(item, other);

                // Once we record one DRC for error for physical clearance
                // we don't need to record more
                const it = checkedPairs.get(key);

                if (it === undefined) checkedPairs.set(key, new LSET().set());
                else it.set();
              }

              return !this.m_drcEngine!.IsCancelled();
            },
            this.m_board!.m_DRCMaxPhysicalClearance,
          );

          this.testItemAgainstZones(item, layer);
        }

        return true;
      });
    }

    progressDelta = 100;
    count = 0;
    ii = 0;

    //
    // Generate a count for progress reporting.
    //

    this.forEachGeometryItem(
      [KICAD_T.PCB_ZONE_T, KICAD_T.PCB_SHAPE_T],
      boardCopperLayers,
      (item: BOARD_ITEM): boolean => {
        const zone = item instanceof ZONE ? item : null;

        if (zone && zone.GetIsRuleArea()) return true; // Continue with other items

        count += item.GetLayerSet().and(boardCopperLayers).count();

        return true;
      },
    );

    //
    // Run clearance checks -within- polygonal items.
    //

    this.forEachGeometryItem(
      [KICAD_T.PCB_ZONE_T, KICAD_T.PCB_SHAPE_T],
      boardCopperLayers,
      (item: BOARD_ITEM): boolean => {
        const shape = item instanceof PCB_SHAPE ? item : null;
        const zone = item instanceof ZONE ? item : null;

        if (zone && zone.GetIsRuleArea()) return true; // Continue with other items

        for (const layer of item.GetLayerSet()) {
          if (IsCopperLayer(layer)) {
            if (!this.reportProgress(ii++, count, progressDelta)) return false;

            const c = this.m_drcEngine!.EvalRules(
              DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
              item,
              null,
              layer,
            );

            if (shape) {
              switch (shape.GetShape()) {
                case SHAPE_T.POLY:
                  this.testShapeLineChain(
                    shape.GetPolyShape().Outline(0),
                    shape.GetWidth(),
                    layer,
                    item,
                    c,
                  );
                  break;

                case SHAPE_T.BEZIER: {
                  const asPoly = new SHAPE_LINE_CHAIN();

                  shape.RebuildBezierToSegmentsPointsList(errorMax);

                  for (const pt of shape.GetBezierPoints()) asPoly.Append(pt);

                  this.testShapeLineChain(asPoly, shape.GetWidth(), layer, item, c);
                  break;
                }

                case SHAPE_T.ARC: {
                  const asPoly = new SHAPE_LINE_CHAIN();

                  const center = shape.getCenter();
                  const angle = shape.GetArcAngle().negate();
                  const r = shape.GetRadius();
                  const steps = GetArcToSegmentCount(r, errorMax, angle);

                  asPoly.Append(shape.GetStart());

                  for (let step = 1; step <= steps; ++step) {
                    const rotation = angle.multiply(step).divide(steps);
                    let pt = shape.GetStart();

                    pt = RotatePoint(pt, center, rotation);
                    asPoly.Append(pt);
                  }

                  this.testShapeLineChain(asPoly, shape.GetWidth(), layer, item, c);
                  break;
                }

                // Simple shapes can't create self-intersections, and I'm not sure a user
                // would want a report that one side of their rectangle was too close to
                // the other side.
                case SHAPE_T.RECTANGLE:
                case SHAPE_T.SEGMENT:
                case SHAPE_T.CIRCLE:
                  break;

                default:
                  UNIMPLEMENTED_FOR(shape.SHAPE_T_asString());
              }
            }

            if (zone) this.testZoneLayer(zone, layer, c);
          }

          if (this.m_drcEngine!.IsCancelled()) return false;
        }

        return !this.m_drcEngine!.IsCancelled();
      },
    );

    this.m_itemTree.clear();

    return !this.m_drcEngine!.IsCancelled();
  }

  private testShapeLineChain(
    aOutline: SHAPE_LINE_CHAIN,
    aLineWidth: number,
    aLayer: PCB_LAYER_ID,
    aParentItem: BOARD_ITEM,
    aConstraint: DRC_CONSTRAINT,
  ): void {
    // We don't want to collide with neighboring segments forming a curve until the concavity
    // approaches 180 degrees.
    const angleTolerance = DEG2RAD(180.0 - ADVANCED_CFG.GetCfg().m_SliverAngleTolerance);
    const epsilon = this.m_board!.GetDesignSettings().GetDRCEpsilon();
    const count = aOutline.SegmentCount();
    const clearance = aConstraint.GetValue().Min();

    if (aConstraint.GetSeverity() === RPT_SEVERITY_IGNORE || clearance - epsilon <= 0) return;

    // Trigonometry is not cheap; cache seg angles
    const angles: number[] = [];

    const angleDiff = (a: number, b: number): number => {
      if (a > b) [a, b] = [b, a];

      const diff = b - a;

      if (diff > Math.PI) return 2 * Math.PI - diff;
      else return diff;
    };

    for (let ii = 0; ii < count; ++ii) {
      const seg = aOutline.CSegment(ii);

      // NB: don't store angles of really short segments (which could point anywhere)

      if (seg.SquaredLength() > SEG.Square(epsilon * 2)) {
        angles.push(EDA_ANGLE.fromVector(sub(seg.B, seg.A)).AsRadians());
      } else if (ii > 0) {
        angles.push(angles[angles.length - 1]!);
      } else {
        for (let jj = 1; jj < count; ++jj) {
          const following = aOutline.CSegment(jj);

          if (following.SquaredLength() > SEG.Square(epsilon * 2) || jj === count - 1) {
            angles.push(EDA_ANGLE.fromVector(sub(following.B, following.A)).AsRadians());
            break;
          }
        }
      }
    }

    // Find collisions before reporting so that we can condense them into fewer reports.
    const collisions: { first: VECTOR2I; second: number }[] = [];

    for (let ii = 0; ii < count; ++ii) {
      const seg = aOutline.CSegment(ii);
      const segAngle = angles[ii]!;

      // Exclude segments on either side of us until we reach the angle tolerance
      let firstCandidate = ii + 1;
      let lastCandidate = count - 1;

      while (firstCandidate < count) {
        if (angleDiff(segAngle, angles[firstCandidate]!) < angleTolerance) firstCandidate++;
        else break;
      }

      if (aOutline.IsClosed()) {
        if (ii > 0) lastCandidate = ii - 1;

        while (lastCandidate !== Math.min(firstCandidate, count - 1)) {
          if (angleDiff(segAngle, angles[lastCandidate]!) < angleTolerance) {
            lastCandidate = lastCandidate === 0 ? count - 1 : lastCandidate - 1;
          } else {
            break;
          }
        }
      }

      // Now run the collision between seg and each candidate seg in the candidate range.
      if (lastCandidate < ii) lastCandidate = count - 1;

      for (let jj = firstCandidate; jj <= lastCandidate; ++jj) {
        const candidate = aOutline.CSegment(jj);
        const actual = { value: 0 };

        if (seg.Collide(candidate, clearance + aLineWidth - epsilon, actual)) {
          const firstPoint = seg.NearestPoint(candidate);
          const secondPoint = candidate.NearestPoint(seg);
          const pos = divideI(add(firstPoint, secondPoint), 2);

          const last = collisions[collisions.length - 1];

          if (last && EuclideanNormI(sub(pos, last.first)) < clearance * 2) {
            if (actual.value < last.second) {
              last.first = pos;
              last.second = actual.value;
            }

            continue;
          }

          collisions.push({ first: pos, second: actual.value });
        }
      }
    }

    for (const collision of collisions) {
      const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
      let pt = collision.first;

      const parentFP = aParentItem.GetParentFootprint();

      if (parentFP) {
        pt = RotatePoint(pt, parentFP.GetOrientation());
        pt = add(pt, parentFP.GetPosition());
      }

      const msg = this.formatMsg(
        'Internal clearance violation (%s clearance %s; actual %s)',
        aConstraint.GetName(),
        clearance,
        collision.second,
      );

      drcItem.SetErrorMessage(msg);
      drcItem.SetItems(aParentItem);
      drcItem.SetViolatingRule(aConstraint.GetParentRule());

      this.reportViolation(drcItem, pt, aLayer);
    }
  }

  private testZoneLayer(aZone: ZONE, aLayer: PCB_LAYER_ID, aConstraint: DRC_CONSTRAINT): void {
    const epsilon = this.m_board!.GetDesignSettings().GetDRCEpsilon();
    const clearance = aConstraint.GetValue().Min();

    if (aConstraint.GetSeverity() === RPT_SEVERITY_IGNORE || clearance - epsilon <= 0) return;

    const fill = aZone.GetFilledPolysList(aLayer).CloneDropTriangulation();

    // Turn fractured fill into outlines and holes
    fill.Simplify();

    for (let outlineIdx = 0; outlineIdx < fill.OutlineCount(); ++outlineIdx) {
      const firstOutline = fill.Outline(outlineIdx);

      //
      // Step one: outline to outline clearance violations
      //

      for (let ii = outlineIdx + 1; ii < fill.OutlineCount(); ++ii) {
        const secondOutline = fill.Outline(ii);

        for (let jj = 0; jj < secondOutline.SegmentCount(); ++jj) {
          const secondSeg = secondOutline.Segment(jj);
          const actual = { value: 0 };
          const pos: VECTOR2I = { x: 0, y: 0 };

          if (firstOutline.Collide(secondSeg, clearance - epsilon, actual, pos)) {
            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
            drcItem.SetErrorDetail(
              this.formatMsg(
                '(%s clearance %s; actual %s)',
                aConstraint.GetName(),
                clearance,
                actual.value,
              ),
            );
            drcItem.SetItems(aZone);
            drcItem.SetViolatingRule(aConstraint.GetParentRule());
            this.reportViolation(drcItem, pos, aLayer);
          }
        }

        if (this.m_drcEngine!.IsCancelled()) return;
      }

      //
      // Step two: interior hole clearance violations
      //

      for (let holeIdx = 0; holeIdx < fill.HoleCount(outlineIdx); ++holeIdx) {
        this.testShapeLineChain(fill.Hole(outlineIdx, holeIdx), 0, aLayer, aZone, aConstraint);

        if (this.m_drcEngine!.IsCancelled()) return;
      }
    }
  }

  private testItemAgainstItem(
    aItem: BOARD_ITEM,
    aItemShape: SHAPE,
    aLayer: PCB_LAYER_ID,
    aOther: BOARD_ITEM,
  ): number {
    const testClearance = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE);
    const testHoles = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE);
    let constraint = new DRC_CONSTRAINT();
    let clearance = 0;
    const actual = { value: 0 };
    let violations = 0;
    const pos: VECTOR2I = { x: 0, y: 0 };
    const boardCopperLayers = LSET.AllCuMask(this.m_board!.GetCopperLayerCount());

    let otherShape: SHAPE = aOther.GetEffectiveShape(aLayer);

    if (testClearance) {
      constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
        aItem,
        aOther,
        aLayer,
      );
      clearance = constraint.GetValue().Min();
    }

    if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
      // Collide (and generate violations) based on a well-defined order so that exclusion
      // checking against previously-generated violations will work.
      if (aItem.m_Uuid > aOther.m_Uuid) {
        [aItem, aOther] = [aOther, aItem];
        [aItemShape, otherShape] = [otherShape, aItemShape];
      }

      if (aItemShape.Collide(otherShape, clearance, actual, pos)) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
        drcItem.SetErrorDetail(
          this.formatMsg(
            '(%s clearance %s; actual %s)',
            constraint.GetName(),
            clearance,
            actual.value,
          ),
        );
        drcItem.SetItems(aItem, aOther);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoShapeGeometry(drcItem, pos, aItemShape, otherShape, aLayer, actual.value);
        ++violations;
      }
    }

    if (testHoles) {
      let itemHoleShape: SHAPE_SEGMENT | null = null;
      let otherHoleShape: SHAPE_SEGMENT | null = null;
      clearance = 0;

      if (aItem.Type() === KICAD_T.PCB_VIA_T) {
        const layers = aItem.GetLayerSet();

        if (layers.Contains(PCB_LAYER_ID.F_Cu)) {
          layers.orAssign(new LSET(LSET.FrontBoardTechMask()).set(PCB_LAYER_ID.F_CrtYd));
        }

        if (layers.Contains(PCB_LAYER_ID.B_Cu)) {
          layers.orAssign(new LSET(LSET.BackBoardTechMask()).set(PCB_LAYER_ID.B_CrtYd));
        }

        if (layers.Contains(PCB_LAYER_ID.F_Cu) && layers.Contains(PCB_LAYER_ID.B_Cu))
          layers.orAssign(boardCopperLayers);

        // wxCHECK_MSG( layers.Contains( aLayer ), violations, wxT( "Bug!  Vias should only be checked for layers on which they exist" ) );
        if (!layers.Contains(aLayer)) return violations;

        itemHoleShape = aItem.GetEffectiveHoleShape();
      } else if (aItem.HasHole()) {
        itemHoleShape = aItem.GetEffectiveHoleShape();
      }

      if (aOther.Type() === KICAD_T.PCB_VIA_T) {
        const layers = aOther.GetLayerSet();

        if (layers.Contains(PCB_LAYER_ID.F_Cu)) {
          layers.orAssign(new LSET(LSET.FrontBoardTechMask()).set(PCB_LAYER_ID.F_CrtYd));
        }

        if (layers.Contains(PCB_LAYER_ID.B_Cu)) {
          layers.orAssign(new LSET(LSET.BackBoardTechMask()).set(PCB_LAYER_ID.B_CrtYd));
        }

        if (layers.Contains(PCB_LAYER_ID.F_Cu) && layers.Contains(PCB_LAYER_ID.B_Cu))
          layers.orAssign(boardCopperLayers);

        // wxCHECK_MSG( layers.Contains( aLayer ), violations, wxT( "Bug!  Vias should only be checked for layers on which they exist" ) );
        if (!layers.Contains(aLayer)) return violations;

        otherHoleShape = aOther.GetEffectiveHoleShape();
      } else if (aOther.HasHole()) {
        otherHoleShape = aOther.GetEffectiveHoleShape();
      }

      if (itemHoleShape || otherHoleShape) {
        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
          aOther,
          aItem,
          aLayer,
        );
        clearance = constraint.GetValue().Min();
      }

      if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
        if (itemHoleShape && itemHoleShape.Collide(otherShape, clearance, actual, pos)) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)!;
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s clearance %s; actual %s)',
              constraint.GetName(),
              clearance,
              actual.value,
            ),
          );
          drcItem.SetItems(aItem, aOther);
          drcItem.SetViolatingRule(constraint.GetParentRule());
          this.reportTwoShapeGeometry(
            drcItem,
            pos,
            itemHoleShape,
            otherShape,
            aLayer,
            actual.value,
          );
          ++violations;
        }

        if (otherHoleShape && otherHoleShape.Collide(aItemShape, clearance, actual, pos)) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)!;
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s clearance %s; actual %s)',
              constraint.GetName(),
              clearance,
              actual.value,
            ),
          );
          drcItem.SetItems(aItem, aOther);
          drcItem.SetViolatingRule(constraint.GetParentRule());
          this.reportTwoShapeGeometry(
            drcItem,
            pos,
            otherHoleShape,
            aItemShape,
            aLayer,
            actual.value,
          );
          ++violations;
        }
      }
    }

    return violations;
  }

  private testItemAgainstZones(aItem: BOARD_ITEM, aLayer: PCB_LAYER_ID): void {
    for (const zone of this.m_board!.m_DRCZones) {
      if (!zone.GetLayerSet().test(aLayer)) continue;

      const itemBBox = aItem.GetBoundingBox();
      const worstCaseBBox = itemBBox.Clone();

      worstCaseBBox.Inflate(this.m_board!.m_DRCMaxClearance);

      if (!worstCaseBBox.Intersects(zone.GetBoundingBox())) continue;

      const testClearance = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE);
      const testHoles = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE);

      if (!testClearance && !testHoles) return;

      const zoneRTree = this.m_board!.m_CopperZoneRTreeCache.get(zone) ?? null;
      let constraint = new DRC_CONSTRAINT();
      let colliding: boolean;
      let clearance = -1;
      const actual = { value: 0 };
      const pos = { value: { x: 0, y: 0 } as VECTOR2I };

      if (testClearance) {
        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
          aItem,
          zone,
          aLayer,
        );
        clearance = constraint.GetValue().Min();
      }

      if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
        let itemShape: SHAPE = aItem.GetEffectiveShape(aLayer);

        if (aItem.Type() === KICAD_T.PCB_PAD_T) {
          const pad = aItem as PAD;

          if (!pad.FlashLayer(aLayer)) {
            if (pad.GetDrillSize().x === 0 && pad.GetDrillSize().y === 0) continue;

            const hole = pad.GetEffectiveHoleShape()!;
            const size = hole.GetWidth();

            itemShape = new SHAPE_SEGMENT(hole.GetSeg(), size);
          }
        }

        if (IsCopperLayer(aLayer) && zoneRTree) {
          colliding = zoneRTree.QueryColliding(itemBBox, itemShape, aLayer, clearance, actual, pos);
        } else {
          colliding = zone.Outline().Collide(itemShape, clearance, actual, pos.value);
        }

        if (colliding) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s clearance %s; actual %s)',
              constraint.GetName(),
              clearance,
              actual.value,
            ),
          );
          drcItem.SetItems(aItem, zone);
          drcItem.SetViolatingRule(constraint.GetParentRule());
          this.reportTwoItemGeometry(drcItem, pos.value, aItem, zone, aLayer, actual.value);
        }
      }

      if (testHoles) {
        let holeShape: SHAPE_SEGMENT | null = null;

        if (aItem.Type() === KICAD_T.PCB_VIA_T) {
          if (aItem.GetLayerSet().Contains(aLayer)) holeShape = aItem.GetEffectiveHoleShape();
        } else if (aItem.HasHole()) {
          holeShape = aItem.GetEffectiveHoleShape();
        }

        if (holeShape) {
          constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
            aItem,
            zone,
            aLayer,
          );
          clearance = constraint.GetValue().Min();

          if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
            if (IsCopperLayer(aLayer) && zoneRTree) {
              colliding = zoneRTree.QueryColliding(
                itemBBox,
                holeShape,
                aLayer,
                clearance,
                actual,
                pos,
              );
            } else {
              colliding = zone.Outline().Collide(holeShape, clearance, actual, pos.value);
            }

            if (colliding) {
              const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)!;
              drcItem.SetErrorDetail(
                this.formatMsg(
                  '(%s clearance %s; actual %s)',
                  constraint.GetName(),
                  clearance,
                  actual.value,
                ),
              );
              drcItem.SetItems(aItem, zone);
              drcItem.SetViolatingRule(constraint.GetParentRule());

              const zoneShape = zone.GetEffectiveShape(aLayer);
              this.reportTwoShapeGeometry(
                drcItem,
                pos.value,
                holeShape,
                zoneShape,
                aLayer,
                actual.value,
              );
            }
          }
        }
      }

      if (this.m_drcEngine!.IsCancelled()) return;
    }
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_PHYSICAL_CLEARANCE);
