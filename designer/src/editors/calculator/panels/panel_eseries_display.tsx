// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "E-Series" memo panel, the IEC 60063 preferred values.
 * Counterpart: KiCad `calculator_panels/panel_eseries_display.cpp`.
 *
 * Two wxGrids, and the merged cells are the whole point of them: an E1 value
 * spans all twelve E12 rows, an E3 value spans four, an E6 value spans two, so
 * you read down a column and see which coarser series each finer value belongs
 * to (`SetCellSize`, panel_eseries_display.cpp:178-201).
 *
 * The E24/E48/E96 grid is wrapped into FOUR stripes of 24 rows laid side by
 * side "like in a newspaper" — 4 x (E24, E48, E96, -) columns with the last
 * separator omitted, fifteen in all (lines 214-291).
 *
 * The values are the tables' own integers — 100, 102, 105 — not 1.00, 1.02.
 * `wxString( "" ) << seriesEntry` on a `uint16_t` is what puts them there.
 */

import type { JSX } from 'react';
import { E12_VALUES, E24_VALUES, E96_VALUES, ESERIES_DISPLAY_SCALE } from '@ziroeda/pcb_calculator';

/** KiCad's per-series cell colours (panel_eseries_display.cpp:36-48). */
const C_E1 = '#f0fff0';
const C_E3 = '#98fb98';
const C_E6 = '#6495ed';
const C_E12 = '#dda0dd';
const C_E24 = '#87ceeb';
const C_E48 = '#6be823';
const C_E96 = '#ffa07a';

/** `wxString( "" ) << uint16_t` — the table entry itself, as an integer. */
const cell = (v: number): string => String(Math.round(v * ESERIES_DISPLAY_SCALE));

function Grid112(): JSX.Element {
  const rows: JSX.Element[] = [];
  for (let row = 0; row < 12; row++) {
    const cells: JSX.Element[] = [];
    if (row === 0)
      cells.push(
        <td key="e1" rowSpan={12} style={{ background: C_E1 }}>
          {cell(E12_VALUES[0] ?? 1)}
        </td>,
      );
    if (row % 4 === 0)
      cells.push(
        <td key="e3" rowSpan={4} style={{ background: C_E3 }}>
          {cell(E12_VALUES[row] ?? 0)}
        </td>,
      );
    if (row % 2 === 0)
      cells.push(
        <td key="e6" rowSpan={2} style={{ background: C_E6 }}>
          {cell(E12_VALUES[row] ?? 0)}
        </td>,
      );
    cells.push(
      <td key="e12" style={{ background: C_E12 }}>
        {cell(E12_VALUES[row] ?? 0)}
      </td>,
    );
    rows.push(<tr key={row}>{cells}</tr>);
  }
  return (
    <table className="es-grid">
      <thead>
        <tr>
          <th style={{ background: C_E1 }}>E1</th>
          <th style={{ background: C_E3 }}>E3</th>
          <th style={{ background: C_E6 }}>E6</th>
          <th style={{ background: C_E12 }}>E12</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

const NUM_STRIPES = 4;
const STRIPE_HEIGHT = 96 / NUM_STRIPES; // 24

function Grid2496(): JSX.Element {
  const rows: JSX.Element[] = [];
  for (let row = 0; row < STRIPE_HEIGHT; row++) {
    const cells: JSX.Element[] = [];
    for (let stripe = 0; stripe < NUM_STRIPES; stripe++) {
      const base = stripe * STRIPE_HEIGHT;
      // E24: one value every four rows, spanning four.
      if (row % 4 === 0)
        cells.push(
          <td key={`a${stripe}`} rowSpan={4} style={{ background: C_E24 }}>
            {cell(E24_VALUES[(base + row) / 4] ?? 0)}
          </td>,
        );
      // E48: every second row, spanning two — taken from the E96 table, as
      // KiCad does (it walks eSeries96 and writes E48 on the even rows).
      if (row % 2 === 0)
        cells.push(
          <td key={`b${stripe}`} rowSpan={2} style={{ background: C_E48 }}>
            {cell(E96_VALUES[base + row] ?? 0)}
          </td>,
        );
      cells.push(
        <td key={`c${stripe}`} style={{ background: C_E96 }}>
          {cell(E96_VALUES[base + row] ?? 0)}
        </td>,
      );
      // The gap column between stripes is one merged cell the full height, so
      // its horizontal rules disappear (lines 293-300). The last one is omitted.
      if (stripe < NUM_STRIPES - 1 && row === 0)
        cells.push(<td key={`g${stripe}`} rowSpan={STRIPE_HEIGHT} className="es-gap" />);
    }
    rows.push(<tr key={row}>{cells}</tr>);
  }

  const head: JSX.Element[] = [];
  for (let stripe = 0; stripe < NUM_STRIPES; stripe++) {
    head.push(
      <th key={`a${stripe}`} style={{ background: C_E24 }}>
        E24
      </th>,
      <th key={`b${stripe}`} style={{ background: C_E48 }}>
        E48
      </th>,
      <th key={`c${stripe}`} style={{ background: C_E96 }}>
        E96
      </th>,
    );
    if (stripe < NUM_STRIPES - 1) head.push(<th key={`g${stripe}`}>-</th>);
  }

  return (
    <table className="es-grid">
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

export function PanelEseriesDisplay(): JSX.Element {
  return (
    <div className="es-panel">
      {/* The wider grid comes FIRST — sbLowerSizerEseries2496 is added above
          sbLowerSizerEseries112, and the titles carry no spaces after the
          commas (panel_eseries_display_base.cpp:21, 52). */}
      <fieldset className="calc-group">
        <legend>E24,E48,E96</legend>
        <div className="es-scroll">
          <Grid2496 />
        </div>
      </fieldset>
      <fieldset className="calc-group">
        <legend>E1,E3,E6,E12</legend>
        <Grid112 />
      </fieldset>
    </div>
  );
}
