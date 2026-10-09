// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/load_select_footprint.cpp`: the footprint-loading half of
 * `PCB_BASE_FRAME` (`SelectFootprintFromLibrary`, `LoadFootprint`,
 * `loadFootprint`, `PlaceFootprint`) and `FOOTPRINT_EDIT_FRAME`'s
 * `SelectFootprintFromBoard`. KiCad spreads a class's methods over several
 * `.cpp` files; this mixes them back in with `applyMixins`, the pattern
 * `files.ts` and `undo_redo.ts` use.
 *
 * `AddFootprintToHistory` (the file-static list at the head of the C++) is
 * `widgets/footprint_history.ts`.
 *
 * Differences from the desktop, each forced by the browser:
 * - `Kiway().Player( FRAME_FOOTPRINT_CHOOSER )->ShowModal()` and
 *   `EDA_LIST_DIALOG::ShowModal()` are React dialogs, so the frame asks the
 *   window through a hook that answers with a promise, and the methods that
 *   wait for a dialog are `async`.
 * - `FOOTPRINT_LIBRARY_ADAPTER::LoadFootprintWithOptionalNickname` reads a
 *   `.pretty` off a disk; the hosted libraries are fetched, so the window's
 *   `loadFootprintFromLibrary` hook is that call. Without one the board's
 *   `FOOTPRINT_LIBRARY_ADAPTER` answers, for a qualified `LIB_ID` only (the
 *   adapter does not enumerate its libraries).
 * - `LoadFootprintFromBoard` and `SaveLibraryAs` (the other two
 *   `FOOTPRINT_EDIT_FRAME` methods in the C++ file) need the footprint editor
 *   on a live BOARD (`Clear_Pcb`, `AddFootprintToBoard`, the library plugin's
 *   `FootprintEnumerate`), which `footprint_edit_frame.ts` does not have yet.
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from './board.js';
import type { FOOTPRINT } from './footprint.js';
import type { FOOTPRINT_EDIT_FRAME } from './footprint_edit_frame.js';
import type { PCB_BASE_FRAME } from './pcb_base_frame.js';

/** `static wxString lastComponentName`, in `SelectFootprintFromLibrary`. */
let s_lastComponentName = '';

/** `static wxString oldName`, in `SelectFootprintFromBoard`: "Save name of last footprint selected." */
let s_oldName = '';

/** For tests: the two statics above. */
export function LoadSelectFootprintStatics(): { lastComponentName: string; oldName: string } {
  return { lastComponentName: s_lastComponentName, oldName: s_oldName };
}

/** `static FOOTPRINT* s_FootprintInitialCopy`: "Copy of footprint for abort/undo command". */
let s_FootprintInitialCopy: FOOTPRINT | null = null;

/** `static PICKED_ITEMS_LIST s_PickedList`: "A pick-list to save initial footprint and dragged tracks". */
const s_PickedList = new PICKED_ITEMS_LIST();

/** `PCB_BASE_FRAME`'s `load_select_footprint.cpp` half, mixed into `PCB_BASE_FRAME`. */
export class LOAD_SELECT_FOOTPRINT_MIXIN {
  /**
   * `PCB_BASE_FRAME::SelectFootprintFromLibrary` (:191-225): the footprint
   * chooser, then the chosen footprint loaded; a successful load goes on the
   * chooser's "recently used" history.
   *
   * @return the loaded footprint, or null when the chooser was cancelled or the
   *         footprint could not be loaded.
   */
  async SelectFootprintFromLibrary(
    this: PCB_BASE_FRAME,
    aPreselect: LIB_ID = new LIB_ID(),
  ): Promise<FOOTPRINT | null> {
    let footprintName = aPreselect.Format();
    const fpid = new LIB_ID();
    let footprint: FOOTPRINT | null = null;

    const chosen = (await this.selectFootprintFromChooser(footprintName)) ?? null;

    if (chosen !== null) {
      footprintName = chosen;
      fpid.Parse(chosen);
    }

    if (!fpid.IsValid()) return null;

    try {
      footprint = await this.loadFootprint(fpid);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
    }

    if (footprint) {
      s_lastComponentName = footprintName;
      addFootprintToHistory(footprintName);
    }

    return footprint;
  }

