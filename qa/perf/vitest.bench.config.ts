// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The perf harness runs under its own config so `*.bench.tsx` files stay out of
 * the CI gate (`vitest run` at the qa root collects `*.test.*` only) while still
 * getting the JSX runtime and the fs allow-list the real config sets up.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: { fs: { allow: ['..'] } },
  test: { include: ['perf/**/*.bench.tsx'] },
});
