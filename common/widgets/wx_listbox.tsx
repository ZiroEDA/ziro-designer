// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_LISTBOX` (`common/widgets/wx_listbox.cpp`, `include/widgets/wx_listbox.h`):
 * "a specialization of wxListBox with support for pinned items".
 *
 * Upstream it is a `wxListBox` whose four string accessors look past
 * `LIB_TREE_MODEL_ADAPTER::GetPinningSymbol()`, so a frame can append
 * `"☆ " + nickname` for a pinned library and still ask for the plain nickname.
 * The two library browsers (`FOOTPRINT_VIEWER_FRAME`, `SYMBOL_VIEWER_FRAME`)
 * are its callers; each builds two of them.
 *
 * The widget half is a `wxListBox` as GTK draws one — a treeview in a scrolled
 * window — whose look already lives in `shell.css` as `.ze-gridlist` (the
 * Grids page's `m_currentGridCtrl` is the same GTK widget). This component
 * wears those rules rather than restating them.
 *
 * It is single-selection (`wxLB_SINGLE`, the default) and deliberately knows
 * nothing about arrow keys: both of its upstream callers catch Up/Down in their
 * frame's `OnCharHook`, which runs before the list sees the key, and do their
 * own `SetSelection` + click. A caller that wants the native keys can pass
 * `onKeyDown`.
 */
import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react';
import { PINNING_SYMBOL } from '../lib_tree_model_adapter.js';
import './wx_listbox.css';

/** `wxNOT_FOUND`. */
export const wxNOT_FOUND = -1;

/** The row text with `GetPinningSymbol()` taken back off the front. */
function stripPinningSymbol(str: string): string {
  return str.startsWith(PINNING_SYMBOL) ? str.substring(PINNING_SYMBOL.length) : str;
}

/**
 * `wxItemContainerImmutable::FindString`: the first row that `IsSameAs( s,
 * bCase )` — a whole-string compare, case-folded unless `bCase`.
 */
function wxFindString(aItems: readonly string[], s: string, bCase: boolean): number {
  const want = bCase ? s : s.toLowerCase();

  for (let i = 0; i < aItems.length; i++) {
    const item = aItems[i]!;

    if ((bCase ? item : item.toLowerCase()) === want) return i;
  }

  return wxNOT_FOUND;
}

/** `WX_LISTBOX::GetBaseString( n )`: row `n` without the pinning mark. */
export function listBoxGetBaseString(aItems: readonly string[], n: number): string {
  return stripPinningSymbol(aItems[n] ?? '');
}

/**
 * `WX_LISTBOX::FindString( s, bCase )`: the pinned spelling first, then the
 * plain one — so a nickname finds its row whether or not it is pinned.
 */
export function listBoxFindString(aItems: readonly string[], s: string, bCase = false): number {
  const retVal = wxFindString(aItems, PINNING_SYMBOL + s, bCase);

  if (retVal === wxNOT_FOUND) return wxFindString(aItems, s, bCase);

  return retVal;
}

/** `WX_LISTBOX::GetStringSelection()`: the selected row, pin stripped, or "". */
export function listBoxGetStringSelection(aItems: readonly string[], aSelection: number): string {
  return aSelection < 0 ? '' : listBoxGetBaseString(aItems, aSelection);
}

export interface WxListBoxProps {
  /** The rows, as `Append` stored them (pinning mark included). */
  items: readonly string[];
  /** `GetSelection()`, or {@link wxNOT_FOUND}. */
  selection: number;
  /** `EVT_LISTBOX`: the user picked row `n`. Not fired for `SetSelection`. */
  onSelect?: (n: number) => void;
  /**
   * `wxEVT_LEFT_DCLICK` connected on the LIST, not on a row
   * (`footprint_viewer_frame.cpp:170-172`) — a double click on the empty space
   * under the last row fires it too, and the handler never asks which row.
   */
  onDoubleClick?: () => void;
  /** `wxNO_BORDER`: the scrolled window's frame is not drawn. */
  noBorder?: boolean;
  /** The list took the focus (`HasFocus()` is what `OnCharHook` asks). */
  onFocus?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

/**
 * The list itself. Every row is rendered — a `wxListBox` is not virtual, and
 * the longest library KiCad ships is well under the count where that matters —
 * and a selection set from outside is scrolled to (`EnsureVisible`).
 */
export function WxListBox({
  items,
  selection,
  onSelect,
  onDoubleClick,
  noBorder = false,
  onFocus,
  onKeyDown,
  ariaLabel,
  testId,
  className,
}: WxListBoxProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // `EnsureVisible( index )`: bring the selected row into view, scrolling the
  // least distance — upstream calls it after every `SetSelection`. A rebuilt
  // list (new `items`) re-runs it too: the same index is a different row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: items is the trigger, not a read
  useEffect(() => {
    const list = ref.current;
    if (!list || selection < 0) return;
    const row = list.children[selection] as HTMLElement | undefined;
    if (!row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [selection, items]);

  const classes = ['ze-gridlist', 'ze-listbox'];
  if (noBorder) classes.push('ze-listbox-noborder');
  if (className) classes.push(className);

  return (
    <div
      ref={ref}
      className={classes.join(' ')}
      role="listbox"
      aria-label={ariaLabel}
      data-testid={testId}
      tabIndex={0}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    >
      {items.map((item, i) => (
        <div
          // Rows can repeat (a library that two filter terms both match is
          // appended twice upstream), so the index is the identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, like wxListBox's
          key={i}
          role="option"
          aria-selected={i === selection}
          className={`ze-gridlist-row${i === selection ? ' selected' : ''}`}
          onMouseDown={() => onSelect?.(i)}
        >
          {item}
        </div>
      ))}
    </div>
  );
}
