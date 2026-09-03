// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Opening a demo from its one-object bundle.
 *
 * Every failure here is quiet. A bundle that drops files opens a board with
 * missing footprints, which reads as a bad demo rather than a bad fetch. A
 * bundle whose entry names lose the project prefix breaks `${KIPRJMOD}` model
 * resolution and the project's own name, silently. And an extras fetch that
 * does not notice the bundle already delivered everything re-downloads 43 MB
 * of 3D models the moment somebody saves a copy — which works, just slowly,
 * which is the whole class of bug the bundle exists to remove.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DemoMeta, fetchDemoExtras, openDemo } from '@ziroeda/designer/src/home/demos.js';
import { zipArchive } from '@ziroeda/designer/src/home/project_archiver.js';

const enc = new TextEncoder();

/** A demo whose files include two deferrable ones (a STEP body and a PDF). */
const DEMO: DemoMeta = {
  id: 'demo_group/widget',
  base: 'widget',
  title: 'Widget',
  description: 'test',
  files: ['widget.kicad_pro', 'widget.kicad_sch', 'lib/part.step', 'doc/sheet.pdf'],
  bundleBytes: 1,
};

const CONTENT: Record<string, string> = {
  'widget.kicad_pro': '{"meta":{}}',
  'widget.kicad_sch': '(kicad_sch)',
  'lib/part.step': 'ISO-10303-21;',
  'doc/sheet.pdf': '%PDF-1.4',
};

const bundleBytes = (): Uint8Array =>
  zipArchive(Object.fromEntries(Object.entries(CONTENT).map(([k, v]) => [k, enc.encode(v)])));

/** Serve the bundle at its URL and 404 everything else, counting both. */
function stubFetch(bundle: Uint8Array | null): { bundleHits: number; fileHits: string[] } {
  const seen = { bundleHits: 0, fileHits: [] as string[] };
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/bundle.zip')) {
      seen.bundleHits++;
      if (!bundle) return { ok: false, status: 404, body: null, headers: new Headers() };
      return {
        ok: true,
        status: 200,
        body: null, // exercise the arrayBuffer path; streaming is covered by the browser
        headers: new Headers(),
        arrayBuffer: async () => bundle.buffer.slice(0) as ArrayBuffer,
      };
    }
    const rel = decodeURIComponent(url.split(`${DEMO.id}/`)[1] ?? '');
    seen.fileHits.push(rel);
    const text = CONTENT[rel];
    if (text === undefined) return { ok: false, status: 404, headers: new Headers() };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => enc.encode(text).buffer as ArrayBuffer,
    };
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a bundled demo opens in one request', () => {
  it('yields every file, 3D models included, prefixed by the project folder', async () => {
    const seen = stubFetch(bundleBytes());

    const files = await openDemo(DEMO);

    expect(seen.bundleHits).toBe(1);
    // Nothing was fetched file-by-file: that is the point of the bundle.
    expect(seen.fileHits).toEqual([]);

    // The whole project, not the openable subset. `lib/part.step` and the PDF
    // are exactly what the old path deferred; a bundle defers nothing, so no
    // later fetch can stall the user mid-edit.
    expect(files.map((f) => f.name).sort()).toEqual([
      'widget/doc/sheet.pdf',
      'widget/lib/part.step',
      'widget/widget.kicad_pro',
      'widget/widget.kicad_sch',
    ]);
    expect(files.find((f) => f.name === 'widget/lib/part.step')?.text).toBe('ISO-10303-21;');
  });

  it('reports progress and still yields bytes for each file', async () => {
    stubFetch(bundleBytes());
    const files = await openDemo(DEMO);
    for (const f of files) expect(f.bytes && f.bytes.length > 0).toBe(true);
  });
});

describe('the bundle is an optimisation, not a format', () => {
  it('falls back to per-file fetches when the bundle is missing', async () => {
    const seen = stubFetch(null); // 404

    const files = await openDemo(DEMO);

    expect(seen.bundleHits).toBe(1);
    // The old path, which fetches only what is needed to open the project.
    expect(seen.fileHits.sort()).toEqual(['widget.kicad_pro', 'widget.kicad_sch']);
    expect(files.map((f) => f.name).sort()).toEqual([
      'widget/widget.kicad_pro',
      'widget/widget.kicad_sch',
    ]);
  });

  it('falls back when the bundle is corrupt rather than opening nothing', async () => {
    const seen = stubFetch(enc.encode('this is not a zip'));

    const files = await openDemo(DEMO);

    expect(seen.fileHits.length).toBeGreaterThan(0);
    expect(files.length).toBe(2);
  });

  it('does not look for a bundle when the manifest declares none', async () => {
    const seen = stubFetch(bundleBytes());
    const { bundleBytes: _omitted, ...noBundle } = DEMO;

    await openDemo(noBundle);

    expect(seen.bundleHits).toBe(0);
  });
});

describe('keeping a demo does not re-download what it already has', () => {
  it('fetches no extras when the bundle delivered them', async () => {
    const seen = stubFetch(bundleBytes());
    const files = await openDemo(DEMO);

    const extras = await fetchDemoExtras(
      DEMO,
      files.map((f) => f.name),
    );

    expect(extras).toEqual([]);
    // 43 MB of STEP in the real CM5 demo; here, simply nothing.
    expect(seen.fileHits).toEqual([]);
  });

  it('still fetches extras for a demo that arrived file-by-file', async () => {
    const seen = stubFetch(null);
    const files = await openDemo(DEMO);

    const extras = await fetchDemoExtras(
      DEMO,
      files.map((f) => f.name),
    );

    expect(extras.map((f) => f.name).sort()).toEqual([
      'widget/doc/sheet.pdf',
      'widget/lib/part.step',
    ]);
    expect(seen.fileHits).toContain('lib/part.step');
  });
});

describe('a brotli-encoded bundle', () => {
  /**
   * The browser decodes `content-encoding: br` before the app sees a byte, so
   * the stream yields DECODED bytes while `content-length` reports compressed
   * ones. Measuring one against the other ran the gauge to ~700%.
   */
  it('measures progress against the decoded size, not content-length', async () => {
    const zip = bundleBytes();
    const compressedLength = Math.floor(zip.length / 3); // as if brotli'd
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      // What R2 sends for an object stored with content-encoding: br.
      headers: new Headers({ 'content-length': String(compressedLength) }),
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: zip }; // decoded bytes
            },
          };
        },
      },
    }));

    const seen: { done: number; total: number }[] = [];
    await openDemo(
      { ...DEMO, bundleBytes: compressedLength, bundleRawBytes: zip.length },
      (done, total) => seen.push({ done, total }),
    );

    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.total).toBe(zip.length);
      expect(s.done).toBeLessThanOrEqual(s.total);
    }
  });
});
