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

import type { LibSymbol, LibPin, SchSymbol, Schematic } from './types.js';
import type { EditCommand } from './tools/command.js';
import { flattenLibSymbol } from './lib_symbol.js';
import { schSymbolLibraryName } from './lib_symbol.js';
import {
  libItemName,
  libNickname,
  libItemNameIllegalCharOffset,
} from './tools/edit_symbol_libid.js';
import { escapeLibId, unescapeString } from '@ziroeda/common';
import type { InputPrefs } from '@ziroeda/common/ui/view_controls.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import { ESCAPE_CONTEXT, EscapeString } from '@ziroeda/common/string_utils.js';
import {
  KiCadSymbolLibFileExtension,
  LegacySymbolLibFileExtension,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxOK } from '@ziroeda/common/wx/defs.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LIB_SYMBOL } from './lib_symbol.js';
import { SymbolLibAdapter } from './project_sch.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import { SCH_FILE_T, SCH_IO_MGR } from './sch_io/sch_io_mgr.js';
import { SCH_IO_KICAD_SEXPR } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_SCREENS } from './sch_screen.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import type { SCHEMATIC } from './schematic.js';

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

// ---- DIALOG_RESCUE_EACH's contract (the dialog is designer's, reached through
// EESCHEMA_APP.DialogRescueEach) ----

/** One row of "Instances of this symbol" — `PopulateInstanceList`. */
export interface RescueInstance {
  readonly reference: string;
  readonly value: string;
}

export interface DialogRescueEachProps {
  candidates: readonly RescueCandidate[];
  /** The placements of one library id, in hierarchy order. */
  instancesOf: (requestedId: string) => readonly RescueInstance[];
  /**
   * Whether the "Never Show Again" button is shown — `aAskShowAgain`, which is
   * `!aRunningOnDemand`. Running it yourself from the Tools menu offers no way
   * to stop it being offered, because you asked for it.
   */
  askShowAgain: boolean;
  inputPrefs?: InputPrefs;
  /** OK: the candidates still ticked, in list order. */
  onOk: (chosen: readonly RescueCandidate[]) => void;
  /** Cancel, and the Never Show Again answer, which also rescues nothing. */
  onCancel: () => void;
  onNeverShowAgain: () => void;
}

// ---------------------------------------------------------------------------
// The KiCad classes (project_rescue.h / project_rescue.cpp) on the live model. Of the two
// rescuers only SYMBOL_LIB_TABLE_RESCUER is ported: LEGACY_RESCUER is for a schematic with no
// library nicknames (a KiCad 4 file), whose LEGACY_SYMBOL_LIBS the live model does not load yet,
// and RescueSymbols only reaches it for such a file. PROJECT_SCH::LegacySchLibs - the project's
// `<project>-cache.lib` - is not a PROJECT element here, so `findSymbol` over it finds nothing:
// with no cache, the live arm is a symbol id with characters LIB_ID forbids.
// ---------------------------------------------------------------------------

/** `sort_by_libid`: symbols in LIB_ID order, so a library symbol is searched once per group. */
function getSymbols(aSchematic: SCHEMATIC, aSymbols: SCH_SYMBOL[]): void {
  const screens = new SCH_SCREENS(aSchematic.Root());

  // Get the full list
  for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
    for (const aItem of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T))
      aSymbols.push(aItem as SCH_SYMBOL);
  }

  if (aSymbols.length === 0) return;

  // sort aSymbols by lib symbol. symbols will be grouped by same lib symbol.
  aSymbols.sort((a, b) => a.GetLibId().compare(b.GetLibId()));
}

/** `findSymbol( aName, aLibs, aCached )`: the legacy libraries are not loaded (see above). */
function findSymbol(_aName: string, _aLibs: null, _aCached: boolean): LIB_SYMBOL | null {
  return null;
}

/** `GetRescueLibraryFileName( aSchematic )`: `<schematic>-rescue.lib` beside the schematic. */
function GetRescueLibraryFileName(aSchematic: SCHEMATIC): {
  path: string;
  name: string;
  ext: string;
} {
  const fn = aSchematic.GetFileName();
  const slash = fn.lastIndexOf('/');
  const full = fn.slice(slash + 1);
  const dot = full.lastIndexOf('.');

  return {
    path: slash < 0 ? '' : fn.slice(0, slash),
    name: `${dot <= 0 ? full : full.slice(0, dot)}-rescue`,
    ext: LegacySymbolLibFileExtension,
  };
}

