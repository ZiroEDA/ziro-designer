// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic print/plot output. Counterparts: `eeschema/sch_plotter.cpp`
 * (SCH_PLOTTER, the Plot dialog's file writers) and `eeschema/printing/
 * sch_printout.cpp` (SCH_PRINTOUT, the Print dialog's page rendering).
 *
 * Both reuse the on-screen schematic renderer: a sheet is drawn at page size
 * with the grid/cursor off and the drawing sheet + colours chosen by the
 * dialog. Raster outputs (PNG, and Print) go through a real `<canvas>`; the
 * vector ones go through a Canvas2D-shaped adapter that records the same
 * draw calls — SVG as `<path>` markup, DXF and PostScript as their entities,
 * and PDF as calls on the ported `PDF_PLOTTER`, the one class KiCad plots
 * every PDF through.
 */

import type { Schematic } from '@ziroeda/eeschema';
import { busJunctionIds } from '@ziroeda/eeschema/src/connectivity/bus.js';
import type { WksSheet } from '@ziroeda/common';
import type { Theme } from '../theme.js';
import { KICAD_CLASSIC } from '../theme.js';
import { renderSchematic, paperSizeIU, setVectorText, type RenderOpts } from './renderer.js';
import { zlibSync } from 'fflate';
import type { LibSymbol } from '@ziroeda/eeschema';
import { plotPdfAnnotations, type PdfNetInfo } from './pdf_annotations.js';
import { schIUScale } from '@ziroeda/common/src/eda_units.js';
import { fracture, type Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  FILL_T,
  PdfPlotter,
  pdfRenderSettings,
  type Color4d,
} from '@ziroeda/pcbnew/src/plot_pdf.js';

const MM = 10000; // IU per mm (matches the renderer)

/** Print/Plot options shared by the dialogs (SCH_PLOT_OPTS subset). */
export interface PlotOpts {
  /** Colour output (false = black and white, KiCad's m_blackAndWhite). */
  color: boolean;
  /** Draw the page border + title block (m_plotDrawingSheet). */
  drawingSheet: boolean;
  /** Custom drawing sheet to plot (a loaded `.kicad_wks`); unset = default. */
  sheet?: WksSheet;
  /** Fill the page with the theme background colour (m_useBackgroundColor). */
  background: boolean;
  /** Raster resolution for PNG output (the PNG Options DPI; default 300). */
  dpi?: number;
  /** Title-block page context of this sheet instance (SCH_SHEET_PATH):
   *  page-number string (${#}), sheet ordinal (page1only visibility), sheet
   *  count (${##}), sheet name and human path. Unset = standalone sheet. */
  pageNumber?: string;
  sheetNumber?: number;
  sheetCount?: number;
  sheetName?: string;
  sheetPath?: string;
  /** Pen width (IU) for zero-width strokes ("Minimum line width"). */
  defaultPenIU?: number;
  /** Effective junction-dot diameter (IU) from the schematic settings
   *  (SCHEMATIC_SETTINGS::GetJunctionSize()), so plots match the screen. */
  junctionDiameterIU?: number;
  /** Dashed-line dash / gap ratios and the label/pin text lift ratio from the
   *  schematic settings (m_DashedLine*Ratio, m_TextOffsetRatio). */
  dashLengthRatio?: number;
  gapLengthRatio?: number;
  textOffsetRatio?: number;
  /** Global-label box margin + overbar offset ratios (m_LabelSizeRatio,
   *  FONT_METRICS m_OverbarHeight), so plots match the screen. */
  labelSizeRatio?: number;
  overbarHeightRatio?: number;
  /** Pin decoration size in IU (m_PinSymbolSize; 0 = per-pin fallback). */
  pinSymbolSizeIU?: number;
  /** Wire hop-over arc radius in IU (0/unset = hop-overs off). */
  hopOverRadiusIU?: number;
  /** Inter-sheet references resolver (RenderOpts shape; unset = hidden). */
  intersheetRefs?: RenderOpts['intersheetRefs'];
  /** Per-item netclass fallbacks for the plotted sheet (RenderOpts shape). */
  netOverrides?: RenderOpts['netOverrides'];
  /** Text-variable resolver, so `${VAR}` plots expanded like the screen. */
  resolveTextVar?: RenderOpts['resolveTextVar'];
  /** Unit-notation inputs for multi-unit references (SubReference). */
  subpart?: RenderOpts['subpart'];
  /** Plot page override (SCH_PLOT_OPTS::m_pageSizeSelect): the schematic's own
   *  page, or the drawing scaled onto an A4 / A sheet. */
  pageSizeSelect?: PlotPageSize;
  /** DXF export units (SCH_PLOT_OPTS::m_DXF_File_Unit). */
  dxfUnits?: 'in' | 'mm';
  /** PDF document properties from the AUTHOR / SUBJECT text variables
   *  (m_PDFMetadata); unset = no /Info dictionary. */
  pdfMetadata?: { title?: string; author?: string; subject?: string };
  /** `m_PDFPropertyPopups`: a popup of an item's properties on the plotted page. */
  pdfPropertyPopups?: boolean;
  /** `m_PDFHierarchicalLinks`: sheets, sheet pins and hierarchical labels link to their pages. */
  pdfHierarchicalLinks?: boolean;
  /**
   * What the connectivity knows about a wire, bus, label or sheet pin (by
   * refId), for the PDF popups; the plotter has no connection graph of its
   * own, so the editor answers.
   */
  netOf?: (itemId: string) => PdfNetInfo | undefined;
  /** The symbols the sheet's symbols come from, for their bookmarks and popups. */
  libById?: Map<string, LibSymbol>;
}

/** PAGE_SIZE_AUTO / PAGE_SIZE_A4 / PAGE_SIZE_A (the "Page size:" choice). */
export type PlotPageSize = 'auto' | 'A4' | 'A';

/** Page dimensions of the sheet in mm, long edge first. */
const PLOT_PAGE_MM: Record<Exclude<PlotPageSize, 'auto'>, [number, number]> = {
  A4: [297, 210],
  A: [11 * 25.4, 8.5 * 25.4],
};

/**
 * The page actually plotted and the scale the drawing gets (SCH_PLOTTER::
 * plotOneSheetPDF/PS): "Schematic size" plots 1:1 on the sheet's own page;
 * A4 / A keep the sheet's orientation and scale by min(scalex, scaley).
 */
export function plotPageIU(
  sch: Schematic,
  opts: PlotOpts,
): { w: number; h: number; scale: number } {
  const actual = pageIU(sch);
  const sel = opts.pageSizeSelect ?? 'auto';
  if (sel === 'auto') return { w: actual.w, h: actual.h, scale: 1 };
  const [long, short] = PLOT_PAGE_MM[sel];
  const portrait = actual.h > actual.w;
  const w = (portrait ? short : long) * MM;
  const h = (portrait ? long : short) * MM;
  return { w, h, scale: Math.min(w / actual.w, h / actual.h) };
}

/** An all-black-on-white theme for monochrome output (KiCad's B&W plot). */
function monochromeTheme(): Theme {
  const black = 'rgb(0, 0, 0)';
  const none = 'rgba(0, 0, 0, 0)';
  return {
    background: 'rgb(255, 255, 255)',
    grid: black,
    gridAxes: black,
    wire: black,
    bus: black,
    busJunction: black,
    junction: black,
    symbolOutline: black,
    symbolFill: none,
    pin: black,
    pinName: black,
    pinNumber: black,
    reference: black,
    value: black,
    fields: black,
    label: black,
    globalLabel: black,
    hierLabel: black,
    netclassFlag: black,
    // Never reached on a plot either: the collision markers live on a
    // VIEW_OVERLAY that only exists while a drag is in flight.
    dragNetCollision: black,
    netHighlight: black,
    selectionShadow: none,
    noteLine: black,
    noText: black,
    privateNote: black,
    noConnect: black,
    // `SCH_SYMBOL::PlotDNP` takes `GetLayerColor( LAYER_DNP_MARKER )` from the
    // render settings, which a monochrome plot has already blacked out.
    dnpMarker: black,
    // Never reached on a plot: `SCH_SYMBOL::Plot` emits `PlotDNP` and no
    // simulation marker, and `RenderOpts.markSimExclusions` is off here.
    excludedFromSim: black,
    ercError: black,
    ercWarning: black,
    ercExclusion: black,
    sheetBorder: black,
    sheetBackground: none,
    sheetName: black,
    sheetFile: black,
    sheetLabel: black,
    sheetFields: black,
    pageFrame: black,
    pageLimits: black,
    anchor: black,
    hidden: black,
    cursor: black,
    auxItems: black,
    // Nothing is ever brightened on a plot — `IsPrinting()` skips the shadow
    // pass — but the field is required, and black keeps a monochrome plot
    // monochrome if anything ever does reach it.
    brightened: black,
    ruleArea: black,
  };
}

/** The theme to plot/print with, given the base editor theme and options. */
function outputTheme(base: Theme, opts: PlotOpts): Theme {
  if (!opts.color) return monochromeTheme();
  // Colour output on a white page unless "background colour" is requested.
  const bg = opts.background ? base.background : 'rgb(255, 255, 255)';
  return { ...base, background: bg };
}

/** Render options for output: no grid, no page-limit outline, drawing sheet per option. */
function outputRenderOpts(opts: PlotOpts, sch: Schematic): RenderOpts {
  return {
    showHiddenPins: false,
    showHiddenFields: false,
    showPageLimits: false,
    // No `Plot()` draws a dangling mark; they are the painter's alone.
    showDanglingIndicators: false,
    // `if( aPlotOpts.m_useBackgroundColor && aPlotter->GetColorMode() )`
    // fill the page; otherwise the page is left as it is.
    paintBackground: opts.background && opts.color,
    // Directive labels are ordinary schematic content, not a "hidden item"
    // like the two above, so a plot carries them. Upstream the painter reads
    // the LIVE `eeconfig()` here as it does on screen, which we cannot from a
    // plotter that is handed no settings — so this is the PARAM's own default
    // (`eeschema_settings.cpp:210-211`), and a plot made with the flags turned
    // off on screen still shows them. Stated rather than silent.
    showDirectiveLabels: true,
    // A plot has no selection, so the selection shadow never runs and this
    // cannot show. Present because RenderOpts requires it, at the PARAM's own
    // default.
    // A plot has no selection; the alt icon is not a selection thing and a
    // plotted sheet shows it exactly as the canvas does.
    showPinAltIcons: true,
    // `if( m_schSettings.m_OverrideItemColors && drawingNetColorHighlights ) return;`
    // — a plot is not that flag, but it is also not the canvas: KiCad plots the
    // highlight layer only if the plotter asks for it, and ours does not offer
    // the layer at all, so it stays off here rather than inventing a plotted
    // band the user never asked to print.
    highlightNetclassColors: false,
    netclassHighlightThicknessMils: 15,
    netclassHighlightAlpha: 0.6,
    fillSelectedShapes: false,
    // A plot has no selection, so neither shadow-pass flag can fire; both are
    // here because RenderOpts requires them.
    drawSelectedChildren: true,
    showDrawingSheet: opts.drawingSheet,
    ...(opts.sheet ? { drawingSheet: opts.sheet } : {}),
    pageNumber: opts.pageNumber,
    sheetNumber: opts.sheetNumber,
    sheetCount: opts.sheetCount,
    sheetName: opts.sheetName,
    sheetPath: opts.sheetPath,
    defaultPenIU: opts.defaultPenIU,
    junctionDiameterIU: opts.junctionDiameterIU,
    // A plot paints the same layers the screen does, so a junction on a bus
    // has to plot in the bus-junction colour too. Derived here rather than
    // threaded in: a plot has no live connection graph to ask.
    busJunctionIds: busJunctionIds(sch),
    dashLengthRatio: opts.dashLengthRatio,
    gapLengthRatio: opts.gapLengthRatio,
    textOffsetRatio: opts.textOffsetRatio,
    labelSizeRatio: opts.labelSizeRatio,
    overbarHeightRatio: opts.overbarHeightRatio,
    pinSymbolSizeIU: opts.pinSymbolSizeIU,
    hopOverRadiusIU: opts.hopOverRadiusIU,
    intersheetRefs: opts.intersheetRefs,
    netOverrides: opts.netOverrides,
    resolveTextVar: opts.resolveTextVar,
    subpart: opts.subpart,
    selectionThicknessMils: 0,
    highlightThicknessMils: 0,
    grid: { show: false, sizeIU: 12700, style: 'dots', lineWidthPx: 1, minSpacingPx: 10 },
  };
}

/** Page size in IU for a sheet (falls back to A4 landscape if unknown). */
export function pageIU(sch: Schematic): { w: number; h: number } {
  return paperSizeIU(sch.paper) ?? { w: 297 * MM, h: 210 * MM };
}

/**
 * Render a sheet to a fresh canvas at `dpi`, fit to the page rectangle
 * (0,0)-(pageW,pageH). Returns the canvas so callers can print, download a
 * PNG, or embed it in a PDF.
 */
export function renderSheetToCanvas(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  dpi = 300,
): HTMLCanvasElement {
  const page = plotPageIU(sch, opts);
  const pxPerIU = dpi / 25.4 / MM; // dpi → px per mm → px per IU
  const cw = Math.max(1, Math.round(page.w * pxPerIU));
  const ch = Math.max(1, Math.round(page.h * pxPerIU));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  const theme = outputTheme(base, opts);
  renderSchematic(
    ctx,
    sch,
    { scale: pxPerIU * page.scale, offsetX: 0, offsetY: 0 },
    theme,
    cw,
    ch,
    undefined,
    undefined,
    outputRenderOpts(opts, sch),
  );
  return canvas;
}

/** Trigger a browser download of a Blob under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Where a plotted file goes. Defaults to a browser download; the editor passes
 *  a sink that writes into the project file manager instead. */
export type PlotSink = (blob: Blob, filename: string) => void;

/** Plot to PNG (raster) at the requested DPI (default 300). */
export async function plotPng(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  name: string,
  sink: PlotSink = downloadBlob,
): Promise<void> {
  const canvas = renderSheetToCanvas(sch, base, opts, opts.dpi ?? 300);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (blob) sink(blob, `${name}.png`);
}

/** One sheet of a PDF plot job. */
export interface PdfPlotSheet {
  sch: Schematic;
  opts: PlotOpts;
  /**
   * `StartPage`'s parent — the sheet path with its last entry popped
   * (sch_plotter.cpp:194-207): the parent's page number and Sheetname, which
   * hang this page's outline entry under the parent's. Unset for a root.
   */
  parent?: { pageNumber: string; sheetName: string };
  /** The page each sheet symbol on this page opens, by the sheet's uuid. */
  childPages?: ReadonlyMap<string, string>;
}

/**
 * `SCH_PLOTTER::createPDFFile`, over the ported `PDF_PLOTTER`: one document,
 * one page per sheet, every page a compressed content stream of the same
 * paths the screen draws — `PDF_PLOTTER` is the one KiCad class both editors
 * plot PDF through, which is why this reaches for `pcbnew/src/plot_pdf.ts`
 * rather than writing a second file format.
 *
 * `setupPlotPagePDF` (:276-310) sizes the page and sets the viewport in
 * decimils; the A4 / A choice's `min( scalex, scaley )` is `plotPageIU`'s
 * scale, folded into the render walk's CTM here rather than into the
 * plotter's, so every back-end scales the one way.
 */
export function sheetsToPdf(
  sheets: readonly PdfPlotSheet[],
  base: Theme,
  metadata?: PlotOpts['pdfMetadata'],
  options: { debugPdfWriter?: boolean; now?: Date } = {},
): Uint8Array {
  const first = sheets[0];
  if (!first) return new Uint8Array();
  const bw = !first.opts.color;
  const plotter = new PdfPlotter(
    // SCH_RENDER_SETTINGS' default pen: the schematic's "Minimum line width",
    // which the renderer strokes zero-width items with.
    pdfRenderSettings({ defaultPenWidth: first.opts.defaultPenIU ?? 0 }),
    // wxZlibOutputStream( wxZ_BEST_COMPRESSION, wxZLIB_ZLIB ): a zlib stream.
    (bytes) => zlibSync(bytes, { level: 9 }),
    { debugPdfWriter: options.debugPdfWriter ?? false },
  );
  plotter.SetColorMode(!bw);
  plotter.SetCreator('Eeschema-PDF');
  // `SetTitle( ExpandTextVars( RootScreen()->GetTitleBlock().GetTitle() ) )`.
  const rootTitle = first.sch.titleBlock?.title ?? '';
  plotter.SetTitle(
    metadata?.title ?? (first.opts.resolveTextVar ? expandVars(rootTitle, first) : rootTitle),
  );
  sheets.forEach((s, i) => {
    const page = plotPageIU(s.sch, s.opts);
    if (metadata) {
      // The AUTHOR / SUBJECT text variables, resolved per sheet (:139-151).
      if (metadata.author !== undefined) plotter.SetAuthor(metadata.author);
      if (metadata.subject !== undefined) plotter.SetSubject(metadata.subject);
    }
    // "For the following pages you need to close the (finished) page,
    // reconfigure, and then start a new one" — and in that order: ClosePage
    // writes the finished page's /MediaBox from the size still in force.
    if (i > 0) plotter.ClosePage();
    // setupPlotPagePDF: the page in mils, the viewport in decimils.
    const mils = schIUScale.IU_PER_MILS;
    plotter.SetPageSettings({ x: page.w / mils, y: page.h / mils });
    plotter.SetViewport({ x: 0, y: 0 }, mils / 10, 1, false);
    const pageNumber = s.opts.pageNumber ?? String(i + 1);
    const sheetName = s.opts.sheetName ?? '';
    if (i === 0) {
      plotter.OpenFile('');
      plotter.StartPlot(pageNumber, sheetName);
    } else {
      plotter.StartPage(
        pageNumber,
        sheetName,
        s.parent?.pageNumber ?? '',
        s.parent?.sheetName ?? '',
      );
    }
    renderToVector(s.sch, base, s.opts, new PdfContext(plotter, page.w, page.h), () => '');
    // Then what each item's Plot() adds beside its geometry: the links, the
    // popups and the bookmarks, which ClosePage writes as the page's /Annots
    // and EndPlot as the outline.
    plotPdfAnnotations(plotter, s.sch, s.opts.libById ?? new Map(), {
      hierarchicalLinks: s.opts.pdfHierarchicalLinks ?? false,
      propertyPopups: s.opts.pdfPropertyPopups ?? false,
      parentPageNumber: s.parent?.pageNumber,
      childPageNumber: (uuid) => s.childPages?.get(uuid),
      netOf: s.opts.netOf,
      resolve: s.opts.resolveTextVar,
      scale: page.scale,
    });
  });
  plotter.EndPlot(options.now);
  return plotter.bytes();
}

/** `ExpandTextVars` over the sheet's own resolver. */
function expandVars(text: string, s: PdfPlotSheet): string {
  const resolve = s.opts.resolveTextVar;
  if (!resolve) return text;
  return text.replace(/\$\{([^}]*)\}/g, (whole, name: string) => resolve(name) ?? whole);
}

/** Plot one sheet to a single-page PDF. */
export async function plotPdf(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  name: string,
  sink: PlotSink = downloadBlob,
): Promise<void> {
  await plotPdfSheets([{ sch, opts }], base, name, sink, opts.pdfMetadata);
}

/**
 * Plot a whole hierarchy to **one** multi-page PDF, as
 * `SCH_PLOTTER::createPDFFile` does — it opens the file once and pages through
 * the sheet list rather than writing a file per sheet. Every other format is
 * one file per sheet because those formats have no notion of a page after the
 * first; PDF does, and a twelve-sheet design should be one document you can
 * page through and send.
 *
 * Each page keeps its own size: sheets in one project can use different paper.
 */
export async function plotPdfSheets(
  sheets: readonly PdfPlotSheet[],
  base: Theme,
  name: string,
  sink: PlotSink = downloadBlob,
  metadata?: PlotOpts['pdfMetadata'],
): Promise<void> {
  if (sheets.length === 0) return;
  const bytes = sheetsToPdf(sheets, base, metadata ?? sheets[0]!.opts.pdfMetadata);
  sink(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${name}.pdf`);
}

