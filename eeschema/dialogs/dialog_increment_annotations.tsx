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
import { Button, RadioButton } from '@ziroeda/common/wx/controls.js';
import { useState, type JSX } from 'react';
import { isSplitNeeded } from '../index.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';

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
    <DialogShim title="Increment Annotations From" onClose={onCancel} className="ze-label-dialog">
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
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
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
        <RadioButton
          label="Current sheet only"
          name="ze-incr-scope"
          checked={!allSheets}
          className="row"
          onChange={() => setAllSheets(false)}
        />
        <RadioButton
          label="All sheets"
          name="ze-incr-scope"
          checked={allSheets}
          className="row"
          onChange={() => setAllSheets(true)}
        />
      </div>
      <div className="ze-modal-footer">
        <Button label="Cancel" onClick={onCancel} />
        <Button label="OK" isDefault onClick={submit} />
      </div>
    </DialogShim>
  );
}
