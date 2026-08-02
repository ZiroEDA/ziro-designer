// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Move Exactly.
 * Counterpart: `pcbnew/dialogs/dialog_move_exact.cpp`.
 *
 * The arithmetic lives in pcbnew (move_exact.ts) where it is tested; this is
 * the entry form over it.
 *
 * The polar checkbox does not add fields, it *reinterprets* the two it already
 * has: X and Y become distance and bearing, and the second unit label changes
 * from mm to degrees. That is upstream's `updateDialogControls`, and it is why
 * the two values are held as plain numbers here rather than as a point.
 */
import { useState, type JSX, type Ref } from 'react';
import { moveKeepsSelectionInBounds, polarTranslation, type RotationAnchor } from '@ziroeda/pcbnew';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';

export interface MoveExactValues {
  translation: { x: number; y: number };
  rotation: number;
  anchor: RotationAnchor;
}

interface Props {
  /** The selection's bounding box, for the out-of-range check. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** How many items are selected — decides which anchor opens preselected. */
  defaultAnchor: RotationAnchor;
  onApply: (values: MoveExactValues) => void;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

/** The four ROTATION_ANCHOR entries, with upstream's wording. */
const ANCHORS: { id: RotationAnchor; label: string }[] = [
  { id: 'itemAnchor', label: 'Rotate around item anchor' },
  { id: 'selectionCenter', label: 'Rotate around selection center' },
  { id: 'userOrigin', label: 'Rotate around local coordinates origin' },
  { id: 'auxOrigin', label: 'Rotate around drill/place origin' },
];

export function DialogMoveExact({
  bbox,
  defaultAnchor,
  onApply,
  onClose,
  rootRef,
}: Props): JSX.Element {
  const [polar, setPolar] = useState(false);
  // Held as typed text, so a half-entered "-" or "1." does not get rewritten
  // under the cursor.
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [rot, setRot] = useState('0');
  const [anchor, setAnchor] = useState<RotationAnchor>(defaultAnchor);

  const num = (s: string): number => {
    const v = Number.parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  };

  // In polar mode X is a distance in mm and Y is a bearing in degrees.
  const translation = polar
    ? polarTranslation(mmToIU(num(x)), num(y))
    : { x: mmToIU(num(x)), y: mmToIU(num(y)) };

  const inRange = !bbox || moveKeepsSelectionInBounds(bbox, translation);

  const field = (
    label: string,
    value: string,
    set: (s: string) => void,
    unit: string,
    invalid = false,
  ): JSX.Element => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 74, textAlign: 'right' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{
          width: 96,
          fontSize: 12,
          padding: '2px 4px',
          color: invalid ? '#e05555' : undefined,
        }}
      />
      <span style={{ width: 26, opacity: 0.7 }}>{unit}</span>
      {/* The Clear buttons upstream puts beside each entry. */}
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
        width: 330,
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
        Move Item
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={polar} onChange={(e) => setPolar(e.target.checked)} />
          Use polar coordinates
        </label>

        {field(polar ? 'Distance:' : 'Move X:', x, setX, 'mm', !inRange)}
        {field(polar ? 'Angle:' : 'Move Y:', y, setY, polar ? '°' : 'mm', !inRange)}
        {field('Rotate:', rot, setRot, '°')}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 74, textAlign: 'right' }}>Anchor:</span>
          <select
            value={anchor}
            onChange={(e) => setAnchor(e.target.value as RotationAnchor)}
            style={{ flex: 1, fontSize: 12 }}
          >
            {ANCHORS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        {!inRange && (
          <div style={{ fontSize: 11.5, color: '#e05555' }}>
            Invalid movement values. Movement would place selection outside of the maximum board
            area.
          </div>
        )}
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
        <button
          type="button"
          disabled={!inRange}
          onClick={() => onApply({ translation, rotation: num(rot), anchor })}
        >
          OK
        </button>
      </div>
    </div>
  );
}