const fullPathOf = (aFn: { path: string; name: string; ext: string }) =>
  `${aFn.path === '' ? '' : `${aFn.path}/`}${aFn.name}.${aFn.ext}`;

/** `SchGetLibSymbol( aLibId, aLibMgr )` (sch_base_frame.cpp:83) without a cache library. */
function SchGetLibSymbol(
  aLibId: LIB_ID,
  aLibMgr: ReturnType<typeof SymbolLibAdapter>,
): LIB_SYMBOL | null {
  try {
    return aLibMgr.LoadSymbol(aLibId);
  } catch (ioe) {
    if (!(ioe instanceof IO_ERROR)) throw ioe;

    return null;
  }
}

export abstract class RESCUE_CANDIDATE {
  protected m_requested_name: string;
  protected m_new_name: string;
  protected m_lib_candidate: LIB_SYMBOL | null;
  protected m_unit: number;
  protected m_bodyStyle: number;

  constructor(
    aRequestedName: string,
    aNewName: string,
    aLibCandidate: LIB_SYMBOL | null,
    aUnit: number,
    aBodyStyle: number,
  ) {
    this.m_requested_name = aRequestedName;
    this.m_new_name = aNewName;
    this.m_lib_candidate = aLibCandidate;
    this.m_unit = aUnit;
    this.m_bodyStyle = aBodyStyle;
  }

  /** Get the name that was originally requested in the schematic. */
  GetRequestedName(): string {
    return this.m_requested_name;
  }

  /** Get the name we're proposing changing it to. */
  GetNewName(): string {
    return this.m_new_name;
  }

  /** Get the part that can be loaded from the project cache, if possible, or else NULL. */
  GetCacheCandidate(): LIB_SYMBOL | null {
    return null;
  }

  /** Get the part the would be loaded from the libraries, if possible, or else NULL. */
  GetLibCandidate(): LIB_SYMBOL | null {
    return this.m_lib_candidate;
  }

  GetUnit(): number {
    return this.m_unit;
  }

  GetBodyStyle(): number {
    return this.m_bodyStyle;
  }

  /** Get a description of the action proposed, for displaying in the UI. */
  abstract GetActionDescription(): string;

  /** Perform the actual rescue action.  @return true for success. */
  abstract PerformAction(aRescuer: RESCUER): boolean;
}

export class RESCUE_SYMBOL_LIB_TABLE_CANDIDATE extends RESCUE_CANDIDATE {
  private readonly m_requested_id: LIB_ID;
  private readonly m_new_id: LIB_ID;
  private readonly m_cache_candidate: LIB_SYMBOL | null;

  constructor(
    aRequestedId: LIB_ID = new LIB_ID(),
    aNewId: LIB_ID = new LIB_ID(),
    aCacheCandidate: LIB_SYMBOL | null = null,
    aLibCandidate: LIB_SYMBOL | null = null,
    aUnit = 0,
    aBodyStyle = 0,
  ) {
    super(aRequestedId.Format(), '', aLibCandidate, aUnit, aBodyStyle);
    this.m_requested_id = aRequestedId;
    this.m_new_id = aNewId;
    this.m_cache_candidate = aCacheCandidate;
  }

  override GetCacheCandidate(): LIB_SYMBOL | null {
    return this.m_cache_candidate;
  }

