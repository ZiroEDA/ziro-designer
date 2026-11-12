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
 * Web deltas: the browser's downloads folder stands for the output folder on
 * disk, so everything plotted is downloaded - one run of several files as one
 * zip, the output directory kept as the folder inside it (designer
 * output_downloads.ts) - and "Open file after plot" shows it in a new tab
 * (upstream opens the system PDF viewer). Controls a browser cannot
 * honour are left out rather than shown dead: PNG anti-aliasing (canvas always
 * anti-aliases).
 */

import { Button, Combo } from '@ziroeda/wx/controls.js';
import { useRef, useState, type JSX } from 'react';
import { mmToIU, iuToMM, type ReportLine } from '@ziroeda/common';
import type { PlotOpts, PlotPageSize } from '../sch_plotter.js';
import { IU_PER_MILS } from '../schematic_settings.js';
import { BUILTIN_THEMES } from '../sch_render_settings.js';
import type { EESCHEMA_SETTINGS_STORE } from '../browser/eeschema_app.js';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

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
  /** `m_PDFPropertyPopups`: a popup of each item's properties on the page. */
  pdfPropertyPopups: boolean;
  /** `m_PDFHierarchicalLinks`: sheets, pins and hierarchical labels link to their pages. */
  pdfHierarchicalLinks: boolean;
  /** Open the plotted file in a new tab (upstream OpenPDF). */
  openAfter: boolean;
  /** Output Messages sink (the dialog's WX_HTML_REPORT_PANEL reporter). */
  report: (message: string, severity: number) => void;
}

interface Props {
  /** The editor's active theme id (the "Color theme:" default selection). */
  themeId?: string;
  onPlot: (request: PlotRequest) => void;
  onClose: () => void;
  /** `Pgm().GetSettingsManager()`'s eeschema slice (`EESCHEMA_APP.settings`),
   *  which this dialog reads its defaults from and writes back to. */
  settings: EESCHEMA_SETTINGS_STORE;
}

const FORMATS: { id: PlotFormat; label: string }[] = [
  { id: 'ps', label: _HKI('Postscript') },
  { id: 'pdf', label: _HKI('PDF') },
  { id: 'svg', label: _HKI('SVG') },
  { id: 'dxf', label: _HKI('DXF') },
  { id: 'png', label: 'PNG' },
];

/** Formats whose files carry a background colour (DIALOG_PLOT_SCHEMATIC::onColorMode). */
const BACKGROUND_FORMATS: PlotFormat[] = ['ps', 'pdf', 'svg', 'png'];
/** Formats a minimum pen width applies to (onPlotFormatSelection). */
const PEN_WIDTH_FORMATS: PlotFormat[] = ['ps', 'pdf', 'svg', 'png'];
/** Formats a browser tab can display ("Open file after plot"). */
const VIEWABLE_FORMATS: PlotFormat[] = ['pdf', 'svg', 'png'];

