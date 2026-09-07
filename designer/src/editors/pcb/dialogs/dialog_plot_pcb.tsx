// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Plot dialog for the board editor. Counterpart: DIALOG_PLOT
 * (`pcbnew/dialogs/dialog_plot_base.cpp` + `dialog_plot.cpp`), the plot-format
 * row and output directory on top, the "Include Layers" checklist on the left,
 * "General Options" and the format's own group on the right, the Output
 * Messages report panel, and the button row Run DRC... / Generate Drill
 * Files... / Close / Plot.
 *
 * Gerber is the format this editor writes, so the dialog shows Gerber's world:
 * upstream's SetPlotFormat( GERBER ) disables drill marks, scaling, mirrored
 * and negative plot outright, options that could never do anything here, so
 * they are left out instead of shown dead, along with the General Options that
 * need plotting passes we don't have (soldermask subtraction, DNP marking,
 * sketch pads / pad numbers). What remains is live: drawing the checked layers,
 * the drill/place file origin, Protel extensions, the Gerber job file, the
 * coordinate format and the X2/X1 attribute style.
 *
 * Web delta, there is no local filesystem, so "Output directory:" is a folder
 * inside the *project* (our cloud file manager), where each .gbr/.gbrjob/.drl
 * is written exactly as KiCad writes them to disk; "Download a copy to this
 * computer" additionally streams the set out as a zip.
 */
import { useMemo, useRef, useState, type JSX } from 'react';
import { zipSync, strToU8 } from 'fflate';
import {
  plotGerberLayer,
  type BoardMaskPasteDefaults,
  plotExcellonDrill,
  gerberProtelExtension,
  plotGerberJob,
  boardAuxOrigin,
  type Board,
} from '@ziroeda/pcbnew';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type ReportLine,
} from '@ziroeda/common';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '../../../widgets/wx_html_report_panel.js';
import { Icon } from '../../../ui/icons.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  board: Board;
  visibleLayers: ReadonlySet<string>;
  /**
   * Board Setup > Solder Mask/Paste, in IU. `PAD::GetSolderMaskExpansion` and
   * `GetSolderPasteMargin` end their fallback chain here, so without it every
   * pad plots its bare copper size on the mask and paste layers and the page
   * changes nothing in the exported gerbers.
   */
  maskPaste?: BoardMaskPasteDefaults;
  /** Folders that already exist in the project (browse choices). */
  projectFolders?: readonly string[];
  /** Write a generated file into the project (path relative to the project
   *  folder). Absent when the board is open standalone, then plots download. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  /** Run DRC... (upstream m_buttonDRC opens the DRC dialog). */
  onRunDrc?: () => void;
  onClose: () => void;
}

