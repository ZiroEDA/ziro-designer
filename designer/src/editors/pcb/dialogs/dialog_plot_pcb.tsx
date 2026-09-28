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
 * The plot format choice (Gerber, Postscript, SVG, DXF, PDF) shows that
 * format's option group and greys the General Options SetPlotFormat greys for
 * it; every format goes through PCB_PLOTTER::Plot with the COLOR_SETTINGS of
 * the PCB editor's colour theme, as DIALOG_PLOT::Plot sets them. General
 * Options not offered here yet (soldermask subtraction, DNP marking, sketch
 * pads / pad numbers; PlotOneBoardLayer has them) are left out rather than
 * shown dead, as are the Postscript "Force A4 output" (PCB_PLOT_PARAMS has no
 * A4 flag yet) and the PDF background colour swatch.
 *
 * Web delta, there is no local filesystem, so "Output directory:" is a folder
 * inside the *project* (our cloud file manager), where each .gbr/.gbrjob/.drl
 * is written exactly as KiCad writes them to disk; "Download a copy to this
 * computer" additionally streams the set out as a zip.
 */
import { useMemo, useRef, useState, type JSX } from 'react';
import { zipSync, zlibSync, strToU8 } from 'fflate';
import { boardAuxOrigin, PCB_PLOTTER, type Board } from '@ziroeda/pcbnew';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { EXCELLON_WRITER } from '@ziroeda/pcbnew/exporters/gendrill_excellon_writer.js';
import { ZEROS_FMT } from '@ziroeda/pcbnew/exporters/gendrill_writer_base.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { DXF_OUTLINE_MODE, DXF_UNITS, PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { PCB_LAYER_ID as LAYER } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { DEFAULT_THEME, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { SpinCtrl } from '@ziroeda/common/widgets/spin_ctrl.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type ReportLine,
} from '@ziroeda/common';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '@ziroeda/pcbnew/pcb_unit_binder.js';

interface Props {
  board: Board;
  visibleLayers: ReadonlySet<string>;
  /** The frame's display units. `m_trackWidthCorrection`
   *  (`dialog_plot.cpp:116`) is a `UNIT_BINDER` on the edit frame like every
   *  other distance field, even though its model is millimetres. */
  units: StatusUnits;
  /** Folders that already exist in the project (browse choices). */
  projectFolders?: readonly string[];
  /** Write a generated file into the project (path relative to the project
   *  folder). Absent when the board is open standalone, then plots download. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  /** Run DRC... (upstream m_buttonDRC opens the DRC dialog). */
  onRunDrc?: () => void;
  onClose: () => void;
}

/** `m_plotFormatOpt`'s choices, in `DIALOG_PLOT::getPlotFormat`'s order. */
const PLOT_FORMATS: readonly { value: string; label: string; format: PLOT_FORMAT; mime: string }[] =
  [
    { value: '0', label: 'Gerber', format: PLOT_FORMAT.GERBER, mime: 'application/vnd.gerber' },
    { value: '1', label: 'Postscript', format: PLOT_FORMAT.POST, mime: 'application/postscript' },
    { value: '2', label: 'SVG', format: PLOT_FORMAT.SVG, mime: 'image/svg+xml' },
    { value: '3', label: 'DXF', format: PLOT_FORMAT.DXF, mime: 'image/vnd.dxf' },
    { value: '4', label: 'PDF', format: PLOT_FORMAT.PDF, mime: 'application/pdf' },
  ];

/** `m_drillShapeOpt`, `m_scaleOpt` and the two colour choices (dialog_plot_base.cpp). */
const DRILL_CHOICES = ['None', 'Small', 'Actual size'].map((l, i) => ({
  value: String(i),
  label: l,
}));
const SCALE_CHOICES = ['Auto', '1:1', '3:2', '2:1', '3:1'].map((l, i) => ({
  value: String(i),
  label: l,
}));
const COLOR_CHOICES = ['Color', 'Black and white'].map((l, i) => ({ value: String(i), label: l }));
const DXF_UNIT_CHOICES = ['Inches', 'Millimeters'].map((l, i) => ({ value: String(i), label: l }));
const COORD_CHOICES = [
  { value: '5', label: '4.5, unit mm' },
  { value: '6', label: '4.6, unit mm' },
];

