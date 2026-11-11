// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Loading the zstd codec EMBEDDED_FILES needs (common/embedded_files.ts), when the network
 * does not cooperate.
 *
 * The package's web `init()` fetched its own wasm and, on a failed fetch, aborted inside a
 * promise it never returned (an unhandled rejection, Sentry JAVASCRIPT-REACT-1N) while the one
 * it did return never settled - a board's open waited on it for good. Now the bytes are
 * fetched first, once more on a failure, and a load that still failed is forgotten so the
 * next caller asks again.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const zstd = vi.hoisted(() => ({ failures: 0 }));

// qa has no dependency on the package, so it is named by the file common's import resolves to
// (its Node build, as the tests run under Node).
vi.mock(
  '../../../common/node_modules/@bokuweb/zstd-wasm/dist/common/index.node.js',
  async (aOriginal) => {
    const real = await aOriginal<{ init: () => Promise<void> }>();
    return {
      ...real,
      init: (): Promise<void> => {
        if (zstd.failures > 0) {
          zstd.failures--;
          return Promise.reject(new Error('Failed to fetch'));
        }
        return real.init();
      },
    };
  },
);

const { EMBEDDED_FILES, fetchCodecWasm } = await import('@ziroeda/common/embedded_files.js');

const WASM = readFileSync(
  fileURLToPath(
    new URL('../../../common/node_modules/@bokuweb/zstd-wasm/dist/web/zstd.wasm', import.meta.url),
  ),
);
const wasm = (): Response => new Response(new Uint8Array(WASM));

/** A fetch answering each call with the next of \a aAnswers; a string is thrown as a TypeError. */
function fakeFetch(aAnswers: (Response | string)[]) {
  const calls: string[] = [];
  const f = (aUrl: string): Promise<Response> => {
    calls.push(aUrl);
    const next = aAnswers.shift()!;
    return typeof next === 'string' ? Promise.reject(new TypeError(next)) : Promise.resolve(next);
  };
  return { f, calls };
}

describe('fetchCodecWasm', () => {
  it('asks once more when the first fetch fails, and returns the module', async () => {
    const { f, calls } = fakeFetch(['Failed to fetch', wasm()]);

    const bytes = await fetchCodecWasm('/assets/zstd.wasm', f);

    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(WASM));
    expect(calls).toEqual(['/assets/zstd.wasm', '/assets/zstd.wasm']);
  });

  it('rejects, rather than waits, when both fail - with what went wrong', async () => {
    const { f } = fakeFetch(['Failed to fetch', 'Failed to fetch']);

    await expect(fetchCodecWasm('/assets/zstd.wasm', f)).rejects.toThrow(
      'The zstd codec could not be loaded (Failed to fetch)',
    );
  });

  it("an answer that is not wasm - a host's index.html for a removed file - is a failure", async () => {
    const html = (): Response =>
      new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } });
    const { f } = fakeFetch([html(), html()]);

    await expect(fetchCodecWasm('/assets/zstd.wasm', f)).rejects.toThrow(
      'not a WebAssembly module',
    );
  });

  it('a status that is not ok is a failure', async () => {
    const { f } = fakeFetch([new Response('', { status: 404 }), new Response('', { status: 404 })]);

    await expect(fetchCodecWasm('/assets/zstd.wasm', f)).rejects.toThrow('HTTP 404');
  });
});

describe('EMBEDDED_FILES::InitCodec', () => {
  it('a load that failed is not remembered: the next call loads it', async () => {
    zstd.failures = 1;

    await expect(EMBEDDED_FILES.InitCodec()).rejects.toThrow('Failed to fetch');
    expect(EMBEDDED_FILES.CodecReady()).toBe(false);

    await EMBEDDED_FILES.InitCodec();
    expect(EMBEDDED_FILES.CodecReady()).toBe(true);
  });
});

describe("the package's web build, which a page and a worker run", () => {
  it('instantiates from the bytes it is handed, with nothing to fetch', async () => {
    const web = (await import(
      '../../../common/node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js'
    )) as unknown as {
      init: (aBytes: ArrayBuffer) => Promise<void>;
      compress: (aData: Uint8Array, aLevel: number) => Uint8Array;
      decompress: (aData: Uint8Array) => Uint8Array;
    };
    const fetched = vi.spyOn(globalThis, 'fetch');

    const bytes = WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength);
    await web.init(bytes as ArrayBuffer);

    expect(fetched).not.toHaveBeenCalled();
    const data = new TextEncoder().encode('embedded embedded embedded');
    expect(web.decompress(web.compress(data, 10))).toEqual(data);
  });
});
