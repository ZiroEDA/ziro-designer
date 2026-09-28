// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Swap Pins — `SCH_EDIT_TOOL::SwapPins` (`eeschema/tools/sch_edit_tool.cpp:1765-1900`)
 * and `SwapPinGeometry` (`sch_tool_utils.cpp:292-325`).
 *
 * Select two or more pins of one symbol and their positions trade places. It is
 * the fix for a footprint whose pinout came out mirrored, without editing the
 * library — which is exactly why it is dangerous enough to sit behind a
 * preference, "Allow unconstrained pin swaps", whose own tooltip says it "may
 * cause invalid design changes".
 *
 * ### Whose pins move
 *
 * Not the library's. `SCH_SYMBOL::m_part` is a `unique_ptr<LIB_SYMBOL>`, a
 * flattened copy owned by the PLACEMENT (`sch_symbol.h:1024`), and
 * `SwapPinGeometry` edits that. Two `Device:R`s on a sheet therefore do not
 * move together.
 *
 * Our `lib_symbols` really is shared, so the same thing has to be said out
 * loud: a placement whose definition is used by any other placement gets a
 * private copy first, filed under KiCad's own name for one —
 *
 *     newName.Printf( wxT( "%s_%d" ), symbol->GetLibId().GetUniStringLibItemName(), cnt );
 *     … while( m_libSymbols.find( newName ) != m_libSymbols.end() ) cnt += 1;
 *     symbol->SetSchSymbolLibraryName( newName );
 *     (`sch_screen.cpp:232-265`)
 *
 * — which is `(lib_name "R_1")` in the file. Upstream mints it lazily, when a
 * diverged part is appended to a screen; ours mints it at the swap, because
 * that is the only moment the divergence is created and there is no Append to
 * notice it later.
 *
 * ### What is swapped
 *
 * Position, orientation, length and operating point (`sch_tool_utils.cpp:303-320`)
 * — geometry only. The NUMBER stays with the pin, which is the whole point:
 * pin 1 ends up where pin 2 was, so the net that was wired to that spot now
 * lands on pin 1.
 */

import { refId } from './hittest.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import type { EditCommand } from './command.js';
import type { LibPin, LibSymbol, SchSymbol, Schematic } from '../types.js';

/** One pin of one placement, located in its definition. */
export interface PlacedPinRef {
  /** `<symbolRefId>:pin<k>`, the id the canvas selects it by. */
  readonly id: string;
  /** Index into `LibSymbol.units`. */
  readonly unit: number;
  /** Index into that unit's `pins`. */
  readonly pin: number;
}

/**
 * The pins of one placement, in the order `<symbolRefId>:pin<k>` numbers them.
 *
 * `k` counts across the units the placement's unit and body style select, in
 * `lib.units` order — the same walk `collectPinSegments` makes. Hidden pins are
 * numbered but not drawn there, so they are numbered here too, or every id
 * after the first hidden pin would name a different pin.
 */
export function placedPinRefs(sym: SchSymbol, symbolId: string, lib: LibSymbol): PlacedPinRef[] {
  const out: PlacedPinRef[] = [];
  let k = 0;
  lib.units.forEach((u, ui) => {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      return;
    u.pins.forEach((_pin, pi) => {
      out.push({ id: `${symbolId}:pin${k}`, unit: ui, pin: pi });
      k += 1;
    });
  });
  return out;
}

/**
 * `SymbolHasSheetInstances` (`sch_tool_utils.cpp:328-370`): the placement is
 * instantiated on more than one sheet path, or in a project other than this
 * one.
 *
 * One SCH_SYMBOL then serves several instances that cannot differ, so a swap
 * would change all of them — which upstream refuses with an infobar rather
 * than doing quietly.
 */
