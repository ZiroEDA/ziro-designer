// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NET_SETTINGS` — `common/project/net_settings.cpp`.
 *
 * In `common/` because upstream's is: net classes are part of `PROJECT_FILE`,
 * and both eeschema and pcbnew read them — eeschema to colour and style a wire
 * from its class, pcbnew to take its clearances and widths. Ours lived in
 * `editors/schematic/schematic_settings.ts` and `editors/pcb/board_settings.ts`
 * and `editors/pcb/project_settings.ts` imported `NetClass` across, which is
 * the same misplacement as the drawing-sheet painter: a project-level structure
 * filed under whichever editor happened to need it first.
 *
 * Net chains come with it. `PANEL_SETUP_NET_CHAINS` sits beside the netclass
 * panel in the same Schematic Setup page and its classes resolve through the
 * same table, so splitting the two would leave the resolution reaching back
 * across the boundary that was just drawn.
 */

import { netclassPatternMatches } from '../eda_pattern_match.js';
import { LINE_STYLE_NAMES } from '../stroke_params.js';

// ---------------------------------------------------------------------------
// Net chains (PANEL_SETUP_NET_CHAINS).

export interface NetChain {
  name: string;
  members: string[];
  chainClass: string;
  netClass: string;
  color: string;
  /** The committed chain's name at dialog-open time; renames diff against it
   *  (PANEL_SETUP_NET_CHAINS CHAIN_ROW::origName). Unset = not committed. */
  origName?: string;
  /** Terminal end pins, carried through edits for the `.kicad_sch` writer. */
  from?: { ref: string; pin: string };
  to?: { ref: string; pin: string };
}
export interface NetChainClass {
  name: string;
  members: number;
}
export interface NetChainsData {
  /** Committed chains, the dialog grid rows (loadFromModel lists only the
   *  committed set; potentials become committed via the editor tools). */
  chains: NetChain[];
  classes: NetChainClass[];
  /** The persisted chain -> class map (net_settings.net_chain_classes). */
  classByChain: Record<string, string>;
}

export function defaultNetChains(): NetChainsData {
  return { chains: [], classes: [], classByChain: {} };
}

// ---------------------------------------------------------------------------
// Net classes (NET_SETTINGS / PANEL_SETUP_NETCLASSES).

export interface NetClass {
  name: string;
  clearance: string;
  trackWidth: string;
  viaSize: string;
  viaHole: string;
  uviaSize: string;
  uviaHole: string;
  dpWidth: string;
  dpGap: string;
  /**
   * `diff_pair_via_gap` — `NETCLASS::GetDiffPairViaGap()`.
   *
   * There is no column for it: `PANEL_SETUP_NETCLASSES`'s grid ends its
   * pcbnew block at `GRID_DIFF_PAIR_GAP` (`panel_setup_netclasses.cpp:63-64`),
   * so the only way a project acquires one is the file. It is modelled anyway
   * because `BOARD_DESIGN_SETTINGS::GetCurrentDiffPairViaGap()` falls back to
   * `HasDiffPairViaGap() ? GetDiffPairViaGap() : GetCurrentDiffPairGap()`, and
   * a blank here is that `Has…()` returning false.
   */
  dpViaGap: string;
  tuningProfile: string;
  pcbColor: string;
  wireThickness: string;
  busThickness: string;
  color: string;
  lineStyle: string;
}
export interface NetClassAssignment {
  pattern: string;
  netClass: string;
}
export interface NetClassesData {
  classes: NetClass[];
  assignments: NetClassAssignment[];
  /**
   * `net_settings.net_colors` — `NET_SETTINGS::m_netColorAssignments`, a net
   * NAME to colour map (net_settings.cpp:224-249). It is not a netclass
   * property and not a board property: a per-net colour override lives in the
   * project file, keyed by name, which is why a board opened without its
   * `.kicad_pro` shows none.
   *
   * pcbnew loads it into the painter at
   * `PCB_EDIT_FRAME::LoadProjectSettings` (pcbnew_config.cpp:95-105) and
   * APPEARANCE_CONTROLS' Nets tab reads it back out of there
   * (appearance_controls.cpp:235). Keyed by name, values in our CSS colour
   * form; a net with no entry is COLOR4D::UNSPECIFIED and draws the
   * checkerboard.
   */
  netColors: Record<string, string>;
}

/**
 * The net class grid's line-style names, in file order (`line_style` 0-4).
 * `g_lineStyleNames` (common/dialogs/panel_setup_netclasses.cpp:99-110) is the
 * same five display strings as `lineTypeNames`, so it is built from the one
 * table rather than restated. (Upstream also prepends a `<Not defined>` row for
 * a class that sets no style; we do not model that yet.)
 */
export const LINE_STYLES: string[] = LINE_STYLE_NAMES.map((d) => d.label);

export function blankNetClass(name: string): NetClass {
  return {
    name,
    clearance: '',
    trackWidth: '',
    viaSize: '',
    viaHole: '',
    uviaSize: '',
    uviaHole: '',
    dpWidth: '',
    dpGap: '',
    dpViaGap: '',
    tuningProfile: '',
    pcbColor: '',
    wireThickness: '',
    busThickness: '',
    color: '',
    lineStyle: 'Solid',
  };
}

export function defaultNetClasses(): NetClassesData {
  // The Default netclass carries KiCad's factory dimensions (NETCLASS defaults,
  // mm); user-added classes start blank (inherit Default).
  return {
    classes: [
      {
        ...blankNetClass('Default'),
        clearance: '0.2',
        trackWidth: '0.25',
        viaSize: '0.8',
        viaHole: '0.4',
        uviaSize: '0.3',
        uviaHole: '0.1',
        dpWidth: '0.2',
        dpGap: '0.25',
      },
    ],
    assignments: [],
    netColors: {},
  };
}

// ---------------------------------------------------------------------------
// Effective netclass resolution (NET_SETTINGS::GetEffectiveNetClass).

/** The schematic-relevant parameters of a resolved netclass. Unset fields are
 *  undefined ('' colors and blank widths never made it in). */
