// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `wxOwnerDrawnComboBox` — the drop-down whose rows the *application* paints.
 *
 * `Combo` next door is the `wxChoice`: a fixed list of strings that GTK draws.
 * This is the other one. `wxOwnerDrawnComboBox` hands each row to
 * `OnDrawItem( wxDC&, const wxRect&, int aItem, int aFlags )` and lets the
 * subclass put whatever it likes in the rectangle — two-tone text, a rule
 * instead of a label, a glyph. KiCad has three such subclasses
 * (`FOOTPRINT_CHOICE`, `FONT_CHOICE`, `WIDTH_COMBOBOX`), and none of them can
 * be expressed by a native `<select>`, whose option list is drawn by the
 * browser: not its font, not its row height, not its position, and certainly
 * not two colours inside one row.
 *
 * So the list is drawn here, and `drawItem` is `OnDrawItem`.
 *
 * ## What is measured, and where the numbers came from
 *
 * Everything below is `~/kicad-probes/fp_choice_*.cpp`, which builds this exact
 * control — read-only `wxOwnerDrawnComboBox`, `FOOTPRINT_CHOICE`'s constructor
 * (`common/widgets/footprint_choice.cpp:28-33`) — on this machine with this
 * theme, pops it, and reads the popup window back out of the display server.
 *
 * `aFlags`, which `OnDrawItem` branches on, is not guesswork either; the probe
 * records every call:
 *
 *   closed control, not focused   CONTROL=1 SELECTED=0
 *   closed control, focused       CONTROL=1 SELECTED=1
 *   popup row, current            CONTROL=0 SELECTED=1
 *   popup row, any other          CONTROL=0 SELECTED=0
 *
 * The focused case is `wxComboCtrlBase::ShouldDrawFocus()`, which is true only
 * for a read-only combo that has the focus while its popup is *closed*; the
 * probe confirms the flag flips off again the moment the list opens.
 *
 * ## Keyboard
 *
 * Also measured, with `wxUIActionSimulator` driving a real one
 * (`~/kicad-probes/fp_choice_keys.cpp`):
 *
 *   closed + Down/Up   steps the value and commits; does NOT open the list
 *   open   + Down/Up   moves the highlight only — the value does not change
 *   open   + Enter     commits the highlighted row and closes
 *   open   + Escape    closes and leaves the value alone
 *
 * A native `<select>` gave all of that away for free, so a replacement that
 * loses it is a regression rather than a fix.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { placeComboPopup, type PopupBox } from './owner_drawn_combo_popup.js';
import { useModalEscape } from './useModalEscape.js';

/**
 * One `wxItemContainer` entry: `Append( aLabel, new wxStringClientData( aValue ) )`.
 */
export interface OwnerDrawnItem {
  /**
   * The client data. `onChange` hands this back, and `drawItem` gets it as the
   * `wxStringClientData` half of the row — which is the whole point of the
   * split: `FOOTPRINT_CHOICE` looks for the client data's library prefix
   * *inside* the display string, and for the "[Default] Lib:Fp" row the two are
   * deliberately not the same text.
   */
  value: string;
  /**
   * `GetString( aItem )`, the display text.
   *
   * The empty string is a SEPARATOR. That is `FOOTPRINT_CHOICE`'s convention,
   * documented on the class itself (`include/widgets/footprint_choice.h:26-36`,
   * "empty items are displayed as nonselectable separators"), and it is the only
   * separator convention wx's owner-drawn combo has, so the shared widget
   * implements it rather than inventing a second one.
   */
  label: string;
  /** Not selectable. Drawn, but vetoed like a separator. */
  disabled?: boolean;
}

/** `aFlags`, as `OnDrawItem` receives them. */
export interface DrawItemFlags {
  /** `wxODCB_PAINTING_CONTROL` — this is the closed box, not a list row. */
  control: boolean;
  /** `wxODCB_PAINTING_SELECTED` — the current row, or a focused closed box. */
  selected: boolean;
}

/** `true` for a row that `TryVetoSelect`/`TryVetoMouse` refuse to land on. */
export function isSeparator(item: OwnerDrawnItem | undefined): boolean {
  return item !== undefined && item.label === '';
}

function selectable(item: OwnerDrawnItem | undefined): boolean {
  return item !== undefined && !isSeparator(item) && !item.disabled;
}

export interface OwnerDrawnComboProps {
  /** The selected item's `value`. */
  value: string;
  items: readonly OwnerDrawnItem[];
  onChange: (value: string) => void;
  /**
   * `OnDrawItem`. Defaults to the plain label, which is what the base
   * `wxOwnerDrawnComboBox` draws.
   */
  drawItem?: (item: OwnerDrawnItem, flags: DrawItemFlags) => ReactNode;
  disabled?: boolean;
  /** Extra class on the closed box. Layout only — the look lives in the CSS. */
  className?: string;
  /** Layout only, as on `Combo`. */
  style?: CSSProperties;
  ariaLabel?: string;
  title?: string;
}

