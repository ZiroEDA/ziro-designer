// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_EXPORT_2581 (`dialog_export_2581_base.cpp` + `dialog_export_2581.{h,cpp}`), File >
 * Fabrication Outputs > IPC-2581 File (.xml)....
 *
 * Sizer tree, read whole (`port-the-sizer-tree-whole`):
 *
 *     bMainSizer (V)
 *       bSizerTop (H, wxEXPAND|wxALL 10): File: / m_outputFileName (proportion 1, min 350) /
 *         m_browseButton
 *       bSizerMiddle (H, wxEXPAND|wxBOTTOM 5)
 *         bSizerLeftCol (V, proportion 1): "File Format" + static line, gbSizer1 (5, 5):
 *           Units: / m_choiceUnits (Millimeters, Inches), Precision: / m_precision (4..10, 6),
 *           Version: / m_versionChoice (B, C; C), m_cbCompress spanning both columns
 *         a 10 px spacer
 *         bSizerRightCol (V, proportion 1): "BOM Columns" + static line, fgSizer4 (2 cols):
 *           BOM revision: / m_textBomRev, Internal ID: / m_oemRef (Generate unique + fields),
 *           Manufacturer P/N: / m_choiceMPN (Omit + fields), Manufacturer: / m_choiceMfg
 *           (N/A + fields, disabled), Distributor P/N: / m_choiceDistPN (Omit + fields),
 *           Distributor: / m_textDistributor ("N/A")
 *       m_messagesPanel (WX_HTML_REPORT_PANEL, proportion 1, min height 150)
 *       m_stdButtons, relabelled "Export" / "Close"
 *
 * Web delta, as in dialog_gen_footprint_position.tsx: the output path is project-relative, and the
 * file goes through `onOutputFile` into the file manager, or downloads when the board is open
 * standalone. The browse button offers the project's folders. Compressed output is a zip holding
 * `<name>.xml`, as wxZipOutputStream writes it upstream.
 */
import { useMemo, useState, type JSX } from 'react';
import { zipSync } from 'fflate';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  Reporter,
  type ReportLine,
} from '@ziroeda/common/reporter.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  IPC2581_UNITS,
  IPC2581_VERSION,
  JOB_EXPORT_PCB_IPC2581,
} from '@ziroeda/common/jobs/job_export_pcb_ipc2581.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { SpinCtrl } from '@ziroeda/common/widgets/spin_ctrl.js';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { BOARD } from '../board.js';
import { PCB_IO_IPC2581 } from '../pcb_io/ipc2581/pcb_io_ipc2581.js';