  /**
   * `FindRescues( aRescuer, aCandidates )` (project_rescue.cpp:344): one candidate per symbol id
   * that is only in the cache, conflicts with its library symbol, or has an illegal name.
   */
  static FindRescues(aRescuer: RESCUER, aCandidates: RESCUE_CANDIDATE[]): void {
    const candidate_map = new Map<
      string,
      { id: LIB_ID; candidate: RESCUE_SYMBOL_LIB_TABLE_CANDIDATE }
    >();

    // Remember the list of symbols is sorted by LIB_ID.
    // So a search in libraries is made only once by group
    let cache_match: LIB_SYMBOL | null = null;
    let lib_match: LIB_SYMBOL | null = null;
    let old_symbol_id = new LIB_ID();

    let symbolName: string;

    for (const eachSymbol of aRescuer.GetSymbols()) {
      const symbol_id = eachSymbol.GetLibId();

      if (!old_symbol_id.equals(symbol_id)) {
        // A new symbol name is found (a new group starts here).
        // Search the symbol names candidates only once for this group:
        old_symbol_id = symbol_id;

        symbolName = symbol_id.Format();

        // Get the library symbol from the cache library.  It will be a flattened
        // symbol by default (no inheritance).
        cache_match = findSymbol(symbolName, null, true);

        // At some point during V5 development, the LIB_ID delimiter character ':' was
        // replaced by '_' when writing the symbol cache library so we have to test for
        // the LIB_NICKNAME_LIB_SYMBOL_NAME case.
        if (!cache_match) {
          symbolName = `${symbol_id.GetLibNickname()}-${symbol_id.GetLibItemName()}`;
          cache_match = findSymbol(symbolName, null, true);
        }

        // Get the library symbol from the symbol library table.
        lib_match = SchGetLibSymbol(symbol_id, SymbolLibAdapter(aRescuer.GetPrj()));

        if (!cache_match && !lib_match) continue;

        // If it's a derived symbol, use the parent symbol to perform the pin test.
        if (lib_match?.IsDerived()) lib_match = lib_match.GetRootSymbol() ?? null;

        // Test whether there is a conflict or if the symbol can only be found in the cache.
        if (LIB_ID.HasIllegalChars(symbol_id.GetLibItemName()) === -1) {
          if (
            cache_match &&
            lib_match &&
            !cache_match.PinsConflictWith(lib_match, true, true, true, true, false)
          )
            continue;

          if (!cache_match && lib_match) continue;
        }

        // Fix illegal LIB_ID name characters.
        const new_name = EscapeString(symbol_id.GetLibItemName(), ESCAPE_CONTEXT.CTX_LIBID);

        // Differentiate symbol name in the rescue library by appending the original symbol
        // library table nickname to the symbol name to prevent name clashes in the rescue
        // library.
        const libNickname = GetRescueLibraryFileName(aRescuer.Schematic()).name;

        const new_id = new LIB_ID(libNickname, `${new_name}-${symbol_id.GetLibNickname()}`);

        const candidate = new RESCUE_SYMBOL_LIB_TABLE_CANDIDATE(
          symbol_id,
          new_id,
          cache_match,
          lib_match,
          eachSymbol.GetUnit(),
          eachSymbol.GetBodyStyle(),
        );

        candidate_map.set(symbol_id.Format(), { id: symbol_id, candidate });
      }
    }

    // Now, dump the map into aCandidates (std::map<LIB_ID, …>: LIB_ID order)
    for (const { candidate } of [...candidate_map.values()].sort((a, b) => a.id.compare(b.id)))
      aCandidates.push(candidate);
  }

  GetActionDescription(): string {
    if (!this.m_cache_candidate && !this.m_lib_candidate) {
      return `Cannot rescue symbol ${unescapeString(this.m_requested_id.GetLibItemName())} which is not available in any library or the cache.`;
    } else if (this.m_cache_candidate && !this.m_lib_candidate) {
      return `Rescue symbol ${unescapeString(this.m_requested_id.Format())} found only in cache library to ${unescapeString(this.m_new_id.Format())}.`;
    }

    return `Rescue modified symbol ${unescapeString(this.m_requested_id.Format())} to ${unescapeString(this.m_new_id.Format())}`;
  }

  PerformAction(aRescuer: RESCUER): boolean {
    const tmp = this.m_cache_candidate ?? this.m_lib_candidate;

    if (!tmp) return false; // wxCHECK_MSG: "Both cache and library symbols undefined."

    const new_symbol = tmp.Flatten();
    new_symbol.SetLibId(this.m_new_id);
    new_symbol.SetName(this.m_new_id.GetLibItemName());
    aRescuer.AddSymbol(new_symbol);

    for (const eachSymbol of aRescuer.GetSymbols()) {
      if (!eachSymbol.GetLibId().equals(this.m_requested_id)) continue;

      eachSymbol.SetLibId(this.m_new_id);
      eachSymbol.ClearFlags();
      aRescuer.LogRescue(eachSymbol, this.m_requested_id.Format(), this.m_new_id.Format());
    }

    return true;
  }
}

/** `RESCUE_LOG`. */
export interface RESCUE_LOG {
  symbol: SCH_SYMBOL;
  old_name: string;
  new_name: string;
}

/**
 * `DIALOG_RESCUE_EACH` as InvokeDialogRescueEach sets it up: the window shows the candidates and
 * writes `chosen` (one flag per candidate, the list's check boxes), ending with wxID_OK; Cancel
 * and "Never Show Again" leave nothing chosen.
 */
export interface DIALOG_RESCUE_EACH_ARG {
  candidates: readonly RESCUE_CANDIDATE[];
  symbols: readonly SCH_SYMBOL[];
  currentSheet: SCH_SHEET_PATH;
  askShowAgain: boolean;
  chosen: boolean[];
}

