// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Transmission Lines" panel, analysis/synthesis for the nine line types.
 * Counterpart: KiCad `calculator_panels/panel_transline.cpp` +
 * `panel_transline_base.cpp` + `transline_dlg_funct.cpp`.
 *
 * THE PANEL IS BUILT FROM FIXED SLOTS, NOT FROM THE PARAMETER LIST.
 * `panel_transline_base.cpp` creates nine substrate rows, one frequency row,
 * three physical rows, three electrical rows and ten result rows ONCE.
 * Selecting a type then walks `TRANSLINE_IDENT`'s parameters and pours them
 * into those slots in order, blanking and disabling whatever is left over
 * (transline_dlg_funct.cpp:190-310). That is why the boxes do not change height
 * when you change type, and it is what this file reproduces — the table itself
 * lives in `transline_ident.ts`.
 *
 * Layout (panel_transline_base.cpp:16-485), a horizontal box of three columns:
 *   left    the "Transmission Line Type" wxRadioBox, then BITMAPS::<type>
 *   middle  "Substrate Parameters", then "Component Parameters" (Frequency
 *           alone), then the coupled-line helper bitmap
 *   right   "Physical Parameters", the Analyze/Synthesize row, "Electrical
 *           Parameters", "Results", a stretch spacer, Reset to Defaults
 *
 * What this replaced, all of it ours and none of it upstream's: a "Dielectric
 * model" drop-down, a "Solder mask present" checkbox and its four fields,
 * drop-downs where KiCad has narrow `...` buttons, H and T sitting among the
 * physical parameters, Analyze/Synthesize inside the Electrical box, a Results
 * table across the page's bottom, and W/H defaults of 3 mm and 1.6 mm against
 * upstream's 0.2 and 0.2.
 */

import {
  CONDUCTOR_RESISTIVITIES,
  LOSS_TANGENTS,
  type MaterialPreset,
  RELATIVE_DIELECTRIC_CONSTANTS,
  coaxAnalyze,
  coaxSynthesize,
  coplanarAnalyze,
  coplanarSynthesize,
  coupledMicrostripAnalyze,
  coupledMicrostripSynthesize,
  coupledStriplineAnalyze,
  coupledStriplineSynthesize,
  microstripAnalyze,
  microstripSynthesize,
  printfG,
  rectWaveguideAnalyze,
  striplineAnalyze,
  striplineSynthesize,
  twistedPairAnalyze,
  twistedPairSynthesize,
  unitPropagationDelay,
} from '@ziroeda/pcb_calculator';
import { type CSSProperties, type JSX, useState } from 'react';
import { Combo } from '../../../ui/Combo.js';
import { SingleChoiceDialog } from '../../../ui/dialog_single_choice.js';
import {
  ANGLE_UNITS,
  FREQ_UNITS,
  Group,
  LEN_UNITS,
  RES_UNITS,
  type UnitOpt,
  parseNum,
} from '../fields.js';
import {
  ELEC_SLOTS,
  FREQUENCY_PRM,
  LINE_TYPE_ORDER,
  type LineType,
  PHYS_SLOTS,
  RESULT_SLOTS,
  SUBS_SLOTS,
  TRANSLINES,
  type TranslinePrm,
} from './transline_ident.js';

