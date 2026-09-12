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
