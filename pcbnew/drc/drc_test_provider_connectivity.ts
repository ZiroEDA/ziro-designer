// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_connectivity.cpp`.
 *
 * Connectivity test provider. Not rule-driven.
 * Errors generated:
 * - DRCE_DANGLING_TRACK
 * - DRCE_DANGLING_VIA
 * - DRCE_ISOLATED_COPPER
 */
import { IS_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { IsCopperLayer, UNDEFINED_LAYER } from '@ziroeda/common/layer_ids.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { add, divideI, equal, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { PAD } from '../pad.js';
import type { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_CONNECTIVITY extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'connectivity';
  }

  Run(): boolean {
    if (!this.reportPhase('Checking pad, via and zone connections...')) return false; // DRC cancelled

    const board = this.m_drcEngine!.GetBoard()!;
    const connectivity = board.GetConnectivity();

    const progressDelta = 250;
    let ii = 0;
    let count = board.Tracks().length + board.m_ZoneIsolatedIslandsMap.size;

    ii += count; // We gave half of this phase to CONNECTIVITY_DATA::Build()
    count += count;

    for (const track of board.Tracks()) {
      const exceedT = this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DANGLING_TRACK);
      const exceedV = this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DANGLING_VIA);

      if (exceedV && exceedT) break;
      else if (track.Type() === KICAD_T.PCB_VIA_T && exceedV) continue;
      else if (
        (track.Type() === KICAD_T.PCB_TRACE_T || track.Type() === KICAD_T.PCB_ARC_T) &&
        exceedT
      )
        continue;

      if (!this.reportProgress(ii++, count, progressDelta)) return false; // DRC cancelled

      // Test for dangling items
      const code =
        track.Type() === KICAD_T.PCB_VIA_T
          ? PCB_DRC_CODE.DRCE_DANGLING_VIA
          : PCB_DRC_CODE.DRCE_DANGLING_TRACK;
      const pos = { value: { x: 0, y: 0 } as VECTOR2I };

      if (connectivity.TestTrackEndpointDangling(track, true, pos)) {
        let drcItem: DRC_ITEM;

        if (track.Type() === KICAD_T.PCB_VIA_T) {
          const constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.VIA_DANGLING_CONSTRAINT,
            track,
            null,
            track.GetLayer(),
          );

          if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE) continue;

          drcItem = DRC_ITEM.Create(code)!;
          drcItem.SetViolatingRule(constraint.GetParentRule());
        } else {
          drcItem = DRC_ITEM.Create(code)!;
        }

        drcItem.SetItems(track);
        this.reportViolation(drcItem, pos.value, track.GetLayer());
      }
    }

    // Test for tracks connecting to post-machined or backdrilled layers
    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_ON_POST_MACHINED_LAYER)) {
      for (const track of board.Tracks()) {
        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_ON_POST_MACHINED_LAYER))
          break;

        // Only check traces and arcs (not vias)
        if (track.Type() !== KICAD_T.PCB_TRACE_T && track.Type() !== KICAD_T.PCB_ARC_T) continue;

        const layer = track.GetLayer();

        // Get items connected to this track
        const items = connectivity.GetConnectivityAlgo().ItemEntry(track).GetItems();

        if (items.length === 0) continue;

        const citem = items[0]!;

        if (!citem.Valid()) continue;

        for (const connected of citem.ConnectedItems()) {
          const item = connected.Parent();

          if (item.GetFlags() & IS_DELETED) continue;

          let isPostMachined = false;

          if (item.Type() === KICAD_T.PCB_PAD_T) {
            const pad = item as PAD;
            isPostMachined = pad.IsBackdrilledOrPostMachined(layer);
          } else if (item.Type() === KICAD_T.PCB_VIA_T) {
            const via = item as PCB_VIA;
            isPostMachined = via.IsBackdrilledOrPostMachined(layer);
          }

          if (isPostMachined) {
            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TRACK_ON_POST_MACHINED_LAYER)!;
            drcItem.SetItems(track, item);

            let pos: VECTOR2I = divideI(add(track.GetStart(), track.GetEnd()), 2);

            // Use the endpoint that's closer to the pad/via
            if (item.HitTest(track.GetStart())) pos = track.GetStart();
            else if (item.HitTest(track.GetEnd())) pos = track.GetEnd();

            this.reportViolation(drcItem, pos, layer);
            break; // Only report once per track
          }
        }
      }
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_NOT_CENTERED_ON_VIA)) {
      for (const track of board.Tracks()) {
        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_NOT_CENTERED_ON_VIA))
          break;

        if (track.Type() !== KICAD_T.PCB_TRACE_T && track.Type() !== KICAD_T.PCB_ARC_T) continue;

        const items = connectivity.GetConnectivityAlgo().ItemEntry(track).GetItems();

        if (items.length === 0) continue;

        const citem = items[0]!;

        if (!citem.Valid()) continue;

        for (const connected of citem.ConnectedItems()) {
          const item = connected.Parent();

          if (item.GetFlags() & IS_DELETED) continue;

          if (item.Type() !== KICAD_T.PCB_VIA_T) continue;

          const via = item as PCB_VIA;
          const viaPos = via.GetPosition();

          const startInVia = via.HitTest(track.GetStart());
          const endInVia = via.HitTest(track.GetEnd());

          if (!startInVia && !endInVia) continue;

          // Check if any track on the same layer connected to this VIA
          // reaches its center. If so, this side is properly connected.
          let layerHasCenteredTrack = false;
          const trackLayer = track.GetLayer();

          const viaEntries = connectivity.GetConnectivityAlgo().ItemEntry(via).GetItems();

          if (viaEntries.length > 0) {
            for (const viaConnected of viaEntries[0]!.ConnectedItems()) {
              const connItem = viaConnected.Parent();

              if (connItem.Type() !== KICAD_T.PCB_TRACE_T && connItem.Type() !== KICAD_T.PCB_ARC_T)
                continue;

              const connTrack = connItem as PCB_TRACK;

              if (connTrack.GetLayer() !== trackLayer) continue;

              if (equal(connTrack.GetStart(), viaPos) || equal(connTrack.GetEnd(), viaPos)) {
                layerHasCenteredTrack = true;
                break;
              }
            }
          }

          if (layerHasCenteredTrack) continue;

          if (
            (startInVia && !equal(track.GetStart(), viaPos)) ||
            (endInVia && !equal(track.GetEnd(), viaPos))
          ) {
            const startViolation = startInVia && !equal(track.GetStart(), viaPos);
            const pos = startViolation ? track.GetStart() : track.GetEnd();

            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TRACK_NOT_CENTERED_ON_VIA)!;
            drcItem.SetItems(track, via);
            this.reportViolation(drcItem, pos, track.GetLayer());
            break;
          }
        }
      }
    }

    /* test starved zones */
    for (const [zone, zoneIslands] of board.m_ZoneIsolatedIslandsMap) {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ISOLATED_COPPER)) break;

      if (!this.reportProgress(ii++, count, progressDelta)) return false; // DRC cancelled

      for (const [layer, layerIslands] of zoneIslands) {
        if (!IsCopperLayer(layer)) continue;

        for (const polyIdx of layerIslands.m_IsolatedOutlines) {
          if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ISOLATED_COPPER)) break;

          const poly = zone.GetFilledPolysList(layer);

          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_ISOLATED_COPPER)!;
          drcItem.SetItems(zone);
          this.reportViolation(drcItem, poly.Outline(polyIdx).CPoint(0), layer);
        }
      }
    }

    if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS)) return true; // continue with other tests

    if (!this.reportPhase('Checking net connections...')) return false; // DRC cancelled

    ii = 0;
    count = connectivity.GetUnconnectedCount(false);

    connectivity.RunOnUnconnectedEdges((edge) => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS)) return false;

      if (!this.reportProgress(ii++, count, progressDelta)) return false; // DRC cancelled

      // wxCHECK( edge.GetSourceNode() && !edge.GetSourceNode()->Dirty(), true );
      const source = edge.GetSourceNode();
      const target = edge.GetTargetNode();

      if (!source || source.Dirty()) return true;
      if (!target || target.Dirty()) return true;

      const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS)!;
      drcItem.SetItems(source.Parent(), target.Parent());
      this.reportViolation(drcItem, source.Pos(), UNDEFINED_LAYER);

      return true;
    });

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_CONNECTIVITY);
