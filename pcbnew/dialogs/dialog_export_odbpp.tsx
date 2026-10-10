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
 * archive is one file in the file manager (or a download when the board is open standalone), and
 * an uncompressed export is its files under that folder. A folder that only ever holds folders
 * (input, symbols, user, wheels) has no file to carry it there, so it lives only in the archives.
 */
import { gzipSync, zipSync } from 'fflate';
import { useState, type JSX } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  JOB_EXPORT_PCB_ODB,
  ODB_COMPRESSION,
  ODB_UNITS,
} from '@ziroeda/common/jobs/job_export_pcb_odb.js';
import { RPT_SEVERITY_ERROR, type Reporter } from '@ziroeda/common/reporter.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { SpinCtrl } from '@ziroeda/common/widgets/spin_ctrl.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { wxTarOutputStream } from '@ziroeda/common/wx/tarstrm.js';
import type { BOARD } from '../board.js';
import { PCB_IO_ODBPP } from '../pcb_io/odbpp/pcb_io_odbpp.js';

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
  /** Folders that already exist in the project (browse choices). */
  projectFolders?: readonly string[];
  onClose: (aResult: ODBPP_DIALOG_RESULT | null) => void;
}

const UNITS_CHOICES = [
  { value: '0', label: 'Millimeters' },
  { value: '1', label: 'Inches' },
];
const COMPRESS_CHOICES = [
  { value: '0', label: 'None' },
  { value: '1', label: 'ZIP' },
  { value: '2', label: 'TGZ' },
];

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
      const msg = `Output files '${outputPath}' already exists. Do you want to overwrite it?`;

      if (!(await aOutput.confirmOverwrite(msg))) return;
    }
  } else if (folder !== '' && aOutput.fileExists(`${folder}/matrix/matrix`)) {
    const msg = `Output directory '${outputPath}' already exists and is not empty. Do you want to overwrite it?`;

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
      `Error generating ODBPP files '${outputPath}'.\n${e.What()}`,
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

export function DialogExportOdbpp({ fileName, projectFolders = [], onClose }: Props): JSX.Element {
  const cancel = (): void => onClose(null);
  useModalEscape(cancel);

  // TransferDataToWindow(): <board>-odb.zip, then OnFmtChoiceOptionChanged.
  const [compress, setCompress] = useState(String(ODB_COMPRESSION.ZIP));
  const [outputFileName, setOutputFileName] = useState(() => {
    const base = (fileName || 'board.kicad_pcb').split('/').pop()!;
    const stem = base.includes('.') ? base.substring(0, base.lastIndexOf('.')) : base;
    return OnFmtChoiceOptionChanged(`${stem}-odb.zip`, ODB_COMPRESSION.ZIP);
  });
  const [browseOpen, setBrowseOpen] = useState(false);
  const [units, setUnits] = useState('0');
  const [precision, setPrecision] = useState(6);

  const onFormatChoice = (aValue: string): void => {
    setCompress(aValue);
    setOutputFileName((p) => OnFmtChoiceOptionChanged(p, Number(aValue) as ODB_COMPRESSION));
  };

  // onOKClick: the name must suit the format.
  const onOK = (): void => {
    const fn = outputFileName;

    if (fn === '') {
      DisplayErrorMessage('Output file name cannot be empty.');
      return;
    }

    const mode = Number(compress) as ODB_COMPRESSION;
    const extension = extOf(fn);

    if (
      (mode === ODB_COMPRESSION.NONE && !isDir(fn)) ||
      (mode === ODB_COMPRESSION.ZIP && extension !== 'zip') ||
      (mode === ODB_COMPRESSION.TGZ && extension !== 'tgz')
    ) {
      DisplayErrorMessage('The output file name conflicts with the selected compression format.');
      return;
    }

    onClose({
      outputPath: fn,
      units: units === '0' ? 'mm' : 'inch',
      precision,
      compressFormat: mode,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={cancel}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Export ODB++
          <span className="x" title="Close" onClick={cancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ display: 'block', overflow: 'auto' }}>
          <div className="ze-genpos-row" onMouseDown={() => setBrowseOpen(false)}>
            <span className="ze-genpos-label">Output file:</span>
            <input
              className="ze-search"
              style={{ flex: 1, minWidth: 350 }}
              value={outputFileName}
              title={
                'Enter a filename if you do not want to use default file names\n' +
                'Can be used only when printing the current sheet'
              }
              onChange={(e) => setOutputFileName(e.target.value)}
            />
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="ze-btn sm"
                title="Export ODB++ File"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setBrowseOpen((v) => !v);
                }}
              >
                <Icon name="folder" size={14} />
              </button>
              {browseOpen && (
                <div className="ze-folder-browse-popup" onMouseDown={(e) => e.stopPropagation()}>
                  {[
                    '',
                    ...[...new Set(projectFolders.filter(Boolean))].sort((a, b) =>
                      a < b ? -1 : a > b ? 1 : 0,
                    ),
                  ].map((f) => (
                    <div
                      key={f || '.'}
                      className="ze-menu-item ze-folder-browse-item"
                      onClick={() => {
                        const trimmed = outputFileName.replace(/\/+$/, '');
                        const base = trimmed.substring(trimmed.lastIndexOf('/') + 1);
                        const tail = isDir(outputFileName) ? '/' : '';
                        setOutputFileName(f ? `${f}/${base}${tail}` : `${base}${tail}`);
                        setBrowseOpen(false);
                      }}
                    >
                      {f || 'Project folder'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ze-genpos-field">
            <span className="ze-genpos-label">Units:</span>
            <Combo value={units} options={UNITS_CHOICES} onChange={setUnits} ariaLabel="Units" />
          </div>
          <div
            className="ze-genpos-field"
            title="The number of values following the decimal separator"
          >
            <span className="ze-genpos-label">Precision:</span>
            <SpinCtrl
              value={precision}
              onChange={setPrecision}
              min={2}
              max={16}
              ariaLabel="Precision"
            />
          </div>
          <div
            className="ze-genpos-field"
            title="Select the format to compress the output ODB++ files"
          >
            <span className="ze-genpos-label">Compression format:</span>
            <Combo
              value={compress}
              options={COMPRESS_CHOICES}
              onChange={onFormatChoice}
              ariaLabel="Compression format"
            />
          </div>
        </div>

        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={onOK}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export { JOB_EXPORT_PCB_ODB };
