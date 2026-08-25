// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Shared input/output widgets and number formatting for the calculator
 * panels, the equivalent of KiCad pcb_calculator's UNIT_SELECTOR + value
 * fields, including the per-field unit dropdowns (mm/mil/inch, Hz…GHz, Ω…MΩ)
 * that convert their value in place when you switch units.
 */

import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { Combo } from '../../ui/Combo.js';
import { printfG } from '@ziroeda/pcb_calculator';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { type UnitOpt, unitIndex } from './unit_selector.js';

/** Parse a user-typed number; returns NaN for empty/invalid text. */
export const parseNum = (s: string): number => {
  const t = s.trim().replace(',', '.');
  if (t === '') return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
};

/** Format a result to a sensible precision (engineering style). */
export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '--';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(digits - 1);
  return Number(v.toPrecision(digits)).toString();
}

// The unit tables live in `unit_selector.ts`, the counterpart of KiCad's
// `widgets/unit_selector.cpp`. Re-exported here because every panel already
// reaches for them through this module.
export {
  ANGLE_UNITS,
  CABLE_LEN_UNITS,
  FREQ_UNITS,
  LEN_UNITS,
  LIN_RES_UNITS,
  POWER_UNITS,
  RES_UNITS,
  SPEED_UNITS,
  THICK_UNITS,
  TIME_UNITS,
  type UnitOpt,
  unitIndex,
  VOLTAGE_UNITS,
} from './unit_selector.js';

/** One labelled row: label, input (or output), plain unit text. */
export function Field({
  label,
  value,
  onChange,
  unit,
  readOnly,
  title,
  width,
  bold,
  pick,
  disabled,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange?: (v: string) => void;
  unit?: ReactNode;
  readOnly?: boolean;
  title?: string;
  width?: number;
  /** KiCad bolds the LABEL and the FIELD of a controlling value together
   *  (panel_track_width.cpp:340-392). */
  bold?: boolean;
  /** The `...` STD_BITMAP_BUTTON some rows carry, which raises
   *  wxGetSingleChoice over a material list. */
  pick?: () => void;
  /** `Enable( false )`, which GTK paints quite differently from a read-only
   *  entry: [px] face rgb(42,42,42) with dim ink, against 3DLIGHT's
   *  rgb(55,55,55) with ordinary ink. */
  disabled?: boolean;
  /** Extra row class, for the per-item wxTOP/wxBOTTOM borders a wxFlexGridSizer
   *  with vgap 0 relies on. */
  className?: string;
}): JSX.Element {
  return (
    <label
      className={`calc-field${bold ? ' bold' : ''}${className ? ` ${className}` : ''}`}
      title={title}
    >
      <span className="calc-field-label">{label}</span>
      {/* The entry and its `...` share ONE cell: wxFormBuilder puts them in a
          horizontal box sizer and adds that to the grid's second column
          (panel_via_size_base.cpp:130-140). */}
      {pick ? (
        <span className="calc-cell">
          <input
            className={`calc-input${readOnly ? ' ro' : ''}`}
            style={width ? { width } : undefined}
            value={value}
            readOnly={readOnly}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            spellCheck={false}
          />
          <button type="button" className="calc-btn calc-pick" onClick={pick}>
            ...
          </button>
        </span>
      ) : (
        <input
          className={`calc-input${readOnly ? ' ro' : ''}`}
          style={width ? { width } : undefined}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          spellCheck={false}
        />
      )}
      {unit != null && <span className="calc-unit">{unit}</span>}
    </label>
  );
}

/**
 * Numeric field with an integrated unit dropdown.
 *
 * The parent owns the value in base SI units (`base`); this widget shows it in
 * the chosen unit and reports edits back through `onBase`. While the input is
 * focused, the parent's value does not overwrite what you type; external
 * changes (synthesis, linked fields) refresh it when unfocused.
 *
 * **Switching the unit does not touch the number.** A `UNIT_SELECTOR` is a
 * plain `wxChoice`, and every panel that has one connects it to the same
 * *recalculate* handler the text field uses — `OnViaCalculate`
 * (panel_via_size_base.cpp:378-388), `OnTWParametersChanged`
 * (panel_track_width_base.cpp:303-312). Neither rewrites the entry. So 0.4 mm
 * switched to mil is 0.4 **mil**: the number stands and the quantity changes,
 * and the results below it move. We used to convert the text so the physical
 * quantity was preserved, which is the opposite of what the real panel does.
 * A *derived* field still follows its value, because `TWDisplayValues` divides
 * by the selector's scale when it rewrites the non-controlling widths
 * (panel_track_width.cpp).
 */
