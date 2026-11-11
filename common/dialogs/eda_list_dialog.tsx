// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_LIST_DIALOG` (common/dialogs/eda_list_dialog.{h,cpp}) over EDA_LIST_DIALOG_BASE: KiCad's
 * "pick one row from a report list" dialog - a label, a wxListCtrl in wxLC_REPORT (sorted with
 * StrNumCmp when asked), a filter box matching `*text*` against the first column, the extras
 * sizer's checkboxes (AddExtraCheckbox), Cancel / OK. Double-clicking a row is OK.
 *
 * One component for the wx class and the ways callers extend it: Board Setup's layer and
 * dielectric pickers, the footprint and symbol SAVE_AS dialogs (a name row prepended), and
 * SCH_BASE_FRAME::SelectLibrary (a "New Library..." button prepended to the buttons).
 */
import { strNumCmp } from '../string_utils.js';
import { CheckBox, ListCtrl } from '@ziroeda/wx/controls.js';
import { wxBOTTOM, wxTOP } from '@ziroeda/wx/defs.js';
import { SizerItem } from '@ziroeda/wx/sizer.js';
import { wxMatches } from '@ziroeda/wx/utils.js';
import { type JSX, useEffect, useRef, useState } from 'react';
import { EDA_LIST_DIALOG_BASE } from './eda_list_dialog_base.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';

/** `DEFAULT_SINGLE_COL_WIDTH` / `DEFAULT_COL_WIDTHS` (eda_list_dialog.cpp:37-38). [data] */
const DEFAULT_SINGLE_COL_WIDTH = 260;
const DEFAULT_COL_WIDTHS = [200, 300] as const;

export interface EdaListRow {
  /** Handed back to `onResult`; `GetTextSelection()` is the first column. */
  value: string;
  /** One cell per header. */
  cells: readonly string[];
}

/** The list and filter logic, apart from the window. */
export class EDA_LIST_DIALOG {
  private readonly m_itemsList: readonly EdaListRow[];
  private readonly m_sortList: boolean;
  /** The filter box's text. */
  m_filter = '';

  constructor(aItemList: readonly EdaListRow[], aSortList: boolean) {
    this.m_itemsList = aItemList;
    this.m_sortList = aSortList;
  }

  /**
   * The rows the list holds: `textChangeInFilterBox` keeps those whose first column matches
   * `*filter*` (case-folded), and `sortList` orders them by StrNumCmp, ignoring case.
   */
  Rows(): EdaListRow[] {
    const filter = `*${this.m_filter.toLowerCase()}*`;
    const rows = this.m_itemsList.filter((row) =>
      wxMatches((row.cells[0] ?? '').toLowerCase(), filter),
    );

    if (this.m_sortList) rows.sort((a, b) => strNumCmp(a.cells[0] ?? '', b.cells[0] ?? '', true));

    return rows;
  }

  /**
   * `m_listBox->FindItem( -1, aPreselectText )` (initDialog): the row whose first column is the
   * text, case ignored; a pinned row's starred text is not found by its bare name. Measured,
   * qa/probes/listctrl_finditem_probe.cpp.
   */
  FindItem(aText: string): string | null {
    const upper = aText.toUpperCase();

    return this.m_itemsList.find((r) => (r.cells[0] ?? '').toUpperCase() === upper)?.value ?? null;
  }

  /** `SetMinClientSize` on the list, by its column count (initDialog). */
  static ListMinSize(aColumnCount: number): [number, number] {
    if (aColumnCount === 1) return [DEFAULT_SINGLE_COL_WIDTH, 200];
    if (aColumnCount === 2) return [DEFAULT_COL_WIDTHS[0] * 3, 200];

    return [-1, -1];
  }

  /** `onSize`: one column fills the list; two split it 42 : 58. */
  static ColumnWidths(aColumnCount: number, aClientWidth: number): number[] {
    if (aColumnCount === 1) return [aClientWidth];

    if (aColumnCount === 2) {
      const first = Math.round(aClientWidth * 0.42);
      return [first, aClientWidth - first];
    }

    return Array.from({ length: aColumnCount }, (_, i) => DEFAULT_COL_WIDTHS[i] ?? 100);
  }
}

/** What the dialog answers besides the row: the extras' values and the button that ended it. */
export interface EdaListExtras {
  /** `GetExtraCheckboxValues()`, in the order they were added. */
  checkboxes: boolean[];
  /** The id an extra button ended the modal with, if it was one. */
  button?: number;
}

