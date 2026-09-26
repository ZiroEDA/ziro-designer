// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_edge_clearance.cpp`.
 *
 * Board edge clearance test. Checks all items for their mechanical clearances against the board
 * edge.
 * Errors generated:
 * - DRCE_EDGE_CLEARANCE
 * - DRCE_SILK_EDGE_CLEARANCE
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SquaredEuclideanNorm, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_PROP } from '../padstack.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_RTREE } from './drc_rtree.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

enum SILK_DISPOSITION {
  UNKNOWN = 0,
  ON_BOARD,
  OFF_BOARD,
  CROSSES_EDGE,
}

export class DRC_TEST_PROVIDER_EDGE_CLEARANCE extends DRC_TEST_PROVIDER {
  private m_castellatedPads: PAD[] = [];
  private m_largestEdgeClearance = 0;
  private m_epsilon = 0;
  private readonly m_edgesTree = new DRC_RTREE();

  private readonly m_silkDisposition = new Map<BOARD_ITEM, SILK_DISPOSITION>();

  // Pads/vias with non-uniform padstacks generate one work unit per unique
  // copper layer. For edge clearance, EvalRules is layer-agnostic
  // (UNDEFINED_LAYER), so per-layer reports for the same (item, edge, pos)
  // are redundant. Dedup at emission time.
  private readonly m_emittedEdgeReports = new Set<string>();

  override GetName(): string {
    return 'edge_clearance';
  }

