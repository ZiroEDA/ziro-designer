/**
 * Electrical Rules Check, ported from KiCad:
 *
 *  - the pin-to-pin conflict matrix and driver pin-type sets are byte-for-byte
 *    copies of ERC_SETTINGS::m_defaultPinMap and the DrivingPinTypes /
 *    DrivingPowerPinTypes / DrivenPinTypes sets (eeschema/erc/erc_settings.cpp,
 *    erc.cpp);
 *  - TestPinToPin: for every net, each pin pair is looked up in the matrix
 *    (stacked pins of one symbol are exempt); mismatches are aggregated so the
 *    pin involved in the most conflicts is reported against its nearest
 *    conflicting pin, exactly KiCad's marker-dedup strategy. The same walk
 *    determines whether a net that *needs* a driver (input / power-input pins)
 *    actually has one, power nets accept only power-output drivers
 *    (ERCE_PIN_NOT_DRIVEN / ERCE_POWERPIN_NOT_DRIVEN); a net carrying a
 *    no-connect flag is exempt;
 *  - ercCheckNoConnects (connection_graph.cpp): a subgraph with a no-connect
 *    and more than one distinct (non-stacked) pin -> "connected NC" warning;
 *    a no-connect with no pins and no labels -> "dangling NC" warning; a pin
 *    alone on its subgraph without a no-connect -> ERCE_PIN_NOT_CONNECTED
 *    (free/NC-type pins exempt);
 *  - TestNoConnectPins (erc.cpp): an NC-*type* pin sharing its position with
 *    any other connectable item -> "Pin with 'no connection' type is connected";
 *  - ercCheckLabels: a label on a net with no pins -> label not connected
 *    (error); with exactly one pin -> "only one pin" warning. Global labels
 *    follow KiCad's default of ignoring the single-instance check.
 *
 * Default severities are ERC_SETTINGS' defaults: everything is an error except
 * pin-to-pin warnings, the no-connect checks, and the single-pin label check.
 */

import type { Schematic, LibSymbol, Vec2 } from '../types.js';
import { refId } from '../tools/hittest.js';
import { expandStackedPinNotation, unescapeString } from '@ziroeda/common/src/string_utils.js';
import { compareLibSymbolsForErc } from '../lib_symbol_compare.js';
import { checkSimModel } from '../sim/sim_model.js';
import { isNetclassFieldName } from '../sch_field.js';
import { computeNetlist, enumeratePins, onSegment, type PinNode } from './nets.js';
import { expandBusLabel, isBusLabel } from './bus.js';
import {
  OK,
  WAR,
  ERR,
  ERC_ITEMS,
  typeIndex,
  TYPE_NAMES,
  defaultErcSettings,
  type PinError,
  type ErcCode,
  type ErcSeverity,
  type ErcSettings,
} from '../erc/erc_settings.js';

// Re-export the ERC settings surface so `@ziroeda/eeschema` consumers keep
// importing these names from the ERC module (the Schematic Setup panels do).
export {
  PIN_TYPES,
  TYPE_NAMES,
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
} from '../erc/erc_settings.js';

// erc.cpp pin-type driver sets.
const DRIVING = new Set(['output', 'power_out', 'passive', 'tri_state', 'bidirectional']);
const DRIVING_POWER = new Set(['power_out']);
const DRIVEN = new Set(['input', 'power_in']);

/** A pin of the same net living on another sheet of the hierarchy. */
export interface ExternalPin {
  electricalType: string;
  ref: string;
  number: string;
  /** Hidden pins lose the "prefer a visible pin" upgrade, as upstream. */
  hidden?: boolean;
  /** Sheet file the pin belongs to, for the report. */
  file?: string;
}

export interface ErcViolation {
  code: ErcCode;
  severity: ErcSeverity;
  message: string;
  at: Vec2;
  /** Item ids involved (selectable refIds; pin ids resolve to their symbol). */
  items: string[];
  /** Sheet file the marker belongs to; a marker lives on its own screen
   *  (SCH_MARKER is appended to the sheet's SCH_SCREEN). */
  file?: string;
}

/**
 * An exclusion signature for a violation (SCH_MARKER::SerializeToString): the
 * settings key, position, and the involved item ids, enough to recognise the
 * same marker on a later run so its exclusion persists across ERC runs.
 */
export function ercExclusionKey(v: Pick<ErcViolation, 'code' | 'at' | 'items' | 'file'>): string {
  return `${v.file ?? ''}|${v.code}|${v.at.x}|${v.at.y}|${v.items[0] ?? ''}|${v.items[1] ?? ''}`;
}

// The active ERC configuration for the current run (set at the top of runErc).
let g_settings: ErcSettings = defaultErcSettings();
// The sheet being checked, stamped onto every marker it produces.
let g_file: string | undefined;

const violation = (code: ErcCode, message: string, at: Vec2, items: string[]): ErcViolation => ({
  code,
  // 'ignore' rules are dropped after the run; the survivors are error/warning.
  severity: g_settings.severities[code] as ErcSeverity,
  message,
  at,
  items,
  ...(g_file === undefined ? {} : { file: g_file }),
});

/** A pin id `<symId>:pin<k>` selects its parent symbol in the editor. */
const selectableId = (id: string): string => {
  const i = id.lastIndexOf(':pin');
  return i === -1 ? id : id.slice(0, i);
};

/** LIB_SYMBOL::GetUnitDisplayName( unit, false ): the bare unit letter. */
const unitLabel = (unit: number): string => {
  let suffix = '';
  let n = unit;
  do {
    const u = (n - 1) % 26;
    suffix = String.fromCharCode(65 + u) + suffix;
    n = Math.trunc((n - u) / 26);
  } while (n > 0);
  return suffix;
};

/** wxString::Matches, an anchored glob where `*` is any run and `?` one char. */
function wxMatches(text: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(text);
  } catch {
    return false;
  }
}

/** A local and an off-sheet pin are never stacked (different screens). */
const stacked2 = (_a: PinNode, _b: ExternalPin): boolean => false;

/** KiCad SCH_PIN::IsStacked (simplified): same symbol, same position. */
const stacked = (a: PinNode, b: PinNode): boolean =>
  a.symId === b.symId && a.at.x === b.at.x && a.at.y === b.at.y;

/** Options for one ERC run (the parts of SCHEMATIC_SETTINGS / the project the
 *  tests read besides the sheet itself). */
/**
 * A symbol placed on another sheet of the hierarchy, as
 * SCH_REFERENCE_LIST sees it. `sheetIndex` is its sheet's position in the
 * sheet list; with the symbol's own index it gives the hierarchy-wide order
 * upstream's sorted reference list has.
 */
export interface ExternalSymbol {
  ref: string;
  unit: number;
  libId: string;
  value: string;
  footprint: string;
  sheetIndex: number;
  index: number;
}

/** A label (or power-symbol value) on another sheet, for TestSimilarLabels. */
export interface ExternalLabel {
  text: string;
  isPin: boolean;
  sheetIndex: number;
  index: number;
}

export interface ErcRunOptions {
  /** SCHEMATIC_SETTINGS::m_ConnectionGridSize for the off-grid endpoint test
   *  (0/absent disables it, as a degenerate grid would flag everything). */
  connectionGridIU?: number;
  /** Bus alias definitions, feeding bus-label expansion in the netlist. */
  busAliases?: ReadonlyMap<string, readonly string[]>;
  /**
   * The sheet's human-readable path (NetlistOptions.sheetPath). ERC names its nets
   * with the same graph the rest of the hierarchy uses, so a caller that resolves
   * cross-sheet pins by net name must pass the same path here, otherwise a child
   * sheet's "/Child/CLK" would be looked up as "/CLK".
   */
  sheetPath?: string;
  /** Sub-sheet documents by file name, for the hierarchical-label test
   *  (ercCheckHierSheets compares a sheet's pins with the child's labels). */
  subSheets?: ReadonlyMap<string, Schematic>;
  /** Global labels used anywhere else in the hierarchy, a global label is only
   *  "single" when it appears once project-wide (ercCheckSingleGlobalLabel). */
  otherSheetGlobalLabels?: ReadonlySet<string>;
  /** Resolve a `${VAR}` name; undefined means unresolved (TestTextVars). */
  resolveTextVar?: (name: string) => string | undefined;
  /** DIALOG_ERC's "Show all errors": mark every pin that lacks a driver, not
   *  just one per net (m_showAllErrors in TestPinToPin). */
  showAllErrors?: boolean;
  /** The configured footprint libraries (nickname -> footprint names), for
   *  TestFootprintLinkIssues; absent skips the test. */
  footprintLibs?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The rest of each net as the hierarchy sees it: the pins that sit on the
   * same (propagated) net name on *other* sheets, and the net names that carry
   * a no-connect flag elsewhere. With these the net tests see KiCad's merged
   * m_nets entry rather than this sheet's slice of it; markers are still only
   * raised for pins of this sheet, so each fault is reported once, on the sheet
   * that owns it.
   */
  externalNetPins?: ReadonlyMap<string, readonly ExternalPin[]>;
  externalNetNoConnects?: ReadonlySet<string>;
  /** The sheet file being checked; stamped onto every violation so a marker
   *  can be drawn (and cross-probed) on the sheet it belongs to. */
  sheetFile?: string;
  /** The library's copy of each symbol, by LIB_ID, for the mismatch test
   *  (TestLibSymbolIssues' Compare); absent libraries are simply not compared. */
  librarySymbols?: ReadonlyMap<string, LibSymbol>;
  /** Pad numbers of each footprint, by LIB_ID, upstream's KIFACE pad fetcher.
   *  Absent (or an unknown footprint) stands the pad tests down. */
  footprintPads?: ReadonlyMap<string, ReadonlySet<string>>;
  /** The configured symbol libraries: nickname -> the symbol names it holds
   *  (SYMBOL_LIBRARY_ADAPTER over the symbol library table). Absent stands
   *  TestLibSymbolIssues' library half down. */
  symbolLibs?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Configured libraries that would not load, by nickname -> their URI
   *  (`!adapter->IsLibraryLoaded( libName )` with LIBRARY_MANAGER::GetFullURI). */
  unloadedSymbolLibs?: ReadonlyMap<string, string>;
  /** This sheet's position in the hierarchy (SCH_SHEET_LIST order). With the
   *  `external*` lists below it decides which sheet's run owns a marker when a
   *  fault spans sheets, so each is reported once, upstream never had to ask,
   *  since ERC_TESTER walks the whole sheet list in one pass. */
  sheetIndex?: number;
  /** Symbols placed on other sheets: SCH_REFERENCE_LIST spans the hierarchy,
   *  so the reference tests (duplicates, units, values, footprints) do too. */
  externalSymbols?: readonly ExternalSymbol[];
  /** Label texts and power-symbol values on other sheets, for
   *  TestSimilarLabels, upstream compares across every subgraph of m_nets. */
  externalLabels?: readonly ExternalLabel[];
  /** SPICE library contents by `Sim.Library` path (SIM_LIB_MGR's resolver);
   *  returning undefined is upstream's "library not found". */
  simLibraryText?: (path: string) => string | undefined;
  /** The project's netclasses (NET_SETTINGS): the default class's name and the
   *  names of the rest. Absent stands TestMissingNetclasses down. */
  netclasses?: { defaultName: string; names: ReadonlySet<string> };
}

