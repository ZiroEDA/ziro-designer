// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GEN_FOOTPRINT_POSITION (`dialog_gen_footprint_position_file_base.cpp`
 * + `dialog_gen_footprint_position.cpp`), File > Fabrication Outputs >
 * Component Placement (.pos, .gbr)....
 *
 * Sizer tree, read whole (`port-the-sizer-tree-whole`):
 *
 *     m_MainSizer (V)
 *       fgSizerTop (2-col flex grid): Design variant: / m_variantChoiceCtrl,
 *         Output directory: / (m_outputDirectoryName flex 1, browse button)
 *       bSizerMiddle (H): fgSizer1 (2-col: Format: / Units:) + a spacer
 *       bSizerLower (V): Include only SMD / Exclude TH / Exclude DNP /
 *         Exclude BOM / Include board edge layer / Use drill/place file
 *         origin / Use negative X on bottom / Generate single file,
 *         then m_messagesPanel (WX_HTML_REPORT_PANEL, proportion 1)
 *       m_sdbSizer, relabelled "Generate Position File" / "Close"
 *
 * 10.0.6 delta from 10.0.5 (`git -C kicad-reference diff 10.0.5 10.0.6 --
 * pcbnew/dialogs/dialog_gen_footprint_position.cpp`): the four filter
 * checkboxes' enable state now runs through `JOB_EXPORT_PCB_POS::
 * FormatSupportsFilter`, which for Gerber leaves Exclude DNP / Exclude BOM
 * enabled (only SMD-only and Exclude TH are Gerber-incompatible, because
 * Gerber X3 records mount type itself) — 10.0.5 disabled all four. The
 * onUpdateUI* handlers are the `*Enabled` values below; `updateOptionCheckbox`
 * also clears a checkbox its format does not support.
 *
 * `place_file_exporter.ts` is a pure function over the POJO `Board`, not a
 * variant-aware live model: `FOOTPRINT`'s `Get{ExcludedFromPosFiles,
 * ExcludedFromBOM,DNP}ForVariant` exist (`pcbnew/footprint.ts`), but nothing
 * in the exporter reads them. The Design variant selector is therefore drawn
 * from the board's real variant names (`BOARD::GetVariantNamesForUI`, itself
 * genuinely implemented) but greyed rather than wired — selecting a variant
 * an exporter that ignores it would generate a file mislabelled with a
 * variant it did not actually filter for, which is worse than not offering
 * the control. A future pass that threads a variant name through
 * `genPositionData` closes this.
 *
 * Web delta, matching `dialog_gendrill.tsx`: "Output directory:" browses the
 * project's own folders, and every generated file goes through
 * `onOutputFile`, which downloads it (a run of several files as one zip, designer output_downloads.ts).
 */
import { useState, type JSX } from 'react';
import type { BOARD } from '../board.js';
import { PLACE_FILE_EXPORTER, placeFileName } from '../exporters/place_file_exporter.js';
import { PLACEFILE_GERBER_WRITER } from '../exporters/gerber_placefile_writer.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  JOB_EXPORT_PCB_POS,
  type JOB_EXPORT_PCB_POS_FILTER,
  type JOB_EXPORT_PCB_POS_FORMAT,
} from '@ziroeda/common/jobs/job_export_pcb_pos.js';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type ReportLine,
} from '@ziroeda/common';
import { RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { DIALOG_GEN_FOOTPRINT_POSITION_BASE } from './dialog_gen_footprint_position_file_base.js';
import { _ } from '@ziroeda/wx/translation.js';

interface Props {
  board: BOARD;
  /** The board's file name, which names the position files. */
  fileName: string;
  /** Write a generated file into the project (path relative to the project
   *  folder). Absent when the board is open standalone, then files download. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  onClose: () => void;
}

/** `m_formatCtrl`'s order: JOB_EXPORT_PCB_POS::FORMAT. */

const download = (name: string, bytes: Uint8Array): void => {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

export function DialogGenFootprintPosition({
  board,
  fileName,
  onOutputFile,
  onClose,
}: Props): JSX.Element {
  const variantNames = board.GetVariantNamesForUI();
  const [variant] = useState(0); // greyed: see the file comment.
  const [outputDir, setOutputDir] = useState('');
  const [format, setFormat] = useState('0');
  const [units, setUnits] = useState('1');
  const [onlySMD, setOnlySMD] = useState(false);
  const [excludeTH, setExcludeTH] = useState(false);
  const [excludeDNP, setExcludeDNP] = useState(false);
  const [excludeBOM, setExcludeBOM] = useState(false);
  const [includeBoardEdge, setIncludeBoardEdge] = useState(false);
  const [useDrillPlaceOrigin, setUseDrillPlaceOrigin] = useState(true);
  const [negateX, setNegateX] = useState(false);
  const [singleFile, setSingleFile] = useState(true);

  // selectedFormat() and the onUpdateUI* handlers.
  const selectedFormat = Number(format) as JOB_EXPORT_PCB_POS_FORMAT;
  const isGerber = selectedFormat === JOB_EXPORT_PCB_POS.FORMAT.GERBER;
  const supports = (aFilter: JOB_EXPORT_PCB_POS_FILTER): boolean =>
    JOB_EXPORT_PCB_POS.FormatSupportsFilter(selectedFormat, aFilter);
  const onlySMDEnabled = supports(JOB_EXPORT_PCB_POS.FILTER.SMD_ONLY);
  const excludeTHEnabled = supports(JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_TH);
  const excludeDNPEnabled = supports(JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_DNP);
  const excludeBOMEnabled = supports(JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_BOM);
  const negateXEnabled = !isGerber;

  /**
   * `m_formatCtrl`'s change: the next onUpdateUI pass, where
   * `updateOptionCheckbox` clears every checkbox the format does not support.
   */
  const changeFormat = (aFormat: string): void => {
    setFormat(aFormat);
    const fmt = Number(aFormat) as JOB_EXPORT_PCB_POS_FORMAT;

    if (!JOB_EXPORT_PCB_POS.FormatSupportsFilter(fmt, JOB_EXPORT_PCB_POS.FILTER.SMD_ONLY))
      setOnlySMD(false);

    if (!JOB_EXPORT_PCB_POS.FormatSupportsFilter(fmt, JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_TH))
      setExcludeTH(false);

    if (!JOB_EXPORT_PCB_POS.FormatSupportsFilter(fmt, JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_DNP))
      setExcludeDNP(false);

    if (!JOB_EXPORT_PCB_POS.FormatSupportsFilter(fmt, JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_BOM))
      setExcludeBOM(false);

    if (fmt === JOB_EXPORT_PCB_POS.FORMAT.GERBER) setNegateX(false);
  };

  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);
  const report = (message: string, severity: number): void =>
    setMessages((m) => [...m, { message, severity, location: 'body' as const }]);

  const base = (fileName || 'board')
    .replace(/\.kicad_pcb$/i, '')
    .split('/')
    .pop()!;
  const dir = outputDir
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');

  const emitBytes = (name: string, bytes: Uint8Array, mime: string): void => {
    const path = dir ? `${dir}/${name}` : name;
    if (onOutputFile) onOutputFile(path, bytes, mime);
    else download(name, bytes);
  };

  const emit = (name: string, text: string, mime: string): void =>
    emitBytes(name, new TextEncoder().encode(text), mime);

  /**
   * `DIALOG_GEN_FOOTPRINT_POSITION::CreateGerberFiles`: the front and the
   * back placement files, always separate, every footprint of each side.
   */
  const createGerberFiles = (): void => {
    setMessages([]);

    // Create the Front and Top side placement files. Gerber P&P files are always separated.
    // Not also they include all footprints
    const exporter = new PLACEFILE_GERBER_WRITER(board);

    // The variant selector is greyed (see the file comment): the default variant.
    exporter.SetVariant('');

    const written = new Map<string, Uint8Array>();
    exporter.SetFileSink((aPath, aBytes) => written.set(aPath, aBytes));

    const shown = (aName: string): string => (dir ? `${dir}/${aName}` : aName);

    let filename = exporter.GetPlaceFileName(`${base}.kicad_pcb`, PCB_LAYER_ID.F_Cu);

    let fpcount = exporter.CreatePlaceFile(
      filename,
      PCB_LAYER_ID.F_Cu,
      includeBoardEdge,
      excludeDNP,
      excludeBOM,
    );

    if (fpcount < 0) {
      // As upstream: the front's message names the board path, not the file.
      report(`Failed to create file '${shown(`${base}.kicad_pcb`)}'.`, RPT_SEVERITY_ERROR);
      return;
    }

    emitBytes(filename, written.get(filename)!, 'application/vnd.gerber');

    report(`Front (top side) placement file: '${shown(filename)}'.`, RPT_SEVERITY_ACTION);

    report(`Component count: ${fpcount}.`, RPT_SEVERITY_INFO);

    // Create the Back or Bottom side placement file
    let fullcount = fpcount;

    filename = exporter.GetPlaceFileName(`${base}.kicad_pcb`, PCB_LAYER_ID.B_Cu);

    fpcount = exporter.CreatePlaceFile(
      filename,
      PCB_LAYER_ID.B_Cu,
      includeBoardEdge,
      excludeDNP,
      excludeBOM,
    );

    if (fpcount < 0) {
      report(`Failed to create file '${shown(filename)}'.`, RPT_SEVERITY_ERROR);
      return;
    }

    emitBytes(filename, written.get(filename)!, 'application/vnd.gerber');

    // Display results
    report(`Back (bottom side) placement file: '${shown(filename)}'.`, RPT_SEVERITY_ACTION);

    report(`Component count: ${fpcount}.`, RPT_SEVERITY_INFO);

    fullcount += fpcount;
    report(`Full component count: ${fullcount}.`, RPT_SEVERITY_INFO);

    report(_('Done.'), RPT_SEVERITY_INFO);
  };

  /** `DIALOG_GEN_FOOTPRINT_POSITION::onGenerate`. */
  const generate = (): void => {
    if (isGerber) createGerberFiles();
    else createAsciiFiles();
  };

  /** `DIALOG_GEN_FOOTPRINT_POSITION::CreateAsciiFiles`. */
  const createAsciiFiles = (): void => {
    const useCSVfmt = format === '1';
    // PLACE_FILE_EXPORTER( board, unitsMM, onlySMD, noTH, excludeDNP,
    // excludeBOM, top, bottom, formatCSV, useAuxOrigin, negateBottomX ).
    const exporter = (aTop: boolean, aBottom: boolean): PLACE_FILE_EXPORTER =>
      new PLACE_FILE_EXPORTER(
        board,
        units === '1',
        onlySMD,
        excludeTH,
        excludeDNP,
        excludeBOM,
        aTop,
        aBottom,
        useCSVfmt,
        useDrillPlaceOrigin,
        negateX,
      );

    // The whole-board test `CreateAsciiFiles` runs before touching the
    // filesystem: bail with the same message if nothing survives the filters.
    const test = exporter(true, true);
    test.GenPositionData();
    if (test.GetFootprintCount() === 0) {
      report(_('No footprint for automated placement.'), RPT_SEVERITY_WARNING);
      return;
    }

    setMessages([]);

    const topSide = true;
    const bottomSide = singleFile;
    const name1 = placeFileName(base, topSide, bottomSide, useCSVfmt);
    const first = exporter(topSide, bottomSide);
    emit(name1, first.GenPositionData(), useCSVfmt ? 'text/csv' : 'text/plain');

    report(
      `${singleFile ? _('Placement') : 'Front (top side) placement'} file: '${dir ? `${dir}/` : ''}${name1}'.`,
      RPT_SEVERITY_ACTION,
    );
    report(`Component count: ${first.GetFootprintCount()}.`, RPT_SEVERITY_INFO);

    if (singleFile) {
      report(_('Done.'), RPT_SEVERITY_INFO);
      return;
    }

    const name2 = placeFileName(base, false, true, useCSVfmt);
    const second = exporter(false, true);
    emit(name2, second.GenPositionData(), useCSVfmt ? 'text/csv' : 'text/plain');

    report(
      `Back (bottom side) placement file: '${dir ? `${dir}/` : ''}${name2}'.`,
      RPT_SEVERITY_ACTION,
    );
    report(`Component count: ${second.GetFootprintCount()}.`, RPT_SEVERITY_INFO);
    report(
      `Full component count: ${first.GetFootprintCount() + second.GetFootprintCount()}.`,
      RPT_SEVERITY_INFO,
    );
    report(_('Done.'), RPT_SEVERITY_INFO);
  };

  const check = (aValue: boolean, aSet: (aOn: boolean) => void, aEnabled = true) => ({
    value: aValue,
    enabled: aEnabled,
    onChange: aSet,
  });

  return (
    <>
      <DIALOG_GEN_FOOTPRINT_POSITION_BASE
        variants={variantNames}
        m_variantChoiceCtrl={variant}
        onVariant={() => {}}
        variantEnabled={false}
        variantTip="Not wired: place_file_exporter.ts does not filter by variant yet."
        m_outputDirectoryName={outputDir}
        onOutputDirectoryName={setOutputDir}
        m_formatCtrl={Number(format)}
        onFormat={(aIndex) => changeFormat(String(aIndex))}
        m_unitsCtrl={Number(units)}
        onUnits={(aIndex) => setUnits(String(aIndex))}
        unitsEnabled={!isGerber}
        m_onlySMD={check(onlySMD, setOnlySMD, onlySMDEnabled)}
        m_excludeTH={check(excludeTH, setExcludeTH, excludeTHEnabled)}
        m_excludeDNP={check(excludeDNP, setExcludeDNP, excludeDNPEnabled)}
        m_excludeBOM={check(excludeBOM, setExcludeBOM, excludeBOMEnabled)}
        m_cbIncludeBoardEdge={check(includeBoardEdge, setIncludeBoardEdge, isGerber)}
        m_useDrillPlaceOrigin={check(useDrillPlaceOrigin, setUseDrillPlaceOrigin)}
        m_negateXcb={check(negateX, setNegateX, negateXEnabled)}
        m_singleFile={check(singleFile, setSingleFile, !isGerber)}
        messages={messages}
        visibleSeverities={severities}
        onVisibleSeveritiesChange={setSeverities}
        onGenerate={generate}
        onCancel={onClose}
      />
    </>
  );
}
