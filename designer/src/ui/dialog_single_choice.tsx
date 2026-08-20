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
 *
 * DELIBERATE DIVERGENCE (Akshay, 2026-08-20). Upstream renders that string as
 * one label, so GTK advances the embedded tab to Pango's next default tab stop
 * and the name column lands wherever the value's own width leaves it: in
 * `StandardResistivityList()` the six-character values (2.4e-8, 6.9e-8, 3.9e-8)
 * stop one place short of the seven-character ones (1.72e-8, 12.4e-8), so the
 * real dialog is ragged. We split the row at the tab and give the list a real
 * two-column grid instead, so every name starts at the same x. This is the one
 * place in the launcher where we knowingly look better than the binary.
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
  showCancel = true,
}: {
  caption: string;
  /** wxGetSingleChoice's first argument; pcb_calculator passes empty for most. */
  message?: string;
  choices: readonly SingleChoiceRow[];
  /** `null` when the dialog is cancelled, which is an empty string in wx. */
  onResult: (value: string | null) => void;
  /**
   * The `wxCANCEL` bit of the dialog's style.
   *
   * `wxCHOICEDLG_STYLE` is
   * `wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER | wxOK | wxCANCEL | wxCENTRE`
   * (`wx/generic/choicdgg.h:26-27`), which is what `wxGetSingleChoice` passes
   * and what pcb_calculator's five call sites get. GerbView's List DCodes
   * masks the bit off — `wxCHOICEDLG_STYLE & ~wxCANCEL`
   * (`gerbview/tools/gerbview_inspection_tool.cpp:145-146`) — because the list
   * is a report and there is nothing to cancel.
   */
  showCancel?: boolean;
}): JSX.Element {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Two columns only when every row actually carries the tab; "Remove
  // Regulator" passes bare names and must stay a plain list.
  const columns = choices.length > 0 && choices.every((c) => c.label.includes('\t'));

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
            className={`ze-choicedlg-list${columns ? ' cols' : ''}`}
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
            {choices.map((c, i) => {
              // The tab is the column break KiCad wrote into the string.
              const tab = c.label.indexOf('\t');
              const head = tab < 0 ? c.label : c.label.slice(0, tab).trimEnd();
              const tail = tab < 0 ? '' : c.label.slice(tab + 1);
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox owns the keys.
                <div
                  key={c.value + c.label}
                  role="option"
                  aria-selected={i === index}
                  className={`ze-choicedlg-item${i === index ? ' selected' : ''}${
                    columns ? ' cols' : ''
                  }`}
                  onClick={() => setIndex(i)}
                  onDoubleClick={() => accept(i)}
                >
                  {columns ? (
                    <>
                      <span>{head}</span>
                      <span>{tail}</span>
                    </>
                  ) : (
                    c.label
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* wxStdDialogButtonSizer, not the message dialog's split bar. */}
        <div className="ze-choicedlg-buttons">
          {showCancel && (
            <button type="button" className="ze-btn" onClick={() => onResult(null)}>
              Cancel
            </button>
          )}
          <button type="button" className="ze-btn" onClick={() => accept(index)}>
            {OK_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
