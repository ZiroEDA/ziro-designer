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
 * Excellon goes through EXCELLON_WRITER, Gerber X2 through GERBER_WRITER;
 * `onFileFormatSelection` enables each format's own options.
 *
 * Web delta: no local filesystem, so "Output folder:" browses the *project*'s
 * own folders (same popup as `dialog_plot.tsx`'s), and every generated file —
 * drill, map, report — goes through `onOutputFile` into the project's file
 * manager, falling back to a browser download when the board is standalone
 * (`plot-print-cloud-output` memory).
 */
import { Button, CheckBox } from '@ziroeda/common/wx/controls.js';
import { useState, type JSX } from 'react';
import type { BOARD } from '../board.js';
import { PCB_PLOT_PARAMS } from '../pcb_plot_params.js';
import { EXCELLON_WRITER } from '../exporters/gendrill_excellon_writer.js';
import { GERBER_WRITER } from '../exporters/gendrill_gerber_writer.js';
import { DRILL_PRECISION, ZEROS_FMT } from '../exporters/gendrill_writer_base.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';

interface Props {
  board: BOARD;
  /** The board's file name, which names the drill files. */
  fileName: string;
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
  fileName,
  projectFolders = [],
  onOutputFile,
  onClose,
}: Props): JSX.Element {
  const [initial] = useState(() => board.GetPlotOptions());
  const [outputDir, setOutputDir] = useState(() => initial.GetOutputDirectory());
  const [browseOpen, setBrowseOpen] = useState(false);
  const [origin, setOrigin] = useState(() => (initial.GetUseAuxOrigin() ? '1' : '0'));
  const [format, setFormat] = useState<'excellon' | 'gerberx2'>('excellon');
  const [generateTenting, setGenerateTenting] = useState(false);
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
  // onFileFormatSelection: Gerber's precision is the plot options' 4.6 or 4.5,
  // always enabled; Excellon's is updatePrecisionOptions'.
  const precisionEnabled = !excellonSelected || Number(zeros) !== ZEROS_FMT.DECIMAL_FORMAT;
  const precisionStr = !excellonSelected
    ? initial.GetGerberPrecision() === 6
      ? '4.6'
      : '4.5'
    : (units === '1' ? PRECISION_INCHES : PRECISION_METRIC).GetPrecisionString();

  const base = (fileName || 'board')
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
    const k = board;
    const opts = new PCB_PLOT_PARAMS();
    opts.assign(k.GetPlotOptions());
    opts.SetOutputDirectory(dir);
    opts.SetUseAuxOrigin(origin === '1');
    if (!opts.IsSameAs(k.GetPlotOptions())) k.SetPlotOptions(opts);
  };

  /** `DIALOG_GENDRILL::genDrillAndMapFiles`. */
  const generate = (): void => {
    const k = board;
    if (!k.GetFileName()) k.SetFileName(fileName || 'board.kicad_pcb');

    updateConfig();
    setMessages([]);

    const drillOffset = origin === '1' ? board.GetDesignSettings().GetAuxOrigin() : { x: 0, y: 0 };
    const precision = units === '1' ? PRECISION_INCHES : PRECISION_METRIC;

    if (excellonSelected) {
      const writer = new EXCELLON_WRITER(k);
      writer.SetFormat(units === '0', Number(zeros) as ZEROS_FMT, precision.m_Lhs, precision.m_Rhs);
      writer.SetOptions(mirror, minimal, drillOffset, mergePTHNPTH);
      writer.SetRouteModeForOvalHoles(!altDrillMode);
      writer.SetMapFileFormat(MAP_FORMATS[Number(mapFormat)]!);
      writer.SetPageInfo(k.GetPageSettings());
      writer.SetFileSink((name, bytes) => emitFile(name, bytes, 'text/plain'));

      writer.CreateDrillandMapFilesSet('', true, generateMap);
    } else {
      const writer = new GERBER_WRITER(k);
      // Set gerber precision: only 5 or 6 digits for mantissa are allowed
      // (SetFormat() accept 5 or 6, and any other value set the precision to 5)
      // the integer part precision is always 4, and units always mm
      writer.SetFormat(initial.GetGerberPrecision());
      writer.SetOptions(drillOffset);
      writer.SetMapFileFormat(MAP_FORMATS[Number(mapFormat)]!);
      writer.SetPageInfo(k.GetPageSettings());
      writer.SetFileSink((name, bytes) => emitFile(name, bytes, 'text/plain'));

      writer.CreateDrillandMapFilesSet('', true, generateMap, generateTenting);
    }
    appendMsg('Done.');
  };

  /** `DIALOG_GENDRILL::onGenReportFile`. */
  const generateReport = (): void => {
    const k = board;
    if (!k.GetFileName()) k.SetFileName(fileName || 'board.kicad_pcb');

    updateConfig();
    setMessages([]);

    const name = `${base}-drl.rpt`;
    // Info is slightly different between Excellon and Gerber
    // (file ext, Merge PTH/NPTH option)
    // As upstream: `m_rbExcellon->GetValue() == 0` picks EXCELLON_WRITER when
    // Gerber X2 is the selected format, and GERBER_WRITER for Excellon.
    let writer: EXCELLON_WRITER | GERBER_WRITER;

    if (!excellonSelected) {
      const excellonWriter = new EXCELLON_WRITER(k);
      excellonWriter.SetMergeOption(mergePTHNPTH);
      writer = excellonWriter;
    } else {
      writer = new GERBER_WRITER(k);
    }

    writer.SetFileSink((_path, bytes) => {
      const path = dir ? `${dir}/${name}` : name;
      if (onOutputFile) onOutputFile(path, bytes, 'text/plain');
      else download(name, bytes);
      appendMsg(`Report file '${path}' created.`);
    });

    if (!writer.GenDrillReportFile(name)) appendMsg(`Failed to create file '${name}'.`);
  };

  return (
    <DialogShim title="Generate Drill Files" onClose={onClose}>
      <div className="ze-modal-body" style={{ display: 'block', overflow: 'auto' }}>
        <div className="ze-gendrill-upper" onMouseDown={() => setBrowseOpen(false)}>
          <span>Output folder:</span>
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
              <div className="ze-folder-browse-popup" onMouseDown={(e) => e.stopPropagation()}>
                {[
                  '',
                  ...[...new Set(projectFolders.filter(Boolean))].sort((a, b) =>
                    a.localeCompare(b),
                  ),
                ].map((f) => (
                  <div
                    key={f || '.'}
                    className="ze-menu-item ze-folder-browse-item"
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

        <div className="ze-gendrill-columns" style={{ display: 'flex', alignItems: 'flex-start' }}>
          {/* bLeftCol: "Format" is a wxStaticText + wxStaticLine, not a box. */}
          <div className="ze-gendrill-col" style={{ flex: 1 }}>
            <div className="ze-gendrill-headline">Format</div>
            <hr className="ze-gendrill-rule" />
            <label className="ze-check">
              <input
                type="radio"
                name="ze-gendrill-fmt"
                checked={excellonSelected}
                onChange={() => setFormat('excellon')}
              />
              Excellon
            </label>
            <div className="ze-gendrill-suboptions">
              <CheckBox
                label="Mirror Y axis"
                checked={mirror}
                disabled={!excellonSelected}
                title={'Not recommended.\nUsed mostly by users who make the boards themselves.'}
                onChange={(aChecked) => setMirror(aChecked)}
              />
              <CheckBox
                label="Minimal header"
                checked={minimal}
                disabled={!excellonSelected}
                title={
                  'Not recommended.\nOnly use it for board houses which do not accept fully featured headers.'
                }
                onChange={(aChecked) => setMinimal(aChecked)}
              />
              <CheckBox
                label="PTH and NPTH in single file"
                checked={mergePTHNPTH}
                disabled={!excellonSelected}
                title={
                  'Not recommended.\nOnly use for board houses which ask for merged PTH and NPTH into a single file.'
                }
                onChange={(aChecked) => setMergePTHNPTH(aChecked)}
              />
              <CheckBox
                label="Use alternate drill mode for oval holes"
                checked={altDrillMode}
                disabled={!excellonSelected}
                onChange={(aChecked) => setAltDrillMode(aChecked)}
              />
            </div>
            <label className="ze-check">
              <input
                type="radio"
                name="ze-gendrill-fmt"
                checked={!excellonSelected}
                onChange={() => setFormat('gerberx2')}
              />
              Gerber X2
            </label>
            <div className="ze-gendrill-suboptions">
              <CheckBox
                label="Generate tenting layers"
                checked={generateTenting}
                disabled={excellonSelected}
                onChange={(aChecked) => setGenerateTenting(aChecked)}
              />
            </div>
            <div className="ze-gendrill-genmap">
              <CheckBox
                label="Generate map:"
                checked={generateMap}
                onChange={(aChecked) => setGenerateMap(aChecked)}
              />
              <Combo
                value={mapFormat}
                options={MAP_CHOICES}
                onChange={setMapFormat}
                disabled={!generateMap}
                ariaLabel="Generate map format"
              />
            </div>
          </div>

          {/* bRightCol: "Options" is a wxStaticText + wxStaticLine too. */}
          <div className="ze-gendrill-col" style={{ flex: '0 0 240px' }}>
            <div className="ze-gendrill-headline">Options</div>
            <hr className="ze-gendrill-rule" />
            <div className="ze-gendrill-optrow">
              <span className="ze-gendrill-optlabel">Origin:</span>
              <Combo
                value={origin}
                options={ORIGIN_CHOICES}
                onChange={setOrigin}
                style={{ flex: 1 }}
                ariaLabel="Origin"
              />
            </div>
            <div className="ze-gendrill-optrow">
              <span className="ze-gendrill-optlabel">Units:</span>
              <Combo
                value={units}
                options={UNITS_CHOICES}
                onChange={setUnits}
                disabled={!excellonSelected}
                style={{ flex: 1 }}
                ariaLabel="Units"
              />
            </div>
            <div className="ze-gendrill-optrow">
              <span className="ze-gendrill-optlabel">Zeros:</span>
              <Combo
                value={zeros}
                options={ZEROS_CHOICES}
                onChange={setZeros}
                disabled={!excellonSelected}
                style={{ flex: 1 }}
                ariaLabel="Zeros"
              />
            </div>
            <div className="ze-gendrill-optrow" style={{ opacity: precisionEnabled ? 1 : 0.5 }}>
              <span className="ze-gendrill-optlabel">Precision:</span>
              <span>{precisionStr}</span>
            </div>
          </div>
        </div>

        <fieldset className="ze-sbox ze-gendrill-messages">
          <legend>Messages</legend>
          <textarea readOnly value={messages.join('\n')} />
        </fieldset>
      </div>

      <div className="ze-modal-footer">
        <Button
          label="Generate Report File..."
          className="ze-gendrill-report-btn"
          onClick={generateReport}
        />
        <Button label="Close" onClick={onClose} />
        <Button label="Generate" isDefault onClick={generate} />
      </div>
    </DialogShim>
  );
}
