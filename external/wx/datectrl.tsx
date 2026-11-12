// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets (wxWindows Library Licence).
/**
 * `wxDatePickerCtrl` (wx/datectrl.h), wxDP_DEFAULT on GTK: an entry holding the date with its own
 * drop-down button beside it that opens the calendar. The browser's in-field calendar glyph is
 * hidden and the button takes its place, so the control has GTK's two parts.
 */
import { type JSX, useRef } from 'react';
import { _ } from './translation.js';

export function DatePickerCtrl({
  value,
  onChange,
  ariaLabel,
}: {
  /** `GetValue()`, as an ISO date (YYYY-MM-DD). */
  value: string;
  /** wxEVT_DATE_CHANGED. */
  onChange: (aIsoDate: string) => void;
  ariaLabel?: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <span className="ze-datepicker">
      <input
        ref={inputRef}
        className="ze-search"
        type="date"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="ze-btn"
        aria-label={_('Pick a date')}
        onClick={() => inputRef.current?.showPicker?.()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3.5 L5 7 L9 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </span>
  );
}