export function EdaListDialog({
  title,
  headers,
  rows,
  listLabel = wxGetTranslation('Items:'),
  showFilter = false,
  sortList = false,
  initialValue,
  preselectText,
  okLabel = 'OK',
  nameRow,
  extraCheckboxes,
  extraButton,
  transferDataFromWindow,
  onResult,
}: {
  /** The window title. */
  title: string;
  /** `EDA_LIST_DIALOG( …, headers, … )` — one per report column. */
  headers: readonly string[];
  rows: readonly EdaListRow[];
  /** `SetListLabel()`; the base's own default is "Items:". */
  listLabel?: string;
  /** The inverse of `HideFilter()`. */
  showFilter?: boolean;
  /** The constructor's `aSortList`. */
  sortList?: boolean;
  /** The value of the row selected at the start. */
  initialValue?: string;
  /** `aPreselectText`: the first-column text of the row selected at the start (FindItem). */
  preselectText?: string;
  /** `SetOKLabel()`; OK by default. */
  okLabel?: string;
  /**
   * The name row a SAVE_AS dialog prepends: a label and a text control whose wxTextValidator
   * excludes `excludeChars`. Its trimmed text is `onResult`'s second argument.
   */
  nameRow?: { label: string; value: string; excludeChars: string };
  /** `AddExtraCheckbox( aLabel, &value )`, each with its starting value. */
  extraCheckboxes?: readonly { label: string; value: boolean }[];
  /** A button prepended to m_ButtonsSizer that ends the modal with \a id. */
  extraButton?: { id: number; label: string };
  /**
   * A subclass's `TransferDataFromWindow()`: false keeps the dialog open (SAVE_SYMBOL_AS_DIALOG's
   * validator asks its questions here).
   */
  transferDataFromWindow?: (
    aValue: string | null,
    aName: string | undefined,
    aExtras: EdaListExtras,
  ) => boolean | Promise<boolean>;
  /** `null` on Cancel — `GetTextSelection()` empty. */
  onResult: (value: string | null, name?: string, extras?: EdaListExtras) => void;
}): JSX.Element {
  const [dlg] = useState(() => new EDA_LIST_DIALOG(rows, sortList));
  const [filter, setFilter] = useState('');
  const [name, setName] = useState(nameRow?.value ?? '');
  // A preselect that names no row selects nothing (`FindItem` answers wxNOT_FOUND): it is in no
  // row the list shows.
  const [sel, setSel] = useState<string | null>(
    () => initialValue ?? (preselectText ? dlg.FindItem(preselectText) : null),
  );
  const [checks, setChecks] = useState(() => (extraCheckboxes ?? []).map((c) => c.value));
  const [clientWidth, setClientWidth] = useState<number>(
    () => EDA_LIST_DIALOG.ListMinSize(headers.length)[0],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  dlg.m_filter = filter;
  const shown = dlg.Rows();
  const selRow = shown.findIndex((r) => r.value === sel);

  // `onSize`: the columns follow the list's client width.
  useEffect(() => {
    const el = listRef.current;

    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => setClientWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The selected row stays in view (initDialog's EnsureVisible).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection is the trigger; the element is read through the ref
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [sel]);

  const extras = (aButton?: number): EdaListExtras =>
    aButton === undefined ? { checkboxes: checks } : { checkboxes: checks, button: aButton };

  const accept = async (aValue: string | null): Promise<void> => {
    const typed = nameRow ? name.trim() : undefined;

    if (transferDataFromWindow && !(await transferDataFromWindow(aValue, typed, extras()))) return;

    onResult(aValue, typed, extras());
  };

  return (
    <EDA_LIST_DIALOG_BASE
      title={title}
      {...(nameRow
        ? {
            nameRow: {
              label: nameRow.label,
              value: name,
              inputRef: nameRef,
              onChange: (aValue: string) =>
                setName([...aValue].filter((c) => !nameRow.excludeChars.includes(c)).join('')),
            },
            initialFocus: nameRef,
          }
        : {})}
      m_listLabel={listLabel}
      listMinSize={EDA_LIST_DIALOG.ListMinSize(headers.length)}
      m_listBox={
        <div ref={listRef} className="ze-dataview-window">
          <ListCtrl
            headers={headers}
            rows={shown.map((r) => r.cells)}
            columnWidths={EDA_LIST_DIALOG.ColumnWidths(headers.length, clientWidth)}
            selection={selRow}
            onSelect={(i) => setSel(shown[i]!.value)}
            onActivate={(i) => {
              // onListItemActivated: wxID_OK, on the row double-clicked.
              setSel(shown[i]!.value);
              void accept(shown[i]!.value);
            }}
            ariaLabel={listLabel}
          />
        </div>
      }
      m_filterBox={
        showFilter
          ? {
              value: filter,
              onChange: (t) => {
                // textChangeInFilterBox rebuilds the list: the selection goes with it.
                setFilter(t);
                setSel(null);
              },
            }
          : null
      }
      m_ExtrasSizer={(extraCheckboxes ?? []).map((c, i) => (
        // AddExtraCheckbox: wxBOTTOM, and wxTOP from the second on.
        <SizerItem key={c.label} flag={i > 0 ? wxBOTTOM | wxTOP : wxBOTTOM} border={5}>
          <CheckBox
            label={c.label}
            checked={checks[i] ?? false}
            onChange={(on) => setChecks(checks.map((v, k) => (k === i ? on : v)))}
          />
        </SizerItem>
      ))}
      {...(extraButton
        ? {
            extraButton: {
              label: extraButton.label,
              onClick: () =>
                onResult(null, nameRow ? name.trim() : undefined, extras(extraButton.id)),
            },
          }
        : {})}
      okLabel={okLabel}
      onOK={() => void accept(selRow >= 0 ? sel : null)}
      onCancel={() => onResult(null)}
    />
  );
}
