// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PDF plotting, counterpart `SCH_PLOTTER::createPDFFile`.
 *
 * The gap this closes: "All pages" wrote **one PDF per sheet**, so a
 * twelve-sheet design gave you twelve files to keep together by hand. Upstream
 * opens the file once and pages through the sheet list. Every other format is
 * one file per sheet because those formats have no page after the first; PDF
 * has, and should use it.
 *
 * And the pages are vector (#377): the render walk's paths handed to the ported
 * `PDF_PLOTTER`, so a wire is `m … l S` in the content stream and a glyph is a
 * filled path, not a JPEG of the sheet. The streams are zlib-compressed as
 * KiCad writes them; the tests inflate them to read the operators back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { unzlibSync } from '../../../designer/node_modules/fflate/esm/index.mjs';
import {
  plotPdf,
  plotPdfSheets,
  sheetsToPdf,
} from '@ziroeda/designer/src/editors/schematic/render/plot.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** A tiny canvas stand-in: the renderer draws into it, we only need its bytes. */
class FakeCanvas {
  width = 64;
  height = 48;
  getContext(): unknown {
    return new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'canvas') return { width: 64, height: 48 };
          if (prop === 'measureText') return () => ({ width: 0 });
          return () => undefined;
        },
        set: () => true,
      },
    );
  }
  toDataURL(): string {
    // A one-pixel JPEG is enough: the writer embeds whatever bytes it is given.
    return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQ==';
  }
}

class FakePath2D {
  rect(): void {}
  moveTo(): void {}
  lineTo(): void {}
}

const origCreate = globalThis.document?.createElement;
const origPath = globalThis.Path2D;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : {}),
  };
  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
});
afterAll(() => {
  if (origCreate) (globalThis.document as { createElement: unknown }).createElement = origCreate;
  (globalThis as { Path2D?: unknown }).Path2D = origPath;
});

