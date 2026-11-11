// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Modeless Find / Find and Replace dialog. Counterpart:
 * `eeschema/dialogs/dialog_sch_find.cpp` (DIALOG_SCH_FIND,
 * dialog_sch_find_base.cpp).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS IN `widgets/` AND NOT UNDER `editors/schematic/`
 * ---------------------------------------------------------------------------
 *
 * It is a `SCH_BASE_FRAME` facility, not a `SCH_EDIT_FRAME` one:
 *
 *     void             ShowFindReplaceDialog( bool aReplace );
 *     DIALOG_SCH_FIND* GetFindReplaceDialog() const { return m_findReplaceDialog; }
 *     …
 *     DIALOG_SCH_FIND* m_findReplaceDialog;      — eeschema/sch_base_frame.h:246-248, :318
 *
 * and `SCH_EDIT_FRAME` and `SYMBOL_EDIT_FRAME` both inherit it — one dialog
 * class, one `ShowFindReplaceDialog`, one search-data object, branching
 * internally on `GetFrameType()`. This port splits eeschema into two editors,
 * so a base-class facility has to live above both of them or it becomes a
 * per-editor copy; `widgets/dialog_sym_lib_table.tsx` (upstream
 * `eeschema/dialogs/dialog_sym_lib_table.cpp`, opened from either frame) and
 * `widgets/lib_tree.tsx` are already here for the same reason.
 *
 * It lived at `editors/schematic/dialogs/dialog_schematic_find.tsx` and was
 * wired only into `SchematicEditor.tsx`, which is why the Symbol Editor's Find
 * and Find-and-Replace buttons carried a static `disabled: true` against a
 * KiCad toolbar that greys neither.
 *
 * ---------------------------------------------------------------------------
 * THE TWO FRAMES
 * ---------------------------------------------------------------------------
 *
 * `DIALOG_SCH_FIND::DIALOG_SCH_FIND` (`dialog_sch_find.cpp:57-67`):
 *
 *     if( m_frame->GetFrameType() == FRAME_SCH_SYMBOL_EDITOR )
 *     {
 *         m_findReplaceData->searchAllPins = true;
 *
 *         m_cbCurrentSheetOnly->Hide();
 *         m_cbSearchPins->Hide();
 *         m_cbSearchNetNames->Hide();
 *         m_cbReplaceReferences->Hide();
 *
 *         m_staticline1->Hide();
 *         m_searchPanelLink->Hide();
 *     }
 *
 * — four option boxes gone, pin search forced ON rather than merely defaulted,
 * and the separator plus the "Show search panel" link gone with them. What is
 * left in that frame is Match case, Whole words only, Regular Expression,
 * Include hidden fields and the current-selection scope.
 *
 * Layout mirrors the base sizers exactly:
 *
 *   mainSizer (vertical)
 *     topSizer (horizontal): leftSizer (grows) | rightSizer (buttons)
 *       leftGridSizer, "Search for:" / "Replace with:" label + combo rows
 *       gbSizer2 to 3-column grid-bag of the search options
 *     bSizer6: staticline + "Show search panel" link (aligned right)
 *
 * Per the base, the Direction radios (m_radioForward/m_radioBackward) are
 * hidden in both modes, so they are omitted here. "Replace with:", the
 * "Replace matches in reference designators" option, and the Replace /
 * Replace All buttons appear only in Find and Replace mode
 * (wxFR_REPLACEDIALOG). Enter = Find, F3 / Shift+F3 = OnCharHook, Esc = close.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { KeyNameFromKeyCode } from '@ziroeda/common/hotkeys_basic.js';
import { DIALOG_SCH_FIND_BASE } from './dialog_sch_find_base.js';
import type { MatchMode, SchSearchData } from '../tools/sch_find_replace_tool.js';
import type { SCH_FIND_REPLACE_TOOL } from '../tools/sch_find_replace_tool.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import { EDA_SEARCH_MATCH_MODE, type SCH_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `EDA_BASE_FRAME::GetFrameType()`, the only thing the dialog branches on. */
export type SchFindFrame = 'FRAME_SCH' | 'FRAME_SCH_SYMBOL_EDITOR';

