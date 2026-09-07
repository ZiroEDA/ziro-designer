// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The one-number prompt in front of Fillet Lines and Chamfer Lines.
 * Counterparts: `GetRadiusParams` and `GetChamferParams` in
 * `pcbnew/tools/item_modification_routine.cpp`'s callers.
 *
 * Upstream keeps the last value in a function-static, so the dialog reopens on
 * whatever the user typed last rather than on the default. The caller owns that
 * here, which is why the value comes in as a prop.
 *
 * Chamfer takes a set-back per side upstream; this offers one for both, since
 * the asymmetric case has no menu entry of its own and the engine already takes
 * the two separately when it is wanted.
 */
import { useState, type JSX, type Ref } from 'react';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';

interface Props {
  title: string;
  label: string;
  /** Current value in IU. */
  value: number;
  /**
   * The frame's display units. Every distance here is a `UNIT_BINDER`
   * upstream, so it shows and reads the frame's unit rather than millimetres.
   */
  units: StatusUnits;
  onApply: (valueIU: number) => void;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

export function DialogLineModification({
  title,
  label,
  value,
  units,
  onApply,
  onClose,
  rootRef,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [text, setText] = useState(pcbUnitText(value, units));

  // `UNIT_BINDER::GetValue()`, so a `1.5mm` typed into a mils field is honoured.
  const parsed = pcbUnitValue(text, units);
  // A zero or negative radius rounds nothing, and the engine would refuse it
  // anyway — better to say so before the user presses OK.
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        top: 80,
        left: 120,
        width: 280,
        background: 'var(--chrome-bg)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 6,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        zIndex: 40,
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--chrome-border)',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {title}
      </div>

      <div style={{ padding: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 60, textAlign: 'right' }}>{label}</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            // The dialog exists only to take this one value, so the caret
            // belongs here rather than a tab away.
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) onApply(parsed);
              if (e.key === 'Escape') onClose();
            }}
            style={{
              width: 90,
              fontSize: 12,
              padding: '2px 4px',
              color: valid ? undefined : '#e05555',
            }}
          />
          <span className="ze-unit-label">{unitLabel(units)}</span>
        </label>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '8px 10px',
          borderTop: '1px solid var(--chrome-border)',
        }}
      >
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!valid} onClick={() => onApply(parsed)}>
          OK
        </button>
      </div>
    </div>
  );
}
