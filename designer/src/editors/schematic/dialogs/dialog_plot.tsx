// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Plot dialog. Counterpart: `eeschema/dialogs/dialog_plot_schematic_base.cpp` +
 * `dialog_plot_schematic.cpp` (DIALOG_PLOT_SCHEMATIC). Same layout as upstream:
 * the output-directory row on top; a three-column row holding the "Output
 * Format" radio box, the "Options" grid and a right column with the selected
 * format's group (PDF / DXF / PNG) plus "Other Options"; the Output Messages
 * report panel; and the std-button row Plot Current Page (Apply) / Close /
 * Plot All Pages (OK).
 *
 * KiCad's enable rules are reproduced exactly (onPlotFormatSelection +
 * onColorMode): the colour theme follows "Output mode: Color"; the background
 * colour needs a format that can carry one (Postscript / PDF / SVG / PNG); the
 * minimum line width is disabled for DXF; PDF and DXF options grey out unless
 * their format is picked and the PNG group only appears for PNG.
 *
 * Web deltas, the browser has no filesystem, so the output directory is a
 * folder inside the *project* (our cloud file manager) rather than a disk path,
 * and its browse button lists the project's folders. Everything plotted lands
 * there; "Download a copy to this computer" additionally streams the file
 * through the browser's download flow, and "Open file after plot" shows it in a
 * new tab (upstream opens the system PDF viewer). Controls a browser cannot
 * honour are left out rather than shown dead: PNG anti-aliasing (canvas always
 * anti-aliases), and the PDF property-popup / hierarchical-link options (our
 * PDF writer emits a page image, not annotated vector content).
 */

import { useMemo, useRef, useState, type JSX } from 'react';
import { mmToIU, iuToMM, type ReportLine } from '@ziroeda/common';
import type { PlotOpts, PlotPageSize } from '../render/plot.js';
import { IU_PER_MILS } from '../schematic_settings.js';
import { BUILTIN_THEMES } from '../theme.js';
import { settings } from '../../../prefs/settings.js';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '../../../widgets/wx_html_report_panel.js';
import { Icon } from '../../../ui/icons.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

export type PlotFormat = 'ps' | 'pdf' | 'svg' | 'dxf' | 'png';

/** One "Plot Current Page" / "Plot All Pages" run. */
export interface PlotRequest {
  format: PlotFormat;
  /** Render options; the editor adds the per-sheet ones (drawing sheet, ...). */
  opts: PlotOpts;
  /** OK plots every sheet, Apply just the current one. */
  allPages: boolean;
  /** "Color theme:" selection (BUILTIN_THEMES key). */
  themeId: string;
  /** Project-relative output folder ('' = the project's own folder). */
  outputDir: string;
  /** Fill the PDF document properties from AUTHOR / SUBJECT. */
  pdfMetadata: boolean;
  /** Open the plotted file in a new tab (upstream OpenPDF). */
  openAfter: boolean;
  /** Also stream the file to the browser's download folder. */
  downloadCopy: boolean;
  /** Output Messages sink (the dialog's WX_HTML_REPORT_PANEL reporter). */
  report: (message: string, severity: number) => void;
}

interface Props {
  /** The editor's active theme id (the "Color theme:" default selection). */
  themeId?: string;
  /** Folders that already exist in the project, for the browse button. */
  projectFolders?: readonly string[];
  onPlot: (request: PlotRequest) => void;
  onClose: () => void;
}

const FORMATS: { id: PlotFormat; label: string }[] = [
  { id: 'ps', label: 'Postscript' },
  { id: 'pdf', label: 'PDF' },
  { id: 'svg', label: 'SVG' },
  { id: 'dxf', label: 'DXF' },
  { id: 'png', label: 'PNG' },
];

/** Formats whose files carry a background colour (DIALOG_PLOT_SCHEMATIC::onColorMode). */
const BACKGROUND_FORMATS: PlotFormat[] = ['ps', 'pdf', 'svg', 'png'];
/** Formats a minimum pen width applies to (onPlotFormatSelection). */
const PEN_WIDTH_FORMATS: PlotFormat[] = ['ps', 'pdf', 'svg', 'png'];
/** Formats a browser tab can display ("Open file after plot"). */
const VIEWABLE_FORMATS: PlotFormat[] = ['pdf', 'svg', 'png'];