interface Props {
  /**
   * Which frame opened it. `FRAME_SCH_SYMBOL_EDITOR` takes the constructor
   * branch quoted above; anything else is the schematic's full option set.
   */
  frame: SchFindFrame;
  data: SchSearchData;
  onChange: (next: SchSearchData) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  /** Replace mode (wxFR_REPLACEDIALOG): the replace row, its option and buttons. */
  replace?: boolean;
  onReplace?: () => void;
  onReplaceAll?: () => void;
  /** m_comboFind / m_comboReplace's drop-down lists: the frame's histories. */
  findStrings?: readonly string[];
  replaceStrings?: readonly string[];
  /** `OnUpdateReplaceUI`: Replace is enabled only with a current match. */
  canReplace?: boolean;
  /**
   * `DIALOG_SCH_FIND::onShowSearchPanel`. Absent in the symbol editor, where
   * upstream hides the link (and the separator above it) outright.
   */
  onShowSearchPanel?: () => void;
}

export function DialogSchFind({
  frame,
  data,
  onChange,
  onFindNext,
  onFindPrevious,
  onClose,
  replace,
  onReplace,
  onReplaceAll,
  findStrings = [],
  replaceStrings = [],
  canReplace = true,
  onShowSearchPanel,
}: Props): JSX.Element {
  const symbolEditor = frame === 'FRAME_SCH_SYMBOL_EDITOR';

  // `m_findReplaceData->searchAllPins = true;` — the CONSTRUCTOR sets the flag
  // for this frame, it does not merely tick a box, so a symbol's pins are
  // searched whether or not the schematic left the option off. The checkbox is
  // hidden straight after, which is why this is not a rendered control. On
  // mount only, because that is when the constructor runs.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    if (symbolEditor && !data.searchAllPins) onChange({ ...data, searchAllPins: true });
  }, [symbolEditor, data, onChange]);

  const setMode = (mode: MatchMode, on: boolean): void =>
    onChange({ ...data, matchMode: on ? mode : 'plain' });

  // `ACTIONS::showSearch.GetHotKey()` appended as " (%s)" (dialog_sch_find.cpp:83-87).
  const hotkey = ACTIONS.showSearch.GetHotKey();
  const linkLabel = `Show search panel${hotkey ? ` (${KeyNameFromKeyCode(hotkey)})` : ''}`;

  return (
    <DIALOG_SCH_FIND_BASE
      title={replace ? _('Find and Replace') : _('Find')}
      m_comboFind={data.findString}
      comboFindChoices={findStrings}
      onComboFind={(v) => onChange({ ...data, findString: v })}
      replaceShown={!!replace}
      m_comboReplace={data.replaceString}
      comboReplaceChoices={replaceStrings}
      onComboReplace={(v) => onChange({ ...data, replaceString: v })}
      m_checkMatchCase={{
        value: data.matchCase,
        onChange: (on) => onChange({ ...data, matchCase: on }),
      }}
      m_checkWholeWord={{
        value: data.matchMode === 'wholeword',
        onChange: (on) => setMode('wholeword', on),
      }}
      m_checkRegexMatch={{
        value: data.matchMode === 'regex',
        onChange: (on) => setMode('regex', on),
      }}
      m_cbSearchPins={{
        shown: !symbolEditor,
        value: data.searchAllPins,
        onChange: (on) => onChange({ ...data, searchAllPins: on }),
      }}
      m_cbSearchNetNames={{
        shown: !symbolEditor,
        value: data.searchNetNames,
        onChange: (on) => onChange({ ...data, searchNetNames: on }),
      }}
      m_cbSearchHiddenFields={{
        value: data.searchAllFields,
        onChange: (on) => onChange({ ...data, searchAllFields: on }),
      }}
      m_cbCurrentSheetOnly={{
        shown: !symbolEditor,
        value: data.searchCurrentSheetOnly,
        enabled: !data.searchSelectedOnly,
        onChange: (on) => onChange({ ...data, searchCurrentSheetOnly: on }),
      }}
      m_cbSelectedOnly={{
        value: data.searchSelectedOnly,
        onChange: (on) => onChange({ ...data, searchSelectedOnly: on }),
      }}
      m_cbReplaceReferences={{
        shown: !!replace && !symbolEditor,
        value: data.replaceReferences,
        onChange: (on) => onChange({ ...data, replaceReferences: on }),
      }}
      onFind={onFindNext}
      m_buttonReplace={{
        shown: !!replace,
        enabled: !!data.findString && canReplace,
        onClick: () => onReplace?.(),
      }}
      m_buttonReplaceAll={{
        shown: !!replace,
        enabled: !!data.findString,
        onClick: () => onReplaceAll?.(),
      }}
      searchPanelLinkShown={!symbolEditor && !!onShowSearchPanel}
      searchPanelLinkLabel={linkLabel}
      onShowSearchPanel={() => onShowSearchPanel?.()}
      onCharHook={(e) => {
        // OnCharHook: F3 / Shift+F3 search from the dialog's own string.
        if (e.key === 'F3') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) onFindPrevious();
          else onFindNext();
        }
      }}
      onCancel={onClose}
    />
  );
}

