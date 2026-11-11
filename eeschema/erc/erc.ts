// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/erc/erc.{h,cpp}`: ERC_TESTER, the electrical rules check on the live SCHEMATIC.
 * Every test upstream's RunTests calls runs here, in its order; each appends SCH_MARKERs to the
 * screen of the sheet it found the fault on, and the connection graph's own checks run through
 * CONNECTION_GRAPH::RunERC.
 */

import { wxMatches } from '@ziroeda/wx/wxstring.js';
import {
  ExpandEnvVarSubstitutions,
  ResolveShownText,
  type TextVarResolverFn,
  FOR_ERC_DRC,
} from '@ziroeda/common/common.js';
import { electricalPinTypeGetText } from '../pin_type.js';
import {
  escapeNetName,
  expandStackedPinNotation,
  strNumCmp,
  unescapeString,
} from '@ziroeda/common/string_utils.js';

// Re-export the ERC settings surface so `@ziroeda/eeschema` consumers keep
// importing these names from the ERC module (the Schematic Setup panels do).
export {
  PIN_TYPES,
  TYPE_ABBREV,
  ERC_ITEMS,
  DEFAULT_PIN_MAP,
  DEFAULT_SEVERITIES,
  defaultErcSettings,
  type ErcCode,
  type ErcSeverity,
  type ErcSeverityLevel,
  type ErcSettings,
  type PinError,
} from './erc_settings.js';