export function DialogPlot({ themeId, projectFolders = [], onPlot, onClose }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [format, setFormat] = useState<PlotFormat>('pdf');
  const [pageSize, setPageSize] = useState<PlotPageSize>('auto');
  const [color, setColor] = useState(true);
  const [drawingSheet, setDrawingSheet] = useState(true);
  const [background, setBackground] = useState(false);
  const [themeSel, setThemeSel] = useState(
    themeId && BUILTIN_THEMES[themeId] ? themeId : '_builtin_default',
  );
  const [dpi, setDpi] = useState(300);
  const [dxfUnits, setDxfUnits] = useState<'in' | 'mm'>('in');
  const [pdfMetadata, setPdfMetadata] = useState(true);
  // TransferDataToWindow seeds the pen width from the drawing defaults (mils).
  const [minWidthMm, setMinWidthMm] = useState(() =>
    String(
      Math.round(iuToMM(settings.eeschema.drawing.default_line_thickness * IU_PER_MILS) * 10000) /
        10000,
    ),
  );
  // Output directory: a folder inside the project, '' = the project folder.
  const [outputDir, setOutputDir] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [openAfter, setOpenAfter] = useState(false);
  const [downloadCopy, setDownloadCopy] = useState(false);

  // Output Messages (WX_HTML_REPORT_PANEL).
  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);
  const report = useRef((message: string, severity: number): void => {
    setMessages((m) => [...m, { message, severity, location: 'body' as const }]);
  }).current;

  const bgAvailable = color && BACKGROUND_FORMATS.includes(format);
  const penEnabled = PEN_WIDTH_FORMATS.includes(format);
  const canOpenAfter = VIEWABLE_FORMATS.includes(format);

  const folders = useMemo(
    () => [...new Set(projectFolders.filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [projectFolders],
  );

  const doPlot = (allPages: boolean): void => {
    const opts: PlotOpts = {
      color,
      drawingSheet,
      background: bgAvailable && background,
      dpi,
      defaultPenIU: penEnabled ? mmToIU(Number(minWidthMm) || 0) : 0,
      pageSizeSelect: pageSize,
      dxfUnits,
    };
    onPlot({
      format,
      opts,
      allPages,
      themeId: themeSel,
      outputDir: outputDir.trim().replace(/^\/+|\/+$/g, ''),
      pdfMetadata: format === 'pdf' && pdfMetadata,
      openAfter: openAfter && canOpenAfter && !allPages,
      downloadCopy,
      report,
    });
  };

  const group: React.CSSProperties = {
    border: '1px solid var(--chrome-border)',
    borderRadius: 4,
    padding: '6px 10px 8px',
    margin: 0,
  };
  const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px', fontWeight: 600 };
  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12.5,
  };
  const lab: React.CSSProperties = { fontSize: 12 };
  // The Options group is a gridbag (label | control | units) like KiCad.
  const optGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr max-content',
    alignItems: 'center',
    gap: '10px 8px',
    fontSize: 12.5,
  };
  const span3: React.CSSProperties = { gridColumn: '1 / 4' };
  const ctrl2: React.CSSProperties = {
    gridColumn: '2 / 4',
    width: '100%',
    boxSizing: 'border-box',
  };
  const check = (disabled?: boolean): React.CSSProperties => ({
    display: 'block',
    margin: '4px 0',
    fontSize: 12.5,
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Plot Schematic Options
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{ display: 'block', padding: '10px 14px', overflow: 'auto' }}
        >
          {/* Output directory (upstream bOutputDir): a folder in the project. */}
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
              title="Folder inside the project for the plotted files (relative to the project). Files appear in the file manager, where you can download them."
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

          {/* Three columns (upstream m_optionsSizer): Output Format and Options
              take their natural width; the right column grows to fill. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <fieldset style={{ ...group, flex: '0 0 130px' }}>
              <legend style={legend}>Output Format</legend>
              {FORMATS.map((f) => (
                <label key={f.id} style={check()}>
                  <input
                    type="radio"
                    name="pfmt"
                    checked={format === f.id}
                    onChange={() => setFormat(f.id)}
                  />{' '}
                  {f.label}
                </label>
              ))}
            </fieldset>

            <fieldset style={{ ...group, flex: '0 0 250px' }}>
              <legend style={legend}>Options</legend>
              <div style={optGrid}>
                <span style={lab}>Page size:</span>
                <select
                  className="ze-select"
                  style={ctrl2}
                  value={pageSize}
                  onChange={(e) => setPageSize(e.target.value as PlotPageSize)}
                >
                  <option value="auto">Schematic size</option>
                  <option value="A4">A4</option>
                  <option value="A">A</option>
                </select>

                <label
                  style={{ ...span3, ...row }}
                  title="Plot the drawing sheet border and title block"
                >
                  <input
                    type="checkbox"
                    checked={drawingSheet}
                    onChange={(e) => setDrawingSheet(e.target.checked)}
                  />{' '}
                  Plot drawing sheet
                </label>

                <div style={{ ...span3, height: 6 }} />

                <span style={lab}>Output mode:</span>
                <select
                  className="ze-select"
                  style={ctrl2}
                  value={color ? 'color' : 'bw'}
                  onChange={(e) => setColor(e.target.value === 'color')}
                >
                  <option value="color">Color</option>
                  <option value="bw">Black and White</option>
                </select>

                <span style={{ ...lab, opacity: color ? 1 : 0.5 }}>Color theme:</span>
                <select
                  className="ze-select"
                  style={ctrl2}
                  value={themeSel}
                  disabled={!color}
                  title="Select the color theme to use for plotting"
                  onChange={(e) => setThemeSel(e.target.value)}
                >
                  {Object.entries(BUILTIN_THEMES).map(([id, t]) => (
                    <option key={id} value={id}>
                      {t.name}
                    </option>
                  ))}
                </select>

                <label
                  style={{ ...span3, ...row, opacity: bgAvailable ? 1 : 0.5 }}
                  title="Plot the background color if the output format supports it"
                >
                  <input
                    type="checkbox"
                    checked={bgAvailable && background}
                    disabled={!bgAvailable}
                    onChange={(e) => setBackground(e.target.checked)}
                  />{' '}
                  Plot background color
                </label>

                <div style={{ ...span3, height: 6 }} />

                <span style={{ ...lab, opacity: penEnabled ? 1 : 0.5 }}>Minimum line width:</span>
                <input
                  className="ze-search"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={minWidthMm}
                  disabled={!penEnabled}
                  title="Selection of the default pen thickness used to draw items, when their thickness is set to 0."
                  onChange={(e) => setMinWidthMm(e.target.value)}
                />
                <span className="ze-muted" style={{ fontSize: 11, opacity: penEnabled ? 1 : 0.5 }}>
                  mm
                </span>
              </div>
            </fieldset>

            {/* Right column: the format groups + Other Options (bOptionsRight). */}
            <div
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <fieldset style={group}>
                <legend style={legend}>PDF Options</legend>
                <label
                  style={check(format !== 'pdf')}
                  title="Generate PDF document properties from AUTHOR and SUBJECT text variables"
                >
                  <input
                    type="checkbox"
                    checked={pdfMetadata}
                    disabled={format !== 'pdf'}
                    onChange={(e) => setPdfMetadata(e.target.checked)}
                  />{' '}
                  Generate metadata from AUTHOR &amp; SUBJECT variables
                </label>
              </fieldset>

              <fieldset style={group}>
                <legend style={legend}>DXF Options</legend>
                <div style={{ ...row, opacity: format === 'dxf' ? 1 : 0.5 }}>
                  <span style={lab}>Export units:</span>
                  <select
                    className="ze-select"
                    value={dxfUnits}
                    disabled={format !== 'dxf'}
                    title="The units to use for the exported DXF file"
                    onChange={(e) => setDxfUnits(e.target.value as 'in' | 'mm')}
                  >
                    <option value="in">Inches</option>
                    <option value="mm">Millimeters</option>
                  </select>
                </div>
              </fieldset>

              {format === 'png' && (
                <fieldset style={group}>
                  <legend style={legend}>PNG Options</legend>
                  <div style={row}>
                    <span style={lab}>DPI:</span>
                    <input
                      className="ze-search"
                      type="number"
                      style={{ width: 90 }}
                      value={dpi}
                      min={72}
                      max={2400}
                      onChange={(e) =>
                        setDpi(Math.max(72, Math.min(2400, Number(e.target.value) || 300)))
                      }
                    />
                  </div>
                </fieldset>
              )}

              <fieldset style={group}>
                <legend style={legend}>Other Options</legend>
                <label
                  style={check(!canOpenAfter)}
                  title="Open the plotted file in a new browser tab after a successful plot (current page only)"
                >
                  <input
                    type="checkbox"
                    checked={openAfter && canOpenAfter}
                    disabled={!canOpenAfter}
                    onChange={(e) => setOpenAfter(e.target.checked)}
                  />{' '}
                  Open file after plot
                </label>
                <label
                  style={check()}
                  title="Plots always land in the project's file manager; check this to also download them to this computer."
                >
                  <input
                    type="checkbox"
                    checked={downloadCopy}
                    onChange={(e) => setDownloadCopy(e.target.checked)}
                  />{' '}
                  Download a copy to this computer
                </label>
              </fieldset>
            </div>
          </div>

          {/* Output Messages (WX_HTML_REPORT_PANEL). */}
          <div style={{ marginTop: 12 }}>
            <HtmlReportPanel
              lines={messages}
              fileName="report.txt"
              minHeight={120}
              visibleSeverities={severities}
              onVisibleSeveritiesChange={setSeverities}
            />
          </div>
        </div>
        <div className="ze-modal-footer">
          {/* KiCad std-button order (GTK): Plot Current Page (Apply), Close, Plot All Pages (OK). */}
          <button className="ze-btn" onClick={() => doPlot(false)}>
            Plot Current Page
          </button>
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button className="ze-btn primary" onClick={() => doPlot(true)}>
            Plot All Pages
          </button>
        </div>
      </div>
    </div>
  );
}
