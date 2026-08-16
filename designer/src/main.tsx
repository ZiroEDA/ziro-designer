// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { AuthGate } from './auth/AuthGate.js';
import { DesktopGate } from './mobile/DesktopGate.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';
import { StorageBanner } from './ui/StorageBanner.js';
import { TooltipLayer } from './ui/Tooltip.js';
import { initTelemetry } from './telemetry/reporter.js';
import { sentrySink } from './telemetry/sentrySink.js';
import { installGlobalErrorHandlers } from './telemetry/global_handlers.js';
import { missingFeatures, unsupportedMessage } from './browser_support.js';
import { checkStorageHealth } from './home/projectStore.js';
import { authEnabled } from './auth/supabaseClient.js';
import { setCloudBackend } from './cloud/cloudStore.js';
import { supabaseBackend } from './cloud/supabaseBackend.js';

// Before rendering, so a crash during the first paint is still reported. No-ops
// when VITE_SENTRY_DSN is unset or the user has opted out, the same
// env-gated-degrades-to-offline shape as auth and cloud sync.
initTelemetry(sentrySink);
// The error boundary only sees render and commit. Nearly everything here is a
// pointer handler, a key handler or an await — none of which reach a boundary,
// all of which were going to a console nobody reads.
installGlobalErrorHandlers();
// The real storage test, at boot. storageAvailable() only proves the API
// exists; this proves a write/read/delete round-trip lands. Without it the
// first a user hears of a full or read-only origin is a save failing mid-edit,
// which is the case storageHealth.ts was written to catch — the function was
// documented as the boot check and nothing ever called it.
//
// Fire-and-forget on purpose: a rejection is already reported through the
// health layer, and a storage probe must never be able to stop the app booting.
void checkStorageHealth().catch(() => undefined);

// The cloud store works against an interface so its failure paths are reachable
// from tests; this is where the real transport goes in. Without Supabase
// configured nothing is installed and every cloud call refuses loudly, which is
// correct: `sync.ts` gates on `authEnabled` and never makes one.
if (authEnabled) setCloudBackend(supabaseBackend());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Before anything renders. An unsupported browser otherwise gets a white
// screen: a TypeError out of a file the user has never heard of, and nothing
// on the page to say whether the app is broken or their browser is. The crash
// screen cannot help, because the failure is usually before React mounts.
const missing = missingFeatures();
if (missing.length > 0) {
  root.textContent = unsupportedMessage(missing);
  root.setAttribute(
    'style',
    'padding:2rem;max-width:40rem;margin:0 auto;white-space:pre-wrap;line-height:1.5',
  );
} else {
  // Outermost first:
  //   ErrorBoundary, catches throws from every layer below, gate and auth alike.
  //   DesktopGate, a phone that can't run the editors is turned away before we
  //                   ask it to sign in (and before auth touches the network).
  //   StorageBanner, sibling of the auth tree, so a storage failure is shouted
  //                   about whether or not the user is signed in, but inside the
  //                   gate, so a turned-away phone isn't warned about an app it
  //                   is not running.
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <DesktopGate>
          <AuthProvider>
            <AuthGate>
              <App />
            </AuthGate>
          </AuthProvider>
          <StorageBanner />
          {/* One tooltip layer for the whole document. It draws every tooltip
              in the app, including the ~460 plain `title` attributes across the
              editors and dialogs, by borrowing the attribute for the duration
              of the hover (see ui/Tooltip.tsx). Mounted here rather than inside
              App because App returns early for the restore screen and for the
              project manager, so a layer in its final return never reaches
              either of them. */}
          <TooltipLayer />
        </DesktopGate>
      </ErrorBoundary>
    </StrictMode>,
  );
}
