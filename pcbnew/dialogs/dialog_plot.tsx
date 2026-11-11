// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PLOT` (dialog_plot.cpp): File > Plot.... The window is DIALOG_PLOT_BASE
 * (dialog_plot_base.tsx); this is the behaviour - TransferDataToWindow from the board's plot
 * settings, SetPlotFormat's enables and option groups, applyPlotSettings back onto the board,
 * Plot through PCB_PLOTTER, the two layer lists and their right-click menus, the solder mask
 * alert and the DRC count. The constructor's "Plot on All Layers" box is built here and handed
 * to the base for bmiddleSizer's position 1, as upstream inserts it.
 *
 * The output directory is a folder inside the project: every plot lands in the project's file
 * manager (or downloads, for a board opened standalone). Browse is wxDirDialog over the project's
 * folders, so the relative-path question upstream asks after it does not arise.
 */
import { useState, type JSX, type MouseEvent } from 'react';
import { zlibSync } from 'fflate';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { DEFAULT_THEME, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { DXF_UNITS, PLOT_FORMAT, PLOT_TEXT_MODE } from '@ziroeda/common/plotters/plotter.js';
import { LAST_PATH_TYPE } from '@ziroeda/common/project/project_file.js';
import {
  Reporter,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type ReportLine,
} from '@ziroeda/common/reporter.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { CheckListBox, moveCurrent } from '@ziroeda/wx/checklst.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import type { MenuItem } from '@ziroeda/wx/menu.js';
import { ContextMenu } from '@ziroeda/wx/menu_ui.js';
import { BoxSizer, SizerItem, StaticBoxSizer } from '@ziroeda/wx/sizer.js';
import type { BOARD } from '../board.js';
import { type DRILL_MARKS, PCB_PLOT_PARAMS } from '../pcb_plot_params.js';
import { PCB_PLOTTER } from '../pcb_plotter.js';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '../pcb_unit_binder.js';
import { PLOT_MAX_SCALE, PLOT_MIN_SCALE } from '../pcbplot.js';
import { DIALOG_PLOT_BASE } from './dialog_plot_base.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';

interface Props {
  board: BOARD;
  /** The board's file name, which names the plot files. */
  fileName: string;
  /** The frame's display units: `m_trackWidthCorrection` is a UNIT_BINDER on the edit frame. */
  units: StatusUnits;
  /** Folders that already exist in the project (wxDirDialog's choices). */
  /** Write a generated file into the project (path relative to the project folder). Absent when
   *  the board is open standalone, then plots download. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  /** `onRunDRC`: the DRC dialog. */
  onRunDrc?: () => void;
  /** `CreateDrillFile`: DIALOG_GENDRILL, resolved when it closes. */
  onCreateDrillFile?: () => Promise<void>;
  /** `onBoardSetup`: `ShowBoardSetupDialog( _( "Solder Mask/Paste" ) )`. */
  onBoardSetup?: (aPage: string) => void;
  /** `ZONE_FILLER_TOOL::CheckAllZones`, before plotting. */
  onCheckZones?: () => Promise<void>;
  /** `onOpenOutputDirectory`: the project folder in the file manager. */
  onOpenOutputDirectory?: (aFolder: string) => void;
  onClose: () => void;
}

/** `getPlotFormat`'s table, in m_plotFormatOpt's order, and each format's MIME type. */
const FORMATS: readonly { format: PLOT_FORMAT; mime: string }[] = [
  { format: PLOT_FORMAT.GERBER, mime: 'application/vnd.gerber' },
  { format: PLOT_FORMAT.POST, mime: 'application/postscript' },
  { format: PLOT_FORMAT.SVG, mime: 'image/svg+xml' },
  { format: PLOT_FORMAT.DXF, mime: 'image/vnd.dxf' },
  { format: PLOT_FORMAT.PDF, mime: 'application/pdf' },
];

/** `s_lastAllLayersOrder`: the Plot on All Layers order, kept between showings of the dialog. */
let s_lastAllLayersOrder: PCB_LAYER_ID[] = [];

const download = (name: string, data: Uint8Array): void => {
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

/** `setDouble` / `setInt`: clip into [min, max]; false when clipped. */
const clip = (aValue: number, aMin: number, aMax: number): [number, boolean] =>
  aValue < aMin ? [aMin, false] : aValue > aMax ? [aMax, false] : [aValue, true];

export function DialogPcbPlot({
  board,
  fileName,
  units,
  onOutputFile,
  onRunDrc,
  onCreateDrillFile,
  onBoardSetup,
  onCheckZones,
  onOpenOutputDirectory,
  onClose,
}: Props): JSX.Element {
  const project = board.GetProject()?.GetProjectFile() ?? null;
  const bds = board.GetDesignSettings();

  // m_plotOpts = m_editFrame->GetPlotSettings(), and the last plot path.
  const [opts] = useState(() => {
    const o = new PCB_PLOT_PARAMS();
    o.assign(board.GetPlotOptions());
    const last = project?.m_PcbLastPath[LAST_PATH_TYPE.LAST_PATH_PLOT] ?? '';
    if (last) o.SetOutputDirectory(last);
    return o;
  });

  // m_layerList = board->GetEnabledLayers().UIOrder().
  const [layerList] = useState(() => board.GetEnabledLayers().UIOrder());
  const [layerChecked, setLayerChecked] = useState(() =>
    layerList.map((l) => opts.GetLayerSelection().test(l)),
  );

  // The constructor's m_plotAllLayersList: stackup order, checked when in the saved sequence,
  // then arrangeAllLayersList( s_lastAllLayersOrder ).
  const [allLayers, setAllLayers] = useState(() => {
    const seq = opts.GetPlotOnAllLayersSequence();
    let order = board
      .GetEnabledLayers()
      .SeqStackupForPlotting()
      .map((l) => ({ layer: l, checked: seq.includes(l) }));
    let idx = 0;

    for (const layer of s_lastAllLayersOrder) {
      let cur = order.findIndex((o) => o.layer === layer);

      while (cur > idx) {
        order = moveCurrent(order, cur, -1);
        cur--;
      }

      idx++;
    }

    return order;
  });
  const [allSel, setAllSel] = useState(-1);

  const variants = board.GetVariantNamesForUI();
  const [variant, setVariant] = useState(() =>
    Math.max(0, variants.indexOf(board.GetCurrentVariant())),
  );

  const [format, setFormat] = useState(() =>
    Math.max(
      0,
      FORMATS.findIndex((f) => f.format === opts.GetFormat()),
    ),
  );
  const plotFormat = FORMATS[format]!.format;
  const [outputDir, setOutputDir] = useState(() => opts.GetOutputDirectory());
  const [plotSheet, setPlotSheet] = useState(() => opts.GetPlotFrameRef());
  const [subtractMask, setSubtractMask] = useState(() => opts.GetSubtractMaskFromSilk());
  const [plotDNP, setPlotDNP] = useState(
    () =>
      opts.GetHideDNPFPsOnFabLayers() ||
      opts.GetSketchDNPFPsOnFabLayers() ||
      opts.GetCrossoutDNPFPsOnFabLayers(),
  );
  // m_hideDNP is the group's first radio, so it is the one set when neither was saved.
  const [hideDNP, setHideDNP] = useState(
    () => opts.GetHideDNPFPsOnFabLayers() || !opts.GetCrossoutDNPFPsOnFabLayers(),
  );
  const [sketchPads, setSketchPads] = useState(() => opts.GetSketchPadsOnFabLayers());
  const [padNumbers, setPadNumbers] = useState(() => opts.GetPlotPadNumbers());
  const [zoneFillCheck, setZoneFillCheck] = useState(true);
  const [drillShape, setDrillShape] = useState(() => opts.GetDrillMarksType() as number);
  const [scale, setScale] = useState(() => opts.GetScaleSelection());
  const [useAuxOrigin, setUseAuxOrigin] = useState(() => opts.GetUseAuxOrigin());
  const [mirror, setMirror] = useState(() => opts.GetMirror());
  const [negative, setNegative] = useState(() => opts.GetNegative());
  const [protel, setProtel] = useState(() => opts.GetUseGerberProtelExtensions());
  const [jobFile, setJobFile] = useState(() => opts.GetCreateGerberJobFile());
  const [coordFormat, setCoordFormat] = useState(() => (opts.GetGerberPrecision() === 5 ? 0 : 1));
  const [useX2, setUseX2] = useState(() => opts.GetUseGerberX2format());
  const [netAttributes, setNetAttributes] = useState(() => opts.GetIncludeGerberNetlistInfo());
  const [disableMacros, setDisableMacros] = useState(() => opts.GetDisableGerberMacros());
  const [fineX, setFineX] = useState(() => String(opts.GetFineScaleAdjustX()));
  const [fineY, setFineY] = useState(() => String(opts.GetFineScaleAdjustY()));
  const [widthAdjust, setWidthAdjust] = useState(() =>
    pcbUnitTextMM(pcbIUScale.iuToMM(opts.GetWidthAdjust()), units),
  );
  const [forceA4, setForceA4] = useState(() => opts.GetA4Output());
  const [dxfContours, setDxfContours] = useState(() => opts.GetDXFPlotPolygonMode());
  const [dxfUnits, setDxfUnits] = useState(() =>
    opts.GetDXFPlotUnits() === DXF_UNITS.INCH ? 0 : 1,
  );
  const [dxfStrokeFont, setDxfStrokeFont] = useState(
    () => opts.GetTextMode() === PLOT_TEXT_MODE.DEFAULT,
  );
  const [dxfSingle, setDxfSingle] = useState(() => opts.GetDXFMultiLayeredExportOption());
  const [svgPrecision, setSvgPrecision] = useState(() => opts.GetSvgPrecision());
  const [svgColor, setSvgColor] = useState(() => (opts.GetBlackAndWhite() ? 1 : 0));
  const [svgFit, setSvgFit] = useState(() => opts.GetSvgFitPagetoBoard());
  const [pdfColor, setPdfColor] = useState(() => (opts.GetBlackAndWhite() ? 1 : 0));
  const [pdfFront, setPdfFront] = useState(() => opts.m_PDFFrontFPPropertyPopups);
  const [pdfBack, setPdfBack] = useState(() => opts.m_PDFBackFPPropertyPopups);
  const [pdfMetadata, setPdfMetadata] = useState(() => opts.m_PDFMetadata);
  const [pdfSingle, setPdfSingle] = useState(() => opts.m_PDFSingle);
  const [pdfBackground, setPdfBackground] = useState<Color4d>(
    () => opts.m_PDFBackgroundColor ?? COLOR4D_UNSPECIFIED,
  );

  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  // reInitDialog runs again after the drill, DRC and Board Setup dialogs.
  const [, setTick] = useState(0);
  const reInit = (): void => {
    setOutputDir(board.GetPlotOptions().GetOutputDirectory());
    setUseAuxOrigin(board.GetPlotOptions().GetUseAuxOrigin());
    setTick((t) => t + 1);
  };

  // reInitDialog: the DRC count.
  let knownViolations = 0;
  let exclusions = 0;

  for (const marker of board.Markers()) {
    if (marker.GetSeverity() === RPT_SEVERITY_EXCLUSION) exclusions++;
    else knownViolations++;
  }

  const drcWarning =
    knownViolations || exclusions
      ? `(${knownViolations} known DRC violations; ${exclusions} exclusions)`
      : null;

  // SetPlotFormat / reInitDialog: the solder mask alert, Gerber only.
  const solderMaskAlert =
    plotFormat === PLOT_FORMAT.GERBER && !!(bds.m_SolderMaskExpansion || bds.m_SolderMaskMinWidth);

  // SetPlotFormat's enables, per format.
  const isGerber = plotFormat === PLOT_FORMAT.GERBER;
  const isPS = plotFormat === PLOT_FORMAT.POST;
  const isDXF = plotFormat === PLOT_FORMAT.DXF;
  const isSVG = plotFormat === PLOT_FORMAT.SVG;
  const isPDF = plotFormat === PLOT_FORMAT.PDF;
  // OnChangeDXFPlotMode: the stroke-font option is for centre-line DXF only.
  const strokeFontEnabled = !dxfContours;

  /** `SetPlotFormat`: the values a format forces where it disables a control. */
  const changeFormat = (aIndex: number): void => {
    setFormat(aIndex);
    const f = FORMATS[aIndex]!.format;

    if (f === PLOT_FORMAT.GERBER) {
      setDrillShape(0);
      setMirror(false);
      setScale(1);
      setNegative(false);
      setForceA4(false);
    } else if (f === PLOT_FORMAT.POST) {
      setUseAuxOrigin(false);
    } else if (f === PLOT_FORMAT.DXF) {
      setMirror(false);
      setNegative(false);
      setForceA4(false);

      if (dxfContours) setDxfStrokeFont(true);
    } else {
      setForceA4(false);
    }
  };

  /** `applyPlotSettings`: the window onto a PCB_PLOT_PARAMS, then onto the board if it changed. */
  const applyPlotSettings = (
    aReporter: Reporter,
  ): { params: PCB_PLOT_PARAMS; xAdj: number; yAdj: number; wAdj: number } => {
    const temp = new PCB_PLOT_PARAMS();

    temp.SetDashedLineDashRatio(opts.GetDashedLineDashRatio());
    temp.SetDashedLineGapRatio(opts.GetDashedLineGapRatio());
    temp.SetSubtractMaskFromSilk(subtractMask);
    temp.SetPlotFrameRef(plotSheet);
    temp.SetSketchPadsOnFabLayers(sketchPads);
    temp.SetPlotPadNumbers(padNumbers);
    temp.SetHideDNPFPsOnFabLayers(plotDNP && hideDNP);
    temp.SetSketchDNPFPsOnFabLayers(plotDNP && !hideDNP);
    temp.SetCrossoutDNPFPsOnFabLayers(plotDNP && !hideDNP);
    temp.SetUseAuxOrigin(useAuxOrigin);
    temp.SetScaleSelection(scale);
    temp.SetDrillMarksType(drillShape as DRILL_MARKS);
    temp.SetMirror(mirror);
    temp.SetDXFPlotPolygonMode(dxfContours);
    temp.SetDXFPlotUnits(dxfUnits === 0 ? DXF_UNITS.INCH : DXF_UNITS.MM);

    if (!strokeFontEnabled) temp.SetTextMode(PLOT_TEXT_MODE.DEFAULT);
    else temp.SetTextMode(dxfStrokeFont ? PLOT_TEXT_MODE.DEFAULT : PLOT_TEXT_MODE.NATIVE);

    temp.SetDXFMultiLayeredExportOption(dxfSingle);

    if (isSVG) {
      temp.SetBlackAndWhite(svgColor === 1);
    } else if (isPDF) {
      temp.SetBlackAndWhite(pdfColor === 1);
      temp.m_PDFFrontFPPropertyPopups = pdfFront;
      temp.m_PDFBackFPPropertyPopups = pdfBack;
      temp.m_PDFMetadata = pdfMetadata;
      temp.m_PDFSingle = pdfSingle;
      temp.m_PDFBackgroundColor = pdfBackground;
    } else {
      temp.SetBlackAndWhite(true);
    }

    // The fine adjusts and the width correction, constrained and written back.
    const [xAdj, xOk] = clip(Number.parseFloat(fineX) || 0, PLOT_MIN_SCALE, PLOT_MAX_SCALE);

    if (!xOk) {
      setFineX(xAdj.toFixed(6));
      aReporter.Report(wxGetTranslation('X scale constrained.'), RPT_SEVERITY_INFO);
    }

    const [yAdj, yOk] = clip(Number.parseFloat(fineY) || 0, PLOT_MIN_SCALE, PLOT_MAX_SCALE);

    if (!yOk) {
      setFineY(yAdj.toFixed(6));
      aReporter.Report(wxGetTranslation('Y scale constrained.'), RPT_SEVERITY_INFO);
    }

    const minW = -(bds.m_TrackMinWidth - 1);
    const maxW = bds.GetSmallestClearanceValue() - 1;
    const [wAdj, wOk] = clip(
      Math.round(pcbUnitValueMM(widthAdjust, units) * pcbIUScale.IU_PER_MM),
      minW,
      maxW,
    );

    if (!wOk) {
      setWidthAdjust(pcbUnitTextMM(pcbIUScale.iuToMM(wAdj), units));
      const lo = pcbUnitTextMM(pcbIUScale.iuToMM(minW), units, true);
      const hi = pcbUnitTextMM(pcbIUScale.iuToMM(maxW), units, true);
      aReporter.Report(
        `Width correction constrained.  The width correction value must be in the range of [${lo}; ${hi}] for the current design rules.`,
        RPT_SEVERITY_WARNING,
      );
    }

    temp.SetFormat(plotFormat);
    temp.SetDisableGerberMacros(disableMacros);
    temp.SetUseGerberProtelExtensions(protel);
    temp.SetUseGerberX2format(useX2);
    temp.SetIncludeGerberNetlistInfo(netAttributes);
    temp.SetCreateGerberJobFile(jobFile);
    temp.SetGerberPrecision(coordFormat === 0 ? 5 : 6);
    temp.SetSvgPrecision(svgPrecision);
    temp.SetSvgFitPageToBoard(svgFit);

    // The checked layers, plus every disabled copper layer.
    const selected = new LSET(layerList.filter((_, i) => layerChecked[i]));
    const disabledCopper = LSET.AllCuMask().and(board.GetEnabledLayers().not());
    temp.SetPlotOnAllLayersSequence(allLayers.filter((o) => o.checked).map((o) => o.layer));
    temp.SetLayerSelection(selected.or(disabledCopper));
    temp.SetNegative(negative);
    temp.SetA4Output(forceA4);

    const dirStr = outputDir.replace(/\\/g, '/');
    temp.SetOutputDirectory(dirStr);

    if (project) project.m_PcbLastPath[LAST_PATH_TYPE.LAST_PATH_PLOT] = dirStr;

    if (!opts.IsSameAs(temp)) board.SetPlotOptions(temp);

    opts.assign(temp);

    return { params: temp, xAdj, yAdj, wAdj };
  };

  const report = (aReporter: Reporter): void => setMessages((m) => [...m, ...aReporter.lines]);

  /** `Plot`. */
  const plot = async (): Promise<void> => {
    const reporter = new Reporter();
    const { params, xAdj, yAdj, wAdj } = applyPlotSettings(reporter);

    const mgr = PgmOrNull()?.GetSettingsManager();
    const cfg = mgr?.GetAppSettings<{ m_ColorTheme: string }>('pcbnew');
    params.SetColorSettings(
      mgr ? mgr.GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME) : new COLOR_SETTINGS(),
    );
    params.SetSketchPadLineWidth(bds.GetLineThickness(PCB_LAYER_ID.F_Fab));

    // If no layer selected, we have nothing plotted.
    if (!params.GetLayerSelection().any()) {
      report(reporter);
      DisplayErrorMessage(wxGetTranslation('No layer selected, Nothing to plot'));
      return;
    }

    if (zoneFillCheck) await onCheckZones?.();

    params.SetAutoScale(false);

    switch (params.GetScaleSelection()) {
      case 0:
        params.SetAutoScale(true);
        break;
      case 2:
        params.SetScale(1.5);
        break;
      case 3:
        params.SetScale(2);
        break;
      case 4:
        params.SetScale(3);
        break;
      default:
        params.SetScale(1);
    }

    // The fine adjusts and width correction apply to PostScript only.
    if (isPS) {
      if (xAdj !== 0) params.SetFineScaleAdjustX(xAdj);
      if (yAdj !== 0) params.SetFineScaleAdjustY(yAdj);
      params.SetWidthAdjust(wAdj);
    }

    if (params.GetScale() < PLOT_MIN_SCALE)
      void DisplayInfoMessage(wxGetTranslation('Warning: Scale option set to a very small value'));

    if (params.GetScale() > PLOT_MAX_SCALE)
      void DisplayInfoMessage(wxGetTranslation('Warning: Scale option set to a very large value'));

    // Save the current plot options in the board.
    board.SetPlotOptions(params);

    const oldVariant = board.GetCurrentVariant();
    board.SetCurrentVariant(variant > 0 ? (variants[variant] ?? '') : '');

    // BOARD::GetFileName names the files and the TF.ProjectId.
    if (!board.GetFileName()) board.SetFileName(fileName || 'board.kicad_pcb');

    const dir = outputDir.trim().replace(/^\/+|\/+$/g, '');
    const plotter = new PCB_PLOTTER(board, reporter, params);
    plotter.SetPdfDeflate((bytes) => zlibSync(bytes));
    plotter.Plot(
      '',
      params.GetLayerSelection().UIOrder(),
      allLayers.filter((o) => o.checked).map((o) => o.layer),
      protel,
      (name, bytes) => {
        const mime = name.endsWith('.gbrjob') ? 'application/json' : FORMATS[format]!.mime;
        if (onOutputFile) onOutputFile(dir ? `${dir}/${name}` : name, bytes, mime);
        else download(name, bytes);
      },
      new Date(),
    );

    board.SetCurrentVariant(oldVariant);

    // PCB_PLOTTER names the file it wrote; ours landed in the project folder.
    for (const line of reporter.lines) {
      const m = /^Plotted to '(.*)'\.$/.exec(line.message);
      if (m && dir && onOutputFile) line.message = `Plotted to '${dir}/${m[1]}'.`;
    }

    report(reporter);
  };

  /** `CreateDrillFile`: the same settings for the drill files, then DIALOG_GENDRILL. */
  const createDrillFile = async (): Promise<void> => {
    const reporter = new Reporter();
    applyPlotSettings(reporter);
    report(reporter);
    await onCreateDrillFile?.();
    reInit();
  };

  /** `OnRightClickLayers`. */
  const onRightClickLayers = (e: MouseEvent<HTMLDivElement>): void => {
    const fab = LSET.AllCuMask()
      .or(LSET.AllTechMask())
      .and(new LSET([PCB_LAYER_ID.B_CrtYd, PCB_LAYER_ID.F_CrtYd]).not());
    const set = (aPick: (aLayer: PCB_LAYER_ID, aWas: boolean) => boolean): void =>
      setLayerChecked((c) => layerList.map((l, i) => aPick(l, c[i] ?? false)));

    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: wxGetTranslation('Select Fab Layers'), action: () => set((l) => fab.test(l)) },
        { sep: true },
        {
          label: wxGetTranslation('Select All Copper Layers'),
          action: () => set((l, was) => (IsCopperLayer(l) ? true : was)),
        },
        {
          label: wxGetTranslation('Deselect All Copper Layers'),
          action: () => set((l, was) => (IsCopperLayer(l) ? false : was)),
        },
        { sep: true },
        { label: wxGetTranslation('Select All Layers'), action: () => set(() => true) },
        { label: wxGetTranslation('Deselect All Layers'), action: () => set(() => false) },
      ],
    });
  };

  /** `OnRightClickAllLayers`. */
  const onRightClickAllLayers = (e: MouseEvent<HTMLDivElement>): void => {
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: wxGetTranslation('Select All Layers'),
          action: () => setAllLayers((o) => o.map((x) => ({ ...x, checked: true }))),
        },
        {
          label: wxGetTranslation('Deselect All Layers'),
          action: () => setAllLayers((o) => o.map((x) => ({ ...x, checked: false }))),
        },
        { sep: true },
        {
          label: wxGetTranslation('Order as Board Stackup'),
          action: () => {
            // arrangeAllLayersList( SeqStackupForPlotting() ), then Select( -1 ).
            const stackup = board.GetEnabledLayers().SeqStackupForPlotting();
            setAllLayers((o) =>
              [...o].sort((a, b) => stackup.indexOf(a.layer) - stackup.indexOf(b.layer)),
            );
            setAllSel(-1);
          },
        },
      ],
    });
  };

  const close = (): void => {
    // ~DIALOG_PLOT: remember the Plot on All Layers order.
    s_lastAllLayersOrder = allLayers.map((o) => o.layer);
    onClose();
  };

  const check = (aValue: boolean, aSet: (aOn: boolean) => void, aEnabled = true) => ({
    value: aValue,
    enabled: aEnabled,
    onChange: aSet,
  });
  const choice = (aValue: number, aSet: (aIndex: number) => void, aEnabled = true) => ({
    value: aValue,
    enabled: aEnabled,
    onChange: aSet,
  });
  const text = (aValue: string, aSet: (aValue: string) => void, aEnabled = true) => ({
    value: aValue,
    enabled: aEnabled,
    onChange: aSet,
  });

  // The constructor's "Plot on All Layers" box: m_plotAllLayersList and the move buttons.
  const plotAllLayers = (
    <StaticBoxSizer label={wxGetTranslation('Plot on All Layers')} orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={3}>
        <CheckListBox
          items={allLayers.map((o) => board.GetLayerName(o.layer))}
          checked={allLayers.map((o) => o.checked)}
          onCheck={(i, on) =>
            setAllLayers((o) => o.map((x, j) => (j === i ? { ...x, checked: on } : x)))
          }
          selection={allSel}
          onSelect={setAllSel}
          onContextMenu={onRightClickAllLayers}
          ariaLabel={wxGetTranslation('Plot on All Layers')}
        />
      </SizerItem>
      <SizerItem flag={wxALL | wxEXPAND} border={3}>
        {/* bButtonSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={3}>
            <StdBitmapButton
              bitmap="small_up"
              title={wxGetTranslation('Move current selection up')}
              onClick={() => {
                if (allSel > 0) {
                  setAllLayers((o) => moveCurrent(o, allSel, -1));
                  setAllSel(allSel - 1);
                }
              }}
            />
          </SizerItem>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
            <StdBitmapButton
              bitmap="small_down"
              title={wxGetTranslation('Move current selection down')}
              onClick={() => {
                if (allSel >= 0 && allSel < allLayers.length - 1) {
                  setAllLayers((o) => moveCurrent(o, allSel, 1));
                  setAllSel(allSel + 1);
                }
              }}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </StaticBoxSizer>
  );

  return (
    <>
      <DIALOG_PLOT_BASE
        m_plotFormatOpt={choice(format, changeFormat)}
        variants={variants}
        m_variantChoiceCtrl={choice(variant, setVariant)}
        m_outputDirectoryName={text(outputDir, setOutputDir)}
        onOpenOutputDirectory={() => onOpenOutputDirectory?.(outputDir)}
        openDirShown={!!onOpenOutputDirectory}
        layerNames={layerList.map((l) => board.GetLayerName(l))}
        layerChecked={layerChecked}
        onLayerCheck={(i, on) => setLayerChecked((c) => c.map((v, j) => (j === i ? on : v)))}
        onRightClickLayers={onRightClickLayers}
        plotAllLayers={plotAllLayers}
        m_plotSheetRef={check(plotSheet, setPlotSheet)}
        m_subtractMaskFromSilk={check(subtractMask, setSubtractMask)}
        m_plotDNP={check(plotDNP, setPlotDNP)}
        hideDNP={hideDNP}
        onDNPMode={setHideDNP}
        dnpModeEnabled={plotDNP}
        m_sketchPadsOnFabLayers={check(sketchPads, setSketchPads)}
        m_plotPadNumbers={check(padNumbers, setPadNumbers, sketchPads)}
        m_zoneFillCheck={check(zoneFillCheck, setZoneFillCheck)}
        m_drillShapeOpt={choice(drillShape, setDrillShape, !isGerber)}
        m_scaleOpt={choice(scale, setScale, !isGerber)}
        m_useAuxOriginCheckBox={check(useAuxOrigin, setUseAuxOrigin, !isPS)}
        m_plotMirrorOpt={check(mirror, setMirror, !isGerber && !isDXF)}
        m_plotPSNegativeOpt={check(negative, setNegative, isPS || isSVG || isPDF)}
        solderMaskAlertShown={solderMaskAlert}
        onBoardSetup={() => {
          onBoardSetup?.(wxGetTranslation('Solder Mask/Paste'));
          reInit();
        }}
        gerberShown={isGerber}
        psShown={isPS}
        dxfShown={isDXF}
        svgShown={isSVG}
        pdfShown={isPDF}
        m_useGerberExtensions={check(protel, setProtel)}
        m_generateGerberJobFile={check(jobFile, setJobFile)}
        m_coordFormatCtrl={choice(coordFormat, setCoordFormat)}
        m_useGerberX2Format={check(useX2, setUseX2)}
        m_useGerberNetAttributes={check(netAttributes, setNetAttributes)}
        m_disableApertMacros={check(disableMacros, setDisableMacros)}
        m_fineAdjustXCtrl={text(fineX, setFineX, isPS)}
        m_fineAdjustYCtrl={text(fineY, setFineY, isPS)}
        m_widthAdjustCtrl={text(widthAdjust, setWidthAdjust, isPS)}
        widthAdjustUnits={unitLabel(units)}
        m_forcePSA4OutputOpt={check(forceA4, setForceA4, isPS)}
        m_DXF_plotModeOpt={check(
          dxfContours,
          (on) => {
            setDxfContours(on);
            if (on) setDxfStrokeFont(true);
          },
          isDXF,
        )}
        m_DXF_plotUnits={choice(dxfUnits, setDxfUnits)}
        m_DXF_plotTextStrokeFontOpt={check(dxfStrokeFont, setDxfStrokeFont, strokeFontEnabled)}
        m_DXF_exportAsMultiLayeredFile={check(dxfSingle, setDxfSingle)}
        m_svgPrecsision={{ value: svgPrecision, onChange: setSvgPrecision }}
        m_SVGColorChoice={choice(svgColor, setSvgColor)}
        m_SVG_fitPageToBoard={check(svgFit, setSvgFit)}
        m_PDFColorChoice={choice(pdfColor, setPdfColor)}
        m_frontFPPropertyPopups={check(pdfFront, setPdfFront)}
        m_backFPPropertyPopups={check(pdfBack, setPdfBack)}
        m_pdfMetadata={check(pdfMetadata, setPdfMetadata)}
        m_pdfSingle={check(pdfSingle, setPdfSingle)}
        pdfBackgroundColor={pdfBackground}
        onPdfBackgroundColor={setPdfBackground}
        pdfBackgroundEnabled={pdfColor !== 1}
        messages={messages}
        visibleSeverities={severities}
        onVisibleSeveritiesChange={setSeverities}
        drcWarning={drcWarning}
        onRunDRC={() => {
          onRunDrc?.();
          reInit();
        }}
        onCreateDrillFile={() => void createDrillFile()}
        onPlot={() => void plot()}
        onCancel={close}
      />
      {menu && (
        <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
