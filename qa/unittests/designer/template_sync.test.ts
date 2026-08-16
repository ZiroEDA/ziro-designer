// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two decisions in the user-template sync: which side of the index wins,
 * and whether a deleted template stays deleted.
 *
 * Both are the kind of thing that looks right and is not. A merge that ignores
 * tombstones resurrects every template the user deleted, on the next sync, on
 * every other machine - and it does it silently, because a resurrected template
 * is indistinguishable from one that simply had not arrived yet.
 */
import { describe, expect, it } from 'vitest';
import {
  mergeIndexes,
  templateIndexPath,
  type TemplateIndexEntry,
} from '@ziroeda/designer/src/cloud/templateSync.js';
import { renameRel } from '@ziroeda/designer/src/home/templates.js';

const entry = (id: string, updatedAt: number, deletedAt?: number): TemplateIndexEntry => ({
  id,
  title: id,
  description: '',
  base: id,
  icon: null,
  html: '',
  createdAt: 1,
  updatedAt,
  ...(deletedAt ? { deletedAt } : {}),
  files: [],
});

describe('templateIndexPath', () => {
  it('scopes the index to the user, under their own prefix', () => {
    // The same prefix blobs live under, so row-level storage policies that
    // already cover "<userId>/..." cover this too.
    expect(templateIndexPath('u1')).toBe('u1/templates/index.json');
  });
});

describe('renameRel, reversed - how a save finds the template file it came from', () => {
  // updateUserTemplateFiles undoes CreateProject's rename by calling renameRel
  // with base and projectName swapped. That only works because the rename is
  // symmetric, so this is the property the mirror actually depends on: get it
  // wrong and a save silently matches nothing and the template never changes.
  const roundTrip = (rel: string, base: string, proj: string): string =>
    renameRel(renameRel(rel, base, proj), proj, base);

  it('returns the template path for a renamed project file', () => {
    expect(renameRel('API.kicad_sch', 'API', 'MyCopy')).toBe('MyCopy.kicad_sch');
    expect(renameRel('MyCopy.kicad_sch', 'MyCopy', 'API')).toBe('API.kicad_sch');
  });

  it('round-trips the files a template actually holds', () => {
    for (const rel of [
      'API.kicad_pro',
      'API.kicad_sch',
      'API.kicad_pcb',
      'API.kicad_prl',
      'sub/API.kicad_sch',
    ]) {
      expect(roundTrip(rel, 'API', 'MyCopy')).toBe(rel);
    }
  });

  it('round-trips the files the rename deliberately leaves alone', () => {
    // Drawing sheets, legacy libraries and .pretty directories are not renamed
    // on the way in, so they must not be renamed on the way back either.
    for (const rel of [
      'API.kicad_wks',
      'API.lib',
      'fp-lib-table',
      'sym-lib-table',
      'API.pretty/Mount.kicad_mod',
    ]) {
      expect(roundTrip(rel, 'API', 'MyCopy')).toBe(rel);
    }
  });

  it('round-trips when the name is unchanged', () => {
    // Edit Template opens under the template's own basename, so this is the
    // ordinary case and the rename is a no-op in both directions.
    expect(roundTrip('API.kicad_sch', 'API', 'API')).toBe('API.kicad_sch');
  });
});

describe('mergeIndexes', () => {
  it('keeps templates that exist on only one side', () => {
    const merged = mergeIndexes([entry('a', 10)], [entry('b', 20)]);
    expect(merged.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('takes the newer of two versions of the same template', () => {
    const merged = mergeIndexes([entry('a', 10)], [entry('a', 30)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.updatedAt).toBe(30);
  });

  it('is symmetric: the argument order does not decide the winner', () => {
    const older = entry('a', 10);
    const newer = entry('a', 30);
    expect(mergeIndexes([older], [newer])[0]!.updatedAt).toBe(30);
    expect(mergeIndexes([newer], [older])[0]!.updatedAt).toBe(30);
  });

  it('lets a newer tombstone bury a template the other side still has', () => {
    // The machine that deleted it pushes the tombstone; the machine that still
    // has it must not win just because its copy has files.
    const merged = mergeIndexes([entry('a', 10)], [entry('a', 20, 20)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe(20);
  });

  it('lets a re-created template outlive an older tombstone', () => {
    // Deleted, then a template of the same name made again: the newer creation
    // wins, or the name would be unusable forever.
    const merged = mergeIndexes([entry('a', 20, 20)], [entry('a', 40)]);
    expect(merged[0]!.deletedAt).toBeUndefined();
    expect(merged[0]!.updatedAt).toBe(40);
  });

  it('orders newest first', () => {
    const merged = mergeIndexes([entry('a', 10), entry('c', 30)], [entry('b', 20)]);
    expect(merged.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('handles both sides empty', () => {
    expect(mergeIndexes([], [])).toEqual([]);
  });
});
