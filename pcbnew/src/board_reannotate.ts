// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Geometric reannotation: renumber every footprint from where it sits.
 * Counterparts: `DIALOG_BOARD_REANNOTATE` (pcbnew/dialogs/dialog_board_reannotate.cpp),
 * which owns the whole algorithm, and `BOARD_REANNOTATE_TOOL::ReannotateDuplicates`
 * (pcbnew/tools/board_reannotate_tool.cpp:74), a separate and much smaller one.
 *
 * ## Plan then apply, because a rename is not a swap
 *
 * Renumbering in place is wrong the moment two footprints trade names: setting
 * R1 → R2 while an R2 still exists leaves two R2s, and the second assignment
 * silently overwrites the first. Upstream avoids that by never touching the
 * board until every new designator is known — `BuildFootprintList` fills a
 * change array keyed by KIID, and only then does `ReannotateBoard` walk the
 * board applying it. Nothing reads a designator after the plan is built, so a
 * cycle of renames resolves atomically. {@link planBoardReannotate} and
 * {@link applyBoardReannotate} are those two halves and must stay separate.
 *
 * The plan is also where collisions are *caught*: after building it, upstream
 * scans it pairwise for two entries claiming the same new designator and
 * refuses the whole operation if it finds any (`errorcount == 0` is the return
 * value). `ok === false` therefore means "do not touch the board", not "some
 * footprints were skipped".
 *
 * ## The grid snap is what stops a nearly-straight row scrambling
 *
 * Sorting on raw coordinates is useless on a real board: a row of resistors
 * placed by hand differs by a few hundred nanometres in y, so a top-to-bottom
 * sort interleaves them with the row below. Every coordinate is therefore
 * rounded to a user-chosen grid *before* sorting, and only the rounded values
 * are compared — {@link roundToReannotateGrid}. A grid of 0 falls back to
 * `MINGRID` (1000 IU = 1 µm), which is small enough to be no snap at all.
 *
 * That rounding carries a genuine upstream bug, reproduced here: the correction
 * that pushes a coordinate away from zero tests the sign of the *already
 * truncated* coordinate rather than of the remainder, so a value that truncates
 * to exactly 0 always rounds up. −700 on a 1000 grid becomes +1000, not −1000.
 * A board sorted by KiCad and by us has to agree, so the bug stays.
 *
 * ## Front and back are sorted by mirrored codes
 *
 * The eight directions are a 3-bit code — sort on y first or x first, each axis
 * ascending or descending — and the radio button index selects one code for the
 * front and a *different* one for the back. The back is seen through the board,
 * so "left to right" on the back is decreasing x in board coordinates; the two
 * lookup tables encode exactly that swap. See {@link reannotateSortCodes}.
 *
 * ## The scope radio overrides the exclusion list
 *
 * `BuildFootprintList` computes an action per footprint — update, empty,
 * invalid, exclude — and then, if the scope is Selection/Front/Back rather than
 * All, *overwrites* it with a plain front/back/selected test. Three consequences
 * that look like bugs and are all upstream behaviour:
 *
 *   - an exclusion-list entry is ignored unless the scope is All (locked
 *     footprints are not, because that test comes first in the chain);
 *   - a footprint with an empty reference loses its EMPTY action and is
 *     renumbered as if its prefix were the empty string, so it comes out named
 *     `1`, `2`, … ;
 *   - the same happens to a reference with no digits in it at all.
 *
 * ## Numbering state is per prefix, and shared between the two passes
 *
 * Each distinct prefix carries its own "last used" counter plus a set of
 * numbers that are unavailable because an excluded footprint already holds
 * them. The front pass runs first; the back pass resets every counter to
 * `backStart - 1` *only if* `backStart` is non-zero, so the shipped default of
 * blank means the back simply continues the front's numbering. The unavailable
 * sets are registered under the footprint's own prefix, before any front/back
 * prefix is added or removed — so with a front prefix of `F_`, an excluded `R3`
 * does not reserve 3 under `F_R`.
 */
