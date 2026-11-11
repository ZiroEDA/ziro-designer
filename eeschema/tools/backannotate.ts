// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/backannotate.cpp` / `.h`: BACK_ANNOTATE, which receives the board's netlist
 * from pcbnew (MAIL_PCB_GET_NETLIST), checks it against the schematic and applies it — the
 * engine behind Tools > Update Schematic from PCB.
 *
 * Ordering: upstream's `std::map<wxString, …>` iterate in key order, so every map here that
 * upstream iterates is walked through {@link sortedEntries} (code-point order, as wxString's
 * operator<). `changesPerFp` is keyed by a `shared_ptr`, i.e. by address; here it is the order a
 * footprint first appears in the changelist.
 *
 * A CHANGELIST_ITEM holds a copy of its SCH_REFERENCE upstream; here it holds the list's own
 * reference object. Nothing reads `m_refs` or `m_multiUnitsRefs` after the changelist is made,
 * so the one write through it (`SetUnit` after a unit swap) is seen by nothing else.
 */
import { DescribeRef } from '@ziroeda/common/common.js';
import { DSNLEXER } from '@ziroeda/common/dsnlexer.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_NEW, SKIP_STRUCT } from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { PTREE, Scan } from '@ziroeda/common/ptree.js';
import {
  NULL_REPORTER,
  type Reporter,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { AccumulateDescriptions, EscapeHTML } from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { headlessPcbNetlist } from '../browser/headless_pcb_netlist.js';
import { CONNECTION_SUBGRAPH } from '../connection_graph.js';
import type { LIB_SYMBOL, UNIT_PIN_INFO } from '../lib_symbol.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_CONNECTION } from '../sch_connection.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import type { SCH_ITEM } from '../sch_item.js';
import { SCH_LABEL, type SCH_LABEL_BASE, SPIN_STYLE } from '../sch_label.js';
import type { SCH_PIN } from '../sch_pin.js';
import {
  type SCH_MULTI_UNIT_REFERENCE_MAP,
  type SCH_REFERENCE,
  SCH_REFERENCE_LIST,
} from '../sch_reference_list.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import { type SCH_SHEET_PATH, SYMBOL_FILTER } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { SCH_CLEANUP_FLAGS } from '../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../symbol.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './sch_line_wire_bus_tool.js';
import { SCH_SELECTION } from './sch_selection.js';
import {
  GetSheetNamesFromPaths,
  SwapPinGeometry,
  SymbolHasSheetInstances,
} from './sch_tool_utils.js';
import { _ } from '@ziroeda/wx/translation.js';

/** wxString's operator<: code-point order. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A `std::map<wxString, V>`'s iteration order. */
function sortedEntries<V>(aMap: ReadonlyMap<string, V>): [string, V][] {
  return [...aMap].sort(([a], [b]) => cmp(a, b));
}

/** `std::vector<wxString> == std::vector<wxString>`. */
const sameNets = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/** Compare nets in the deterministic library order so diode arrays and similar map cleanly. */
function netsInUnitOrder(
  aPins: readonly string[],
  aNetByPin: ReadonlyMap<string, string>,
): string[] {
  const nets: string[] = [];

  if (aPins.length > 0) {
    for (const pinNum of aPins) nets.push(aNetByPin.get(pinNum) ?? '');
  } else {
    for (const [, net] of sortedEntries(aNetByPin)) nets.push(net);
  }

  return nets;
}

export interface BACKANNOTATE_UNIT_SWAP_CANDIDATE {
  m_ref: string;
  m_currentUnit: number;
  m_schNetsByPin: Map<string, string>;
  m_unitPinNumbers: string[];
}

export interface BACKANNOTATE_UNIT_SWAP_STEP {
  m_firstIndex: number;
  m_secondIndex: number;
  m_firstUnit: number;
  m_secondUnit: number;
}

export interface BACKANNOTATE_UNIT_SWAP_PLAN {
  m_mappingOk: boolean;
  m_identity: boolean;
  m_steps: BACKANNOTATE_UNIT_SWAP_STEP[];
  m_swappedCandidateIndices: Set<number>;
}

/**
 * Compute a pure unit-swap plan from schematic-side unit definitions and the final PCB pin map.
 *
 * This is shared by backannotation and unit tests so swap inference can be exercised without
 * constructing a full schematic editor test harness.
 */
export function PlanBackannotateUnitSwaps(
  aCandidates: readonly BACKANNOTATE_UNIT_SWAP_CANDIDATE[],
  aPcbPinMap: ReadonlyMap<string, string>,
): BACKANNOTATE_UNIT_SWAP_PLAN {
  const plan: BACKANNOTATE_UNIT_SWAP_PLAN = {
    m_mappingOk: false,
    m_identity: true,
    m_steps: [],
    m_swappedCandidateIndices: new Set(),
  };

  if (aCandidates.length < 2) {
    plan.m_mappingOk = true;
    return plan;
  }

  const desiredTarget = new Map<number, number>();
  const usedTargets = new Set<number>();

  for (let candidateIdx = 0; candidateIdx < aCandidates.length; ++candidateIdx) {
    const candidate = aCandidates[candidateIdx]!;
    const pcbNetsByPin = new Map<string, string>();

    for (const pinNum of candidate.m_unitPinNumbers)
      pcbNetsByPin.set(pinNum, aPcbPinMap.get(pinNum) ?? '');

    const pcbNets = netsInUnitOrder(candidate.m_unitPinNumbers, pcbNetsByPin);
    let matched = false;

    for (let matchIdx = 0; matchIdx < aCandidates.length; ++matchIdx) {
      if (usedTargets.has(matchIdx)) continue;

      const potentialMatch = aCandidates[matchIdx]!;
      const schNets = netsInUnitOrder(
        potentialMatch.m_unitPinNumbers,
        potentialMatch.m_schNetsByPin,
      );

      if (sameNets(pcbNets, schNets)) {
        desiredTarget.set(candidateIdx, matchIdx);
        usedTargets.add(matchIdx);
        matched = true;
        break;
      }
    }

    if (!matched) return plan;
  }

  plan.m_mappingOk = true;
  plan.m_identity = true;

  for (let candidateIdx = 0; candidateIdx < aCandidates.length; ++candidateIdx) {
    const target = desiredTarget.get(candidateIdx);

    if (target === undefined || target !== candidateIdx) {
      plan.m_identity = false;
      break;
    }
  }

  if (plan.m_identity) return plan;

  const visited = new Set<number>();

  for (let startIdx = 0; startIdx < aCandidates.length; ++startIdx) {
    if (visited.has(startIdx)) continue;

    const cycle: number[] = [];
    let curIdx = startIdx;

    while (!visited.has(curIdx)) {
      visited.add(curIdx);
      cycle.push(curIdx);

      const next = desiredTarget.get(curIdx);

      if (next === undefined || next === curIdx) break;

      curIdx = next;
    }

    if (cycle.length < 2) continue;

    for (let i = cycle.length - 1; i > 0; --i) {
      const firstIdx = cycle[i - 1]!;
      const secondIdx = cycle[i]!;

      plan.m_steps.push({
        m_firstIndex: firstIdx,
        m_secondIndex: secondIdx,
        m_firstUnit: aCandidates[firstIdx]!.m_currentUnit,
        m_secondUnit: aCandidates[secondIdx]!.m_currentUnit,
      });
      plan.m_swappedCandidateIndices.add(firstIdx);
      plan.m_swappedCandidateIndices.add(secondIdx);
    }
  }

  return plan;
}

/** `BACK_ANNOTATE::PCB_FP_DATA`: container for Pcbnew footprint data. */
export class PCB_FP_DATA {
  constructor(
    public m_ref: string,
    public m_footprint: string,
    public m_value: string,
    public m_DNP: boolean,
    public m_excludeFromBOM: boolean,
    public m_excludeFromPosFiles: boolean,
    public m_pinMap: Map<string, string>,
    public m_fieldsMap: Map<string, string>,
  ) {}
}

/** `CHANGELIST_ITEM`: `std::pair<SCH_REFERENCE, std::shared_ptr<PCB_FP_DATA>>`. */
type CHANGELIST_ITEM = [SCH_REFERENCE, PCB_FP_DATA];

/**
 * Back annotation algorithm class used to receive, check, and apply a NETLIST from Pcbnew.
 *
 * The following checks are made:
 * - Schematic symbol exists, but linked Pcbnew footprint missing.
 * - Pcbnew footprint exists but no schematic symbol connected to.
 * - Pcbnew footprint is standalone.
 * - Schematic sheet is reused one or more times and user trying to change footprint or value
 *   only for few of them.
 * - Schematic symbols share same path.
 * - More than one Pcbnew footprint linked to same path.
 */
export class BACK_ANNOTATE {
  private readonly m_reporter: Reporter;
  private readonly m_matchByReference: boolean;
  private readonly m_processFootprints: boolean;
  private readonly m_processValues: boolean;
  private readonly m_processReferences: boolean;
  private readonly m_processNetNames: boolean;
  private readonly m_processAttributes: boolean;
  private readonly m_processOtherFields: boolean;
  private readonly m_preferUnitSwaps: boolean;
  private readonly m_preferPinSwaps: boolean;
  private readonly m_dryRun: boolean;

  /** `PCB_FOOTPRINTS_MAP`: path (or reference, when re-linking) -> footprint data. */
  private readonly m_pcbFootprints = new Map<string, PCB_FP_DATA>();
  private readonly m_refs = new SCH_REFERENCE_LIST();
  private readonly m_multiUnitsRefs: SCH_MULTI_UNIT_REFERENCE_MAP = new Map();
  private readonly m_changelist: CHANGELIST_ITEM[] = [];
  private readonly m_frame: SCH_EDIT_FRAME;
  /** Number of user-level changes. */
  private m_changesCount = 0;

  constructor(
    aFrame: SCH_EDIT_FRAME,
    aReporter: Reporter,
    aRelinkFootprints: boolean,
    aProcessFootprints: boolean,
    aProcessValues: boolean,
    aProcessReferences: boolean,
    aProcessNetNames: boolean,
    aProcessAttributes: boolean,
    aProcessOtherFields: boolean,
    aPreferUnitSwaps: boolean,
    aPreferPinSwaps: boolean,
    aDryRun: boolean,
  ) {
    this.m_reporter = aReporter;
    this.m_matchByReference = aRelinkFootprints;
    this.m_processFootprints = aProcessFootprints;
    this.m_processValues = aProcessValues;
    this.m_processReferences = aProcessReferences;
    this.m_processNetNames = aProcessNetNames;
    this.m_processAttributes = aProcessAttributes;
    this.m_processOtherFields = aProcessOtherFields;
    this.m_preferUnitSwaps = aPreferUnitSwaps;
    this.m_preferPinSwaps = aPreferPinSwaps;
    this.m_dryRun = aDryRun;
    this.m_frame = aFrame;
  }

  /**
   * Run back annotation algorithm. If any errors, back annotation doesn't run.
   *
   * @param aNetlist is the netlist to use for back annotation.
   * @return true if back annotation completed success.
   */
  BackAnnotateSymbols(aNetlist: string): boolean {
    this.m_changesCount = 0;

    if (
      !this.m_matchByReference &&
      !this.m_processValues &&
      !this.m_processFootprints &&
      !this.m_processReferences &&
      !this.m_processNetNames &&
      !this.m_processAttributes &&
      !this.m_processOtherFields
    ) {
      this.m_reporter.ReportTail(
        _('Select at least one property to back annotate.'),
        RPT_SEVERITY_ERROR,
      );
      return false;
    }

    this.getPcbModulesFromString(aNetlist);

    const sheets = this.m_frame.Schematic().Hierarchy();
    sheets.GetSymbols(this.m_refs, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);
    sheets.GetMultiUnitSymbols(this.m_multiUnitsRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

    this.getChangeList();
    this.checkForUnusedSymbols();

    this.applyChangelist();
    return true;
  }

  /**
   * Get netlist from the Pcbnew.
   *
   * Upstream opens the board editor off screen when it is not running
   * (`Kiway().Player( FRAME_PCB_EDITOR, true )` + OpenProjectFiles) and mails it. A frame here
   * mounts asynchronously, so a board editor that is not running is answered by the headless
   * provider instead (browser/headless_pcb_netlist.ts), which holds what that off-screen frame
   * would have answered. `Kiface().IsSingle()` is never true here: there is no stand-alone
   * schematic editor.
   *
   * @return true if success.
   */
  FetchNetlistFromPCB(aNetlist: { value: string }): boolean {
    const kiway = this.m_frame.Kiway();

    if (kiway?.GetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR)) {
      const payload = { value: '' };
      kiway.ExpressMail(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_PCB_GET_NETLIST, payload);
      aNetlist.value = payload.value;
    } else {
      aNetlist.value = headlessPcbNetlist() ?? '';
    }

    return true;
  }

  PushNewLinksToPCB(): void {
    const nullPayload = { value: '' };

    this.m_frame
      .Kiway()
      ?.ExpressMail(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_PCB_UPDATE_LINKS, nullPayload);
  }

  /** The number of user-level changes the last run made (or would make, dry). */
  GetChangesCount(): number {
    return this.m_changesCount;
  }

  /**
   * Parse netlist sent over KiWay express mail interface and fill `m_pcbFootprints`.
   *
   * NOTE: KiCad's PTREE scanner constructs a property *name* tree, not a property tree.
   * Every token in the s-expr is stored as a property name; the property's value is then
   * either the nested s-exprs or an empty PTREE; there are *no* literal property values.
   */
  private getPcbModulesFromString(aPayload: string): void {
    const getStr = (pt: PTREE): string => pt.front()[0];

    const lexer = new DSNLEXER(aPayload, 'getPcbModulesFromString');
    const doc = new PTREE();

    Scan(doc, lexer);

    const tree = doc.get_child('pcb_netlist');
    let msg: string;
    this.m_pcbFootprints.clear();

    for (const [itemKey, itemTree] of tree) {
      let path = '';
      let value = '';
      let footprint = '';
      let dnp = false;
      let exBOM = false;
      let exPosFiles = false;
      const pinNetMap = new Map<string, string>();
      const fieldsMap = new Map<string, string>();
      console.assert(itemKey === 'ref');
      const ref = getStr(itemTree);

      try {
        if (this.m_matchByReference) path = ref;
        else path = getStr(itemTree.get_child('timestamp'));

        if (path === '') {
          msg = `Footprint '${DescribeRef(ref)}' has no assigned symbol.`;
          this.m_reporter.ReportHead(msg, RPT_SEVERITY_WARNING);
          continue;
        }

        footprint = getStr(itemTree.get_child('fpid'));
        value = getStr(itemTree.get_child('value'));

        // Get child PTREE of fields
        const fields = itemTree.get_child_optional('fields');

        // Parse each field out of the fields string
        if (fields) {
          for (const [fieldKey, fieldTree] of fields) {
            if (fieldKey !== 'field') continue;

            // Fields are of the format "(field (name "name") "12345")
            const fieldName = fieldTree.get_child_optional('name');
            const fieldValue = fieldTree.back()[0];

            if (!fieldName) continue;

            fieldsMap.set(getStr(fieldName), fieldValue);
          }
        }

        // Get DNP, Exclude from BOM, and Exclude from Position Files out of the
        // properties if they exist
        for (const [childKey, property] of itemTree) {
          if (childKey !== 'property') continue;

          const name = property.get_child_optional('name');

          if (!name) continue;

          if (name.front()[0] === 'dnp') dnp = true;
          else if (name.front()[0] === 'exclude_from_bom') exBOM = true;
          else if (name.front()[0] === 'exclude_from_pos_files') exPosFiles = true;
        }

        const nets = itemTree.get_child_optional('nets');

        if (nets) {
          for (const [pinNetKey, pinNet] of nets) {
            console.assert(pinNetKey === 'pin_net');
            const pinNumber = pinNet.front()[0];
            const netName = pinNet.back()[0];
            pinNetMap.set(pinNumber, netName);
          }
        }
      } catch {
        console.warn('Cannot parse PCB netlist for back-annotation.');
      }

      const existing = this.m_pcbFootprints.get(path);

      if (existing) {
        // Module with this path already exists - generate error
        msg = `Footprints '${DescribeRef(existing.m_ref)}' and '${DescribeRef(ref)}' linked to same symbol.`;
        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ERROR);
      } else {
        // Add footprint to the map
        this.m_pcbFootprints.set(
          path,
          new PCB_FP_DATA(ref, footprint, value, dnp, exBOM, exPosFiles, pinNetMap, fieldsMap),
        );
      }
    }
  }

  /** Create changelist. */
  private getChangeList(): void {
    for (const [pcbPath, pcbData] of sortedEntries(this.m_pcbFootprints)) {
      let refIndex: number;
      let foundInMultiunit = false;

      for (const [, refList] of sortedEntries(this.m_multiUnitsRefs)) {
        if (this.m_matchByReference) refIndex = refList.FindRef(pcbPath);
        else refIndex = refList.FindRefByFullPath(pcbPath);

        if (refIndex >= 0) {
          // If footprint linked to multi unit symbol, we add all symbol's units to
          // the change list
          foundInMultiunit = true;

          for (let i = 0; i < refList.GetCount(); ++i) {
            refList.at(i).GetSymbol().ClearFlags(SKIP_STRUCT);
            this.m_changelist.push([refList.at(i), pcbData]);
          }

          break;
        }
      }

      if (foundInMultiunit) continue;

      if (this.m_matchByReference) refIndex = this.m_refs.FindRef(pcbPath);
      else refIndex = this.m_refs.FindRefByFullPath(pcbPath);

      if (refIndex >= 0) {
        this.m_refs.at(refIndex).GetSymbol().ClearFlags(SKIP_STRUCT);
        this.m_changelist.push([this.m_refs.at(refIndex), pcbData]);
      } else {
        // Haven't found linked symbol in multiunits or common refs. Generate error
        this.m_reporter.ReportTail(
          `Cannot find symbol for footprint '${DescribeRef(pcbData.m_ref)}'.`,
          RPT_SEVERITY_ERROR,
        );
      }
    }
  }

  /**
   * Check if some symbols are not represented in PCB footprints and vice versa.
   *
   * `m_refs` must be sorted by path.
   *
   * 10.0.6 warns only for a symbol that IS excluded from the board, which reads inverted against
   * its message; mirrored as written.
   */
  private checkForUnusedSymbols(): void {
    this.m_refs.SortByTimeStamp();

    this.m_changelist.sort((a, b) =>
      SCH_REFERENCE_LIST.sortByTimeStamp(a[0], b[0])
        ? -1
        : SCH_REFERENCE_LIST.sortByTimeStamp(b[0], a[0])
          ? 1
          : 0,
    );

    let i = 0;

    for (const item of this.m_changelist) {
      // Refs and changelist are both sorted by paths, so we just go over m_refs and
      // generate errors before we will find m_refs member to which item linked
      while (i < this.m_refs.GetCount() && this.m_refs.at(i).GetPath() !== item[0].GetPath()) {
        const ref = this.m_refs.at(i);

        if (ref.GetSymbol().GetExcludedFromBoard()) {
          this.m_reporter.ReportTail(
            `Footprint '${DescribeRef(this.m_refs.at(i).GetRef())}' is not present on PCB. ` +
              'Corresponding symbols in schematic must be manually deleted (if desired).',
            RPT_SEVERITY_WARNING,
          );
        }

        ++i;
      }

      ++i;
    }

    if (
      this.m_matchByReference &&
      !this.m_frame.ReadyToNetlist(_('Re-linking footprints requires a fully annotated schematic.'))
    ) {
      this.m_reporter.ReportTail(_('Footprint re-linking canceled by user.'), RPT_SEVERITY_ERROR);
    }
  }

  /** Apply changelist to the schematic. */
  private applyChangelist(): void {
    const commit = new SCH_COMMIT(this.m_frame);
    let msg: string;

    const unitSwapItems = new Set<CHANGELIST_ITEM>();

    // First, optionally handle unit swaps across multi-unit symbols where possible
    // This needs to happen before the rest of the normal changelist processing,
    // because the swaps will modify the changelist
    if (this.m_processNetNames && this.m_preferUnitSwaps) {
      const debugReporter = NULL_REPORTER.GetInstance(); // Change to m_reporter for debugging

      // Group changelist items by shared PCB footprint data pointer
      const changesPerFp = new Map<PCB_FP_DATA, CHANGELIST_ITEM[]>();

      msg = `DEBUG(unit-swap): grouped changelist into ${changesPerFp.size} footprint(s) for unit-swap processing:`;

      // The changelist will have multiple entries for multi-unit symbols, each unit ref, e.g.
      // U1A, U1B will point to the same PCB_FP_DATA. Grouping by pointer allows us to handle all
      // units of a symbol together by working on all changes to the same PCB footprint at once.
      for (const item of this.m_changelist) {
        const group = changesPerFp.get(item[1]);
        if (group) group.push(item);
        else changesPerFp.set(item[1], [item]);
        msg += ` ${item[0].GetRef()}`;
      }

      debugReporter.ReportHead(msg, RPT_SEVERITY_INFO);

      // Handle all changes per footprint
      for (const [fp, changedFpItems] of changesPerFp) {
        const swappedSymbols = new Set<SCH_SYMBOL>();
        const swappedItems = new Set<CHANGELIST_ITEM>();

        // Snapshot of one schematic unit instance (ref + sheet path + nets) for matching
        interface SYM_UNIT {
          sym: SCH_SYMBOL;
          screen: SCH_SCREEN | null;
          sheetPath: SCH_SHEET_PATH;
          ref: string;
          currentUnit: number;
          // Track these so we avoid re-applying label/field changes to swapped units
          changeItem: CHANGELIST_ITEM;
          schNetsByPin: Map<string, string>; // pinNumber -> net (schematic)
          pcbNetsByPin: Map<string, string>; // pinNumber -> net (from PCB pin map)
          unitPinNumbers: string[]; // library-defined pin numbers per unit
          schNetsInUnitOrder: string[];
          pcbNetsInUnitOrder: string[];
        }

        // All symbol units for this footprint
        const symbolUnits: SYM_UNIT[] = [];

        const unitPinsByLibSymbol = new Map<LIB_SYMBOL, UNIT_PIN_INFO[]>();

        const getUnitPins = (symbol: SCH_SYMBOL | null, unitNumber: number): string[] => {
          if (unitNumber <= 0) return [];

          if (!symbol) return [];

          const libSymbol = symbol.GetLibSymbolRef();

          if (!libSymbol) return [];

          let unitInfos = unitPinsByLibSymbol.get(libSymbol);

          if (!unitInfos) {
            unitInfos = libSymbol.GetUnitPinInfo();
            unitPinsByLibSymbol.set(libSymbol, unitInfos);
          }

          if (unitNumber > unitInfos.length) return [];

          return unitInfos[unitNumber - 1]!.m_pinNumbers;
        };

        for (const changedItem of changedFpItems) {
          const ref = changedItem[0];
          const symbol = ref.GetSymbol();
          const screen = ref.GetSheetPath().LastScreen();

          if (!symbol) continue;

          let currentUnit = ref.GetUnit();

          if (currentUnit <= 0) currentUnit = symbol.GetUnitSelection(ref.GetSheetPath());

          if (currentUnit <= 0) currentUnit = symbol.GetUnit();

          // Collect nets keyed by pin number. Ordering by XY is intentionally avoided here.
          const symbolUnit: SYM_UNIT = {
            sym: symbol,
            screen,
            ref: symbol.GetRef(ref.GetSheetPath(), true),
            sheetPath: ref.GetSheetPath(),
            changeItem: changedItem,
            currentUnit,
            unitPinNumbers: getUnitPins(symbol, currentUnit),
            schNetsByPin: new Map(),
            pcbNetsByPin: new Map(),
            schNetsInUnitOrder: [],
            pcbNetsInUnitOrder: [],
          };

          const sheetPath = ref.GetSheetPath();

          for (const pin of symbol.GetPins(ref.GetSheetPath())) {
            const pinNum = pin.GetNumber();

            // PCB nets from footprint pin map
            symbolUnit.pcbNetsByPin.set(pinNum, fp.m_pinMap.get(pinNum) ?? '');

            // Schematic nets from connections
            const p = symbol.GetPin(pinNum);

            if (p) {
              const connection = p.Connection(sheetPath);
              symbolUnit.schNetsByPin.set(pinNum, connection ? connection.Name(true) : '');
            } else symbolUnit.schNetsByPin.set(pinNum, '');
          }

          symbolUnit.pcbNetsInUnitOrder = netsInUnitOrder(
            symbolUnit.unitPinNumbers,
            symbolUnit.pcbNetsByPin,
          );
          symbolUnit.schNetsInUnitOrder = netsInUnitOrder(
            symbolUnit.unitPinNumbers,
            symbolUnit.schNetsByPin,
          );

          symbolUnits.push(symbolUnit);
        }

        const vectorToString = (values: readonly string[]): string => values.join(', ');

        const mapToString = (pinMap: ReadonlyMap<string, string>): string =>
          vectorToString(sortedEntries(pinMap).map(([k, v]) => `${k}=${v}`));

        msg = `DEBUG(unit-swap): footprint ${fp.m_ref} processed (${symbolUnits.length} units, dryRun=${this.m_dryRun ? 1 : 0}).`;
        debugReporter.ReportHead(msg, RPT_SEVERITY_INFO);

        // For debugging, sort the symbol units by ref
        symbolUnits.sort((a, b) => cmp(a.ref, b.ref));

        for (const su of symbolUnits) {
          msg =
            `DEBUG(unit-swap):   unit ${su.currentUnit}: ${su.ref} pcbPins[${mapToString(su.pcbNetsByPin)}] ` +
            `schPins[${mapToString(su.schNetsByPin)}] unitPins[${vectorToString(su.unitPinNumbers)}] ` +
            `pcbUnitNets[${vectorToString(su.pcbNetsInUnitOrder)}] schUnitNets[${vectorToString(su.schNetsInUnitOrder)}].`;
          debugReporter.ReportHead(msg, RPT_SEVERITY_INFO);
        }

        if (symbolUnits.length < 2) continue;

        const candidates: BACKANNOTATE_UNIT_SWAP_CANDIDATE[] = symbolUnits.map((symbolUnit) => ({
          m_ref: symbolUnit.ref,
          m_currentUnit: symbolUnit.currentUnit,
          m_schNetsByPin: symbolUnit.schNetsByPin,
          m_unitPinNumbers: symbolUnit.unitPinNumbers,
        }));

        const plan = PlanBackannotateUnitSwaps(candidates, fp.m_pinMap);

        if (!plan.m_mappingOk) {
          msg = `DEBUG(unit-swap): mapping failed for footprint ${fp.m_ref}.`;
          debugReporter.ReportHead(msg, RPT_SEVERITY_INFO);
          continue;
        }

        if (plan.m_identity) {
          msg = `DEBUG(unit-swap): footprint ${fp.m_ref} already aligned (identity mapping).`;
          debugReporter.ReportHead(msg, RPT_SEVERITY_INFO);
          continue;
        }

        if (!this.m_dryRun) {
          // std::set<size_t> iterates in index order.
          for (const candidateIdx of [...plan.m_swappedCandidateIndices].sort((a, b) => a - b))
            commit.Modify(symbolUnits[candidateIdx]!.sym, symbolUnits[candidateIdx]!.screen);
        }

        for (const step of plan.m_steps) {
          const a = symbolUnits[step.m_firstIndex]!;
          const b = symbolUnits[step.m_secondIndex]!;
          const aUnit = a.currentUnit;
          const bUnit = b.currentUnit;

          if (!this.m_dryRun) {
            a.sym.SetUnit(bUnit);
            b.sym.SetUnit(aUnit);

            a.sym.SetUnitSelection(a.sheetPath, bUnit);
            b.sym.SetUnitSelection(b.sheetPath, aUnit);
          }

          a.currentUnit = bUnit;
          b.currentUnit = aUnit;

          swappedSymbols.add(a.sym);
          swappedSymbols.add(b.sym);

          swappedItems.add(a.changeItem);
          unitSwapItems.add(a.changeItem);

          swappedItems.add(b.changeItem);
          unitSwapItems.add(b.changeItem);

          const baseRef = a.sym.GetRef(a.sheetPath, false);
          let unitAString = a.sym.SubReference(aUnit, false);
          let unitBString = b.sym.SubReference(bUnit, false);

          if (unitAString === '') unitAString = `${aUnit}`;

          if (unitBString === '') unitBString = `${bUnit}`;

          msg = `Swap ${DescribeRef(baseRef)} unit ${unitAString} with unit ${unitBString}.`;
          this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
          ++this.m_changesCount;
        }

        msg = `DEBUG(unit-swap): applied ${plan.m_steps.length} swap steps for footprint ${fp.m_ref}.`;
        debugReporter.ReportHead(msg, RPT_SEVERITY_INFO);

        // Remove label updates for swapped symbols by marking their SKIP_STRUCT flag
        if (!this.m_dryRun) {
          for (const changedItem of changedFpItems) {
            const symbol = changedItem[0].GetSymbol();

            if (!symbol) continue;

            if (swappedItems.has(changedItem) || swappedSymbols.has(symbol))
              symbol.SetFlags(SKIP_STRUCT);

            const updatedUnit = symbol.GetUnitSelection(changedItem[0].GetSheetPath());
            changedItem[0].SetUnit(updatedUnit);
          }
        }
      }
    }

    // Apply changes from change list
    for (const item of this.m_changelist) {
      const ref = item[0];
      const fpData = item[1];
      const symbol = ref.GetSymbol();
      const screen = ref.GetSheetPath().LastScreen();
      const oldFootprint = ref.GetFootprint();
      const oldValue = ref.GetValue();
      const oldDNP = ref.GetSymbol().GetDNP();
      const oldExBOM = ref.GetSymbol().GetExcludedFromBOM();
      const oldExPosFiles = ref.GetSymbol().GetExcludedFromPosFiles();
      // Skip prevents us from re-applying label/field changes to units we just swapped
      const skip = (ref.GetSymbol().GetFlags() & SKIP_STRUCT) > 0 || unitSwapItems.has(item);

      const boolString = (b: boolean): string => (b ? _('true') : _('false'));

      if (!this.m_dryRun) commit.Modify(symbol, screen, RECURSE_MODE.NO_RECURSE);

      if (
        this.m_processReferences &&
        ref.GetRef() !== fpData.m_ref &&
        !skip &&
        !symbol.GetField(FIELD_T.REFERENCE)!.HasTextVars()
      ) {
        ++this.m_changesCount;
        msg = `Change ${DescribeRef(ref.GetRef())} reference designator to '${fpData.m_ref}'.`;

        if (!this.m_dryRun) symbol.SetRef(ref.GetSheetPath(), fpData.m_ref);

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
      }

      if (
        this.m_processFootprints &&
        oldFootprint !== fpData.m_footprint &&
        !skip &&
        !symbol.GetField(FIELD_T.FOOTPRINT)!.HasTextVars()
      ) {
        ++this.m_changesCount;
        msg =
          `Change ${DescribeRef(ref.GetRef())} footprint assignment from ` +
          `'${EscapeHTML(oldFootprint)}' to '${EscapeHTML(fpData.m_footprint)}'.`;

        if (!this.m_dryRun) symbol.SetFootprintFieldText(fpData.m_footprint);

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
      }

      if (
        this.m_processValues &&
        oldValue !== fpData.m_value &&
        !skip &&
        !symbol.GetField(FIELD_T.VALUE)!.HasTextVars()
      ) {
        ++this.m_changesCount;
        msg =
          `Change ${DescribeRef(ref.GetRef())} value from ` +
          `'${EscapeHTML(oldValue)}' to '${EscapeHTML(fpData.m_value)}'.`;

        if (!this.m_dryRun) symbol.SetValueFieldText(fpData.m_value);

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
      }

      if (this.m_processAttributes && oldDNP !== fpData.m_DNP && !skip) {
        ++this.m_changesCount;
        msg =
          `Change ${DescribeRef(ref.GetRef())} 'Do not populate' from ` +
          `'${boolString(oldDNP)}' to '${boolString(fpData.m_DNP)}'.`;

        if (!this.m_dryRun) symbol.SetDNP(fpData.m_DNP);

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
      }

      if (this.m_processAttributes && oldExBOM !== fpData.m_excludeFromBOM && !skip) {
        ++this.m_changesCount;
        msg =
          `Change ${DescribeRef(ref.GetRef())} 'Exclude from bill of materials' from ` +
          `'${boolString(oldExBOM)}' to '${boolString(fpData.m_excludeFromBOM)}'.`;

        if (!this.m_dryRun) symbol.SetExcludedFromBOM(fpData.m_excludeFromBOM);

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
      }

      if (this.m_processAttributes && oldExPosFiles !== fpData.m_excludeFromPosFiles && !skip) {
        ++this.m_changesCount;
        msg =
          `Change ${DescribeRef(ref.GetRef())} 'Exclude from position files' from ` +
          `'${boolString(oldExPosFiles)}' to '${boolString(fpData.m_excludeFromPosFiles)}'.`;

        if (!this.m_dryRun) symbol.SetExcludedFromPosFiles(fpData.m_excludeFromPosFiles);

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
      }

      let swappedPins = new Set<string>();

      // Try to satisfy footprint pad net swaps by moving symbol pins before falling back to labels.
      if (this.m_preferPinSwaps && this.m_processNetNames && !skip)
        swappedPins = this.applyPinSwaps(symbol, ref, fpData, commit);

      if (this.m_processNetNames && !skip) {
        for (const [pinNumber, shortNetName] of sortedEntries(fpData.m_pinMap)) {
          const pin = symbol.GetPin(pinNumber);

          // Skip pins that the user preferred to handle with pin swaps in applyPinSwaps()
          if (swappedPins.has(pinNumber)) continue;

          if (!pin) {
            msg = `Cannot find ${DescribeRef(ref.GetRef())} pin '${EscapeHTML(pinNumber)}'.`;
            this.m_reporter.ReportHead(msg, RPT_SEVERITY_ERROR);

            continue;
          }

          const connection = pin.Connection(ref.GetSheetPath());

          if (connection && connection.Name(true) !== shortNetName) {
            this.processNetNameChange(
              commit,
              ref.GetRef(),
              pin,
              connection,
              connection.Name(true),
              shortNetName,
            );
          }
        }
      }

      if (this.m_processOtherFields) {
        // Need to handle three cases: existing field, new field, deleted field
        for (const [fpFieldName, fpFieldValue] of sortedEntries(fpData.m_fieldsMap)) {
          const symField = symbol.GetField(fpFieldName);

          // Skip fields that are individually controlled
          if (
            fpFieldName === GetCanonicalFieldName(FIELD_T.REFERENCE) ||
            fpFieldName === GetCanonicalFieldName(FIELD_T.VALUE)
          ) {
            continue;
          }

          // 1. Existing fields has changed value
          // PCB Field value is checked against the shown text because this is the value
          // with all the variables resolved. The footprints field value gets the symbol's
          // resolved value when the PCB is updated from the schematic.
          if (
            symField &&
            !symField.HasTextVars() &&
            symField.GetShownText(ref.GetSheetPath(), false) !== fpFieldValue
          ) {
            this.m_changesCount++;
            msg =
              `Change ${DescribeRef(ref.GetRef())} field '${EscapeHTML(symField.GetCanonicalName())}' ` +
              `value to '${EscapeHTML(fpFieldValue)}'.`;

            if (!this.m_dryRun) symField.SetText(fpFieldValue);

            this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
          }

          // 2. New field has been added to footprint and needs to be added to symbol
          if (symField === null) {
            this.m_changesCount++;
            msg =
              `Add ${DescribeRef(ref.GetRef())} field '${EscapeHTML(fpFieldName)}' ` +
              `with value '${EscapeHTML(fpFieldValue)}'.`;

            if (!this.m_dryRun) {
              const newField = new SCH_FIELD(symbol, FIELD_T.USER, fpFieldName);
              newField.SetText(fpFieldValue);
              newField.SetTextPos(symbol.GetPosition());
              newField.SetVisible(false); // Don't clutter up the schematic
              symbol.AddField(newField);
            }

            this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
          }
        }

        // 3. Existing field has been deleted from footprint and needs to be deleted from symbol
        // Check all symbol fields for existence in the footprint field map.
        // Collect names first to avoid iterator invalidation when removing fields.
        const fieldsToDelete: string[] = [];

        for (const field of symbol.GetFields()) {
          if (field.IsMandatory()) continue;

          if (!fpData.m_fieldsMap.has(field.GetCanonicalName())) {
            this.m_changesCount++;
            msg = `Delete ${DescribeRef(ref.GetRef())} field '${EscapeHTML(field.GetName())}.'`;

            fieldsToDelete.push(field.GetName());
            this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
          }
        }

        if (!this.m_dryRun) {
          for (const fieldName of fieldsToDelete) symbol.RemoveField(fieldName);
        }
      }

      if (symbol.GetFlags() & SKIP_STRUCT) symbol.ClearFlags(SKIP_STRUCT);

      unitSwapItems.delete(item);

      // TODO: back-annotate netclass changes?
    }

    if (!this.m_dryRun) {
      this.m_frame.RecalculateConnections(commit, SCH_CLEANUP_FLAGS.NO_CLEANUP);
      this.m_frame.UpdateNetHighlightStatus();

      commit.Push(_('Update Schematic from PCB'));
    }
  }

  /** Handle footprint pad net swaps with symbol pin swaps where possible. */
  private applyPinSwaps(
    aSymbol: SCH_SYMBOL,
    aReference: SCH_REFERENCE,
    aFpData: PCB_FP_DATA,
    aCommit: SCH_COMMIT,
  ): Set<string> {
    // Tracks pin numbers that we end up swapping so that the caller can skip any
    // duplicate label-only handling for those pins.
    const swappedPins = new Set<string>();

    if (!aSymbol) return swappedPins;

    const screen = aReference.GetSheetPath().LastScreen();

    if (!screen) return swappedPins;

    // Used to build the list of schematic pins whose current net assignment does not match the PCB.
    interface PIN_CHANGE {
      pin: SCH_PIN;
      pinNumber: string;
      currentNet: string;
      targetNet: string;
    }

    const mismatches: PIN_CHANGE[] = [];

    // Helper map that lets us find all pins currently on a given net.
    const pinsByCurrentNet = new Map<string, number[]>();

    // Build the mismatch list by inspecting each footprint pin that differs from the schematic.
    for (const [pinNumber, desiredNet] of sortedEntries(aFpData.m_pinMap)) {
      const pin = aSymbol.GetPin(pinNumber);

      // Ignore power pins and anything marked as non-connectable. Power pins can map to
      // hidden/global references, e.g. implicit power connections on logic symbols.
      if (!pin || pin.IsPower() || !pin.IsConnectable()) continue;

      const connection = pin.Connection(aReference.GetSheetPath());
      const currentNet = connection ? connection.Name(true) : '';

      if (desiredNet === '' || currentNet === '') continue;

      if (desiredNet === currentNet) continue;

      const idx = mismatches.length;
      mismatches.push({ pin, pinNumber, currentNet, targetNet: desiredNet });
      const list = pinsByCurrentNet.get(currentNet);
      if (list) list.push(idx);
      else pinsByCurrentNet.set(currentNet, [idx]);
    }

    if (mismatches.length < 2) return swappedPins;

    // Track which mismatch entries we have already consumed, and the underlying pin objects
    // we still need to clean up wiring around once the geometry swap is done.
    const handled = mismatches.map(() => false);
    const swappedPinObjects: SCH_PIN[] = [];
    let swappedLibPins = false;
    let msg: string;

    let allowPinSwaps = false;
    const currentProjectName = this.m_frame.Prj().GetProjectName();

    const cfg = this.m_frame.eeconfig();

    if (cfg) allowPinSwaps = cfg.input.allow_unconstrained_pin_swaps;

    const sharedSheetPaths = new Set<string>();
    const sharedProjectNames = new Set<string>();
    const sharedSheetSymbol = SymbolHasSheetInstances(
      aSymbol,
      currentProjectName,
      sharedSheetPaths,
      sharedProjectNames,
    );

    let friendlySheetNames = new Set<string>();

    if (sharedSheetSymbol && sharedSheetPaths.size > 0)
      friendlySheetNames = GetSheetNamesFromPaths(sharedSheetPaths, this.m_frame.Schematic());

    // Check each mismatch and try to find a partner whose desired net matches our current net
    // (i.e. the two pins have been swapped on the PCB).
    for (let i = 0; i < mismatches.length; ++i) {
      // Skip entries already handled by a previous successful swap.
      if (handled[i]) continue;

      const change = mismatches[i]!;

      // Find candidate pins whose current net equals the net we want to move this pin to.
      const range = pinsByCurrentNet.get(change.targetNet);

      // Nobody currently on the desired net, so there's no reciprocal swap to apply.
      if (!range) continue;

      // Track the best partner index in case we discover a reciprocal mismatch below.
      let partnerIdx = -1;

      // Examine every pin that presently lives on the net we want to move to.
      for (const candidateIdx of range) {
        if (candidateIdx === i || handled[candidateIdx]) continue;

        const candidate = mismatches[candidateIdx]!;

        // Potential swap partner must want to move to our current net, i.e. the PCB swapped the
        // two nets between these pins.
        if (candidate.targetNet === change.currentNet) {
          partnerIdx = candidateIdx;
          break;
        }
      }

      // No viable partner found; either there was no reciprocal net mismatch or it was already
      // consumed. Leave this entry for label-based handling.
      if (partnerIdx < 0) continue;

      const partner = mismatches[partnerIdx]!;

      // Sanity check: both pins must belong to the same schematic symbol before we swap geometry;
      // this prevents us from moving pin outlines between different units of a multi-unit symbol.
      if (change.pin.GetParentSymbol() !== partner.pin.GetParentSymbol()) continue;

      if (!allowPinSwaps || sharedSheetSymbol) {
        const a = EscapeHTML(change.pin.GetShownNumber());
        const b = EscapeHTML(partner.pin.GetShownNumber());

        if (sharedProjectNames.size > 0) {
          const otherProjects: string[] = [];

          // std::set<wxString> iterates in key order.
          for (const name of [...sharedProjectNames].sort(cmp)) {
            if (currentProjectName !== '' && name === currentProjectName) continue;

            otherProjects.push(name);
          }

          const projects = AccumulateDescriptions(otherProjects);

          if (projects === '') {
            msg =
              `Would swap ${DescribeRef(aReference.GetRef())} pins ${a} and ${b} to match PCB, ` +
              'but the symbol is shared across other projects.';
          } else {
            // 10.0.6 passes the bare reference here, not DescribeRef( … ); mirrored.
            msg =
              `Would swap ${aReference.GetRef()} pins ${a} and ${b} to match PCB, but the symbol ` +
              `is shared across other projects (${projects}).`;
          }
        } else if (friendlySheetNames.size > 0) {
          const sheets = AccumulateDescriptions([...friendlySheetNames].sort(cmp));

          msg =
            `Would swap ${DescribeRef(aReference.GetRef())} pins ${a} and ${b} to match PCB, ` +
            `but the symbol is used by multiple sheet instances (${sheets}).`;
        } else if (sharedSheetSymbol) {
          msg =
            `Would swap ${DescribeRef(aReference.GetRef())} pins ${a} and ${b} to match PCB, ` +
            'but the symbol is shared.';
        } else {
          msg =
            `Would swap ${DescribeRef(aReference.GetRef())} pins ${a} and ${b} to match PCB, ` +
            'but unconstrained pin swaps are disabled in the schematic preferences.';
        }

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_INFO);

        handled[i] = true;
        handled[partnerIdx] = true;
        continue;
      }

      if (!this.m_dryRun) {
        // Record the two pins in the commit and physically swap their local geometry.
        aCommit.Modify(change.pin, screen, RECURSE_MODE.RECURSE);
        aCommit.Modify(partner.pin, screen, RECURSE_MODE.RECURSE);

        swappedLibPins = SwapPinGeometry(change.pin, partner.pin) || swappedLibPins;
      }

      // Don't pick either entry again for another pairing.
      handled[i] = true;
      handled[partnerIdx] = true;

      // Remember which pin numbers we touched so the caller can suppress duplicate work.
      swappedPins.add(change.pinNumber);
      swappedPins.add(partner.pinNumber);
      swappedPinObjects.push(change.pin);
      swappedPinObjects.push(partner.pin);

      ++this.m_changesCount;

      msg =
        `Swap ${DescribeRef(aReference.GetRef())} pins ${EscapeHTML(change.pin.GetShownNumber())} ` +
        `and ${EscapeHTML(partner.pin.GetShownNumber())} to match PCB.`;
      this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
    }

    // Nothing left to do if we didn't find a valid swap pair when we were in dry-run mode.
    if (swappedPinObjects.length === 0) return swappedPins;

    if (!this.m_dryRun) {
      if (swappedLibPins) aSymbol.UpdatePins();

      this.m_frame.UpdateItem(aSymbol, false, true);

      const toolMgr = this.m_frame.GetToolManager();
      const lwbTool = toolMgr?.GetTool(SCH_LINE_WIRE_BUS_TOOL);

      if (lwbTool) {
        const cleanupSelection = new SCH_SELECTION(screen);

        // Make sure we tidy up any wires connected to the pins whose geometry just moved.
        for (const swappedPin of swappedPinObjects) cleanupSelection.Add(swappedPin);

        lwbTool.TrimOverLappingWires(aCommit, cleanupSelection);
        lwbTool.AddJunctionsIfNeeded(aCommit, cleanupSelection);
      }

      this.m_frame.Schematic().CleanUp(aCommit);
    }

    return swappedPins;
  }

  private processNetNameChange(
    aCommit: SCH_COMMIT,
    aRef: string,
    aPin: SCH_PIN,
    aConnection: SCH_CONNECTION,
    aOldName: string,
    aNewName: string,
  ): void {
    let msg: string;

    // Find a physically-connected driver.  We can't use the SCH_CONNECTION's m_driver because
    // it has already been resolved by merging subgraphs with the same label, etc., and our
    // name change may cause that resolution to change.

    const connectedItems = new Set<SCH_ITEM>();
    let driver: SCH_ITEM | null = null;
    let driverPriority: number = CONNECTION_SUBGRAPH.PRIORITY.NONE;

    addConnections(aPin, aConnection.Sheet(), connectedItems);

    for (const item of connectedItems) {
      const priority = CONNECTION_SUBGRAPH.GetDriverPriority(item);

      if (priority > driverPriority) {
        driver = item;
        driverPriority = priority;
      }
    }

    switch (driver!.Type()) {
      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_SHEET_PIN_T:
        ++this.m_changesCount;

        msg =
          `Change ${DescribeRef(aRef)} pin ${EscapeHTML(aPin.GetShownNumber())} net label from ` +
          `'${EscapeHTML(aOldName)}' to '${EscapeHTML(aNewName)}'.`;

        if (!this.m_dryRun) {
          aCommit.Modify(driver!, aConnection.Sheet().LastScreen());
          (driver as SCH_LABEL_BASE).SetText(aNewName);
        }

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
        break;

      case KICAD_T.SCH_PIN_T: {
        if ((driver as SCH_PIN).IsPower()) {
          msg =
            `Net ${EscapeHTML(aOldName)} cannot be changed to ${EscapeHTML(aNewName)} ` +
            'because it is driven by a power pin.';

          this.m_reporter.ReportHead(msg, RPT_SEVERITY_ERROR);
          break;
        }

        // The physical connection walk could not find a label driver.  This can happen when
        // a label sits in the middle of an unsplit wire.  Fall back to the connection graph's
        // resolved driver which handles this case through subgraph merging.
        const connGraph = this.m_frame.Schematic().ConnectionGraph();
        const sg = connGraph ? connGraph.GetSubgraphForItem(aPin) : null;

        if (
          sg &&
          sg.GetDriver() &&
          sg.GetOwnDriverPriority() >= CONNECTION_SUBGRAPH.PRIORITY.LOCAL_LABEL
        ) {
          const resolvedDriver = sg.GetDriver()!;

          ++this.m_changesCount;
          msg =
            `Change ${DescribeRef(aRef)} pin ${EscapeHTML(aPin.GetShownNumber())} net label from ` +
            `'${EscapeHTML(aOldName)}' to '${EscapeHTML(aNewName)}'.`;

          if (!this.m_dryRun) {
            if (resolvedDriver.Type() === KICAD_T.SCH_PIN_T) {
              const powerPin = resolvedDriver as SCH_PIN;
              const symbol = powerPin.GetParentSymbol() as SCH_SYMBOL;

              aCommit.Modify(symbol, sg.GetSheet().LastScreen());
              symbol.GetField(FIELD_T.VALUE)!.SetText(aNewName);
            } else {
              aCommit.Modify(resolvedDriver, sg.GetSheet().LastScreen());
              (resolvedDriver as SCH_LABEL_BASE).SetText(aNewName);
            }
          }

          this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
          break;
        }

        ++this.m_changesCount;
        msg =
          `Add label '${EscapeHTML(aNewName)}' to ${DescribeRef(aRef)} pin ` +
          `${EscapeHTML(aPin.GetShownNumber())} net.`;

        if (!this.m_dryRun) {
          const settings = this.m_frame.Schematic().Settings();
          const label = new SCH_LABEL(driver!.GetPosition(), aNewName);
          label.SetParent(this.m_frame.Schematic());
          label.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });
          label.SetSpinStyle(orientLabel(driver as SCH_PIN));
          label.SetFlags(IS_NEW);

          const screen = aConnection.Sheet().LastScreen();
          aCommit.Add(label, screen);
        }

        this.m_reporter.ReportHead(msg, RPT_SEVERITY_ACTION);
        break;
      }

      default:
        break;
    }
  }
}