/** Plot to a true-vector SVG. */
export function plotSvg(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  name: string,
  sink: PlotSink = downloadBlob,
): void {
  const svg = sheetToSvg(sch, base, opts);
  sink(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
}

// ----- SVG output (vector) ---------------------------------------------------

/** Render a sheet to an SVG document string, at 1 user unit = 1 mm. */
export function sheetToSvg(sch: Schematic, base: Theme, opts: PlotOpts): string {
  const page = plotPageIU(sch, opts);
  const wMM = page.w / MM;
  const hMM = page.h / MM;
  // Draw in IU, then a viewBox in IU with an mm-sized viewport keeps line
  // widths (which the renderer sets in IU) correct.
  const svg = new SvgContext(page.w, page.h);
  const theme = outputTheme(base, opts);
  // Stroke glyph text as line segments so the adapter records it as vector paths.
  setVectorText(true);
  try {
    renderSchematic(
      svg as unknown as CanvasRenderingContext2D,
      sch,
      { scale: page.scale, offsetX: 0, offsetY: 0 },
      theme,
      page.w,
      page.h,
      undefined,
      undefined,
      outputRenderOpts(opts, sch),
    );
  } finally {
    setVectorText(false);
  }
  return svg.toString(wMM, hMM);
}

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, t: Mat): Mat {
  return [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ];
}