  /** `PCB_BASE_FRAME::LoadFootprint` (:228-241): `loadFootprint`, an IO_ERROR being "not found". */
  async LoadFootprint(this: PCB_BASE_FRAME, aFootprintId: LIB_ID): Promise<FOOTPRINT | null> {
    let footprint: FOOTPRINT | null = null;

    try {
      footprint = await this.loadFootprint(aFootprintId);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
    }

    return footprint;
  }

  /**
   * `PCB_BASE_FRAME::loadFootprint` (:244-278): the footprint out of the
   * library, its nets cleared, and — for a real board, not a footprint holder —
   * given the board's default text, graphics, dimension and barcode styles.
   */
  async loadFootprint(this: PCB_BASE_FRAME, aFootprintId: LIB_ID): Promise<FOOTPRINT | null> {
    // When loading a footprint from a library in the footprint editor
    // the items UUIDs must be keep and not reinitialized
    const keepUUID = this.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR);
    let footprint: FOOTPRINT | null = null;

    try {
      footprint = await this.loadFootprintWithOptionalNickname(aFootprintId, keepUUID);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
    }

    if (footprint) {
      // If the footprint is found, clear all net info to be sure there are no broken links to
      // any netinfo list (should be not needed, but it can be edited from the footprint editor )
      footprint.ClearAllNets();

      const pcb = this.GetBoard();

      if (pcb && !pcb.IsFootprintHolder()) {
        const bds = pcb.GetDesignSettings();

        footprint.ApplyDefaultSettings(
          pcb,
          bds.m_StyleFPFields,
          bds.m_StyleFPText,
          bds.m_StyleFPShapes,
          bds.m_StyleFPDimensions,
          bds.m_StyleFPBarcodes,
        );
      }
    }

    return footprint;
  }

  /**
   * `FOOTPRINT_LIBRARY_ADAPTER::LoadFootprintWithOptionalNickname`
   * (footprint_library_adapter.cpp:366-383), as the frame reaches it through
   * `PROJECT_PCB::FootprintLibAdapter( &Prj() )`: the window's hook, else the
   * board's adapter for a qualified `LIB_ID`.
   */
  async loadFootprintWithOptionalNickname(
    this: PCB_BASE_FRAME,
    aFootprintId: LIB_ID,
    aKeepUUID: boolean,
  ): Promise<FOOTPRINT | null> {
    const fromWindow = this.loadFootprintFromLibraryWindow(aFootprintId, aKeepUUID);

    if (fromWindow) return await fromWindow;

    const adapter = this.GetBoard()?.GetFootprintLibAdapter();
    const nickname = aFootprintId.GetUniStringLibNickname();

    if (!adapter || nickname === '') return null;

    return adapter.LoadFootprint(nickname, aFootprintId.GetUniStringLibItemName(), aKeepUUID);
  }

  /**
   * `PCB_BASE_FRAME::PlaceFootprint` (:400-446): commit a footprint the user
   * has finished placing — its undo entry (a new one, or the move's
   * initial-copy pair), its position (the cursor's, or `aPosition`), its flags
   * cleared, and the connectivity and ratsnest brought up to date.
   */
  PlaceFootprint(
    this: PCB_BASE_FRAME,
    aFootprint: FOOTPRINT | null,
    aRecreateRatsnest = true,
    aPosition?: VECTOR2I,
  ): void {
    if (aFootprint === null) return;

    this.OnModify();

    if (aFootprint.IsNew()) {
      this.SaveCopyInUndoList(aFootprint, UNDO_REDO.NEWITEM);
    } else if (aFootprint.IsMoving()) {
      const picker = new ITEM_PICKER(null, aFootprint, UNDO_REDO.CHANGED);
      picker.SetLink(s_FootprintInitialCopy);
      s_PickedList.PushItem(picker);
      s_FootprintInitialCopy = null; // the picker is now owner of s_ModuleInitialCopy.
    }

    if (s_PickedList.GetCount()) {
      this.SaveCopyInUndoList(s_PickedList, UNDO_REDO.UNSPECIFIED);

      // Clear list, but DO NOT delete items, because they are owned by the saved undo
      // list and they therefore in use
      s_PickedList.ClearItemsList();
    }

    if (aPosition) aFootprint.SetPosition(aPosition);
    else aFootprint.SetPosition(this.GetCanvas()!.GetViewControls().GetCursorPosition());

    aFootprint.ClearFlags();

    s_FootprintInitialCopy = null;

    if (aRecreateRatsnest) this.GetBoard()!.GetConnectivity().Update(aFootprint);

    if (aRecreateRatsnest) this.Compile_Ratsnest(true);

    this.SetMsgPanel(aFootprint);
  }
}

