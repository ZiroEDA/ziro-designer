// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `wxChoice` — the drop-down every KiCad frame uses for a fixed list.
 *
 * This exists because a native `<select>`'s option list is drawn by the
 * operating system, not by the page, and therefore cannot be themed at all.
 * Measured side by side against a real `bitmap2component` at the same combo:
 *
 *                       KiCad            ours (native select)
 *   popup background    rgb(29,29,29)    rgb(44,44,44)
 *   highlighted row     rgb(62,62,62)    rgb(153,200,255)   <- Chrome's own blue
 *   popup border        rgb(75,75,75)    (none)
 *
 * The blue is Chrome's native highlight and no stylesheet reaches it. The only
 * way to match KiCad is to draw the list ourselves, which is what this does.
 * The colours below are the same `#1d1d1d` / `#4b4b4b` the menu drop-downs
 * already use — one palette, not a second one invented here.
 *
 * The other half of the difference is placement. A native select drops its list
 * *below* the closed box. GTK's `wxChoice` opens the list **over** the box, with
 * the currently-selected row sitting on top of it, so the value you are looking
 * at does not move when the list appears. That is what `popupTop` computes.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MutableRefObject,
  type Ref,
} from 'react';

// ---- wxChoice's popup placement (was wx_combobox_popup.ts) ----
/**
 * Where a `Combo`'s drop-down list opens.
 *
 * Split out of `Combo.tsx` because this is the only part of the widget that can
 * be tested without a DOM, and the test environment cannot reach into a `.tsx`.
 */

/**
 * Row height and vertical padding, kept here so `popupTop` and the CSS agree.
 *
 * 30, not the 26 of a GtkMenu row. A `wxChoice`'s popup is not a menu and does
 * not use menu metrics: measured on a real `pcb_calculator` combo, the
 * highlighted row spans y=40..69 inside a content box of y=6..73 with 4px of
 * padding, i.e. 30px per row. Ours was 26 because the value was taken from the
 * drop-down menus next door.
 */
export const ROW_H = 30;
export const PAD_Y = 4;

/**
 * The popup's top edge, in viewport coordinates.
 *
 * GTK's `wxChoice` opens its list *over* the closed box with the selected row
 * covering it, so the value you are reading does not move when the list appears
 * — unlike a native `<select>`, which drops the list below the box. Off-screen
 * at either end the list slides back in rather than opening partly out of view,
 * which is why a long list selected near its bottom still shows whole.
 *
 * @param buttonTop      top of the closed box, viewport coordinates
 * @param index          index of the selected row
 * @param count          number of rows
 * @param viewportHeight `window.innerHeight`
 */
export function popupTop(
  buttonTop: number,
  index: number,
  count: number,
  viewportHeight: number,
): number {
  const height = count * ROW_H + PAD_Y * 2;
  const wanted = buttonTop - PAD_Y - index * ROW_H;
  return Math.max(4, Math.min(wanted, viewportHeight - 4 - height));
}

export interface ComboOption {
  /** Value handed back to `onChange`. */
  value: string;
  label: string;
  disabled?: boolean;
  /**
   * A colour swatch drawn before the label, which is the second argument of
   * `Append( name, wxBitmapBundle::FromBitmaps( bitmaps ), ... )` in
   * `GBR_LAYER_BOX_SELECTOR::Resync` (`gerbview/widgets/gbr_layer_box_selector.cpp:105`).
   * The bitmap is `LAYER_PRESENTATION::DrawColorSwatch`
   * (`common/widgets/layer_presentation.cpp:36-62`): the canvas background
   * filled opaque, the layer colour over it, and a 1 px black outline.
   *
   * It lives on the shared option rather than in GerbView because the widget
   * is shared — `PCB_LAYER_BOX_SELECTOR` draws its entries with the same
   * `LAYER_PRESENTATION` call.
   *
   * Pass an opaque colour: our layer colours have no alpha, so filling with it
   * is what blending it over the background would produce anyway.
   */
  swatch?: string;
  /**
   * A KiCad bitmap drawn before the label — the same second argument of
   * `Append( name, KiBitmapBundle( ... ) )` that `swatch` models, for the
   * combos whose entries carry an icon rather than a colour. A
   * `wxBitmapComboBox` is exactly a wxChoice that draws one:
   * `m_borderStyleCombo->Append( lineStyleDesc.name, KiBitmapBundle( lineStyleDesc.bitmap ) )`
   * (dialog_shape_properties.cpp:61) over `lineTypeNames`
   * (common/stroke_params.cpp:39-45).
   *
   * The value is the image itself (a URL): the caller makes it, as KiCad's
   * caller makes the bundle with `KiBitmapBundle` (here `bitmapUrl`).
   */
  bitmap?: string;
  /**
   * A specimen drawn AFTER the label in another face — `FONT_CHOICE::
   * OnDrawItem` (common/widgets/font_choice.cpp:336-370): the name in the GUI
   * font, then for every installed face "AaBbCcDd123456" 15 px to its right
   * in that face, at the GUI size, in GRAYTEXT (the highlight text colour on
   * the selected row). Only the popup rows carry it; the closed box shows the
   * name alone, as a wxOwnerDrawnComboBox's text control does.
   */
  sample?: { text: string; fontFamily: string };
}

