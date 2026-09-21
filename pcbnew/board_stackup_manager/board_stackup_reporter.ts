// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_stackup_manager/board_stackup_reporter.cpp`: the text the
 * Physical Stackup page's "Export to Clipboard" copies.
 */
import { type EdaUnits, pcbIUScale, stringFromValue } from '@ziroeda/common/src/eda_units.js';
import {
  type BOARD_STACKUP,
  BOARD_STACKUP_ITEM_TYPE,
  BS_EDGE_CONNECTOR_BEVELLED,
  BS_EDGE_CONNECTOR_NONE,
} from './board_stackup.js';

export function BuildStackupReport(aStackup: BOARD_STACKUP, aUnits: EdaUnits): string {
  // Build a ascii representation of stackup and copy it in the clipboard
  let report = '';
  let txt: string;

  for (const item of aStackup.GetList()) {
    // Skip stackup items useless for the current board
    if (!item.IsEnabled()) continue;

    if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
      let sublayer_text = '';

      if (item.GetSublayersCount()) sublayer_text = `\n  sublayer "1/${item.GetSublayersCount()}"`;

      txt = `layer "${item.FormatDielectricLayerName()}" type "${item.GetTypeName()}"${sublayer_text}`;
    } else {
      txt = `layer "${item.GetLayerName()}" type "${item.GetTypeName()}"`;
    }

    report += txt;

    if (item.IsColorEditable()) {
      txt = ` Color "${item.GetColor()}"`;
      report += txt;
    }

    for (let idx = 0; idx < item.GetSublayersCount(); idx++) {
      if (idx) {
        // not printed for the main (first) layer.
        txt = `\n  sublayer "${idx + 1}/${item.GetSublayersCount()}"`;
        report += txt;
      }

      if (item.IsThicknessEditable()) {
        txt = ` Thickness ${stringFromValue(pcbIUScale, aUnits, item.GetThickness(idx), true)}`;
        report += txt;

        if (
          item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC &&
          item.IsThicknessLocked(idx)
        ) {
          txt = ' Locked';
          report += txt;
        }
      }

      if (item.IsMaterialEditable()) {
        txt = ` Material "${item.GetMaterial(idx)}"`;
        report += txt;
      }

      if (item.HasEpsilonRValue()) {
        txt = ` EpsilonR ${item.FormatEpsilonR(idx)}`;
        report += txt;
      }

      if (item.HasLossTangentValue()) {
        txt = ` LossTg ${item.FormatLossTangent(idx)}`;
        report += txt;
      }
    }

    report += '\n';
  }

  // Finish and other options:
  txt = `Finish "${aStackup.m_FinishType}"`;
  report += txt;

  if (aStackup.m_HasDielectricConstrains) report += ' Option "Impedance Controlled"';

  if (aStackup.m_EdgePlating) report += ' Option "Plated edges"';

  if (aStackup.m_EdgeConnectorConstraints !== BS_EDGE_CONNECTOR_NONE) {
    let conn_txt = 'yes';

    if (aStackup.m_EdgeConnectorConstraints === BS_EDGE_CONNECTOR_BEVELLED) conn_txt += ',bevelled';

    txt = ` EdgeConnector "${conn_txt}"`;
    report += txt;
  }

  report += '\n';

  return report;
}