/** `FOOTPRINT_EDIT_FRAME`'s `load_select_footprint.cpp` half, mixed into that class. */
export class FOOTPRINT_EDIT_FRAME_LOAD_SELECT_MIXIN {
  /**
   * `FOOTPRINT_EDIT_FRAME::SelectFootprintFromBoard` (:281-325): pick one of
   * the board's footprints by reference designator from a one-column list
   * dialog ("Footprints [%u items]").
   */
  async SelectFootprintFromBoard(
    this: FOOTPRINT_EDIT_FRAME,
    aPcb: BOARD,
  ): Promise<FOOTPRINT | null> {
    const listnames: string[] = [];

    for (const footprint of aPcb.Footprints()) listnames.push(footprint.GetReference());

    const msg = `Footprints [${listnames.length} items]`;
    const headers = ['Footprint'];

    // Conversion from wxArrayString to vector of ArrayString
    const itemsToDisplay = listnames.map((name) => [name]);

    // EDA_LIST_DIALOG dlg( this, msg, headers, itemsToDisplay, wxEmptyString );
    const fpname = (await this.hooks.selectFromList?.(msg, headers, itemsToDisplay)) ?? null;

    if (fpname === null) return null;

    s_oldName = fpname;

    for (const fp of aPcb.Footprints()) {
      if (fpname === fp.GetReference()) return fp;
    }

    return null;
  }
}

// ============================================================================
// Folded in from footprint_history.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `s_FootprintHistoryList` (pcbnew/load_select_footprint.cpp:55-73): the
 * "-- Recently Used --" group at the top of every Footprint Chooser.
 *
 * A file-static in upstream, so it is one list per process and it does not
 * survive a restart — a module-level array is the same thing here. Only
 * `PCB_BASE_FRAME::SelectFootprintFromLibrary` (:221) ADDS to it, i.e. the
 * Place Footprints tool; every chooser, whichever field opened it, SHOWS it.
 */

/** `s_FootprintHistoryMaxCount = 8` (:56). */
const MAX = 8;

const history: string[] = [];

/** `AddFootprintToHistory( aName )` (:58-73): dedupe, insert at the front, trim. */
export function addFootprintToHistory(libId: string): void {
  for (let i = history.length - 1; i >= 0; i--) if (history[i] === libId) history.splice(i, 1);
  history.unshift(libId);
  // `while( GetCount() >= s_FootprintHistoryMaxCount ) RemoveAt( last )` —
  // `>=`, not `>`, so the list holds at most SEVEN entries. Quoted, not fixed.
  while (history.length >= MAX) history.pop();
}

/** The list as the chooser's constructor receives it, most recent first. */
export function footprintHistory(): readonly string[] {
  return history;
}

/** For tests. */
export function clearFootprintHistory(): void {
  history.length = 0;
}
