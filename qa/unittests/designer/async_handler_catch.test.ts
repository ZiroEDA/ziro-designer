// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * An async handler that opens something must say so when it fails.
 *
 * `try { … } finally { setLoading(null) }` with no `catch` looks harmless and
 * is not: the throw escapes an async click handler, so the loading overlay
 * clears, nothing happens, and nothing is said. The user clicks their project,
 * sees a flicker, and cannot tell whether they mis-clicked or their work is
 * gone.
 *
 * Four of these existed on the paths that open things — a stored project, a
 * whole schematic project, a library symbol, a demo — each reachable by an
 * ordinary failure: a corrupt gzip blob, an IndexedDB read error, a dropped
 * network fetch.
 *
 * Scanned from the source because these are `.tsx` click handlers that qa
 * cannot run. Crude, and it catches a `finally` that never grew a `catch`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

/** The functions that open something, and the file they live in. */
const OPENERS: [file: string, fn: string][] = [
  ['designer/src/home/HomePage.tsx', 'const openStored'],
  ['designer/src/editors/schematic/SchematicEditor.tsx', 'const loadProject'],
  ['designer/src/editors/schematic/SchematicEditor.tsx', 'const loadText'],
  ['designer/src/editors/symbol/SymbolEditor.tsx', 'const loadSymbol'],
];

describe('every opener reports its failures', () => {
  for (const [file, fn] of OPENERS) {
    it(`${fn} in ${file.split('/').pop()}`, () => {
      const src = readFileSync(`${repo}${file}`, 'utf8');
      const start = src.indexOf(fn);
      expect(start, `${fn} not found — the scan stopped working`).toBeGreaterThan(-1);

      // To the end of the function: the next top-level `const` declaration at
      // the same indent, which is how this file declares each handler.
      const rest = src.slice(start + fn.length);
      const end = rest.search(/\n  const \w/);
      const body = end === -1 ? rest : rest.slice(0, end);

      expect(body).toContain('try {');
      expect(
        body,
        `${fn} has a try with no catch — a failure here clears the overlay and says nothing`,
      ).toMatch(/}\s*catch/);
    });
  }
});