export function NumField({
  label,
  units,
  base,
  onBase,
  defaultUnit,
  readOnly,
  title,
  digits = 6,
  bold,
  labelAlign,
  initialText,
  className,
  text: textProp,
  onText,
  unitIdx: unitIdxProp,
  onUnitIdx,
}: {
  label: ReactNode;
  units: UnitOpt[];
  base: number;
  onBase?: (v: number) => void;
  /**
   * The field's text, when the parent owns it.
   *
   * A panel that *persists* the field has to own it: upstream stores the
   * `wxTextCtrl`'s string and the `wxChoice`'s index, not the physical quantity
   * (`aCfg->m_ViaSize.hole_diameter = m_textCtrlHoleDia->GetValue()`,
   * panel_via_size.cpp:182-183), and a round trip through a number would print
   * "1.0" back as "1". Supplying `text` means supplying `onText`; `base` is
   * then whatever the parent derives from the two.
   */
  text?: string;
  onText?: (t: string) => void;
  /** The selected unit's index, when the parent owns it. Same reason. */
  unitIdx?: number;
  onUnitIdx?: (i: number) => void;
  /** Unit label to start on (e.g. 'µm'); defaults to the first entry. Ignored
   *  when `unitIdx` is supplied. */
  defaultUnit?: string;
  readOnly?: boolean;
  title?: string;
  /** `%g` precision; C's default, and KiCad never passes another. */
  digits?: number;
  /** As on `Field`: the controlling value's label and field are both bold. */
  bold?: boolean;
  /** The panel's state IS its field text: pcb_calculator stores these defaults
   *  as STRINGS and calls SetValue with them, so "1.0" stays "1.0" until the
   *  user or a calculation rewrites it. `%g` of 1.0 is "1", which is not what
   *  the binary shows (pcb_calculator_settings.cpp:265). */
  initialText?: string;
  /** wxFormBuilder right-aligns exactly one parameter label in the whole
   *  launcher — Transmission Lines' Frequency
   *  (panel_transline_base.cpp:207). Everything else is flush left. */
  labelAlign?: 'left' | 'right';
  /** As on `Field`. */
  className?: string;
}): JSX.Element {
  const [ownIdx, setOwnIdx] = useState(() => (defaultUnit ? unitIndex(units, defaultUnit) : 0));
  const idx = unitIdxProp ?? ownIdx;
  const mult = units[idx]?.mult ?? 1;
  // `%g`. Every value pcb_calculator writes into a field goes through
  // `wxString::Format( "%g", … )`, which is six significant figures — the five
  // this used to print showed 0.30039 where the real panel shows 0.300387.
  const derived = Number.isFinite(base) ? printfG(base / mult, digits) : readOnly ? '' : '';
  const [ownText, setOwnText] = useState(initialText ?? derived);
  const text = textProp ?? ownText;
  const focused = useRef(false);
  // A settings default is a STRING and the panel's state IS its field text, so
  // "1.0" must survive until something genuinely rewrites the value - `%g` of 1
  // is "1", which is not what the binary shows. Comparing against the last
  // derived value rather than firing on mount also makes this idempotent under
  // React's double-invoked effects.
  const lastDerived = useRef(derived);

  // Refresh the text from the parent value when it changes externally and the
  // user isn't mid-edit (read-only outputs always track the value).
  useEffect(() => {
    if (derived === lastDerived.current) return;
    lastDerived.current = derived;
    // A field the parent owns is refreshed by the parent; there is nothing here
    // to refresh, and writing to it from an effect would fight the owner.
    if (textProp !== undefined) return;
    if (readOnly || !focused.current) setOwnText(derived);
  }, [derived, readOnly, textProp]);

  const emit = (t: string): void => {
    if (onText) onText(t);
    else setOwnText(t);
    onBase?.(parseNum(t) * mult);
  };
  // The selection moves and nothing else does — see the note on this component.
  const switchUnit = (nextIdx: number): void => {
    if (onUnitIdx) onUnitIdx(nextIdx);
    else setOwnIdx(nextIdx);
  };

  return (
    <label
      className={`calc-field${bold ? ' bold' : ''}${className ? ` ${className}` : ''}`}
      title={title}
    >
      <span className="calc-field-label" style={labelAlign ? { textAlign: labelAlign } : undefined}>
        {label}
      </span>
      <input
        className={`calc-input${readOnly ? ' ro' : ''}`}
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onChange={readOnly ? undefined : (e) => emit(e.target.value)}
      />
      {units.length > 1 ? (
        <Combo
          style={{ minWidth: 62 }}
          value={String(idx)}
          options={units.map((u, i) => ({ value: String(i), label: u.label }))}
          onChange={(v) => switchUnit(Number(v))}
        />
      ) : (
        <span className="calc-unit" title={units[0]?.title}>
          {units[0]?.label}
        </span>
      )}
    </label>
  );
}

/** KiCad-style titled group box. */
export function Group({
  title,
  children,
  className,
  style,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <fieldset className={`calc-group${className ? ` ${className}` : ''}`} style={style}>
      {title != null && <legend>{title}</legend>}
      {children}
    </fieldset>
  );
}

/** A lightweight in-page modal dialog (sandbox-safe; no window.prompt/alert). */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Omit it: a wxDialog is sized by its sizer, not by a number we picked. */
  width?: number;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  return (
    <div className="calc-modal-backdrop" onMouseDown={onClose}>
      <div
        className="calc-modal"
        style={width ? { width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="calc-modal-head">
          <span>{title}</span>
          <button type="button" className="calc-modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="calc-modal-body">{children}</div>
        {footer && <div className="calc-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Copy text to the clipboard with a synchronous fallback for sandboxes. */
export function copyText(text: string): boolean {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * A read-only RESULT line. `pcb_calculator` shows every computed value as a
 * `wxStaticText` whose label it rewrites (`m_ViaResistance->SetLabel( msg )`,
 * panel_via_size.cpp:276-300, and the same shape on Track Width, Wavelength,
 * Fusing Current and the attenuators) — never a text control. Ours had drawn
 * them as read-only entry boxes, which is a whole column of borders KiCad does
 * not paint.
 */
export function ResultField({
  label,
  value,
  unit,
  title,
  className,
}: {
  label: ReactNode;
  value: string;
  unit?: ReactNode;
  title?: string;
  /** As on `Field`. */
  className?: string;
}): JSX.Element {
  return (
    <div className={`calc-result${className ? ` ${className}` : ''}`} title={title}>
      <span className="calc-field-label">{label}</span>
      <span className="calc-result-value">{value}</span>
      {unit != null && <span className="calc-unit">{unit}</span>}
    </div>
  );
}