export function symbolIsShared(
  sym: SchSymbol,
  currentProject: string,
): { sheetPaths: string[]; projectNames: string[] } | null {
  const paths = new Set<string>();
  const projects = new Set<string>();
  for (const inst of sym.instances ?? []) {
    paths.add(inst.path);
    if (inst.project && (currentProject === '' || inst.project !== currentProject))
      projects.add(inst.project);
  }
  const sharedWithinProject = paths.size > 1;
  const sharedWithOtherProjects = projects.size > 0;
  if (!sharedWithinProject && !sharedWithOtherProjects) return null;
  return {
    sheetPaths: sharedWithinProject ? [...paths].sort() : [],
    projectNames: sharedWithOtherProjects ? [...projects].sort() : [],
  };
}

/** `LIB_ID::GetUniStringLibItemName` — the part after the colon, or the whole
 *  id when there is no library prefix. */
const itemName = (libId: string): string => libId.slice(libId.indexOf(':') + 1);

/**
 * `newName.Printf( "%s_%d", … )`, counting up until the name is free
 * (`sch_screen.cpp:234-247`). The count starts at 1, so the first private copy
 * of `Device:R` is `R_1`.
 */
export function privateLibSymbolName(libId: string, taken: ReadonlySet<string>): string {
  const base = itemName(libId);
  let cnt = 1;
  while (taken.has(`${base}_${cnt}`)) cnt += 1;
  return `${base}_${cnt}`;
}

/** `SwapPinGeometry`: position, orientation, length and operating point, and
 *  nothing else — not the number, which is what makes the swap mean anything. */
function swapGeometry(a: LibPin, b: LibPin): [LibPin, LibPin] {
  return [
    { ...a, at: b.at, angle: b.angle, length: b.length },
    { ...b, at: a.at, angle: a.angle, length: a.length },
  ];
}

/**
 * `AccumulateDescriptions` (`sch_tool_utils.cpp`): the comma-and-"and" list the
 * infobar quotes the shared sheets or projects in.
 */
function accumulate(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The infobar `SwapPins` shows instead of swapping (`sch_edit_tool.cpp:1792-1836`),
 * in upstream's own three wordings: named projects, named sheets, and the bare
 * fallback when neither could be named.
 */
export function sharedPinSwapMessage(r: {
  sheetPaths: readonly string[];
  projectNames: readonly string[];
}): string {
  if (r.projectNames.length > 0) {
    return `Pin swaps are disabled for symbols shared across other projects (${accumulate(
      r.projectNames,
    )}). Duplicate the sheet to edit pins independently.`;
  }
  if (r.sheetPaths.length > 0) {
    return `Pin swaps are disabled for symbols used by multiple sheet instances (${accumulate(
      r.sheetPaths,
    )}). Duplicate the sheet to edit pins independently.`;
  }
  return 'Pin swaps are disabled for shared symbols. Duplicate the sheet to edit pins independently.';
}

/** Why a swap was refused, in upstream's words. */
export type SwapPinsRefusal =
  | { kind: 'too_few' }
  | { kind: 'not_one_symbol' }
  | { kind: 'shared'; sheetPaths: string[]; projectNames: string[] };

export interface SwapPinsPlan {
  cmd: EditCommand;
  /** The placement the swap acted on, for the caller to reselect. */
  symbolId: string;
}

/**
 * The Swap Pins commit, or the reason there is none.
 *
 * `sorted` is the selection in the order it was made
 * (`GetItemsSortedBySelectionOrder`), and the swap chain is upstream's:
 *
 *     for( size_t i = 0; i < sorted.size() - 1; i++ )
 *         SwapPinGeometry( sorted[i], sorted[(i + 1) % sorted.size()] );
 *
 * — adjacent pairs, so two pins trade and three or more rotate through each
 * other. The modulo cannot wrap, because `i` stops one short.
 */
export function swapPinsCommand(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  pinIds: readonly string[],
  currentProject = '',
): SwapPinsPlan | SwapPinsRefusal {
  if (pinIds.length < 2) return { kind: 'too_few' };

  const symbolIdOf = (id: string): string => id.slice(0, id.lastIndexOf(':pin'));
  const symbolId = symbolIdOf(pinIds[0]!);
  // "All pins need to be on the same symbol" (`sch_edit_tool.cpp:1786-1790`).
  // Kept for the reason it gives, though it cannot be the thing that decides:
  // the ids below are looked up in a table built for THIS symbol, so a pin of
  // another one fails there too. Upstream's check is against the parent
  // pointer, where it is the only test there is.
  if (pinIds.some((id) => symbolIdOf(id) !== symbolId)) return { kind: 'not_one_symbol' };

  const symIndex = doc.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === symbolId);
  if (symIndex < 0) return { kind: 'not_one_symbol' };
  const sym = doc.symbols[symIndex]!;

  const shared = symbolIsShared(sym, currentProject);
  if (shared) return { kind: 'shared', ...shared };

  const defName = schSymbolLibraryName(sym);
  const lib = libById.get(defName);
  if (!lib) return { kind: 'not_one_symbol' };

  const refs = new Map(placedPinRefs(sym, symbolId, lib).map((r) => [r.id, r]));
  const chain = pinIds.map((id) => refs.get(id));
  if (chain.some((r) => r === undefined)) return { kind: 'not_one_symbol' };

  return {
    symbolId,
    cmd: {
      label: 'Swap Pins',
      apply: (d: Schematic): Schematic => applySwap(d, defName, chain as PlacedPinRef[], symbolId),
      invert: (before: Schematic): EditCommand => restoreTo(before),
    },
  };
}

