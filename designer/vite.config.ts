import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
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
// which deploy is loaded — this makes "am I on the latest build?" verifiable
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
 * Source maps are uploaded to Sentry and then deleted — never deployed.
 *
 * `sourcemap: 'hidden'` generates them without leaving a `//# sourceMappingURL`
 * comment in the bundle, so nothing advertises them, and
 * `filesToDeleteAfterUpload` removes them before the output directory ships.
 * Sentry gets readable stack traces; the public site never serves our source.
 *
 * The whole thing is off unless all three credentials are present. That keeps
 * `pnpm build` working for contributors and in CI — and, importantly, means a
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
  build: { sourcemap: uploadMaps ? 'hidden' : false },
  plugins: [
    react(),
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