export interface EffectiveNetClass {
  /** The class name; a multi-class merge is named `Effective for net: <net>`
   *  like upstream's composite netclass. */
  name: string;
  /** `#rrggbb`, when any constituent sets a schematic color. */
  color?: string;
  wireWidthMils?: number;
  busWidthMils?: number;
  /** A LINE_STYLES name; always present (Default's style completes the set). */
  lineStyle: string;
  /**
   * `NETCLASS::GetConstituentNetclasses()`, by name, highest priority first:
   * the matched classes, then Default when `addMissingDefaults` had to add
   * it — which it does whenever one of the ten sized parameters (clearance,
   * track, via, µvia, diff-pair, wire, bus) is unset by every matched class.
   */
  constituents: string[];
}

/**
 * `NETCLASS::GetHumanReadableName` (netclass.cpp:294-326): one constituent is
 * its name; two are "A and B"; three "A, B and C"; more "A, B and N more".
 */
export function netClassHumanReadableName(eff: EffectiveNetClass): string {
  const c = eff.constituents;
  if (c.length <= 1) return eff.name;
  if (c.length === 2) return `${c[0]} and ${c[1]}`;
  if (c.length === 3) return `${c[0]}, ${c[1]} and ${c[2]}`;
  return `${c[0]}, ${c[1]} and ${c.length - 2} more`;
}

/**
 * The clearance the DRC engine resolves for one net, in mm, or undefined when
 * no class it belongs to states one.
 *
 * `DRC_ENGINE::loadImplicitRules` makes one implicit rule per netclass that
 * `HasClearance()`, conditioned on `A.hasExactNetclass('<name>')`, then sorts
 * them **ascending by clearance** before adding them. Rule selection is winner-
 * takes-all with the last match winning, so a net in more than one class ends
 * up with the LARGEST of their clearances — not the highest-priority one, which
 * is how every other netclass parameter resolves.
 */
export function netClassClearanceMM(
  netName: string,
  data: NetClassesData,
  chainAssignments?: readonly { pattern: string; netClass: string }[],
): number | undefined {
  const num = (s: string): number | undefined => {
    const v = Number.parseFloat(s);
    return s.trim() !== '' && Number.isFinite(v) ? v : undefined;
  };

  const dflt = data.classes[0];
  const matched: NetClass[] = [];

  if (netName) {
    for (const a of [...data.assignments, ...(chainAssignments ?? [])]) {
      if (!a.netClass) continue;
      const cls = data.classes.find((c) => c.name === a.netClass);
      if (!cls || matched.includes(cls)) continue;
      if (netclassPatternMatches(a.pattern, netName)) matched.push(cls);
    }
  }

  // "An unmatched net is in Default", and Default also completes the set for a
  // net whose own classes state no clearance.
  if (dflt && !matched.includes(dflt)) matched.push(dflt);

  let out: number | undefined;
  for (const cls of matched) {
    const v = num(cls.clearance);
    if (v !== undefined && (out === undefined || v > out)) out = v;
  }
  return out;
}

/**
 * NET_SETTINGS::GetEffectiveNetClass, over the dialog's netclass grid: collect
 * every class whose pattern assignment matches the net, sort by priority
 * (grid order; Default = lowest), then fill parameters from the lowest
 * priority up so higher-priority classes win (makeEffectiveNetclass). The
 * Default class completes any missing parameters; an empty net name resolves
 * straight to Default.
 */
export function resolveEffectiveNetClass(
  netName: string,
  data: NetClassesData,
  chainAssignments?: readonly { pattern: string; netClass: string }[],
): EffectiveNetClass {
  const dflt = data.classes[0] ?? blankNetClass('Default');
  // Priority = grid position (the serializer writes it that way); Default last.
  const priorityOf = (c: NetClass): number =>
    c === dflt ? Number.MAX_SAFE_INTEGER : data.classes.indexOf(c) - 1;
  const matched: NetClass[] = [];
  if (netName) {
    // User pattern assignments first, then chain-derived ones, the same two
    // applyPatternList calls in NET_SETTINGS::GetEffectiveNetClass; chain
    // netclasses must exist (ApplyNetChainNetclasses' HasNetclass gate).
    for (const a of [...data.assignments, ...(chainAssignments ?? [])]) {
      if (!a.netClass) continue;
      const cls = data.classes.find((c) => c.name === a.netClass);
      if (!cls || matched.includes(cls)) continue;
      if (netclassPatternMatches(a.pattern, netName)) matched.push(cls);
    }
  }
  const constituents = matched.length > 0 ? [...matched] : [dflt];
  if (!constituents.includes(dflt)) constituents.push(dflt); // complete params
  // `makeEffectiveNetclass`'s sort: priority, then `GetName().Cmp` — a
  // codepoint compare, never the locale's.
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  constituents.sort((a, b) => priorityOf(a) - priorityOf(b) || cmp(a.name, b.name));
  // `addMissingDefaults`: Default joins the constituents when a sized
  // parameter is set by none of the matched classes.
  const sized: (keyof NetClass)[] = [
    'clearance',
    'trackWidth',
    'viaSize',
    'viaHole',
    'uviaSize',
    'uviaHole',
    'dpWidth',
    'dpGap',
    'wireThickness',
    'busThickness',
  ];
  const defaultNeeded =
    matched.length === 0 ||
    sized.some((k) => !matched.some((c) => String(c[k] ?? '').trim() !== ''));
  const named = constituents.filter((c) => c !== dflt || defaultNeeded || matched.includes(dflt));
  const eff: EffectiveNetClass = {
    name:
      matched.length === 0
        ? dflt.name
        : matched.length === 1
          ? matched[0]!.name
          : `Effective for net: ${netName}`,
    lineStyle: 'Solid',
    constituents: named.map((c) => c.name),
  };
  const num = (s: string): number | undefined => {
    const v = Number.parseFloat(s);
    return s.trim() !== '' && Number.isFinite(v) ? v : undefined;
  };
  // Lowest priority first, so higher-priority values overwrite.
  for (let i = constituents.length - 1; i >= 0; i--) {
    const c = constituents[i]!;
    const wire = num(c.wireThickness);
    const bus = num(c.busThickness);
    if (wire !== undefined) eff.wireWidthMils = wire;
    if (bus !== undefined) eff.busWidthMils = bus;
    if (c.color) eff.color = c.color;
    // The grid can't express an unset style (rows default to Solid), so only
    // a non-Solid choice contributes, KiCad's HasLineStyle() equivalent.
    if (c.lineStyle && c.lineStyle !== 'Solid') eff.lineStyle = c.lineStyle;
  }
  return eff;
}

