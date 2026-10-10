// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Modeless Find dialog for the board editor. Counterpart:
 * `pcbnew/dialogs/dialog_find.cpp` (DIALOG_FIND / dialog_find_base.cpp), the
 * same controls in the same order: the search combo, then Match case, Whole
 * words only, Wildcards, Wrap; the include-scope checkboxes (footprint
 * reference designators, footprint values, other text items, net names, DRC
 * markers greyed until DRC lands); Find Next / Find Previous / Restart Search /
 * Close, with a status line. Enter = Find Next, Shift+Enter = Find Previous,
 * Esc = close.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { DIALOG_FIND, FIND_OPTIONS } from './dialog_find.js';

interface Props {
  /** The live DIALOG_FIND this window draws. */
  dialog: DIALOG_FIND;
  onClose: () => void;
}

export function DialogPcbFind({ dialog, onClose }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(dialog.m_searchString);
  // The dialog's own state changes under its handlers; the window redraws after each.
  const [, setTick] = useState(0);
  const redraw = (): void => setTick((t) => t + 1);
  const options = dialog.m_options;
  const status = dialog.m_status;
  const onFind = (dir: 'next' | 'prev' | 'restart'): void => {
    if (dir === 'next') dialog.OnFindNext();
    else if (dir === 'prev') dialog.OnFindPrevious();
    else dialog.OnSearchAgain();
    redraw();
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commitText = (value: string): void => {
    setText(value);
    dialog.SetSearchString(value);
  };
  // `onOptionChanged`: any checkbox makes the hit list stale.
  const opt = (patch: Partial<FIND_OPTIONS>): void => {
    dialog.SetOptions({ ...options, ...patch });
    redraw();
  };

  return (
    <div className="ze-modal ze-find-dialog" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ze-modal-header">
        Find
        <span className="x" onClick={onClose}>
          ✕
        </span>
      </div>
      <div className="ze-find-body">
        {/* topSizer: left column (grows) + button column (right) */}
        <div className="ze-find-top">
          <div className="ze-find-left">
            {/* bSizer8: "Search for:" label + combo */}
            <label className="ze-find-searchrow">
              <span>Search for:</span>
              <input
                ref={inputRef}
                className="ze-search"
                value={text}
                placeholder="Text with optional wildcards"
                onChange={(e) => commitText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onFind(e.shiftKey ? 'prev' : 'next');
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onClose();
                  }
                }}
              />
            </label>
            {/* sizerOptions: modifiers spread horizontally */}
            <div className="ze-find-modifiers">
              <label>
                <input
                  type="checkbox"
                  checked={options.matchCase}
                  onChange={(e) => opt({ matchCase: e.target.checked })}
                />
                Match case
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.matchWords}
                  onChange={(e) => opt({ matchWords: e.target.checked })}
                />
                Whole words only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.wildcards}
                  onChange={(e) => opt({ wildcards: e.target.checked })}
                />
                Wildcards
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.wrap}
                  onChange={(e) => opt({ wrap: e.target.checked })}
                />
                Wrap
              </label>
            </div>
            {/* sizerInclude: wxFlexGridSizer( 0, 2 ), 2-column scope grid */}
            <div className="ze-find-scope">
              <label>
                <input
                  type="checkbox"
                  checked={options.includeReferences}
                  onChange={(e) => opt({ includeReferences: e.target.checked })}
                />
                Search footprint reference designators
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.includeMarkers}
                  onChange={(e) => opt({ includeMarkers: e.target.checked })}
                />
                Search DRC markers
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.includeValues}
                  onChange={(e) => opt({ includeValues: e.target.checked })}
                />
                Search footprint values
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.includeNets}
                  onChange={(e) => opt({ includeNets: e.target.checked })}
                />
                Search net names
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.checkAllFields}
                  onChange={(e) => opt({ checkAllFields: e.target.checked })}
                />
                Include hidden fields
              </label>
              <span />
              <label>
                <input
                  type="checkbox"
                  checked={options.includeTexts}
                  onChange={(e) => opt({ includeTexts: e.target.checked })}
                />
                Search other text items
              </label>
            </div>
          </div>
          {/* buttonSizer: vertical stack, right side */}
          <div className="ze-find-buttons">
            <button type="button" className="primary" onClick={() => onFind('next')}>
              Find Next
            </button>
            <button type="button" onClick={() => onFind('prev')}>
              Find Previous
            </button>
            <button type="button" onClick={() => onFind('restart')}>
              Restart Search
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="ze-find-sep" />
        {/* sizerStatus: status text + "Show search panel" link */}
        <div className="ze-find-status">
          <span className="status">{status}</span>
          <span
            className="ze-find-panellink"
            onClick={() => {
              dialog.OnShowSearchPanel();
              onClose();
            }}
          >
            Show search panel
          </span>
        </div>
      </div>
    </div>
  );
}
