// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/exporters/export_footprint_associations.cpp`: the CvPcb
 * footprint association (.cmp) file, written from the board — File > Export >
 * Footprint Association (.cmp) File... (`BOARD_EDITOR_CONTROL::ExportCmpFile`).
 *
 * Where upstream `fopen`s the file, RecreateCmpFile returns its text and the
 * frame's WriteTextFile hook stores it.
 */

import { GetISO8601CurrentDateTime } from '@ziroeda/common/string_utils.js';
import type { BOARD } from '../board.js';

/**
 * Create the file *.cmp which links footprint names to the references of the
 * board's footprints.
 *
 * @param aBrd the board.
 * @param aDate "now", for the header; upstream reads the clock.
 * @return the file's text.
 */
export function RecreateCmpFile(aBrd: BOARD, aDate?: string): string {
  let cmpFile = '';

  cmpFile += `Cmp-Mod V01 Created by PcbNew   date = ${aDate ?? GetISO8601CurrentDateTime()}\n`;

  for (const fp of aBrd.Footprints()) {
    cmpFile += '\nBeginCmp\n';
    cmpFile += `TimeStamp = ${fp.m_Uuid}\n`;
    // KIID_PATH::AsString's loop ('/' + each step): empty for a footprint
    // placed from no schematic, where common/kiid.ts's kiidPathAsString says "/".
    cmpFile += `Path = ${fp
      .GetPath()
      .map((pathStep) => `/${pathStep}`)
      .join('')}\n`;
    cmpFile += `Reference = ${fp.GetReference() !== '' ? fp.GetReference() : '[NoRef]'};\n`;
    cmpFile += `ValeurCmp = ${fp.GetValue() !== '' ? fp.GetValue() : '[NoVal]'};\n`;
    cmpFile += `IdModule  = ${fp.GetFPID().Format()};\n`;
    cmpFile += 'EndCmp\n';
  }

  cmpFile += '\nEndListe\n';

  return cmpFile;
}
