// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The naming of a preserved copy, and the rule that decides when one is made
 * (#367).
 *
 * A pull overwrites the local record wholesale, which is fine when the local
 * side has not changed since it last agreed with the cloud and a day's work
 * when it has. Preserving it as a copy is what that bought.
 *
 * The copy is no longer made by the sync, though: a project that changed on
 * both sides is reported and neither side is touched, because the decision is
 * not the sync's to make and making it silently put duplicates of somebody's
 * board in Open Project. `keepBoth` still makes exactly this copy with exactly
 * this name -- the difference is that somebody chose it. See
 * `sync_no_auto_copy.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localCopyName } from '@ziroeda/designer/src/home/projectStore.js';

describe('the preserved copy’s name', () => {
  it('says what it is and when it was kept', () => {
    // It lands in Recent beside the project it came from, so it has to be
    // obvious at a glance which is which.
    expect(localCopyName('Amp', new Date('2026-08-05T11:00:00Z'))).toBe(
      'Amp (local copy, 2026-08-05)',
    );
  });

  it('is stable across times of day', () => {
    // Two syncs on the same day produce the same name rather than a churn of
    // near-identical entries differing by seconds.
    const a = localCopyName('Amp', new Date('2026-08-05T01:00:00Z'));
    const b = localCopyName('Amp', new Date('2026-08-05T23:00:00Z'));
    expect(a).toBe(b);
  });

  it('keeps the original name recognisable', () => {
    expect(localCopyName('Amp', new Date('2026-08-05T00:00:00Z'))).toContain('Amp');
  });
});

describe('what a rebuild-the-record save must carry across', () => {
  /**
   * `saveProject` builds a fresh `StoredRecord` rather than patching the stored
   * one, so every field not named in that literal is dropped on each save. This
   * is the shape that has bitten before — a field added to a record, and an
   * update path that quietly wipes it.
   *
   * Asserted against the source rather than the store, because the store is
   * IndexedDB and qa has none. Crude, and it catches the thing that matters:
   * somebody adding a field to StoredRecord and not carrying it here.
   */
  const src = readFileSync(
    fileURLToPath(new URL('../../../designer/src/home/projectStore.ts', import.meta.url)),
    'utf8',
  );
  const saveProject = src.slice(
    src.indexOf('export async function saveProject'),
    src.indexOf('export async function listProjects'),
  );

  it('reads the existing record back', () => {
    expect(saveProject).toMatch(/existing = await tx/);
  });

  for (const field of ['createdAt', 'syncedAt', 'ownerId']) {
    it(`carries ${field} across`, () => {
      expect(saveProject).toContain(`existing?.${field}`);
    });
  }

  it('is looking at the right function', () => {
    // A slice that missed would pass every check above by being empty.
    expect(saveProject).toContain("await tx('readwrite'");
    expect(saveProject.length).toBeGreaterThan(400);
  });
});

describe('the ownership rule the fork has to respect', () => {
  // `ownedBy(owner, record)` — the predicate listProjects filters on.
  const ownedBy = (owner: string | null, r: { ownerId?: string }): boolean =>
    owner === null || r.ownerId === undefined || r.ownerId === owner;

  it('treats an unowned record as visible to everyone', () => {
    // Which is why a preserved copy must not be left unowned: it is a copy of
    // the signed-in user's board, and on a shared machine the next person to
    // sign in would see it.
    expect(ownedBy('alice', {})).toBe(true);
    expect(ownedBy('bob', {})).toBe(true);
  });

  it('hides another account’s record, which is the protection being relied on', () => {
    expect(ownedBy('bob', { ownerId: 'alice' })).toBe(false);
    expect(ownedBy('alice', { ownerId: 'alice' })).toBe(true);
  });

  it('shows everything when nobody is signed in', () => {
    expect(ownedBy(null, { ownerId: 'alice' })).toBe(true);
  });
});
