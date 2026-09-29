// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxSearchCtrl` as wxGTK builds it: a `GtkSearchEntry`, i.e. an entry with an
 * icon slot at each end.
 *
 * `LIB_TREE` hangs a recent-searches menu and a cancel button off its one
 * (`lib_tree.tsx` keeps that richer control); the plain one here is what the
 * two library browsers build — `new wxSearchCtrl( ... )` then
 * `SetDescriptiveText( _( "Filter" ) )` and nothing else
 * (`footprint_viewer_frame.cpp:141-163`). No `ShowCancelButton( true )`, so the
 * secondary slot stays empty.
 *
 * The entry is the shared `.ze-search`; the slots are the shared
 * `.ze-libtree-entry` / `.ze-entry-icon` rules, so the glyph sits where the
 * probe measured it and the text starts past it. The wrapper's own flex is its
 * caller's sizer proportion and is set there.
 */
import type { JSX, KeyboardEvent, Ref } from 'react';

/**
 * The two icons a `wxSearchCtrl` shows.
 *
 * KiCad draws NEITHER of them. `LIB_TREE` asks for a `wxSearchCtrl` and calls
 * `ShowCancelButton( true )` (common/widgets/lib_tree.cpp:79-81); on GTK3 that
 * is a `GtkSearchEntry`, and the two glyphs it puts in its primary and
 * secondary icon slots come from the ICON THEME - `edit-find-symbolic` and
 * `edit-clear-symbolic`. `qa/probes/chooser_shell_probe.cpp` asks a real one:
 *
 *   primary   edit-find-symbolic    16x16 at x 9   of a 34px-tall entry
 *   secondary edit-clear-symbolic   16x16 at x 385 of a 410px-wide entry
 *
 * so both are 16x16 inset 9px from their end. The active theme here is
 * Yaru-dark, whose icons live in /usr/share/icons/Yaru/scalable/actions/; the
 * path data below is those two files verbatim, with the theme's own `gray` /
 * `#808080` fill replaced by `currentColor` because GTK recolours a symbolic
 * icon to the style's colour (--entry-icon-fg).
 *
 * A generic magnifier and a bare "✕" are what we had, and the clear glyph in
 * particular is not an ✕ at all: it is a backspace-shaped tag with the ✕ inside
 * it, which is the single most recognisable thing in that row.
 */
export function EditFindSymbolic(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 1C3.69 1 1 3.69 1 7s2.69 6 6 6a5.948 5.948 0 0 0 3.664-1.273l2.863 2.863 1.063-1.063-2.863-2.863A5.949 5.949 0 0 0 13 7c0-3.31-2.69-6-6-6zm0 1a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5z"
      />
    </svg>
  );
}

export function EditClearSymbolic(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="m4.9336 3-4.2227 4.2227-0.0039062-0.0039062-0.70703 0.70703 0.0039063 0.0039063-0.0039063 0.0039063 0.70703 0.70703 0.0039062-0.0039062 3.0469 3.0488 1.2422 1.2402v2e-3l0.072266 0.072219h10.928v-10h-11zm0.41406 1h9.6523v8h-9.5117l-4.0703-4.0703zm2.3594 1-0.70703 0.70703 2.2969 2.2969-2.2969 2.2988 0.70703 0.70703 2.2969-2.2988 2.2988 2.2988 0.70703-0.70703-2.2988-2.2988 2.2988-2.2969-0.70703-0.70703-2.2988 2.2969z"
      />
    </svg>
  );
}

export interface WxSearchCtrlProps {
  value: string;
  /** `EVT_TEXT`: every edit, not only Enter. */
  onChange: (value: string) => void;
  /** `SetDescriptiveText`. */
  descriptiveText?: string;
  /** `SetToolTip`. */
  toolTip?: string;
  inputRef?: Ref<HTMLInputElement>;
  onFocus?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  testId?: string;
}

/** One `wxSearchCtrl`: the magnifier in the primary slot, the entry after it. */
export function WxSearchCtrl({
  value,
  onChange,
  descriptiveText,
  toolTip,
  inputRef,
  onFocus,
  onKeyDown,
  autoFocus,
  testId,
}: WxSearchCtrlProps): JSX.Element {
  return (
    <div className="ze-libtree-entry" title={toolTip}>
      <span className="ze-entry-icon left" aria-hidden="true">
        <EditFindSymbolic />
      </span>
      <input
        ref={inputRef}
        className="ze-search"
        type="text"
        placeholder={descriptiveText}
        value={value}
        data-testid={testId}
        // biome-ignore lint/a11y/noAutofocus: wx gives the first control of a new frame the focus
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
