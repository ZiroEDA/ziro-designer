// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Create Array.
 * Counterpart: `pcbnew/dialogs/dialog_create_array.cpp`.
 *
 * The placement lives in common (array_options.ts) and the settings mapping in
 * array_settings.ts; this is the form over them. Grid and circular are separate
 * pages because their fields have nothing in common — upstream uses a notebook
 * for the same reason.
 */
import { useState, type JSX, type Ref } from 'react';
import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  arrayItemCount,
  arraySettingsValid,
  type ArrayMode,
  type ArraySettings,
} from '../array_settings.js';

interface Props {
  initial: ArraySettings;
  onApply: (settings: ArraySettings) => void;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

const mm = (v: number): string => String(iuToMM(v));

export function DialogCreateArray({ initial, onApply, onClose, rootRef }: Props): JSX.Element {
  const [s, setS] = useState<ArraySettings>(initial);
  // Distances are held as typed text so a half-entered "-" or "1." survives.
  const [text, setText] = useState<Record<string, string>>({
    dx: mm(initial.dxIU),
    dy: mm(initial.dyIU),
    ox: mm(initial.offsetXIU),
    oy: mm(initial.offsetYIU),
    cx: mm(initial.centreXIU),
    cy: mm(initial.centreYIU),
  });

  const num = (t: string): number => {
    const v = Number.parseFloat(t);
    return Number.isFinite(v) ? v : 0;
  };

  const resolved = (): ArraySettings => ({
    ...s,
    dxIU: mmToIU(num(text.dx!)),
    dyIU: mmToIU(num(text.dy!)),
    offsetXIU: mmToIU(num(text.ox!)),
    offsetYIU: mmToIU(num(text.oy!)),
    centreXIU: mmToIU(num(text.cx!)),
    centreYIU: mmToIU(num(text.cy!)),
  });

  const valid = arraySettingsValid(s);
  const count = arrayItemCount(s);

  const field = (label: string, key: string, unit = 'mm'): JSX.Element => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 92, textAlign: 'right' }}>{label}</span>
      <input
        type="text"
        value={text[key] ?? ''}
        onChange={(e) => setText({ ...text, [key]: e.target.value })}
        style={{ width: 82, fontSize: 12, padding: '2px 4px' }}
      />
      <span style={{ opacity: 0.7 }}>{unit}</span>
    </label>
  );

  const intField = (
    label: string,
    value: number,
    set: (v: number) => void,
    unit = '',
  ): JSX.Element => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 92, textAlign: 'right' }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => set(Number.parseInt(e.target.value, 10) || 0)}
        style={{ width: 82, fontSize: 12, padding: '2px 4px' }}
      />
      <span style={{ opacity: 0.7 }}>{unit}</span>
    </label>
  );

  const check = (label: string, value: boolean, set: (v: boolean) => void): JSX.Element => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginLeft: 100 }}>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  const tab = (id: ArrayMode, label: string): JSX.Element => (
    <button
      type="button"
      onClick={() => setS({ ...s, mode: id })}
      style={{
        fontSize: 12,
        padding: '4px 12px',
        fontWeight: s.mode === id ? 600 : 400,
        borderBottom: s.mode === id ? '2px solid var(--accent, #6af)' : '2px solid transparent',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        top: 80,
        left: 120,
        width: 340,
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
        Create Array
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '6px 10px 0' }}>
        {tab('grid', 'Grid')}
        {tab('circular', 'Circular')}
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {s.mode === 'grid' ? (
          <>
            {intField('Horizontal:', s.nx, (v) => setS({ ...s, nx: v }), 'items')}
            {intField('Vertical:', s.ny, (v) => setS({ ...s, ny: v }), 'items')}
            {field('Spacing X:', 'dx')}
            {field('Spacing Y:', 'dy')}
            {field('Offset X:', 'ox')}
            {field('Offset Y:', 'oy')}
            {intField('Stagger:', s.stagger, (v) => setS({ ...s, stagger: v }))}
            {check('Stagger rows (else columns)', s.staggerRows, (v) =>
              setS({ ...s, staggerRows: v }),
            )}
            {check('Centre on the original', s.centred, (v) => setS({ ...s, centred: v }))}
          </>
        ) : (
          <>
            {intField('Count:', s.count, (v) => setS({ ...s, count: v }), 'items')}
            {field('Centre X:', 'cx')}
            {field('Centre Y:', 'cy')}
            {intField('Angle:', s.angle, (v) => setS({ ...s, angle: v }), '° (0 = divide)')}
            {intField('Start angle:', s.angleOffset, (v) => setS({ ...s, angleOffset: v }), '°')}
            {check('Clockwise', s.clockwise, (v) => setS({ ...s, clockwise: v }))}
            {check('Rotate items', s.rotateItems, (v) => setS({ ...s, rotateItems: v }))}
          </>
        )}
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
          {valid ? `${count} item${count === 1 ? '' : 's'} in total` : 'Counts must be at least 1'}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!valid} onClick={() => onApply(resolved())}>
            OK
          </button>
        </span>
      </div>
    </div>
  );
}
