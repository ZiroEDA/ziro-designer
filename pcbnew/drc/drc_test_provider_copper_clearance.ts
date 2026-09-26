// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_copper_clearance.cpp`.
 *
 * Copper clearance test. Checks all copper items (pads, vias, tracks, drawings, zones) for their
 * electrical clearance.
 *
 * Errors generated:
 * - DRCE_CLEARANCE
 * - DRCE_HOLE_CLEARANCE
 * - DRCE_TRACKS_CROSSING
 * - DRCE_ZONES_INTERSECT
 * - DRCE_SHORTING_ITEMS
 */
import { FLASHING, IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LAYER_RANGE } from '@ziroeda/common/layer_range.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { NETINFO_ITEM } from '../netinfo.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB } from '../padstack.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TEXT } from '../pcb_text.js';
import type { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT, DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';
import { ptrGreater } from './ptr_order.js';

export class DRC_TEST_PROVIDER_COPPER_CLEARANCE extends DRC_TEST_PROVIDER {
  private m_drcEpsilon = 0;

  override GetName(): string {
    return 'clearance';
  }

  private sub_e(aClearance: number): number {
    return Math.max(0, aClearance - this.m_drcEpsilon);
  }

  Run(): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();

    if (this.m_board!.m_DRCMaxClearance <= 0) {
      this.REPORT_AUX('No Clearance constraints found. Tests not run.');
      return true; // continue with other tests
    }

    this.m_drcEpsilon = this.m_board!.GetDesignSettings().GetDRCEpsilon();

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE)) {
      if (!this.reportPhase('Checking track & via clearances...')) return false; // DRC cancelled

      this.testTrackClearances();
    } else if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)) {
      if (!this.reportPhase('Checking hole clearances...')) return false; // DRC cancelled

      this.testTrackClearances();
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE)) {
      if (!this.reportPhase('Checking pad clearances...')) return false; // DRC cancelled

      this.testPadClearances();
    } else if (
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SHORTING_ITEMS) ||
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)
    ) {
      if (!this.reportPhase('Checking pads...')) return false; // DRC cancelled

      this.testPadClearances();
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE)) {
      if (!this.reportPhase('Checking copper graphic clearances...')) return false; // DRC cancelled

      this.testGraphicClearances();
    } else if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)) {
      if (!this.reportPhase('Checking copper graphic hole clearances...')) return false; // DRC cancelled

      this.testGraphicClearances();
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE)) {
      if (!this.reportPhase('Checking copper zone clearances...')) return false; // DRC cancelled

      this.testZonesToZones();

      if (!this.reportPhase('Checking teardrop clearances...')) return false; // DRC cancelled

      this.testTeardropClearances();
    } else if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ZONES_INTERSECT)) {
      if (!this.reportPhase('Checking zones...')) return false; // DRC cancelled

      this.testZonesToZones();
    }

    return !this.m_drcEngine!.IsCancelled();
  }

  /**
   * Checks for track/via/hole <-> clearance
   * @param item Track to text
   * @param itemShape Primitive track shape
   * @param layer Which layer to test (in case of vias this can be multiple
   * @param other item against which to test the track item
   * @return false if there is a clearance violation reported, true if there is none
   */
  private testSingleLayerItemAgainstItem(
    item: BOARD_ITEM,
    itemShape: SHAPE,
    layer: PCB_LAYER_ID,
    other: BOARD_ITEM,
  ): boolean {
    let testClearance = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE);
    let testShorting = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SHORTING_ITEMS);
    const testHoles = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE);
    let constraint = new DRC_CONSTRAINT();
    let clearance = -1;
    const actual = { value: 0 };
    const pos: VECTOR2I = { x: 0, y: 0 };
    let has_error = false;
    let itemNet: NETINFO_ITEM | null = null;
    let otherNet: NETINFO_ITEM | null = null;

    if (item.IsConnected()) itemNet = (item as BOARD_CONNECTED_ITEM).GetNet();

    if (other.IsConnected()) otherNet = (other as BOARD_CONNECTED_ITEM).GetNet();

    if (itemNet === otherNet) testClearance = testShorting = false;

    let otherShape_shared_ptr: SHAPE | null = null;

    if (other.Type() === KICAD_T.PCB_PAD_T) {
      const pad = other as PAD;

      if (!pad.FlashLayer(layer)) {
        if (pad.GetAttribute() === PAD_ATTRIB.NPTH) testClearance = testShorting = false;

        otherShape_shared_ptr = pad.GetEffectiveHoleShape();
      }
    } else if (other.Type() === KICAD_T.PCB_VIA_T) {
      const via = other as PCB_VIA;

      if (!via.FlashLayer(layer)) otherShape_shared_ptr = via.GetEffectiveHoleShape();
    }

    if (!otherShape_shared_ptr) otherShape_shared_ptr = other.GetEffectiveShape(layer);

    let otherShape: SHAPE = otherShape_shared_ptr;

    // Collide (and generate violations) based on a well-defined order so that exclusion checking
    // against previously-generated violations will work.
    if (item.m_Uuid > other.m_Uuid) {
      [item, other] = [other, item];
      [itemShape, otherShape] = [otherShape, itemShape];
      [itemNet, otherNet] = [otherNet, itemNet];
    }

    if (testClearance || testShorting) {
      constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
        item,
        other,
        layer,
      );
      clearance = constraint.GetValue().Min();
    }

    if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
      // Special processing for track:track intersections
      if (item.Type() === KICAD_T.PCB_TRACE_T && other.Type() === KICAD_T.PCB_TRACE_T) {
        const track = item as PCB_TRACK;
        const otherTrack = other as PCB_TRACK;

        const trackSeg = new SEG(track.GetStart(), track.GetEnd());
        const otherSeg = new SEG(otherTrack.GetStart(), otherTrack.GetEnd());

        const intersection = trackSeg.Intersect(otherSeg);

        if (intersection) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TRACKS_CROSSING)!;
          drcItem.SetItems(item, other);
          drcItem.SetViolatingRule(constraint.GetParentRule());
          this.reportTwoPointGeometry(drcItem, intersection, intersection, intersection, layer);
          return false;
        }
      }

      if (itemShape.Collide(otherShape, this.sub_e(clearance), actual, pos)) {
        if (
          itemNet &&
          this.m_drcEngine!.IsNetTieExclusion(itemNet.GetNetCode(), layer, pos, other)
        ) {
          // Collision occurred as track was entering a pad marked as a net-tie.  We
          // allow these.
        } else if (actual.value === 0 && otherNet && testShorting) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SHORTING_ITEMS)!;
          drcItem.SetErrorDetail(
            `(nets ${itemNet ? itemNet.GetNetname() : '<no net>'} and ${otherNet ? otherNet.GetNetname() : '<no net>'})`,
          );
          drcItem.SetItems(item, other);
          this.reportTwoPointGeometry(drcItem, pos, pos, pos, layer);
          has_error = true;

          if (!this.m_drcEngine!.GetReportAllTrackErrors()) return false;
        } else if (testClearance) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s clearance %s; actual %s)',
              constraint.GetName(),
              clearance,
              actual.value,
            ),
          );
          drcItem.SetItems(item, other);
          drcItem.SetViolatingRule(constraint.GetParentRule());
          this.reportTwoShapeGeometry(drcItem, pos, itemShape, otherShape, layer, actual.value);
          has_error = true;

          if (!this.m_drcEngine!.GetReportAllTrackErrors()) return false;
        }
      }
    }

    if (testHoles && (item.HasHole() || other.HasHole())) {
      const a: [BOARD_ITEM, BOARD_ITEM] = [item, other];
      const b: [BOARD_ITEM, BOARD_ITEM] = [other, item];
      const b_net: [NETINFO_ITEM | null, NETINFO_ITEM | null] = [otherNet, itemNet];
      const a_shape: [SHAPE, SHAPE] = [itemShape, otherShape];

      for (let ii = 0; ii < 2; ++ii) {
        let holeShape: SHAPE_SEGMENT | null;

        if (b[ii]!.Type() === KICAD_T.PCB_VIA_T) {
          if (b[ii]!.GetLayerSet().Contains(layer)) holeShape = b[ii]!.GetEffectiveHoleShape();
          else continue;
        } else {
          if (b[ii]!.HasHole()) holeShape = b[ii]!.GetEffectiveHoleShape();
          else continue;
        }

        if (!holeShape) continue;

        const netcode = b_net[ii] ? b_net[ii]!.GetNetCode() : 0;

        if (
          netcode &&
          this.m_drcEngine!.IsNetTieExclusion(netcode, layer, holeShape.Centre(), a[ii]!)
        )
          continue;

        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
          b[ii]!,
          a[ii]!,
          layer,
        );
        clearance = constraint.GetValue().Min();

        // Test for hole to item clearance even if clearance is 0, because the item cannot be
        // inside (or intersect) the hole.
        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE) {
          if (a_shape[ii]!.Collide(holeShape, this.sub_e(clearance), actual, pos)) {
            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)!;
            drcItem.SetErrorDetail(
              this.formatMsg(
                clearance ? '(%s clearance %s; actual %s)' : '(%s clearance %s; actual < 0)',
                constraint.GetName(),
                clearance,
                actual.value,
              ),
            );
            drcItem.SetItems(a[ii]!, b[ii]!);
            drcItem.SetViolatingRule(constraint.GetParentRule());
            this.reportTwoShapeGeometry(drcItem, pos, a_shape[ii]!, holeShape, layer, actual.value);
            return false;
          }
        }
      }
    }

    return !has_error;
  }

  private testItemAgainstZone(aItem: BOARD_ITEM, aZone: ZONE, aLayer: PCB_LAYER_ID): void {
    if (!aZone.GetLayerSet().test(aLayer)) return;

    if (aZone.GetNetCode() && aItem.IsConnected()) {
      if (aZone.GetNetCode() === (aItem as BOARD_CONNECTED_ITEM).GetNetCode()) return;
    }

    const itemBBox = aItem.GetBoundingBox();
    const worstCaseBBox = itemBBox.Clone();

    worstCaseBBox.Inflate(this.m_board!.m_DRCMaxClearance);

    if (!worstCaseBBox.Intersects(aZone.GetBoundingBox())) return;

    const parentFP = aItem.GetParentFootprint();

    // Ignore graphic items which implement a net-tie to the zone's net on the layer being tested.
    if (parentFP && parentFP.IsNetTie() && aItem instanceof PCB_SHAPE) {
      const allowedNetTiePads = new Set<PAD>();

      for (const pad of parentFP.Pads()) {
        if (pad.GetNetCode() === aZone.GetNetCode() && aZone.GetNetCode() !== 0) {
          if (pad.IsOnLayer(aLayer)) allowedNetTiePads.add(pad);

          for (const other of parentFP.GetNetTiePads(pad)) {
            if (other.IsOnLayer(aLayer)) allowedNetTiePads.add(other);
          }
        }
      }

      if (allowedNetTiePads.size > 0) {
        const itemShape = aItem.GetEffectiveShape();

        for (const pad of allowedNetTiePads) {
          if (
            pad.GetBoundingBox().Intersects(itemBBox) &&
            pad.GetEffectiveShape(aLayer).Collide(itemShape)
          ) {
            return;
          }
        }
      }
    }

    let testClearance = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE);
    const testHoles = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE);

    if (!testClearance && !testHoles) return;

    const zoneTree = this.m_board!.m_CopperZoneRTreeCache.get(aZone);

    if (!zoneTree) return;

    let constraint = new DRC_CONSTRAINT();
    let clearance = -1;
    const actual = { value: 0 };
    const pos = { value: { x: 0, y: 0 } as VECTOR2I };

    if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      const pad = aItem as PAD;
      const flashedPad = pad.FlashLayer(aLayer);
      const platedHole = pad.HasHole() && pad.GetAttribute() === PAD_ATTRIB.PTH;

      if (!flashedPad && !platedHole) testClearance = false;
    }

    if (testClearance) {
      constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
        aItem,
        aZone,
        aLayer,
      );
      clearance = constraint.GetValue().Min();
    }

    if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
      const itemShape = aItem.GetEffectiveShape(aLayer, FLASHING.DEFAULT);

      if (
        zoneTree.QueryColliding(itemBBox, itemShape, aLayer, this.sub_e(clearance), actual, pos)
      ) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
        drcItem.SetErrorDetail(
          this.formatMsg(
            '(%s clearance %s; actual %s)',
            constraint.GetName(),
            clearance,
            actual.value,
          ),
        );
        drcItem.SetItems(aItem, aZone);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoItemGeometry(drcItem, pos.value, aItem, aZone, aLayer, actual.value);
      }
    }

    if (testHoles && aItem.HasHole()) {
      let holeShape: SHAPE_SEGMENT | null = null;

      if (aItem.Type() === KICAD_T.PCB_VIA_T) {
        if (aItem.GetLayerSet().Contains(aLayer)) holeShape = aItem.GetEffectiveHoleShape();
      } else {
        holeShape = aItem.GetEffectiveHoleShape();
      }

      if (holeShape) {
        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
          aItem,
          aZone,
          aLayer,
        );
        clearance = constraint.GetValue().Min();

        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
          if (
            zoneTree.QueryColliding(itemBBox, holeShape, aLayer, this.sub_e(clearance), actual, pos)
          ) {
            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)!;
            drcItem.SetErrorDetail(
              this.formatMsg(
                '(%s clearance %s; actual %s)',
                constraint.GetName(),
                clearance,
                actual.value,
              ),
            );
            drcItem.SetItems(aItem, aZone);
            drcItem.SetViolatingRule(constraint.GetParentRule());

            const zoneShape = aZone.GetEffectiveShape(aLayer);
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
  }

  /*
   * We have to special-case knockout text as it's most often knocked-out of a zone, so it's
   * presumed to collide with one.  However, if it collides with more than one, and they have
   * different nets, then we have a short.
   */
  private testKnockoutTextAgainstZone(
    aText: BOARD_ITEM,
    aInheritedNet: { value: NETINFO_ITEM | null },
    aZone: ZONE,
  ): void {
    const testClearance = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE);
    const testShorts = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SHORTING_ITEMS);

    if (!testClearance && !testShorts) return;

    const layer = aText.GetLayer();

    if (!aZone.GetLayerSet().test(layer)) return;

    const itemBBox = aText.GetBoundingBox();
    const worstCaseBBox = itemBBox.Clone();

    worstCaseBBox.Inflate(this.m_board!.m_DRCMaxClearance);

    if (!worstCaseBBox.Intersects(aZone.GetBoundingBox())) return;

    const zoneTree = this.m_board!.m_CopperZoneRTreeCache.get(aZone);

    if (!zoneTree) return;

    const itemShape = aText.GetEffectiveShape(layer, FLASHING.DEFAULT);

    if (aInheritedNet.value === null) {
      if (zoneTree.QueryColliding(itemBBox, itemShape, layer)) aInheritedNet.value = aZone.GetNet();
    }

    if (aInheritedNet.value === aZone.GetNet()) return;

    const constraint = this.m_drcEngine!.EvalRules(
      DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
      aText,
      aZone,
      layer,
    );
    const clearance = constraint.GetValue().Min();
    const actual = { value: 0 };
    const pos = { value: { x: 0, y: 0 } as VECTOR2I };

    if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance >= 0) {
      if (zoneTree.QueryColliding(itemBBox, itemShape, layer, this.sub_e(clearance), actual, pos)) {
        let drcItem: DRC_ITEM;

        if (testShorts && actual.value === 0 && aInheritedNet.value) {
          drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SHORTING_ITEMS)!;
          drcItem.SetErrorDetail(
            `(nets ${aInheritedNet.value.GetNetname()} and ${aZone.GetNetname()})`,
          );
        } else {
          drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s clearance %s; actual %s)',
              constraint.GetName(),
              clearance,
              actual.value,
            ),
          );
        }

        drcItem.SetItems(aText, aZone);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoItemGeometry(drcItem, pos.value, aText, aZone, layer, actual.value);
      }
    }
  }

  private testTrackClearances(): void {
    const freePadsUsageMap = new Map<BOARD_ITEM, number>();
    let done = 0;
    const count = this.m_board!.Tracks().length;

    this.REPORT_AUX(`Testing ${count} tracks & vias...`);

    const boardCopperLayers = LSET.AllCuMask(this.m_board!.GetCopperLayerCount());

    const testTrack = (trackIdx: number): void => {
      const track = this.m_board!.Tracks()[trackIdx]!;

      for (const layer of new LSET(track.GetLayerSet()).and(boardCopperLayers)) {
        const trackShape = track.GetEffectiveShape(layer);

        this.m_board!.m_CopperItemRTreeCache!.QueryCollidingItem(
          track,
          layer,
          layer,
          // Filter:
          (other: BOARD_ITEM): boolean => {
            if (
              other.IsConnected() &&
              (other as BOARD_CONNECTED_ITEM).GetNetCode() === track.GetNetCode()
            ) {
              return false;
            }

            // For track-vs-track pairs, use pointer ordering to ensure each
            // pair is tested exactly once across all threads, eliminating the
            // need for a shared checkedPairs mutex.
            const otherType = other.Type();

            if (
              (otherType === KICAD_T.PCB_TRACE_T ||
                otherType === KICAD_T.PCB_ARC_T ||
                otherType === KICAD_T.PCB_VIA_T) &&
              ptrGreater(track, other)
            ) {
              return false;
            }

            return true;
          },
          // Visitor:
          (other: BOARD_ITEM): boolean => {
            if (this.m_drcEngine!.IsCancelled()) return false;

            if (other.Type() === KICAD_T.PCB_PAD_T && (other as PAD).IsFreePad()) {
              if (other.GetEffectiveShape(layer).Collide(trackShape)) {
                const it = freePadsUsageMap.get(other);

                if (it === undefined) {
                  freePadsUsageMap.set(other, track.GetNetCode());
                  return true; // Continue colliding tests
                } else if (it === track.GetNetCode()) {
                  return true; // Continue colliding tests
                }
              }
            }

            if (!this.testSingleLayerItemAgainstItem(track, trackShape, layer, other)) {
              if (!this.m_drcEngine!.GetReportAllTrackErrors()) return false;
            }

            return !this.m_drcEngine!.IsCancelled();
          },
          this.m_board!.m_DRCMaxClearance,
        );

        for (const zone of this.m_board!.m_DRCCopperZones) {
          this.testItemAgainstZone(track, zone, layer);

          if (this.m_drcEngine!.IsCancelled()) break;
        }
      }

      done += 1;
    };

    // The thread pool's loop runs here one track at a time, with the
    // progress reported as the wait loop would.
    for (let ii = 0; ii < this.m_board!.Tracks().length; ++ii) {
      testTrack(ii);
      this.reportProgress(done, count);

      if (this.m_drcEngine!.IsCancelled()) break;
    }
  }

  private testPadAgainstItem(
    pad: PAD,
    padShape: SHAPE,
    aLayer: PCB_LAYER_ID,
    other: BOARD_ITEM,
  ): boolean {
    let testClearance = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE);
    let testShorting = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SHORTING_ITEMS);
    let testHoles = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE);

    // Disable some tests for net-tie objects in a footprint
    if (other.GetParent() === pad.GetParent()) {
      const fp = pad.GetParentFootprint()!;
      const padToNetTieGroupMap = fp.MapPadNumbersToNetTieGroups();
      // `std::map::operator[]` inserts a default (0) for a missing key.
      const padGroupIdx = padToNetTieGroupMap.get(pad.GetNumber()) ?? 0;

      if (other.Type() === KICAD_T.PCB_PAD_T) {
        const otherPad = other as PAD;

        if (
          padGroupIdx >= 0 &&
          padGroupIdx === (padToNetTieGroupMap.get(otherPad.GetNumber()) ?? 0)
        ) {
          testClearance = testShorting = false;
        }

        if (pad.SameLogicalPadAs(otherPad)) testHoles = false;
      }

      if (other.Type() === KICAD_T.PCB_SHAPE_T && padGroupIdx >= 0)
        testClearance = testShorting = false;
    }

    const otherCItem: BOARD_CONNECTED_ITEM | null = other.IsConnected()
      ? (other as BOARD_CONNECTED_ITEM)
      : null;
    let otherPad: PAD | null = null;
    let otherVia: PCB_VIA | null = null;

    if (other.Type() === KICAD_T.PCB_PAD_T) otherPad = other as PAD;

    if (other.Type() === KICAD_T.PCB_VIA_T) otherVia = other as PCB_VIA;

    if (!IsCopperLayer(aLayer)) testClearance = testShorting = false;

    // A NPTH has no cylinder, but it may still have pads on some layers
    if (pad.GetAttribute() === PAD_ATTRIB.NPTH && !pad.FlashLayer(aLayer))
      testClearance = testShorting = false;

    if (otherPad && otherPad.GetAttribute() === PAD_ATTRIB.NPTH && !otherPad.FlashLayer(aLayer)) {
      testClearance = testShorting = false;
    }

    // Track clearances are tested in testTrackClearances()
    if (
      other.Type() === KICAD_T.PCB_TRACE_T ||
      other.Type() === KICAD_T.PCB_ARC_T ||
      other.Type() === KICAD_T.PCB_VIA_T
    ) {
      testClearance = testShorting = false;
    }

    // Graphic clearances are tested in testGraphicClearances()
    if (other.Type() === KICAD_T.PCB_SHAPE_T || other.Type() === KICAD_T.PCB_TEXTBOX_T) {
      testClearance = testShorting = false;
    }

    const padNet = pad.GetNetCode();
    const otherNet = otherCItem ? otherCItem.GetNetCode() : 0;

    // Other objects of the same (defined) net get a waiver on clearance and hole tests
    if (otherNet && otherNet === padNet) {
      testClearance = testShorting = false;
      testHoles = false;
    }

    if (
      !(pad.GetDrillSize().x > 0) &&
      !(otherPad && otherPad.GetDrillSize().x > 0) &&
      !(otherVia && otherVia.GetDrill() > 0)
    ) {
      testHoles = false;
    }

    if (!testClearance && !testShorting && !testHoles) return true;

    const otherShape = other.GetEffectiveShape(aLayer);
    let constraint = new DRC_CONSTRAINT();
    let clearance = 0;
    const actual = { value: 0 };
    const pos: VECTOR2I = { x: 0, y: 0 };
    let has_error = false;

    if (otherPad && pad.SameLogicalPadAs(otherPad)) {
      // If pads are equivalent (ie: from the same footprint with the same pad number)...
      // ... and have "real" nets...
      // then they must be the same net
      if (testShorting) {
        if (pad.GetNetCode() === 0 || pad.GetNetCode() === otherPad.GetNetCode()) return true;

        if (
          pad.GetShortNetname().startsWith('unconnected-(') &&
          otherPad.GetShortNetname().startsWith('unconnected-(')
        ) {
          return true;
        }

        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SHORTING_ITEMS)!;
        drcItem.SetErrorDetail(`(nets ${pad.GetNetname()} and ${otherPad.GetNetname()})`);
        drcItem.SetItems(pad, otherPad);
        this.reportViolation(drcItem, otherPad.GetPosition(), aLayer);
        has_error = true;
      }

      return !has_error;
    }

    if (testClearance || testShorting) {
      constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
        pad,
        other,
        aLayer,
      );
      clearance = constraint.GetValue().Min();

      if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
        if (padShape.Collide(otherShape, this.sub_e(clearance), actual, pos)) {
          if (this.m_drcEngine!.IsNetTieExclusion(pad.GetNetCode(), aLayer, pos, other)) {
            // Pads connected to pads of a net-tie footprint are allowed to collide
            // with the net-tie footprint's graphics.
          } else if (actual.value === 0 && padNet && otherNet && testShorting) {
            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SHORTING_ITEMS)!;
            drcItem.SetErrorDetail(`(nets ${pad.GetNetname()} and ${otherCItem!.GetNetname()})`);
            drcItem.SetItems(pad, other);
            this.reportTwoPointGeometry(drcItem, pos, pos, pos, aLayer);
            has_error = true;
            testHoles = false; // No need for multiple violations
          } else if (testClearance) {
            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
            drcItem.SetErrorDetail(
              this.formatMsg(
                '(%s clearance %s; actual %s)',
                constraint.GetName(),
                clearance,
                actual.value,
              ),
            );
            drcItem.SetItems(pad, other);
            drcItem.SetViolatingRule(constraint.GetParentRule());
            this.reportTwoItemGeometry(drcItem, pos, pad, other, aLayer, actual.value);
            has_error = true;
            testHoles = false; // No need for multiple violations
          }
        }
      }
    }

    const doTestHole = (
      item: BOARD_ITEM,
      shape: SHAPE,
      otherItem: BOARD_ITEM,
      aOtherShape: SHAPE,
      aClearance: number,
    ): void => {
      if (shape.Collide(aOtherShape, this.sub_e(aClearance), actual, pos)) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)!;
        drcItem.SetErrorDetail(
          this.formatMsg(
            '(%s clearance %s; actual %s)',
            constraint.GetName(),
            aClearance,
            actual.value,
          ),
        );
        drcItem.SetItems(item, otherItem);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoShapeGeometry(drcItem, pos, shape, aOtherShape, aLayer, actual.value);
        has_error = true;
        testHoles = false; // No need for multiple violations
      }
    };

    if (testHoles) {
      constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
        pad,
        other,
        aLayer,
      );

      if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE) testHoles = false;
    }

    if (testHoles && otherPad && otherPad.HasHole() && pad.FlashLayer(aLayer)) {
      clearance = constraint.GetValue().Min();

      if (clearance > 0)
        doTestHole(pad, padShape, otherPad, otherPad.GetEffectiveHoleShape()!, clearance);
    }

    // Pad pairs are deduplicated by pointer order in testPadClearances.
    // Run the swapped direction so we don't miss any violations.
    if (testHoles && pad.HasHole() && otherPad && otherPad.FlashLayer(aLayer)) {
      clearance = constraint.GetValue().Min();

      if (clearance > 0)
        doTestHole(otherPad, otherShape, pad, pad.GetEffectiveHoleShape()!, clearance);
    }

    if (testHoles && otherVia && otherVia.HasHole()) {
      clearance = constraint.GetValue().Min();

      if (!otherVia.IsOnLayer(aLayer)) clearance = 0;

      if (clearance > 0)
        doTestHole(pad, padShape, otherVia, otherVia.GetEffectiveHoleShape()!, clearance);
    }

    return !has_error;
  }

  private testPadClearances(): void {
    let done = 1;

    const boardCopperLayers = LSET.AllCuMask(this.m_board!.GetCopperLayerCount());

    const fp_check = (ii: number): void => {
      const footprint = this.m_board!.Footprints()[ii]!;

      for (const pad of footprint.Pads()) {
        for (const layer of new LSET(pad.GetLayerSet()).and(boardCopperLayers)) {
          if (this.m_drcEngine!.IsCancelled()) return;

          const padShape = pad.GetEffectiveShape(layer);

          this.m_board!.m_CopperItemRTreeCache!.QueryCollidingItem(
            pad,
            layer,
            layer,
            // Filter:
            (other: BOARD_ITEM): boolean => {
              // For pad-vs-pad pairs, use pointer ordering to ensure
              // each pair is tested only once across all threads.
              if (other.Type() === KICAD_T.PCB_PAD_T && ptrGreater(pad, other)) return false;

              return true;
            },
            // Visitor
            (other: BOARD_ITEM): boolean => {
              this.testPadAgainstItem(pad, padShape, layer, other);
              return !this.m_drcEngine!.IsCancelled();
            },
            this.m_board!.m_DRCMaxClearance,
          );

          for (const zone of this.m_board!.m_DRCCopperZones) {
            this.testItemAgainstZone(pad, zone, layer);

            if (this.m_drcEngine!.IsCancelled()) return;
          }
        }
      }

      done += 1;
    };

    const numFootprints = this.m_board!.Footprints().length;

    // The thread pool's loop runs here one footprint at a time, with the
    // progress reported as the wait loop would.
    for (let ii = 0; ii < numFootprints; ++ii) {
      fp_check(ii);
      this.reportProgress(done, numFootprints);
    }
  }

  private testGraphicClearances(): void {
    let count = this.m_board!.Drawings().length;
    let done = 1;

    for (const footprint of this.m_board!.Footprints()) {
      count += footprint.GraphicalItems().length + footprint.GetFields().length;
    }

    this.REPORT_AUX(`Testing ${count} graphics...`);

    const isKnockoutText = (item: BOARD_ITEM): boolean => {
      return (
        (item.Type() === KICAD_T.PCB_TEXT_T || item.Type() === KICAD_T.PCB_FIELD_T) &&
        (item as PCB_TEXT).IsKnockout()
      );
    };

    const testGraphicAgainstZone = (item: BOARD_ITEM): void => {
      if (item.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T || this.isInvisibleText(item)) return;

      if (!IsCopperLayer(item.GetLayer())) return;

      // Knockout text is most often knocked-out of a zone, so it's presumed to
      // collide with one.  However, if it collides with more than one, and they
      // have different nets, then we have a short.
      const inheritedNet = { value: null as NETINFO_ITEM | null };

      for (const zone of this.m_board!.m_DRCCopperZones) {
        if (isKnockoutText(item)) this.testKnockoutTextAgainstZone(item, inheritedNet, zone);
        else this.testItemAgainstZone(item, zone, item.GetLayer());

        if (this.m_drcEngine!.IsCancelled()) return;
      }
    };

    const testCopperGraphic = (graphic: BOARD_ITEM): void => {
      const layer = graphic.GetLayer();

      this.m_board!.m_CopperItemRTreeCache!.QueryCollidingItem(
        graphic,
        layer,
        layer,
        // Filter:
        (other: BOARD_ITEM): boolean => {
          // Graphics are often compound shapes so ignore collisions
          // between shapes in a single footprint.
          if (
            graphic.Type() === KICAD_T.PCB_SHAPE_T &&
            other.Type() === KICAD_T.PCB_SHAPE_T &&
            graphic.GetParentFootprint() &&
            graphic.GetParentFootprint() === other.GetParentFootprint()
          ) {
            return false;
          }

          // Track clearances are tested in testTrackClearances()
          if (
            other.Type() === KICAD_T.PCB_TRACE_T ||
            other.Type() === KICAD_T.PCB_ARC_T ||
            other.Type() === KICAD_T.PCB_VIA_T
          ) {
            return false;
          }

          const graphicNet = graphic.IsConnected()
            ? (graphic as BOARD_CONNECTED_ITEM).GetNetCode()
            : 0;
          const otherNet = other.IsConnected() ? (other as BOARD_CONNECTED_ITEM).GetNetCode() : 0;

          if (graphicNet && graphicNet === otherNet) return false;

          // For graphic-graphic pairs, use pointer ordering for dedup
          if (
            (other.Type() === KICAD_T.PCB_SHAPE_T ||
              other.Type() === KICAD_T.PCB_TEXTBOX_T ||
              other.Type() === KICAD_T.PCB_BARCODE_T) &&
            ptrGreater(graphic, other)
          ) {
            return false;
          }

          return true;
        },
        // Visitor:
        (other: BOARD_ITEM): boolean => {
          this.testSingleLayerItemAgainstItem(graphic, graphic.GetEffectiveShape(), layer, other);

          return !this.m_drcEngine!.IsCancelled();
        },
        this.m_board!.m_DRCMaxClearance,
      );
    };

    for (const item of this.m_board!.Drawings()) {
      if (!this.m_drcEngine!.IsCancelled()) {
        testGraphicAgainstZone(item);

        if (
          (item.Type() === KICAD_T.PCB_SHAPE_T || item.Type() === KICAD_T.PCB_BARCODE_T) &&
          item.IsOnCopperLayer()
        ) {
          testCopperGraphic(item);
        }

        done += 1;
      }
    }

    for (const footprint of this.m_board!.Footprints()) {
      for (const item of footprint.GraphicalItems()) {
        if (!this.m_drcEngine!.IsCancelled()) {
          testGraphicAgainstZone(item);

          if (
            (item.Type() === KICAD_T.PCB_SHAPE_T || item.Type() === KICAD_T.PCB_BARCODE_T) &&
            item.IsOnCopperLayer()
          ) {
            testCopperGraphic(item);
          }

          done += 1;
        }
      }

      // Fields (reference, value, etc.) live in their own list but render as real
      // copper when placed on a copper layer, so they must be tested too.
      for (const field of footprint.GetFields()) {
        if (!this.m_drcEngine!.IsCancelled()) {
          testGraphicAgainstZone(field);
          done += 1;
        }
      }
    }

    this.reportProgress(done, count);
  }

  private testTeardropClearances(): void {
    const boardCopperLayers = LSET.AllCuMask(this.m_board!.GetCopperLayerCount());

    for (const teardrop of this.m_board!.m_DRCCopperZones) {
      if (!teardrop.IsTeardropArea()) continue;

      for (const layer of new LSET(teardrop.GetLayerSet()).and(boardCopperLayers)) {
        if (this.m_drcEngine!.IsCancelled()) return;

        for (const zone of this.m_board!.m_DRCCopperZones) {
          if (zone === teardrop) continue;

          if (!zone.GetLayerSet().Contains(layer)) continue;

          // For teardrop-vs-teardrop pairs, use pointer ordering so each
          // pair is tested only once.
          if (zone.IsTeardropArea() && ptrGreater(teardrop, zone)) continue;

          this.testItemAgainstZone(teardrop, zone, layer);

          if (this.m_drcEngine!.IsCancelled()) return;
        }
      }
    }
  }

  private testZonesToZones(): void {
    const testClearance = !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_CLEARANCE);
    const testIntersects = !this.m_drcEngine!.IsErrorLimitExceeded(
      PCB_DRC_CODE.DRCE_ZONES_INTERSECT,
    );

    const poly_segments: Map<PCB_LAYER_ID, SEG[]>[] = [];

    for (let ii = 0; ii < this.m_board!.m_DRCCopperZones.length; ii++)
      poly_segments.push(new Map());

    const segmentsOf = (idx: number, layer: PCB_LAYER_ID): SEG[] => {
      let segs = poly_segments[idx]!.get(layer);

      if (!segs) {
        segs = [];
        poly_segments[idx]!.set(layer, segs);
      }

      return segs;
    };

    let done = 0;
    let count = 0;

    const reportZoneZoneViolation = (
      zoneA: ZONE,
      zoneB: ZONE,
      pt: VECTOR2I,
      actual: number,
      constraint: DRC_CONSTRAINT,
      layer: PCB_LAYER_ID,
    ): void => {
      let drcItem: DRC_ITEM;

      if (constraint.IsNull()) {
        drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_ZONES_INTERSECT)!;
        drcItem.SetErrorDetail('(intersecting zones must have distinct priorities)');
        drcItem.SetItems(zoneA, zoneB);
        this.reportViolation(drcItem, pt, layer);
      } else {
        drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
        drcItem.SetErrorDetail(
          this.formatMsg(
            '(%s clearance %s; actual %s)',
            constraint.GetName(),
            constraint.GetValue().Min(),
            Math.max(actual, 0),
          ),
        );
        drcItem.SetItems(zoneA, zoneB);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoItemGeometry(drcItem, pt, zoneA, zoneB, layer, actual);
      }
    };

    const checkZones = (
      zoneA_idx: number,
      zoneB_idx: number,
      sameNet: boolean,
      layer: PCB_LAYER_ID,
    ): void => {
      const zoneA = this.m_board!.m_DRCCopperZones[zoneA_idx]!;
      const zoneB = this.m_board!.m_DRCCopperZones[zoneB_idx]!;
      const actual = { value: 0 };
      const pt: VECTOR2I = { x: 0, y: 0 };

      if (sameNet && testIntersects) {
        if (zoneA.Outline().Collide(zoneB.Outline(), 0, actual, pt)) {
          done += 1;
          reportZoneZoneViolation(zoneA, zoneB, pt, actual.value, new DRC_CONSTRAINT(), layer);
          return;
        }
      } else if (!sameNet && testClearance) {
        const constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
          zoneA,
          zoneB,
          layer,
        );
        const clearance = constraint.GetValue().Min();

        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance > 0) {
          const refSegments = segmentsOf(zoneA_idx, layer);
          const testSegments = segmentsOf(zoneB_idx, layer);

          // Iterate through all the segments in zoneA
          for (const refSegment of refSegments) {
            // Iterate through all the segments in zoneB
            for (const testSegment of testSegments) {
              // We have ensured that the 'A' segment starts before the 'B' segment, so if the
              // 'A' segment ends before the 'B' segment starts, we can skip to the next 'A'
              if (refSegment.B.x < testSegment.A.x) break;

              const dist_sq = { value: 0 };
              const other_pt: VECTOR2I = { x: 0, y: 0 };
              refSegment.NearestPoints(testSegment, pt, other_pt, dist_sq);
              const a = Math.floor(Math.sqrt(dist_sq.value) + 0.5);

              if (a < clearance) {
                done += 1;
                reportZoneZoneViolation(zoneA, zoneB, pt, a, constraint, layer);
                return;
              }
            }
          }
        }
      }

      done += 1;
    };

    // Pre-sort zones into layers
    const zone_idx_by_layer = new Map<PCB_LAYER_ID, number[]>();

    const zonesOn = (layer: PCB_LAYER_ID): number[] => {
      let v = zone_idx_by_layer.get(layer);

      if (!v) {
        v = [];
        zone_idx_by_layer.set(layer, v);
      }

      return v;
    };

    for (let ii = 0; ii < this.m_board!.m_DRCCopperZones.length; ii++) {
      const zone = this.m_board!.m_DRCCopperZones[ii]!;

      // Teardrop areas are tested as tracks, not zones
      if (zone.IsTeardropArea()) continue;

      for (const layer of zone.GetLayerSet()) {
        if (!IsCopperLayer(layer)) continue;

        zonesOn(layer).push(ii);
      }
    }

    const pending: (() => void)[] = [];

    for (const layer of new LAYER_RANGE(
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.B_Cu,
      this.m_board!.GetCopperLayerCount(),
    )) {
      // Skip over layers not used on the current board
      if (!this.m_board!.IsLayerEnabled(layer)) continue;

      for (const ii of zonesOn(layer)) {
        const poly = this.m_board!.m_DRCCopperZones[ii]!.GetFill(layer);

        if (poly) {
          const zone_layer_poly_segs = segmentsOf(ii, layer);

          for (const it of poly.IterateSegmentsWithHoles()) {
            const seg = new SEG(it.A, it.B);

            if (seg.A.x > seg.B.x) seg.Reverse();

            zone_layer_poly_segs.push(seg);
          }

          // Sort by x-coordinates for the sweep-line optimization in the inner
          // loop. SEG::operator< must not be used here because it delegates to
          // VECTOR2I::operator< which compares by magnitude, violating strict
          // weak ordering when mixed with VECTOR2I::operator== for tie-breaking.
          zone_layer_poly_segs.sort((a: SEG, b: SEG): number => {
            if (a.A.x !== b.A.x) return a.A.x - b.A.x;

            if (a.A.y !== b.A.y) return a.A.y - b.A.y;

            if (a.B.x !== b.B.x) return a.B.x - b.B.x;

            return a.B.y - b.B.y;
          });
        }
      }

      const idxs = zonesOn(layer);

      for (let it_a = 0; it_a < idxs.length; ++it_a) {
        const ia = idxs[it_a]!;
        const zoneA = this.m_board!.m_DRCCopperZones[ia]!;

        for (let it_a2 = it_a + 1; it_a2 < idxs.length; ++it_a2) {
          const ia2 = idxs[it_a2]!;
          const zoneB = this.m_board!.m_DRCCopperZones[ia2]!;

          const sameNet = zoneA.GetNetCode() === zoneB.GetNetCode() && zoneA.GetNetCode() >= 0;

          if (sameNet && zoneA.GetAssignedPriority() !== zoneB.GetAssignedPriority()) continue;

          // rule areas may overlap at will
          if (zoneA.GetIsRuleArea() || zoneB.GetIsRuleArea()) continue;

          // Examine a candidate zone: compare zoneB to zoneA
          let polyA: SHAPE_POLY_SET | null = null;
          let polyB: SHAPE_POLY_SET | null = null;

          if (sameNet) {
            polyA = zoneA.Outline();
            polyB = zoneB.Outline();
          } else {
            polyA = zoneA.GetFill(layer);
            polyB = zoneB.GetFill(layer);
          }

          if (!polyA || !polyB || !polyA.BBoxFromCaches().Intersects(polyB.BBoxFromCaches()))
            continue;

          count++;
          pending.push(() => checkZones(ia, ia2, sameNet, layer));
        }
      }
    }

    // The thread pool's tasks run here one after the other, with the
    // progress reported as the wait loop would.
    for (const task of pending) {
      if (this.m_drcEngine!.IsCancelled()) break;

      task();
      this.reportProgress(done, count);
    }
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_COPPER_CLEARANCE);
