import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { AuthGate } from './auth/AuthGate.js';
import { DesktopGate } from './mobile/DesktopGate.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
// DesktopGate sits outside AuthGate: a phone that can't run the editors is
// turned away before we ask it to sign in (and before auth touches the network).
createRoot(root).render(
  <StrictMode>
    <DesktopGate>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </DesktopGate>
  </StrictMode>,
);