/** `selectionToScale` / DIALOG_PLOT::Plot's scale switch. */
const SCALES = [0, 1, 1.5, 2, 3];

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
  units,
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
  // The rest of DIALOG_PLOT::init_Dialog: the board's own plot settings.
  const [initial] = useState(() => board.k?.GetPlotOptions() ?? new PCB_PLOT_PARAMS());
  const [formatSel, setFormatSel] = useState(() => {
    const i = PLOT_FORMATS.findIndex((f) => f.format === initial.GetFormat());
    return String(Math.max(0, i));
  });
  const format = PLOT_FORMATS[Number(formatSel)]!.format;
  const [plotSheet, setPlotSheet] = useState(() => initial.GetPlotFrameRef());
  const [drillSel, setDrillSel] = useState(() => String(initial.GetDrillMarksType()));
  const [scaleSel, setScaleSel] = useState(() => String(initial.GetScaleSelection()));
  const [mirror, setMirror] = useState(() => initial.GetMirror());
  const [negative, setNegative] = useState(() => initial.GetNegative());
  const [fineX, setFineX] = useState(() => String(initial.GetFineScaleAdjustX()));
  const [fineY, setFineY] = useState(() => String(initial.GetFineScaleAdjustY()));
  const [widthAdjust, setWidthAdjust] = useState(() =>
    pcbUnitTextMM(pcbIUScale.iuToMM(initial.GetWidthAdjust()), units),
  );
  const [dxfContours, setDxfContours] = useState(() => initial.GetDXFPlotPolygonMode());
  const [dxfUnits, setDxfUnits] = useState(() =>
    initial.GetDXFPlotUnits() === DXF_UNITS.INCH ? '0' : '1',
  );
  const [dxfSingle, setDxfSingle] = useState(() => initial.GetDXFMultiLayeredExportOption());
  const [svgPrecision, setSvgPrecision] = useState(() => initial.GetSvgPrecision());
  const [svgBw, setSvgBw] = useState(() => (initial.GetBlackAndWhite() ? '1' : '0'));
  const [svgFit, setSvgFit] = useState(() => initial.GetSvgFitPagetoBoard());
  const [pdfBw, setPdfBw] = useState(() => (initial.GetBlackAndWhite() ? '1' : '0'));
  const [pdfFront, setPdfFront] = useState(() => initial.m_PDFFrontFPPropertyPopups);
  const [pdfBack, setPdfBack] = useState(() => initial.m_PDFBackFPPropertyPopups);
  const [pdfMetadata, setPdfMetadata] = useState(() => initial.m_PDFMetadata);
  const [pdfSingle, setPdfSingle] = useState(() => initial.m_PDFSingle);
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

  /**
   * DIALOG_PLOT::Plot: applyPlotSettings onto a PCB_PLOT_PARAMS, the editor's
   * colour theme, then PCB_PLOTTER::Plot, which runs StartPlotBoard /
   * PlotBoardLayers for each checked layer and, for Gerber, the job file.
   * Board Setup's Solder Mask/Paste values reach the pads through the board's
   * own design settings.
   */
  const plot = (): void => {
    const k = board.k;

    if (!k) {
      report('The board model is not loaded, nothing to plot.', RPT_SEVERITY_WARNING);
      return;
    }

    // BOARD::GetFileName names the files and the TF.ProjectId; the view holds it.
    if (!k.GetFileName()) k.SetFileName(board.fileName ?? 'board.kicad_pcb');

    const layers = layerNames
      .filter((l) => checked.has(l))
      .map((l) => LSET.NameToLayer(l) as PCB_LAYER_ID)
      .filter((l) => l >= 0);

    if (layers.length === 0) {
      report('No layers selected, nothing to plot.', RPT_SEVERITY_WARNING);
      return;
    }

    const params = new PCB_PLOT_PARAMS();
    params.assign(k.GetPlotOptions());
    params.SetFormat(format);
    params.SetPlotFrameRef(plotSheet);
    params.SetUseAuxOrigin(format !== PLOT_FORMAT.POST && useAuxOrigin);
    params.SetScaleSelection(Number(scaleSel));
    params.SetDrillMarksType(
      format === PLOT_FORMAT.GERBER
        ? DRILL_MARKS.NO_DRILL_SHAPE // SetPlotFormat( GERBER ) disables the drill marks
        : (Number(drillSel) as DRILL_MARKS),
    );
    params.SetMirror(format !== PLOT_FORMAT.GERBER && format !== PLOT_FORMAT.DXF && mirror);
    params.SetNegative(format !== PLOT_FORMAT.GERBER && format !== PLOT_FORMAT.DXF && negative);
    params.SetDXFPlotPolygonMode(dxfContours);
    params.SetDXFPlotUnits(dxfUnits === '0' ? DXF_UNITS.INCH : DXF_UNITS.MM);
    params.SetDXFMultiLayeredExportOption(dxfSingle);

    if (format === PLOT_FORMAT.SVG) params.SetBlackAndWhite(svgBw === '1');
    else if (format === PLOT_FORMAT.PDF) {
      params.SetBlackAndWhite(pdfBw === '1');
      params.m_PDFFrontFPPropertyPopups = pdfFront;
      params.m_PDFBackFPPropertyPopups = pdfBack;
      params.m_PDFMetadata = pdfMetadata;
      params.m_PDFSingle = pdfSingle;
    } else params.SetBlackAndWhite(true);

    if (format === PLOT_FORMAT.POST) {
      params.SetFineScaleAdjustX(Number(fineX) || 1);
      params.SetFineScaleAdjustY(Number(fineY) || 1);
      params.SetWidthAdjust(Math.round(pcbUnitValueMM(widthAdjust, units) * pcbIUScale.IU_PER_MM));
    }

    params.SetUseGerberProtelExtensions(protel);
    params.SetUseGerberX2format(useX2);
    params.SetCreateGerberJobFile(jobFile);
    params.SetGerberPrecision(coordDigits);
    params.SetSvgPrecision(svgPrecision);
    params.SetSvgFitPageToBoard(svgFit);
    params.SetLayerSelection(new LSET(layers));

    // DIALOG_PLOT::Plot: the scale, the theme and the sketch pad width.
    const scale = SCALES[Number(scaleSel)] ?? 1;
    params.SetAutoScale(format !== PLOT_FORMAT.GERBER && scale === 0);
    params.SetScale(format === PLOT_FORMAT.GERBER || scale === 0 ? 1 : scale);

    const mgr = PgmOrNull()?.GetSettingsManager();
    const cfg = mgr?.GetAppSettings<{ m_ColorTheme: string }>('pcbnew');
    params.SetColorSettings(
      mgr ? mgr.GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME) : new COLOR_SETTINGS(),
    );
    params.SetSketchPadLineWidth(k.GetDesignSettings().GetLineThickness(LAYER.F_Fab));

    const reporter = new Reporter();
    const files: Record<string, Uint8Array> = {};
    const plotter = new PCB_PLOTTER(k, reporter, params);
    plotter.SetPdfDeflate((bytes) => zlibSync(bytes));

    plotter.Plot(
      '',
      layers,
      [],
      protel,
      (name, bytes) => {
        files[name] = bytes;
        const mime = name.endsWith('.gbrjob')
          ? 'application/json'
          : PLOT_FORMATS[Number(formatSel)]!.mime;
        const path = dir ? `${dir}/${name}` : name;
        if (onOutputFile) onOutputFile(path, bytes, mime);
        else download(name, bytes);
      },
      new Date(),
    );

    for (const line of reporter.lines) {
      // PCB_PLOTTER names the file it wrote; ours landed in the project folder.
      const m = /^Plotted to '(.*)'\.$/.exec(line.message);
      report(
        m ? `Plotted to '${dir && onOutputFile ? `${dir}/${m[1]}` : m[1]}'.` : line.message,
        line.severity,
      );
    }

    if (downloadCopy) {
      download(`${base}-plots.zip`, zipSync(files));
      report(`Downloaded ${base}-plots.zip.`, RPT_SEVERITY_INFO);
    }
  };

  /**
   * Generate Drill Files...: EXCELLON_WRITER with DIALOG_GENDRILL's defaults
   * (metric, decimal, PTH and NPTH merged, oval holes as G85 slots) and the
   * drill/place origin when "Use drill/place file origin" is checked.
   */
  const drill = (): void => {
    const k = board.k;

    if (!k) {
      report('The board model is not loaded, nothing to drill.', RPT_SEVERITY_WARNING);
      return;
    }

    if (!k.GetFileName()) k.SetFileName(board.fileName ?? 'board.kicad_pcb');

    const writer = new EXCELLON_WRITER(k);
    const origin = useAuxOrigin ? k.GetDesignSettings().GetAuxOrigin() : { x: 0, y: 0 };
    // dialog_gendrill.cpp: precisionListForMetric( 3, 3 )
    writer.SetFormat(true, ZEROS_FMT.DECIMAL_FORMAT, 3, 3);
    writer.SetOptions(false, false, origin, true);
    writer.SetRouteModeForOvalHoles(false);
    writer.SetFileSink((name, bytes) => {
      const text = new TextDecoder().decode(bytes);
      emit(name, text, 'text/plain');
      if (downloadCopy) download(name, text);
    });
    writer.CreateDrillandMapFilesSet('', true, false);
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
            <Combo value={formatSel} options={PLOT_FORMATS} onChange={setFormatSel} />
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
                type="button"
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
                {format !== PLOT_FORMAT.GERBER && (
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={plotSheet}
                      onChange={(e) => setPlotSheet(e.target.checked)}
                    />
                    Plot drawing sheet
                  </label>
                )}
                <div style={fieldRow}>
                  <span>Drill marks:</span>
                  <Combo
                    value={format === PLOT_FORMAT.GERBER ? '0' : drillSel}
                    options={DRILL_CHOICES}
                    onChange={setDrillSel}
                    disabled={format === PLOT_FORMAT.GERBER}
                  />
                </div>
                <div style={fieldRow}>
                  <span>Scaling:</span>
                  <Combo
                    value={format === PLOT_FORMAT.GERBER ? '1' : scaleSel}
                    options={SCALE_CHOICES}
                    onChange={setScaleSel}
                    disabled={format === PLOT_FORMAT.GERBER}
                  />
                </div>
                <label
                  style={check}
                  title="Use the drill/place file origin as the coordinate origin for plotted files"
                >
                  <input
                    type="checkbox"
                    checked={format !== PLOT_FORMAT.POST && useAuxOrigin}
                    disabled={format === PLOT_FORMAT.POST}
                    onChange={(e) => setUseAuxOrigin(e.target.checked)}
                  />
                  Use drill/place file origin
                </label>
                <label style={check}>
                  <input
                    type="checkbox"
                    checked={format !== PLOT_FORMAT.GERBER && format !== PLOT_FORMAT.DXF && mirror}
                    disabled={format === PLOT_FORMAT.GERBER || format === PLOT_FORMAT.DXF}
                    onChange={(e) => setMirror(e.target.checked)}
                  />
                  Mirrored plot
                </label>
                <label style={check}>
                  <input
                    type="checkbox"
                    checked={
                      format !== PLOT_FORMAT.GERBER && format !== PLOT_FORMAT.DXF && negative
                    }
                    disabled={format === PLOT_FORMAT.GERBER || format === PLOT_FORMAT.DXF}
                    onChange={(e) => setNegative(e.target.checked)}
                  />
                  Negative plot
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

              {format === PLOT_FORMAT.GERBER && (
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
                        <Combo
                          style={{ flex: 1 }}
                          value={String(coordDigits)}
                          options={COORD_CHOICES}
                          onChange={(v) => setCoordDigits(Number(v) as 5 | 6)}
                        />
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
              )}

              {format === PLOT_FORMAT.POST && (
                <fieldset style={box}>
                  <legend style={legend}>Postscript Options</legend>
                  <div style={fieldRow}>
                    <span>X scale factor:</span>
                    <input
                      className="ze-search"
                      value={fineX}
                      onChange={(e) => setFineX(e.target.value)}
                    />
                  </div>
                  <div style={fieldRow}>
                    <span>Y scale factor:</span>
                    <input
                      className="ze-search"
                      value={fineY}
                      onChange={(e) => setFineY(e.target.value)}
                    />
                  </div>
                  <div style={fieldRow}>
                    <span>Track width correction:</span>
                    <input
                      className="ze-search"
                      value={widthAdjust}
                      onChange={(e) => setWidthAdjust(e.target.value)}
                    />
                    <span className="ze-unit-label">{unitLabel(units)}</span>
                  </div>
                </fieldset>
              )}

              {format === PLOT_FORMAT.DXF && (
                <fieldset style={box}>
                  <legend style={legend}>DXF Options</legend>
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={dxfContours}
                      onChange={(e) => setDxfContours(e.target.checked)}
                    />
                    Plot graphic items using their contours
                  </label>
                  <div style={fieldRow}>
                    <span>Export units:</span>
                    <Combo value={dxfUnits} options={DXF_UNIT_CHOICES} onChange={setDxfUnits} />
                  </div>
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={dxfSingle}
                      onChange={(e) => setDxfSingle(e.target.checked)}
                    />
                    Single document
                  </label>
                </fieldset>
              )}

              {format === PLOT_FORMAT.SVG && (
                <fieldset style={box}>
                  <legend style={legend}>SVG Options</legend>
                  <div style={fieldRow}>
                    <span>Precision:</span>
                    <SpinCtrl value={svgPrecision} min={3} max={6} onChange={setSvgPrecision} />
                  </div>
                  <div style={fieldRow}>
                    <span>Output mode:</span>
                    <Combo value={svgBw} options={COLOR_CHOICES} onChange={setSvgBw} />
                  </div>
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={svgFit}
                      onChange={(e) => setSvgFit(e.target.checked)}
                    />
                    Fit page to board
                  </label>
                </fieldset>
              )}

              {format === PLOT_FORMAT.PDF && (
                <fieldset style={box}>
                  <legend style={legend}>PDF Options</legend>
                  <div style={fieldRow}>
                    <span>Output mode:</span>
                    <Combo value={pdfBw} options={COLOR_CHOICES} onChange={setPdfBw} />
                  </div>
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={pdfFront}
                      onChange={(e) => setPdfFront(e.target.checked)}
                    />
                    Generate property popups for front footprints
                  </label>
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={pdfBack}
                      onChange={(e) => setPdfBack(e.target.checked)}
                    />
                    Generate property popups for back footprints
                  </label>
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={pdfMetadata}
                      onChange={(e) => setPdfMetadata(e.target.checked)}
                    />
                    Generate metadata from AUTHOR &amp; SUBJECT variables
                  </label>
                  <label style={check}>
                    <input
                      type="checkbox"
                      checked={pdfSingle}
                      onChange={(e) => setPdfSingle(e.target.checked)}
                    />
                    Single document
                  </label>
                </fieldset>
              )}
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
            type="button"
            className="ze-btn"
            style={{ marginRight: 'auto' }}
            disabled={!onRunDrc}
            onClick={() => onRunDrc?.()}
          >
            Run DRC...
          </button>
          <button type="button" className="ze-btn" onClick={drill}>
            Generate Drill Files...
          </button>
          <button type="button" className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="ze-btn primary" onClick={plot}>
            Plot
          </button>
        </div>
      </div>
    </div>
  );
}
