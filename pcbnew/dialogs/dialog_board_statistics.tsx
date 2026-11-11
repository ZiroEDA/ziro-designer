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
import { type JSX, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
  wxGridCellAttr,
  type wxGridEvent,
  wxGridStringTable,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { wxALIGN_LEFT, wxALIGN_RIGHT } from '@ziroeda/wx/defs.js';
import { DIALOG_BOARD_STATISTICS_BASE } from './dialog_board_statistics_base.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

interface Props {
  board: BOARD;
  unitsProvider: UNITS_PROVIDER;
  projectName: string;
  /** The board's file name, which the report's suggested name is made from. */
  boardName: string;
  /** Hands the caller the finished report text to save, and the name it suggests. */
  onGenerateReport: (text: string, suggestedName: string) => void;
  onClose: () => void;
}

const DRILL_COL_LABELS = [
  _HKI('Count'),
  _HKI('Shape'),
  _HKI('X Size'),
  _HKI('Y Size'),
  _HKI('Plated'),
  _HKI('Via/Pad'),
  _HKI('Start Layer'),
  _HKI('Stop Layer'),
];

/** `s_savedDialogState`: the three checkboxes, remembered for the session. */
const s_savedDialogState = {
  excludeNoPins: false,
  subtractHoles: false,
  subtractHolesFromCopper: false,
};

/** For a test: a session that has not opened the dialog yet. */
export function ResetBoardStatisticsState(): void {
  s_savedDialogState.excludeNoPins = false;
  s_savedDialogState.subtractHoles = false;
  s_savedDialogState.subtractHolesFromCopper = false;
}

/** `formatCount`. */
const formatCount = (aCount: number): string => `${aCount}`;

/**
 * One of the General page's wxGrids: no labels, the label column left-aligned and the amounts
 * right-aligned (the constructor's SetCellAlignment loop), the cells `aCells`.
 */
function InfoGrid({
  cells,
  ariaLabel,
}: {
  cells: readonly (readonly string[])[];
  ariaLabel: string;
}): JSX.Element {
  const cols = cells[0]?.length ?? 0;
  const [grid] = useState(() => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(0, cols), true);
    g.EnableEditing(false);

    for (let col = 0; col < cols; col++) {
      const attr = new wxGridCellAttr();
      attr.SetAlignment(col === 0 ? wxALIGN_LEFT : wxALIGN_RIGHT, wxALIGN_CENTER);
      g.SetColAttr(col, attr);
    }

    return g;
  });

  useLayoutEffect(() => {
    grid.BeginBatch();
    grid.ClearRows();
    grid.AppendRows(cells.length);
    cells.forEach((row, r) => {
      row.forEach((value, c) => {
        grid.SetCellValue(r, c, value);
      });
    });
    grid.EndBatch();
  }, [grid, cells]);

  return <WxGridView grid={grid} colLabels={false} ariaLabel={ariaLabel} />;
}

