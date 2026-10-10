// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILTER_COMBOBOX` and `FILTER_COMBOPOPUP` (`include/widgets/filter_combobox.h`,
 * `common/widgets/filter_combobox.cpp`): "a combobox that has a filterable
 * popup", for lists too long to scroll. `NET_SELECTOR` and `NETCLASS_SELECTOR`
 * are its two subclasses.
 *
 * The closed control is a `wxComboCtrl`, drawn with the `.ze-odcombo` rules the
 * other wxComboCtrl (`wxOwnerDrawnComboBox`) uses. The popup is a `wxPanel`
 * holding "Filter:", a `wxTextCtrl` and a `wxListBox`:
 *
 * - `OnPopup` clears the filter, selects the current value and focuses the
 *   filter box.
 * - typing edits the filter (spaces are refused by its `wxTextValidator`),
 *   rebuilds the list and selects its first row (`onFilterEdit`);
 * - Up/Down move the list selection, Enter accepts, Esc and Tab dismiss
 *   (`onKeyDown`); the pointer hot-tracks the selection and a click accepts.
 * - closed: Enter, Down or Space opens it, and a printable key opens it with
 *   that key already in the filter (`FILTER_COMBOBOX::onKeyDown`).
 *
 * `FilterComboCtrl` is the class with its virtuals as props (`getListContent`,
 * `Accept`); `FilterComboBox` is `FILTER_COMBOBOX` with the base popup.
 *
 * Not ported: Shift+Enter on the closed control posting `wxID_OK` to the
 * parent dialog, which no dialog of ours listens for.
 */

import { TextCtrl } from '../wx/controls.js';
import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useModalEscape } from '../dialog_shim.js';

/**
 * `FILTER_COMBOPOPUP::getListContent`: the (sorted) string list, filtered by a
 * simple substring, case-insensitive search.
 */
export function filterListContent(aStringList: readonly string[], aFilter: string): string[] {
  const filterString = aFilter.toLowerCase();

  return aStringList.filter(
    (str) => filterString === '' || str.toLowerCase().includes(filterString),
  );
}