/** Undo is a restore rather than a re-swap: minting the private definition is
 *  not its own inverse, so putting the document back is the honest inverse. */
function restoreTo(before: Schematic): EditCommand {
  const cmd: EditCommand = {
    label: 'Swap Pins',
    apply: () => before,
    invert: (after: Schematic) => ({
      label: 'Swap Pins',
      apply: () => after,
      invert: () => cmd,
    }),
  };
  return cmd;
}

function applySwap(
  doc: Schematic,
  defName: string,
  chain: readonly PlacedPinRef[],
  symbolId: string,
): Schematic {
  const symIndex = doc.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === symbolId);
  if (symIndex < 0) return doc;
  const sym = doc.symbols[symIndex]!;

  const defIndex = doc.libSymbols.findIndex((l) => l.libId === defName);
  if (defIndex < 0) return doc;
  let def = doc.libSymbols[defIndex]!;

  // A definition another placement also uses has to be copied before it can be
  // changed, or the swap would move that placement's pins too.
  const sharedDef = doc.symbols.some(
    (s, i) => i !== symIndex && schSymbolLibraryName(s) === defName,
  );
  const libSymbols = doc.libSymbols.slice();
  let libName = sym.libName;
  if (sharedDef) {
    const taken = new Set(doc.libSymbols.map((l) => l.libId));
    libName = privateLibSymbolName(sym.libId, taken);
    def = { ...def, libId: libName };
    libSymbols.push(def);
  }

  // A private copy renames its units with it. The unit name is not decoration:
  // `SCH_IO_KICAD_SEXPR_LIB_CACHE` synthesises it on save as
  // `"%s_%d_%d"` over the PARENT's item name (`:495`), and the reader takes the
  // unit and body style back off that suffix — so a copy called `R_1` whose
  // units still said `R_1_1` would read back correctly but not be the bytes
  // KiCad writes.
  const units = def.units.map((u) => ({
    ...u,
    ...(sharedDef ? { name: `${itemName(def.libId)}_${u.unit}_${u.bodyStyle}` } : {}),
    pins: u.pins.slice(),
  }));
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    const pa = units[a.unit]?.pins[a.pin];
    const pb = units[b.unit]?.pins[b.pin];
    if (!pa || !pb) continue;
    const [na, nb] = swapGeometry(pa, pb);
    units[a.unit]!.pins[a.pin] = na;
    units[b.unit]!.pins[b.pin] = nb;
  }

  const nextDef: LibSymbol = { ...def, units };
  const at = sharedDef ? libSymbols.length - 1 : defIndex;
  libSymbols[at] = nextDef;

  const symbols = doc.symbols.slice();
  symbols[symIndex] = libName === undefined ? sym : { ...sym, libName };
  return { ...doc, symbols, libSymbols };
}