export function Combo({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
  style,
  title,
  ariaLabel,
  autoFocus,
}: {
  /**
   * Forwarded to the button, so a `<label htmlFor>` beside it still points at
   * its control. A wxChoice is always paired with a wxStaticText upstream and
   * the two grey together; without this the association silently dangles.
   */
  id?: string;
  value: string;
  options: readonly ComboOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Layout only — the look belongs to `.ze-combo`, never to a call site. */
  style?: CSSProperties;
  title?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[index];

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const top = popupTop(r.top, index, options.length, window.innerHeight);
    setBox({ left: r.left, top, width: r.width });
  }, [open, index, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // A popped-up list takes the key; the frame behind must not also act.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // An EMPTY wxChoice does not open. GTK drops the popup only when the model
  // has rows, so clicking a choice with nothing in it - the Regulators
  // selector before a data file is loaded - does nothing at all. Ours opened
  // an empty box.
  const canOpen = options.length > 0;

  const step = (delta: number): void => {
    for (let i = index + delta; i >= 0 && i < options.length; i += delta) {
      const o = options[i];
      if (o && !o.disabled) {
        onChange(o.value);
        return;
      }
    }
  };

  return (
    <>
      <button
        id={id}
        ref={btnRef}
        type="button"
        className={`ze-combo${className ? ` ${className}` : ''}`}
        style={style}
        // biome-ignore lint/a11y/noAutofocus: wxDialog focuses its first control.
        autoFocus={autoFocus}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-empty={canOpen ? undefined : ''}
        onClick={() => setOpen((v) => canOpen && !v)}
        onKeyDown={(e) => {
          // wxChoice answers the arrows without opening; Enter/Space opens.
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            step(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            step(-1);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (canOpen) setOpen(true);
          }
        }}
      >
        {/* A wxChoice takes its width from the WIDEST entry in its model, not
            from the selection - which is why an empty one is still as wide as
            its list would be and why KiCad's "mm" selector is 94 px, not 58.
            The ghosts are laid over the shown value and only set the width. */}
        {/* Outside .ze-combo-value, which is a grid stacking every entry in
            ONE cell to size the box; a swatch in there would stack with them. */}
        {selected?.swatch !== undefined && (
          <span className="ze-combo-swatch" style={{ background: selected.swatch }} />
        )}
        {selected?.bitmap !== undefined && (
          <img className="ze-combo-bitmap" src={selected.bitmap} alt="" />
        )}
        <span className="ze-combo-value">
          <span className="ze-combo-shown">{selected?.label ?? ''}</span>
          {options.map((o) => (
            <span key={o.value} className="ze-combo-ghost" aria-hidden="true">
              {o.label}
            </span>
          ))}
        </span>
        <span className="twisty expandable ze-combo-arrow" />
      </button>
      {open && box && (
        <div
          ref={popRef}
          className="ze-combo-popup"
          role="listbox"
          style={{ position: 'fixed', left: box.left, top: box.top, minWidth: box.width }}
        >
          {options.map((o) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`ze-combo-item${o.value === value ? ' selected' : ''}${
                o.disabled ? ' disabled' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (o.disabled) return;
                onChange(o.value);
                setOpen(false);
                btnRef.current?.focus();
              }}
            >
              {o.swatch !== undefined && (
                <span className="ze-combo-swatch" style={{ background: o.swatch }} />
              )}
              {o.bitmap !== undefined && <img className="ze-combo-bitmap" src={o.bitmap} alt="" />}
              {o.label}
              {o.sample !== undefined && (
                <span className="ze-combo-sample" style={{ fontFamily: o.sample.fontFamily }}>
                  {o.sample.text}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** WX_COMBOBOX's SEPARATOR (common/widgets/wx_combobox.cpp). */
export const WX_COMBOBOX_SEPARATOR = '---';

/**
 * A `wxComboBox` — the editable one: a text entry the user types into, with a drop-down of
 * suggestions beside it (the sheet pin's names, a label's existing values). Its list is drawn
 * with the wxChoice popup's own classes, but it opens BELOW the entry, as GTK's combobox entry
 * does, since the entry's text is what the user is looking at.
 */
export function TextCombo({
  value,
  options,
  onChange,
  onSelect,
  onEnter,
  className,
  title,
  autoFocus,
  ariaLabel,
  menuText,
  disabled,
  inputRef: aInputRef,
}: {
  value: string;
  /** The suggestions; picking one replaces the entry's text. */
  options: readonly string[];
  /**
   * WX_COMBOBOX's `m_menuText`: what the list shows for option i, when that differs from the
   * text it puts in the entry ("Page 2 (power)" for "#2"). A menu text of "---" is
   * WX_COMBOBOX's SEPARATOR: an 11 px rule that cannot be picked.
   */
  menuText?: readonly (string | undefined)[];
  onChange: (value: string) => void;
  /** `wxEVT_COMBOBOX`: a suggestion picked from the list (after `onChange`), never typing. */
  onSelect?: (value: string) => void;
  /** Enter in the entry: the dialog's default button. */
  onEnter?: () => void;
  className?: string;
  title?: string;
  autoFocus?: boolean;
  /** The entry's accessible name: its wxStaticText label. */
  ariaLabel?: string;
  /** `Enable( false )`: the entry and its button. */
  disabled?: boolean;
  /** The entry, e.g. as a dialog's `SetInitialFocus( m_valueCombo->GetTextCtrl() )`. */
  inputRef?: Ref<HTMLInputElement>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.bottom, width: r.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  return (
    <>
      <span ref={wrapRef} className={`ze-textcombo${className ? ` ${className}` : ''}`}>
        <input
          ref={(el) => {
            (inputRef as MutableRefObject<HTMLInputElement | null>).current = el;
            if (typeof aInputRef === 'function') aInputRef(el);
            else if (aInputRef)
              (aInputRef as MutableRefObject<HTMLInputElement | null>).current = el;
          }}
          value={value}
          title={title}
          disabled={disabled}
          aria-label={ariaLabel}
          // biome-ignore lint/a11y/noAutofocus: wxDialog focuses its first control.
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' && open) {
              e.preventDefault();
              setOpen(false);
            } else if (e.key === 'ArrowDown' && options.length > 0) {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === 'Enter') {
              setOpen(false);
              // wxTE_PROCESS_ENTER: an entry with its own Enter takes the key; without one,
              // Enter goes on to the dialog's default button (GTK's activates-default).
              if (onEnter) {
                e.preventDefault();
                onEnter();
              }
            }
          }}
        />
        <button
          type="button"
          className="ze-textcombo-button"
          tabIndex={-1}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled || options.length === 0}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="twisty expandable ze-combo-arrow" />
        </button>
      </span>
      {open && box && (
        <div
          ref={popRef}
          className="ze-combo-popup"
          role="listbox"
          style={{ position: 'fixed', left: box.left, top: box.top, minWidth: box.width }}
        >
          {options.map((o, i) => {
            const text = menuText?.[i] ?? o;
            // TryVetoMouse / TryVetoSelect: a click on the separator is swallowed.
            if (text === WX_COMBOBOX_SEPARATOR)
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is static per open.
                  key={i}
                  role="separator"
                  className="ze-combo-separator"
                  onMouseDown={(e) => e.preventDefault()}
                />
              );
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is static per open.
                key={i}
                role="option"
                aria-selected={o === value}
                className={`ze-combo-item${o === value ? ' selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o);
                  onSelect?.(o);
                  setOpen(false);
                  inputRef.current?.focus();
                }}
              >
                {text}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
