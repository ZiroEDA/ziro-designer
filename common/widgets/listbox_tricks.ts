// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LISTBOX_TRICKS` (common/widgets/listbox_tricks.{h,cpp}): the right-click menu and the keys a
 * multi-select wxListBox of strings gets - Copy, Cut, Paste, Duplicate, Delete - and the
 * EDA_EVT_LISTBOX_CHANGED its owner listens for. Used by the footprint-filter lists.
 */
import type { wxListBox } from '@ziroeda/wx/listbox.js';
import { wxNOT_FOUND } from '@ziroeda/wx/listbox.js';
import { GetClipboardUTF8, SaveClipboard } from '../clipboard.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The menu ids (listbox_tricks.h). */
export enum LISTBOX_TRICKS_ID {
  ID_COPY,
  ID_CUT,
  ID_PASTE,
  ID_DELETE,
  ID_DUPLICATE,
}

/** `OnListBoxRDown`'s menu, in order: id, label, accelerator, icon. */
export const LISTBOX_TRICKS_MENU: readonly {
  id: LISTBOX_TRICKS_ID;
  label: string;
  accel: string;
  bitmap: string;
}[] = [
  { id: LISTBOX_TRICKS_ID.ID_COPY, label: _HKI('Copy'), accel: 'Ctrl+C', bitmap: 'copy' },
  { id: LISTBOX_TRICKS_ID.ID_CUT, label: _HKI('Cut'), accel: 'Ctrl+X', bitmap: 'cut' },
  { id: LISTBOX_TRICKS_ID.ID_PASTE, label: _HKI('Paste'), accel: 'Ctrl+V', bitmap: 'paste' },
  {
    id: LISTBOX_TRICKS_ID.ID_DUPLICATE,
    label: _HKI('Duplicate'),
    accel: 'Ctrl+D',
    bitmap: 'duplicate',
  },
  { id: LISTBOX_TRICKS_ID.ID_DELETE, label: _HKI('Delete'), accel: 'Del', bitmap: 'trash' },
];

export class LISTBOX_TRICKS {
  constructor(
    private readonly m_listBox: wxListBox,
    /** `EDA_EVT_LISTBOX_CHANGED`, posted to the list box after each change. */
    private readonly m_onChanged: () => void = () => {},
  ) {}

  /** `listBoxDeleteSelected()`: @return the deleted rows, ascending. */
  listBoxDeleteSelected(): number[] {
    const selections = this.m_listBox.GetSelections();

    if (selections.length === 0)
      // Nothing to remove
      return selections;

    selections.sort((a, b) => a - b);

    for (let ii = selections.length - 1; ii >= 0; ii--) this.m_listBox.Delete(selections[ii]!);

    this.m_listBox.SetSelection(wxNOT_FOUND);

    if (this.m_listBox.GetCount() > 0) this.m_listBox.SetSelection(Math.max(0, selections[0]! - 1));

    this.m_onChanged();
    return selections;
  }

  /** `listBoxGetSelected()`. */
  listBoxGetSelected(): string[] {
    return this.m_listBox.GetSelections().map((ii) => this.m_listBox.GetString(ii));
  }

  /** `listBoxDuplicateSelected()`. */
  listBoxDuplicateSelected(): void {
    const selections = this.m_listBox.GetSelections();
    let insertAt =
      selections.length > 0 ? selections[selections.length - 1]! + 1 : this.m_listBox.GetCount();

    this.m_listBox.SetSelection(wxNOT_FOUND);

    for (const ii of selections) {
      // insertAt only grows, so the rows not yet copied keep their index
      const filter = this.m_listBox.GetString(ii);
      this.m_listBox.Insert(filter, insertAt);
      this.m_listBox.SetSelection(insertAt);
      insertAt++;
    }

    this.m_onChanged();
  }

  /** `listBoxCopy()`: the selected rows, each ending in a newline. */
  listBoxCopy(): void {
    const filters = this.listBoxGetSelected();
    let result = '';

    for (const filter of filters) result += `${filter}\n`;

    SaveClipboard(result);
  }

  /** `listBoxPaste()`: the clipboard's lines, trimmed, after the last selected row. */
  listBoxPaste(): void {
    let lines: string[] = [];
    const text = GetClipboardUTF8().trim();

    // wxSplit of an empty string is no lines at all
    if (text !== '') lines = text.split('\n');

    if (lines.length === 0) return;

    const selections = this.m_listBox.GetSelections();
    const insertAt =
      selections.length > 0 ? selections[selections.length - 1]! + 1 : this.m_listBox.GetCount();

    lines = lines.map((line) => line.trim());

    this.m_listBox.InsertItems(lines, insertAt);
    this.m_listBox.SetSelection(wxNOT_FOUND);

    for (let ii = insertAt; ii < insertAt + lines.length; ii++) this.m_listBox.SetSelection(ii);

    this.m_onChanged();
  }

  /** `listBoxCut()`. */
  listBoxCut(): void {
    this.listBoxCopy();
    const deleted = this.listBoxDeleteSelected();
    const select = deleted.length > 0 ? deleted[0]! : this.m_listBox.GetCount();

    this.m_listBox.SetSelection(wxNOT_FOUND);
    this.m_listBox.SetSelection(Math.min(select, this.m_listBox.GetCount() - 1));
  }

  /** `OnListBoxRDown`'s menu handler. */
  OnMenu(aId: LISTBOX_TRICKS_ID): void {
    switch (aId) {
      case LISTBOX_TRICKS_ID.ID_COPY:
        this.listBoxCopy();
        break;
      case LISTBOX_TRICKS_ID.ID_PASTE:
        this.listBoxPaste();
        break;
      case LISTBOX_TRICKS_ID.ID_CUT:
        this.listBoxCut();
        break;
      case LISTBOX_TRICKS_ID.ID_DELETE:
        this.listBoxDeleteSelected();
        break;
      case LISTBOX_TRICKS_ID.ID_DUPLICATE:
        this.listBoxDuplicateSelected();
        break;
    }
  }

  /**
   * `OnListBoxKeyDown`: Delete, and Ctrl+C/V/X/D. @return false when the key was skipped (left
   * for the list box's own handling).
   */
  OnListBoxKeyDown(aKey: string, aControlDown: boolean): boolean {
    if (aKey === 'Delete') {
      this.listBoxDeleteSelected();
      return true;
    }

    if (!aControlDown) return false;

    switch (aKey.toUpperCase()) {
      case 'C':
        this.listBoxCopy();
        return true;
      case 'V':
        this.listBoxPaste();
        return true;
      case 'X':
        this.listBoxCut();
        return true;
      case 'D':
        this.listBoxDuplicateSelected();
        return true;
      default:
        return false;
    }
  }

  /** `OnListBoxDelete` (EDA_EVT_LISTBOX_DELETE): what a dialog's trash button forwards. */
  OnListBoxDelete(): void {
    this.listBoxDeleteSelected();
  }
}
