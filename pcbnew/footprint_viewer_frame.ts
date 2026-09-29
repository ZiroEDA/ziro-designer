// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_VIEWER_FRAME` (`pcbnew/footprint_viewer_frame.cpp`/`.h`), the
 * Footprint Library Browser — its KIWAY half and every decision the frame
 * makes that is not drawing: which rows the two lists hold under a filter,
 * which row is selected after a rebuild, where Previous / Next land, the
 * title, the list widths `LoadSettings` restores, and `AddFootprintToPCB`.
 *
 * `footprint_viewer_frame_ui.tsx` is the window; it owns the lists, the
 * canvas and the toolbars those decisions drive, the way
 * `footprint_edit_frame_ui.tsx` owns `FOOTPRINT_EDIT_FRAME`'s.
 */
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { RSTRING_T } from '@ziroeda/common/project.js';
import { EdaCombinedMatcher } from '@ziroeda/common/eda_pattern_match.js';
import { PINNING_SYMBOL } from '@ziroeda/common/lib_tree_model_adapter.js';
import type { FOOTPRINT_INFO } from '@ziroeda/common/footprint_info.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import { listBoxFindString, wxNOT_FOUND } from '@ziroeda/common/widgets/wx_listbox.js';
import type { PcbFootprint } from './types.js';

/** `enum class FPVIEWER_CONSTANTS` (`footprint_viewer_frame.h:41-47`). */
export enum FPVIEWER_CONSTANTS {
  NEW_PART = 0,
  NEXT_PART = 1,
  PREVIOUS_PART = 2,
  RELOAD_PART = 3,
}

/** `_( "Footprint Library Browser" )`, the constructor's title and the title's tail. */
export const FOOTPRINT_VIEWER_TITLE = 'Footprint Library Browser';

/** `_( "[no library selected]" )` (`UpdateTitle`). */
export const FPVIEWER_NO_LIBRARY = '[no library selected]';

/** `_( "No board currently open." )` (`AddFootprintToPCB`). */
export const FPVIEWER_NO_BOARD = 'No board currently open.';

/** `_( "Previous footprint placement still in progress." )` (`AddFootprintToPCB`). */
export const FPVIEWER_PLACEMENT_IN_PROGRESS = 'Previous footprint placement still in progress.';

/**
 * `m_fpFilter->SetToolTip( … )` (`footprint_viewer_frame.cpp:154-157`), the
 * two spaces after "spaces." included.
 */
export const FPVIEWER_FP_FILTER_TOOLTIP =
  'Filter on footprint name, keywords, description and pad count.\n' +
  'Search terms are separated by spaces.  All search terms must match.\n' +
  'A term which is a number will also match against the pad count.';

/** `m_libListWidth = 200; m_fpListWidth = 300;` and the panes' `BestSize`. */
export const FPVIEWER_LIB_LIST_BEST_WIDTH = 200;
export const FPVIEWER_FP_LIST_BEST_WIDTH = 300;
/** `.MinSize( 100, -1 )` on both palettes. */
export const FPVIEWER_LIST_MIN_WIDTH = 100;

/** `wxStringTokenizer( filter, " \t\r\n", wxTOKEN_STRTOK )`: empty tokens dropped. */
export function filterTokens(aFilter: string): string[] {
  return aFilter.split(/[ \t\r\n]+/).filter((t) => t !== '');
}

/**
 * `wxString::IsNumber()`: an optional sign, then nothing but ASCII digits.
 * wx's loop accepts a bare sign too (the digit loop simply runs zero times),
 * so `"-"` is a "number" whose `wxAtoi` is 0 — ported as upstream has it.
 */
export function wxIsNumber(aText: string): boolean {
  return aText !== '' && /^[+-]?[0-9]*$/.test(aText);
}

