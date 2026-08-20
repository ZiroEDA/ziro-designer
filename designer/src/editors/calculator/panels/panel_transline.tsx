// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Transmission Lines" panel, analysis/synthesis for the nine line types.
 * Counterpart: KiCad `calculator_panels/panel_transline.cpp`.
 *
 * Every physical dimension has a per-field unit selector (mm/mil/inch/µm…) and
 * the frequency has its own Hz…GHz selector, matching KiCad's UNIT_SELECTOR
 * fields; internally all lengths are held in metres.
 */

import { useState, type JSX } from 'react';
import {
  CONDUCTOR_RESISTIVITIES,
  LOSS_TANGENTS,
  type MaterialPreset,
  RELATIVE_DIELECTRIC_CONSTANTS,
  coaxAnalyze,
  coaxSynthesize,
  coupledStriplineAnalyze,
  coupledStriplineSynthesize,
  dispersedSubstrate,
  coplanarAnalyze,
  coplanarSynthesize,
  coupledMicrostripAnalyze,
  coupledMicrostripSynthesize,
  microstripAnalyze,
  microstripSynthesize,
  rectWaveguideAnalyze,
  striplineAnalyze,
  striplineSynthesize,
  twistedPairAnalyze,
  twistedPairSynthesize,
  type TranslineAnalysis,
  printfG,
} from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { Field, FREQ_UNITS, Group, LEN_UNITS, NumField, fmt, parseNum } from '../fields.js';

type LineType =
  | 'microstrip'
  | 'c_microstrip'
  | 'stripline'
  | 'c_stripline'
  | 'cpw'
  | 'gcpw'
  | 'rectwaveguide'
  | 'coax'
  | 'twistedpair';

const LINE_TYPES: { id: LineType; name: string }[] = [
  // m_TranslineSelectionChoices, spelled exactly as the radio box spells it
  // (panel_transline_base.cpp:23-31) — "Coplanar wave guide", three words.
  { id: 'microstrip', name: 'Microstrip Line' },
  { id: 'c_microstrip', name: 'Coupled Microstrip Line' },
  { id: 'stripline', name: 'Stripline' },
  { id: 'c_stripline', name: 'Coupled Stripline' },
  { id: 'cpw', name: 'Coplanar wave guide' },
  { id: 'gcpw', name: 'Coplanar wave guide w/ ground plane' },
  { id: 'rectwaveguide', name: 'Rectangular Waveguide' },
  { id: 'coax', name: 'Coaxial Line' },
  { id: 'twistedpair', name: 'Twisted Pair' },
];

interface PhysField {
  key: string;
  label: string;
  /** 'len' → held in metres with a length unit selector; 'raw' → plain number. */
  kind: 'len' | 'raw';
  /** Default value in base units (metres for 'len'). */
  def: number;
  /** Starting unit for a length field. */
  unit?: string;
}

const L = (key: string, label: string, defMm: number, unit = 'mm'): PhysField => ({
  key,
  label,
  kind: 'len',
  def: defMm * 1e-3,
  unit,
});

const PHYS_FIELDS: Record<LineType, PhysField[]> = {
  microstrip: [L('w', 'W:', 3), L('h', 'H:', 1.6), L('t', 'T:', 0.035, 'µm'), L('l', 'L:', 50)],
  cpw: [
    L('w', 'W:', 0.5),
    L('s', 'S:', 0.3),
    L('h', 'H:', 1.6),
    L('t', 'T:', 0.035, 'µm'),
    L('l', 'L:', 50),
  ],
  gcpw: [
    L('w', 'W:', 0.5),
    L('s', 'S:', 0.3),
    L('h', 'H:', 1.6),
    L('t', 'T:', 0.035, 'µm'),
    L('l', 'L:', 50),
  ],
  rectwaveguide: [L('a', 'a:', 22.86), L('b', 'b:', 10.16), L('l', 'L:', 100)],
  coax: [L('din', 'din:', 0.9), L('dout', 'dout:', 2.95), L('l', 'L:', 1000)],
  c_microstrip: [
    L('w', 'W:', 0.3),
    L('s', 'S:', 0.2),
    L('h', 'H:', 0.2),
    L('t', 'T:', 0.035, 'µm'),
    L('l', 'L:', 50),
  ],
  stripline: [L('w', 'W:', 0.7), L('h', 'H:', 1.6), L('t', 'T:', 0.035, 'µm'), L('l', 'L:', 50)],
  c_stripline: [
    L('w', 'W:', 0.2),
    L('s', 'S:', 0.2),
    L('h', 'H:', 0.2),
    L('a', 'a:', 0),
    L('t', 'T:', 0.035, 'µm'),
    L('l', 'L:', 50),
  ],
  twistedpair: [
    L('din', 'din:', 0.511),
    L('dout', 'dout:', 0.93),
    { key: 'twists', label: 'Twists:', kind: 'raw', def: 100 },
    L('l', 'L:', 1000),
  ],
};

