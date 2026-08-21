// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The type combo in GerbView's five open dialogs.
 *
 * KiCad builds each list by hand in `gerbview/files.cpp` and hands it to a
 * `wxFileDialog`, which turns it into the combo at the bottom of the dialog.
 * Ours reached for a hidden `<input type="file" accept="...">` instead, which
 * has no names and no groups at all — Chrome renders any accept list as one
 * entry called "Custom Files" — so every one of these dialogs offered one
 * unnamed filter where KiCad offers between one and fourteen named ones.
 *
 * Autodetect was worse than mislabelled: it clicked the GERBER input, so the
 * one entry whose whole purpose is to accept anything was the most narrowly
 * filtered of the five.
 */
import { describe, expect, it } from 'vitest';
import {
  GERBVIEW_AUTODETECT_FILTERS,
  GERBVIEW_DRILL_FILTERS,
  GERBVIEW_GERBER_FILTERS,
  GERBVIEW_JOB_FILTERS,
  GERBVIEW_ZIP_FILTERS,
} from '@ziroeda/designer/src/fs/wildcards.js';
import {
  acceptAttribute,
  pickerTypes,
  wantsAllFiles,
} from '@ziroeda/designer/src/fs/open_file_dialog.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VIEWER = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/gerbview/GerberViewer.tsx', import.meta.url),
  ),
  'utf8',
);

const labels = (fs: readonly { label: string }[]): string[] => fs.map((f) => f.label);