// ---------------------------------------------------------------------------
// NET_SETTINGS (include/project/net_settings.h / common/project/net_settings.cpp)
//
// The class. The `NESTED_SETTINGS` JSON load/save and the schema migrations are
// not ported (the project file readers fill the maps directly); everything
// else — the netclass maps, label and pattern assignments, the effective
// netclass computation with its caches, the colour assignments, the bus
// helpers — is here. The plain-object `NetClass`/`NetClassesData` forms above
// are the older surface the designer still reads and go with stage 2.

import { type Color4d, COLOR4D_UNSPECIFIED, parseColor4d } from '../color4d.js';
import { pcbIUScale, schIUScale } from '../eda_units.js';
import { CombinedMatcherContext, EdaCombinedMatcher } from '../eda_pattern_match.js';
import { NETCLASS } from '../netclass.js';
import type { OutStr } from '../font/font.js';

const isSuperSubOverbar = (c: string | undefined): boolean => c === '^' || c === '_' || c === '~';

/** `getInPcbUnits( aObj, aKey )`: a number in mm, to IU; absent otherwise. */
function getInPcbUnits(aObj: Record<string, unknown>, aKey: string): number | undefined {
  const v = aObj[aKey];

  if (typeof v === 'number') return pcbIUScale.mmToIU(v);

  return undefined;
}

/** `getInSchUnits( aObj, aKey )`: a number in mils, to IU; absent otherwise. */
function getInSchUnits(aObj: Record<string, unknown>, aKey: string): number | undefined {
  const v = aObj[aKey];

  if (typeof v === 'number') return schIUScale.milsToIU(v);

  return undefined;
}

