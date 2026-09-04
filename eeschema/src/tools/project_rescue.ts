// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Project Rescue Helper — `eeschema/project_rescue.cpp`.
 *
 * What it is for: a schematic remembers which symbols it was drawn with, and a
 * library is free to change underneath it. Rescue is the offer to keep the copy
 * the schematic was drawn with, under a new name in a `<schematic>-rescue`
 * library, rather than silently taking whatever the library says today.
 *
 * There are two rescuers upstream and they are not interchangeable:
 *
 *     if( schematic.HasNoFullyDefinedLibIds() )
 *         RescueLegacyProject( true );
 *     else
 *         RescueSymbolLibTableProject( true );
 *     (`sch_editor_control.cpp:533-541`)
 *
 * `LEGACY_RESCUER` is for a schematic whose symbols have no library nickname at
 * all — a KiCad 4 file, before symbol library tables. Anything we can open has
 * fully defined ids, so the one that applies here is always
 * `SYMBOL_LIB_TABLE_RESCUER`, and this module ports its candidate finder,
 * `RESCUE_SYMBOL_LIB_TABLE_CANDIDATE::FindRescues` (`project_rescue.cpp:344-436`).
 *
 * ## The two places it looks
 *
 * The finder consults the project's legacy `<project>-cache.lib`, through
 * `PROJECT_SCH::LegacySchLibs`, and the symbol library table. The cache is
 * taken as an argument here rather than reached for, because who supplies it is
 * the caller's business — `sch_io/legacy/read-lib.ts` reads that format, and a
 * project without one hands over an empty map.
 *
 * With no cache exactly one arm stays live, and it is a real one: an id whose
 * item name contains characters `LIB_ID` forbids. Both cache-dependent skips
 * sit *inside* the legal-name test —
 *
 *     if( LIB_ID::HasIllegalChars( symbol_id.GetLibItemName() ) == -1 )
 *     {
 *         if( cache_match && lib_match && !cache_match->PinsConflictWith( … ) )
 *             continue;
 *         if( !cache_match && lib_match )
 *             continue;
 *     }
 *
 * — so `Device:Conn<1>`, which an importer or a hand-edited file leaves behind,
 * is a candidate on the strength of its name alone.
 *
 * This is deliberately NOT the same question as ERC's `lib_symbol_mismatch`,
 * which compares a sheet's `lib_symbols` entry against the library. That is the
 * modern cache; this is the KiCad 4/5 one. Upstream keeps both, and so do we.
 */

import type { LibSymbol, LibPin, SchSymbol, Schematic } from '../types.js';
import type { EditCommand } from './command.js';
import { flattenLibSymbol } from '../lib_symbol.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import { libItemName, libNickname, libItemNameIllegalCharOffset } from './edit_symbol_libid.js';
import { escapeLibId, unescapeString } from '@ziroeda/common';

/**
 * One row of the rescue dialog — `RESCUE_SYMBOL_LIB_TABLE_CANDIDATE`.
 *
 * `cache` and `lib` are the two symbols being compared: the copy in the
 * project's cache library and the copy in the library the id names. At least
 * one is always present (`if( !cache_match && !lib_match ) continue`), and
 * which of them is missing is what the action description reports.
 */
export interface RescueCandidate {
  /** `m_requested_id.Format()`, the library id the schematic asks for. */
  readonly requestedId: string;
  /** `m_new_id.Format()`, where the rescued copy will live. */
  readonly newId: string;
  readonly cache: LibSymbol | null;
  readonly lib: LibSymbol | null;
  /** The unit and body style of the first placement found, for the preview. */
  readonly unit: number;
  readonly bodyStyle: number;
}

/**
 * The rescue library's nickname — `GetRescueLibraryFileName`
 * (`project_rescue.cpp:107-113`), which is the SCHEMATIC's filename with
 * `-rescue` appended, not the project's name. They are usually the same, and
 * on a project whose root sheet was renamed they are not.
 */
export function rescueLibraryNickname(schematicFileName: string): string {
  const base = schematicFileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return `${base}-rescue`;
}

/** The file the rescued symbols are written to. Upstream sets the extension to
 *  `.kicad_sym` in `WriteRescueLibrary` even though the row it looks up may be
 *  a legacy one (`project_rescue.cpp:806`). */
export function rescueLibraryFileName(schematicFileName: string): string {
  return `${rescueLibraryNickname(schematicFileName)}.kicad_sym`;
}

