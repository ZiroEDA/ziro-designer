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
  constituents.sort((a, b) => priorityOf(a) - priorityOf(b) || a.name.localeCompare(b.name));
  const eff: EffectiveNetClass = {
    name:
      matched.length === 0
        ? dflt.name
        : matched.length === 1
          ? matched[0]!.name
          : `Effective for net: ${netName}`,
    lineStyle: 'Solid',
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