// KiCad's own dark-theme artwork (GPL), vendored under assets/.
const TL_ART = import.meta.glob('../../../assets/calculator/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * m_translineBitmap: `KiBitmapBundle( m_transline_list[type]->m_BitmapName )`
 * (transline_dlg_funct.cpp:108). Drawn 1:1 at the size the dark PNG has, which
 * is what the bundle picks at 100% scale.
 */
const ART_SIZE: Record<string, [number, number]> = {
  microstrip: [227, 174],
  c_microstrip: [227, 174],
  stripline: [223, 167],
  coupled_stripline: [322, 167],
  cpw: [227, 167],
  cpw_back: [220, 167],
  rectwaveguide: [265, 163],
  coax: [242, 227],
  twistedpair: [246, 216],
  microstrip_zodd_zeven: [394, 174],
};

function Art({ name }: { name: string }): JSX.Element | null {
  const src = TL_ART[`../../../assets/calculator/${name}.svg`];
  const [w, h] = ART_SIZE[name] ?? [0, 0];
  if (!src) return null;
  return <img className="calc-art tl-art" src={src} alt="" width={w} height={h} />;
}

const UNIT_LISTS: Record<string, UnitOpt[]> = {
  len: LEN_UNITS,
  freq: FREQ_UNITS,
  res: RES_UNITS,
  angle: ANGLE_UNITS,
};

/** The three `...` buttons and the wxGetSingleChoiceIndex each one raises
 *  (transline_dlg_funct.cpp:45,63,81). */
const PICKERS: Record<string, { caption: string; list: readonly MaterialPreset[]; key: string }> = {
  epsilonR: {
    caption: 'Relative Dielectric Constants',
    list: RELATIVE_DIELECTRIC_CONSTANTS,
    key: 'Er',
  },
  tanD: { caption: 'Dielectric Loss Factor', list: LOSS_TANGENTS, key: 'TanD' },
  rho: { caption: 'Specific Resistance', list: CONDUCTOR_RESISTIVITIES, key: 'Rho' },
};

/** Every parameter of a type, in the order the slots are filled. */
const allPrms = (t: LineType): TranslinePrm[] => {
  const id = TRANSLINES[t];
  return [...id.subs, FREQUENCY_PRM, ...id.phys, ...id.elec];
};

/**
 * `data->value->SetValue( wxString::Format( wxS( "%g" ), prm->m_Value ) )`
 * (transline_dlg_funct.cpp:234). So H(top) opens reading `1e+20`, ρ `1.72e-08`
 * and Roughness `0` — not `1e20`, `1.72e-8` or an empty field.
 */
const defaults = (t: LineType): Record<string, string> =>
  Object.fromEntries(allPrms(t).map((p) => [p.key, p.dummy ? '' : printfG(p.def)]));

/** `data->unit->SetSelection( prm->m_UnitSelection )`, and a fresh panel's is 0. */
const defaultUnits = (t: LineType): Record<string, number> =>
  Object.fromEntries(allPrms(t).map((p) => [p.key, 0]));

export function PanelTransline(): JSX.Element {
  const [type, setType] = useState<LineType>('microstrip');
  const [vals, setVals] = useState<Record<string, string>>(() => defaults('microstrip'));
  const [units, setUnits] = useState<Record<string, number>>(() => defaultUnits('microstrip'));
  /** The ten Results slots. Empty until Analyze/Synthesize runs, as upstream. */
  const [msgs, setMsgs] = useState<string[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState('');

  const ident = TRANSLINES[type];
  const prmByKey = new Map(allPrms(type).map((p) => [p.key, p]));

  const text = (key: string): string => vals[key] ?? '';
  const num = (key: string): number => parseNum(text(key));
  /** The field's number times its selector's scale — KiCad's FromUserUnit(). */
  const si = (key: string): number => {
    const p = prmByKey.get(key);
    const list = p ? UNIT_LISTS[p.units] : undefined;
    return num(key) * (list?.[units[key] ?? 0]?.mult ?? 1);
  };
  const put = (key: string, v: string): void => setVals((s) => ({ ...s, [key]: v }));

  /**
   * PANEL_TRANSLINE::OnTranslineSelection — every parameter goes back to its
   * m_DefaultValue and m_DefaultUnit and the messages are cleared
   * (transline_dlg_funct.cpp:96-145).
   */
  const pick = (t: LineType): void => {
    setType(t);
    setVals(defaults(t));
    setUnits(defaultUnits(t));
    setMsgs([]);
    setError('');
  };
  const resetDefaults = (): void => pick(type);

  const el = () => ({
    frequencyHz: si('Frequency'),
    epsilonR: num('Er'),
    tanD: num('TanD'),
    sigma: 1 / num('Rho'),
    // MUR_PRM is the substrate's / insulator's; only microstrip and the two
    // hollow-guide types carry one, and the rest imply 1.
    mur: prmByKey.has('mu Rel S')
      ? num('mu Rel S')
      : prmByKey.has('mu Rel I')
        ? num('mu Rel I')
        : 1,
    murC: prmByKey.has('mu Rel C') ? num('mu Rel C') : 1,
  });

  const g = (v: number | undefined, unit = ''): string =>
    v == null || !Number.isFinite(v) ? '' : unit ? `${printfG(v)} ${unit}` : printfG(v);

  /** The Ang_l field is in whatever its selector says; rad is index 0. */
  const angleToField = (deg: number): number =>
    (units.Ang_l ?? 0) === 0 ? (deg * Math.PI) / 180 : deg;

  const setElecFromZ = (z0: number, angleDeg: number): void => {
    const scale = RES_UNITS[units.Z0 ?? 0]?.mult ?? 1;
    setVals((s) => ({ ...s, Z0: printfG(z0 / scale), Ang_l: printfG(angleToField(angleDeg)) }));
  };

  const analyze = (): void => {
    setError('');
    try {
      const e = el();
      const out: string[] = [];
      switch (type) {
        case 'microstrip':
        case 'stripline': {
          const phys = {
            widthM: si('W'),
            heightM: si('H'),
            thicknessM: si('T'),
            lengthM: si('L'),
          };
          const r = type === 'microstrip' ? microstripAnalyze(phys, e) : striplineAnalyze(phys, e);
          out.push(
            g(r.epsEff),
            g(unitPropagationDelay(r.epsEff), 'ps/cm'),
            g(r.conductorLossDb, 'dB'),
            g(r.dielectricLossDb, 'dB'),
            g(r.skinDepthM * 1e6, 'µm'),
          );
          setElecFromZ(r.z0, r.angleDeg);
          break;
        }
        case 'cpw':
        case 'gcpw': {
          const r = coplanarAnalyze(
            {
              widthM: si('W'),
              gapM: si('S'),
              heightM: si('H'),
              thicknessM: si('T'),
              lengthM: si('L'),
            },
            e,
            type === 'gcpw',
          );
          out.push(
            g(r.epsEff),
            g(unitPropagationDelay(r.epsEff), 'ps/cm'),
            g(r.conductorLossDb, 'dB'),
            g(r.dielectricLossDb, 'dB'),
            g(r.skinDepthM * 1e6, 'µm'),
          );
          setElecFromZ(r.z0, r.angleDeg);
          break;
        }
        case 'rectwaveguide': {
          const r = rectWaveguideAnalyze({ aM: si('a'), bM: si('b'), lengthM: si('L') }, e);
          // setResult( 0, Z0EH, "Ohm" ) — spelled "Ohm" here, not "Ω"
          // (rectwaveguide.cpp:380).
          out.push(
            g(r.z0, 'Ohm'),
            g(r.epsEff),
            g(r.conductorLossDb, 'dB'),
            g(r.dielectricLossDb, 'dB'),
            r.teModes,
            r.tmModes,
          );
          setElecFromZ(r.z0, r.angleDeg);
          break;
        }
        case 'coax': {
          const r = coaxAnalyze(
            { innerDiaM: si('Din'), outerDiaM: si('Dout'), lengthM: si('L') },
            e,
          );
          out.push(
            g(r.epsEff),
            g(r.conductorLossDb, 'dB'),
            g(r.dielectricLossDb, 'dB'),
            r.teModes,
            r.tmModes,
          );
          setElecFromZ(r.z0, r.angleDeg);
          break;
        }
        case 'c_microstrip': {
          const r = coupledMicrostripAnalyze(
            {
              widthM: si('W'),
              gapM: si('S'),
              heightM: si('H'),
              thicknessM: si('T'),
              lengthM: si('L'),
            },
            e,
          );
          const x = r.extra;
          out.push(
            g(x.epsEffEven),
            g(x.epsEffOdd),
            g(unitPropagationDelay(x.epsEffEven), 'ps/cm'),
            g(unitPropagationDelay(x.epsEffOdd), 'ps/cm'),
            // C_MICROSTRIP reports conductor and dielectric loss per mode
            // (c_microstrip.cpp:60-63). Our engine returns one figure for the
            // pair, so the odd slot is left EMPTY rather than repeating the
            // even one — an empty cell is honest, a duplicated number is not.
            g(r.conductorLossDb, 'dB'),
            '',
            g(r.dielectricLossDb, 'dB'),
            '',
            g(r.skinDepthM * 1e6, 'µm'),
            g(x.zDiff, 'Ω'),
          );
          setVals((s) => ({
            ...s,
            Zeven: printfG(x.z0Even),
            Zodd: printfG(x.z0Odd),
            Ang_l: printfG(angleToField(r.angleDeg)),
          }));
          break;
        }
        case 'c_stripline': {
          const r = coupledStriplineAnalyze(
            {
              widthM: si('W'),
              gapM: si('S'),
              heightM: si('H'),
              offsetAM: 0,
              thicknessM: si('T'),
              lengthM: si('L'),
            },
            e,
          );
          out.push(
            g(r.epsEffEven),
            g(r.epsEffOdd),
            g(unitPropagationDelay(r.epsEffEven), 'ps/cm'),
            g(unitPropagationDelay(r.epsEffOdd), 'ps/cm'),
            g(r.skinDepthM * 1e6, 'µm'),
            g(r.zDiff, 'Ω'),
          );
          setVals((s) => ({
            ...s,
            Zeven: printfG(r.z0Even),
            Zodd: printfG(r.z0Odd),
            Ang_l: printfG(angleToField(r.angleDeg)),
          }));
          break;
        }
        case 'twistedpair': {
          const r = twistedPairAnalyze(
            {
              dinM: si('Din'),
              doutM: si('Dout'),
              twistsPerM: num('Twists'),
              lengthM: si('L'),
            },
            { ...e, epsilonRenv: num('ErEnv') },
          );
          out.push(
            g(r.epsEff),
            g(r.conductorLossDb, 'dB'),
            g(r.dielectricLossDb, 'dB'),
            g(r.skinDepthM * 1e6, 'µm'),
          );
          setElecFromZ(r.z0, r.angleDeg);
          break;
        }
      }
      setMsgs(out);
    } catch {
      setError('Analysis failed, check the input values.');
    }
  };

  const synthesize = (): void => {
    setError('');
    const e = el();
    const zTarget = si(prmByKey.has('Zeven') ? 'Zeven' : 'Z0');
    const angRaw = num('Ang_l');
    const angTarget = (units.Ang_l ?? 0) === 0 ? (angRaw * 180) / Math.PI : angRaw;
    if (!(zTarget > 0) || !(angTarget > 0)) {
      setError('Enter a positive impedance and electrical length.');
      return;
    }
    const noSolution = (): void =>
      setError('No physical solution found for this target impedance.');
    const setLen = (key: string, metres: number): void =>
      put(key, printfG(metres / (LEN_UNITS[units[key] ?? 0]?.mult ?? 1e-3)));

    switch (type) {
      case 'microstrip':
      case 'stripline': {
        const phys = {
          widthM: si('W'),
          heightM: si('H'),
          thicknessM: si('T'),
          lengthM: si('L'),
        };
        const s =
          type === 'microstrip'
            ? microstripSynthesize(phys, e, zTarget, angTarget)
            : striplineSynthesize(phys, e, zTarget, angTarget);
        if (!s) {
          noSolution();
          return;
        }
        setLen('W', s.widthM);
        setLen('L', s.lengthM);
        break;
      }
      case 'cpw':
      case 'gcpw': {
        const s = coplanarSynthesize(
          {
            widthM: si('W'),
            gapM: si('S'),
            heightM: si('H'),
            thicknessM: si('T'),
            lengthM: si('L'),
          },
          e,
          type === 'gcpw',
          zTarget,
          angTarget,
        );
        if (!s) {
          noSolution();
          return;
        }
        setLen('S', s.gapM);
        setLen('L', s.lengthM);
        break;
      }
      case 'rectwaveguide':
        setError('Synthesis is not available for rectangular waveguides.');
        return;
      case 'coax': {
        const s = coaxSynthesize(
          { innerDiaM: si('Din'), outerDiaM: si('Dout'), lengthM: si('L') },
          e,
          zTarget,
          angTarget,
        );
        if (!s) {
          noSolution();
          return;
        }
        setLen('Din', s.innerDiaM);
        setLen('L', s.lengthM);
        break;
      }
      case 'c_microstrip': {
        const s = coupledMicrostripSynthesize(
          {
            widthM: si('W'),
            gapM: si('S'),
            heightM: si('H'),
            thicknessM: si('T'),
            lengthM: si('L'),
          },
          e,
          zTarget,
          angTarget,
        );
        if (!s) {
          noSolution();
          return;
        }
        setLen('S', s.gapM);
        setLen('L', s.lengthM);
        break;
      }
      case 'c_stripline': {
        const zOddTarget = si('Zodd');
        if (!(zOddTarget > 0)) {
          setError('Enter a positive odd-mode impedance.');
          return;
        }
        const s = coupledStriplineSynthesize(
          {
            widthM: si('W'),
            gapM: si('S'),
            heightM: si('H'),
            offsetAM: 0,
            thicknessM: si('T'),
            lengthM: si('L'),
          },
          e,
          zTarget,
          zOddTarget,
        );
        if (!s) {
          noSolution();
          return;
        }
        setLen('W', s.widthM);
        setLen('S', s.gapM);
        break;
      }
      case 'twistedpair': {
        const s = twistedPairSynthesize(
          {
            dinM: si('Din'),
            doutM: si('Dout'),
            twistsPerM: num('Twists'),
            lengthM: si('L'),
          },
          { ...e, epsilonRenv: num('ErEnv') },
          zTarget,
          angTarget,
        );
        if (!s) {
          noSolution();
          return;
        }
        setLen('Din', s.dinM);
        setLen('L', s.lengthM);
        break;
      }
    }
    setMsgs([]);
  };

  /**
   * One slot. Label, entry, then whichever third column the parameter carries:
   * a unit selector, a static unit, or nothing. `wxALIGN_CENTER_VERTICAL` on
   * the label and `AddGrowableCol( 1 )` on the entry are what `.calc-grid3`
   * reproduces.
   */
  const prmRow = (p: TranslinePrm | undefined, slotKey: string): JSX.Element => {
    if (!p) {
      // An UNUSED slot: blank label, empty field, `Enable( false )`, selector
      // hidden (transline_dlg_funct.cpp:255-268). The row still occupies its
      // grid line, which is why the boxes keep their height across types.
      return (
        <label className="calc-field" key={slotKey}>
          <span className="calc-field-label" />
          <input className="calc-input" value="" disabled readOnly />
          <span className="calc-unit" />
        </label>
      );
    }
    const list = UNIT_LISTS[p.units];
    return (
      <label className="calc-field" key={slotKey} title={p.tip}>
        {/* `prm->m_DlgLabel != "" ? prm->m_DlgLabel + ':' : ""`
            (transline_dlg_funct.cpp:227) — the DUMMY row's label is EMPTY, so
            it must not render a bare colon, which is what appending
            unconditionally produced. */}
        <span className="calc-field-label">{p.label === '' ? '' : `${p.label}:`}</span>
        {p.pick ? (
          <span className="calc-cell">
            <input
              className="calc-input"
              value={text(p.key)}
              spellCheck={false}
              onChange={(ev) => put(p.key, ev.target.value)}
            />
            {/* A plain wxButton labelled "..." with wxBU_EXACTFIT
                (panel_transline_base.cpp:70) — not the drop-down ours had. */}
            <button
              type="button"
              className="calc-btn calc-pick"
              onClick={() => setPicking(p.pick ?? null)}
            >
              ...
            </button>
          </span>
        ) : (
          <input
            className="calc-input"
            value={text(p.key)}
            disabled={p.dummy}
            readOnly={p.dummy}
            spellCheck={false}
            onChange={(ev) => put(p.key, ev.target.value)}
          />
        )}
        {list ? (
          <Combo
            ariaLabel={`${p.label} unit`}
            value={String(units[p.key] ?? 0)}
            options={list.map((u, i) => ({ value: String(i), label: u.label }))}
            onChange={(v) => setUnits((s) => ({ ...s, [p.key]: Number(v) }))}
          />
        ) : (
          <span className="calc-unit">{p.staticUnit ?? ''}</span>
        )}
      </label>
    );
  };

  const slots = (list: TranslinePrm[], n: number, tag: string): JSX.Element[] =>
    Array.from({ length: n }, (_, i) => prmRow(list[i], `${tag}${i}`));

  return (
    <div className="tl-panel calc-page-body">
      {/* bSizeTransline, wxHORIZONTAL (panel_transline_base.cpp:17). */}
      <div className="calc-row tl-row">
        <div className="tl-left">
          {/* A wxRadioBox, ONE column, SetSelection( 0 )
              (panel_transline_base.cpp:33-35). */}
          <Group title="Transmission Line Type" className="tl-types">
            {LINE_TYPE_ORDER.map((t) => (
              <label key={t} className="calc-radio">
                <input type="radio" name="tl-type" checked={type === t} onChange={() => pick(t)} />
                {TRANSLINES[t].name}
              </label>
            ))}
          </Group>
          {/* m_translineBitmap: KiBitmapBundle( m_BitmapName ), centred, 10 px
              above and below (base:39-41). [px] KiCad's microstrip ink measures
              203x149 inside the 227x174 bitmap, centred in a 278 px column. */}
          <Art name={ident.bitmap} />
        </div>

        <div className="tl-middle">
          <Group
            title="Substrate Parameters"
            className="calc-grid3 tl-box"
            style={{ '--calc-vgap': '3px' /* fgSizerSubstPrms( 9, 3, 3, 0 ) */ } as CSSProperties}
          >
            {slots(ident.subs, SUBS_SLOTS, 'subs')}
          </Group>

          {/* Its own static box, holding Frequency and nothing else
              (base:196-221). Ours had folded Frequency into Substrate. */}
          <Group
            title="Component Parameters"
            className="calc-grid3 tl-box"
            style={{ '--calc-vgap': '0px' /* fgSizeCmpPrms( 1, 3, 0, 0 ) */ } as CSSProperties}
          >
            {/* The ONE label wxFormBuilder right-aligns in this whole launcher:
                `wxALIGN_CENTER_VERTICAL|wxALIGN_RIGHT` (base:207). */}
            <label className="calc-field" title={FREQUENCY_PRM.tip}>
              <span className="calc-field-label" style={{ textAlign: 'right' }}>
                Frequency:
              </span>
              <input
                className="calc-input"
                value={text('Frequency')}
                spellCheck={false}
                onChange={(ev) => put('Frequency', ev.target.value)}
              />
              <Combo
                ariaLabel="Frequency unit"
                value={String(units.Frequency ?? 0)}
                options={FREQ_UNITS.map((u, i) => ({ value: String(i), label: u.label }))}
                onChange={(v) => setUnits((s) => ({ ...s, Frequency: Number(v) }))}
              />
            </label>
          </Group>

          {/* m_bmCMicrostripZoddZeven, shown for the two coupled types only
              (transline_dlg_funct.cpp:111-112). */}
          {(type === 'c_microstrip' || type === 'c_stripline') && (
            <Art name="microstrip_zodd_zeven" />
          )}
        </div>

        <div className="tl-right">
          <Group
            title="Physical Parameters"
            className="tl-phys tl-box"
            style={{ '--calc-vgap': '3px' /* fgSizerPhysPrms( 4, 4, 3, 0 ) */ } as CSSProperties}
          >
            {Array.from({ length: PHYS_SLOTS }, (_, i) => (
              <div className="tl-phys-row" key={`phys${i}`}>
                {prmRow(ident.phys[i], `physrow${i}`)}
                {/* m_radioBtnPrm1/2 exist on the first two rows only, and show
                    only when the type has a parameter selection
                    (base:266,281; transline_dlg_funct.cpp:117-118). */}
                {i < 2 && ident.hasPrmSelection ? (
                  <input
                    type="radio"
                    name="tl-prm"
                    defaultChecked={i === 0}
                    aria-label="Solve for this parameter"
                  />
                ) : (
                  <span />
                )}
              </div>
            ))}
          </Group>

          {/* bSizerButtons: a row of its OWN, between the two boxes — not
              inside either (base:303-329). Each button has a STD_BITMAP_BUTTON
              beside it carrying small_down / small_up. */}
          <div className="tl-buttons">
            <button type="button" className="calc-btn" onClick={analyze}>
              Analyze
            </button>
            <button
              type="button"
              className="calc-btn calc-bmp"
              aria-label="Analyze"
              onClick={analyze}
            >
              <img
                src={TL_ART['../../../assets/calculator/small_down.svg']}
                alt=""
                width={16}
                height={16}
              />
            </button>
            <span className="tl-buttons-gap" />
            <button type="button" className="calc-btn" onClick={synthesize}>
              Synthesize
            </button>
            <button
              type="button"
              className="calc-btn calc-bmp"
              aria-label="Synthesize"
              onClick={synthesize}
            >
              <img
                src={TL_ART['../../../assets/calculator/small_up.svg']}
                alt=""
                width={16}
                height={16}
              />
            </button>
          </div>

          <Group
            title="Electrical Parameters"
            className="calc-grid3 tl-box"
            style={{ '--calc-vgap': '3px' /* fgSizerResults( 3, 3, 3, 0 ) */ } as CSSProperties}
          >
            {slots(ident.elec, ELEC_SLOTS, 'elec')}
          </Group>

          {/* sbMessagesSizer is titled "Results" and holds TEN two-column rows
              of plain wxStaticText — no borders, no entries (base:399-472). */}
          <Group
            title="Results"
            className="tl-results tl-box"
            style={
              { '--calc-vgap': '4px' /* fgSizerTranslResults( 10, 2, 4, 0 ) */ } as CSSProperties
            }
          >
            {Array.from({ length: RESULT_SLOTS }, (_, i) => (
              <div className="tl-result-row" key={`msg${i}`}>
                <span className="calc-field-label">
                  {ident.messages[i] ? `${ident.messages[i]}:` : ''}
                </span>
                <span className="calc-result-value">{msgs[i] ?? ''}</span>
              </div>
            ))}
          </Group>

          {error && <div className="calc-error">{error}</div>}

          {/* A stretch spacer, then wxALIGN_RIGHT|wxALL 10 (base:478-481). */}
          <div className="calc-reset-row">
            <button type="button" className="calc-btn" onClick={resetDefaults}>
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>

      {picking && PICKERS[picking] && (
        <SingleChoiceDialog
          caption={PICKERS[picking].caption}
          choices={PICKERS[picking].list.map((m) => ({
            value: String(m.value),
            label: `${m.value} \t${m.name}`,
          }))}
          onResult={(v) => {
            const target = PICKERS[picking]?.key;
            if (v !== null && target) put(target, v.split('\t')[0] ?? v);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
