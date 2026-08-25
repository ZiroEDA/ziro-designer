// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `qa` had no vitest config at all, which was fine while every test was a pure
 * function over an engine. A test that RENDERS a React panel needs two things
 * that defaults do not give it: the automatic JSX runtime (without it a `.tsx`
 * test fails with `React is not defined`, because the classic transform expects
 * `React` in scope), and a DOM.
 *
 * The DOM is deliberately NOT set globally. It is opted into per file with a
 * `// @vitest-environment happy-dom` docblock, because the other ~13 000 tests
 * are engine maths and paying for a document on all of them is a real cost for
 * no gain.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  /**
   * A rendered toolbar reaches KiCad's vendored icons through
   * `import.meta.glob('../assets/toolbar/*.svg', { query: '?url' })`
   * (`designer/src/ui/toolbarIcons.ts`), and an asset request is checked
   * against Vite's fs allow-list rather than resolved through the module
   * graph. `qa` is the root here, so `designer/src/assets/` is outside it and
   * every such request came back `Denied ID ...svg?url` — the whole file
   * failing to collect, not one icon going missing.
   *
   * The repo root is the workspace, so allowing it is the same reach the
   * `@ziroeda/*` package links already have.
   */
  server: { fs: { allow: ['..'] } },
});