/** `openJobFile`'s body alone, comments blanked. */
function jobHandlerBody(): string {
  const at = VIEWER.indexOf('const openJobFile = useCallback');
  expect(at, 'openJobFile is missing').toBeGreaterThanOrEqual(0);
  const end = VIEWER.indexOf('}, [', at);
  expect(end, "openJobFile's callback does not close").toBeGreaterThan(at);
  return VIEWER.slice(at, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('Open Autodetected File(s)', () => {
  it('offers All files and nothing else', () => {
    // LoadFileOrShowDialog( aFileName, FILEEXT::AllFilesWildcard(),
    //                       _( "Open Autodetected File(s)" ), 2 )  files.cpp:200-205
    expect(labels(GERBVIEW_AUTODETECT_FILTERS)).toStrictEqual(['All files (*)']);
  });

  it('and therefore constrains the fallback input to nothing', () => {
    // An accept list here would be NARROWER than the dialog it stands in for,
    // which is the bug that started this: autodetect clicked the Gerber input.
    expect(acceptAttribute(GERBVIEW_AUTODETECT_FILTERS)).toBe('');
  });
});

describe('Open Gerber File(s)', () => {
  it('offers upstream fourteen entries, in upstream order', () => {
    // files.cpp:223-245, verbatim including the capital letters on the two Pad
    // Master entries, which are upstream's and not a typo.
    expect(labels(GERBVIEW_GERBER_FILTERS)).toStrictEqual([
      'Gerber files (*.g*; *.pho)',
      'Top layer (*.gtl)',
      'Bottom layer (*.gbl)',
      'Bottom solder resist (*.gbs)',
      'Top solder resist (*.gts)',
      'Bottom overlay (*.gbo)',
      'Top overlay (*.gto)',
      'Bottom paste (*.gbp)',
      'Top paste (*.gtp)',
      'Keep-out layer (*.gko)',
      'Mechanical layers (*.gm1; *.gm2; *.gm3; *.gm4; *.gm5; *.gm6; *.gm7; *.gm8; *.gm9)',
      'Top Pad Master (*.gpt)',
      'Bottom Pad Master (*.gpb)',
      'All files (*)',
    ]);
  });

  it('ends with All files, so nothing is unreachable', () => {
    // The `g*` glob cannot be expressed as extensions, so the catch-all at the
    // end is what keeps an unusual extension openable — the same role it plays
    // upstream when the glob fails to match.
    expect(wantsAllFiles(GERBVIEW_GERBER_FILTERS)).toBe(true);
  });

  it('drops the four extensions GerbView never offered', () => {
    // `.ger`, `.art`, `.rs274x` and `.x` were ours, and so was a literal `.g*`
    // that an accept attribute can never match.
    const all = GERBVIEW_GERBER_FILTERS.flatMap((f) => f.extensions);
    for (const bogus of ['ger', 'art', 'rs274x', 'x', 'g*']) {
      expect(all, `${bogus} is not in gerbview/files.cpp`).not.toContain(bogus);
    }
  });
});

describe('Open NC (Excellon) Drill File(s)', () => {
  it('is the drill wildcard then All files', () => {
    // filetypes = DrillFileWildcard(); filetypes << "|"; += AllFilesWildcard()
    //                                                          files.cpp:250-257
    expect(labels(GERBVIEW_DRILL_FILTERS)).toStrictEqual([
      'Drill files (*.drl; *.nc; *.xnc; *.txt)',
      'All files (*)',
    ]);
  });

  it('lists xnc, which ours left out, and not tap or drd, which are not there', () => {
    const exts = GERBVIEW_DRILL_FILTERS[0]!.extensions;
    expect(exts).toContain('xnc');
    expect(exts).not.toContain('tap');
    expect(exts).not.toContain('drd');
  });
});

describe('the two single-filter dialogs', () => {
  it('Open Gerber Job File offers one filter and no All files', () => {
    // job_file_reader.cpp:190-195 passes GerberJobFileWildcard() alone. The
    // asymmetry against the two above is upstream's, so it is asserted rather
    // than smoothed over.
    expect(labels(GERBVIEW_JOB_FILTERS)).toStrictEqual(['Gerber job file (*.gbrjob)']);
    expect(wantsAllFiles(GERBVIEW_JOB_FILTERS)).toBe(false);
  });

  it('Open Zip File likewise', () => {
    // files.cpp:660-663.
    expect(labels(GERBVIEW_ZIP_FILTERS)).toStrictEqual(['Zip file (*.zip)']);
    expect(wantsAllFiles(GERBVIEW_ZIP_FILTERS)).toBe(false);
  });

  it('and the job one no longer accepts .json, which is not a job file', () => {
    expect(GERBVIEW_JOB_FILTERS[0]!.extensions).toStrictEqual(['gbrjob']);
  });
});

describe('the filters reach the picker as named groups', () => {
  it('each becomes one type with the wildcard label as its description', () => {
    // showOpenFilePicker's `description` is what the OS dialog puts in its
    // filter combo — the only browser API that has one.
    const types = pickerTypes(GERBVIEW_DRILL_FILTERS);
    expect(types).toHaveLength(1); // All files is not a type; see below
    expect(types[0]!.description).toBe('Drill files (*.drl; *.nc; *.xnc; *.txt)');
    expect(Object.values(types[0]!.accept)[0]).toStrictEqual(['.drl', '.nc', '.xnc', '.txt']);
  });

  it('leaves the All files entry to excludeAcceptAllOption', () => {
    // A type with an empty accept map makes the call throw, so it must be
    // reported separately rather than passed through.
    expect(pickerTypes(GERBVIEW_AUTODETECT_FILTERS)).toStrictEqual([]);
    expect(wantsAllFiles(GERBVIEW_AUTODETECT_FILTERS)).toBe(true);
  });

  it('de-duplicates the fallback accept in first-seen order', () => {
    // Every Gerber sub-filter's extension also appears in the g* catch-all, so
    // a naive join would repeat most of them.
    const accept = acceptAttribute(GERBVIEW_DRILL_FILTERS);
    // Drill list carries All files, so the accept is empty by design.
    expect(accept).toBe('');
    const job = acceptAttribute(GERBVIEW_JOB_FILTERS);
    expect(job).toBe('.gbrjob');
  });
});

describe('GerbView opens five dialogs, not two', () => {
  it('each menu entry names its own filter list', () => {
    // Autodetect and Gerber both clicked openInputRef before this, so the two
    // that differ most were the two that were identical.
    //
    // openJobFile is the exception and it is upstream's: reading a job file is
    // `GERBVIEW_FRAME::LoadGerberJobFile`, a separate function with a dialog of
    // its own (`job_file_reader.cpp:176-195`), NOT the plot loader — which is
    // precisely what lets the plot loader refuse a .gbrjob by name. So it opens
    // through a handler and that handler is what names the list; the test
    // follows the one hop rather than pretending the shape is uniform, and the
    // case below asserts the separation itself.
    for (const [entry, filters] of [
      ['openAutodetected', 'GERBVIEW_AUTODETECT_FILTERS'],
      ['openGerber', 'GERBVIEW_GERBER_FILTERS'],
      ['openDrillFile', 'GERBVIEW_DRILL_FILTERS'],
      ['openZipFile', 'GERBVIEW_ZIP_FILTERS'],
    ] as const) {
      const at = VIEWER.indexOf(`${entry}: () => {`);
      expect(at, `${entry} is not wired`).toBeGreaterThanOrEqual(0);
      const body = VIEWER.slice(at, VIEWER.indexOf('},', at));
      expect(body, `${entry} must open ${filters}`).toContain(filters);
    }

    expect(jobHandlerBody(), 'openJobFile must open GERBVIEW_JOB_FILTERS').toContain(
      'GERBVIEW_JOB_FILTERS',
    );
  });

  it('and the job entry does not go through the plot loader', () => {
    // The whole point of the split: LoadListOfGerberAndDrillFiles refuses a
    // .gbrjob by name (`files.cpp:302-310`), so routing the job entry through
    // it would make Open Gerber Job File refuse the only file it accepts.
    // Comments stripped, and the slice ends at the handler's own close rather
    // than at the next section header: the first version of this ran to
    // `// ---- layer management` and reported the handler as an offender
    // because a LATER function's comment mentions loadFiles. Prose about a
    // rule must not read as the rule.
    const jobHandler = jobHandlerBody();
    expect(jobHandler).not.toContain('loadFiles');
    expect(jobHandler).toContain('applyJobFile');
  });

  it('and goes through the picker, not straight to the input', () => {
    expect(VIEWER).toMatch(/openFileDialog\(filters, \{/);
  });
});
