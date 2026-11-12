// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_EXPORT_ODBPP (`dialog_export_odbpp_base.cpp` + `dialog_export_odbpp.{h,cpp}`), File >
 * Fabrication Outputs > ODB++ Output File....
 *
 * Sizer tree, read whole (`port-the-sizer-tree-whole`):
 *
 *     bMainSizer (V)
 *       bSizerTop (H, wxALL|wxEXPAND 5): Output file: / m_outputFileName (proportion 1, min 350) /
 *         m_browseButton
 *       bSizer3 (H): fgSizer (2 cols, proportion 3): Units: / m_choiceUnits (Millimeters,
 *         Inches), Precision: / m_precision (2..16, 6), Compression format: / m_choiceCompress
 *         (None, ZIP, TGZ; ZIP), and an empty column (proportion 2)
 *       m_stdButtons OK / Cancel
 *
 * As upstream, the dialog only collects the settings; BOARD_EDITOR_CONTROL::GenerateODBPPFiles
 * checks the zones and calls GenerateODBPPFiles below. The output path is project-relative: an
 * archive is one download, and an uncompressed export is its files under that folder in one zip
 * (designer output_downloads.ts). A folder that only ever holds folders
 * (input, symbols, user, wheels) has no file to carry it there, so it lives only in the archives.
 */
import { gzipSync, zipSync } from 'fflate';
import { useState, type JSX } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  JOB_EXPORT_PCB_ODB,
  ODB_COMPRESSION,
  ODB_UNITS,
} from '@ziroeda/common/jobs/job_export_pcb_odb.js';
import { RPT_SEVERITY_ERROR, type Reporter } from '@ziroeda/common/reporter.js';
import { wxTarOutputStream } from '@ziroeda/wx/tarstrm.js';
import type { BOARD } from '../board.js';
import { PCB_IO_ODBPP } from '../pcb_io/odbpp/pcb_io_odbpp.js';
import { DIALOG_EXPORT_ODBPP_BASE } from './dialog_export_odbpp_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** What the dialog hands BOARD_EDITOR_CONTROL::GenerateODBPPFiles on OK. */
export interface ODBPP_DIALOG_RESULT {
  outputPath: string;
  units: string;
  precision: number;
  compressFormat: ODB_COMPRESSION;
}

/** The frame calls GenerateODBPPFiles makes: the file source, the KIDIALOG, the writer. */
export interface ODBPP_OUTPUT {
  fileExists(aPath: string): boolean;
  /** `KIDIALOG( …, wxOK | wxCANCEL | wxICON_WARNING )` with OK as Overwrite: true for OK. */
  confirmOverwrite(aMessage: string): Promise<boolean>;
  write(aPath: string, aBytes: Uint8Array, aMime: string): void;
}

interface Props {
  /** The board's file name, which names the default output. */
  fileName: string;
  onClose: (aResult: ODBPP_DIALOG_RESULT | null) => void;
}

/** `wxFileName( fn ).IsDir()`: a path that ends in a separator. */
const isDir = (aPath: string): boolean => aPath.endsWith('/') || aPath.endsWith('\\');

/** `OnFmtChoiceOptionChanged`: the name keeps its stem and takes the format's extension. */
export function OnFmtChoiceOptionChanged(aFileName: string, aMode: ODB_COMPRESSION): string {
  let fn = aFileName;
  const sepIdx = Math.max(fn.lastIndexOf('/'), fn.lastIndexOf('\\'));
  const dotIdx = fn.lastIndexOf('.');

  if (isDir(fn)) fn = fn.substring(0, sepIdx);
  else if (sepIdx < dotIdx) fn = fn.substring(0, dotIdx);

  switch (aMode) {
    case ODB_COMPRESSION.ZIP:
      return `${fn}.zip`;
    case ODB_COMPRESSION.TGZ:
      return `${fn}.tgz`;
    case ODB_COMPRESSION.NONE:
      // wxFileName( fn, "" ).GetFullPath(): fn as a folder.
      return `${fn}/`;
    default:
      return fn;
  }
}

