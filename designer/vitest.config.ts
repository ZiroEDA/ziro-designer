// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The designer package's own tests: the few that have to import a module
 * `qa` cannot typecheck — three.js scenes reaching `occt-import-js` and a
 * Vite `?url` asset. Everything else belongs in `qa/`.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