/** The constructor's `readNetClass` lambda. */
function readNetClass(entry: Record<string, unknown>): NETCLASS {
  const name = String(entry.name);

  const nc = new NETCLASS(name, false);

  if (typeof entry.priority === 'number') nc.SetPriority(Math.trunc(entry.priority));

  if (typeof entry.tuning_profile === 'string') nc.SetTuningProfile(entry.tuning_profile);

  // `if( auto value = getInPcbUnits( entry, "..." ) ) nc->Set...( *value );`
  const setIU = (aKey: string, aSetter: (v: number) => void, aGet = getInPcbUnits): void => {
    const value = aGet(entry, aKey);

    if (value !== undefined) aSetter(value);
  };

  setIU('clearance', (v) => nc.SetClearance(v));
  setIU('track_width', (v) => nc.SetTrackWidth(v));
  setIU('via_diameter', (v) => nc.SetViaDiameter(v));
  setIU('via_drill', (v) => nc.SetViaDrill(v));
  setIU('microvia_diameter', (v) => nc.SetuViaDiameter(v));
  setIU('microvia_drill', (v) => nc.SetuViaDrill(v));
  setIU('diff_pair_width', (v) => nc.SetDiffPairWidth(v));
  setIU('diff_pair_gap', (v) => nc.SetDiffPairGap(v));
  setIU('diff_pair_via_gap', (v) => nc.SetDiffPairViaGap(v));
  setIU('wire_width', (v) => nc.SetWireWidth(v), getInSchUnits);
  setIU('bus_width', (v) => nc.SetBusWidth(v), getInSchUnits);

  if (typeof entry.line_style === 'number') nc.SetLineStyle(Math.trunc(entry.line_style));

  if (typeof entry.pcb_color === 'string') nc.SetPcbColor(parseColor4d(entry.pcb_color));

  if (typeof entry.schematic_color === 'string')
    nc.SetSchematicColor(parseColor4d(entry.schematic_color));

  return nc;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** True when the character at `i` is preceded by an odd run of backslashes. */
function isEscaped(s: string, i: number): boolean {
  let n = 0;
  for (let k = i - 1; k >= 0 && s[k] === '\\'; k--) n++;
  return n % 2 === 1;
}

function parseBusVectorImpl(bus: string): { name: string; members: string[] } | null {
  const len = bus.length;
  let i = 0;
  let prefix = '';
  let suffix = '';
  let braceNesting = 0;
  let fmtWrapsName = false;
  let inQuotes = false;

  // Prefix (up to the range '[').
  for (; i < len; i++) {
    const c = bus[i]!;
    if (c === '"' && !isEscaped(bus, i)) {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      if (c === '\\' && i + 1 < len) prefix += bus[++i];
      else prefix += c;
      continue;
    }
    if (c === '{') {
      if (i > 0 && isSuperSubOverbar(bus[i - 1])) {
        braceNesting++;
        prefix += '{';
        continue;
      }
      return null;
    }
    if (c === '}') {
      braceNesting--;
      prefix += '}';
      continue;
    }
    if (c === '\\' && bus[i + 1] === ' ') {
      prefix += bus[++i];
      continue;
    }
    if (c === ' ' || c === ']') return null;
    if (c === '[') {
      if (braceNesting > 0) {
        const fmtStart = prefix.lastIndexOf('{');
        if (fmtStart > 0 && isSuperSubOverbar(prefix[fmtStart - 1])) {
          if (fmtStart === prefix.length - 1) {
            // '{' immediately precedes '[' (e.g. D_{[1..2]}): the formatting
            // decorates the range indices, not the name.
            prefix = prefix.slice(0, fmtStart - 1);
          } else {
            // Name characters between '{' and '[' (e.g. ~{BE[0..3]}): the
            // formatting wraps each member name.
            fmtWrapsName = true;
          }
        }
      }
      break;
    }
    prefix += c;
  }

  // Start index.
  i++;
  if (i >= len) return null;
  let tmp = '';
  let begin = 0;
  let end = 0;
  let found = false;
  for (; i < len; i++) {
    if (bus[i] === '.' && bus[i + 1] === '.') {
      begin = Number.parseInt(tmp || '0', 10);
      i += 2;
      found = true;
      break;
    }
    if (!isDigit(bus[i])) return null;
    tmp += bus[i];
  }
  if (!found || i >= len) return null;

  // End index.
  tmp = '';
  found = false;
  for (; i < len; i++) {
    if (bus[i] === ']') {
      end = Number.parseInt(tmp || '0', 10);
      i++;
      found = true;
      break;
    }
    if (!isDigit(bus[i])) return null;
    tmp += bus[i];
  }
  if (!found) return null;

  // Suffix: only a closing formatting brace and polarity markers may follow.
  for (; i < len; i++) {
    const c = bus[i]!;
    if (c === '}') {
      braceNesting--;
      if (fmtWrapsName) suffix += c;
    } else if (c === '+' || c === '-' || c === 'P' || c === 'N') {
      suffix += c;
    } else {
      return null;
    }
  }
  if (braceNesting !== 0) return null;
  if (begin === end) return null;
  if (begin > end) [begin, end] = [end, begin];

  const members: string[] = [];
  for (let idx = begin; idx <= end; idx++) members.push(`${prefix}${idx}${suffix}`);
  return { name: prefix, members };
}

function parseBusGroupImpl(group: string): { name: string; members: string[] } | null {
  const len = group.length;
  let i = 0;
  let prefix = '';
  let braceNesting = 0;
  let inQuotes = false;

  // Prefix (up to the member-list '{', which is NOT preceded by ^ _ ~).
  for (; i < len; i++) {
    const c = group[i]!;
    if (c === '"' && !isEscaped(group, i)) {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      if (c === '\\' && i + 1 < len) prefix += group[++i];
      else prefix += c;
      continue;
    }
    if (c === '{') {
      if (i > 0 && isSuperSubOverbar(group[i - 1])) {
        braceNesting++;
        prefix += '{';
        continue;
      }
      break;
    }
    if (c === '}') {
      braceNesting--;
      prefix += '}';
      continue;
    }
    if (c === '\\' && group[i + 1] === ' ') {
      prefix += group[++i];
      continue;
    }
    if (c === ' ' || c === '[' || c === ']') return null;
    prefix += c;
  }
  if (braceNesting !== 0) return null;
  if (i >= len || group[i] !== '{') return null;

  // Members.
  i++;
  if (i >= len) return null;
  inQuotes = false;
  const members: string[] = [];
  let tmp = '';
  for (; i < len; i++) {
    const c = group[i]!;
    if (c === '"' && !isEscaped(group, i)) {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      if (c === '\\' && i + 1 < len) tmp += group[++i];
      else tmp += c;
      continue;
    }
    if (c === '{') {
      if (i > 0 && isSuperSubOverbar(group[i - 1])) {
        braceNesting++;
        // Keep the full formatting notation (~{CAS} is distinct from CAS).
        tmp += '{';
        continue;
      }
      return null;
    }
    if (c === '}') {
      if (braceNesting > 0) {
        braceNesting--;
        tmp += '}';
        continue;
      }
      if (tmp !== '') members.push(tmp);
      return { name: prefix, members };
    }
    if (c === '\\' && group[i + 1] === ' ') {
      tmp += group[++i];
      continue;
    }
    if (c === ' ' || c === ',') {
      if (tmp !== '') members.push(tmp);
      tmp = '';
      continue;
    }
    tmp += c;
  }
  return null;
}

/**
 * `std::map<wxString, T>` iteration is name order; a `Map` keeps insertion order, so the
 * readers that iterate sort. `wxString::operator<` is code-unit order.
 */
const wxLess = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class NET_SETTINGS {
  /// @brief The default netclass
  private m_defaultNetClass: NETCLASS;

  /// @brief Map of netclass names to netclass definitions
  private m_netClasses = new Map<string, NETCLASS>();

  /// @brief Map of net names to resolved netclasses
  private m_netClassLabelAssignments = new Map<string, Set<string>>();

  /// @brief List of net class pattern assignments
  private m_netClassPatternAssignments: [EdaCombinedMatcher, string][] = [];

  /// @brief Map of netclass names to netclass definitions for
  // composite (multiple netclass assignment / missing defaults) netclasses
  private m_compositeNetClasses = new Map<string, NETCLASS>();

  /// @brief Map of netclass names to netclass definitions for implicit netclasses
  ///
  /// Implicit netclasses are those which are in a netclass label, but which do not have a
  /// netclass definition in the netclass setup panel. They contribute as a constituent
  /// netclass to enable DRC rules and name resolution, but do not contribute parameters
  // to the effective netclasses which contain them.
  private m_impicitNetClasses = new Map<string, NETCLASS>();

  /// @brief Cache of nets to pattern-matched netclasses
  private m_effectiveNetclassCache = new Map<string, NETCLASS>();

  private m_netColorAssignments = new Map<string, Color4d>();

  constructor() {
    this.m_defaultNetClass = new NETCLASS(NETCLASS.Default, true);
    this.m_defaultNetClass.SetDescription('This is the default net class.');
    this.m_defaultNetClass.SetPriority(2147483647);
  }

  /// @brief Sets the default netclass for the project
  /// Calling user is responsible for resetting the effective netclass calculation caches
  SetDefaultNetclass(netclass: NETCLASS): void {
    this.m_defaultNetClass = netclass;
  }

  /// @brief Gets the default netclass for the project
  GetDefaultNetclass(): NETCLASS {
    return this.m_defaultNetClass;
  }

  /// @brief Determines if the given netclass exists
  HasNetclass(netclassName: string): boolean {
    return this.m_netClasses.has(netclassName);
  }

  /// @brief Sets the given netclass
  /// Calling user is responsible for resetting the effective netclass calculation caches
  SetNetclass(netclassName: string, netclass: NETCLASS): void {
    this.m_netClasses.set(netclassName, netclass);
  }

  /// @brief Sets all netclass
  /// Calling this method will reset the effective netclass calculation caches
  SetNetclasses(netclasses: Map<string, NETCLASS>): void {
    this.m_netClasses = new Map(netclasses);
    this.ClearAllCaches();
  }

  /// @brief Gets all netclasses
  GetNetclasses(): Map<string, NETCLASS> {
    return this.m_netClasses;
  }

  /// @brief Gets all composite (multiple assignment / missing defaults) netclasses
  // Note the full connectivity or board net synchronisation must be run before calling
  // this, otherwise resolved netclasses may be missing
  GetCompositeNetclasses(): Map<string, NETCLASS> {
    return this.m_compositeNetClasses;
  }

  /**
   * The `PARAM_LAMBDA` loaders of the C++ constructor - `classes`,
   * `net_colors`, `netclass_assignments`, `netclass_patterns` - over the
   * `net_settings` object of a `.kicad_pro`. `NESTED_SETTINGS::LoadFromFile`
   * runs them one by one; the schema migrations (0-5) are not ported.
   */
  LoadFromJson(aJson: unknown): void {
    const obj =
      aJson !== null && typeof aJson === 'object' ? (aJson as Record<string, unknown>) : {};

    // "classes"
    {
      const classes = obj.classes;

      if (Array.isArray(classes)) {
        this.m_netClasses.clear();

        for (const entry of classes) {
          if (entry === null || typeof entry !== 'object' || !('name' in entry)) continue;

          const nc = readNetClass(entry as Record<string, unknown>);

          if (nc.IsDefault()) this.m_defaultNetClass = nc;
          else this.m_netClasses.set(nc.GetName(), nc);
        }
      }
    }

    // "net_colors"
    {
      const colors = obj.net_colors;

      if (colors !== null && typeof colors === 'object' && !Array.isArray(colors)) {
        this.m_netColorAssignments.clear();

        for (const [key, value] of Object.entries(colors as Record<string, unknown>)) {
          if (typeof value === 'string') this.m_netColorAssignments.set(key, parseColor4d(value));
        }
      }
    }

    // "netclass_assignments"
    {
      const assignments = obj.netclass_assignments;

      if (assignments !== null && typeof assignments === 'object' && !Array.isArray(assignments)) {
        this.m_netClassLabelAssignments.clear();

        for (const [key, value] of Object.entries(assignments as Record<string, unknown>)) {
          if (!Array.isArray(value)) continue;

          let set = this.m_netClassLabelAssignments.get(key);

          if (!set) {
            set = new Set();
            this.m_netClassLabelAssignments.set(key, set);
          }

          for (const netclassName of value)
            if (typeof netclassName === 'string') set.add(netclassName);
        }
      }
    }

    // "netclass_patterns"
    {
      const patterns = obj.netclass_patterns;

      if (Array.isArray(patterns)) {
        this.m_netClassPatternAssignments = [];

        for (const entry of patterns) {
          if (entry === null || typeof entry !== 'object') continue;

          const e = entry as Record<string, unknown>;

          if (typeof e.pattern === 'string' && typeof e.netclass === 'string') {
            const pattern = e.pattern;
            const netclass = e.netclass;

            // Expand bus patterns so individual bus member nets can be matched
            NET_SETTINGS.ForEachBusMember(pattern, (memberPattern) => {
              this.addSinglePatternAssignment(memberPattern, netclass);
            });
          }
        }
      }
    }

    this.ClearAllCaches();
  }

  /// @brief Clears all netclasses
  /// Calling this method will reset the effective netclass calculation caches
  ClearNetclasses(): void {
    this.m_netClasses.clear();
    this.m_impicitNetClasses.clear();
    this.ClearAllCaches();
  }

  /// @brief Gets all current net name to netclasses assignments
  GetNetclassLabelAssignments(): Map<string, Set<string>> {
    return this.m_netClassLabelAssignments;
  }

  /// @brief Clears all net name to netclasses assignments
  /// Calling user is responsible for resetting the effective netclass calculation caches
  ClearNetclassLabelAssignments(): void {
    this.m_netClassLabelAssignments.clear();
  }

  /// @brief Clears a specific net name to netclass assignment
  /// Calling user is responsible for resetting the effective netclass calculation caches
  ClearNetclassLabelAssignment(netName: string): void {
    this.m_netClassLabelAssignments.delete(netName);
  }

  /// @brief Sets a net name to netclasses assignment
  /// Calling user is responsible for resetting the effective netclass calculation caches
  SetNetclassLabelAssignment(netName: string, netclasses: Set<string>): void {
    this.m_netClassLabelAssignments.set(netName, new Set(netclasses));
  }

  /// @brief Apppends to a net name to netclasses assignment
  /// Calling user is responsible for resetting the effective netclass calculation caches
  AppendNetclassLabelAssignment(netName: string, netclasses: Set<string>): void {
    let set = this.m_netClassLabelAssignments.get(netName);

    if (!set) {
      set = new Set();
      this.m_netClassLabelAssignments.set(netName, set);
    }

    for (const nc of netclasses) set.add(nc);
  }

  /// @brief Determines if a given net name has netclasses assigned
  HasNetclassLabelAssignment(netName: string): boolean {
    return this.m_netClassLabelAssignments.has(netName);
  }

  /// @brief Sets a netclass pattern assignment
  /// Calling this method will reset the effective netclass calculation caches
  SetNetclassPatternAssignment(pattern: string, netclass: string): void {
    // Expand bus patterns (vector buses and bus groups) to individual member patterns.
    // This is necessary because the regex/wildcard matchers interpret brackets and braces
    // as special characters, not as bus notation.
    NET_SETTINGS.ForEachBusMember(pattern, (memberPattern) => {
      this.addSinglePatternAssignment(memberPattern, netclass);
    });

    this.ClearAllCaches();
  }

  private addSinglePatternAssignment(pattern: string, netclass: string): void {
    // Avoid exact duplicates - these shouldn't cause problems, due to later de-duplication
    // but they are unnecessary.
    for (const assignment of this.m_netClassPatternAssignments) {
      if (assignment[0].getPattern() === pattern && assignment[1] === netclass) return;
    }

    // No assignment, add a new one
    this.m_netClassPatternAssignments.push([
      new EdaCombinedMatcher(pattern, CombinedMatcherContext.NETCLASS),
      netclass,
    ]);
  }

  /// @brief Sets all netclass pattern assignments
  /// Calling user is responsible for resetting the effective netclass calculation caches
  SetNetclassPatternAssignments(netclassPatterns: [EdaCombinedMatcher, string][]): void {
    this.m_netClassPatternAssignments = netclassPatterns;
    this.ClearAllCaches();
  }

  /// @brief Gets the netclass pattern assignments
  GetNetclassPatternAssignments(): [EdaCombinedMatcher, string][] {
    return this.m_netClassPatternAssignments;
  }

  /// @brief Clears all netclass pattern assignments
  ClearNetclassPatternAssignments(): void {
    this.m_netClassPatternAssignments = [];
  }

  /// @brief Clears effective netclass cache for the given net
  ClearCacheForNet(netName: string): void {
    const cached = this.m_effectiveNetclassCache.get(netName);

    if (cached) {
      const compositeNetclassName = cached.GetName();
      this.m_compositeNetClasses.delete(compositeNetclassName);
      this.m_effectiveNetclassCache.delete(netName);
    }
  }

  /// @brief Clears the effective netclass cache for all nets
  ClearAllCaches(): void {
    this.m_effectiveNetclassCache.clear();
    this.m_compositeNetClasses.clear();
  }

  /// @brief Sets a net to color assignment
  /// Calling user is responsible for resetting the effective netclass calculation caches
  SetNetColorAssignment(netName: string, color: Color4d): void {
    this.m_netColorAssignments.set(netName, color);
  }

  /// @brief Gets all net name to color assignments
  GetNetColorAssignments(): Map<string, Color4d> {
    return this.m_netColorAssignments;
  }

  /// @brief Clears all net name to color assignments
  /// Calling user is responsible for resetting the effective netclass calculation caches
  ClearNetColorAssignments(): void {
    this.m_netColorAssignments.clear();
  }

  /// @brief Retarget netclass patterns and net colors after a path prefix changes (sheet rename).
  /// Rewrites any entry whose net path starts with aOldPrefix to use aNewPrefix. Returns true and
  /// clears the caches if anything changed.
  RenameNetPathPrefix(aOldPrefix: string, aNewPrefix: string): boolean {
    if (aOldPrefix === '' || aOldPrefix === aNewPrefix) return false;

    let changed = false;

    // Patterns hold the path as plain text, so swap the leading prefix and rebuild the matcher.
    for (const assignment of this.m_netClassPatternAssignments) {
      const pattern = assignment[0].getPattern();

      if (pattern.startsWith(aOldPrefix)) {
        const updated = aNewPrefix + pattern.slice(aOldPrefix.length);
        assignment[0] = new EdaCombinedMatcher(updated, CombinedMatcherContext.NETCLASS);
        changed = true;
      }
    }

    // Net color keys are full net names, which carry the path too.
    const updatedColors = new Map<string, Color4d>();

    for (const [netName, color] of this.m_netColorAssignments) {
      if (netName.startsWith(aOldPrefix)) {
        updatedColors.set(aNewPrefix + netName.slice(aOldPrefix.length), color);
        changed = true;
      } else {
        updatedColors.set(netName, color);
      }
    }

    if (changed) {
      this.m_netColorAssignments = updatedColors;
      this.ClearAllCaches();
    }

    return changed;
  }

  /// @brief Determines if an effective netclass for the given net name has been cached
  HasEffectiveNetClass(aNetName: string): boolean {
    return this.m_effectiveNetclassCache.has(aNetName);
  }

  /// @brief Returns an already cached effective netclass for the given net name
  /// @return The netclass, or default netclass if not found
  GetCachedEffectiveNetClass(aNetName: string): NETCLASS {
    const nc = this.m_effectiveNetclassCache.get(aNetName);

    if (!nc) throw new RangeError('out_of_range'); // std::map::at

    return nc;
  }

  /// @brief Fetches the effective (may be aggregate) netclass for the given net name
  // If the effective netclass has not been computed, it will be created and cached.
  GetEffectiveNetClass(aNetName: string): NETCLASS {
    // Lambda to fetch an explicit netclass. Returns a nullptr if not found
    const getExplicitNetclass = (netclass: string): NETCLASS | null => {
      if (netclass === NETCLASS.Default) return this.m_defaultNetClass;

      return this.m_netClasses.get(netclass) ?? null;
    };

    // Lambda to fetch or create an implicit netclass (defined with a label, but not configured)
    // These are needed as while they do not provide any netclass parameters, they do now appear in
    // DRC matching strings as an assigned netclass.
    const getOrAddImplicitNetcless = (netclass: string): NETCLASS => {
      const ii = this.m_impicitNetClasses.get(netclass);

      if (ii === undefined) {
        const nc = new NETCLASS(netclass, false);
        nc.SetPriority(2147483647 - 1); // Priority > default netclass
        this.m_impicitNetClasses.set(netclass, nc);
        return nc;
      } else {
        return ii;
      }
    };

    // <no net> is forced to be part of the default netclass.
    if (aNetName === '') return this.m_defaultNetClass;

    // First check if we have a cached resolved netclass
    const cacheItr = this.m_effectiveNetclassCache.get(aNetName);

    if (cacheItr !== undefined) return cacheItr;

    // No cache found - build a vector of all netclasses assigned to or matching this net
    const resolvedNetclasses = new Set<NETCLASS>();

    // First find explicit netclass assignments
    const it = this.m_netClassLabelAssignments.get(aNetName);

    if (it !== undefined && it.size > 0) {
      for (const netclassName of it) {
        const netclass = getExplicitNetclass(netclassName);

        if (netclass) {
          resolvedNetclasses.add(netclass);
        } else {
          resolvedNetclasses.add(getOrAddImplicitNetcless(netclassName));
        }
      }
    }

    // Now find any pattern-matched netclass assignments
    for (const [matcher, netclassName] of this.m_netClassPatternAssignments) {
      if (matcher.startsWith(aNetName)) {
        const netclass = getExplicitNetclass(netclassName);

        if (netclass) {
          resolvedNetclasses.add(netclass);
        } else {
          resolvedNetclasses.add(getOrAddImplicitNetcless(netclassName));
        }
      }
    }

    // Handle zero resolved netclasses
    if (resolvedNetclasses.size === 0) {
      // For bus patterns, check if all members share the same netclass.
      // If they do, the bus inherits that netclass for coloring purposes.
      const state: {
        sharedNetclass: NETCLASS | null;
        allSameNetclass: boolean;
        isBusPattern: boolean;
      } = {
        sharedNetclass: null,
        allSameNetclass: true,
        isBusPattern: false,
      };

      NET_SETTINGS.ForEachBusMember(aNetName, (member) => {
        // If ForEachBusMember gives us back the same name, it's not a bus.
        // Skip to avoid infinite recursion.
        if (member === aNetName) return;

        state.isBusPattern = true;

        if (!state.allSameNetclass) return;

        const memberNc = this.GetEffectiveNetClass(member);

        if (!state.sharedNetclass) {
          state.sharedNetclass = memberNc;
        } else if (memberNc.GetName() !== state.sharedNetclass.GetName()) {
          state.allSameNetclass = false;
        }
      });

      const shared = state.sharedNetclass;

      if (
        state.isBusPattern &&
        state.allSameNetclass &&
        shared &&
        shared.GetName() !== NETCLASS.Default
      ) {
        this.m_effectiveNetclassCache.set(aNetName, shared);
        return shared;
      }

      this.m_effectiveNetclassCache.set(aNetName, this.m_defaultNetClass);
      return this.m_defaultNetClass;
    }

    // Make and cache the effective netclass. Note that makeEffectiveNetclass will add the default
    // netclass to resolvedNetclasses if it is needed to complete the netclass paramters set. It
    // will also sort resolvedNetclasses by priority order.
    const netclassPtrs: NETCLASS[] = [];

    for (const nc of resolvedNetclasses) netclassPtrs.push(nc);

    const name = `Effective for net: ${aNetName}`;
    const effectiveNetclass = new NETCLASS(name, false);

    this.makeEffectiveNetclass(effectiveNetclass, netclassPtrs);

    if (netclassPtrs.length === 1) {
      // No defaults were added - just return the primary netclass
      const first = resolvedNetclasses.values().next().value!;
      this.m_effectiveNetclassCache.set(aNetName, first);
      return first;
    } else {
      effectiveNetclass.SetConstituentNetclasses(netclassPtrs);
      this.m_compositeNetClasses.set(effectiveNetclass.GetName(), effectiveNetclass);
      this.m_effectiveNetclassCache.set(aNetName, effectiveNetclass);
      return effectiveNetclass;
    }
  }

  /// @brief Recomputes the internal values of all aggregate effective netclasses
  /// Called when a value of a user-defined netclass changes, but the whole netclass list is not
  /// being recomputed.
  RecomputeEffectiveNetclasses(): void {
    for (const [, nc] of this.m_compositeNetClasses) {
      // Note this needs to be a copy in case we now need to add the default netclass
      const constituents = [...nc.GetConstituentNetclasses()];

      console.assert(constituents.length > 0);

      // If the last netclass is Default, remove it (it will be re-added if still needed)
      if (constituents[constituents.length - 1]!.GetName() === NETCLASS.Default) {
        constituents.pop();
      }

      // Remake the netclass from original constituents
      nc.ResetParameters();
      this.makeEffectiveNetclass(nc, constituents);
      nc.SetConstituentNetclasses(constituents);
    }
  }

  private makeEffectiveNetclass(
    effectiveNetclass: NETCLASS,
    constituentNetclasses: NETCLASS[],
  ): void {
    // Sort the resolved netclasses by priority (highest first), with same-priority netclasses
    // ordered alphabetically
    constituentNetclasses.sort((nc1, nc2) => {
      const p1 = nc1.GetPriority();
      const p2 = nc2.GetPriority();

      if (p1 < p2) return -1;

      if (p1 === p2) return wxLess(nc1.GetName(), nc2.GetName());

      return 1;
    });

    // Iterate from lowest priority netclass and fill effective netclass parameters
    for (let i = constituentNetclasses.length - 1; i >= 0; --i) {
      const nc = constituentNetclasses[i]!;

      if (nc.HasClearance()) {
        effectiveNetclass.SetClearance(nc.GetClearance());
        effectiveNetclass.SetClearanceParent(nc);
      }

      if (nc.HasTrackWidth()) {
        effectiveNetclass.SetTrackWidth(nc.GetTrackWidth());
        effectiveNetclass.SetTrackWidthParent(nc);
      }

      if (nc.HasViaDiameter()) {
        effectiveNetclass.SetViaDiameter(nc.GetViaDiameter());
        effectiveNetclass.SetViaDiameterParent(nc);
      }

      if (nc.HasViaDrill()) {
        effectiveNetclass.SetViaDrill(nc.GetViaDrill());
        effectiveNetclass.SetViaDrillParent(nc);
      }

      if (nc.HasuViaDiameter()) {
        effectiveNetclass.SetuViaDiameter(nc.GetuViaDiameter());
        effectiveNetclass.SetuViaDiameterParent(nc);
      }

      if (nc.HasuViaDrill()) {
        effectiveNetclass.SetuViaDrill(nc.GetuViaDrill());
        effectiveNetclass.SetuViaDrillParent(nc);
      }

      if (nc.HasDiffPairWidth()) {
        effectiveNetclass.SetDiffPairWidth(nc.GetDiffPairWidth());
        effectiveNetclass.SetDiffPairWidthParent(nc);
      }

      if (nc.HasDiffPairGap()) {
        effectiveNetclass.SetDiffPairGap(nc.GetDiffPairGap());
        effectiveNetclass.SetDiffPairGapParent(nc);
      }

      if (nc.HasDiffPairViaGap()) {
        effectiveNetclass.SetDiffPairViaGap(nc.GetDiffPairViaGap());
        effectiveNetclass.SetDiffPairViaGapParent(nc);
      }

      if (nc.HasWireWidth()) {
        effectiveNetclass.SetWireWidth(nc.GetWireWidth());
        effectiveNetclass.SetWireWidthParent(nc);
      }

      if (nc.HasBusWidth()) {
        effectiveNetclass.SetBusWidth(nc.GetBusWidth());
        effectiveNetclass.SetBusWidthParent(nc);
      }

      if (nc.HasLineStyle()) {
        effectiveNetclass.SetLineStyle(nc.GetLineStyle());
        effectiveNetclass.SetLineStyleParent(nc);
      }

      const pcbColor = nc.GetPcbColor();

      if (!colorEquals(pcbColor, COLOR4D_UNSPECIFIED)) {
        effectiveNetclass.SetPcbColor(pcbColor);
        effectiveNetclass.SetPcbColorParent(nc);
      }

      const schColor = nc.GetSchematicColor();

      if (!colorEquals(schColor, COLOR4D_UNSPECIFIED)) {
        effectiveNetclass.SetSchematicColor(schColor);
        effectiveNetclass.SetSchematicColorParent(nc);
      }

      if (nc.HasTuningProfile()) {
        effectiveNetclass.SetTuningProfile(nc.GetTuningProfile());
        effectiveNetclass.SetTuningProfileParent(nc);
      }
    }

    // Fill in any required defaults
    if (this.addMissingDefaults(effectiveNetclass))
      constituentNetclasses.push(this.m_defaultNetClass);
  }

  /// @brief Adds any missing fields to the given netclass from the default netclass
  /// @returns true if any fields were added from the default netclass
  private addMissingDefaults(nc: NETCLASS): boolean {
    let addedDefault = false;

    if (!nc.HasClearance()) {
      addedDefault = true;
      nc.SetClearance(this.m_defaultNetClass.GetClearance());
      nc.SetClearanceParent(this.m_defaultNetClass);
    }

    if (!nc.HasTrackWidth()) {
      addedDefault = true;
      nc.SetTrackWidth(this.m_defaultNetClass.GetTrackWidth());
      nc.SetTrackWidthParent(this.m_defaultNetClass);
    }

    if (!nc.HasViaDiameter()) {
      addedDefault = true;
      nc.SetViaDiameter(this.m_defaultNetClass.GetViaDiameter());
      nc.SetViaDiameterParent(this.m_defaultNetClass);
    }

    if (!nc.HasViaDrill()) {
      addedDefault = true;
      nc.SetViaDrill(this.m_defaultNetClass.GetViaDrill());
      nc.SetViaDrillParent(this.m_defaultNetClass);
    }

    if (!nc.HasuViaDiameter()) {
      addedDefault = true;
      nc.SetuViaDiameter(this.m_defaultNetClass.GetuViaDiameter());
      nc.SetuViaDiameterParent(this.m_defaultNetClass);
    }

    if (!nc.HasuViaDrill()) {
      addedDefault = true;
      nc.SetuViaDrill(this.m_defaultNetClass.GetuViaDrill());
      nc.SetuViaDrillParent(this.m_defaultNetClass);
    }

    if (!nc.HasDiffPairWidth()) {
      addedDefault = true;
      nc.SetDiffPairWidth(this.m_defaultNetClass.GetDiffPairWidth());
      nc.SetDiffPairWidthParent(this.m_defaultNetClass);
    }

    if (!nc.HasDiffPairGap()) {
      addedDefault = true;
      nc.SetDiffPairGap(this.m_defaultNetClass.GetDiffPairGap());
      nc.SetDiffPairGapParent(this.m_defaultNetClass);
    }

    // Currently this is only on the default netclass, and not editable in the setup panel
    // if( !nc->HasDiffPairViaGap() )
    // {
    //     addedDefault = true;
    //     nc->SetDiffPairViaGap( m_defaultNetClass->GetDiffPairViaGap() );
    //     nc->SetDiffPairViaGapParent( m_defaultNetClass.get() );
    // }

    if (!nc.HasWireWidth()) {
      addedDefault = true;
      nc.SetWireWidth(this.m_defaultNetClass.GetWireWidth());
      nc.SetWireWidthParent(this.m_defaultNetClass);
    }

    if (!nc.HasBusWidth()) {
      addedDefault = true;
      nc.SetBusWidth(this.m_defaultNetClass.GetBusWidth());
      nc.SetBusWidthParent(this.m_defaultNetClass);
    }

    // The tuning profile can be empty - only fill if a default tuning profile is set
    if (!nc.HasTuningProfile() && this.m_defaultNetClass.HasTuningProfile()) {
      addedDefault = true;
      nc.SetTuningProfile(this.m_defaultNetClass.GetTuningProfile());
      nc.SetTuningProfileParent(this.m_defaultNetClass);
    }

    return addedDefault;
  }

  GetNetClassByName(aNetClassName: string): NETCLASS {
    const ii = this.m_netClasses.get(aNetClassName);

    if (ii === undefined) return this.m_defaultNetClass;
    else return ii;
  }

  /**
   * Parse a bus vector (e.g. A[7..0]) into name and members.
   *
   * @param aBus is a bus vector label string
   * @param aName out is the bus name, e.g. "A"
   * @param aMemberList is a list of member strings, e.g. A7, A6, and so on
   * @return true if aBus was successfully parsed
   */
  static ParseBusVector(aBus: string, aName: OutStr | null, aMemberList: string[] | null): boolean {
    const parsed = parseBusVectorImpl(aBus);

    if (!parsed) return false;

    if (aName) aName.value = parsed.name;

    if (aMemberList) aMemberList.push(...parsed.members);

    return true;
  }

  /**
   * Parse a bus group label into the name and a list of components.
   *
   * @param aGroup is the input label, e.g. "USB{DP DM}"
   * @param aName is the output group name, e.g. "USB"
   * @param aMemberList is a list of member strings, e.g. "DP", "DM"
   * @return true if aGroup was successfully parsed
   */
  static ParseBusGroup(
    aGroup: string,
    aName: OutStr | null,
    aMemberList: string[] | null,
  ): boolean {
    const parsed = parseBusGroupImpl(aGroup);

    if (!parsed) return false;

    if (aName) aName.value = parsed.name;

    if (aMemberList) aMemberList.push(...parsed.members);

    return true;
  }

  /**
   * Expand a bus pattern (vector or group) and call aFunction for each member.
   * If the pattern is not a bus, aFunction is called once with the original pattern.
   */
  static ForEachBusMember(aBusPattern: string, aFunction: (aMember: string) => void): void {
    const members: string[] = [];

    if (NET_SETTINGS.ParseBusVector(aBusPattern, null, members)) {
      // Vector bus: call function for each expanded member
      for (const member of members) aFunction(member);
    } else if (NET_SETTINGS.ParseBusGroup(aBusPattern, null, members)) {
      // Bus group: recursively expand each member (which may itself be a vector or group)
      for (const member of members) NET_SETTINGS.ForEachBusMember(member, aFunction);
    } else {
      // Not a bus pattern: call function with the original pattern
      aFunction(aBusPattern);
    }
  }
}

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