/**
 * The minimal subset of CanvasRenderingContext2D the schematic renderer uses,
 * recording each draw as SVG markup. Transforms are emitted as a `matrix(...)`
 * attribute so stroke widths and dashes stay in local (pre-transform) units,
 * exactly as canvas treats them.
 */
class SvgContext {
  private out: string[] = [];
  private ctm: Mat = IDENT;
  private stack: { ctm: Mat; fill: string; stroke: string; lw: number; dash: number[] }[] = [];
  private path: string[] = [];
  private curX = NaN;
  private curY = NaN;
  private startX = NaN;
  private startY = NaN;

  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  font = '';
  textAlign = '';
  private dash: number[] = [];

  constructor(
    private pw: number,
    private ph: number,
  ) {}

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctm = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    this.ctm = mul(this.ctm, [1, 0, 0, 1, x, y]);
  }
  rotate(t: number): void {
    this.ctm = mul(this.ctm, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
  }
  save(): void {
    this.stack.push({
      ctm: this.ctm,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
      lw: this.lineWidth,
      dash: this.dash,
    });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.ctm = s.ctm;
    this.fillStyle = s.fill;
    this.strokeStyle = s.stroke;
    this.lineWidth = s.lw;
    this.dash = s.dash;
  }
  setLineDash(d: number[]): void {
    this.dash = d;
  }

  beginPath(): void {
    this.path = [];
    this.curX = this.curY = this.startX = this.startY = NaN;
  }
  moveTo(x: number, y: number): void {
    this.path.push(`M${n(x)} ${n(y)}`);
    this.curX = this.startX = x;
    this.curY = this.startY = y;
  }
  lineTo(x: number, y: number): void {
    this.path.push(`L${n(x)} ${n(y)}`);
    this.curX = x;
    this.curY = y;
  }
  closePath(): void {
    this.path.push('Z');
    this.curX = this.startX;
    this.curY = this.startY;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.push(`M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`);
    this.curX = this.startX = x;
    this.curY = this.startY = y;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    const sx = cx + r * Math.cos(a0);
    const sy = cy + r * Math.sin(a0);
    this.path.push(Number.isNaN(this.curX) ? `M${n(sx)} ${n(sy)}` : `L${n(sx)} ${n(sy)}`);
    let span = a1 - a0;
    if (ccw) {
      if (span > 0) span -= 2 * Math.PI;
    } else if (span < 0) span += 2 * Math.PI;
    const sweep = ccw ? 0 : 1;
    if (Math.abs(span) >= 2 * Math.PI - 1e-6) {
      // Full circle: two half-arcs (SVG can't draw a 360° arc in one command).
      const mx = cx - r * Math.cos(a0);
      const my = cy - r * Math.sin(a0);
      this.path.push(`A${n(r)} ${n(r)} 0 1 ${sweep} ${n(mx)} ${n(my)}`);
      this.path.push(`A${n(r)} ${n(r)} 0 1 ${sweep} ${n(sx)} ${n(sy)}`);
      this.curX = sx;
      this.curY = sy;
      return;
    }
    const ex = cx + r * Math.cos(a1);
    const ey = cy + r * Math.sin(a1);
    const large = Math.abs(span) > Math.PI ? 1 : 0;
    this.path.push(`A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(ex)} ${n(ey)}`);
    this.curX = ex;
    this.curY = ey;
  }

  stroke(): void {
    if (!this.path.length) return;
    this.out.push(
      `<path d="${this.path.join(' ')}" fill="none" stroke="${esc(this.strokeStyle)}" ` +
        `stroke-width="${n(this.lineWidth)}" stroke-linecap="${this.lineCap === 'round' ? 'round' : 'butt'}" ` +
        `stroke-linejoin="${this.lineJoin === 'round' ? 'round' : 'miter'}"` +
        this.dashAttr() +
        this.tf() +
        '/>',
    );
  }
  fill(): void {
    if (!this.path.length) return;
    this.out.push(
      `<path d="${this.path.join(' ')}" fill="${esc(this.fillStyle)}" stroke="none"${this.tf()}/>`,
    );
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" ` +
        `stroke="${esc(this.strokeStyle)}" stroke-width="${n(this.lineWidth)}"` +
        this.dashAttr() +
        this.tf() +
        '/>',
    );
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${esc(this.fillStyle)}"${this.tf()}/>`,
    );
  }
  fillText(text: string, x: number, y: number): void {
    this.out.push(
      `<text x="${n(x)}" y="${n(y)}" fill="${esc(this.fillStyle)}" text-anchor="middle"${this.tf()}>${escText(text)}</text>`,
    );
  }
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    const src = (img as HTMLImageElement).src ?? '';
    if (!src) return;
    this.out.push(
      `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${esc(src)}"${this.tf()}/>`,
    );
  }

  private dashAttr(): string {
    return this.dash.length ? ` stroke-dasharray="${this.dash.map(n).join(',')}"` : '';
  }
  private tf(): string {
    const m = this.ctm;
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return '';
    return ` transform="matrix(${m.map(n).join(' ')})"`;
  }

  toString(wMM: number, hMM: number): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(wMM)}mm" height="${n(hMM)}mm" ` +
      `viewBox="0 0 ${n(this.pw)} ${n(this.ph)}">\n` +
      this.out.join('\n') +
      `\n</svg>\n`
    );
  }
}

