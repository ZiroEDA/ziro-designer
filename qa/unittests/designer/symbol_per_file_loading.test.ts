// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a symbol fetches that symbol, not its library.
 *
 * The library files are large enough that this is the difference between about
 * a kilobyte and 7.0 MB (Connector_Generic), so what is asserted here is the
 * request that goes out, not only the value that comes back. The fallback to a
 * whole library matters just as much: it is what makes the split safe to deploy
 * before every host serves it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const LIB = 'Device';

/** A one-symbol library file, as tools/libraries/upload.mjs emits. */
const oneSymbolFile = (blocks: string[]): string =>
  `(kicad_symbol_lib\n\t(version 20241209)\n\t(generator "ziro_library_split")\n\t(generator_version "1.0")\n${blocks.join('\n')}\n)\n`;

const R_SMALL = `\t(symbol "R_Small"
\t\t(pin_numbers (hide yes))
\t\t(property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
\t\t(symbol "R_Small_1_1"
\t\t\t(rectangle (start -0.762 1.778) (end 0.762 -1.778)
\t\t\t\t(stroke (width 0.2032) (type default)) (fill (type none)))
\t\t\t(pin passive line (at 0 2.54 270) (length 0.762)
\t\t\t\t(name "~" (effects (font (size 1.27 1.27))))
\t\t\t\t(number "1" (effects (font (size 1.27 1.27)))))
\t\t\t(pin passive line (at 0 -2.54 90) (length 0.762)
\t\t\t\t(name "~" (effects (font (size 1.27 1.27))))
\t\t\t\t(number "2" (effects (font (size 1.27 1.27)))))
\t\t)
\t)`;

/** Derived: owns no geometry at all, only its own text properties. */
const R_SMALL_US = `\t(symbol "R_Small_US"
\t\t(extends "R_Small")
\t\t(property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
\t)`;

const WHOLE_LIB = oneSymbolFile([R_SMALL, R_SMALL_US]);

/** Fresh module state per test: the loader caches libraries and symbols, and
 *  remembers when a host turned out not to serve symbols individually. */
async function freshLoader(): Promise<
  typeof import('@ziroeda/designer/src/editors/schematic/symbols/index.js')
> {
  vi.resetModules();
  return import('@ziroeda/designer/src/editors/schematic/symbols/index.js');
}

let requested: string[] = [];

/** Serve the given URL suffixes; everything else 404s, as a real host would. */
function serve(routes: Record<string, string>): void {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const url = String(input);
      requested.push(url);
      const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
      return Promise.resolve(
        hit
          ? new Response(hit[1], { status: 200 })
          : new Response('not found', { status: 404, statusText: 'Not Found' }),
      );
    }),
  );
}