const SUBSTRATE_DEFAULTS = {
  er: '4.5',
  tand: '0.02',
  // KiCad's panel takes the conductor's specific resistance ρ in Ω·m.
  rho: '1.72e-8',
  mur: '1',
  erEnv: '1',
};

/** Text field with a KiCad-style "…" preset picker that fills the value. */
function PresetField({
  label,
  value,
  onChange,
  unit,
  presets,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  presets: readonly MaterialPreset[];
}): JSX.Element {
  return (
    <div className="calc-field">
      <span className="calc-field-label">{label}</span>
      <input
        className="calc-input"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <Combo
        style={{ minWidth: 62 }}
        value=""
        title="Standard materials"
        options={[
          { value: '', label: '…' },
          ...presets.map((p) => ({ value: String(p.value), label: `${p.value}, ${p.name}` })),
        ]}
        onChange={(v) => {
          if (v !== '') onChange(v);
        }}
      />
      <span className="calc-unit">{unit}</span>
    </div>
  );
}

export function PanelTransline(): JSX.Element {
  const [type, setType] = useState<LineType>('microstrip');
  const [freqHz, setFreqHz] = useState(1e9);
  const [sub, setSub] = useState({ ...SUBSTRATE_DEFAULTS });
  const [phys, setPhys] = useState<Record<string, number>>(() => defaults('microstrip'));
  const [z0, setZ0] = useState('50');
  // Odd-mode impedance target, used by the coupled stripline (KiCad Zodd).
  const [zOdd, setZOdd] = useState('50');
  // Dielectric dispersion model (KiCad m_dielectricModelChoice + spec frequency).
  const [dielModel, setDielModel] = useState<'constant' | 'djordjevic_sarkar'>('constant');
  const [specFreqHz, setSpecFreqHz] = useState(1e9);
  // Solder mask overlay (KiCad m_soldermask* controls; defaults from TRANSLINE::Init).
  const [smPresent, setSmPresent] = useState(false);
  const [smThickM, setSmThickM] = useState(20e-6);
  const [smEr, setSmEr] = useState('3.5');
  const [smTand, setSmTand] = useState('0.025');
  const [smFills, setSmFills] = useState(true);
  // ANG_L_PRM's default is 0 and its unit selector opens on rad
  // (transline_ident.cpp:156).
  const [angle, setAngle] = useState('0');
  const [angleUnit, setAngleUnit] = useState(0);
  const [result, setResult] = useState<TranslineAnalysis | null>(null);
  const [error, setError] = useState('');

  function defaults(t: LineType): Record<string, number> {
    return Object.fromEntries(PHYS_FIELDS[t].map((f) => [f.key, f.def]));
  }

  const pick = (t: LineType): void => {
    setType(t);
    setPhys(defaults(t));
    setResult(null);
    setError('');
    setZ0(t === 'c_microstrip' ? '100' : t === 'twistedpair' ? '120' : '50');
    setZOdd('50');
  };

  // PANEL_TRANSLINE::OnTransLineResetButtonClick (transline_dlg_funct.cpp:356-372):
  // every TRANSLINE_PRM goes back to its m_DefaultValue and m_DefaultUnit, then
  // the type is re-selected, which redraws the whole page. Re-picking the
  // current type does exactly that here.
  const resetDefaults = (): void => {
    pick(type);
    setAngle('0');
    setAngleUnit(0);
  };

  const el = () => {
    const base = {
      frequencyHz: freqHz,
      epsilonR: parseNum(sub.er),
      tanD: parseNum(sub.tand),
      sigma: 1 / parseNum(sub.rho),
      mur: 1, // dielectric relative permeability (non-magnetic substrate)
      murC: parseNum(sub.mur),
    };
    // Djordjevic-Sarkar overlays the dispersed εr / tan δ at the operating
    // frequency, exactly as KiCad's UpdateDielectricModel does per analysis.
    const d = dispersedSubstrate(base, { model: dielModel, specFreqHz });
    return { ...base, epsilonR: d.epsilonR, tanD: d.tanD };
  };
  const v = (key: string): number => phys[key] ?? 0;

  // Mask correction applies to microstrip, coupled microstrip, CPW and CBCPW.
  const maskApplies = ['microstrip', 'c_microstrip', 'cpw', 'gcpw'].includes(type);
  const soldermask = () => ({
    present: smPresent,
    thicknessM: smThickM,
    epsilonR: parseNum(smEr),
    tanD: parseNum(smTand),
    fillsGaps: smFills,
  });

  const analyze = (): void => {
    setError('');
    try {
      const e = el();
      let r: TranslineAnalysis;
      switch (type) {
        case 'microstrip':
          r = microstripAnalyze(
            { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
            e,
            soldermask(),
          );
          break;
        case 'cpw':
        case 'gcpw':
          r = coplanarAnalyze(
            { widthM: v('w'), gapM: v('s'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
            e,
            type === 'gcpw',
            soldermask(),
          );
          break;
        case 'rectwaveguide':
          r = rectWaveguideAnalyze({ aM: v('a'), bM: v('b'), lengthM: v('l') }, e);
          break;
        case 'coax':
          r = coaxAnalyze({ innerDiaM: v('din'), outerDiaM: v('dout'), lengthM: v('l') }, e);
          break;
        case 'c_microstrip':
          r = coupledMicrostripAnalyze(
            {
              widthM: v('w'),
              gapM: v('s'),
              heightM: v('h'),
              thicknessM: v('t'),
              lengthM: v('l'),
            },
            e,
            soldermask(),
          );
          break;
        case 'stripline':
          r = striplineAnalyze(
            { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
            e,
          );
          break;
        case 'c_stripline': {
          const cr = coupledStriplineAnalyze(
            {
              widthM: v('w'),
              gapM: v('s'),
              heightM: v('h'),
              offsetAM: v('a'),
              thicknessM: v('t'),
              lengthM: v('l'),
            },
            e,
          );
          r = {
            z0: Math.sqrt(cr.z0Even * cr.z0Odd),
            epsEff: cr.epsEffEven,
            angleDeg: cr.angleDeg,
            conductorLossDb: 0.5 * (cr.attenCondEvenDb + cr.attenCondOddDb),
            dielectricLossDb: 0.5 * (cr.attenDielEvenDb + cr.attenDielOddDb),
            skinDepthM: cr.skinDepthM,
            extra: {
              z0Even: cr.z0Even,
              z0Odd: cr.z0Odd,
              zDiff: cr.zDiff,
              zComm: cr.zComm,
              coupling: cr.couplingK,
            },
          };
          setZOdd(fmt(cr.z0Odd, 5));
          break;
        }
        case 'twistedpair':
          r = twistedPairAnalyze(
            { dinM: v('din'), doutM: v('dout'), twistsPerM: v('twists'), lengthM: v('l') },
            { ...e, epsilonRenv: parseNum(sub.erEnv) },
          );
          break;
      }
      setResult(r);
      // `%g` — the real field reads 66.9548, not 66.955.
      if (type === 'c_stripline') setZ0(printfG(r.extra?.z0Even ?? r.z0));
      else setZ0(printfG(type === 'c_microstrip' ? (r.extra?.zDiff ?? r.z0) : r.z0));
      setAngle(printfG(angleUnit === 0 ? (r.angleDeg * Math.PI) / 180 : r.angleDeg));
    } catch {
      setError('Analysis failed, check the input values.');
    }
  };

  const synthesize = (): void => {
    setError('');
    const e = el();
    const zTarget = parseNum(z0);
    // The field is in radians unless the selector says degrees.
    const angRaw = parseNum(angle);
    const angTarget = angleUnit === 0 ? (angRaw * 180) / Math.PI : angRaw;
    if (!(zTarget > 0) || !(angTarget > 0)) {
      setError('Enter a positive Z0 and electrical length.');
      return;
    }
    let next: Record<string, number> | null = null;
    switch (type) {
      case 'microstrip': {
        const s = microstripSynthesize(
          { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, w: s.widthM, l: s.lengthM };
        break;
      }
      case 'cpw':
      case 'gcpw': {
        const s = coplanarSynthesize(
          { widthM: v('w'), gapM: v('s'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
          e,
          type === 'gcpw',
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, s: s.gapM, l: s.lengthM };
        break;
      }
      case 'rectwaveguide':
        setError('Synthesis is not available for rectangular waveguides.');
        return;
      case 'coax': {
        const s = coaxSynthesize(
          { innerDiaM: v('din'), outerDiaM: v('dout'), lengthM: v('l') },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, din: s.innerDiaM, l: s.lengthM };
        break;
      }
      case 'c_microstrip': {
        const s = coupledMicrostripSynthesize(
          {
            widthM: v('w'),
            gapM: v('s'),
            heightM: v('h'),
            thicknessM: v('t'),
            lengthM: v('l'),
          },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, s: s.gapM, l: s.lengthM };
        break;
      }
      case 'stripline': {
        const s = striplineSynthesize(
          { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, w: s.widthM, l: s.lengthM };
        break;
      }
      case 'c_stripline': {
        // Joint (W, S) Newton solve for the Zeven/Zodd targets (KiCad default path).
        const zOddTarget = parseNum(zOdd);
        if (!(zOddTarget > 0)) {
          setError('Enter a positive odd-mode impedance.');
          return;
        }
        const s = coupledStriplineSynthesize(
          {
            widthM: v('w'),
            gapM: v('s'),
            heightM: v('h'),
            offsetAM: v('a'),
            thicknessM: v('t'),
            lengthM: v('l'),
          },
          e,
          zTarget,
          zOddTarget,
        );
        if (s) next = { ...phys, w: s.widthM, s: s.gapM };
        break;
      }
      case 'twistedpair': {
        const s = twistedPairSynthesize(
          { dinM: v('din'), doutM: v('dout'), twistsPerM: v('twists'), lengthM: v('l') },
          { ...e, epsilonRenv: parseNum(sub.erEnv) },
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, din: s.dinM, l: s.lengthM };
        break;
      }
    }
    if (!next) {
      setError('No physical solution found for this target impedance.');
      return;
    }
    setPhys(next);
    setResult(null);
  };

  const isDiff = type === 'c_microstrip';
  const extraRows: [string, string][] = [];
  if (result?.extra) {
    const x = result.extra;
    if (x.z0Even != null) extraRows.push(['Even-mode impedance (Ze)', `${fmt(x.z0Even, 5)} Ω`]);
    if (x.z0Odd != null) extraRows.push(['Odd-mode impedance (Zo)', `${fmt(x.z0Odd, 5)} Ω`]);
    if (x.zDiff != null) extraRows.push(['Differential impedance (Zd)', `${fmt(x.zDiff, 5)} Ω`]);
    if (x.zComm != null) extraRows.push(['Common-mode impedance (Zc)', `${fmt(x.zComm, 5)} Ω`]);
    if (x.coupling != null) extraRows.push(['Coupling factor', fmt(x.coupling, 4)]);
    if (x.te11CutoffHz != null)
      extraRows.push(['TE11 cutoff', `${fmt(x.te11CutoffHz / 1e9, 4)} GHz`]);
    if (x.fcTE10Hz != null) extraRows.push(['TE10 cutoff', `${fmt(x.fcTE10Hz / 1e9, 4)} GHz`]);
    if (x.fcTE20Hz != null) extraRows.push(['TE20 cutoff', `${fmt(x.fcTE20Hz / 1e9, 4)} GHz`]);
    if (x.fcTE01Hz != null) extraRows.push(['TE01 cutoff', `${fmt(x.fcTE01Hz / 1e9, 4)} GHz`]);
    if (x.guideWavelengthM != null)
      extraRows.push(['Guide wavelength', `${fmt(x.guideWavelengthM * 1000, 5)} mm`]);
  }

  return (
    <div className="calc-page-body">
      {/* A wxRadioBox, one column, titled by the box itself
          (panel_transline_base.cpp:33). It was a drop-down. */}
      <Group title="Transmission Line Type" className="tl-types">
        {LINE_TYPES.map((t) => (
          <label key={t.id} className="calc-radio">
            <input
              type="radio"
              name="tl-type"
              checked={type === t.id}
              onChange={() => pick(t.id)}
            />
            {t.name}
          </label>
        ))}
      </Group>

      <div className="calc-row">
        <Group title="Substrate Parameters">
          <PresetField
            label="εr:"
            value={sub.er}
            onChange={(val) => setSub({ ...sub, er: val })}
            unit=""
            presets={RELATIVE_DIELECTRIC_CONSTANTS}
          />
          <PresetField
            label="tan δ:"
            value={sub.tand}
            onChange={(val) => setSub({ ...sub, tand: val })}
            unit=""
            presets={LOSS_TANGENTS}
          />
          <PresetField
            label="ρ:"
            value={sub.rho}
            onChange={(val) => setSub({ ...sub, rho: val })}
            unit="Ω·m"
            presets={CONDUCTOR_RESISTIVITIES}
          />
          <div
            className="calc-field"
            title={
              "'Constant': εr and tan δ applied at all frequencies.\n" +
              "'Djordjevic-Sarkar': causal wideband Debye anchored at the spec frequency."
            }
          >
            <span className="calc-field-label">Dielectric model:</span>
            <Combo
              value={dielModel}
              options={[
                { value: 'constant', label: 'Constant' },
                { value: 'djordjevic_sarkar', label: 'Djordjevic-Sarkar' },
              ]}
              onChange={(v) => setDielModel(v as 'constant' | 'djordjevic_sarkar')}
            />
          </div>
          {dielModel === 'djordjevic_sarkar' && (
            <NumField
              label="εr, tanδ spec frequency:"
              units={FREQ_UNITS}
              base={specFreqHz}
              onBase={setSpecFreqHz}
            />
          )}
          {maskApplies && (
            <>
              <label
                className="calc-field"
                title={
                  'Enable solder resist / LPI overlay correction.  Affects εeff, Z0, and ' +
                  'dielectric loss for microstrip, coupled microstrip, CPW, and CBCPW.'
                }
              >
                <input
                  type="checkbox"
                  checked={smPresent}
                  onChange={(e) => setSmPresent(e.target.checked)}
                />
                <span className="calc-field-label">Solder mask present</span>
              </label>
              {smPresent && (
                <>
                  <NumField
                    label="Mask thickness:"
                    units={LEN_UNITS}
                    defaultUnit="µm"
                    base={smThickM}
                    onBase={setSmThickM}
                  />
                  <Field
                    label="Mask εr:"
                    value={smEr}
                    onChange={setSmEr}
                    unit=""
                    title="Mask relative permittivity. Default 3.5 for standard green LPI. Range 3.3-3.8 for typical resins."
                  />
                  <Field
                    label="Mask tanδ:"
                    value={smTand}
                    onChange={setSmTand}
                    unit=""
                    title="Mask loss tangent. Default 0.025 for LPI."
                  />
                  {(type === 'cpw' || type === 'gcpw') && (
                    <label
                      className="calc-field"
                      title={
                        'Enable when the mask fills the CPW slots (standard LPI process).\n' +
                        'Disable for selective mask that covers only the traces.'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={smFills}
                        onChange={(e) => setSmFills(e.target.checked)}
                      />
                      <span className="calc-field-label">Mask fills gaps</span>
                    </label>
                  )}
                </>
              )}
            </>
          )}
          <Field
            label="Conductor permeability (µ):"
            value={sub.mur}
            onChange={(val) => setSub({ ...sub, mur: val })}
            unit=""
          />
          {type === 'twistedpair' && (
            <Field
              label="Environment εr:"
              value={sub.erEnv}
              onChange={(val) => setSub({ ...sub, erEnv: val })}
              unit=""
            />
          )}
          {/* The ONE label wxFormBuilder right-aligns in this whole launcher:
              `fgSizeCmpPrms->Add( m_Frequency_label, 0,
              wxALIGN_CENTER_VERTICAL|wxALIGN_RIGHT, 5 )`
              (panel_transline_base.cpp:207). Every other parameter label is
              flush left, which is why the app-wide rule is left. */}
          <NumField
            label="Frequency:"
            labelAlign="right"
            units={FREQ_UNITS}
            base={freqHz}
            onBase={setFreqHz}
          />
        </Group>

        <Group title="Physical Parameters">
          {PHYS_FIELDS[type].map((f) =>
            f.kind === 'len' ? (
              <NumField
                key={f.key}
                label={f.label}
                units={LEN_UNITS}
                defaultUnit={f.unit ?? 'mm'}
                base={v(f.key)}
                onBase={(val) => setPhys((p) => ({ ...p, [f.key]: val }))}
              />
            ) : (
              <Field
                key={f.key}
                label={f.label}
                value={fmt(v(f.key))}
                onChange={(val) => setPhys((p) => ({ ...p, [f.key]: Number(val) || 0 }))}
                unit="1/m"
              />
            ),
          )}
        </Group>

        <Group title="Electrical Parameters">
          <Field
            label={type === 'c_stripline' ? 'Zeven:' : isDiff ? 'Zdiff:' : 'Z0:'}
            value={z0}
            onChange={setZ0}
            unit="Ω"
          />
          {type === 'c_stripline' && (
            <Field label="Zodd:" value={zOdd} onChange={setZOdd} unit="Ω" />
          )}
          {/* ANG_L_PRM carries a rad/deg UNIT_SELECTOR_ANGLE opening on rad
              (transline_ident.cpp:156), so the real field reads 1.79748, not
              102.99. */}
          <div className="calc-field">
            <span className="calc-field-label">Ang_l:</span>
            <input
              className="calc-input"
              value={angle}
              spellCheck={false}
              onChange={(e) => setAngle(e.target.value)}
            />
            <Combo
              ariaLabel="Ang_l unit"
              style={{ minWidth: 78 }}
              value={String(angleUnit)}
              options={[
                { value: '0', label: 'rad' },
                { value: '1', label: 'deg' },
              ]}
              onChange={(v) => {
                const next = Number(v);
                const cur = Number(angle);
                if (Number.isFinite(cur))
                  setAngle(printfG(next === 0 ? (cur * Math.PI) / 180 : (cur * 180) / Math.PI));
                setAngleUnit(next);
              }}
            />
          </div>
          {/* m_AnalyseButton + m_bpButtonAnalyze (small_down), then
              m_SynthetizeButton + m_bpButtonSynthetize (small_up); plain
              buttons, and the arrows are separate bitmap buttons wired to the
              same handlers (panel_transline_base.cpp:307-325). */}
          <div className="tl-buttons">
            <button type="button" className="calc-btn" onClick={analyze}>
              Analyze
            </button>
            <button
              type="button"
              className="calc-btn exactfit"
              aria-label="Analyze"
              onClick={analyze}
            >
              ↓
            </button>
            <button type="button" className="calc-btn" onClick={synthesize}>
              Synthesize
            </button>
            <button
              type="button"
              className="calc-btn exactfit"
              aria-label="Synthesize"
              onClick={synthesize}
            >
              ↑
            </button>
          </div>
        </Group>
      </div>

      {error && <div className="calc-error">{error}</div>}

      {/* m_buttonTransLineReset, wxALIGN_RIGHT|wxALL 10
          (panel_transline_base.cpp:480-481). */}
      <div className="calc-reset-row">
        <button type="button" className="calc-btn" onClick={resetDefaults}>
          Reset to Defaults
        </button>
      </div>

      <Group title="Results">
        <table className="calc-table">
          <tbody>
            <tr>
              <td className="rowhead">Effective εr:</td>
              <td>{result ? printfG(result.epsEff) : ''}</td>
            </tr>
            <tr>
              <td className="rowhead">Conductor losses:</td>
              <td>
                {result && Number.isFinite(result.conductorLossDb)
                  ? `${printfG(result.conductorLossDb)} dB`
                  : ''}
              </td>
            </tr>
            <tr>
              <td className="rowhead">Dielectric losses:</td>
              <td>
                {result && Number.isFinite(result.dielectricLossDb)
                  ? `${printfG(result.dielectricLossDb)} dB`
                  : ''}
              </td>
            </tr>
            <tr>
              <td className="rowhead">Skin depth:</td>
              <td>{result ? `${printfG(result.skinDepthM * 1e6)} µm` : ''}</td>
            </tr>
            {extraRows.map(([k, val]) => (
              <tr key={k}>
                <td className="rowhead">{k}</td>
                <td>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>
    </div>
  );
}
