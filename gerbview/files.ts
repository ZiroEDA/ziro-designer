// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/files.cpp`, the engine half: what
 * `GERBVIEW_FRAME::LoadListOfGerberAndDrillFiles` refuses, and what it says
 * about it (`:278-422`), and the autodetect it runs. The frame's own methods
 * (the open dialogs, `LoadZipArchiveFile`, `unarchiveFiles`) are
 * `GerberViewer.tsx`'s until the frame moves (STRUCTURE.md).
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

import { EXCELLON_IMAGE } from './excellon_read_drill_file.js';
import { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { GERBER_DRAW_LAYER } from '@ziroeda/common/layer_id.js';
import {
  Reporter,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_UNDEFINED,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/reporter.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import {
  GERBVIEW_AUTODETECT_FILTERS,
  GERBVIEW_DRILL_FILTERS,
  GERBVIEW_GERBER_FILTERS,
  GERBVIEW_ZIP_FILTERS,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import {
  wxFileExists,
  wxReadFileSync,
  wxRemoveFile,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { unzipSync } from 'fflate';
import { GERBER_FILE_IMAGE_LIST, GERBER_ORDER_ENUM } from './gerber_file_image_list.js';
import { type GERBVIEW_FRAME, NO_AVAILABLE_LAYERS } from './gerbview_frame.js';

/**
 * The file types `LoadListOfGerberAndDrillFiles` switches on (`aFileType`):
 * 0 gerber, 1 drill, 2 autodetect. Open Gerber File(s) passes 0 for every
 * file, Open NC Drill File(s) passes 1, and Open Autodetected File(s) passes
 * 2 — so only the third one sniffs, and the first two parse whatever they are
 * given.
 */
export const GBR_FILE_TYPE = { GERBER: 0, DRILL: 1, AUTODETECT: 2 } as const;
export type GbrFileType = (typeof GBR_FILE_TYPE)[keyof typeof GBR_FILE_TYPE];

/**
 * Autodetect, resolved (`files.cpp:355-401`): the Excellon sniff first, then
 * the RS-274 one; null when neither passes and the `default:` branch refuses
 * the file.
 */
export function detectFileType(text: string): 0 | 1 | null {
  if (EXCELLON_IMAGE.TestFileIsExcellon(text)) return GBR_FILE_TYPE.DRILL;
  if (GERBER_FILE_IMAGE.TestFileIsRS274(text)) return GBR_FILE_TYPE.GERBER;
  return null;
}

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

/**
 * Does this batch run its own sort, so `LoadListOfGerberAndDrillFiles`' one
 * must not run behind it?
 *
 * Only a zip does. `LoadZipArchiveFile` ends by sorting the archive's contents
 * itself — by X2 attributes when any gerber in it was X2, otherwise by file
 * extension (`gerbview/files.cpp:631-634`) — so the caller leaves it alone.
 *
 * A `.gbrjob` does NOT, and that is the point of this function. Upstream
 * refuses one on the plot path outright (`files.cpp:301-310`, and `decideLoad`
 * above carries the same refusal), so it takes no layer and has no bearing on
 * the ordering. Ours used to APPLY it here and mark the batch self-sorted, and
 * because a KiCad plot folder contains exactly one `.gbrjob`, opening a whole
 * folder silently skipped the sort and left the layers in file-chooser order
 * with the drill file last instead of first.
 */
export function plotBatchSelfSorts(fileNames: readonly string[]): boolean {
  return fileNames.some((n) => n.toLowerCase().endsWith('.zip'));
}

// ---- GERBVIEW_FRAME's loaders (files.cpp:45-738) ----------------------------

/** `MSG_OOM`. */
export const MSG_OOM = '<b>Memory was exhausted reading:</b> <i>%s</i>';

/** `wxFileName( aPath ).GetFullName()`. */
function fullNameOf(aPath: string): string {
  const i = aPath.lastIndexOf('/');
  return i === -1 ? aPath : aPath.slice(i + 1);
}

/** `wxFileName( aPath ).GetPath()`. */
function pathOf(aPath: string): string {
  const i = aPath.lastIndexOf('/');
  return i <= 0 ? (i === 0 ? '/' : '') : aPath.slice(0, i);
}

/** `wxFileName( aPath ).GetExt()`. */
function extOf(aPath: string): string {
  const name = fullNameOf(aPath);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1);
}

/** The file's text, as the readers' `wxFopen` + `fgets` see it; null when it cannot be opened. */
export function ReadFileText(aPath: string): string | null {
  const bytes = wxReadFileSync(aPath);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/** `WX_STRING_REPORTER`: messages kept as one string, a line each. */
export class WX_STRING_REPORTER extends Reporter {
  private m_string = '';

  Report(aText: string, aSeverity: Severity = RPT_SEVERITY_UNDEFINED): this {
    super.report(aText, aSeverity);
    this.m_string += `${aText}\n`;
    return this;
  }

  override report(aText: string, aSeverity: Severity = RPT_SEVERITY_UNDEFINED): this {
    return this.Report(aText, aSeverity);
  }

  HasMessage(): boolean {
    return this.m_string !== '';
  }

  GetMessages(): string {
    return this.m_string;
  }

  Clear(): void {
    super.clear();
    this.m_string = '';
  }
}

/** `static int lastGerberFileWildcard`: the filter the last dialog ended on. */
let lastGerberFileWildcard = 0;

/**
 * Load a file or show the dialog to choose several; then load them. The
 * dialog is the page's (`GERBVIEW_FRAME_HOST.FileDialog`).
 */
export async function LoadFileOrShowDialog(
  this: GERBVIEW_FRAME,
  aFileName: string,
  dialogFiletypes: readonly ChooserFilter[],
  dialogTitle: string,
  filetype: number,
): Promise<boolean> {
  let filenamesList: string[] = [];
  let currentPath: string;

  if (aFileName === '') {
    const chosen = await this.Host().FileDialog(
      dialogTitle,
      dialogFiletypes,
      true,
      lastGerberFileWildcard,
    );

    if (chosen === null) return false;

    lastGerberFileWildcard = chosen.filterIndex;
    filenamesList = chosen.paths;
    this.m_mruPath = currentPath = chosen.paths.length ? pathOf(chosen.paths[0]!) : this.m_mruPath;
  } else {
    filenamesList.push(aFileName);
    currentPath = pathOf(aFileName);
    this.m_mruPath = currentPath;
  }

  const isFirstFile = this.GetImagesList().GetLoadedImageCount() === 0;

  const fileTypesVec = new Array<number>(filenamesList.length).fill(filetype);
  const success = await this.LoadListOfGerberAndDrillFiles(
    currentPath,
    filenamesList,
    fileTypesVec,
  );

  // Auto zoom / sort is only applied when no other files have been loaded
  if (isFirstFile) {
    const ly = this.GetActiveLayer();

    this.SortLayersByFileExtension();
    this.Zoom_Automatique(false);

    // Ensure the initial active graphic layer is updated after sorting.
    this.SetActiveLayer(ly, true);
  }

  return success;
}

export function LoadAutodetectedFiles(this: GERBVIEW_FRAME, aFileName: string): Promise<boolean> {
  // 2 = autodetect files
  return LoadFileOrShowDialog.call(
    this,
    aFileName,
    GERBVIEW_AUTODETECT_FILTERS,
    'Open Autodetected File(s)',
    2,
  );
}

export function LoadGerberFiles(this: GERBVIEW_FRAME, aFileName: string): Promise<boolean> {
  // 0 = gerber files
  return LoadFileOrShowDialog.call(
    this,
    aFileName,
    GERBVIEW_GERBER_FILTERS,
    'Open Gerber File(s)',
    0,
  );
}

export function LoadExcellonFiles(this: GERBVIEW_FRAME, aFileName: string): Promise<boolean> {
  // 1 = drill files
  return LoadFileOrShowDialog.call(
    this,
    aFileName,
    GERBVIEW_DRILL_FILTERS,
    'Open NC (Excellon) Drill File(s)',
    1,
  );
}

/**
 * Load a list of Gerber and NC drill files and updates the view based on them.
 *
 * @param aPath is the base path for the filenames if they are relative
 * @param aFilenameList is a list of filenames to load
 * @param aFileType is a list of type of files to load (0 = Gerber, 1 = NC drill, 2 Autodetect)
 *                  (if nullptr, the file type is detected from the extension)
 * @return true if every file loaded successfully
 */
export async function LoadListOfGerberAndDrillFiles(
  this: GERBVIEW_FRAME,
  aPath: string,
  aFilenameList: readonly string[],
  aFileType: number[],
): Promise<boolean> {
  console.assert(
    aFilenameList.length === aFileType.length,
    'Mismatch in file names and file types count',
  );

  // Read gerber files: each file is loaded on a new GerbView layer
  let success = true;
  let layer = this.GetActiveLayer();
  let firstLoadedLayer = NO_AVAILABLE_LAYERS;
  const visibility = this.GetVisibleLayers();

  // Manage errors when loading files
  const reporter = new WX_STRING_REPORTER();

  for (let ii = 0; ii < aFilenameList.length; ii++) {
    let filename = aFilenameList[ii]!;

    if (!filename.startsWith('/')) filename = `${aPath}/${filename}`;

    // Check for non existing files, to avoid creating broken or useless data
    // and report all in one error list:
    if (!wxFileExists(filename)) {
      const warning = `<b>File not found:</b><br>${filename}<br>`;
      reporter.Report(warning, RPT_SEVERITY_WARNING);
      success = false;
      continue;
    }

    if (extOf(filename) === 'gbrjob') {
      //We cannot read a gerber job file as a gerber plot file: skip it
      const txt = format(MSG_JOB_FILE_AS_PLOT, fullNameOf(filename));
      success = false;
      reporter.Report(txt, RPT_SEVERITY_ERROR);
      continue;
    }

    this.m_lastFileName = filename;

    // Make sure we have a layer available to load into
    layer = this.getNextAvailableLayer();

    if (layer === NO_AVAILABLE_LAYERS) {
      success = false;
      reporter.Report(MSG_NO_MORE_LAYER, RPT_SEVERITY_ERROR);

      // Report the name of not loaded files:
      while (ii < aFilenameList.length) {
        const notLoaded = aFilenameList[ii++]!;
        const txt = format(MSG_NOT_LOADED, fullNameOf(notLoaded));
        reporter.Report(txt, RPT_SEVERITY_ERROR);
      }

      break;
    }

    this.SetActiveLayer(layer, false);
    visibility.set(layer, true);

    try {
      // 2 = Autodetect
      if (aFileType[ii] === 2) {
        const text = ReadFileText(filename) ?? '';

        if (EXCELLON_IMAGE.TestFileIsExcellon(text)) aFileType[ii] = 1;
        else if (GERBER_FILE_IMAGE.TestFileIsRS274(text)) aFileType[ii] = 0;
      }

      switch (aFileType[ii]) {
        case 0:
          if (await this.Read_GERBER_File(filename)) {
            this.Host().UpdateFileHistory(filename, 'gerber');

            if (firstLoadedLayer === NO_AVAILABLE_LAYERS) firstLoadedLayer = layer;
          }

          break;

        case 1:
          if (await this.Read_EXCELLON_File(filename)) {
            this.Host().UpdateFileHistory(filename, 'drill');

            // Select the first added layer by default when done loading
            if (firstLoadedLayer === NO_AVAILABLE_LAYERS) firstLoadedLayer = layer;
          }

          break;
        default: {
          const txt = format(MSG_NOT_LOADED, fullNameOf(filename));
          reporter.Report(txt, RPT_SEVERITY_ERROR);
        }
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;

      // std::bad_alloc
      const txt = format(MSG_OOM, fullNameOf(filename));
      reporter.Report(txt, RPT_SEVERITY_ERROR);
      success = false;
    }
  }

  if (!success) await this.Host().HtmlMessageBox(ERRORS_CAPTION, reporter.GetMessages());

  this.SetVisibleLayers(visibility);

  if (firstLoadedLayer !== NO_AVAILABLE_LAYERS) this.SetActiveLayer(firstLoadedLayer, true);

  // Synchronize layers tools with actual active layer:
  this.ReFillLayerWidget();

  this.syncLayerBox(true);

  this.GetCanvas()?.Refresh();

  return success;
}

/**
 * Extract gerber and drill files from the zip archive, and load them.
 *
 * @param aFullFileName is the full filename of the zip archive
 * @param aReporter a REPORTER to collect warning and error messages
 * @return true if OK, false if a file cannot be readable
 */
export async function unarchiveFiles(
  this: GERBVIEW_FRAME,
  aFullFileName: string,
  aReporter: WX_STRING_REPORTER | null,
): Promise<boolean> {
  let foundX2Gerbers = false;
  let msg: string;
  let firstLoadedLayer = NO_AVAILABLE_LAYERS;
  const visibility = this.GetVisibleLayers();

  // Extract the path of aFullFileName. We use it to store temporary files
  const unzipDir = pathOf(aFullFileName);

  const zipBytes = wxReadFileSync(aFullFileName);
  let entries: Record<string, Uint8Array> | null = null;

  try {
    entries = zipBytes ? unzipSync(zipBytes) : null;
  } catch {
    entries = null;
  }

  if (!entries) {
    if (aReporter) {
      msg = `Zip file '${aFullFileName}' cannot be opened.`;
      aReporter.Report(msg, RPT_SEVERITY_ERROR);
    }

    return false;
  }

  // Update the list of recent zip files.
  this.Host().UpdateFileHistory(aFullFileName, 'zip');

  // The unzipped file in only a temporary file. Give it a filename
  // which cannot conflict with an usual filename.
  const unzipped_tempfile = `${unzipDir}/$tempfile.tmp`;

  let success = true;
  let reported_no_more_layer = false;
  const view = this.GetCanvas()!.GetView();

  // wxZipInputStream walks the entries in the archive's own order.
  for (const [fname, data] of Object.entries(entries)) {
    if (fname.endsWith('/')) continue; // entry->IsDir()

    const curr_ext = extOf(fname).toLowerCase();

    // The archive contains Gerber and/or Excellon drill files. Use the right loader.
    // However it can contain a few other files (reports, pdf files...),
    // which will be skipped.
    if (curr_ext === 'gbrjob') {
      //We cannot read a gerber job file as a gerber plot file: skip it
      if (aReporter) {
        msg = `Skipped file '${fname}' (gerber job file).`;
        aReporter.Report(msg, RPT_SEVERITY_WARNING);
      }

      continue;
    }

    let { order } = GERBER_FILE_IMAGE_LIST.GetGerberLayerFromFilename(fname);

    let layer = this.getNextAvailableLayer();

    if (layer === NO_AVAILABLE_LAYERS) {
      success = false;

      if (aReporter) {
        if (!reported_no_more_layer) aReporter.Report(MSG_NO_MORE_LAYER, RPT_SEVERITY_ERROR);

        reported_no_more_layer = true;

        // Report the name of not loaded files:
        msg = format(MSG_NOT_LOADED, fname);
        aReporter.Report(msg, RPT_SEVERITY_ERROR);
      }

      continue;
    }

    this.SetActiveLayer(layer, false);

    // Create the unzipped temporary file:
    if (!wxWriteFileSync(unzipped_tempfile, data)) {
      success = false;

      if (aReporter) {
        msg = `<b>Unable to create temporary file '${unzipped_tempfile}'.</b>`;
        aReporter.Report(msg, RPT_SEVERITY_ERROR);
      }
    }

    let read_ok = true;
    const tempText = ReadFileText(unzipped_tempfile) ?? '';

    // Try to parse files if we can't tell from file extension
    if (order === GERBER_ORDER_ENUM.GERBER_LAYER_UNKNOWN) {
      if (EXCELLON_IMAGE.TestFileIsExcellon(tempText)) {
        order = GERBER_ORDER_ENUM.GERBER_DRILL;
      } else if (GERBER_FILE_IMAGE.TestFileIsRS274(tempText)) {
        // If we have no way to know what layer it is, just guess
        order = GERBER_ORDER_ENUM.GERBER_TOP_COPPER;
      } else if (aReporter) {
        msg = `Skipped file '${fname}' (unknown type).`;
        aReporter.Report(msg, RPT_SEVERITY_WARNING);
      }
    }

    if (order === GERBER_ORDER_ENUM.GERBER_DRILL) {
      read_ok = await this.Read_EXCELLON_File(unzipped_tempfile);
    } else if (order !== GERBER_ORDER_ENUM.GERBER_LAYER_UNKNOWN) {
      // Read gerber files: each file is loaded on a new GerbView layer
      read_ok = await this.Read_GERBER_File(unzipped_tempfile);

      if (read_ok) {
        const gbrImage = this.GetGbrImage(layer);

        if (gbrImage)
          view.SetLayerHasNegatives(GERBER_DRAW_LAYER(layer), gbrImage.HasNegativeItems());
      }
    }

    // Select the first added layer by default when done loading
    if (read_ok && firstLoadedLayer === NO_AVAILABLE_LAYERS) firstLoadedLayer = layer;

    // The unzipped file is only a temporary file, delete it.
    wxRemoveFile(unzipped_tempfile);

    if (!read_ok) {
      success = false;

      if (aReporter) {
        msg = `<b>unzipped file ${unzipped_tempfile} read error</b>`;
        aReporter.Report(msg, RPT_SEVERITY_ERROR);
      }
    } else {
      const gerber_image = this.GetGbrImage(layer);
      visibility.set(layer, true);

      if (gerber_image) {
        gerber_image.m_FileName = fname;

        if (gerber_image.m_IsX2_file) foundX2Gerbers = true;
      }

      layer = this.getNextAvailableLayer();
      this.SetActiveLayer(layer, false);
    }
  }

  if (foundX2Gerbers) this.SortLayersByX2Attributes();
  else this.SortLayersByFileExtension();

  this.SetVisibleLayers(visibility);

  // Select the first layer loaded so we don't show another layer on top after
  if (firstLoadedLayer !== NO_AVAILABLE_LAYERS) this.SetActiveLayer(firstLoadedLayer, true);

  return success;
}

/**
 * Load a zipped archive file.
 *
 * @param aFileName is the file name to load. If empty, the file name will be
 *                  chosen from the page's dialog.
 * @return true if file was opened successfully.
 */
export async function LoadZipArchiveFile(
  this: GERBVIEW_FRAME,
  aFullFileName: string,
): Promise<boolean> {
  let filename = aFullFileName;

  if (filename === '') {
    const chosen = await this.Host().FileDialog('Open Zip File', GERBVIEW_ZIP_FILTERS, false, 0);

    if (chosen === null || chosen.paths.length === 0) return false;

    filename = chosen.paths[0]!;
    this.m_mruPath = pathOf(filename);
  } else {
    this.m_mruPath = pathOf(filename);
  }

  const reporter = new WX_STRING_REPORTER();

  if (filename !== '') await unarchiveFiles.call(this, filename, reporter);

  this.Zoom_Automatique(false);

  // Synchronize layers tools with actual active layer:
  this.ReFillLayerWidget();
  this.SetActiveLayer(this.GetActiveLayer());
  this.syncLayerBox();

  if (reporter.HasMessage()) await this.Host().HtmlMessageBox('Messages', reporter.GetMessages());

  return true;
}
