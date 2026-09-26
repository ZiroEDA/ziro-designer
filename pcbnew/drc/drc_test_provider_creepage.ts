// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_creepage.cpp`.
 *
 * Physical creepage tests.
 *
 * Errors generated:
 * - DRCE_CREEPAGE
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { add, equal, Perpendicular, ResizeI, sub } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PAD_ATTRIB } from '../pad.js';
import type { PCB_MARKER } from '../pcb_marker.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { PCB_TRACK } from '../pcb_track.js';
import {
  CREEPAGE_GRAPH,
  type GRAPH_CONNECTION,
  type GRAPH_NODE,
  GRAPH_NODE_TYPE,
} from './drc_creepage_utils.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';
import { ptrOrdinal } from './ptr_order.js';

export class DRC_TEST_PROVIDER_CREEPAGE extends DRC_TEST_PROVIDER {
  // std::set<std::pair<const BOARD_ITEM*, const BOARD_ITEM*>>: an ORDERED pair
  private m_reportedPairs = new Set<string>();

  override GetName(): string {
    return 'creepage';
  }

  Run(): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();
    this.m_reportedPairs.clear();

    if (!this.m_drcEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.CREEPAGE_CONSTRAINT)) {
      this.REPORT_AUX('No creepage constraints found. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CREEPAGE)) {
      if (!this.reportPhase('Checking creepage...')) return false; // DRC cancelled

      this.testCreepage();
    }

    return !this.m_drcEngine!.IsCancelled();
  }

  private testCreepagePair(
    aGraph: CREEPAGE_GRAPH,
    aNetCodeA: number,
    aNetCodeB: number,
    aLayer: PCB_LAYER_ID,
  ): number {
    const bci1 = new PCB_TRACK(this.m_board);
    const bci2 = new PCB_TRACK(this.m_board);
    bci1.SetNetCode(aNetCodeA);
    bci2.SetNetCode(aNetCodeB);
    bci1.SetLayer(aLayer);
    bci2.SetLayer(aLayer);

    const constraint = this.m_drcEngine!.EvalRules(
      DRC_CONSTRAINT_T.CREEPAGE_CONSTRAINT,
      bci1,
      bci2,
      aLayer,
    );
    const creepageValue = constraint.Value().Min();
    aGraph.SetTarget(creepageValue);

    if (creepageValue <= 0) return 0;

    // Let's make a quick "clearance test"
    const netA = this.m_board!.FindNet(aNetCodeA);
    const netB = this.m_board!.FindNet(aNetCodeB);

    if (!netA || !netB) return 0;

    if (netA.GetBoundingBox().Distance(netB.GetBoundingBox()) > creepageValue) return 0;

    const NetA = aGraph.AddNetElements(aNetCodeA, aLayer, creepageValue);
    const NetB = aGraph.AddNetElements(aNetCodeB, aLayer, creepageValue);

    aGraph.GeneratePaths(creepageValue, aLayer);

    const temp_nodes: GRAPH_NODE[] = [];

    for (const aNode of aGraph.m_nodes) {
      if (
        aNode &&
        aNode.m_parent &&
        !aNode.m_parent.IsConductive() &&
        !aNode.m_connectDirectly &&
        aNode.m_type === GRAPH_NODE_TYPE.POINT
      )
        temp_nodes.push(aNode);
    }

    // alg::for_all_pairs
    for (let i = 0; i < temp_nodes.length; i++) {
      for (let j = i + 1; j < temp_nodes.length; j++) {
        const aN1 = temp_nodes[i]!;
        const aN2 = temp_nodes[j]!;

        if (aN1 === aN2) continue;

        if (!aN1 || !aN2) continue;

        if (!aN1.m_parent || !aN2.m_parent) continue;

        if (aN1.m_parent !== aN2.m_parent) continue;

        aN1.m_parent.ConnectChildren(aN1, aN2, aGraph);
      }
    }

    const shortestPath: GRAPH_CONNECTION[] = [];
    const distance = aGraph.Solve(NetA, NetB, shortestPath);

    if (shortestPath.length > 0 && shortestPath.length >= 4 && distance - creepageValue < 0) {
      const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CREEPAGE)!;
      drcItem.SetErrorDetail(
        this.formatMsg(
          '(%s creepage %s; actual %s)',
          constraint.GetName(),
          creepageValue,
          distance,
        ),
      );
      drcItem.SetViolatingRule(constraint.GetParentRule());

      const gc1 = shortestPath[1]!;
      const gc2 = shortestPath[shortestPath.length - 2]!;

      if (gc1.n1 && gc2.n2) {
        const item1 = gc1.n1.m_parent!.GetParent();
        const item2 = gc2.n2.m_parent!.GetParent();

        const key = `${item1 ? ptrOrdinal(item1) : -1}:${item2 ? ptrOrdinal(item2) : -1}`;

        if (!this.m_reportedPairs.has(key)) {
          this.m_reportedPairs.add(key);
          drcItem.SetItems(item1, item2);
        } else return 1;
      }

      const startPoint = gc1.m_path.a2;
      const endPoint = gc2.m_path.a2;
      const path: PCB_SHAPE[] = [];

      for (const gc of shortestPath) gc.GetShapes(path);

      this.reportViolation(drcItem, gc1.m_path.a2, aLayer, (aMarker: PCB_MARKER) => {
        aMarker.SetPath(path, startPoint, endPoint);
      });
    }

    return 1;
  }

  GetMaxConstraint(aNetCodes: readonly number[]): number {
    let maxConstraint = 0;

    const bci1 = new PCB_TRACK(this.m_board);
    const bci2 = new PCB_TRACK(this.m_board);

    for (let i = 0; i < aNetCodes.length; i++) {
      for (let j = i + 1; j < aNetCodes.length; j++) {
        const aNet1 = aNetCodes[i]!;
        const aNet2 = aNetCodes[j]!;

        if (aNet1 === aNet2) continue;

        bci1.SetNetCode(aNet1);
        bci2.SetNetCode(aNet2);

        for (const layer of LSET.AllCuMask(this.m_board!.GetCopperLayerCount()).Seq()) {
          bci1.SetLayer(layer);
          bci2.SetLayer(layer);
          const constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.CREEPAGE_CONSTRAINT,
            bci1,
            bci2,
            layer,
          );
          const value = constraint.Value().Min();
          maxConstraint = value > maxConstraint ? value : maxConstraint;
        }
      }
    }

    return maxConstraint;
  }

  private CollectNetCodes(aVector: number[]): void {
    // NETCODES_MAP is a std::map, iterated in ascending netcode order
    const nets = this.m_board!.GetNetInfo().NetsByNetcode();

    for (const netcode of [...nets.keys()].sort((a, b) => a - b)) aVector.push(netcode);
  }

  private CollectBoardEdges(aVector: BOARD_ITEM[], aOwned: PCB_SHAPE[]): void {
    if (!this.m_board) return;

    for (const drawing of this.m_board.Drawings()) {
      if (!drawing) continue;

      if (drawing.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) aVector.push(drawing);
    }

    for (const fp of this.m_board.Footprints()) {
      if (!fp) continue;

      for (const drawing of fp.GraphicalItems()) {
        if (!drawing) continue;

        if (drawing.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) aVector.push(drawing);
      }
    }

    for (const p of this.m_board.GetPads()) {
      if (!p) continue;

      if (p.GetAttribute() !== PAD_ATTRIB.NPTH) continue;

      const hole = p.GetEffectiveHoleShape();

      if (!hole) continue;

      const ptA = hole.GetSeg().A;
      const ptB = hole.GetSeg().B;
      const radius = Math.trunc(hole.GetWidth() / 2);

      if (equal(ptA, ptB)) {
        // Circular hole: add as a single circle.
        const s = new PCB_SHAPE(null, SHAPE_T.CIRCLE);
        s.SetRadius(radius);
        s.SetPosition(ptA);
        aVector.push(s);
        aOwned.push(s);
      } else {
        // Oblong slot: add the two semicircular end caps and two straight sides.
        // The slot outline is the border that creepage paths must not cross.
        const axis = sub(ptB, ptA);
        const perp = ResizeI(Perpendicular(axis), radius);

        // Side segments connecting the two end caps.
        const seg1 = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
        seg1.SetStart(add(ptA, perp));
        seg1.SetEnd(add(ptB, perp));
        aVector.push(seg1);
        aOwned.push(seg1);

        const seg2 = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
        seg2.SetStart(sub(ptA, perp));
        seg2.SetEnd(sub(ptB, perp));
        aVector.push(seg2);
        aOwned.push(seg2);

        // Semicircular arc at ptA end (180 degrees, away from ptB).
        const midA = sub(ptA, ResizeI(axis, radius));
        const arcA = new PCB_SHAPE(null, SHAPE_T.ARC);
        arcA.SetArcGeometry(add(ptA, perp), midA, sub(ptA, perp));
        aVector.push(arcA);
        aOwned.push(arcA);

        // Semicircular arc at ptB end (180 degrees, away from ptA).
        const midB = add(ptB, ResizeI(axis, radius));
        const arcB = new PCB_SHAPE(null, SHAPE_T.ARC);
        arcB.SetArcGeometry(sub(ptB, perp), midB, add(ptB, perp));
        aVector.push(arcB);
        aOwned.push(arcB);
      }
    }
  }

  private testCreepage(): number {
    if (!this.m_board) return -1;

    const netcodes: number[] = [];

    this.CollectNetCodes(netcodes);
    const maxConstraint = this.GetMaxConstraint(netcodes);

    if (maxConstraint <= 0) return 0;

    const outline = new SHAPE_POLY_SET();

    // Subtract NPTH holes from the outline polygon so candidate-path midpoint tests
    // reject creepage segments routed through slot interiors. Without subtraction,
    // a midpoint inside an NPTH oval still counts as "inside the board" and the
    // creepage validator accepts straight-through-slot paths (issue #24286).
    const hasValidOutline = this.m_board.GetBoardPolygonOutlines(outline, false, null, false, true);

    const graph = new CREEPAGE_GRAPH(this.m_board);

    if (ADVANCED_CFG.GetCfg().m_EnableCreepageSlot)
      graph.m_minGrooveWidth = this.m_board.GetDesignSettings().m_MinGrooveWidth;
    else graph.m_minGrooveWidth = 0;

    graph.m_boardOutline = hasValidOutline ? outline : null;

    this.CollectBoardEdges(graph.m_boardEdge, graph.m_ownedBoardEdges);
    graph.TransformEdgeToCreepShapes();
    graph.RemoveDuplicatedShapes();
    graph.TransformCreepShapesToNodes(graph.m_shapeCollection);

    graph.GeneratePaths(maxConstraint, PCB_LAYER_ID.Edge_Cuts);

    const beNodeSize = graph.m_nodes.length;
    const beConnectionsSize = graph.m_connections.length;
    let prevTestChangedGraph = false;

    let current = 0;
    const total =
      ((netcodes.length * (netcodes.length - 1)) / 2) * this.m_board.GetCopperLayerCount();
    const layers = this.m_board.GetLayerSet();

    for (let i = 0; i < netcodes.length; i++) {
      for (let j = i + 1; j < netcodes.length; j++) {
        const aNet1 = netcodes[i]!;
        const aNet2 = netcodes[j]!;

        if (aNet1 === aNet2) continue;

        for (const layer of layers.copperLayers()) {
          this.reportProgress(current++, total);

          if (prevTestChangedGraph) {
            let vectorSize = graph.m_connections.length;

            for (let k = beConnectionsSize; k < vectorSize; k++) {
              // We need to remove the connection from its endpoints' lists.
              graph.RemoveConnection(graph.m_connections[k]!, false);
            }

            graph.m_connections.length = beConnectionsSize;

            vectorSize = graph.m_nodes.length;
            graph.m_nodes.length = beNodeSize;

            // Rebuild m_nodeset to match the surviving board-edge
            // prefix.  Without this, stale per-net nodes from the
            // previous iteration remain in the set and corrupt
            // subsequent FindNode/AddNode lookups.
            graph.m_nodeset.clear();

            for (let k = 0; k < beNodeSize; ++k) {
              const gn = graph.m_nodes[k];

              if (gn)
                graph.m_nodeset.set(CREEPAGE_GRAPH.nodeKey(gn.m_type, gn.m_parent, gn.m_pos), gn);
            }
          }

          prevTestChangedGraph = this.testCreepagePair(graph, aNet1, aNet2, layer) !== 0;
        }
      }
    }

    return 1;
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_CREEPAGE);
