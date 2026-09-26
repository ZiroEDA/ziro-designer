// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxChoice` / `wxComboBox` (`wx/choice.h`, `wx/combobox.h`) as KiCad's
 * frames use them: a list of strings and a selection, filled and read by the
 * frame's own code (`UpdateGridSelectBox`, `OnSelectZoom`, GerbView's
 * highlight boxes). The model is this object; the page draws it through the
 * shared `Combo` (`common/widgets/wx_combobox.tsx`).
 *
 * A change listener stands in for the repaint wx does on its own when the
 * list or the selection changes.
 */

/** `wxNOT_FOUND`. */
export const wxNOT_FOUND = -1;

export class wxChoice {
  private m_strings: string[] = [];
  private m_selection = wxNOT_FOUND;
  private m_enabled = true;
  private m_onChange: (() => void) | null = null;

  constructor(aChoices?: readonly string[]) {
    if (aChoices) this.m_strings.push(...aChoices);
  }

  /** The page's repaint hook. */
  SetChangeListener(aListener: (() => void) | null): void {
    this.m_onChange = aListener;
  }

  protected changed(): void {
    this.m_onChange?.();
  }

  Clear(): void {
    this.m_strings = [];
    this.m_selection = wxNOT_FOUND;
    this.changed();
  }

  /** @return the index of the (last) appended item. */
  Append(aItems: string | readonly string[]): number {
    if (typeof aItems === 'string') this.m_strings.push(aItems);
    else this.m_strings.push(...aItems);

    this.changed();
    return this.m_strings.length - 1;
  }

  /** @return the position of the inserted item. */
  Insert(aItem: string, aPos: number): number {
    this.m_strings.splice(aPos, 0, aItem);

    if (this.m_selection >= aPos) this.m_selection++;

    this.changed();
    return aPos;
  }

  Delete(aN: number): void {
    if (aN < 0 || aN >= this.m_strings.length) return;

    this.m_strings.splice(aN, 1);

    if (this.m_selection === aN) this.m_selection = wxNOT_FOUND;
    else if (this.m_selection > aN) this.m_selection--;

    this.changed();
  }

  GetCount(): number {
    return this.m_strings.length;
  }

  GetString(aN: number): string {
    return this.m_strings[aN] ?? '';
  }

  GetStrings(): readonly string[] {
    return this.m_strings;
  }

  SetString(aN: number, aString: string): void {
    if (aN < 0 || aN >= this.m_strings.length) return;

    this.m_strings[aN] = aString;
    this.changed();
  }

  GetSelection(): number {
    return this.m_selection;
  }

  /** `GetCurrentSelection()`: the same as GetSelection outside an open popup. */
  GetCurrentSelection(): number {
    return this.m_selection;
  }

  SetSelection(aN: number): void {
    const n = aN >= 0 && aN < this.m_strings.length ? aN : wxNOT_FOUND;

    if (n === this.m_selection) return;

    this.m_selection = n;
    this.changed();
  }

  GetStringSelection(): string {
    return this.m_selection === wxNOT_FOUND ? '' : this.GetString(this.m_selection);
  }

  FindString(aString: string): number {
    return this.m_strings.indexOf(aString);
  }

  Enable(aEnable = true): void {
    if (aEnable === this.m_enabled) return;

    this.m_enabled = aEnable;
    this.changed();
  }

  IsEnabled(): boolean {
    return this.m_enabled;
  }
}
