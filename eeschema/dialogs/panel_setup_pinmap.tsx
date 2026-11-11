// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pin Conflicts Map panel. Counterpart: `eeschema/dialogs/panel_setup_pinmap.cpp`
 * (PANEL_SETUP_PINMAP::reBuildMatrixPanel), the pin-type-vs-pin-type conflict
 * matrix, drawn as KiCad's lower-triangular staircase: pin-type names right-
 * aligned down the left; each column's name set HORIZONTALLY up-and-right of its
 * diagonal cell (into the empty upper triangle) with a vertical `|` callout; and
 * a grid of green-square / amber-triangle / red-circle buttons. Clicking a cell
 * cycles OK -> Warning -> Error and mirrors it (the matrix is symmetric). NC
 * ("Unconnected") is excluded, as in KiCad (PINMAP_TYPE_COUNT = types - 1).
 * Feeds runErc's TestPinToPin.
 */

import type { JSX } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { PANEL_SETUP_PINMAP_BASE } from './panel_setup_pinmap_base.js';
import { PIN_TYPES, type ErcSettings, type PinError } from '../index.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

interface Props {
  settings: ErcSettings;
  onChange: (next: ErcSettings) => void;
}

// Row/column labels, matching KiCad's CommentERC_H (NC excluded).
const PIN_LABELS = [
  _HKI('Input Pin'),
  _HKI('Output Pin'),
  _HKI('Bidirectional Pin'),
  _HKI('Tri-State Pin'),
  _HKI('Passive Pin'),
  _HKI('Free Pin'),
  _HKI('Unspecified Pin'),
  _HKI('Power Input Pin'),
  _HKI('Power Output Pin'),
  _HKI('Open Collector'),
  _HKI('Open Emitter'),
];

// Matrix geometry (mirrors reBuildMatrixPanel's bitmap+padding steps).
const LABEL_W = 104; // row-label column
const CELL = 22;
const STEPX = CELL + 8;
const STEPY = CELL + 6;
const LINE_H = 15;
const TOP = 42; // headroom for the highest column label

/** setDRCMatrixButtonState: each state's bitmap and tooltip. */
const STATE_BITMAP = ['erc_green', 'ercwarn', 'ercerr'];

export function PanelSetupPinmap({ settings, onChange }: Props): JSX.Element {
  const n = PIN_TYPES.length - 1; // exclude NC

  const cycle = (r: number, c: number): void => {
    const pinMap = settings.pinMap.map((row) => [...row]);
    const next = (((pinMap[r]![c]! as number) + 1) % 3) as PinError;
    pinMap[r]![c] = next;
    pinMap[c]![r] = next; // symmetric, like KiCad
    onChange({ ...settings, pinMap });
  };

  const title = [
    wxGetTranslation('No error or warning'),
    wxGetTranslation('Generate warning'),
    wxGetTranslation('Generate error'),
  ];
  const width = LABEL_W + n * STEPX + 140;
  const height = TOP + n * STEPY + CELL + 6;

  return (
    <PANEL_SETUP_PINMAP_BASE
      m_matrixPanel={
        <div style={{ position: 'relative', width, height, fontSize: 11 }}>
          {Array.from({ length: n }, (_, r) => {
            const top = TOP + r * STEPY;
            const cx = LABEL_W + r * STEPX + CELL / 2;
            return (
              <div key={r}>
                {/* Row label (right-aligned into the left column). */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    width: LABEL_W - 6,
                    top: top + (CELL - LINE_H) / 2,
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {PIN_LABELS[r]}
                </div>

                {/* Column label + callout, horizontal, above the diagonal cell. */}
                <div
                  style={{
                    position: 'absolute',
                    left: cx + 4,
                    top: top - 2 * LINE_H,
                    whiteSpace: 'nowrap',
                    color: 'var(--chrome-fg)',
                  }}
                >
                  {PIN_LABELS[r]}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: cx,
                    top: top - LINE_H - 2,
                    width: 1,
                    height: LINE_H + 2,
                    background: 'var(--chrome-border)',
                  }}
                />

                {/* Cells 0..r (lower triangle). */}
                {Array.from({ length: r + 1 }, (_, c) => {
                  const v = settings.pinMap[r]![c]! as number;
                  return (
                    <button
                      key={c}
                      onClick={() => cycle(r, c)}
                      // setDRCMatrixButtonState's tooltip is the state alone.
                      title={title[v]}
                      aria-label={`${PIN_LABELS[r]} / ${PIN_LABELS[c]}`}
                      style={{
                        position: 'absolute',
                        left: LABEL_W + c * STEPX,
                        top,
                        width: CELL,
                        height: CELL,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        background: 'transparent',
                        border: '1px solid var(--chrome-border)',
                        borderRadius: 3,
                        cursor: 'default',
                      }}
                    >
                      <img src={bitmapUrl(STATE_BITMAP[v]!)} alt="" />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      }
    />
  );
}
