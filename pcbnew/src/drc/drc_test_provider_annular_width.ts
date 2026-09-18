// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_annular_width.cpp`.
 *
 * Via/pad annular ring width test. Checks if there's sufficient copper ring around
 * PTH/NPTH holes (vias/pads)
 * Errors generated:
 * - DRCE_ANNULAR_WIDTH
 *
 * Todo:
 * - check pad holes too.
 */
import type { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/src/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_SHAPE } from '../padstack.js';
import type { PCB_VIA } from '../pcb_track.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T, type DRC_CONSTRAINT } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_ANNULAR_WIDTH extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'annular_width';
  }

  Run(): boolean {
    if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ANNULAR_WIDTH)) {
      this.REPORT_AUX('Annular width violations ignored. Skipping check.');
      return true; // continue with other tests
    }

    const progressDelta = 500;

    if (!this.m_drcEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT)) {
      this.REPORT_AUX('No annular width constraints found. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.reportPhase('Checking pad & via annular rings...')) return false; // DRC cancelled

    const calcEffort = (item: BOARD_ITEM): number => {
      switch (item.Type()) {
        case KICAD_T.PCB_VIA_T:
          return 1;

        case KICAD_T.PCB_PAD_T: {
          const pad = item as PAD;

          if (!pad.HasHole() || pad.GetAttribute() !== PAD_ATTRIB.PTH) return 0;

          let effort = 0;

          pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
            const off = pad.GetOffset(aLayer);

            if (off.x === 0 && off.y === 0) {
              switch (pad.GetShape(aLayer)) {
                // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH in the C++
                case PAD_SHAPE.CHAMFERED_RECT:
                  if (pad.GetChamferRectRatio(aLayer) > 0.3) break;
                // KI_FALLTHROUGH
                case PAD_SHAPE.CIRCLE:
                case PAD_SHAPE.OVAL:
                case PAD_SHAPE.RECTANGLE:
                case PAD_SHAPE.ROUNDRECT:
                  effort += 1;
                  break;

                default:
                  break;
              }
            }

            effort += 5;
          });

          return effort;
        }

        default:
          return 0;
      }
    };

    const getPadAnnulusPts = (
      pad: PAD,
      aLayer: PCB_LAYER_ID,
      constraint: DRC_CONSTRAINT,
      sameNumPads: readonly PAD[],
      pt: { ptA: VECTOR2I; ptB: VECTOR2I },
    ): void => {
      let handled = false;
      const off = pad.GetOffset(aLayer);

      if (off.x === 0 && off.y === 0) {
        const xDist = KiROUND((pad.GetSizeX() - pad.GetDrillSizeX()) / 2.0);
        const yDist = KiROUND((pad.GetSizeY() - pad.GetDrillSizeY()) / 2.0);

        if (yDist < xDist) {
          pt.ptA = sub(pad.GetPosition(), { x: 0, y: Math.trunc(pad.GetDrillSizeY() / 2) });
          pt.ptB = sub(pad.GetPosition(), { x: 0, y: Math.trunc(pad.GetSizeY() / 2) });
        } else {
          pt.ptA = sub(pad.GetPosition(), { x: Math.trunc(pad.GetDrillSizeX() / 2), y: 0 });
          pt.ptB = sub(pad.GetPosition(), { x: Math.trunc(pad.GetSizeX() / 2), y: 0 });
        }

        pt.ptA = RotatePoint(pt.ptA, pad.GetPosition(), pad.GetOrientation());
        pt.ptB = RotatePoint(pt.ptB, pad.GetPosition(), pad.GetOrientation());

        switch (pad.GetShape(aLayer)) {
          case PAD_SHAPE.CHAMFERED_RECT:
            handled = pad.GetChamferRectRatio(aLayer) <= 0.3;
            break;

          case PAD_SHAPE.CIRCLE:
          case PAD_SHAPE.OVAL:
          case PAD_SHAPE.RECTANGLE:
          case PAD_SHAPE.ROUNDRECT:
            handled = true;
            break;

          default:
            break;
        }
      }

      const overlappingSameNumPads: PAD[] = [];

      for (const p of sameNumPads) {
        if (p.IsOnLayer(aLayer) && pad.GetBoundingBox().Intersects(p.GetBoundingBox())) {
          overlappingSameNumPads.push(p);
        }
      }

      // Same-number pads only add copper. Skip the slow path unless one
      // fully covers this pad (combined outline is then bigger than this
      // pad alone) or one's drill cuts into this pad (drill-to-drill copper
      // becomes the real limit).
      let overlapHasConstrainingHole = false;
      let overlapCoversThisPad = false;

      for (const p of overlappingSameNumPads) {
        if (p.GetBoundingBox().Contains(pad.GetBoundingBox())) overlapCoversThisPad = true;

        if (p.HasHole() && pad.GetBoundingBox().Intersects(p.GetEffectiveHoleShape()!.BBox())) {
          overlapHasConstrainingHole = true;
        }

        if (overlapCoversThisPad && overlapHasConstrainingHole) break;
      }

      if (
        handled &&
        overlappingSameNumPads.length > 0 &&
        !overlapHasConstrainingHole &&
        !overlapCoversThisPad &&
        constraint.Value().HasMin() &&
        !constraint.Value().HasMax()
      ) {
        // Circle: same annular width all around, so the fast value is exact
        // whenever any direction is uncovered. Non-circle has a narrow side
        // an SMD can rescue by itself, so trust the fast value here only
        // when it already passes.
        if (pad.GetShape(aLayer) === PAD_SHAPE.CIRCLE) {
          return;
        } else {
          const width = EuclideanNormI(sub(pt.ptA, pt.ptB));

          if (width >= constraint.Value().Min()) return;
        }
      }

      if (!handled || overlappingSameNumPads.length > 0) {
        // Slow (but general purpose) method.
        const padOutline = new SHAPE_POLY_SET();
        const slot = pad.GetEffectiveHoleShape()!;

        pad.TransformShapeToPolygon(
          padOutline,
          aLayer,
          0,
          pad.GetMaxError(),
          ERROR_LOC.ERROR_INSIDE,
        );

        if (sameNumPads.length === 0) {
          if (!padOutline.Collide(pad.GetPosition())) {
            // Hole outside pad
            pt.ptA = pad.GetPosition();
            pt.ptB = pad.GetPosition();
          } else {
            const a: VECTOR2I = { x: 0, y: 0 };
            const b: VECTOR2I = { x: 0, y: 0 };
            padOutline.NearestPoints(slot, a, b);
            pt.ptA = a;
            pt.ptB = b;
          }
        } else if (constraint.Value().HasMin()) {
          const aggregatePadOutline = padOutline.CloneDropTriangulation();
          const otherPadHoles = new SHAPE_POLY_SET();
          const slotPolygon = new SHAPE_POLY_SET();

          slot.TransformToPolygon(slotPolygon, 0, ERROR_LOC.ERROR_INSIDE);

          for (const sameNumPad of sameNumPads) {
            // Construct the full pad with outline and hole.
            sameNumPad.TransformShapeToPolygon(
              aggregatePadOutline,
              aLayer,
              0,
              pad.GetMaxError(),
              ERROR_LOC.ERROR_OUTSIDE,
            );

            sameNumPad.TransformHoleToPolygon(
              otherPadHoles,
              0,
              pad.GetMaxError(),
              ERROR_LOC.ERROR_INSIDE,
            );
          }

          aggregatePadOutline.BooleanSubtract(otherPadHoles);

          if (!aggregatePadOutline.Collide(pad.GetPosition())) {
            // Hole outside pad
            pt.ptA = pad.GetPosition();
            pt.ptB = pad.GetPosition();
          } else {
            const a: VECTOR2I = { x: 0, y: 0 };
            const b: VECTOR2I = { x: 0, y: 0 };
            aggregatePadOutline.NearestPoints(slot, a, b);
            pt.ptA = a;
            pt.ptB = b;
          }
        }
      }
    };

    const checkConstraint = (
      constraint: DRC_CONSTRAINT,
      item: BOARD_ITEM,
      ptA: VECTOR2I,
      ptB: VECTOR2I,
      aLayer: PCB_LAYER_ID,
    ): void => {
      if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE) return;

      let v_min = 0;
      let v_max = 0;
      let fail_min = false;
      let fail_max = false;
      const width = EuclideanNormI(sub(ptA, ptB));

      if (constraint.Value().HasMin()) {
        v_min = constraint.Value().Min();
        fail_min = width < v_min;
      }

      if (constraint.Value().HasMax()) {
        v_max = constraint.Value().Max();
        fail_max = width > v_max;
      }

      if (fail_min || fail_max) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_ANNULAR_WIDTH)!;

        if (fail_min) {
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s min annular width %s; actual %s)',
              constraint.GetName(),
              v_min,
              width,
            ),
          );
        }

        if (fail_max) {
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s max annular width %s; actual %s)',
              constraint.GetName(),
              v_max,
              width,
            ),
          );
        }

        drcItem.SetItems(item);
        drcItem.SetViolatingRule(constraint.GetParentRule());

        this.reportTwoPointGeometry(drcItem, item.GetPosition(), ptA, ptB, aLayer);
      }
    };

    const checkAnnularWidth = (item: BOARD_ITEM): boolean => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ANNULAR_WIDTH)) return false;

      if (item.Type() === KICAD_T.PCB_VIA_T) {
        const via = item as PCB_VIA;

        via.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
          const constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT,
            item,
            null,
            aLayer,
          );

          const ptA = sub(via.GetPosition(), { x: Math.trunc(via.GetDrillValue() / 2), y: 0 });
          const ptB = sub(via.GetPosition(), { x: Math.trunc(via.GetWidth(aLayer) / 2), y: 0 });

          checkConstraint(constraint, via, ptA, ptB, aLayer);
        });
      } else if (item.Type() === KICAD_T.PCB_PAD_T) {
        const pad = item as PAD;

        if (!pad.HasHole() || pad.GetAttribute() !== PAD_ATTRIB.PTH) return true;

        let sameNumPads: PAD[] = [];

        const fp = pad.GetParent() as FOOTPRINT | null;

        if (fp) sameNumPads = fp.GetPads(pad.GetNumber(), pad);

        pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
          const constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT,
            item,
            null,
            aLayer,
          );

          const pt = { ptA: { x: 0, y: 0 } as VECTOR2I, ptB: { x: 0, y: 0 } as VECTOR2I };

          getPadAnnulusPts(pad, aLayer, constraint, sameNumPads, pt);
          checkConstraint(constraint, pad, pt.ptA, pt.ptB, aLayer);
        });
      }

      return true;
    };

    const board = this.m_drcEngine!.GetBoard()!;
    let ii = 0;
    let total = 0;

    for (const item of board.Tracks()) total += calcEffort(item);

    for (const footprint of board.Footprints()) {
      for (const pad of footprint.Pads()) total += calcEffort(pad);
    }

    for (const item of board.Tracks()) {
      ii += calcEffort(item);

      if (!this.reportProgress(ii, total, progressDelta)) return false; // DRC cancelled

      if (!checkAnnularWidth(item)) break;
    }

    for (const footprint of board.Footprints()) {
      for (const pad of footprint.Pads()) {
        ii += calcEffort(pad);

        if (!this.reportProgress(ii, total, progressDelta)) return false; // DRC cancelled

        if (!checkAnnularWidth(pad)) break;
      }
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_ANNULAR_WIDTH);