function n(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0';
}
/** Fixed-decimal number for DXF/PS coordinates (no exponent form). */
function num(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : '0';
}
/** CSS colour (#rgb / #rrggbb / rgb(...)) -> [r,g,b] in 0..255. */
function parseColor(s: string): [number, number, number] {
  const t = (s || '').trim();
  if (t[0] === '#') {
    if (t.length === 4)
      return [
        parseInt(t[1]! + t[1]!, 16),
        parseInt(t[2]! + t[2]!, 16),
        parseInt(t[3]! + t[3]!, 16),
      ];
    return [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16)];
  }
  const m = t.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1]!.split(',').map((v) => parseInt(v, 10) || 0);
    return [r ?? 0, g ?? 0, b ?? 0];
  }
  return [0, 0, 0];
}

type Pt = [number, number];
interface SubPath {
  pts: Pt[];
  closed: boolean;
}

/**
 * Shared CTM + path accumulation for the vector back-ends (DXF, PostScript).
 * Implements the same CanvasRenderingContext2D subset as SvgContext, but, since
 * DXF/PS can't defer a transform to a matrix attribute, every path point is
 * resolved through the CTM to absolute page coordinates before it is emitted.
 * Glyphs arrive as stroked segments (setVectorText), so only geometry is needed.
 */
