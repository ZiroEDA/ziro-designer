// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Statistics.
 * Counterpart: `pcbnew/dialogs/dialog_board_statistics.cpp`.
 *
 * Every number here is computed in pcbnew (`board_statistics_report.ts`) where
 * it is tested; this is the notebook over it. The dialog formats and nothing
 * else, which is why the "Generate Report File..." button hands the same
 * `BoardStatisticsData` to `FormatBoardStatisticsReport` rather than
 * re-deriving anything from the grids.
 *
 * The three checkboxes re-run the computation rather than filtering a cached
 * result: each one changes what is counted, not what is shown.
 *
 * `Dimensions:` is one cell holding "W x H" — the width carries no unit suffix
 * and the height does, so the row reads "40 x 25 mm" rather than repeating the
 * unit. When the board has no closed outline both it and `Area:` read
 * "unknown"; the densities do too, since they divide by the board area.
 *
 * Only the Drill Holes grid is a WX_GRID upstream (`m_gridDrills`, read-only,
 * cells centred, sorted by a click on a column label through
 * `wxEVT_GRID_COL_SORT` -> `drillGridSort`); the four General grids are plain
 * `wxGrid`s and stay tables here.
 */
import { CheckBox } from '@ziroeda/common/wx/controls.js';
import { type JSX, type Ref, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  type BoardStatisticsData,
  type BoardStatisticsOptions,
  ComputeBoardStatistics,
  DEFAULT_BOARD_STATISTICS_OPTIONS,
  FormatBoardStatisticsReport,
} from '../board_statistics_report.js';
import type { BOARD } from '../board.js';
import { DRILL_LINE_ITEM_COL_ID, DRILL_LINE_ITEM_COMPARE } from '../board_statistics.js';
import { PAD_DRILL_SHAPE } from '../padstack.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxALIGN_CENTER,
  wxEVT_GRID_COL_SORT,
  type wxGridEvent,
  wxGridStringTable,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';

