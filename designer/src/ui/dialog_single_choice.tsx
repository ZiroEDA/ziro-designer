// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxGetSingleChoice( message, caption, choices )` — the stock "pick one from a
 * list" dialog. `pcb_calculator` raises it from five places: the two `...`
 * buttons on Cable Size (`panel_cable_size.cpp:238,262`), the two on Via Size
 * (`panel_via_size.cpp:88,101`) and Remove Regulator
 * (`panel_regulator.cpp:292`). One shared component, because wx has one dialog.
 *
 * KiCad's lists are `"<value> \t<name>"` strings and the caller takes
 * `.BeforeFirst( ' ' )`, so a row shows both halves and the answer is the value.
 */
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { OK_LABEL } from './message_dialog.js';
import { useModalEscape } from './useModalEscape.js';

export interface SingleChoiceRow {
  /** What the caller receives — KiCad's `BeforeFirst(' ')`. */
  value: string;
  /** The whole row as it appears in the list. */
  label: string;
}

export function SingleChoiceDialog({
  caption,
  message,
  choices,
  onResult,
}: {
  caption: string;
  /** wxGetSingleChoice's first argument; pcb_calculator passes empty for most. */
  message?: string;
  choices: readonly SingleChoiceRow[];
  /** `null` when the dialog is cancelled, which is an empty string in wx. */
  onResult: (value: string | null) => void;
}): JSX.Element {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useModalEscape(() => onResult(null));
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const accept = (i: number): void => onResult(choices[i]?.value ?? null);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-choicedlg" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-choicedlg-body">
          {message && <div className="ze-choicedlg-message">{message}</div>}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the list IS the control. */}
          <div
            ref={listRef}
            className="ze-choicedlg-list"
            role="listbox"
            tabIndex={0}
            aria-label={caption}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(choices.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                accept(index);
              }
            }}
          >
            {choices.map((c, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox owns the keys.
              <div
                key={c.value + c.label}
                role="option"
                aria-selected={i === index}
                className={`ze-choicedlg-item${i === index ? ' selected' : ''}`}
                onClick={() => setIndex(i)}
                onDoubleClick={() => accept(i)}
              >
                {c.label}
              </div>
            ))}
          </div>
        </div>
        <div className="ze-msgdlg-buttons">
          <button type="button" className="ze-btn" onClick={() => onResult(null)}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={() => accept(index)}>
            {OK_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