/** The dialog's own control values, which `updateFlags` reads into the search data. */
export interface SCH_FIND_CONTROLS {
  matchCase: boolean;
  wholeWord: boolean;
  regexMatch: boolean;
  searchHiddenFields: boolean;
  replaceReferences: boolean;
  searchPins: boolean;
  selectedOnly: boolean;
  currentSheetOnly: boolean;
  currentSheetOnlyEnabled: boolean;
  searchNetNames: boolean;
}

/**
 * `DIALOG_SCH_FIND` (dialog_sch_find.cpp): the modeless Find / Find and Replace dialog. It
 * edits the frame's SCH_SEARCH_DATA and drives SCH_FIND_REPLACE_TOOL; the combo lists are the
 * frame's find and replace histories. The view is `DialogSchFind` above.
 */
export class DIALOG_SCH_FIND {
  protected readonly m_frame: SCH_BASE_FRAME;
  private readonly m_findReplaceTool: SCH_FIND_REPLACE_TOOL;
  private readonly m_findReplaceData: SCH_SEARCH_DATA;
  private m_findDirty = true;
  private readonly m_replace: boolean;
  private readonly m_controls: SCH_FIND_CONTROLS;

  /// m_comboFind / m_comboReplace: their strings and current value.
  private m_findStrings: string[] = [];
  private m_findValue = '';
  private m_replaceStrings: string[] = [];
  private m_replaceValue = '';
  private m_shown = false;

  constructor(aParent: SCH_BASE_FRAME, aData: SCH_SEARCH_DATA, aReplace: boolean) {
    this.m_frame = aParent;
    this.m_findReplaceTool = aParent
      .GetToolManager()!
      .FindTool('eeschema.FindReplace') as SCH_FIND_REPLACE_TOOL;
    this.m_findReplaceData = aData;
    this.m_replace = aReplace;

    if (this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH_SYMBOL_EDITOR)
      this.m_findReplaceData.searchAllPins = true;

    this.m_controls = {
      matchCase: this.m_findReplaceData.matchCase,
      wholeWord: this.m_findReplaceData.matchMode === EDA_SEARCH_MATCH_MODE.WHOLEWORD,
      regexMatch: this.m_findReplaceData.matchMode === EDA_SEARCH_MATCH_MODE.REGEX,
      searchHiddenFields: this.m_findReplaceData.searchAllFields,
      replaceReferences: this.m_findReplaceData.replaceReferences,
      searchPins: this.m_findReplaceData.searchAllPins,
      selectedOnly: this.m_findReplaceData.searchSelectedOnly,
      currentSheetOnly: this.m_findReplaceData.searchCurrentSheetOnly,
      currentSheetOnlyEnabled: !this.m_findReplaceData.searchSelectedOnly,
      searchNetNames: this.m_findReplaceData.searchNetNames,
    };
  }

  /** `HasFlag( wxFR_REPLACEDIALOG )`. */
  IsReplaceDialog(): boolean {
    return this.m_replace;
  }

  Show(aShow: boolean): void {
    this.m_shown = aShow;
  }

  IsShown(): boolean {
    return this.m_shown;
  }

  Destroy(): void {
    this.m_shown = false;
  }

  /** What the view shows: the combo values and the option boxes, as the form's record. */
  GetControlValues(): SchSearchData {
    const c = this.m_controls;
    return {
      findString: this.m_findValue,
      replaceString: this.m_replaceValue,
      matchCase: c.matchCase,
      matchMode: c.wholeWord ? 'wholeword' : c.regexMatch ? 'regex' : 'plain',
      searchAllFields: c.searchHiddenFields,
      searchAllPins: c.searchPins,
      searchCurrentSheetOnly: c.currentSheetOnly,
      searchSelectedOnly: c.selectedOnly,
      searchNetNames: c.searchNetNames,
      replaceReferences: c.replaceReferences,
      searchAndReplace: this.m_replace,
    };
  }

  OnClose(): void {
    // Notify the SCH_BASE_FRAME
    this.m_frame.OnFindDialogClose();
  }

