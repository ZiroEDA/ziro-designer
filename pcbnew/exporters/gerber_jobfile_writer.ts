// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber job file (`.gbrjob`), the counterpart of `GERBER_JOBFILE_WRITER`
 * (`pcbnew/exporters/gerber_jobfile_writer.cpp`).
 *
 * Not yet a port of the class: a minimal job file listing the plotted layer
 * files, moved here from `plot_gerber.ts` when GERBER_PLOTTER replaced that
 * writer. Each file's `FileFunction` is the Gerber header's own
 * (`GetGerberFileFunctionAttribute`, pcbplot.ts).
 */

import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  GENERATOR_APPLICATION,
  GENERATOR_VENDOR,
  GENERATOR_VERSION,
} from '@ziroeda/common/generator.js';
import type { BOARD } from '../board.js';
import { GetGerberFileFunctionAttribute } from '../pcbplot.js';

/** Minimal Gerber job file (.gbrjob) listing the plotted layer files. */
export function plotGerberJob(
  board: BOARD,
  files: { layer: PCB_LAYER_ID; name: string }[],
): string {
  const copperCount = board.GetCopperLayerCount();
  return JSON.stringify(
    {
      Header: {
        GenerationSoftware: {
          Vendor: GENERATOR_VENDOR,
          Application: GENERATOR_APPLICATION,
          Version: GENERATOR_VERSION,
        },
      },
      GeneralSpecs: {
        ProjectId: { Name: board.GetFileName() || 'board' },
        LayerNumber: copperCount,
      },
      FilesAttributes: files.map((f) => ({
        Path: f.name,
        FileFunction: GetGerberFileFunctionAttribute(board, f.layer)
          .replace(/^%TF\.FileFunction,/, '')
          .replace(/\*%$/, ''),
      })),
    },
    null,
    2,
  );
}
