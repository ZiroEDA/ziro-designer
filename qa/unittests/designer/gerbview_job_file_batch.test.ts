// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `.gbrjob` in a plot batch must not stop the batch being sorted.
 *
 * Akshay opened a whole KiCad plot folder — 21 files — with "Open Autodetected
 * File" and the layers manager came out in file-chooser order with the drill
 * file LAST, where a real GerbView puts it first. Neither of our two sorts
 * produces that order, because no sort had run at all.
 *
 * The cause was one file. A KiCad plot folder contains exactly one `.gbrjob`,
 * and `loadFiles` had a branch that APPLIED it and then marked the whole batch
 * `selfSorted`, on the reasoning that a job file runs its own sort. It does
 * not: `LoadListOfGerberAndDrillFiles` refuses one outright —
 *
 *     if( filename.GetExt() == FILEEXT::GerberJobFileExtension.c_str() )
 *     {   //We cannot read a gerber job file as a gerber plot file: skip it
 *         txt.Printf( _( "<b>A gerber job file cannot be loaded as a plot
 *                         file</b> <i>%s</i>" ), filename.GetFullName() );
 *         success = false;
 *         reporter.Report( txt, RPT_SEVERITY_ERROR );
 *         continue;   }              (`gerbview/files.cpp:301-310`)
 *
 * — so it takes no layer and has no bearing on the ordering. `decideLoad`
 * already carried that refusal with upstream's own message; the file simply
 * never reached it.
 *
 * The names below are the real contents of the folder Akshay loaded,
 * `/home/akshay/ki_demo`, so the case this pins is the one that failed.
 */
import { describe, expect, it } from 'vitest';
import {
  decideLoad,
  plotBatchSelfSorts,
} from '@ziroeda/designer/src/editors/gerbview/gerber_load_report.js';
import { compareByFileExtension } from '@ziroeda/gerbview';

const P = 'kit-dev-coldfire-xilinx_5213-';

/** `/home/akshay/ki_demo`, all 22 of them. */
const FOLDER = [
  'B_Adhesive.gbr',
  'B_Courtyard.gbr',
  'B_Cu.gbr',
  'B_Mask.gbr',
  'B_Paste.gbr',
  'B_Silkscreen.gbr',
  'Edge_Cuts.gbr',
  'F_Adhesive.gbr',
  'F_Courtyard.gbr',
  'F_Fab.gbr',
  'F_Mask.gbr',
  'F_Paste.gbr',
  'F_Silkscreen.gbr',
  'In1_Cu.gbr',
  'In2_Cu.gbr',
  'job.gbrjob',
  'Margin.gbr',
  'NPTH.drl',
  'PTH.drl',
  'Top_layer.gbr',
  'User_Comments.gbr',
  'User_Drawings.gbr',
].map((n) => P + n);

describe('a .gbrjob does not make a plot batch self-sorting', () => {
  it('is false for the folder that failed', () => {
    // The regression itself: this returned true, and `if( isFirstFile )
    // SortLayersByFileExtension()` (files.cpp:184-193) was then skipped.
    expect(plotBatchSelfSorts(FOLDER)).toBe(false);
  });

  it('is false for a job file even when it is the only file', () => {
    expect(plotBatchSelfSorts([`${P}job.gbrjob`])).toBe(false);
  });

  it('is true for a zip, which really does sort itself', () => {
    // LoadZipArchiveFile ends with SortLayersByX2Attributes or
    // SortLayersByFileExtension of its own (files.cpp:631-634).
    expect(plotBatchSelfSorts(['plots.zip'])).toBe(true);
    expect(plotBatchSelfSorts(['PLOTS.ZIP'])).toBe(true);
  });
});

describe('the job file is refused, not loaded, on the plot path', () => {
  it('carries upstream error text and takes no layer', () => {
    const d = decideLoad(`${P}job.gbrjob`, '{"Header":{}}', 2, { noMoreLayers: false });
    expect(d.kind).toBe('refuse');
    expect(d.kind === 'refuse' && d.message).toContain(
      'A gerber job file cannot be loaded as a plot file',
    );
  });
});

describe('with the sort restored, the folder orders as KiCad does', () => {
  it('puts the drill file first and leaves the rest in load order', () => {
    // .DRL -> GERBER_DRILL (0), .GBR -> GERBER_BOARD_OUTLINE (1)
    // (gerber_file_image_list.cpp:216,232), and every .gbr therefore ties —
    // which upstream leaves in load order. Exactly what Akshay's KiCad capture
    // shows: PTH.drl at row 1, the gerbers behind it unmoved.
    const plots = FOLDER.filter((n) => !n.endsWith('.gbrjob') && !n.endsWith('NPTH.drl'));
    const sorted = plots.slice().sort(compareByFileExtension);

    expect(sorted[0]).toBe(`${P}PTH.drl`);
    // and the ties keep the order they arrived in
    expect(sorted.slice(1)).toEqual(plots.filter((n) => n !== `${P}PTH.drl`));
  });
});