  OnIdle(): void {
    if (this.m_findDirty) {
      this.m_findReplaceTool.UpdateFind(ACTIONS.updateFind.MakeEvent());
      this.m_findDirty = false;
    }
  }

  OnCancel(): void {
    this.OnClose();
  }

  /** `OnCharHook` for F3 / Shift+F3. */
  OnFindKey(aShiftDown: boolean): void {
    this.updateFlags();
    this.m_findReplaceData.findString = this.m_findValue;

    if (aShiftDown) this.m_findReplaceTool.FindNext(ACTIONS.findPrevious.MakeEvent());
    else this.m_findReplaceTool.FindNext(ACTIONS.findNext.MakeEvent());
  }

  onShowSearchPanel(): void {
    if (this.m_frame.GetFrameType() !== FRAME_T.FRAME_SCH) return;

    this.m_frame.GetToolManager()!.RunAction(ACTIONS.showSearch);

    this.Show(false);
  }

  /** `OnUpdateReplaceUI`. */
  CanReplace(): boolean {
    return this.m_replace && this.m_findValue !== '' && this.m_findReplaceTool.HasMatch();
  }

  /** `OnUpdateReplaceAllUI`. */
  CanReplaceAll(): boolean {
    return this.m_replace && this.m_findValue !== '';
  }

  OnSearchForText(aValue: string): void {
    this.m_findValue = aValue;
    this.m_findReplaceData.findString = this.m_findValue;
    this.m_findDirty = true;
  }

  OnReplaceWithText(aValue: string): void {
    this.m_replaceValue = aValue;
    this.m_findReplaceData.replaceString = this.m_replaceValue;
  }

  /** `OnOptions`: a box changed, with \a aControls the new values. */
  OnOptions(aControls: Partial<SCH_FIND_CONTROLS>): void {
    Object.assign(this.m_controls, aControls);
    this.updateFlags();
    this.m_findDirty = true;
  }

  private updateFlags(): void {
    const c = this.m_controls;
    const data = this.m_findReplaceData;

    // Rebuild the search flags in m_findReplaceData from dialog settings
    data.matchCase = c.matchCase;
    data.searchAllFields = c.searchHiddenFields;
    data.searchAllPins = c.searchPins;
    data.replaceReferences = c.replaceReferences;
    data.searchNetNames = c.searchNetNames;

    // Only read the current-sheet-only widget when the user can actually toggle it.
    // While selection-only forces it on, its value doesn't reflect user intent.
    if (c.currentSheetOnlyEnabled) data.searchCurrentSheetOnly = c.currentSheetOnly;

    if (c.wholeWord) data.matchMode = EDA_SEARCH_MATCH_MODE.WHOLEWORD;
    // m_checkRegexMatch->IsShown(): the base never hides it, so in both modes and both frames.
    else if (c.regexMatch) data.matchMode = EDA_SEARCH_MATCH_MODE.REGEX;
    else data.matchMode = EDA_SEARCH_MATCH_MODE.PLAIN;

    if (c.selectedOnly) {
      c.currentSheetOnlyEnabled = false;
      data.searchSelectedOnly = true;
    } else {
      c.currentSheetOnly = data.searchCurrentSheetOnly;
      c.currentSheetOnlyEnabled = true;
      data.searchSelectedOnly = false;
    }
  }

  /** Move \a aValue to the top of \a aStrings, inserting it when absent. */
  private static toTop(aStrings: string[], aValue: string): void {
    const index = aStrings.indexOf(aValue);

    if (index === -1) aStrings.unshift(aValue);
    else if (index !== 0) {
      aStrings.splice(index, 1);
      aStrings.unshift(aValue);
    }
  }

  OnFind(): void {
    this.updateFlags(); // Ensure search flags are up to date

    DIALOG_SCH_FIND.toTop(this.m_findStrings, this.m_findValue);

    this.m_findReplaceTool.FindNext(ACTIONS.findNext.MakeEvent());
  }

  /** `OnReplace`: wxID_REPLACE when \a aAll is false, wxID_REPLACE_ALL when true. */
  OnReplace(aAll: boolean): void {
    this.updateFlags(); // Ensure search flags are up to date

    DIALOG_SCH_FIND.toTop(this.m_replaceStrings, this.m_replaceValue);

    if (!aAll) this.m_findReplaceTool.ReplaceAndFindNext(ACTIONS.replaceAndFindNext.MakeEvent());
    else this.m_findReplaceTool.ReplaceAll(ACTIONS.replaceAll.MakeEvent());
  }

