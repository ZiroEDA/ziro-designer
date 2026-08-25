// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "E-Series" memo panel, the IEC 60063 preferred values.
 * Counterpart: KiCad `calculator_panels/panel_eseries_display.cpp` +
 * `panel_eseries_display_base.cpp`.
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
 *
 * `bTablesSizerESeries` is wxHORIZONTAL (base:19): the WIDE grid is the left
 * box and E1,E3,E6,E12 the right one, sharing a top edge. Under both sits
 * `m_panelESeriesHelp`, a bare HTML_WINDOW — no static box, no "Help" legend —
 * added proportion 1 wxEXPAND with a 100 px minimum (base:66-70).
 */

import { changeLightness, rgb8ToCss, rgbFromBgrHex } from '@ziroeda/common';
import { E12_VALUES, E24_VALUES, E96_VALUES, ESERIES_DISPLAY_SCALE } from '@ziroeda/pcb_calculator';
import type { JSX } from 'react';

/**
 * [data] the seven column colours, `wxColour( 0xBBGGRR )` literals from
 * panel_eseries_display.h:93-129. KiCad hardcodes these, so we mirror the
 * table rather than inventing one. Six of the seven are named HTML colours,
 * and the header says so: honeydew, palegreen, cornflowerblue, plum, skyblue
 * and — E96, `0x7aa0ff` — lightsalmon `#FFA07A`.
 *
 * **E48 is the exception, and it is a typo of upstream's.** The header comments
 * it `olivedrab`, which is `#6B8E23` and would be `0x238E6B` in BGR; what is
 * written is `0x23e86b`, the middle byte transposed, so the column renders a
 * bright green `#6BE823`. Mirrored, because a colour table is data and the
 * point is that the two panels look the same.
 */
const S_C_E1_BGR = 0xf0fff0;
const S_C_E3_BGR = 0x98fb98;
const S_C_E6_BGR = 0xed9564;
const S_C_E12_BGR = 0xdda0dd;
const S_C_E24_BGR = 0xebce87;
const S_C_E48_BGR = 0x23e86b;
const S_C_E96_BGR = 0x7aa0ff;

/** [data] panel_eseries_display.h:80,87. */
const S_ALT_ADJUST_VALUE = 125;
const S_DARK_ADJUST_VALUE = 78;

/**
 * `wxSystemSettings::GetAppearance().IsDark()` (panel_eseries_display.cpp:48).
 * The shell has one palette and it is the dark one — `ui/shell.css` carries no
 * light token set for this to read — so the branch is constant here, the same
 * way this launcher already vendors KiCad's DARK artwork only.
 */
const SHELL_IS_DARK = true;

/**
 * `recalculateColumnColours` (panel_eseries_display.cpp:118-146): darken every
 * column when the theme is dark "so that the white numerals on top stand out
 * better", then pair each with its `ChangeLightness( 125 )` alternate. Every
 * merged BLOCK flips between the pair, which is what gives each column its
 * banding — ours were flat, and undarkened.
 *
 * [px] verified against `~/calcvis/k11_e-series.png`: E24 (105,160,183) and its
 * alternate (142,183,201); E48 (83,180,27)/(126,198,84); E96 (198,124,95)/
 * (212,156,135); E6 (78,116,184)/(122,150,201); E1 (187,198,187).
 */
const columnAdjust = SHELL_IS_DARK ? S_DARK_ADJUST_VALUE : 100;
const column = (bgr: number): string =>
  rgb8ToCss(changeLightness(rgbFromBgrHex(bgr), columnAdjust));
const pair = (bgr: number): [string, string] => {
  const base = changeLightness(rgbFromBgrHex(bgr), columnAdjust);
  return [rgb8ToCss(base), rgb8ToCss(changeLightness(base, S_ALT_ADJUST_VALUE))];
};

const C_E1 = column(S_C_E1_BGR);
const P_E3 = pair(S_C_E3_BGR);
const P_E6 = pair(S_C_E6_BGR);
const P_E12 = pair(S_C_E12_BGR);
const P_E24 = pair(S_C_E24_BGR);
const P_E48 = pair(S_C_E48_BGR);
const P_E96 = pair(S_C_E96_BGR);

/** `wxString( "" ) << uint16_t` — the table entry itself, as an integer. */
const cell = (v: number): string => String(Math.round(v * ESERIES_DISPLAY_SCALE));

/**
 * The colour loops walk `row += cellHeight` and flip on every step, so a
 * column whose cells span N rows alternates every N rows — E96's span 1 and
 * flip every row, E24's span 4 (panel_eseries_display.cpp:305-395).
 */
