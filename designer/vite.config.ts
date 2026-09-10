import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

function gitSha(short = false): string | undefined {
  try {
    return execSync(`git rev-parse ${short ? '--short ' : ''}HEAD`)
      .toString()
      .trim();
  } catch {
    return undefined; // building outside a checkout (a source tarball)
  }
}

// A short build stamp (git SHA + UTC time) so the running app can show exactly
// which deploy is loaded, this makes "am I on the latest build?" verifiable
// instead of guessing when behaviour looks stale.
function buildStamp(): string {
  const sha = gitSha(true);
  if (!sha) return 'dev';
  return `${sha} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/**
 * The release identity shared by the running app and the uploaded source maps.
 *
 * Both sides must agree exactly or symbolication silently does nothing: Sentry
 * matches an incoming event's `release` against the release the maps were
 * uploaded under, and a mismatch just leaves the stack minified. So this value
 * is computed once here and used for both.
 *
 * Vercel does not run the build inside a git checkout, so its own commit SHA is
 * the only source there.
 */
const RELEASE: string = process.env.VERCEL_GIT_COMMIT_SHA ?? gitSha() ?? 'dev';

// Read by designer/src/telemetry/reporter.ts. Assigned rather than overwritten
// so an explicit VITE_RELEASE in the environment still wins.
process.env.VITE_RELEASE ??= RELEASE;

/**
 * Source maps are uploaded to Sentry and then deleted, never deployed.
 *
 * `sourcemap: 'hidden'` generates them without leaving a `//# sourceMappingURL`
 * comment in the bundle, so nothing advertises them, and
 * `filesToDeleteAfterUpload` removes them before the output directory ships.
 * Sentry gets readable stack traces; the public site never serves our source.
 *
 * The whole thing is off unless all three credentials are present. That keeps
 * `pnpm build` working for contributors and in CI, and, importantly, means a
 * build without the token emits no maps at all rather than emitting them and
 * quietly publishing them.
 */
const SENTRY_ORG = process.env.SENTRY_ORG;
const SENTRY_PROJECT = process.env.SENTRY_PROJECT;
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const uploadMaps = !!(SENTRY_ORG && SENTRY_PROJECT && SENTRY_AUTH_TOKEN);

// On GitHub Pages the app is served from https://<user>.github.io/<repo>/, so the
// asset base must be the repo subpath. Locally it stays '/'. The CI workflow sets
// VITE_BASE=/pcb/.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
  build: {
    sourcemap: uploadMaps ? 'hidden' : false,
    /**
     * Bitmaps are files, as KiCad's are.
     *
     * Vite's default inlines any asset under 4 KB as a data: URI, and the
     * toolbar's 472 icons are all under it — so 799 KB of base64 SVG sat in
     * the entry chunk, downloaded and parsed before the sign-in screen could
     * paint, for icons nothing shows until an editor frame does. As files
     * they are hashed and immutable, precached by the worker, and fetched by
     * a frame when it first paints — which is at idle, since the frames warm
     * behind the manager (App.tsx, `warmFrames`). The entry drops by half.
     */
    assetsInlineLimit: 0,
  },
  /**
   * ES, not Vite's default IIFE.
   *
   * The OCCT worker (`editors/pcb/occt_worker.ts`) lazily imports the 7.6 MB
   * WASM kernel, and a lazy import is a code split. Rollup cannot emit a
   * split build as IIFE, so the default fails the whole build with "UMD and
   * IIFE output formats are not supported for code-splitting builds" — not at
   * dev time, only at `vite build`, which is why this arrived with the worker
   * and was found one commit later.
   *
   * Every browser that has `Worker` at all supports module workers, and the
   * loader falls back to the main thread where it does not.
   */
  worker: { format: 'es' },
  plugins: [
    react(),
    /**
     * The app is installed, not fetched.
     *
     * KiCad's editors are on disk; opening one never waits for a network. Ours
     * were downloaded on every visit — Vercel serves hashed chunks as
     * `max-age=0, must-revalidate` unless told otherwise (that is now
     * vercel.json's job) — and an editor nobody had opened yet was fetched the
     * moment they first asked for it, behind a "Loading the board editor..."
     * overlay. This service worker precaches every built chunk on the first
     * visit, so the second launch, and every editor in it, comes off disk with
     * no request at all, and the app works with the network down.
     *
     * `prompt`, not `autoUpdate`: a new deploy is *installed* in the background
     * but *activates* only once every tab of the old build is closed — the way
     * a desktop update applies at the next launch. `autoUpdate` would swap the
     * worker under a running editor, whose still-lazy chunks then hit the
     * network for hashes the new deploy no longer serves.
     */
    VitePWA({
      registerType: 'prompt',
      // registerSW.js as a separate script rather than inline: index.html carries
      // no CSP nonce and we want the register call to stay out of the entry.
      injectRegister: 'script-defer',
      manifest: {
        name: 'ZiroEDA',
        short_name: 'ZiroEDA',
        description: 'Browser-native, KiCad-compatible schematic and PCB design.',
        start_url: '/',
        display: 'standalone',
        // The chrome the shell paints while the first chunk loads. Matches the
        // mark's own ground in favicon.svg and the dark shell in ui/shell.css.
        background_color: '#18181b',
        theme_color: '#18181b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The code, and only the code. public/ also ships 50 MB of symbol
        // libraries, 5 MB of templates and the demo boards; those are data the
        // app fetches when a project needs them, and precaching them would turn
        // the first visit into a download of the whole library. Likewise the
        // 7.4 MB OCCT kernel is cached the first time a 3D view asks for it,
        // below, not up front.
        globPatterns: ['index.html', 'favicon.svg', 'icons/*.png', 'assets/**/*.{js,css,png,svg}'],
        // index.js alone is 1.7 MB; workbox's default 2 MiB cap would otherwise
        // quietly skip the one file that matters most.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Every app route (/p/<uid>/pcb, /demo/<id>) is index.html, as
        // vercel.json's rewrite already says. Serving it from the precache is
        // what makes a cold-start with no network still paint the launcher.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // WASM kernels are hashed like every other asset, so cache-first is
            // exact; they are just too big to insist on before first paint.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/assets/') && url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'wasm', expiration: { maxEntries: 8 } },
          },
        ],
      },
      // Dev keeps Vite's own module server, where a stale worker would serve
      // yesterday's source; the worker exists in builds only.
      devOptions: { enabled: false },
    }),
    ...(uploadMaps
      ? [
          sentryVitePlugin({
            org: SENTRY_ORG,
            project: SENTRY_PROJECT,
            authToken: SENTRY_AUTH_TOKEN,
            // The ZiroEDA project lives in Sentry's EU region. The CLI defaults
            // to the US instance, where the upload appears to succeed and then
            // binds to nothing, so this must be set explicitly.
            url: process.env.SENTRY_URL ?? 'https://de.sentry.io/',
            release: { name: RELEASE },
            // Paths are relative to the Vite root (designer/).
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            // We do not send our own build telemetry to Sentry either.
            telemetry: false,
          }),
        ]
      : []),
  ],
  server: { port: 5173 },
  // zstd-wasm locates zstd.wasm next to its own module via import.meta.url;
  // pre-bundling would move the JS into .vite/deps without the wasm, so serve
  // the package as-is (production builds handle new URL(..., import.meta.url)
  // natively and copy the asset).
  optimizeDeps: { exclude: ['@bokuweb/zstd-wasm'] },
});
