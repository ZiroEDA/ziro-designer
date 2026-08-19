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
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { popupTop } from './combo_popup.js';

export interface ComboOption {
  /** Value handed back to `onChange`. */
  value: string;
  label: string;
  disabled?: boolean;
}

export function Combo({
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
        onClick={() => setOpen((v) => !v)}
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
            setOpen(true);
          }
        }}
      >
        <span className="ze-combo-value">{selected?.label ?? ''}</span>
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
              {o.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