export abstract class RESCUER {
  protected m_symbols: SCH_SYMBOL[] = [];
  protected m_prj: PROJECT;
  protected m_schematic: SCHEMATIC;
  protected m_currentSheet: SCH_SHEET_PATH;

  protected m_all_candidates: RESCUE_CANDIDATE[] = [];
  protected m_chosen_candidates: RESCUE_CANDIDATE[] = [];

  protected m_rescue_log: RESCUE_LOG[] = [];

  constructor(aProject: PROJECT, aSchematic: SCHEMATIC | null, aCurrentSheet: SCH_SHEET_PATH) {
    this.m_schematic = aSchematic ?? (aCurrentSheet.LastScreen()!.Schematic() as SCHEMATIC);

    if (this.m_schematic) getSymbols(this.m_schematic, this.m_symbols);

    this.m_prj = aProject;
    this.m_currentSheet = aCurrentSheet;
  }

  abstract WriteRescueLibrary(aParent: SCH_EDIT_FRAME): boolean;

  abstract OpenRescueLibrary(): void;

  abstract FindCandidates(): void;

  abstract AddSymbol(aNewSymbol: LIB_SYMBOL): void;

  abstract InvokeDialog(aParent: SCH_EDIT_FRAME, aAskShowAgain: boolean): Promise<void>;

  /** `RemoveDuplicates()`: the first candidate of each requested name. */
  RemoveDuplicates(): void {
    const names_seen: string[] = [];

    this.m_all_candidates = this.m_all_candidates.filter((it) => {
      if (names_seen.includes(it.GetRequestedName())) return false;

      names_seen.push(it.GetRequestedName());
      return true;
    });
  }

  GetCandidateCount(): number {
    return this.m_all_candidates.length;
  }

  GetChosenCandidateCount(): number {
    return this.m_chosen_candidates.length;
  }

  GetSymbols(): SCH_SYMBOL[] {
    return this.m_symbols;
  }

  GetPrj(): PROJECT {
    return this.m_prj;
  }

  Schematic(): SCHEMATIC {
    return this.m_schematic;
  }

  LogRescue(aSymbol: SCH_SYMBOL, aOldName: string, aNewName: string): void {
    this.m_rescue_log.push({ symbol: aSymbol, old_name: aOldName, new_name: aNewName });
  }

  DoRescues(): boolean {
    for (const each_candidate of this.m_chosen_candidates) {
      if (!each_candidate.PerformAction(this)) return false;
    }

    return true;
  }

  UndoRescues(): void {
    for (const each_logitem of this.m_rescue_log) {
      const libId = new LIB_ID();

      libId.SetLibItemName(each_logitem.old_name);
      each_logitem.symbol.SetLibId(libId);
      each_logitem.symbol.ClearFlags();
    }
  }

  /** `RescueProject( aParent, aRescuer, aRunningOnDemand )` (project_rescue.cpp:544). */
  static async RescueProject(
    aParent: SCH_EDIT_FRAME,
    aRescuer: RESCUER,
    aRunningOnDemand: boolean,
  ): Promise<boolean> {
    aRescuer.FindCandidates();

    if (!aRescuer.GetCandidateCount()) {
      if (aRunningOnDemand) {
        await aParent.ShowModalDialog('KICAD_MESSAGE_DIALOG', [], {
          message: 'This project has nothing to rescue.',
          caption: 'Project Rescue Helper',
          style: wxOK,
        });
      }

      return true;
    }

    aRescuer.RemoveDuplicates();
    await aRescuer.InvokeDialog(aParent, !aRunningOnDemand);

    // If no symbols were rescued, let the user know what's going on. He might
    // have clicked cancel by mistake, and should have some indication of that.
    if (!aRescuer.GetChosenCandidateCount()) {
      await aParent.ShowModalDialog('KICAD_MESSAGE_DIALOG', [], {
        message: 'No symbols were rescued.',
        caption: 'Project Rescue Helper',
        style: wxOK,
      });

      // Set the modified flag even on Cancel. Many users seem to instinctively want to Save at
      // this point, due to the reloading of the symbols, so we'll make the save button active.
      return true;
    }

    aRescuer.OpenRescueLibrary();

    if (!aRescuer.DoRescues()) {
      aRescuer.UndoRescues();
      return false;
    }

    aRescuer.WriteRescueLibrary(aParent);

    return true;
  }

