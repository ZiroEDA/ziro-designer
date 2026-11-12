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
 * drill, map, report — goes through `onOutputFile`, which downloads it (a run of several files as one zip, designer output_downloads.ts).
 */
import { useState, type JSX } from 'react';
import type { BOARD } from '../board.js';
import { PCB_PLOT_PARAMS } from '../pcb_plot_params.js';
import { EXCELLON_WRITER } from '../exporters/gendrill_excellon_writer.js';
import { GERBER_WRITER } from '../exporters/gendrill_gerber_writer.js';
import { DRILL_PRECISION, ZEROS_FMT } from '../exporters/gendrill_writer_base.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { DIALOG_GENDRILL_BASE } from './dialog_gendrill_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

interface Props {
  board: BOARD;
  /** The board's file name, which names the drill files. */
  fileName: string;
  /** Write a generated file into the project (path relative to the project
   *  folder). Absent when the board is open standalone, then files download. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  onClose: () => void;
}

/** `precisionListForInches` / `precisionListForMetric` (`dialog_gendrill.cpp:54-55`) —
 *  KiCad's own two constants, not invented here. */
const PRECISION_INCHES = new DRILL_PRECISION(2, 4);
const PRECISION_METRIC = new DRILL_PRECISION(3, 3);

/** `m_choiceDrillMap`'s order, and `genDrillAndMapFiles`'s `filefmt[]` beside it. */
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

export function DialogGendrill({ board, fileName, onOutputFile, onClose }: Props): JSX.Element {
  const [initial] = useState(() => board.GetPlotOptions());
  const [outputDir, setOutputDir] = useState(() => initial.GetOutputDirectory());
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
    appendMsg(wxFormat(_("Created file '%s'."), path));
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
    appendMsg(_('Done.'));
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
      appendMsg(wxFormat(_("Report file '%s' created."), path));
    });

    if (!writer.GenDrillReportFile(name))
      appendMsg(wxFormat(_("Failed to create file '%s'."), name));
  };

  const check = (aValue: boolean, aSet: (aOn: boolean) => void, aEnabled = true) => ({
    value: aValue,
    enabled: aEnabled,
    onChange: aSet,
  });
  const choice = (aValue: string, aSet: (aValue: string) => void, aEnabled = true) => ({
    value: Number(aValue),
    enabled: aEnabled,
    onChange: (aIndex: number) => aSet(String(aIndex)),
  });

  return (
    <>
      <DIALOG_GENDRILL_BASE
        m_outputDirectoryName={outputDir}
        onOutputDirectoryName={setOutputDir}
        excellon={excellonSelected}
        onFileFormatSelection={(aExcellon) => setFormat(aExcellon ? 'excellon' : 'gerberx2')}
        m_Check_Mirror={check(mirror, setMirror, excellonSelected)}
        m_Check_Minimal={check(minimal, setMinimal, excellonSelected)}
        m_Check_Merge_PTH_NPTH={check(mergePTHNPTH, setMergePTHNPTH, excellonSelected)}
        m_altDrillMode={check(altDrillMode, setAltDrillMode, excellonSelected)}
        m_generateTentingLayers={check(generateTenting, setGenerateTenting, !excellonSelected)}
        m_cbGenerateMap={check(generateMap, setGenerateMap)}
        m_choiceDrillMap={choice(mapFormat, setMapFormat, generateMap)}
        m_origin={choice(origin, setOrigin)}
        m_units={choice(units, setUnits, excellonSelected)}
        m_zeros={choice(zeros, setZeros, excellonSelected)}
        precision={precisionStr}
        precisionEnabled={precisionEnabled}
        messages={messages.join('\n')}
        onGenReportFile={generateReport}
        onGenerate={generate}
        onCancel={onClose}
      />
    </>
  );
}