beforeEach(() => {
  requested = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Every test re-imports the module to get its caches back, and that import
// pulls the whole designer -> eeschema -> sexpr graph. On an idle machine it
// takes well under a second; sharing cores with the rest of the suite it went
// past the 5 s default and failed there while passing on its own.
describe('loadSymbol', { timeout: 30_000 }, () => {
  it('fetches only that symbol when the host serves one file per symbol', async () => {
    serve({ [`/${LIB}/R_Small.kicad_sym`]: oneSymbolFile([R_SMALL]) });
    const { loadSymbol } = await freshLoader();

    const sym = await loadSymbol(LIB, 'R_Small');

    expect(sym?.libId).toBe('Device:R_Small');
    expect(requested).toHaveLength(1);
    // The whole library must not be touched, which is the entire point.
    expect(requested[0]).toMatch(/\/Device\/R_Small\.kicad_sym$/);
    expect(requested[0]).not.toMatch(/\/Device\.kicad_sym$/);
  });

  it("carries the parent chain, so a derived symbol still has the parent's pins", async () => {
    // The failure this guards: resolveExtends looks the parent up by name and,
    // finding nothing, keeps the child's own (empty) body. The symbol parses and
    // places with no pins and no error anywhere.
    serve({ [`/${LIB}/R_Small_US.kicad_sym`]: oneSymbolFile([R_SMALL, R_SMALL_US]) });
    const { loadSymbol, symbolPinCount } = await freshLoader();

    const derived = await loadSymbol(LIB, 'R_Small_US');

    expect(derived?.libId).toBe('Device:R_Small_US');
    expect(symbolPinCount(derived!)).toBe(2);
  });

  it('would notice a file that omitted the parent', async () => {
    // Proves the assertion above can fail, rather than passing on a reader that
    // invents pins from somewhere.
    serve({ [`/${LIB}/R_Small_US.kicad_sym`]: oneSymbolFile([R_SMALL_US]) });
    const { loadSymbol, symbolPinCount } = await freshLoader();

    const orphan = await loadSymbol(LIB, 'R_Small_US');

    expect(orphan).toBeDefined();
    expect(symbolPinCount(orphan!)).toBe(0);
  });

  it('falls back to the whole library on a host without the per-symbol layout', async () => {
    serve({ [`/${LIB}.kicad_sym`]: WHOLE_LIB });
    const { loadSymbol } = await freshLoader();

    const sym = await loadSymbol(LIB, 'R_Small');

    expect(sym?.libId).toBe('Device:R_Small');
    expect(requested.some((u) => u.endsWith(`/${LIB}/R_Small.kicad_sym`))).toBe(true);
    expect(requested.some((u) => u.endsWith(`/${LIB}.kicad_sym`))).toBe(true);
  });

  it('stops trying the per-symbol path once a host has answered from the library', async () => {
    serve({ [`/${LIB}.kicad_sym`]: WHOLE_LIB, '/Other.kicad_sym': WHOLE_LIB });
    const { loadSymbol } = await freshLoader();

    await loadSymbol(LIB, 'R_Small');
    const afterFirst = requested.length;
    await loadSymbol('Other', 'R_Small_US');

    // The second library is fetched whole, with no per-symbol attempt first.
    const second = requested.slice(afterFirst);
    expect(second.some((u) => u.endsWith('/Other/R_Small_US.kicad_sym'))).toBe(false);
    expect(second.some((u) => u.endsWith('/Other.kicad_sym'))).toBe(true);
  });

  it('reports which library failed, rather than a parse error on the error page', async () => {
    serve({}); // nothing is served: every fetch 404s
    const { loadSymbol } = await freshLoader();

    await expect(loadSymbol(LIB, 'R_Small')).rejects.toThrow(/Device.*HTTP 404/);
  });

  it('reuses a library that is already loaded rather than fetching the symbol', async () => {
    serve({ [`/${LIB}.kicad_sym`]: WHOLE_LIB });
    const { loadLibrarySymbols, loadSymbol } = await freshLoader();

    await loadLibrarySymbols(LIB); // what the library browser does
    const afterBrowse = requested.length;
    const sym = await loadSymbol(LIB, 'R_Small');

    expect(sym?.libId).toBe('Device:R_Small');
    expect(requested).toHaveLength(afterBrowse); // nothing further went out
  });

  it('does not disable the per-symbol path for a symbol that simply does not exist', async () => {
    // Device is served whole and has no such symbol; Other is served per symbol.
    // The miss must read as "no such symbol", not as "this host has no per-symbol
    // layout", or one bad name would push every later placement back onto
    // multi-megabyte library fetches.
    serve({
      [`/${LIB}.kicad_sym`]: WHOLE_LIB,
      '/Other/R_Small.kicad_sym': oneSymbolFile([R_SMALL]),
    });
    const { loadSymbol } = await freshLoader();

    expect(await loadSymbol(LIB, 'NoSuchSymbol')).toBeUndefined();
    const afterMiss = requested.length;
    const sym = await loadSymbol('Other', 'R_Small');

    expect(sym?.libId).toBe('Other:R_Small');
    expect(requested.slice(afterMiss).some((u) => u.endsWith('/Other/R_Small.kicad_sym'))).toBe(
      true,
    );
  });
});
