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
import { initTelemetry } from './telemetry/reporter.js';
import { sentrySink } from './telemetry/sentrySink.js';

// Before rendering, so a crash during the first paint is still reported. No-ops
// when VITE_SENTRY_DSN is unset or the user has opted out, the same
// env-gated-degrades-to-offline shape as auth and cloud sync.
initTelemetry(sentrySink);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
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
      </DesktopGate>
    </ErrorBoundary>
  </StrictMode>,
);
