// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Color Code" memo panel, the resistor colour-band reference chart.
 * Counterpart: KiCad `calculator_panels/panel_color_code.cpp` +
 * `panel_color_code_base.cpp`.
 *
 * THE CHART IS ARTWORK, NOT A TABLE. Every column is one wxStaticBitmap —
 * `BITMAPS::color_code_value_and_name`, `color_code_value` twice,
 * `color_code_multiplier` and `color_code_tolerance` (panel_color_code.cpp:
 * 43-50) — laid out by a `wxFlexGridSizer( 2, 6, 0, 0 )`: six headers on the
 * first row, six bitmaps on the second (base:22-58).
 *
 * We had rebuilt it out of `<div>`s from a local table of hex colours and
 * space-padded strings. That is a re-invention of four PNGs, and it drifted
 * exactly where a reconstruction does: a Tolerance row with no text collapsed
 * to a shorter cell, so from Green down the whole column slid out of step with
 * the colour it belongs to. [px] KiCad's rows are a uniform 305/12 = 25.4 and
 * its `± 5%` sits on the Gold row at y=388; ours put it at 356 against a Gold
 * row at 429.
 *
 * The 4th Band column is shown only when the tolerance selection is NOT index 0
 * — 5 % and 10 % parts have three value bands, tighter ones have four
 * (`ToleranceSelection`, panel_color_code.cpp:75-83).
 */

import { type JSX, useState } from 'react';
import { Group } from '../fields.js';

/** KiCad's own dark-theme artwork (GPL), vendored under assets/. */
const CC_ART = import.meta.glob('../../../assets/calculator/color_code_*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * `KiBitmapBundle` at 100 % scale hands back the bitmap's own size, and these
 * four are 91 px wide: 305 tall for the twelve-row columns and 256 for the
 * ten-row value columns.
 */
const ART_SIZE: Record<string, [number, number]> = {
  color_code_value_and_name: [91, 305],
  color_code_value: [91, 256],
  color_code_multiplier: [91, 305],
  color_code_tolerance: [91, 305],
};

function Band({ title, art, edge }: { title: string; art: string; edge: boolean }): JSX.Element {
  const [w, h] = ART_SIZE[art] ?? [0, 0];
  return (
    <div className={edge ? 'cc-col cc-col-all' : 'cc-col'}>
      {/* wxALIGN_CENTER_HORIZONTAL|wxTOP|wxRIGHT|wxLEFT, 5 (base:28). */}
      <div className="cc-colhead">{title}</div>
      <img
        className="calc-art cc-art"
        src={CC_ART[`../../../assets/calculator/${art}.svg`]}
        alt=""
        width={w}
        height={h}
      />
    </div>
  );
}

export function PanelColorCode(): JSX.Element {
  /* m_rbToleranceSelection: "10% / 5%" is index 0 and hides the 4th band. */
  const [tol2, setTol2] = useState(false);
  return (
    /* bSizerPanelColorCode, wxHORIZONTAL (base:12). PANEL_COLOR_CODE is this
       radio box and these columns and NOTHING else: what used to follow the
       chart here — a "Resistor" encoder with a resistance field, a tolerance
       choice, 4/5/6-band radios, a drawn resistor and a second "Chart" table —
       exists nowhere in pcb_calculator. */
    <div className="cc-panel calc-page-body">
      {/* bSizerOpts holds the radio box with wxBOTTOM|wxRIGHT 30, and goes into
          the row with wxALL 8 (base:19-20). */}
      <div className="cc-opts">
        <Group title="Tolerance" className="cc-tolbox">
          <label className="calc-radio">
            <input type="radio" name="cc-tol" checked={!tol2} onChange={() => setTol2(false)} />
            10% / 5%
          </label>
          <label className="calc-radio">
            <input type="radio" name="cc-tol" checked={tol2} onChange={() => setTol2(true)} />
            &lt;= 2%
          </label>
        </Group>
      </div>
      <div className="cc-chart">
        {/* The first three bitmaps carry wxTOP|wxBOTTOM|wxLEFT — no wxRIGHT —
            and the last three wxALL (base:45-58). */}
        <Band title="1st Band" art="color_code_value_and_name" edge={false} />
        <Band title="2nd Band" art="color_code_value" edge={false} />
        <Band title="3rd Band" art="color_code_value" edge={false} />
        {tol2 && <Band title="4th Band" art="color_code_value" edge={true} />}
        <Band title="Multiplier" art="color_code_multiplier" edge={true} />
        <Band title="Tolerance" art="color_code_tolerance" edge={true} />
      </div>
    </div>
  );
}
