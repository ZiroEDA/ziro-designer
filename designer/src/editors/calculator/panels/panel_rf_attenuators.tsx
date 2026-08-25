// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "RF Attenuators" panel, PI, Tee, bridged Tee and resistive splitter.
 * Counterpart: KiCad `calculator_panels/panel_rf_attenuators.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import { ATTENUATORS, AttenuatorType, calculateAttenuator, printfG } from '@ziroeda/pcb_calculator';
import { Field, Group, parseNum } from '../fields.js';
import { useCalcSaveSettings } from '../calc_settings.js';
import {
  CALC_ATTENUATOR_NAMES,
  settings,
  type CalcAttenuatorName,
  type PcbCalculatorAttenuator,
} from '../../../prefs/settings.js';

/**
 * The radio selection is `attenuators.type` and it indexes this list, which is
 * `m_AttenuatorList`'s order (panel_rf_attenuators.cpp) — the same order
 * `CALC_ATTENUATOR_NAMES` gives, so the name is just the index.
 */
const attName = (t: AttenuatorType): CalcAttenuatorName =>
  CALC_ATTENUATOR_NAMES[t] ?? CALC_ATTENUATOR_NAMES[0];

// KiCad's own dark-theme artwork (GPL), vendored under assets/.
const ATT_ART = import.meta.glob('../../../assets/calculator/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * m_attenuatorBitmap: BITMAPS::att_pi / att_tee / att_bridge / att_splitter,
 * whichever the selected topology carries (attenuator_classes.cpp), drawn 1:1
 * at the size the PNG has. Ours was a redrawing missing the Zin / Zout
 * terminals and their labels entirely.
 */
const ATT_ART_NAME: Record<AttenuatorType, [string, number, number]> = {
  [AttenuatorType.PI]: ['att_pi', 287, 159],
  [AttenuatorType.TEE]: ['att_tee', 280, 147],
  [AttenuatorType.BRIDGED_TEE]: ['att_bridge', 287, 257],
  [AttenuatorType.SPLITTER]: ['att_splitter', 295, 121],
};

function AttenuatorDrawing({ type }: { type: AttenuatorType }): JSX.Element {
  const [name, w, h] = ATT_ART_NAME[type];
  return (
    <img
      className="calc-art"
      src={ATT_ART[`../../../assets/calculator/${name}.svg`]}
      alt=""
      width={w}
      height={h}
    />
  );
}

function AttenuatorFormula({ type }: { type: AttenuatorType }): JSX.Element {
  const V = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <b>
      <i>{children}</i>
    </b>
  );
  const head = (t: string): JSX.Element => <h3 className="rf-formula-head">{t}</h3>;
  const common = (
    <>
      <V>a</V> is attenuation in dB
      <br />
      <V>
        Z<sub>in</sub>
      </V>{' '}
      is desired input impedance in Ω
      <br />
      <V>
        Z<sub>out</sub>
      </V>{' '}
      is desired output impedance in Ω
    </>
  );
  const kl = (
    <>
      <V>
        K = V<sub>I</sub>/V<sub>O</sub> = 10<sup>a/20</sup>
      </V>
      <br />
      <V>
        L = K<sup>2</sup> = 10<sup>a/10</sup>
      </V>
      <br />
    </>
  );

  if (type === AttenuatorType.PI)
    return (
      <div className="rf-formula">
        {head('Pi Attenuator')}
        <p>{common}</p>
        <p>
          {kl}
          <V>A = (L+1) / (L−1)</V>
        </p>
        <p>
          <V>
            R2 = (L−1) / 2·√(Z<sub>in</sub> · Z<sub>out</sub> / L)
          </V>
          <br />
          <V>
            R1 = 1 / (A/Z<sub>in</sub> − 1/R2)
          </V>
          <br />
          <V>
            R3 = 1 / (A/Z<sub>out</sub> − 1/R2)
          </V>
        </p>
      </div>
    );

  if (type === AttenuatorType.TEE)
    return (
      <div className="rf-formula">
        {head('Tee Attenuator')}
        <p>{common}</p>
        <p>
          {kl}
          <V>A = (L+1) / (L−1)</V>
        </p>
        <p>
          <V>
            R2 = 2·√(L · Z<sub>in</sub> · Z<sub>out</sub>) / (L−1)
          </V>
          <br />
          <V>
            R1 = Z<sub>in</sub> · A − R2
          </V>
          <br />
          <V>
            R3 = Z<sub>out</sub> · A − R2
          </V>
        </p>
      </div>
    );

  if (type === AttenuatorType.BRIDGED_TEE)
    return (
      <div className="rf-formula">
        {head('Bridged Tee Attenuator')}
        <p>
          <V>a</V> is attenuation in dB
          <br />
          <V>
            Z<sub>in</sub>
          </V>{' '}
          is desired input impedance in Ω
          <br />
          <V>
            Z<sub>out</sub>
          </V>{' '}
          is desired output impedance in Ω
          <br />
          <V>
            Z<sub>0</sub> = Z<sub>in</sub> = Z<sub>out</sub>
          </V>
        </p>
        <p>
          <V>
            L = 10<sup>a/20</sup>
          </V>
        </p>
        <p>
          <V>
            R1 = Z<sub>0</sub> · (L−1)
          </V>
          <br />
          <V>
            R2 = Z<sub>0</sub> / (L−1)
          </V>
        </p>
      </div>
    );

  return (
    <div className="rf-formula">
      {head('Split Attenuator')}
      <p>
        Attenuation is 6 dB
        <br />
        <V>
          Z<sub>in</sub>
        </V>{' '}
        is desired input impedance in Ω
        <br />
        <V>
          Z<sub>out</sub>
        </V>{' '}
        is desired output impedance in Ω
        <br />
        <V>
          Z<sub>0</sub> = Z<sub>in</sub> = Z<sub>out</sub>
        </V>
      </p>
      <p>
        <V>
          R1 = R2 = R3 = Z<sub>0</sub>/3
        </V>
      </p>
    </div>
  );
}

export function PanelRfAttenuators(): JSX.Element {
  /**
   * PANEL_RF_ATTENUATORS::LoadSettings / SaveSettings.
   *
   * Each ATTENUATOR keeps its OWN attenuation / Zin / Zout and reads and writes
   * them itself (`ATTENUATOR::ReadConfig` / `WriteConfig`,
   * attenuators/attenuator_classes.cpp:64-84), so switching topology restores
   * that topology's three numbers rather than carrying the current ones over
   * (`SetAttenuator` → `TransfAttenuatorDataToPanel`, panel_rf_attenuators.cpp).
   *
   * The stored numbers are only updated by `TransfPanelDataToAttenuator`, which
   * runs on **Calculate** — `SaveSettings` does not read the controls, unlike
   * PANEL_TRANSLINE's, which calls its transfer first (panel_transline.cpp:72-74).
   * So a value typed and not calculated does not survive the frame closing.
   * That is upstream's behaviour and it is mirrored here rather than improved.
   */
  const [store, setStore] = useState<Record<CalcAttenuatorName, PcbCalculatorAttenuator>>(() => {
    const a = settings.pcbCalculator.attenuators;
    return {
      att_pi: { ...a.att_pi },
      att_tee: { ...a.att_tee },
      att_bridge: { ...a.att_bridge },
      att_splitter: { ...a.att_splitter },
    };
  });
  const [type, setType] = useState<AttenuatorType>(() => {
    const t = settings.pcbCalculator.attenuators.type;
    return (ATTENUATORS[t]?.type ?? AttenuatorType.PI) as AttenuatorType;
  });
  // `msg.Printf( "%g", … )` into each of the three fields.
  const [atten, setAtten] = useState(() => printfG(store[attName(type)].attenuation));
  const [zin, setZin] = useState(() => printfG(store[attName(type)].zin));
  const [zout, setZout] = useState(() => printfG(store[attName(type)].zout));

  useCalcSaveSettings((s) => {
    s.attenuators.type = type;
    for (const name of CALC_ATTENUATOR_NAMES) s.attenuators[name] = { ...store[name] };
  });

  const info = ATTENUATORS[type] ?? ATTENUATORS[0]!;
  const r = useMemo(
    () =>
      calculateAttenuator(
        type,
        parseNum(atten),
        parseNum(zin),
        info.hasZout ? parseNum(zout) : parseNum(zin),
      ),
    [type, atten, zin, zout, info.hasZout],
  );

  // KiCad's Calculate button is not decoration: the Values box holds whatever
  // the LAST press produced, and changing a parameter does not update it
  // (panel_rf_attenuators.cpp:211-245). Ours recomputed live.
  const [shown, setShown] = useState<ReturnType<typeof calculateAttenuator> | null>(null);
  const calculate = (): void => {
    // TransfPanelDataToAttenuator, then Calculate (panel_rf_attenuators.cpp).
    // The transfer is what makes the three numbers persistable, and it happens
    // here and nowhere else.
    setStore((prev) => ({
      ...prev,
      [attName(type)]: {
        attenuation: parseNum(atten) || 0,
        zin: parseNum(zin) || 0,
        zout: parseNum(zout) || 0,
      },
    }));
    setShown(r);
  };

  return (
    <div className="rf-panel">
      <div className="calc-row">
        <div className="calc-col" style={{ maxWidth: 300 }}>
          {/* A wxRadioBox — the title is the box's, not a static text
              (panel_rf_attenuators_base.cpp:26). */}
          <Group title="Attenuators" className="calc-radiobox">
            {ATTENUATORS.map((a) => (
              <label key={a.type} className="calc-radio">
                <input
                  type="radio"
                  name="att-type"
                  checked={type === a.type}
                  onChange={() => {
                    // SetAttenuator: the new topology's own three numbers go
                    // into the fields and the three results are blanked
                    // (panel_rf_attenuators.cpp).
                    const next = store[attName(a.type)];
                    setType(a.type);
                    setAtten(printfG(next.attenuation));
                    setZin(printfG(next.zin));
                    setZout(printfG(next.zout));
                    setShown(null);
                  }}
                />
                {a.name}
              </label>
            ))}
          </Group>
          <AttenuatorDrawing type={type} />
        </div>
        {/* [px] KiCad's middle column runs x 533..777 - 244 px - and the unit
            labels sit INSIDE the boxes at 757..772; ours were 300 px wide with
            the units spilling out at 866..878, into the Formula pane. */}
        <div className="calc-col rf-mid">
          <Group title="Parameters" className="calc-grid3 rf-box">
            {/* `msg.Printf( "%g", m_Attenuation ); SetValue( msg ); Enable(
                m_Attenuation_Enable )` — the splitter's field is DISABLED but
                still shows that attenuator's own number, which is 6 only until
                someone changes it (panel_rf_attenuators.cpp). Ours printed a
                literal "6" there. Zin, by contrast, really is cleared when it
                is disabled: `msg.Clear()`. */}
            <Field
              label="Attenuation (a):"
              value={atten}
              onChange={info.hasAttenuation ? setAtten : undefined}
              readOnly={!info.hasAttenuation}
              disabled={!info.hasAttenuation}
              unit="dB"
            />
            <Field
              label="Zin:"
              value={info.hasZout ? zin : ''}
              onChange={info.hasZout ? setZin : undefined}
              readOnly={!info.hasZout}
              unit="Ω"
            />
            <Field label="Zout:" value={zout} onChange={setZout} unit="Ω" />
          </Group>
          <div className="rf-buttons">
            <button
              type="button"
              className="calc-btn"
              style={{ minWidth: 120 }}
              onClick={calculate}
            >
              Calculate
            </button>
            {/* m_bpButtonCalcAtt, a STD_BITMAP_BUTTON carrying BITMAPS::small_down,
                wired to the same handler (panel_rf_attenuators.cpp:41). */}
            <button
              type="button"
              className="calc-btn calc-bmp"
              aria-label="Calculate"
              onClick={calculate}
            >
              <img
                src={ATT_ART['../../../assets/calculator/small_down.svg']}
                alt=""
                width={16}
                height={16}
              />
            </button>
          </div>
          <Group title="Values" className="calc-grid3 rf-box">
            {info.resistorLabels.map((label, i) => (
              <Field
                key={label}
                label={`${label}:`}
                value={
                  shown ? (shown.error ? '--' : printfG(shown.resistors[i] ?? Number.NaN)) : ''
                }
                readOnly
                unit="Ω"
              />
            ))}
          </Group>
          {/* m_staticTextAttMsg is a plain label ABOVE the message area, not a
              static box (panel_rf_attenuators_base.cpp:164). */}
          <div className="rf-messages-label">Messages</div>
          {/* m_Attenuator_Messages is an HTML_WINDOW (base:171) — the same
              widget as every help pane — so it paints wxSYS_COLOUR_WINDOW,
              rgb(39,39,39), not the frame's rgb(44,44,44). It said
              `background: var(--chrome-bg)`, which is the frame colour
              restated locally; now it consumes the shared rule. */}
          <div className="calc-help-body rf-messages">
            {shown?.error && (
              <>
                <br />
                <b>Error!</b>
                <br />
                <em>{`Attenuation more than ${shown.minAttenuationDb.toFixed(6)} dB`}</em>
              </>
            )}
          </div>
        </div>
        <fieldset className="calc-group rf-formula-box">
          <legend>Formula</legend>
          {/* m_panelAttFormula is an HTML_WINDOW too (base:186), added
              wxALL|wxEXPAND 5 so the box's own border shows the frame colour
              around a darker window. Ours painted no fill at all. */}
          <div className="calc-help-body rf-formula-window">
            <AttenuatorFormula type={type} />
          </div>
        </fieldset>
      </div>
    </div>
  );
}
