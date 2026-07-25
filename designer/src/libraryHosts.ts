/**
 * Where the hosted libraries live.
 *
 * The full KiCad sets, symbols, footprints, packages3D (pre-converted to .glb)
 * and the demo projects, are served from this project's Cloudflare R2 bucket,
 * so the app has the same library table wherever it runs. `public/symbols`,
 * `public/footprints` and friends hold only a small bundled subset, kept as an
 * offline fallback.
 *
 * The bucket URL is the built-in default *in code* rather than deployment-only
 * configuration: a dev server that silently fell back to the bundled subset
 * would resolve fewer footprints and symbols than production, which quietly
 * changes what ERC and the choosers report. A `VITE_*_URL` still overrides it
 * (vercel.json sets them to this same bucket).
 */

// The cast keeps this module loadable outside Vite (the qa test runner).
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

/** The library bucket's public host. */
export const LIBRARY_HOST = 'https://pub-ac941e05e1284f409be2ed74ddb151b3.r2.dev';

/** `<base>/index.json` + `<base>/<Library>.kicad_sym`. */
export const SYMBOLS_HOST = viteEnv?.VITE_SYMBOLS_URL || `${LIBRARY_HOST}/symbols`;

/** `<base>/index.json` + `<base>/<Library>.pretty/<Footprint>.kicad_mod`. */
export const FOOTPRINTS_HOST = viteEnv?.VITE_FOOTPRINTS_URL || `${LIBRARY_HOST}/footprints`;

/** `<base>/<Library>.3dshapes/<Model>.glb`, the bucket root. */
export const MODELS3D_HOST = viteEnv?.VITE_MODELS3D_URL || LIBRARY_HOST;

/** `<base>/index.json` + the demo project archives. */
export const DEMOS_HOST = viteEnv?.VITE_DEMOS_URL || `${LIBRARY_HOST}/demos`;

/** The bundled subsets under `public/`, the offline fallback. */
export const bundledBase = (kind: 'symbols' | 'footprints'): string =>
  `${viteEnv?.BASE_URL ?? '/'}${kind}`;

/**
 * The base each library kind is currently served from. It starts at the hosted
 * set and drops to the bundled subset if that turns out to be unreachable
 * (offline dev), so every later per-file fetch follows the same base.
 */
export const libraryBase: { symbols: string; footprints: string } = {
  symbols: SYMBOLS_HOST,
  footprints: FOOTPRINTS_HOST,
};

/** Fetch a library index, failing over to the bundled copy once. */
export async function fetchLibraryIndex<T>(kind: 'symbols' | 'footprints'): Promise<T[]> {
  try {
    const res = await fetch(`${libraryBase[kind]}/index.json`);
    if (res.ok) return (await res.json()) as T[];
  } catch {
    /* unreachable, fall through to the bundled subset */
  }
  libraryBase[kind] = bundledBase(kind);
  try {
    const res = await fetch(`${libraryBase[kind]}/index.json`);
    return res.ok ? ((await res.json()) as T[]) : [];
  } catch {
    return [];
  }
}
