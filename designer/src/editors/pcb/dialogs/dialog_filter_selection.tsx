// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Filter Selection.
 * Counterpart: `pcbnew/dialogs/dialog_filter_selection.cpp`.
 *
 * The predicate and the tri-state live in pcbnew (filter_selection.ts) where
 * they are tested; this is the checkbox panel over them.
 *
 * "All items" is genuinely tri-state, and its indeterminate reading is not a
 * quirk to smooth over: with the locked-footprints box counted, the dialog's
 * own default of seven-of-eight opens as mixed, which is what upstream shows.
 */
import type { JSX, Ref } from 'react';
import { allItemsState, type SelectionFilter, setAllFilterItems } from '@ziroeda/pcbnew';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  filter: SelectionFilter;
  onChange: (next: SelectionFilter) => void;
  /** How many items the current filter would keep, for the footer. */
  matchCount: number;
  onApply: () => void;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

export function DialogFilterSelection({
  filter,
  onChange,
  matchCount,
  onApply,
  onClose,
  rootRef,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const all = allItemsState(filter);

  const box = (
    key: keyof SelectionFilter,
    label: string,
    opts: { indent?: boolean; disabled?: boolean } = {},
  ): JSX.Element => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 0',
        marginLeft: opts.indent ? 20 : 0,
        fontSize: 12,
        opacity: opts.disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={filter[key]}
        disabled={opts.disabled}
        onChange={(e) => onChange({ ...filter, [key]: e.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        top: 80,
        left: 120,
        width: 300,
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
        Filter Selected Items
      </div>

      <div style={{ padding: '8px 12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={all === 'checked'}
            ref={(el) => {
              // The indeterminate state is a DOM property, not an attribute,
              // so React cannot set it from JSX.
              if (el) el.indeterminate = all === 'mixed';
            }}
            onChange={(e) => onChange(setAllFilterItems(e.target.checked))}
          />
          All items
        </label>

        <div style={{ height: 6 }} />

        {box('footprints', 'Footprints')}
        {/* A sub-option of the box above, and disabled while it is off — the
            same shape upstream gives it. */}
        {box('lockedFootprints', 'Include locked footprints', {
          indent: true,
          disabled: !filter.footprints,
        })}
        {box('tracks', 'Tracks')}
        {box('vias', 'Vias')}
        {box('zones', 'Zones')}
        {box('techLayers', 'Graphics on technical layers')}
        {box('boardOutline', 'Graphics on Edge.Cuts')}
        {box('text', 'Text')}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderTop: '1px solid var(--chrome-border)',
        }}
      >
        <span style={{ fontSize: 11.5, opacity: 0.75 }}>
          {matchCount === 1 ? '1 item kept' : `${matchCount} items kept`}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onApply}>
            OK
          </button>
        </span>
      </div>
    </div>
  );
}
