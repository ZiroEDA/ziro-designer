// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Regulators" panel, adjustable-regulator divider with min/typ/max
 * worst-case analysis. Counterpart: KiCad `calculator_panels/panel_regulator.cpp`.
 *
 * The regulator library plays the role of KiCad's regulators data file: it
 * lives in the browser and can be imported/exported ("Browse" / "Export") as
 * JSON. Add/Edit use an in-page dialog (no blocked window.prompt), so every
 * button works in a sandboxed frame too.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  BUILTIN_REGULATORS,
  type RegulatorData,
  RegulatorSolve,
  RegulatorType,
  printfG,
  solveRegulator,
} from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { Field, Group, Modal, copyText, parseNum } from '../fields.js';

const STORAGE_KEY = 'ziro.calculator.regulators';

// The tooltips wxFormBuilder attaches, character for character
// (panel_regulator_base.cpp:29, 88, 108, 113, 118, 236, 258 — note the double
// space in the Iadj one, which is upstream's).
const TIP_TYPE =
  'Type of the regulator.\nThere are 2 types:\n' +
  '- regulators which have a dedicated sense pin for the voltage regulation.\n' +
  '- 3 terminal pins.';
const TIP_DATA_FILE = 'The name of the data file which stores known regulators parameters.';
const TIP_EDIT = 'Edit the current selected regulator.';
const TIP_ADD = 'Enter a new item to the current list of available regulators';
const TIP_REMOVE = 'Remove an item from the current list of available regulators';
const TIP_VREF = 'The internal reference voltage of the regulator.\nShould not be 0.';
const TIP_IADJ = 'For 3 terminal regulators only, the  Adjust pin current.';

interface Stored {
  regulators: RegulatorData[];
  selected: string;
}

const DEFAULT_REG = BUILTIN_REGULATORS[0]!;

function loadRegulators(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      if (Array.isArray(s.regulators) && s.regulators.length) return s;
    }
  } catch {
    /* fresh defaults */
  }
  return { regulators: [...BUILTIN_REGULATORS], selected: DEFAULT_REG.name };
}