import type { NET_MAP } from '../connection_graph.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_MARKER as SCH_MARKER_LIVE } from '../sch_marker.js';
import { multiUnitEntries, type SCH_MULTI_UNIT_REFERENCE_MAP } from '../sch_reference_list.js';
import { SCH_SCREENS } from '../sch_screen.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_PIN } from '../sch_pin.js';
import { LIB_ID as LIB_ID_LIVE } from '@ziroeda/common/lib_id.js';
import { wxCmp } from '@ziroeda/wx/wxstring.js';
import type { SCH_LABEL_BASE } from '../sch_label.js';
import type { SCH_FIELD } from '../sch_field.js';
import { SCH_SHEET_PATH as SCH_SHEET_PATH_LIVE } from '../sch_sheet_path.js';
import type { SCH_TEXT } from '../sch_text.js';
import type { SCH_TEXTBOX } from '../sch_textbox.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { type SCH_ITEM as SCH_ITEM_LIVE, SCH_ITEM as SCH_ITEM_LIVE_CLASS } from '../sch_item.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { LIBRARY_TABLE_TYPE } from '@ziroeda/common/libraries/library_table.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import {
  DS_DRAW_ITEM_LIST,
  DS_DRAW_ITEM_TEXT,
} from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import type { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { SymbolLibAdapter } from '../project_sch.js';
import { CheckDuplicatePins } from '../symbol_checker.js';
import { SIM_LIB_MGR } from '../sim/sim_lib_mgr.js';
import { WX_STRING_REPORTER } from '@ziroeda/common/reporter.js';
import type { KIFACE } from '@ziroeda/common/kiway.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import { KIFACE_ADDR_ID } from '@ziroeda/include/kiface_ids.js';

/** `typedef int (*TESTER_FN_PTR)( const wxString&, PROJECT* )` (erc.cpp, TestFootprintLinkIssues). */
type TESTER_FN_PTR = (aFootprint: string, aProject: PROJECT | null) => number;
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import { ElectricalPinTypeGetText } from '../pin_type.js';
import { strNumCmp as strNumCmpLive } from '@ziroeda/common/string_utils.js';
import { Distance } from '@ziroeda/kimath/src/math/vector2.js';
import { ERC_SCH_PIN_CONTEXT } from './erc_sch_pin_context.js';
import type { SCH_LINE } from '../sch_line.js';
import type { SCH_BUS_WIRE_ENTRY } from '../sch_bus_entry.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { ELECTRICAL_PINTYPE } from '@ziroeda/common/pin_type.js';
import { SYMBOL_FILTER, type SCH_SHEET_LIST } from '../sch_sheet_path.js';
import { SCH_CLEANUP_FLAGS, type SCHEMATIC } from '../schematic.js';
import { KICAD_T as KICAD_T_LIVE } from '@ziroeda/core/typeinfo.js';
import { ERC_ITEM } from './erc_item.js';
import {
  ERC_PIN_SORTING_METRIC,
  ERCE_T as ERCE,
  PIN_ERROR,
  type ERC_SETTINGS,
} from './erc_settings.js';
import { _ } from '@ziroeda/wx/translation.js';

// List of pin types that are considered drivers for usual input pins
// i.e. pin type = ELECTRICAL_PINTYPE::PT_INPUT, but not PT_POWER_IN
// that need only a PT_POWER_OUT pin type to be driven
const DrivingPinTypes = new Set<ELECTRICAL_PINTYPE>([
  ELECTRICAL_PINTYPE.PT_OUTPUT,
  ELECTRICAL_PINTYPE.PT_POWER_OUT,
  ELECTRICAL_PINTYPE.PT_PASSIVE,
  ELECTRICAL_PINTYPE.PT_TRISTATE,
  ELECTRICAL_PINTYPE.PT_BIDI,
]);

// List of pin types that are considered drivers for power pins
// In fact only a ELECTRICAL_PINTYPE::PT_POWER_OUT pin type can drive
// power input pins
const DrivingPowerPinTypes = new Set<ELECTRICAL_PINTYPE>([ELECTRICAL_PINTYPE.PT_POWER_OUT]);

// List of pin types that require a driver elsewhere on the net
const DrivenPinTypes = new Set<ELECTRICAL_PINTYPE>([
  ELECTRICAL_PINTYPE.PT_INPUT,
  ELECTRICAL_PINTYPE.PT_POWER_IN,
]);

/**
 * `std::map<VECTOR2I, T>`: keyed on the exact point, iterated by x then y, as KiCad's
 * `std::less<VECTOR2I>` specialization (libs/kimath/src/math/vector2.cpp) orders it. (Not
 * VECTOR2::operator<, which compares x² + y²; the specialization is what std::map uses.)
 */
class VECTOR2I_MAP<T> {
  private m_map = new Map<string, { key: VECTOR2I; value: T }>();

  constructor(private readonly m_make: () => T) {}

  private static id(aPt: VECTOR2I): string {
    return `${aPt.x},${aPt.y}`;
  }

  /** `operator[]`. */
  at(aPt: VECTOR2I): T {
    const id = VECTOR2I_MAP.id(aPt);
    let entry = this.m_map.get(id);

    if (!entry) {
      entry = { key: { x: aPt.x, y: aPt.y }, value: this.m_make() };
      this.m_map.set(id, entry);
    }

    return entry.value;
  }

  /** `count( aPt )`. */
  has(aPt: VECTOR2I): boolean {
    return this.m_map.has(VECTOR2I_MAP.id(aPt));
  }

  *[Symbol.iterator](): Iterator<[VECTOR2I, T]> {
    const entries = [...this.m_map.values()].sort((a, b) =>
      a.key.x === b.key.x ? a.key.y - b.key.y : a.key.x - b.key.x,
    );

    for (const e of entries) yield [e.key, e.value];
  }
}

export class ERC_TESTER {
  private m_schematic: SCHEMATIC;
  private m_settings: ERC_SETTINGS;
  private m_sheetList: SCH_SHEET_LIST;
  private m_screens: SCH_SCREENS;
  private m_refMap: SCH_MULTI_UNIT_REFERENCE_MAP = new Map();
  private m_nets: NET_MAP;
  private m_showAllErrors: boolean;

  constructor(aSchematic: SCHEMATIC, aShowAllErrors = false) {
    this.m_schematic = aSchematic;
    this.m_settings = aSchematic.ErcSettings();
    this.m_sheetList = aSchematic.BuildSheetListSortedByPageNumbers();
    this.m_screens = new SCH_SCREENS(aSchematic.Root());
    this.m_nets = aSchematic.ConnectionGraph().GetNetMap();
    this.m_showAllErrors = aShowAllErrors;

    this.m_sheetList.GetMultiUnitSymbols(this.m_refMap, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
  }

  /**
   * Inside a given sheet, one cannot have sheets with duplicate names (file names can be
   * duplicated).
   *
   * @return the error count
   * @param aCreateMarker true = create error markers in schematic,
   *                      false = calculate error count only
   */
  TestDuplicateSheetNames(aCreateMarker: boolean): number {
    let err_count = 0;

    for (let screen = this.m_screens.GetFirst(); screen; screen = this.m_screens.GetNext()) {
      const list = screen.Items().OfType(KICAD_T_LIVE.SCH_SHEET_T) as unknown as SCH_SHEET[];

      for (let i = 0; i < list.length; i++) {
        const sheet = list[i]!;

        for (let j = i + 1; j < list.length; j++) {
          const test_item = list[j]!;

          // We have found a second sheet: compare names
          // we are using case insensitive comparison to avoid mistakes between
          // similar names like Mysheet and mysheet
          if (
            sheet.GetShownName(false).toLowerCase() === test_item.GetShownName(false).toLowerCase()
          ) {
            if (aCreateMarker) {
              const ercItem = ERC_ITEM.Create(ERCE.ERCE_DUPLICATE_SHEET_NAME)!;
              ercItem.SetItems(sheet, test_item);
              const marker = new SCH_MARKER_LIVE(ercItem, sheet.GetPosition());
              screen.Append(marker);
            }

            err_count++;
          }
        }
      }
    }

    return err_count;
  }

  /**
   * Test for uniform units of multi-unit symbols: report the units not placed, and those of
   * them holding input, power input or bidirectional pins.
   *
   * @return the error count
   */
  TestMissingUnits(): number {
    let errors = 0;

    for (const [symbolName, refList] of multiUnitEntries(this.m_refMap)) {
      if (!refList.GetCount()) continue; // wxCHECK2

      // Reference unit
      const base_ref = refList.GetItem(0);
      const unit = base_ref.GetSymbol();
      const libSymbol = base_ref.GetLibPart()!;

      if (refList.GetCount() === libSymbol.GetUnitCount()) continue;

      const lib_units = new Set<number>();
      const instance_units = new Set<number>();
      const missing_units: number[] = [];

      const report = (
        aMissingUnits: readonly number[],
        aErrorMsg: (s: string, u: string) => string,
        aErrorCode: ERCE,
      ) => {
        let missing_pin_units = '[ ';
        let ii = 0;

        for (const missing_unit of aMissingUnits) {
          if (ii++ === 3) {
            missing_pin_units += '...';
            break;
          }

          missing_pin_units += `${libSymbol.GetUnitDisplayName(missing_unit, false)}, `;
        }

        missing_pin_units = missing_pin_units.slice(0, missing_pin_units.length - 2);
        missing_pin_units += ' ]';

        const ercItem = ERC_ITEM.Create(aErrorCode)!;
        ercItem.SetErrorMessage(aErrorMsg(symbolName, missing_pin_units));
        ercItem.SetItems(unit);
        ercItem.SetSheetSpecificPath(base_ref.GetSheetPath());
        ercItem.SetItemsSheetPaths(base_ref.GetSheetPath());

        const marker = new SCH_MARKER_LIVE(ercItem, unit.GetPosition());
        base_ref.GetSheetPath().LastScreen()!.Append(marker);

        ++errors;
      };

      for (let ii = 1; ii <= libSymbol.GetUnitCount(); ++ii) lib_units.add(ii);

      for (let ii = 0; ii < refList.GetCount(); ++ii)
        instance_units.add(refList.GetItem(ii).GetUnit());

      // std::set_difference over two std::sets: ascending.
      for (const u of [...lib_units].sort((a, b) => a - b))
        if (!instance_units.has(u)) missing_units.push(u);

      if (missing_units.length > 0 && this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_UNIT)) {
        report(
          missing_units,
          (s, u) => `Symbol ${s} has unplaced units ${u}`,
          ERCE.ERCE_MISSING_UNIT,
        );
      }

      const missing_power = new Set<number>();
      const missing_input = new Set<number>();
      const missing_bidi = new Set<number>();

      for (const missing_unit of missing_units) {
        let bodyStyle = 0;

        for (let ii = 0; ii < refList.GetCount(); ++ii) {
          if (refList.GetItem(ii).GetUnit() === missing_unit) {
            bodyStyle = refList.GetItem(ii).GetSymbol().GetBodyStyle();
            break;
          }
        }

        for (const pin of libSymbol.GetGraphicalPins(missing_unit, bodyStyle)) {
          switch (pin.GetType()) {
            case ELECTRICAL_PINTYPE.PT_POWER_IN:
              missing_power.add(missing_unit);
              break;

            case ELECTRICAL_PINTYPE.PT_BIDI:
              missing_bidi.add(missing_unit);
              break;

            case ELECTRICAL_PINTYPE.PT_INPUT:
              missing_input.add(missing_unit);
              break;

            default:
              break;
          }
        }
      }

      const ascending = (aSet: Set<number>) => [...aSet].sort((a, b) => a - b);

      if (
        missing_power.size > 0 &&
        this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_POWER_INPUT_PIN)
      ) {
        report(
          ascending(missing_power),
          (s, u) => `Symbol ${s} has input power pins in units ${u} that are not placed`,
          ERCE.ERCE_MISSING_POWER_INPUT_PIN,
        );
      }

      if (missing_input.size > 0 && this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_INPUT_PIN)) {
        report(
          ascending(missing_input),
          (s, u) => `Symbol ${s} has input pins in units ${u} that are not placed`,
          ERCE.ERCE_MISSING_INPUT_PIN,
        );
      }

      if (missing_bidi.size > 0 && this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_BIDI_PIN)) {
        report(
          ascending(missing_bidi),
          (s, u) => `Symbol ${s} has bidirectional pins in units ${u} that are not placed`,
          ERCE.ERCE_MISSING_BIDI_PIN,
        );
      }
    }

    return errors;
  }

  /**
   * Check that a pin of a multi-unit symbol is on one net in every unit that has it.
   *
   * @return the error count
   */
  TestMultUnitPinConflicts(): number {
    let errors = 0;

    const pinToNetMap = new Map<string, [string, SCH_PIN]>();

    for (const [key, subgraphs] of this.m_nets) {
      const netName = key.Name;

      for (const subgraph of subgraphs) {
        for (const item of subgraph.GetItems()) {
          if (item.Type() === KICAD_T_LIVE.SCH_PIN_T) {
            const pin = item as SCH_PIN;
            const sheet = subgraph.GetSheet();

            if (!pin.GetParentSymbol()!.IsMultiUnit()) continue;

            const name = `${pin.GetParentSymbol()!.GetRef(sheet)}:${pin.GetShownNumber()}`;
            const first = pinToNetMap.get(name);

            if (!first) {
              pinToNetMap.set(name, [netName, pin]);
            } else if (first[0] !== netName) {
              const ercItem = ERC_ITEM.Create(ERCE.ERCE_DIFFERENT_UNIT_NET)!;

              ercItem.SetErrorMessage(
                `Pin ${pin.GetShownNumber()} is connected to both ${netName} and ${first[0]}`,
              );

              ercItem.SetItems(pin, first[1]);
              ercItem.SetSheetSpecificPath(sheet);
              ercItem.SetItemsSheetPaths(sheet, sheet);

              const marker = new SCH_MARKER_LIVE(ercItem, pin.GetPosition());
              sheet.LastScreen()!.Append(marker);
              errors += 1;
            }
          }
        }
      }
    }

    return errors;
  }

  /**
   * Check the pins of each net against the pin conflict map, and that a net whose pins need a
   * driver has one.
   *
   * @return the error count
   */
  TestPinToPin(): number {
    let errors = 0;

    for (const [, subgraphs] of this.m_nets) {
      const pins: ERC_SCH_PIN_CONTEXT[] = [];
      const pinToScreenMap = new Map<SCH_PIN, SCH_SCREEN>();
      let has_noconnect = false;

      for (const subgraph of subgraphs) {
        if (subgraph.GetNoConnect()) has_noconnect = true;

        for (const item of subgraph.GetItems()) {
          if (item.Type() === KICAD_T_LIVE.SCH_PIN_T) {
            pins.push(new ERC_SCH_PIN_CONTEXT(item as SCH_PIN, subgraph.GetSheet()));
            pinToScreenMap.set(item as SCH_PIN, subgraph.GetSheet().LastScreen()!);
          }
        }
      }

      // `ret = lhs < rhs`, upstream's hash fallback, is 0 or 1 and never less than 0: a full tie
      // keeps its order (std::sort is an insertion sort below 16; Array.sort is stable).
      pins.sort((lhs, rhs) => {
        let ret = strNumCmpLive(
          lhs.Pin()!.GetParentSymbol()!.GetRef(lhs.Sheet()),
          rhs.Pin()!.GetParentSymbol()!.GetRef(rhs.Sheet()),
        );

        if (ret === 0) ret = strNumCmpLive(lhs.Pin()!.GetNumber(), rhs.Pin()!.GetNumber());

        return ret < 0 ? -1 : ret > 0 ? 1 : 0;
      });

      let needsDriver = new ERC_SCH_PIN_CONTEXT();
      let needsDriverType = ELECTRICAL_PINTYPE.PT_UNSPECIFIED;
      let hasDriver = false;
      const pinsNeedingDrivers: ERC_SCH_PIN_CONTEXT[] = [];
      const nonPowerPinsNeedingDrivers: ERC_SCH_PIN_CONTEXT[] = [];
      const powerInPinsNeedingDrivers: ERC_SCH_PIN_CONTEXT[] = [];

      // We need different drivers for power nets and normal nets.
      // A power net has at least one pin having the ELECTRICAL_PINTYPE::PT_POWER_IN
      // and power nets can be driven only by ELECTRICAL_PINTYPE::PT_POWER_OUT pins
      const ispowerNet = pins.some(
        (refPin) => refPin.Pin()!.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN,
      );

      // Iterators are indices into pins.
      const pin_mismatches: [number, number, PIN_ERROR][] = [];
      const pin_mismatch_counts = new Map<number, number>();

      for (let refIt = 0; refIt < pins.length; ++refIt) {
        const refPin = pins[refIt]!;
        const refType = refPin.Pin()!.GetType();

        if (DrivenPinTypes.has(refType)) {
          // needsDriver will be the pin shown in the error report eventually, so try to
          // upgrade to a "better" pin if possible: something visible and only a power symbol
          // if this net needs a power driver
          pinsNeedingDrivers.push(refPin);

          if (!refPin.Pin()!.IsPower()) nonPowerPinsNeedingDrivers.push(refPin);

          if (refType === ELECTRICAL_PINTYPE.PT_POWER_IN) powerInPinsNeedingDrivers.push(refPin);

          if (
            !needsDriver.Pin() ||
            (!needsDriver.Pin()!.IsVisible() && refPin.Pin()!.IsVisible()) ||
            (ispowerNet !== (needsDriverType === ELECTRICAL_PINTYPE.PT_POWER_IN) &&
              ispowerNet === (refType === ELECTRICAL_PINTYPE.PT_POWER_IN))
          ) {
            needsDriver = refPin;
            needsDriverType = needsDriver.Pin()!.GetType();
          }
        }

        if (ispowerNet) hasDriver ||= DrivingPowerPinTypes.has(refType);
        else hasDriver ||= DrivingPinTypes.has(refType);

        for (let testIt = refIt + 1; testIt < pins.length; ++testIt) {
          const testPin = pins[testIt]!;

          // Multiple pins in the same symbol that share a type,
          // name and position are considered
          // "stacked" and shouldn't trigger ERC errors
          if (refPin.Pin()!.IsStacked(testPin.Pin()!) && refPin.Sheet().equals(testPin.Sheet()))
            continue;

          const testType = testPin.Pin()!.GetType();

          if (ispowerNet) hasDriver ||= DrivingPowerPinTypes.has(testType);
          else hasDriver ||= DrivingPinTypes.has(testType);

          const erc = this.m_settings.GetPinMapValue(refType, testType);

          if (erc !== PIN_ERROR.OK && this.m_settings.IsTestEnabled(ERCE.ERCE_PIN_TO_PIN_WARNING)) {
            pin_mismatches.push([refIt, testIt, erc]);

            if (this.m_settings.GetERCSortingMetric() === ERC_PIN_SORTING_METRIC.SM_HEURISTICS) {
              pin_mismatch_counts.set(
                refIt,
                this.m_settings.GetPinTypeWeight(pins[refIt]!.Pin()!.GetType()),
              );
              pin_mismatch_counts.set(
                testIt,
                this.m_settings.GetPinTypeWeight(pins[testIt]!.Pin()!.GetType()),
              );
            } else {
              pin_mismatch_counts.set(testIt, (pin_mismatch_counts.get(testIt) ?? 0) + 1);
              pin_mismatch_counts.set(refIt, (pin_mismatch_counts.get(refIt) ?? 0) + 1);
            }
          }
        }
      }

      // std::multimap<size_t, iterator_t, std::greater<size_t>> filled through std::inserter from
      // the std::map (iterator order): count descending, equal counts in iterator order.
      const pins_dsc = [...pin_mismatch_counts]
        .sort((a, b) => a[0] - b[0])
        .map(([it, count]) => [count, it] as const)
        .sort((a, b) => b[0] - a[0]);

      for (const [, pinIt] of pins_dsc) {
        if (pin_mismatches.length === 0) break;

        const pin = pins[pinIt]!.Pin()!;
        const position = pin.GetPosition();

        let nearest_pin = -1;
        let smallest_distance = Number.POSITIVE_INFINITY;
        let erc = PIN_ERROR.OK;

        // std::erase_if
        for (let i = 0; i < pin_mismatches.length; ) {
          const tuple = pin_mismatches[i]!;
          let other: number;

          if (pinIt === tuple[0]) other = tuple[1];
          else if (pinIt === tuple[1]) other = tuple[0];
          else {
            i++;
            continue;
          }

          if (pins[pinIt]!.Sheet().Cmp(pins[other]!.Sheet()) !== 0) {
            if (smallest_distance === Number.POSITIVE_INFINITY) {
              nearest_pin = other;
              erc = tuple[2];
            }
          } else {
            const distance = Distance(position, pins[other]!.Pin()!.GetPosition());

            if (smallest_distance === Number.POSITIVE_INFINITY || distance < smallest_distance) {
              smallest_distance = distance;
              nearest_pin = other;
              erc = tuple[2];
            }
          }

          pin_mismatches.splice(i, 1);
        }

        if (nearest_pin !== -1) {
          const other_pin = pins[nearest_pin]!.Pin()!;

          const ercItem = ERC_ITEM.Create(
            erc === PIN_ERROR.WARNING ? ERCE.ERCE_PIN_TO_PIN_WARNING : ERCE.ERCE_PIN_TO_PIN_ERROR,
          )!;
          ercItem.SetItems(pin, other_pin);
          ercItem.SetSheetSpecificPath(pins[pinIt]!.Sheet());
          ercItem.SetItemsSheetPaths(pins[pinIt]!.Sheet(), pins[nearest_pin]!.Sheet());

          ercItem.SetErrorMessage(
            `Pins of type ${ElectricalPinTypeGetText(pin.GetType())} and ${ElectricalPinTypeGetText(other_pin.GetType())} are connected`,
          );

          const marker = new SCH_MARKER_LIVE(ercItem, pin.GetPosition());
          pinToScreenMap.get(pin)!.Append(marker);
          errors++;
        }
      }

      if (needsDriver.Pin() && !hasDriver && !has_noconnect) {
        const err_code = ispowerNet ? ERCE.ERCE_POWERPIN_NOT_DRIVEN : ERCE.ERCE_PIN_NOT_DRIVEN;

        if (this.m_settings.IsTestEnabled(err_code)) {
          let pinsToMark: ERC_SCH_PIN_CONTEXT[] = [];

          // The marker should land on a pin matching the error message: for an
          // ERCE_POWERPIN_NOT_DRIVEN error mark a PT_POWER_IN pin (which is what the
          // error refers to), for ERCE_PIN_NOT_DRIVEN prefer a pin that is not on a
          // power symbol so the marker is anchored to the consuming pin rather than
          // a power flag.
          if (this.m_showAllErrors) {
            if (ispowerNet && powerInPinsNeedingDrivers.length > 0)
              pinsToMark = powerInPinsNeedingDrivers;
            else if (nonPowerPinsNeedingDrivers.length > 0) pinsToMark = nonPowerPinsNeedingDrivers;
            else pinsToMark = pinsNeedingDrivers;
          } else {
            if (ispowerNet && powerInPinsNeedingDrivers.length > 0)
              pinsToMark.push(powerInPinsNeedingDrivers[0]!);
            else pinsToMark.push(needsDriver);
          }

          for (const pinCtx of pinsToMark) {
            const ercItem = ERC_ITEM.Create(err_code)!;

            ercItem.SetItems(pinCtx.Pin());
            ercItem.SetSheetSpecificPath(pinCtx.Sheet());
            ercItem.SetItemsSheetPaths(pinCtx.Sheet());

            const marker = new SCH_MARKER_LIVE(ercItem, pinCtx.Pin()!.GetPosition());
            pinToScreenMap.get(pinCtx.Pin()!)!.Append(marker);
            errors++;
          }
        }
      }
    }

    return errors;
  }

  /**
   * Test if any pin with the no-connect electrical type is connected to anything.
   *
   * @return the error count
   */
  TestNoConnectPins(): number {
    let err_count = 0;

    for (const sheet of this.m_sheetList) {
      const pinMap = new VECTOR2I_MAP<SCH_ITEM_LIVE[]>(() => []);

      const addOther = (pt: VECTOR2I, aOther: SCH_ITEM_LIVE) => {
        if (pinMap.has(pt)) pinMap.at(pt).push(aOther);
      };

      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        for (const pin of symbol.GetPins(sheet)) {
          if (pin.GetType() === ELECTRICAL_PINTYPE.PT_NC) pinMap.at(pin.GetPosition()).push(pin);
        }
      }

      for (const item of sheet.LastScreen()!.Items()) {
        if (item.Type() === KICAD_T_LIVE.SCH_SYMBOL_T) {
          const symbol = item as SCH_SYMBOL;

          for (const pin of symbol.GetPins(sheet)) {
            if (pin.GetType() !== ELECTRICAL_PINTYPE.PT_NC) addOther(pin.GetPosition(), pin);
          }
        } else if (item.IsConnectable() && item.Type() !== KICAD_T_LIVE.SCH_NO_CONNECT_T) {
          for (const pt of item.GetConnectionPoints()) addOther(pt, item);
        }
      }

      for (const [pt, items] of pinMap) {
        if (items.length > 1) {
          let all_nc = true;

          for (const item of items) {
            if (item.Type() !== KICAD_T_LIVE.SCH_PIN_T) {
              all_nc = false;
              break;
            }

            const pin = item as SCH_PIN;

            if (pin.GetType() !== ELECTRICAL_PINTYPE.PT_NC) {
              all_nc = false;
              break;
            }
          }

          if (all_nc) continue;

          err_count++;

          const ercItem = ERC_ITEM.Create(ERCE.ERCE_NOCONNECT_CONNECTED)!;

          ercItem.SetItems(
            items[0]!,
            items[1]!,
            items.length > 2 ? items[2]! : null,
            items.length > 3 ? items[3]! : null,
          );
          ercItem.SetErrorMessage(_("Pin with 'no connection' type is connected"));
          ercItem.SetSheetSpecificPath(sheet);

          const marker = new SCH_MARKER_LIVE(ercItem, pt);
          sheet.LastScreen()!.Append(marker);
        }
      }
    }

    return err_count;
  }

  /**
   * Test that power pins named as grounds are on a ground net, in symbols that have one.
   *
   * @return the error count
   */
  TestGroundPins(): number {
    let errors = 0;

    const isGround = (txt: string) => {
      const upper = txt.toUpperCase();

      return (
        upper.includes('GND') ||
        upper === 'EARTH' ||
        upper.startsWith('EARTH_') ||
        upper === 'VSS' ||
        upper === 'VSSA'
      );
    };

    for (const sheet of this.m_sheetList) {
      const screen = sheet.LastScreen()!;

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;
        let hasGroundNet = false;
        const mismatched: SCH_PIN[] = [];

        for (const pin of symbol.GetPins(sheet)) {
          const conn = pin.Connection(sheet);
          const net = conn ? conn.GetNetName() : '';
          const netIsGround = isGround(net);

          // We are only interested in power pins
          if (
            pin.GetType() !== ELECTRICAL_PINTYPE.PT_POWER_OUT &&
            pin.GetType() !== ELECTRICAL_PINTYPE.PT_POWER_IN
          ) {
            continue;
          }

          if (netIsGround) hasGroundNet = true;

          if (isGround(pin.GetShownName()) && !netIsGround) mismatched.push(pin);
        }

        if (hasGroundNet) {
          for (const pin of mismatched) {
            const ercItem = ERC_ITEM.Create(ERCE.ERCE_GROUND_PIN_NOT_GROUND)!;

            ercItem.SetErrorMessage(`Pin ${pin.GetShownName()} not connected to ground net`);
            ercItem.SetItems(pin);
            ercItem.SetSheetSpecificPath(sheet);
            ercItem.SetItemsSheetPaths(sheet);

            const marker = new SCH_MARKER_LIVE(ercItem, pin.GetPosition());
            screen.Append(marker);
            errors++;
          }
        }
      }
    }

    return errors;
  }

  /**
   * Check for labels, and power symbols' values, that differ only in letter case.
   *
   * @return the error count
   */
  TestSimilarLabels(): number {
    let errors = 0;
    // std::unordered_map<wxString, ...>: only lookup by the normalized text is observable.
    const generalMap = new Map<string, [string, SCH_ITEM_LIVE, SCH_SHEET_PATH_LIVE][]>();

    const logError = (
      item: SCH_ITEM_LIVE,
      sheet: SCH_SHEET_PATH_LIVE,
      other: [string, SCH_ITEM_LIVE, SCH_SHEET_PATH_LIVE],
    ) => {
      const [, otherItem, otherSheet] = other;
      let typeOfWarning = ERCE.ERCE_SIMILAR_LABELS;

      if (item.Type() === KICAD_T_LIVE.SCH_PIN_T && otherItem.Type() === KICAD_T_LIVE.SCH_PIN_T) {
        //Two Pins
        typeOfWarning = ERCE.ERCE_SIMILAR_POWER;
      } else if (
        item.Type() === KICAD_T_LIVE.SCH_PIN_T ||
        otherItem.Type() === KICAD_T_LIVE.SCH_PIN_T
      ) {
        //Pin and Label
        typeOfWarning = ERCE.ERCE_SIMILAR_LABEL_AND_POWER;
      } else {
        //Two Labels
        typeOfWarning = ERCE.ERCE_SIMILAR_LABELS;
      }

      const ercItem = ERC_ITEM.Create(typeOfWarning)!;
      ercItem.SetItems(item, otherItem);
      ercItem.SetSheetSpecificPath(sheet);
      ercItem.SetItemsSheetPaths(sheet, otherSheet);

      const marker = new SCH_MARKER_LIVE(ercItem, item.GetPosition());
      sheet.LastScreen()!.Append(marker);
    };

    const entries = (normalized: string) => {
      let list = generalMap.get(normalized);

      if (!list) {
        list = [];
        generalMap.set(normalized, list);
      }

      return list;
    };

    for (const [, subgraphs] of this.m_nets) {
      for (const subgraph of subgraphs) {
        const sheet = subgraph.GetSheet();

        for (const item of subgraph.GetItems()) {
          switch (item.Type()) {
            case KICAD_T_LIVE.SCH_LABEL_T:
            case KICAD_T_LIVE.SCH_HIER_LABEL_T:
            case KICAD_T_LIVE.SCH_GLOBAL_LABEL_T: {
              const label = item as SCH_LABEL_BASE;
              const unnormalized = label.GetShownText(sheet, false);
              const normalized = unnormalized.toLowerCase();
              const list = entries(normalized);

              list.push([unnormalized, label, sheet]);

              for (const otherTuple of [...list]) {
                const [otherText, otherItem, otherSheet] = otherTuple;

                if (unnormalized !== otherText) {
                  // Similar local labels on different sheets are fine
                  if (
                    item.Type() === KICAD_T_LIVE.SCH_LABEL_T &&
                    otherItem.Type() === KICAD_T_LIVE.SCH_LABEL_T &&
                    !sheet.equals(otherSheet)
                  ) {
                    continue;
                  }

                  logError(label, sheet, otherTuple);
                  errors += 1;
                }
              }

              break;
            }

            case KICAD_T_LIVE.SCH_PIN_T: {
              const pin = item as SCH_PIN;

              if (!pin.IsPower()) continue;

              const symbol = pin.GetParentSymbol() as unknown as SCH_SYMBOL;
              const unnormalized = symbol.GetValue(true, sheet, false);
              const normalized = unnormalized.toLowerCase();
              const list = entries(normalized);

              list.push([unnormalized, pin, sheet]);

              for (const otherTuple of [...list]) {
                const [otherText] = otherTuple;

                if (unnormalized !== otherText) {
                  logError(pin, sheet, otherTuple);
                  errors += 1;
                }
              }

              break;
            }

            default:
              break;
          }
        }
      }
    }

    return errors;
  }

  /**
   * Check for pins whose number uses the stacked-pin notation wrongly.
   *
   * @return the warning count
   */
  TestStackedPinNotation(): number {
    let warnings = 0;

    for (const sheet of this.m_sheetList) {
      const screen = sheet.LastScreen()!;

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        for (const pin of symbol.GetPins(sheet)) {
          const valid = { value: true };
          pin.GetStackedPinNumbers(valid);

          if (!valid.value) {
            const ercItem = ERC_ITEM.Create(ERCE.ERCE_STACKED_PIN_SYNTAX)!;
            ercItem.SetItems(pin);
            ercItem.SetSheetSpecificPath(sheet);
            ercItem.SetItemsSheetPaths(sheet);

            const marker = new SCH_MARKER_LIVE(ercItem, pin.GetPosition());
            screen.Append(marker);
            warnings++;
          }
        }
      }
    }

    return warnings;
  }

  /**
   * `TestTextVars( aDrawingSheet )` (erc.cpp:186): every field, text, text box, sheet pin and
   * symbol body text whose shown text still holds a `${...}` gets ERCE_UNRESOLVED_VARIABLE, and a
   * `${ERC_WARNING msg}` / `${ERC_ERROR msg}` assertion anywhere in a text raises that generic
   * marker instead; \a aDrawingSheet's texts are checked on every sheet too.
   */
  TestTextVars(aDrawingSheet: DS_PROXY_VIEW_ITEM | null): void {
    const wsItems = new DS_DRAW_ITEM_LIST(schIUScale, FOR_ERC_DRC);

    const project = this.m_schematic.Project();
    const resolver = (aToken: { value: string }) => project.TextVarResolver(aToken);

    // str.Matches( wxS( "*${*}*" ) )
    const hasVar = (aStr: string): boolean => /\$\{[\s\S]*\}/.test(aStr);
    const unresolved = (aStr: string): boolean => hasVar(ExpandEnvVarSubstitutions(aStr, resolver));

    const testAssertion = (
      aItem: SCH_ITEM_LIVE | null,
      aSheet: SCH_SHEET_PATH_LIVE,
      aScreen: SCH_SCREEN,
      aText: string,
      aPos: VECTOR2I,
    ): boolean => {
      // Match anywhere in the text; a `\${ERC_ERROR ...}` stays inert.
      const reportEach = (aExpr: RegExp, aErrorCode: number): boolean => {
        let found = false;
        for (const m of aText.matchAll(aExpr)) {
          found = true;
          let ercText = m[2] ?? '';
          const ercItem = ERC_ITEM.Create(aErrorCode)!;

          if (aItem) ercItem.SetItems(aItem);
          else ercText += _(' (in drawing sheet)');

          ercItem.SetSheetSpecificPath(aSheet);
          ercItem.SetErrorMessage(ercText);
          aScreen.Append(new SCH_MARKER_LIVE(ercItem, aPos));
        }
        return found;
      };

      const foundWarning = reportEach(
        /(^|[^\\])\$\{ERC_WARNING\s*([^}]*)\}/g,
        ERCE.ERCE_GENERIC_WARNING,
      );
      const foundError = reportEach(/(^|[^\\])\$\{ERC_ERROR\s*([^}]*)\}/g, ERCE.ERCE_GENERIC_ERROR);

      return foundWarning || foundError;
    };

    const report = (
      aOwner: SCH_ITEM_LIVE,
      aSheet: SCH_SHEET_PATH_LIVE,
      aScreen: SCH_SCREEN,
      aPos: VECTOR2I,
    ): void => {
      const ercItem = ERC_ITEM.Create(ERCE.ERCE_UNRESOLVED_VARIABLE)!;
      ercItem.SetItems(aOwner);
      ercItem.SetSheetSpecificPath(aSheet);
      aScreen.Append(new SCH_MARKER_LIVE(ercItem, aPos));
    };

    const testFields = (
      aOwner: SCH_ITEM_LIVE,
      aFields: readonly SCH_FIELD[],
      aSheet: SCH_SHEET_PATH_LIVE,
      aScreen: SCH_SCREEN,
    ): void => {
      for (const field of aFields) {
        if (testAssertion(field, aSheet, aScreen, field.GetText(), field.GetPosition())) {
          // Don't run unresolved test
        } else if (unresolved(field.GetShownText(aSheet, true))) {
          report(aOwner, aSheet, aScreen, field.GetPosition());
        }
      }
    };

    if (aDrawingSheet) {
      wsItems.SetPageNumber('1');
      wsItems.SetSheetCount(1);
      wsItems.SetFileName('dummyFilename');
      wsItems.SetSheetName('dummySheet');
      wsItems.SetSheetLayer('dummyLayer');
      wsItems.SetProject(project);
      wsItems.BuildDrawItemsList(aDrawingSheet.GetPageInfo(), aDrawingSheet.GetTitleBlock());
    }

    for (const sheet of this.m_sheetList) {
      const screen = sheet.LastScreen()!;

      // Snapshot before iterating: the loop body appends SCH_MARKERs to this same screen.
      const items = [...screen.Items()];

      for (const item of items) {
        const type = item.Type();

        if (type === KICAD_T_LIVE.SCH_SYMBOL_T) {
          const symbol = item as SCH_SYMBOL;
          testFields(symbol, symbol.GetFields(), sheet, screen);

          symbol.GetLibSymbolRef()?.RunOnChildren((child) => {
            if (
              child.Type() !== KICAD_T_LIVE.SCH_TEXT_T &&
              child.Type() !== KICAD_T_LIVE.SCH_TEXTBOX_T
            )
              return;

            const text = child as SCH_TEXT | SCH_TEXTBOX;
            const shown =
              child.Type() === KICAD_T_LIVE.SCH_TEXT_T
                ? (text as SCH_TEXT).GetShownText(sheet, true)
                : (text as SCH_TEXTBOX).GetShownText(null, sheet, true);

            if (testAssertion(symbol, sheet, screen, text.GetText(), text.GetPosition())) {
              // Don't run unresolved test
            } else if (unresolved(shown)) {
              const bbox = symbol.GetTransform().TransformCoordinate(text.GetBoundingBox());
              const c = bbox.Centre();
              const pos = symbol.GetPosition();
              report(symbol, sheet, screen, { x: c.x + pos.x, y: c.y + pos.y });
            }
          }, RECURSE_MODE.NO_RECURSE);
        } else if (
          type === KICAD_T_LIVE.SCH_LABEL_T ||
          type === KICAD_T_LIVE.SCH_GLOBAL_LABEL_T ||
          type === KICAD_T_LIVE.SCH_HIER_LABEL_T ||
          type === KICAD_T_LIVE.SCH_DIRECTIVE_LABEL_T
        ) {
          const label = item as unknown as SCH_LABEL_BASE;
          testFields(label as unknown as SCH_ITEM_LIVE, label.GetFields(), sheet, screen);
        } else if (type === KICAD_T_LIVE.SCH_SHEET_T) {
          const subSheet = item as unknown as SCH_SHEET;
          testFields(subSheet as unknown as SCH_ITEM_LIVE, subSheet.GetFields(), sheet, screen);

          const subSheetPath = new SCH_SHEET_PATH_LIVE(sheet);
          subSheetPath.push_back(subSheet);

          for (const pin of subSheet.GetPins()) {
            if (hasVar(pin.GetShownText(subSheetPath, true)))
              report(pin as unknown as SCH_ITEM_LIVE, sheet, screen, pin.GetPosition());
          }
        } else if (type === KICAD_T_LIVE.SCH_TEXT_T) {
          const text = item as SCH_TEXT;
          if (testAssertion(text, sheet, screen, text.GetText(), text.GetPosition())) {
            // Don't run unresolved test
          } else if (hasVar(text.GetShownText(sheet, true))) {
            report(text, sheet, screen, text.GetPosition());
          }
        } else if (type === KICAD_T_LIVE.SCH_TEXTBOX_T) {
          const textBox = item as SCH_TEXTBOX;
          if (testAssertion(textBox, sheet, screen, textBox.GetText(), textBox.GetPosition())) {
            // Don't run unresolved test
          } else if (hasVar(textBox.GetShownText(null, sheet, true))) {
            report(textBox, sheet, screen, textBox.GetPosition());
          }
        }
      }

      for (let item = wsItems.GetFirst(); item; item = wsItems.GetNext()) {
        if (!(item instanceof DS_DRAW_ITEM_TEXT)) continue;

        const text = item;

        if (testAssertion(null, sheet, screen, text.GetText(), text.GetPosition())) {
          // Don't run unresolved test
        } else if (hasVar(text.GetShownText(true))) {
          const ercItem = ERC_ITEM.Create(ERCE.ERCE_UNRESOLVED_VARIABLE)!;
          ercItem.SetErrorMessage(_('Unresolved text variable in drawing sheet'));
          ercItem.SetSheetSpecificPath(sheet);
          screen.Append(new SCH_MARKER_LIVE(ercItem, text.GetPosition()));
        }
      }
    }
  }

  /**
   * `TestLibSymbolIssues()` (erc.cpp): each placed symbol's library is configured, loaded, and
   * holds the symbol (ERCE_LIB_SYMBOL_ISSUES), and the schematic's cached copy still matches the
   * flattened library symbol (ERCE_LIB_SYMBOL_MISMATCH, skipped while the copy has duplicate pin
   * numbers that TestDuplicatePinNets judges instead).
   *
   * @return the marker count
   */
  TestLibSymbolIssues(): number {
    const manager = Pgm().GetLibraryManager();
    const adapter = SymbolLibAdapter(this.m_schematic.Project());
    let err_count = 0;

    for (let screen = this.m_screens.GetFirst(); screen; screen = this.m_screens.GetNext()) {
      const markers: SCH_MARKER_LIVE[] = [];

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;
        const libSymbolInSchematic = symbol.GetLibSymbolRef();

        if (!libSymbolInSchematic) continue;

        const libName = symbol.GetLibId().GetLibNickname();
        const row = manager.GetRow(LIBRARY_TABLE_TYPE.SYMBOL, libName);

        const issue = (aMessage: string): void => {
          const ercItem = ERC_ITEM.Create(ERCE.ERCE_LIB_SYMBOL_ISSUES)!;
          ercItem.SetItems(symbol);
          ercItem.SetErrorMessage(aMessage);
          markers.push(new SCH_MARKER_LIVE(ercItem, symbol.GetPosition()));
        };

        if (!row || row.Disabled()) {
          if (this.m_settings.IsTestEnabled(ERCE.ERCE_LIB_SYMBOL_ISSUES))
            issue(
              `The current configuration does not include the symbol library '${unescapeString(libName)}'`,
            );
          continue;
        } else if (!adapter.IsLibraryLoaded(libName)) {
          if (this.m_settings.IsTestEnabled(ERCE.ERCE_LIB_SYMBOL_ISSUES))
            issue(
              `The symbol library '${unescapeString(libName)}' was not found at '${manager.GetFullURI(row, true)}'`,
            );
          continue;
        }

        const symbolName = symbol.GetLibId().GetLibItemName();
        const libSymbol = adapter.LoadSymbol(symbol.GetLibId());

        if (!libSymbol) {
          if (this.m_settings.IsTestEnabled(ERCE.ERCE_LIB_SYMBOL_ISSUES))
            issue(
              `Symbol '${unescapeString(symbolName)}' not found in symbol library '${unescapeString(libName)}'`,
            );
          continue;
        }

        const flattenedSymbol = libSymbol.Flatten();
        const flags =
          SCH_ITEM_LIVE_CLASS.COMPARE_FLAGS.EQUALITY | SCH_ITEM_LIVE_CLASS.COMPARE_FLAGS.ERC;

        if (this.m_settings.IsTestEnabled(ERCE.ERCE_LIB_SYMBOL_MISMATCH)) {
          // Duplicate pins make Compare() fail; TestDuplicatePinNets judges those instead.
          const messages: string[] = [];

          if (!libSymbolInSchematic.GetDuplicatePinNumbersAreJumpers())
            CheckDuplicatePins(
              libSymbolInSchematic,
              messages,
              new UNITS_PROVIDER(schIUScale, 'mils'),
            );

          if (messages.length === 0 && flattenedSymbol.Compare(libSymbolInSchematic, flags) !== 0) {
            const ercItem = ERC_ITEM.Create(ERCE.ERCE_LIB_SYMBOL_MISMATCH)!;
            ercItem.SetItems(symbol);
            ercItem.SetErrorMessage(
              `Symbol '${unescapeString(symbolName)}' doesn't match copy in library '${unescapeString(libName)}'`,
            );
            markers.push(new SCH_MARKER_LIVE(ercItem, symbol.GetPosition()));
          }
        }
      }

      for (const marker of markers) {
        screen.Append(marker);
        err_count += 1;
      }
    }

    return err_count;
  }

  /**
   * `TestFootprintLinkIssues( aCvPcb, aProject )` (erc.cpp:1816): each placed symbol's resolved
   * Footprint field must parse as a LIB_ID, name a library the configuration includes and
   * enables, and a footprint that library holds - CvPcb's KIFACE_TEST_FOOTPRINT_LINK judges the
   * last three. Upstream's BlockUntilLoaded is the caller's: the dialog loads the footprint
   * libraries before it runs the tests.
   *
   * @return the marker count
   */
  TestFootprintLinkIssues(aCvPcb: KIFACE, aProject: PROJECT | null): number {
    let err_count = 0;

    const linkTester = aCvPcb.IfaceOrAddress(
      KIFACE_ADDR_ID.KIFACE_TEST_FOOTPRINT_LINK,
    ) as TESTER_FN_PTR;

    for (const sheet of this.m_sheetList) {
      const markers: SCH_MARKER_LIVE[] = [];

      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;
        const footprint = symbol.GetFootprintFieldText(true, sheet, false);

        if (footprint === '') continue;

        const issue = (aMessage: string): void => {
          const ercItem = ERC_ITEM.Create(ERCE.ERCE_FOOTPRINT_LINK_ISSUES)!;
          ercItem.SetErrorMessage(aMessage);
          ercItem.SetItems(symbol);
          markers.push(new SCH_MARKER_LIVE(ercItem, symbol.GetPosition()));
        };

        const fpID = new LIB_ID_LIVE();

        if (fpID.Parse(footprint, true) >= 0) {
          issue(`'${footprint}' is not a valid footprint identifier`);
          continue;
        }

        const libName = fpID.GetLibNickname();
        const fpName = fpID.GetLibItemName();
        const ret = linkTester(footprint, aProject);

        if (ret === KIFACE_ADDR_ID.KIFACE_TEST_FOOTPRINT_LINK_NO_LIBRARY) {
          issue(`The current configuration does not include the footprint library '${libName}'`);
        } else if (ret === KIFACE_ADDR_ID.KIFACE_TEST_FOOTPRINT_LINK_LIBRARY_NOT_ENABLED) {
          issue(`The footprint library '${libName}' is not enabled in the current configuration`);
        } else if (ret === KIFACE_ADDR_ID.KIFACE_TEST_FOOTPRINT_LINK_NO_FOOTPRINT) {
          issue(`Footprint '${fpName}' not found in library '${libName}'`);
        }
      }

      for (const marker of markers) {
        sheet.LastScreen()!.Append(marker);
        err_count += 1;
      }
    }

    return err_count;
  }

  /**
   * `TestSimModelIssues()` (erc.cpp:2054): every simulated symbol (its sheet and itself not
   * excluded from simulation, its reference not starting with '#') has its model built, and
   * whatever building reported becomes one ERCE_SIMULATION_MODEL marker.
   *
   * @return the marker count
   */
  TestSimModelIssues(): number {
    const reporter = new WX_STRING_REPORTER();
    let err_count = 0;
    const libMgr = new SIM_LIB_MGR(this.m_schematic.Project());
    const variant = this.m_schematic.GetCurrentVariant();

    for (const sheet of this.m_sheetList) {
      if (sheet.GetExcludedFromSim(variant)) continue;

      const markers: SCH_MARKER_LIVE[] = [];

      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        // Power symbols and other symbols which have the reference starting with "#" are
        // not included in simulation
        if (symbol.GetRef(sheet).startsWith('#') || symbol.ResolveExcludedFromSim()) continue;

        // Reset for each symbol
        reporter.Clear();

        libMgr.CreateModel(sheet, symbol, true, 0, variant, reporter);

        if (reporter.HasMessage()) {
          const ercItem = ERC_ITEM.Create(ERCE.ERCE_SIMULATION_MODEL)!;

          // Remove \n and \r at e.o.l if any:
          ercItem.SetErrorMessage(reporter.GetMessages().trimEnd());
          ercItem.SetItems(symbol);

          markers.push(new SCH_MARKER_LIVE(ercItem, symbol.GetPosition()));
        }
      }

      for (const marker of markers) {
        sheet.LastScreen()!.Append(marker);
        err_count += 1;
      }
    }

    return err_count;
  }

  /**
   * Check for field names with leading or trailing whitespace, on symbols and sheets.
   *
   * @return the warning count
   */
  TestFieldNameWhitespace(): number {
    let warnings = 0;

    for (const sheet of this.m_sheetList) {
      const screen = sheet.LastScreen()!;

      const check = (aOwner: SCH_ITEM_LIVE, aFields: readonly SCH_FIELD[]) => {
        for (const field of aFields) {
          // wxString::Trim() then Trim( false ): spaces, tabs, line breaks.
          const trimmedFieldName = field.GetName().replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');

          if (field.GetName() !== trimmedFieldName) {
            const ercItem = ERC_ITEM.Create(ERCE.ERCE_FIELD_NAME_WHITESPACE)!;
            ercItem.SetItems(aOwner, field);
            ercItem.SetItemsSheetPaths(sheet, sheet);
            ercItem.SetSheetSpecificPath(sheet);
            ercItem.SetErrorMessage(
              `Field name has leading or trailing whitespace: '${field.GetName()}'`,
            );

            const marker = new SCH_MARKER_LIVE(ercItem, field.GetPosition());
            screen.Append(marker);
            warnings++;
          }
        }
      };

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T))
        check(item, (item as SCH_SYMBOL).GetFields());

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_SHEET_T))
        check(item, (item as unknown as SCH_SHEET).GetFields());
    }

    return warnings;
  }

  /**
   * Check that pins sharing a number in one symbol (allowed when the library says they are
   * not jumpers) are on one net.
   *
   * @return the error count
   */
  TestDuplicatePinNets(): number {
    let errors = 0;

    for (const sheet of this.m_sheetList) {
      const screen = sheet.LastScreen()!;

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;
        const libSymbol = symbol.GetLibSymbolRef();

        if (!libSymbol) continue;

        if (libSymbol.GetDuplicatePinNumbersAreJumpers()) continue;

        const pins = symbol.GetPins(sheet);

        // std::map<wxString, ...>: by number, as wxString compares (code points).
        const pinsByNumber = new Map<string, [SCH_PIN, string][]>();

        for (const pin of pins) {
          const conn = pin.Connection(sheet);
          const netName = conn ? conn.GetNetName() : '';

          pinsByNumber.set(pin.GetNumber(), [
            ...(pinsByNumber.get(pin.GetNumber()) ?? []),
            [pin, netName],
          ]);
        }

        for (const [pinNumber, pinNetPairs] of [...pinsByNumber].sort((a, b) =>
          wxCmp(a[0], b[0]),
        )) {
          if (pinNetPairs.length < 2) continue;

          const firstNet = pinNetPairs[0]![1];
          let hasDifferentNets = false;
          let conflictPin: SCH_PIN | null = null;

          for (let i = 1; i < pinNetPairs.length; i++) {
            if (pinNetPairs[i]![1] !== firstNet) {
              hasDifferentNets = true;
              conflictPin = pinNetPairs[i]![0];
              break;
            }
          }

          if (hasDifferentNets) {
            const ercItem = ERC_ITEM.Create(ERCE.ERCE_DUPLICATE_PIN_ERROR)!;
            const second = pinNetPairs[1]![1];

            ercItem.SetErrorMessage(
              `Pin ${pinNumber} on symbol '${symbol.GetRef(sheet)}' is connected to different nets: ${firstNet === '' ? _('<no net>') : firstNet} and ${second === '' ? _('<no net>') : second}`,
            );
            ercItem.SetItems(pinNetPairs[0]![0], conflictPin);
            ercItem.SetSheetSpecificPath(sheet);
            ercItem.SetItemsSheetPaths(sheet, sheet);

            const marker = new SCH_MARKER_LIVE(ercItem, pinNetPairs[0]![0].GetPosition());
            screen.Append(marker);
            errors++;
          }
        }
      }
    }

    return errors;
  }

  /**
   * Check for global and local labels with the same name.
   *
   * @return the error count
   */
  TestSameLocalGlobalLabel(): number {
    let errCount = 0;

    // std::unordered_map<wxString, ...>: only which label is kept per text is observable.
    const globalLabels = new Map<string, [SCH_ITEM_LIVE, SCH_SHEET_PATH_LIVE]>();
    const localLabels = new Map<string, [SCH_ITEM_LIVE, SCH_SHEET_PATH_LIVE]>();

    for (const [, subgraphs] of this.m_nets) {
      for (const subgraph of subgraphs) {
        const sheet = subgraph.GetSheet();

        for (const item of subgraph.GetItems()) {
          if (
            item.Type() === KICAD_T_LIVE.SCH_LABEL_T ||
            item.Type() === KICAD_T_LIVE.SCH_GLOBAL_LABEL_T
          ) {
            const label = item as SCH_LABEL_BASE;
            const text = label.GetShownText(sheet, false);

            const map = item.Type() === KICAD_T_LIVE.SCH_LABEL_T ? localLabels : globalLabels;

            if (!map.has(text)) map.set(text, [label, sheet]);
          }
        }
      }
    }

    for (const [globalText, globalItem] of globalLabels) {
      for (const [localText, localItem] of localLabels) {
        if (globalText === localText) {
          const ercItem = ERC_ITEM.Create(ERCE.ERCE_SAME_LOCAL_GLOBAL_LABEL)!;
          ercItem.SetItems(globalItem[0], localItem[0]);
          ercItem.SetSheetSpecificPath(globalItem[1]);
          ercItem.SetItemsSheetPaths(globalItem[1], localItem[1]);

          const marker = new SCH_MARKER_LIVE(ercItem, globalItem[0].GetPosition());
          globalItem[1].LastScreen()!.Append(marker);

          errCount++;
        }
      }
    }

    return errCount;
  }

  /**
   * Test for netclasses that are referenced but not defined.
   *
   * @return the error count
   */
  TestMissingNetclasses(): number {
    let err_count = 0;
    const settings = this.m_schematic.Project().GetProjectFile().NetSettings();
    const defaultNetclass = settings.GetDefaultNetclass().GetName();

    const logError = (sheet: SCH_SHEET_PATH_LIVE, item: SCH_ITEM_LIVE, netclass: string) => {
      err_count++;

      const ercItem = ERC_ITEM.Create(ERCE.ERCE_UNDEFINED_NETCLASS)!;

      ercItem.SetItems(item);
      ercItem.SetErrorMessage(`Netclass ${netclass} is not defined`);

      const marker = new SCH_MARKER_LIVE(ercItem, item.GetPosition());
      sheet.LastScreen()!.Append(marker);
    };

    for (const sheet of this.m_sheetList) {
      for (const item of sheet.LastScreen()!.Items()) {
        item.RunOnChildren((aChild: SCH_ITEM_LIVE) => {
          if (aChild.Type() === KICAD_T_LIVE.SCH_FIELD_T) {
            const field = aChild as unknown as SCH_FIELD;

            if (field.GetCanonicalName() === 'Netclass') {
              const netclass = field.GetShownText(sheet, false);

              if (
                netclass !== '' &&
                netclass !== defaultNetclass &&
                !settings.HasNetclass(netclass)
              ) {
                logError(sheet, item, netclass);
              }
            }
          }
        }, RECURSE_MODE.NO_RECURSE);
      }
    }

    return err_count;
  }

  /**
   * Test to see if there are potentially confusing 4-way junctions in the schematic.
   *
   * @return the error count
   */
  TestFourWayJunction(): number {
    let err_count = 0;

    const pinStackAlreadyRepresented = (pin: SCH_PIN, collection: SCH_ITEM_LIVE[]): boolean => {
      for (let i = 0; i < collection.length; i++) {
        const item = collection[i]!;

        if (
          item.Type() === KICAD_T_LIVE.SCH_PIN_T &&
          item.GetParentSymbol() === pin.GetParentSymbol()
        ) {
          if (pin.IsVisible() && !(item as SCH_PIN).IsVisible()) collection[i] = pin;

          return true;
        }
      }

      return false;
    };

    for (const sheet of this.m_sheetList) {
      const connMap = new VECTOR2I_MAP<SCH_ITEM_LIVE[]>(() => []);
      const screen = sheet.LastScreen()!;

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        for (const pin of symbol.GetPins(sheet)) {
          const entry = connMap.at(pin.GetPosition());

          // Only one pin per pin-stack.
          if (pinStackAlreadyRepresented(pin, entry)) continue;

          entry.push(pin);
        }
      }

      for (const item of screen.Items().OfType(KICAD_T_LIVE.SCH_LINE_T)) {
        const line = item as SCH_LINE;

        if (line.IsGraphicLine()) continue;

        for (const pt of line.GetConnectionPoints()) connMap.at(pt).push(line);
      }

      for (const [pt, items] of connMap) {
        if (items.length >= 4) {
          err_count++;

          const ercItem = ERC_ITEM.Create(ERCE.ERCE_FOUR_WAY_JUNCTION)!;

          ercItem.SetItems(items[0]!, items[1]!, items[2]!, items[3]!);
          ercItem.SetErrorMessage(`Four items connected at ${pt.x}, ${pt.y}`);
          ercItem.SetSheetSpecificPath(sheet);

          const marker = new SCH_MARKER_LIVE(ercItem, pt);
          sheet.LastScreen()!.Append(marker);
        }
      }
    }

    return err_count;
  }

  /**
   * Test for a label that connects to more than one wire.
   *
   * @return the error count
   */
  TestLabelMultipleWires(): number {
    let err_count = 0;

    for (const sheet of this.m_sheetList) {
      const connMap = new VECTOR2I_MAP<SCH_ITEM_LIVE[]>(() => []);

      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_LIVE.SCH_LABEL_T)) {
        for (const pt of item.GetConnectionPoints()) connMap.at(pt).push(item);
      }

      for (const [pt, labels] of connMap) {
        const lines: (SCH_ITEM_LIVE | null)[] = [];

        for (const item of sheet.LastScreen()!.Items().Overlapping(KICAD_T_LIVE.SCH_LINE_T, pt)) {
          const line = item as SCH_LINE;

          if (line.IsGraphicLine()) continue;

          // If the line is connected at the endpoint, then there will be a junction
          if (!line.IsEndPoint(pt)) lines.push(line);
        }

        if (lines.length > 1) {
          err_count++;
          // Only show the first 3 lines and if there are only two, adds a nullptr
          lines.length = 3;

          const ercItem = ERC_ITEM.Create(ERCE.ERCE_LABEL_MULTIPLE_WIRES)!;

          ercItem.SetItems(labels[0]!, lines[0] ?? null, lines[1] ?? null, lines[2] ?? null);
          ercItem.SetErrorMessage(`Label connects more than one wire at ${pt.x}, ${pt.y}`);
          ercItem.SetSheetSpecificPath(sheet);

          const marker = new SCH_MARKER_LIVE(ercItem, pt);
          sheet.LastScreen()!.Append(marker);
        }
      }
    }

    return err_count;
  }

  /**
   * Test if all units of each multiunit symbol have the same footprint assigned.
   *
   * @return the error count
   */
  TestMultiunitFootprints(): number {
    let errors = 0;

    for (const [, refList] of multiUnitEntries(this.m_refMap)) {
      if (refList.GetCount() === 0) continue; // wxFAIL: it should not happen

      // Reference footprint
      let unit: SCH_SYMBOL | null = null;
      let unitName = '';
      let unitFP = '';

      for (let ii = 0; ii < refList.GetCount(); ++ii) {
        const sheetPath = refList.GetItem(ii).GetSheetPath();
        unitFP = refList.GetItem(ii).GetFootprint();

        if (unitFP !== '') {
          unit = refList.GetItem(ii).GetSymbol();
          unitName = unit.GetRef(sheetPath, true);
          break;
        }
      }

      for (let ii = 0; ii < refList.GetCount(); ++ii) {
        const secondRef = refList.GetItem(ii);
        const secondUnit = secondRef.GetSymbol();
        const secondName = secondUnit.GetRef(secondRef.GetSheetPath(), true);
        const secondFp = secondRef.GetFootprint();

        if (unit && secondFp !== '' && unitFP !== secondFp) {
          const ercItem = ERC_ITEM.Create(ERCE.ERCE_DIFFERENT_UNIT_FP)!;
          ercItem.SetErrorMessage(`Different footprints assigned to ${unitName} and ${secondName}`);
          ercItem.SetItems(unit, secondUnit);

          const marker = new SCH_MARKER_LIVE(ercItem, secondUnit.GetPosition());
          secondRef.GetSheetPath().LastScreen()!.Append(marker);

          ++errors;
        }
      }
    }

    return errors;
  }

  /**
   * Test symbols for footprint assignments that do not match their library symbol's footprint
   * filters.
   *
   * @return the error count
   */
  TestFootprintFilters(): number {
    let err_count = 0;

    for (const sheet of this.m_sheetList) {
      const markers: SCH_MARKER_LIVE[] = [];

      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_LIVE.SCH_SYMBOL_T)) {
        const sch_symbol = item as SCH_SYMBOL;
        const lib_symbol = sch_symbol.GetLibSymbolRef();

        if (!lib_symbol) continue;

        const filters = lib_symbol.GetFPFilters();

        if (filters.length === 0) continue;

        const lowerId = sch_symbol.GetFootprintFieldText(true, sheet, false).toLowerCase();
        const footprint = new LIB_ID_LIVE();

        if (footprint.Parse(lowerId) > 0) continue;

        const lowerItemName = footprint.GetUniStringLibItemName().toLowerCase();
        let found = false;

        for (let filter of filters) {
          filter = filter.toLowerCase();

          // If the filter contains a ':' character, include the library name in the pattern
          if (filter.includes(':')) found ||= wxMatches(lowerId, filter);
          else found ||= wxMatches(lowerItemName, filter);

          if (found) break;
        }

        if (!found) {
          const ercItem = ERC_ITEM.Create(ERCE.ERCE_FOOTPRINT_FILTERS)!;
          ercItem.SetErrorMessage(
            `Assigned footprint (${footprint.GetUniStringLibItemName()}) doesn't match footprint filters (${filters.join(' ')})`,
          );
          ercItem.SetItems(sch_symbol);
          markers.push(new SCH_MARKER_LIVE(ercItem, sch_symbol.GetPosition()));
        }
      }

      for (const marker of markers) {
        sheet.LastScreen()!.Append(marker);
        err_count += 1;
      }
    }

    return err_count;
  }

  /**
   * Test pins and wire ends for being off grid.
   *
   * @return the error count
   */
  TestOffGridEndpoints(): number {
    const gridSize = this.m_schematic.Settings().m_ConnectionGridSize;
    let err_count = 0;

    for (let screen = this.m_screens.GetFirst(); screen; screen = this.m_screens.GetNext()) {
      const markers: SCH_MARKER_LIVE[] = [];

      for (const item of screen.Items()) {
        if (item.Type() === KICAD_T_LIVE.SCH_LINE_T && item.IsConnectable()) {
          const line = item as SCH_LINE;

          if (line.GetStartPoint().x % gridSize !== 0 || line.GetStartPoint().y % gridSize !== 0) {
            const ercItem = ERC_ITEM.Create(ERCE.ERCE_ENDPOINT_OFF_GRID)!;
            ercItem.SetItems(line);

            markers.push(new SCH_MARKER_LIVE(ercItem, line.GetStartPoint()));
          } else if (
            line.GetEndPoint().x % gridSize !== 0 ||
            line.GetEndPoint().y % gridSize !== 0
          ) {
            const ercItem = ERC_ITEM.Create(ERCE.ERCE_ENDPOINT_OFF_GRID)!;
            ercItem.SetItems(line);

            markers.push(new SCH_MARKER_LIVE(ercItem, line.GetEndPoint()));
          }
        }

        if (item.Type() === KICAD_T_LIVE.SCH_BUS_WIRE_ENTRY_T) {
          const entry = item as SCH_BUS_WIRE_ENTRY;

          for (const point of entry.GetConnectionPoints()) {
            if (point.x % gridSize !== 0 || point.y % gridSize !== 0) {
              const ercItem = ERC_ITEM.Create(ERCE.ERCE_ENDPOINT_OFF_GRID)!;
              ercItem.SetItems(entry);

              markers.push(new SCH_MARKER_LIVE(ercItem, point));
            }
          }
        } else if (item.Type() === KICAD_T_LIVE.SCH_SYMBOL_T) {
          const symbol = item as SCH_SYMBOL;

          for (const pin of symbol.GetPins(null)) {
            if (pin.GetType() === ELECTRICAL_PINTYPE.PT_NC) continue;

            const pinPos = pin.GetPosition();

            if (pinPos.x % gridSize !== 0 || pinPos.y % gridSize !== 0) {
              const ercItem = ERC_ITEM.Create(ERCE.ERCE_ENDPOINT_OFF_GRID)!;
              ercItem.SetItems(pin);

              markers.push(new SCH_MARKER_LIVE(ercItem, pinPos));
              break;
            }
          }
        }
      }

      for (const marker of markers) {
        screen.Append(marker);
        err_count += 1;
      }
    }

    return err_count;
  }

  /**
   * Run the ERC tests the settings enable. \a aEditFrame, when given, rebuilds connectivity
   * first; \a aDrawingSheet, when given, has its texts checked by TestTextVars.
   */
  RunTests(
    aDrawingSheet: DS_PROXY_VIEW_ITEM | null = null,
    aEditFrame: SCH_EDIT_FRAME | null = null,
    aCvPcb: KIFACE | null = null,
    aProject: PROJECT | null = null,
    aProgressReporter: PROGRESS_REPORTER | null = null,
  ): void {
    const phase = (aMessage: string): void => aProgressReporter?.AdvancePhase(aMessage);

    this.m_sheetList.AnnotatePowerSymbols();

    // Test duplicate sheet names inside a given sheet.  While one can have multiple references
    // to the same file, each must have a unique name.
    if (this.m_settings.IsTestEnabled(ERCE.ERCE_DUPLICATE_SHEET_NAME)) {
      phase(_('Checking sheet names...'));
      this.TestDuplicateSheetNames(true);
    }

    phase(_('Checking conflicts...'));

    // If we are using the new connectivity, make sure that we do a full-rebuild
    // (ADVANCED_CFG::m_IncrementalConnectivity is off by default: NO_CLEANUP).
    if (aEditFrame) aEditFrame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.NO_CLEANUP);

    this.m_schematic.ConnectionGraph().RunERC();

    phase(_('Checking units...'));

    // Test is all units of each multiunit symbol have the same footprint assigned.
    if (this.m_settings.IsTestEnabled(ERCE.ERCE_DIFFERENT_UNIT_FP)) {
      phase(_('Checking footprints...'));
      this.TestMultiunitFootprints();
    }

    if (
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_UNIT) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_INPUT_PIN) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_POWER_INPUT_PIN) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_BIDI_PIN)
    ) {
      this.TestMissingUnits();
    }

    phase(_('Checking pins...'));

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_DIFFERENT_UNIT_NET))
      this.TestMultUnitPinConflicts();

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_DUPLICATE_PIN_ERROR)) this.TestDuplicatePinNets();

    // Test pins on each net against the pin connection table
    if (
      this.m_settings.IsTestEnabled(ERCE.ERCE_PIN_TO_PIN_ERROR) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_POWERPIN_NOT_DRIVEN) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_PIN_NOT_DRIVEN)
    ) {
      this.TestPinToPin();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_GROUND_PIN_NOT_GROUND)) this.TestGroundPins();

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_STACKED_PIN_SYNTAX)) this.TestStackedPinNotation();

    // Test similar labels (i;e. labels which are identical when
    // using case insensitive comparisons)
    if (
      this.m_settings.IsTestEnabled(ERCE.ERCE_SIMILAR_LABELS) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_SIMILAR_POWER) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_SIMILAR_LABEL_AND_POWER)
    ) {
      phase(_('Checking similar labels...'));
      this.TestSimilarLabels();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_SAME_LOCAL_GLOBAL_LABEL)) {
      phase(_('Checking local and global labels...'));
      this.TestSameLocalGlobalLabel();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_UNRESOLVED_VARIABLE)) {
      phase(_('Checking for unresolved variables...'));
      this.TestTextVars(aDrawingSheet);
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_FIELD_NAME_WHITESPACE)) {
      phase(_('Checking field names...'));
      this.TestFieldNameWhitespace();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_SIMULATION_MODEL)) {
      phase(_('Checking SPICE models...'));
      this.TestSimModelIssues();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_NOCONNECT_CONNECTED)) {
      phase(_('Checking no connect pins for connections...'));
      this.TestNoConnectPins();
    }

    if (
      this.m_settings.IsTestEnabled(ERCE.ERCE_LIB_SYMBOL_ISSUES) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_LIB_SYMBOL_MISMATCH)
    ) {
      phase(_('Checking for library symbol issues...'));
      this.TestLibSymbolIssues();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_FOOTPRINT_LINK_ISSUES) && aCvPcb) {
      phase(_('Checking for footprint link issues...'));
      this.TestFootprintLinkIssues(aCvPcb, aProject);
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_FOOTPRINT_FILTERS)) {
      phase(_('Checking footprint assignments against footprint filters...'));
      this.TestFootprintFilters();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_ENDPOINT_OFF_GRID)) {
      phase(_('Checking for off grid pins and wires...'));
      this.TestOffGridEndpoints();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_FOUR_WAY_JUNCTION)) {
      phase(_('Checking for four way junctions...'));
      this.TestFourWayJunction();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_LABEL_MULTIPLE_WIRES)) {
      phase(_('Checking for labels on more than one wire...'));
      this.TestLabelMultipleWires();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_UNDEFINED_NETCLASS)) {
      phase(_('Checking for undefined netclasses...'));
      this.TestMissingNetclasses();
    }

    this.m_schematic.ResolveERCExclusionsPostUpdate();
  }
}
