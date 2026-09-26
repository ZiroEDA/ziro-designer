// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_tables/board_stackup_table.cpp`: the `PCB_TABLE` that
 * Place > Stackup Table puts on the board, one row per stackup sublayer.
 */
import {
  type EdaUnits,
  pcbIUScale,
  stringFromValue,
  unityScale,
} from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/eda_text.js';
import { IsValidLayer } from '@ziroeda/common/layer_ids.js';
import { InitialCaps } from '@ziroeda/common/string_utils.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import type { BOARD } from '../board.js';
import { DEFAULT_LINE_WIDTH } from '../board_design_settings_defaults.js';
import {
  type BOARD_STACKUP_ITEM,
  BOARD_STACKUP_ITEM_TYPE,
  NotSpecifiedPrm,
} from '../board_stackup_manager/board_stackup.js';
import { PCB_TABLE, PCB_TABLECELL } from '../pcb_table.js';

export function Build_Board_Stackup_Table(aBoard: BOARD, aDisplayUnits: EdaUnits): PCB_TABLE {
  const settings = aBoard.GetDesignSettings();
  const stackup = settings.GetStackupDescriptor();
  const units_provider = new UNITS_PROVIDER(pcbIUScale, aDisplayUnits);

  stackup.SynchronizeWithBoard(settings);

  const layers = stackup.GetList();

  const table = new PCB_TABLE(aBoard, pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH));
  table.SetColCount(7);

  const addHeaderCell = (text: string): void => {
    const c = new PCB_TABLECELL(table);
    c.SetTextSize({ x: pcbIUScale.mmToIU(1.5), y: pcbIUScale.mmToIU(1.5) });
    c.SetTextThickness(pcbIUScale.mmToIU(0.3));
    c.SetText(text);
    table.AddCell(c);
  };

  const addDataCell = (text: string, align: 'L' | 'R' = 'L'): void => {
    const c = new PCB_TABLECELL(table);
    c.SetTextSize({ x: pcbIUScale.mmToIU(1.5), y: pcbIUScale.mmToIU(1.5) });
    c.SetTextThickness(pcbIUScale.mmToIU(0.2));

    if (align === 'R') c.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);

    c.SetText(text);
    table.AddCell(c);
  };

  const layerThicknessString = (aStackupItem: BOARD_STACKUP_ITEM, aSublayerId: number): string => {
    const layerThickness = aStackupItem.GetThickness(aSublayerId);

    // Layers like silkscreen, paste, etc. have no defined thickness, but that
    // does not mean that they are specified as exactly 0mm
    if (!aStackupItem.IsThicknessEditable()) return NotSpecifiedPrm();

    return units_provider.StringFromValue(layerThickness, true);
  };

  addHeaderCell('Layer Name');
  addHeaderCell('Type');
  addHeaderCell('Material');
  addHeaderCell('Thickness');
  addHeaderCell('Color');
  addHeaderCell('Epsilon R');
  addHeaderCell('Loss Tangent');

  for (let i = 0; i < stackup.GetCount(); i++) {
    const stackup_item = layers[i]!;

    for (let sublayer_id = 0; sublayer_id < stackup_item.GetSublayersCount(); sublayer_id++) {
      // Layer names are empty until we close at least once the board setup dialog.
      // If the user did not open the dialog, then get the names from the board.
      // But dielectric layer names will be missing. And in stackup, the name is not very good
      // So, for dielectric, a name will be used, similar to the name build in gerber job file
      let layerName = stackup_item.GetLayerName();

      if (layerName === '') {
        if (IsValidLayer(stackup_item.GetBrdLayerId()))
          layerName = aBoard.GetLayerName(stackup_item.GetBrdLayerId());
      }

      if (stackup_item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
        layerName = 'Dielectric';

        if (stackup_item.GetSublayersCount() < 2)
          layerName += ` ${stackup_item.GetDielectricLayerId()}`;
        else
          layerName += ` ${stackup_item.GetDielectricLayerId()} (${sublayer_id + 1}/${stackup_item.GetSublayersCount()})`;
      }

      addDataCell(layerName);
      addDataCell(InitialCaps(stackup_item.GetTypeName()));
      addDataCell(stackup_item.GetMaterial(sublayer_id));
      addDataCell(layerThicknessString(stackup_item, sublayer_id), 'R');
      addDataCell(stackup_item.GetColor(sublayer_id));
      addDataCell(
        stringFromValue(unityScale, 'unscaled', stackup_item.GetEpsilonR(sublayer_id)),
        'R',
      );
      addDataCell(
        stringFromValue(unityScale, 'unscaled', stackup_item.GetLossTangent(sublayer_id)),
        'R',
      );
    }
  }

  table.Autosize();
  table.SetPosition({ x: 0, y: 0 });

  return table;
}