function orientLabel(aPin: SCH_PIN): SPIN_STYLE {
  let spin = new SPIN_STYLE(SPIN_STYLE.RIGHT);

  // Initial orientation from the pin
  switch (aPin.GetLibPin()!.GetOrientation()) {
    default:
    case PIN_ORIENTATION.PIN_RIGHT:
      spin = new SPIN_STYLE(SPIN_STYLE.LEFT);
      break;
    case PIN_ORIENTATION.PIN_UP:
      spin = new SPIN_STYLE(SPIN_STYLE.BOTTOM);
      break;
    case PIN_ORIENTATION.PIN_DOWN:
      spin = new SPIN_STYLE(SPIN_STYLE.UP);
      break;
    case PIN_ORIENTATION.PIN_LEFT:
      spin = new SPIN_STYLE(SPIN_STYLE.RIGHT);
      break;
  }

  // Reorient based on the actual symbol orientation now
  const {
    SYM_ORIENT_0,
    SYM_ORIENT_90,
    SYM_ORIENT_180,
    SYM_ORIENT_270,
    SYM_MIRROR_X,
    SYM_MIRROR_Y,
  } = SYMBOL_ORIENTATION_T;
  const orientations: { flag: number; n_rots: number; mirror_x: number; mirror_y: number }[] = [
    { flag: SYM_ORIENT_0, n_rots: 0, mirror_x: 0, mirror_y: 0 },
    { flag: SYM_ORIENT_90, n_rots: 1, mirror_x: 0, mirror_y: 0 },
    { flag: SYM_ORIENT_180, n_rots: 2, mirror_x: 0, mirror_y: 0 },
    { flag: SYM_ORIENT_270, n_rots: 3, mirror_x: 0, mirror_y: 0 },
    { flag: SYM_MIRROR_X + SYM_ORIENT_0, n_rots: 0, mirror_x: 1, mirror_y: 0 },
    { flag: SYM_MIRROR_X + SYM_ORIENT_90, n_rots: 1, mirror_x: 1, mirror_y: 0 },
    { flag: SYM_MIRROR_Y, n_rots: 0, mirror_x: 0, mirror_y: 1 },
    { flag: SYM_MIRROR_X + SYM_ORIENT_270, n_rots: 3, mirror_x: 1, mirror_y: 0 },
    { flag: SYM_MIRROR_Y + SYM_ORIENT_0, n_rots: 0, mirror_x: 0, mirror_y: 1 },
    { flag: SYM_MIRROR_Y + SYM_ORIENT_90, n_rots: 1, mirror_x: 0, mirror_y: 1 },
    { flag: SYM_MIRROR_Y + SYM_ORIENT_180, n_rots: 2, mirror_x: 0, mirror_y: 1 },
    { flag: SYM_MIRROR_Y + SYM_ORIENT_270, n_rots: 3, mirror_x: 0, mirror_y: 1 },
  ];

  let o = orientations[0]!;

  const parentSymbol = aPin.GetParentSymbol() as SCH_SYMBOL | null;

  if (!parentSymbol) return spin;

  const symbolOrientation = parentSymbol.GetOrientation();

  for (const i of orientations) {
    if (i.flag === symbolOrientation) {
      o = i;
      break;
    }
  }

  for (let i = 0; i < o.n_rots; i++) spin = spin.RotateCCW();

  if (o.mirror_x) spin = spin.MirrorX();

  if (o.mirror_y) spin = spin.MirrorY();

  return spin;
}

function addConnections(
  aItem: SCH_ITEM,
  aSheetPath: SCH_SHEET_PATH,
  connectedItems: Set<SCH_ITEM>,
): void {
  if (!connectedItems.has(aItem)) {
    connectedItems.add(aItem);

    for (const connectedItem of aItem.ConnectedItems(aSheetPath))
      addConnections(connectedItem, aSheetPath, connectedItems);
  }
}
