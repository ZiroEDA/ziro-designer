// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every field of `StoredRecord` is accounted for by every function that builds
 * one — carried across, or excused by name with a reason.
 *
 * Three functions construct a record literal rather than patching the stored
 * one, so a field they do not mention is silently dropped. That has now bitten
 * three times in two days:
 *
 *  - `syncedAt` was wiped by every ordinary save, which made the whole cloud
 *    conflict protection inert — `updatedAt > syncedAt` can never be true if
 *    the first edit after a sync erases `syncedAt`;
 *  - `ownerId` was dropped when saving while signed out, un-owning the project
 *    and exposing it to every account on the browser;
 *  - the same shape hit the schematic writer three times (`(span …)`, the
 *    table's column widths, a cell's margins) in the same week.
 *
 * Every one of those tested green, because the feature worked. Only the field
 * went missing.
 *
 * Asserted against the source rather than the store: the store is IndexedDB
 * and qa has none. Crude, and it catches the thing that matters — somebody
 * adds a field to `StoredRecord` and one of these three does not carry it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  fileURLToPath(new URL('../../../designer/src/home/projectStore.ts', import.meta.url)),
  'utf8',
);

/** The functions that build a `StoredRecord` literal, and where each ends. */
const BUILDERS: [name: string, until: string][] = [
  ['saveProject', 'export async function listProjects'],
  ['importProject', 'export async function hasDivergedLocally'],
  ['forkLocalCopy', 'export async function deleteProject'],
];

/**
 * Fields a given builder legitimately does not carry, and why. A reason is the
 * price of an exemption — the point of the list is that adding to it is a
 * decision somebody made on purpose.
 */
const EXCUSED: Record<string, Record<string, string>> = {
  saveProject: {
    id: 'generated or passed in; it is what identifies the record',
    name: 'the argument — renaming is the caller’s intent',
    updatedAt: 'set to now: this save is the update',
    files: 'the argument',
  },
  importProject: {
    id: 'comes from the cloud record',
    name: 'comes from the cloud record',
    createdAt: 'comes from the cloud record',
    updatedAt: 'comes from the cloud record',
    files: 'comes from the cloud record',
    syncedAt: 'set to the pulled updatedAt: the two sides now agree',
    ownerId: 'set to the current owner',
    lastOpenedAt:
      'deliberately not carried: a pulled project sorts by its new updatedAt, ' +
      'which is what "someone else just changed this" should do to Recent',
    templateId:
      'nothing to carry: the cloud row has no such field. The link from a ' +
      'project to the template it edits is local, so a project pulled onto a ' +
      'second machine arrives as an ordinary project. The template itself ' +
      'syncs (templateSync.ts), so Edit Template there makes a bound one again',
  },
  forkLocalCopy: {
    id: 'a fresh id — the copy is a new project',
    userDir:
      'deliberately not carried, and carrying it would LOSE the fork. A ' +
      'user-data folder is reached by its fixed id and hidden from ' +
      'listProjects; a fork has neither — a fresh random id, so no path ' +
      'resolves to it — so marking it a folder would make the rescue copy ' +
      'unreachable in both directions. It is a project named "Templates ' +
      '(local copy …)", which is exactly what a person needs to salvage it',
    pushedHashes:
      'deliberately absent: those blobs are known present because the ' +
      'original’s cloud row references them, and this copy has no row. ' +
      'Carrying them would let its first push commit a row naming a blob ' +
      'nothing had checked was there',
    name: 'the argument: "<name> (local copy, <date>)"',
    syncedAt: 'deliberately absent: the copy has never agreed with the cloud',
    baseVersion:
      'deliberately absent, and carrying it would be a false claim. The fork ' +
      'has a fresh id, so no cloud row exists for it; naming a version would ' +
      'make its first push a compare-and-swap against a row that is not there, ' +
      'which the commit refuses. Absent means base 0 — "this project is new" — ' +
      'which is exactly what it is',
    syncedHashes:
      'deliberately absent, for the same reason as syncedAt: divergence is ' +
      'measured against what the two sides last agreed, and this copy has ' +
      'never agreed with anything. Carrying the original’s would declare the ' +
      'fork already in sync with a row it has no relationship to',
    lastOpenedAt: 'never opened; it sorts by updatedAt beside its original',
    templateId:
      'deliberately absent: a fork is a new project, and two projects both ' +
      'bound to one template would each mirror their saves into it and ' +
      'overwrite each other. The original keeps the binding',
  },
};

/** Field names declared on the StoredRecord interface. */
function storedRecordFields(): string[] {
  const start = src.indexOf('interface StoredRecord {');
  const end = src.indexOf('\n}', start);
  expect(start, 'StoredRecord interface not found — the scan stopped working').toBeGreaterThan(-1);
  return [...src.slice(start, end).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
}

/**
 * A builder's body with comments stripped.
 *
 * The strip is what makes this catch a *removed* carry rather than only a new
 * field: the comment explaining why `syncedAt` is carried mentions `syncedAt`,
 * so a plain text search still matched after the line doing the carrying was
 * deleted. Measured, not assumed — the mutation that drops the carry passed
 * until the comments came out.
 */
function body(name: string, until: string): string {
  const start = src.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = src.indexOf(until, start);
  return src
    .slice(start, end > start ? end : undefined)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('every StoredRecord field is accounted for', () => {
  const fields = storedRecordFields();

  it('found the interface', () => {
    // Without this the sweep passes by having nothing to check.
    expect(fields).toContain('syncedAt');
    expect(fields.length).toBeGreaterThan(5);
  });

  for (const [name, until] of BUILDERS) {
    it(name, () => {
      const text = body(name, until);
      expect(text.length, `${name}'s body looks empty`).toBeGreaterThan(200);
      const missing = fields.filter((f) => !EXCUSED[name]?.[f] && !text.includes(f));
      expect(
        missing,
        `${name} builds a StoredRecord without carrying: ${missing.join(', ')} — ` +
          'carry them across, or excuse each with a reason',
      ).toEqual([]);
    });
  }
});
