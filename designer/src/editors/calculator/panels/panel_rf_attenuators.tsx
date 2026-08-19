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

/** Simple schematic sketch per topology. */
function AttenuatorDrawing({ type }: { type: AttenuatorType }): JSX.Element {
  const res = (x: number, y: number, vertical: boolean, label: string): JSX.Element => (
    <g key={label}>
      {vertical ? (
        <path
          d={`M${x} ${y} l5 4 l-10 7 l10 7 l-10 7 l10 7 l-5 4`}
          stroke="#4a86c5"
          fill="none"
          strokeWidth="1.5"
        />
      ) : (
        <path
          d={`M${x} ${y} l4 -5 l7 10 l7 -10 l7 10 l7 -10 l4 5`}
          stroke="#4a86c5"
          fill="none"
          strokeWidth="1.5"
        />
      )}
      <text
        x={vertical ? x + 10 : x + 12}
        y={vertical ? y + 22 : y - 10}
        fill="#e6e6e6"
        fontSize="12"
      >
        {label}
      </text>
    </g>
  );
  const wire = (x1: number, y1: number, x2: number, y2: number, i: number): JSX.Element => (
    <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4a86c5" strokeWidth="1.5" />
  );
  const gnd = (x: number, y: number, i: number): JSX.Element => (
    <g key={`g${i}`} stroke="#4a86c5" strokeWidth="1.5">
      <line x1={x - 10} y1={y} x2={x + 10} y2={y} />
      <line x1={x - 6} y1={y + 4} x2={x + 6} y2={y + 4} />
      <line x1={x - 2} y1={y + 8} x2={x + 2} y2={y + 8} />
    </g>
  );

  switch (type) {
    case AttenuatorType.PI:
      return (
        <svg width="320" height="150" className="calc-svg">
          {wire(10, 40, 90, 40, 0)}
          {res(90, 35, false, 'R2')}
          {wire(126, 40, 310, 40, 1)}
          {wire(60, 40, 60, 60, 2)}
          {res(55, 60, true, 'R1')}
          {wire(60, 96, 60, 115, 3)}
          {gnd(60, 115, 0)}
          {wire(250, 40, 250, 60, 4)}
          {res(245, 60, true, 'R3')}
          {wire(250, 96, 250, 115, 5)}
          {gnd(250, 115, 1)}
        </svg>
      );
    case AttenuatorType.TEE:
      return (
        <svg width="320" height="150" className="calc-svg">
          {wire(10, 40, 60, 40, 0)}
          {res(60, 35, false, 'R1')}
          {wire(96, 40, 170, 40, 1)}
          {res(170, 35, false, 'R3')}
          {wire(206, 40, 310, 40, 2)}
          {wire(150, 40, 150, 60, 3)}
          {res(145, 60, true, 'R2')}
          {wire(150, 96, 150, 115, 4)}
          {gnd(150, 115, 0)}
        </svg>
      );
    case AttenuatorType.BRIDGED_TEE:
      return (
        <svg width="320" height="190" className="calc-svg">
          {wire(10, 70, 70, 70, 0)}
          {wire(70, 70, 70, 30, 1)}
          {wire(70, 30, 120, 30, 2)}
          {res(120, 25, false, 'R1')}
          {wire(156, 30, 210, 30, 3)}
          {wire(210, 30, 210, 70, 4)}
          {wire(70, 70, 100, 70, 5)}
          {res(100, 65, false, 'Z0')}
          {wire(136, 70, 150, 70, 6)}
          {res(150, 65, false, 'Z0')}
          {wire(186, 70, 210, 70, 7)}
          {wire(210, 70, 310, 70, 8)}
          {wire(143, 70, 143, 95, 9)}
          {res(138, 95, true, 'R2')}
          {wire(143, 131, 143, 150, 10)}
          {gnd(143, 150, 0)}
        </svg>
      );
    case AttenuatorType.SPLITTER:
      return (
        <svg width="320" height="150" className="calc-svg">
          {wire(10, 70, 60, 70, 0)}
          {res(60, 65, false, 'R1')}
          {wire(96, 70, 130, 70, 1)}
          {wire(130, 70, 130, 30, 2)}
          {wire(130, 70, 130, 110, 3)}
          {wire(130, 30, 160, 30, 4)}
          {res(160, 25, false, 'R2')}
          {wire(196, 30, 310, 30, 5)}
          {wire(130, 110, 160, 110, 6)}
          {res(160, 105, false, 'R3')}
          {wire(196, 110, 310, 110, 7)}
        </svg>
      );
  }
}

/**
 * The four `*_formula.md` files, rendered. `TransfAttenuatorDataToPanel` pushes
 * `m_FormulaName` through `ConvertMarkdown2Html` into the Formula pane
 * (panel_rf_attenuators.cpp:192-206).
 */
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
  const [type, setType] = useState<AttenuatorType>(AttenuatorType.PI);
  const [atten, setAtten] = useState('6');
  const [zin, setZin] = useState('50');
  const [zout, setZout] = useState('50');

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
  const calculate = (): void => setShown(r);

  return (
    <div className="rf-panel">
      <div className="calc-row">
        <div className="calc-col" style={{ maxWidth: 300 }}>
          {/* A wxRadioBox — the title is the box's, not a static text
              (panel_rf_attenuators_base.cpp:26). */}
          <Group title="Attenuators">
            {ATTENUATORS.map((a) => (
              <label key={a.type} className="calc-radio">
                <input
                  type="radio"
                  name="att-type"
                  checked={type === a.type}
                  onChange={() => {
                    setType(a.type);
                    setShown(null);
                  }}
                />
                {a.name}
              </label>
            ))}
          </Group>
          <AttenuatorDrawing type={type} />
        </div>
        <div className="calc-col" style={{ maxWidth: 300 }}>
          <Group title="Parameters">
            <Field
              label="Attenuation (a):"
              value={info.hasAttenuation ? atten : '6'}
              onChange={info.hasAttenuation ? setAtten : undefined}
              readOnly={!info.hasAttenuation}
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
              className="calc-btn exactfit"
              aria-label="Calculate"
              onClick={calculate}
            >
              ↓
            </button>
          </div>
          <Group title="Values">
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
          <div className="rf-messages">
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
          <AttenuatorFormula type={type} />
        </fieldset>
      </div>
    </div>
  );
}
