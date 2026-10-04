// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/exporters/export_gencad.cpp`: `BOARD_EDITOR_CONTROL::ExportGenCAD`,
 * File > Export > GenCAD... — the options dialog, then GENCAD_EXPORTER.
 */

import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import {
  DIALOG_GENCAD_EXPORT_OPTIONS,
  type DIALOG_GENCAD_EXPORT_OPTIONS_FRAME,
  GENCAD_EXPORT_OPT,
} from '../dialogs/dialog_gencad_export_options.js';
import { GENCAD_EXPORTER } from './export_gencad_writer.js';

/** The frame `ExportGenCAD` runs on. */
export interface EXPORT_GENCAD_FRAME extends DIALOG_GENCAD_EXPORT_OPTIONS_FRAME {
  GetBoard(): BOARD | null;
  /** `optionsDialog.ShowModal()`: true for OK. */
  ShowGencadExportOptionsDialog(aDialog: DIALOG_GENCAD_EXPORT_OPTIONS): Promise<boolean>;
  Compile_Ratsnest(aDisplayStatus: boolean): void;
  WriteTextFile(aPath: string, aText: string): boolean;
}

/** `BOARD_EDITOR_CONTROL::ExportGenCAD` (export_gencad.cpp:36-77). */
export async function BOARD_EDITOR_CONTROL_ExportGenCAD(
  aFrame: EXPORT_GENCAD_FRAME,
): Promise<number> {
  const optionsDialog = new DIALOG_GENCAD_EXPORT_OPTIONS(aFrame, 'Export to GenCAD');

  if (!(await aFrame.ShowGencadExportOptionsDialog(optionsDialog))) return 0;

  const path = optionsDialog.GetFileName();

  // Get options
  const flipBottomPads = optionsDialog.GetOption(GENCAD_EXPORT_OPT.FLIP_BOTTOM_PADS);
  const uniquePinName = optionsDialog.GetOption(GENCAD_EXPORT_OPT.UNIQUE_PIN_NAMES);
  const individualShapes = optionsDialog.GetOption(GENCAD_EXPORT_OPT.INDIVIDUAL_SHAPES);
  const storeOriginCoords = optionsDialog.GetOption(GENCAD_EXPORT_OPT.STORE_ORIGIN_COORDS);

  // No idea on *why* this should be needed... maybe to fix net names?
  aFrame.Compile_Ratsnest(true);

  const board = aFrame.GetBoard()!;
  const exporter = new GENCAD_EXPORTER(board);

  // This is the export origin (the auxiliary axis)
  const auxOrigin = board.GetDesignSettings().GetAuxOrigin();
  const useAux = optionsDialog.GetOption(GENCAD_EXPORT_OPT.USE_AUX_ORIGIN);
  const GencadOffset: VECTOR2I = { x: useAux ? auxOrigin.x : 0, y: useAux ? auxOrigin.y : 0 };

  exporter.SetPlotOffet(GencadOffset);
  exporter.FlipBottomPads(flipBottomPads);
  exporter.UsePinNamesUnique(uniquePinName);
  exporter.UseIndividualShapes(individualShapes);
  exporter.StoreOriginCoordsInFile(storeOriginCoords);

  const success = exporter.WriteFile(path, (aPath, aText) => aFrame.WriteTextFile(aPath, aText));

  // DisplayError: the same error box as DisplayErrorMessage, without extra info.
  if (!success) DisplayErrorMessage(`Failed to create file '${path}'.`);

  return 0;
}
