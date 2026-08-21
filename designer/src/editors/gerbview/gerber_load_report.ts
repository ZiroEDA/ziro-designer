// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `GERBVIEW_FRAME::LoadListOfGerberAndDrillFiles` refuses, and what it
 * says about it (`gerbview/files.cpp:278-422`).
 *
 * Loading is not "try to parse and see": there are three gates before the
 * parser, and each one names the file in a report that is shown at the end as
 * one Errors box rather than a dialog per file:
 *
 *     if( !success )
 *     {
 *         wxSafeYield();
 *         HTML_MESSAGE_BOX mbox( this, _( "Errors" ) );
 *         mbox.ListSet( reporter.GetMessages() );
 *         mbox.ShowModal();
 *     }                                            files.cpp:413-421
 *
 * Ours had none of them: every file went to `readGerberOrDrill`, which picks a
 * parser and never refuses, so a job file loaded as an empty gerber layer and
 * an unreadable file loaded as an empty gerber layer.
 *
 * The strings carry their own HTML because `HTML_MESSAGE_BOX::ListSet` wraps
 * each message in `<li>` and renders it as HTML — the bold heading and italic
 * filename in a live GerbView's Errors box are these markers, not styling we
 * would choose.
 */

import { detectFileType, GBR_FILE_TYPE, type GbrFileType } from '@ziroeda/gerbview';

/** `MSG_NOT_LOADED` (`gerbview/files.cpp:46`). */
export const MSG_NOT_LOADED = '<b>Not loaded:</b> <i>%s</i>';

/** `MSG_NO_MORE_LAYER` (`:45`). Not a format string — it names no file. */
export const MSG_NO_MORE_LAYER = '<b>No more available layers</b> in GerbView to load files';

/** The `.gbrjob` refusal (`:303-307`). */
export const MSG_JOB_FILE_AS_PLOT =
  '<b>A gerber job file cannot be loaded as a plot file</b> <i>%s</i>';

/** `_( "Errors" )`, the Errors box's caption (`:417`). */
export const ERRORS_CAPTION = 'Errors';

const format = (template: string, fileName: string): string => template.replace('%s', fileName);

/**
 * What to do with one file of a load batch: parse it as `type`, or refuse it
 * with `message`.
 *
 * `text` is only read for the autodetect case, which is the only one that
 * sniffs — Open Gerber File(s) passes 0 for every file and Open NC Drill
 * File(s) passes 1, and both hand whatever they are given straight to their
 * parser.
 */
export type LoadDecision = { kind: 'parse'; type: 0 | 1 } | { kind: 'refuse'; message: string };

/**
 * The three gates, in upstream's order.
 *
 * `noMoreLayers` is the first (`:336-352`): with no free slot the batch stops
 * and every remaining file is reported as not loaded, which is why it is asked
 * before anything is read.
 */
export function decideLoad(
  fileName: string,
  text: string,
  fileType: GbrFileType,
  opts: { noMoreLayers?: boolean } = {},
): LoadDecision {
  if (opts.noMoreLayers === true) {
    return { kind: 'refuse', message: format(MSG_NOT_LOADED, fileName) };
  }

  // `if( filename.GetExt() == FILEEXT::GerberJobFileExtension.c_str() )` (`:302`).
  // Note this is checked for EVERY type, autodetect included, and before any
  // content is read — a job file is refused on its name alone. "Open Gerber Job
  // File" is a different entry point (`job_file_reader.cpp:176`) and does not
  // come through here.
  if (/\.gbrjob$/i.test(fileName)) {
    return { kind: 'refuse', message: format(MSG_JOB_FILE_AS_PLOT, fileName) };
  }

  if (fileType === GBR_FILE_TYPE.AUTODETECT) {
    const detected = detectFileType(text);
    // The type stays 2 when neither sniff passes and falls to `default:`
    // (`:398-400`), which is the refusal — not a parse attempt.
    if (detected === null) {
      return { kind: 'refuse', message: format(MSG_NOT_LOADED, fileName) };
    }
    return { kind: 'parse', type: detected };
  }

  return { kind: 'parse', type: fileType };
}
