// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_matched_length.cpp`.
 *
 * Single-ended matched length + skew + via count test.
 * Errors generated:
 * - DRCE_LENGTH_OUT_OF_RANGE
 * - DRCE_SKEW_OUT_OF_RANGE
 * - DRCE_TOO_MANY_VIAS
 * Todo: arc support
 */
import type { EdaDataType } from '@ziroeda/common/eda_units.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import {
  LENGTH_DELAY_DOMAIN_OPT,
  LENGTH_DELAY_LAYER_OPT,
  type PATH_OPTIMISATIONS,
} from '../length_delay_calculation/length_delay_calculation.js';
import {
  type LENGTH_DELAY_CALCULATION_ITEM,
  LENGTH_DELAY_CALCULATION_ITEM_TYPE,
} from '../length_delay_calculation/length_delay_calculation_item.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_LENGTH_REPORT, DRC_LENGTH_REPORT_ENTRY } from './drc_length_report.js';
import { DRC_CONSTRAINT, DRC_CONSTRAINT_T, type DRC_RULE } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';
import { ptrOrdinal } from './ptr_order.js';

type CONNECTION = DRC_LENGTH_REPORT_ENTRY;

/** `std::set<BOARD_CONNECTED_ITEM*>::insert`: in pointer order, once. */
function setInsert(aSet: BOARD_CONNECTED_ITEM[], aItem: BOARD_CONNECTED_ITEM): void {
  if (aSet.includes(aItem)) return;

  aSet.push(aItem);
  aSet.sort((a, b) => ptrOrdinal(a) - ptrOrdinal(b));
}

export class DRC_TEST_PROVIDER_MATCHED_LENGTH extends DRC_TEST_PROVIDER {
  private readonly m_report = new DRC_LENGTH_REPORT();

  override GetName(): string {
    return 'length';
  }

