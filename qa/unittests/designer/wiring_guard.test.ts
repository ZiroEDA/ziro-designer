// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Nothing in the app's own boot and durability layer is exported and never
 * called.
 *
 * This has bitten twice. `setRecoveryProvider` was never called outside its own
 * test, so the crash screen told users "nothing was lost" while their board sat
 * unsaved in memory. `checkStorageHealth` was documented as "boot check: prove
 * a real write/read/delete round-trip works" and nothing ever ran it, so the
 * first a user heard of a full or read-only origin was a save failing mid-edit
 * — the exact case the health layer was written to catch.
 *
 * Both are the same shape: the mechanism exists, is correct, is tested, and is
 * wired to nothing. A unit test cannot see that, because the unit works.
 *
 * So this scans the modules where being unwired is dangerous — the ones whose
 * job is to notice that something has gone wrong — and requires each exported
 * function to be called from somewhere that is not a test and not itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Modules whose exports must be reachable from the running app. */
const WATCHED = [
  'designer/src/home/storageHealth.ts',
  // The store itself: checkStorageHealth lived here, not in storageHealth.ts,
  // which is exactly why the first version of this guard missed it.
  'designer/src/home/projectStore.ts',
  'designer/src/home/recovery_source.ts',
  'designer/src/home/record_lock.ts',
  'designer/src/home/flush_on_hide.ts',
  'designer/src/browser_support.ts',
  'designer/src/telemetry/global_handlers.ts',
];

/**
 * Exports that are deliberately entry points for callers outside this scan —
 * React components, or hooks a `.tsx` uses. Each needs a reason.
 */
const EXCUSED: Record<string, string> = {
  // Pure classifier, called by reportStorageFailure and probeStorage inside its
  // own module. Exported so its table of DOMException names can be unit-tested
  // directly rather than through a fake IndexedDB.
  classifyError: 'used inside its own module; exported for its own test',
  // Test-only reset for module-level state, named so.
  resetRecordLocksForTests: 'test-only, and says so in the name',
  // A store capability with no UI: there is no way to rename a project in the
  // app, so this has never been called. Harmless rather than dangerous -- the
  // failure is a missing feature, not a silent one -- but recorded here rather
  // than deleted, since the store half is written and tested. See #419.
  renameProject: 'no rename-project UI exists yet; the store half is ready',
};

const repo = fileURLToPath(new URL('../../../', import.meta.url));

/** Every .ts/.tsx under designer/src, minus the file itself. */
function appSources(exclude: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}${e.name}`;
      if (e.isDirectory()) walk(`${full}/`);
      else if (/\.tsx?$/.test(e.name) && !full.endsWith(exclude)) out.push(full);
    }
  };
  walk(`${repo}designer/src/`);
  return out;
}

describe('the durability layer is actually wired up', () => {
  for (const rel of WATCHED) {
    it(rel, () => {
      const src = readFileSync(`${repo}${rel}`, 'utf8');
      const names = [...src.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]!);
      expect(names.length, `no exports found in ${rel} — the scan stopped working`).toBeGreaterThan(
        0,
      );

      const corpus = appSources(rel.replace('designer/src', ''))
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');

      const unwired = names.filter(
        // `<T>` may sit between the name and the parenthesis: runTx<T>(db, …).
        (n) => !EXCUSED[n] && !new RegExp(`\\b${n}\\s*(?:<[^>]*>)?\\s*\\(`).test(corpus),
      );
      expect(
        unwired,
        `exported by ${rel} and called from nowhere in the app: ${unwired.join(', ')}`,
      ).toEqual([]);
    });
  }
});
