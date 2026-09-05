// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Open Existing Project lists projects, and nothing that only looks like one.
 *
 * Templates, Symbols, Footprints and 3D Models sit at the root of the account's
 * tree beside the projects, because that tree is this app's file manager and
 * that is where they belong. In this one dialog they are the worst kind of
 * noise: four rows that look exactly like what is being asked for and can never
 * be it — the dialog already refuses to accept one — so all they do is push the
 * real projects down the list. Which is what a user reported, with seven rows
 * of which three were projects.
 */
import { describe, expect, it } from 'vitest';
import { projectsOnlyFileSystem } from '@ziroeda/designer/src/fs/chooser_places.js';
import type { Entry, FileSystem } from '@ziroeda/designer/src/fs/filesystem.js';

const folder = (name: string, path = `/${name}`): Entry => ({
  name,
  path,
  kind: 'folder',
  size: null,
  modified: 0,
});
const project = (name: string, path = `/${name}`): Entry => ({
  name,
  path,
  kind: 'project',
  size: null,
  modified: 0,
});

/** The account tree as the root actually comes back: folders first. */
function fakeBelow(root: Entry[], deeper: Entry[] = []): FileSystem & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async list(dir: string) {
      asked.push(dir);
      return dir === '/' ? root : deeper;
    },
    async stat() {
      return null;
    },
    async read() {
      return new Uint8Array();
    },
    async write() {},
    async mkdir() {},
    async mkproject() {},
    async rename() {},
    async remove() {},
  } as FileSystem & { asked: string[] };
}

describe('the root of Open Existing Project', () => {
  it('shows the projects and hides the four shared folders', async () => {
    const fs = projectsOnlyFileSystem(
      fakeBelow([
        folder('3D Models'),
        folder('Footprints'),
        folder('Symbols'),
        folder('Templates'),
        project('ACtoDCconverter'),
        project('Amp'),
      ]),
    );
    expect((await fs.list('/')).map((e) => e.name)).toEqual(['ACtoDCconverter', 'Amp']);
  });

  it('keeps a project that happens to be called Symbols', async () => {
    // Compared by path, not by name. The shared folder is `/Symbols`; a project
    // of that name is a different path, and hiding it would lose somebody's
    // work from the only dialog that opens it.
    const fs = projectsOnlyFileSystem(
      fakeBelow([folder('Symbols'), project('Symbols', '/Symbols (1)')]),
    );
    const names = (await fs.list('/')).map((e) => e.path);
    expect(names).toEqual(['/Symbols (1)']);
  });

  it('leaves everything below the root alone', async () => {
    // Only the root is filtered. Walking into a project must still show its
    // files, and a file inside one may legitimately be called Templates.
    const fs = projectsOnlyFileSystem(
      fakeBelow([], [folder('Templates', '/Amp/Templates'), project('x', '/Amp/x')]),
    );
    expect((await fs.list('/Amp')).map((e) => e.name)).toEqual(['Templates', 'x']);
  });

  it('delegates everything that is not a listing', async () => {
    // A path picked here has to be a real path in the account, so nothing but
    // `list` may differ — otherwise the caller needs a special case for it.
    const below = fakeBelow([]);
    const fs = projectsOnlyFileSystem(below);
    await fs.stat('/Amp');
    await fs.remove('/Amp');
    expect(typeof fs.mkproject).toBe('function');
    expect(fs.stat).toBe(below.stat);
    expect(fs.remove).toBe(below.remove);
  });
});
