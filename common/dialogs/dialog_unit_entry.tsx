// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_UNIT_ENTRY_DIALOG` and `WX_PT_ENTRY_DIALOG`
 * (common/dialogs/dialog_unit_entry.cpp), with their `_base`s folded in: one
 * value, or an X/Y pair, bound to the frame's units by a UNIT_BINDER.
 *
 * The board editor's Fillet Lines, Fillet Tracks, Chamfer Lines, Simplify
 * Shapes and Heal Shapes all ask through the first
 * (pcbnew/tools/edit_tool.cpp:1307, :1487, :1556, :1844, :1916).
 *
 * The sizer tree (dialog_unit_entry_base.cpp): `bSizerContent`, horizontal, at
 * wxEXPAND|wxRIGHT|wxLEFT 5 - the label wxALIGN_CENTER_VERTICAL|wxTOP|wxBOTTOM|
 * wxLEFT 5, the entry proportion 1 wxALL 5, the unit wxTOP|wxBOTTOM|wxRIGHT 5
 * - then a 100 px stretch spacer and the std buttons at wxALL 5.
 */
import { useState, type JSX } from 'react';
import { StdDialogButtons } from '../dialog_shim_buttons.js';
import type { EdaIuScale } from '../eda_units.js';
import {
  parseUnitValue,
  stringFromValue,
  unitLabel,
  type EdaUnits,
} from '../widgets/unit_binder.js';
import { useModalEscape } from './use_modal_escape.js';

/** A UNIT_BINDER's text for a value in IU. */
export function unitEntryText(aValueIU: number, aUnits: EdaUnits, aIuScale: EdaIuScale): string {
  return stringFromValue(aIuScale.iuToMM(aValueIU), aUnits, false, aIuScale);
}

/** `UNIT_BINDER::GetIntValue()`: the text read back into IU, NaN when it will not parse. */
export function unitEntryValue(aText: string, aUnits: EdaUnits, aIuScale: EdaIuScale): number {
  return Math.round(aIuScale.mmToIU(parseUnitValue(aText, aUnits, aIuScale)));
}

export function WX_UNIT_ENTRY_DIALOG({
  caption,
  label,
  defaultValue,
  units,
  iuScale,
  onResult,
}: {
  caption: string;
  label: string;
  /** `aDefaultValue`, in IU. */
  defaultValue: number;
  /** The frame's display units (the binder's units provider). */
  units: EdaUnits;
  iuScale: EdaIuScale;
  /** `GetValue()` in IU on wxID_OK; `null` on wxID_CANCEL. */
  onResult: (valueIU: number | null) => void;
}): JSX.Element {
  const [text, setText] = useState(() => unitEntryText(defaultValue, units, iuScale));
  useModalEscape(() => onResult(null));
  const ok = (): void => {
    const v = unitEntryValue(text, units, iuScale);
    onResult(Number.isFinite(v) ? v : 0);
  };

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-unitentry" role="dialog" aria-modal="true" aria-label={caption}>
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-unitentry-content">
          <span className="ze-unitentry-label">{label}</span>
          <input
            className="ze-search ze-unitentry-ctrl"
            aria-label={label}
            // `SetInitialFocus( m_textCtrl )`.
            // biome-ignore lint/a11y/noAutofocus: SetInitialFocus, upstream's own.
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ok();
              e.stopPropagation();
            }}
          />
          <span className="ze-unitentry-unit">{unitLabel(units)}</span>
        </div>
        <StdDialogButtons onCancel={() => onResult(null)} onOk={ok} />
      </div>
    </div>
  );
}

/**
 * `WX_PT_ENTRY_DIALOG`: an X and a Y through two binders, with an optional
 * Reset button that zeroes both (`ResetValues`).
 */
export function WX_PT_ENTRY_DIALOG({
  caption,
  labelX,
  labelY,
  defaultValue,
  showResetButton = false,
  units,
  iuScale,
  onResult,
}: {
  caption: string;
  labelX: string;
  labelY: string;
  /** `aDefaultValue`, in IU. */
  defaultValue: { x: number; y: number };
  /** `aShowResetButt`. */
  showResetButton?: boolean;
  units: EdaUnits;
  iuScale: EdaIuScale;
  onResult: (value: { x: number; y: number } | null) => void;
}): JSX.Element {
  const [x, setX] = useState(() => unitEntryText(defaultValue.x, units, iuScale));
  const [y, setY] = useState(() => unitEntryText(defaultValue.y, units, iuScale));
  useModalEscape(() => onResult(null));
  const read = (t: string): number => {
    const v = unitEntryValue(t, units, iuScale);
    return Number.isFinite(v) ? v : 0;
  };
  const ok = (): void => onResult({ x: read(x), y: read(y) });
  const row = (label: string, value: string, set: (t: string) => void): JSX.Element => (
    <div className="ze-unitentry-content">
      <span className="ze-unitentry-label">{label}</span>
      <input
        className="ze-search ze-unitentry-ctrl"
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ok();
          e.stopPropagation();
        }}
      />
      <span className="ze-unitentry-unit">{unitLabel(units)}</span>
    </div>
  );

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-unitentry" role="dialog" aria-modal="true" aria-label={caption}>
        <div className="ze-modal-header">{caption}</div>
        {row(labelX, x, setX)}
        {row(labelY, y, setY)}
        <StdDialogButtons onCancel={() => onResult(null)} onOk={ok}>
          {showResetButton && (
            <button
              type="button"
              className="ze-btn"
              onClick={() => {
                setX(unitEntryText(0, units, iuScale));
                setY(unitEntryText(0, units, iuScale));
              }}
            >
              Reset
            </button>
          )}
        </StdDialogButtons>
      </div>
    </div>
  );
}