/** Every pin of a symbol, tagged with the unit and body style it is drawn in. */
interface TaggedPin {
  readonly pin: LibPin;
  readonly unit: number;
  readonly bodyStyle: number;
}

/**
 * `LIB_SYMBOL::GetGraphicalPins()` with no arguments: no unit filtering, no
 * body-style filtering, so every pin of every unit. A derived symbol answers
 * from its root, which is what flattening does here.
 */
function graphicalPins(sym: LibSymbol): TaggedPin[] {
  const flat = flattenLibSymbol(sym);
  return flat.units.flatMap((u) =>
    u.pins.map((pin) => ({ pin, unit: u.unit, bodyStyle: u.bodyStyle })),
  );
}

/** Which properties `pinsConflictWith` compares beyond unit, body style and position. */
export interface PinConflictTests {
  readonly numbers: boolean;
  readonly names: boolean;
  readonly type: boolean;
  readonly orientation: boolean;
  readonly length: boolean;
}

/**
 * `LIB_SYMBOL::PinsConflictWith` (`lib_symbol.cpp`).
 *
 * For every pin of `a`, look for a pin of `b` in the same unit and body style,
 * at the same position, agreeing on whichever of the five properties were asked
 * for. One pin with no such partner is a conflict.
 *
 * Note the asymmetry, which is upstream's: it walks `a`'s pins only, so a `b`
 * with extra pins at positions `a` does not use is not a conflict. The rescue
 * call passes `a` = the cache copy, so a library that has GAINED pins is not by
 * itself a reason to rescue; one that moved or renamed them is.
 */
export function pinsConflictWith(a: LibSymbol, b: LibSymbol, tests: PinConflictTests): boolean {
  const others = graphicalPins(b);
  for (const mine of graphicalPins(a)) {
    const found = others.some(
      (other) =>
        mine.unit === other.unit &&
        mine.bodyStyle === other.bodyStyle &&
        mine.pin.at.x === other.pin.at.x &&
        mine.pin.at.y === other.pin.at.y &&
        (!tests.numbers || mine.pin.number === other.pin.number) &&
        (!tests.names || mine.pin.name === other.pin.name) &&
        (!tests.type || mine.pin.electricalType === other.pin.electricalType) &&
        (!tests.orientation || mine.pin.angle === other.pin.angle) &&
        (!tests.length || mine.pin.length === other.pin.length),
    );
    if (!found) return true;
  }
  return false;
}

/** The tests the rescuer asks for: everything but the pin length
 *  (`project_rescue.cpp:409`, `PinsConflictWith( *lib_match, true, true, true, true, false )`). */
export const RESCUE_PIN_TESTS: PinConflictTests = {
  numbers: true,
  names: true,
  type: true,
  orientation: true,
  length: false,
};

/** How {@link findRescues} reaches the two libraries it compares. */
export interface RescueSources {
  /**
   * The project's legacy `<project>-cache.lib`, by the name the cache files a
   * symbol under. Empty when the project has no cache library, which is every
   * project written by KiCad 6 or later.
   */
  readonly cache: ReadonlyMap<string, LibSymbol>;
  /** `SchGetLibSymbol( symbol_id, … )` — the library the id names, or null. */
  readonly lib: (libId: string) => LibSymbol | null;
  /** The root schematic's file name, which names the rescue library. */
  readonly schematicFileName: string;
}

/**
 * `findSymbol( aName, LegacySchLibs, aCached = true )`, and its second attempt.
 *
 * A V5-era cache library wrote the LIB_ID delimiter as something other than
 * ':', so the name is looked up twice — once as the id formats it, once with
 * the nickname and item name joined by '-'. (The comment upstream says the
 * delimiter became '_'; the format string it then uses is '-'. Mirrored as
 * written, because what matters is which names actually match a file on disk.)
 */
function findCached(cache: ReadonlyMap<string, LibSymbol>, libId: string): LibSymbol | null {
  const direct = cache.get(libId);
  if (direct) return direct;
  const nickname = libNickname(libId);
  const item = libItemName(libId);
  return cache.get(`${nickname}-${item}`) ?? null;
}