interface Props {
  board: BOARD;
  /** The board's file name, which names the default output. */
  fileName: string;
  /** Folders that already exist in the project (browse choices). */
  projectFolders?: readonly string[];
  /** Write a generated file into the project (path relative to the project folder). Absent when
   *  the board is open standalone, then the file downloads. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  onClose: () => void;
}

const UNITS_CHOICES = [
  { value: '0', label: 'Millimeters' },
  { value: '1', label: 'Inches' },
];
const VERSION_CHOICES = [
  { value: '0', label: 'B' },
  { value: '1', label: 'C' },
];

const download = (name: string, bytes: Uint8Array): void => {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

/** `wxFileName::SetExt( aExt )` on a path. */
function setExt(aPath: string, aExt: string): string {
  const slash = aPath.lastIndexOf('/');
  const dot = aPath.lastIndexOf('.');
  const stem = dot > slash + 1 ? aPath.substring(0, dot) : aPath;
  return stem === '' ? '' : `${stem}.${aExt}`;
}

/**
 * `DIALOG_EXPORT_2581::GenerateFile`: the shared dialog / CLI step. `aWrite` receives the file
 * (the zip, when compressing); false and an error report when the plugin throws.
 */
export function GenerateFile(
  aJob: JOB_EXPORT_PCB_IPC2581,
  aBoard: BOARD,
  aReporter: Reporter | null,
  aWrite: (aPath: string, aBytes: Uint8Array) => void,
): boolean {
  const outPath = aJob.m_filename;

  const props = new Map<string, string>();
  props.set('units', aJob.m_units === IPC2581_UNITS.MM ? 'mm' : 'inch');
  props.set('sigfig', String(aJob.m_precision));
  props.set('version', aJob.m_version === IPC2581_VERSION.C ? 'C' : 'B');
  props.set('OEMRef', aJob.m_colInternalId);
  props.set('mpn', aJob.m_colMfgPn);
  props.set('mfg', aJob.m_colMfg);
  props.set('dist', aJob.m_colDist);
  props.set('distpn', aJob.m_colDistPn);

  let bomRev = aJob.m_bomRev;
  const project = aBoard.GetProject();

  if (bomRev === '' && project) {
    const bomSettings = project.GetProjectFile().m_IP2581Bom;
    bomRev = bomSettings.bomRev;

    if (bomRev === '') bomRev = bomSettings.schRevision;
  }

  if (bomRev !== '') props.set('bomrev', bomRev);

  let bytes: Uint8Array | null = null;

  try {
    const pi = new PCB_IO_IPC2581();
    pi.SetReporter(aReporter);
    pi.SetFileWriter((_aPath, aData) => {
      bytes = aData;
    });
    pi.SaveBoard(outPath, aBoard, props);
  } catch (e) {
    if (!(e instanceof IO_ERROR)) throw e;

    aReporter?.Report(
      `Error generating IPC-2581 file '${aJob.m_filename}'.\n${e.What()}`,
      RPT_SEVERITY_ERROR,
    );
    return false;
  }

  if (!bytes) return false;

  if (aJob.m_compress) {
    const inner = setExt(outPath, 'xml');
    const entry = inner.substring(inner.lastIndexOf('/') + 1);
    aWrite(outPath, zipSync({ [entry]: bytes }));
  } else {
    aWrite(outPath, bytes);
  }

  return true;
}

export function DialogExport2581({
  board,
  fileName,
  projectFolders = [],
  onOutputFile,
  onClose,
}: Props): JSX.Element {
  useModalEscape(onClose);

  // init(): every field name of every footprint, sorted (std::set).
  const fieldNames = useMemo(() => {
    const options = new Set<string>();

    for (const fp of board.Footprints())
      for (const field of fp.GetFields()) options.add(field.GetName());

    return [...options].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [board]);

  const bom = board.GetProject()?.GetProjectFile().m_IP2581Bom ?? null;
  const pick = (aFirst: string, aWant: string): string =>
    fieldNames.includes(aWant) ? aWant : aFirst;

  // TransferDataToWindow(), the non-job branch.
  const defaultPath = (): string =>
    setExt((fileName || 'board.kicad_pcb').split('/').pop()!, 'xml');
  const [outputFileName, setOutputFileName] = useState(defaultPath);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [units, setUnits] = useState('0');
  const [precision, setPrecision] = useState(6);
  const [version, setVersion] = useState('1');
  const [compress, setCompress] = useState(false);
  const [bomRev, setBomRev] = useState(() => (bom ? bom.bomRev || bom.schRevision : ''));
  // Upstream selects the saved internal ID column in m_choiceMPN, not m_oemRef (a slip in
  // TransferDataToWindow that the MPN branch below then overrides); m_oemRef keeps its default.
  const [oemRef, setOemRef] = useState('');
  const [mpn, setMpn] = useState(() => pick('', bom?.MPN ?? ''));
  const [mfg, setMfg] = useState(() =>
    fieldNames.includes(bom?.MPN ?? '\0') ? pick('', bom?.mfg ?? '') : '',
  );
  const [distPN, setDistPN] = useState(() => pick('', bom?.distPN ?? ''));
  const [distributor, setDistributor] = useState(() =>
    fieldNames.includes(bom?.distPN ?? '\0') && bom?.distPN ? bom.dist : 'N/A',
  );

  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);

  const mfgEnabled = mpn !== '';
  const distEnabled = distPN !== '';

  // onCompressCheck: the extension follows the checkbox.
  const changeCompress = (aOn: boolean): void => {
    setCompress(aOn);
    setOutputFileName((p) => setExt(p, aOn ? 'zip' : 'xml'));
  };

  // onMfgPNChange: guess the manufacturer column unless one is chosen.
  const changeMpn = (aValue: string): void => {
    setMpn(aValue);

    if (aValue === '' || mfg !== '') return;

    for (const guess of ['manufacturer', 'mfg']) {
      if (fieldNames.includes(guess)) {
        setMfg(guess);
        return;
      }
    }
  };

  // onDistPNChange: guess the distributor from the column's name.
  const changeDistPN = (aValue: string): void => {
    setDistPN(aValue);

    if (aValue === '') {
      setDistributor('N/A');
      return;
    }

    if (distributor !== 'N/A') return;

    const dist = aValue.toUpperCase();
    const guesses: [string, string][] = [
      ['DIGIKEY', 'Digi-Key'],
      ['DIGI-KEY', 'Digi-Key'],
      ['MOUSER', 'Mouser'],
      ['NEWARK', 'Newark'],
      ['RS COMPONENTS', 'RS Components'],
      ['FARNELL', 'Farnell'],
      ['ARROW', 'Arrow'],
      ['AVNET', 'Avnet'],
      ['TME', 'TME'],
      ['LCSC', 'LCSC'],
    ];

    for (const [needle, name] of guesses) {
      if (dist.includes(needle)) {
        setDistributor(name);
        return;
      }
    }
  };

  // The Get* accessors.
  const getDist = (): string => (!distEnabled || distributor === 'N/A' ? '' : distributor);

  // onOKClick, the non-job branch: TransferDataFromWindow into a job, then GenerateFile.
  const onExport = (): void => {
    const job = new JOB_EXPORT_PCB_IPC2581();

    if (bom) {
      bom.id = oemRef;
      bom.mfg = mfgEnabled ? mfg : '';
      bom.MPN = mpn;
      bom.distPN = distPN;
      bom.dist = getDist();
      bom.bomRev = bomRev;
    }

    job.m_colInternalId = oemRef;
    job.m_colDist = getDist();
    job.m_colDistPn = distPN;
    job.m_colMfg = mfgEnabled ? mfg : '';
    job.m_colMfgPn = mpn;
    job.m_bomRev = bomRev;
    job.m_version = version === '0' ? IPC2581_VERSION.B : IPC2581_VERSION.C;
    job.m_units = units === '0' ? IPC2581_UNITS.MM : IPC2581_UNITS.INCH;
    job.m_precision = precision;
    job.m_compress = compress;

    const path = outputFileName.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    job.m_filename = path;

    const reporter = new Reporter();
    const name = path.substring(path.lastIndexOf('/') + 1);
    const stem = name.includes('.') ? name.substring(0, name.lastIndexOf('.')) : name;

    if (stem === '') {
      reporter.Report(
        'The board must be saved before generating IPC-2581 file.',
        RPT_SEVERITY_ERROR,
      );
      setMessages([...reporter.lines]);
      return;
    }

    const ok = GenerateFile(job, board, reporter, (aPath, aBytes) => {
      if (onOutputFile)
        onOutputFile(aPath, aBytes, compress ? 'application/zip' : 'application/xml');
      else download(name, aBytes);
    });

    if (ok) reporter.Report('IPC-2581 file generated successfully.', RPT_SEVERITY_ACTION);

    setMessages([...reporter.lines]);
  };

  const options = (aFirst: string): { value: string; label: string }[] => [
    { value: '', label: aFirst },
    ...fieldNames.map((n) => ({ value: n, label: n })),
  ];

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Export IPC-2581
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ display: 'block', overflow: 'auto' }}>
          <div className="ze-genpos-row" onMouseDown={() => setBrowseOpen(false)}>
            <span className="ze-genpos-label">File:</span>
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
                title="Export IPC-2581 File"
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
                        const base = outputFileName.substring(outputFileName.lastIndexOf('/') + 1);
                        setOutputFileName(f ? `${f}/${base}` : base);
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

          <div className="ze-genpos-formatrow">
            <div className="ze-pref-group" style={{ flex: 1 }}>
              <div className="ze-pref-group-title">File Format</div>
              <div className="ze-pref-group-body">
                <div className="ze-genpos-field">
                  <span className="ze-genpos-label">Units:</span>
                  <Combo
                    value={units}
                    options={UNITS_CHOICES}
                    onChange={setUnits}
                    ariaLabel="Units"
                  />
                </div>
                <div
                  className="ze-genpos-field"
                  title="The number of values following the decimal separator"
                >
                  <span className="ze-genpos-label">Precision:</span>
                  <SpinCtrl
                    value={precision}
                    onChange={setPrecision}
                    min={4}
                    max={10}
                    ariaLabel="Precision"
                  />
                </div>
                <div className="ze-genpos-field">
                  <span className="ze-genpos-label">Version:</span>
                  <Combo
                    value={version}
                    options={VERSION_CHOICES}
                    onChange={setVersion}
                    ariaLabel="Version"
                  />
                </div>
                <label className="ze-check" title="Compress output into 'zip' file">
                  <input
                    type="checkbox"
                    checked={compress}
                    onChange={(e) => changeCompress(e.target.checked)}
                  />
                  Compress output
                </label>
              </div>
            </div>

            <div className="ze-pref-group" style={{ flex: 1 }}>
              <div className="ze-pref-group-title">BOM Columns</div>
              <div className="ze-pref-group-body">
                <div
                  className="ze-genpos-field"
                  title="Revision string for the BOM section. Auto-populated from schematic title block revision"
                >
                  <span className="ze-genpos-label">BOM revision:</span>
                  <input
                    className="ze-search"
                    style={{ flex: 1 }}
                    value={bomRev}
                    onChange={(e) => setBomRev(e.target.value)}
                  />
                </div>
                <div
                  className="ze-genpos-field"
                  title={
                    'Part ID number used internally during design.\nThis number must be unique to each part.'
                  }
                >
                  <span className="ze-genpos-label">Internal ID:</span>
                  <Combo
                    value={oemRef}
                    options={options('Generate unique')}
                    onChange={setOemRef}
                    style={{ flex: 1 }}
                    ariaLabel="Internal ID"
                  />
                </div>
                <div
                  className="ze-genpos-field"
                  title="Column containing the manufacturer part number"
                >
                  <span className="ze-genpos-label">Manufacturer P/N:</span>
                  <Combo
                    value={mpn}
                    options={options('Omit')}
                    onChange={changeMpn}
                    style={{ flex: 1 }}
                    ariaLabel="Manufacturer P/N"
                  />
                </div>
                <div className="ze-genpos-field">
                  <span className="ze-genpos-label">Manufacturer:</span>
                  <Combo
                    value={mfgEnabled ? mfg : ''}
                    options={options('N/A')}
                    onChange={setMfg}
                    disabled={!mfgEnabled}
                    style={{ flex: 1 }}
                    ariaLabel="Manufacturer"
                  />
                </div>
                <div
                  className="ze-genpos-field"
                  title="Column containing the distributor part number"
                >
                  <span className="ze-genpos-label">Distributor P/N:</span>
                  <Combo
                    value={distPN}
                    options={options('Omit')}
                    onChange={changeDistPN}
                    style={{ flex: 1 }}
                    ariaLabel="Distributor P/N"
                  />
                </div>
                <div className="ze-genpos-field">
                  <span className="ze-genpos-label">Distributor:</span>
                  <input
                    className="ze-search"
                    style={{ flex: 1 }}
                    value={distributor}
                    disabled={!distEnabled}
                    onChange={(e) => setDistributor(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="ze-genpos-report">
            <HtmlReportPanel
              lines={messages}
              fileName="report.txt"
              minHeight={150}
              visibleSeverities={severities}
              onVisibleSeveritiesChange={setSeverities}
            />
          </div>
        </div>

        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="ze-btn primary" onClick={onExport}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