  private checkLengths(
    aConstraint: DRC_CONSTRAINT,
    aMatchedConnections: readonly CONNECTION[],
  ): void {
    for (const ent of aMatchedConnections) {
      let minViolation = false;
      let maxViolation = false;
      let minLen = 0;
      let maxLen = 0;

      const isTimeDomain = aConstraint.GetOption(DRC_CONSTRAINT.OPTIONS.TIME_DOMAIN);
      const dataType: EdaDataType = isTimeDomain ? 'time' : 'distance';

      if (!isTimeDomain) {
        if (aConstraint.GetValue().HasMin() && ent.total < aConstraint.GetValue().Min()) {
          minViolation = true;
          minLen = aConstraint.GetValue().Min();
        } else if (aConstraint.GetValue().HasMax() && ent.total > aConstraint.GetValue().Max()) {
          maxViolation = true;
          maxLen = aConstraint.GetValue().Max();
        }
      } else {
        if (aConstraint.GetValue().HasMin() && ent.totalDelay < aConstraint.GetValue().Min()) {
          minViolation = true;
          minLen = aConstraint.GetValue().Min();
        } else if (
          aConstraint.GetValue().HasMax() &&
          ent.totalDelay > aConstraint.GetValue().Max()
        ) {
          maxViolation = true;
          maxLen = aConstraint.GetValue().Max();
        }
      }

      if (minViolation || maxViolation) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_LENGTH_OUT_OF_RANGE)!;

        if (minViolation) {
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s min length %s; actual %s)',
              aConstraint.GetName(),
              minLen,
              aConstraint.GetOption(DRC_CONSTRAINT.OPTIONS.TIME_DOMAIN)
                ? ent.totalDelay
                : ent.total,
              dataType,
            ),
          );
        } else if (maxViolation) {
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s max length %s; actual %s)',
              aConstraint.GetName(),
              maxLen,
              aConstraint.GetOption(DRC_CONSTRAINT.OPTIONS.TIME_DOMAIN)
                ? ent.totalDelay
                : ent.total,
              dataType,
            ),
          );
        }

        for (const offendingTrack of ent.items) drcItem.AddItem(offendingTrack);

        drcItem.SetViolatingRule(aConstraint.GetParentRule());

        this.reportViolation(drcItem, ent.items[0]!.GetPosition(), ent.items[0]!.GetLayer());
      }
    }
  }

  private checkSkews(
    aConstraint: DRC_CONSTRAINT,
    aMatchedConnections: readonly CONNECTION[],
  ): void {
    const checkSkewsImpl = (connections: readonly CONNECTION[]): void => {
      const isTimeDomain = aConstraint.GetOption(DRC_CONSTRAINT.OPTIONS.TIME_DOMAIN);
      const dataType: EdaDataType = isTimeDomain ? 'time' : 'distance';

      let maxLength = 0;
      let maxNetname = '';

      if (!isTimeDomain) {
        for (const ent of connections) {
          if (ent.total > maxLength) {
            maxLength = ent.total;
            maxNetname = ent.netname;
          }
        }
      } else {
        for (const ent of connections) {
          if (ent.totalDelay > maxLength) {
            maxLength = ent.totalDelay;
            maxNetname = ent.netname;
          }
        }
      }

      for (const ent of connections) {
        const skew = isTimeDomain
          ? KiROUND(ent.totalDelay - maxLength)
          : KiROUND(ent.total - maxLength);

        let fail_min = false;
        let fail_max = false;

        if (aConstraint.GetValue().HasMax() && Math.abs(skew) > aConstraint.GetValue().Max())
          fail_max = true;
        else if (aConstraint.GetValue().HasMin() && Math.abs(skew) < aConstraint.GetValue().Min())
          fail_min = true;

        if (fail_min || fail_max) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SKEW_OUT_OF_RANGE)!;
          let msg: string;

          const reportTotal = isTimeDomain ? ent.totalDelay : ent.total;

          if (fail_min) {
            msg = `(${aConstraint.GetName()} min skew ${this.MessageTextFromValue(aConstraint.GetValue().Min(), true, dataType)}; actual ${this.MessageTextFromValue(skew, true, dataType)}; target net length ${this.MessageTextFromValue(maxLength, true, dataType)} (from ${maxNetname}); actual ${this.MessageTextFromValue(reportTotal, true, dataType)})`;
          } else {
            msg = `(${aConstraint.GetName()} max skew ${this.MessageTextFromValue(aConstraint.GetValue().Max(), true, dataType)}; actual ${this.MessageTextFromValue(skew, true, dataType)}; target net length ${this.MessageTextFromValue(maxLength, true, dataType)} (from ${maxNetname}); actual ${this.MessageTextFromValue(reportTotal, true, dataType)})`;
          }

          drcItem.SetErrorDetail(msg);

          for (const offendingTrack of ent.items) drcItem.SetItems(offendingTrack);

          drcItem.SetViolatingRule(aConstraint.GetParentRule());

          this.reportViolation(drcItem, ent.items[0]!.GetPosition(), ent.items[0]!.GetLayer());
        }
      }
    };

    if (aConstraint.GetOption(DRC_CONSTRAINT.OPTIONS.SKEW_WITHIN_DIFF_PAIRS)) {
      // Find all pairs of nets in the matched connections
      const netcodeMap = new Map<number, CONNECTION>();

      for (const ent of aMatchedConnections) netcodeMap.set(ent.netcode, ent);

      const matchedDiffPairs: CONNECTION[][] = [];

      // `std::map` iterates in netcode order; erasing while iterating skips the erased key.
      for (const netcode of [...netcodeMap.keys()].sort((a, b) => a - b)) {
        const connection = netcodeMap.get(netcode);

        if (connection === undefined) continue;

        const matchedNet = this.m_board!.DpCoupledNet(connection.netinfo);

        if (matchedNet) {
          const matchedNetcode = matchedNet.GetNetCode();

          if (netcodeMap.has(matchedNetcode)) {
            const pair: CONNECTION[] = [connection, netcodeMap.get(matchedNetcode)!];
            matchedDiffPairs.push(pair);
            netcodeMap.delete(matchedNetcode);
          }
        }
      }

      // Test all found pairs of nets
      for (const matchedDiffPair of matchedDiffPairs) checkSkewsImpl(matchedDiffPair);
    } else {
      // Test all matched nets as a group
      checkSkewsImpl(aMatchedConnections);
    }
  }

  private checkViaCounts(
    aConstraint: DRC_CONSTRAINT,
    aMatchedConnections: readonly CONNECTION[],
  ): void {
    for (const ent of aMatchedConnections) {
      let drcItem: DRC_ITEM | null = null;

      if (aConstraint.GetValue().HasMax() && ent.viaCount > aConstraint.GetValue().Max()) {
        drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_VIA_COUNT_OUT_OF_RANGE)!;
        const msg = `(${aConstraint.GetName()} max count ${aConstraint.GetValue().Max()}; actual ${ent.viaCount})`;

        drcItem.SetErrorMessage(`Too many vias on a connection ${msg}`);
      } else if (aConstraint.GetValue().HasMin() && ent.viaCount < aConstraint.GetValue().Min()) {
        drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_VIA_COUNT_OUT_OF_RANGE)!;
        const msg = `(${aConstraint.GetName()} min count ${aConstraint.GetValue().Min()}; actual ${ent.viaCount})`;

        drcItem.SetErrorMessage(`Too few vias on a connection ${msg}`);
      }

      if (drcItem) {
        for (const offendingTrack of ent.items) drcItem.SetItems(offendingTrack);

        drcItem.SetViolatingRule(aConstraint.GetParentRule());

        this.reportViolation(drcItem, ent.items[0]!.GetPosition(), ent.items[0]!.GetLayer());
      }
    }
  }

  Run(): boolean {
    return this.runInternal(false);
  }

  private runInternal(aDelayReportMode = false): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();
    this.m_report.Clear();

    if (!aDelayReportMode) {
      if (!this.reportPhase('Gathering length-constrained connections...')) return false;
    }

    const boardCopperLayers = LSET.AllCuMask(this.m_board!.GetCopperLayerCount());
    /** `std::map<DRC_RULE*, std::set<BOARD_CONNECTED_ITEM*>>`, in insertion order. */
    const itemSets = new Map<DRC_RULE, BOARD_CONNECTED_ITEM[]>();

    const ftCache = this.m_board!.GetConnectivity().GetFromToCache();

    ftCache.Rebuild(this.m_board!);

    const progressDelta = 100;
    let count = 0;
    let ii = 0;

    this.forEachGeometryItem(
      [KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T, KICAD_T.PCB_VIA_T, KICAD_T.PCB_PAD_T],
      boardCopperLayers,
      (): boolean => {
        count++;
        return true;
      },
    );

    this.forEachGeometryItem(
      [KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T, KICAD_T.PCB_VIA_T, KICAD_T.PCB_PAD_T],
      boardCopperLayers,
      (item: BOARD_ITEM): boolean => {
        if (!this.reportProgress(ii++, count, progressDelta)) return false;

        for (const jj of [
          DRC_CONSTRAINT_T.LENGTH_CONSTRAINT,
          DRC_CONSTRAINT_T.SKEW_CONSTRAINT,
          DRC_CONSTRAINT_T.VIA_COUNT_CONSTRAINT,
        ]) {
          const constraint = this.m_drcEngine!.EvalRules(jj, item, null, item.GetLayer());

          if (constraint.IsNull()) continue;

          const citem = item as BOARD_CONNECTED_ITEM;
          const rule = constraint.GetParentRule()!;

          let set = itemSets.get(rule);

          if (!set) {
            set = [];
            itemSets.set(rule, set);
          }

          setInsert(set, citem);
        }

        return true;
      },
    );

    const calc = this.m_board!.GetLengthCalculation();

    /** `std::map<DRC_RULE*, std::vector<CONNECTION>>`, in insertion order. */
    const matches = new Map<DRC_RULE, CONNECTION[]>();

    for (const [rule, ruleItems] of itemSets) {
      /** `std::map<int, std::set<BOARD_CONNECTED_ITEM*>>`: netcode order. */
      const netMap = new Map<number, BOARD_CONNECTED_ITEM[]>();

      for (const item of ruleItems) {
        let set = netMap.get(item.GetNetCode());

        if (!set) {
          set = [];
          netMap.set(item.GetNetCode(), set);
        }

        setInsert(set, item);
      }

      for (const netCode of [...netMap.keys()].sort((a, b) => a - b)) {
        const netItems = netMap.get(netCode)!;
        const lengthItems: LENGTH_DELAY_CALCULATION_ITEM[] = [];

        const ent = new DRC_LENGTH_REPORT_ENTRY();
        ent.items = netItems;
        ent.netcode = netCode;
        ent.netname = this.m_board!.GetNetInfo().GetNetItem(ent.netcode)!.GetNetname();
        ent.netinfo = this.m_board!.GetNetInfo().GetNetItem(ent.netcode);

        ent.viaCount = 0;
        ent.totalRoute = 0;
        ent.totalVia = 0;
        ent.totalPadToDie = 0;
        ent.fromItem = null;
        ent.toItem = null;

        for (const item of netItems) {
          const lengthItem = calc.GetLengthCalculationItem(item);

          if (lengthItem.Type() !== LENGTH_DELAY_CALCULATION_ITEM_TYPE.UNKNOWN)
            lengthItems.push(lengthItem);
        }

        const opts: PATH_OPTIMISATIONS = {
          OptimiseVias: true,
          MergeTracks: true,
          OptimiseTracesInPads: true,
          InferViaInPad: false,
        };
        const details = calc.CalculateLengthDetails(
          lengthItems,
          opts,
          null,
          null,
          LENGTH_DELAY_LAYER_OPT.NO_LAYER_DETAIL,
          LENGTH_DELAY_DOMAIN_OPT.WITH_DELAY_DETAIL,
        );
        ent.viaCount = details.NumVias;
        ent.totalVia = details.ViaLength;
        ent.totalViaDelay = details.ViaDelay;
        ent.totalRoute = details.TrackLength;
        ent.totalRouteDelay = details.TrackDelay;
        ent.totalPadToDie = details.PadToDieLength;
        ent.totalPadToDieDelay = details.PadToDieDelay;
        ent.total = ent.totalRoute + ent.totalVia + ent.totalPadToDie;
        ent.totalDelay = ent.totalRouteDelay + ent.totalViaDelay + ent.totalPadToDieDelay;
        ent.matchingRule = rule;

        const ftPath = ftCache.QueryFromToPath(new Set(ent.items));

        if (ftPath) {
          ent.from = ftPath.fromName;
          ent.to = ftPath.toName;
        } else {
          ent.from = ent.to = '<unconstrained>';
        }

        this.m_report.Add(ent);

        let list = matches.get(rule);

        if (!list) {
          list = [];
          matches.set(rule, list);
        }

        list.push(ent);
      }
    }

    if (!aDelayReportMode) {
      if (!this.reportPhase('Checking length constraints...')) return false;

      ii = 0;
      count = matches.size;

      for (const [rule, matchedConnections] of matches) {
        if (!this.reportProgress(ii++, count, progressDelta)) return false;

        matchedConnections.sort((a: CONNECTION, b: CONNECTION): number =>
          a.netname < b.netname ? -1 : b.netname < a.netname ? 1 : 0,
        );

        if (this.getLogReporter()) {
          this.REPORT_AUX(`Length-constrained traces for rule '${rule.m_Name}':`);

          for (const ent of matchedConnections) {
            this.REPORT_AUX(
              ` - net: ${ent.netname}, from: ${ent.from}, to: ${ent.to}, ${ent.items.length} matching items, total: ${this.MessageTextFromValue(ent.total)} (tracks: ${this.MessageTextFromValue(ent.totalRoute)}, vias: ${this.MessageTextFromValue(ent.totalVia)}, pad-to-die: ${this.MessageTextFromValue(ent.totalPadToDie)}), vias: ${ent.viaCount}`,
            );
          }
        }

        const lengthConstraint = rule.FindConstraint(DRC_CONSTRAINT_T.LENGTH_CONSTRAINT);

        if (lengthConstraint && lengthConstraint.GetSeverity() !== RPT_SEVERITY_IGNORE)
          this.checkLengths(lengthConstraint, matchedConnections);

        const skewConstraint = rule.FindConstraint(DRC_CONSTRAINT_T.SKEW_CONSTRAINT);

        if (skewConstraint && skewConstraint.GetSeverity() !== RPT_SEVERITY_IGNORE)
          this.checkSkews(skewConstraint, matchedConnections);

        const viaCountConstraint = rule.FindConstraint(DRC_CONSTRAINT_T.VIA_COUNT_CONSTRAINT);

        if (viaCountConstraint && viaCountConstraint.GetSeverity() !== RPT_SEVERITY_IGNORE) {
          this.checkViaCounts(viaCountConstraint, matchedConnections);
        }
      }
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_MATCHED_LENGTH);
