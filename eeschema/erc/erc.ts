// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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

import { wxMatches } from '@ziroeda/common/wx/wxstring.js';
import {
  ExpandEnvVarSubstitutions,
  ResolveShownText,
  type TextVarResolverFn,
} from '@ziroeda/common/common.js';
import { electricalPinTypeGetText } from '../pin_type.js';
import type { Schematic, LibSymbol, Vec2 } from '../types.js';
import { refId } from '../tools/hittest.js';
import {
  escapeNetName,
  expandStackedPinNotation,
  strNumCmp,
  unescapeString,
} from '@ziroeda/common/string_utils.js';
import { compareLibSymbolsForErc } from '../lib_symbol.js';
import { flattenLibSymbol } from '../lib_symbol.js';
import { checkSimModel } from '../sim/sim_model.js';
import { isNetclassFieldName } from '../sch_field.js';
import { computeNetlist, enumeratePins, onSegment, type PinNode } from '../connectivity/nets.js';
import { expandBusLabel, isBusLabel } from '../connectivity/bus.js';
import { wireDangleStates } from '../connectivity/dangling.js';
import {
  OK,
  WAR,
  ERR,
  ERC_ITEMS,
  typeIndex,
  defaultErcSettings,
  type PinError,
  type ErcCode,
  type ErcSeverity,
  type ErcSettings,
} from './erc_settings.js';
import { schSymbolLibraryName } from '../lib_symbol.js';

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
  // The PARENT of each item, not the item: see `ercParentId`. A stored
  // exclusion must keep matching across the change that made markers carry
  // pin ids rather than their symbols.
  return `${v.file ?? ''}|${v.code}|${v.at.x}|${v.at.y}|${ercParentId(v.items[0] ?? '')}|${ercParentId(v.items[1] ?? '')}`;
}

// The active ERC configuration for the current run (set at the top of runErc).
let g_settingsSet: ErcSettings | null = null;

/** The defaults are made on first use, not at load: erc_settings.ts may not have run yet when a
 *  module cycle reaches this file. */
function settingsNow(): ErcSettings {
  g_settingsSet ??= defaultErcSettings();
  return g_settingsSet;
}
// The sheet being checked, stamped onto every marker it produces.
let g_file: string | undefined;

const violation = (code: ErcCode, message: string, at: Vec2, items: string[]): ErcViolation => ({
  code,
  // 'ignore' rules are dropped after the run; the survivors are error/warning.
  severity: settingsNow().severities[code] as ErcSeverity,
  message,
  at,
  items,
  ...(g_file === undefined ? {} : { file: g_file }),
});

/**
 * A pin id is `<symId>:pin<k>`, and the marker keeps it WHOLE.
 *
 * `ERC_ITEM::SetItems` stores the offending items themselves, and a pin's
 * `GetItemDescription` is `Symbol <ref> Pin <n> [<type>, <shape>]`
 * (sch_pin.cpp:1702-1723) — so the tree can only name the pin if the marker
 * still knows which pin it was. This used to strip `:pin<k>` here so that
 * clicking a row selected the parent symbol, and the description could then
 * only ever say "Symbol <ref>" and the net.
 *
 * Selection strips it instead, at the point of selecting — `locateViolation`
 * in SchematicEditor — which is where upstream resolves a pin to the symbol it
 * highlights.
 */
const selectableId = (id: string): string => id;

/**
 * The parent of a pin id, for anything that must address the SYMBOL: the
 * editor's selection, and the exclusion key.
 *
 * The key has to keep using the parent. It is a synthetic string of ours
 * (`file|code|x|y|item0|item1`) that a project stores, so changing what goes
 * into it would orphan every exclusion a user has already saved.
 */