import { strNumCmp, wildCompareString } from '@ziroeda/common/src/string_utils.js';
import { getRefDesPrefix } from './spread_footprints.js';
import { setFootprintReference } from './edit-footprint.js';
import type { SList, SNode } from '@ziroeda/sexpr/src/types.js';
import type { Board, PcbFootprint } from './types.js';

/** `MINGRID`, the grid `RoundToGrid` falls back to when it is handed 0. */
export const REANNOTATE_MIN_GRID = 1000;

/** `MAXERROR`: the duplicate scan gives up after this many reports. */
export const REANNOTATE_MAX_ERROR = 10;

/** `VALIDPREFIX`, the non-alphanumeric characters a prefix box will accept. */
export const REANNOTATE_VALID_PREFIX_CHARS = '_-+=/\\';

/** `ACTION_CODE`: what the plan decided to do with one footprint. */
export type ReannotateAction = 'update' | 'empty' | 'invalid' | 'exclude';

/** `ActionMessage[]`, the suffix the change log prints for a non-update. */
export const REANNOTATE_ACTION_MESSAGE: Readonly<Record<ReannotateAction, string>> = {
  update: '',
  empty: '(not updated)',
  invalid: '(unannotated; not updated)',
  exclude: '(excluded)',
};

/** `REFDES_INFO`, one footprint as the sorter sees it. */
export interface ReannotateRefDesInfo {
  /** Index into `board.footprints`; this port's stand-in for `REFDES_INFO::Uuid`. */
  index: number;
  uuid: string | undefined;
  /** `GetLayer() == F_Cu`. */
  front: boolean;
  /** The reference as it stands now, `R1`, `C2`, possibly empty. */
  refDesString: string;
  /** Everything before the first digit — *not* `UTIL::GetRefDesPrefix`. */
  refDesPrefix: string;
  x: number;
  y: number;
  roundedX: number;
  roundedY: number;
  action: ReannotateAction;
  /** `FPID`, reported alongside a bad reference so the user can find it. */
  fpid: string;
}

/** `REFDES_CHANGE`, one row of the plan. */
export interface ReannotateChange {
  index: number;
  uuid: string | undefined;
  /** The designator to write. Equal to `oldRefDesString` for anything but an update. */
  newRefDes: string;
  oldRefDesString: string;
  front: boolean;
  action: ReannotateAction;
}

/** `REFDES_PREFIX_INFO`, the numbering state of one prefix. */
export interface ReannotatePrefixInfo {
  refDesPrefix: string;
  lastUsedRefDes: number;
  /** Numbers held by excluded footprints, which must be skipped over. */
  unavailableRefs: ReadonlySet<number>;
}

/** Which footprints the dialog's scope radio admits. */
export type ReannotateScope = 'all' | 'front' | 'back' | 'selection';

export interface ReannotateOptions {
  /**
   * Index into the eight direction radio buttons, in the order
   * `m_sortButtons` lists them. Out of range falls back to 0, as upstream.
   */
  sortCode: number;
  scope: ReannotateScope;
  /** `m_ExcludeLocked`. Checked first, so it survives a Front/Back/Selection scope. */
  excludeLocked: boolean;
  /** Footprint UUIDs the selection tool reports; only read when scope is `selection`. */
  selected: ReadonlySet<string>;
  /**
   * `m_locationChoice`: sort by the footprint's own position (the shipped
   * default) or by where its Reference text sits.
   */
  useFootprintLocation: boolean;
  /** `m_GridChoice`, resolved to IU. 0 means `REANNOTATE_MIN_GRID`. */
  sortGridX: number;
  sortGridY: number;
  /** `m_ExcludeList`, raw. Split on commas and whitespace. */
  excludeList: string;
  /** `wxAtoi( m_FrontRefDesStart )`; the dialog ships with "1". */
  frontStart: number;
  /** `wxAtoi( m_BackRefDesStart )`; the dialog ships blank, i.e. 0. */
  backStart: number;
  frontPrefix: string;
  backPrefix: string;
  removeFrontPrefix: boolean;
  removeBackPrefix: boolean;
}