const download = (name: string, data: Uint8Array | string): void => {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], {
    type: 'application/octet-stream',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

export function DialogPcbPlot({
  board,
  visibleLayers,
  maskPaste,
  projectFolders = [],
  onOutputFile,
  onRunDrc,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const layerNames = board.layers.map((l) => l.name);
  const displayName = new Map(board.layers.map((l) => [l.name, l.userName ?? l.name]));
  // KiCad defaults to the fab set; seed with the visible layers intersection.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(layerNames.filter((l) => visibleLayers.has(l))),
  );
  const [protel, setProtel] = useState(false);
  const [jobFile, setJobFile] = useState(true);
  const [coordDigits, setCoordDigits] = useState<5 | 6>(6);
  const [useX2, setUseX2] = useState(true);
  const [useAuxOrigin, setUseAuxOrigin] = useState(false);
  const [outputDir, setOutputDir] = useState('gerbers');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [downloadCopy, setDownloadCopy] = useState(false);
  const base = (board.fileName ?? 'board')
    .replace(/\.kicad_pcb$/i, '')
    .split('/')
    .pop()!;

  // Output Messages (WX_HTML_REPORT_PANEL).
  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);
  const report = useRef((message: string, severity: number): void => {
    setMessages((m) => [...m, { message, severity, location: 'body' as const }]);
  }).current;

  const folders = useMemo(
    () => [...new Set(projectFolders.filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [projectFolders],
  );

  const toggle = (name: string): void =>
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const dir = outputDir.trim().replace(/^\/+|\/+$/g, '');
  /** Write one generated file into the project (and optionally download it). */
  const emit = (name: string, text: string, mime: string): void => {
    const bytes = strToU8(text);
    const path = dir ? `${dir}/${name}` : name;
    if (onOutputFile) {
      onOutputFile(path, bytes, mime);
      report(`Plotted to '${path}'.`, RPT_SEVERITY_ACTION);
    } else {
      download(name, bytes);
      report(`Plotted to '${name}'.`, RPT_SEVERITY_ACTION);
    }
  };

  const plot = (): void => {
    const made: { layer: string; name: string; text: string }[] = [];
    const date = new Date().toISOString();
    const origin = useAuxOrigin ? boardAuxOrigin(board) : undefined;
    for (const layer of layerNames.filter((l) => checked.has(l))) {
      const ext = protel ? gerberProtelExtension(layer) : 'gbr';
      const name = `${base}-${layer.replace(/\./g, '_')}.${ext}`;
      made.push({
        layer,
        name,
        text: plotGerberLayer(board, layer, {
          creationDate: date,
          coordDigits,
          useX2,
          origin,
          maskPaste,
        }),
      });
    }
    if (made.length === 0) {
      report('No layers selected, nothing to plot.', RPT_SEVERITY_WARNING);
      return;
    }
    for (const m of made) emit(m.name, m.text, 'application/vnd.gerber');
    const files: Record<string, Uint8Array> = {};
    for (const m of made) files[m.name] = strToU8(m.text);
    if (jobFile) {
      const jobName = `${base}-job.gbrjob`;
      const text = plotGerberJob(
        board,
        made.map((m) => ({ layer: m.layer, name: m.name })),
      );
      emit(jobName, text, 'application/json');
      files[jobName] = strToU8(text);
    }
    if (downloadCopy) {
      download(`${base}-gerbers.zip`, zipSync(files));
      report(`Downloaded ${base}-gerbers.zip.`, RPT_SEVERITY_INFO);
    }
  };

  const drill = (): void => {
    const origin = useAuxOrigin ? boardAuxOrigin(board) : undefined;
    const text = plotExcellonDrill(board, { creationDate: new Date().toISOString(), origin });
    emit(`${base}.drl`, text, 'text/plain');
    if (downloadCopy) download(`${base}.drl`, text);
  };

  const box: React.CSSProperties = {
    border: '1px solid var(--chrome-border)',
    borderRadius: 4,
    padding: '6px 10px 8px',
    margin: '0 0 10px',
  };
  const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px', fontWeight: 600 };
  const lab: React.CSSProperties = { fontSize: 12 };
  const check: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '5px 0',
    fontSize: 12.5,
  };
  const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '5px 0',
    fontSize: 12.5,
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Plot
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{ display: 'block', padding: '10px 14px', overflow: 'auto' }}
        >
          {/* Plot format + output directory (upstream's top rows). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={lab}>Plot format:</span>
            <select className="ze-select" value="gerber" onChange={() => {}}>
              <option value="gerber">Gerber</option>
            </select>
          </div>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}
            onMouseDown={() => setBrowseOpen(false)}
          >
            <span style={lab}>Output directory:</span>
            <input
              className="ze-search"
              style={{ flex: 1 }}
              value={outputDir}
              placeholder="Project folder"
              title="Folder inside the project for the plot files (relative to the project). They appear in the file manager, where you can download them."
              onChange={(e) => setOutputDir(e.target.value)}
            />
            <div style={{ position: 'relative' }}>
              <button
                className="ze-btn sm"
                title="Select output directory"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setBrowseOpen((v) => !v);
                }}
              >
                <Icon name="folder" size={14} />
              </button>
              {browseOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    zIndex: 20,
                    minWidth: 180,
                    marginTop: 2,
                    background: 'var(--chrome-bg2)',
                    border: '1px solid var(--chrome-border)',
                    borderRadius: 3,
                    fontSize: 12,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {['', ...folders].map((f) => (
                    <div
                      key={f || '.'}
                      className="ze-menu-item"
                      style={{ padding: '4px 12px', cursor: 'default' }}
                      onClick={() => {
                        setOutputDir(f);
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

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {/* Include Layers */}
            <fieldset
              style={{ ...box, flex: '0 0 200px', display: 'flex', flexDirection: 'column' }}
            >
              <legend style={legend}>Include Layers</legend>
              <div className="ze-grid-pane" style={{ height: 300, padding: '4px 6px' }}>
                {layerNames.map((l) => (
                  <label key={l} style={{ ...check, margin: '3px 0' }}>
                    <input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} />
                    {displayName.get(l) ?? l}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Options */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <fieldset style={box}>
                <legend style={legend}>General Options</legend>
                <label
                  style={check}
                  title="Use the drill/place file origin as the coordinate origin for plotted files"
                >
                  <input
                    type="checkbox"
                    checked={useAuxOrigin}
                    onChange={(e) => setUseAuxOrigin(e.target.checked)}
                  />
                  Use drill/place file origin
                </label>
                <label
                  style={check}
                  title="Plot files always land in the project's file manager; check this to also download them here."
                >
                  <input
                    type="checkbox"
                    checked={downloadCopy}
                    onChange={(e) => setDownloadCopy(e.target.checked)}
                  />
                  Download a copy to this computer
                </label>
              </fieldset>

              <fieldset style={box}>
                <legend style={legend}>Gerber Options</legend>
                <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label
                      style={check}
                      title={
                        'Use Protel Gerber extensions (.GBL, .GTL, etc...)\nNo longer recommended. The official extension is .gbr'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={protel}
                        onChange={(e) => setProtel(e.target.checked)}
                      />
                      Use Protel filename extensions
                    </label>
                    <label
                      style={check}
                      title={
                        'Generate a Gerber job file that contains info about the board,\nand the list of generated Gerber plot files'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={jobFile}
                        onChange={(e) => setJobFile(e.target.checked)}
                      />
                      Generate Gerber job file
                    </label>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={fieldRow}>
                      <span>Coordinate format:</span>
                      <select
                        className="ze-select"
                        style={{ flex: 1 }}
                        value={coordDigits}
                        onChange={(e) => setCoordDigits(Number(e.target.value) as 5 | 6)}
                      >
                        <option value={5}>4.5, unit mm</option>
                        <option value={6}>4.6, unit mm</option>
                      </select>
                    </div>
                    <label
                      style={check}
                      title={
                        'Use X2 Gerber file format.\nInclude mainly X2 attributes in Gerber headers.\nIf not checked, use X1 format.\nIn X1 format, these attributes are included as comments in files.'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={useX2}
                        onChange={(e) => setUseX2(e.target.checked)}
                      />
                      Use extended X2 format (recommended)
                    </label>
                  </div>
                </div>
              </fieldset>
            </div>
          </div>

          {/* Output Messages (WX_HTML_REPORT_PANEL). */}
          <HtmlReportPanel
            lines={messages}
            fileName="report.txt"
            minHeight={90}
            visibleSeverities={severities}
            onVisibleSeveritiesChange={setSeverities}
          />
        </div>

        {/* DIALOG_PLOT std-button row (GTK): Generate Drill Files (Apply),
            Close (Cancel), Plot (OK); Run DRC… on the far left. */}
        <div className="ze-modal-footer">
          <button
            className="ze-btn"
            style={{ marginRight: 'auto' }}
            disabled={!onRunDrc}
            onClick={() => onRunDrc?.()}
          >
            Run DRC...
          </button>
          <button className="ze-btn" onClick={drill}>
            Generate Drill Files...
          </button>
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button className="ze-btn primary" onClick={plot}>
            Plot
          </button>
        </div>
      </div>
    </div>
  );
}