/** `wxAtoi`: the leading integer, 0 when there is none. */
function wxAtoi(aText: string): number {
  const n = Number.parseInt(aText, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * `ReCreateLibraryList()`'s rows (`footprint_viewer_frame.cpp:404-455`).
 *
 * An empty filter lists every nickname. Otherwise the filter is split into
 * terms and EACH term is swept over every nickname: a library matched by any
 * term is listed — and a library two terms both match is `process()`ed twice
 * and appended twice. There is no de-duplication upstream; that is ported.
 *
 * Pinned libraries (the project's `m_PinnedFootprintLibs` or the user's
 * `session.pinned_fp_libs`) come first, each wearing `GetPinningSymbol()`.
 */
export function libraryListRows(
  aNicknames: readonly string[],
  aFilter: string,
  aIsPinned: (aNickname: string) => boolean,
): string[] {
  const pinnedMatches: string[] = [];
  const otherMatches: string[] = [];

  const process = (aNickname: string): void => {
    if (aIsPinned(aNickname)) pinnedMatches.push(aNickname);
    else otherMatches.push(aNickname);
  };

  if (aFilter === '') {
    for (const nickname of aNicknames) process(nickname);
  } else {
    for (const token of filterTokens(aFilter)) {
      const term = token.toLowerCase();
      const matcher = new EdaCombinedMatcher(term);

      for (const nickname of aNicknames) {
        if (matcher.find(nickname.toLowerCase()) >= 0) process(nickname);
      }
    }
  }

  return [...pinnedMatches.map((n) => PINNING_SYMBOL + n), ...otherMatches];
}

/**
 * `ReCreateFootprintList()`'s rows (`footprint_viewer_frame.cpp:458-515`).
 *
 * Unlike the library list, every term must match: a footprint that scores
 * nothing against any one term is excluded. A term that `IsNumber()` also
 * matches when it equals the pad count. The survivors keep the library's
 * order.
 *
 * Upstream scores the loaded `FOOTPRINT`s; this scores the library index's
 * `FOOTPRINT_INFO`s, whose `GetSearchTerms()` is the same list term for term
 * (`common/footprint_info.cpp:67-86` against `pcbnew/footprint.cpp:1707-1725`).
 * The one difference is the pad count: `GetPadCount( DO_NOT_INCLUDE_NPTH )`
 * counts every plated pad, and the hosted index carries the UNIQUE numbered
 * pad count only (`footprint_info_impl.ts`), so a footprint with two pads
 * sharing a number answers one less.
 */
export function footprintListRows(
  aFootprints: readonly FOOTPRINT_INFO[],
  aFilter: string,
): string[] {
  const excludes = new Set<string>();

  for (const token of filterTokens(aFilter)) {
    const filterTerm = token.toLowerCase();
    const matcher = new EdaCombinedMatcher(filterTerm);

    for (const footprint of aFootprints) {
      let matched = matcher.scoreTerms(footprint.GetSearchTerms()).score;

      if (wxIsNumber(filterTerm) && wxAtoi(filterTerm) === footprint.GetPadCount()) matched++;

      if (!matched) excludes.add(footprint.GetFootprintName());
    }
  }

  const rows: string[] = [];

  for (const footprint of aFootprints) {
    const fpName = footprint.GetFootprintName();

    if (!excludes.has(fpName)) rows.push(fpName);
  }

  return rows;
}

/**
 * The tail of `ReCreateLibraryList` / `ReCreateFootprintList`: the row the
 * rebuilt list selects. The current name if the list still holds it
 * (`FindString( name, true )`, case-sensitive), else the first row, else none.
 * Either way a selected row is then "clicked".
 */
export function listSelectionAfterRebuild(aRows: readonly string[], aCurrent: string): number {
  const index = aCurrent === '' ? wxNOT_FOUND : listBoxFindString(aRows, aCurrent, true);

  if (index !== wxNOT_FOUND) return index;

  return aRows.length > 0 ? 0 : wxNOT_FOUND;
}

/** `selectPrev( aListBox )`: one up, or nothing at the top (and nothing with no selection). */
export function selectPrevIndex(aSelection: number): number | null {
  const prev = aSelection - 1;

  return prev >= 0 ? prev : null;
}

/** `selectNext( aListBox )`: one down, or nothing past the end. */
export function selectNextIndex(aSelection: number, aCount: number): number | null {
  const next = aSelection + 1;

  return next < aCount ? next : null;
}

/**
 * `SelectAndViewFootprint( aMode )`'s index arithmetic
 * (`footprint_viewer_frame.cpp:1025-1040`): find the current footprint
 * (case-sensitively), then step once for NEXT / PREVIOUS, stopping at either
 * end. {@link wxNOT_FOUND} when the current name is not in the list, and the
 * frame then shows nothing new.
 */
export function stepFootprintSelection(
  aRows: readonly string[],
  aCurrent: string,
  aMode: FPVIEWER_CONSTANTS,
): number {
  let selection = listBoxFindString(aRows, aCurrent, true);

  if (aMode === FPVIEWER_CONSTANTS.NEXT_PART) {
    if (selection !== wxNOT_FOUND && selection < aRows.length - 1) selection++;
  }

  if (aMode === FPVIEWER_CONSTANTS.PREVIOUS_PART) {
    if (selection !== wxNOT_FOUND && selection > 0) selection--;
  }

  return selection;
}

/**
 * `UpdateTitle()` (`footprint_viewer_frame.cpp:995-1016`):
 * `"<nickname> — <full URI> — Footprint Library Browser"`, or
 * `"[no library selected] — …"` when there is no library or its URI cannot be
 * resolved. The dashes are U+2014 with a space either side.
 */
export function footprintViewerTitle(aNickname: string, aFullUri: string | null): string {
  let title: string;

  if (aNickname !== '' && aFullUri !== null) title = `${aNickname} — ${aFullUri}`;
  else title = FPVIEWER_NO_LIBRARY;

  return `${title} — ${FOOTPRINT_VIEWER_TITLE}`;
}

/**
 * `LoadSettings`' "set parameters to a reasonable value" (`:808-815`):
 *
 *     int maxWidth = cfg->m_FootprintViewer.state.size_x - 80;
 *     if( m_libListWidth + m_fpListWidth > maxWidth )
 *     {
 *         m_libListWidth = maxWidth * ( m_libListWidth / ( m_libListWidth + m_fpListWidth ) );
 *         m_fpListWidth = maxWidth - m_libListWidth;
 *     }
 *
 * All four are `int`, so `m_libListWidth / (sum)` is INTEGER division and is
 * 0 whenever the sum is larger — which is always, once there are two positive
 * widths. The clamp therefore zeroes the library list and hands the fp list
 * all of `maxWidth`. Ported with the truncation, because it decides what the
 * constructor does next: a width that is not `> 0` is not applied, and that
 * pane keeps its `BestSize`.
 */
export function clampFootprintViewerListWidths(
  aLibListWidth: number,
  aFpListWidth: number,
  aWindowWidth: number,
): { lib: number; fp: number } {
  const maxWidth = Math.trunc(aWindowWidth) - 80;
  let lib = Math.trunc(aLibListWidth);
  let fp = Math.trunc(aFpListWidth);

  if (lib + fp > maxWidth) {
    lib = maxWidth * Math.trunc(lib / (lib + fp));
    fp = maxWidth - lib;
  }

  return { lib, fp };
}

/** The width a pane opens at: the restored one when `> 0`, else its `BestSize`. */
export function paneWidthOrBest(aWidth: number, aBest: number): number {
  return aWidth > 0 ? aWidth : aBest;
}

/**
 * What `AddFootprintToPCB` asks of `FRAME_PCB_EDITOR`'s player — the two
 * members of `PCB_EDIT_FRAME` / `BOARD_EDITOR_CONTROL` it reaches for.
 */
export interface FOOTPRINT_VIEWER_PCB_TARGET {
  /** `toolMgr->GetTool<BOARD_EDITOR_CONTROL>()->PlacingFootprint()`. */
  PlacingFootprint(): boolean;
  /**
   * The rest of `AddFootprintToPCB` on the board side: `selectionClear`, a
   * `Duplicate()` of the viewed footprint with its orphaned pad nets cleared,
   * put on the front, and `PostAction( PCB_ACTIONS::placeFootprint,
   * newFootprint )` — the footprint rides the cursor and the next click drops
   * it.
   */
  PlaceFootprintFromLibraryBrowser(aFpid: string, aFootprint: PcbFootprint): void;
}

function isPcbTarget(aFrame: unknown): aFrame is FOOTPRINT_VIEWER_PCB_TARGET {
  const f = aFrame as Partial<FOOTPRINT_VIEWER_PCB_TARGET> | null;

  return (
    !!f &&
    typeof f.PlacingFootprint === 'function' &&
    typeof f.PlaceFootprintFromLibraryBrowser === 'function'
  );
}

/** What the frame reaches through its window. */
export interface FOOTPRINT_VIEWER_FRAME_HOOKS {
  /** `ReCreateLibraryList()`, which `MAIL_RELOAD_LIB` runs. */
  reCreateLibraryList(): void;
  /** `GetBoard()->GetFirstFootprint()`: the footprint on show, and its LIB_ID. */
  getFirstFootprint(): { fpid: string; footprint: PcbFootprint } | null;
}

export class FOOTPRINT_VIEWER_FRAME extends KIWAY_PLAYER {
  private readonly hooks: FOOTPRINT_VIEWER_FRAME_HOOKS;

  /**
   * Where `getCurNickname` / `getCurFootprintName` keep their answer when no
   * project is open. Upstream they are the project's retained strings
   * (`PCB_FOOTPRINT_VIEWER_LIB_NICKNAME`, `…_FP_NAME`); with no PROJECT there
   * is nowhere else to put them.
   */
  private m_curNickname = '';
  private m_curFootprintName = '';

  constructor(hooks: FOOTPRINT_VIEWER_FRAME_HOOKS) {
    super(FRAME_T.FRAME_FOOTPRINT_VIEWER, pcbIUScale, 'mm');
    this.hooks = hooks;
    // `m_aboutTitle = _HKI( "KiCad Footprint Library Browser" )`, the product
    // being ours.
    this.m_aboutTitle = ABOUT_TITLES.footprintViewer;
  }

  /** `Prj().GetRString( … )`, or the frame's own copy when there is no project. */
  private rstring(aId: RSTRING_T, aFallback: string): string {
    try {
      return this.Prj().GetRString(aId);
    } catch {
      return aFallback;
    }
  }

  private setRstring(aId: RSTRING_T, aValue: string): void {
    try {
      this.Prj().SetRString(aId, aValue);
    } catch {
      // No PROJECT: the member below is the only copy.
    }
  }

  /** `getCurNickname()`: `PROJECT::PCB_FOOTPRINT_VIEWER_LIB_NICKNAME`. */
  getCurNickname(): string {
    return this.rstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_LIB_NICKNAME, this.m_curNickname);
  }

  setCurNickname(aNickname: string): void {
    this.m_curNickname = aNickname;
    this.setRstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_LIB_NICKNAME, aNickname);
  }

  /** `getCurFootprintName()`: `PROJECT::PCB_FOOTPRINT_VIEWER_FP_NAME`. */
  getCurFootprintName(): string {
    return this.rstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_FP_NAME, this.m_curFootprintName);
  }

  setCurFootprintName(aName: string): void {
    this.m_curFootprintName = aName;
    this.setRstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_FP_NAME, aName);
  }

  /** `FOOTPRINT_VIEWER_FRAME::KiwayMailIn` (`footprint_viewer_frame.cpp:973-984`). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    switch (mail.Command()) {
      case MAIL_T.MAIL_RELOAD_LIB:
        this.hooks.reCreateLibraryList();
        break;

      default:
        break;
    }
  }

  /**
   * `AddFootprintToPCB()` (`footprint_viewer_frame.cpp:707-783`): "export the
   * current footprint name and close the library browser" — in fact, hand a
   * copy of the footprint on show to the board editor to place, and raise it.
   *
   * Nothing happens with no footprint on the board. With no board editor alive
   * it is `DisplayErrorMessage( "No board currently open." )`; with a
   * placement already riding the cursor there, `DisplayError( "Previous
   * footprint placement still in progress." )`. KiCad's `DisplayError` is the
   * same modal box with a different caption; there is one error box here.
   *
   * Returns whether the footprint was handed over.
   */
  AddFootprintToPCB(): boolean {
    const shown = this.hooks.getFirstFootprint();

    if (!shown) return false;

    const kiway = this.Kiway();
    const pcbframe = kiway?.GetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR) ?? null;

    // happens when the board editor is not active (or closed)
    if (!isPcbTarget(pcbframe)) {
      DisplayErrorMessage(FPVIEWER_NO_BOARD);
      return false;
    }

    if (pcbframe.PlacingFootprint()) {
      DisplayErrorMessage(FPVIEWER_PLACEMENT_IN_PROGRESS);
      return false;
    }

    pcbframe.PlaceFootprintFromLibraryBrowser(shown.fpid, shown.footprint);

    // `pcbframe->Raise()`.
    kiway?.Player(FRAME_T.FRAME_PCB_EDITOR);

    return true;
  }
}
