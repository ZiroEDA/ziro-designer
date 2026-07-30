// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Standalone entry that mounts just the Calculator Tools frame, used to build
 * a single self-contained page for manual testing, independent of the launcher,
 * cloud sync or the other editors.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CalculatorTools } from './editors/calculator/CalculatorTools.js';
import './ui/shell.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <CalculatorTools onExitToHome={() => window.location.reload()} />
    </StrictMode>,
  );
}
