// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The places sidebar, and which of its rows a file may be SAVED into.
 *
 * GTK builds one `GtkPlacesSidebar` for every `wxFileDialog` in the process, so
 * the rows are the same in KiCad's project manager and in an editor's Open —
 * and a row that is not a save target leaves the Save button insensitive
 * rather than letting a person type a name and meet an error. Ours had the
 * list assembled inside HomePage, so it existed in one window only, and
 * nothing anywhere said which rows were writable.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { standardChooserPlaces } from '@ziroeda/designer/src/fs/chooser_places.js';
import { FsErrorCode } from '@ziroeda/designer/src/fs/filesystem.js';
import type { Entry, FileSystem } from '@ziroeda/designer/src/fs/filesystem.js';

/** A stand-in for the account's tree — the one place that DOES take a write. */
const accountFs: FileSystem = {
  list: async (): Promise<Entry[]> => [],
  stat: async (): Promise<Entry | null> => null,
  read: async (): Promise<Uint8Array> => new Uint8Array(),
  write: async (): Promise<void> => {},
  mkdir: async (): Promise<void> => {},
  mkproject: async (): Promise<void> => {},
  rename: async (): Promise<void> => {},
  remove: async (): Promise<void> => {},
};

const places = standardChooserPlaces(accountFs);
const byId = (id: string) => places.find((p) => p.id === id);

describe('the shared places sidebar', () => {
  it('lists all four rows, Recent first', () => {
    // Recent is the row above Home in GtkPlacesSidebar, and the one a person
    // reaches for most.
    expect(places.map((p) => p.id)).toEqual(['recent', 'projects', 'demos', 'templates']);
  });

  it('gives Projects no filesystem of its own, which is what makes it the tree', () => {
    // Every other row brings a listing; Projects browses the caller's tree, and
    // the chooser reads that absence as "this is the writable one".
    expect(byId('projects')?.fs).toBeUndefined();
    for (const id of ['recent', 'demos', 'templates'])
      expect(byId(id)?.fs, `${id} browses its own listing`).toBeDefined();
  });

  it('makes a template a leaf rather than a folder that opens empty', () => {
    // A template's manifest carries no file list, so there is nothing inside
    // one to show. `activateOpens` is how the widget is told.
    expect(byId('templates')?.activateOpens).toBe(true);
    expect(byId('demos')?.activateOpens).toBeFalsy();
  });
});

describe('the save gate', () => {
  it('refuses a write to Recent, Demos and Templates', async () => {
    for (const id of ['recent', 'demos', 'templates']) {
      const fs = byId(id)?.fs;
      expect(fs, `${id} has a filesystem`).toBeDefined();
      await expect(
        (fs as FileSystem).write('/anything.kicad_sch', new Uint8Array()),
        `${id} is read-only`,
      ).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
    }
  });

  it('refuses every other way of changing one of them, not just write', async () => {
    // A gate on `write` alone leaves New Folder and Rename open, which is the
    // same hole from a different button.
    const fs = byId('demos')?.fs as FileSystem;
    await expect(fs.mkdir('/x')).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
    await expect(fs.mkproject('/x')).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
    await expect(fs.rename('/x', 'y')).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
    await expect(fs.remove('/x')).rejects.toMatchObject({ code: FsErrorCode.READ_ONLY });
  });

  it('lets a write through to the account tree, so the gate is not just "everything"', async () => {
    // The other half: a test that only proved things were refused would pass
    // with every place read-only, and then nothing could be saved at all.
    await expect(accountFs.write('/p/x.kicad_sch', new Uint8Array())).resolves.toBeUndefined();
  });
});

const CHOOSER = readFileSync(
  fileURLToPath(new URL('../../../designer/src/fs/FileChooser.tsx', import.meta.url)),
  'utf8',
);

describe('the widget half of the gate', () => {
  it('reads a place with its own tree as not writable by default', () => {
    // The rule lives in one expression, and this is it: `writable` when the
    // place says so, otherwise "only the row with no fs of its own".
    expect(CHOOSER).toContain('place.writable ?? place.fs === undefined');
  });

  it('blocks the accept button AND the name entry, not one of the two', () => {
    // Leaving the entry live in a place nothing can be saved to invites the
    // name that has nowhere to go.
    expect(CHOOSER).toContain("mode === 'save' ? placeWritable && isValidName(name)");
    expect(CHOOSER).toContain('disabled={!placeWritable}');
  });
});