export const ercParentId = (id: string): string => {
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
  /** The schematic's text-variable resolver, for TestTextVars. */
  resolveTextVar?: TextVarResolverFn;
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
  /**
   * This sheet's entry from `computeHierarchyNetlist`'s `hierNetNames`: the name
   * this sheet's own graph gives a net -> the name the hierarchy settled on.
   * The two lists above are keyed by the hierarchy's names, and re-graphing one
   * sheet cannot reproduce them (a parent's local label outranks this sheet's
   * hierarchical label, so the local "/Child/SIG" is really "/SIG"), so the
   * lookups translate through this first.
   */
  hierNetNames?: ReadonlyMap<string, string>;
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
  g_settingsSet = settings;
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
      // The external lists speak the hierarchy's net names, not this sheet's.
      const hierName = opts.hierNetNames?.get(net.name) ?? net.name;
      g = {
        name: net.name,
        pins: [],
        external: opts.externalNetPins?.get(hierName) ?? [],
        hasNC: opts.externalNetNoConnects?.has(hierName) ?? false,
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
          // GetNameForDriver escapes the label text, and `primary` below is a
          // driver name too, so a label with a '/' in it must be compared escaped
          // or it never matches the net it actually named.
          drivers.push({ id, name: escapeNetName(l.text), at: l.at });
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
    const lines = sch.lines
      .map((l, i) => ({ l, i, id: refId('line', l.uuid, i) }))
      .filter((x) => x.l.kind === 'wire' || x.l.kind === 'bus');
    // Only wires are reported: ercCheckDanglingWireEndpoints skips anything whose
    // layer is not LAYER_WIRE, so a bus left hanging is never a violation (its
    // dangling state only drives the auto-start-a-line behaviour).
    const wires = lines.filter((x) => x.l.kind === 'wire');
    // Whether each end is dangling is SCH_LINE::UpdateDanglingState, which is
    // already ported: an end is connected by any co-located end item other than a
    // bus end, and a wire's own two ends never count.
    const dangleStates = wireDangleStates(sch, libById);
    // A wire endpoint is dangling when nothing else lands on it: no item, and
    // no other wire touching it (mid-span contact counts, as SCH_LINE's
    // dangling state is cleared by any connection).
    const touches = (p: Vec2, self: string): boolean =>
      (endpointUsers.get(key(p)) ?? 0) > 0 ||
      lines.some(
        (w) =>
          w.id !== self &&
          (onSegment(p, w.l.start, w.l.end) ||
            (w.l.start.x === p.x && w.l.start.y === p.y) ||
            (w.l.end.x === p.x && w.l.end.y === p.y)),
      );
    for (const w of wires) {
      const state = dangleStates.get(w.i);
      const startFree = state ? state.start : !touches(w.l.start, w.id);
      const endFree = state ? state.end : !touches(w.l.end, w.id);
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
      const lib = libById.get(schSymbolLibraryName(sym));
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
        const lib = libById.get(schSymbolLibraryName(sym));
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
          const erc = settingsNow().pinMap[typeIndex(refType)]![typeIndex(ext.electricalType)]!;
          if (erc !== OK) {
            externalMismatches.push([i, ext, erc]);
            mismatchCounts.set(i, (mismatchCounts.get(i) ?? 0) + 1);
          }
        }

        for (let j = i + 1; j < gpins.length; j++) {
          const test = gpins[j]!;
          if (stacked(ref, test)) continue; // stacked pins don't conflict
          const erc = settingsNow().pinMap[typeIndex(refType)]![typeIndex(test.electricalType)]!;
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
              `Pins of type ${electricalPinTypeGetText(pin.electricalType)} and ${electricalPinTypeGetText(other.electricalType)} are connected`,
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
              `Pins of type ${electricalPinTypeGetText(pin.electricalType)} and ${electricalPinTypeGetText(other.electricalType)} are connected`,
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
        // TestPinToPin sorts with StrNumCmp, which compares digit runs as
        // numbers: R9 comes before R10, where a plain string compare puts R10
        // first and marks the wrong pin.
        const byRefAndNumber = (a: PinNode, b: PinNode): number =>
          strNumCmp(a.ref, b.ref) || strNumCmp(a.number, b.number);
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
    const resolver = opts.resolveTextVar;
    if (resolver) {
      // `unresolved`: what is left of `${` once the item's shown text has had
      // the environment substituted too (erc.cpp:190-195), one marker per item.
      const unresolved = (str: string): boolean =>
        ExpandEnvVarSubstitutions(str, resolver).includes('${');
      const scan = (text: string, at: Vec2, id: string): void => {
        if (unresolved(ResolveShownText(text, resolver)))
          out.push(violation('unresolved_variable', 'Unresolved text variable', at, [id]));
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
    if (settingsNow().severities.simulation_model_issue !== 'ignore') {
      sch.symbols.forEach((sym, i) => {
        const reference = sym.fields.find((f) => f.key === 'Reference')?.value ?? '';
        // Power symbols and anything else referenced with '#' are not simulated.
        if (reference.startsWith('#') || sym.excludedFromSim) return;
        const issues = checkSimModel(
          sym,
          libById.get(schSymbolLibraryName(sym)),
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
        const cached = libById.get(schSymbolLibraryName(sym));
        const library = opts.librarySymbols?.get(schSymbolLibraryName(sym));
        if (!cached || !library) return;
        // `std::unique_ptr<LIB_SYMBOL> flattenedSymbol = libSymbol->Flatten();`
        // (erc.cpp:1774) — the LIBRARY side is flattened before the compare,
        // because the schematic's cached copy always is: `SCH_SCREEN` stores
        // `Flatten()`ed symbols (sch_screen.cpp:262, :844) so a placement is
        // never derived. Comparing a flattened cache against a raw `extends`
        // definition says "doesn't match" for every derived symbol on the
        // sheet, whatever the user did — four 1N4007s reported it here.
        if (compareLibSymbolsForErc(cached, flattenLibSymbol(library)) === null) return;
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
      const lib = libById.get(schSymbolLibraryName(sym));
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
      const lib = libById.get(schSymbolLibraryName(first));
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
      const lib = libById.get(schSymbolLibraryName(group[0]!));
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
      const lib = libById.get(schSymbolLibraryName(first));
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
  const kept = out.filter((v) => settingsNow().severities[v.code] !== 'ignore');

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

// ---------------------------------------------------------------------------
// `ERC_TESTER`, the live-model class (erc.cpp / erc.h), beside the record model's runErc above
// until S7. Ported so far: TestDuplicateSheetNames and the connection graph's own checks
// (CONNECTION_GRAPH::RunERC); the other tests are marked in RunTests where they run upstream.
// ---------------------------------------------------------------------------

import type { NET_MAP } from '../connection_graph.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_MARKER as SCH_MARKER_LIVE } from '../sch_marker.js';
import { multiUnitEntries, type SCH_MULTI_UNIT_REFERENCE_MAP } from '../sch_reference_list.js';
import { SCH_SCREENS } from '../sch_screen.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_PIN } from '../sch_pin.js';
import { LIB_ID as LIB_ID_LIVE } from '@ziroeda/common/lib_id.js';
import { wxCmp } from '@ziroeda/common/wx/wxstring.js';
import type { SCH_LABEL_BASE } from '../sch_label.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SCH_SHEET_PATH as SCH_SHEET_PATH_LIVE } from '../sch_sheet_path.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { SCH_ITEM as SCH_ITEM_LIVE } from '../sch_item.js';
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
          ercItem.SetErrorMessage("Pin with 'no connection' type is connected");
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
              `Pin ${pinNumber} on symbol '${symbol.GetRef(sheet)}' is connected to different nets: ${firstNet === '' ? '<no net>' : firstNet} and ${second === '' ? '<no net>' : second}`,
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
   * first. Not here: the drawing sheet (TestTextVars), CvPcb (TestFootprintLinkIssues) and
   * the progress reporter.
   */
  RunTests(aEditFrame: SCH_EDIT_FRAME | null = null): void {
    this.m_sheetList.AnnotatePowerSymbols();

    // Test duplicate sheet names inside a given sheet.  While one can have multiple references
    // to the same file, each must have a unique name.
    if (this.m_settings.IsTestEnabled(ERCE.ERCE_DUPLICATE_SHEET_NAME))
      this.TestDuplicateSheetNames(true);

    // If we are using the new connectivity, make sure that we do a full-rebuild
    // (ADVANCED_CFG::m_IncrementalConnectivity is off by default: NO_CLEANUP).
    if (aEditFrame) aEditFrame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.NO_CLEANUP);

    this.m_schematic.ConnectionGraph().RunERC();

    // Test is all units of each multiunit symbol have the same footprint assigned.
    if (this.m_settings.IsTestEnabled(ERCE.ERCE_DIFFERENT_UNIT_FP)) this.TestMultiunitFootprints();

    if (
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_UNIT) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_INPUT_PIN) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_POWER_INPUT_PIN) ||
      this.m_settings.IsTestEnabled(ERCE.ERCE_MISSING_BIDI_PIN)
    ) {
      this.TestMissingUnits();
    }

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
      this.TestSimilarLabels();
    }

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_SAME_LOCAL_GLOBAL_LABEL))
      this.TestSameLocalGlobalLabel();

    // Pending: TestTextVars.

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_FIELD_NAME_WHITESPACE))
      this.TestFieldNameWhitespace();

    // Pending: TestSimModelIssues.

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_NOCONNECT_CONNECTED)) this.TestNoConnectPins();

    // Pending: TestLibSymbolIssues, TestFootprintLinkIssues.

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_FOOTPRINT_FILTERS)) this.TestFootprintFilters();

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_ENDPOINT_OFF_GRID)) this.TestOffGridEndpoints();

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_FOUR_WAY_JUNCTION)) this.TestFourWayJunction();

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_LABEL_MULTIPLE_WIRES))
      this.TestLabelMultipleWires();

    if (this.m_settings.IsTestEnabled(ERCE.ERCE_UNDEFINED_NETCLASS)) this.TestMissingNetclasses();

    this.m_schematic.ResolveERCExclusionsPostUpdate();
  }
}
