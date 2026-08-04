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
 * These assert the document's structure rather than its pixels — the pages are
 * the same rendered images either way, so what changed is the container.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { plotPdf, plotPdfSheets } from '@ziroeda/designer/src/editors/schematic/render/plot.js';
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

const opts = { blackAndWhite: false, dpi: 72 } as never;

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
    expect(text.startsWith('%PDF-1.4')).toBe(true);
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
    // One image XObject per page, not one shared between them.
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(3);
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
    // Objects 1..9 for two pages: catalog, page tree, three per page, info.
    // /Size counts the free object 0 as well, so it is one more than that.
    expect(size).toBe(10);
    const rows = text.slice(text.indexOf('xref')).match(/^\d{10} \d{5} [nf] $/gm) ?? [];
    expect(rows).toHaveLength(size);
    for (let i = 1; i < size; i++) {
      const at = Number(rows[i]!.slice(0, 10));
      expect(text.startsWith(`${i} 0 obj`, at), `object ${i}`).toBe(true);
    }
  });
});