interface Props {
  board: BOARD;
  unitsProvider: UNITS_PROVIDER;
  projectName: string;
  boardName: string;
  /** Hands the caller the finished report text to save. */
  onGenerateReport: (text: string, suggestedName: string) => void;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

type Tab = 'general' | 'drills';

/** `m_gridDrills->SetColLabelValue` (`_base.cpp:240-247`). */
const DRILL_COL_LABELS = [
  'Count',
  'Shape',
  'X Size',
  'Y Size',
  'Plated',
  'Via/Pad',
  'Start Layer',
  'Stop Layer',
];

// No metrics here: `.ze-grid` is the shared wxGrid port and carries the
// padding, the font and the rules. Only the alignment is this dialog's, and
// it is a class too.

function Grid({ rows }: { rows: [string, string][] }): JSX.Element {
  return (
    <table className="ze-grid">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="ze-stats-label">{label}</td>
            <td className="ze-stats-value">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DialogBoardStatistics({
  board,
  unitsProvider,
  projectName,
  boardName,
  onGenerateReport,
  onClose,
  rootRef,
}: Props): JSX.Element {
  useModalEscape(onClose);

  const [tab, setTab] = useState<Tab>('general');
  const [options, setOptions] = useState<BoardStatisticsOptions>(DEFAULT_BOARD_STATISTICS_OPTIONS);

  // Each checkbox changes what is counted, so the whole computation re-runs.
  const data: BoardStatisticsData = useMemo(
    () => ComputeBoardStatistics(board, options),
    [board, options],
  );

  const v = (value: number, type: 'distance' | 'area' = 'distance'): string =>
    unitsProvider.MessageTextFromValue(value, true, type);

  const unknown = 'unknown';

  const boardRows: [string, string][] = [
    [
      'Dimensions:',
      data.hasOutline
        ? `${unitsProvider.MessageTextFromValue(data.boardWidth, false)} x ${unitsProvider.MessageTextFromValue(data.boardHeight, true)}`
        : unknown,
    ],
    ['Area:', data.hasOutline ? v(data.boardArea, 'area') : unknown],
    ['Front copper area:', v(data.frontCopperArea, 'area')],
    ['Back copper area:', v(data.backCopperArea, 'area')],
    ['Min track clearance:', v(data.minClearanceTrackToTrack)],
    ['Min track width:', v(data.minTrackWidth)],
    ['Min drill diameter:', v(data.minDrillSize)],
    ['Board stackup thickness:', v(data.boardThickness)],
    ['Front footprint area:', v(data.frontFootprintCourtyardArea, 'area')],
    [
      'Front footprint density:',
      data.hasOutline ? `${data.frontFootprintDensity.toFixed(2)} %` : unknown,
    ],
    ['Back footprint area:', v(data.backFootprintCourtyardArea, 'area')],
    [
      'Back footprint density:',
      data.hasOutline ? `${data.backFootprintDensity.toFixed(2)} %` : unknown,
    ],
  ];

  const padRows: [string, string][] = [
    ...data.padEntries.map((e): [string, string] => [e.title, `${e.quantity}`]),
    ...data.padPropertyEntries.map((e): [string, string] => [e.title, `${e.quantity}`]),
  ];

  const viaRows: [string, string][] = data.viaEntries.map((e) => [e.title, `${e.quantity}`]);

  const frontTotal = data.footprintEntries.reduce((n, e) => n + e.frontCount, 0);
  const backTotal = data.footprintEntries.reduce((n, e) => n + e.backCount, 0);

  const checkbox = (key: keyof BoardStatisticsOptions, label: string): JSX.Element => (
    <CheckBox
      label={label}
      checked={options[key]}
      onChange={(aChecked) => setOptions({ ...options, [key]: aChecked })}
    />
  );

  /** `m_gridDrills` (`dialog_board_statistics_base.cpp:226-256`). */
  const [drillGrid] = useState(() => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(0, DRILL_COL_LABELS.length), true);
    DRILL_COL_LABELS.forEach((label, c) => {
      g.SetColLabelValue(c, label);
    });
    g.EnableEditing(false);
    g.SetDefaultCellAlignment(wxALIGN_CENTER, wxALIGN_CENTER);
    return g;
  });

  /** `drillGridSort`'s `sort( m_statsData.drillEntries … COMPARE( colId, ascending ) )`. */
  const [drillSort, setDrillSort] = useState<{ col: DRILL_LINE_ITEM_COL_ID; asc: boolean } | null>(
    null,
  );
  const drills = useMemo(
    () =>
      drillSort
        ? [...data.drillEntries].sort(DRILL_LINE_ITEM_COMPARE(drillSort.col, drillSort.asc))
        : data.drillEntries,
    [data, drillSort],
  );

  useEffect(() => {
    const drillGridSort = (e: wxGridEvent): void => {
      const colId = e.GetCol() as DRILL_LINE_ITEM_COL_ID;
      const ascending = !(drillGrid.IsSortingBy(colId) && drillGrid.IsSortOrderAscending());
      setDrillSort({ col: colId, asc: ascending });
    };
    drillGrid.Connect(wxEVT_GRID_COL_SORT, drillGridSort);
    return () => drillGrid.Disconnect(wxEVT_GRID_COL_SORT, drillGridSort);
  }, [drillGrid]);

  // `updateDrillGrid` (`:370-411`).
  useLayoutEffect(() => {
    drillGrid.BeginBatch();
    drillGrid.ClearRows();
    drillGrid.AppendRows(drills.length);

    drills.forEach((d, row) => {
      const shapeStr =
        d.shape === PAD_DRILL_SHAPE.CIRCLE
          ? 'Round'
          : d.shape === PAD_DRILL_SHAPE.OBLONG
            ? 'Slot'
            : '???';
      const layerStr = (layer: PCB_LAYER_ID): string =>
        layer === PCB_LAYER_ID.UNDEFINED_LAYER ? 'N/A' : board.GetLayerName(layer);
      const cells = [
        `${d.qty}`,
        shapeStr,
        unitsProvider.MessageTextFromValue(d.xSize),
        unitsProvider.MessageTextFromValue(d.ySize),
        d.isPlated ? 'PTH' : 'NPTH',
        d.isPad ? 'Pad' : 'Via',
        layerStr(d.startLayer),
        layerStr(d.stopLayer),
      ];
      cells.forEach((v, col) => {
        drillGrid.SetCellValue(row, col, v);
      });
    });

    drillGrid.EndBatch();
  }, [drillGrid, drills, board, unitsProvider]);

  return (
    <div ref={rootRef} className="ze-dialog" role="dialog" aria-label="Board Statistics">
      <div className="ze-dialog-body">
        <div className="ze-notebook-tabs">
          <button type="button" aria-pressed={tab === 'general'} onClick={() => setTab('general')}>
            General
          </button>
          <button type="button" aria-pressed={tab === 'drills'} onClick={() => setTab('drills')}>
            Drill Holes
          </button>
        </div>

        {tab === 'general' ? (
          <div className="ze-stats-general">
            <fieldset>
              <legend>Components</legend>
              <table className="ze-grid">
                <thead>
                  <tr>
                    <th className="ze-stats-label" />
                    <th className="ze-stats-value">Front Side</th>
                    <th className="ze-stats-value">Back Side</th>
                    <th className="ze-stats-value">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.footprintEntries.map((e) => (
                    <tr key={e.title}>
                      <td className="ze-stats-label">{e.title}</td>
                      <td className="ze-stats-value">{e.frontCount}</td>
                      <td className="ze-stats-value">{e.backCount}</td>
                      <td className="ze-stats-value">{e.frontCount + e.backCount}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="ze-stats-label">Total:</td>
                    <td className="ze-stats-value">{frontTotal}</td>
                    <td className="ze-stats-value">{backTotal}</td>
                    <td className="ze-stats-value">{frontTotal + backTotal}</td>
                  </tr>
                </tbody>
              </table>
            </fieldset>

            <fieldset>
              <legend>Pads</legend>
              <Grid rows={padRows} />
            </fieldset>

            <fieldset>
              <legend>Board</legend>
              <Grid rows={boardRows} />
            </fieldset>

            <fieldset>
              <legend>Vias</legend>
              <Grid rows={viaRows} />
            </fieldset>
          </div>
        ) : (
          <WxGridView grid={drillGrid} ariaLabel="Drill holes" />
        )}

        <div className="ze-stats-options">
          {checkbox('subtractHolesFromBoardArea', 'Subtract holes from board area')}
          {checkbox('subtractHolesFromCopperAreas', 'Subtract holes from copper areas')}
          {checkbox('excludeFootprintsWithoutPads', 'Exclude footprints with no pads')}
        </div>
      </div>

      <div className="ze-dialog-buttons">
        <button
          type="button"
          onClick={() =>
            onGenerateReport(
              FormatBoardStatisticsReport(data, board, unitsProvider, projectName, boardName),
              `${boardName || 'board'}-statistics.txt`,
            )
          }
        >
          Generate Report File...
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
