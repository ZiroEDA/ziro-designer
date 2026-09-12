// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PDF annotations a schematic page carries: what each item's `Plot()`
 * hands the plotter beside its geometry —
 *
 *  - `SCH_SHEET::Plot` (sch_sheet.cpp:1429-1448): a sheet is a clickable link
 *    to its page, or, without links, a property popup led by that link;
 *  - `SCH_SYMBOL::Plot` (sch_symbol.cpp:3352-3380): a popup of the non-empty
 *    fields plus the library keywords, and a bookmark under "Symbols" for
 *    every symbol that is not a power symbol;
 *  - `SCH_LABEL_BASE::Plot` (sch_label.cpp:1539-1590): a hierarchical label
 *    links to the parent page and a sheet pin to the child page; otherwise
 *    a popup of the net and its resolved netclass; and every hierarchical
 *    label is bookmarked under "Hierarchical Labels";
 *  - `SCH_LINE::Plot` (sch_line.cpp:906-938): a wire's popup is its net and
 *    netclass, a bus's the member nets;
 *  - `SCH_TEXT::Plot` / `SCH_TEXTBOX::Plot` (sch_text.cpp:618, sch_textbox.cpp
 *    :450): a text with a hyperlink is a link box.
 *
 * `m_PDFHierarchicalLinks` and `m_PDFPropertyPopups` gate the links and the
 * popups; the bookmarks are unconditional. The boxes are each item's
 * `GetBoundingBox()` (the label's `GetBodyBoundingBox()`), in the page's
 * plot units — the same scale the render walk drew at.
 *
 * Not carried: the intersheet-references field's page menu
 * (sch_field.cpp:1384-1400), which needs the page list behind the
 * `${INTERSHEET_REFS}` text rather than the text alone.
 */
import type { LibSymbol, SchField, SchLabel, SchSymbol, Schematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { schSymbolLibraryName } from '@ziroeda/eeschema/src/lib_symbol_compare.js';
import { fieldShownText, fieldTextBox } from '@ziroeda/eeschema/src/fieldbox.js';
import {
  emptyBBox,
  includePoint,
  isEmpty,
  labelBox,
  sheetPinBBox,
  symbolBodyBBox,
  type BBox,
} from '@ziroeda/eeschema/src/tools/bbox.js';
import type { PdfBox2, PdfPlotter } from '@ziroeda/pcbnew/src/plot_pdf.js';

/** What the sheet's connectivity knows about a wire, bus or label. */
export interface PdfNetInfo {
  /** `SCH_CONNECTION::Name()`. */
  net: string;
  /** `GetEffectiveNetClass()->GetHumanReadableName()`. */
  netclass: string;
  /** A bus connection's `Members()`, by name. */
  members?: readonly string[];
  /**
   * `SCH_LINE::GetPenWidth()` for a line: its own stroke, else the netclass
   * width, else the schematic's default wire or bus width — the same answer
   * the render walk drew it with.
   */
  penWidth?: number;
}

export interface PdfAnnotationContext {
  /** `SCH_PLOT_OPTS::m_PDFHierarchicalLinks`. */
  hierarchicalLinks: boolean;
  /** `SCH_PLOT_OPTS::m_PDFPropertyPopups`. */
  propertyPopups: boolean;
  /**
   * The parent sheet's page number when this page is not a root
   * (`sheet->size() >= 2`): where a hierarchical label links to.
   */
  parentPageNumber?: string;
  /** `findSelf().GetPageNumber()` for the sheet symbol with this uuid: the page it opens. */
  childPageNumber: (sheetUuid: string) => string | undefined;
  /** The net of a wire, bus or label item (by refId), when connected. */
  netOf?: (itemId: string) => PdfNetInfo | undefined;
  /** `GetShownText`'s `${VAR}` resolver, by token; undefined leaves the token. */
  resolve?: (token: string) => string | undefined;
  /** The plot's page scale (`plotPageIU().scale`): drawing IU → plot IU. */
  scale: number;
}

/** `EDA_TEXT::GotoPageHref`: `"#" + page`. */
export const gotoPageHref = (page: string): string => `#${page}`;

export function plotPdfAnnotations(
  plotter: PdfPlotter,
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  ctx: PdfAnnotationContext,
): void {
  const box = (b: BBox): PdfBox2 => ({
    pos: { x: b.minX * ctx.scale, y: b.minY * ctx.scale },
    size: { x: (b.maxX - b.minX) * ctx.scale, y: (b.maxY - b.minY) * ctx.scale },
  });
  /** `ExpandTextVars` over the resolver: every `${TOKEN}` it answers. */
  const shown = (text: string): string =>
    ctx.resolve
      ? text.replace(/\$\{([^}]*)\}/g, (whole, name: string) => ctx.resolve!(name) ?? whole)
      : text;
  const merge = (into: BBox, b: BBox): void => {
    includePoint(into, { x: b.minX, y: b.minY });
    includePoint(into, { x: b.maxX, y: b.maxY });
  };
  /** `SCH_FIELD::GetBoundingBox` for a visible field, rotated for a vertical one. */
  const fieldBox = (f: SchField, text: string): BBox | null => {
    if (f.effects?.hidden || f.at === undefined) return null;
    const tb = fieldTextBox(f, text);
    const b: BBox = { minX: tb.x, minY: tb.y, maxX: tb.x + tb.w, maxY: tb.y + tb.h };
    if (f.angle % 180 === 0) return b;
    // A 90° field: the box turned about the anchor.
    const r = (x: number, y: number) => ({
      x: f.at!.x - (y - f.at!.y),
      y: f.at!.y + (x - f.at!.x),
    });
    const out = emptyBBox();
    includePoint(out, r(b.minX, b.minY));
    includePoint(out, r(b.maxX, b.maxY));
    return out;
  };

  // SCH_SHEET::Plot
  sch.sheets.forEach((s) => {
    const b: BBox = {
      minX: s.at.x,
      minY: s.at.y,
      maxX: s.at.x + s.size.w,
      maxY: s.at.y + s.size.h,
    };
    // `SCH_SHEET::GetBoundingBox`: the body plus the visible fields.
    for (const f of s.fields) {
      const fb = fieldBox(f, shown(f.value));
      if (fb) merge(b, fb);
    }
    const page = s.uuid ? ctx.childPageNumber(s.uuid) : undefined;
    if (page === undefined) return;
    if (ctx.hierarchicalLinks) {
      plotter.HyperlinkBox(box(b), gotoPageHref(page));
    } else if (ctx.propertyPopups) {
      const properties = [gotoPageHref(page)];
      for (const f of s.fields) properties.push(`!${f.key} = ${shown(f.value)}`);
      plotter.HyperlinkMenu(box(b), properties);
    }
    // Sheet pins: SCH_LABEL_BASE::Plot's SCH_SHEET_PIN_T branch.
    for (const pin of s.pins) {
      const pb = sheetPinBBox(pin);
      if (ctx.hierarchicalLinks) plotter.HyperlinkBox(box(pb), gotoPageHref(page));
      else if (ctx.propertyPopups) {
        const info = pin.uuid ? ctx.netOf?.(refId('sheetpin', pin.uuid, 0)) : undefined;
        if (info)
          plotter.HyperlinkMenu(box(pb), [
            `!Net = ${info.net}`,
            `!Resolved netclass = ${info.netclass}`,
          ]);
      }
    }
  });

  // SCH_SYMBOL::Plot
  sch.symbols.forEach((sym: SchSymbol) => {
    const lib = libById.get(schSymbolLibraryName(sym));
    const unitCount = lib ? Math.max(1, ...lib.units.map((u) => u.unit)) : 1;
    const b = symbolBodyBBox(sym, lib);
    const texts = sym.fields.map((f) => shown(fieldShownText(f, sym, unitCount)));
    sym.fields.forEach((f, i) => {
      const fb = fieldBox(f, texts[i]!);
      if (fb) merge(b, fb);
    });
    if (ctx.propertyPopups) {
      const properties: string[] = [];
      sym.fields.forEach((f, i) => {
        if (texts[i] !== '') properties.push(`!${f.key} = ${texts[i]}`);
      });
      const keywords = lib?.properties.find((p) => p.key === 'ki_keywords')?.value ?? '';
      if (keywords !== '') properties.push(`!Keywords = ${keywords}`);
      plotter.HyperlinkMenu(box(b), properties);
    }
    if (!lib?.isPower) {
      const ref = sym.fields.find((f) => f.key === 'Reference');
      plotter.Bookmark(box(b), ref ? texts[sym.fields.indexOf(ref)]! : '', 'Symbols');
    }
  });

  // SCH_LABEL_BASE::Plot and SCH_TEXT::Plot
  sch.labels.forEach((l: SchLabel, i) => {
    const b = labelBox(l);
    if (l.kind === 'text') {
      if (l.hyperlink) plotter.HyperlinkBox(box(b), l.hyperlink);
      return;
    }
    let linkAlreadyPlotted = false;
    if (ctx.hierarchicalLinks && l.kind === 'hierarchical_label' && ctx.parentPageNumber) {
      plotter.HyperlinkBox(box(b), gotoPageHref(ctx.parentPageNumber));
      linkAlreadyPlotted = true;
    }
    if (ctx.propertyPopups && !linkAlreadyPlotted) {
      const info = ctx.netOf?.(refId('label', l.uuid, i));
      if (info)
        plotter.HyperlinkMenu(box(b), [
          `!Net = ${info.net}`,
          `!Resolved netclass = ${info.netclass}`,
        ]);
    }
    if (l.kind === 'hierarchical_label')
      plotter.Bookmark(box(b), shown(l.text), 'Hierarchical Labels');
  });

  // SCH_TEXTBOX::Plot
  sch.textBoxes.forEach((t) => {
    if (!t.hyperlink) return;
    const b = emptyBBox();
    includePoint(b, t.start);
    includePoint(b, t.end);
    plotter.HyperlinkBox(box(b), t.hyperlink);
  });

  // SCH_LINE::Plot
  if (ctx.propertyPopups && ctx.netOf) {
    sch.lines.forEach((l, i) => {
      if (l.kind !== 'wire' && l.kind !== 'bus') return;
      const info = ctx.netOf!(refId('line', l.uuid, i));
      if (!info) return;
      const properties =
        l.kind === 'wire'
          ? [`!Net = ${info.net}`, `!Resolved netclass = ${info.netclass}`]
          : (info.members ?? []).map((m) => `!${m}`);
      if (properties.length === 0) return;
      // `SCH_LINE::GetBoundingBox`: the ends, out by half the pen, plus one.
      const width = Math.trunc((info.penWidth ?? l.stroke?.width ?? 0) / 2);
      const b: BBox = {
        minX: Math.min(l.start.x, l.end.x) - width,
        minY: Math.min(l.start.y, l.end.y) - width,
        maxX: Math.max(l.start.x, l.end.x) + width + 1,
        maxY: Math.max(l.start.y, l.end.y) + width + 1,
      };
      if (!isEmpty(b)) plotter.HyperlinkMenu(box(b), properties);
    });
  }
}
