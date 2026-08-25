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

import { useMemo, useRef, useState, type JSX } from 'react';
import {
  formatRegulatorDataFile,
  parseRegulatorDataFile,
  REGULATOR_DATA_FILE_EXT,
  type RegulatorData,
  RegulatorSolve,
  RegulatorType,
  REGULATOR_DEFAULTS,
  REGULATOR_TYPE_CHOICES,
  printfG,
  solveRegulator,
} from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { Field, Group, Modal, copyText, parseNum } from '../fields.js';
import { useCalcSaveSettings } from '../calc_settings.js';
import { settings } from '../../../prefs/settings.js';

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

/**
 * The regulator library and the name selected in it.
 *
 * Upstream these are two different things in two different places: the list is
 * a `.pcbcalc` file on disk read by `PANEL_REGULATOR::ReadDataFile`
 * (datafile_read_write.cpp) and named by `regulators.data_file`, while the
 * selection is `regulators.selected_regulator` in the settings file
 * (pcb_calculator_settings.cpp:128-132). A browser has no disk, so both live in
 * `pcb_calculator.json` — the list under the ZiroEDA-only `regulators.library`.
 * They were in a standalone `ziro.calculator.regulators` key until v3 of the
 * settings schema, which migrates it (`migrateRegulatorLibrary`).
 *
 * KiCad ships NO regulators: `REGULATOR_LIST` is empty until the user loads a
 * data file or presses Add Regulator, which is why the selector opens blank and
 * Edit/Remove open disabled (panel_regulator.cpp:47, 141).
 */
interface Stored {
  regulators: RegulatorData[];
  selected: string;
}

