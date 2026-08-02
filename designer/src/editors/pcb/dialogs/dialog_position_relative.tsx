// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Position Relative To.
 * Counterpart: `pcbnew/dialogs/dialog_position_relative.cpp`.
 *
 * The arithmetic lives in pcbnew (position_relative.ts) where it is tested;
 * this chooses the reference point and reads the offset.
 *
 * Unlike Move Exactly this dialog states where the selection will *land*, so it
 * shows the reference it is measuring from — a wrong reference silently gives a
 * plausible wrong answer, and upstream keeps that line visible for the same
 * reason.
 */
import { useState, type JSX, type Ref } from 'react';
import { polarTranslation } from '@ziroeda/pcbnew';
import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';

/** `DIALOG_POSITION_RELATIVE::ANCHOR_TYPE`, less the interactive point picker. */
export type PositionReferenceKind = 'gridOrigin' | 'userOrigin' | 'item';

export interface PositionRelativeValues {
  reference: { x: number; y: number };
  offset: { x: number; y: number };
}

interface Props {
  gridOrigin: { x: number; y: number };
  userOrigin: { x: number; y: number };
  /**
   * The item the user last clicked, if any, as the "reference item" option.
   * Null disables that option rather than hiding it, so the dialog does not
   * change shape depending on what happened before it opened.
   */
  referenceItem: { label: string; at: { x: number; y: number } } | null;
  /** Arm the canvas picker — upstream's "Select Item..." button. */
  onPick: () => void;
  onApply: (values: PositionRelativeValues) => void;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

const mm = (v: number): string =>
  iuToMM(v)
    .toFixed(4)
    .replace(/\.?0+$/, '');

export function DialogPositionRelative({
  gridOrigin,
  userOrigin,
  referenceItem,
  onPick,
  onApply,
  onClose,
  rootRef,
}: Props): JSX.Element {
  const [kind, setKind] = useState<PositionReferenceKind>(referenceItem ? 'item' : 'gridOrigin');
  const [polar, setPolar] = useState(false);
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');

  const num = (s: string): number => {
    const v = Number.parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  };

  const reference =
    kind === 'gridOrigin'
      ? gridOrigin
      : kind === 'userOrigin'
        ? userOrigin
        : (referenceItem?.at ?? gridOrigin);

  // In polar mode X is a distance in mm and Y a bearing in degrees.
  const offset = polar
    ? polarTranslation(mmToIU(num(x)), num(y))
    : { x: mmToIU(num(x)), y: mmToIU(num(y)) };

  const option = (id: PositionReferenceKind, label: string, disabled = false): JSX.Element => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="radio"
        name="posrel-ref"
        checked={kind === id}
        disabled={disabled}
        onChange={() => setKind(id)}
      />
      {label}
    </label>
  );

  const field = (label: string, value: string, set: (s: string) => void, unit: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 68, textAlign: 'right' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{ width: 96, fontSize: 12, padding: '2px 4px' }}
      />
      <span style={{ width: 26, opacity: 0.7 }}>{unit}</span>
      <button type="button" onClick={() => set('0')} title="Reset to zero">
        ⨯
      </button>
    </label>
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        top: 80,
        left: 120,
        width: 350,
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
        Position Relative To Reference Item
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {option('gridOrigin', 'Use grid origin')}
        {option('userOrigin', 'Use local coordinates origin')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {option('item', 'Use reference item', !referenceItem)}
          <button type="button" onClick={onPick}>
            Select Item…
          </button>
        </div>

        <div style={{ fontSize: 11.5, opacity: 0.75 }}>
          {kind === 'item'
            ? `Reference item: ${referenceItem?.label ?? '<none selected>'}`
            : `Reference location: (${mm(reference.x)}, ${mm(reference.y)}) mm`}
        </div>

        <div style={{ height: 2 }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={polar} onChange={(e) => setPolar(e.target.checked)} />
          Use polar coordinates
        </label>

        {field(polar ? 'Distance:' : 'Offset X:', x, setX, 'mm')}
        {field(polar ? 'Angle:' : 'Offset Y:', y, setY, polar ? '°' : 'mm')}
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
        <button type="button" onClick={() => onApply({ reference, offset })}>
          OK
        </button>
      </div>
    </div>
  );
}
