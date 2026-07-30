// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The "Select Columns" dialog behind a library tree's header context menu.
 * Mirrors kicad/common/dialogs/eda_reorderable_list_dialog.cpp
 * (EDA_REORDERABLE_LIST_DIALOG): an Available list on the left, an Enabled list
 * on the right, ">" / "<" between them and Move up / Move down beside the
 * enabled list.
 */
import { useState } from 'react';

export interface SelectColumnsDialogProps {
  /** Every column the tree can show (m_availableItems). */
  available: readonly string[];
  /** Currently shown columns, in order (m_enabledItems). */
  enabled: readonly string[];
  onOk: (enabled: string[]) => void;
  onCancel: () => void;
}

export function SelectColumnsDialog({
  available,
  enabled,
  onOk,
  onCancel,
}: SelectColumnsDialogProps): JSX.Element {
  const [enabledList, setEnabledList] = useState<string[]>([...enabled]);
  const [selAvailable, setSelAvailable] = useState<string | null>(null);
  const [selEnabled, setSelEnabled] = useState<string | null>(null);

  // updateItems: the available list shows only what isn't enabled yet.
  const availableList = available.filter((c) => !enabledList.includes(c));

  const add = () => {
    if (!selAvailable) return;
    setEnabledList((prev) => [...prev, selAvailable]);
    setSelEnabled(selAvailable);
    setSelAvailable(null);
  };

  const remove = () => {
    // "Item" is always shown, so it can never be moved back to available.
    if (!selEnabled || selEnabled === 'Item') return;
    setEnabledList((prev) => prev.filter((c) => c !== selEnabled));
    setSelAvailable(selEnabled);
    setSelEnabled(null);
  };

  const move = (delta: number) => {
    if (!selEnabled) return;
    setEnabledList((prev) => {
      const idx = prev.indexOf(selEnabled);
      const next = idx + delta;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const out = [...prev];
      out.splice(idx, 1);
      out.splice(next, 0, selEnabled);
      return out;
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal ze-select-columns"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <div className="ze-modal-header">
          Select Columns
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-reorderable">
          <div className="ze-reorderable-col">
            <label>Available:</label>
            <div className="ze-reorderable-list">
              {availableList.map((c) => (
                <div
                  key={c}
                  className={`row${c === selAvailable ? ' active' : ''}`}
                  onClick={() => setSelAvailable(c)}
                  onDoubleClick={() => {
                    setSelAvailable(c);
                    setEnabledList((prev) => [...prev, c]);
                  }}
                >
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div className="ze-reorderable-buttons">
            <button type="button" className="ze-btn" title="Add" onClick={add}>
              &gt;
            </button>
            <button type="button" className="ze-btn" title="Remove" onClick={remove}>
              &lt;
            </button>
          </div>
          <div className="ze-reorderable-col wide">
            <label>Enabled:</label>
            <div className="ze-reorderable-list">
              {enabledList.map((c) => (
                <div
                  key={c}
                  className={`row${c === selEnabled ? ' active' : ''}`}
                  onClick={() => setSelEnabled(c)}
                >
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div className="ze-reorderable-buttons">
            <button type="button" className="ze-btn" title="Move up" onClick={() => move(-1)}>
              ▲
            </button>
            <button type="button" className="ze-btn" title="Move down" onClick={() => move(1)}>
              ▼
            </button>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={() => onOk(enabledList)}>
            OK
          </button>
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