  /** `InvokeDialogRescueEach( aParent, aRescuer, aCurrentSheet, aGalBackEndType, aAskShowAgain )`. */
  protected async invokeDialogRescueEach(
    aParent: SCH_EDIT_FRAME,
    aAskShowAgain: boolean,
  ): Promise<void> {
    const arg: DIALOG_RESCUE_EACH_ARG = {
      candidates: this.m_all_candidates,
      symbols: this.m_symbols,
      currentSheet: this.m_currentSheet,
      askShowAgain: aAskShowAgain,
      chosen: this.m_all_candidates.map(() => true),
    };

    // TransferDataFromWindow: the checked rows; Cancel / Never Show Again clear the choice.
    if ((await aParent.ShowModalDialog('DIALOG_RESCUE_EACH', [], arg)) !== wxID_OK) {
      this.m_chosen_candidates = [];
      return;
    }

    this.m_chosen_candidates = this.m_all_candidates.filter((_c, index) => arg.chosen[index]);
  }
}

export class SYMBOL_LIB_TABLE_RESCUER extends RESCUER {
  private readonly m_rescueLibSymbols: LIB_SYMBOL[] = [];
  private readonly m_properties = new Map<string, string>();

  FindCandidates(): void {
    RESCUE_SYMBOL_LIB_TABLE_CANDIDATE.FindRescues(this, this.m_all_candidates);
  }

  InvokeDialog(aParent: SCH_EDIT_FRAME, aAskShowAgain: boolean): Promise<void> {
    return this.invokeDialogRescueEach(aParent, aAskShowAgain);
  }

  OpenRescueLibrary(): void {
    this.m_properties.set(SCH_IO_KICAD_SEXPR.PropBuffering, '');

    const fn = GetRescueLibraryFileName(this.m_schematic);
    const manager = Pgm().GetLibraryManager();
    const adapter = SymbolLibAdapter(this.m_prj);

    // If a rescue library already exists copy the contents of that library so we do not
    // lose any previous rescues.
    const row = manager.GetRow(LIBRARY_TABLE_TYPE.SYMBOL, fn.name);

    if (row) {
      if (SCH_IO_MGR.EnumFromStr(row.Type()) === SCH_FILE_T.SCH_KICAD)
        fn.ext = KiCadSymbolLibFileExtension;

      for (const symbol of adapter.GetSymbols(fn.name))
        this.m_rescueLibSymbols.push(LIB_SYMBOL.copyOf(symbol));
    }
  }

  WriteRescueLibrary(_aParent: SCH_EDIT_FRAME): boolean {
    const manager = Pgm().GetLibraryManager();
    const fn = GetRescueLibraryFileName(this.m_schematic);
    const optRow = manager.GetRow(LIBRARY_TABLE_TYPE.SYMBOL, fn.name);

    fn.ext = KiCadSymbolLibFileExtension;

    try {
      const pi = SCH_IO_MGR.FindPlugin(SCH_FILE_T.SCH_KICAD)!;

      for (const symbol of this.m_rescueLibSymbols)
        pi.SaveSymbol(fullPathOf(fn), LIB_SYMBOL.copyOf(symbol), this.m_properties);

      pi.SaveLibrary(fullPathOf(fn));
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(`Failed to save rescue library ${fullPathOf(fn)}.`, ioe.message);
      return false;
    }

    // If the rescue library already exists in the symbol library table no need save it to add
    // it to the table.
    if (!optRow || SCH_IO_MGR.EnumFromStr(optRow.Type()) === SCH_FILE_T.SCH_LEGACY) {
      const uri = `\${KIPRJMOD}/${fn.name}.${fn.ext}`;
      const libNickname = fn.name;

      const projectTable = manager.Table(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.PROJECT);

      if (!projectTable) return false; // wxCHECK

      const row = projectTable.Row(libNickname) ?? projectTable.InsertRow();

      row.SetNickname(libNickname);
      row.SetURI(uri);
      row.SetType('KiCad');

      const saved = projectTable.Save();

      if (!saved.ok) {
        // wxMessageBox( …, _( "File Save Error" ), wxOK | wxICON_ERROR )
        DisplayErrorMessage(`Error saving library table:\n\n${saved.error.message}`);
        return false;
      }
    }

    // Update the schematic symbol library links since the library list has changed.
    const schematic = new SCH_SCREENS(this.m_schematic.Root());
    schematic.UpdateSymbolLinks();
    return true;
  }

  AddSymbol(aNewSymbol: LIB_SYMBOL): void {
    this.m_rescueLibSymbols.push(LIB_SYMBOL.copyOf(aNewSymbol));
  }
}