abstract class VectorContext {
  protected ctm: Mat = IDENT;
  private stack: { ctm: Mat; lw: number; stroke: string; fill: string }[] = [];
  private subs: SubPath[] = [];
  private cur: SubPath | null = null;

  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  font = '';
  textAlign = '';

  constructor(
    protected pw: number,
    protected ph: number,
  ) {}

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctm = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    this.ctm = mul(this.ctm, [1, 0, 0, 1, x, y]);
  }
  rotate(t: number): void {
    this.ctm = mul(this.ctm, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
  }
  save(): void {
    this.stack.push({
      ctm: this.ctm,
      lw: this.lineWidth,
      stroke: this.strokeStyle,
      fill: this.fillStyle,
    });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.ctm = s.ctm;
    this.lineWidth = s.lw;
    this.strokeStyle = s.stroke;
    this.fillStyle = s.fill;
  }
  setLineDash(_d: number[]): void {
    // Dashes are dropped (solid strokes), schematic dashes are cosmetic and a
    // sketch-style plot is the DXF/PS convention.
  }

  beginPath(): void {
    this.subs = [];
    this.cur = null;
  }
  moveTo(x: number, y: number): void {
    this.cur = { pts: [[x, y]], closed: false };
    this.subs.push(this.cur);
  }
  lineTo(x: number, y: number): void {
    if (!this.cur) {
      this.moveTo(x, y);
      return;
    }
    this.cur.pts.push([x, y]);
  }
  closePath(): void {
    if (this.cur) this.cur.closed = true;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.subs.push({
      pts: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      closed: true,
    });
    this.cur = null;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    let span = a1 - a0;
    if (ccw) {
      if (span > 0) span -= 2 * Math.PI;
    } else if (span < 0) span += 2 * Math.PI;
    const s0: Pt = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    if (this.cur) this.cur.pts.push(s0);
    else this.moveTo(s0[0], s0[1]);
    const steps = Math.max(6, Math.ceil(Math.abs(span) / (Math.PI / 24)));
    for (let i = 1; i <= steps; i++) {
      const a = a0 + span * (i / steps);
      this.cur!.pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }

  private apply(p: Pt): Pt {
    const m = this.ctm;
    return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  }
  private ctmScale(): number {
    return Math.hypot(this.ctm[0], this.ctm[1]) || 1;
  }

  stroke(): void {
    const w = this.lineWidth * this.ctmScale();
    for (const s of this.subs) {
      if (s.pts.length < 2) continue;
      this.emitPolyline(
        s.pts.map((p) => this.apply(p)),
        w,
        this.strokeStyle,
        s.closed,
      );
    }
  }
  fill(): void {
    // One `fill` is one shape, however many subpaths it holds: an outline
    // glyph's rings — an 'O' is its outer ring and its hole — arrive in one
    // path and cancel under non-zero winding. `CALLBACK_GAL::DrawGlyph`
    // (common/callback_gal.cpp:70-78) hands a plotter the same thing after
    // `Fracture()`, one outline per glyph with the holes bridged in; passing
    // the rings together lets each back-end keep that. Emitting them one by
    // one, which this did, painted every hole solid on the PostScript plot.
    const rings = this.subs
      .filter((s) => s.pts.length >= 3)
      .map((s) => s.pts.map((p) => this.apply(p)));
    if (rings.length) this.emitPolygonSet(rings, this.fillStyle);
  }
  /**
   * A filled shape of one or more rings. The default draws each ring as its
   * own polygon, which is right where "filled" means "a closed outline" —
   * DXF, whose `PlotPoly` "Plot[s] outlines with lines (thickness = 0) to
   * define the polygon" (DXF_plotter.cpp:1484-1487) — and wrong wherever
   * the back-end really fills, which overrides it.
   */
  protected emitPolygonSet(rings: Pt[][], color: string): void {
    for (const r of rings) this.emitPolygon(r, color);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const box: Pt[] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    this.emitPolyline(
      box.map((p) => this.apply(p)),
      this.lineWidth * this.ctmScale(),
      this.strokeStyle,
      true,
    );
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const box: Pt[] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    this.emitPolygon(
      box.map((p) => this.apply(p)),
      this.fillStyle,
    );
  }
  fillText(): void {
    // Unreachable while plotting: setVectorText strokes every glyph.
  }
  drawImage(): void {
    // Raster images have no vector representation in DXF / PostScript.
  }

  protected abstract emitPolyline(pts: Pt[], width: number, color: string, closed: boolean): void;
  protected abstract emitPolygon(pts: Pt[], color: string): void;
}

/** DXF (AutoCAD R2000 / AC1015) back-end: one LWPOLYLINE per path, in the
 *  "Export units:" unit (DXF_UNITS::INCH / MM), true-colour (code 420). Y is
 *  flipped because DXF is Y-up. */
class DxfContext extends VectorContext {
  private ents: string[] = [];
  private handle = 0x100;
  /** IU per exported unit: 1 mm, or 25.4 mm for inches. */
  private readonly u: number;
  constructor(
    pw: number,
    ph: number,
    private readonly units: 'in' | 'mm' = 'in',
  ) {
    super(pw, ph);
    this.u = units === 'mm' ? MM : MM * 25.4;
  }
  private X(x: number): string {
    return num(x / this.u);
  }
  private Y(y: number): string {
    return num((this.ph - y) / this.u);
  }
  protected emitPolyline(pts: Pt[], width: number, color: string, closed: boolean): void {
    this.lwpolyline(pts, closed, width, color);
  }
  protected emitPolygon(pts: Pt[], color: string): void {
    // DXF has no simple filled polygon; emit the closed outline (sketch fill).
    this.lwpolyline(pts, true, 0, color);
  }
  private lwpolyline(pts: Pt[], closed: boolean, width: number, color: string): void {
    if (pts.length < 2) return;
    const [r, g, b] = parseColor(color);
    const h = (this.handle++).toString(16).toUpperCase();
    const e: string[] = [
      '0',
      'LWPOLYLINE',
      '5',
      h,
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbPolyline',
      '90',
      String(pts.length),
      '70',
      closed ? '1' : '0',
      '420',
      String((r << 16) | (g << 8) | b),
    ];
    if (width > 0) e.push('43', num(width / this.u));
    for (const p of pts) e.push('10', this.X(p[0]), '20', this.Y(p[1]));
    this.ents.push(e.join('\n'));
  }
  document(): string {
    const seed = this.handle.toString(16).toUpperCase();
    return [
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$ACADVER',
      '1',
      'AC1015',
      // $INSUNITS: 1 = inches, 4 = millimeters (the "Export units:" choice).
      '9',
      '$INSUNITS',
      '70',
      this.units === 'mm' ? '4' : '1',
      '9',
      '$HANDSEED',
      '5',
      seed,
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      ...this.ents.join('\n').split('\n'),
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
  }
}

/** PostScript (Adobe 3.0) back-end: points (1/72"), Y flipped (PS is Y-up). */
class PsContext extends VectorContext {
  private body: string[] = [];
  private K = 72 / (25.4 * MM); // IU -> PostScript points
  private X(x: number): string {
    return num(x * this.K);
  }
  private Y(y: number): string {
    return num((this.ph - y) * this.K);
  }
  private path(pts: Pt[], closed: boolean, newpath = true): string {
    const c = [`${newpath ? 'newpath ' : ''}${this.X(pts[0]![0])} ${this.Y(pts[0]![1])} m`];
    for (let i = 1; i < pts.length; i++) c.push(`${this.X(pts[i]![0])} ${this.Y(pts[i]![1])} l`);
    if (closed) c.push('closepath');
    return c.join(' ');
  }
  protected emitPolyline(pts: Pt[], width: number, color: string, closed: boolean): void {
    if (pts.length < 2) return;
    const [r, g, b] = parseColor(color);
    this.body.push(
      `${this.path(pts, closed)} ${num(width * this.K)} setlinewidth ` +
        `${ps(r)} ${ps(g)} ${ps(b)} setrgbcolor stroke`,
    );
  }
  protected emitPolygon(pts: Pt[], color: string): void {
    if (pts.length < 3) return;
    const [r, g, b] = parseColor(color);
    this.body.push(`${this.path(pts, true)} ${ps(r)} ${ps(g)} ${ps(b)} setrgbcolor fill`);
  }
  /** Every ring in one path, one `fill`: PostScript's `fill` is non-zero winding. */
  protected override emitPolygonSet(rings: Pt[][], color: string): void {
    const [r, g, b] = parseColor(color);
    const path = rings.map((pts, i) => this.path(pts, true, i === 0)).join(' ');
    this.body.push(`${path} ${ps(r)} ${ps(g)} ${ps(b)} setrgbcolor fill`);
  }
  document(title: string): string {
    const w = Math.ceil(this.pw * this.K);
    const h = Math.ceil(this.ph * this.K);
    return [
      '%!PS-Adobe-3.0',
      `%%BoundingBox: 0 0 ${w} ${h}`,
      // Declare the real media size so interpreters don't fall back to US
      // Letter (612 pt) and clip the right edge of a wider sheet.
      `%%DocumentMedia: plot ${w} ${h} 0 () ()`,
      `%%Title: ${title}`,
      '%%Pages: 1',
      '%%EndComments',
      '%%BeginProlog',
      '/m { moveto } bind def',
      '/l { lineto } bind def',
      '1 setlinecap 1 setlinejoin',
      '%%EndProlog',
      '%%Page: 1 1',
      `<< /PageSize [${w} ${h}] >> setpagedevice`,
      ...this.body,
      'showpage',
      '%%Trailer',
      '%%EOF',
      '',
    ].join('\n');
  }
}
/** 0..255 channel -> PostScript 0..1 float. */
function ps(v: number): string {
  return (v / 255).toFixed(3);
}

/**
 * The PDF back-end: the render walk's paths handed to the ported
 * `PDF_PLOTTER` as the primitives `SCH_SCREEN::Plot` would call — a stroke is
 * `MoveTo`/`LineTo`/`FinishTo` (a closed one `PlotPoly( NO_FILL )`), a fill is
 * `PlotPoly( FILLED_SHAPE, 0 )`, colour and pen through `SetColor` and
 * `SetCurrentLineWidth`. The plotter writes the operators, the page's CTM,
 * the compressed stream and the xref; nothing about the file format lives
 * here.
 *
 * A multi-ring fill — an outline glyph's rings — goes the way
 * `CALLBACK_GAL::DrawGlyph` sends one (callback_gal.cpp:70-78): the
 * `SHAPE_POLY_SET` is `Fracture()`d into one simple outline per glyph, holes
 * bridged in, and each outline is one `PlotPoly`.
 */
class PdfContext extends VectorContext {
  constructor(
    private readonly plotter: PdfPlotter,
    pw: number,
    ph: number,
  ) {
    super(pw, ph);
  }
  private static colour(color: string): Color4d {
    const [r, g, b] = parseColor(color);
    return { r: r / 255, g: g / 255, b: b / 255, a: 1 };
  }
  private static vec(pts: Pt[]): Vec2[] {
    return pts.map(([x, y]) => ({ x, y }));
  }
  protected emitPolyline(pts: Pt[], width: number, color: string, closed: boolean): void {
    if (pts.length < 2) return;
    this.plotter.SetColor(PdfContext.colour(color));
    if (closed) {
      this.plotter.PlotPoly(PdfContext.vec(pts), FILL_T.NO_FILL, width);
      return;
    }
    this.plotter.SetCurrentLineWidth(width);
    this.plotter.MoveTo({ x: pts[0]![0], y: pts[0]![1] });
    for (let i = 1; i < pts.length - 1; i++) this.plotter.LineTo({ x: pts[i]![0], y: pts[i]![1] });
    const last = pts[pts.length - 1]!;
    this.plotter.FinishTo({ x: last[0], y: last[1] });
  }
  protected emitPolygon(pts: Pt[], color: string): void {
    if (pts.length < 3) return;
    this.plotter.SetColor(PdfContext.colour(color));
    this.plotter.PlotPoly(PdfContext.vec(pts), FILL_T.FILLED_SHAPE, 0);
  }
  protected override emitPolygonSet(rings: Pt[][], color: string): void {
    if (rings.length === 1) {
      this.emitPolygon(rings[0]!, color);
      return;
    }
    this.plotter.SetColor(PdfContext.colour(color));
    // An OUTLINE_GLYPH is a SHAPE_POLY_SET of VECTOR2I: whole IU before the
    // fracture, as `KiROUND` fills one.
    const whole = rings.map((r) => r.map(([x, y]) => ({ x: KiROUND(x), y: KiROUND(y) })));
    for (const outline of fracture(nestRings(whole)))
      this.plotter.PlotPoly(outline, FILL_T.FILLED_SHAPE, 0);
  }
}

/**
 * Rings from one non-zero fill, sorted into `SHAPE_POLY_SET` polygons — an
 * outline and the holes directly inside it — by containment depth, the way
 * `OUTLINE_FONT` builds a glyph (`AddOutline` for a filled contour,
 * `AddHole` for the one it sits in). Even depth is an outline, odd a hole of
 * the innermost ring around it.
 */
function nestRings(rings: Vec2[][]): Polygon[] {
  const inside = (p: Vec2, ring: Vec2[]): boolean => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const containers = rings.map((r, i) =>
    rings.map((_, j) => j).filter((j) => j !== i && inside(r[0]!, rings[j]!)),
  );
  const polygons: Polygon[] = [];
  const outlineOf = new Map<number, Polygon>();
  rings.forEach((r, i) => {
    if (containers[i]!.length % 2 === 0) {
      const poly: Polygon = [r];
      outlineOf.set(i, poly);
      polygons.push(poly);
    }
  });
  rings.forEach((r, i) => {
    const around = containers[i]!;
    if (around.length % 2 === 0) return;
    // The innermost ring around a hole is the one with the most containers.
    const owner = around.reduce((best, j) =>
      containers[j]!.length > containers[best]!.length ? j : best,
    );
    outlineOf.get(owner)?.push(r);
  });
  return polygons;
}

/** Plot the sheet to a true-vector DXF (AutoCAD) drawing. */
export function sheetToDxf(sch: Schematic, base: Theme, opts: PlotOpts): string {
  const page = plotPageIU(sch, opts);
  return renderToVector(
    sch,
    base,
    opts,
    new DxfContext(page.w, page.h, opts.dxfUnits ?? 'in'),
    (c) => c.document(),
  );
}
/** Plot the sheet to a single-page Adobe PostScript document. */
export function sheetToPs(sch: Schematic, base: Theme, opts: PlotOpts, title: string): string {
  const page = plotPageIU(sch, opts);
  return renderToVector(sch, base, opts, new PsContext(page.w, page.h), (c) => c.document(title));
}
/** Run the shared render walk into a vector context and serialise it. */
function renderToVector<C extends VectorContext>(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  ctx: C,
  done: (c: C) => string,
): string {
  const page = plotPageIU(sch, opts);
  const theme = outputTheme(base, opts);
  setVectorText(true);
  try {
    renderSchematic(
      ctx as unknown as CanvasRenderingContext2D,
      sch,
      { scale: page.scale, offsetX: 0, offsetY: 0 },
      theme,
      page.w,
      page.h,
      undefined,
      undefined,
      outputRenderOpts(opts, sch),
    );
  } finally {
    setVectorText(false);
  }
  return done(ctx);
}

/** Plot to DXF. */
export function plotDxf(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  name: string,
  sink: PlotSink = downloadBlob,
): void {
  sink(new Blob([sheetToDxf(sch, base, opts)], { type: 'application/dxf' }), `${name}.dxf`);
}
/** Plot to PostScript. */
export function plotPs(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  name: string,
  sink: PlotSink = downloadBlob,
): void {
  sink(
    new Blob([sheetToPs(sch, base, opts, name)], { type: 'application/postscript' }),
    `${name}.ps`,
  );
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- minimal single-image PDF ---------------------------------------------

// ----- Print (browser) -------------------------------------------------------

/** One page of a print job: a sheet document and its render options. */
export interface PrintPage {
  sch: Schematic;
  opts: PlotOpts;
}

/**
 * Open the browser print flow for a multi-page job, SCH_PRINTOUT prints the
 * whole hierarchy, one page per sheet instance in SCH_SHEET_LIST order.
 * Colour output prints as-is; B&W forces the monochrome theme (outputTheme).
 * "Print" auto-opens the browser print flow once the last page has loaded;
 * "Print Preview" (KiCad's Apply) just shows the rendered pages. The page
 * orientation follows the first sheet (CSS `@page` is per-document, unlike
 * wxPrintout's per-page setup).
 */
export function printSheets(
  pages: readonly PrintPage[],
  base: Theme,
  title: string,
  preview = false,
): void {
  if (pages.length === 0) return;
  const dataUrls = pages.map(({ sch, opts }) =>
    renderSheetToCanvas(sch, opts.color ? base : KICAD_CLASSIC, opts, 300).toDataURL('image/png'),
  );
  const first = pageIU(pages[0]!.sch);
  const landscape = first.w >= first.h;
  const win = window.open('', '_blank');
  if (!win) return;
  const onload = preview ? 'window.focus();' : 'window.focus();window.print();';
  win.document.write(
    `<!doctype html><html><head><title>${escText(title)}</title>` +
      `<style>@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 0; }` +
      `html,body { margin: 0; padding: 0; }` +
      `img { display: block; width: 100%; height: auto; page-break-after: always; }` +
      `img:last-child { page-break-after: auto; }</style></head>` +
      `<body>${dataUrls
        .map((u, i) => `<img src="${u}"${i === dataUrls.length - 1 ? ` onload="${onload}"` : ''}/>`)
        .join('')}</body></html>`,
  );
  win.document.close();
}

/** Single-sheet convenience wrapper over printSheets. */
export function printSheet(
  sch: Schematic,
  base: Theme,
  opts: PlotOpts,
  title: string,
  preview = false,
): void {
  printSheets([{ sch, opts }], base, title, preview);
}