/** `wxFileName::GetExt`. */
const extOf = (aPath: string): string => {
  const base = aPath.substring(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.substring(dot + 1) : '';
};

/**
 * `DIALOG_EXPORT_ODBPP::GenerateODBPPFiles`: export the board and package it as the job asks.
 * An existing output is replaced only after the Overwrite confirmation.
 */
export async function GenerateODBPPFiles(
  aJob: JOB_EXPORT_PCB_ODB,
  aBoard: BOARD,
  aOutput: ODBPP_OUTPUT,
  aReporter: Reporter | null,
): Promise<void> {
  let outputPath = aJob.m_outputPath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (outputPath === '') {
    const f = aJob.m_filename;
    outputPath = f.substring(0, f.lastIndexOf('/') + 1);
  }

  const outputIsSingleFile = aJob.m_compressionMode !== ODB_COMPRESSION.NONE;
  const folder = outputPath.replace(/\/+$/, '');

  if (outputIsSingleFile) {
    if (aOutput.fileExists(outputPath)) {
      const msg = wxFormat(
        _("Output files '%s' already exists. Do you want to overwrite it?"),
        outputPath,
      );

      if (!(await aOutput.confirmOverwrite(msg))) return;
    }
  } else if (folder !== '' && aOutput.fileExists(`${folder}/matrix/matrix`)) {
    const msg = wxFormat(
      _("Output directory '%s' already exists and is not empty. Do you want to overwrite it?"),
      outputPath,
    );

    if (!(await aOutput.confirmOverwrite(msg))) return;
  }

  const props = new Map<string, string>([
    ['units', aJob.m_units === ODB_UNITS.MM ? 'mm' : 'inch'],
    ['sigfig', String(aJob.m_precision)],
  ]);

  let tree: ReturnType<PCB_IO_ODBPP['ExportTree']>;

  try {
    const pi = new PCB_IO_ODBPP();
    pi.SetReporter(aReporter);
    tree = pi.ExportTree(aBoard, props);
  } catch (e) {
    if (!(e instanceof IO_ERROR)) throw e;

    aReporter?.Report(
      wxFormat(_("Error generating ODBPP files '%s'.\n%s"), outputPath, e.What()),
      RPT_SEVERITY_ERROR,
    );
    return;
  }

  const enc = new TextEncoder();

  if (aJob.m_compressionMode === ODB_COMPRESSION.ZIP) {
    // wxZipOutputStream over the temporary tree: every folder, then its files.
    const entries: Record<string, Uint8Array> = {};

    for (const d of tree.dirs) entries[`${d}/`] = new Uint8Array();

    for (const [p, t] of tree.files) entries[p] = enc.encode(t);

    aOutput.write(outputPath, zipSync(entries), 'application/zip');
  } else if (aJob.m_compressionMode === ODB_COMPRESSION.TGZ) {
    // The tar's root is the temporary folder's name, "odb".
    const tar = new wxTarOutputStream();
    const now = new Date();

    for (const d of tree.dirs) tar.PutNextDirEntry(`odb/${d}`, now);

    for (const [p, t] of tree.files) tar.PutNextEntry(`odb/${p}`, enc.encode(t), now);

    aOutput.write(outputPath, gzipSync(tar.Close()), 'application/gzip');
  } else {
    for (const [p, t] of tree.files)
      aOutput.write(folder === '' ? p : `${folder}/${p}`, enc.encode(t), 'text/plain');
  }
}

/**
 * `DIALOG_EXPORT_ODBPP`: the settings it collects and the checks onOKClick makes. The window is
 * DIALOG_EXPORT_ODBPP_BASE; Browse asks wxDirDialog for the folder and keeps the file name, as
 * the output is downloaded.
 */
export function DialogExportOdbpp({ fileName, onClose }: Props): JSX.Element {
  // TransferDataToWindow(): <board>-odb.zip, then OnFmtChoiceOptionChanged.
  const [compress, setCompress] = useState<number>(ODB_COMPRESSION.ZIP);
  const [outputFileName, setOutputFileName] = useState(() => {
    const base = (fileName || 'board.kicad_pcb').split('/').pop()!;
    const stem = base.includes('.') ? base.substring(0, base.lastIndexOf('.')) : base;
    return OnFmtChoiceOptionChanged(`${stem}-odb.zip`, ODB_COMPRESSION.ZIP);
  });
  const [units, setUnits] = useState(0);
  const [precision, setPrecision] = useState(6);

  const onFormatChoice = (aIndex: number): void => {
    setCompress(aIndex);
    setOutputFileName((p) => OnFmtChoiceOptionChanged(p, aIndex as ODB_COMPRESSION));
  };

  // onOKClick: the name must suit the format.
  const onOKClick = (): void => {
    const fn = outputFileName;

    if (fn === '') {
      DisplayErrorMessage(_('Output file name cannot be empty.'));
      return;
    }

    const mode = compress as ODB_COMPRESSION;
    const extension = extOf(fn);

    if (
      (mode === ODB_COMPRESSION.NONE && !isDir(fn)) ||
      (mode === ODB_COMPRESSION.ZIP && extension !== 'zip') ||
      (mode === ODB_COMPRESSION.TGZ && extension !== 'tgz')
    ) {
      DisplayErrorMessage(
        _('The output file name conflicts with the selected compression format.'),
      );
      return;
    }

    onClose({
      outputPath: fn,
      units: units === 0 ? 'mm' : 'inch',
      precision,
      compressFormat: mode,
    });
  };

  // The folder part of the output name, for wxDirDialog's defaultPath.
  const trimmed = outputFileName.replace(/\/+$/, '');
  const folder = trimmed.includes('/') ? trimmed.substring(0, trimmed.lastIndexOf('/')) : '';

  return (
    <>
      <DIALOG_EXPORT_ODBPP_BASE
        m_outputFileName={outputFileName}
        onOutputFileName={setOutputFileName}
        m_choiceUnits={units}
        onChoiceUnits={setUnits}
        m_precision={precision}
        onPrecision={setPrecision}
        m_choiceCompress={compress}
        onFormatChoice={onFormatChoice}
        onOKClick={onOKClick}
        onCancel={() => onClose(null)}
      />
    </>
  );
}

export { JOB_EXPORT_PCB_ODB };
