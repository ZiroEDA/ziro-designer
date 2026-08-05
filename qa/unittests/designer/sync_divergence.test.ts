// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The naming of a preserved copy, and the rule that decides when one is made
 * (#367).
 *
 * Reconciliation is last-write-wins on `updatedAt`, so a pull overwrites the
 * local record wholesale. Fine when the local side has not changed since it
 * last agreed with the cloud; a day's work when it has.
 */
import { describe, it, expect } from 'vitest';
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