export function DialogPlot({ settings, themeId, onPlot, onClose }: Props): JSX.Element {
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
  // The three PDF checkboxes, each `SetValue(true)` in the base file
  // (dialog_plot_schematic_base.cpp:139-151).
  const [pdfPropertyPopups, setPdfPropertyPopups] = useState(true);
  const [pdfHierarchicalLinks, setPdfHierarchicalLinks] = useState(true);
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
  const [openAfter, setOpenAfter] = useState(false);

  // Output Messages (WX_HTML_REPORT_PANEL).
  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);
  const report = useRef((message: string, severity: number): void => {
    setMessages((m) => [...m, { message, severity, location: 'body' as const }]);
  }).current;

  const bgAvailable = color && BACKGROUND_FORMATS.includes(format);
  const penEnabled = PEN_WIDTH_FORMATS.includes(format);
  const canOpenAfter = VIEWABLE_FORMATS.includes(format);

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
      pdfPropertyPopups: format === 'pdf' && pdfPropertyPopups,
      pdfHierarchicalLinks: format === 'pdf' && pdfHierarchicalLinks,
      openAfter: openAfter && canOpenAfter && !allPages,
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
    <DialogShim title={_('Plot Schematic Options')} onClose={onClose}>
      <div
        className="ze-modal-body"
        style={{ display: 'block', padding: '10px 14px', overflow: 'auto' }}
      >
        {/* Output directory (upstream bOutputDir): the folder inside the download. No browse
            button: the files are downloaded, so there is no folder on disk to pick. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={lab}>{_('Output directory:')}</span>
          <input
            className="ze-search"
            style={{ flex: 1 }}
            value={outputDir}
            placeholder="(none)"
            title="Folder for the plotted files. They are downloaded; a plot of several files comes as one zip with this folder inside it."
            onChange={(e) => setOutputDir(e.target.value)}
          />
        </div>

        {/* Three columns (upstream m_optionsSizer): Output Format and Options
          take their natural width; the right column grows to fill. */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <fieldset style={{ ...group, flex: '0 0 130px' }}>
            <legend style={legend}>{_('Output Format')}</legend>
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
            <legend style={legend}>{_('Options')}</legend>
            <div style={optGrid}>
              <span style={lab}>{_('Page size:')}</span>
              <Combo
                value={String(pageSize)}
                options={[
                  { value: String('auto'), label: _('Schematic size') },
                  { value: String('A4'), label: 'A4' },
                  { value: String('A'), label: 'A' },
                ]}
                className="ze-select"
                style={ctrl2}
                onChange={(aValue) => setPageSize(aValue as PlotPageSize)}
              />

              <label
                style={{ ...span3, ...row }}
                title={_('Plot the drawing sheet border and title block')}
              >
                <input
                  type="checkbox"
                  checked={drawingSheet}
                  onChange={(e) => setDrawingSheet(e.target.checked)}
                />{' '}
                {_('Plot drawing sheet')}
              </label>

              <div style={{ ...span3, height: 6 }} />

              <span style={lab}>{_('Output mode:')}</span>
              <Combo
                value={String(color ? 'color' : 'bw')}
                options={[
                  { value: String('color'), label: _('Color') },
                  { value: String('bw'), label: _('Black and White') },
                ]}
                className="ze-select"
                style={ctrl2}
                onChange={(aValue) => setColor(aValue === 'color')}
              />

              <span style={{ ...lab, opacity: color ? 1 : 0.5 }}>{_('Color theme:')}</span>
              <Combo
                value={String(themeSel)}
                options={Object.entries(BUILTIN_THEMES).map(([id, t]) => ({
                  value: String(id),
                  label: t.name,
                }))}
                disabled={!color}
                title={_('Select the color theme to use for plotting')}
                className="ze-select"
                style={ctrl2}
                onChange={(aValue) => setThemeSel(aValue)}
              />

              <label
                style={{ ...span3, ...row, opacity: bgAvailable ? 1 : 0.5 }}
                title={_('Plot the background color if the output format supports it')}
              >
                <input
                  type="checkbox"
                  checked={bgAvailable && background}
                  disabled={!bgAvailable}
                  onChange={(e) => setBackground(e.target.checked)}
                />{' '}
                {_('Plot background color')}
              </label>

              <div style={{ ...span3, height: 6 }} />

              <span style={{ ...lab, opacity: penEnabled ? 1 : 0.5 }}>
                {_('Minimum line width:')}
              </span>
              <input
                className="ze-search"
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={minWidthMm}
                disabled={!penEnabled}
                title={_(
                  'Selection of the default pen thickness used to draw items, when their thickness is set to 0.',
                )}
                onChange={(e) => setMinWidthMm(e.target.value)}
              />
              <span className="ze-muted" style={{ fontSize: 11, opacity: penEnabled ? 1 : 0.5 }}>
                {_('mm')}
              </span>
            </div>
          </fieldset>

          {/* Right column: the format groups + Other Options (bOptionsRight). */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <fieldset style={group}>
              <legend style={legend}>{_('PDF Options')}</legend>
              <label style={check(format !== 'pdf')}>
                <input
                  type="checkbox"
                  checked={pdfPropertyPopups}
                  disabled={format !== 'pdf'}
                  onChange={(e) => setPdfPropertyPopups(e.target.checked)}
                />{' '}
                {_('Generate property popups')}
              </label>
              <label style={check(format !== 'pdf')}>
                <input
                  type="checkbox"
                  checked={pdfHierarchicalLinks}
                  disabled={format !== 'pdf'}
                  onChange={(e) => setPdfHierarchicalLinks(e.target.checked)}
                />{' '}
                {_('Generate clickable links for hierarchical elements')}
              </label>
              <label
                style={check(format !== 'pdf')}
                title={_('Generate PDF document properties from AUTHOR and SUBJECT text variables')}
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
              <legend style={legend}>{_('DXF Options')}</legend>
              <div style={{ ...row, opacity: format === 'dxf' ? 1 : 0.5 }}>
                <span style={lab}>{_('Export units:')}</span>
                <Combo
                  value={String(dxfUnits)}
                  options={[
                    { value: 'in', label: _('Inches') },
                    // The value is the unit itself (data); only the label is a message.
                    { value: 'mm', label: _('Millimeters') },
                  ]}
                  disabled={format !== 'dxf'}
                  title={_('The units to use for the exported DXF file')}
                  className="ze-select"
                  onChange={(aValue) => setDxfUnits(aValue as 'in' | 'mm')}
                />
              </div>
            </fieldset>

            {format === 'png' && (
              <fieldset style={group}>
                <legend style={legend}>{_('PNG Options')}</legend>
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
              <legend style={legend}>{_('Other Options')}</legend>
              <label
                style={check(!canOpenAfter)}
                title={_(
                  'Open the plotted file in a new browser tab after a successful plot (current page only)',
                )}
              >
                <input
                  type="checkbox"
                  checked={openAfter && canOpenAfter}
                  disabled={!canOpenAfter}
                  onChange={(e) => setOpenAfter(e.target.checked)}
                />{' '}
                {_('Open file after plot')}
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
        <Button label={_('Plot Current Page')} onClick={() => doPlot(false)} />
        <Button label={_('Close')} onClick={onClose} />
        <Button label={_('Plot All Pages')} isDefault onClick={() => doPlot(true)} />
      </div>
    </DialogShim>
  );
}