/**
 * `RESCUE_SYMBOL_LIB_TABLE_CANDIDATE::FindRescues` (`project_rescue.cpp:344-436`).
 *
 * `aRescuer.GetSymbols()` is every symbol on every screen of the hierarchy,
 * sorted by library id so that each id is looked up once
 * (`getSymbols`/`sort_by_libid`, `project_rescue.cpp:41-77`). The candidates
 * accumulate in a `std::map<LIB_ID, …>` and are emitted in that map's order, so
 * the dialog lists them sorted by id rather than by where they appear on the
 * sheet — reproduced here by sorting the ids.
 */
export function findRescues(
  symbols: readonly SchSymbol[],
  sources: RescueSources,
): RescueCandidate[] {
  const rescueNickname = rescueLibraryNickname(sources.schematicFileName);
  const byId = new Map<string, RescueCandidate>();

  for (const symbol of symbols) {
    const symbolId = symbol.libId;
    // One lookup per id: the C++ gets this from the sort, we get it from the map.
    if (byId.has(symbolId)) continue;

    const cacheMatch = findCached(sources.cache, symbolId);
    let libMatch = sources.lib(symbolId);

    // "If it's a derived symbol, use the parent symbol to perform the pin test."
    // A derived symbol with no reachable root is treated as no match at all.
    if (libMatch?.extends) {
      const root = libMatch.parent ? rootOf(libMatch) : null;
      libMatch = root;
    }

    if (!cacheMatch && !libMatch) continue;

    if (libItemNameIllegalCharOffset(libItemName(symbolId)) === -1) {
      if (cacheMatch && libMatch && !pinsConflictWith(cacheMatch, libMatch, RESCUE_PIN_TESTS))
        continue;
      if (!cacheMatch && libMatch) continue;
    }

    // "Differentiate symbol name in the rescue library by appending the original
    // symbol library table nickname to the symbol name to prevent name clashes."
    const newName = escapeLibId(libItemName(symbolId));
    byId.set(symbolId, {
      requestedId: symbolId,
      newId: `${rescueNickname}:${newName}-${libNickname(symbolId)}`,
      cache: cacheMatch,
      lib: libMatch,
      unit: symbol.unit,
      bodyStyle: symbol.bodyStyle,
    });
  }

  return [...byId.keys()].sort(compareLibId).map((id) => byId.get(id)!);
}

/** `LIB_SYMBOL::GetRootSymbol`, walking `m_parent` to the symbol that defines
 *  the body. Null when the chain is broken, which upstream treats as no match. */
function rootOf(sym: LibSymbol): LibSymbol | null {
  let cur: LibSymbol | undefined = sym;
  const seen = new Set<LibSymbol>();
  while (cur?.extends) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    cur = cur.parent;
  }
  return cur ?? null;
}

/** `LIB_ID::compare`: the nickname, then the item name, both by code unit. */
function compareLibId(a: string, b: string): number {
  const an = libNickname(a);
  const bn = libNickname(b);
  if (an !== bn) return an < bn ? -1 : 1;
  const ai = libItemName(a);
  const bi = libItemName(b);
  return ai === bi ? 0 : ai < bi ? -1 : 1;
}

/**
 * `RESCUE_SYMBOL_LIB_TABLE_CANDIDATE::GetActionDescription`
 * (`project_rescue.cpp:442-465`) — the "Action Taken" column.
 *
 * Three sentences for three situations, and they are not interchangeable: the
 * first is a refusal, the second is a symbol the library has lost, the third is
 * a symbol the library still has but has changed.
 */
export function rescueActionDescription(c: RescueCandidate): string {
  const u = unescapeString;
  if (!c.cache && !c.lib)
    return `Cannot rescue symbol ${u(libItemName(c.requestedId))} which is not available in any library or the cache.`;
  if (c.cache && !c.lib)
    return `Rescue symbol ${u(c.requestedId)} found only in cache library to ${u(c.newId)}.`;
  return `Rescue modified symbol ${u(c.requestedId)} to ${u(c.newId)}`;
}

/**
 * The definition a rescue writes — `PerformAction`'s first half
 * (`project_rescue.cpp:468-479`).
 *
 * The CACHE copy wins when there is one: the whole point is to keep the symbol
 * the schematic was drawn with. It falls back to the library copy only for the
 * illegal-name case, where the two are the same symbol and only the id is
 * being repaired. `Flatten()` first, because the rescue library has to stand on
 * its own — a derived symbol whose parent stayed behind would draw as nothing.
 */