function saveRegulators(s: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** Divider schematic like the KiCad panel drawing. */
function RegulatorDrawing({ type }: { type: RegulatorType }): JSX.Element {
  const three = type === RegulatorType.THREE_TERMINAL;
  return (
    <svg className="calc-svg" width="330" height="264" viewBox="0 0 300 240">
      <g stroke="#4a86c5" fill="none" strokeWidth="1.5">
        <rect x="70" y="30" width="120" height="80" />
        <circle cx="20" cy="40" r="4" />
        <line x1="24" y1="40" x2="70" y2="40" />
        <line x1="190" y1="40" x2="250" y2="40" />
        <circle cx="254" cy="40" r="4" />
        <line x1="130" y1="110" x2="130" y2="130" />
        <line x1="130" y1="130" x2="215" y2="130" />
        <line x1="215" y1="40" x2="215" y2="55" />
        <path d="M215 55 l6 5 l-12 8 l12 8 l-12 8 l12 8 l-6 5" />
        <line x1="215" y1="97" x2="215" y2="155" />
        <path d="M215 155 l6 5 l-12 8 l12 8 l-12 8 l12 8 l-6 5" />
        <line x1="215" y1="197" x2="215" y2="210" />
        <line x1="200" y1="210" x2="230" y2="210" />
        <line x1="206" y1="215" x2="224" y2="215" />
        <line x1="212" y1="220" x2="218" y2="220" />
      </g>
      <g fill="#e6e6e6" fontSize="13" fontFamily="system-ui">
        <text x="80" y="52">
          Vin
        </text>
        <text x="150" y="52">
          Vout
        </text>
        <text x="112" y="102">
          {three ? 'ADJ' : 'FB'}
        </text>
        <text x="232" y="80">
          R1
        </text>
        <text x="232" y="180">
          R2
        </text>
      </g>
    </svg>
  );
}

/** Editable form state for the Add/Edit dialog (strings, µA for Iadj). */
interface RegForm {
  original: string | null; // name being edited, or null when adding
  name: string;
  type: RegulatorType;
  vrefMin: string;
  vrefTyp: string;
  vrefMax: string;
  iadjTyp: string;
  iadjMax: string;
}

const formFrom = (r: RegulatorData | null): RegForm => ({
  original: r?.name ?? null,
  name: r?.name ?? '',
  type: r?.type ?? RegulatorType.THREE_TERMINAL,
  vrefMin: String(r?.vrefMin ?? 1.2),
  vrefTyp: String(r?.vrefTyp ?? 1.25),
  vrefMax: String(r?.vrefMax ?? 1.3),
  iadjTyp: String((r?.iadjTyp ?? 50e-6) * 1e6),
  iadjMax: String((r?.iadjMax ?? 100e-6) * 1e6),
});

/** KiCad PANEL_REGULATOR::round_to + "%g" display (default step 0.001). */
const roundTo = (v: number, precision = 0.001): string =>
  Number.isFinite(v)
    ? printfG(Number((Math.round(v / precision) * precision).toPrecision(12)))
    : '';

export function PanelRegulator(): JSX.Element {
  const [store, setStore] = useState<Stored>(loadRegulators);
  const [type, setType] = useState<RegulatorType>(RegulatorType.THREE_TERMINAL);
  const [solve, setSolve] = useState<RegulatorSolve>(RegulatorSolve.R1);
  const [r1, setR1] = useState('0.240'); // kΩ
  const [r2, setR2] = useState('0.720'); // kΩ
  const [vout, setVout] = useState('5');
  const [vrefMin, setVrefMin] = useState('1.20');
  const [vrefTyp, setVrefTyp] = useState('1.25');
  const [vrefMax, setVrefMax] = useState('1.30');
  const [iadjTyp, setIadjTyp] = useState('50'); // µA
  const [iadjMax, setIadjMax] = useState('100');
  const [resTol, setResTol] = useState('1');
  const [comment, setComment] = useState('');
  // KiCad holds no result object: RegulatorsSolve() writes every cell straight
  // back into its wxTextCtrl and the message into a wxStaticText, and nothing
  // else ever clears them — not a radio, not an edit, not a regulator change.
  // Mirroring that is what makes the panel behave like the real one.
  const [r1Min, setR1Min] = useState('');
  const [r1Max, setR1Max] = useState('');
  const [r2Min, setR2Min] = useState('');
  const [r2Max, setR2Max] = useState('');
  const [voutMin, setVoutMin] = useState('');
  const [voutMax, setVoutMax] = useState('');
  const [tolMin, setTolMin] = useState('');
  const [tolMax, setTolMax] = useState('');
  const [message, setMessage] = useState('');

  // Dialog / feedback state (in-page, sandbox-safe).
  const [form, setForm] = useState<RegForm | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // KiCad's wxMessageBox. It has exactly three on this panel and none of them
  // is a success notice — Copy to Clipboard, Reset to Defaults, Add and Remove
  // all complete silently, which is why the transient "toast" that used to sit
  // beside Calculate is gone.
  const [notice, setNotice] = useState('');
  const [dataFileName, setDataFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveRegulators(store), [store]);

  const current = store.regulators.find((r) => r.name === store.selected) ?? null;

  const applyRegulator = (reg: RegulatorData): void => {
    setType(reg.type);
    setVrefMin(String(reg.vrefMin));
    setVrefTyp(String(reg.vrefTyp));
    setVrefMax(String(reg.vrefMax));
    setIadjTyp(String(reg.iadjTyp * 1e6));
    setIadjMax(String(reg.iadjMax * 1e6));
  };

  const calculate = (): void => {
    const r = solveRegulator({
      type,
      solve,
      r1Typ: parseNum(r1) * 1000,
      r2Typ: parseNum(r2) * 1000,
      voutTyp: parseNum(vout),
      vrefMin: parseNum(vrefMin),
      vrefTyp: parseNum(vrefTyp),
      vrefMax: parseNum(vrefMax),
      iadjTyp: parseNum(iadjTyp) * 1e-6,
      iadjMax: parseNum(iadjMax) * 1e-6,
      resTolPct: parseNum(resTol),
    });
    // KiCad clears the message first, then either reports and returns, or
    // writes all nine cells plus the power comment (panel_regulator.cpp:500-539).
    setMessage(r.error ?? '');
    if (r.error) return;
    const kk = (v: number): string => roundTo(v / 1000);
    setR1Min(kk(r.r1.min));
    setR1(kk(r.r1.typ));
    setR1Max(kk(r.r1.max));
    setR2Min(kk(r.r2.min));
    setR2(kk(r.r2.typ));
    setR2Max(kk(r.r2.max));
    setVoutMin(roundTo(r.vout.min));
    setVout(roundTo(r.vout.typ));
    setVoutMax(roundTo(r.vout.max));
    setTolMin(roundTo(r.tolNegPct, 0.01));
    setTolMax(roundTo(r.tolPosPct, 0.01));
    setComment(
      `${roundTo(r.vout.typ, 0.01)}V [${roundTo(r.vout.min, 0.01)}V ... ${roundTo(
        r.vout.max,
        0.01,
      )}V]`,
    );
  };

  // DIALOG_REGULATOR_FORM::TransferDataFromWindow (dialog_regulator_form.cpp:49)
  // simply returns false when a field is empty, |Vref| < 0.1 or (3-terminal)
  // |Iadj| < 1 — the dialog stays open and says nothing at all.
  const formValid = (f: RegForm | null): boolean => {
    if (!f || !f.name.trim()) return false;
    for (const v of [f.vrefMin, f.vrefTyp, f.vrefMax]) {
      if (v.trim() === '' || Math.abs(parseNum(v)) < 0.1) return false;
    }
    if (f.type === RegulatorType.THREE_TERMINAL) {
      for (const v of [f.iadjTyp, f.iadjMax]) {
        if (v.trim() === '' || !Number.isInteger(parseNum(v)) || Math.abs(parseNum(v)) < 1)
          return false;
      }
    }
    return true;
  };

  const saveForm = (): void => {
    if (!formValid(form) || !form) return;
    if (!form.original && store.regulators.some((r) => r.name === form.name.trim())) {
      setNotice('This regulator is already in list. Aborted');
      return;
    }
    const reg: RegulatorData = {
      name: form.name.trim(),
      type: form.type,
      vrefMin: parseNum(form.vrefMin),
      vrefTyp: parseNum(form.vrefTyp),
      vrefMax: parseNum(form.vrefMax),
      iadjTyp: parseNum(form.iadjTyp) * 1e-6,
      iadjMax: parseNum(form.iadjMax) * 1e-6,
    };
    setStore((s) => {
      const rest = s.regulators.filter((r) => r.name !== (form.original ?? reg.name));
      return {
        regulators: [...rest, reg].sort((a, b) => a.name.localeCompare(b.name)),
        selected: reg.name,
      };
    });
    applyRegulator(reg);
    setForm(null);
  };

  const removeRegulator = (): void => {
    if (!confirmRemove) return;
    setStore((s) => {
      const rest = s.regulators.filter((r) => r.name !== confirmRemove);
      return { regulators: rest, selected: rest[0]?.name ?? '' };
    });
    setConfirmRemove(null);
  };

  // panel_regulator.cpp:72-102, field for field. It touches NOTHING else: not
  // the regulator list, not the selected regulator, not the data file, not the
  // power comment and not the message.
  const resetDefaults = (): void => {
    setResTol('1');
    setR1Min('');
    setR1('0.240');
    setR1Max('');
    setR2Min('');
    setR2('0.720');
    setR2Max('');
    setVrefMin('1.20');
    setVrefTyp('1.25');
    setVrefMax('1.30');
    setVoutMin('');
    setVout('5');
    setVoutMax('');
    setIadjTyp('50');
    setIadjMax('100');
    setTolMin('');
    setTolMax('');
    setType(RegulatorType.THREE_TERMINAL);
    setSolve(RegulatorSolve.VOUT);
  };

  // PANEL_REGULATOR::OnCopyCB (panel_regulator.cpp:332-341): it copies the
  // field's text and reports nothing, whether or not the field is empty.
  const copyComment = (): void => {
    copyText(comment);
  };

  const exportData = (): void => {
    const blob = new Blob([JSON.stringify(store.regulators, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'regulators.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (file: File): void => {
    void file.text().then((txt) => {
      try {
        const parsed = JSON.parse(txt) as RegulatorData[];
        if (!Array.isArray(parsed) || !parsed.length) throw new Error('empty');
        const clean = parsed.filter(
          (r) => typeof r.name === 'string' && Number.isFinite(r.vrefTyp),
        );
        if (!clean.length) throw new Error('no valid entries');
        setStore({ regulators: clean, selected: clean[0]!.name });
        applyRegulator(clean[0]!);
        setDataFileName(file.name);
      } catch {
        setNotice(`Unable to read data file '${file.name}'.`);
      }
    });
  };

  const radioRow = (
    id: RegulatorSolve,
    label: string,
    min: string,
    typ: string,
    max: string,
    setTyp: (v: string) => void,
    unit: string,
  ): JSX.Element => (
    <>
      <input type="radio" name="reg-solve" checked={solve === id} onChange={() => setSolve(id)} />
      <span className="reg-label">{label}</span>
      <input className="calc-input ro" readOnly value={min} />
      <input className="calc-input" value={typ} onChange={(e) => setTyp(e.target.value)} />
      <input className="calc-input ro" readOnly value={max} />
      <span className="calc-unit">{unit}</span>
    </>
  );

  const formCell = (key: keyof RegForm): JSX.Element => (
    <input
      className="calc-input"
      style={{ width: 90 }}
      value={String(form?.[key] ?? '')}
      onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
    />
  );

  return (
    <div>
      <div className="calc-row">
        {/* bSizeLeftpReg: fixed 400px column; the Type choice stretches
            across it (proportion 1), the drawing centres, and the Formula
            box expands to the column width. */}
        <div className="calc-col" style={{ flex: '0 0 400px', width: 400, minWidth: 400 }}>
          <div className="calc-field">
            <span title={TIP_TYPE}>Type:</span>
            <Combo
              style={{ flex: 1 }}
              ariaLabel="Type"
              value={String(type)}
              options={[
                { value: String(RegulatorType.STANDARD), label: 'Standard Type' },
                { value: String(RegulatorType.THREE_TERMINAL), label: '3 Terminal Type' },
              ]}
              onChange={(v) => setType(Number(v) as RegulatorType)}
            />
          </div>
          <div style={{ alignSelf: 'center', margin: '10px 0' }}>
            <RegulatorDrawing type={type} />
          </div>
          <Group title="Formula">
            <div className="calc-formula">
              {type === RegulatorType.THREE_TERMINAL
                ? 'Vout = Vref * (R1 + R2) / R1 + Iadj * R2'
                : 'Vout = Vref * (R1 + R2) / R2'}
            </div>
          </Group>
        </div>

        {/* KiCad's right column is only as wide as the parameter grid, so the
            stretch-spacer items (tolerance input, Copy, Reset) align to the
            grid's right edge, not the page edge. */}
        <div className="calc-col" style={{ flex: '0 0 auto', width: 530 }}>
          <Group title="Regulator">
            <div className="calc-field">
              <Combo
                style={{ flex: 1 }}
                ariaLabel="Regulator"
                value={store.selected}
                options={[
                  { value: '', label: '' },
                  ...store.regulators.map((r) => ({ value: r.name, label: r.name })),
                ]}
                onChange={(v) => {
                  const reg = store.regulators.find((r) => r.name === v);
                  setStore((st) => ({ ...st, selected: v }));
                  if (reg) applyRegulator(reg);
                }}
              />
            </div>
            <div style={{ margin: '6px 0 2px' }} title={TIP_DATA_FILE}>
              Regulators data file:
            </div>
            <div className="calc-field">
              <input
                className="calc-input"
                style={{ flex: 1 }}
                readOnly
                value={dataFileName}
                placeholder=""
              />
              <button type="button" className="calc-btn" onClick={() => fileRef.current?.click()}>
                Browse
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importData(f);
                  e.target.value = '';
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="calc-btn"
                style={{ flex: 1 }}
                disabled={!current}
                title={TIP_EDIT}
                onClick={() => setForm(formFrom(current))}
              >
                Edit Regulator
              </button>
              <button
                type="button"
                className="calc-btn"
                style={{ flex: 1 }}
                title={TIP_ADD}
                onClick={() => setForm(formFrom(null))}
              >
                Add Regulator
              </button>
              <button
                type="button"
                className="calc-btn"
                style={{ flex: 1 }}
                disabled={!current}
                title={TIP_REMOVE}
                onClick={() => setConfirmRemove(current?.name ?? null)}
              >
                Remove Regulator
              </button>
            </div>
          </Group>

          {/* fgSizerRegParams: ONE wxFlexGridSizer, 7 rows x 6 columns
              (radio | label | min | typ | max | unit), not seven separate rows
              — which is what keeps the columns aligned and the pitch at 48 px.
              (panel_regulator_base.cpp:131-297.) */}
          <div className="reg-grid">
            <span />
            <span />
            <span className="reg-colhead">min</span>
            <span className="reg-colhead">typ</span>
            <span className="reg-colhead">max</span>
            <span />

            {radioRow(RegulatorSolve.R1, 'R1:', r1Min, r1, r1Max, setR1, 'kΩ')}
            {radioRow(RegulatorSolve.R2, 'R2:', r2Min, r2, r2Max, setR2, 'kΩ')}
            {radioRow(RegulatorSolve.VOUT, 'Vout:', voutMin, vout, voutMax, setVout, 'V')}

            <span />
            <span className="reg-label" title={TIP_VREF}>
              Vref:
            </span>
            <input
              className="calc-input"
              value={vrefMin}
              onChange={(e) => setVrefMin(e.target.value)}
            />
            <input
              className="calc-input"
              value={vrefTyp}
              onChange={(e) => setVrefTyp(e.target.value)}
            />
            <input
              className="calc-input"
              value={vrefMax}
              onChange={(e) => setVrefMax(e.target.value)}
            />
            <span className="calc-unit">V</span>

            {type === RegulatorType.THREE_TERMINAL && (
              <>
                <span />
                <span className="reg-label" title={TIP_IADJ}>
                  Iadj:
                </span>
                <span />
                <input
                  className="calc-input"
                  value={iadjTyp}
                  onChange={(e) => setIadjTyp(e.target.value)}
                />
                <input
                  className="calc-input"
                  value={iadjMax}
                  onChange={(e) => setIadjMax(e.target.value)}
                />
                <span className="calc-unit">µA</span>
              </>
            )}

            <span />
            <span className="reg-label">Overall tolerance:</span>
            <input className="calc-input ro" readOnly value={tolMin} />
            <span />
            <input className="calc-input ro" readOnly value={tolMax} />
            <span className="calc-unit">%</span>
          </div>

          <div className="calc-field">
            <span>Resistor tolerance:</span>
            <span style={{ flex: 1 }} />
            <input
              className="calc-input"
              style={{ width: 45 }}
              value={resTol}
              onChange={(e) => setResTol(e.target.value)}
            />
            <span className="calc-unit">%</span>
          </div>
          <div className="calc-field">
            <span>Power Comment:</span>
            <input
              className="calc-input ro"
              style={{ width: 200, textAlign: 'center' }}
              readOnly
              value={comment}
            />
            <span style={{ flex: 1 }} />
            <button type="button" className="calc-btn" onClick={copyComment}>
              Copy to Clipboard
            </button>
          </div>

          {/* m_RegulMessage: a plain wxStaticText, 10 px border all round
              (panel_regulator_base.cpp:346-348). Not coloured, not a dialog. */}
          <div className="calc-error">{message}</div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              className="calc-btn"
              style={{ minWidth: 120 }}
              onClick={calculate}
            >
              Calculate
            </button>
          </div>
        </div>
      </div>

      {/* KiCad: the right column stretches over the remaining window, and
          Reset to Defaults floats to its far bottom-right corner. */}
      <div style={{ marginTop: 48, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="calc-btn" onClick={resetDefaults}>
          Reset to Defaults
        </button>
      </div>

      {/* DIALOG_REGULATOR_FORM (dialogs/dialog_regulator_form_base.cpp): one
          title for both add and edit, a 4x3 flex grid, and Name disabled while
          editing. OK is refused silently while the values are not valid. */}
      {form && (
        <Modal
          title="Regulator Parameters"
          onClose={() => setForm(null)}
          footer={
            <>
              <button type="button" className="calc-btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="calc-btn"
                disabled={!formValid(form)}
                onClick={saveForm}
              >
                OK
              </button>
            </>
          }
        >
          <div className="reg-form-grid">
            <span>Name:</span>
            <span>
              <input
                className="calc-input"
                style={{ width: 286 }}
                disabled={form.original != null}
                value={form.name}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
              />
            </span>
            <span />

            <span>Vref (min/typ/max):</span>
            <span className="reg-form-triple">
              {formCell('vrefMin')}
              {formCell('vrefTyp')}
              {formCell('vrefMax')}
            </span>
            <span>Volt</span>

            <span>Type:</span>
            <span>
              <Combo
                ariaLabel="Type"
                value={String(form.type)}
                options={[
                  { value: String(RegulatorType.STANDARD), label: 'Standard Type' },
                  { value: String(RegulatorType.THREE_TERMINAL), label: '3 Terminal Type' },
                ]}
                onChange={(v) =>
                  setForm((f) => (f ? { ...f, type: Number(v) as RegulatorType } : f))
                }
              />
            </span>
            <span />

            {form.type === RegulatorType.THREE_TERMINAL && (
              <>
                <span>Iadj (typ/max):</span>
                <span className="reg-form-triple">
                  {formCell('iadjTyp')}
                  {formCell('iadjMax')}
                </span>
                <span>µA</span>
              </>
            )}
          </div>
        </Modal>
      )}

      {notice && (
        <Modal
          title="Calculator Tools"
          onClose={() => setNotice('')}
          footer={
            <button type="button" className="calc-btn" onClick={() => setNotice('')}>
              OK
            </button>
          }
        >
          {notice}
        </Modal>
      )}

      {confirmRemove && (
        <Modal
          title="Remove Regulator"
          onClose={() => setConfirmRemove(null)}
          footer={
            <>
              <button type="button" className="calc-btn" onClick={() => setConfirmRemove(null)}>
                Cancel
              </button>
              <button type="button" className="calc-btn" onClick={removeRegulator}>
                Remove
              </button>
            </>
          }
        >
          Remove regulator &lsquo;{confirmRemove}&rsquo; from the library?
        </Modal>
      )}
    </div>
  );
}
