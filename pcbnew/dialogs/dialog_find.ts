// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FIND` (pcbnew/dialogs/dialog_find.cpp): the board's Find. The hit
 * list is built from the live BOARD with each item's own `Matches()`, walked
 * by Find Next / Find Previous, and each hit is selected through the tool
 * manager and handed to the frame's callback (`PCB_SELECTION_TOOL::FindItem`).
 * The window that draws it is `DialogPcbFind` in dialog_find.tsx.
 */
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { EDA_SEARCH_MATCH_MODE } from '@ziroeda/common/eda_search_data.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { type BOARD, BOARD_LISTENER } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';

/** The dialog's checkboxes (`dialog_find_base.cpp`). */
export interface FIND_OPTIONS {
  /** `m_matchCase` */
  matchCase: boolean;
  /** `m_matchWords` */
  matchWords: boolean;
  /** `m_wildcards` */
  wildcards: boolean;
  /** `m_wrap` */
  wrap: boolean;
  /** `m_includeReferences` */
  includeReferences: boolean;
  /** `m_includeValues` */
  includeValues: boolean;
  /** `m_includeTexts` */
  includeTexts: boolean;
  /** `m_includeMarkers` */
  includeMarkers: boolean;
  /** `m_includeNets` */
  includeNets: boolean;
  /** `m_checkAllFields` */
  checkAllFields: boolean;
}

/** The checkboxes as `dialog_find_base.cpp` sets them. */
export const DEFAULT_FIND_OPTIONS: FIND_OPTIONS = {
  matchCase: false,
  matchWords: false,
  wildcards: false,
  wrap: true,
  includeReferences: true,
  includeValues: true,
  includeTexts: true,
  includeMarkers: true,
  includeNets: true,
  checkAllFields: false,
};

/** `BOARD_LISTENER`: any change to the board makes the hit list stale. */
class FIND_BOARD_LISTENER extends BOARD_LISTENER {
  constructor(private readonly m_onChange: () => void) {
    super();
  }

  override OnBoardItemAdded(): void {
    this.m_onChange();
  }

  override OnBoardItemsAdded(): void {
    this.m_onChange();
  }

  override OnBoardItemRemoved(): void {
    this.m_onChange();
  }

  override OnBoardItemsRemoved(): void {
    this.m_onChange();
  }

  override OnBoardItemChanged(): void {
    this.m_onChange();
  }

  override OnBoardItemsChanged(): void {
    this.m_onChange();
  }

  override OnBoardCompositeUpdate(): void {
    this.m_onChange();
  }
}

export class DIALOG_FIND {
  private readonly m_frame: PCB_EDIT_FRAME;
  private m_board: BOARD | null;
  private readonly m_listener = new FIND_BOARD_LISTENER(() => {
    this.m_upToDate = false;
  });
  private m_hitList: BOARD_ITEM[] = [];
  /** `m_it`: an index into `m_hitList`; `m_hitList.length` is `end()`. */
  private m_it = 0;
  private m_upToDate = false;
  private m_highlightCallback: ((aItem: BOARD_ITEM | null) => void) | null = null;

  /** `m_searchCombo`'s text. */
  m_searchString = '';
  m_options: FIND_OPTIONS = { ...DEFAULT_FIND_OPTIONS };
  /** `m_status`'s label. */
  m_status = '';

  constructor(aFrame: PCB_EDIT_FRAME) {
    this.m_frame = aFrame;

    const history = this.m_frame.GetFindHistoryList();

    while (history.length > 10) history.pop();

    if (history.length > 0) this.m_searchString = history[0]!;

    this.m_board = this.m_frame.GetBoard();
    this.m_board?.AddListener(this.m_listener);
  }

  /** `~DIALOG_FIND`. */
  Destroy(): void {
    this.m_board?.RemoveListener(this.m_listener);
  }

  /** `OnBoardChanged`: a new board is listened to, and the hits are stale. */
  OnBoardChanged(): void {
    this.m_board?.RemoveListener(this.m_listener);
    this.m_board = this.m_frame.GetBoard();
    this.m_board?.AddListener(this.m_listener);
    this.m_upToDate = false;
  }

  /** `Preload( aFindString )`. */
  Preload(aFindString: string): void {
    if (aFindString !== '') this.m_searchString = aFindString;
  }

  /** The function to be called on each found item; it must handle null. */
  SetCallback(aCallback: (aItem: BOARD_ITEM | null) => void): void {
    this.m_highlightCallback = aCallback;
  }

  /** `GetItem()`: the current hit, or null. */
  GetItem(): BOARD_ITEM | null {
    return this.m_it < this.m_hitList.length ? this.m_hitList[this.m_it]! : null;
  }

  /** The combo's history (`m_searchCombo`'s strings), newest first. */
  GetHistory(): readonly string[] {
    return this.m_frame.GetFindHistoryList();
  }

  /** Finds the next item. */
  FindNext(aReverse: boolean): void {
    this.search(!aReverse);
  }

  /** `m_searchCombo` edited. */
  SetSearchString(aString: string): void {
    this.m_searchString = aString;
  }

  /** `onOptionChanged`: any checkbox. */
  SetOptions(aOptions: FIND_OPTIONS): void {
    this.m_options = { ...aOptions };
    this.m_upToDate = false;
  }