export function OwnerDrawnCombo({
  value,
  items,
  onChange,
  drawItem,
  disabled = false,
  className,
  style,
  ariaLabel,
  title,
}: OwnerDrawnComboProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [box, setBox] = useState<PopupBox | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const ids = useId();

  const index = items.findIndex((o) => o.value === value);
  const current = index >= 0 ? items[index] : undefined;

  /** `GetVListBoxComboPopup()->wxVListBox::GetSelection()`, the inner list's row. */
  const [hi, setHi] = useState(index);

  const close = useCallback(() => {
    setOpen(false);
    setBox(null);
    btnRef.current?.focus();
  }, []);

  // Esc closes the LIST, and must not reach the dialog behind it. The modal
  // stack is how every other popup in the app gets that, and last-mounted-wins
  // is exactly the precedence needed here: the combo registers after the dialog
  // it sits in, so it takes the key first. (Measured upstream: Escape on an open
  // popup closes it and leaves the value alone.)
  useModalEscape(close, open);

  // The list opens flush under the control, so its position depends on where the
  // control ended up — which is only knowable after layout. The first frame
  // renders it hidden purely to be measured, the way MenuBar's flyouts are.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    setBox(
      placeComboPopup(
        { left: r.left, top: r.top, bottom: r.bottom, width: r.width },
        { width: pop.scrollWidth, height: pop.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [open]);

  // Clicking anywhere else dismisses without committing, as clicking off a wx
  // popup does.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setBox(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const draw = (item: OwnerDrawnItem, flags: DrawItemFlags): ReactNode =>
    drawItem ? drawItem(item, flags) : item.label;

  /**
   * `FOOTPRINT_CHOICE::TryVetoSelect`: a move onto a separator is put back where
   * it came from (`SetSelectionEither( aInner, m_last_selection )`), so the row
   * cannot be reached at all. Not "skipped over" — upstream really does leave
   * you where you were.
   */
  const veto = (from: number, to: number): number => (selectable(items[to]) ? to : from);

  /**
   * Type-ahead, which `wxVListBoxComboPopup` does on the visible strings and
   * which a native `<select>` was giving us for free.
   */
  const typed = useRef({ text: '', at: 0 });
  const typeAhead = (ch: string, from: number): number => {
    const now = Date.now();
    const t = typed.current;
    // A pause starts a new search rather than extending the last one, so "aa"
    // typed slowly walks the entries beginning with "a" while "ab" typed quickly
    // looks for that prefix.
    const fresh = now - t.at > 1000;
    t.text = fresh ? ch : t.text + ch;
    t.at = now;
    const want = t.text.toLowerCase();
    // One accumulated letter walks the matches from the row after this one; a
    // longer prefix re-searches from where we are.
    const start = t.text.length > 1 ? from : from + 1;
    for (let n = 0; n < items.length; n++) {
      const i = (start + n + items.length * 2) % items.length;
      const o = items[i];
      if (o !== undefined && selectable(o) && o.label.toLowerCase().startsWith(want)) return i;
    }
    return from;
  };

  const commit = (i: number): void => {
    const o = items[i];
    if (o === undefined || !selectable(o)) return;
    onChange(o.value);
  };

  function openList(): void {
    if (items.length === 0) return;
    setHi(index);
    setOpen(true);
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHi((h) => veto(h, h + (e.key === 'ArrowDown' ? 1 : -1)));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        commit(hi);
        close();
      } else if (e.key.length === 1) {
        setHi((h) => typeAhead(e.key, h));
      }
      return;
    }

    // Closed. Down/Up step the value without opening; Enter/Space/Alt+Down open.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.altKey) {
        openList();
        return;
      }
      const to = veto(index, index + (e.key === 'ArrowDown' ? 1 : -1));
      if (to !== index) commit(to);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openList();
    } else if (e.key.length === 1) {
      const to = typeAhead(e.key, index);
      if (to !== index) commit(to);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ze-odcombo${className ? ` ${className}` : ''}`}
        style={style}
        disabled={disabled}
        title={title}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${ids}-list` : undefined}
        aria-activedescendant={open && hi >= 0 ? `${ids}-opt-${hi}` : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {/*
          The closed box is `OnDrawItem` too, with `wxODCB_PAINTING_CONTROL` set
          — one code path, not a second renderer. `selected` is
          `ShouldDrawFocus()`: focused, read-only, popup closed.
        */}
        <span className={`ze-odcombo-text${focused && !open ? ' selected' : ''}`}>
          {current ? draw(current, { control: true, selected: focused && !open }) : ''}
        </span>
        {/* The app's one chevron, the same `.twisty` a `Combo` and the tree pane
            draw; a second arrow glyph here would be a second answer. */}
        <span className="twisty expandable ze-combo-arrow ze-odcombo-arrow" />
      </button>
      {open && (
        <div
          ref={popRef}
          id={`${ids}-list`}
          className="ze-odcombo-popup"
          role="listbox"
          style={
            box
              ? { position: 'fixed', ...box }
              : // The measuring frame: laid out, so `scrollWidth`/`scrollHeight`
                // are real, but never painted.
                { position: 'fixed', left: 0, top: 0, visibility: 'hidden' }
          }
        >
          {items.map((o, i) => {
            const sep = isSeparator(o);
            const isHi = i === hi;
            return (
              <div
                // Two rows can carry the same value (a separator's is ''), so the
                // index is the only identity a row has.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={i}
                id={`${ids}-opt-${i}`}
                role={sep ? 'separator' : 'option'}
                aria-selected={sep ? undefined : o.value === value}
                aria-disabled={o.disabled || undefined}
                className={
                  sep
                    ? 'ze-odcombo-sep'
                    : `ze-odcombo-item${isHi ? ' selected' : ''}${o.disabled ? ' disabled' : ''}`
                }
                // `TryVetoMouse` refuses wxEVT_MOTION over a separator, so the
                // highlight does not follow the pointer onto one.
                onMouseMove={() => setHi((h) => veto(h, i))}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!selectable(o)) return;
                  commit(i);
                  close();
                }}
              >
                {sep ? null : draw(o, { control: false, selected: isHi })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