/** `SetStringList`: `m_stringList = aStringList; m_stringList.Sort();`. */
export function sortStringList(aStringList: readonly string[]): string[] {
  // wxArrayString::Sort() is a plain wxString compare: by code point.
  return [...aStringList].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `getFilterValue()`: `m_filterCtrl->GetValue().Trim( true ).Trim( false )`. */
const trimFilter = (s: string): string => s.trim();

/** `m_filterValidator->SetCharExcludes( " " )`. */
const stripExcluded = (s: string): string => s.replaceAll(' ', '');

export interface FilterComboCtrlProps {
  /** The text the closed `wxComboCtrl` shows (`SetValue`). */
  value: string;
  /** `getListContent( aStringList )` for the current filter value. */
  getListContent: (aFilter: string) => string[];
  /**
   * `Accept()`: the list's selected string, or '' when nothing is selected.
   * Called after the popup has been dismissed.
   */
  onAccept: (aSelected: string) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  /** Layout only; the look lives in the CSS. */
  className?: string;
  style?: CSSProperties;
}

export function FilterComboCtrl({
  value,
  getListContent,
  onAccept,
  disabled = false,
  id,
  ariaLabel,
  className,
  style,
}: FilterComboCtrlProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState(-1);
  const [box, setBox] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const list = open ? getListContent(trimFilter(filter)) : [];

  const dismiss = useCallback(() => {
    setOpen(false);
    setBox(null);
    btnRef.current?.focus();
  }, []);

  // Esc dismisses the popup and must not reach the dialog behind it.
  useModalEscape(dismiss, open);

  /** `Popup()` + `OnPopup()`, with `OnStartingKey` when a key opened it. */
  const popup = (aStartingKey = ''): void => {
    const start = stripExcluded(aStartingKey);
    // "While it can sometimes be useful to keep the filter, it's always
    // unexpected. Better to clear it."
    setFilter(start);
    const content = getListContent(trimFilter(start));
    // `m_listBox->SetStringSelection( GetStringValue() )`, or the first row
    // when the starting key went through `onFilterEdit`.
    setSelection(start === '' ? content.indexOf(value) : content.length > 0 ? 0 : -1);
    setOpen(true);
  };

  const accept = (aIndex = selection): void => {
    const selected = aIndex >= 0 ? (list[aIndex] ?? '') : '';
    dismiss();
    onAccept(selected);
  };

  // The popup opens below the control, at least as wide as it
  // (`GetAdjustedSize( aMinWidth, ... )`), and grows to its widest row.
  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.bottom, minWidth: r.width });
    filterRef.current?.focus();
  }, [open]);

  // A click anywhere else dismisses without accepting.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setBox(null);
    };
    // Capture: a control that unmounts on mousedown would otherwise read as
    // outside by the time the bubble reaches the window.
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  /** `FILTER_COMBOPOPUP::onKeyDown`. */
  const onPopupKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        dismiss();
        break;
      case 'Enter':
        e.preventDefault();
        accept();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelection((s) => Math.min(s + 1, list.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelection((s) => Math.max(s - 1, 0));
        break;
      default:
        // Everything else goes to the filter textbox, which has the focus.
        break;
    }
    e.stopPropagation();
  };

  /** `FILTER_COMBOBOX::onKeyDown`, closed. */
  const onControlKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (open) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      popup();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Non-control characters go to filterbox in popup for read-only controls
      e.preventDefault();
      popup(e.key);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        className={`ze-odcombo${className ? ` ${className}` : ''}`}
        style={style}
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${ids}-list` : undefined}
        onClick={() => (open ? dismiss() : popup())}
        onKeyDown={onControlKeyDown}
      >
        <span className="ze-odcombo-text">{value}</span>
        <span className="twisty expandable ze-combo-arrow ze-odcombo-arrow" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="ze-odcombo-popup ze-filter-popup"
          style={
            box
              ? { position: 'fixed', left: box.left, top: box.top, minWidth: box.minWidth }
              : { position: 'fixed', left: 0, top: 0, visibility: 'hidden' }
          }
          onKeyDown={onPopupKeyDown}
        >
          <label className="ze-filter-popup-label" htmlFor={`${ids}-filter`}>
            Filter:
          </label>
          <TextCtrl
            value={filter}
            onChange={(aValue) => {
              // `onFilterEdit`: rebuild, and select the first row.
              const next = stripExcluded(aValue);
              setFilter(next);
              setSelection(getListContent(trimFilter(next)).length > 0 ? 0 : -1);
            }}
            id={`${ids}-filter`}
            inputRef={filterRef}
          />
          <div id={`${ids}-list`} className="ze-filter-popup-list" role="listbox">
            {list.map((s, i) => (
              <div
                // Rows are strings the owner built; two can be equal.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={i}
                role="option"
                aria-selected={i === selection}
                className={`ze-odcombo-item${i === selection ? ' selected' : ''}`}
                // `onMouseMoved`: hot-track the listbox selection.
                onMouseMove={() => setSelection(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSelection(i);
                  accept(i);
                }}
              >
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export interface FilterComboBoxProps
  extends Omit<FilterComboCtrlProps, 'getListContent' | 'onAccept'> {
  /** `SetStringList( aList )`. */
  stringList: readonly string[];
  /** `FILTERED_ITEM_SELECTED`, with the newly selected string. */
  onChange: (aSelected: string) => void;
}

/** `FILTER_COMBOBOX` with the base `FILTER_COMBOPOPUP`. */
export function FilterComboBox({
  stringList,
  value,
  onChange,
  ...rest
}: FilterComboBoxProps): JSX.Element {
  const sorted = sortStringList(stringList);
  return (
    <FilterComboCtrl
      {...rest}
      value={value}
      getListContent={(f) => filterListContent(sorted, f)}
      onAccept={(selectedString) => {
        // No update on empty
        if (selectedString !== '' && selectedString !== value) onChange(selectedString);
      }}
    />
  );
}