  private resolveSilkDisposition(
    aItem: BOARD_ITEM,
    aItemShape: SHAPE,
    aBoardOutline: SHAPE_POLY_SET,
  ): void {
    let disposition = SILK_DISPOSITION.UNKNOWN;

    if (aItemShape.Type() === SHAPE_TYPE.SH_COMPOUND) {
      const compound = aItemShape as SHAPE_COMPOUND;

      for (const elem of compound.Shapes()) {
        const elem_disposition = aBoardOutline.Contains(elem.Centre())
          ? SILK_DISPOSITION.ON_BOARD
          : SILK_DISPOSITION.OFF_BOARD;

        if (disposition === SILK_DISPOSITION.UNKNOWN) {
          disposition = elem_disposition;
        } else if (disposition !== elem_disposition) {
          disposition = SILK_DISPOSITION.CROSSES_EDGE;
          break;
        }
      }
    } else {
      disposition = aBoardOutline.Contains(aItemShape.Centre())
        ? SILK_DISPOSITION.ON_BOARD
        : SILK_DISPOSITION.OFF_BOARD;
    }

    this.m_silkDisposition.set(aItem, disposition);

    if (disposition === SILK_DISPOSITION.CROSSES_EDGE) {
      let nearestEdge: BOARD_ITEM | null = null;
      const itemPos = aItem.GetCenter();
      let nearestEdgePt = aBoardOutline.Outline(0).NearestPoint(itemPos, false);

      for (let outlineIdx = 1; outlineIdx < aBoardOutline.OutlineCount(); ++outlineIdx) {
        const otherEdgePt = aBoardOutline.Outline(outlineIdx).NearestPoint(itemPos, false);

        if (
          SquaredEuclideanNorm(sub(otherEdgePt, itemPos)) <
          SquaredEuclideanNorm(sub(nearestEdgePt, itemPos))
        ) {
          nearestEdgePt = otherEdgePt;
        }
      }

      for (const edge of this.m_edgesTree.GetObjectsAt(
        nearestEdgePt,
        PCB_LAYER_ID.Edge_Cuts,
        this.m_epsilon,
      )) {
        if (edge.HitTest(nearestEdgePt, this.m_epsilon)) {
          nearestEdge = edge;
          break;
        }
      }

      if (!nearestEdge) return;

      const constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT,
        nearestEdge,
        aItem,
        UNDEFINED_LAYER,
      );
      const minClearance = constraint.GetValue().Min();

      if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && minClearance >= 0) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE)!;

        // Report clearance info if there is any, even though crossing is just a straight-up collision
        if (minClearance > 0) {
          drcItem.SetErrorDetail(
            this.formatMsg('(%s clearance %s; actual %s)', constraint.GetName(), minClearance, 0),
          );
        }

        drcItem.SetItems(nearestEdge.m_Uuid, aItem.m_Uuid);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoPointGeometry(
          drcItem,
          nearestEdgePt,
          nearestEdgePt,
          nearestEdgePt,
          aItem.GetLayer(),
        );
      }
    }
    // #if 0: "Silk outside board edge" errors are not reported.
  }

  private testAgainstEdge(
    item: BOARD_ITEM,
    itemShape: SHAPE,
    shapeLayer: PCB_LAYER_ID,
    edge: BOARD_ITEM,
    aConstraintType: DRC_CONSTRAINT_T,
    aErrorCode: PCB_DRC_CODE,
  ): boolean {
    let shape: SHAPE | null;

    if (edge.Type() === KICAD_T.PCB_PAD_T) shape = edge.GetEffectiveHoleShape();
    else shape = edge.GetEffectiveShape(PCB_LAYER_ID.Edge_Cuts);

    const constraint = this.m_drcEngine!.EvalRules(aConstraintType, edge, item, UNDEFINED_LAYER);
    const minClearance = constraint.GetValue().Min();
    const actual = { value: 0 };
    const pos: VECTOR2I = { x: 0, y: 0 };

    if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && minClearance >= 0) {
      if (
        shape &&
        itemShape.Collide(shape, Math.max(0, minClearance - this.m_epsilon), actual, pos)
      ) {
        if (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T) {
          // Edge collisions are allowed inside the holes of castellated pads
          for (const castellatedPad of this.m_castellatedPads) {
            if (castellatedPad.GetEffectiveHoleShape()!.Collide(pos)) return true;
          }
        }

        const reportKey = `${item.m_Uuid}:${edge.m_Uuid}:${pos.x},${pos.y}`;

        if (this.m_emittedEdgeReports.has(reportKey)) {
          // Same (item, edge, pos) already reported from another work unit.
          if (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T) {
            return this.m_drcEngine!.GetReportAllTrackErrors();
          } else {
            return false;
          }
        }

        this.m_emittedEdgeReports.add(reportKey);

        const drcItem = DRC_ITEM.Create(aErrorCode)!;

        // Only report clearance info if there is any; otherwise it's just a straight collision
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

        drcItem.SetItems(edge.m_Uuid, item.m_Uuid);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoItemGeometry(drcItem, pos, edge, item, shapeLayer, actual.value);

        if (aErrorCode === PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE)
          this.m_silkDisposition.set(item, SILK_DISPOSITION.CROSSES_EDGE);

        if (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T) {
          return this.m_drcEngine!.GetReportAllTrackErrors();
        } else {
          return false; // don't report violations with multiple edges; one is enough
        }
      }
    }

    return true;
  }

  Run(): boolean {
    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_EDGE_CLEARANCE)) {
      if (!this.reportPhase('Checking copper to board edge clearances...')) return false; // DRC cancelled
    } else if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE)) {
      if (!this.reportPhase('Checking silk to board edge clearances...')) return false; // DRC cancelled
    } else {
      this.REPORT_AUX('Edge clearance violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    this.m_board = this.m_drcEngine!.GetBoard();
    this.m_castellatedPads.length = 0;
    this.m_epsilon = this.m_board!.GetDesignSettings().GetDRCEpsilon();
    this.m_edgesTree.clear();
    this.m_silkDisposition.clear();
    this.m_emittedEdgeReports.clear();

    const worstClearanceConstraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT,
    );

    if (worstClearanceConstraint)
      this.m_largestEdgeClearance = worstClearanceConstraint.GetValue().Min();

    /*
     * Build an RTree of the various edges (including NPTH holes) and margins found on the board.
     */
    const edges: PCB_SHAPE[] = [];

    this.forEachGeometryItem(
      [KICAD_T.PCB_SHAPE_T],
      new LSET([PCB_LAYER_ID.Edge_Cuts, PCB_LAYER_ID.Margin]),
      (item: BOARD_ITEM): boolean => {
        const shape = item as PCB_SHAPE;
        const stroke = shape.GetStroke().clone(); // STROKE_PARAMS stroke = shape->GetStroke(), a copy

        if (item.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) stroke.SetWidth(0);

        if (shape.GetShape() === SHAPE_T.RECTANGLE && !shape.IsSolidFill()) {
          // A single rectangle for the board would defeat the RTree, so convert to edges
          if (shape.GetCornerRadius() > 0) {
            for (const subshape of shape.MakeEffectiveShapes(true)) {
              if (subshape instanceof SHAPE_SEGMENT) {
                const segment = subshape;
                const e = shape.Clone();
                e.SetShape(SHAPE_T.SEGMENT);
                e.SetStart(segment.GetSeg().A);
                e.SetEnd(segment.GetSeg().B);
                e.SetStroke(stroke);
                edges.push(e);
              } else if (subshape instanceof SHAPE_ARC) {
                const arc = subshape;
                const e = shape.Clone();
                e.SetShape(SHAPE_T.ARC);
                e.SetArcGeometry(arc.GetP0(), arc.GetArcMid(), arc.GetP1());
                e.SetStroke(stroke);
                edges.push(e);
              } else {
              }
            }
          } else {
            let e = shape.Clone();
            e.SetShape(SHAPE_T.SEGMENT);
            e.SetEndX(shape.GetStartX());
            e.SetStroke(stroke);
            edges.push(e);
            e = shape.Clone();
            e.SetShape(SHAPE_T.SEGMENT);
            e.SetEndY(shape.GetStartY());
            e.SetStroke(stroke);
            edges.push(e);
            e = shape.Clone();
            e.SetShape(SHAPE_T.SEGMENT);
            e.SetStartX(shape.GetEndX());
            e.SetStroke(stroke);
            edges.push(e);
            e = shape.Clone();
            e.SetShape(SHAPE_T.SEGMENT);
            e.SetStartY(shape.GetEndY());
            e.SetStroke(stroke);
            edges.push(e);
          }
        } else if (shape.GetShape() === SHAPE_T.POLY && !shape.IsSolidFill()) {
          // A single polygon for the board would defeat the RTree, so convert to edges.
          const poly = shape.GetPolyShape().Outline(0);

          for (let ii = 0; ii < poly.GetSegmentCount(); ++ii) {
            const seg = poly.CSegment(ii);
            const e = shape.Clone();
            e.SetShape(SHAPE_T.SEGMENT);
            e.SetStart(seg.A);
            e.SetEnd(seg.B);
            e.SetStroke(stroke);
            edges.push(e);
          }
        } else {
          const e = shape.Clone();
          e.SetStroke(stroke);
          edges.push(e);
        }

        return true;
      },
    );

    for (const edge of edges) {
      for (const layer of [PCB_LAYER_ID.Edge_Cuts, PCB_LAYER_ID.Margin]) {
        if (edge.IsOnLayer(layer))
          this.m_edgesTree.Insert(edge, layer, undefined, this.m_largestEdgeClearance);
      }
    }

    for (const footprint of this.m_board!.Footprints()) {
      for (const pad of footprint.Pads()) {
        if (pad.GetAttribute() === PAD_ATTRIB.NPTH && pad.HasHole()) {
          // edge-clearances are for milling tolerances (drilling tolerances are handled
          // by hole-clearances)
          if (pad.GetDrillSizeX() !== pad.GetDrillSizeY()) {
            this.m_edgesTree.Insert(
              pad,
              PCB_LAYER_ID.Edge_Cuts,
              undefined,
              this.m_largestEdgeClearance,
            );
          }
        }

        if (pad.GetProperty() === PAD_PROP.CASTELLATED) this.m_castellatedPads.push(pad);
      }
    }

    /*
     * Test copper and silk items against the set of edges.
     */
    const progressDelta = 200;
    let count = 0;
    let ii = 0;

    this.forEachGeometryItem(
      DRC_TEST_PROVIDER.s_allBasicItems,
      LSET.AllLayersMask(),
      (): boolean => {
        count++;
        return true;
      },
    );

    this.forEachGeometryItem(
      DRC_TEST_PROVIDER.s_allBasicItems,
      LSET.AllLayersMask(),
      (item: BOARD_ITEM): boolean => {
        const testCopper = !this.m_drcEngine!.IsErrorLimitExceeded(
          PCB_DRC_CODE.DRCE_EDGE_CLEARANCE,
        );
        const testSilk = !this.m_drcEngine!.IsErrorLimitExceeded(
          PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE,
        );

        if (!testCopper && !testSilk) return false; // All limits exceeded; we're done

        if (!this.reportProgress(ii++, count, progressDelta)) return false; // DRC cancelled; we're done

        if (this.isInvisibleText(item)) return true; // Continue with other items

        if (item.Type() === KICAD_T.PCB_ZONE_T) {
          // Rule areas have no copper and are purely logical -- skip edge clearance.
          if ((item as ZONE).GetIsRuleArea()) return true;
        }

        if (item.Type() === KICAD_T.PCB_PAD_T) {
          const pad = item as PAD;

          if (
            pad.GetProperty() === PAD_PROP.CASTELLATED ||
            pad.GetAttribute() === PAD_ATTRIB.CONN
          ) {
            return true; // Continue with other items
          }
        }

        let layersToTest: PCB_LAYER_ID[];

        switch (item.Type()) {
          case KICAD_T.PCB_PAD_T:
            layersToTest = (item as PAD).Padstack().UniqueLayers();
            break;

          case KICAD_T.PCB_VIA_T:
            layersToTest = (item as PCB_VIA).Padstack().UniqueLayers();
            break;

          case KICAD_T.PCB_ZONE_T:
            layersToTest = [];

            for (const layer of item.GetLayerSet()) layersToTest.push(layer);

            break;

          default:
            layersToTest = [UNDEFINED_LAYER];
        }

        for (const shapeLayer of layersToTest) {
          const itemShape = item.GetEffectiveShape(shapeLayer);

          for (const testLayer of [PCB_LAYER_ID.Edge_Cuts, PCB_LAYER_ID.Margin]) {
            if (testCopper && item.IsOnCopperLayer()) {
              this.m_edgesTree.QueryCollidingItem(
                item,
                shapeLayer,
                testLayer,
                null,
                (edge: BOARD_ITEM): boolean => {
                  return this.testAgainstEdge(
                    item,
                    itemShape,
                    shapeLayer,
                    edge,
                    DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT,
                    PCB_DRC_CODE.DRCE_EDGE_CLEARANCE,
                  );
                },
                this.m_largestEdgeClearance,
              );
            }

            if (
              testSilk &&
              (item.IsOnLayer(PCB_LAYER_ID.F_SilkS) || item.IsOnLayer(PCB_LAYER_ID.B_SilkS))
            ) {
              this.m_edgesTree.QueryCollidingItem(
                item,
                shapeLayer,
                testLayer,
                null,
                (edge: BOARD_ITEM): boolean => {
                  return this.testAgainstEdge(
                    item,
                    itemShape,
                    shapeLayer,
                    edge,
                    DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT,
                    PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE,
                  );
                },
                this.m_largestEdgeClearance,
              );
            }
          }

          if (
            testSilk &&
            (item.IsOnLayer(PCB_LAYER_ID.F_SilkS) || item.IsOnLayer(PCB_LAYER_ID.B_SilkS))
          ) {
            // `m_silkDisposition[item]` default-inserts UNKNOWN.
            if (
              (this.m_silkDisposition.get(item) ?? SILK_DISPOSITION.UNKNOWN) ===
                SILK_DISPOSITION.UNKNOWN &&
              this.m_board!.BoardOutline().HasOutline()
            ) {
              this.resolveSilkDisposition(
                item,
                itemShape,
                this.m_board!.BoardOutline().GetOutline(),
              );
            }
          }
        }

        return true;
      },
    );

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_EDGE_CLEARANCE);
