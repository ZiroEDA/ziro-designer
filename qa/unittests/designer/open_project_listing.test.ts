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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  USER_DIRS,
  isReservedRootName,
  projectsOnlyFileSystem,
} from '@ziroeda/designer/src/fs/chooser_places.js';
import { newProjectFolderName } from '@ziroeda/designer/src/home/new_project.js';
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

/**
 * New Project Folder lists the same root, and used to be the ONE exception:
 * the four names are the ones a new project may not take, and somebody about to
 * create a project called "Templates" was better off seeing it was taken. That
 * reads as four undeletable folders in a window that only ever asks for a name,
 * so the window hides them like every other and REFUSES the name instead.
 *
 * Without the refusal the project is made and the tree shows it as
 * `Templates (2)` — `byDisplayName` disambiguating a collision the person never
 * meant to create, and never asked to be renamed out of.
 */
describe('the name a new project may not take', () => {
  it('refuses every shared folder’s name', () => {
    for (const path of Object.values(USER_DIRS))
      expect(isReservedRootName(path.replace(/^\/+/, '')), path).toBe(true);
  });

  it('refuses it whatever the capitals, because the tree is keyed by name', () => {
    expect(isReservedRootName('templates')).toBe(true);
    expect(isReservedRootName('3D MODELS')).toBe(true);
  });

  it('refuses it with the spaces a file dialog leaves on the end', () => {
    expect(isReservedRootName('  Symbols ')).toBe(true);
  });

  it('allows every other name, including one that merely contains it', () => {
    for (const ok of ['Blinky', 'My Templates', 'Symbols2', 'templates-old', ''])
      expect(isReservedRootName(ok), ok).toBe(false);
  });

  it('refuses the name New Project Folder would otherwise create', () => {
    // The whole decision the window makes about the path it gets back.
    const decided = newProjectFolderName('/Templates.kicad_pro');
    expect(decided).toStrictEqual({
      refusal:
        '\u201cTemplates\u201d is the name of a shared folder in this account.  Please choose another name.',
    });
  });

  it('takes every other name, with upstream’s own extension handling', () => {
    // `.kicad_pro` is replaced by SetExt and disappears; any other extension is
    // folded back into the name (kicad_manager_control.cpp:287-300).
    expect(newProjectFolderName('/Blinky.kicad_pro')).toStrictEqual({ name: 'Blinky' });
    expect(newProjectFolderName('/rev.2')).toStrictEqual({ name: 'rev.2' });
  });

  it('is the LEAF of the path, not the folder it was typed in', () => {
    // The chooser can be standing anywhere; `wxFileName::GetName()` is the
    // leaf. Sanitising hides this at the root, where the only separator is the
    // leading slash it strips anyway.
    expect(newProjectFolderName('/Blinky/rev2.kicad_pro')).toStrictEqual({ name: 'rev2' });
  });

  it('creates nothing at all from a name that sanitises away', () => {
    expect(newProjectFolderName('/???')).toBeNull();
  });

  it('is asked by New Project Folder before the project is made', () => {
    // Per-occurrence, read off the element: the check has to sit in the accept
    // handler of THAT chooser, above the call that creates the project.
    const src = readFileSync(
      fileURLToPath(new URL('../../../designer/src/home/HomePage.tsx', import.meta.url)),
      'utf8',
    );
    const at = src.indexOf('title="New Project Folder"');
    const dialog =
      at < 0 ? undefined : src.slice(src.lastIndexOf('<FileChooser', at), src.indexOf('/>', at));
    expect(dialog, 'the New Project Folder chooser').toBeTruthy();
    expect(dialog).toContain('newProjectFolderName(path)');
    // The refusal has to be ACTED on, not merely computed: the window says it
    // and stops. `'refusal' in decided` guards the create below it.
    expect(dialog).toContain("'refusal' in decided");
    expect(dialog).toContain('setInfoMessage(decided.refusal)');
    expect(dialog!.indexOf('newProjectFolderName')).toBeLessThan(dialog!.indexOf('createFromTpl'));
    // And it browses the filtered tree, not the account's own.
    expect(dialog).toContain('fs={openProjectFs}');
  });
});