// KiCad's own dark-theme artwork (GPL), vendored under assets/ — the panel
// shows `BITMAPS::regul_3pins` or `BITMAPS::regul` at its natural 295x265 /
// 295x220 size (panel_regulator.cpp:104-113, panel_regulator_base.cpp:44-49).
const REGUL_ART = import.meta.glob('../../../assets/calculator/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const artUrl = (name: string): string | undefined =>
  REGUL_ART[`../../../assets/calculator/${name}.svg`];

/** wxStaticBitmap m_bitmapRegul3pins / m_bitmapRegul4pins. */
function RegulatorDrawing({ type }: { type: RegulatorType }): JSX.Element {
  const three = type === RegulatorType.THREE_TERMINAL;
  return (
    <img
      className="calc-art"
      src={artUrl(three ? 'regul_3pins' : 'regul')}
      alt=""
      width={295}
      height={three ? 265 : 220}
    />
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

/** `%.3g`, which is what CopyRegulatorDataToDialog prints
 *  (dialog_regulator_form.cpp:113-125). */
const g3 = (v: number): string => printfG(Number(v.toPrecision(3)));

/**
 * DIALOG_REGULATOR_FORM opens with EVERY field empty and the type choice on
 * index 0, Standard Type (dialog_regulator_form_base.cpp:31-67 - every
 * wxTextCtrl is constructed with wxEmptyString - and :65 SetSelection( 0 )).
 * Only CopyRegulatorDataToDialog fills them, when editing.
 */
const formFrom = (r: RegulatorData | null): RegForm =>
  r
    ? {
        original: r.name,
        name: r.name,
        type: r.type,
        vrefMin: g3(r.vrefMin),
        vrefTyp: g3(r.vrefTyp),
        vrefMax: g3(r.vrefMax),
        // KiCad holds Iadj in microamps and prints the field verbatim.
        iadjTyp: g3(r.iadjTyp * 1e6),
        iadjMax: g3(r.iadjMax * 1e6),
      }
    : {
        original: null,
        name: '',
        type: RegulatorType.STANDARD,
        vrefMin: '',
        vrefTyp: '',
        vrefMax: '',
        iadjTyp: '',
        iadjMax: '',
      };

/** KiCad PANEL_REGULATOR::round_to + "%g" display (default step 0.001). */
const roundTo = (v: number, precision = 0.001): string =>
  Number.isFinite(v)
    ? printfG(Number((Math.round(v / precision) * precision).toPrecision(12)))
    : '';

export function PanelRegulator(): JSX.Element {
  // PANEL_REGULATOR::LoadSettings / SaveSettings (panel_regulator.cpp:551-611),
  // thirteen keys. Every one of the nine value fields is stored as the field
  // TEXT, so "0.240" survives as "0.240".
  const cfg0 = settings.pcbCalculator.regulators;
  const [store, setStore] = useState<Stored>(() => ({
    regulators: cfg0.library,
    selected: cfg0.selected_regulator,
  }));
  const [type, setType] = useState<RegulatorType>(() =>
    cfg0.type === RegulatorType.STANDARD ? RegulatorType.STANDARD : RegulatorType.THREE_TERMINAL,
  );
  // `regulators.last_param` indexes { m_rbRegulR1, m_rbRegulR2, m_rbRegulVout }
  // and LoadSettings folds anything >= 3 back to 0 (panel_regulator.cpp:569-575).
  const [solve, setSolve] = useState<RegulatorSolve>(() =>
    cfg0.last_param >= 0 && cfg0.last_param < 3
      ? (cfg0.last_param as RegulatorSolve)
      : RegulatorSolve.R1,
  );
  const [r1, setR1] = useState(cfg0.r1); // kΩ
  const [r2, setR2] = useState(cfg0.r2); // kΩ
  const [vout, setVout] = useState(cfg0.voutTyp);
  const [vrefMin, setVrefMin] = useState(cfg0.vrefMin);
  const [vrefTyp, setVrefTyp] = useState(cfg0.vrefTyp);
  const [vrefMax, setVrefMax] = useState(cfg0.vrefMax);
  const [iadjTyp, setIadjTyp] = useState(cfg0.iadjTyp); // µA
  const [iadjMax, setIadjMax] = useState(cfg0.iadjMax);
  const [resTol, setResTol] = useState(cfg0.resTol);
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
  const [dataFileName, setDataFileName] = useState(cfg0.data_file);
  const fileRef = useRef<HTMLInputElement>(null);

  useCalcSaveSettings((s) => {
    s.regulators.resTol = resTol;
    s.regulators.r1 = r1;
    s.regulators.r2 = r2;
    s.regulators.vrefMin = vrefMin;
    s.regulators.vrefTyp = vrefTyp;
    s.regulators.vrefMax = vrefMax;
    // NOT `voutTyp = vout`. PANEL_REGULATOR::SaveSettings writes the setting
    // INTO the control here — `m_voutTypVal->SetValue( aCfg->m_Regulators.voutTyp )`,
    // panel_regulator.cpp:585 — where every line around it reads the control
    // into the setting. So upstream loads Vout and never saves it, and a typed
    // Vout does not survive the frame closing. Mirrored deliberately; deleting
    // this comment and assigning `vout` is the one-line fix if it ever stops
    // being what we want.
    s.regulators.iadjTyp = iadjTyp;
    s.regulators.iadjMax = iadjMax;
    s.regulators.data_file = dataFileName;
    s.regulators.selected_regulator = store.selected;
    s.regulators.type = type;
    s.regulators.last_param = solve;
    s.regulators.library = store.regulators;
  });

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
    const d = REGULATOR_DEFAULTS;
    setResTol(d.resTol);
    setR1Min(d.r1Min);
    setR1(d.r1Typ);
    setR1Max(d.r1Max);
    setR2Min(d.r2Min);
    setR2(d.r2Typ);
    setR2Max(d.r2Max);
    setVrefMin(d.vrefMin);
    setVrefTyp(d.vrefTyp);
    setVrefMax(d.vrefMax);
    setVoutMin(d.voutMin);
    setVout(d.voutTyp);
    setVoutMax(d.voutMax);
    setIadjTyp(d.iadjTyp);
    setIadjMax(d.iadjMax);
    setTolMin(d.tolMin);
    setTolMax(d.tolMax);
    setType(d.type);
    setSolve(d.solve);
  };

  // PANEL_REGULATOR::OnCopyCB (panel_regulator.cpp:332-341): it copies the
  // field's text and reports nothing, whether or not the field is empty.
  const copyComment = (): void => {
    copyText(comment);
  };

  // PANEL_REGULATOR::WriteDataFile (datafile_read_write.cpp:91-113).
  const exportData = (): void => {
    const blob = new Blob([formatRegulatorDataFile(store.regulators, 'pcb_calculator (ZiroEDA)')], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `regulators.${REGULATOR_DATA_FILE_EXT}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // PANEL_REGULATOR::OnDataFileSelection then ReadDataFile
  // (panel_regulator.cpp:186-235, datafile_read_write.cpp:50-88): the file is a
  // `.pcbcalc` s-expression, the list it holds REPLACES the current one, and a
  // file that will not parse raises "Unable to read data file '%s'.".
  const importData = (file: File): void => {
    void file.text().then((txt) => {
      try {
        const parsed = parseRegulatorDataFile(txt);
        setStore({ regulators: parsed, selected: parsed[0]?.name ?? '' });
        if (parsed[0]) applyRegulator(parsed[0]);
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
      <input className="calc-input ro light" readOnly value={min} />
      <input className="calc-input" value={typ} onChange={(e) => setTyp(e.target.value)} />
      <input className="calc-input ro light" readOnly value={max} />
      <span className="calc-unit">{unit}</span>
    </>
  );

  const formCell = (key: keyof RegForm): JSX.Element => (
    <input
      className="calc-input"
      style={{ width: 96 }}
      value={String(form?.[key] ?? '')}
      onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
    />
  );

  return (
    <div className="calc-page-body">
      <div className="calc-row">
        {/* bSizeLeftpReg: fixed 400px column; the Type choice stretches
            across it (proportion 1), the drawing centres, and the Formula
            box expands to the column width. */}
        <div
          className="calc-col"
          style={{
            flex: '0 0 390px' /* [px] bSizeLeftpReg's 400 less the row's own 5 each side */,
            width: 390,
            minWidth: 390,
          }}
        >
          <div className="calc-field">
            <span title={TIP_TYPE}>Type:</span>
            <Combo
              style={{ flex: 1 }}
              ariaLabel="Type"
              value={String(type)}
              options={REGULATOR_TYPE_CHOICES.map((c) => ({
                value: String(c.value),
                label: c.label,
              }))}
              onChange={(v) => setType(Number(v) as RegulatorType)}
            />
          </div>
          {/* a 10 px spacer, then the bitmap with a 10 px border all round
              and centred horizontally (panel_regulator_base.cpp:42-49). */}
          <div
            style={{
              alignSelf: 'center',
              margin: '20px 0' /* [data] a 10 px spacer plus the bitmap's wxALL 10 */,
            }}
          >
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
                /* m_choiceRegulatorSelector holds the list and nothing else —
                   `Append( m_RegulatorList.GetRegList() )` (panel_regulator.cpp:47),
                   so there is no blank entry above it. */
                options={store.regulators.map((r) => ({ value: r.name, label: r.name }))}
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
                accept={`.${REGULATOR_DATA_FILE_EXT}`}
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
            <input className="calc-input ro light" readOnly value={tolMin} />
            <span />
            <input className="calc-input ro light" readOnly value={tolMax} />
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
              className="calc-input ro light"
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

      {/* bSizerRegulRight ends with `Add( 0, 0, 1, wxEXPAND )` — a stretch
          spacer — and only then the button, with wxALIGN_RIGHT and a 10 px
          top/bottom/right border (panel_regulator_base.cpp:364-367). So Reset
          sits at the BOTTOM of the frame, not under Calculate. */}
      <div className="calc-reset-row">
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
              {/* KiCad's OK is never disabled: TransferDataFromWindow just
                  returns false and the dialog stays open, saying nothing
                  (dialog_regulator_form.cpp:48-93). Ours greyed it out, which
                  tells the user something upstream does not. */}
              <button type="button" className="calc-btn" onClick={saveForm}>
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
                style={{ width: 310 }}
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
                options={REGULATOR_TYPE_CHOICES.map((c) => ({
                  value: String(c.value),
                  label: c.label,
                }))}
                onChange={(v) =>
                  setForm((f) => (f ? { ...f, type: Number(v) as RegulatorType } : f))
                }
              />
            </span>
            <span />

            {form.type === RegulatorType.THREE_TERMINAL && (
              <>
                <span>Iadj (typ/max):</span>
                <span className="reg-form-triple iadj">
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