  /** `onTextEnter` / `onFindNextClick`. */
  OnFindNext(): void {
    this.search(true);
  }

  /** `onFindPreviousClick`. */
  OnFindPrevious(): void {
    this.search(false);
  }

  /** `onSearchAgainClick`. */
  OnSearchAgain(): void {
    this.m_upToDate = false;
    this.search(true);
  }

  /** `onShowSearchPanel`. */
  OnShowSearchPanel(): void {
    this.m_frame.GetToolManager()?.RunAction(ACTIONS.showSearch);
  }

  /** `search( bool aDirection )` (dialog_find.cpp:160-406). */
  private search(aDirection: boolean): void {
    let endIsReached = false;
    let isFirstSearch = false;

    const searchString = this.m_searchString;

    if (searchString === '') return;

    // Add/move the search string to the top of the list if it isn't already there
    const history = this.m_frame.GetFindHistoryList();
    const index = history.indexOf(searchString);

    if (index === -1) {
      history.unshift(searchString);
      this.m_upToDate = false;

      if (history.length > 10) history.pop();
    } else if (index !== 0) {
      history.splice(index, 1);
      history.unshift(searchString);
      this.m_upToDate = false;
    }

    const frd = this.m_frame.GetFindReplaceData();

    if (this.m_options.matchCase) frd.matchCase = true;

    if (this.m_options.matchWords) frd.matchMode = EDA_SEARCH_MATCH_MODE.WHOLEWORD;
    else if (this.m_options.wildcards) frd.matchMode = EDA_SEARCH_MATCH_MODE.WILDCARD;
    else frd.matchMode = EDA_SEARCH_MATCH_MODE.PLAIN;

    frd.searchAllFields = this.m_options.checkAllFields;

    // Search parameters
    frd.findString = searchString;

    const board = this.m_frame.GetBoard()!;
    const o = this.m_options;

    // Refresh the list of results
    if (!this.m_upToDate) {
      this.m_status = 'Searching...';
      this.m_hitList = [];

      if (o.includeTexts || o.includeValues || o.includeReferences) {
        for (const fp of board.Footprints()) {
          let found = false;

          if (o.includeReferences && fp.Reference().Matches(frd, null)) found = true;

          if (!found && o.includeValues && fp.Value().Matches(frd, null)) found = true;

          if (!found && o.includeTexts) {
            for (const item of fp.GraphicalItems()) {
              if (item.Type() === KICAD_T.PCB_TEXT_T && item.Matches(frd, null)) {
                found = true;
                break;
              }
            }
          }

          if (!found && o.includeTexts) {
            for (const field of fp.GetFields()) {
              if (!field) continue;

              if (field.Matches(frd, null)) {
                found = true;
                break;
              }
            }
          }

          if (found) this.m_hitList.push(fp);
        }

        if (o.includeTexts) {
          for (const item of board.Drawings()) {
            if (item.Type() === KICAD_T.PCB_TEXT_T && item.Matches(frd, null))
              this.m_hitList.push(item);
          }

          for (const zone of board.Zones()) {
            if (zone.Matches(frd, null)) this.m_hitList.push(zone);
          }
        }
      }

      if (o.includeMarkers) {
        for (const marker of board.Markers()) {
          if (marker.Matches(frd, null)) this.m_hitList.push(marker as unknown as BOARD_ITEM);
        }
      }

      if (o.includeNets) {
        for (const net of board.GetNetInfo()) {
          if (net?.Matches(frd, null)) this.m_hitList.push(net as unknown as BOARD_ITEM);
        }
      }

      this.m_upToDate = true;
      isFirstSearch = true;

      if (aDirection) this.m_it = 0;
      else this.m_it = this.m_hitList.length;
    }

    const end = this.m_hitList.length;

    // Get the item to display
    if (this.m_hitList.length === 0) {
      this.m_frame.SetStatusText('');
    } else if (aDirection) {
      if (this.m_it !== end && !isFirstSearch) this.m_it++;

      if (this.m_it === end) {
        if (o.wrap) {
          this.m_it = 0;
        } else {
          endIsReached = true;
          this.m_it--; // point to the last REAL result
        }
      }
    } else {
      if (this.m_it === 0) {
        if (o.wrap) this.m_it = end;
        else endIsReached = true;
      }

      if (this.m_it !== 0) this.m_it--;
    }

    // Display the item
    if (this.m_hitList.length === 0) {
      this.m_frame.SetStatusText('');
      const msg = `'${searchString}' not found`;
      this.m_frame.ShowInfoBarMsg(msg);
      this.m_status = msg;
    } else if (endIsReached || this.m_it === end) {
      this.m_frame.SetStatusText('');
      this.m_frame.ShowInfoBarMsg('No more items to show');
      this.m_status = 'No hits';
    } else {
      const mgr = this.m_frame.GetToolManager()!;
      mgr.RunAction(ACTIONS.selectionClear);
      mgr.RunAction(ACTIONS.selectItem, this.m_hitList[this.m_it]);

      this.m_frame.SetStatusText(`'${searchString}' found`);
      this.m_status = `Hit(s): ${this.m_it + 1} / ${this.m_hitList.length}`;
    }

    this.m_highlightCallback?.(this.GetItem());
  }
}
