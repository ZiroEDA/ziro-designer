// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GENDRILL (`pcbnew/dialogs/dialog_gendrill_base.cpp` + `dialog_gendrill.cpp`),
 * File > Fabrication Outputs > Drill Files... and the Plot dialog's own
 * "Generate Drill Files..." button (`dialog_plot.cpp:778`, `DIALOG_GENDRILL dlg(
 * m_editFrame, this )` — the same dialog from both places).
 *
 * Sizer tree, read whole before any CSS was written (`port-the-sizer-tree-whole`):
 *
 *     bMainSizer (V)
 *       bupperSizer (H): "Output folder:" label, m_outputDirectoryName (flex 1), browse button
 *       bmiddlerSizer (H)
 *         bLeftCol (V, flex 1): "Format" + line
 *           bSizerMargins (V)
 *             m_rbExcellon
 *             fgSizerExcellonOptions (indent 20): Mirror Y / Minimal header /
 *               PTH+NPTH single file / alt oval-hole mode
 *             spacer (proportion 1)
 *             m_rbGerberX2
 *             fgSizerGerberX2Options: Generate tenting layers
 *             bSizer9 (H): Generate map: / m_choiceDrillMap
 *         spacer (15px)
 *         bRightCol (V, flex 0): "Options" + line
 *           fgSizer1 (2-col flex grid, col 1 growable): Origin: / Units: /
 *             Zeros: / (spacer) / Precision: (label)
 *       bMsgSizer (StaticBox "Messages", proportion 1): m_messagesBox (readonly, multiline)
 *       m_buttonsSizer (H): "Generate Report File..." (flex 0), sdbSizer
 *         relabelled "Generate" / "Close" (`SetupStandardButtons`)
 *
 * Only EXCELLON_WRITER is ported (`GERBER_WRITER` is not — STRUCTURE.md), so
 * Gerber X2 drill files stay greyed: the row is buildable, not
 * browser-impossible, so it greys rather than disappears
 * (`browser-irrelevant-remove-not-grey`). Its one child (tenting layers) greys
 * with it, matching `onFileFormatSelection`'s `Enable( !enbl_Excellon )` — always
 * false while Excellon is the only selectable format.
 *
 * Web delta: no local filesystem, so "Output folder:" browses the *project*'s
 * own folders (same popup as `dialog_plot.tsx`'s), and every generated file —
 * drill, map, report — goes through `onOutputFile` into the project's file
 * manager, falling back to a browser download when the board is standalone
 * (`plot-print-cloud-output` memory).
 */
import { useState, type JSX } from 'react';
import type { Board } from '../index.js';
import { boardAuxOrigin } from '../board_design_settings.js';
import { PCB_PLOT_PARAMS } from '../pcb_plot_params.js';
import { EXCELLON_WRITER } from '../exporters/gendrill_excellon_writer.js';
import { DRILL_PRECISION, ZEROS_FMT } from '../exporters/gendrill_writer_base.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';

interface Props {
  board: Board;
  /** Folders that already exist in the project (browse choices). */
  projectFolders?: readonly string[];
  /** Write a generated file into the project (path relative to the project
   *  folder). Absent when the board is open standalone, then files download. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  onClose: () => void;
}

/** `precisionListForInches` / `precisionListForMetric` (`dialog_gendrill.cpp:54-55`) —
 *  KiCad's own two constants, not invented here. */
const PRECISION_INCHES = new DRILL_PRECISION(2, 4);
const PRECISION_METRIC = new DRILL_PRECISION(3, 3);

const ORIGIN_CHOICES = ['Absolute', 'Drill/place file origin'].map((l, i) => ({
  value: String(i),
  label: l,
}));
const UNITS_CHOICES = ['Millimeters', 'Inches'].map((l, i) => ({ value: String(i), label: l }));
const ZEROS_CHOICES = [
  'Decimal format (recommended)',
  'Suppress leading zeros',
  'Suppress trailing zeros',
  'Keep zeros',
].map((l, i) => ({ value: String(i), label: l }));
/** `m_choiceDrillMap`'s order, and `genDrillAndMapFiles`'s `filefmt[]` beside it. */
const MAP_CHOICES = ['Postscript', 'Gerber X2', 'DXF', 'SVG', 'PDF'].map((l, i) => ({
  value: String(i),
  label: l,
}));
const MAP_FORMATS = [
  PLOT_FORMAT.POST,
  PLOT_FORMAT.GERBER,
  PLOT_FORMAT.DXF,
  PLOT_FORMAT.SVG,
  PLOT_FORMAT.PDF,
];

const download = (name: string, bytes: Uint8Array): void => {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

export function DialogGendrill({
  board,
  projectFolders = [],
  onOutputFile,
  onClose,
}: Props): JSX.Element {
  useModalEscape(onClose);

  const [initial] = useState(() => board.k?.GetPlotOptions() ?? new PCB_PLOT_PARAMS());
  const [outputDir, setOutputDir] = useState(() => initial.GetOutputDirectory());
  const [browseOpen, setBrowseOpen] = useState(false);
  const [origin, setOrigin] = useState(() => (initial.GetUseAuxOrigin() ? '1' : '0'));
  // Gerber X2 drill files stay greyed (GERBER_WRITER not ported); the radio
  // state exists so the sizer tree matches upstream, but it can never flip.
  const [format] = useState<'excellon' | 'gerberx2'>('excellon');
  const [mirror, setMirror] = useState(false);
  const [minimal, setMinimal] = useState(false);
  const [mergePTHNPTH, setMergePTHNPTH] = useState(false);
  const [altDrillMode, setAltDrillMode] = useState(false);
  const [units, setUnits] = useState('0');
  const [zeros, setZeros] = useState('0');
  const [generateMap, setGenerateMap] = useState(false);
  const [mapFormat, setMapFormat] = useState('1');
  const [messages, setMessages] = useState<string[]>([]);

  const excellonSelected = format === 'excellon';
  const precisionEnabled = Number(zeros) !== ZEROS_FMT.DECIMAL_FORMAT;
  const precisionStr = (units === '1' ? PRECISION_INCHES : PRECISION_METRIC).GetPrecisionString();

  const base = (board.fileName ?? 'board')
    .replace(/\.kicad_pcb$/i, '')
    .split('/')
    .pop()!;
  const dir = outputDir
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');

  const appendMsg = (line: string): void => setMessages((m) => [...m, line]);

  const emitFile = (name: string, bytes: Uint8Array, mime: string): void => {
    const path = dir ? `${dir}/${name}` : name;
    if (onOutputFile) onOutputFile(path, bytes, mime);
    else download(name, bytes);
    appendMsg(`Created file '${path}'.`);
  };

  /** `DIALOG_GENDRILL::updateConfig` — persist output dir / origin onto the
   *  board's own plot options, the same field the Plot dialog reads. */
  const updateConfig = (): void => {
    const k = board.k;
    if (!k) return;
    const opts = new PCB_PLOT_PARAMS();
    opts.assign(k.GetPlotOptions());
    opts.SetOutputDirectory(dir);
    opts.SetUseAuxOrigin(origin === '1');
    if (!opts.IsSameAs(k.GetPlotOptions())) k.SetPlotOptions(opts);
  };

  /** `DIALOG_GENDRILL::genDrillAndMapFiles`, Excellon branch only. */
  const generate = (): void => {
    const k = board.k;
    if (!k) {
      appendMsg('The board model is not loaded, nothing to generate.');
      return;
    }
    if (!k.GetFileName()) k.SetFileName(board.fileName ?? 'board.kicad_pcb');

    updateConfig();
    setMessages([]);

    const drillOffset = origin === '1' ? boardAuxOrigin(board) : { x: 0, y: 0 };
    const precision = units === '1' ? PRECISION_INCHES : PRECISION_METRIC;

    const writer = new EXCELLON_WRITER(k);
    writer.SetFormat(units === '0', Number(zeros) as ZEROS_FMT, precision.m_Lhs, precision.m_Rhs);
    writer.SetOptions(mirror, minimal, drillOffset, mergePTHNPTH);
    writer.SetRouteModeForOvalHoles(!altDrillMode);
    writer.SetMapFileFormat(MAP_FORMATS[Number(mapFormat)]!);
    writer.SetPageInfo(k.GetPageSettings());
    writer.SetFileSink((name, bytes) => emitFile(name, bytes, 'text/plain'));

    writer.CreateDrillandMapFilesSet('', true, generateMap);
    appendMsg('Done.');
  };

  /** `DIALOG_GENDRILL::onGenReportFile`. */
  const generateReport = (): void => {
    const k = board.k;
    if (!k) {
      appendMsg('The board model is not loaded, nothing to report.');
      return;
    }
    if (!k.GetFileName()) k.SetFileName(board.fileName ?? 'board.kicad_pcb');

    updateConfig();
    setMessages([]);

    const name = `${base}-drl.rpt`;
    const writer = new EXCELLON_WRITER(k);
    writer.SetMergeOption(mergePTHNPTH);
    writer.SetFileSink((_path, bytes) => {
      const path = dir ? `${dir}/${name}` : name;
      if (onOutputFile) onOutputFile(path, bytes, 'text/plain');
      else download(name, bytes);
      appendMsg(`Report file '${path}' created.`);
    });

    if (!writer.GenDrillReportFile(name)) appendMsg(`Failed to create file '${name}'.`);
  };

  const box: React.CSSProperties = {
    border: '1px solid var(--chrome-border)',
    borderRadius: 4,
    padding: '6px 10px 8px',
  };
  const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px', fontWeight: 600 };
  const lab: React.CSSProperties = { fontSize: 12 };
  const check: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '4px 0',
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
          Generate Drill Files
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{ display: 'block', padding: '10px 14px', overflow: 'auto' }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}
            onMouseDown={() => setBrowseOpen(false)}
          >
            <span style={lab}>Output folder:</span>
            <input
              className="ze-search"
              style={{ flex: 1 }}
              value={outputDir}
              placeholder="Project folder"
              title="Folder inside the project for the drill/map files (relative to the project). They appear in the file manager, where you can download them."
              onChange={(e) => setOutputDir(e.target.value)}
            />
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="ze-btn sm"
                title="Select output folder"
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
                  {[
                    '',
                    ...[...new Set(projectFolders.filter(Boolean))].sort((a, b) =>
                      a.localeCompare(b),
                    ),
                  ].map((f) => (
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

          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            {/* Format */}
            <fieldset style={{ ...box, flex: 1 }}>
              <legend style={legend}>Format</legend>
              <label style={check}>
                <input type="radio" name="ze-gendrill-fmt" checked readOnly />
                Excellon
              </label>
              <div style={{ marginLeft: 20 }}>
                <label
                  style={check}
                  title={'Not recommended.\nUsed mostly by users who make the boards themselves.'}
                >
                  <input
                    type="checkbox"
                    checked={mirror}
                    onChange={(e) => setMirror(e.target.checked)}
                  />
                  Mirror Y axis
                </label>
                <label
                  style={check}
                  title={
                    'Not recommended.\nOnly use it for board houses which do not accept fully featured headers.'
                  }
                >
                  <input
                    type="checkbox"
                    checked={minimal}
                    onChange={(e) => setMinimal(e.target.checked)}
                  />
                  Minimal header
                </label>
                <label
                  style={check}
                  title={
                    'Not recommended.\nOnly use for board houses which ask for merged PTH and NPTH into a single file.'
                  }
                >
                  <input
                    type="checkbox"
                    checked={mergePTHNPTH}
                    onChange={(e) => setMergePTHNPTH(e.target.checked)}
                  />
                  PTH and NPTH in single file
                </label>
                <label style={check}>
                  <input
                    type="checkbox"
                    checked={altDrillMode}
                    onChange={(e) => setAltDrillMode(e.target.checked)}
                  />
                  Use alternate drill mode for oval holes
                </label>
              </div>
              <label
                style={{ ...check, marginTop: 4 }}
                title="Not ported: GERBER_WRITER (Gerber drill files) is not built here yet."
              >
                <input type="radio" name="ze-gendrill-fmt" disabled />
                Gerber X2
              </label>
              <div style={{ marginLeft: 20 }}>
                <label style={check}>
                  <input type="checkbox" disabled />
                  Generate tenting layers
                </label>
              </div>
              <div style={{ ...fieldRow, marginTop: 4 }}>
                <label style={{ ...check, margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={generateMap}
                    onChange={(e) => setGenerateMap(e.target.checked)}
                  />
                  Generate map:
                </label>
                <Combo
                  value={mapFormat}
                  options={MAP_CHOICES}
                  onChange={setMapFormat}
                  disabled={!generateMap}
                  ariaLabel="Generate map format"
                />
              </div>
            </fieldset>

            {/* Options */}
            <fieldset style={{ ...box, flex: '0 0 240px' }}>
              <legend style={legend}>Options</legend>
              <div style={fieldRow}>
                <span style={{ minWidth: 60 }}>Origin:</span>
                <Combo
                  value={origin}
                  options={ORIGIN_CHOICES}
                  onChange={setOrigin}
                  style={{ flex: 1 }}
                  ariaLabel="Origin"
                />
              </div>
              <div style={fieldRow}>
                <span style={{ minWidth: 60 }}>Units:</span>
                <Combo
                  value={units}
                  options={UNITS_CHOICES}
                  onChange={setUnits}
                  disabled={!excellonSelected}
                  style={{ flex: 1 }}
                  ariaLabel="Units"
                />
              </div>
              <div style={fieldRow}>
                <span style={{ minWidth: 60 }}>Zeros:</span>
                <Combo
                  value={zeros}
                  options={ZEROS_CHOICES}
                  onChange={setZeros}
                  disabled={!excellonSelected}
                  style={{ flex: 1 }}
                  ariaLabel="Zeros"
                />
              </div>
              <div style={{ ...fieldRow, opacity: precisionEnabled ? 1 : 0.5 }}>
                <span style={{ minWidth: 60 }}>Precision:</span>
                <span>{precisionStr}</span>
              </div>
            </fieldset>
          </div>

          <fieldset style={{ ...box, marginTop: 10 }}>
            <legend style={legend}>Messages</legend>
            <textarea
              readOnly
              value={messages.join('\n')}
              style={{
                width: '100%',
                minHeight: 90,
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: 12,
                background: 'var(--chrome-bg2)',
                color: 'var(--chrome-fg)',
                border: '1px solid var(--chrome-border)',
                borderRadius: 3,
                padding: 4,
                boxSizing: 'border-box',
              }}
            />
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <button
            type="button"
            className="ze-btn"
            style={{ marginRight: 'auto' }}
            onClick={generateReport}
          >
            Generate Report File...
          </button>
          <button type="button" className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="ze-btn primary" onClick={generate}>
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