/**
 * The phases ERC_TESTER::RunTests announces through its PROGRESS_REPORTER, in
 * upstream's order (DIALOG_ERC shows each one as the run reaches it).
 */
export const ERC_PHASES: readonly string[] = [
  'Checking sheet names...',
  'Checking pin maps...',
  'Checking conflicts...',
  'Checking units...',
  'Checking footprints...',
  'Checking pins...',
  'Checking similar labels...',
  'Checking local and global labels...',
  'Checking for unresolved variables...',
  'Checking field names...',
  'Checking SPICE models...',
  'Checking no connect pins for connections...',
  'Checking for library symbol issues...',
  'Checking for footprint link issues...',
  'Checking footprint assignments against footprint filters...',
  'Checking for off grid pins and wires...',
  'Checking for four way junctions...',
  'Checking for labels on more than one wire...',
  'Checking for undefined netclasses...',
];

/** Run the electrical rules check on a single sheet. */
export function runErc(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  settings: ErcSettings = defaultErcSettings(),
  opts: ErcRunOptions = {},
): ErcViolation[] {
  const steps = runErcSteps(sch, libById, settings, opts);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The same run as a generator that yields before each phase, so a caller can
 * paint progress between phases the way DIALOG_ERC's "Tests Running…" page does
 * (PROGRESS_REPORTER_BASE::AdvancePhase).
 */
export function* runErcSteps(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  settings: ErcSettings = defaultErcSettings(),
  opts: ErcRunOptions = {},
): Generator<string, ErcViolation[], void> {
  g_settings = settings;
  g_file = opts.sheetFile;
  const out: ErcViolation[] = [];
  const netlist = computeNetlist(sch, libById, {
    busAliases: opts.busAliases,
    ...(opts.sheetPath !== undefined ? { sheetPath: opts.sheetPath } : {}),
  });
  const pins = enumeratePins(sch, libById);
  const pinById = new Map(pins.map((p) => [p.id, p]));

  // Item-kind lookups by id, matching the node ids computeNetlist emits.
  const labelIds = new Map<string, { text: string; at: Vec2; kind: string }>();
  sch.labels.forEach((l, i) => {
    if (l.kind !== 'text')
      labelIds.set(refId('label', l.uuid, i), { text: l.text, at: l.at, kind: l.kind });
  });
  const noConnectIds = new Map<string, Vec2>();
  sch.noConnects.forEach((nc, i) => noConnectIds.set(refId('noconnect', nc.uuid, i), nc.at));
  const wireIds = new Set<string>();
  sch.lines.forEach((l, i) => {
    if (l.kind === 'wire') wireIds.add(refId('line', l.uuid, i));
  });
  // Sheet-pin node ids (`<sheetId>:sheetpin<k>`): they count as connections; nets
  // crossing the hierarchy are exempt from single-sheet label/unconnected checks.
  const isSheetPin = (id: string): boolean => id.includes(':sheetpin');
  /** A placed symbol's library id, by its refId. */
  const symbolLibIdById = new Map<string, string>(
    sch.symbols.map((sym, i) => [refId('symbol', sym.uuid, i), sym.libId]),
  );
  /** A placed symbol's Value, by its refId, a power symbol's net name. */
  const symbolValueById = new Map<string, string>(
    sch.symbols.map((sym, i) => [
      refId('symbol', sym.uuid, i),
      sym.fields.find((f) => f.key === 'Value')?.value ?? '',
    ]),
  );

  // State more than one check reads: the name-merged nets (KiCad's m_nets),
  // the bus lines, the connection grid and the symbols grouped by reference
  // (SCH_REFERENCE_LIST's m_refMap).
  interface NetGroup {
    name: string;
    pins: PinNode[];
    /** Pins of the same net on other sheets (hierarchy-merged). */
    external: readonly ExternalPin[];
    hasNC: boolean;
    labels: string[];
    hasSheetPin: boolean;
  }
  const groups = new Map<string, NetGroup>();
  for (const net of netlist.nets) {
    let g = groups.get(net.name);
    if (!g) {
      g = {
        name: net.name,
        pins: [],
        external: opts.externalNetPins?.get(net.name) ?? [],
        hasNC: opts.externalNetNoConnects?.has(net.name) ?? false,
        labels: [],
        hasSheetPin: false,
      };
      groups.set(net.name, g);
    }
    for (const id of net.items) {
      const p = pinById.get(id);
      if (p) g.pins.push(p);
      if (noConnectIds.has(id)) g.hasNC = true;
      if (labelIds.has(id)) g.labels.push(id);
      if (isSheetPin(id)) g.hasSheetPin = true;
    }
  }

  // With hierarchy data the net tests see the whole net, so a sheet pin is no
  // longer a reason to stand down (upstream never had to: its m_nets entry
  // already spans the sheets).
  const hierarchyKnown = opts.externalNetPins !== undefined;
  /** Global labels by text, for ercCheckSingleGlobalLabel / TestSameLocalGlobalLabel. */
  const globalLabels = new Map<string, { id: string; at: Vec2 }[]>();
  for (const [lid, l] of labelIds) {
    if (l.kind !== 'global_label') continue;
    const arr = globalLabels.get(l.text) ?? [];
    arr.push({ id: lid, at: l.at });
    globalLabels.set(l.text, arr);
  }
  const grid = Math.round(opts.connectionGridIU ?? 0);
  const busLines = sch.lines
    .map((l, i) => ({ l, id: refId('line', l.uuid, i) }))
    .filter((x) => x.l.kind === 'bus');
  const netByCode = new Map(netlist.nets.map((n) => [n.code, n]));
  const refOf = (s: (typeof sch.symbols)[number]): string =>
    s.fields.find((f) => f.key === 'Reference')?.value ?? '';
  const fieldValue = (s: (typeof sch.symbols)[number], key: string): string =>
    s.fields.find((f) => f.key === key)?.value ?? '';
  /**
   * The symbols grouped by reference, SCH_REFERENCE_LIST's m_refMap, which
   * upstream builds over the *whole* hierarchy. Symbols on other sheets come in
   * as `externalSymbols`, so a reference shared across sheets is one group here
   * too; each entry keeps its hierarchy order, and only the sheet that owns the
   * entry a fault is reported against raises the marker.
   */
  interface RefEntry {
    unit: number;
    libId: string;
    value: string;
    footprint: string;
    sheetIndex: number;
    index: number;
    /** The placed symbol, when it is on this sheet. */
    sym?: (typeof sch.symbols)[number];
  }
  const byRef = new Map<string, RefEntry[]>();
  const hereIndex = opts.sheetIndex ?? 0;
  sch.symbols.forEach((sym, index) => {
    const ref = refOf(sym);
    if (!ref || ref.startsWith('#')) return;
    const arr = byRef.get(ref) ?? [];
    arr.push({
      unit: sym.unit,
      libId: sym.libId,
      value: fieldValue(sym, 'Value'),
      footprint: fieldValue(sym, 'Footprint'),
      sheetIndex: hereIndex,
      index,
      sym,
    });
    byRef.set(ref, arr);
  });
  for (const ext of opts.externalSymbols ?? []) {
    if (!ext.ref || ext.ref.startsWith('#')) continue;
    const arr = byRef.get(ext.ref) ?? [];
    arr.push({
      unit: ext.unit,
      libId: ext.libId,
      value: ext.value,
      footprint: ext.footprint,
      sheetIndex: ext.sheetIndex,
      index: ext.index,
    });
    byRef.set(ext.ref, arr);
  }
  for (const arr of byRef.values()) {
    arr.sort((a, b) =>
      a.sheetIndex !== b.sheetIndex ? a.sheetIndex - b.sheetIndex : a.index - b.index,
    );
  }
  /** The id of an entry on this sheet (the only ones a marker can point at). */
  const refItemId = (e: RefEntry): string => refId('symbol', e.sym?.uuid, e.index);

  /** CONNECTION_GRAPH::ercCheckNoConnects, per subgraph. */
  const checkNoConnects = (): void => {
    for (const net of netlist.nets) {
      const netPins = net.items.filter((id) => pinById.has(id)).map((id) => pinById.get(id)!);
      const netNCs = net.items.filter((id) => noConnectIds.has(id));
      const netLabels = net.items.filter((id) => labelIds.has(id));

      // Distinct (non-stacked) pins, as ercCheckNoConnects counts them.
      const distinctPins: PinNode[] = [];
      for (const p of netPins) {
        if (!distinctPins.some((q) => stacked(p, q))) distinctPins.push(p);
      }

      if (netNCs.length > 0) {
        if (distinctPins.length > 1) {
          const p = netPins[0]!;
          out.push(
            violation(
              'no_connect_connected',
              'A pin with a "no connection" flag is connected',
              p.at,
              [selectableId(p.id), netNCs[0]!],
            ),
          );
        }
        if (netPins.length === 0 && netLabels.length === 0) {
          out.push(
            violation(
              'no_connect_dangling',
              'Unconnected "no connection" flag',
              noConnectIds.get(netNCs[0]!)!,
              [netNCs[0]!],
            ),
          );
        }
        continue; // a no-connect exempts the subgraph from the unconnected-pin check
      }

      // ERCE_PIN_NOT_CONNECTED: a pin with no other connections on its subgraph.
      // Labels and sheet pins count as connections (they join the net by name);
      // other non-stacked pins count; a bare stub wire does not (KiCad: wires have
      // driver priority NONE).
      if (net.items.some(isSheetPin)) continue;
      if (netPins.length > 0 && netLabels.length === 0 && distinctPins.length === 1) {
        const p = distinctPins[0]!;
        if (p.electricalType !== 'no_connect' && p.electricalType !== 'free' && !p.hidden) {
          out.push(violation('pin_not_connected', 'Pin not connected', p.at, [selectableId(p.id)]));
        }
      }
    }
  };

  /** CONNECTION_GRAPH::ercCheckLabels, a label needs pins on its net. */
  const ercCheckLabels = (): void => {
    for (const group of groups.values()) {
      const gpins = group.pins;
      const external = group.external;
      // Locals and hierarchical labels error with no pins and warn with exactly
      // one; globals keep KiCad's default of ignoring the single-instance check.
      // The pin count is the merged net's (upstream counts the whole net); a
      // sheet pin only stands the check down when the hierarchy is unknown.
      const netPinCount = gpins.length + external.length;
      if (
        group.labels.length > 0 &&
        !group.hasNC &&
        !(hierarchyKnown ? false : group.hasSheetPin) &&
        netPinCount <= 1
      ) {
        for (const lid of group.labels) {
          const l = labelIds.get(lid)!;
          if (l.kind === 'global_label' && netPinCount === 1) continue;
          if (netPinCount === 0) {
            out.push(violation('label_dangling', 'Label not connected', l.at, [lid]));
          } else if (l.kind !== 'global_label') {
            out.push(
              violation('isolated_pin_label', 'Label connected to only one pin', l.at, [lid]),
            );
          }
        }
      }
    }
  };

  /** CONNECTION_GRAPH::ercCheckDirectiveLabels, a dangling netclass directive label. */
  const ercCheckDirectiveLabels = (): void => {
    for (const [i, label] of (sch.directiveLabels ?? []).entries()) {
      // SCH_LABEL::IsDangling: nothing of the connectivity graph lands on it.
      const attached =
        sch.lines.some(
          (l) => (l.kind === 'wire' || l.kind === 'bus') && onSegment(label.at, l.start, l.end),
        ) || pins.some((p) => p.at.x === label.at.x && p.at.y === label.at.y);
      if (attached) continue;
      out.push(
        violation('label_dangling', 'Label not connected', label.at, [
          label.uuid ?? `directivelabel:idx:${i}`,
        ]),
      );
    }
  };

  /** CONNECTION_GRAPH::ercCheckMultipleDrivers, two names on one net. */
  const ercCheckMultipleDrivers = (): void => {
    for (const net of netlist.nets) {
      interface DriverItem {
        id: string;
        name: string;
        at: Vec2;
      }
      const drivers: DriverItem[] = [];
      for (const id of net.items) {
        const l = labelIds.get(id);
        if (l) {
          drivers.push({ id, name: l.text, at: l.at });
          continue;
        }
        const p = pinById.get(id);
        if (p && p.electricalType === 'power_in' && (p.isPowerSymbol || p.hidden)) {
          const name = p.isPowerSymbol ? (symbolValueById.get(p.symId) ?? '') : p.name;
          if (name) drivers.push({ id: selectableId(p.id), name, at: p.at });
        }
      }
      if (drivers.length < 2) continue;
      // Both sides are driver names (GetNameForDriver), so neither carries the
      // sheet path, otherwise "/ALPHA" would read as a conflict with "ALPHA".
      const primary = net.localName;
      for (const d of drivers) {
        if (d.name === primary) continue;
        out.push(
          violation(
            'multiple_net_names',
            `Both ${primary} and ${d.name} are attached to the same items; ${primary} will be used in the netlist`,
            d.at,
            [d.id],
          ),
        );
        break; // upstream reports the first conflicting driver and returns
      }
    }
  };

  /** CONNECTION_GRAPH::ercCheckBusToNetConflicts / ercCheckBusToBusEntryConflicts / ercCheckBusToBusConflicts. */
  const ercCheckBusConflicts = (): void => {
    // bus_to_net_conflict (ERCE_BUS_TO_NET_CONFLICT): a wire endpoint sitting
    // directly on a bus (no entry), or a bus-syntax label driving a wire net.
    sch.lines.forEach((l, i) => {
      if (l.kind !== 'wire') return;
      const wid = refId('line', l.uuid, i);
      for (const p of [l.start, l.end]) {
        const bus = busLines.find((b) => onSegment(p, b.l.start, b.l.end));
        if (bus) {
          out.push(
            violation('bus_to_net_conflict', 'Invalid connection between bus and net items', p, [
              wid,
              bus.id,
            ]),
          );
          break; // one marker per wire, like the off-grid test
        }
      }
    });
    for (const [lid, l] of labelIds) {
      if (!isBusLabel(l.text)) continue;
      // Bus labels on a bus were routed to the bus graph; one still in the wire
      // netlist is a bus label attached to net items, but only when the net
      // has other items (upstream needs a net item AND a bus item; a floating
      // bus label is just unconnected).
      const code = netlist.netByItem.get(lid);
      const net = code !== undefined ? netByCode.get(code) : undefined;
      if (net && net.items.length > 1) {
        out.push(
          violation('bus_to_net_conflict', 'Invalid connection between bus and net items', l.at, [
            lid,
          ]),
        );
      }
    }

    // net_not_bus_member (ERCE_BUS_ENTRY_CONFLICT): a net attached to a bus via
    // an entry, whose resolved name is not one of the bus's members. Power-pin /
    // global-label driven nets are exempt, and unnamed (auto-named) nets are
    // left to the unconnected checks, like upstream.
    const globalLabelNets = new Set<number>();
    for (const [lid, l] of labelIds) {
      if (l.kind === 'global_label') {
        const code = netlist.netByItem.get(lid);
        if (code !== undefined) globalLabelNets.add(code);
      }
    }
    const powerNets = new Set<number>();
    for (const p of pins) {
      // A power *input* pin drives the net's name (SCH_PIN::IsGlobalPower); a
      // power symbol's power_out pin (PWR_FLAG) does not.
      if (p.electricalType !== 'power_in' || !(p.isPowerSymbol || p.hidden)) continue;
      const code = netlist.netByItem.get(p.id);
      if (code !== undefined) powerNets.add(code);
    }
    const entryById = new Map(
      sch.busEntries.map((e, i) => [refId('busentry', e.uuid, i), e] as const),
    );
    for (const bus of netlist.buses) {
      if (bus.members.length === 0) continue;
      const memberSet = new Set(bus.members);
      const busLineId = bus.items.find((id) => busLines.some((b) => b.id === id));
      for (const entryId of bus.entryIds) {
        const code = netlist.netByItem.get(entryId);
        if (code === undefined) continue;
        if (globalLabelNets.has(code) || powerNets.has(code)) continue;
        const net = netByCode.get(code);
        if (!net || net.name.startsWith('Net-')) continue; // undriven: incomplete
        // Members are the bus label's own tokens, so compare the net's own name:
        // both sides of the comparison are local to this sheet.
        if (memberSet.has(net.localName)) continue;
        const entry = entryById.get(entryId);
        out.push(
          violation(
            'net_not_bus_member',
            `Net ${net.name} is graphically connected to bus ${bus.name} but is not a member of that bus`,
            entry?.at ?? { x: 0, y: 0 },
            busLineId ? [entryId, busLineId] : [entryId],
          ),
        );
      }
    }

    // bus_to_bus_conflict (ERCE_BUS_TO_BUS_CONFLICT): a bus label and a bus
    // port (hierarchical label) on the same bus that share no members.
    for (const bus of netlist.buses) {
      const label = bus.labels.find((l) => !l.port);
      const port = bus.labels.find((l) => l.port);
      if (!label || !port) continue;
      const a = new Set(expandBusLabel(label.text, opts.busAliases)?.members ?? []);
      const bMembers = expandBusLabel(port.text, opts.busAliases)?.members ?? [];
      if (!bMembers.some((m) => a.has(m))) {
        const l = labelIds.get(label.id);
        out.push(
          violation(
            'bus_to_bus_conflict',
            'Buses are graphically connected but share no bus members',
            l?.at ?? { x: 0, y: 0 },
            [label.id, port.id],
          ),
        );
      }
    }
  };

  /** CONNECTION_GRAPH::ercCheckFloatingWires / ercCheckDanglingWireEndpoints. */
  const ercCheckWires = (): void => {
    const endpointUsers = new Map<string, number>();
    const key = (p: Vec2): string => `${p.x},${p.y}`;
    const bump = (p: Vec2): void => {
      endpointUsers.set(key(p), (endpointUsers.get(key(p)) ?? 0) + 1);
    };
    for (const p of pins) bump(p.at);
    for (const [, l] of labelIds) bump(l.at);
    for (const at of noConnectIds.values()) bump(at);
    for (const s of sch.sheets) for (const p of s.pins) bump(p.at);
    sch.busEntries.forEach((e) => {
      bump(e.at);
      bump({ x: e.at.x + e.size.x, y: e.at.y + e.size.y });
    });
    const wires = sch.lines
      .map((l, i) => ({ l, id: refId('line', l.uuid, i) }))
      .filter((x) => x.l.kind === 'wire' || x.l.kind === 'bus');
    // A wire endpoint is dangling when nothing else lands on it: no item, and
    // no other wire touching it (mid-span contact counts, as SCH_LINE's
    // dangling state is cleared by any connection).
    const touches = (p: Vec2, self: string): boolean =>
      (endpointUsers.get(key(p)) ?? 0) > 0 ||
      wires.some(
        (w) =>
          w.id !== self &&
          (onSegment(p, w.l.start, w.l.end) ||
            (w.l.start.x === p.x && w.l.start.y === p.y) ||
            (w.l.end.x === p.x && w.l.end.y === p.y)),
      );
    for (const w of wires) {
      const startFree = !touches(w.l.start, w.id);
      const endFree = !touches(w.l.end, w.id);
      // Both ends free: the wire is connected to nothing at all (floating).
      if (startFree && endFree) {
        out.push(violation('wire_dangling', 'Wires not connected to anything', w.l.start, [w.id]));
        continue;
      }
      if (startFree) {
        out.push(
          violation('unconnected_wire_endpoint', 'Unconnected wire endpoint', w.l.start, [w.id]),
        );
      }
      if (endFree) {
        out.push(
          violation('unconnected_wire_endpoint', 'Unconnected wire endpoint', w.l.end, [w.id]),
        );
      }
    }
  };

  /** CONNECTION_GRAPH::ercCheckSingleGlobalLabel. */
  const ercCheckSingleGlobalLabel = (): void => {
    for (const [text, arr] of globalLabels) {
      if (arr.length !== 1 || opts.otherSheetGlobalLabels?.has(text)) continue;
      out.push(
        violation(
          'single_global_label',
          'Global label only appears once in the schematic',
          arr[0]!.at,
          [arr[0]!.id],
        ),
      );
    }
  };

  /** CONNECTION_GRAPH::ercCheckHierSheets. */
  const ercCheckHierSheets = (): void => {
    // Every sheet pin must have a hierarchical label of the same name in the
    // child sheet, and every hierarchical label a matching pin.
    if (opts.subSheets) {
      sch.sheets.forEach((s, i) => {
        const file = s.fields.find((f) => f.key === 'Sheetfile')?.value ?? '';
        const child = opts.subSheets?.get(file);
        if (!child) return;
        const sheetId = refId('sheet', s.uuid, i);
        const childLabels = child.labels.filter((l) => l.kind === 'hierarchical_label');
        for (const pin of s.pins) {
          if (!childLabels.some((l) => l.text === pin.name)) {
            out.push(
              violation(
                'hier_label_mismatch',
                `Sheet pin ${unescapeString(pin.name)} has no matching hierarchical label inside the sheet`,
                pin.at,
                [sheetId],
              ),
            );
          }
        }
        for (const label of childLabels) {
          if (!s.pins.some((p) => p.name === label.text)) {
            out.push(
              violation(
                'hier_label_mismatch',
                `Hierarchical label ${unescapeString(label.text)} has no matching sheet pin in the parent sheet`,
                s.at,
                [sheetId],
              ),
            );
          }
        }
      });
    }
  };

  /** ERC_TESTER::TestDuplicateSheetNames. */
  const testDuplicateSheetNames = (): void => {
    const sheetName = (s: (typeof sch.sheets)[number]): string =>
      s.fields.find((f) => f.key === 'Sheetname')?.value ?? '';
    sch.sheets.forEach((s, i) => {
      const name = sheetName(s);
      if (!name) return;
      for (let j = i + 1; j < sch.sheets.length; j++) {
        const other = sch.sheets[j]!;
        // Case-insensitive, "to avoid mistakes between similar names".
        if (sheetName(other).toLowerCase() !== name.toLowerCase()) continue;
        out.push(
          violation('duplicate_sheet_names', 'Duplicate sheet names within a given sheet', s.at, [
            refId('sheet', s.uuid, i),
            refId('sheet', other.uuid, j),
          ]),
        );
      }
    });
  };

  /** ERC_TESTER::TestPinMap. */
  const testPinMap = (): void => {
    // A pin map's entries must name pins the symbol actually has, and two pins
    // may not claim one pad unless a jumper group ties them together. (Pin maps
    // and pin numbers are library-symbol properties, so upstream walks unique
    // screens rather than sheet paths, one sheet's run is one screen here.)
    sch.symbols.forEach((sym, i) => {
      const lib = libById.get(sym.libId);
      const maps = lib?.pinMaps ?? [];
      if (!lib || maps.length === 0) return;
      const id = refId('symbol', sym.uuid, i);
      const pinNumbers = new Set(lib.units.flatMap((u) => u.pins.map((p) => p.number)));
      const jumperGroups = lib.jumperPinGroups ?? [];
      const sharesJumperGroup = (a: string, b: string): boolean =>
        jumperGroups.some((g) => g.includes(a) && g.includes(b));

      for (const map of maps) {
        for (const entry of map.entries) {
          if (pinNumbers.has(entry.pin)) continue;
          out.push(
            violation(
              'pin_map_stale_pin',
              `Pin map '${map.name}' references unknown symbol pin '${entry.pin}'`,
              sym.at,
              [id],
            ),
          );
        }

        // A single pin stacked across several pads is allowed; two pins on one
        // pad is not.
        const padToPin = new Map<string, string>();
        for (const entry of map.entries) {
          for (const pad of expandStackedPinNotation(entry.pad).numbers) {
            const owner = padToPin.get(pad);
            if (owner === undefined) {
              padToPin.set(pad, entry.pin);
            } else if (owner !== entry.pin && !sharesJumperGroup(owner, entry.pin)) {
              out.push(
                violation(
                  'pin_map_duplicate_pad',
                  `Symbol pins '${owner}' and '${entry.pin}' both map to pad '${pad}'`,
                  sym.at,
                  [id],
                ),
              );
            }
          }
        }
      }
    });

    // TestPinMap's pad half: an association's map may only name pads the bound
    // footprint actually has, and a connected pin must resolve to some pad.
    if (opts.footprintPads) {
      const padsOf = (libId: string): ReadonlySet<string> | undefined => {
        const pads = opts.footprintPads?.get(libId);
        return pads && pads.size > 0 ? pads : undefined;
      };

      sch.symbols.forEach((sym, i) => {
        const lib = libById.get(sym.libId);
        if (!lib) return;
        const id = refId('symbol', sym.uuid, i);
        const maps = lib.pinMaps ?? [];
        const associations = lib.associatedFootprints ?? [];

        // ERCE_PIN_MAP_BAD_PAD
        for (const assoc of associations) {
          const map = maps.find((m) => m.name === assoc.mapName);
          if (!map) continue;
          const pads = padsOf(assoc.footprintLibId);
          if (!pads) continue;
          for (const entry of map.entries) {
            for (const pad of expandStackedPinNotation(entry.pad).numbers) {
              if (pads.has(pad)) continue;
              out.push(
                violation(
                  'pin_map_bad_pad',
                  `Pin map '${map.name}' references pad '${pad}' not present on footprint '${assoc.footprintLibId}'`,
                  sym.at,
                  [id],
                ),
              );
            }
          }
        }

        // ERCE_PIN_MAP_UNMAPPED_PIN, only for symbols that bind a footprint.
        if (associations.length === 0) return;
        const fpText = fieldValue(sym, 'Footprint');
        const sep = fpText.indexOf(':');
        if (fpText === '' || sep <= 0) return;
        const pads = padsOf(fpText);
        if (!pads) return;

        // SCH_PIN::GetEffectivePadNumber's resolution order.
        const override = sym.pinMapOverride;
        const mode = override?.mode ?? 'library_default';
        let map: (typeof maps)[number] | undefined;
        if (mode === 'named_map') map = maps.find((m) => m.name === override?.mapName);
        if (!map && mode !== 'identity') {
          const assoc = associations.find((a) => a.footprintLibId === fpText);
          if (assoc) map = maps.find((m) => m.name === assoc.mapName);
        }

        for (const pin of pins) {
          if (pin.symId !== id) continue;
          // Dangling pins are skipped: an unconnected pin needs no pad.
          if (netlist.netByItem.get(pin.id) === undefined) continue;
          // Instance-local sparse edits win, unless identity is forced.
          if (mode !== 'identity' && override?.edits.some((e) => e.pin === pin.number)) continue;
          // 1. MAPPED, an explicit entry needs no footprint.
          if (map?.entries.some((e) => e.pin === pin.number)) continue;
          // 2. IDENTITY, the footprint carries a pad of that number.
          if (pads.has(pin.number)) continue;
          // 3. UNMAPPED.
          out.push(
            violation(
              'pin_map_unmapped_pin',
              `Pin '${pin.number}' is connected but maps to no pad on footprint '${fpText}'`,
              pin.at,
              [selectableId(pin.id)],
            ),
          );
        }
      });
    }
  };

  /** ERC_TESTER::TestNoConnectPins. */
  const testNoConnectPins = (): void => {
    const byPoint = new Map<string, { nc: PinNode[]; others: number }>();
    const keyOf = (p: Vec2): string => `${p.x},${p.y}`;
    for (const p of pins) {
      if (p.electricalType !== 'no_connect') continue;
      const e = byPoint.get(keyOf(p.at)) ?? { nc: [], others: 0 };
      e.nc.push(p);
      byPoint.set(keyOf(p.at), e);
    }
    const bump = (pt: Vec2): void => {
      const e = byPoint.get(keyOf(pt));
      if (e) e.others++;
    };
    for (const p of pins) if (p.electricalType !== 'no_connect') bump(p.at);
    sch.lines.forEach((l) => {
      if (l.kind === 'wire') {
        bump(l.start);
        bump(l.end);
      }
    });
    sch.labels.forEach((l) => {
      if (l.kind !== 'text') bump(l.at);
    });
    sch.junctions.forEach((j) => bump(j.at));
    for (const { nc, others } of byPoint.values()) {
      if (others > 0) {
        const p = nc[0]!;
        out.push(
          violation('no_connect_connected', "Pin with 'no connection' type is connected", p.at, [
            selectableId(p.id),
          ]),
        );
      }
    }
  };

  /** ERC_TESTER::TestPinToPin, the pin conflict matrix and the driver test. */
  const testPinToPin = (): void => {
    for (const group of groups.values()) {
      const gpins = group.pins;
      const external = group.external;

      // Power net: any power-input pin present (erc.cpp TestPinToPin).
      const isPowerNet =
        gpins.some((p) => p.electricalType === 'power_in') ||
        external.some((p) => p.electricalType === 'power_in');

      let needsDriver: PinNode | null = null;
      let hasDriver = false;
      // Every pin that wants a driver, split the way TestPinToPin splits them so
      // the marker lands on a pin matching the message.
      const pinsNeedingDrivers: PinNode[] = [];
      const nonPowerPinsNeedingDrivers: PinNode[] = [];
      const powerInPinsNeedingDrivers: PinNode[] = [];
      const mismatches: [number, number, PinError][] = [];
      const externalMismatches: [number, ExternalPin, PinError][] = [];
      const mismatchCounts = new Map<number, number>();

      // An off-sheet pin can drive the net, and an off-sheet driven pin can be
      // the one the error should be reported against, in which case this sheet
      // stays quiet and the sheet that owns the pin reports it (below).
      for (const ext of external) {
        hasDriver ||= (isPowerNet ? DRIVING_POWER : DRIVING).has(ext.electricalType);
      }

      for (let i = 0; i < gpins.length; i++) {
        const ref = gpins[i]!;
        const refType = ref.electricalType;

        if (DRIVEN.has(refType)) {
          pinsNeedingDrivers.push(ref);
          // SCH_PIN::IsPower(), a power pin is a power *input* pin; anything
          // else is "non power" and makes a better anchor for the marker.
          if (!(refType === 'power_in')) nonPowerPinsNeedingDrivers.push(ref);
          if (refType === 'power_in') powerInPinsNeedingDrivers.push(ref);
          // Prefer a visible pin, and on a power net a power-in pin, for the report.
          if (
            !needsDriver ||
            (needsDriver.hidden && !ref.hidden) ||
            (isPowerNet !== (needsDriver.electricalType === 'power_in') &&
              isPowerNet === (refType === 'power_in'))
          ) {
            needsDriver = ref;
          }
        }
        hasDriver ||= (isPowerNet ? DRIVING_POWER : DRIVING).has(refType);

        // The rest of the net, on other sheets: it can drive this net and it can
        // conflict with a local pin (upstream walks one merged pin list; here the
        // pairs that both live off-sheet are left to that sheet's own run).
        for (const ext of external) {
          if (stacked2(ref, ext)) continue;
          const erc = g_settings.pinMap[typeIndex(refType)]![typeIndex(ext.electricalType)]!;
          if (erc !== OK) {
            externalMismatches.push([i, ext, erc]);
            mismatchCounts.set(i, (mismatchCounts.get(i) ?? 0) + 1);
          }
        }

        for (let j = i + 1; j < gpins.length; j++) {
          const test = gpins[j]!;
          if (stacked(ref, test)) continue; // stacked pins don't conflict
          const erc = g_settings.pinMap[typeIndex(refType)]![typeIndex(test.electricalType)]!;
          if (erc !== OK) {
            mismatches.push([i, j, erc]);
            mismatchCounts.set(i, (mismatchCounts.get(i) ?? 0) + 1);
            mismatchCounts.set(j, (mismatchCounts.get(j) ?? 0) + 1);
          }
        }
      }

      // TestPinToPin walks a net's pins in (symbol reference, pin number) order
      // and keeps upgrading the pin the error will be reported against. Over a
      // hierarchy the same walk decides which *sheet* owns the marker: if the
      // winner is off-sheet, that sheet's run raises it and this one stays quiet.
      let externalNeedsDriverWins = false;
      if (hierarchyKnown && needsDriver && !hasDriver) {
        interface Candidate {
          local: PinNode | null;
          ref: string;
          number: string;
          type: string;
          visible: boolean;
        }
        const candidates: Candidate[] = [
          ...gpins
            .filter((p) => DRIVEN.has(p.electricalType))
            .map((p) => ({
              local: p,
              ref: p.ref,
              number: p.number,
              type: p.electricalType,
              visible: !p.hidden,
            })),
          ...external
            .filter((p) => DRIVEN.has(p.electricalType))
            .map((p) => ({
              local: null,
              ref: p.ref,
              number: p.number,
              type: p.electricalType,
              visible: !p.hidden,
            })),
        ].sort((a, b) => a.ref.localeCompare(b.ref) || a.number.localeCompare(b.number));

        let winner: Candidate | null = null;
        for (const c of candidates) {
          if (
            !winner ||
            (!winner.visible && c.visible) ||
            (isPowerNet !== (winner.type === 'power_in') && isPowerNet === (c.type === 'power_in'))
          ) {
            winner = c;
          }
        }
        externalNeedsDriverWins = !!winner && winner.local === null;
        if (winner?.local) needsDriver = winner.local;
      }

      // Report each offending pin once, against its nearest conflicting pin,
      // consuming its pairs, KiCad's aggregation in TestPinToPin.
      const order = [...mismatchCounts.entries()].sort((a, b) => b[1] - a[1]).map(([idx]) => idx);
      let remaining = mismatches;
      for (const idx of order) {
        if (remaining.length === 0) break;
        const pin = gpins[idx]!;
        let nearest = -1;
        let nearestErc = WAR as PinError;
        let best = Infinity;
        remaining = remaining.filter(([a, b, erc]) => {
          const other = a === idx ? b : b === idx ? a : -1;
          if (other === -1) return true;
          const q = gpins[other]!;
          const d = (q.at.x - pin.at.x) ** 2 + (q.at.y - pin.at.y) ** 2;
          if (d < best) {
            best = d;
            nearest = other;
            nearestErc = erc;
          }
          return false;
        });
        if (nearest !== -1) {
          const other = gpins[nearest]!;
          const code: ErcCode = nearestErc === ERR ? 'pin_to_pin_error' : 'pin_to_pin';
          out.push(
            violation(
              code,
              `Pins of type ${TYPE_NAMES[pin.electricalType]} and ${TYPE_NAMES[other.electricalType]} are connected`,
              pin.at,
              [selectableId(pin.id), selectableId(other.id)],
            ),
          );
          continue;
        }
        // No local partner left: fall back to an off-sheet one. Upstream takes
        // the first such pin (the distance test only applies within a sheet).
        const cross = externalMismatches.find(([a]) => a === idx);
        if (cross) {
          const [, other, erc] = cross;
          const code: ErcCode = erc === ERR ? 'pin_to_pin_error' : 'pin_to_pin';
          out.push(
            violation(
              code,
              `Pins of type ${TYPE_NAMES[pin.electricalType]} and ${TYPE_NAMES[other.electricalType]} are connected`,
              pin.at,
              [selectableId(pin.id)],
            ),
          );
        }
      }

      // Without hierarchy data a net crossing a sheet pin may be driven on the
      // other side and we cannot see it, so the check stands down; with it, the
      // merged net is the whole story. When the pin that best represents the
      // error lives on another sheet, that sheet's run reports it (upstream
      // raises exactly one marker per undriven net).
      const skipForHierarchy = hierarchyKnown ? externalNeedsDriverWins : group.hasSheetPin;
      if (needsDriver && !hasDriver && !group.hasNC && !skipForHierarchy) {
        const code: ErcCode = isPowerNet ? 'power_pin_not_driven' : 'pin_not_driven';
        const message = isPowerNet
          ? 'Input Power pin not driven by any Output Power pins'
          : 'Input pin not driven by any Output pins';
        // TestPinToPin's pinsToMark: for a power net mark a power-input pin (what
        // the message is about); otherwise prefer a pin that is not on a power
        // symbol, so the marker sits on the consuming pin rather than a flag.
        // "Show all errors" marks the whole list instead of one representative.
        const byRefAndNumber = (a: PinNode, b: PinNode): number =>
          a.ref.localeCompare(b.ref) || a.number.localeCompare(b.number);
        const powerIn = [...powerInPinsNeedingDrivers].sort(byRefAndNumber);
        const nonPower = [...nonPowerPinsNeedingDrivers].sort(byRefAndNumber);
        let marked: PinNode[];
        if (opts.showAllErrors) {
          marked =
            isPowerNet && powerIn.length > 0
              ? powerIn
              : nonPower.length > 0
                ? nonPower
                : pinsNeedingDrivers;
        } else {
          marked = isPowerNet && powerIn.length > 0 ? [powerIn[0]!] : [needsDriver];
        }
        for (const p of marked) {
          out.push(violation(code, message, p.at, [selectableId(p.id)]));
        }
      }
    }
  };

  /**
   * ERC_TESTER::TestSimilarLabels, texts that differ only in case. Upstream
   * walks every subgraph of m_nets, so labels on *different* sheets are
   * compared too; here the other sheets' texts arrive as `externalLabels`.
   * The marker goes on the later of the pair (upstream keeps the first-seen
   * item and reports the one that follows it), so each pair is raised once, by
   * the sheet that owns the later item.
   */
  const testSimilarLabels = (): void => {
    interface SimilarItem {
      id: string;
      text: string;
      at: Vec2;
      isPin: boolean;
      /** Hierarchy order: sheet position, then position within the sheet. */
      sheetIndex: number;
      index: number;
      local: boolean;
    }
    const here = opts.sheetIndex ?? 0;
    const similar: SimilarItem[] = [];
    let order = 0;
    for (const [lid, l] of labelIds) {
      similar.push({
        id: lid,
        text: l.text,
        at: l.at,
        isPin: false,
        sheetIndex: here,
        index: order++,
        local: true,
      });
    }
    // A power pin's text is its symbol's value (upstream's GetValue).
    const seenPowerSymbol = new Set<string>();
    for (const p of pins) {
      if (p.electricalType !== 'power_in' || !p.isPowerSymbol) continue;
      if (seenPowerSymbol.has(p.symId)) continue;
      seenPowerSymbol.add(p.symId);
      const value = symbolValueById.get(p.symId) ?? '';
      if (value) {
        similar.push({
          id: selectableId(p.id),
          text: value,
          at: p.at,
          isPin: true,
          sheetIndex: here,
          index: order++,
          local: true,
        });
      }
    }
    for (const ext of opts.externalLabels ?? []) {
      similar.push({
        id: '',
        text: ext.text,
        at: { x: 0, y: 0 },
        isPin: ext.isPin,
        sheetIndex: ext.sheetIndex,
        index: ext.index,
        local: false,
      });
    }

    const before = (a: SimilarItem, b: SimilarItem): boolean =>
      a.sheetIndex !== b.sheetIndex ? a.sheetIndex < b.sheetIndex : a.index < b.index;

    const byLower = new Map<string, SimilarItem[]>();
    for (const item of similar) {
      const key = item.text.toLowerCase();
      const arr = byLower.get(key) ?? [];
      arr.push(item);
      byLower.set(key, arr);
    }
    for (const arr of byLower.values()) {
      for (const item of arr) {
        if (!item.local) continue; // another sheet's run reports its own items
        const other = arr.find((o) => o.text !== item.text && before(o, item));
        if (!other) continue;
        const code: ErcCode =
          item.isPin && other.isPin
            ? 'similar_power'
            : item.isPin || other.isPin
              ? 'similar_label_and_power'
              : 'similar_labels';
        // logError sets no message: the tree shows the ERC_ITEM's own title.
        out.push(
          violation(
            code,
            ERC_ITEMS.find((e) => e.code === code)!.title,
            item.at,
            other.local ? [item.id, other.id] : [item.id],
          ),
        );
      }
    }
  };

  /** ERC_TESTER::TestSameLocalGlobalLabel. */
  const testSameLocalGlobalLabel = (): void => {
    // ERCE_SAME_LOCAL_GLOBAL_LABEL: one name used by both a local and a global.
    for (const [lid, l] of labelIds) {
      if (l.kind !== 'label') continue;
      if (!globalLabels.has(l.text)) continue;
      out.push(
        violation('same_local_global_label', 'Local and global labels have same name', l.at, [
          lid,
          globalLabels.get(l.text)![0]!.id,
        ]),
      );
    }

    // TestSameLocalGlobalLabel's power half: the same name on a global and a
    // local power symbol is ERCE_SAME_LOCAL_GLOBAL_POWER.
    const globalPower = new Map<string, PinNode>();
    const localPower = new Map<string, PinNode>();
    for (const p of pins) {
      if (p.electricalType !== 'power_in' || !p.isPowerSymbol) continue;
      const value = symbolValueById.get(p.symId) ?? '';
      if (!value) continue;
      const map = p.isLocalPowerSymbol ? localPower : globalPower;
      if (!map.has(value)) map.set(value, p);
    }
    for (const [value, global] of globalPower) {
      const local = localPower.get(value);
      if (!local) continue;
      out.push(
        violation(
          'same_local_global_power',
          'Local and global power symbols have same name',
          global.at,
          [selectableId(global.id), selectableId(local.id)],
        ),
      );
    }
  };

  /** ERC_TESTER::TestTextVars. */
  const testTextVars = (): void => {
    if (opts.resolveTextVar) {
      const scan = (text: string, at: Vec2, id: string): void => {
        for (const m of text.matchAll(/\$\{([^}]+)\}/g)) {
          const name = m[1]!;
          if (opts.resolveTextVar?.(name) === undefined) {
            out.push(violation('unresolved_variable', 'Unresolved text variable', at, [id]));
          }
        }
      };
      sch.labels.forEach((l, i) => {
        scan(l.text, l.at, refId('label', l.uuid, i));
      });
      sch.symbols.forEach((s, i) => {
        const id = refId('symbol', s.uuid, i);
        for (const f of s.fields) scan(f.value, s.at, id);
      });
    }
  };

  /** ERC_TESTER::TestFieldNameWhitespace. */
  const testFieldNameWhitespace = (): void => {
    // TestFieldNameWhitespace.
    sch.symbols.forEach((s, i) => {
      for (const f of s.fields) {
        if (f.key === f.key.trim()) continue;
        out.push(
          violation(
            'field_name_whitespace',
            `Field name has leading or trailing whitespace: '${f.key}'`,
            s.at,
            [refId('symbol', s.uuid, i)],
          ),
        );
      }
    });
  };

  /** ERC_TESTER::TestSimModelIssues. */
  const testSimModelIssues = (): void => {
    if (g_settings.severities.simulation_model_issue !== 'ignore') {
      sch.symbols.forEach((sym, i) => {
        const reference = sym.fields.find((f) => f.key === 'Reference')?.value ?? '';
        // Power symbols and anything else referenced with '#' are not simulated.
        if (reference.startsWith('#') || sym.excludedFromSim) return;
        const issues = checkSimModel(
          sym,
          libById.get(sym.libId),
          opts.simLibraryText ?? (() => undefined),
        );
        if (issues.length === 0) return;
        out.push(
          violation('simulation_model_issue', issues.map((x) => x.message).join('\n'), sym.at, [
            refId('symbol', sym.uuid, i),
          ]),
        );
      });
    }
  };

  /**
   * ERC_TESTER::TestLibSymbolIssues, the library a symbol names must be in the
   * configuration and must still hold it, and the schematic's cached copy must
   * match the library's. A symbol with no cached copy at all is skipped, as
   * upstream skips it (`if( !libSymbolInSchematic ) continue`).
   */
  const testLibSymbolIssues = (): void => {
    /** LIB_ID -> [library nickname, symbol name]. */
    const splitLibId = (libId: string): [string, string] => {
      const sep = libId.indexOf(':');
      return sep <= 0 ? ['', libId] : [libId.slice(0, sep), libId.slice(sep + 1)];
    };

    // The symbol library table half: without one (nothing configured) the test
    // stands down rather than reporting every library as missing.
    if (opts.symbolLibs) {
      sch.symbols.forEach((sym, i) => {
        if (!libById.has(sym.libId)) return;
        const [libName, symbolName] = splitLibId(sym.libId);
        const library = opts.symbolLibs?.get(libName);
        const uri = opts.unloadedSymbolLibs?.get(libName);
        if (!library) {
          out.push(
            violation(
              'lib_symbol_issues',
              `The current configuration does not include the symbol library '${unescapeString(libName)}'`,
              sym.at,
              [refId('symbol', sym.uuid, i)],
            ),
          );
        } else if (uri !== undefined) {
          // In the table, but the library itself could not be read.
          out.push(
            violation(
              'lib_symbol_issues',
              `The symbol library '${unescapeString(libName)}' was not found at '${uri}'`,
              sym.at,
              [refId('symbol', sym.uuid, i)],
            ),
          );
        } else if (!library.has(symbolName)) {
          out.push(
            violation(
              'lib_symbol_issues',
              `Symbol '${symbolName}' not found in symbol library '${libName}'`,
              sym.at,
              [refId('symbol', sym.uuid, i)],
            ),
          );
        }
      });
    }

    // TestLibSymbolIssues' second half: the cached symbol must still match the
    // library's copy (LIB_SYMBOL::Compare under EQUALITY | ERC).
    if (opts.librarySymbols) {
      sch.symbols.forEach((sym, i) => {
        const cached = libById.get(sym.libId);
        const library = opts.librarySymbols?.get(sym.libId);
        if (!cached || !library) return;
        if (compareLibSymbolsForErc(cached, library) === null) return;
        const [libName, symbolName] = splitLibId(sym.libId);
        out.push(
          violation(
            'lib_symbol_mismatch',
            `Symbol '${symbolName}' doesn't match copy in library '${libName}'`,
            sym.at,
            [refId('symbol', sym.uuid, i)],
          ),
        );
      });
    }
  };

  /** ERC_TESTER::TestFootprintLinkIssues. */
  const testFootprintLinkIssues = (): void => {
    // TestFootprintLinkIssues: the Footprint field must name a library the
    // configuration knows and a footprint that library actually holds.
    if (opts.footprintLibs) {
      sch.symbols.forEach((sym, i) => {
        const footprint = fieldValue(sym, 'Footprint');
        if (!footprint) return;
        const id = refId('symbol', sym.uuid, i);
        const sep = footprint.indexOf(':');
        if (sep <= 0 || sep === footprint.length - 1) {
          out.push(
            violation(
              'footprint_link_issues',
              `'${footprint}' is not a valid footprint identifier`,
              sym.at,
              [id],
            ),
          );
          return;
        }
        const libName = footprint.slice(0, sep);
        const fpName = footprint.slice(sep + 1);
        const lib = opts.footprintLibs?.get(libName);
        if (!lib) {
          out.push(
            violation(
              'footprint_link_issues',
              `The current configuration does not include the footprint library '${libName}'`,
              sym.at,
              [id],
            ),
          );
        } else if (!lib.has(fpName)) {
          out.push(
            violation(
              'footprint_link_issues',
              `Footprint '${fpName}' not found in library '${libName}'`,
              sym.at,
              [id],
            ),
          );
        }
      });
    }
  };

  /** ERC_TESTER::TestFootprintFilters. */
  const testFootprintFilters = (): void => {
    // The assigned footprint must match one of the library symbol's
    // `ki_fp_filters` globs, the whole LIB_ID when the filter carries a ':',
    // otherwise the footprint name alone. Everything is compared lower-cased.
    sch.symbols.forEach((sym, i) => {
      const lib = libById.get(sym.libId);
      const filters = (lib?.properties.find((f) => f.key === 'ki_fp_filters')?.value ?? '')
        .split(/\s+/)
        .filter(Boolean);
      if (filters.length === 0) return;
      const lowerId = fieldValue(sym, 'Footprint').toLowerCase();
      // LIB_ID::Parse( lowerId ) > 0, an unparsable id is left to the link test.
      const sep = lowerId.indexOf(':');
      if (lowerId === '' || sep <= 0) return;
      const lowerItemName = lowerId.slice(sep + 1);
      const matches = filters.some((raw) => {
        const filter = raw.toLowerCase();
        return wxMatches(filter.includes(':') ? lowerId : lowerItemName, filter);
      });
      if (matches) return;
      out.push(
        violation(
          'footprint_filter',
          `Assigned footprint (${lowerItemName}) doesn't match footprint filters (${filters.join(' ')})`,
          sym.at,
          [refId('symbol', sym.uuid, i)],
        ),
      );
    });
  };

  /** ERC_TESTER::TestOffGridEndpoints. */
  const testOffGridEndpoints = (): void => {
    // ERC_TESTER::TestOffGridEndpoints: wire/bus endpoints, bus-entry connection
    // points and symbol pins must sit on the connection grid (Schematic Setup >
    // Formatting, SCHEMATIC_SETTINGS::m_ConnectionGridSize). One marker per
    // wire (start, else end) and per symbol (first off-grid pin), like upstream.
    if (grid > 0) {
      const MSG = 'Symbol pin or wire end off connection grid';
      const off = (p: Vec2): boolean =>
        Math.round(p.x) % grid !== 0 || Math.round(p.y) % grid !== 0;
      sch.lines.forEach((l, i) => {
        if (l.kind !== 'wire' && l.kind !== 'bus') return;
        const lid = refId('line', l.uuid, i);
        if (off(l.start)) out.push(violation('endpoint_off_grid', MSG, l.start, [lid]));
        else if (off(l.end)) out.push(violation('endpoint_off_grid', MSG, l.end, [lid]));
      });
      sch.busEntries.forEach((e, i) => {
        const eid = refId('busentry', e.uuid, i);
        for (const p of [e.at, { x: e.at.x + e.size.x, y: e.at.y + e.size.y }]) {
          if (off(p)) out.push(violation('endpoint_off_grid', MSG, p, [eid]));
        }
      });
      const flagged = new Set<string>();
      for (const p of pins) {
        // NC-type pins are exempt (upstream skips ELECTRICAL_PINTYPE::PT_NC).
        if (flagged.has(p.symId) || p.electricalType === 'no_connect') continue;
        if (off(p.at)) {
          out.push(violation('endpoint_off_grid', MSG, p.at, [p.id]));
          flagged.add(p.symId);
        }
      }
    }
  };

  /** ERC_TESTER::TestFourWayJunction. */
  const testFourWayJunction = (): void => {
    const atPoint = new Map<string, string[]>();
    const key = (p: Vec2): string => `${p.x},${p.y}`;
    const add = (p: Vec2, id: string): void => {
      const arr = atPoint.get(key(p)) ?? [];
      arr.push(id);
      atPoint.set(key(p), arr);
    };
    const seenPinStack = new Set<string>();
    for (const p of pins) {
      // Only one pin per pin-stack (pinStackAlreadyRepresented).
      const stackKey = `${p.symId}|${key(p.at)}`;
      if (seenPinStack.has(stackKey)) continue;
      seenPinStack.add(stackKey);
      add(p.at, selectableId(p.id));
    }
    sch.lines.forEach((l, i) => {
      if (l.kind !== 'wire' && l.kind !== 'bus') return;
      const id = refId('line', l.uuid, i);
      add(l.start, id);
      add(l.end, id);
    });
    for (const [k, ids] of atPoint) {
      if (ids.length < 4) continue;
      const [x, y] = k.split(',').map(Number) as [number, number];
      out.push(
        violation(
          'four_way_junction',
          `Four items connected at ${x}, ${y}`,
          { x, y },
          ids.slice(0, 4),
        ),
      );
    }
  };

  /** ERC_TESTER::TestLabelMultipleWires. */
  const testLabelMultipleWires = (): void => {
    // A label sitting mid-span on more than one wire: the wires are joined
    // through the label rather than through a junction.
    const wires = sch.lines
      .map((l, i) => ({ l, id: refId('line', l.uuid, i) }))
      .filter((x) => x.l.kind === 'wire');
    for (const [lid, l] of labelIds) {
      const crossing = wires.filter(
        (w) =>
          onSegment(l.at, w.l.start, w.l.end) &&
          !(w.l.start.x === l.at.x && w.l.start.y === l.at.y) &&
          !(w.l.end.x === l.at.x && w.l.end.y === l.at.y),
      );
      if (crossing.length > 1) {
        out.push(
          violation(
            'label_multiple_wires',
            `Label connects more than one wire at ${l.at.x}, ${l.at.y}`,
            l.at,
            [lid, ...crossing.slice(0, 3).map((w) => w.id)],
          ),
        );
      }
    }
  };

  /** ERC_TESTER::TestStackedPinNotation. */
  const testStackedPinNotation = (): void => {
    // A pin number that looks like stacked-pin notation but does not parse.
    for (const p of pins) {
      if (!expandStackedPinNotation(p.number).valid) {
        out.push(
          violation('stacked_pin_name', 'Pin name resembles stacked pin', p.at, [
            selectableId(p.id),
          ]),
        );
      }
    }
  };

  /** ERC_TESTER::TestDuplicatePinNets. */
  const testDuplicatePinNets = (): void => {
    // Two pins of one symbol sharing a pin number must share a net.
    {
      const netNameOfItem = (id: string): string => {
        const code = netlist.netByItem.get(id);
        return code === undefined ? '' : (netByCode.get(code)?.name ?? '');
      };
      const bySymbol = new Map<string, PinNode[]>();
      for (const p of pins) {
        const arr = bySymbol.get(p.symId) ?? [];
        arr.push(p);
        bySymbol.set(p.symId, arr);
      }
      for (const [symId, symPins] of bySymbol) {
        const lib = libById.get(symbolLibIdById.get(symId) ?? '');
        // `(duplicate_pin_numbers_are_jumpers yes)` makes the duplicates a jumper.
        if (lib?.duplicatePinNumbersAreJumpers) continue;
        const byNumber = new Map<string, PinNode[]>();
        for (const p of symPins) {
          const arr = byNumber.get(p.number) ?? [];
          arr.push(p);
          byNumber.set(p.number, arr);
        }
        for (const [number, group] of byNumber) {
          if (group.length < 2) continue;
          const firstNet = netNameOfItem(group[0]!.id);
          const conflict = group.slice(1).find((p) => netNameOfItem(p.id) !== firstNet);
          if (!conflict) continue;
          const shown = (n: string): string => (n === '' ? '<no net>' : n);
          out.push(
            violation(
              'duplicate_pins',
              `Pin ${number} on symbol '${group[0]!.ref}' is connected to different nets: ` +
                `${shown(firstNet)} and ${shown(netNameOfItem(conflict.id))}`,
              group[0]!.at,
              [selectableId(group[0]!.id), selectableId(conflict.id)],
            ),
          );
        }
      }
    }
  };

  /** ERC_TESTER::TestGroundPins. */
  const testGroundPins = (): void => {
    // A pin *named* like a ground pin on a symbol that does have a ground net,
    // but which is not itself on one.
    {
      const isGround = (txt: string): boolean => {
        const upper = txt.toUpperCase();
        return (
          upper.includes('GND') ||
          upper === 'EARTH' ||
          upper.startsWith('EARTH_') ||
          upper === 'VSS' ||
          upper === 'VSSA'
        );
      };
      const netNameOfItem = (id: string): string => {
        const code = netlist.netByItem.get(id);
        return code === undefined ? '' : (netByCode.get(code)?.name ?? '');
      };
      const bySymbol = new Map<string, PinNode[]>();
      for (const p of pins) {
        const arr = bySymbol.get(p.symId) ?? [];
        arr.push(p);
        bySymbol.set(p.symId, arr);
      }
      for (const symPins of bySymbol.values()) {
        let hasGroundNet = false;
        const mismatched: PinNode[] = [];
        for (const p of symPins) {
          // Only power pins are of interest.
          if (p.electricalType !== 'power_out' && p.electricalType !== 'power_in') continue;
          const netIsGround = isGround(netNameOfItem(p.id));
          if (netIsGround) hasGroundNet = true;
          if (isGround(p.name) && !netIsGround) mismatched.push(p);
        }
        if (!hasGroundNet) continue;
        for (const p of mismatched) {
          out.push(
            violation('ground_pin_not_ground', `Pin ${p.name} not connected to ground net`, p.at, [
              selectableId(p.id),
            ]),
          );
        }
      }
    }
  };

  /**
   * SCH_REFERENCE_LIST::CheckAnnotation, which DIALOG_ERC runs (through
   * SCH_EDIT_FRAME::CheckAnnotate) before ERC_TESTER::RunTests: unannotated
   * symbols, duplicate references, extra units, and units of one symbol
   * carrying different values. A unit's name in these messages is the
   * reference plus SCH_SYMBOL::SubReference, as upstream formats them.
   */
  const checkAnnotation = (): void => {
    for (const [ref, group] of byRef) {
      const first = group[0]!;
      const lib = libById.get(first.libId);
      const libUnits = lib ? Math.max(1, ...lib.units.map((u) => u.unit)) : 1;
      // Unannotated (CheckAnnotation's first pass). The unit number is named
      // only when the library part actually has several units.
      if (ref.includes('?')) {
        for (const g of group) {
          if (!g.sym) continue; // another sheet's run reports its own symbols
          const message =
            libUnits > 1
              ? `Item not annotated: ${ref} (unit ${g.unit})`
              : `Item not annotated: ${ref}`;
          out.push(violation('unannotated', message, g.sym.at, [refItemId(g)]));
        }
        continue;
      }
      /** SCH_SYMBOL::SubReference, the unit suffix a multi-unit part carries. */
      const sub = (g: RefEntry): string => (libUnits > 1 ? unitLabel(g.unit) : '');

      // Duplicate reference / extra units: two symbols sharing a reference and
      // a unit number, or a unit beyond the library part's unit count. The
      // marker sits on the *first* of the pair (CheckAnnotation passes it as
      // aItemA, and the handler appends to that item's screen), so the sheet
      // holding the first one reports it.
      const seenUnits = new Map<number, RefEntry>();
      for (const g of group) {
        const dupe = seenUnits.get(g.unit);
        if (dupe) {
          if (dupe.sym) {
            out.push(
              violation(
                'duplicate_reference',
                `Duplicate items ${ref}${sub(dupe)}\n`,
                dupe.sym.at,
                [refItemId(dupe), ...(g.sym ? [refItemId(g)] : [])],
              ),
            );
          }
        } else {
          seenUnits.set(g.unit, g);
        }
        if (g.sym && g.unit > libUnits) {
          out.push(
            violation(
              'extra_units',
              `Error: symbol ${ref} (unit ${g.unit}) exceeds units defined (${libUnits})`,
              g.sym.at,
              [refItemId(g)],
            ),
          );
        }
      }

      // Units of one symbol must share a value (CheckAnnotation's value test).
      // Upstream reports against the first of the pair, as above.
      if (!first.sym) continue;
      for (const g of group.slice(1)) {
        if (g.value !== first.value) {
          out.push(
            violation(
              'unit_value_mismatch',
              `Different values for ${ref}${sub(first)} (${first.value}) and ${ref}${sub(g)} (${g.value})`,
              first.sym.at,
              [refItemId(first), ...(g.sym ? [refItemId(g)] : [])],
            ),
          );
        }
      }
    }
  };

  /** ERC_TESTER::TestMultiunitFootprints. */
  const testMultiunitFootprints = (): void => {
    for (const [ref, group] of byRef) {
      if (ref.includes('?')) continue;
      const lib = libById.get(group[0]!.libId);
      const multiUnit = (lib ? Math.max(1, ...lib.units.map((u) => u.unit)) : 1) > 1;
      // GetRef( sheet, true ), the reference with its unit suffix.
      const name = (g: RefEntry): string => (multiUnit ? `${ref}${unitLabel(g.unit)}` : ref);
      const withFp = group.find((g) => g.footprint !== '');
      if (!withFp) continue;
      for (const g of group) {
        // The marker is appended to the *second* unit's screen, so the sheet
        // holding it reports the pair.
        if (!g.sym || g.footprint === '' || g.footprint === withFp.footprint) continue;
        out.push(
          violation(
            'different_unit_footprint',
            `Different footprints assigned to ${name(withFp)} and ${name(g)}`,
            g.sym.at,
            [refItemId(g), ...(withFp.sym ? [refItemId(withFp)] : [])],
          ),
        );
      }
    }
  };

  /** ERC_TESTER::TestMissingUnits. */
  const testMissingUnits = (): void => {
    for (const [ref, group] of byRef) {
      const first = group[0]!;
      if (ref.includes('?')) continue;
      // The whole hierarchy's placements decide what is missing, but only the
      // sheet holding the first unit raises the marker.
      if (!first.sym) continue;
      const lib = libById.get(first.libId);
      const libUnits = lib ? Math.max(1, ...lib.units.map((u) => u.unit)) : 1;
      if (libUnits > 1 && lib) {
        const placed = new Set(group.map((g) => g.unit));
        const missing: number[] = [];
        for (let u = 1; u <= libUnits; u++) if (!placed.has(u)) missing.push(u);
        if (missing.length > 0) {
          const list = `[ ${missing.slice(0, 3).map(unitLabel).join(', ')}${
            missing.length > 3 ? ', ...' : ''
          } ]`;
          out.push(
            violation('missing_unit', `Symbol ${ref} has unplaced units ${list}`, first.sym.at, [
              refItemId(first),
            ]),
          );

          // …and, per pin type, which of those unplaced units carry pins.
          const withType = (type: string): number[] =>
            missing.filter((u) =>
              lib.units.some(
                (lu) =>
                  (lu.unit === u || lu.unit === 0) &&
                  lu.pins.some((p) => p.electricalType === type),
              ),
            );
          const report = (units: number[], code: ErcCode, what: string): void => {
            if (units.length === 0) return;
            const l = `[ ${units.slice(0, 3).map(unitLabel).join(', ')}${
              units.length > 3 ? ', ...' : ''
            } ]`;
            out.push(
              violation(
                code,
                `Symbol ${ref} has ${what} in units ${l} that are not placed`,
                first.sym!.at,
                [refItemId(first)],
              ),
            );
          };
          report(withType('power_in'), 'missing_power_pin', 'input power pins');
          report(withType('input'), 'missing_input_pin', 'input pins');
          report(withType('bidirectional'), 'missing_bidi_pin', 'bidirectional pins');
        }
      }
    }
  };

  /** ERC_TESTER::TestMultUnitPinConflicts. */
  const testMultUnitPinConflicts = (): void => {
    for (const [ref, group] of byRef) {
      if (ref.includes('?')) continue;
      // TestMultUnitPinConflicts: a pin number shared by several units of one
      // symbol must land on the same net in every unit. Units on other sheets
      // are left to their own run: their pins' nets are not graphed here.
      if (group.length > 1) {
        const netOfPin = new Map<string, { net: string; at: Vec2; id: string }>();
        for (const g of group) {
          if (!g.sym) continue;
          for (const p of pins) {
            if (p.symId !== refItemId(g)) continue;
            const code = netlist.netByItem.get(p.id);
            const net = code !== undefined ? (netByCode.get(code)?.name ?? '') : '';
            if (net === '') continue;
            const prev = netOfPin.get(p.number);
            if (!prev) {
              netOfPin.set(p.number, { net, at: p.at, id: selectableId(p.id) });
            } else if (prev.net !== net) {
              out.push(
                violation(
                  'different_unit_net',
                  `Pin ${p.number} is connected to both ${prev.net} and ${net}`,
                  p.at,
                  [selectableId(p.id), prev.id],
                ),
              );
            }
          }
        }
      }
    }
  };

  /** ERC_TESTER::TestMissingNetclasses, a "Netclass" field naming a netclass the project does not define. */
  const testMissingNetclasses = (): void => {
    const netclasses = opts.netclasses;
    if (!netclasses) return;
    const known = (name: string): boolean =>
      name === netclasses.defaultName || netclasses.names.has(name);
    const check = (name: string, at: Vec2, id: string): void => {
      if (name === '' || known(name)) return;
      out.push(violation('undefined_netclass', `Netclass ${name} is not defined`, at, [id]));
    };
    (sch.directiveLabels ?? []).forEach((label, i) => {
      for (const f of label.fields) {
        if (isNetclassFieldName(f.key))
          check(f.value, label.at, label.uuid ?? `directivelabel:idx:${i}`);
      }
    });
    sch.symbols.forEach((sym, i) => {
      for (const f of sym.fields) {
        if (f.key === 'Netclass') check(f.value, sym.at, refId('symbol', sym.uuid, i));
      }
    });
  };

  // ERC_TESTER::RunTests' order, phase by phase. Annotation is checked first,
  // as DIALOG_ERC::OnRunERCClick calls CheckAnnotate before the tester runs.
  checkAnnotation();

  yield 'Checking sheet names...';
  testDuplicateSheetNames();

  yield 'Checking pin maps...';
  testPinMap();

  yield 'Checking conflicts...';
  // CONNECTION_GRAPH::RunERC, whose per-subgraph checks upstream announces
  // under this one phase.
  ercCheckMultipleDrivers();
  ercCheckBusConflicts();
  ercCheckWires();
  checkNoConnects();
  ercCheckLabels();
  ercCheckDirectiveLabels();
  ercCheckHierSheets();
  ercCheckSingleGlobalLabel();

  yield 'Checking units...';

  yield 'Checking footprints...';
  testMultiunitFootprints();
  testMissingUnits();

  yield 'Checking pins...';
  testMultUnitPinConflicts();
  testDuplicatePinNets();
  testPinToPin();
  testGroundPins();
  testStackedPinNotation();

  yield 'Checking similar labels...';
  testSimilarLabels();

  yield 'Checking local and global labels...';
  testSameLocalGlobalLabel();

  yield 'Checking for unresolved variables...';
  testTextVars();

  yield 'Checking field names...';
  testFieldNameWhitespace();

  yield 'Checking SPICE models...';
  testSimModelIssues();

  yield 'Checking no connect pins for connections...';
  testNoConnectPins();

  yield 'Checking for library symbol issues...';
  testLibSymbolIssues();

  yield 'Checking for footprint link issues...';
  testFootprintLinkIssues();

  yield 'Checking footprint assignments against footprint filters...';
  testFootprintFilters();

  yield 'Checking for off grid pins and wires...';
  testOffGridEndpoints();

  yield 'Checking for four way junctions...';
  testFourWayJunction();

  yield 'Checking for labels on more than one wire...';
  testLabelMultipleWires();

  yield 'Checking for undefined netclasses...';
  testMissingNetclasses();

  // Drop rules set to "ignore" in the Schematic Setup severities panel.
  const kept = out.filter((v) => g_settings.severities[v.code] !== 'ignore');

  // Stable order: errors first, then by position (KiCad sorts its report).
  kept.sort((a, b) =>
    a.severity === b.severity
      ? a.at.y - b.at.y || a.at.x - b.at.x
      : a.severity === 'error'
        ? -1
        : 1,
  );
  return kept;
}