export function DialogBoardStatistics({
  board,
  unitsProvider,
  projectName,
  boardName,
  onGenerateReport,
  onClose,
}: Props): JSX.Element {
  const [page, setPage] = useState(0);
  const [options, setOptions] = useState<BoardStatisticsOptions>(() => ({
    excludeFootprintsWithoutPads: s_savedDialogState.excludeNoPins,
    subtractHolesFromBoardArea: s_savedDialogState.subtractHoles,
    subtractHolesFromCopperAreas: s_savedDialogState.subtractHolesFromCopper,
  }));

  // checkboxClicked: remember the box, then getDataFromPCB() and updateWidgets() again.
  const data: BoardStatisticsData = useMemo(
    () => ComputeBoardStatistics(board, options),
    [board, options],
  );

  const check = (aKey: keyof BoardStatisticsOptions, aSaved: keyof typeof s_savedDialogState) => ({
    value: options[aKey],
    onChange: (aOn: boolean) => {
      s_savedDialogState[aSaved] = aOn;
      setOptions((o) => ({ ...o, [aKey]: aOn }));
    },
  });

  const v = (value: number, type: 'distance' | 'area' = 'distance'): string =>
    unitsProvider.MessageTextFromValue(value, true, type);

  // updateWidgets: each grid's rows, as KiCad fills them.
  const totalPads = data.padEntries.reduce((n, e) => n + e.quantity, 0);
  const pads = [
    ...data.padEntries.map((e) => [e.title, formatCount(e.quantity)]),
    [_('Total:'), formatCount(totalPads)],
    ...data.padPropertyEntries.map((e) => [e.title, formatCount(e.quantity)]),
  ];
  const totalVias = data.viaEntries.reduce((n, e) => n + e.quantity, 0);
  const vias = [
    ...data.viaEntries.map((e) => [e.title, formatCount(e.quantity)]),
    [_('Total:'), formatCount(totalVias)],
  ];
  const totalFront = data.footprintEntries.reduce((n, e) => n + e.frontCount, 0);
  const totalBack = data.footprintEntries.reduce((n, e) => n + e.backCount, 0);
  const components = [
    ['', _('Front Side'), _('Back Side'), _('Total')],
    ...data.footprintEntries.map((e) => [
      e.title,
      formatCount(e.frontCount),
      formatCount(e.backCount),
      formatCount(e.frontCount + e.backCount),
    ]),
    [
      _('Total:'),
      formatCount(totalFront),
      formatCount(totalBack),
      formatCount(totalFront + totalBack),
    ],
  ];
  const unknown = _('unknown');
  const boardRows = [
    [
      _('Dimensions:'),
      data.hasOutline
        ? `${unitsProvider.MessageTextFromValue(data.boardWidth, false)} x ${unitsProvider.MessageTextFromValue(data.boardHeight, true)}`
        : unknown,
    ],
    [_('Area:'), data.hasOutline ? v(data.boardArea, 'area') : unknown],
    [_('Front copper area:'), v(data.frontCopperArea, 'area')],
    [_('Back copper area:'), v(data.backCopperArea, 'area')],
    [_('Min track clearance:'), v(data.minClearanceTrackToTrack)],
    [_('Min track width:'), v(data.minTrackWidth)],
    [_('Min drill diameter:'), v(data.minDrillSize)],
    [_('Board stackup thickness:'), v(data.boardThickness)],
    [_('Front footprint area:'), v(data.frontFootprintCourtyardArea, 'area')],
    [
      _('Front footprint density:'),
      data.hasOutline ? `${data.frontFootprintDensity.toFixed(2)} %` : '',
    ],
    [_('Back footprint area:'), v(data.backFootprintCourtyardArea, 'area')],
    [
      _('Back footprint density:'),
      data.hasOutline ? `${data.backFootprintDensity.toFixed(2)} %` : '',
    ],
  ];

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

  /** `drillGridSort`'s `sort( m_statsData.drillEntries ... COMPARE( colId, ascending ) )`. */
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

  // `updateDrillGrid`.
  useLayoutEffect(() => {
    drillGrid.BeginBatch();
    drillGrid.ClearRows();
    drillGrid.AppendRows(drills.length);
    drills.forEach((d, row) => {
      const shapeStr =
        d.shape === PAD_DRILL_SHAPE.CIRCLE
          ? _('Round')
          : d.shape === PAD_DRILL_SHAPE.OBLONG
            ? _('Slot')
            : '???';
      const layerStr = (layer: PCB_LAYER_ID): string =>
        layer === PCB_LAYER_ID.UNDEFINED_LAYER ? 'N/A' : board.GetLayerName(layer);
      const cells = [
        `${d.qty}`,
        shapeStr,
        unitsProvider.MessageTextFromValue(d.xSize),
        unitsProvider.MessageTextFromValue(d.ySize),
        d.isPlated ? _('PTH') : _('NPTH'),
        d.isPad ? _('Pad') : _('Via'),
        layerStr(d.startLayer),
        layerStr(d.stopLayer),
      ];
      cells.forEach((value, col) => {
        drillGrid.SetCellValue(row, col, value);
      });
    });
    drillGrid.EndBatch();
  }, [drillGrid, drills, board, unitsProvider]);

  return (
    <DIALOG_BOARD_STATISTICS_BASE
      page={page}
      onPage={setPage}
      m_gridComponents={<InfoGrid cells={components} ariaLabel={_('Components')} />}
      m_gridPads={<InfoGrid cells={pads} ariaLabel={_('Pads')} />}
      m_gridBoard={<InfoGrid cells={boardRows} ariaLabel={_('Board')} />}
      m_gridVias={<InfoGrid cells={vias} ariaLabel={_('Vias')} />}
      m_checkBoxSubtractHoles={check('subtractHolesFromBoardArea', 'subtractHoles')}
      m_checkBoxSubtractHolesFromCopper={check(
        'subtractHolesFromCopperAreas',
        'subtractHolesFromCopper',
      )}
      m_checkBoxExcludeComponentsNoPins={check('excludeFootprintsWithoutPads', 'excludeNoPins')}
      m_gridDrills={<WxGridView grid={drillGrid} ariaLabel={_('Drill holes')} />}
      onSaveReport={() =>
        onGenerateReport(
          FormatBoardStatisticsReport(data, board, unitsProvider, projectName, boardName),
          // `fn.SetName( fn.GetName() + wxT( "_report" ) ); fn.SetExt( wxT( "txt" ) )`
          `${(boardName || 'board').replace(/\.kicad_pcb$/, '')}_report.txt`,
        )
      }
      onClose={onClose}
    />
  );
}
