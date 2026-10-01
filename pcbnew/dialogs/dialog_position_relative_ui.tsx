// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Position Relative To Reference Item. Counterpart:
 * `pcbnew/dialogs/dialog_position_relative_base.cpp`:
 *
 *     bMainSizer (V)
 *       bUpperSizer (V)                          wxEXPAND|wxALL 5
 *         m_referenceInfo (min width 340)        wxALL|wxEXPAND 5
 *         bSizerButtOpts (H)                     1, wxEXPAND|wxTOP|wxBOTTOM 5
 *           "Use Local Origin" "Use Grid Origin"
 *           "Select Item..."   "Select Point..."   each 1, wxALL 5
 *         bSizer6 > wxStaticLine                 wxEXPAND|wxTOP 5
 *       fgSizer2 (5 cols, col 1 growable)        1, wxEXPAND|wxALL 5
 *         label  entry  unit  spacer(10)  "Reset"      (X row, then Y row)
 *       bSizerBottom (H)                         wxEXPAND|wxTOP 5
 *         "Use polar coordinates"  spacer(40)  wxStdDialogButtonSizer
 *
 * The decisions are `dialog_position_relative.ts`'s `DIALOG_POSITION_RELATIVE`,
 * which this window renders and whose handlers it calls. The dialog is
 * MODELESS: it is drawn while `dialog.IsShown()`, over the canvas, which stays
 * live (the picker buttons hide it and the picker brings it back).
 */
import { type JSX, type Ref, useEffect, useRef, useSyncExternalStore } from 'react';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import {
  DIALOG_POSITION_RELATIVE_TITLE,
  type DIALOG_POSITION_RELATIVE,
} from './dialog_position_relative.js';

export function DialogPositionRelativeModeless({
  dialog,
}: {
  dialog: DIALOG_POSITION_RELATIVE;
}): JSX.Element | null {
  useSyncExternalStore(
    (listener) => dialog.Subscribe(listener),
    () => dialog.GetVersion(),
  );

  const shown = dialog.IsShown();
  const xRef = useRef<HTMLInputElement>(null);
  const raised = dialog.GetRaiseCount();

  // Esc is wxID_CANCEL, which hides a modeless dialog.
  useModalEscape(() => dialog.OnCancel(), shown);

  // `SetInitialFocus( m_xEntry )`, and `Raise(); SetFocus()` when the picker returns.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `raised` is the trigger, the effect does not read it
  useEffect(() => {
    if (shown) xRef.current?.focus();
  }, [shown, raised]);

  if (!shown) return null;

  const entry = (
    binder: UNIT_BINDER,
    id: string,
    cls: string,
    ref?: Ref<HTMLInputElement>,
  ): JSX.Element => (
    <input
      ref={ref}
      id={id}
      className={`ze-search ${cls}`}
      value={binder.GetText()}
      onChange={(e) => dialog.SetEntryText(binder, e.target.value)}
      onBlur={() => dialog.OnTextFocusLost(binder)}
      onKeyDown={(e) => {
        // The OK button is the dialog's default: Enter activates it.
        if (e.key === 'Enter') dialog.OnOkClick();
      }}
    />
  );

  return (
    <div
      className="ze-find-dialog ze-posrel"
      role="dialog"
      aria-label={DIALOG_POSITION_RELATIVE_TITLE}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ze-modal-header">
        {DIALOG_POSITION_RELATIVE_TITLE}
        <span className="x" onClick={() => dialog.OnCancel()}>
          ✕
        </span>
      </div>
      <div className="ze-posrel-body">
        <div className="ze-posrel-upper">
          <div className="ze-posrel-info">{dialog.m_referenceInfo}</div>
          <div className="ze-posrel-buttons">
            <button type="button" className="ze-btn" onClick={() => dialog.OnUseUserOriginClick()}>
              Use Local Origin
            </button>
            <button type="button" className="ze-btn" onClick={() => dialog.OnUseGridOriginClick()}>
              Use Grid Origin
            </button>
            <button
              type="button"
              className="ze-btn"
              title={
                'Click and select a board item.\nThe anchor position will be the position of the selected item.'
              }
              onClick={() => dialog.OnSelectItemClick()}
            >
              Select Item...
            </button>
            <button type="button" className="ze-btn" onClick={() => dialog.OnSelectPointClick()}>
              Select Point...
            </button>
          </div>
          <div className="ze-posrel-line" />
        </div>

        <div className="ze-posrel-grid">
          <label className="lbl r1" htmlFor="ze-posrel-x">
            {dialog.GetXLabel()}
          </label>
          {entry(dialog.m_xOffset, 'ze-posrel-x', 'r1', xRef)}
          <span className="unit">{dialog.GetXUnitLabel()}</span>
          <span className="spacer r1" />
          <button
            type="button"
            className="ze-btn r1"
            title={dialog.m_clearXToolTip}
            onClick={() => dialog.OnClear('x')}
          >
            Reset
          </button>

          <label className="lbl r2l" htmlFor="ze-posrel-y">
            {dialog.GetYLabel()}
          </label>
          {entry(dialog.m_yOffset, 'ze-posrel-y', 'r2')}
          <span className="unit">{dialog.GetYUnitLabel()}</span>
          <span className="spacer r2s" />
          <button
            type="button"
            className="ze-btn r2"
            title={dialog.m_clearYToolTip}
            onClick={() => dialog.OnClear('y')}
          >
            Reset
          </button>
        </div>
      </div>
      <StdDialogButtons onCancel={() => dialog.OnCancel()} onOk={() => dialog.OnOkClick()}>
        <label>
          <input
            type="checkbox"
            checked={dialog.m_polarCoords}
            onChange={(e) => dialog.OnPolarChanged(e.target.checked)}
          />
          Use polar coordinates
        </label>
      </StdDialogButtons>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TRANSITIONAL: the pre-port dialog, kept only because `pcb_edit_frame_ui.tsx`
// still mounts it. Delete this block, with `tools/position_relative_tool.ts`'s
// legacy block, when the frame mounts `DialogPositionRelativeModeless`.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { polarTranslation } from '../index.js';
import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';

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
            Select Item...
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