  /** m_comboFind->GetStrings() as it stands, for the drop-down. */
  GetFindComboStrings(): readonly string[] {
    return this.m_findStrings;
  }

  GetFindEntries(): string[] {
    DIALOG_SCH_FIND.toTop(this.m_findStrings, this.m_findValue);

    return this.m_findStrings.slice();
  }

  SetFindEntries(aEntries: readonly string[], aFindString: string): void {
    this.m_findStrings.push(...aEntries);

    while (this.m_findStrings.length > 10) {
      this.m_frame.GetFindHistoryList().pop();
      this.m_findStrings.splice(9, 1);
    }

    if (aFindString !== '') this.m_findValue = aFindString;
    else if (this.m_findStrings.length) this.m_findValue = this.m_findStrings[0]!;
  }

  SetReplaceEntries(aEntries: readonly string[]): void {
    this.m_replaceStrings.push(...aEntries);

    while (this.m_replaceStrings.length > 10) {
      this.m_frame.GetFindHistoryList().pop();
      this.m_replaceStrings.splice(9, 1);
    }

    if (this.m_replaceStrings.length) this.m_replaceValue = this.m_replaceStrings[0]!;
  }

  GetReplaceEntries(): string[] {
    return this.m_replaceStrings.slice();
  }
}

/**
 * The modeless DIALOG_SCH_FIND as a window shows it, one for both frames since the dialog is
 * SCH_BASE_FRAME's: the factory ShowFindReplaceDialog builds it through, installed on \a frame,
 * and the dialog while it is shown. SCH_FIND_REPLACE_TOOL does the finding.
 */
export function SchFindDialogHost({
  frame,
  frameType,
}: {
  frame: SCH_BASE_FRAME;
  frameType: SchFindFrame;
}): JSX.Element | null {
  const [findDialog, setFindDialog] = useState<DIALOG_SCH_FIND | null>(null);
  const [, setFindTick] = useState(0);

  useEffect(() => {
    frame.SetFindReplaceDialogFactory((aData, aReplace) => {
      class WINDOW_DIALOG_SCH_FIND extends DIALOG_SCH_FIND {
        override Show(aShow: boolean): void {
          super.Show(aShow);
          setFindDialog(this);
          setFindTick((n) => n + 1);
        }

        override Destroy(): void {
          super.Destroy();
          setFindDialog((d) => (d === this ? null : d));
        }
      }
      return new WINDOW_DIALOG_SCH_FIND(frame, aData, aReplace);
    });
    return () => frame.SetFindReplaceDialogFactory(null);
  }, [frame]);

  if (!findDialog?.IsShown()) return null;

  return (
    <DialogSchFind
      // The dialog branches on the frame type itself, so this is the whole of the difference.
      frame={frameType}
      data={findDialog.GetControlValues()}
      onChange={(next) => {
        const cur = findDialog.GetControlValues();
        if (next.findString !== cur.findString) findDialog.OnSearchForText(next.findString);
        else if (next.replaceString !== cur.replaceString)
          findDialog.OnReplaceWithText(next.replaceString);
        else
          findDialog.OnOptions({
            matchCase: next.matchCase,
            wholeWord: next.matchMode === 'wholeword',
            regexMatch: next.matchMode === 'regex',
            searchHiddenFields: next.searchAllFields,
            replaceReferences: next.replaceReferences,
            searchPins: next.searchAllPins,
            selectedOnly: next.searchSelectedOnly,
            currentSheetOnly: next.searchCurrentSheetOnly,
            searchNetNames: next.searchNetNames,
          });
        // wxEVT_IDLE follows the event.
        findDialog.OnIdle();
        setFindTick((n) => n + 1);
      }}
      onFindNext={() => findDialog.OnFind()}
      onFindPrevious={() => findDialog.OnFindKey(true)}
      onClose={() => findDialog.OnCancel()}
      findStrings={findDialog.GetFindComboStrings()}
      replaceStrings={findDialog.GetReplaceEntries()}
      canReplace={findDialog.CanReplace()}
      replace={findDialog.IsReplaceDialog()}
      onReplace={() => findDialog.OnReplace(false)}
      onReplaceAll={() => findDialog.OnReplace(true)}
      onShowSearchPanel={() => findDialog.onShowSearchPanel()}
    />
  );
}