const sheet = (paper: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (paper "${paper}") (lib_symbols))`));

const opts = { color: true, drawingSheet: false, background: false } as never;

/** Every page content stream of `bytes`, inflated. */
function contentStreams(bytes: Uint8Array): string[] {
  const latin1 = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const out: string[] = [];
  const re = /<< \/Length \d+ 0 R \/Filter \/FlateDecode >>\nstream\n/g;
  let m: RegExpExecArray | null = re.exec(latin1);
  while (m) {
    const start = m.index + m[0].length;
    const end = latin1.indexOf('\nendstream', start);
    const inflated = unzlibSync(bytes.subarray(start, end));
    out.push(Array.from(inflated, (b) => String.fromCharCode(b)).join(''));
    m = re.exec(latin1);
  }
  return out;
}

async function pdfText(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Latin-1: the structure is ASCII and the JPEG bytes must not be mangled by
  // a UTF-8 decode that would replace them.
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

describe('a single sheet', () => {
  it('is a one-page document', async () => {
    let blob: Blob | null = null;
    await plotPdf(sheet('A4'), KICAD_DEFAULT, opts, 'one', (b) => {
      blob = b;
    });
    const text = await pdfText(blob!);
    // PDF_PLOTTER::StartPlot writes 1.5, and the binary-marker comment after it.
    expect(text.startsWith('%PDF-1.5\n%')).toBe(true);
    expect(text).toContain('/Count 1');
    expect(text.match(/\/Type \/Page[^s]/g)).toHaveLength(1);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});

describe('a hierarchy', () => {
  it('is one document with a page per sheet', async () => {
    // The whole point: twelve sheets used to be twelve files.
    let blob: Blob | null = null;
    let name = '';
    await plotPdfSheets(
      [
        { sch: sheet('A4'), opts },
        { sch: sheet('A4'), opts },
        { sch: sheet('A4'), opts },
      ],
      KICAD_DEFAULT,
      'proj',
      (b, f) => {
        blob = b;
        name = f;
      },
    );
    expect(name).toBe('proj.pdf');
    const text = await pdfText(blob!);
    expect(text).toContain('/Count 3');
    expect(text.match(/\/Type \/Page[^s]/g)).toHaveLength(3);
    // One content stream per page, and no raster anywhere: the page IS the
    // drawing, not a picture of it.
    expect(text.match(/\/Filter \/FlateDecode/g)).toHaveLength(3);
    expect(text).not.toContain('/Subtype /Image');
  });

  it('gives each page its own size, because sheets can use different paper', async () => {
    let blob: Blob | null = null;
    await plotPdfSheets(
      [
        { sch: sheet('A4'), opts },
        { sch: sheet('A3'), opts },
      ],
      KICAD_DEFAULT,
      'proj',
      (b) => {
        blob = b;
      },
    );
    const boxes = (await pdfText(blob!)).match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toEqual(boxes[1]); // A3 is not A4
  });

  it('writes nothing at all for an empty job', async () => {
    // "Nothing to write" is the caller's error to report; silently emitting an
    // empty PDF would look like success.
    let called = false;
    await plotPdfSheets([], KICAD_DEFAULT, 'proj', () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});

describe('the cross-reference table', () => {
  it('points at every object it declares', async () => {
    // A wrong xref is the classic way to produce a PDF that opens in one viewer
    // and not another, and it is exactly what a hand-numbered multi-page writer
    // gets wrong.
    let blob: Blob | null = null;
    await plotPdfSheets(
      [
        { sch: sheet('A4'), opts },
        { sch: sheet('A4'), opts },
      ],
      KICAD_DEFAULT,
      'proj',
      (b) => {
        blob = b;
      },
    );
    const text = await pdfText(blob!);
    const size = Number(/\/Size (\d+)/.exec(text)![1]);
    const rows = text.slice(text.indexOf('xref')).match(/^\d{10} \d{5} [nf] $/gm) ?? [];
    expect(rows).toHaveLength(size);
    for (let i = 1; i < size; i++) {
      const at = Number(rows[i]!.slice(0, 10));
      expect(text.startsWith(`${i} 0 obj`, at), `object ${i}`).toBe(true);
    }
  });
});

describe('the page is vector', () => {
  const wired = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
        (wire (pts (xy 50 50) (xy 100 50)) (stroke (width 0) (type default)) (uuid "w1"))
        (label "NET_A" (at 50 50 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "l1")))`),
    );

  it('strokes a wire as a path, in the decimil user space StartPage s CTM sets up', () => {
    const [page] = contentStreams(sheetsToPdf([{ sch: wired(), opts }], KICAD_DEFAULT));
    // StartPage: `0.0072 0 0 0.0072 0 0 cm 1 J 1 j 0 0 0 rg 0 0 0 RG … w`.
    expect(page!.startsWith('0.0072 0 0 0.0072 0 0 cm 1 J 1 j 0 0 0 rg 0 0 0 RG')).toBe(true);
    // The wire, (50,50)-(100,50) mm = 19685.04-39370.08 decimils across, on
    // an A4 landscape page 82680 decimils tall (8268 mils, PAGE_INFO's A4),
    // y flipped: 82680 - 19685.04.
    // PenTo writes `{:f}`, six decimals, one operator per line.
    expect(page).toMatch(/19685\.03937\d 62994\.96063\d m\n39370\.07874\d 62994\.96063\d l\nS\n/);
    // The label is stroke-font segments, not a text object and not an image.
    expect(page!.match(/ l\n/g)!.length).toBeGreaterThan(10);
    expect(page).not.toContain('BT');
    expect(page).not.toContain('Do');
  });

  it('paints in the wire colour of the theme, and black in black-and-white', () => {
    const colour = contentStreams(sheetsToPdf([{ sch: wired(), opts }], KICAD_DEFAULT))[0]!;
    const rgb = colour.match(/([\d.]+) ([\d.]+) ([\d.]+) RG/g) ?? [];
    // KICAD_DEFAULT's wire is rgb(0, 150, 0): `0 0.588235 0 RG`, not black.
    expect(rgb).toContain('0 0.588235 0 RG');
    const bw = contentStreams(
      sheetsToPdf([{ sch: wired(), opts: { ...opts, color: false } }], KICAD_DEFAULT),
    )[0]!;
    expect(bw.match(/([\d.]+) ([\d.]+) ([\d.]+) RG/g)!.every((c) => c === '0 0 0 RG')).toBe(true);
  });

  it('a filled shape with a hole is one fractured outline, filled', () => {
    // A circle-ish rectangle with a hole cannot be written from a schematic
    // directly, but an outline glyph is — see plot_outline_text.test.ts. Here
    // the fill path is checked at the operator level: a filled rectangle is
    // `m l l l h f`, not stroked.
    const doc = readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
        (rectangle (start 10 10) (end 20 20) (stroke (width 0) (type default))
          (fill (type color) (color 255 0 0 1)) (uuid "r1")))`),
    );
    const [page] = contentStreams(sheetsToPdf([{ sch: doc, opts }], KICAD_DEFAULT));
    // `PlotPoly( FILLED_SHAPE, 0 )`: one `w` for the clamped zero pen, the
    // corners at six decimals, then `h f` — closed and filled, no stroke.
    expect(page).toMatch(/1 0 0 rg 1 0 0 RG\n[\d.]+ w\n[\d.]+ [\d.]+ m ([\d.]+ [\d.]+ l ){3}h f\n/);
  });
});

describe('the page carries what each item s Plot() adds beside its geometry', () => {
  // A root with a sheet symbol and a wire, and the child sheet with a
  // hierarchical label: SCH_SHEET::Plot, SCH_SYMBOL::Plot, SCH_LABEL_BASE::Plot
  // and SCH_LINE::Plot each hand the plotter an annotation.
  const ROOT = `(kicad_sch (version 20250114) (paper "A4")
    (lib_symbols
      (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (property "Value" "R" (at 0 0 0))
        (property "ki_keywords" "res resistor" (at 0 0 0))
        (symbol "R_0_1" (rectangle (start -1 1) (end 1 -1)))))
    (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 52 48 0)) (property "Value" "10k" (at 52 52 0))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) hide)))
    (wire (pts (xy 60 60) (xy 80 60)) (stroke (width 0) (type default)) (uuid "w1"))
    (text "see the datasheet" (at 20 90 0) (effects (font (size 1.27 1.27))) (hyperlink "https://example.com/ds") (uuid "t1"))
    (sheet (at 100 20) (size 30 20) (uuid "s1")
      (property "Sheetname" "Child" (at 100 19 0)) (property "Sheetfile" "child.kicad_sch" (at 100 41 0))
      (pin "IN" input (at 100 30 180) (effects (font (size 1.27 1.27))) (uuid "p1"))))`;
  const CHILD = `(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
    (hierarchical_label "IN" (shape input) (at 30 30 0) (effects (font (size 1.27 1.27))) (uuid "h1")))`;
  const netOf = (id: string) =>
    id === 'w1' ? { net: '/NET_A', netclass: 'Default', penWidth: 1524 } : undefined;
  const plot = (flags: { pdfHierarchicalLinks?: boolean; pdfPropertyPopups?: boolean }) => {
    const root = readSchematic(parse(ROOT));
    const child = readSchematic(parse(CHILD));
    const libById = new Map(root.libSymbols.map((l) => [l.libId, l]));
    const bytes = sheetsToPdf(
      [
        {
          sch: root,
          opts: { ...opts, ...flags, pageNumber: '1', libById, netOf },
          childPages: new Map([['s1', '2']]),
        },
        {
          sch: child,
          opts: { ...opts, ...flags, pageNumber: '2', sheetName: 'Child', libById },
          parent: { pageNumber: '1', sheetName: '' },
        },
      ],
      KICAD_DEFAULT,
    );
    return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  };
  const annots = (text: string): string[] =>
    text.match(/\/Type \/Annot\n\/Subtype \/Link\n[\s\S]*?\nendobj/g) ?? [];

  it('with hierarchical links: the sheet, its pin and the child s label are /Dest links', () => {
    const text = plot({ pdfHierarchicalLinks: true });
    const links = annots(text).filter((a) => a.includes('/Dest ['));
    // Sheet + sheet pin → page 2; hierarchical label → page 1: three GoTo links.
    expect(links).toHaveLength(3);
    // …and the text's URL is an /S /URI action, not a page.
    expect(text).toContain('/S /URI /URI (https://example.com/ds)');
    // No popups were asked for: no menu annotation (EndPlot's JSInit is the
    // one JavaScript action every document carries).
    expect(annots(text).filter((a) => a.includes('/S /JavaScript'))).toHaveLength(0);
  });

  it('with property popups: the symbol s fields, the sheet s link-led menu, the wire s net', () => {
    const text = plot({ pdfPropertyPopups: true });
    const menus = annots(text).filter((a) => a.includes('/S /JavaScript'));
    // SCH_SYMBOL: `!Name = value` for every non-empty field plus the keywords;
    // the hidden, empty Footprint is skipped.
    // buildMenuJs strips the `!` that marks a label rather than a link.
    const symbolMenu = menus.find((m) => m.includes('["Reference = R1"]'));
    expect(symbolMenu).toBeDefined();
    expect(symbolMenu).toContain('["Value = 10k"]');
    expect(symbolMenu).toContain('["Keywords = res resistor"]');
    expect(symbolMenu).not.toContain('Footprint');
    // SCH_SHEET without links: the page link first, then the fields.
    // The `#2` entry becomes `["Show Page 2", "#<index>"]` — the second page.
    const sheetMenu = menus.find((m) => m.includes('["Sheetname = Child"]'));
    expect(sheetMenu).toContain('["Show Page 2", "#1"]');
    expect(sheetMenu).toContain('["Sheetfile = child.kicad_sch"]');
    // SCH_LINE: net and resolved netclass. (A net whose name starts with `/`
    // — every sheet-local net — reads to buildMenuJs as a file path, so the
    // entry carries a `file:///NET_A` href. Upstream's, and reproduced.)
    expect(
      menus.some(
        (m) =>
          m.includes('["Net = /NET_A", "file:///NET_A"]') &&
          m.includes('["Resolved netclass = Default"]'),
      ),
    ).toBe(true);
    // No page links.
    expect(text).not.toContain('/Dest [');
  });

  it('bookmarks the symbol under "Symbols" and the hierarchical label under its group, always', () => {
    const text = plot({});
    expect(text).toContain('/Title (Symbols)');
    expect(text).toContain('/Title (R1)');
    expect(text).toContain('/Title (Hierarchical Labels)');
    expect(text).toContain('/Title (IN)');
    // The child page's outline entry names the sheet and hangs off page 1's.
    expect(text).toContain('/Title (Child \\(Page 2\\))');
  });
});
