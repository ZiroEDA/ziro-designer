// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_tables/board_characteristics_table.cpp`: the `PCB_TABLE`
 * that Place > Board Characteristics puts on the board.
 */
import {
  type EdaUnits,
  pcbIUScale,
  stringFromValue,
  unityScale,
} from '@ziroeda/common/eda_units.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '../board.js';
import { DEFAULT_LINE_WIDTH } from '../board_design_settings_defaults.js';
import {
  BS_EDGE_CONNECTOR_BEVELLED,
  BS_EDGE_CONNECTOR_IN_USE,
  BS_EDGE_CONNECTOR_NONE,
} from '../board_stackup_manager/board_stackup.js';
import {
  ComputeBoardStatistics,
  DEFAULT_BOARD_STATISTICS_OPTIONS,
  InitializeBoardStatisticsData,
} from '../board_statistics_report.js';
import { PCB_TABLE, PCB_TABLECELL } from '../pcb_table.js';

export function Build_Board_Characteristics_Table(
  aBoard: BOARD,
  aDisplayUnits: EdaUnits,
): PCB_TABLE {
  const settings = aBoard.GetDesignSettings();
  const stackup = settings.GetStackupDescriptor();
  const units_provider = new UNITS_PROVIDER(pcbIUScale, aDisplayUnits);

  stackup.SynchronizeWithBoard(settings);

  const brd_stat_data = InitializeBoardStatisticsData();
  const opts = DEFAULT_BOARD_STATISTICS_OPTIONS;
  ComputeBoardStatistics(aBoard, opts, brd_stat_data);

  const table = new PCB_TABLE(aBoard, pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH));
  table.SetColCount(4);

  const addHeaderCell = (text: string): void => {
    const c = new PCB_TABLECELL(table);
    c.SetTextSize({ x: pcbIUScale.mmToIU(2.0), y: pcbIUScale.mmToIU(2.0) });
    c.SetTextThickness(pcbIUScale.mmToIU(0.4));
    c.SetText(text);
    c.SetColSpan(table.GetColCount());
    table.AddCell(c);
  };

  const addDataCell = (text: string): void => {
    const c = new PCB_TABLECELL(table);
    c.SetTextSize({ x: pcbIUScale.mmToIU(1.5), y: pcbIUScale.mmToIU(1.5) });
    c.SetTextThickness(pcbIUScale.mmToIU(0.2));
    c.SetText(text);
    table.AddCell(c);
  };

  addHeaderCell('BOARD CHARACTERISTICS');

  for (let col = 1; col < table.GetColCount(); ++col) {
    addHeaderCell('');
    table.GetCell(0, col)!.SetColSpan(0);
  }

  addDataCell('Copper layer count: ');
  addDataCell(stringFromValue(unityScale, 'unscaled', settings.GetCopperLayerCount(), false));

  addDataCell('Board thickness: ');
  addDataCell(units_provider.MessageTextFromValue(brd_stat_data.boardThickness, true));

  const outline = new SHAPE_POLY_SET();
  aBoard.GetBoardPolygonOutlines(outline, false);
  const size = outline.BBox();

  addDataCell('Board overall dimensions: ');
  addDataCell(
    `${units_provider.MessageTextFromValue(size.GetWidth(), true)} x ${units_provider.MessageTextFromValue(size.GetHeight(), true)}`,
  );

  addDataCell('');
  addDataCell('');

  addDataCell('Min track/spacing: ');
  addDataCell(
    `${units_provider.MessageTextFromValue(brd_stat_data.minTrackWidth, true)} / ${units_provider.MessageTextFromValue(brd_stat_data.minClearanceTrackToTrack, true)}`,
  );

  const min_holeSize = brd_stat_data.minDrillSize;
  addDataCell('Min hole diameter: ');
  addDataCell(units_provider.MessageTextFromValue(min_holeSize, true));

  addDataCell('Copper finish: ');
  addDataCell(stackup.m_FinishType);

  addDataCell('Impedance control: ');
  addDataCell(stackup.m_HasDielectricConstrains ? 'Yes' : 'No');

  addDataCell('Castellated pads: ');
  const castellated_pad_count = aBoard.GetPadWithCastellatedAttrCount();
  addDataCell(castellated_pad_count ? 'Yes' : 'No');

  addDataCell('Press-fit pads: ');
  const pressfit_pad_count = aBoard.GetPadWithPressFitAttrCount();
  addDataCell(pressfit_pad_count ? 'Yes' : 'No');

  addDataCell('Plated board edge: ');
  addDataCell(stackup.m_EdgePlating ? 'Yes' : 'No');

  let msg = '';

  switch (stackup.m_EdgeConnectorConstraints) {
    case BS_EDGE_CONNECTOR_NONE:
      msg = 'No';
      break;
    case BS_EDGE_CONNECTOR_IN_USE:
      msg = 'Yes';
      break;
    case BS_EDGE_CONNECTOR_BEVELLED:
      msg = 'Yes, Bevelled';
      break;
  }

  addDataCell('Edge card connectors: ');
  addDataCell(msg);

  // We are building a table having 4 columns.
  // So we must have a cell count multible of 4, to have fully build row.
  // Othewise the table is really badly drawn.
  const cells_list = table.GetCells();
  const cell_to_add_cnt = cells_list.length % table.GetColCount();

  for (let ii = 0; ii < cell_to_add_cnt; ii++) addDataCell('');

  table.SetStrokeExternal(false);
  table.SetStrokeHeaderSeparator(false);
  table.SetStrokeColumns(false);
  table.SetStrokeRows(false);

  table.Autosize();
  table.SetPosition({ x: 0, y: 0 });

  return table;
}
