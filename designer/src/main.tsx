import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { AuthGate } from './auth/AuthGate.js';
import { DesktopGate } from './mobile/DesktopGate.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';
import { StorageBanner } from './ui/StorageBanner.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
// Outermost first:
//   ErrorBoundary — catches throws from every layer below, gate and auth alike.
//   DesktopGate   — a phone that can't run the editors is turned away before we
//                   ask it to sign in (and before auth touches the network).
//   StorageBanner — sibling of the auth tree, so a storage failure is shouted
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