/**
 * The dialog as it opens, before the user touches anything: All, no exclusions,
 * front starts at 1, back continues from the front, sort down-then-right.
 *
 * `sortGridX`/`sortGridY` are 0 rather than a real grid because upstream reads
 * them from the user's grid list, which the engine has no view of; 0 is the
 * value `RoundToGrid` itself treats as "use MINGRID".
 */
export const DEFAULT_REANNOTATE_OPTIONS: ReannotateOptions = {
  sortCode: 0,
  scope: 'all',
  excludeLocked: false,
  selected: new Set<string>(),
  useFootprintLocation: true,
  sortGridX: 0,
  sortGridY: 0,
  excludeList: '',
  frontStart: 1,
  backStart: 0,
  frontPrefix: '',
  backPrefix: '',
  removeFrontPrefix: false,
  removeBackPrefix: false,
};

export interface ReannotatePlan {
  /** `m_changeArray`, sorted by `StrNumCmp` on the old designator. */
  changes: ReannotateChange[];
  /** `aBadRefDes`, footprints whose reference is empty or has no digit in it. */
  badRefDes: ReannotateRefDesInfo[];
  /** `m_frontFootprints` / `m_backFootprints`, each in its own sorted order. */
  front: ReannotateRefDesInfo[];
  back: ReannotateRefDesInfo[];
  /** `m_refDesPrefixInfos` in creation order, with their final counters. */
  prefixes: ReannotatePrefixInfo[];
  /** `m_excludeArray`, the tokens actually parsed out of the exclude list. */
  excludes: string[];
  /** The duplicate reports, verbatim; empty when the plan is applicable. */
  errors: string[];
  /** `BuildFootprintList`'s return: false means leave the board alone. */
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const SORT_Y_FIRST = 0b100;
const DESCENDING_FIRST = 0b010;
const DESCENDING_SECOND = 0b001;

/**
 * `FrontDirectionsArray` / `BackDirectionsArray`. Index is the radio button, in
 * `m_sortButtons` order: Down-Right, Right-Down, Down-Left, Left-Down, Up-Right,
 * Right-Up, Up-Left, Left-Up.
 *
 * The back table is not the front table negated. Only the *second* axis flips
 * for the y-first entries (0–3) while the *first* axis flips for the x-first
 * entries (4–7), because in both cases it is the horizontal axis that mirrors
 * and the horizontal axis is the secondary one in the first half and the
 * primary one in the second.
 */
const FRONT_DIRECTIONS = [0b100, 0b101, 0b110, 0b111, 0b000, 0b001, 0b010, 0b011] as const;
const BACK_DIRECTIONS = [0b101, 0b100, 0b111, 0b110, 0b010, 0b011, 0b000, 0b001] as const;

/** The three flags `SetSortCodes` unpacks from a direction code. */
export interface ReannotateSortCodes {
  sortYFirst: boolean;
  descendingFirst: boolean;
  descendingSecond: boolean;
}

/**
 * `SetSortCodes( FrontDirectionsArray | BackDirectionsArray, sortCode )`.
 * A `sortCode` outside 0–7 is clamped to 0, matching the dialog's own
 * `if( sortCode >= m_sortButtons.size() ) sortCode = 0`.
 */
export function reannotateSortCodes(sortCode: number, front: boolean): ReannotateSortCodes {
  const table = front ? FRONT_DIRECTIONS : BACK_DIRECTIONS;
  const idx = sortCode >= 0 && sortCode < table.length ? sortCode : 0;
  const code = table[idx]!;
  return {
    sortYFirst: (code & SORT_Y_FIRST) !== 0,
    descendingFirst: (code & DESCENDING_FIRST) !== 0,
    descendingSecond: (code & DESCENDING_SECOND) !== 0,
  };
}

/**
 * `FootprintCompare`, as a comparator returning a number rather than a bool.
 *
 * Only the *rounded* coordinates are compared. Upstream sorts by swapping the
 * operands rather than by negating the result, which is the same thing here;
 * what it does not do is break ties any further, so two footprints that round
 * to the same cell keep whatever order `std::sort` leaves them in. This port
 * sorts stably instead, so that order is the board's file order — a real choice
 * rather than an arbitrary one, and the only deviation in this function.
 */
export function compareReannotateFootprints(
  a: ReannotateRefDesInfo,
  b: ReannotateRefDesInfo,
  codes: ReannotateSortCodes,
): number {
  let x0 = a.roundedX;
  let x1 = b.roundedX;
  let y0 = a.roundedY;
  let y1 = b.roundedY;

  if (codes.sortYFirst) {
    [x0, y0] = [y0, x0];
    [x1, y1] = [y1, x1];
  }

  if (codes.descendingFirst) [x0, x1] = [x1, x0];
  if (codes.descendingSecond) [y0, y1] = [y1, y0];

  if (x0 !== x1) return x0 < x1 ? -1 : 1;
  if (y0 !== y1) return y0 < y1 ? -1 : 1;
  return 0;
}

/**
 * `RoundToGrid`. Truncating division, then a nudge away from zero when the
 * remainder is more than half a grid step.
 *
 * The nudge asks whether the *truncated* coordinate is negative, not whether
 * the remainder is, so a coordinate whose whole magnitude is the remainder
 * (|coord| < grid) always rounds towards positive: −700 on a 1000 grid gives
 * +1000. That is upstream's arithmetic and changing it would put us out of step
 * with a board KiCad has sorted.
 *
 * The comparison is strict, so exactly half a step rounds towards zero, and the
 * half-step itself is an integer division — on an odd grid, 501 of 1001 does
 * not round up.
 */
export function roundToReannotateGrid(coord: number, grid: number): number {
  const g = grid === 0 ? REANNOTATE_MIN_GRID : grid;
  const c = Math.trunc(coord);
  const rounder = c % g;
  let out = c - rounder;

  if (Math.abs(rounder) > Math.trunc(g / 2)) out += out < 0 ? -g : g;

  return out;
}

// ---------------------------------------------------------------------------
// Reference designator helpers
// ---------------------------------------------------------------------------

/**
 * `UTIL::GetRefDesNumber`: the digits from the first one to the end of the
 * string, or −1 when there are none or when what follows the first digit is not
 * purely numeric. `R1A` is −1, not 1.
 */
export function getRefDesNumber(refDes: string): number {
  const first = refDes.search(/[0-9]/);
  if (first < 0) return -1;
  const tail = refDes.slice(first);
  return /^[0-9]+$/.test(tail) ? Number(tail) : -1;
}

/**
 * `FilterPrefix`: the prefix boxes drop a trailing character that is neither
 * alphanumeric nor one of `VALIDPREFIX`. Upstream runs this on every keystroke,
 * so only the last character can ever be wrong.
 */
export function filterReannotatePrefix(prefix: string): string {
  if (prefix.length === 0) return prefix;
  const last = prefix[prefix.length - 1]!;
  if (/[0-9A-Za-z]/.test(last)) return prefix;
  if (REANNOTATE_VALID_PREFIX_CHARS.includes(last)) return prefix;
  return prefix.slice(0, -1);
}

/** `wxStringTokenizer( …, ", \t\r\n", wxTOKEN_STRTOK )`: empty tokens dropped. */
function splitExcludeList(text: string): string[] {
  return text.split(/[, \t\r\n]+/).filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** Where the sorter reads a footprint's position from. */
function footprintSortPosition(
  fp: PcbFootprint,
  useFootprintLocation: boolean,
): { x: number; y: number } {
  if (useFootprintLocation) return { x: fp.at.x, y: fp.at.y };

  // `footprint->Reference().GetPosition()`. A footprint always has a Reference
  // field upstream; our model can carry one that was never written to file, in
  // which case the footprint anchor is the only position there is.
  const ref = fp.texts.find((t) => t.kind === 'reference');
  return ref ? { x: ref.at.x, y: ref.at.y } : { x: fp.at.x, y: fp.at.y };
}

/** Mutable twin of {@link ReannotatePrefixInfo} used while the plan is built. */
interface PrefixState {
  refDesPrefix: string;
  lastUsedRefDes: number;
  unavailableRefs: Set<number>;
}

/**
 * `GetOrBuildRefDesInfo`. A prefix met for the first time starts one below the
 * requested start number, floored at 0 — so a start of 0 and a start of 1 both
 * mean "the first footprint gets 1".
 */
function getOrBuildPrefixInfo(
  states: PrefixState[],
  refDesPrefix: string,
  startRefDes = 1,
): PrefixState {
  const found = states.find((s) => s.refDesPrefix === refDesPrefix);
  if (found) return found;

  const created: PrefixState = {
    refDesPrefix,
    lastUsedRefDes: Math.max(startRefDes - 1, 0),
    unavailableRefs: new Set<number>(),
  };
  states.push(created);
  return created;
}

/**
 * `BuildChangeArray`, one side of the board.
 *
 * `aStartRefDes != 0` resets *every* prefix counter seen so far, including ones
 * created for excluded footprints and ones the front pass has already used.
 * That is what makes a back start number restart the numbering, and what makes
 * a blank one continue it.
 */
function buildChangeArray(
  footprints: readonly ReannotateRefDesInfo[],
  startRefDes: number,
  prefix: string,
  removePrefix: boolean,
  states: PrefixState[],
  changes: ReannotateChange[],
  badRefDes: ReannotateRefDesInfo[],
): void {
  const prefixSize = prefix.length;
  const havePrefix = prefixSize !== 0;
  const addPrefix = havePrefix && !removePrefix;
  const doRemovePrefix = removePrefix && havePrefix;

  if (startRefDes !== 0) {
    for (const state of states) state.lastUsedRefDes = startRefDes - 1;
  }

  for (const source of footprints) {
    // Upstream iterates by value and edits the copy; the prefix rewrite below
    // must not leak back into `m_frontFootprints`.
    const fpData: ReannotateRefDesInfo = { ...source };

    const change: ReannotateChange = {
      index: fpData.index,
      uuid: fpData.uuid,
      newRefDes: fpData.refDesString,
      oldRefDesString: fpData.refDesString,
      front: fpData.front,
      action: fpData.action,
    };

    // Note this re-tags the *copy* only: `change.Action` was already taken, so
    // it decides the branch below and this line only affects the bad-refdes
    // report. A scope radio that overwrote `empty` with `update` therefore
    // still falls through to the numbering branch.
    if (fpData.refDesString.length === 0) fpData.action = 'empty';

    if (change.action === 'empty' || change.action === 'invalid') {
      changes.push(change);
      badRefDes.push(fpData);
      continue;
    }

    if (change.action === 'update') {
      // `find( aPrefix ) == 0`: an empty prefix is always "present".
      const prefixPresent = fpData.refDesPrefix.indexOf(prefix) === 0;

      if (addPrefix && !prefixPresent) fpData.refDesPrefix = prefix + fpData.refDesPrefix;
      if (doRemovePrefix && prefixPresent)
        fpData.refDesPrefix = fpData.refDesPrefix.slice(prefixSize);

      const state = getOrBuildPrefixInfo(states, fpData.refDesPrefix, startRefDes);
      let newNumber = state.lastUsedRefDes + 1;

      while (state.unavailableRefs.has(newNumber)) newNumber++;

      change.newRefDes = state.refDesPrefix + String(newNumber);
      state.lastUsedRefDes = newNumber;
    }

    changes.push(change);
  }
}

/**
 * `BuildFootprintList`: classify, sort, reserve, renumber, then look for
 * collisions. Nothing here touches the board.
 */
export function planBoardReannotate(
  board: Board,
  options: Partial<ReannotateOptions> = {},
): ReannotatePlan {
  const opts: ReannotateOptions = { ...DEFAULT_REANNOTATE_OPTIONS, ...options };

  const excludes = splitExcludeList(opts.excludeList);
  const front: ReannotateRefDesInfo[] = [];
  const back: ReannotateRefDesInfo[] = [];

  board.footprints.forEach((fp, index) => {
    const refDesString = fp.reference ?? '';
    const pos = footprintSortPosition(fp, opts.useFootprintLocation);

    // `find_first_of("0123456789")`; npos means "no digits", and `substr( 0,
    // npos )` is then the whole string, so a digitless reference is all prefix.
    const firstNum = refDesString.search(/[0-9]/);

    let action: ReannotateAction = 'update';

    if (refDesString.length === 0) action = 'empty';
    else if (firstNum < 0) action = 'invalid';

    const refDesPrefix = firstNum < 0 ? refDesString : refDesString.slice(0, firstNum);

    for (const excluded of excludes) {
      if (excluded.endsWith('*')) {
        // `fpData.RefDesString.Matches( excluded )`
        // (dialog_board_reannotate.cpp:506). wxString::Matches is the
        // case-SENSITIVE glob, unlike the WildCompareString( …, false ) the
        // filter dialogs use, so an exclusion of `R*` leaves `r5` alone.
        if (wildCompareString(excluded, refDesString, true)) {
          action = 'exclude';
          break;
        }
      } else if (excluded === refDesPrefix) {
        action = 'exclude';
        break;
      }
    }

    const isFront = fp.layer === 'F.Cu';

    // The scope chain overwrites whatever the exclusion list and the
    // empty/invalid tests decided. Only "All" leaves them standing.
    if ((fp.locked ?? false) && opts.excludeLocked) action = 'exclude';
    else if (opts.scope === 'selection')
      action = fp.uuid !== undefined && opts.selected.has(fp.uuid) ? 'update' : 'exclude';
    else if (opts.scope === 'front') action = isFront ? 'update' : 'exclude';
    else if (opts.scope === 'back') action = isFront ? 'exclude' : 'update';

    const info: ReannotateRefDesInfo = {
      index,
      uuid: fp.uuid,
      front: isFront,
      refDesString,
      refDesPrefix,
      x: pos.x,
      y: pos.y,
      roundedX: roundToReannotateGrid(pos.x, opts.sortGridX),
      roundedY: roundToReannotateGrid(pos.y, opts.sortGridY),
      action,
      fpid: fp.lib,
    };

    if (isFront) front.push(info);
    else back.push(info);
  });

  const frontCodes = reannotateSortCodes(opts.sortCode, true);
  const backCodes = reannotateSortCodes(opts.sortCode, false);
  front.sort((a, b) => compareReannotateFootprints(a, b, frontCodes));
  back.sort((a, b) => compareReannotateFootprints(a, b, backCodes));

  // `BuildUnavailableRefsList`: front first, then back, registered under each
  // footprint's own prefix — before any front/back prefix is applied.
  const states: PrefixState[] = [];

  for (const info of [...front, ...back]) {
    if (info.action !== 'exclude') continue;
    const state = getOrBuildPrefixInfo(states, info.refDesPrefix);
    // `std::set<unsigned int>`: the −1 that a digitless reference yields
    // arrives as 4294967295, which no counter will ever reach.
    state.unavailableRefs.add(getRefDesNumber(info.refDesString) >>> 0);
  }

  const changes: ReannotateChange[] = [];
  const badRefDes: ReannotateRefDesInfo[] = [];

  if (front.length > 0) {
    buildChangeArray(
      front,
      opts.frontStart,
      opts.frontPrefix,
      opts.removeFrontPrefix,
      states,
      changes,
      badRefDes,
    );
  }

  if (back.length > 0) {
    buildChangeArray(
      back,
      opts.backStart,
      opts.backPrefix,
      opts.removeBackPrefix,
      states,
      changes,
      badRefDes,
    );
  }

  // `ChangeArrayCompare`. Case-sensitive: upstream calls StrNumCmp with its
  // default `aIgnoreCase = false` here, unlike the duplicates tool next door.
  changes.sort((a, b) => strNumCmp(a.oldRefDesString, b.oldRefDesString));

  const errors: string[] = [];
  let errorCount = 0;

  for (let i = 0; i < changes.length; i++) {
    if (changes[i]!.action !== 'empty' && changes[i]!.action !== 'invalid') {
      for (let j = i + 1; j < changes.length; j++) {
        if (changes[i]!.newRefDes === changes[j]!.newRefDes) {
          errors.push(`Duplicate instances of ${changes[j]!.newRefDes}`);

          if (errorCount++ > REANNOTATE_MAX_ERROR) {
            errors.push('Aborted: too many errors');
            break;
          }
        }
      }
    }

    if (errorCount > REANNOTATE_MAX_ERROR) break;
  }

  return {
    changes,
    badRefDes,
    front,
    back,
    prefixes: states.map((s) => ({
      refDesPrefix: s.refDesPrefix,
      lastUsedRefDes: s.lastUsedRefDes,
      unavailableRefs: new Set(s.unavailableRefs),
    })),
    excludes,
    errors,
    ok: errorCount === 0,
  };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/*
 * `FOOTPRINT::SetReference` is `setFootprintReference` in `edit-footprint.ts`,
 * imported above. This file used to carry its own copy, which patched the model
 * and the source but did NOT re-resolve a `${REFERENCE}` text — so reannotating
 * renamed the silkscreen and left the F.Fab designator on the old number.
 */

/**
 * `ReannotateBoard`'s apply loop. Every footprint is visited, but the plan gives
 * a non-update one its old designator back, so only the renumbered ones move.
 *
 * This reads nothing from the board, which is the whole point: the plan was
 * computed against the original designators and applying it cannot see the
 * half-renamed intermediate state.
 */
export function applyBoardReannotate(board: Board, plan: ReannotatePlan): Board {
  const byIndex = new Map<number, ReannotateChange>();
  for (const change of plan.changes) byIndex.set(change.index, change);

  return {
    ...board,
    footprints: board.footprints.map((fp, index) => {
      const change = byIndex.get(index);
      if (change === undefined || change.newRefDes === (fp.reference ?? '')) return fp;
      return setFootprintReference(fp, change.newRefDes);
    }),
  };
}

/**
 * Plan and, if the plan is applicable, apply. `board` comes back untouched when
 * `plan.ok` is false, exactly as upstream refuses to reach its `BOARD_COMMIT`.
 *
 * A non-empty `plan.badRefDes` is *not* a refusal: upstream asks the user
 * "Reannotate anyway?" and carries on if they agree. That prompt is the
 * caller's to raise.
 */
export function reannotateBoard(
  board: Board,
  options: Partial<ReannotateOptions> = {},
): { board: Board; plan: ReannotatePlan } {
  const plan = planBoardReannotate(board, options);
  return { board: plan.ok ? applyBoardReannotate(board, plan) : board, plan };
}

// ---------------------------------------------------------------------------
// BOARD_REANNOTATE_TOOL::ReannotateDuplicates
// ---------------------------------------------------------------------------

/**
 * `BOARD_REANNOTATE_TOOL::ReannotateDuplicates`: a different algorithm with a
 * different purpose — nothing moves to a new position in the numbering, each
 * selected footprint just walks its own number upwards until it is unique. It
 * is what runs after a paste, so that pasting a copy of R1 gives R2 rather than
 * a second R1.
 *
 * Two upstream properties worth stating because they surprise:
 *
 *   - the designator a footprint *vacates* is never freed. The map is only ever
 *     inserted into, so renaming R1 → R3 leaves R1 still marked as taken and a
 *     later footprint will not reuse it.
 *   - a footprint whose reference is already unique is left alone even if the
 *     rest of the selection is being renumbered — `duplicate` stays false and
 *     the loop breaks on the first pass.
 *
 * `additionalUuids` and `additionalRefs` stand in for `aAdditionalFootprints`,
 * the not-yet-placed footprints of a paste: designators they hold are taken,
 * but they are not themselves renumbered.
 */
export function reannotateDuplicates(
  board: Board,
  selectedUuids: ReadonlySet<string>,
  additional: readonly { uuid: string; reference: string }[] = [],
): Board {
  if (selectedUuids.size === 0) return board;

  // A multimap reference -> uuid over the board plus the additional footprints.
  const usedDesignators = new Map<string, string[]>();
  const addUsed = (reference: string, uuid: string): void => {
    const list = usedDesignators.get(reference);
    if (list) list.push(uuid);
    else usedDesignators.set(reference, [uuid]);
  };

  board.footprints.forEach((fp, index) => {
    addUsed(fp.reference ?? '', fp.uuid ?? `#${index}`);
  });
  for (const extra of additional) addUsed(extra.reference, extra.uuid);

  const selection = board.footprints
    .map((fp, index) => ({ fp, index, uuid: fp.uuid ?? `#${index}` }))
    .filter((e) => e.fp.uuid !== undefined && selectedUuids.has(e.fp.uuid));

  // The selection sort: natural order on the reference (case-insensitively
  // here, unlike the dialog), then position — y *descending*, x ascending —
  // then the UUID so the result never depends on collection order.
  selection.sort((a, b) => {
    const ii = strNumCmp(a.fp.reference ?? '', b.fp.reference ?? '', true);
    if (ii !== 0) return ii;
    if (a.fp.at.y !== b.fp.at.y) return a.fp.at.y > b.fp.at.y ? -1 : 1;
    if (a.fp.at.x !== b.fp.at.x) return a.fp.at.x < b.fp.at.x ? -1 : 1;
    return a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0;
  });

  const renamed = new Map<number, string>();

  for (const entry of selection) {
    let reference = entry.fp.reference ?? '';
    const stem = getRefDesPrefix(reference);
    let value = getRefDesNumber(reference);
    let duplicate = false;

    for (;;) {
      const holders = usedDesignators.get(reference);
      if (holders === undefined) break;

      // `duplicate` is deliberately never reset: once this footprint is known
      // to clash it keeps climbing until the name is free of *everyone*.
      //
      // Mutation testing says a plain assignment here is indistinguishable, and
      // that is not an accident: a climbed-to name can only be occupied by
      // *other* footprints, because the only entries this one has in the map
      // are its original designator and the one inserted after the loop ends.
      // The sticky flag is kept because it is what upstream writes and because
      // a caller who lists a board footprint in `additional` under a second
      // name would make the difference observable.
      if (holders.some((uuid) => uuid !== entry.uuid)) duplicate = true;

      if (!duplicate) break;

      value = value < 0 ? 1 : value + 1;
      reference = stem + String(value);
    }

    if (duplicate) {
      addUsed(reference, entry.uuid);
      renamed.set(entry.index, reference);
    }
  }

  if (renamed.size === 0) return board;

  return {
    ...board,
    footprints: board.footprints.map((fp, index) => {
      const reference = renamed.get(index);
      return reference === undefined ? fp : setFootprintReference(fp, reference);
    }),
  };
}
