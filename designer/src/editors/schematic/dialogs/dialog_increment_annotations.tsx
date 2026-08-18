// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Increment Annotations From… Counterpart:
 * `eeschema/dialogs/dialog_increment_annotations_base.cpp`
 * (DIALOG_INCREMENT_ANNOTATIONS) and SCH_EDITOR_CONTROL::IncrementAnnotations.
 *
 * This is how room is made in the middle of an existing run of references:
 * everything from the start reference upward moves up by the increment, so a
 * new part can take the number that was freed. The start reference has to end
 * in a number (or a `?`) — there is nothing to increment otherwise, and
 * upstream simply returns without doing anything.
 */
import { useState, type JSX } from 'react';
import { isSplitNeeded } from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

export interface IncrementAnnotationsResult {
  startRef: string;
  increment: number;
  /** false = current sheet only (the dialog's default). */
  allSheets: boolean;
}

interface Props {
  onOk: (r: IncrementAnnotationsResult) => void;
  onCancel: () => void;
}

export function DialogIncrementAnnotations({ onOk, onCancel }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [startRef, setStartRef] = useState('');
  const [increment, setIncrement] = useState('1');
  const [allSheets, setAllSheets] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const ref = startRef.trim();
    // wxTextValidator( wxFILTER_EMPTY ) on the field, plus IsSplitNeeded's
    // silent bail-out — said out loud here rather than closing on a no-op.
    if (!ref) {
      setError('Enter a start reference designator');
      return;
    }
    if (!isSplitNeeded(ref)) {
      setError(`"${ref}" has no number to increment from`);
      return;
    }
    const n = Math.min(64, Math.max(1, Math.trunc(Number(increment)) || 1));
    onOk({ startRef: ref, increment: n, allSheets });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Increment Annotations From
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {error && (
            <div className="ze-props-error" onClick={() => setError(null)}>
              {error}, click to dismiss
            </div>
          )}
          <label className="row">
            <span>Start reference designator:</span>
            <input
              className="ze-search"
              // biome-ignore lint/a11y/noAutofocus: SetInitialFocus( m_FirstRefDes )
              autoFocus
              value={startRef}
              onChange={(e) => setStartRef(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
          </label>
          <label className="row">
            <span>Increment by:</span>
            <input
              className="ze-search"
              style={{ width: 80 }}
              type="number"
              min={1}
              max={64}
              value={increment}
              onChange={(e) => setIncrement(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <div style={{ height: 10 }} />
          <label className="row">
            <input
              type="radio"
              name="ze-incr-scope"
              checked={!allSheets}
              onChange={() => setAllSheets(false)}
            />
            <span>Current sheet only</span>
          </label>
          <label className="row">
            <input
              type="radio"
              name="ze-incr-scope"
              checked={allSheets}
              onChange={() => setAllSheets(true)}
            />
            <span>All sheets</span>
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