export function rescuedDefinition(c: RescueCandidate): LibSymbol | null {
  const source = c.cache ?? c.lib;
  if (!source) return null;
  const flat = flattenLibSymbol(source);
  const name = libItemName(c.newId);
  return {
    ...flat,
    libId: c.newId,
    // Flatten() resolves the inheritance; the copy must not claim a parent that
    // is not going into the rescue library with it.
    extends: undefined,
    parent: undefined,
    units: flat.units.map((u) => ({ ...u, name: `${name}_${u.unit}_${u.bodyStyle}` })),
  } as LibSymbol;
}

/** One `RESCUE_LOG` row: which placement was repointed, and from what. */
export interface RescueLogEntry {
  readonly reference: string;
  readonly oldId: string;
  readonly newId: string;
}

/**
 * `PerformAction`'s second half: every placement asking for the old id is
 * repointed at the new one.
 *
 * Ours also has to move the placement's cached definition, which upstream does
 * not because its cache is a separate file. `lib_symbols` is keyed by the name
 * the placement resolves through, so a symbol repointed at `foo-rescue:R-Device`
 * with no such entry would draw as nothing at all.
 */
export function repointSymbols(
  symbols: readonly SchSymbol[],
  chosen: readonly RescueCandidate[],
): { symbols: SchSymbol[]; log: RescueLogEntry[] } {
  const byOldId = new Map(chosen.map((c) => [c.requestedId, c]));
  const log: RescueLogEntry[] = [];
  let changed = false;
  const next = symbols.map((s) => {
    const c = byOldId.get(s.libId);
    if (!c) return s;
    log.push({
      reference: s.fields.find((f) => f.key === 'Reference')?.value ?? '',
      oldId: c.requestedId,
      newId: c.newId,
    });
    // `SetLibId` alone upstream. Here the placement's private-copy pointer has
    // to go too: it named an entry under the OLD id, and the rescued definition
    // is filed under the new one.
    const { libName: _dropped, ...rest } = s;
    changed = true;
    return { ...rest, libId: c.newId };
  });
  // The identity matters: `rescueDocumentCommand` reads it to leave a sheet
  // that places none of the rescued ids untouched, rather than replacing it
  // with an equal copy.
  return { symbols: changed ? next : [...symbols], log };
}

/**
 * The rescue applied to one document, as an `EditCommand`.
 *
 * Upstream this is two separate things: `PerformAction` repoints the placements
 * in memory, and `WriteRescueLibrary` writes the rescued definitions to a new
 * `.kicad_sym` file. Ours does both of those AND a third thing upstream has no
 * need of — filing the definitions in the sheet's own `lib_symbols`. That block
 * is what a placement actually draws from, so a symbol repointed at a library
 * we have only just written, and not yet indexed, would otherwise come up
 * empty-bodied until the project was reopened.
 *
 * The old entries are dropped in the same step, because `SCH_SCREEN` keeps
 * `lib_symbols` to what the sheet still uses; leaving them would put a
 * definition in the file that nothing on the sheet resolves through.
 *
 * The command is undoable in the ordinary way, but nothing undoes it: upstream
 * calls `m_frame->ClearUndoRedoList()` once the rescues are done
 * (`sch_editor_control.cpp:582`), because the library on disk has changed and
 * putting the schematic back would leave it pointing at a rescue library it no
 * longer matches.
 */
export function rescueDocumentCommand(chosen: readonly RescueCandidate[]): EditCommand {
  const label = 'Rescue Symbols';
  return {
    label,
    apply(doc: Schematic): Schematic {
      if (!doc.symbols.some((s) => chosen.some((c) => c.requestedId === s.libId))) return doc;
      const { symbols } = repointSymbols(doc.symbols, chosen);

      const rescued = chosen
        .filter((c) => doc.symbols.some((s) => s.libId === c.requestedId))
        .map(rescuedDefinition)
        .filter((d): d is LibSymbol => d !== null);
      if (rescued.length === 0) return { ...doc, symbols };

      // What the sheet still resolves through, after the repointing.
      const used = new Set(symbols.map(schSymbolLibraryName));
      const kept = doc.libSymbols.filter((l) => used.has(l.libId));
      const already = new Set(kept.map((l) => l.libId));
      return {
        ...doc,
        symbols,
        libSymbols: [...kept, ...rescued.filter((d) => !already.has(d.libId))],
      };
    },
    invert(before: Schematic): EditCommand {
      return {
        label,
        apply: () => before,
        invert: (b: Schematic) => ({
          label,
          apply: () => b,
          invert: () => rescueDocumentCommand(chosen),
        }),
      };
    },
  };
}