const alt = (p: readonly [string, string], row: number, span: number): string =>
  Math.floor(row / span) % 2 === 0 ? p[0] : p[1];

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
        <td key="e3" rowSpan={4} style={{ background: alt(P_E3, row, 4) }}>
          {cell(E12_VALUES[row] ?? 0)}
        </td>,
      );
    if (row % 2 === 0)
      cells.push(
        <td key="e6" rowSpan={2} style={{ background: alt(P_E6, row, 2) }}>
          {cell(E12_VALUES[row] ?? 0)}
        </td>,
      );
    cells.push(
      <td key="e12" style={{ background: alt(P_E12, row, 1) }}>
        {cell(E12_VALUES[row] ?? 0)}
      </td>,
    );
    rows.push(<tr key={row}>{cells}</tr>);
  }
  return (
    <table className="eser-grid">
      {/* A wxGrid's column labels are drawn by its LABEL window: one background
          for the whole strip, `GetLabelBackgroundColour()`. There is no
          per-column label colour and KiCad never asks for one — ours painted
          each header in its series colour, which is invented. [px] KiCad's
          strip is rgb(55,55,55) with white text, y 56..77. */}
      <thead>
        <tr>
          <th>E1</th>
          <th>E3</th>
          <th>E6</th>
          <th>E12</th>
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
          <td key={`a${stripe}`} rowSpan={4} style={{ background: alt(P_E24, row, 4) }}>
            {cell(E24_VALUES[(base + row) / 4] ?? 0)}
          </td>,
        );
      // E48: every second row, spanning two — taken from the E96 table, as
      // KiCad does (it walks eSeries96 and writes E48 on the even rows).
      if (row % 2 === 0)
        cells.push(
          <td key={`b${stripe}`} rowSpan={2} style={{ background: alt(P_E48, row, 2) }}>
            {cell(E96_VALUES[base + row] ?? 0)}
          </td>,
        );
      cells.push(
        <td key={`c${stripe}`} style={{ background: alt(P_E96, row, 1) }}>
          {cell(E96_VALUES[base + row] ?? 0)}
        </td>,
      );
      // The gap column between stripes is one merged cell the full height, so
      // its horizontal rules disappear (lines 293-300), and it is repainted
      // `s_colourMatching` — the grid's own LABEL background — "to make them
      // less eye-catching" (lines 397-404). The last one is omitted.
      if (stripe < NUM_STRIPES - 1 && row === 0)
        cells.push(<td key={`g${stripe}`} rowSpan={STRIPE_HEIGHT} className="eser-gap" />);
    }
    rows.push(<tr key={row}>{cells}</tr>);
  }

  const head: JSX.Element[] = [];
  for (let stripe = 0; stripe < NUM_STRIPES; stripe++) {
    head.push(
      <th key={`a${stripe}`}>E24</th>,
      <th key={`b${stripe}`}>E48</th>,
      <th key={`c${stripe}`}>E96</th>,
    );
    if (stripe < NUM_STRIPES - 1) head.push(<th key={`g${stripe}`}>-</th>);
  }

  return (
    <table className="eser-grid">
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

export function PanelEseriesDisplay(): JSX.Element {
  return (
    <div className="eser-panel calc-page-body">
      {/* bTablesSizerESeries, wxHORIZONTAL (base:19). Both boxes are added
          without wxEXPAND and the ROW itself goes into bSizerESeries with
          proportion 0 (base:64), so there is no slack to hand out and each box
          shrink-wraps its grid. Ours stacked them vertically. */}
      <div className="eser-tables">
        {/* The wider grid comes FIRST, and the titles carry no spaces after the
            commas (base:21, 52). */}
        <fieldset className="calc-group eser-box">
          <legend>E24,E48,E96</legend>
          <Grid2496 />
        </fieldset>
        <fieldset className="calc-group eser-box">
          <legend>E1,E3,E6,E12</legend>
          <Grid112 />
        </fieldset>
      </div>
      {/* m_panelESeriesHelp: a BARE HTML_WINDOW, not inside a static box and
          with no legend, `SetMinSize( -1, 100 )` and proportion 1 wxEXPAND
          (base:66-70). Its text is pcb_calculator/eseries_display_help.md,
          rendered through ConvertMarkdown2Html. The page had none of it. */}
      <div className="calc-help-body eser-help">
        <p>
          Passive components are commonly made with E-series values appropriate to their precision.
          Capacitors commonly use E12 values. 10% and 5% resistors commonly use E24 values. 1%
          resistors use E96 values. Other series are not commonly used.
        </p>
        <p>
          To select a value begin with the calculated target value and then round it to 2
          significant figures for E24 or below or 3 significant figures for E48 and up. Then find
          the value in the table which is nearest to the significant figures remaining and
          substitute it for those figures.
        </p>
        <p>
          For example if the calculated target value is 16,834.2Ω then this rounds to 16,800Ω. The
          nearest value to 168 is 169 and the selected E96 value is 16.9kΩ.
        </p>
        <p>The value 0 is a special case and is not present in any series.</p>
      </div>
    </div>
  );
}
